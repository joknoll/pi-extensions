import { randomUUID } from "node:crypto";
import type { RunCapture, Trace } from "./types.ts";
const object = (v: unknown): Record<string, unknown> | undefined =>
  typeof v === "object" && v !== null ? (v as Record<string, unknown>) : undefined;
export const traceId = randomUUID;
export function sliceBranch(branch: unknown[], baseEntryId?: string) {
  if (!baseEntryId) return branch;
  const i = branch.findIndex((e) => object(e)?.id === baseEntryId);
  return i < 0 ? branch : branch.slice(i + 1);
}
export function buildTrace(
  capture: RunCapture,
  entries: unknown[],
  completion: { head?: string; commits: string[] },
): Trace {
  return {
    schemaVersion: 1,
    traceId: capture.traceId,
    session: { id: capture.sessionId },
    run: {
      startedAt: capture.startedAt,
      endedAt: new Date().toISOString(),
      prompt: capture.prompt,
      thinkingLevelAtStart: capture.thinkingLevel,
      baseEntryId: capture.baseEntryId,
    },
    git: {
      branch: capture.branch,
      baseCommit: capture.baseHead,
      headAtCompletion: completion.head,
      detectedCommits: completion.commits,
    },
    entries,
  };
}
export function canonical(trace: Trace) {
  return `${JSON.stringify(trace)}\n`;
}
