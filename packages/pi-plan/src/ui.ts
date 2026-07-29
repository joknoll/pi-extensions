import { styleText } from "node:util";
import { SettingsManager, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import {
  OTHER_LABEL,
  type EssayAnswer,
  type EssayQuestion,
  type MultipleChoiceAnswer,
  type MultipleChoiceQuestion,
  type PlanAnswer,
  type PlanQuestion,
  type SingleChoiceAnswer,
  type SingleChoiceQuestion,
  type YesNoAnswer,
  type YesNoQuestion,
} from "./questions.ts";
import {
  acceptEditedArchive,
  agentDir,
  ensurePlanArchive,
  launchEditor,
  readPlanArchive,
} from "./storage.ts";

export type ReadyIntent = "implement" | "compact" | "clear" | "keep" | "discard" | "edit";
export const READY_OPTIONS: Array<{ label: string; intent: ReadyIntent }> = [
  { label: "Implement plan", intent: "implement" },
  { label: "Implement plan and compact", intent: "compact" },
  { label: "Implement plan and clear context", intent: "clear" },
  { label: "Keep planning", intent: "keep" },
  { label: "Exit / discard", intent: "discard" },
];

const INSET = "  ";

function paintBackground(line: string, background: string): string {
  if (!background) return line;
  return `${background}${line.replaceAll("\x1b[0m", `\x1b[0m${background}`)}\x1b[49m`;
}

function paintPlanLine(line: string, width: number, background: string): string {
  const truncated = truncateToWidth(line, width);
  return paintBackground(
    `${truncated}${" ".repeat(Math.max(0, width - visibleWidth(truncated)))}`,
    background,
  );
}

export async function showPlanSelect(
  ctx: ExtensionContext,
  title: string,
  options: readonly string[],
): Promise<string | undefined> {
  if (ctx.mode !== "tui") return undefined;
  const background = ctx.ui.theme.getBgAnsi("userMessageBg");
  return ctx.ui.custom<string | undefined>((tui, _theme, _keybindings, done) => {
    let selected = 0;
    return {
      handleInput(data: string) {
        if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) done(undefined);
        else if (matchesKey(data, "return")) done(options[selected]);
        else if (matchesKey(data, "up")) {
          selected = (selected + options.length - 1) % options.length;
          tui.requestRender();
        } else if (matchesKey(data, "down")) {
          selected = (selected + 1) % options.length;
          tui.requestRender();
        }
      },
      invalidate() {},
      render(width: number) {
        const divider = styleText("gray", "─".repeat(Math.max(1, width)));
        const lines = ["", `${INSET}${styleText("bold", title)}`, divider, ""];
        for (let index = 0; index < options.length; index += 1) {
          const prefix = index === selected ? "› " : "  ";
          const text = `${prefix}${options[index]}`;
          lines.push(`${INSET}${index === selected ? styleText(["cyan", "bold"], text) : text}`);
        }
        lines.push(
          "",
          divider,
          `${INSET}${styleText("gray", "↑↓ navigate  enter select  escape/ctrl+c cancel")}`,
          "",
        );
        return lines.map((line) => paintPlanLine(line, width, background));
      },
    };
  });
}

export function contextUsageIndicator(ctx: Pick<ExtensionContext, "getContextUsage">): string {
  const percent = ctx.getContextUsage()?.percent;
  return percent == null || !Number.isFinite(percent) ? "" : ` (${Math.round(percent)}%)`;
}

export async function showReadyMenu(
  ctx: ExtensionContext,
  archivePath: string,
): Promise<ReadyIntent | undefined> {
  if (ctx.mode !== "tui") return undefined;
  const background = ctx.ui.theme.getBgAnsi("userMessageBg");
  const clearContextLabel = `${READY_OPTIONS.find((option) => option.intent === "clear")?.label}${contextUsageIndicator(ctx)}`;
  return ctx.ui.custom<ReadyIntent>((tui, _theme, _keybindings, done) => {
    let selected = 0;
    return {
      handleInput(data: string) {
        const finish = (intent: ReadyIntent) => done(intent);
        if (matchesKey(data, "escape")) finish("keep");
        else if (matchesKey(data, "ctrl+e")) finish("edit");
        else if (matchesKey(data, "return")) finish(READY_OPTIONS[selected].intent);
        else if (matchesKey(data, "up")) {
          selected = (selected + READY_OPTIONS.length - 1) % READY_OPTIONS.length;
          tui.requestRender();
        } else if (matchesKey(data, "down")) {
          selected = (selected + 1) % READY_OPTIONS.length;
          tui.requestRender();
        }
      },
      invalidate() {},
      render(width: number) {
        const divider = styleText("gray", "─".repeat(Math.max(1, width)));
        const lines = ["", `${INSET}${styleText("bold", "Plan ready")}`, divider, ""];
        for (let index = 0; index < READY_OPTIONS.length; index += 1) {
          const prefix = index === selected ? "› " : "  ";
          const option = READY_OPTIONS[index];
          const label = option.intent === "clear" ? clearContextLabel : option.label;
          const text = `${prefix}${label}`;
          lines.push(`${INSET}${index === selected ? styleText(["cyan", "bold"], text) : text}`);
        }
        lines.push(
          "",
          divider,
          `${INSET}${styleText("gray", "Ctrl+E edit archive · Esc keep planning")}`,
          `${INSET}${styleText("gray", archivePath)}`,
          "",
        );
        return lines.map((line) => paintPlanLine(line, width, background));
      },
    };
  });
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

// --- Question widgets ---------------------------------------------------

export type QuestionOutcome = "previous" | "next" | { answer: PlanAnswer } | undefined;

function frameTop(index: number, total: number, question: string): string[] {
  return [
    "",
    `${INSET}${styleText("gray", `Question ${index + 1}/${total}`)}`,
    `${INSET}${styleText(["cyan", "bold"], question)}`,
    "",
  ];
}

function frameBottom(hint: string): string[] {
  return ["", `${INSET}${styleText("gray", hint)}`, ""];
}

function optionRow(prefix: string, text: string, active: boolean): string {
  const full = `${prefix}${text}`;
  return `${INSET}${active ? styleText(["cyan", "bold"], full) : full}`;
}

async function showSingleChoiceQuestion(
  ctx: ExtensionContext,
  question: SingleChoiceQuestion,
  previous: SingleChoiceAnswer | undefined,
  index: number,
  total: number,
): Promise<QuestionOutcome> {
  const rows = [...question.options, { label: OTHER_LABEL, impact: "Add notes" }];
  const restored = previous ? rows.findIndex((row) => row.label === previous.label) : -1;
  let selected = restored < 0 ? 0 : restored;
  let otherText = previous?.other ?? "";
  const background = ctx.ui.theme.getBgAnsi("userMessageBg");
  for (;;) {
    const outcome = await ctx.ui.custom<"previous" | "next" | "select" | undefined>(
      (tui, _theme, _keys, done) => ({
        handleInput(data: string) {
          if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) done(undefined);
          else if (matchesKey(data, "left")) done("previous");
          else if (matchesKey(data, "right")) done("next");
          else if (matchesKey(data, "up")) {
            selected = (selected + rows.length - 1) % rows.length;
            tui.requestRender();
          } else if (matchesKey(data, "down")) {
            selected = (selected + 1) % rows.length;
            tui.requestRender();
          } else if (matchesKey(data, "return")) done("select");
        },
        invalidate() {},
        render(width: number) {
          const lines = frameTop(index, total, question.question);
          for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
            const row = rows[rowIndex];
            const text = `${rowIndex + 1}. ${row.label.padEnd(24)} ${row.impact}`;
            lines.push(optionRow(rowIndex === selected ? "› " : "  ", text, rowIndex === selected));
          }
          lines.push(...frameBottom("↑↓ choose  ←→ questions  enter submit  esc interrupt"));
          return lines.map((line) => paintPlanLine(line, width, background));
        },
      }),
    );
    if (outcome === undefined || outcome === "previous" || outcome === "next") return outcome;
    const row = rows[selected];
    if (row.label !== OTHER_LABEL)
      return { answer: { id: question.id, type: "single_choice", label: row.label } };
    const other = await ctx.ui.input(question.header, otherText || question.question);
    if (other === undefined) continue;
    const trimmed = other.trim();
    if (!trimmed) continue;
    otherText = trimmed;
    return {
      answer: { id: question.id, type: "single_choice", label: OTHER_LABEL, other: trimmed },
    };
  }
}

