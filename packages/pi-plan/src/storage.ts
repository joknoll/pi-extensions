import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { SettingsManager, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { DEFAULTS, type Preferences, validPreferences } from "./core.ts";

export const MAX_PLAN_SIZE = 256_000;

export function agentDir(): string {
  return process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
}

export async function loadPreferences(): Promise<{ preferences: Preferences; warning?: string }> {
  try {
    const parsed: unknown = JSON.parse(await readFile(join(agentDir(), "pi-plan.json"), "utf8"));
    if (!validPreferences(parsed))
      throw new Error("expected only valid model and thinkingLevel fields");
    return { preferences: parsed };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { preferences: DEFAULTS };
    return {
      preferences: DEFAULTS,
      warning: `Invalid pi-plan.json; using inherited defaults (${error instanceof Error ? error.message : String(error)})`,
    };
  }
}

export async function savePreferences(value: Preferences): Promise<void> {
  if (!validPreferences(value)) throw new Error("Refusing to save invalid planning preferences");
  const file = join(agentDir(), "pi-plan.json");
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

export function plansDirectory(): string {
  return resolve(agentDir(), "plans");
}

export function isArchivePath(path: string): boolean {
  const rel = relative(plansDirectory(), resolve(path));
  return (
    rel.length > 0 && !rel.startsWith("..") && !rel.includes("/../") && !rel.includes("\\..\\")
  );
}

function slug(plan: string): string {
  const heading = plan.match(/^#+\s+(.+)$/m)?.[1] || "plan";
  return (
    heading
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "plan"
  );
}

async function assertSafeTarget(path: string, allowMissing: boolean): Promise<void> {
  if (!isArchivePath(path)) throw new Error("Archive path is outside the plans directory");
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error("Archive target is not a regular file");
  } catch (error) {
    if (allowMissing && (error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
}

async function atomicWrite(target: string, content: string): Promise<void> {
  const temporary = join(
    plansDirectory(),
    `.${basename(target)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    await writeFile(temporary, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function writePlanArchive(plan: string, existing?: string): Promise<string> {
  await mkdir(plansDirectory(), { recursive: true });
  const target = existing
    ? resolve(existing)
    : join(
        plansDirectory(),
        `${new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15)}-${slug(plan)}-${randomUUID()}.md`,
      );
  await assertSafeTarget(target, true);
  await atomicWrite(target, plan);
  return target;
}

export async function ensurePlanArchive(plan: string, archivePath: string): Promise<string> {
  const target = resolve(archivePath);
  await assertSafeTarget(target, true);
  try {
    await readFile(target);
    return target;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return writePlanArchive(plan, target);
  }
}

export async function readPlanArchive(path: string): Promise<string> {
  const target = resolve(path);
  await assertSafeTarget(target, false);
  return readFile(target, "utf8");
}

function splitEditorCommand(command: string): [string, string[]] {
  const tokens =
    command
      .match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)
      ?.map((token) => token.replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, "$1$2")) ?? [];
  const executable = tokens.shift();
  if (!executable) throw new Error("No external editor is configured");
  return [executable, tokens];
}

async function launchEditor(command: string, path: string): Promise<number | null> {
  const [executable, args] = splitEditorCommand(command);
  return new Promise((done) => {
    const child = spawn(executable, [...args, path], {
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.once("error", () => done(null));
    child.once("close", done);
  });
}

export async function acceptEditedArchive(
  path: string,
  previous: string,
  exitCode: number | null,
): Promise<string> {
  try {
    if (exitCode !== 0)
      throw new Error(
        exitCode === null
          ? "External editor could not start"
          : `External editor exited with status ${exitCode}`,
      );
    const edited = (await readPlanArchive(path)).trim();
    if (!edited) throw new Error("Edited plan is empty");
    if (edited.length > MAX_PLAN_SIZE) throw new Error("Edited plan exceeds the size limit");
    await writePlanArchive(edited, path);
    return edited;
  } catch (error) {
    await rm(path, { force: true });
    await writePlanArchive(previous, path);
    throw error;
  }
}

export async function editArchivedPlan(
  ctx: ExtensionContext,
  plan: string,
  archivePath: string,
): Promise<{ plan: string; archivePath: string; changed: boolean }> {
  if (ctx.mode !== "tui") return { plan, archivePath, changed: false };
  const path = await ensurePlanArchive(plan, archivePath);
  const previous = await readPlanArchive(path);
  const editor = SettingsManager.create(ctx.cwd, agentDir()).getExternalEditorCommand();
  if (!editor) throw new Error("No external editor is configured");
  const exitCode = await ctx.ui.custom<number | null>(async (tui, _theme, _keys, done) => {
    let result: number | null = null;
    tui.stop();
    try {
      process.stdout.write(
        `Launching external editor: ${editor}\nPi will resume when the editor exits.\n`,
      );
      result = await launchEditor(editor, path);
    } finally {
      tui.start();
      tui.requestRender(true);
    }
    done(result);
    return { invalidate() {}, render: () => ["Returning from external editor…"] };
  });
  const edited = await acceptEditedArchive(path, previous, exitCode);
  return { plan: edited, archivePath: path, changed: edited !== plan };
}
