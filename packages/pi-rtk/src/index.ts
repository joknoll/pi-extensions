import { isToolCallEventType, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default async function piRtk(pi: ExtensionAPI) {
  const available = await pi
    .exec("rtk", ["--version"], { timeout: 2_000 })
    .then((result) => !result.killed && result.code === 0)
    .catch(() => false);

  if (!available) return;

  pi.on("tool_call", async (event, ctx) => {
    if (!isToolCallEventType("bash", event) || !event.input.command.trim()) return;

    try {
      const result = await pi.exec("rtk", ["rewrite", event.input.command], {
        signal: ctx.signal,
        timeout: 2_000,
      });
      const rewritten = result.stdout.trim();

      if (
        !result.killed &&
        (result.code === 0 || result.code === 3) &&
        rewritten &&
        rewritten !== event.input.command
      ) {
        event.input.command = rewritten;
      }
    } catch {
      // Fail open.
    }
  });
}
