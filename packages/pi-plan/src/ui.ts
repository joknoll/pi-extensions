import { styleText } from "node:util";
import {
  SettingsManager,
  type ExtensionContext,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { Container, matchesKey, Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import {
  OTHER_LABEL,
  type MultipleChoiceAnswer,
  type MultipleChoiceQuestion,
  type PlanAnswer,
  type PlanQuestion,
  type PlanQuestionsResult,
  type SingleChoiceAnswer,
  type SingleChoiceQuestion,
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

const isUp = (data: string): boolean => data === "k" || matchesKey(data, "up");
const isDown = (data: string): boolean => data === "j" || matchesKey(data, "down");
const isLeft = (data: string): boolean => data === "h" || matchesKey(data, "left");
const isRight = (data: string): boolean => data === "l" || matchesKey(data, "right");

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
        else if (isUp(data)) {
          selected = (selected + options.length - 1) % options.length;
          tui.requestRender();
        } else if (isDown(data)) {
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
          `${INSET}${styleText("gray", "↑↓/jk navigate  enter select  escape/ctrl+c cancel")}`,
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
        else if (isUp(data)) {
          selected = (selected + READY_OPTIONS.length - 1) % READY_OPTIONS.length;
          tui.requestRender();
        } else if (isDown(data)) {
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

export type QuestionSummaryComponent = Container;

function answerText(answer: PlanAnswer): string {
  const labels = answer.type === "single_choice" ? [answer.label] : answer.labels;
  const selection = labels.join(", ");
  return answer.other ? `${selection} — ${answer.other}` : selection;
}

export function renderQuestionSummary(
  component: QuestionSummaryComponent,
  questions: readonly PlanQuestion[],
  result: PlanQuestionsResult | undefined,
  theme: Theme,
): QuestionSummaryComponent {
  component.clear();
  const answered = result?.cancelled ? 0 : (result?.answers.length ?? 0);
  const status = result?.cancelled
    ? "cancelled"
    : result
      ? `${answered}/${questions.length} answered`
      : `0/${questions.length} answered`;
  component.addChild(
    new Text(
      `${theme.fg("accent", "•")} ${theme.fg("toolTitle", theme.bold("Questions"))} ${theme.fg("dim", status)}`,
      0,
      0,
    ),
  );
  for (const question of questions) {
    component.addChild(new Text(`  ${theme.fg("dim", "•")} ${question.question}`, 0, 0));
    const answer = result?.answers.find((candidate) => candidate.id === question.id);
    if (answer) {
      component.addChild(
        new Text(
          `    ${theme.fg("dim", "answer:")} ${theme.fg("accent", answerText(answer))}`,
          0,
          0,
        ),
      );
      if (answer.note) {
        component.addChild(new Text(`    ${theme.fg("dim", "note:")} ${answer.note}`, 0, 0));
      }
    }
  }
  return component;
}

export type QuestionOutcome = "previous" | "next" | { answer: PlanAnswer } | undefined;

function wrapText(text: string, width: number): string[] {
  if (width <= 0) return [""];
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (visibleWidth(candidate) <= width) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    let rest = word;
    while (visibleWidth(rest) > width) {
      const truncated = truncateToWidth(rest, width, "");
      // A double-width grapheme cannot fit in a one-column remainder. Consume it
      // anyway so pathological terminal widths cannot trap the renderer in a loop.
      const chunk = truncated || Array.from(rest)[0] || "";
      lines.push(chunk);
      rest = rest.slice(chunk.length);
    }
    line = rest;
  }
  if (line) lines.push(line);
  return lines;
}

function frameTop(index: number, total: number, question: string, width: number): string[] {
  return [
    "",
    `${INSET}${styleText("gray", `Question ${index + 1}/${total}`)}`,
    ...wrapText(question, Math.max(1, width - visibleWidth(INSET))).map(
      (line) => `${INSET}${styleText(["cyan", "bold"], line)}`,
    ),
    "",
  ];
}

function frameNote(note: string, width: number): string[] {
  if (!note) return [];
  return [
    "",
    ...wrapText(`Note: ${note}`, Math.max(1, width - visibleWidth(INSET))).map(
      (line) => `${INSET}${styleText("white", line)}`,
    ),
  ];
}

function frameBottom(hint: string): string[] {
  return ["", `${INSET}${styleText("gray", hint)}`, ""];
}

async function editQuestionNote(
  ctx: ExtensionContext,
  question: PlanQuestion,
  current: string,
): Promise<string> {
  const note = await ctx.ui.input(`${question.header} note`, current || "Add optional context");
  return note === undefined ? current : note.trim();
}

type QuestionRow = { label: string; impact: string };

/** Renders option titles as a distinct column and wraps both columns without clipping. */
function optionRows(
  rows: readonly QuestionRow[],
  cursor: number,
  width: number,
  checked?: ReadonlySet<number>,
): string[] {
  const multiple = checked !== undefined;
  const maxNumberWidth = String(rows.length).length;
  const markerWidth = 2 + (multiple ? 4 : 0) + maxNumberWidth + 2;
  const available = Math.max(1, width - visibleWidth(INSET) - markerWidth);
  const gap = available >= 18 ? 2 : 1;
  const widestLabel = Math.max(...rows.map((row) => visibleWidth(row.label)));
  const labelLimit = Math.max(
    1,
    Math.min(Math.max(8, Math.floor((available - gap) * 0.4)), available - gap - 1),
  );
  const labelWidth = Math.min(widestLabel, labelLimit);
  const impactWidth = Math.max(1, available - labelWidth - gap);
  const output: string[] = [];

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const active = rowIndex === cursor;
    const labelLines = wrapText(row.label, labelWidth);
    const impactLines = wrapText(row.impact, impactWidth);
    const lineCount = Math.max(labelLines.length, impactLines.length);
    for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
      const pointer = lineIndex === 0 && active ? "› " : "  ";
      const selection = multiple
        ? `${lineIndex === 0 ? (checked.has(rowIndex) ? "[x] " : "[ ] ") : "    "}`
        : "";
      const number =
        lineIndex === 0
          ? `${String(rowIndex + 1).padStart(maxNumberWidth)}. `
          : " ".repeat(maxNumberWidth + 2);
      const label = labelLines[lineIndex] ?? "";
      const impact = impactLines[lineIndex] ?? "";
      const paddedLabel = `${label}${" ".repeat(Math.max(0, labelWidth - visibleWidth(label)))}`;
      const styledMarker = active
        ? styleText(["cyan", "bold"], `${pointer}${selection}${number}`)
        : `${pointer}${selection}${number}`;
      const styledLabel = styleText(active ? ["cyan", "bold"] : ["white", "bold"], paddedLabel);
      const styledImpact = styleText(active ? "cyan" : "white", impact);
      output.push(`${INSET}${styledMarker}${styledLabel}${" ".repeat(gap)}${styledImpact}`);
    }
  }
  return output;
}

async function showSingleChoiceQuestion(
  ctx: ExtensionContext,
  question: SingleChoiceQuestion,
  previous: SingleChoiceAnswer | undefined,
  index: number,
  total: number,
  draftNote: string | undefined,
  saveDraftNote: (note: string) => void,
): Promise<QuestionOutcome> {
  const rows = [...question.options, { label: OTHER_LABEL, impact: "Write a custom answer" }];
  const restored = previous ? rows.findIndex((row) => row.label === previous.label) : -1;
  let selected = restored < 0 ? 0 : restored;
  let otherText = previous?.other ?? "";
  let noteText = draftNote ?? previous?.note ?? "";
  const background = ctx.ui.theme.getBgAnsi("userMessageBg");
  for (;;) {
    const outcome = await ctx.ui.custom<"previous" | "next" | "select" | "note" | undefined>(
      (tui, _theme, _keys, done) => ({
        handleInput(data: string) {
          if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) done(undefined);
          else if (isLeft(data)) done("previous");
          else if (isRight(data)) done("next");
          else if (data === "n") done("note");
          else if (isUp(data)) {
            selected = (selected + rows.length - 1) % rows.length;
            tui.requestRender();
          } else if (isDown(data)) {
            selected = (selected + 1) % rows.length;
            tui.requestRender();
          } else if (matchesKey(data, "return")) done("select");
        },
        invalidate() {},
        render(width: number) {
          const lines = frameTop(index, total, question.question, width);
          lines.push(...optionRows(rows, selected, width), ...frameNote(noteText, width));
          lines.push(
            ...frameBottom(
              `↑↓/jk choose  ←→/hl questions  n ${noteText ? "edit" : "add"} note  enter submit  esc interrupt`,
            ),
          );
          return lines.map((line) => paintPlanLine(line, width, background));
        },
      }),
    );
    if (outcome === undefined || outcome === "previous" || outcome === "next") return outcome;
    if (outcome === "note") {
      noteText = await editQuestionNote(ctx, question, noteText);
      saveDraftNote(noteText);
      continue;
    }
    const row = rows[selected];
    if (row.label !== OTHER_LABEL)
      return {
        answer: {
          id: question.id,
          type: "single_choice",
          label: row.label,
          ...(noteText ? { note: noteText } : {}),
        },
      };
    const other = await ctx.ui.input(question.header, otherText || question.question);
    if (other === undefined) continue;
    const trimmed = other.trim();
    if (!trimmed) continue;
    otherText = trimmed;
    return {
      answer: {
        id: question.id,
        type: "single_choice",
        label: OTHER_LABEL,
        other: trimmed,
        ...(noteText ? { note: noteText } : {}),
      },
    };
  }
}

async function showMultipleChoiceQuestion(
  ctx: ExtensionContext,
  question: MultipleChoiceQuestion,
  previous: MultipleChoiceAnswer | undefined,
  index: number,
  total: number,
  draftNote: string | undefined,
  saveDraftNote: (note: string) => void,
): Promise<QuestionOutcome> {
  const rows = [...question.options, { label: OTHER_LABEL, impact: "Write a custom answer" }];
  const otherRowIndex = rows.length - 1;
  const selectedRows = new Set<number>(
    previous?.labels
      .map((label) => rows.findIndex((row) => row.label === label))
      .filter((rowIndex) => rowIndex >= 0) ?? [],
  );
  let otherText = previous?.other ?? "";
  let noteText = draftNote ?? previous?.note ?? "";
  let cursor = 0;
  const background = ctx.ui.theme.getBgAnsi("userMessageBg");
  for (;;) {
    const outcome = await ctx.ui.custom<
      "previous" | "next" | "toggle" | "submit" | "note" | undefined
    >((tui, _theme, _keys, done) => ({
      handleInput(data: string) {
        if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) done(undefined);
        else if (isLeft(data)) done("previous");
        else if (isRight(data)) done("next");
        else if (data === "n") done("note");
        else if (isUp(data)) {
          cursor = (cursor + rows.length - 1) % rows.length;
          tui.requestRender();
        } else if (isDown(data)) {
          cursor = (cursor + 1) % rows.length;
          tui.requestRender();
        } else if (matchesKey(data, "space")) done("toggle");
        else if (matchesKey(data, "return") && selectedRows.size > 0) done("submit");
      },
      invalidate() {},
      render(width: number) {
        const lines = frameTop(index, total, question.question, width);
        lines.push(...optionRows(rows, cursor, width, selectedRows), ...frameNote(noteText, width));
        const noteAction = noteText ? "edit" : "add";
        lines.push(
          ...frameBottom(
            selectedRows.size > 0
              ? `↑↓/jk move  space toggle  ←→/hl questions  n ${noteAction} note  enter submit  esc interrupt`
              : `↑↓/jk move  space toggle  ←→/hl questions  n ${noteAction} note  select at least one`,
          ),
        );
        return lines.map((line) => paintPlanLine(line, width, background));
      },
    }));
    if (outcome === undefined || outcome === "previous" || outcome === "next") return outcome;
    if (outcome === "note") {
      noteText = await editQuestionNote(ctx, question, noteText);
      saveDraftNote(noteText);
      continue;
    }
    if (outcome === "submit") {
      const labels = question.options
        .filter((option) => selectedRows.has(rows.findIndex((row) => row.label === option.label)))
        .map((option) => option.label);
      const other = selectedRows.has(otherRowIndex) ? otherText : undefined;
      if (other !== undefined) labels.push(OTHER_LABEL);
      return {
        answer: {
          id: question.id,
          type: "multiple_choice",
          labels,
          other,
          ...(noteText ? { note: noteText } : {}),
        },
      };
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

export async function showPlanQuestion(
  ctx: ExtensionContext,
  question: PlanQuestion,
  previous: PlanAnswer | undefined,
  index: number,
  total: number,
  draftNote?: string,
  saveDraftNote: (note: string) => void = () => {},
): Promise<QuestionOutcome> {
  switch (question.type) {
    case "single_choice":
      return showSingleChoiceQuestion(
        ctx,
        question,
        previous?.type === "single_choice" ? previous : undefined,
        index,
        total,
        draftNote,
        saveDraftNote,
      );
    case "multiple_choice":
      return showMultipleChoiceQuestion(
        ctx,
        question,
        previous?.type === "multiple_choice" ? previous : undefined,
        index,
        total,
        draftNote,
        saveDraftNote,
      );
  }
}
