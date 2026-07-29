import { describe, expect, test } from "vite-plus/test";
import { initTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  buildEditDiffRows,
  changedWordRanges,
  chooseEditDiffLayout,
  EditDiffRenderer,
  parseEditPatch,
} from "./edit-diff-renderer.ts";

initTheme();

const patch = `--- a/example.ts
+++ b/example.ts
@@ -1,4 +1,4 @@
 const one = 1;
-const value = "old";
+const value = "new";
 const three = 3;
 const four = 4;
@@ -10,2 +10,3 @@
 const ten = 10;
+const eleven = 11;
 const twelve = 12;
`;

const theme = {
  name: "test",
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
  getFgAnsi: (color: string) =>
    color === "toolDiffRemoved" ? "\x1b[38;2;220;80;80m" : "\x1b[38;2;80;200;120m",
  getBgAnsi: () => "\x1b[48;2;20;20;20m",
  getColorMode: () => "truecolor",
} as unknown as Theme;

describe("edit diff model", () => {
  test("parses line numbers and omitted context across hunks", () => {
    const entries = parseEditPatch(patch);
    expect(entries).toContainEqual({
      kind: "remove",
      content: 'const value = "old";',
      oldNumber: 2,
    });
    expect(entries).toContainEqual({
      kind: "add",
      content: "const eleven = 11;",
      newNumber: 11,
    });
    expect(entries).toContainEqual({ kind: "separator", omitted: 5 });
  });

  test("pairs replacement blocks without dropping unequal lines", () => {
    const entries = parseEditPatch(`--- a/x\n+++ b/x\n@@ -1,2 +1,3 @@\n-a\n-b\n+c\n+d\n+e\n`);
    const rows = buildEditDiffRows(entries);
    expect(rows).toHaveLength(3);
    expect(rows[0]?.left?.content).toBe("a");
    expect(rows[0]?.right?.content).toBe("c");
    expect(rows[2]?.left).toBeUndefined();
    expect(rows[2]?.right?.content).toBe("e");
  });

  test("chooses split only for readable, balanced wide changes", () => {
    const balanced = parseEditPatch(`--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old value\n+new value\n`);
    expect(chooseEditDiffLayout(balanced, 120)).toBe("split");
    expect(chooseEditDiffLayout(balanced, 70)).toBe("unified");
    expect(
      chooseEditDiffLayout(parseEditPatch(`--- a/x\n+++ b/x\n@@ -0,0 +1 @@\n+new\n`), 120),
    ).toBe("unified");
  });

  test("finds exact changed word ranges on both sides", () => {
    expect(changedWordRanges("const oldName = 1", "const newName = 1")).toEqual({
      oldRanges: [{ start: 6, end: 13 }],
      newRanges: [{ start: 6, end: 13 }],
    });
  });
});

describe("edit diff rendering", () => {
  test("collapses logical rows and keeps every terminal row within width", () => {
    const manyLines = Array.from({ length: 20 }, (_, index) => `-old ${index}\n+new ${index}`).join(
      "\n",
    );
    const manyPatch = `--- a/x.txt\n+++ b/x.txt\n@@ -1,20 +1,20 @@\n${manyLines}\n`;
    const compact = new EditDiffRenderer(manyPatch, "", "x.txt", false, theme).render(60);
    const expanded = new EditDiffRenderer(manyPatch, "", "x.txt", true, theme).render(60);
    expect(compact.some((line) => line.includes("24 more diff rows"))).toBe(true);
    expect(expanded).toHaveLength(40);
    expect(compact.every((line) => visibleWidth(line) <= 60)).toBe(true);
    expect(compact.join("\n")).not.toContain("[48;");
    expect(compact.join("\n")).toContain("\x1b[1;4m");
  });

  test("renders unknown languages with non-truecolor theme values", () => {
    const indexedTheme = {
      name: "indexed-test",
      fg: (_color: string, text: string) => text,
      bg: (_color: string, text: string) => text,
      bold: (text: string) => text,
      getFgAnsi: () => "\x1b[38;5;2m",
      getBgAnsi: () => "\x1b[48;5;0m",
      getColorMode: () => "256color",
    } as unknown as Theme;
    const rendered = new EditDiffRenderer(patch, "", "unknown.zzz", false, indexedTheme).render(70);
    expect(rendered.join("\n")).toContain("new");
  });

  test("falls back to the display diff for malformed patches", () => {
    const rendered = new EditDiffRenderer(
      "not a patch",
      "+ 1 readable",
      "unknown.zzz",
      false,
      theme,
    ).render(40);
    expect(rendered.join("\n")).toContain("readable");
  });
});
