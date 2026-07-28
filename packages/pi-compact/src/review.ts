import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { GeneratedCompaction } from "./types.ts";

export type ReviewResult = { kind: "apply"; generated: GeneratedCompaction } | { kind: "cancel" };

function splitCommand(command: string): [string, string[]] {
  const tokens =
    command
      .match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)
      ?.map((token) => token.replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, "$1$2")) ?? [];
  const executable = tokens.shift();
  if (!executable) throw new Error("No external editor is configured");
  return [executable, tokens];
}

export async function editWithExternalEditor(
  summary: string,
  editorCommand: string,
  run: typeof spawn = spawn,
): Promise<string | undefined> {
  const directory = await mkdtemp(join(tmpdir(), "pi-compact-"));
  const file = join(directory, "summary.md");
  try {
    await writeFile(file, summary, "utf8");
    const [command, args] = splitCommand(editorCommand);
    const exitCode = await new Promise<number | null>((resolve) => {
      const child = run(command, [...args, file], {
        stdio: "inherit",
        shell: process.platform === "win32",
      });
      child.once("error", () => resolve(null));
      child.once("close", resolve);
    });
    if (exitCode !== 0) return undefined;
    return (await readFile(file, "utf8")).replace(/\n$/, "");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function editInTui(
  ctx: ExtensionContext,
  summary: string,
  editorCommand: string,
): Promise<string | undefined> {
  return ctx.ui.custom<string | undefined>(async (tui, _theme, _keybindings, done) => {
    let edited: string | undefined;
    tui.stop();
    try {
      process.stdout.write(
        `Launching external editor: ${editorCommand}\nPi will resume when the editor exits.\n`,
      );
      edited = await editWithExternalEditor(summary, editorCommand);
    } catch (error) {
      process.stdout.write(
        `External editor failed: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    } finally {
      tui.start();
      tui.requestRender(true);
    }
    done(edited);
    return {
      invalidate() {},
      render() {
        return ["Returning from external editor…"];
      },
    };
  });
}

export async function reviewCompaction(
  generated: GeneratedCompaction,
  ctx: ExtensionContext,
  editorCommand: string,
): Promise<ReviewResult> {
  const details = generated.result.details;
  ctx.ui.notify(
    `${details?.profile ?? "balanced"} · ${generated.modelLabel} · evidence ${details?.preservedEvidence ?? 0} preserved, ${details?.omittedEvidence ?? 0} omitted`,
    "info",
  );

  const edited =
    ctx.mode === "tui"
      ? await editInTui(ctx, generated.result.summary, editorCommand)
      : await ctx.ui.editor("Review smart compaction summary", generated.result.summary);
  if (edited === undefined) return { kind: "cancel" };
  if (!edited.trim()) {
    ctx.ui.notify("The compaction summary cannot be empty", "error");
    return { kind: "cancel" };
  }

  const changed = edited !== generated.result.summary;
  const confirmed = await ctx.ui.confirm(
    "Apply smart compaction?",
    changed ? "Apply the user-approved edited summary?" : "Apply the reviewed summary?",
  );
  if (!confirmed) return { kind: "cancel" };

  generated.result.summary = edited;
  if (details) details.status = changed ? "user-approved" : "reviewed";
  return { kind: "apply", generated };
}
