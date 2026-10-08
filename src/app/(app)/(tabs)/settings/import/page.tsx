"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import type { ImportRow } from "@/app/api/import/csv/route";
import { useHousehold } from "@/components/HouseholdProvider";
import { SettingsScreen } from "@/components/settings";
import { Card, Chip, ErrorNote, PrimaryButton, SecondaryButton, cx } from "@/components/ui";
import { formatCents, formatSigned } from "@/lib/money";
import { TZ, dayLabel, sydneyDate } from "@/lib/periods";

interface Result {
  committed: boolean;
  format: "anz" | "nab" | "generic";
  rows: ImportRow[];
  skipped: { line: number; reason: string }[];
  summary: { total: number; new: number; merged: number; flagged: number; alreadyImported: number; deleted: number; excluded: number };
}

const FORMAT = { anz: "ANZ export", nab: "NAB export", generic: "Bank export" };
const shortDate = new Intl.DateTimeFormat("en-AU", { timeZone: TZ, day: "numeric", month: "short" });
const actionable = (r: ImportRow) => r.action !== "already_imported" && r.action !== "deleted" && r.action !== "invalid";

export default function ImportCsv() {
  const { accounts, labelFor } = useHousehold();
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [preview, setPreview] = useState<Result | null>(null);
  const [include, setInclude] = useState<Set<number>>(new Set());
  const [done, setDone] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const [today] = useState(() => sydneyDate());

  async function send(csv: string, account: string, commit: boolean, lines?: number[]) {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/import/csv", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account_id: account, csv, commit, include: lines }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(body.error ?? "Couldn't read that file");
      return null;
    }
    return body as Result;
  }

  async function choose(f: File, account = accountId) {
    const text = await f.text();
    setFile({ name: f.name, text });
    setDone(null);
    const r = await send(text, account, false);
    setPreview(r);
    if (r) setInclude(new Set(r.rows.filter((x) => x.include && actionable(x)).map((x) => x.idx)));
  }

  async function changeAccount(id: string) {
    setAccountId(id);
    if (file) {
      const r = await send(file.text, id, false);
      setPreview(r);
      if (r) setInclude(new Set(r.rows.filter((x) => x.include && actionable(x)).map((x) => x.idx)));
    }
  }

  async function commit() {
    if (!file || !preview) return;
    const r = await send(file.text, accountId, true, [...include]);
    if (r) {
      setDone(r);
      setPreview(null);
      setFile(null);
      if (input.current) input.current.value = "";
    }
  }

  const toImport = preview?.rows.filter((r) => actionable(r) && include.has(r.idx)) ?? [];
  const counts = {
    new: toImport.filter((r) => r.action === "new").length,
    merge: toImport.filter((r) => r.action === "merge").length,
    ambiguous: toImport.filter((r) => r.action === "ambiguous").length,
  };
  const days = useMemo(() => {
    const groups: { day: string; rows: ImportRow[] }[] = [];
    for (const r of preview?.rows ?? []) {
      if (groups.at(-1)?.day !== r.date) groups.push({ day: r.date, rows: [] });
      groups.at(-1)!.rows.push(r);
    }
    return groups;
  }, [preview]);

  if (accounts.length === 0) {
    return (
      <SettingsScreen title="Import bank CSV">
        <Card className="gap-3 p-5">
          <div className="text-[15px] font-semibold">Add a card first</div>
          <div className="text-[14px] text-muted">Each import goes into one card, so its transactions can be matched to phone captures.</div>
          <Link href="/settings/accounts" className="text-[14px] font-semibold">
            Accounts & cards
          </Link>
        </Card>
      </SettingsScreen>
    );
  }

  return (
    <SettingsScreen title="Import bank CSV">
      {done ? (
        <Card className="gap-3 p-5">
          <div className="text-[15px] font-semibold">Imported</div>
          <div className="text-[14px] text-muted">
            {done.summary.new} new · {done.summary.merged} confirmed earlier entries
            {done.summary.flagged > 0 && ` · ${done.summary.flagged} flagged as possible duplicates`}
            {done.summary.alreadyImported > 0 && ` · ${done.summary.alreadyImported} were already imported`}
            {done.summary.deleted > 0 && ` · ${done.summary.deleted} you deleted earlier were skipped`}
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-[14px] font-semibold">
            <Link href="/activity">See Activity</Link>
            {done.summary.flagged > 0 && <Link href="/activity?filter=review">Review flagged</Link>}
          </div>
        </Card>
      ) : (
        <div className="px-1 text-[13px] text-muted">
          In ANZ or NAB internet banking, export the card&apos;s transactions as CSV, then pick the card and the file. Purchases
          already captured by a phone are confirmed rather than added twice, and importing the same file again adds nothing.
        </div>
      )}

      <div className="flex flex-col gap-2">
        <div className="text-[13px] text-muted">Card</div>
        <div className="flex flex-wrap gap-2">
          {accounts.map((a) => (
            <Chip key={a.id} selected={a.id === accountId} onClick={() => changeAccount(a.id)}>
              {a.nickname}
              {a.last4 && ` ••${a.last4}`} · {labelFor(a.member_id)}
            </Chip>
          ))}
        </div>
      </div>

      <input
        ref={input}
        type="file"
        accept=".csv,text/csv,text/comma-separated-values,application/vnd.ms-excel"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) choose(f);
        }}
      />
      <SecondaryButton onClick={() => input.current?.click()} disabled={busy}>
        {file ? `Choose a different file (${file.name})` : "Choose CSV file"}
      </SecondaryButton>

      {error && <ErrorNote>{error}</ErrorNote>}

      {preview && (
        <>
          <Card className="gap-2 p-5">
            <div className="text-[15px] font-semibold">
              {FORMAT[preview.format]} · {preview.summary.total} rows
            </div>
            <div className="flex flex-col gap-1 text-[13px] text-muted">
              <span>
                <b className="text-ink">{counts.new}</b> new
              </span>
              <span>
                <b className="text-ink">{counts.merge}</b> {counts.merge === 1 ? "confirms an earlier entry" : "confirm earlier entries"}
              </span>
              {counts.ambiguous > 0 && (
                <span>
                  <b className="text-warn-text">{counts.ambiguous}</b> possible {counts.ambiguous === 1 ? "duplicate" : "duplicates"} —
                  imported and flagged for review
                </span>
              )}
              {preview.summary.alreadyImported > 0 && <span>{preview.summary.alreadyImported} already imported</span>}
              {preview.summary.deleted > 0 && <span>{preview.summary.deleted} deleted earlier</span>}
              <span>{preview.rows.filter((r) => actionable(r) && !include.has(r.idx)).length} not imported (tap a row to change)</span>
              {preview.skipped.length > 0 && (
                <span className="text-warn-text">
                  {preview.skipped.length} unreadable {preview.skipped.length === 1 ? "line" : "lines"} (first: line{" "}
                  {preview.skipped[0].line}, {preview.skipped[0].reason})
                </span>
              )}
            </div>
          </Card>

          {days.map(({ day, rows }) => (
            <div key={day} className="flex flex-col gap-2">
              <div className="text-[13px] font-semibold text-muted">{dayLabel(day, today)}</div>
              <div className="flex flex-col overflow-hidden rounded-[16px] bg-surface">
                {rows.map((r, i) => {
                  const on = include.has(r.idx);
                  const can = actionable(r);
                  return (
                    <button
                      key={r.idx}
                      type="button"
                      disabled={!can}
                      aria-pressed={can ? on : undefined}
                      onClick={() =>
                        setInclude((s) => {
                          const n = new Set(s);
                          if (n.has(r.idx)) n.delete(r.idx);
                          else n.add(r.idx);
                          return n;
                        })
                      }
                      className={cx(
                        "box-border flex min-h-[60px] w-full items-center gap-3 px-[14px] py-3 text-left text-ink",
                        can ? "cursor-pointer" : "opacity-50",
                        i > 0 && "border-t border-divider",
                        can && on && r.action === "ambiguous" && "bg-warn-row",
                      )}
                    >
                      <span
                        aria-hidden
                        className={cx(
                          "flex size-6 shrink-0 items-center justify-center rounded-full border text-[13px] font-bold",
                          can && on ? "border-accent bg-accent text-white" : "border-line bg-surface text-transparent",
                        )}
                      >
                        ✓
                      </span>
                      <span className="flex min-w-0 grow flex-col gap-[2px]">
                        <span className="truncate text-[14px] font-semibold">{r.description}</span>
                        <span className={cx("truncate text-[12px]", r.action === "ambiguous" && on ? "text-warn-text" : "text-muted")}>
                          {status(r, on)}
                        </span>
                      </span>
                      <span className={cx("font-num text-[14px] font-semibold whitespace-nowrap", r.amount_cents > 0 && "text-accent")}>
                        {formatSigned(r.amount_cents)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          <div className="sticky -bottom-5 -mx-5 bg-bg px-5 pt-2 pb-5">
            <PrimaryButton onClick={commit} disabled={busy || toImport.length === 0}>
              {busy ? "Importing…" : `Import ${toImport.length} ${toImport.length === 1 ? "transaction" : "transactions"}`}
            </PrimaryButton>
          </div>
        </>
      )}
    </SettingsScreen>
  );
}

function status(r: ImportRow, on: boolean): string {
  if (r.action === "already_imported") return "Already imported";
  if (r.action === "deleted") return "Deleted earlier · not imported again";
  if (r.action === "invalid") return "Can't import this row";
  if (!on) return r.reason && r.reason !== "Refund" ? `Not imported · ${r.reason}` : "Not imported";
  if (r.action === "merge" && r.match) {
    const what = r.match_kind === "manual" ? "manual entry" : "phone capture";
    return `Confirms ${what} · ${r.match.merchant}, ${shortDate.format(new Date(r.match.occurred_at))}`;
  }
  if (r.action === "ambiguous") {
    const what = r.match_kind === "manual" ? ["manual entry", "manual entries"] : ["phone capture", "phone captures"];
    return `${r.candidates === 1 ? `A ${what[0]}` : `${r.candidates} ${what[1]}`} could match · will be flagged`;
  }
  if (r.amount_cents > 0) return `Refund of ${formatCents(r.amount_cents)}`;
  return "New";
}
