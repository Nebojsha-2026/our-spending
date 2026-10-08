"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CategoryIcon } from "@/components/CategoryIcon";
import { useHousehold } from "@/components/HouseholdProvider";
import { Card, ErrorNote, cx } from "@/components/ui";
import { formatCents } from "@/lib/money";
import { daysLeftInMonth, monthName, periodAt, sydneyDate } from "@/lib/periods";
import { createClient } from "@/lib/supabase/client";

export default function BudgetsPage() {
  const { categories } = useHousehold();
  const [today] = useState(() => sydneyDate());
  const month = periodAt("month", today);
  const [spent, setSpent] = useState<Map<string | null, number> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    createClient()
      .from("v_spend_by_period")
      .select("category_id,spent_cents")
      .eq("period", "month")
      .eq("period_start", month.start)
      .then(({ data, error }) => {
        if (error) return setError(error.message);
        const m = new Map<string | null, number>();
        for (const r of data as { category_id: string | null; spent_cents: number }[]) {
          m.set(r.category_id, (m.get(r.category_id) ?? 0) + Number(r.spent_cents));
        }
        setSpent(m);
      });
  }, [month.start]);

  const daysLeft = daysLeftInMonth(today);
  // Non-spending categories (transfers etc.) have no budget and no spending.
  const spending = categories.filter((c) => c.counts_as_spending);
  const budgeted = spending.filter((c) => c.monthly_budget_cents != null && c.monthly_budget_cents > 0);
  const unbudgeted = spending.filter((c) => !budgeted.includes(c));
  const totalBudget = budgeted.reduce((a, c) => a + Number(c.monthly_budget_cents), 0);
  const totalSpent = budgeted.reduce((a, c) => a + Math.max(0, spent?.get(c.id) ?? 0), 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto [&>*]:shrink-0 px-5 pt-[calc(28px+env(safe-area-inset-top))] pb-5">
      <div className="flex flex-col gap-[2px]">
        <div className="text-[13px] text-muted">Budgets</div>
        <div className="text-[20px] font-bold">{monthName(month.start)}</div>
      </div>

      {error && <ErrorNote>Couldn&apos;t load spending: {error}</ErrorNote>}

      {budgeted.length === 0 ? (
        <Card className="gap-3 p-5">
          <div className="text-[15px] font-semibold">No budgets yet</div>
          <div className="text-[14px] text-muted">
            Set a monthly amount for any category and you&apos;ll see how much is left and your daily pace here.
          </div>
          <Link href="/settings/categories" className="text-[14px] font-semibold">
            Set budgets in Settings
          </Link>
        </Card>
      ) : (
        <div className={cx("flex flex-col gap-4 transition-opacity", !spent && "opacity-0")}>
          <Card className="gap-[14px] p-5">
            <div className="flex items-baseline justify-between">
              <div className="text-[13px] text-muted">Left this month</div>
              <div className="text-[13px] text-muted">
                {daysLeft} {daysLeft === 1 ? "day" : "days"} to go
              </div>
            </div>
            <div className={cx("font-num text-[40px] leading-none font-semibold tracking-[-1px]", totalSpent > totalBudget && "text-up")}>
              {totalSpent > totalBudget ? "−" : ""}
              {formatCents(totalBudget - totalSpent)}
            </div>
            <Bar spent={totalSpent} budget={totalBudget} height={10} />
            <div className="text-[13px] text-muted">
              <span className="font-semibold text-ink">{formatCents(totalSpent)}</span> of {formatCents(totalBudget)} budgeted
            </div>
          </Card>

          <Card className="gap-4 px-5 py-[18px]">
            <div className="text-[15px] font-semibold">By category</div>
            {budgeted.map((c) => {
              const s = Math.max(0, spent?.get(c.id) ?? 0);
              const budget = Number(c.monthly_budget_cents);
              const left = budget - s;
              return (
                <div key={c.id} className="flex gap-3">
                  <CategoryIcon icon={c.icon} />
                  <div className="flex min-w-0 grow flex-col gap-[5px]">
                    <div className="flex justify-between gap-3 text-[13px]">
                      <span className="truncate">{c.name}</span>
                      <span className="font-num font-semibold whitespace-nowrap">
                        {formatCents(s)} <span className="font-sans font-normal text-muted">of {formatCents(budget)}</span>
                      </span>
                    </div>
                    <Bar spent={s} budget={budget} height={6} />
                    <div className={cx("text-[12px]", left < 0 ? "text-up" : "text-muted")}>
                      {left < 0
                        ? `${formatCents(-left)} over`
                        : `${formatCents(left)} left · ${formatCents(Math.floor(left / daysLeft))}/day`}
                    </div>
                  </div>
                </div>
              );
            })}
          </Card>

          {unbudgeted.length > 0 && (
            <Card className="gap-3 px-5 py-[18px]">
              <div className="text-[15px] font-semibold">No budget set</div>
              {unbudgeted.map((c) => (
                <div key={c.id} className="flex items-center gap-3 text-[13px]">
                  <CategoryIcon icon={c.icon} size={28} />
                  <span className="grow">{c.name}</span>
                  <span className="font-num font-semibold">{formatCents(Math.max(0, spent?.get(c.id) ?? 0))}</span>
                </div>
              ))}
              <Link href="/settings/categories" className="text-[13px] font-semibold">
                Edit budgets
              </Link>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function Bar({ spent, budget, height }: { spent: number; budget: number; height: number }) {
  const pct = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0;
  return (
    <div className="bg-divider" style={{ height, borderRadius: height / 2 }}>
      <div
        className={spent > budget ? "bg-up" : "bg-accent"}
        style={{ height, borderRadius: height / 2, width: `${pct.toFixed(1)}%` }}
      />
    </div>
  );
}
