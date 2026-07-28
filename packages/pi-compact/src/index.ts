import {
  compact,
  type CompactionResult,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
  type SessionBeforeCompactEvent,
} from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import { loadConfig } from "./config.ts";
import { reviewCompaction } from "./review.ts";
import type {
  CompactionProfile,
  GeneratedCompaction,
  PiCompactConfig,
  RunOptions,
  SmartCompactionDetails,
} from "./types.ts";

export type {
  CompactionProfile,
  CompactionReviewStatus,
  PiCompactConfig,
  SmartCompactionDetails,
} from "./types.ts";

const HELP = `Usage:
/smart-compact
/smart-compact fast|balanced|thorough [--model=provider/id] [--apply] [--] [focus]
/smart-compact options
/smart-compact status

Profiles select low, medium, or high summary reasoning. --apply skips editable review. Native /compact and automatic compaction are unchanged.`;

const PROFILES = new Set<CompactionProfile>(["fast", "balanced", "thorough"]);
const REASONING = {
  fast: "low",
  balanced: "medium",
  thorough: "high",
} as const;
const MAX_EVIDENCE_ENTRIES = 20;
const MAX_EVIDENCE_CHARS = 500;
const FILE_TAG = /\n\n<read-files>/;

interface ParsedArguments {
  action: "run" | "options" | "status" | "help";
  profile?: CompactionProfile;
  model?: string;
  apply: boolean;
  focus?: string;
}

interface EvidenceAppendix {
  markdown: string;
  preserved: number;
  omitted: number;
}

interface PendingRequest {
  sessionId: string;
  options: RunOptions;
  reviewCancelled: boolean;
}

type CompactionPreparation = SessionBeforeCompactEvent["preparation"];

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let token = "";
  let quote: "'" | '"' | undefined;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quote) {
      if (character === quote) quote = undefined;
      else if (character === "\\" && quote === '"' && index + 1 < input.length)
        token += input[(index += 1)];
      else token += character;
    } else if (character === "'" || character === '"') quote = character;
    else if (/\s/.test(character)) {
      if (token) tokens.push(token);
      token = "";
    } else token += character;
  }
  if (quote) throw new Error("Unclosed quote in smart-compact arguments");
  if (token) tokens.push(token);
  return tokens;
}

export function parseArguments(input: string): ParsedArguments {
  const tokens = tokenize(input.trim());
  const first = tokens[0]?.toLowerCase();
  if (first === "status" || first === "help" || first === "options") {
    if (tokens.length > 1) throw new Error(`/${first} does not accept additional arguments`);
    return { action: first, apply: false };
  }

  let profile: CompactionProfile | undefined;
  let model: string | undefined;
  let apply = false;
  let remainder = false;
  const focus: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (remainder) focus.push(token);
    else if (token === "--") remainder = true;
    else if (token === "--apply") apply = true;
    else if (token === "--model" || token.startsWith("--model=")) {
      model = token === "--model" ? tokens[(index += 1)] : token.slice("--model=".length);
      if (!model) throw new Error("--model requires provider/model");
    } else if (!profile && PROFILES.has(token as CompactionProfile))
      profile = token as CompactionProfile;
    else if (token.startsWith("--")) throw new Error(`Unknown option: ${token}`);
    else focus.push(token);
  }
  return { action: "run", profile, model, apply, focus: focus.join(" ").trim() || undefined };
}

function textOf(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (part): part is { type: "text"; text: string } =>
        typeof part === "object" &&
        part !== null &&
        (part as { type?: unknown }).type === "text" &&
        typeof (part as { text?: unknown }).text === "string",
    )
    .map((part) => part.text)
    .join("\n");
}

function truncateEvidence(value: string): string {
  const clean = value.replace(/\s+/g, " ").trim();
  const characters = Array.from(
    new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(clean),
    ({ segment }) => segment,
  );
  if (characters.length <= MAX_EVIDENCE_CHARS) return clean;
  return `${characters.slice(0, MAX_EVIDENCE_CHARS - 20).join("")}... [truncated]`;
}

