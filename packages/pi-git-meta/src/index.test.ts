import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { expect, test } from "vite-plus/test";
import piGitMeta from "./index.ts";

test("records, restores, attaches, and reports failures", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-git-meta-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = join(root, "agent");
  await mkdir(join(root, ".git"));

  let head = "base";
  let branchEntries: unknown[] = [{ id: "before" }];
  let failGet = false;
  const pending = new Set<string>();
  const relations = new Map<string, Set<string>>();
  const values = new Map<string, Map<string, string>>();
  const notifications: Array<{ message: string; level: string }> = [];

  const exec = async (command: string, args: string[]) => {
    if (command === "git") {
      if (args.includes("--show-toplevel")) return result(root);
      if (args.includes("--git-dir")) return result(join(root, ".git"));
      if (args.includes("--is-ancestor")) return result("");
      if (args.includes("--short")) return result("main");
      if (args[0] === "rev-list") return result(head === "base" ? "" : head);
      if (args.includes("--verify")) return result(head);
    }
    if (args[0] === "--version") return result("git-meta 0.1.10");
    if (args[0] === "get") {
      if (failGet) return result("", 1, "get failed");
      if (args[1]?.startsWith("change-id:")) {
        const chunks = Object.fromEntries(
          [...(values.get(args[1]) ?? [])]
            .filter(([key]) => key.startsWith("pi:trace-chunk:"))
            .map(([key, value]) => [key.slice(-6), value]),
        );
        return result(
          Object.keys(chunks).length ? JSON.stringify({ pi: { "trace-chunk": chunks } }) : "",
        );
      }
      return result(
        pending.size
          ? JSON.stringify({ meta: { local: { pi: { "pending-traces": [...pending] } } } })
          : "",
      );
    }
    if (args[0] === "set") {
      const target = values.get(args[1]!) ?? new Map<string, string>();
      target.set(args[2]!, args[3]!);
      values.set(args[1]!, target);
    }
    if (args[0] === "set:add" && args[1] === "project") pending.add(args[3]!);
    if (args[0] === "set:add" && args[1]?.startsWith("commit:")) {
      const ids = relations.get(args[1]) ?? new Set<string>();
      ids.add(args[3]!);
      relations.set(args[1], ids);
    }
    if (args[0] === "set:rm") pending.delete(args[3]!);
    return result("");
  };

  const ctx = {
    cwd: root,
    model: { provider: "test", id: "model" },
    isProjectTrusted: () => true,
    sessionManager: {
      getBranch: () => branchEntries,
      getSessionId: () => "session",
    },
    ui: {
      notify: (message: string, level = "info") => notifications.push({ message, level }),
      setStatus: () => undefined,
    },
  } as unknown as ExtensionContext;

  function load() {
    const handlers = new Map<string, (event: never, context: ExtensionContext) => Promise<void>>();
    let command: ((args: string, context: ExtensionContext) => Promise<void>) | undefined;
    piGitMeta({
      exec,
      getThinkingLevel: () => "medium",
      on: (name: string, handler: never) => handlers.set(name, handler),
      registerCommand: (_name: string, value: { handler: typeof command }) => {
        command = value.handler;
      },
    } as unknown as ExtensionAPI);
    return { handlers, command: () => command! };
  }

  try {
    const first = load();
    await first.handlers.get("session_start")!({} as never, ctx);
    await first.handlers.get("before_agent_start")!({ prompt: "commit" } as never, ctx);
    head = "commit-1";
    branchEntries = [{ id: "before" }, { id: "after", type: "message", message: {} }];
    await first.handlers.get("agent_settled")!({} as never, ctx);
    expect(pending.size).toBe(0);
    expect(relations.get("commit:commit-1")?.size).toBe(1);

    const second = load();
    await second.handlers.get("session_start")!({} as never, ctx);
    await second.handlers.get("before_agent_start")!({ prompt: "pending" } as never, ctx);
    await second.handlers.get("agent_settled")!({} as never, ctx);
    expect(pending.size).toBe(1);
    expect([...pending][0]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );

    head = "commit-2";
    const third = load();
    await third.handlers.get("session_start")!({} as never, ctx);
    expect(pending.size).toBe(0);
    expect(relations.get("commit:commit-2")?.size).toBe(1);

    await third.handlers.get("before_agent_start")!({ prompt: "manual" } as never, ctx);
    await third.handlers.get("agent_settled")!({} as never, ctx);
    await third.command()("attach all HEAD", ctx);
    expect(pending.size).toBe(0);
    expect(relations.get("commit:commit-2")?.size).toBe(2);

    failGet = true;
    await third.command()("status", ctx);
    expect(notifications.at(-1)).toEqual({ message: "get failed", level: "error" });
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    await rm(root, { recursive: true, force: true });
  }
});

function result(stdout: string, code = 0, stderr = "") {
  return { stdout, stderr, code, killed: false };
}
