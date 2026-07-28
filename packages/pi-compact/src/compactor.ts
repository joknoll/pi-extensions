import type {
  CompactionResult,
  ExtensionContext,
  SessionBeforeCompactEvent,
} from "@earendil-works/pi-coding-agent";
import type { AssistantMessage, Model } from "@earendil-works/pi-ai";
import { getLlmClient } from "./llm.ts";
import type {
  CompactionProfile,
  EvidenceFact,
  ResolvedProfile,
  RunOptions,
  SmartCompactionDetails,
  VerificationReport,
} from "./types.ts";

type CompactionPreparation = SessionBeforeCompactEvent["preparation"];

export const PROFILE_SETTINGS: Record<CompactionProfile, ResolvedProfile> = {
  fast: { outputTokens: 4_096, reasoning: "low", toolResultChars: 2_000, repairWithModel: false },
  balanced: {
    outputTokens: 8_192,
    reasoning: "medium",
    toolResultChars: 4_000,
    repairWithModel: true,
  },
  thorough: {
    outputTokens: 12_288,
    reasoning: "high",
    toolResultChars: 8_000,
    repairWithModel: true,
  },
};

const REQUIRED_HEADINGS = [
  "## Goal",
  "## Constraints and Preferences",
  "## Progress",
  "## Key Decisions",
  "## Open Loops",
  "## Next Steps",
  "## Critical Context",
] as const;

const PREFIXED_SECRET_PATTERNS = [
  /(authorization\s*[:=]\s*(?:bearer\s+)?)[^\s,;]+/gi,
  /((?:api[_-]?key|access[_-]?token|secret|password)\s*[:=]\s*)[^\s,;]+/gi,
] as const;
const TOKEN_SECRET_PATTERN = /\b(?:sk|xox[baprs]|gh[pousr])[-_][a-z0-9_-]{12,}\b/gi;

function textOf(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (part): part is { type: "text"; text: string } =>
        Boolean(part) &&
        typeof part === "object" &&
        (part as { type?: unknown }).type === "text" &&
        typeof (part as { text?: unknown }).text === "string",
    )
    .map((part) => part.text)
    .join("\n");
}

function cleanFact(value: string, limit = 600): string {
  return value.replace(/\s+/g, " ").trim().slice(0, limit);
}

export function redactSecrets(value: string): string {
  let result = value;
  for (const pattern of PREFIXED_SECRET_PATTERNS) result = result.replace(pattern, "$1[REDACTED]");
  return result.replace(TOKEN_SECRET_PATTERN, "[REDACTED]");
}