export function extractEvidence(preparation: CompactionPreparation): EvidenceAppendix {
  const candidates: string[] = [];
  const messages = [...preparation.messagesToSummarize, ...preparation.turnPrefixMessages];
  const directive = /^\s*(?:[-*+]\s+|\d+[.)]\s+)?(?:must|never|do not|only|keep|avoid|prefer)\b/i;

  for (const message of messages) {
    const role = (message as { role?: string }).role;
    const text = textOf(message);
    if (role === "user") {
      for (const line of text.split(/\r?\n/)) if (directive.test(line)) candidates.push(line);
    } else if (role === "toolResult" && (message as { isError?: boolean }).isError === true) {
      if (text.trim()) candidates.push(`Tool error: ${text}`);
    }
  }

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const candidate of candidates) {
    const evidence = truncateEvidence(candidate);
    const key = evidence.toLocaleLowerCase();
    if (!evidence || seen.has(key)) continue;
    seen.add(key);
    unique.push(evidence);
  }
  const preserved = unique.slice(0, MAX_EVIDENCE_ENTRIES);
  const omitted = unique.length - preserved.length;
  const omission =
    omitted > 0 ? `\n- ${omitted} additional evidence item(s) omitted by limit.` : "";
  return {
    markdown:
      preserved.length > 0
        ? `## Preserved Evidence\n\n${preserved.map((item) => `- ${item}`).join("\n")}${omission}`
        : "",
    preserved: preserved.length,
    omitted,
  };
}

function appendEvidence(summary: string, appendix: EvidenceAppendix): string {
  if (!appendix.markdown) return summary;
  const match = FILE_TAG.exec(summary);
  if (!match || match.index === undefined) return `${summary.trimEnd()}\n\n${appendix.markdown}`;
  return `${summary.slice(0, match.index).trimEnd()}\n\n${appendix.markdown}${summary.slice(match.index)}`;
}

function modelLabel(model: Model<any> | undefined): string {
  return model ? `${model.provider}/${model.id}` : "none";
}

function findModel(ctx: ExtensionContext, value: string): Model<any> | undefined {
  const slash = value.indexOf("/");
  if (slash < 1 || slash === value.length - 1) return undefined;
  return ctx.modelRegistry.find(value.slice(0, slash), value.slice(slash + 1));
}

function resolveConfiguredModel(
  ctx: ExtensionContext,
  config: PiCompactConfig,
  explicit?: string,
): { model?: Model<any>; configured: boolean; warning?: string; error?: string } {
  if (explicit) {
    const model = findModel(ctx, explicit);
    return model
      ? { model, configured: false }
      : { configured: false, error: `Unknown model: ${explicit}` };
  }
  if (config.summaryModel) {
    const configured = findModel(ctx, config.summaryModel);
    if (configured && ctx.modelRegistry.hasConfiguredAuth(configured))
      return { model: configured, configured: true };
    return {
      model: ctx.model,
      configured: false,
      warning: `Configured summary model ${config.summaryModel} is unavailable; using ${modelLabel(ctx.model)}`,
    };
  }
  return { model: ctx.model, configured: false };
}

function isCrossProvider(ctx: ExtensionContext, model: Model<any>): boolean {
  return Boolean(ctx.model && model.provider !== ctx.model.provider);
}

function latestDetails(ctx: ExtensionContext): SmartCompactionDetails | undefined {
  const branch = ctx.sessionManager.getBranch();
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index];
    if (entry.type !== "compaction") continue;
    const details = entry.details as Partial<SmartCompactionDetails> | undefined;
    if (details?.kind === "pi-compact" && details.version === 1)
      return details as SmartCompactionDetails;
  }
  return undefined;
}

function showStatus(ctx: ExtensionContext): void {
  const loaded = loadConfig(ctx);
  const resolved = resolveConfiguredModel(ctx, loaded.config);
  const usage = ctx.getContextUsage();
  const latest = latestDetails(ctx);
  const lines = [
    `Context: ${usage?.tokens?.toLocaleString() ?? "unknown"}/${usage?.contextWindow.toLocaleString() ?? "unknown"}${usage?.percent == null ? "" : ` (${Math.round(usage.percent)}%)`}`,
    `Profile: ${loaded.config.profile}`,
    `Summary model: ${modelLabel(resolved.model)}`,
    `Review: ${loaded.config.review ? "external editor" : "disabled"}`,
    latest
      ? `Latest: ${latest.profile} · ${latest.model} · ${latest.status} · evidence ${latest.preservedEvidence} preserved, ${latest.omittedEvidence} omitted`
      : "Latest: no smart compaction on this branch",
  ];
  for (const warning of [...loaded.warnings, ...(resolved.warning ? [resolved.warning] : [])])
    lines.push(`Warning: ${warning}`);
  ctx.ui.notify(lines.join("\n"), loaded.warnings.length || resolved.warning ? "warning" : "info");
}

