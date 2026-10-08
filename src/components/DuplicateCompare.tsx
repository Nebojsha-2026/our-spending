"use client";

import { useEffect, useState } from "react";
import { formatSigned } from "@/lib/money";
import { TZ } from "@/lib/periods";
import { createClient } from "@/lib/supabase/client";
import { SOURCE_LABEL, type Transaction } from "@/lib/types";
import { useHousehold } from "./HouseholdProvider";
import { ChevronLeft, ChevronRight } from "./icons";
import { PrimaryButton, cx } from "./ui";

const when = new Intl.DateTimeFormat("en-AU", {
  timeZone: TZ,
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});
const day = new Intl.DateTimeFormat("en-AU", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" });

/**
 * A flagged bank row next to the earlier entry it could be a copy of, field by
 * field, with differences highlighted. Several candidates: step through them.
 * "Merge with this one" merges into the entry on show.
 */
export function DuplicateCompare({
  txn,
  busy,
  onMerge,
}: {
  txn: Transaction;
  busy: boolean;
  onMerge: (intoId: string) => void;
}) {
  const { accountById, categoryById, labelFor } = useHousehold();
  const [cands, setCands] = useState<Transaction[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [i, setI] = useState(0);

  useEffect(() => {
    createClient()
      .rpc("duplicate_candidates", { p_id: txn.id })
      .then(({ data, error }) => (error ? setError(error.message) : setCands((data ?? []) as Transaction[])));
  }, [txn.id]);

  if (error) return <div className="text-[13px]">Couldn&apos;t load the earlier entries: {error}</div>;
  if (!cands) return <div className="text-[13px] opacity-70">Finding the earlier entry…</div>;
  if (cands.length === 0) {
    return <div className="text-[13px]">Nothing left to merge it with (the earlier entry was merged or deleted). Keep it.</div>;
  }

  const other = cands[Math.min(i, cands.length - 1)];
  const card = (t: Transaction) => {
    const a = t.account_id ? accountById.get(t.account_id) : undefined;
    return a ? `${a.nickname}${a.last4 ? ` ••${a.last4}` : ""}` : "—";
  };
  // The bank only knows the day, so its time (noon) isn't worth comparing.
  const fields: { label: string; bank: string; earlier: string; same?: boolean }[] = [
    { label: "Amount", bank: formatSigned(Number(txn.amount_cents)), earlier: formatSigned(Number(other.amount_cents)) },
    {
      label: "When",
      bank: day.format(new Date(txn.occurred_at)),
      earlier: when.format(new Date(other.occurred_at)),
      same: day.format(new Date(txn.occurred_at)) === day.format(new Date(other.occurred_at)),
    },
    { label: "Name", bank: txn.merchant, earlier: other.merchant },
    { label: "Description", bank: txn.merchant_raw ?? "—", earlier: other.merchant_raw ?? "—" },
    { label: "Who", bank: labelFor(txn.member_id), earlier: labelFor(other.member_id) },
    { label: "Card", bank: card(txn), earlier: card(other) },
    {
      label: "Category",
      bank: txn.category_id ? (categoryById.get(txn.category_id)?.name ?? "—") : "—",
      earlier: other.category_id ? (categoryById.get(other.category_id)?.name ?? "—") : "—",
    },
    ...(other.note ? [{ label: "Note", bank: txn.note ?? "—", earlier: other.note }] : []),
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[13px] font-semibold">
          {cands.length === 1 ? "Compare with the earlier entry" : `Earlier entry ${i + 1} of ${cands.length}`}
        </div>
        {cands.length > 1 && (
          <div className="flex gap-2">
            <StepButton label="Previous" disabled={i === 0} onClick={() => setI(i - 1)}>
              <ChevronLeft />
            </StepButton>
            <StepButton label="Next" disabled={i >= cands.length - 1} onClick={() => setI(i + 1)}>
              <ChevronRight />
            </StepButton>
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-[12px] bg-surface text-ink">
        <div className="grid grid-cols-[72px_1fr_1fr] gap-2 px-3 py-2 text-[12px] font-semibold text-muted">
          <span />
          <span>Bank CSV</span>
          <span>{SOURCE_LABEL[other.source]}</span>
        </div>
        {fields.map((f) => {
          const same = f.same ?? f.bank.trim().toLowerCase() === f.earlier.trim().toLowerCase();
          return (
            <div key={f.label} className="grid grid-cols-[72px_1fr_1fr] gap-2 border-t border-divider px-3 py-2 text-[13px]">
              <span className="text-[12px] text-muted">{f.label}</span>
              <span className="min-w-0 break-words">{f.bank}</span>
              <span className={cx("min-w-0 break-words", !same && "font-semibold text-warn-text")}>{f.earlier}</span>
            </div>
          );
        })}
      </div>
      <div className="text-[12px]">
        Highlighted = different. The bank&apos;s name and description often differ from what you typed; the amount, day and card
        are what matter.
      </div>

      <PrimaryButton onClick={() => onMerge(other.id)} disabled={busy}>
        {cands.length === 1 ? "Same purchase — merge" : "Same purchase — merge with this one"}
      </PrimaryButton>
    </div>
  );
}

function StepButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-9 cursor-pointer items-center justify-center rounded-full border border-line bg-surface text-ink disabled:opacity-40"
    >
      {children}
    </button>
  );
}