function uniqueFacts(facts: EvidenceFact[]): EvidenceFact[] {
  const seen = new Set<string>();
  return facts.filter((fact) => {
    const key = `${fact.kind}:${fact.text.toLowerCase()}`;
    if (!fact.text || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function fileLists(preparation: CompactionPreparation): {
  readFiles: string[];
  modifiedFiles: string[];
} {
  const modifiedFiles = [
    ...new Set([...preparation.fileOps.written, ...preparation.fileOps.edited]),
  ].sort((left, right) => left.localeCompare(right));
  const modified = new Set(modifiedFiles);
  const readFiles = [...preparation.fileOps.read]
    .filter((path) => !modified.has(path))
    .sort((left, right) => left.localeCompare(right));
  return { readFiles, modifiedFiles };
}

export function extractEvidence(
  preparation: CompactionPreparation,
  focus?: string,
): EvidenceFact[] {
  const facts: EvidenceFact[] = [];
  if (focus) facts.push({ kind: "focus", text: cleanFact(redactSecrets(focus)), critical: true });

  const messages = [...preparation.messagesToSummarize, ...preparation.turnPrefixMessages];
  const userMessages = messages
    .filter((message) => (message as { role?: string }).role === "user")
    .map(textOf);
  const latestRequest = [...userMessages]
    .reverse()
    .find((text) => text.trim() && !text.trim().startsWith("/"));
  if (latestRequest)
    facts.push({
      kind: "goal",
      text: cleanFact(redactSecrets(latestRequest), 900),
      critical: true,
    });

  const constraintPattern =
    /\b(must|never|do not|don't|should not|required?|prefer|only|without|keep|avoid)\b/i;
  for (const message of userMessages) {
    for (const line of message.split(/\n+/)) {
      if (constraintPattern.test(line)) {
        facts.push({ kind: "constraint", text: cleanFact(redactSecrets(line)), critical: true });
      }
    }
  }

  for (const message of messages) {
    const role = (message as { role?: string }).role;
    const text = textOf(message);
    if (
      role === "toolResult" &&
      ((message as { isError?: boolean }).isError ||
        /\b(error|failed|exception|exit code [1-9])\b/i.test(text))
    ) {
      facts.push({ kind: "error", text: cleanFact(redactSecrets(text)), critical: true });
    }
    if (role === "assistant") {
      for (const line of text.split(/\n+/)) {
        if (/\b(decided|decision|we will|the approach|chosen|root cause|blocked)\b/i.test(line)) {
          facts.push({
            kind: /blocked/i.test(line) ? "open-loop" : "decision",
            text: cleanFact(redactSecrets(line)),
            critical: false,
          });
        }
      }
    }
  }

  const files = fileLists(preparation);
  for (const path of files.modifiedFiles)
    facts.push({ kind: "file", text: `Modified file: ${path}`, critical: true });
  for (const path of files.readFiles)
    facts.push({ kind: "file", text: `Read file: ${path}`, critical: false });
  return uniqueFacts(facts).slice(-80);
}

function truncateMiddle(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  const half = Math.floor((maxChars - 80) / 2);
  return `${value.slice(0, half)}\n… [${value.length - half * 2} characters omitted] …\n${value.slice(-half)}`;
}

export function serializeForSummary(
  preparation: CompactionPreparation,
  model: Model<any>,
  profile: ResolvedProfile,
): string {
  const messages = [...preparation.messagesToSummarize, ...preparation.turnPrefixMessages];
  const messageChunks = messages.map((message, index) => {
    const role = (message as { role?: string }).role ?? "custom";
    const maxChars = role === "toolResult" ? profile.toolResultChars : 12_000;
    const marker = index >= preparation.messagesToSummarize.length ? " split-turn-prefix" : "";
    return `[${role}${marker}]\n${truncateMiddle(redactSecrets(textOf(message)), maxChars)}`;
  });
  const outputTokens = Math.min(
    profile.outputTokens,
    model.maxTokens || profile.outputTokens,
    preparation.settings.reserveTokens,
  );
  const inputTokens = Math.max(8_000, model.contextWindow - outputTokens - 8_192);
  const maxChars = inputTokens * 4;
  const selected: string[] = [];
  let used = 0;
  for (let index = messageChunks.length - 1; index >= 0; index -= 1) {
    const chunk = messageChunks[index];
    if (used + chunk.length > maxChars && selected.length > 0) continue;
    selected.unshift(chunk);
    used += chunk.length;
  }
  return selected.join("\n\n");
}

function promptFor(
  preparation: CompactionPreparation,
  evidence: EvidenceFact[],
  transcript: string,
  focus?: string,
): string {
  const previous = preparation.previousSummary
    ? redactSecrets(preparation.previousSummary)
    : "None";
  const facts = evidence
    .map(
      (fact, index) =>
        `F${index + 1} [${fact.kind}${fact.critical ? ", critical" : ""}]: ${fact.text}`,
    )
    .join("\n");
  return `Create a compact checkpoint summary of the supplied coding-agent history.

Output Markdown only and use these headings exactly:
${REQUIRED_HEADINGS.join("\n")}

Preserve concrete goals, user constraints, decisions, completed work, unresolved failures, blockers, and next actions. Do not claim unfinished work is done. Do not invent file paths. Use concise bullets. If the input is a split turn, append a section named **Turn Context (split turn):** explaining the retained suffix. The file lists are added deterministically later; do not add XML file tags.

Requested focus: ${focus ? redactSecrets(focus) : "No additional focus"}

Previous compaction summary:
${previous}

Evidence ledger (higher priority than prose):
${facts || "No deterministic facts extracted"}

Conversation transcript:
${transcript}`;
}

function assistantText(message: AssistantMessage): string {
  if (message.stopReason === "error" || message.stopReason === "aborted") {
    throw new Error(message.errorMessage || `Summary model stopped with ${message.stopReason}`);
  }
  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function normalizeWords(value: string): Set<string> {
  return new Set(value.toLowerCase().match(/[a-z0-9_./-]{3,}/g) ?? []);
}

function factCovered(summaryWords: Set<string>, fact: EvidenceFact): boolean {
  const words = [...normalizeWords(fact.text)].filter(
    (word) => !["file", "modified", "read", "with", "from", "that", "this"].includes(word),
  );
  if (words.length === 0) return true;
  const matches = words.filter((word) => summaryWords.has(word)).length;
  return matches / words.length >= 0.65;
}

function sectionFor(fact: EvidenceFact): string {
  switch (fact.kind) {
    case "goal":
      return "## Goal";
    case "constraint":
    case "focus":
      return "## Constraints and Preferences";
    case "decision":
      return "## Key Decisions";
    case "error":
    case "open-loop":
      return "## Open Loops";
    case "file":
      return "## Critical Context";
  }
}

function appendUnder(summary: string, heading: string, text: string): string {
  const headingIndex = summary.indexOf(heading);
  if (headingIndex < 0) return `${summary.trim()}\n\n${heading}\n\n- ${text}`;
  const afterHeading = headingIndex + heading.length;
  const nextHeading = summary.indexOf("\n## ", afterHeading);
  const insertion = nextHeading < 0 ? summary.length : nextHeading;
  return `${summary.slice(0, insertion).trimEnd()}\n- ${text}\n${summary.slice(insertion).trimStart()}`.trim();
}

function pathCandidates(value: string): Set<string> {
  return new Set(
    value.match(/(?:\.?\.?\/)?[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+\.[A-Za-z0-9_.-]+/g) ?? [],
  );
}

export function verifyAndRepair(
  summaryInput: string,
  facts: EvidenceFact[],
  knownText: string,
): VerificationReport {
  let summary = summaryInput.trim();
  let repairCount = 0;
  const gapKinds: string[] = [];
  for (const heading of REQUIRED_HEADINGS) {
    if (!summary.includes(heading)) {
      summary += `\n\n${heading}\n\n- None recorded.`;
      repairCount += 1;
    }
  }
  let words = normalizeWords(summary);
  for (const fact of facts.filter((candidate) => candidate.critical)) {
    if (!factCovered(words, fact)) {
      summary = appendUnder(summary, sectionFor(fact), `[Preserved fact] ${fact.text}`);
      repairCount += 1;
      words = normalizeWords(summary);
    }
  }

  const knownPaths = pathCandidates(knownText);
  for (const fact of facts.filter((candidate) => candidate.kind === "file")) {
    for (const path of pathCandidates(fact.text)) knownPaths.add(path);
  }
  const unknownPaths = [...pathCandidates(summary)].filter((path) => !knownPaths.has(path));
  if (unknownPaths.length > 0) gapKinds.push("unknown-file-path");
  const critical = facts.filter((fact) => fact.critical);
  const coveredFacts = critical.filter((fact) => factCovered(normalizeWords(summary), fact)).length;
  return {
    summary,
    coveredFacts,
    totalFacts: critical.length,
    repairCount,
    gapKinds,
    acceptable: coveredFacts === critical.length && gapKinds.length === 0 && summary.length > 0,
  };
}

async function repairWithModel(
  report: VerificationReport,
  model: Model<any>,
  auth: { apiKey?: string; headers?: Record<string, string>; env?: Record<string, string> },
  signal: AbortSignal,
  profile: ResolvedProfile,
  knownText: string,
): Promise<string> {
  const knownPaths = [...pathCandidates(knownText)].join("\n") || "No file paths were observed";
  const response = await getLlmClient().complete(
    model,
    {
      systemPrompt: "Repair a compaction summary. Return Markdown only; do not add facts.",
      messages: [
        {
          role: "user",
          content: `Remove or replace unsupported file paths. Do not change supported facts or add new ones.\n\nKNOWN FILE PATHS:\n${knownPaths}\n\nSUMMARY:\n${report.summary}`,
          timestamp: Date.now(),
        },
      ],
    },
    {
      ...auth,
      signal,
      maxTokens: Math.min(profile.outputTokens, model.maxTokens || profile.outputTokens),
      reasoning: profile.reasoning,
    },
  );
  return assistantText(response);
}

function fileTags(readFiles: string[], modifiedFiles: string[]): string {
  return `\n\n<read-files>\n${readFiles.join("\n")}\n</read-files>\n\n<modified-files>\n${modifiedFiles.join("\n")}\n</modified-files>`;
}

export interface GeneratedCompaction {
  result: CompactionResult<SmartCompactionDetails>;
  report: VerificationReport;
  modelLabel: string;
}

export async function generateCompaction(
  preparation: CompactionPreparation,
  options: RunOptions,
  ctx: ExtensionContext,
  signal: AbortSignal,
): Promise<GeneratedCompaction | undefined> {
  const model = options.model ?? ctx.model;
  if (!model) throw new Error("No active model is available for compaction");
  const resolved = PROFILE_SETTINGS[options.profile];
  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok) throw new Error(auth.error);
  const evidence = extractEvidence(preparation, options.focus);
  const transcript = serializeForSummary(preparation, model, resolved);
  const knownText = `${preparation.previousSummary ?? ""}\n${transcript}`;
  const maxTokens = Math.min(
    resolved.outputTokens,
    model.maxTokens || resolved.outputTokens,
    preparation.settings.reserveTokens,
  );

  ctx.ui.setWorkingMessage("Synthesizing audited compact…");
  const response = await getLlmClient().complete(
    model,
    {
      systemPrompt: "You summarize coding-agent context without continuing the conversation.",
      messages: [
        {
          role: "user",
          content: promptFor(preparation, evidence, transcript, options.focus),
          timestamp: Date.now(),
        },
      ],
    },
    { ...auth, signal, maxTokens, reasoning: resolved.reasoning },
  );
  let report = verifyAndRepair(assistantText(response), evidence, knownText);
  if (!report.acceptable && resolved.repairWithModel) {
    ctx.ui.setWorkingMessage("Repairing verification gaps…");
    const repaired = await repairWithModel(report, model, auth, signal, resolved, knownText);
    report = verifyAndRepair(repaired, evidence, knownText);
    report.repairCount += 1;
  }
  if (!report.acceptable) return undefined;

  const files = fileLists(preparation);
  const summary = `${report.summary.trim()}${fileTags(files.readFiles, files.modifiedFiles)}`;
  const modelLabel = `${model.provider}/${model.id}`;
  const details: SmartCompactionDetails = {
    kind: "pi-compact",
    version: 1,
    profile: options.profile,
    model: modelLabel,
    verification: {
      status: "verified",
      coveredFacts: report.coveredFacts,
      totalFacts: report.totalFacts,
      repairCount: report.repairCount,
      gapKinds: report.gapKinds,
    },
    readFiles: files.readFiles,
    modifiedFiles: files.modifiedFiles,
  };
  return {
    modelLabel,
    report,
    result: {
      summary,
      firstKeptEntryId: preparation.firstKeptEntryId,
      tokensBefore: preparation.tokensBefore,
      estimatedTokensAfter: preparation.settings.keepRecentTokens + Math.ceil(summary.length / 4),
      details,
    },
  };
}
