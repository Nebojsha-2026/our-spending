"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CategoryDrilldown } from "@/components/CategoryDrilldown";
import { CategoryIcon } from "@/components/CategoryIcon";
import { EditTransactionSheet } from "@/components/EditTransactionSheet";
import { SupportCard } from "@/components/SupportCard";
import { Tour } from "@/components/Tour";
import { useHousehold } from "@/components/HouseholdProvider";
import { AlertIcon, ChevronLeft, ChevronRight } from "@/components/icons";
import { Card, CircleButton, ErrorNote, Segmented, PersonDot, cx } from "@/components/ui";
import { deltaLabel, formatCents, formatSigned } from "@/lib/money";
import { loadNeedsReview, loadOverview, type OverviewData } from "@/lib/overview";
import { periodAt, periodLabel, previousLabel, sydneyDate, type PeriodKind } from "@/lib/periods";
import { createClient } from "@/lib/supabase/client";
import { TRANSACTION_COLUMNS, type Transaction } from "@/lib/types";

const KINDS: { value: PeriodKind; label: string }[] = [
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "year", label: "Year" },
];

export default function OverviewPage() {
  const { members, categoryById, labelFor } = useHousehold();
  const [kind, setKind] = useState<PeriodKind>("month");
  const [offset, setOffset] = useState(0);
  const [today] = useState(() => sydneyDate());
  const period = useMemo(() => periodAt(kind, today, offset), [kind, today, offset]);
  // The "Where it went" bar that's open ("none" = uncategorised), and the
  // transaction being edited from it. Edits bump `reloads` to refresh everything.
  const [openCategory, setOpenCategory] = useState<string | null>(null);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [reloads, setReloads] = useState(0);
  const [allCategories, setAllCategories] = useState(false);
  const [recent, setRecent] = useState<Transaction[]>([]);
  const [recentError, setRecentError] = useState(false);
  useEffect(() => {
    let live = true;
    createClient().from("transactions").select(TRANSACTION_COLUMNS).order("occurred_at", { ascending: false }).limit(3).returns<Transaction[]>()
      .then(({ data, error }) => { if (live) { setRecent(data ?? []); setRecentError(Boolean(error)); } });
    return () => { live = false; };
  }, [reloads]);

  const [cache, setCache] = useState<Record<string, OverviewData>>({});
  const key = `${kind}:${period.start}:${reloads}`;
  // The latest result, tagged with the period it belongs to. Until it matches the
  // selected period we show the previous numbers dimmed (or a cached copy).
  const [result, setResult] = useState<{ key: string; data: OverviewData | null; error: string | null } | null>(null);
  const [review, setReview] = useState<{ count: number; uncategorised: number } | null>(null);
  const loading = result?.key !== key;
  const data = loading ? (cache[key] ?? result?.data ?? null) : result.data;
  const error = loading ? null : result.error;

  useEffect(() => {
    let live = true;
    loadOverview(createClient(), period, today)
      .then((d) => {
        setCache((c) => ({ ...c, [key]: d }));
        if (live) setResult({ key, data: d, error: null });
      })
      .catch((e: Error) => live && setResult((r) => ({ key, data: r?.data ?? null, error: e.message })));
    return () => {
      live = false;
    };
  }, [key, period, today]);

  useEffect(() => {
    loadNeedsReview(createClient()).then(setReview, () => setReview(null));
  }, [reloads]);

  function step(n: number) {
    setOffset((o) => o + n);
    setOpenCategory(null);
  }

  function changed() {
    setEditing(null);
    setReloads((n) => n + 1);
  }

  const total = data?.total ?? 0;
  const delta = data ? deltaLabel(data.total, data.previousTotal, previousLabel(period, today)) : null;
  const maxCat = Math.max(1, ...(data?.byCategory.map((c) => c.cents) ?? []));
  const maxTrend = Math.max(1, ...(data?.trend.map((t) => t.cents) ?? []));
  const spendingMembers = members.map((m) => ({ m, cents: Math.max(0, data?.byMember.get(m.id) ?? 0) }));
  const splitTotal = spendingMembers.reduce((a, x) => a + x.cents, 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto [&>*]:shrink-0 px-5 pt-[calc(28px+env(safe-area-inset-top))] pb-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-[23px] font-bold tracking-[-0.8px] text-accent-link">Our spending</h1>
        <Link href="/settings/household" aria-label="Your household" className="flex -space-x-1">
          {members.slice(0, 4).map((m) => <PersonDot key={m.id} label={labelFor(m.id)} color={m.colour} />)}
          {members.length > 4 && <span className="flex size-8 items-center justify-center rounded-full bg-segment text-xs">+{members.length - 4}</span>}
        </Link>
      </div>
      <div className="flex items-center justify-between">
        <CircleButton label="Previous period" onClick={() => step(-1)}><ChevronLeft /></CircleButton>
        <h2 className="text-[18px] font-semibold">{periodLabel(period, today)}</h2>
        <CircleButton label="Next period" onClick={() => step(1)} disabled={offset >= 0}><ChevronRight /></CircleButton>
      </div>

      <Segmented
        label="Period"
        options={KINDS}
        value={kind}
        onChange={(k) => {
          setKind(k);
          setOffset(0);
          setOpenCategory(null);
        }}
      />

      {error && <ErrorNote>Couldn&apos;t load spending: {error}</ErrorNote>}

      <div className={cx("flex flex-col gap-4 transition-opacity", loading && !data && "opacity-0", loading && data && "opacity-60")}>
        <Card className="spend-summary animate-rise gap-[14px] p-5">
          <div className="flex items-baseline justify-between">
            <div className="text-[13px] text-muted">Spent this {kind}</div>
            {delta && (
              <div className={cx("text-[13px] font-semibold", delta.up ? "text-up" : "text-accent")}>{delta.text}</div>
            )}
          </div>
          <div className="font-num text-[44px] leading-none font-semibold tracking-[-1px]">
            {total < 0 ? "+" : ""}
            {formatCents(total)}
          </div>
          <div className="text-[12px] text-muted">Household total · AUD</div>
          <div className="flex h-[8px] gap-[2px] overflow-hidden rounded-[5px] bg-divider">
            {splitTotal > 0 &&
              spendingMembers
                .filter((x) => x.cents > 0)
                .map(({ m, cents }) => (
                  <div key={m.id} style={{ background: m.colour, width: `${((cents / splitTotal) * 100).toFixed(1)}%` }} />
                ))}
          </div>
          <div className={cx("flex flex-wrap gap-x-4 gap-y-1 text-[13px]", spendingMembers.length <= 2 && "justify-between")}>
            {spendingMembers.map(({ m, cents }) => (
              <div key={m.id} className="flex items-center gap-[6px]">
                <span className="inline-block size-2 rounded-full" style={{ background: m.colour }} />
                <span className="text-muted">{labelFor(m.id)}</span>
                <span className="font-semibold">{formatCents(cents)}</span>
              </div>
            ))}
          </div>
        </Card>

        {review && review.count > 0 && (
          <Link
            href="/activity?filter=review"
            className="flex items-center gap-[10px] rounded-[14px] bg-warn-bg px-[14px] py-3 text-warn-ink hover:text-warn-ink"
          >
            <AlertIcon className="shrink-0 text-warn-text" />
            <span className="grow text-[14px]">
              {review.count} {review.count === 1 ? "transaction needs" : "transactions need"}{" "}
              {review.uncategorised === review.count ? "a category" : "review"}
            </span>
            <span className="text-[14px] font-semibold">Review</span>
          </Link>
        )}

        <Card className="gap-3 px-4 py-4">
          <div className="flex items-baseline justify-between gap-2">
            <div className="text-[15px] font-semibold">Where it went</div>
            {data && data.byCategory.length > 3 && <button type="button" className="min-h-11 cursor-pointer text-[12px] font-semibold text-accent-link" aria-expanded={allCategories} onClick={() => setAllCategories(!allCategories)}>{allCategories ? "Show less" : "View all"}</button>}
          </div>
          {data && data.byCategory.length === 0 && (
            <div className="text-[13px] text-muted">Nothing spent in this period yet.</div>
          )}
          {(allCategories ? data?.byCategory : data?.byCategory.slice(0, 3))?.map((c) => {
            const id = c.categoryId ?? "none";
            const open = openCategory === id;
            const cat = c.categoryId ? categoryById.get(c.categoryId) : undefined;
            return (
              <div key={id} className="flex flex-col gap-2">
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setOpenCategory(open ? null : id)}
                  className="-mx-2 flex min-h-[48px] cursor-pointer items-center gap-3 rounded-[10px] border-none bg-transparent px-2 py-1 text-left text-ink"
                >
                  <CategoryIcon icon={cat?.icon} muted={!cat} />
                  <span className="flex min-w-0 grow flex-col gap-[5px]">
                    <span className="flex w-full items-center justify-between gap-2 text-[13px]">
                      <span className={cx("truncate", open && "font-semibold")}>
                        {c.categoryId ? (cat?.name ?? "Deleted category") : "Uncategorised"}
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="font-num font-semibold">{formatCents(c.cents)}</span>
                        <ChevronRight size={14} className={cx("text-muted transition-transform", open && "rotate-90")} />
                      </span>
                    </span>
                    <span className="block h-[6px] w-full rounded-[3px] bg-divider">
                      <span className="category-bar block h-[6px] rounded-[3px] bg-accent" style={{ width: `${((c.cents / maxCat) * 100).toFixed(1)}%` }} />
                    </span>
                  </span>
                </button>
                {open && (
                  <CategoryDrilldown period={period} categoryId={c.categoryId} reloadKey={reloads} onEdit={setEditing} />
                )}
              </div>
            );
          })}
        </Card>

        <Card className="gap-1 px-4 py-3">
          <div className="flex items-center justify-between"><h2 className="text-[15px] font-semibold">Recent activity</h2><Link href="/activity" className="flex min-h-11 items-center text-[12px] font-semibold">View all</Link></div>
          {recentError && <p className="text-[13px] text-muted">Couldn&apos;t load recent activity. <Link href="/activity">Try Activity</Link></p>}
          {!recentError && recent.length === 0 && <p className="py-2 text-[13px] text-muted">Your latest purchases will appear here.</p>}
          {recent.map((txn) => <button type="button" key={txn.id} onClick={() => setEditing(txn)} className="flex min-h-[64px] cursor-pointer items-center gap-3 border-t border-divider text-left">
            <CategoryIcon icon={txn.category_id ? categoryById.get(txn.category_id)?.icon : undefined} />
            <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-semibold">{txn.merchant}</span><span className="text-[11px] text-muted">{labelFor(txn.member_id)} · {txn.category_id ? categoryById.get(txn.category_id)?.name : "Needs category"}</span></span>
            <span className="font-num text-[13px] font-semibold">{formatSigned(Number(txn.amount_cents))}</span>
          </button>)}
        </Card>

        <Card className="gap-3 px-4 py-4">
          <div className="text-[15px] font-semibold">{data?.trendTitle ?? " "}</div>
          <div className="flex h-24 items-end gap-[6px]">
            {data?.trend.map((t, i) => (
              <div key={i} className="flex flex-1 basis-0 flex-col items-center gap-[6px]">
                <div
                  title={formatCents(t.cents)}
                  className="w-full max-w-7 rounded-[6px_6px_2px_2px]"
                  style={{
                    height: Math.max(2, Math.round((Math.max(0, t.cents) / maxTrend) * 72)),
                    background: i === data.trend.length - 1 ? "var(--color-accent)" : "var(--color-accent-soft)",
                  }}
                />
                <div className="text-[11px] text-muted">{t.label}</div>
              </div>
            ))}
          </div>
        </Card>

        {data && data.topMerchants.length > 0 && (
          <Card className="gap-3 px-4 py-4">
            <div className="text-[15px] font-semibold">Top merchants</div>
            {data.topMerchants.map((m) => (
              <div key={m.merchant} className="flex justify-between gap-3 text-[13px]">
                <span className="truncate">{m.merchant}</span>
                <span className="font-num font-semibold">{formatCents(Number(m.spent_cents))}</span>
              </div>
            ))}
          </Card>
        )}
      </div>

      <SupportCard />
      <Tour />

      {editing && (
        <EditTransactionSheet txn={editing} onClose={() => setEditing(null)} onSaved={changed} onDeleted={changed} />
      )}
    </div>
  );
}
