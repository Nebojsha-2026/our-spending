import { describe, expect, it } from "vitest";
import { inRange, parseRange, rangeFor, rangeLabel, suggestedThreshold } from "./rules";

describe("merchant rule amount ranges", () => {
  it("labels ranges", () => {
    expect(rangeLabel({ min_amount_cents: null, max_amount_cents: 1000 })).toBe("under $10");
    expect(rangeLabel({ min_amount_cents: 5000, max_amount_cents: null })).toBe("$50 or more");
    expect(rangeLabel({ min_amount_cents: 1000, max_amount_cents: 5050 })).toBe("$10 to under $50.50");
    expect(rangeLabel({ min_amount_cents: null, max_amount_cents: null })).toBeNull();
  });

  it("treats min as inclusive and max as exclusive, on the size of the spend", () => {
    const under10 = { min_amount_cents: null, max_amount_cents: 1000 };
    const from50 = { min_amount_cents: 5000, max_amount_cents: null };
    expect(inRange(under10, -999)).toBe(true);
    expect(inRange(under10, -1000)).toBe(false);
    expect(inRange(from50, -5000)).toBe(true);
    expect(inRange(from50, -4999)).toBe(false);
  });

  it("suggests a round $X that includes the purchase", () => {
    expect(suggestedThreshold(-450, "under")).toBe(500);
    expect(suggestedThreshold(-500, "under")).toBe(1000);
    expect(suggestedThreshold(-6200, "over")).toBe(6000);
    expect(suggestedThreshold(-300, "over")).toBe(500); // never below the smallest step
    expect(suggestedThreshold(-12_345, "under")).toBe(15_000);
  });

  it("turns the Always prompt into a range", () => {
    expect(rangeFor("any", "")).toEqual({ min_amount_cents: null, max_amount_cents: null });
    expect(rangeFor("under", "10")).toEqual({ min_amount_cents: null, max_amount_cents: 1000 });
    expect(rangeFor("over", "$50")).toEqual({ min_amount_cents: 5000, max_amount_cents: null });
    expect(rangeFor("under", "")).toHaveProperty("error");
    expect(rangeFor("over", "abc")).toHaveProperty("error");
  });

  it("validates request bodies", () => {
    expect(parseRange({})).toEqual({ min_amount_cents: null, max_amount_cents: null });
    expect(parseRange({ max_amount_cents: 1000 })).toEqual({ min_amount_cents: null, max_amount_cents: 1000 });
    expect(parseRange({ min_amount_cents: 12.5 })).toHaveProperty("error");
    expect(parseRange({ min_amount_cents: 5000, max_amount_cents: 1000 })).toHaveProperty("error");
    expect(parseRange({ max_amount_cents: 0 })).toHaveProperty("error");
  });
});
