import { describe, expect, it } from "vitest";
import { shouldShowSupport } from "./support";

describe("support card", () => {
  const now = Date.parse("2026-11-01T00:00:00Z");
  it("waits until the app has been used for a while", () => {
    expect(shouldShowSupport({}, 49, now)).toBe(false);
    expect(shouldShowSupport({}, 50, now)).toBe(true);
  });
  it("respects Maybe later for a month, and I've already supported for good", () => {
    expect(shouldShowSupport({ snoozeUntil: now + 1 }, 500, now)).toBe(false);
    expect(shouldShowSupport({ snoozeUntil: now - 1 }, 500, now)).toBe(true);
    expect(shouldShowSupport({ supported: true }, 500, now)).toBe(false);
  });
});
