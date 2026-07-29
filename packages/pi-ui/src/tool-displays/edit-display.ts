import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  createEditTool,
  generateDiffString,
  generateUnifiedPatch,
  type EditToolDetails,
  type EditToolInput,
  type ExtensionAPI,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { Box, Container, Spacer, Text } from "@earendil-works/pi-tui";
import { countChanges, displayPath } from "./display-utils.ts";
import { EditDiffRenderer } from "./edit-diff-renderer.ts";

const DIFF_CONTEXT_LINES = 3;

type EditPreview = EditToolDetails & { argsKey: string };
type EditCallComponent = Box & {
  preview?: EditPreview;
  previewArgsKey?: string;
  previewPending: boolean;
  settled: boolean;
  settledError: boolean;
  nativeDiff?: {
    argsKey: string;
    expanded: boolean;
    themeKey: string;
    renderer: EditDiffRenderer;
  };
};

function getEditArgs(args: EditToolInput): EditToolInput | undefined {
  if (typeof args.path !== "string" || !Array.isArray(args.edits)) return undefined;
  if (
    !args.edits.every(
      (edit) => typeof edit.oldText === "string" && typeof edit.newText === "string",
    )
  )
    return undefined;
  return args;
}

function argsKey(args: EditToolInput): string {
  return JSON.stringify(args);
}

function applyEdits(content: string, edits: EditToolInput["edits"]): string | undefined {
  const replacements: Array<{ start: number; end: number; text: string }> = [];
  for (const edit of edits) {
    const start = content.indexOf(edit.oldText);
    if (start < 0 || content.indexOf(edit.oldText, start + 1) >= 0) return undefined;
    replacements.push({ start, end: start + edit.oldText.length, text: edit.newText });
  }
  replacements.sort((a, b) => b.start - a.start);
  for (let index = 1; index < replacements.length; index++) {
    if (replacements[index - 1]!.start < replacements[index]!.end) return undefined;
  }
  let result = content;
  for (const replacement of replacements) {
    result = `${result.slice(0, replacement.start)}${replacement.text}${result.slice(replacement.end)}`;
  }
  return result;
}

async function previewEdit(cwd: string, args: EditToolInput): Promise<EditPreview | undefined> {
  try {
    const original = await readFile(resolve(cwd, args.path), "utf8");
    const updated = applyEdits(original, args.edits);
    if (updated === undefined) return undefined;
    const diff = generateDiffString(original, updated, DIFF_CONTEXT_LINES);
    return {
      argsKey: argsKey(args),
      diff: diff.diff,
      patch: generateUnifiedPatch(args.path, original, updated, DIFF_CONTEXT_LINES),
      firstChangedLine: diff.firstChangedLine,
    };
  } catch {
    return undefined;
  }
}

function buildComponent(): EditCallComponent {
  return Object.assign(new Box(1, 1, (text) => text), {
    previewPending: false,
    settled: false,
    settledError: false,
  });
}

function renderCall(
  component: EditCallComponent,
  args: EditToolInput,
  theme: Theme,
  context: { cwd: string; expanded: boolean; isError: boolean; invalidate: () => void },
): EditCallComponent {
  const input = getEditArgs(args);
  const failed = context.isError || component.settledError;
  component.setBgFn((text) => (failed ? theme.bg("toolErrorBg", text) : text));
  component.clear();

  const path = input ? displayPath(input.path, context.cwd) : "…";
  let heading = `${theme.fg(failed ? "error" : "accent", "•")} `;
  if (component.preview) {
    const { additions, removals } = countChanges(component.preview.diff);
    heading += `${theme.fg("toolTitle", theme.bold("Edited"))} ${theme.fg("accent", path)}`;
    heading += ` ${theme.fg("dim", "(")}${theme.fg("toolDiffAdded", `+${additions}`)} ${theme.fg("toolDiffRemoved", `-${removals}`)}${theme.fg("dim", ")")}`;
  } else {
    heading += `${theme.fg("toolTitle", theme.bold(component.settled ? "Edited" : "Editing"))} ${theme.fg("accent", path)}`;
  }
  component.addChild(new Text(heading, 0, 0));

  if (!component.preview) return component;
  const themeKey = `${theme.name ?? ""}:${theme.getColorMode()}:${theme.getFgAnsi("toolDiffAdded")}:${theme.getFgAnsi("toolDiffRemoved")}`;
  if (
    component.nativeDiff?.argsKey !== component.preview.argsKey ||
    component.nativeDiff.expanded !== context.expanded ||
    component.nativeDiff.themeKey !== themeKey
  ) {
    component.nativeDiff = {
      argsKey: component.preview.argsKey,
      expanded: context.expanded,
      themeKey,
      renderer: new EditDiffRenderer(
        component.preview.patch,
        component.preview.diff,
        input?.path ?? "",
        context.expanded,
        theme,
      ),
    };
  }
  component.addChild(new Spacer(1));
  component.addChild(component.nativeDiff.renderer);
  return component;
}

export function registerEditDisplay(pi: ExtensionAPI): void {
  const tool = createEditTool(process.cwd());
  pi.registerTool({
    name: "edit",
    label: "edit",
    description:
      "Edit a single file using exact text replacement. Every edits[].oldText must match a unique, non-overlapping region of the original file.",
    promptSnippet:
      "Make precise file edits with exact text replacement, including multiple disjoint edits in one call",
    promptGuidelines: [
      "Use edit for precise changes (edits[].oldText must match exactly)",
      "When changing multiple separate locations in one file, use one edit call with multiple entries in edits[] instead of multiple edit calls",
      "Keep edits[].oldText as small as possible while still being unique in the file.",
    ],
    parameters: tool.parameters,
    renderShell: "self",
    execute(toolCallId, params, signal, onUpdate, ctx) {
      return createEditTool(ctx.cwd).execute(toolCallId, params, signal, onUpdate);
    },
    renderCall(args, theme, context) {
      const component =
        (context.lastComponent as EditCallComponent | undefined) ??
        (context.state.callComponent as EditCallComponent | undefined) ??
        buildComponent();
      context.state.callComponent = component;
      const input = getEditArgs(args);
      const key = input ? argsKey(input) : undefined;
      if (component.previewArgsKey !== key) {
        component.preview = undefined;
        component.previewArgsKey = key;
        component.previewPending = false;
        component.settled = false;
        component.settledError = false;
        component.nativeDiff = undefined;
      }
      if (context.argsComplete && input && key && !component.preview && !component.previewPending) {
        component.previewPending = true;
        void previewEdit(context.cwd, input).then((preview) => {
          if (component.previewArgsKey !== key) return;
          component.previewPending = false;
          component.preview = preview;
          context.invalidate();
        });
      }
      return renderCall(component, args, theme, context);
    },
    renderResult(result, _options, theme, context) {
      const component = context.state.callComponent as EditCallComponent | undefined;
      const details = result.details as EditToolDetails | undefined;
      const input = getEditArgs(context.args);
      if (component) {
        component.settled = true;
        component.settledError = context.isError;
        if (!context.isError && details?.diff && details.patch && input) {
          component.preview = { ...details, argsKey: argsKey(input) };
          component.nativeDiff = undefined;
        }
        renderCall(component, context.args, theme, context);
      }
      return new Container();
    },
  });
}