async function showMultipleChoiceQuestion(
  ctx: ExtensionContext,
  question: MultipleChoiceQuestion,
  previous: MultipleChoiceAnswer | undefined,
  index: number,
  total: number,
): Promise<QuestionOutcome> {
  const rows = [...question.options, { label: OTHER_LABEL, impact: "Add notes" }];
  const otherRowIndex = rows.length - 1;
  const selectedRows = new Set<number>(
    previous?.labels
      .map((label) => rows.findIndex((row) => row.label === label))
      .filter((rowIndex) => rowIndex >= 0) ?? [],
  );
  let otherText = previous?.other ?? "";
  let cursor = 0;
  const background = ctx.ui.theme.getBgAnsi("userMessageBg");
  for (;;) {
    const outcome = await ctx.ui.custom<"previous" | "next" | "toggle" | "submit" | undefined>(
      (tui, _theme, _keys, done) => ({
        handleInput(data: string) {
          if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) done(undefined);
          else if (matchesKey(data, "left")) done("previous");
          else if (matchesKey(data, "right")) done("next");
          else if (matchesKey(data, "up")) {
            cursor = (cursor + rows.length - 1) % rows.length;
            tui.requestRender();
          } else if (matchesKey(data, "down")) {
            cursor = (cursor + 1) % rows.length;
            tui.requestRender();
          } else if (matchesKey(data, "space")) done("toggle");
          else if (matchesKey(data, "return") && selectedRows.size > 0) done("submit");
        },
        invalidate() {},
        render(width: number) {
          const lines = frameTop(index, total, question.question);
          for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
            const row = rows[rowIndex];
            const checkbox = selectedRows.has(rowIndex) ? "[x]" : "[ ]";
            const text = `${checkbox} ${rowIndex + 1}. ${row.label.padEnd(24)} ${row.impact}`;
            lines.push(optionRow(rowIndex === cursor ? "› " : "  ", text, rowIndex === cursor));
          }
          lines.push(
            ...frameBottom(
              selectedRows.size > 0
                ? "↑↓ move  space toggle  ←→ questions  enter submit  esc interrupt"
                : "↑↓ move  space toggle  ←→ questions  select at least one  esc interrupt",
            ),
          );
          return lines.map((line) => paintPlanLine(line, width, background));
        },
      }),
    );
    if (outcome === undefined || outcome === "previous" || outcome === "next") return outcome;
    if (outcome === "submit") {
      const labels = question.options
        .filter((option) => selectedRows.has(rows.findIndex((row) => row.label === option.label)))
        .map((option) => option.label);
      const other = selectedRows.has(otherRowIndex) ? otherText : undefined;
      if (other !== undefined) labels.push(OTHER_LABEL);
      return { answer: { id: question.id, type: "multiple_choice", labels, other } };
    }
    // toggle
    if (cursor !== otherRowIndex) {
      if (selectedRows.has(cursor)) selectedRows.delete(cursor);
      else selectedRows.add(cursor);
      continue;
    }
    if (selectedRows.has(otherRowIndex)) {
      selectedRows.delete(otherRowIndex);
      otherText = "";
      continue;
    }
    const other = await ctx.ui.input(question.header, otherText || question.question);
    if (other === undefined) continue;
    const trimmed = other.trim();
    if (!trimmed) continue;
    otherText = trimmed;
    selectedRows.add(otherRowIndex);
  }
}

