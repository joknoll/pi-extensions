import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import { parseArguments } from "./arguments.ts";
import { generateCompaction } from "./compactor.ts";
import { loadConfig } from "./config.ts";
import { createPendingSlot } from "./pending.ts";
import { reviewCompaction } from "./review.ts";
import type {
  CompactionProfile,
  PiCompactConfig,
  RunOptions,
  SmartCompactionDetails,
} from "./types.ts";

export type { CompactionProfile, PiCompactConfig, SmartCompactionDetails } from "./types.ts";

const HELP = `Usage:
/smart-compact
/smart-compact fast|balanced|thorough [--model=provider/id] [--apply] [--] [focus]
/smart-compact options
/smart-compact status

Profiles choose internal quality and cost budgets. --apply skips editable review. Native /compact and automatic compaction are unchanged.`;

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
): { model?: Model<any>; warning?: string; error?: string } {
  if (explicit) {
    const model = findModel(ctx, explicit);
    return model ? { model } : { error: `Unknown model: ${explicit}` };
  }
  if (config.summaryModel) {
    const configured = findModel(ctx, config.summaryModel);
    if (configured && ctx.modelRegistry.hasConfiguredAuth(configured)) return { model: configured };
    return {
      model: ctx.model,
      warning: `Configured summary model ${config.summaryModel} is unavailable; using ${modelLabel(ctx.model)}`,
    };
  }
  return { model: ctx.model };
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
      ? `Latest: ${latest.profile} · ${latest.model} · ${latest.verification.status} · facts ${latest.verification.coveredFacts}/${latest.verification.totalFacts} · repairs ${latest.verification.repairCount}`
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
  const profiles: CompactionProfile[] = [
    config.profile,
    ...(["fast", "balanced", "thorough"] as const).filter((value) => value !== config.profile),
  ];
  const profile = await ctx.ui.select("Compaction profile", profiles);
  if (!profile) return undefined;

  const current = modelLabel(ctx.model);
  const available = ctx.modelRegistry.getAvailable();
  const modelOptions = [
    `Active model (${current})`,
    ...available.map(modelLabel).filter((value) => value !== current),
  ];
  const selectedModel = await ctx.ui.select("Summary model", modelOptions);
  if (!selectedModel) return undefined;
  const model = selectedModel.startsWith("Active model")
    ? ctx.model
    : findModel(ctx, selectedModel);
  if (!model) {
    ctx.ui.notify("The selected model is no longer available", "error");
    return undefined;
  }

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

function startCompaction(
  ctx: ExtensionCommandContext,
  pending: ReturnType<typeof createPendingSlot>,
  options: RunOptions,
): void {
  if (options.review && !ctx.hasUI) {
    ctx.ui.notify(
      "Reviewed smart compaction requires TUI/RPC mode; use --apply to run non-interactively",
      "error",
    );
    return;
  }
  const sessionId = ctx.sessionManager.getSessionId();
  pending.set(sessionId, options);
  ctx.ui.notify(
    `Starting ${options.profile} smart compaction with ${modelLabel(options.model ?? ctx.model)}`,
    "info",
  );
  ctx.compact({
    customInstructions: options.focus,
    onComplete: (result) => {
      pending.clear();
      ctx.ui.notify(
        `Smart compaction applied: ${result.tokensBefore.toLocaleString()} tokens before compaction`,
        "info",
      );
    },
    onError: (error) => {
      pending.clear();
      ctx.ui.notify(`Smart compaction could not start: ${error.message}`, "error");
    },
  });
}

export default function piCompactExtension(pi: ExtensionAPI): void {
  const pending = createPendingSlot();

  pi.registerCommand("smart-compact", {
    description: "Create a verified, editable compaction checkpoint",
    getArgumentCompletions: (prefix) => {
      const values = [
        "fast",
        "balanced",
        "thorough",
        "options",
        "status",
        "help",
        "--model=",
        "--apply",
        "--",
      ];
      const matches = values
        .filter((value) => value.startsWith(prefix))
        .map((value) => ({ value, label: value }));
      return matches.length > 0 ? matches : null;
    },
    handler: async (args, ctx) => {
      await ctx.waitForIdle();
      let parsed;
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
        if (options) startCompaction(ctx, pending, options);
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
      startCompaction(ctx, pending, {
        profile: parsed.profile ?? loaded.config.profile,
        model: resolved.model,
        explicitModel: parsed.model,
        focus: parsed.focus,
        review: parsed.apply ? false : loaded.config.review,
      });
    },
  });

  pi.on("session_before_compact", async (event, ctx) => {
    if (event.reason !== "manual") return undefined;
    const options = pending.consume(ctx.sessionManager.getSessionId());
    if (!options) return undefined;
    try {
      ctx.ui.setWorkingMessage("Extracting critical context…");
      const generated = await generateCompaction(event.preparation, options, ctx, event.signal);
      if (!generated) {
        ctx.ui.notify("Smart verification did not pass; using native Pi compaction", "warning");
        return undefined;
      }
      if (options.review) {
        ctx.ui.setWorkingMessage("Waiting for compaction review…");
        const reviewed = await reviewCompaction(generated, ctx, loadConfig(ctx).externalEditor);
        if (reviewed.kind === "cancel") {
          ctx.ui.notify("Smart compaction cancelled", "info");
          return { cancel: true };
        }
        return { compaction: reviewed.generated.result };
      }
      return { compaction: generated.result };
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
    pending.clear();
  });
}
