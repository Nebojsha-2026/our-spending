// Amount ranges on merchant rules. Amounts are the size of the spend in cents:
// min is inclusive, max exclusive ("under $10" = max 1000, "$50 or more" = min 5000).
import { formatCents } from "./money";

export type AmountScope = "any" | "under" | "over";

export interface AmountRange {
  min_amount_cents: number | null;
  max_amount_cents: number | null;
}

const dollars = (cents: number) => formatCents(cents).replace(/\.00$/, "");

/** "under $10", "$50 or more", "$10 to $50", or null for any amount. */
export function rangeLabel(r: AmountRange): string | null {
  const { min_amount_cents: min, max_amount_cents: max } = r;
  if (min != null && max != null) return `${dollars(min)} to under ${dollars(max)}`;
  if (max != null) return `under ${dollars(max)}`;
  if (min != null) return `${dollars(min)} or more`;
  return null;
}

/** Whether a spend of `cents` (either sign) falls inside the range. */
export function inRange(r: AmountRange, cents: number) {
  const a = Math.abs(cents);
  return (r.min_amount_cents == null || a >= r.min_amount_cents) && (r.max_amount_cents == null || a < r.max_amount_cents);
}

/**
 * A round default for "Only for amounts under/over $X" that includes the
 * purchase being categorised: $4.50 → under $5, $62.00 → $60 or more.
 */
export function suggestedThreshold(cents: number, scope: Exclude<AmountScope, "any">): number {
  const a = Math.abs(cents);
  const step = a < 2000 ? 500 : a < 10000 ? 1000 : 5000;
  if (scope === "under") return (Math.floor(a / step) + 1) * step;
  return Math.max(step, Math.floor(a / step) * step);
}

/** Scope + dollar text from the "Always" prompt → a range, or an error message. */
export function rangeFor(scope: AmountScope, dollarsText: string): AmountRange | { error: string } {
  if (scope === "any") return { min_amount_cents: null, max_amount_cents: null };
  const n = Number(dollarsText.replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n) || n <= 0 || n > 1_000_000) return { error: "Enter an amount in dollars" };
  const cents = Math.round(n * 100);
  return scope === "under" ? { min_amount_cents: null, max_amount_cents: cents } : { min_amount_cents: cents, max_amount_cents: null };
}

/** Validates min/max from a request body. */
export function parseRange(body: Record<string, unknown>): AmountRange | { error: string } {
  const read = (v: unknown) => (v == null ? null : Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 100_000_000 ? (v as number) : NaN);
  const min = read(body.min_amount_cents);
  const max = read(body.max_amount_cents);
  if (Number.isNaN(min) || Number.isNaN(max)) return { error: "Amounts must be whole cents" };
  if (max === 0) return { error: "The upper amount must be more than $0" };
  if (min != null && max != null && min >= max) return { error: "The lower amount must be less than the upper amount" };
  return { min_amount_cents: min, max_amount_cents: max };
}
