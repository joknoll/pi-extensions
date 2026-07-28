import { expect, test } from "vite-plus/test";
import { nuSuggestions, shellResult } from "./helpers.ts";

test("normalizes Nu completions and killed results", () => {
  expect(nuSuggestions("str ca", ["str camel-case", "str capitalize"])).toEqual({
    prefix: "ca",
    items: [
      { value: "camel-case", label: "str camel-case" },
      { value: "capitalize", label: "str capitalize" },
    ],
  });
  expect(nuSuggestions("echo $env.PA", ["PATH"]).items[0]?.value).toBe("$env.PATH");
  expect(shellResult({ stdout: "out", stderr: "err", code: 0, killed: true })).toEqual({
    output: "out\nerr",
    exitCode: 1,
    cancelled: true,
    truncated: false,
  });
});
