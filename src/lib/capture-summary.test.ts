import { describe, expect, it } from "vitest";
import { captureSummaryMessage, unknownCardReason } from "./capture-summary";

describe("weekly capture summary wording", () => {
  it("counts both kinds", () => {
    expect(captureSummaryMessage({ missed: 3, unknown_cards: 2, unreadable: 1 })).toEqual({
      title: "3 payments weren't logged last week",
      body: "2 on cards not saved in the app, 1 the app couldn't read. Tap to check the Capture log.",
      url: "/settings/capture-log",
      tag: "capture-summary",
    });
  });

  it("words one kind, one or many", () => {
    expect(captureSummaryMessage({ missed: 1, unknown_cards: 1, unreadable: 0 })).toMatchObject({
      title: "1 payment wasn't logged last week",
      body: "It was on a card not saved in the app. Tap to check the Capture log.",
    });
    expect(captureSummaryMessage({ missed: 4, unknown_cards: 0, unreadable: 4 }).body).toBe(
      "The app couldn't read them. Tap to check the Capture log.",
    );
  });

  it("keeps the Capture log reason short", () => {
    expect(unknownCardReason("Afterpay Card")).toMatch(/^Not one of your cards: "Afterpay Card"\./);
    expect(unknownCardReason("x".repeat(500)).length).toBeLessThanOrEqual(200);
  });
});
