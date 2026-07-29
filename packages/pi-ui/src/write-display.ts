import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";
import {
  createWriteTool,
  generateDiffString,
  generateUnifiedPatch,
  keyHint,
  renderDiff,
  type ExtensionAPI,
  type WriteToolInput,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import {
  Box,
  Container,
  Spacer,
  Text,
  truncateToWidth,
  type Component,
  visibleWidth,
} from "@earendil-works/pi-tui";

const COLLAPSED_DIFF_LINES = 16;
const DIFF_CONTEXT_LINES = 3;
const MIN_SPLIT_WIDTH = 88;

interface WriteDiffDetails {
  diff: string;
  existed: boolean;
  patch: string;
}

interface WritePreview extends WriteDiffDetails {
  argsKey: string;
}

interface WriteRenderContext {
  cwd: string;
  expanded: boolean;
  isError: boolean;
}

interface WriteCallComponent extends Box {
  preview?: WritePreview;
  previewArgsKey?: string;
  previewPending: boolean;
  settled: boolean;
  settledError: boolean;
  delta?: { argsKey: string; renderer: DeltaDiff };
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

async function readPreviousContent(
  cwd: string,
  path: string,
): Promise<{ content: string; existed: boolean } | undefined> {
  try {
    return { content: await readFile(resolve(cwd, path), "utf8"), existed: true };
  } catch (error: unknown) {
    if (isMissingFile(error)) return { content: "", existed: false };
    return undefined;
  }
}

function countChanges(diff: string): { additions: number; removals: number } {
  let additions = 0;
  let removals = 0;

  for (const line of diff.split("\n")) {
    if (line.startsWith("+")) additions++;
    else if (line.startsWith("-")) removals++;
  }

  return { additions, removals };
}

function displayPath(path: string, cwd: string): string {
  const absolutePath = resolve(cwd, path);
  const relativePath = relative(cwd, absolutePath);
  if (relativePath && !relativePath.startsWith("..") && !isAbsolute(relativePath))
    return relativePath;

  const home = homedir();
  return absolutePath === home || absolutePath.startsWith(`${home}/`)
    ? `~${absolutePath.slice(home.length)}`
    : path;
}

function getWriteArgs(args: WriteToolInput): { path: string; content: string } | undefined {
  return typeof args.path === "string" && typeof args.content === "string"
    ? { path: args.path, content: args.content }
    : undefined;
}

function getArgsKey(args: { path: string; content: string }): string {
  return JSON.stringify(args);
}

function buildCallComponent(): WriteCallComponent {
  return Object.assign(new Box(1, 1, (text) => text), {
    previewPending: false,
    settled: false,
    settledError: false,
  });
}

function setPreview(
  component: WriteCallComponent,
  preview: WritePreview,
  argsKey: string,
): boolean {
  const changed =
    component.preview?.diff !== preview.diff || component.preview?.existed !== preview.existed;
  component.preview = preview;
  component.previewArgsKey = argsKey;
  component.previewPending = false;
  return changed;
}

type DiffKind = "add" | "context" | "remove";

interface DiffLine {
  content: string;
  kind: DiffKind;
  lineNumber: string;
}

interface DiffRow {
  left?: DiffLine;
  right?: DiffLine;
}

function parseDiffLines(diff: string): DiffLine[] {
  return diff
    .split("\n")
    .map((line) => {
      const match = /^([ +-])\s*(\d+)\s(.*)$/.exec(line);
      if (!match) return undefined;
      return {
        kind: match[1] === "+" ? "add" : match[1] === "-" ? "remove" : "context",
        lineNumber: match[2],
        content: match[3],
      };
    })
    .filter((line): line is DiffLine => line !== undefined);
}

function buildSplitRows(lines: DiffLine[]): DiffRow[] {
  const rows: DiffRow[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line) break;

    if (line.kind === "remove") {
      const removed: DiffLine[] = [];
      while (lines[index]?.kind === "remove") removed.push(lines[index++]!);
      const added: DiffLine[] = [];
      while (lines[index]?.kind === "add") added.push(lines[index++]!);
      for (let pair = 0; pair < Math.max(removed.length, added.length); pair++) {
        rows.push({ left: removed[pair], right: added[pair] });
      }
      continue;
    }

    rows.push(line.kind === "add" ? { right: line } : { left: line, right: line });
    index++;
  }

  return rows;
}

function padCell(text: string, width: number): string {
  const fitted = truncateToWidth(text, width);
  return `${fitted}${" ".repeat(Math.max(0, width - visibleWidth(fitted)))}`;
}

async function renderDelta(patch: string, width: number): Promise<string[]> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      "delta",
      ["--side-by-side", "--line-numbers", `--width=${width}`, "--paging=never"],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timeout = setTimeout(() => child.kill(), 2_000);
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolvePromise(Buffer.concat(stdout).toString("utf8").replace(/\n$/, "").split("\n"));
      } else {
        reject(new Error(Buffer.concat(stderr).toString("utf8").trim() || "delta failed"));
      }
    });
    child.stdin.end(patch);
  });
}

