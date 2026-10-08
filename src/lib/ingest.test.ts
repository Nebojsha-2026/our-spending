import { describe, expect, it } from "vitest";
import { cleanMerchant, generateToken, hashToken, parseAmount, rulePatternFor } from "./ingest";

describe("parseAmount", () => {
  it("accepts what Shortcuts and MacroDroid send", () => {
    expect(parseAmount("$23.50")).toBe(2350);
    expect(parseAmount("A$1,234.56")).toBe(123456);
    expect(parseAmount("AUD 12")).toBe(1200);
    expect(parseAmount("-$5.00")).toBe(500);
    expect(parseAmount("−$5")).toBe(500);
    expect(parseAmount(" 7.5 ")).toBe(750);
    expect(parseAmount(23.5)).toBe(2350);
    expect(parseAmount("$0.10")).toBe(10);
  });

  it("rejects zero and junk", () => {
    expect(parseAmount("$0.00")).toBeNull();
    expect(parseAmount(0)).toBeNull();
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("twenty")).toBeNull();
    expect(parseAmount("$1.2.3")).toBeNull();
    expect(parseAmount(null)).toBeNull();
    expect(parseAmount(undefined)).toBeNull();
    expect(parseAmount(Number.NaN)).toBeNull();
  });
});

describe("cleanMerchant", () => {
  it("strips store numbers, suburbs and processor prefixes", () => {
    expect(cleanMerchant("WOOLWORTHS 1234 NEWTOWN")).toBe("Woolworths");
    expect(cleanMerchant("COLES 0745 RYDE")).toBe("Coles");
    expect(cleanMerchant("SQ *THE CORNER")).toBe("The Corner");
    expect(cleanMerchant("PAYPAL *NETFLIX")).toBe("Netflix");
    expect(cleanMerchant("AMAZON MKTPL AU")).toBe("Amazon MKTPL");
    expect(cleanMerchant("BP NEWTOWN")).toBe("BP Newtown");
    expect(cleanMerchant("KMART 1077 PARRAMATTA NSW")).toBe("Kmart");
    expect(cleanMerchant("7-ELEVEN 2045 SYDNEY")).toBe("7-Eleven");
  });

  it("leaves names that are already tidy", () => {
    expect(cleanMerchant("Woolworths")).toBe("Woolworths");
    expect(cleanMerchant("Guzman y Gomez")).toBe("Guzman y Gomez");
    expect(cleanMerchant("  ")).toBe("");
  });

  it("strips ANZ/NAB card prefixes, dates and times", () => {
    expect(cleanMerchant("V4821 28/09 7-Eleven")).toBe("7-Eleven");
    expect(cleanMerchant("V4821 28/09 7-ELEVEN 2045 SYDNEY")).toBe("7-Eleven");
    expect(cleanMerchant("M1234 01/10/2026 COLES 0745 RYDE")).toBe("Coles");
    expect(cleanMerchant("Card xx1234 WOOLWORTHS NEWTOWN")).toBe("Woolworths Newtown");
    expect(cleanMerchant("VISA PURCHASE 28/09 KFC")).toBe("KFC");
    expect(cleanMerchant("WOOLWORTHS 1234 NEWTOWN 28/09")).toBe("Woolworths");
    expect(cleanMerchant("BP NEWTOWN Card xx1234 Value Date: 20/09/2026")).toBe("BP Newtown");
  });

  it("strips 'Eftpos dd/mm hh:mm' and a duplicated trailing suburb", () => {
    expect(cleanMerchant("Eftpos 20/09 11:32KBC Surry Hills Surry Hills")).toBe("KBC Surry Hills");
    expect(cleanMerchant("EFTPOS 20/09 11:32 KBC SURRY HILLS SURRY HILLS NSW")).toBe("KBC Surry Hills");
    expect(cleanMerchant("Eftpos 20/09 9:05am Bakery Newtown Newtown")).toBe("Bakery Newtown");
  });

  it("cleans every variant of one merchant to the same name", () => {
    const variants = ["V4821 28/09 7-Eleven", "V4821 03/10 7-ELEVEN 2045 SYDNEY", "7-ELEVEN 2045 SYDNEY", "7-Eleven"];
    expect(new Set(variants.map(cleanMerchant))).toEqual(new Set(["7-Eleven"]));
  });

  it("does not mistake names for noise", () => {
    expect(cleanMerchant("Posh Nails")).toBe("Posh Nails");
    expect(cleanMerchant("Bora Bora")).toBe("Bora Bora");
    expect(cleanMerchant("11:32AMAZON")).toBe("Amazon"); // "AM" glued to a name is not a time
    expect(cleanMerchant("V4821 28/09")).toBe("V4821 28/09"); // nothing left: keep what the bank said
  });
});

describe("rulePatternFor", () => {
  it("is the cleaned merchant name, not the raw bank text", () => {
    expect(rulePatternFor("WOOLWORTHS 1234 NEWTOWN")).toBe("Woolworths");
    expect(rulePatternFor("SQ *THE CORNER")).toBe("The Corner");
    expect(rulePatternFor("V4821 28/09 7-Eleven")).toBe("7-Eleven");
    expect(rulePatternFor("Eftpos 20/09 11:32KBC Surry Hills Surry Hills")).toBe("KBC Surry Hills");
    expect(rulePatternFor("100%_PURE 12")).toBe("100\\%\\_pure"); // "%" isn't a word separator
    expect(rulePatternFor("")).toBeNull();
  });
});

describe("device tokens", () => {
  it("are long, random and hashed", () => {
    const a = generateToken();
    expect(a).toMatch(/^het_[A-Za-z0-9_-]{43}$/);
    expect(generateToken()).not.toBe(a);
    expect(hashToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(a)).toBe(hashToken(a));
  });
});
