import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import {
  BOUNDARY_TYPE,
  isInternalPlanTool,
  newCycle,
  offState,
  parseState,
  transformContext,
  validState,
  validateShell,
  withoutInternalPlanTools,
  type PlanState,
} from "./core.ts";
import { completePlan } from "./index.ts";
import { acceptEditedArchive, isArchivePath, MAX_PLAN_SIZE, writePlanArchive } from "./storage.ts";

function planningState(): PlanState {
  return {
    kind: "pi-plan-state",
    version: 2,
    phase: "planning",
    cycle: newCycle({
      previousTools: ["read"],
      previousThinking: "high",
      planningModel: "inherit",
      planningThinking: "inherit",
    }),
  };
}

describe("plan completion", () => {
  test("archives the plan, stores ready state, and terminates the agent turn", async () => {
    const archived: string[] = [];
    const completion = await completePlan(planningState(), "  # Ready plan  ", async (plan) => {
      archived.push(plan);
      return "/archive/ready.md";
    });

    expect(archived).toEqual(["# Ready plan"]);
    expect(completion.state).toMatchObject({
      phase: "ready",
      cycle: { plan: "# Ready plan", archivePath: "/archive/ready.md", revision: 1 },
    });
    expect(completion.result.terminate).toBe(true);
    expect(completion.result).not.toHaveProperty("isError");
  });

  test.each([
    ["inactive", offState(), "# Plan", undefined],
    ["empty", planningState(), "   ", undefined],
    ["oversized", planningState(), "x".repeat(MAX_PLAN_SIZE + 1), undefined],
    ["archive failure", planningState(), "# Plan", async () => Promise.reject(new Error("disk"))],
  ])("rejects %s completion without terminating", async (_name, state, plan, archive) => {
    const completion = await completePlan(state, plan, archive);
    expect(completion.state).toBe(state);
    expect(completion.result.isError).toBe(true);
    expect(completion.result).not.toHaveProperty("terminate");
  });
});

test("Plan interaction waits emit Herdr blocked state without direct socket code", async () => {
  const index = await readFile(new URL("index.ts", import.meta.url), "utf8");
  expect(index).toContain('pi.events.emit("herdr:blocked", { active: true, label })');
  expect(index).toContain('pi.events.emit("herdr:blocked", { active: false, label })');
  expect(index).not.toContain("HERDR_SOCKET_PATH");
});

describe("internal Plan tool filtering", () => {
  test("recognizes the reserved tool names", () => {
    expect(isInternalPlanTool("plan_mode_question")).toBe(true);
    expect(isInternalPlanTool("plan_mode_complete")).toBe(true);
    expect(isInternalPlanTool("read")).toBe(false);
  });

  test("removes only internal tools while preserving order", () => {
    expect(
      withoutInternalPlanTools([
        "read",
        "plan_mode_question",
        "custom",
        "plan_mode_complete",
        "bash",
      ]),
    ).toEqual(["read", "custom", "bash"]);
  });

  test("is idempotent and leaves normal tool lists unchanged", () => {
    const normal = ["read", "custom", "bash"];
    const filtered = withoutInternalPlanTools(normal);
    expect(filtered).toEqual(normal);
    expect(withoutInternalPlanTools(filtered)).toEqual(normal);
  });

  test("cleans internal tools from historical previous-tool data", () => {
    const previousTools = ["edit", "plan_mode_complete", "write"];
    expect(withoutInternalPlanTools(previousTools)).toEqual(["edit", "write"]);
  });
});

describe("strict shell policy", () => {
  const cases: Array<[string, boolean]> = [
    ["rg -n plan src | head -20", true],
    ["git --no-pager diff --no-ext-diff", true],
    ["vp check", true],
    ["uv lock --check", true],
    ["cargo test", true],
    ["go vet ./...", true],
    ["rtk git status --short", true],
    ["rtk git diff -- packages/pi-plan/src/core.ts", true],
    ["rtk rg plan packages/pi-plan", true],
    ["rtk cargo test", true],
    ["git status", false],
    ["git --no-pager diff", false],
    ["git --no-pager checkout main", false],
    ["rtk", false],
    ["rtk rtk git status", false],
    ["rtk unknown inspect", false],
    ["rtk git checkout main", false],
    ["rtk git diff --ext-diff", false],
    ["rtk rg --pre helper plan", false],
    ["rtk vp check --fix", false],
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
  expect(transformContext(messages, true)).toEqual(messages.slice(4));
});

test("strips stale completion interactions after selecting the latest boundary while off", () => {
  const boundary = {
    role: "custom",
    customType: BOUNDARY_TYPE,
    details: { version: 1 },
    content: "implement",
  };
  const messages = [
    { role: "user", content: "old" },
    boundary,
    {
      role: "assistant",
      content: [
        { type: "text", text: "keep" },
        { type: "toolCall", name: "plan_mode_complete" },
      ],
    },
    { role: "toolResult", toolName: "plan_mode_complete", content: "stale" },
  ];
  expect(transformContext(messages, false)).toEqual([
    boundary,
    { role: "assistant", content: [{ type: "text", text: "keep" }] },
  ]);
  expect(transformContext(messages, true)).toEqual(messages.slice(1));
});

test("runtime application is fail-closed and does not persist unchanged state", async () => {
  const index = await readFile(new URL("index.ts", import.meta.url), "utf8");
  const applyStart = index.indexOf("async function applyPlanning");
  const applyEnd = index.indexOf("async function restoreRuntime", applyStart);
  const applyPlanning = index.slice(applyStart, applyEnd);
  expect(applyPlanning.indexOf("pi.setActiveTools")).toBeLessThan(
    applyPlanning.indexOf("await pi.setModel"),
  );
  expect(applyPlanning).not.toContain("persist();");
  expect(index.match(/await applyPlanning\(ctx\);\n\s+persist\(\);/g)).toHaveLength(2);
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