class DeltaDiff implements Component {
  private readonly cached = new Map<string, string[]>();
  private readonly pending = new Set<string>();

  constructor(
    private readonly patch: string,
    private readonly fallback: SplitDiff,
    private readonly invalidateRow: () => void,
  ) {}

  invalidate(): void {}

  render(width: number): string[] {
    const key = `${width}:${this.fallback.expanded}`;
    const cached = this.cached.get(key);
    if (cached) return cached.map((line) => truncateToWidth(line, width));

    if (!this.pending.has(key)) {
      this.pending.add(key);
      void renderDelta(this.patch, width)
        .then((lines) => {
          this.cached.set(key, lines);
          this.invalidateRow();
        })
        .catch(() => undefined)
        .finally(() => this.pending.delete(key));
    }
    return this.fallback.render(width);
  }
}

class SplitDiff implements Component {
  constructor(
    private readonly diff: string,
    readonly expanded: boolean,
    private readonly theme: Theme,
  ) {}

  invalidate(): void {}

  render(width: number): string[] {
    if (width < MIN_SPLIT_WIDTH) return this.renderUnified(width);

    const rows = buildSplitRows(parseDiffLines(this.diff));
    const visibleRows = this.expanded ? rows : rows.slice(0, COLLAPSED_DIFF_LINES);
    const hiddenRows = rows.length - visibleRows.length;
    const numberWidth = Math.max(
      3,
      ...rows
        .flatMap((row) => [row.left, row.right])
        .flatMap((line) => (line ? [line.lineNumber.length] : [])),
    );
    const separator = " │ ";
    const columnWidth = Math.floor((width - visibleWidth(separator)) / 2);
    const renderCell = (line: DiffLine | undefined, side: "left" | "right"): string => {
      if (!line) return " ".repeat(columnWidth);
      const isChange = line.kind === (side === "left" ? "remove" : "add");
      const color = isChange
        ? line.kind === "add"
          ? "toolDiffAdded"
          : "toolDiffRemoved"
        : "toolDiffContext";
      const number = line.lineNumber.padStart(numberWidth, " ");
      return padCell(this.theme.fg(color, `${number} │ ${line.content}`), columnWidth);
    };

    const header = (label: string) =>
      padCell(this.theme.fg("muted", `${label.padStart(numberWidth, " ")} │`), columnWidth);
    const rendered = [
      `${header("old")}${this.theme.fg("dim", separator)}${header("new")}`,
      `${this.theme.fg("dim", "─".repeat(columnWidth))}${this.theme.fg("dim", "─┼─")}${this.theme.fg("dim", "─".repeat(columnWidth))}`,
      ...visibleRows.map(
        (row) =>
          `${renderCell(row.left, "left")}${this.theme.fg("dim", separator)}${renderCell(row.right, "right")}`,
      ),
    ];
    if (hiddenRows > 0) {
      rendered.push(
        `${this.theme.fg("muted", `… ${hiddenRows} more diff rows,`)} ${keyHint("app.tools.expand", "to expand")}`,
      );
    }
    return rendered.map((line) => truncateToWidth(line, width));
  }

  private renderUnified(width: number): string[] {
    const lines = this.diff.split("\n");
    const visibleLines = this.expanded ? lines : lines.slice(0, COLLAPSED_DIFF_LINES);
    const rendered = renderDiff(visibleLines.join("\n")).split("\n");
    if (lines.length > visibleLines.length) {
      rendered.push(
        `${this.theme.fg("muted", `… ${lines.length - visibleLines.length} more diff lines,`)} ${keyHint("app.tools.expand", "to expand")}`,
      );
    }
    return rendered.map((line) => truncateToWidth(line, width));
  }
}

