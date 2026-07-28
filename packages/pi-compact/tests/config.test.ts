import { describe, expect, test } from "vite-plus/test";
import { resolveConfig } from "../src/config.ts";

describe("configuration", () => {
  test("merges trusted project values over global values", () => {
    const result = resolveConfig(
      { piCompact: { profile: "fast", summaryModel: "openai/summary", review: false } },
      { piCompact: { profile: "thorough", review: true } },
    );
    expect(result.config).toEqual({
      profile: "thorough",
      summaryModel: "openai/summary",
      review: true,
    });
    expect(result.warnings).toEqual([]);
  });

  test("falls back field-by-field for invalid settings", () => {
    const result = resolveConfig(
      { piCompact: { profile: "maximum", summaryModel: 7, review: "yes" } },
      {},
    );
    expect(result.config).toEqual({ profile: "balanced", summaryModel: null, review: true });
    expect(result.warnings).toHaveLength(3);
  });
});
