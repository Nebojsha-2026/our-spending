import { describe, expect, it } from "vitest";
import {
  CsvFormatError,
  defaultInclude,
  externalRefKeys,
  parseBankAmount,
  parseBankCsv,
  parseBankDate,
  parseCsvText,
} from "./bank-csv";

describe("CSV basics", () => {
  it("handles quotes, doubled quotes, CRLF and a BOM", () => {
    expect(parseCsvText('﻿a,"b, c","d ""e"""\r\n1,2,3\n\n')).toEqual([
      ["a", "b, c", 'd "e"'],
      ["1", "2", "3"],
    ]);
  });

  it("reads bank dates", () => {
    expect(parseBankDate("06/10/2026")).toBe("2026-10-06");
    expect(parseBankDate("6/10/26")).toBe("2026-10-06");
    expect(parseBankDate("06 Oct 26")).toBe("2026-10-06");
    expect(parseBankDate("6 October 2026")).toBe("2026-10-06");
    expect(parseBankDate("2026-10-06")).toBe("2026-10-06");
    expect(parseBankDate("31/02/2026")).toBeNull();
    expect(parseBankDate("Date")).toBeNull();
  });

  it("reads bank amounts", () => {
    expect(parseBankAmount("-23.50")).toBe(-2350);
    expect(parseBankAmount("$1,234.56")).toBe(123456);
    expect(parseBankAmount("(23.50)")).toBe(-2350);
    expect(parseBankAmount("23.50 DR")).toBe(-2350);
    expect(parseBankAmount("23.50 CR")).toBe(2350);
    expect(parseBankAmount("")).toBeNull();
    expect(parseBankAmount("abc")).toBeNull();
  });
});

describe("parseBankCsv", () => {
  it("reads an ANZ export (no header)", () => {
    const csv = [
      '06/10/2026,"-64.20","WOOLWORTHS 1234 NEWTOWN"',
      '05/10/2026,"-71.40","BP NEWTOWN 4321 NEWTOWN NS AUS"',
      '05/10/2026,"2500.00","PAY/SALARY FROM ACME PTY LTD"',
    ].join("\n");
    const { format, rows, skipped } = parseBankCsv(csv);
    expect(format).toBe("anz");
    expect(skipped).toEqual([]);
    expect(rows.map((r) => [r.date, r.amountCents, r.description])).toEqual([
      ["2026-10-06", -6420, "WOOLWORTHS 1234 NEWTOWN"],
      ["2026-10-05", -7140, "BP NEWTOWN 4321 NEWTOWN NS AUS"],
      ["2026-10-05", 250000, "PAY/SALARY FROM ACME PTY LTD"],
    ]);
  });

  it("reads a NAB export (header, merchant name column)", () => {
    const csv = [
      "Date,Amount,Account Number,,Transaction Type,Transaction Details,Balance,Category,Merchant Name",
      "06 Oct 26,-38.50,083-123 12345678,,EFTPOS DEBIT,COLES 0745 RYDE,1200.00,Groceries,Coles",
      "04 Oct 26,-9.50,083-123 12345678,,EFTPOS DEBIT,SQ *THE CORNER,1238.50,Dining,",
      "bad,line,here",
    ].join("\r\n");
    const { format, rows, skipped } = parseBankCsv(csv);
    expect(format).toBe("nab");
    expect(rows).toEqual([
      { line: 2, date: "2026-10-06", amountCents: -3850, description: "COLES 0745 RYDE", merchantName: "Coles" },
      { line: 3, date: "2026-10-04", amountCents: -950, description: "SQ *THE CORNER", merchantName: null },
    ]);
    expect(skipped).toEqual([{ line: 4, reason: 'unreadable date "bad"' }]);
  });

  it("reads other exports with debit/credit columns", () => {
    const csv = "Transaction Date,Narrative,Debit Amount,Credit Amount\n2026-10-03,KMART 1077,46.00,\n2026-10-03,REFUND AMAZON,,29.99";
    const { format, rows } = parseBankCsv(csv);
    expect(format).toBe("generic");
    expect(rows.map((r) => r.amountCents)).toEqual([-4600, 2999]);
  });

  it("explains files it can't read", () => {
    expect(() => parseBankCsv("")).toThrow(CsvFormatError);
    expect(() => parseBankCsv("Foo,Bar\n1,2")).toThrow(/Couldn't find the date, amount and description columns. Header was: Foo, Bar/);
  });
});

describe("import defaults", () => {
  const row = (amountCents: number, description: string) => ({ line: 1, date: "2026-10-06", amountCents, description, merchantName: null });

  it("imports spending and refunds, skips transfers and income", () => {
    expect(defaultInclude(row(-6420, "WOOLWORTHS 1234"))).toEqual({ include: true, reason: null });
    expect(defaultInclude(row(-50000, "TRANSFER TO SAVINGS 1234"))).toMatchObject({ include: false });
    expect(defaultInclude(row(-120000, "PAYMENT THANKYOU 4821"))).toMatchObject({ include: false });
    expect(defaultInclude(row(2999, "REFUND AMAZON MKTPL"))).toEqual({ include: true, reason: "Refund" });
    expect(defaultInclude(row(250000, "PAY/SALARY FROM ACME"))).toMatchObject({ include: false });
  });

  it("gives identical same-day rows distinct, stable refs", () => {
    const rows = [row(-450, "CAFE"), row(-450, "CAFE"), row(-450, "cafe ")].map((r) => ({ ...r, description: r.description.trim() }));
    const keys = externalRefKeys("acct", rows);
    expect(new Set(keys).size).toBe(3);
    expect(externalRefKeys("acct", rows)).toEqual(keys);
    expect(externalRefKeys("other", rows)[0]).not.toBe(keys[0]);
  });
});