async function showYesNoQuestion(
  ctx: ExtensionContext,
  question: YesNoQuestion,
  previous: YesNoAnswer | undefined,
  index: number,
  total: number,
): Promise<QuestionOutcome> {
  const rows = ["Yes", "No"];
  let selected = previous === undefined ? 0 : previous.answer ? 0 : 1;
  const background = ctx.ui.theme.getBgAnsi("userMessageBg");
  const outcome = await ctx.ui.custom<"previous" | "next" | "select" | undefined>(
    (tui, _theme, _keys, done) => ({
      handleInput(data: string) {
        if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) done(undefined);
        else if (matchesKey(data, "left")) done("previous");
        else if (matchesKey(data, "right")) done("next");
        else if (matchesKey(data, "up")) {
          selected = (selected + rows.length - 1) % rows.length;
          tui.requestRender();
        } else if (matchesKey(data, "down")) {
          selected = (selected + 1) % rows.length;
          tui.requestRender();
        } else if (matchesKey(data, "return")) done("select");
      },
      invalidate() {},
      render(width: number) {
        const lines = frameTop(index, total, question.question);
        for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
          const text = `${rowIndex + 1}. ${rows[rowIndex]}`;
          lines.push(optionRow(rowIndex === selected ? "› " : "  ", text, rowIndex === selected));
        }
        lines.push(...frameBottom("↑↓ choose  ←→ questions  enter submit  esc interrupt"));
        return lines.map((line) => paintPlanLine(line, width, background));
      },
    }),
  );
  if (outcome === undefined || outcome === "previous" || outcome === "next") return outcome;
  return { answer: { id: question.id, type: "yes_no", answer: selected === 0 } };
}

