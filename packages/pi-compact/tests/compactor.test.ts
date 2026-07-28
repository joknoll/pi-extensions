import type { ExtensionContext, SessionBeforeCompactEvent } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage, Model } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, test } from "vite-plus/test";
import {
  extractEvidence,
  generateCompaction,
  redactSecrets,
  serializeForSummary,
  verifyAndRepair,
  PROFILE_SETTINGS,
} from "../src/compactor.ts";
import { resetLlmClient, setLlmClient } from "../src/llm.ts";

type Preparation = SessionBeforeCompactEvent["preparation"];

afterEach(() => resetLlmClient());

function response(text: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "anthropic-messages",
    provider: "test",
    model: "summary",
    usage: {
      input: 100,
      output: 100,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 200,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: 1,
  };
}

function preparation(): Preparation {
  return {
    firstKeptEntryId: "kept-entry",
    messagesToSummarize: [
      {
        role: "user",
        content: "Implement auth. You must preserve the refresh-token behavior.",
        timestamp: 1,
      },
      {
        role: "toolResult",
        toolCallId: "tool-1",
        toolName: "write",
        content: [
          { type: "text", text: "Error: packages/auth/session.ts failed with exit code 1" },
        ],
        isError: true,
        timestamp: 2,
      },
    ],
    turnPrefixMessages: [],
    isSplitTurn: false,
    tokensBefore: 60_000,
    previousSummary: "## Open Loops\n- Finish session refresh",
    fileOps: {
      read: new Set(["packages/auth/readme.md"]),
      written: new Set(["packages/auth/session.ts"]),
      edited: new Set<string>(),
    },
    settings: { enabled: true, reserveTokens: 16_384, keepRecentTokens: 20_000 },
  };
}

describe("audited compactor", () => {
  test("extracts critical goals, constraints, errors, and file operations", () => {
    const facts = extractEvidence(preparation(), "focus on auth");
    expect(facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "focus", critical: true }),
        expect.objectContaining({ kind: "goal", critical: true }),
        expect.objectContaining({ kind: "constraint", critical: true }),
        expect.objectContaining({ kind: "error", critical: true }),
        expect.objectContaining({ kind: "file", text: "Modified file: packages/auth/session.ts" }),
      ]),
    );
  });

  test("redacts likely credentials before model input", () => {
    expect(
      redactSecrets(
        "api_key=secret-value Authorization: Bearer token-value sk-exampleabcdefghijkl",
      ),
    ).toBe("api_key=[REDACTED] Authorization: Bearer [REDACTED] [REDACTED]");
  });

  test("repairs missing schema and critical facts deterministically", () => {
    const facts = extractEvidence(preparation());
    const report = verifyAndRepair(
      "## Goal\nImplement auth",
      facts,
      serializeForSummary(
        preparation(),
        { contextWindow: 100_000, maxTokens: 16_384 } as never,
        PROFILE_SETTINGS.fast,
      ),
    );
    expect(report.acceptable).toBe(true);
    expect(report.coveredFacts).toBe(report.totalFacts);
    expect(report.repairCount).toBeGreaterThan(0);
    expect(report.summary).toContain("[Preserved fact]");
    expect(report.summary).toContain("## Critical Context");
  });

  test("rejects a summary containing an unsupported file path", () => {
    const report = verifyAndRepair(
      "## Goal\nAuth\n## Constraints and Preferences\nNone\n## Progress\nNone\n## Key Decisions\nNone\n## Open Loops\nNone\n## Next Steps\nNone\n## Critical Context\nChanged packages/invented/file.ts",
      [],
      "Known conversation without paths",
    );
    expect(report.acceptable).toBe(false);
    expect(report.gapKinds).toContain("unknown-file-path");
  });

  test("returns a Pi-compatible verified compaction result", async () => {
    const calls: Array<{ maxTokens?: number; reasoning?: string }> = [];
    setLlmClient({
      async complete(_model, _context, options) {
        calls.push(options);
        return response(`## Goal
Implement auth
## Constraints and Preferences
Preserve refresh-token behavior
## Progress
Implementation is in progress
## Key Decisions
None
## Open Loops
Resolve the failed session write
## Next Steps
Fix the error
## Critical Context
packages/auth/session.ts failed with exit code 1`);
      },
    });
    const model = {
      provider: "test",
      id: "summary",
      contextWindow: 100_000,
      maxTokens: 16_384,
    } as Model<any>;
    const ctx = {
      model,
      modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "test" }) },
      ui: { setWorkingMessage() {} },
    } as unknown as ExtensionContext;

    const generated = await generateCompaction(
      preparation(),
      { profile: "balanced", model, review: false },
      ctx,
      new AbortController().signal,
    );

    expect(generated?.result).toMatchObject({
      firstKeptEntryId: "kept-entry",
      tokensBefore: 60_000,
      details: {
        kind: "pi-compact",
        profile: "balanced",
        model: "test/summary",
        verification: { status: "verified" },
      },
    });
    expect(generated?.result.summary).toContain("<modified-files>\npackages/auth/session.ts");
    expect(calls).toEqual([expect.objectContaining({ maxTokens: 8_192, reasoning: "medium" })]);
  });
});
