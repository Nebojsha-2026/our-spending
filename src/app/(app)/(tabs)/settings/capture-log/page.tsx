"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useHousehold } from "@/components/HouseholdProvider";
import { SettingsScreen, useAction } from "@/components/settings";
import { Card, ErrorNote, SecondaryButton, cx } from "@/components/ui";
import { TZ } from "@/lib/periods";
import { createClient } from "@/lib/supabase/client";

interface Failure {
  id: string;
  member_id: string | null;
  app: string | null;
  raw: string;
  reason: string;
  created_at: string;
}

const when = new Intl.DateTimeFormat("en-AU", { timeZone: TZ, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** Notifications the server skipped or couldn't read (ingest_failures). */
export default function CaptureLog() {
  const { labelFor } = useHousehold();
  const [items, setItems] = useState<Failure[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const action = useAction();

  const load = useCallback(() => {
    createClient()
      .from("ingest_failures")
      .select("id,member_id,app,raw,reason,created_at")
      .order("created_at", { ascending: false })
      .limit(100)
      .returns<Failure[]>()
      .then(({ data, error }) => (error ? setError(error.message) : setItems(data)));
  }, []);
  useEffect(load, [load]);

  async function clear() {
    if (!confirm) return setConfirm(true);
    // Deletes every row the user can see (RLS limits it to this household).
    if (await action.run(() => createClient().from("ingest_failures").delete().not("id", "is", null))) {
      setConfirm(false);
      load();
    }
  }

  async function copy(f: Failure) {
    try {
      await navigator.clipboard.writeText(`[${f.app ?? "unknown app"}] ${f.raw}`);
      setCopied(f.id);
    } catch {
      setCopied(null);
    }
  }

  return (
    <SettingsScreen title="Capture log">
      <div className="px-1 text-[13px] text-muted">
        Phone notifications that weren&apos;t saved: ones skipped on purpose (declines, refunds, transfers), payments from
        cards that aren&apos;t in Accounts &amp; cards, and ones the app couldn&apos;t read. If a real purchase lands here, add it with <Link href="/add">+</Link> and copy the text
        so a pattern can be added for that wording.
      </div>
      {(error || action.error) && <ErrorNote>{error ?? action.error}</ErrorNote>}
      {items?.length === 0 && <div className="py-6 text-center text-[14px] text-muted">Nothing here — every notification was read.</div>}

      {items?.map((f) => {
        const skipped = f.reason.startsWith("Ignored");
        return (
          <Card key={f.id} className="gap-2 px-[14px] py-3">
            <div className="flex items-baseline justify-between gap-3 text-[12px] text-muted">
              <span className="truncate">
                {f.app ?? "Unknown app"}
                {f.member_id && ` · ${labelFor(f.member_id)}`}
              </span>
              <span className="shrink-0">{when.format(new Date(f.created_at))}</span>
            </div>
            <div className="text-[14px] break-words whitespace-pre-wrap">{f.raw}</div>
            <div className="flex items-center justify-between gap-3">
              <span className={cx("text-[12px] font-semibold", skipped ? "text-muted" : "text-warn-text")}>{f.reason}</span>
              <button
                type="button"
                onClick={() => copy(f)}
                className="min-h-11 shrink-0 cursor-pointer bg-transparent px-1 text-[13px] font-semibold text-accent-link"
              >
                {copied === f.id ? "Copied" : "Copy text"}
              </button>
            </div>
          </Card>
        );
      })}

      {items && items.length > 0 && (
        <SecondaryButton danger onClick={clear} disabled={action.busy}>
          {confirm ? "Tap again to clear the log" : "Clear log"}
        </SecondaryButton>
      )}
    </SettingsScreen>
  );
}
