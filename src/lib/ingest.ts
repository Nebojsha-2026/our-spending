import { createHash, randomBytes } from "node:crypto";

/**
 * Amount as the phone sends it → positive cents, or null if unusable.
 * Forgiving: "$23.50", "A$1,234.56", "AUD 12", "-$5.00", 23.5 all work.
 */
export function parseAmount(input: unknown): number | null {
  let n: number;
  if (typeof input === "number") {
    n = input;
  } else if (typeof input === "string") {
    const s = input
      .replace(/−/g, "-")
      .replace(/AUD|A\$|\$|,|\s/gi, "");
    if (!/^[-+]?(\d+(\.\d*)?|\.\d+)$/.test(s)) return null;
    n = Number(s);
  } else {
    return null;
  }
  if (!Number.isFinite(n)) return null;
  const cents = Math.round(Math.abs(n) * 100);
  return cents > 0 && cents <= 100_000_000 ? cents : null;
}

// Noise in front of the merchant, stripped repeatedly in this order. Kept as
// source strings: supabase/migrations/20261010000001_merchant_cleaning.sql
// has the same list for public.clean_merchant(), and a test checks they agree.
export const LEADING_NOISE = [
  // Payment processors that hide the real merchant (Square, PayPal, Zeller…).
  "^(SQ ?\\*|SP ?\\*|SP |PAYPAL ?\\*|PP ?\\*|ZLR ?\\*|LS |TST ?\\*|IZ ?\\*|SUMUP ?\\*|CKO ?\\*|DD ?\\*) *",
  // Transaction type words: "Eftpos 20/09 11:32…", "VISA PURCHASE …".
  "^(EFTPOS|POS|VISA (DEBIT )?PURCHASE|DEBIT CARD PURCHASE|CARD PURCHASE|PURCHASE)(?![A-Z0-9]) *",
  // ANZ/NAB card prefix: "V4821" (Visa) / "M1234" (Mastercard), "Card xx1234".
  "^[VM][0-9]{4}(?![A-Z0-9]) *",
  "^(CARD )?X{2,}[0-9]{4}(?![A-Z0-9]) *",
  // Date and time: "28/09", "28/09/2026", "11:32" (often glued on: "11:32KBC").
  "^[0-9]{1,2}/[0-9]{1,2}(/[0-9]{2,4})?(?![A-Z0-9]) *",
  "^[0-9]{1,2}:[0-9]{2}(:[0-9]{2})?( ?[AP]M(?![A-Z]))? *",
];
const LEADING = LEADING_NOISE.map((src) => new RegExp(src, "i"));

// Words from here on are a store number, date, time or card — not the name.
const CUT = /^(#?[0-9][0-9-]*|[0-9]{1,2}\/[0-9]{1,2}(\/[0-9]{2,4})?|[0-9]{1,2}:[0-9]{2}(:[0-9]{2})?|X{2,}[0-9]{4})$/i;
const TRAILING = new Set(["AU", "AUS", "AUSTRALIA", "NSW", "VIC", "QLD", "WA", "SA", "TAS", "ACT", "NT", "PTY", "LTD"]);

/** The meaningful words of a bank/phone merchant string, before any re-casing. */
export function merchantWords(raw: string): string[] {
  let s = raw.trim().replace(/\s+/g, " ");
  for (let prev = ""; prev !== s; ) {
    prev = s;
    for (const re of LEADING) s = s.replace(re, "");
  }
  let words = s.split(" ").filter(Boolean);
  // Cut at the first store number, date, time or card ("WOOLWORTHS 1234
  // NEWTOWN" → WOOLWORTHS); a suburb usually follows it.
  const cut = words.findIndex(
    (w, i) => i > 0 && (CUT.test(w) || (/^card$/i.test(w) && CUT.test(words[i + 1] ?? "")) || (/^value$/i.test(w) && /^date:?$/i.test(words[i + 1] ?? ""))),
  );
  if (cut > 0) words = words.slice(0, cut);
  for (let changed = true; changed; ) {
    changed = false;
    while (words.length > 1 && TRAILING.has(words.at(-1)!.toUpperCase())) {
      words = words.slice(0, -1);
      changed = true;
    }
    // A repeated trailing suburb: "KBC Surry Hills Surry Hills" → "KBC Surry Hills".
    const n = words.length;
    for (let k = Math.floor(n / 2); k >= 1; k--) {
      const tail = words.slice(n - k).join(" ").toLowerCase();
      const before = words.slice(n - 2 * k, n - k).join(" ").toLowerCase();
      if (tail === before && (n - 2 * k >= 1 || k >= 2)) {
        words = words.slice(0, n - k);
        changed = true;
        break;
      }
    }
  }
  return words;
}

function titleWord(w: string) {
  if (!/[AEIOUY]/i.test(w)) return w.toUpperCase(); // BP, KFC, JB
  return w.toLowerCase().replace(/(^|[-/&.])([a-z])/g, (_, sep: string, c: string) => sep + c.toUpperCase());
}

/**
 * Bank or phone merchant text → a tidy name. Strips card prefixes, dates,
 * times, store numbers, suburbs and a repeated trailing suburb:
 *   "WOOLWORTHS 1234 NEWTOWN" → "Woolworths"
 *   "V4821 28/09 7-Eleven" → "7-Eleven"
 *   "Eftpos 20/09 11:32KBC Surry Hills Surry Hills" → "KBC Surry Hills"
 * Already-tidy names are left alone. public.clean_merchant() in SQL is the same.
 */
export function cleanMerchant(raw: string): string {
  const words = merchantWords(raw);
  if (words.length === 0) return raw.trim().slice(0, 120);
  const shouting = !/[a-z]/.test(words.join(" "));
  return (shouting ? words.map(titleWord) : words).join(" ").slice(0, 120);
}

/**
 * ILIKE pattern for "Always put X in Y": the cleaned merchant name, exactly
 * (not case-sensitive). Rules are checked against the cleaned name as well as
 * the raw bank text, so this matches the merchant at any store, on any date.
 */
export function rulePatternFor(raw: string): string | null {
  const name = cleanMerchant(raw);
  if (!name) return null;
  return name.replace(/[\\%_]/g, (c) => "\\" + c);
}

/** Device tokens: random, shown once; only the sha256 is stored. */
export function generateToken(): string {
  return "het_" + randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