function buildWriteCall(
  component: WriteCallComponent,
  args: WriteToolInput,
  theme: Theme,
  context: Pick<WriteRenderContext, "cwd" | "expanded" | "isError"> & { invalidate: () => void },
): WriteCallComponent {
  const writeArgs = getWriteArgs(args);
  const preview = component.preview;
  const background =
    context.isError || component.settledError
      ? "toolErrorBg"
      : preview || component.settled
        ? "toolSuccessBg"
        : "toolPendingBg";
  component.setBgFn((text) => theme.bg(background, text));
  component.clear();

  const path = writeArgs ? displayPath(writeArgs.path, context.cwd) : "…";
  const title = `${theme.fg("toolTitle", theme.bold("write"))} ${theme.fg("accent", path)}`;
  component.addChild(new Text(title, 0, 0));

  if (!preview) {
    if (component.settled) component.addChild(new Text(theme.fg("success", "written"), 0, 0));
    return component;
  }

  const { additions, removals } = countChanges(preview.diff);
  const action = preview.existed ? "updated" : "created";
  let summary = theme.fg("success", action);
  summary += theme.fg("dim", "  ");
  summary += theme.fg("success", `+${additions}`);
  summary += theme.fg("dim", "  ");
  summary += theme.fg("error", `-${removals}`);
  component.addChild(new Spacer(1));
  component.addChild(new Text(summary, 0, 0));

  if (component.delta?.argsKey !== preview.argsKey) {
    component.delta = {
      argsKey: preview.argsKey,
      renderer: new DeltaDiff(
        preview.patch,
        new SplitDiff(preview.diff, context.expanded, theme),
        context.invalidate,
      ),
    };
  }
  component.addChild(new Spacer(1));
  component.addChild(component.delta.renderer);

  return component;
}

export function registerWriteDisplay(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "write",
    label: "write",
    description:
      "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.",
    promptSnippet: "Create or overwrite files",
    promptGuidelines: ["Use write only for new files or complete rewrites."],
    parameters: createWriteTool(process.cwd()).parameters,
    renderShell: "self",

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const previous = await readPreviousContent(ctx.cwd, params.path);
      const result = await createWriteTool(ctx.cwd).execute(toolCallId, params, signal, onUpdate);
      if (!previous) return result;

      return {
        ...result,
        details: {
          diff: generateDiffString(previous.content, params.content, DIFF_CONTEXT_LINES).diff,
          existed: previous.existed,
          patch: generateUnifiedPatch(
            params.path,
            previous.content,
            params.content,
            DIFF_CONTEXT_LINES,
          ),
        } satisfies WriteDiffDetails,
      };
    },

    renderCall(args, theme, context) {
      const component =
        (context.lastComponent as WriteCallComponent | undefined) ??
        (context.state.callComponent as WriteCallComponent | undefined) ??
        buildCallComponent();
      context.state.callComponent = component;

      const writeArgs = getWriteArgs(args);
      const argsKey = writeArgs ? getArgsKey(writeArgs) : undefined;
      if (component.previewArgsKey !== argsKey) {
        component.preview = undefined;
        component.previewArgsKey = argsKey;
        component.previewPending = false;
        component.settled = false;
        component.settledError = false;
      }

      if (
        context.argsComplete &&
        writeArgs &&
        argsKey &&
        !component.preview &&
        !component.previewPending
      ) {
        component.previewPending = true;
        void readPreviousContent(context.cwd, writeArgs.path).then((previous) => {
          if (component.previewArgsKey !== argsKey) return;
          if (!previous) {
            component.previewPending = false;
            context.invalidate();
            return;
          }
          const diff = generateDiffString(
            previous.content,
            writeArgs.content,
            DIFF_CONTEXT_LINES,
          ).diff;
          const patch = generateUnifiedPatch(
            writeArgs.path,
            previous.content,
            writeArgs.content,
            DIFF_CONTEXT_LINES,
          );
          if (setPreview(component, { argsKey, diff, patch, existed: previous.existed }, argsKey)) {
            context.invalidate();
          }
        });
      }

      return buildWriteCall(component, args, theme, context);
    },

    renderResult(result, _options, theme, context) {
      const component = context.state.callComponent as WriteCallComponent | undefined;
      const details = result.details as WriteDiffDetails | undefined;
      const writeArgs = getWriteArgs(context.args);
      const argsKey = writeArgs ? getArgsKey(writeArgs) : undefined;

      if (component) {
        component.settled = true;
        component.settledError = context.isError;
        if (!context.isError && details && argsKey) {
          setPreview(component, { argsKey, ...details }, argsKey);
        }
        buildWriteCall(component, context.args, theme, context);
      }

      return new Container();
    },
  });
}
