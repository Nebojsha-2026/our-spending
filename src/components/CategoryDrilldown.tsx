"use client";

import { useEffect, useState } from "react";
import { formatSigned } from "@/lib/money";
import { CATEGORY_LIST_LIMIT, loadCategoryTransactions } from "@/lib/overview";
import { type Period, TZ } from "@/lib/periods";
import { createClient } from "@/lib/supabase/client";
import type { Transaction } from "@/lib/types";
import { useHousehold } from "./HouseholdProvider";
import { cx } from "./ui";

const day = new Intl.DateTimeFormat("en-AU", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" });

/**
 * The transactions behind one "Where it went" bar, shown under it on the
 * Overview. Tapping one opens the usual edit sheet (via onEdit).
 */
export function CategoryDrilldown({
  period,
  categoryId,
  reloadKey,
  onEdit,
}: {
  period: Period;
  /** null = uncategorised */
  categoryId: string | null;
  /** Changes after an edit, to reload the list. */
  reloadKey: number;
  onEdit: (t: Transaction) => void;
}) {
  const { memberById, labelFor } = useHousehold();
  const [result, setResult] = useState<{ key: string; rows: Transaction[] | null; error: string | null } | null>(null);
  const key = `${period.start}|${period.end}|${categoryId}|${reloadKey}`;

  useEffect(() => {
    let live = true;
    loadCategoryTransactions(createClient(), period, categoryId).then(
      (rows) => live && setResult({ key, rows, error: null }),
      (e: Error) => live && setResult({ key, rows: null, error: e.message }),
    );
    return () => {
      live = false;
    };
  }, [key, period, categoryId]);

  const rows = result?.rows;
  if (result?.error) return <div className="text-[13px] text-up">Couldn&apos;t load transactions: {result.error}</div>;
  if (!rows) return <div className="py-2 text-[13px] text-muted">Loading…</div>;
  if (rows.length === 0) return <div className="py-2 text-[13px] text-muted">No transactions.</div>;

  return (
    <div className={cx("animate-rise", result.key !== key && "opacity-60")}>
      <div className="flex flex-col overflow-hidden rounded-[12px] border border-divider">
        {rows.map((r, i) => {
          const member = memberById.get(r.member_id);
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => onEdit(r)}
              className={`flex min-h-[52px] w-full cursor-pointer items-center gap-3 bg-transparent px-3 py-2 text-left text-ink ${i > 0 ? "border-t border-divider" : ""}`}
            >
              <span className="size-2 shrink-0 rounded-full" style={{ background: member?.colour ?? "#5B6167" }} aria-hidden />
              <span className="flex min-w-0 grow flex-col gap-[1px]">
                <span className="truncate text-[14px] font-semibold">{r.merchant}</span>
                <span className="truncate text-[12px] text-muted">
                  {day.format(new Date(r.occurred_at))} · {labelFor(r.member_id)}
                  {r.note ? ` · ${r.note}` : ""}
                </span>
              </span>
              <span className={`font-num text-[14px] font-semibold whitespace-nowrap ${r.amount_cents > 0 ? "text-accent" : ""}`}>
                {formatSigned(Number(r.amount_cents))}
              </span>
            </button>
          );
        })}
      </div>
      <div className="pt-2 text-[12px] text-muted">
        {rows.length === CATEGORY_LIST_LIMIT
          ? `Showing the latest ${CATEGORY_LIST_LIMIT}.`
          : `${rows.length} transaction${rows.length === 1 ? "" : "s"}. Tap one to edit it.`}
      </div>
    </div>
  );
}
