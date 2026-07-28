import { CustomEditor, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const FALLBACK_BACKGROUND = "\x1b[48;2;58;58;58m";
const RESET_BACKGROUND = "\x1b[49m";
const DEFAULT_PROMPT = "❯ ";
const SHELL_PROMPT = "$ ";
// eslint-disable-next-line no-control-regex -- terminal output intentionally contains ANSI escapes.
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]/g;

/** Paint a complete terminal line while preserving the background after full ANSI resets. */
export function paintBackground(line: string, background: string): string {
  return `${background}${line.replaceAll("\x1b[0m", `\x1b[0m${background}`)}${RESET_BACKGROUND}`;
}

/** Pi's stock editor behavior with a borderless, full-width input surface. */
export class PiEditor extends CustomEditor {
  bashBorderColor?: (text: string) => string;
  background = FALLBACK_BACKGROUND;

  render(width: number): string[] {
    const prompt =
      this.borderColor("x") === this.bashBorderColor?.("x") ? SHELL_PROMPT : DEFAULT_PROMPT;
    const lines = super.render(Math.max(1, width - prompt.length));
    const isBorder = (line: string): boolean => line.replace(ANSI, "").includes("─");
    const bottomBorder = lines.findIndex((line, index) => index > 0 && isBorder(line));
    const inputLines = bottomBorder === -1 ? lines.slice(1) : lines.slice(1, bottomBorder);
    const autocompleteLines = bottomBorder === -1 ? [] : lines.slice(bottomBorder + 1);
    const padding = " ".repeat(width);

    return [
      padding,
      ...inputLines.map(
        (line, index) => `${index === 0 ? prompt : " ".repeat(prompt.length)}${line}`,
      ),
      padding,
      ...autocompleteLines,
    ].map((line) => paintBackground(line, this.background));
  }
}

/** Install Joknoll's Pi UI customizations. Footer changes intentionally live in pi-footer. */
export default function piUi(pi: ExtensionAPI): void {
  pi.on("session_start", (_event, ctx) => {
    ctx.ui.setEditorComponent((tui, theme, keybindings) => {
      const editor = new PiEditor(tui, theme, keybindings);
      editor.bashBorderColor = ctx.ui.theme.getBashModeBorderColor();
      editor.background = ctx.ui.theme.getBgAnsi("userMessageBg");
      return editor;
    });
  });
}
