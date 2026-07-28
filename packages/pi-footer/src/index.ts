import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { stripVTControlCharacters, styleText } from "node:util";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export const formatTokens = (tokens: number): string =>
  tokens < 1_000 ? `${tokens}` : `${(tokens / 1_000).toFixed(tokens < 10_000 ? 1 : 0)}k`;

export default function piFooter(pi: ExtensionAPI): void {
  pi.on("session_start", async (_event, ctx) => {
    let directory = ctx.cwd;
    try {
      const result = await pi.exec(
        "starship",
        ["prompt", "--path", ctx.cwd, "--status", "0", "--terminal-width", "200"],
        { timeout: 2_000 },
      );
      if (result.code === 0 && result.stdout.trim()) {
        // Preserve Starship's styling, but omit its input prompt and empty lines.
        directory = result.stdout
          .split(/\r?\n/)
          .map((line) => line.replaceAll("❯", "").trim())
          .filter((line) => stripVTControlCharacters(line).trim())
          .join(" ");
      }
    } catch {
      // Starship is optional; use the working directory if it cannot be run.
    }

    ctx.ui.setFooter((_tui, theme, footerData) => ({
      invalidate() {},
      render(width: number): string[] {
        let input = 0;
        let output = 0;
        for (const entry of ctx.sessionManager.getBranch()) {
          if (entry.type === "message" && entry.message.role === "assistant") {
            const message = entry.message as AssistantMessage;
            input += message.usage.input + message.usage.cacheRead + message.usage.cacheWrite;
            output += message.usage.output;
          }
        }

        const context = ctx.getContextUsage();
        const contextWindow = ctx.model?.contextWindow;
        const contextText =
          context?.tokens !== null && context?.tokens !== undefined && contextWindow
            ? `${((context.tokens / contextWindow) * 100).toFixed(1)}%/${formatTokens(contextWindow)}`
            : "";
        const model = ctx.model?.id ?? "no model";
        const thinkingLevel = pi.getThinkingLevel();
        const thinkingText = {
          off: theme.fg("thinkingOff", thinkingLevel),
          minimal: theme.fg("thinkingMinimal", thinkingLevel),
          low: theme.fg("thinkingLow", thinkingLevel),
          medium: theme.fg("thinkingMedium", thinkingLevel),
          high: theme.fg("thinkingHigh", thinkingLevel),
          xhigh: theme.fg("thinkingXhigh", thinkingLevel),
          max: theme.fg("thinkingMax", thinkingLevel),
        }[thinkingLevel];
        const stats = [
          theme.fg("dim", `↑${formatTokens(input)}/↓${formatTokens(output)}`),
          contextText && theme.fg("dim", contextText),
        ].filter(Boolean);
        const modelText = ctx.model ? styleText("yellowBright", model) : theme.fg("dim", model);
        const statuses = footerData.getExtensionStatuses();
        const planModeStatus = statuses.get("plan-mode");
        const planMode = planModeStatus ? styleText("cyan", planModeStatus) : undefined;
        const cache = statuses.get("pi-cache");
        const right = [planMode, modelText, thinkingText, cache, ...stats]
          .filter(Boolean)
          .join(theme.fg("dim", " · "));
        const padding = " ".repeat(
          Math.max(1, width - visibleWidth(directory) - visibleWidth(right)),
        );
        return [truncateToWidth(directory + padding + right, width)];
      },
    }));
  });
}
