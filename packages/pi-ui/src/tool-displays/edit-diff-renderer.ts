import {
  getLanguageFromPath,
  highlightCode,
  keyHint,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";
import { diffWords, parsePatch } from "diff";

const COLLAPSED_ROWS = 16;
const MIN_SPLIT_WIDTH = 88;
const MIN_CODE_WIDTH = 24;

type LineKind = "add" | "context" | "remove";
export interface EditDiffLine {
  kind: LineKind;
  content: string;
  oldNumber?: number;
  newNumber?: number;
}
export interface EditDiffSeparator {
  kind: "separator";
  omitted: number;
}
export type EditDiffEntry = EditDiffLine | EditDiffSeparator;
export interface EditDiffRow {
  left?: EditDiffLine;
  right?: EditDiffLine;
  separator?: EditDiffSeparator;
}
export interface WordRange {
  start: number;
  end: number;
}

export function parseEditPatch(patch: string): EditDiffEntry[] {
  const parsed = parsePatch(patch)[0];
  if (!parsed?.hunks.length) return [];
  const entries: EditDiffEntry[] = [];
  let previousOldEnd: number | undefined;
  for (const hunk of parsed.hunks) {
    if (previousOldEnd !== undefined) {
      entries.push({ kind: "separator", omitted: Math.max(0, hunk.oldStart - previousOldEnd) });
    }
    let oldNumber = hunk.oldStart;
    let newNumber = hunk.newStart;
    for (const raw of hunk.lines) {
      const marker = raw[0];
      const content = raw.slice(1).replaceAll("\t", "  ");
      if (marker === " ") {
        entries.push({ kind: "context", content, oldNumber: oldNumber++, newNumber: newNumber++ });
      } else if (marker === "-") {
        entries.push({ kind: "remove", content, oldNumber: oldNumber++ });
      } else if (marker === "+") {
        entries.push({ kind: "add", content, newNumber: newNumber++ });
      }
    }
    previousOldEnd = hunk.oldStart + hunk.oldLines;
  }
  return entries;
}

export function buildEditDiffRows(entries: EditDiffEntry[]): EditDiffRow[] {
  const rows: EditDiffRow[] = [];
  for (let index = 0; index < entries.length;) {
    const entry = entries[index]!;
    if (entry.kind === "separator") {
      rows.push({ separator: entry });
      index++;
    } else if (entry.kind === "remove") {
      const removed: EditDiffLine[] = [];
      const added: EditDiffLine[] = [];
      while (entries[index]?.kind === "remove") removed.push(entries[index++] as EditDiffLine);
      while (entries[index]?.kind === "add") added.push(entries[index++] as EditDiffLine);
      for (let pair = 0; pair < Math.max(removed.length, added.length); pair++) {
        rows.push({ left: removed[pair], right: added[pair] });
      }
    } else {
      rows.push(entry.kind === "add" ? { right: entry } : { left: entry, right: entry });
      index++;
    }
  }
  return rows;
}

export function changedWordRanges(
  oldText: string,
  newText: string,
): {
  oldRanges: WordRange[];
  newRanges: WordRange[];
} {
  const oldRanges: WordRange[] = [];
  const newRanges: WordRange[] = [];
  let oldOffset = 0;
  let newOffset = 0;
  for (const change of diffWords(oldText, newText)) {
    const length = change.value.length;
    if (change.removed) {
      oldRanges.push({ start: oldOffset, end: oldOffset + length });
      oldOffset += length;
    } else if (change.added) {
      newRanges.push({ start: newOffset, end: newOffset + length });
      newOffset += length;
    } else {
      oldOffset += length;
      newOffset += length;
    }
  }
  return { oldRanges, newRanges };
}

export function chooseEditDiffLayout(entries: EditDiffEntry[], width: number): "split" | "unified" {
  if (width < MIN_SPLIT_WIDTH) return "unified";
  const changed = entries.filter((entry): entry is EditDiffLine => entry.kind !== "separator");
  const additions = changed.filter((line) => line.kind === "add").length;
  const removals = changed.filter((line) => line.kind === "remove").length;
  if (!additions || !removals || Math.max(additions, removals) > Math.min(additions, removals) * 2)
    return "unified";
  const codeWidth = Math.floor((width - 3) / 2) - 8;
  if (codeWidth < MIN_CODE_WIDTH) return "unified";
  const long = changed.filter((line) => visibleWidth(line.content) > codeWidth).length;
  return long > changed.length / 3 ? "unified" : "split";
}

function fit(text: string, width: number): string {
  return truncateToWidth(text, width, "…", true);
}

function applyRanges(text: string, ranges: WordRange[], start: string, end: string): string {
  if (!ranges.length) return text;
  let result = "";
  let visible = 0;
  let rangeIndex = 0;
  for (let index = 0; index < text.length;) {
    if (text[index] === "\x1b" && text[index + 1] === "[") {
      const end = text.indexOf("m", index + 2);
      if (end >= 0) {
        result += text.slice(index, end + 1);
        index = end + 1;
        continue;
      }
    }
    const range = ranges[rangeIndex];
    if (range && visible === range.start) result += start;
    result += text[index]!;
    visible++;
    index++;
    if (range && visible === range.end) {
      result += end;
      rangeIndex++;
    }
  }
  if (rangeIndex < ranges.length) result += end;
  return result;
}

function highlighted(lines: EditDiffLine[], path: string): Map<EditDiffLine, string> {
  const result = new Map<EditDiffLine, string>();
  if (!lines.length) return result;
  let output: string[];
  try {
    output = highlightCode(lines.map((line) => line.content).join("\n"), getLanguageFromPath(path));
  } catch {
    output = lines.map((line) => line.content);
  }
  lines.forEach((line, index) => result.set(line, output[index] ?? line.content));
  return result;
}

export class EditDiffRenderer implements Component {
  private readonly entries?: EditDiffEntry[];

  constructor(
    patch: string,
    private readonly displayDiff: string,
    private readonly path: string,
    private readonly expanded: boolean,
    private readonly theme: Theme,
  ) {
    try {
      const entries = parseEditPatch(patch);
      this.entries = entries.length ? entries : undefined;
    } catch {
      this.entries = undefined;
    }
  }

  invalidate(): void {}

  render(width: number): string[] {
    if (!this.entries) return this.renderFallback(width);
    return chooseEditDiffLayout(this.entries, width) === "split"
      ? this.renderSplit(width)
      : this.renderUnified(width);
  }

  private lineColor(kind: LineKind): "toolDiffAdded" | "toolDiffContext" | "toolDiffRemoved" {
    return kind === "add"
      ? "toolDiffAdded"
      : kind === "remove"
        ? "toolDiffRemoved"
        : "toolDiffContext";
  }

  private renderSplit(width: number): string[] {
    const rows = buildEditDiffRows(this.entries!);
    const visible = this.expanded ? rows : rows.slice(0, COLLAPSED_ROWS);
    const hidden = rows.length - visible.length;
    const lines = visible
      .flatMap((row) => [row.left, row.right])
      .filter((line): line is EditDiffLine => !!line);
    const syntax = highlighted(lines, this.path);
    const numberWidth = Math.max(
      3,
      ...lines
        .flatMap((line) => [line.oldNumber ?? 0, line.newNumber ?? 0])
        .map(String)
        .map((n) => n.length),
    );
    const divider = " │ ";
    const columnWidth = Math.floor((width - visibleWidth(divider)) / 2);
    const cell = (
      line: EditDiffLine | undefined,
      side: "old" | "new",
      counterpart?: EditDiffLine,
    ): string => {
      if (!line) return " ".repeat(columnWidth);
      const color = this.lineColor(line.kind);
      const number = String(
        side === "old" ? (line.oldNumber ?? "") : (line.newNumber ?? ""),
      ).padStart(numberWidth);
      const sign = line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " ";
      let code = line.kind === "context" ? (syntax.get(line) ?? line.content) : line.content;
      if (counterpart && line.kind !== "context") {
        const ranges = changedWordRanges(
          line.kind === "remove" ? line.content : counterpart.content,
          line.kind === "add" ? line.content : counterpart.content,
        );
        const selected = line.kind === "remove" ? ranges.oldRanges : ranges.newRanges;
        code = applyRanges(code, selected, "\x1b[1;4m", "\x1b[22;24m");
      }
      const gutter = `${number} ${sign} │ `;
      const content =
        line.kind === "context"
          ? this.theme.fg(color, gutter) + code
          : this.theme.fg(color, gutter + code);
      return fit(content, columnWidth);
    };
    const output = visible.map((row) => {
      if (row.separator)
        return fit(this.theme.fg("muted", `… ${row.separator.omitted} unchanged lines …`), width);
      return `${cell(row.left, "old", row.right)}${this.theme.fg("dim", divider)}${cell(row.right, "new", row.left)}`;
    });
    if (hidden > 0)
      output.push(
        `${this.theme.fg("muted", `… ${hidden} more diff rows,`)} ${keyHint("app.tools.expand", "to expand")}`,
      );
    return output.map((line) => truncateToWidth(line, width));
  }

  private renderUnified(width: number): string[] {
    const visible = this.expanded ? this.entries! : this.entries!.slice(0, COLLAPSED_ROWS);
    const hidden = this.entries!.length - visible.length;
    const lines = visible.filter((entry): entry is EditDiffLine => entry.kind !== "separator");
    const syntax = highlighted(lines, this.path);
    const counterparts = new Map<EditDiffLine, EditDiffLine>();
    for (const row of buildEditDiffRows(this.entries!)) {
      if (row.left?.kind === "remove" && row.right?.kind === "add") {
        counterparts.set(row.left, row.right);
        counterparts.set(row.right, row.left);
      }
    }
    const numberWidth = Math.max(
      3,
      ...lines
        .flatMap((line) => [line.oldNumber ?? 0, line.newNumber ?? 0])
        .map(String)
        .map((n) => n.length),
    );
    const output = visible.map((entry) => {
      if (entry.kind === "separator")
        return fit(this.theme.fg("muted", `… ${entry.omitted} unchanged lines …`), width);
      const color = this.lineColor(entry.kind);
      const oldNumber = String(entry.oldNumber ?? "").padStart(numberWidth);
      const newNumber = String(entry.newNumber ?? "").padStart(numberWidth);
      const sign = entry.kind === "add" ? "+" : entry.kind === "remove" ? "-" : " ";
      let code = entry.kind === "context" ? (syntax.get(entry) ?? entry.content) : entry.content;
      const counterpart = counterparts.get(entry);
      if (counterpart) {
        const ranges = changedWordRanges(
          entry.kind === "remove" ? entry.content : counterpart.content,
          entry.kind === "add" ? entry.content : counterpart.content,
        );
        code = applyRanges(
          code,
          entry.kind === "remove" ? ranges.oldRanges : ranges.newRanges,
          "\x1b[1;4m",
          "\x1b[22;24m",
        );
      }
      const gutter = `${oldNumber} ${newNumber} ${sign} │ `;
      const content =
        entry.kind === "context"
          ? this.theme.fg(color, gutter) + code
          : this.theme.fg(color, gutter + code);
      return fit(content, width);
    });
    if (hidden > 0)
      output.push(
        `${this.theme.fg("muted", `… ${hidden} more diff rows,`)} ${keyHint("app.tools.expand", "to expand")}`,
      );
    return output.map((line) => truncateToWidth(line, width));
  }

  private renderFallback(width: number): string[] {
    if (!this.displayDiff) return [];
    const lines = this.displayDiff.split("\n");
    const visible = this.expanded ? lines : lines.slice(0, COLLAPSED_ROWS);
    const output = visible.map((line) => {
      const color = line.startsWith("+")
        ? "toolDiffAdded"
        : line.startsWith("-")
          ? "toolDiffRemoved"
          : "toolDiffContext";
      return this.theme.fg(color, line);
    });
    const hidden = lines.length - visible.length;
    if (hidden > 0) {
      output.push(
        `${this.theme.fg("muted", `… ${hidden} more diff rows,`)} ${keyHint("app.tools.expand", "to expand")}`,
      );
    }
    return output.map((line) => truncateToWidth(line, width));
  }
}
