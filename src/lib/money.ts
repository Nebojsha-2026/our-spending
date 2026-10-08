// Amounts are integer cents in AUD. Spending is negative, refunds positive.

const MINUS = "−"; // typographic minus, as in the design

const grouped = new Intl.NumberFormat("en-AU", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** 384260 → "$3,842.60" (no sign). */
export function formatCents(cents: number): string {
  return "$" + grouped.format(Math.abs(cents) / 100);
}

/** A transaction amount: -6420 → "−$64.20", 1500 → "+$15.00". */
export function formatSigned(cents: number): string {
  return (cents < 0 ? MINUS : "+") + formatCents(cents);
}

/** Percentage change label, e.g. "+12% vs last week". Null if there's nothing to compare. */
export function deltaLabel(current: number, previous: number, against: string) {
  if (previous <= 0) return null;
  const pct = Math.round(((current - previous) / previous) * 100);
  const text = (pct > 0 ? "+" : pct < 0 ? MINUS : "") + Math.abs(pct) + "% vs " + against;
  return { text, up: pct > 0 };
}

/**
 * Quick add keypad. Mirrors the approved design: max 2 decimals, max 7 digits,
 * a leading "0" is replaced by the next digit.
 */
export function pressKey(amount: string, key: string): string {
  if (key === "del") return amount.slice(0, -1);
  if (key === ".") return amount.includes(".") ? amount : (amount || "0") + ".";
  const dot = amount.indexOf(".");
  if (dot !== -1 && amount.length - dot > 2) return amount;
  if (amount.replace(".", "").length >= 7) return amount;
  return amount === "0" ? key : amount + key;
}

/** Keypad string → cents. "12.5" → 1250, "" → 0. */
export function keypadToCents(amount: string): number {
  if (!amount || amount === ".") return 0;
  const [whole, frac = ""] = amount.split(".");
  return Number(whole || "0") * 100 + Number((frac + "00").slice(0, 2));
}

/** "12.50" / "$1,200" / "" → cents, or null if unparseable. Used by budget inputs. */
export function dollarsToCents(input: string): number | null {
  const clean = input.replace(/[$,\s]/g, "");
  if (clean === "") return null;
  if (!/^\d+(\.\d{0,2})?$/.test(clean)) return null;
  return keypadToCents(clean);
}
