import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { UUID, jsonError, readJson, requireMember } from "@/lib/api";
import { CsvFormatError, defaultInclude, externalRefKeys, parseBankCsv } from "@/lib/bank-csv";
import { cleanMerchant } from "@/lib/ingest";
import { queueBudgetAlerts } from "@/lib/push";

const MAX_CHARS = 2_000_000;
const MAX_ROWS = 5_000;

export interface ImportRow {
  idx: number; // line in the file
  date: string;
  amount_cents: number;
  description: string;
  /** deleted: imported before and then deleted from Activity, so not imported again. */
  action: "new" | "merge" | "ambiguous" | "already_imported" | "deleted" | "invalid";
  include: boolean;
  reason: string | null;
  candidates: number;
  /** What the row matched: a phone capture or a manual entry. */
  match_kind: "phone" | "manual" | null;
  match: { id: string; merchant: string; occurred_at: string } | null;
}

/**
 * POST /api/import/csv — import an ANZ or NAB CSV export into one card.
 * Body: { account_id, csv, commit?: boolean, include?: number[] }
 *   commit false (default): preview — what each row would do, nothing written
 *   commit true: import; `include` lists the file lines to import (defaults if omitted)
 */
export async function POST(req: Request) {
  const auth = await requireMember();
  if ("error" in auth) return auth.error;
  const body = await readJson(req);
  if (!body) return jsonError("Expected a JSON body", 400);

  const accountId = body.account_id;
  if (typeof accountId !== "string" || !UUID.test(accountId)) return jsonError("Choose the card this file is for", 400);
  if (typeof body.csv !== "string" || !body.csv.trim()) return jsonError("The file is empty", 400);
  if (body.csv.length > MAX_CHARS) return jsonError("That file is too big — export a shorter date range", 413);
  const commit = body.commit === true;
  const chosen = Array.isArray(body.include) ? new Set(body.include.filter((n): n is number => Number.isInteger(n))) : null;

  let parsed;
  try {
    parsed = parseBankCsv(body.csv);
  } catch (e) {
    if (e instanceof CsvFormatError) return jsonError(e.message, 422);
    throw e;
  }
  if (parsed.rows.length > MAX_ROWS) return jsonError(`That file has ${parsed.rows.length} rows; import up to ${MAX_ROWS} at a time`, 413);

  const refs = externalRefKeys(accountId, parsed.rows);
  const defaults = parsed.rows.map(defaultInclude);
  const payload = parsed.rows.map((r, i) => ({
    idx: r.line,
    date: r.date,
    amount_cents: r.amountCents,
    description: r.description,
    merchant_fallback: cleanMerchant(r.merchantName ?? r.description),
    external_ref: createHash("sha256").update(refs[i]).digest("hex"),
    include: chosen ? chosen.has(r.line) : defaults[i].include,
  }));

  const { data, error } = await auth.supabase.rpc("import_bank_rows", {
    p_account_id: accountId,
    p_rows: payload,
    p_commit: commit,
  });
  if (error) return jsonError(error.code === "22023" ? "Unknown card" : error.message, 400);
  if (commit) queueBudgetAlerts(auth.supabase, req);

  const results = new Map((data as Omit<ImportRow, "date" | "amount_cents" | "description" | "reason">[]).map((r) => [r.idx, r]));
  const rows: ImportRow[] = parsed.rows
    .map((r, i) => {
      const res = results.get(r.line)!;
      return {
        ...res,
        date: r.date,
        amount_cents: r.amountCents,
        description: r.description,
        reason: defaults[i].reason,
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date) || a.idx - b.idx);

  const counted = (pred: (r: ImportRow) => boolean) => rows.filter(pred).length;
  const settled = (r: ImportRow) => r.action === "already_imported" || r.action === "deleted";
  const active = (r: ImportRow) => r.include && !settled(r) && r.action !== "invalid";
  return NextResponse.json({
    committed: commit,
    format: parsed.format,
    rows,
    skipped: parsed.skipped,
    summary: {
      total: rows.length,
      new: counted((r) => active(r) && r.action === "new"),
      merged: counted((r) => active(r) && r.action === "merge"),
      flagged: counted((r) => active(r) && r.action === "ambiguous"),
      alreadyImported: counted((r) => r.action === "already_imported"),
      deleted: counted((r) => r.action === "deleted"),
      excluded: counted((r) => !r.include && !settled(r)),
    },
  });
}
