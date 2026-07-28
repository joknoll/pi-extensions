import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export type CacheUsage = {
  input: number;
  cacheRead: number;
  cacheWrite: number;
};

export type CacheStats = {
  reportedRequests: number;
  unavailableRequests: number;
  hitRequests: number;
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

type UnknownRecord = Record<string, unknown>;

const STATUS_KEY = "pi-cache";

function record(value: unknown): UnknownRecord | undefined {
  return typeof value === "object" && value !== null ? (value as UnknownRecord) : undefined;
}

function nonNegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/**
 * Reads Pi's normalized usage shape. Missing cache fields mean unavailable
 * telemetry, not a cache miss.
 */
export function readCacheUsage(message: unknown): CacheUsage | undefined {
  const messageRecord = record(message);
  const usage = record(messageRecord?.usage);
  if (!usage) return undefined;

  const input = nonNegativeNumber(usage.input);
  const cacheRead = nonNegativeNumber(usage.cacheRead);
  const cacheWrite = nonNegativeNumber(usage.cacheWrite);
  if (input === undefined || cacheRead === undefined || cacheWrite === undefined) return undefined;

  return { input, cacheRead, cacheWrite };
}

export function emptyCacheStats(): CacheStats {
  return {
    reportedRequests: 0,
    unavailableRequests: 0,
    hitRequests: 0,
    inputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
}

export function addMessageToStats(stats: CacheStats, message: unknown): CacheStats {
  const usage = readCacheUsage(message);
  if (!usage) return { ...stats, unavailableRequests: stats.unavailableRequests + 1 };

  return {
    ...stats,
    reportedRequests: stats.reportedRequests + 1,
    hitRequests: stats.hitRequests + (usage.cacheRead > 0 ? 1 : 0),
    inputTokens: stats.inputTokens + usage.input + usage.cacheRead + usage.cacheWrite,
    cacheReadTokens: stats.cacheReadTokens + usage.cacheRead,
    cacheWriteTokens: stats.cacheWriteTokens + usage.cacheWrite,
  };
}

export function formatCacheStatus(stats: CacheStats): string {
  if (stats.reportedRequests === 0) {
    return stats.unavailableRequests > 0 ? "cache n/a" : "";
  }

  const percentage =
    stats.inputTokens === 0 ? 0 : Math.round((stats.cacheReadTokens / stats.inputTokens) * 100);
  return `cache ${stats.hitRequests}/${stats.reportedRequests} · ${percentage}%`;
}

function formatTokens(tokens: number): string {
  return tokens < 1_000 ? String(tokens) : `${(tokens / 1_000).toFixed(tokens < 10_000 ? 1 : 0)}k`;
}

export function formatCacheReport(stats: CacheStats): string {
  const status = formatCacheStatus(stats) || "cache awaiting first response";
  const lines = [status];

  if (stats.reportedRequests > 0) {
    lines.push(
      `Cached reads: ${formatTokens(stats.cacheReadTokens)} / ${formatTokens(stats.inputTokens)} input tokens`,
    );
    if (stats.cacheWriteTokens > 0)
      lines.push(`Cache writes: ${formatTokens(stats.cacheWriteTokens)} tokens`);
  }
  if (stats.unavailableRequests > 0) {
    lines.push(
      `Cache usage unavailable: ${stats.unavailableRequests} response${stats.unavailableRequests === 1 ? "" : "s"}`,
    );
  }
  lines.push("Session-only; rebuilt from the active session history after reload.");
  return lines.join("\n");
}

function isAssistantMessage(message: unknown): boolean {
  return record(message)?.role === "assistant";
}

function restoreCurrentBranch(ctx: ExtensionContext, add: (message: unknown) => void): void {
  for (const entry of ctx.sessionManager.getBranch()) {
    const entryRecord = record(entry);
    if (entryRecord?.type === "message" && isAssistantMessage(entryRecord.message))
      add(entryRecord.message);
  }
}

/**
 * Shows cache telemetry already supplied by Pi/provider responses. It never
 * changes prompts, request payloads, environment variables, or model config.
 */
export default function piCache(pi: ExtensionAPI): void {
  let stats = emptyCacheStats();
  let countedMessages = new WeakSet<object>();

  const publish = (ctx: ExtensionContext): void => {
    ctx.ui.setStatus(STATUS_KEY, formatCacheStatus(stats) || undefined);
  };

  const add = (message: unknown): void => {
    const messageRecord = record(message);
    if (!messageRecord || !isAssistantMessage(messageRecord) || countedMessages.has(messageRecord))
      return;
    countedMessages.add(messageRecord);
    stats = addMessageToStats(stats, messageRecord);
  };

  pi.on("session_start", async (_event, ctx) => {
    stats = emptyCacheStats();
    countedMessages = new WeakSet<object>();
    restoreCurrentBranch(ctx, add);
    publish(ctx);
  });

  pi.on("message_end", async (event, ctx) => {
    add(event.message);
    publish(ctx);
  });

  pi.registerCommand("cache-stats", {
    description: "Show prompt-cache telemetry for the current session",
    handler: async (args, ctx) => {
      if (args.trim().toLowerCase() === "reset") {
        stats = emptyCacheStats();
        publish(ctx);
        ctx.ui.notify(
          "Current cache measurement reset (a reload restores session history).",
          "info",
        );
        return;
      }
      ctx.ui.notify(formatCacheReport(stats), "info");
    },
  });
}
