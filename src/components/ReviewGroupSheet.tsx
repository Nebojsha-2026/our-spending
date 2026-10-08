"use client";

import { CategoryGlyph } from "./CategoryIcon";
import { useState } from "react";
import { formatCents, formatSigned } from "@/lib/money";
import { TZ } from "@/lib/periods";
import { unconfirmed, type Transaction } from "@/lib/types";
import { AlwaysPrompt, alwaysBody, useAlwaysChoice } from "./AlwaysPrompt";
import { useHousehold } from "./HouseholdProvider";
import { Chip, ErrorNote, List, ListRow, PrimaryButton, SectionLabel, Sheet } from "./ui";

const day = new Intl.DateTimeFormat("en-AU", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" });

/** Needs review, one merchant: its transactions, newest first. */
export interface ReviewGroup {
  key: string;
  merchant: string;
  rows: Transaction[];
  totalCents: number;
}

/** Group Needs review rows by cleaned merchant, biggest groups first. */
export function groupByMerchant(rows: Transaction[]): ReviewGroup[] {
  const map = new Map<string, ReviewGroup>();
  for (const r of rows) {
    const key = r.merchant.trim().toLowerCase();
    let g = map.get(key);
    if (!g) map.set(key, (g = { key, merchant: r.merchant, rows: [], totalCents: 0 }));
    g.rows.push(r);
    g.totalCents += Number(r.amount_cents);
  }
  return [...map.values()].sort(
    (a, b) => b.rows.length - a.rows.length || b.rows[0].occurred_at.localeCompare(a.rows[0].occurred_at) || a.key.localeCompare(b.key),
  );
}

/** Why a group is in Needs review, e.g. "12 need a category · 1 possible duplicate". */
export function groupReason(g: ReviewGroup) {
  const uncategorised = g.rows.filter((r) => !r.category_id).length;
  const dupes = g.rows.filter((r) => r.review_reason).length;
  const unconf = g.rows.filter((r) => r.category_id && !r.review_reason && unconfirmed(r)).length;
  const parts = [];
  if (uncategorised) parts.push(uncategorised === g.rows.length && g.rows.length === 1 ? "Needs category" : `${uncategorised} need a category`);
  if (dupes) parts.push(`${dupes} possible duplicate${dupes === 1 ? "" : "s"}`);
  if (unconf) parts.push(`${unconf} unconfirmed`);
  return parts.join(" · ");
}

/**
 * Set the category for a whole merchant group in one go, optionally as an
 * "Always" rule. Individual rows open the usual edit sheet.
 */
export function ReviewGroupSheet({
  group,
  mixed = false,
  onClose,
  onEditOne,
  onDone,
}: {
  group: ReviewGroup;
  /** Several merchants (a bulk selection): no "Always" rule, since there's no one name to remember. */
  mixed?: boolean;
  onClose: () => void;
  onEditOne: (t: Transaction) => void;
  /** `applied`: how many transactions got the category. */
  onDone: (applied: number) => void;
}) {
  const { categories, categoryById } = useHousehold();
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const always = useAlwaysChoice(group.rows[0].amount_cents, true);
  const category = categoryId ? categoryById.get(categoryId) : undefined;
  const n = group.rows.length;

  async function save() {
    if (!categoryId) return;
    const remember = alwaysBody(always, !mixed);
    if ("error" in remember) return setError(remember.error ?? null);
    setBusy(true);
    setError(null);
    const res = await fetch("/api/transactions/categorise", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: group.rows.map((r) => r.id), category_id: categoryId, ...remember }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(body.error ?? "Couldn't save");
    onDone(Number(body.applied ?? 0));
  }

  return (
    <Sheet title={group.merchant} open onClose={onClose}>
      <div className="flex flex-col items-center gap-[6px]">
        <div className="font-num text-[40px] leading-none font-semibold tracking-[-1px]">{formatCents(group.totalCents)}</div>
        <div className="text-center text-[13px] text-muted">
          {n} transaction{n === 1 ? "" : "s"} · {groupReason(group)}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="text-[13px] text-muted">Category for all {n}</div>
        <div className="flex flex-wrap gap-2">
          {categories.map((c) => (
            <Chip key={c.id} selected={c.id === categoryId} onClick={() => setCategoryId(c.id === categoryId ? null : c.id)}>
              <span className="flex items-center gap-[6px]">
                <CategoryGlyph icon={c.icon} size={15} />
                {c.name}
              </span>
            </Chip>
          ))}
        </div>
      </div>

      {category && !mixed && <AlwaysPrompt merchant={group.merchant} category={category.name} onceLabel={`Just these ${n}`} state={always} />}

      {error && <ErrorNote>{error}</ErrorNote>}
      <PrimaryButton onClick={save} disabled={busy || !categoryId}>
        {category ? `Put ${n === 1 ? "it" : `all ${n}`} in ${category.name}` : "Choose a category"}
      </PrimaryButton>

      <SectionLabel>Transactions</SectionLabel>
      <List>
        {group.rows.map((r) => {
          const c = r.category_id ? categoryById.get(r.category_id) : undefined;
          return (
            <ListRow
              key={r.id}
              title={day.format(new Date(r.occurred_at))}
              subtitle={r.review_reason ? "Possible duplicate" : c ? (unconfirmed(r) ? `Unconfirmed · ${c.name}` : c.name) : "Needs category"}
              right={<span className="font-num text-[15px] font-semibold whitespace-nowrap">{formatSigned(Number(r.amount_cents))}</span>}
              onClick={() => onEditOne(r)}
            />
          );
        })}
      </List>
    </Sheet>
  );
}