async function optionsMenu(
  ctx: ExtensionCommandContext,
  config: PiCompactConfig,
): Promise<RunOptions | undefined> {
  if (!ctx.hasUI) {
    ctx.ui.notify("/smart-compact options requires TUI or RPC mode", "error");
    return undefined;
  }
  const profiles = [
    config.profile,
    ...(["fast", "balanced", "thorough"] as const).filter((value) => value !== config.profile),
  ];
  const profile = await ctx.ui.select("Compaction profile", profiles);
  if (!profile) return undefined;

  const current = modelLabel(ctx.model);
  const selectedModel = await ctx.ui.select("Summary model", [
    `Active model (${current})`,
    ...ctx.modelRegistry
      .getAvailable()
      .map(modelLabel)
      .filter((value) => value !== current),
  ]);
  if (!selectedModel) return undefined;
  const model = selectedModel.startsWith("Active model")
    ? ctx.model
    : findModel(ctx, selectedModel);
  if (!model) {
    ctx.ui.notify("The selected model is no longer available", "error");
    return undefined;
  }
  if (isCrossProvider(ctx, model))
    ctx.ui.notify(
      `Using ${model.provider} will send compacted conversation context to a provider other than the active ${ctx.model?.provider} provider.`,
      "warning",
    );

  const focus = await ctx.ui.input(
    "Optional focus",
    "Leave empty to preserve the whole working state",
  );
  if (focus === undefined) return undefined;
  const reviewChoice = await ctx.ui.select(
    "Review",
    config.review
      ? ["Edit in external editor", "Apply without review"]
      : ["Apply without review", "Edit in external editor"],
  );
  if (!reviewChoice) return undefined;
  return {
    profile: profile as CompactionProfile,
    model,
    focus: focus.trim() || undefined,
    review: reviewChoice === "Edit in external editor",
  };
}

export function shouldHandleCompaction(
  reason: SessionBeforeCompactEvent["reason"],
  request: PendingRequest | undefined,
  sessionId: string,
): request is PendingRequest {
  return reason === "manual" && request?.sessionId === sessionId;
}

export function cancellationErrorMessage(
  request: Pick<PendingRequest, "reviewCancelled"> | undefined,
  error: Error,
): string | undefined {
  return request?.reviewCancelled
    ? undefined
    : `Smart compaction could not start: ${error.message}`;
}

