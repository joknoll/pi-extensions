import type { RunOptions } from "./types.ts";

interface PendingRequest {
  sessionId: string;
  createdAt: number;
  options: RunOptions;
}

export interface PendingSlot {
  set(sessionId: string, options: RunOptions): void;
  consume(sessionId: string): RunOptions | undefined;
  clear(): void;
  peek(): RunOptions | undefined;
}

export function createPendingSlot(ttlMs = 60_000, now: () => number = Date.now): PendingSlot {
  let pending: PendingRequest | undefined;
  return {
    set(sessionId, options) {
      pending = { sessionId, options, createdAt: now() };
    },
    consume(sessionId) {
      const candidate = pending;
      pending = undefined;
      if (!candidate || candidate.sessionId !== sessionId || now() - candidate.createdAt > ttlMs)
        return undefined;
      return candidate.options;
    },
    clear() {
      pending = undefined;
    },
    peek() {
      return pending?.options;
    },
  };
}
