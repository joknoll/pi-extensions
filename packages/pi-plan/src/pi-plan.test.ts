import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { BOUNDARY_TYPE, parseState, transformContext, validState, validateShell } from "./core.ts";
import { acceptEditedArchive, isArchivePath, writePlanArchive } from "./storage.ts";

describe("strict shell policy", () => {
  const cases: Array<[string, boolean]> = [
    ["rg -n plan src | head -20", true],
    ["git --no-pager diff --no-ext-diff", true],
    ["vp check", true],
    ["uv lock --check", true],
    ["cargo test", true],
    ["go vet ./...", true],
    ["git status", false],
    ["git --no-pager checkout main", false],
    ["find . -delete", false],
    ["vp check --fix", false],
    ["cat file > copy", false],
    ["echo $(whoami)", false],
  ];
  test.each(cases)("%s allowed=%s", (command, allowed) => {
    expect(validateShell(command) === undefined).toBe(allowed);
  });
});

test("accepts current version-2 state with redundant runtime fields and rejects malformed state", () => {
  const current = {
    kind: "pi-plan-state",
    version: 2,
    phase: "ready",
    cycle: {
      id: "cycle",
      revision: 1,
      previousTools: ["read"],
      previousModel: "provider/model",
      previousThinking: "high",
      planningModel: "inherit",
      planningThinking: "inherit",
      effectiveModel: "provider/model",
      effectiveThinking: "high",
      plan: "# Plan",
      archivePath: "/tmp/plan.md",
    },
  };
  expect(validState(current)).toBe(true);
  expect(parseState(current)).not.toHaveProperty("cycle.effectiveModel");
  expect(validState({ ...current, cycle: { ...current.cycle, revision: -1 } })).toBe(false);
  expect(validState({ ...current, cycle: { ...current.cycle, archivePath: undefined } })).toBe(
    false,
  );
});

test("filters from the latest valid implementation boundary", () => {
  const messages = [
    { role: "user", content: "old" },
    { role: "custom", customType: BOUNDARY_TYPE, details: { version: 1 }, content: "first" },
    { role: "user", content: "middle" },
    { role: "custom", customType: BOUNDARY_TYPE, details: { version: 0 }, content: "invalid" },
    { role: "custom", customType: BOUNDARY_TYPE, details: { version: 1 }, content: "latest" },
    { role: "assistant", content: [{ type: "text", text: "new" }] },
  ];
  expect(transformContext(messages, false)).toEqual(messages.slice(4));
  expect(transformContext(messages, true)).toEqual(messages);
});

test("keeps archives contained, replaces atomically, and restores invalid edits", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-plan-test-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = directory;
  try {
    const path = await writePlanArchive("# First");
    expect(isArchivePath(path)).toBe(true);
    expect(isArchivePath(join(directory, "outside.md"))).toBe(false);
    expect(path).toMatch(/-first-[0-9a-f-]+\.md$/);

    const replaced = await writePlanArchive("# Second", path);
    expect(replaced).toBe(path);
    expect(await readFile(path, "utf8")).toBe("# Second");

    await writeFile(path, "   ", "utf8");
    await expect(acceptEditedArchive(path, "# Second", 0)).rejects.toThrow("empty");
    expect(await readFile(path, "utf8")).toBe("# Second");

    await writeFile(path, "# Changed", "utf8");
    await expect(acceptEditedArchive(path, "# Second", 1)).rejects.toThrow("status 1");
    expect(await readFile(path, "utf8")).toBe("# Second");
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    await rm(directory, { recursive: true, force: true });
  }
});
