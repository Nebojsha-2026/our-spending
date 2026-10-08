"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { EditTransactionSheet } from "@/components/EditTransactionSheet";
import { useHousehold } from "@/components/HouseholdProvider";
import { NeedsReview } from "@/components/NeedsReview";
import { type ReviewGroup, ReviewGroupSheet } from "@/components/ReviewGroupSheet";
import { Chip, ErrorNote, PersonDot, SecondaryButton, cx, inputClass } from "@/components/ui";
import { formatSigned } from "@/lib/money";
import { loadNeedsReview } from "@/lib/overview";
import { dayLabel, sydneyDate } from "@/lib/periods";
import { createClient } from "@/lib/supabase/client";
import { SOURCE_LABEL, TRANSACTION_COLUMNS, needsReview, unconfirmed, type Transaction } from "@/lib/types";

const PAGE = 100;
// Needs review loads in one go so every merchant group is complete.
const REVIEW_PAGE = 1000;

export default function ActivityPage() {
  return (
    <Suspense>
      <Activity />
    </Suspense>
  );
}

function Activity() {
  const params = useSearchParams();
  const { members, memberById, categoryById, labelFor } = useHousehold();
  const [filter, setFilter] = useState(params.get("filter") ?? "all"); // all | review | <member id>
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [rows, setRows] = useState<Transaction[]>([]);
  const [hasMore, setHasMore] = useState(false);
  // Which filter+search the rows belong to; while it lags behind, we're loading.
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reloads, setReloads] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [reviewCount, setReviewCount] = useState<number | null>(null);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [group, setGroup] = useState<{ group: ReviewGroup; mixed: boolean } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [today] = useState(() => sydneyDate());

  useEffect(() => {
    const t = setTimeout(() => setTerm(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  const refreshReview = useCallback(() => {
    loadNeedsReview(createClient()).then((r) => setReviewCount(r.count), () => setReviewCount(null));
  }, []);
  useEffect(refreshReview, [refreshReview]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  const reviewing = filter === "review";
  const pageSize = reviewing ? REVIEW_PAGE : PAGE;

  const fetchPage = useCallback(
    async (from: number) => {
      const supabase = createClient();
      let q = supabase
        .from(filter === "review" ? "v_needs_review" : "transactions")
        .select(TRANSACTION_COLUMNS)
        .order("occurred_at", { ascending: false })
        .order("id")
        .range(from, from + pageSize - 1);
      if (filter !== "all" && filter !== "review") q = q.eq("member_id", filter);
      // Strip characters that have meaning in PostgREST filter syntax.
      const safe = term.replace(/[,()*%\\"]/g, " ").trim();
      if (safe) q = q.or(`merchant.ilike.*${safe}*,merchant_raw.ilike.*${safe}*,note.ilike.*${safe}*`);
      const { data, error } = await q.returns<Transaction[]>();
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    [filter, term, pageSize],
  );

  const queryKey = `${filter}|${term}|${reloads}`;
  const loading = loadedKey !== queryKey || loadingMore;

  useEffect(() => {
    let live = true;
    fetchPage(0)
      .then((data) => {
        if (!live) return;
        setRows(data);
        setHasMore(data.length === pageSize);
        setError(null);
      })
      .catch((e: Error) => live && setError(e.message))
      .finally(() => live && setLoadedKey(queryKey));
    return () => {
      live = false;
    };
  }, [fetchPage, queryKey, pageSize]);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const data = await fetchPage(rows.length);
      setRows((r) => [...r, ...data]);
      setHasMore(data.length === pageSize);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }

  const days = useMemo(() => {
    const groups: { day: string; rows: Transaction[] }[] = [];
    for (const r of rows) {
      const day = sydneyDate(r.occurred_at);
      if (groups.at(-1)?.day !== day) groups.push({ day, rows: [] });
      groups.at(-1)!.rows.push(r);
    }
    return groups;
  }, [rows]);

  /** After an "Always" rule or a group update: say how many, and reload the list. */
  function applied(n: number) {
    if (n > 0) setNotice(`Applied to ${n} transaction${n === 1 ? "" : "s"}`);
    setReloads((x) => x + 1);
    refreshReview();
  }

  const chips = [
    { value: "all", label: "All" },
    ...members.map((m) => ({ value: m.id, label: labelFor(m.id) })),
    { value: "review", label: reviewCount ? `Needs review · ${reviewCount}` : "Needs review" },
  ];

  return (
    <>
      <div className="flex flex-col gap-[14px] px-5 pt-[calc(28px+env(safe-area-inset-top))] pb-3">
        <div className="text-[20px] font-bold">Activity</div>
        <div className="flex flex-col gap-1">
          <label htmlFor="txsearch" className="text-[12px] text-muted">
            Search merchants or notes
          </label>
          <input
            id="txsearch"
            type="search"
            placeholder="e.g. Woolworths"
            className={inputClass}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {chips.map((c) => (
            <Chip key={c.value} tone="dark" size="sm" selected={filter === c.value} onClick={() => setFilter(c.value)}>
              {c.label}
            </Chip>
          ))}
        </div>
      </div>

      <div className={cx("flex min-h-0 flex-1 flex-col gap-[18px] overflow-y-auto [&>*]:shrink-0 px-5 pb-5 transition-opacity", loading && "opacity-60")}>
        {notice && (
          <div role="status" className="rounded-[14px] bg-surface px-[14px] py-3 text-[14px] font-semibold text-accent">
            {notice}
          </div>
        )}
        {error && <ErrorNote>Couldn&apos;t load transactions: {error}</ErrorNote>}
        {!loading && !error && rows.length === 0 && (
          <div className="py-10 text-center text-[14px] text-muted">
            {term ? "Nothing matches that search." : filter === "review" ? "All caught up — nothing to review." : "No transactions yet. Tap + to add one."}
          </div>
        )}

        {reviewing && rows.length > 0 && (
          <NeedsReview
            rows={rows}
            onOpenGroup={(g, mixed) => setGroup({ group: g, mixed })}
            onEditOne={setEditing}
            onChanged={(message) => {
              setNotice(message);
              setReloads((x) => x + 1);
              refreshReview();
            }}
          />
        )}

        {!reviewing && days.map(({ day, rows: dayRows }) => {
          // Day total is spending only: transfers and other non-spending categories are left out.
          const total = dayRows.reduce(
            (a, r) => (r.category_id && categoryById.get(r.category_id)?.counts_as_spending === false ? a : a + Number(r.amount_cents)),
            0,
          );
          return (
            <div key={day} className="flex flex-col gap-2">
              <div className="flex justify-between text-[13px] text-muted">
                <span className="font-semibold">{dayLabel(day, today)}</span>
                <span>{formatSigned(total)}</span>
              </div>
              <div className="flex flex-col overflow-hidden rounded-[16px] bg-surface">
                {dayRows.map((r, i) => {
                  const category = r.category_id ? categoryById.get(r.category_id) : undefined;
                  const member = memberById.get(r.member_id);
                  const who = labelFor(r.member_id);
                  const notSpending = category?.counts_as_spending === false;
                  // What needs attention, if anything (the design tints uncategorised rows).
                  const flag = !category
                    ? "Needs category"
                    : r.review_reason
                      ? `Possible duplicate · ${category.name}`
                      : unconfirmed(r)
                        ? `Unconfirmed · ${category.name}`
                        : null;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setEditing(r)}
                      className={cx(
                        "box-border flex min-h-[60px] w-full cursor-pointer items-center gap-3 px-[14px] py-3 text-ink",
                        !category || r.review_reason ? "bg-warn-row" : "bg-transparent",
                        i > 0 && "border-t border-divider",
                      )}
                    >
                      <PersonDot label={who} color={member?.colour ?? "#5B6167"} />
                      <span className="flex min-w-0 grow flex-col gap-[2px] text-left">
                        <span className="truncate text-[15px] font-semibold">{r.merchant}</span>
                        <span className={cx("truncate text-[12px]", flag ? "text-warn-text" : "text-muted")}>
                          {flag ?? (notSpending ? `${category!.name} · Not spending` : category!.name)} · {who} · {SOURCE_LABEL[r.source]}
                        </span>
                      </span>
                      <span
                        className={cx(
                          "font-num text-[15px] font-semibold whitespace-nowrap",
                          notSpending ? "text-muted" : r.amount_cents > 0 && "text-accent",
                        )}
                      >
                        {formatSigned(Number(r.amount_cents))}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}

        {hasMore && (
          <SecondaryButton onClick={loadMore} disabled={loading}>
            Show more
          </SecondaryButton>
        )}
      </div>

      {editing && (
        <EditTransactionSheet
          txn={editing}
          onClose={() => setEditing(null)}
          onSaved={(t, appliedTo) => {
            if (appliedTo > 0 || group) applied(appliedTo);
            if (group) setGroup(null);
            setRows((rs) =>
              filter === "review" && !needsReview(t)
                ? rs.filter((r) => r.id !== t.id)
                : rs.map((r) => (r.id === t.id ? t : r)),
            );
            setEditing(null);
            refreshReview();
          }}
          onDeleted={(id) => {
            setRows((rs) => rs.filter((r) => r.id !== id));
            setEditing(null);
            setGroup(null);
            refreshReview();
          }}
        />
      )}

      {group && !editing && (
        <ReviewGroupSheet
          group={group.group}
          mixed={group.mixed}
          onClose={() => setGroup(null)}
          onEditOne={setEditing}
          onDone={(n) => {
            setGroup(null);
            applied(n);
          }}
        />
      )}
    </>
  );
}
