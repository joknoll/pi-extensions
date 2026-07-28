import { EventEmitter } from "node:events";
import { writeFileSync } from "node:fs";
import type { ChildProcess, spawn } from "node:child_process";
import { expect, test } from "vite-plus/test";
import { editWithExternalEditor } from "../src/review.ts";

test("external editor returns the edited temporary summary", async () => {
  const fakeSpawn = ((_command: string, args: string[]) => {
    const child = new EventEmitter();
    writeFileSync(args.at(-1)!, "edited summary\n", "utf8");
    queueMicrotask(() => child.emit("close", 0));
    return child as ChildProcess;
  }) as typeof spawn;

  await expect(editWithExternalEditor("original", "editor --wait", fakeSpawn)).resolves.toBe(
    "edited summary",
  );
});