async function showEssayQuestion(
  ctx: ExtensionContext,
  question: EssayQuestion,
  previous: EssayAnswer | undefined,
  index: number,
  total: number,
): Promise<QuestionOutcome> {
  const background = ctx.ui.theme.getBgAnsi("userMessageBg");
  for (;;) {
    const outcome = await ctx.ui.custom<"previous" | "next" | "select" | undefined>(
      (_tui, _theme, _keys, done) => ({
        handleInput(data: string) {
          if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) done(undefined);
          else if (matchesKey(data, "left")) done("previous");
          else if (matchesKey(data, "right")) done("next");
          else if (matchesKey(data, "return")) done("select");
        },
        invalidate() {},
        render(width: number) {
          const lines = frameTop(index, total, question.question);
          lines.push(
            `${INSET}${styleText("gray", previous?.text ? "Current answer:" : "No answer yet")}`,
          );
          if (previous?.text)
            lines.push(`${INSET}${truncateToWidth(previous.text.split("\n")[0], width)}`);
          lines.push("");
          lines.push(...frameBottom("enter write answer  ←→ questions  esc interrupt"));
          return lines.map((line) => paintPlanLine(line, width, background));
        },
      }),
    );
    if (outcome === undefined || outcome === "previous" || outcome === "next") return outcome;
    const text = await ctx.ui.editor(question.header, previous?.text ?? "");
    if (text === undefined) continue;
    const trimmed = text.trim();
    if (!trimmed) continue;
    return { answer: { id: question.id, type: "essay", text: trimmed } };
  }
}

export async function showPlanQuestion(
  ctx: ExtensionContext,
  question: PlanQuestion,
  previous: PlanAnswer | undefined,
  index: number,
  total: number,
): Promise<QuestionOutcome> {
  switch (question.type) {
    case "single_choice":
      return showSingleChoiceQuestion(
        ctx,
        question,
        previous?.type === "single_choice" ? previous : undefined,
        index,
        total,
      );
    case "multiple_choice":
      return showMultipleChoiceQuestion(
        ctx,
        question,
        previous?.type === "multiple_choice" ? previous : undefined,
        index,
        total,
      );
    case "yes_no":
      return showYesNoQuestion(
        ctx,
        question,
        previous?.type === "yes_no" ? previous : undefined,
        index,
        total,
      );
    case "essay":
      return showEssayQuestion(
        ctx,
        question,
        previous?.type === "essay" ? previous : undefined,
        index,
        total,
      );
  }
}
