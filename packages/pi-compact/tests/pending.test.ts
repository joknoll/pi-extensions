import { describe, expect, test } from "vite-plus/test";
import { createPendingSlot } from "../src/pending.ts";

const options = { profile: "balanced", review: true } as const;

describe("pending request slot", () => {
  test("is single-use and session-bound", () => {
    const slot = createPendingSlot();
    slot.set("session-a", options);
    expect(slot.consume("session-b")).toBeUndefined();
    expect(slot.consume("session-a")).toBeUndefined();
  });

  test("expires requests", () => {
    let now = 1_000;
    const slot = createPendingSlot(50, () => now);
    slot.set("session-a", options);
    now += 51;
    expect(slot.consume("session-a")).toBeUndefined();
  });

  test("returns a matching request exactly once", () => {
    const slot = createPendingSlot();
    slot.set("session-a", options);
    expect(slot.consume("session-a")).toEqual(options);
    expect(slot.consume("session-a")).toBeUndefined();
  });
});
