// ANZ / NAB CSV exports → rows ready for import_bank_rows().
//
// Formats handled:
//   ANZ   no header; Date (DD/MM/YYYY), Amount (signed), Description[, …]
//   NAB   header row: Date, Amount, Account Number, …, Transaction Details, …, Merchant Name
//   other any export with a header naming a date, an amount (or debit/credit)
//         and a description/details/narrative column
// Amounts become signed cents (spending negative); dates become Sydney calendar dates.

export type BankFormat = "anz" | "nab" | "generic";

export interface BankRow {
  /** 1-based line in the file, for error messages and the preview. */
  line: number;
  date: string; // YYYY-MM-DD
  amountCents: number;
  description: string;
  /** NAB's "Merchant Name" column, when present (a cleaner display name). */
  merchantName: string | null;
}

export interface ParsedCsv {
  format: BankFormat;
  rows: BankRow[];
  /** Lines that looked like data but couldn't be read. */
  skipped: { line: number; reason: string }[];
}

export class CsvFormatError extends Error {}

/** RFC 4180-ish: quoted fields, doubled quotes, CRLF/LF, BOM. */
export function parseCsvText(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** "06/10/2026", "6/10/26", "06 Oct 26", "6 October 2026", "2026-10-06" → "2026-10-06". */
export function parseBankDate(input: string): string | null {
  const s = input.trim();
  let y: number, m: number, d: number;
  let match: RegExpExecArray | null;
  if ((match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s))) [y, m, d] = [+match[1], +match[2], +match[3]];
  else if ((match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s))) [d, m, y] = [+match[1], +match[2], +match[3]];
  else if ((match = /^(\d{1,2})[\s-]([A-Za-z]{3})[A-Za-z]*[\s-](\d{2}|\d{4})$/.exec(s))) {
    d = +match[1];
    m = MONTHS[match[2].toLowerCase()] ?? 0;
    y = +match[3];
  } else return null;
  if (y < 100) y += 2000;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/** "-23.50", "$1,234.56", "(23.50)", "23.50 DR", "23.50 CR" → signed cents. */
export function parseBankAmount(input: string): number | null {
  let s = input.trim().replace(/[$,\s]|AUD/gi, "").replace(/−/g, "-");
  if (!s) return null;
  let sign = 1;
  if (/^\(.*\)$/.test(s)) {
    sign = -1;
    s = s.slice(1, -1);
  }
  if (/DR$/i.test(s)) {
    sign = -1;
    s = s.slice(0, -2);
  } else if (/CR$/i.test(s)) s = s.slice(0, -2);
  if (!/^[-+]?\d+(\.\d{1,2})?$/.test(s)) return null;
  return sign * Math.round(Number(s) * 100);
}

const norm = (h: string) => h.trim().toLowerCase();
const findCol = (header: string[], re: RegExp) => header.findIndex((h) => re.test(norm(h)));

export function parseBankCsv(text: string): ParsedCsv {
  const table = parseCsvText(text);
  if (table.length === 0) throw new CsvFormatError("The file is empty.");

  const first = table[0];
  const headerless = parseBankDate(first[0] ?? "") !== null && parseBankAmount(first[1] ?? "") !== null;

  let format: BankFormat;
  let dateCol: number, amountCol: number, debitCol = -1, creditCol = -1, descCol: number, merchantCol = -1;
  let start: number;

  if (headerless) {
    // ANZ: Date, Amount, Description (sometimes more columns after).
    format = "anz";
    [dateCol, amountCol, descCol, start] = [0, 1, 2, 0];
  } else {
    const header = first;
    start = 1;
    dateCol = findCol(header, /^(transaction )?date$|^date\b/);
    amountCol = findCol(header, /^amount\b|^transaction amount$/);
    debitCol = findCol(header, /^(debit|withdrawal)s?\b/);
    creditCol = findCol(header, /^(credit|deposit)s?\b/);
    descCol = findCol(header, /transaction details|description|narrative|details|particulars|payee/);
    merchantCol = findCol(header, /^merchant( name)?$/);
    format = header.some((h) => /transaction details/i.test(h)) || header.some((h) => /account number/i.test(h)) ? "nab" : "generic";
    if (descCol < 0 && merchantCol >= 0) descCol = merchantCol;
    if (dateCol < 0 || descCol < 0 || (amountCol < 0 && debitCol < 0 && creditCol < 0)) {
      throw new CsvFormatError(
        `Couldn't find the date, amount and description columns. Header was: ${header.map((h) => h.trim()).join(", ")}`,
      );
    }
  }

  const rows: BankRow[] = [];
  const skipped: ParsedCsv["skipped"] = [];
  for (let i = start; i < table.length; i++) {
    const r = table[i];
    const line = i + 1;
    const date = parseBankDate(r[dateCol] ?? "");
    let amount: number | null;
    if (amountCol >= 0) amount = parseBankAmount(r[amountCol] ?? "");
    else {
      const debit = parseBankAmount(r[debitCol] ?? "");
      const credit = parseBankAmount(r[creditCol] ?? "");
      amount = debit ? -Math.abs(debit) : credit ? Math.abs(credit) : null;
    }
    const description = (r[descCol] ?? "").replace(/\s+/g, " ").trim();
    if (!date) skipped.push({ line, reason: `unreadable date "${r[dateCol] ?? ""}"` });
    else if (amount === null) skipped.push({ line, reason: `unreadable amount "${r[amountCol] ?? ""}"` });
    else if (amount === 0) skipped.push({ line, reason: "zero amount" });
    else {
      const merchantName = merchantCol >= 0 ? (r[merchantCol] ?? "").replace(/\s+/g, " ").trim() || null : null;
      rows.push({ line, date, amountCents: amount, description: description || merchantName || "Unknown", merchantName });
    }
  }
  if (rows.length === 0) {
    throw new CsvFormatError(
      skipped.length ? `No rows could be read (first problem: line ${skipped[0].line}, ${skipped[0].reason}).` : "No transactions found.",
    );
  }
  return { format, rows, skipped };
}

// Debits that are money moving between your own accounts, not spending.
const OWN_TRANSFER = /\b(transfer to|tfr to|trf to|internet transfer|online transfer|to savings|to linked acc|payment thank ?you|payment received,? thank|credit card (re)?payment|card repayment|cc payment|anz internet banking payment|nab card payment)\b/i;
const REFUND = /\b(refund|return|reversal|reversed|credit voucher|chargeback)\b/i;

/** Whether a row is imported by default, and why not (shown in the preview). */
export function defaultInclude(row: BankRow): { include: boolean; reason: string | null } {
  if (row.amountCents < 0) {
    return OWN_TRANSFER.test(row.description) ? { include: false, reason: "Looks like a transfer or card repayment" } : { include: true, reason: null };
  }
  return REFUND.test(row.description) ? { include: true, reason: "Refund" } : { include: false, reason: "Money in (income isn't tracked)" };
}

/**
 * Stable per-row id so re-importing the same file inserts nothing. Identical
 * rows on the same day (two $4.50 coffees) get an occurrence number.
 */
export function externalRefKeys(accountId: string, rows: BankRow[]): string[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const base = [accountId, r.date, r.amountCents, r.description.toUpperCase()].join("|");
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return `${base}|${n}`;
  });
}
