import { describe, expect, test } from "vite-plus/test";
import { parseArguments } from "../src/arguments.ts";

describe("smart-compact arguments", () => {
  test("uses a focused direct-run grammar", () => {
    expect(parseArguments('thorough --model=anthropic/sonnet -- "focus on auth flow"')).toEqual({
      action: "run",
      profile: "thorough",
      model: "anthropic/sonnet",
      apply: false,
      focus: "focus on auth flow",
    });
  });

  test("supports non-interactive application", () => {
    expect(parseArguments("balanced --apply preserve errors")).toMatchObject({
      action: "run",
      profile: "balanced",
      apply: true,
      focus: "preserve errors",
    });
  });

  test("rejects malformed options", () => {
    expect(() => parseArguments("--model")).toThrow("--model requires");
    expect(() => parseArguments("--unknown")).toThrow("Unknown option");
    expect(() => parseArguments('fast "unfinished')).toThrow("Unclosed quote");
  });
});
