"use client";

import { useMemo, useState } from "react";
import { formatSigned } from "@/lib/money";
import { type Transaction, unconfirmed } from "@/lib/types";
import { useHousehold } from "./HouseholdProvider";
import { CheckIcon } from "./icons";
import { type ReviewGroup, groupByMerchant, groupReason } from "./ReviewGroupSheet";
import { Chip, ErrorNote, cx } from "./ui";

type Reason = "all" | "category" | "duplicate" | "unconfirmed";
const NO_CARD = "none";

const reasonsOf = (r: Transaction): Reason[] => [
  ...(!r.category_id ? (["category"] as const) : []),
  ...(r.review_reason ? (["duplicate"] as const) : []),
  ...(r.category_id && !r.review_reason && unconfirmed(r) ? (["unconfirmed"] as const) : []),
];

/** A 22px checkbox in the design's accent colour; `some` = partly selected group. */
function Tick({ state }: { state: "all" | "some" | "none" }) {
  return (
    <span
      aria-hidden
      className={cx(
        "flex size-[22px] shrink-0 items-center justify-center rounded-[6px] border",
        state === "none" ? "border-line bg-surface" : "border-accent bg-accent text-white",
      )}
    >
      {state === "all" && <CheckIcon />}
      {state === "some" && <span className="h-[2px] w-[10px] rounded bg-white" />}
    </span>
  );
}

/**
 * Needs review, grouped by merchant. Filter by reason and card; in Select mode
 * pick groups (or Select all) and merge duplicates, confirm, set a category or
 * delete them in one go.
 */
