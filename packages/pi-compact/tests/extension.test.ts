import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { expect, test } from "vite-plus/test";
import piCompactExtension from "../src/index.ts";

test("registers only the smart command and leaves automatic compaction untouched", async () => {
  const commands: string[] = [];
  let beforeCompact: ((event: { reason: string }, ctx: object) => Promise<unknown>) | undefined;
  const api = {
    registerCommand(name: string) {
      commands.push(name);
    },
    on(event: string, handler: typeof beforeCompact) {
      if (event === "session_before_compact") beforeCompact = handler;
    },
  } as unknown as ExtensionAPI;

  piCompactExtension(api);

  expect(commands).toEqual(["smart-compact"]);
  await expect(beforeCompact!({ reason: "threshold" }, {})).resolves.toBeUndefined();
});
