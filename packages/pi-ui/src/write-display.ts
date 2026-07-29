import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";
import {
  createWriteTool,
  generateDiffString,
  keyHint,
  renderDiff,
  type ExtensionAPI,
  type WriteToolInput,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { Box, Spacer, Text } from "@earendil-works/pi-tui";

const COLLAPSED_DIFF_LINES = 16;
const DIFF_CONTEXT_LINES = 3;

interface WriteDiffDetails {
  diff: string;
  existed: boolean;
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

function renderDiffPreview(diff: string, expanded: boolean): { text: string; hiddenLines: number } {
  const lines = diff.split("\n");
  const visibleLines = expanded ? lines : lines.slice(0, COLLAPSED_DIFF_LINES);
  return {
    text: renderDiff(visibleLines.join("\n")),
    hiddenLines: lines.length - visibleLines.length,
  };
}

function buildWriteCall(
  component: WriteCallComponent,
  args: WriteToolInput,
  theme: Theme,
  context: Pick<WriteRenderContext, "cwd" | "expanded" | "isError">,
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

  const rendered = renderDiffPreview(preview.diff, context.expanded);
  if (rendered.text) {
    component.addChild(new Spacer(1));
    component.addChild(new Text(rendered.text, 0, 0));
  }
  if (rendered.hiddenLines > 0) {
    component.addChild(
      new Text(
        `${theme.fg("muted", `… ${rendered.hiddenLines} more diff lines,`)} ${keyHint("app.tools.expand", "to expand")}`,
        0,
        0,
      ),
    );
  }

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
          if (setPreview(component, { argsKey, diff, existed: previous.existed }, argsKey)) {
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
        return buildWriteCall(component, context.args, theme, context);
      }

      return new Text("", 0, 0);
    },
  });
}
