export type Source = "apple_pay" | "android" | "csv" | "manual" | "bank_feed";
export type Status = "captured" | "confirmed";

export interface Household {
  id: string;
  name: string;
}

export interface Member {
  id: string;
  household_id: string;
  user_id: string | null;
  email: string | null;
  display_name: string;
  colour: string;
}

export interface Account {
  id: string;
  household_id: string;
  member_id: string;
  /** ANZ, NAB, CBA, Westpac or another bank's name. */
  bank: string;
  nickname: string;
  last4: string | null;
  type: "debit" | "credit";
  is_default: boolean;
}

export interface Category {
  id: string;
  household_id: string;
  name: string;
  icon: string;
  colour: string;
  monthly_budget_cents: number | null;
  sort: number;
  /** False for transfers, paying employees, money passed on: left out of spending totals. */
  counts_as_spending: boolean;
}

export interface MerchantRule {
  id: string;
  household_id: string;
  match_pattern: string;
  clean_name: string;
  category_id: string | null;
  priority: number;
  /** Only for spends of at least this many cents (inclusive). */
  min_amount_cents: number | null;
  /** Only for spends under this many cents (exclusive). */
  max_amount_cents: number | null;
}

export interface Transaction {
  id: string;
  household_id: string;
  member_id: string;
  account_id: string | null;
  amount_cents: number;
  merchant_raw: string | null;
  merchant: string;
  category_id: string | null;
  occurred_at: string;
  source: Source;
  status: Status;
  external_ref: string | null;
  note: string | null;
  /** Set by CSV import when several phone captures could be this purchase. */
  review_reason: string | null;
}

export const TRANSACTION_COLUMNS =
  "id,household_id,member_id,account_id,amount_cents,merchant_raw,merchant,category_id,occurred_at,source,status,external_ref,note,review_reason";

// Labels match the design ("Apple Pay", "Android", "Bank CSV").
export const SOURCE_LABEL: Record<Source, string> = {
  apple_pay: "Apple Pay",
  android: "Android",
  csv: "Bank CSV",
  manual: "Manual",
  bank_feed: "Bank feed",
};

/** Phone capture the bank hasn't confirmed within 7 days. */
export function unconfirmed(t: Pick<Transaction, "status" | "occurred_at">, now = Date.now()) {
  return t.status === "captured" && Date.parse(t.occurred_at) < now - 7 * 86_400_000;
}

/** Same rule as the v_needs_review view: no category, unconfirmed after 7 days, or a possible duplicate. */
export function needsReview(t: Pick<Transaction, "category_id" | "status" | "occurred_at" | "review_reason">, now = Date.now()) {
  return !t.category_id || unconfirmed(t, now) || t.review_reason !== null;
}

export interface DeviceToken {
  id: string;
  member_id: string;
  label: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}
