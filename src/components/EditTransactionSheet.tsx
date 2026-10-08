"use client";

import { CategoryGlyph } from "./CategoryIcon";
import { useState } from "react";
import { formatSigned } from "@/lib/money";
import { TZ } from "@/lib/periods";
import { SOURCE_LABEL, unconfirmed, type Transaction } from "@/lib/types";
import { AlwaysPrompt, alwaysBody, useAlwaysChoice } from "./AlwaysPrompt";
import { CaptureText } from "./CaptureText";
import { DuplicateCompare } from "./DuplicateCompare";
import { useHousehold } from "./HouseholdProvider";
import { Chip, ErrorNote, Field, PrimaryButton, SecondaryButton, Sheet, inputClass } from "./ui";

const when = new Intl.DateTimeFormat("en-AU", {
  timeZone: TZ,
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/**
 * Tap a transaction → edit category, merchant or note. Changing the category
 * offers "Always put X in Y?", which saves a merchant rule for the cleaned
 * merchant name (optionally only for some amounts) and applies it to every
 * existing match (SPEC: learning categories).
 */
export function EditTransactionSheet({
  txn,
  onClose,
  onSaved,
  onDeleted,
}: {
  txn: Transaction;
  onClose: () => void;
  /** `applied`: how many transactions an "Always" rule was applied to (0 if none). */
  onSaved: (t: Transaction, applied: number) => void;
  onDeleted: (id: string) => void;
}) {
  const { categories, categoryById, accountById, labelFor } = useHousehold();
  const [merchant, setMerchant] = useState(txn.merchant);
  const [categoryId, setCategoryId] = useState<string | null>(txn.category_id);
  const [note, setNote] = useState(txn.note ?? "");
  const always = useAlwaysChoice(txn.amount_cents);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const account = txn.account_id ? accountById.get(txn.account_id) : undefined;
  const newCategory = categoryId && categoryId !== txn.category_id ? categoryById.get(categoryId) : undefined;

  async function save() {
    const remember = alwaysBody(always, Boolean(newCategory));
    if ("error" in remember) return setError(remember.error ?? null);
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/transactions/${txn.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ merchant, category_id: categoryId, note, ...remember }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(body.error ?? "Couldn't save");
    onSaved(body.transaction as Transaction, body.learned?.applied ?? 0);
  }

  /** Possible duplicate: merge it into the phone capture or manual entry it copies. */
  async function merge(into: string) {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/transactions/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [txn.id], action: "merge", into }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(body.error ?? "Couldn't merge");
    if (!body.done) return setError("Nothing left to merge it with — keep it, or delete one.");
    onDeleted(txn.id);
  }

  /** "Keep both" / "Mark as confirmed": clears the review flag. */
  async function confirmIt() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/transactions/${txn.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: true }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(body.error ?? "Couldn't save");
    onSaved(body.transaction as Transaction, 0);
  }

  async function remove() {
    if (!confirmDelete) return setConfirmDelete(true);
    setBusy(true);
    const res = await fetch(`/api/transactions/${txn.id}`, { method: "DELETE" });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(body.error ?? "Couldn't delete");
    onDeleted(txn.id);
  }

  return (
    <Sheet title={txn.merchant} open onClose={onClose}>
      <div className="flex flex-col items-center gap-[6px]">
        <div className="font-num text-[40px] leading-none font-semibold tracking-[-1px]">{formatSigned(txn.amount_cents)}</div>
        <div className="text-center text-[13px] text-muted">
          {when.format(new Date(txn.occurred_at))} · {labelFor(txn.member_id)} · {SOURCE_LABEL[txn.source]}
          {account && ` · ${account.nickname}${account.last4 ? ` ••${account.last4}` : ""}`}
          {txn.status === "captured" && " · Unconfirmed"}
        </div>
      </div>

      {txn.review_reason ? (
        <div className="flex flex-col gap-3 rounded-[14px] bg-warn-bg px-[14px] py-3 text-[14px] text-warn-ink">
          <div>
            {txn.review_reason}. If it&apos;s the same purchase, merge them: the earlier entry keeps its details and gets the
            bank&apos;s confirmation. If they&apos;re really two purchases, keep both.
          </div>
          {txn.external_ref && <DuplicateCompare txn={txn} busy={busy} onMerge={merge} />}
          <SecondaryButton onClick={confirmIt} disabled={busy}>
            Different purchases — keep both
          </SecondaryButton>
        </div>
      ) : (
        unconfirmed(txn) && (
          <div className="flex flex-col gap-3 rounded-[14px] bg-warn-bg px-[14px] py-3 text-[14px] text-warn-ink">
            <div>
              No bank import has confirmed this phone capture after 7 days. If it was paid on a card you don&apos;t import,
              mark it confirmed; if the purchase didn&apos;t happen, delete it.
            </div>
            <SecondaryButton onClick={confirmIt} disabled={busy}>
              Mark as confirmed
            </SecondaryButton>
          </div>
        )
      )}

      <Field label="Merchant" hint={txn.merchant_raw && txn.merchant_raw.toLowerCase() !== merchant.trim().toLowerCase() ? `Bank description: ${txn.merchant_raw}` : undefined}>
        {(id) => <input id={id} className={inputClass} value={merchant} maxLength={120} onChange={(e) => setMerchant(e.target.value)} />}
      </Field>

      <div className="flex flex-col gap-2">
        <div className="text-[13px] text-muted">Category</div>
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

      {newCategory && (
        <AlwaysPrompt merchant={merchant.trim() || txn.merchant} category={newCategory.name} onceLabel="Just this one" state={always} />
      )}

      <Field label="Note">
        {(id) => (
          <textarea
            id={id}
            className={`${inputClass} h-auto min-h-[72px] py-[10px]`}
            value={note}
            maxLength={500}
            onChange={(e) => setNote(e.target.value)}
          />
        )}
      </Field>

      {txn.source === "android" && <CaptureText id={txn.id} />}

      {error && <ErrorNote>{error}</ErrorNote>}
      <PrimaryButton onClick={save} disabled={busy || !merchant.trim()}>
        Save
      </PrimaryButton>
      <SecondaryButton danger onClick={remove} disabled={busy}>
        {confirmDelete ? "Tap again to delete" : "Delete"}
      </SecondaryButton>
      {confirmDelete && txn.external_ref && (
        <div className="px-1 text-center text-[12px] text-muted">
          It came from a bank import; importing that file again won&apos;t bring it back.
        </div>
      )}
    </Sheet>
  );
}
