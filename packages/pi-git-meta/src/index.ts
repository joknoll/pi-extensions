import { readFile } from "node:fs/promises";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "./config.ts";
import { commitsSince, discoverGit } from "./git.ts";
import { GitMeta } from "./git-meta.ts";
import { recoverSpool, removeSpool, writeSpool } from "./spool.ts";
import { buildTrace, canonical, sliceBranch, traceId } from "./trace.ts";
import type { GitState, RunCapture, Trace } from "./types.ts";

const PENDING_KEY = "meta:local:pi:pending-traces";
const TRACE_CHUNK_KEY = "pi:trace-chunk";
const TRACE_CHUNK_SIZE = 4096;
const TRACE_ID_PATTERN =
  /^(?:pi-trace-)?[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const USAGE = "Usage: /git-meta status | /git-meta attach [trace-id|all] [ref]";
const entryId = (value: unknown) =>
  typeof value === "object" && value !== null && typeof (value as { id?: unknown }).id === "string"
    ? (value as { id: string }).id
    : undefined;

function parseTrace(body: string): Trace {
  const value = JSON.parse(body) as Partial<Trace>;
  if (
    value.schemaVersion !== 1 ||
    typeof value.traceId !== "string" ||
    !TRACE_ID_PATTERN.test(value.traceId) ||
    typeof value.session?.id !== "string" ||
    !Array.isArray(value.git?.detectedCommits) ||
    !value.git.detectedCommits.every((commit) => typeof commit === "string") ||
    !Array.isArray(value.entries)
  )
    throw new Error("Invalid Pi trace");
  return value as Trace;
}

export default function piGitMeta(pi: ExtensionAPI): void {
  let git: GitState | undefined;
  let meta: GitMeta | undefined;
  let active: RunCapture | undefined;

  const report = (
    ctx: ExtensionContext,
    message: string,
    level: "info" | "warning" | "error" = "info",
  ) => ctx.ui.notify(message, level);

  async function pendingIds() {
    if (!meta) throw new Error("git-meta is unavailable");
    const output = await meta.run(["get", "project", PENDING_KEY, "--json"]);
    if (!output) return [];
    const value = JSON.parse(output) as {
      meta?: { local?: { pi?: { "pending-traces"?: unknown } } };
    };
    const ids = value.meta?.local?.pi?.["pending-traces"];
    if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string"))
      throw new Error("Invalid pending trace index");
    return ids;
  }

  async function refreshStatus(ctx: ExtensionContext) {
    const count = (await pendingIds()).length;
    ctx.ui.setStatus("git-meta", count ? `git-meta ${count} pending` : "git-meta");
  }

  async function ingest(path: string) {
    if (!meta) throw new Error("git-meta is unavailable");
    const body = await readFile(path, "utf8");
    const trace = parseTrace(body);
    const target = `change-id:${trace.traceId}`;
    await meta.set(target, "agent:schema", "pi-trace/v1");
    const encoded = Buffer.from(body).toString("base64");
    for (let offset = 0, index = 0; offset < encoded.length; offset += TRACE_CHUNK_SIZE, index++)
      await meta.set(
        target,
        `${TRACE_CHUNK_KEY}:${index.toString().padStart(6, "0")}`,
        encoded.slice(offset, offset + TRACE_CHUNK_SIZE),
      );
    await meta.add("project", PENDING_KEY, trace.traceId);
    await removeSpool(path);
    return trace;
  }

  async function readTrace(id: string) {
    if (!meta) throw new Error("git-meta is unavailable");
    const output = await meta.run(["get", `change-id:${id}`, TRACE_CHUNK_KEY, "--json"]);
    if (!output) throw new Error(`Missing data for pending trace: ${id}`);
    const value = JSON.parse(output) as { pi?: { "trace-chunk"?: unknown } };
    const chunks = value.pi?.["trace-chunk"];
    if (!chunks || typeof chunks !== "object" || Array.isArray(chunks))
      throw new Error(`Invalid data for pending trace: ${id}`);
    const entries = Object.entries(chunks);
    if (!entries.every(([, chunk]) => typeof chunk === "string"))
      throw new Error(`Invalid data for pending trace: ${id}`);
    const encoded = entries
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, chunk]) => chunk)
      .join("");
    return parseTrace(Buffer.from(encoded, "base64").toString());
  }

  async function resolveCommit(ref: string) {
    if (!git) throw new Error("Git repository is unavailable");
    const result = await pi.exec("git", ["rev-parse", "--verify", `${ref}^{commit}`], {
      cwd: git.root,
      timeout: 5000,
    });
    const commit = result.stdout.trim();
    if (result.code !== 0 || !commit) throw new Error(`Not a commit: ${ref}`);
    return commit;
  }

  async function attach(ids: string[], commits: string[]) {
    if (!meta) throw new Error("git-meta is unavailable");
    const pending = new Set(await pendingIds());
    for (const id of ids) if (!pending.has(id)) throw new Error(`Unknown pending trace: ${id}`);
    for (const id of ids) {
      for (const commit of commits) await meta.add(`commit:${commit}`, "agent:traces", id);
      await meta.remove("project", PENDING_KEY, id);
    }
  }

  async function reconcilePending(ctx: ExtensionContext) {
    if (!git || !meta) return;
    const ids = await pendingIds();
    if (ids.length !== 1) return;
    const trace = await readTrace(ids[0]!);
    const now = await discoverGit(pi, git.root);
    if (!now || now.branch !== trace.git.branch) return;
    const commits = await commitsSince(pi, git.root, trace.git.baseCommit, now.head);
    if (!commits.length) return;
    await attach(ids, commits);
    git = now;
    await refreshStatus(ctx);
  }

  pi.on("session_start", async (_event, ctx) => {
    git = undefined;
    meta = undefined;
    active = undefined;
    ctx.ui.setStatus("git-meta", undefined);
    const { config, warnings } = loadConfig(ctx);
    for (const warning of warnings) report(ctx, warning, "warning");
    if (!config.enabled || !ctx.isProjectTrusted()) return;
    git = await discoverGit(pi, ctx.cwd);
    if (!git) return;
    meta = new GitMeta(pi, config.command, git.root);
    try {
      await meta.run(["--version"]);
      for (const path of await recoverSpool(git.gitDir)) {
        let trace: Trace;
        try {
          trace = await ingest(path);
        } catch (error) {
          report(ctx, `git-meta recovery retained ${path}: ${String(error)}`, "error");
          continue;
        }
        if (trace.git.detectedCommits.length)
          try {
            await attach([trace.traceId], trace.git.detectedCommits);
          } catch (error) {
            report(
              ctx,
              `git-meta trace ${trace.traceId} remains pending: ${String(error)}`,
              "error",
            );
          }
      }
      try {
        await reconcilePending(ctx);
      } catch (error) {
        report(ctx, `git-meta pending trace was not attached: ${String(error)}`, "error");
      }
      await refreshStatus(ctx);
    } catch (error) {
      meta = undefined;
      ctx.ui.setStatus("git-meta", "git-meta error");
      report(ctx, `git-meta disabled: ${String(error)}`, "warning");
    }
  });

  pi.on("before_agent_start", async (event, ctx) => {
    if (!git || !meta || active) return;
    try {
      await reconcilePending(ctx);
    } catch (error) {
      report(ctx, `git-meta pending trace was not attached: ${String(error)}`, "error");
    }
    const now = await discoverGit(pi, git.root);
    if (!now) return;
    git = now;
    const branch = ctx.sessionManager.getBranch();
    active = {
      traceId: traceId(),
      sessionId: ctx.sessionManager.getSessionId(),
      baseEntryId: entryId(branch.at(-1)),
      prompt: event.prompt,
      startedAt: new Date().toISOString(),
      thinkingLevel: String(pi.getThinkingLevel()),
      model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined,
      baseHead: git.head,
      branch: git.branch,
    };
  });

  pi.on("agent_settled", async (_event, ctx) => {
    if (!active || !git || !meta) return;
    const capture = active;
    active = undefined;
    let path: string | undefined;
    try {
      const now = await discoverGit(pi, git.root);
      const commits =
        now?.branch === capture.branch
          ? await commitsSince(pi, git.root, capture.baseHead, now?.head)
          : [];
      const body = canonical(
        buildTrace(capture, sliceBranch(ctx.sessionManager.getBranch(), capture.baseEntryId), {
          head: now?.head,
          commits,
        }),
      );
      if (Buffer.byteLength(body) > loadConfig(ctx).config.maxTraceBytes)
        throw new Error(`trace ${capture.traceId} exceeds maxTraceBytes`);
      path = await writeSpool(git.gitDir, capture.traceId, body);
      const trace = await ingest(path);
      path = undefined;
      git = now ?? git;
      if (commits.length) await attach([trace.traceId], commits);
      await refreshStatus(ctx);
    } catch (error) {
      report(
        ctx,
        path ? `git-meta trace retained in recovery spool: ${String(error)}` : String(error),
        "error",
      );
    }
  });

  pi.on("session_shutdown", (_event, ctx) => ctx.ui.setStatus("git-meta", undefined));

  pi.registerCommand("git-meta", {
    description: "Show or attach Pi provenance traces",
    handler: async (args, ctx) => {
      try {
        if (!meta || !git) throw new Error("git-meta is unavailable");
        const tokens = args.trim().split(/\s+/).filter(Boolean);
        const action = tokens.shift() ?? "status";
        if (action === "status" && !tokens.length) {
          const ids = await pendingIds();
          return report(
            ctx,
            ids.length ? `Pending Pi traces:\n${ids.join("\n")}` : "No pending Pi traces",
          );
        }
        if (action !== "attach" || tokens.length > 2) throw new Error(USAGE);
        const selection = tokens[0] ?? "all";
        const pending = await pendingIds();
        const ids = selection === "all" ? pending : [selection];
        if (!ids.length) return report(ctx, "No pending Pi traces");
        await attach(ids, [await resolveCommit(tokens[1] ?? "HEAD")]);
        await refreshStatus(ctx);
        report(ctx, `Attached ${ids.length} trace(s)`);
      } catch (error) {
        report(ctx, error instanceof Error ? error.message : String(error), "error");
      }
    },
  });
}
