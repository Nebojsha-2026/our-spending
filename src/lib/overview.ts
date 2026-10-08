import type { SupabaseClient } from "@supabase/supabase-js";
import { type Period, addDays, previous, sydneyDate, trendSlots } from "./periods";
import { TRANSACTION_COLUMNS, type Transaction } from "./types";

export interface SpendRow {
  period: "week" | "month" | "year";
  period_start: string;
  member_id: string;
  category_id: string | null;
  spent_cents: number;
}

export interface OverviewData {
  total: number;
  previousTotal: number;
  byMember: Map<string, number>;
  /** Highest first; category_id null = uncategorised. */
  byCategory: { categoryId: string | null; cents: number }[];
  trendTitle: string;
  trend: { label: string; cents: number }[];
  topMerchants: { merchant: string; spent_cents: number }[];
}

const sum = (rows: SpendRow[]) => rows.reduce((a, r) => a + Number(r.spent_cents), 0);

/** Everything the Overview needs for one period, from v_spend_by_period + top_merchants. */
export async function loadOverview(supabase: SupabaseClient, period: Period, today: string): Promise<OverviewData> {
  const prev = previous(period);
  const trend = trendSlots(period, today);
  const columns = "period,period_start,member_id,category_id,spent_cents";

  // Week/month: the 6 trend periods already include this one and the previous one.
  // Year: this year + last year as yearly rows, and this year's months for the trend.
  const periodRows =
    period.kind === "year"
      ? supabase.from("v_spend_by_period").select(columns).eq("period", "year").gte("period_start", prev.start).lte("period_start", period.start)
      : supabase.from("v_spend_by_period").select(columns).eq("period", period.kind).gte("period_start", trend.slots[0].start).lte("period_start", period.start);
  const trendRows =
    period.kind === "year"
      ? supabase.from("v_spend_by_period").select(columns).eq("period", "month").gte("period_start", period.start).lt("period_start", period.end)
      : null;
  const top = supabase.rpc("top_merchants", { p_from: period.start, p_to: period.end, p_limit: 5 });

  const [p, t, m] = await Promise.all([periodRows, trendRows, top]);
  for (const r of [p, t, m]) if (r?.error) throw new Error(r.error.message);

  const rows = (p.data ?? []) as SpendRow[];
  const current = rows.filter((r) => r.period_start === period.start);

  const byMember = new Map<string, number>();
  const byCat = new Map<string | null, number>();
  for (const r of current) {
    byMember.set(r.member_id, (byMember.get(r.member_id) ?? 0) + Number(r.spent_cents));
    byCat.set(r.category_id, (byCat.get(r.category_id) ?? 0) + Number(r.spent_cents));
  }

  const trendSource = (t?.data ?? rows) as SpendRow[];
  return {
    total: sum(current),
    previousTotal: sum(rows.filter((r) => r.period_start === prev.start)),
    byMember,
    byCategory: [...byCat.entries()]
      .filter(([, cents]) => cents > 0)
      .map(([categoryId, cents]) => ({ categoryId, cents }))
      .sort((a, b) => b.cents - a.cents),
    trendTitle: trend.title,
    trend: trend.slots.map((s) => ({
      label: s.label,
      cents: sum(trendSource.filter((r) => r.period_start === s.start)),
    })),
    topMerchants: (m.data ?? []) as OverviewData["topMerchants"],
  };
}

/** Count for the "Needs review" banner and chip. */
export async function loadNeedsReview(supabase: SupabaseClient) {
  const { data, error } = await supabase.from("v_needs_review").select("needs_category");
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as { needs_category: boolean }[];
  return { count: rows.length, uncategorised: rows.filter((r) => r.needs_category).length };
}

/** Whether an instant falls on a Sydney calendar day inside the period. */
export function inPeriod(occurredAt: string, period: Pick<Period, "start" | "end">): boolean {
  const d = sydneyDate(occurredAt);
  return d >= period.start && d < period.end;
}

export const CATEGORY_LIST_LIMIT = 500;

/**
 * Transactions in one category (null = uncategorised) during the period,
 * newest first: what's behind a "Where it went" bar.
 */
export async function loadCategoryTransactions(
  supabase: SupabaseClient,
  period: Period,
  categoryId: string | null,
): Promise<Transaction[]> {
  // Sydney days start 10–11 hours before UTC ones: fetch a day either side,
  // then keep exactly the period's Sydney days.
  let q = supabase
    .from("transactions")
    .select(TRANSACTION_COLUMNS)
    .gte("occurred_at", `${addDays(period.start, -1)}T00:00:00Z`)
    .lt("occurred_at", `${addDays(period.end, 1)}T00:00:00Z`)
    .order("occurred_at", { ascending: false })
    .order("id")
    .limit(CATEGORY_LIST_LIMIT + 100);
  q = categoryId ? q.eq("category_id", categoryId) : q.is("category_id", null);
  const { data, error } = await q.returns<Transaction[]>();
  if (error) throw new Error(error.message);
  return (data ?? []).filter((t) => inPeriod(t.occurred_at, period)).slice(0, CATEGORY_LIST_LIMIT);
}
