import { expect, test } from "vite-plus/test";
import { formatTokens } from "../src/index.ts";

test("formats footer token counts compactly", () => {
  expect(formatTokens(999)).toBe("999");
  expect(formatTokens(1_000)).toBe("1.0k");
  expect(formatTokens(10_000)).toBe("10k");
});