export default function piCompactExtension(pi: ExtensionAPI): void {
  let pending: PendingRequest | undefined;

  function startCompaction(ctx: ExtensionCommandContext, options: RunOptions): void {
    if (options.review && !ctx.hasUI) {
      ctx.ui.notify(
        "Reviewed smart compaction requires TUI/RPC mode; use --apply to run non-interactively",
        "error",
      );
      return;
    }
    const request: PendingRequest = {
      sessionId: ctx.sessionManager.getSessionId(),
      options,
      reviewCancelled: false,
    };
    pending = request;
    ctx.ui.notify(
      `Starting ${options.profile} smart compaction with ${modelLabel(options.model)}`,
      "info",
    );
    ctx.compact({
      customInstructions: options.focus,
      onComplete: (result) => {
        if (pending === request) pending = undefined;
        ctx.ui.notify(
          `Smart compaction applied: ${result.tokensBefore.toLocaleString()} tokens before compaction`,
          "info",
        );
      },
      onError: (error) => {
        if (pending === request) pending = undefined;
        const message = cancellationErrorMessage(request, error);
        if (message) ctx.ui.notify(message, "error");
      },
    });
  }

  pi.registerCommand("smart-compact", {
    description: "Create a native, editable compaction checkpoint",
    getArgumentCompletions: (prefix) => {
      const matches = [
        "fast",
        "balanced",
        "thorough",
        "options",
        "status",
        "help",
        "--model=",
        "--apply",
        "--",
      ]
        .filter((value) => value.startsWith(prefix))
        .map((value) => ({ value, label: value }));
      return matches.length > 0 ? matches : null;
    },
    handler: async (args, ctx) => {
      await ctx.waitForIdle();
      let parsed: ParsedArguments;
      try {
        parsed = parseArguments(args);
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
        return;
      }
      if (parsed.action === "help") {
        ctx.ui.notify(HELP, "info");
        return;
      }
      if (parsed.action === "status") {
        showStatus(ctx);
        return;
      }

      const loaded = loadConfig(ctx);
      for (const warning of loaded.warnings) ctx.ui.notify(warning, "warning");
      if (parsed.action === "options") {
        const options = await optionsMenu(ctx, loaded.config);
        if (options) startCompaction(ctx, options);
        return;
      }

      const resolved = resolveConfiguredModel(ctx, loaded.config, parsed.model);
      if (resolved.error) {
        ctx.ui.notify(resolved.error, "error");
        return;
      }
      if (resolved.warning) ctx.ui.notify(resolved.warning, "warning");
      if (!resolved.model) {
        ctx.ui.notify("No active model is available for smart compaction", "error");
        return;
      }

      if (isCrossProvider(ctx, resolved.model)) {
        const warning = `Using ${resolved.model.provider} will send compacted conversation context to a provider other than the active ${ctx.model?.provider} provider.`;
        if (parsed.model) ctx.ui.notify(warning, "warning");
        else if (resolved.configured && !ctx.hasUI) {
          ctx.ui.notify(
            `${warning} Non-interactive use requires an explicit --model=${modelLabel(resolved.model)}.`,
            "error",
          );
          return;
        } else if (resolved.configured) {
          const confirmed = await ctx.ui.confirm("Use cross-provider summary model?", warning);
          if (!confirmed) {
            ctx.ui.notify("Smart compaction cancelled", "info");
            return;
          }
        }
      }

      startCompaction(ctx, {
        profile: parsed.profile ?? loaded.config.profile,
        model: resolved.model,
        focus: parsed.focus,
        review: parsed.apply ? false : loaded.config.review,
      });
    },
  });

  pi.on("session_before_compact", async (event, ctx) => {
    const request = pending;
    if (!shouldHandleCompaction(event.reason, request, ctx.sessionManager.getSessionId()))
      return undefined;
    pending = undefined;
    try {
      ctx.ui.setWorkingMessage("Generating native Pi compaction…");
      const auth = await ctx.modelRegistry.getApiKeyAndHeaders(request.options.model);
      if (!auth.ok) throw new Error(auth.error);
      const nativeResult = await compact(
        event.preparation,
        request.options.model,
        auth.apiKey,
        auth.headers,
        request.options.focus,
        event.signal,
        REASONING[request.options.profile],
        undefined,
        auth.env,
      );
      const evidence = extractEvidence(event.preparation);
      const nativeDetails = nativeResult.details as
        | { readFiles?: string[]; modifiedFiles?: string[] }
        | undefined;
      const details: SmartCompactionDetails = {
        kind: "pi-compact",
        version: 1,
        profile: request.options.profile,
        model: modelLabel(request.options.model),
        status: "generated",
        preservedEvidence: evidence.preserved,
        omittedEvidence: evidence.omitted,
        readFiles: nativeDetails?.readFiles ?? [],
        modifiedFiles: nativeDetails?.modifiedFiles ?? [],
      };
      const generated: GeneratedCompaction = {
        modelLabel: details.model,
        result: {
          ...nativeResult,
          summary: appendEvidence(nativeResult.summary, evidence),
          details,
        } satisfies CompactionResult<SmartCompactionDetails>,
      };
      if (!request.options.review) return { compaction: generated.result };

      ctx.ui.setWorkingMessage("Waiting for compaction review…");
      const reviewed = await reviewCompaction(generated, ctx, loadConfig(ctx).externalEditor);
      if (reviewed.kind === "cancel") {
        request.reviewCancelled = true;
        ctx.ui.notify("Smart compaction cancelled", "info");
        return { cancel: true };
      }
      return { compaction: reviewed.generated.result };
    } catch (error) {
      if (event.signal.aborted) return { cancel: true };
      ctx.ui.notify(
        `Smart compaction failed; using native Pi compaction: ${error instanceof Error ? error.message : String(error)}`,
        "warning",
      );
      return undefined;
    } finally {
      ctx.ui.setWorkingMessage();
    }
  });

  pi.on("session_shutdown", () => {
    pending = undefined;
  });
}
