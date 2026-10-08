import { describe, expect, it } from "vitest";
import { deltaLabel, dollarsToCents, formatCents, formatSigned, keypadToCents, pressKey } from "./money";
import {
  dayLabel,
  daysLeftInMonth,
  periodAt,
  periodLabel,
  previous,
  previousLabel,
  sydneyDate,
  trendSlots,
} from "./periods";

describe("money", () => {
  it("formats cents", () => {
    expect(formatCents(384260)).toBe("$3,842.60");
    expect(formatSigned(-6420)).toBe("−$64.20");
    expect(formatSigned(1500)).toBe("+$15.00");
  });

  it("follows the design's keypad rules", () => {
    const type = (keys: string[]) => keys.reduce(pressKey, "");
    expect(type(["1", "2", ".", "5", "0", "9"])).toBe("12.50");
    expect(type(["0", "7"])).toBe("7");
    expect(type([".", "5"])).toBe("0.5");
    expect(type(["1", ".", ".", "2"])).toBe("1.2");
    expect(type(["1", "2", "3", "4", "5", "6", "7", "8"])).toBe("1234567");
    expect(type(["4", "del"])).toBe("");
    expect(keypadToCents("12.5")).toBe(1250);
    expect(keypadToCents("0.05")).toBe(5);
    expect(keypadToCents("")).toBe(0);
  });

  it("parses typed dollar amounts", () => {
    expect(dollarsToCents("$1,200")).toBe(120000);
    expect(dollarsToCents("45.5")).toBe(4550);
    expect(dollarsToCents("")).toBeNull();
    expect(dollarsToCents("12.345")).toBeNull();
    expect(dollarsToCents("abc")).toBeNull();
  });

  it("labels deltas", () => {
    expect(deltaLabel(112, 100, "last week")).toEqual({ text: "+12% vs last week", up: true });
    expect(deltaLabel(92, 100, "August")).toEqual({ text: "−8% vs August", up: false });
    expect(deltaLabel(50, 0, "2025")).toBeNull();
  });
});

describe("periods (Australia/Sydney, Mon–Sun weeks)", () => {
  const today = "2026-10-06"; // Tuesday

  it("finds the Sydney calendar day across the UTC date line", () => {
    expect(sydneyDate("2026-10-05T14:30:00Z")).toBe("2026-10-06"); // 01:30 AEDT
    expect(sydneyDate("2026-10-05T12:59:00Z")).toBe("2026-10-05"); // 23:59 AEDT
  });

  it("starts weeks on Monday", () => {
    expect(periodAt("week", today)).toEqual({ kind: "week", start: "2026-10-05", end: "2026-10-12" });
    expect(periodAt("week", "2026-10-11")).toMatchObject({ start: "2026-10-05" }); // Sunday
    expect(periodAt("week", "2026-10-12")).toMatchObject({ start: "2026-10-12" }); // Monday
    expect(periodAt("week", today, -1)).toMatchObject({ start: "2026-09-28", end: "2026-10-05" });
  });

  it("steps months and years", () => {
    expect(periodAt("month", today, -1)).toEqual({ kind: "month", start: "2026-09-01", end: "2026-10-01" });
    expect(periodAt("month", "2026-01-15", -1)).toMatchObject({ start: "2025-12-01" });
    expect(periodAt("year", today)).toEqual({ kind: "year", start: "2026-01-01", end: "2027-01-01" });
    expect(previous(periodAt("year", today))).toMatchObject({ start: "2025-01-01", end: "2026-01-01" });
  });

  it("labels periods like the design", () => {
    expect(periodLabel(periodAt("week", today), today)).toBe("Week of 5 – 11 Oct");
    expect(periodLabel(periodAt("week", today, -1), today)).toBe("Week of 28 Sep – 4 Oct");
    expect(periodLabel(periodAt("month", today, -1), today)).toBe("September 2026");
    expect(periodLabel(periodAt("year", today), today)).toBe("2026 so far");
    expect(periodLabel(periodAt("year", today, -1), today)).toBe("2025");
    expect(previousLabel(periodAt("week", today), today)).toBe("last week");
    expect(previousLabel(periodAt("month", today, -1), today)).toBe("August");
    expect(previousLabel(periodAt("year", today), today)).toBe("2025");
  });

  it("builds trend slots", () => {
    const w = trendSlots(periodAt("week", today), today);
    expect(w.title).toBe("Last 6 weeks");
    expect(w.slots.map((s) => s.label)).toEqual(["31 Aug", "7 Sep", "14 Sep", "21 Sep", "28 Sep", "5 Oct"]);
    const m = trendSlots(periodAt("month", today, -1), today);
    expect(m.slots.map((s) => s.label)).toEqual(["Apr", "May", "Jun", "Jul", "Aug", "Sep"]);
    const y = trendSlots(periodAt("year", today), today);
    expect(y.kind).toBe("month");
    expect(y.slots.map((s) => s.label).join("")).toBe("JFMAMJJASO");
    expect(trendSlots(periodAt("year", today, -1), today).slots).toHaveLength(12);
  });

  it("labels days and counts the days left", () => {
    expect(dayLabel("2026-10-06", today)).toBe("Today · Tue 6 Oct");
    expect(dayLabel("2026-10-05", today)).toBe("Mon 5 Oct");
    expect(dayLabel("2025-12-31", today)).toBe("Wed 31 Dec 2025");
    expect(daysLeftInMonth(today)).toBe(26);
    expect(daysLeftInMonth("2026-10-31")).toBe(1);
  });
});

describe("inPeriod (category drill-down)", () => {
  const oct = { start: "2026-10-01", end: "2026-11-01" };
  it("uses the Sydney calendar day, not UTC", async () => {
    const { inPeriod } = await import("./overview");
    expect(inPeriod("2026-09-30T14:30:00Z", oct)).toBe(true); // 1 Oct 00:30 in Sydney (AEST+10)
    expect(inPeriod("2026-09-30T13:30:00Z", oct)).toBe(false); // 30 Sep 23:30
    expect(inPeriod("2026-10-31T12:59:00Z", oct)).toBe(true); // 31 Oct 23:59 (AEDT+11)
    expect(inPeriod("2026-10-31T13:00:00Z", oct)).toBe(false); // 1 Nov 00:00
  });
});