export function NeedsReview({
  rows,
  onOpenGroup,
  onEditOne,
  onChanged,
}: {
  rows: Transaction[];
  /** Open the category sheet for a group (`mixed`: several merchants, so no "Always"). */
  onOpenGroup: (g: ReviewGroup, mixed: boolean) => void;
  onEditOne: (t: Transaction) => void;
  /** After a bulk action: a message to show, and reload. */
  onChanged: (message: string) => void;
}) {
  const { accountById } = useHousehold();
  const [reason, setReason] = useState<Reason>("all");
  const [card, setCard] = useState<string>("all");
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cards = useMemo(() => {
    const ids = new Set(rows.map((r) => r.account_id ?? NO_CARD));
    return [...ids].map((id) => {
      const a = id === NO_CARD ? undefined : accountById.get(id);
      return { id, label: a ? `${a.nickname}${a.last4 ? ` ••${a.last4}` : ""}` : "No card" };
    });
  }, [rows, accountById]);

  const visible = useMemo(
    () =>
      rows.filter(
        (r) =>
          (reason === "all" || reasonsOf(r).includes(reason)) &&
          (card === "all" || (r.account_id ?? NO_CARD) === card),
      ),
    [rows, reason, card],
  );
  const groups = useMemo(() => groupByMerchant(visible), [visible]);
  const count = (x: Reason) => rows.filter((r) => reasonsOf(r).includes(x)).length;

  // Only what's on screen counts as selected (filters may hide some).
  const chosen = visible.filter((r) => selected.has(r.id));
  const dupes = chosen.filter((r) => r.review_reason).length;
  const allState = chosen.length === 0 ? "none" : chosen.length === visible.length ? "all" : "some";

  function toggle(ids: string[], on: boolean) {
    setConfirmDelete(false);
    setSelected((s) => {
      const next = new Set(s);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  function stopSelecting() {
    setSelecting(false);
    setSelected(new Set());
    setConfirmDelete(false);
    setError(null);
  }

  async function run(action: "merge" | "confirm" | "delete") {
    if (action === "delete" && !confirmDelete) return setConfirmDelete(true);
    const ids = (action === "merge" ? chosen.filter((r) => r.review_reason) : chosen).map((r) => r.id);
    setBusy(true);
    setError(null);
    const res = await fetch("/api/transactions/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, action }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(body.error ?? "Couldn't update");
    const n = Number(body.done ?? 0);
    const skipped = Number(body.skipped ?? 0);
    const t = (k: number) => `${k} transaction${k === 1 ? "" : "s"}`;
    const verb = action === "merge" ? "Merged" : action === "confirm" ? "Confirmed" : "Deleted";
    const why =
      action === "merge" ? "nothing left to merge with" : action === "delete" ? "already gone" : "not changed";
    onChanged(`${verb} ${t(n)}${skipped ? ` · ${skipped} skipped (${why})` : ""}`);
    stopSelecting();
  }

  function setCategory() {
    const merchants = new Set(chosen.map((r) => r.merchant.trim().toLowerCase()));
    const mixed = merchants.size > 1;
    onOpenGroup(
      {
        key: "selection",
        merchant: mixed ? `${chosen.length} selected` : chosen[0].merchant,
        rows: chosen,
        totalCents: chosen.reduce((a, r) => a + Number(r.amount_cents), 0),
      },
      mixed,
    );
  }

  const reasonChips: { value: Reason; label: string; n: number }[] = [
    { value: "all", label: "All", n: rows.length },
    { value: "duplicate", label: "Possible duplicates", n: count("duplicate") },
    { value: "category", label: "Needs category", n: count("category") },
    { value: "unconfirmed", label: "Unconfirmed", n: count("unconfirmed") },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {reasonChips
          .filter((c) => c.value === "all" || c.n > 0)
          .map((c) => (
            <Chip key={c.value} size="sm" selected={reason === c.value} onClick={() => setReason(c.value)}>
              {c.value === "all" ? c.label : `${c.label} · ${c.n}`}
            </Chip>
          ))}
      </div>
      {cards.length > 1 && (
        <div className="flex flex-wrap gap-2">
          <Chip size="sm" selected={card === "all"} onClick={() => setCard("all")}>
            Any card
          </Chip>
          {cards.map((c) => (
            <Chip key={c.id} size="sm" selected={card === c.id} onClick={() => setCard(c.id)}>
              {c.label}
            </Chip>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between text-[13px] text-muted">
        {selecting ? (
          <button
            type="button"
            className="flex cursor-pointer items-center gap-2 border-none bg-transparent p-0 text-[13px] font-semibold text-ink"
            onClick={() => toggle(visible.map((r) => r.id), allState !== "all")}
          >
            <Tick state={allState} />
            Select all {visible.length}
          </button>
        ) : (
          <span className="font-semibold">
            {visible.length} item{visible.length === 1 ? "" : "s"} · by merchant
          </span>
        )}
        {visible.length > 0 && (
          <button
            type="button"
            className="cursor-pointer border-none bg-transparent p-0 text-[13px] font-semibold text-accent-link"
            onClick={() => (selecting ? stopSelecting() : setSelecting(true))}
          >
            {selecting ? "Done" : "Select"}
          </button>
        )}
      </div>

      {groups.length > 0 && (
        <div className="flex flex-col overflow-hidden rounded-[16px] bg-surface">
          {groups.map((g, i) => {
            const ids = g.rows.map((r) => r.id);
            const on = ids.filter((id) => selected.has(id)).length;
            const state = on === 0 ? "none" : on === ids.length ? "all" : "some";
            return (
              <button
                key={g.key}
                type="button"
                aria-pressed={selecting ? state === "all" : undefined}
                onClick={() =>
                  selecting ? toggle(ids, state !== "all") : g.rows.length === 1 ? onEditOne(g.rows[0]) : onOpenGroup(g, false)
                }
                className={cx(
                  "box-border flex min-h-[60px] w-full cursor-pointer items-center gap-3 px-[14px] py-3 text-ink",
                  g.rows.some((r) => !r.category_id || r.review_reason) ? "bg-warn-row" : "bg-transparent",
                  i > 0 && "border-t border-divider",
                )}
              >
                {selecting ? (
                  <Tick state={state} />
                ) : (
                  <span
                    className="flex size-8 shrink-0 items-center justify-center rounded-full bg-segment font-num text-[13px] font-bold text-ink"
                    aria-label={`${g.rows.length} transactions`}
                  >
                    {g.rows.length}
                  </span>
                )}
                <span className="flex min-w-0 grow flex-col gap-[2px] text-left">
                  <span className="truncate text-[15px] font-semibold">{g.merchant}</span>
                  <span className="truncate text-[12px] text-warn-text">{groupReason(g)}</span>
                </span>
                <span className="font-num text-[15px] font-semibold whitespace-nowrap">
                  {formatSigned(g.rows.length === 1 ? Number(g.rows[0].amount_cents) : g.totalCents)}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {visible.length === 0 && rows.length > 0 && (
        <div className="py-6 text-center text-[14px] text-muted">Nothing here with these filters.</div>
      )}

      {selecting && chosen.length > 0 && (
        <div className="sticky bottom-0 flex flex-col gap-2 rounded-[16px] bg-surface p-3 shadow-[0_-2px_12px_var(--color-shadow)]">
          <div className="text-[13px] font-semibold">
            {chosen.length} selected{dupes ? ` · ${dupes} possible duplicate${dupes === 1 ? "" : "s"}` : ""}
          </div>
          {error && <ErrorNote>{error}</ErrorNote>}
          <div className="grid grid-cols-2 gap-2">
            {dupes > 0 && (
              <ActionButton primary onClick={() => run("merge")} disabled={busy}>
                Merge {dupes}
              </ActionButton>
            )}
            <ActionButton onClick={() => run("confirm")} disabled={busy}>
              {dupes ? "Keep both" : "Confirm"}
            </ActionButton>
            <ActionButton onClick={setCategory} disabled={busy}>
              Set category
            </ActionButton>
            <ActionButton danger onClick={() => run("delete")} disabled={busy}>
              {confirmDelete ? "Tap again" : "Delete"}
            </ActionButton>
          </div>
        </div>
      )}
    </div>
  );
}

function ActionButton({
  children,
  onClick,
  disabled,
  primary,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cx(
        "h-11 cursor-pointer rounded-[12px] border text-[14px] font-semibold disabled:opacity-50",
        primary ? "border-accent bg-accent text-white" : "border-line bg-surface",
        danger ? "text-up" : !primary && "text-ink",
      )}
    >
      {children}
    </button>
  );
}
