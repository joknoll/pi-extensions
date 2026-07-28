import { CustomEditor, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

export function paintBackground(line: string, background: string): string {
  return `${background}${line.replaceAll("\x1b[0m", `\x1b[0m${background}`)}\x1b[49m`;
}

class PiEditor extends CustomEditor {
  bashBorderColor?: (text: string) => string;
  // Pi has no editor-background token; session_start replaces this fallback.
  background = "\x1b[48;2;58;58;58m";

  render(width: number): string[] {
    const prompt = this.borderColor("x") === this.bashBorderColor?.("x") ? "$ " : "❯ ";
    const lines = super.render(Math.max(1, width - prompt.length));
    // eslint-disable-next-line no-control-regex -- Pi renders ANSI-colored borders.
    const border = /\x1b\[[0-?]*[ -/]*[@-~]/g;
    const bottom = lines.findIndex(
      (line, index) => index > 0 && line.replace(border, "").includes("─"),
    );
    const input = bottom < 0 ? lines.slice(1) : lines.slice(1, bottom);

    return [
      " ".repeat(width),
      ...input.map((line, index) => `${index ? " ".repeat(prompt.length) : prompt}${line}`),
      " ".repeat(width),
      ...(bottom < 0 ? [] : lines.slice(bottom + 1)),
    ].map((line) => paintBackground(line, this.background));
  }
}

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
