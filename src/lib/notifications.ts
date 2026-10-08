// Turns Android payment notification text into a purchase.
//
// MacroDroid forwards `raw` = "[notification_title] | [notification]" plus the
// app name; all parsing happens here so a bank changing its wording is a code
// fix, not a phone re-configuration. Anything that doesn't parse is logged to
// ingest_failures (Settings → Capture log) so a pattern can be added.

export type NotificationResult =
  /** merchant null: a purchase whose notification didn't name the shop. */
  | { kind: "purchase"; cents: number; merchant: string | null; card: string | null }
  | { kind: "ignored"; reason: string }
  | { kind: "unparsed"; reason: string };

export type AppKind = "wallet" | "anz" | "nab" | "other";

export function appKind(app: string): AppKind {
  if (/wallet|google ?pay|\bgpay\b/i.test(app)) return "wallet";
  if (/\banz\b/i.test(app)) return "anz";
  if (/\bnab\b/i.test(app)) return "nab";
  return "other";
}

// Money moving that isn't a card purchase, or a purchase that didn't happen.
const NOT_A_PURCHASE: [RegExp, string][] = [
  [/declin|unsuccessful|not approved|insufficient/i, "declined"],
  [/refund|reversal|reversed|credited|cashback/i, "refund or credit"],
  [/\b(received|deposit(ed)?|incoming|paid you|sent you)\b/i, "money in"],
  [/\btransfer(red)?\b|\bpayid\b|\bosko\b|\bbpay\b/i, "transfer"],
  [/\bbalance\b|statement|payment due|due date|minimum payment|summary/i, "account alert"],
];

const AMOUNT = /(?:AU?\$|AUD\s?|\$)\s?(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/i;
const CARD_LAST4 = /(?:ending(?:\s+in)?|card\s+(?:no\.?)?|[•·*xX]{2,})\s*(\d{4})\b/i;
const CARD_NAME = /\b(?:with|using|on)\s+(?:your\s+)?((?:ANZ|NAB|Visa|Mastercard|Debit|Credit|Amex)[\w\s]*?)(?=\s*(?:[•·*xX]{2,}|ending|card|$|[.,;]))/i;
// "… at MERCHANT on your card …", "… at MERCHANT using …", "… at MERCHANT."
const AT_MERCHANT = /\bat\s+(.+?)(?=\s+(?:on|with|using|via|from|for)\s|\s+card\b|\s*[.;,](?:\s|$)|\s*$)/i;
// "… to MERCHANT …" — only used for wallet-style "Paid $x to Merchant".
const TO_MERCHANT = /\bpaid\s+(?:AU?\$|\$)?\s?[\d,.]+\s+to\s+(.+?)(?=\s+(?:on|with|using)\s|\s*[.;,](?:\s|$)|\s*$)/i;

function squash(s: string) {
  return s.replace(/\s+/g, " ").trim();
}

// Words that make up a card's name in a notification: "Visa", "ANZ Visa Debit",
// "Mastercard ••1234", "NAB Rewards Platinum Card ending 4821".
const CARD_WORDS =
  /\b(anz|nab|cba|commbank|commonwealth|westpac|st\.? george|ing|macquarie|bendigo|suncorp|up|amp|visa|mastercard|master card|amex|american express|eftpos|debit|credit|card|platinum|rewards|black|gold|classic|everyday|access|low rate|frequent flyer|qantas|velocity|ending|in)\b/gi;
const CARD_BRAND = /\b(visa|mastercard|master card|amex|american express|eftpos|debit|credit)\b|[•·*xX]{2,}\s*\d{4}|\bending(\s+in)?\s*\d{4}/i;

/** "Visa", "Visa ••1234", "ANZ Visa Debit" — a card, not a shop. */
export function looksLikeCard(s: string): boolean {
  const t = s.trim();
  if (!t || !CARD_BRAND.test(t)) return false;
  return t.replace(CARD_WORDS, "").replace(/[•·*xX]{2,}|\d{4}|[\s\-–:·.,()]/g, "") === "";
}

// Labels some notifications put in front of a name: "From: VISA", "Merchant: KFC".
const LABEL = /^(?:from|to|at|merchant|payee|paid to|payment to|purchase at|spent at|card)\s*:\s*/i;

/** "From: VISA" → "VISA". */
export function stripLabel(s: string) {
  return s.replace(LABEL, "").trim();
}

// Bank alerts laid out as fields: "A payment was made of $9.77 From: VISA card
// ending 6800 Description: Afterpay afterpay.com". The shop is the Description
// (or Merchant / Payee) field, up to the next "Field:".
const FIELD_MERCHANT =
  /\b(?:description|merchant|merchant name|payee|paid to|purchase at)\s*:\s*(.+?)(?=\s+(?:from|to|card|account|date|time|amount|reference|ref|balance|location)\s*:|\s*$)/i;

/** "Afterpay afterpay.com" → "Afterpay": a trailing web address adds nothing. */
function dropTrailingDomain(s: string) {
  const without = s.replace(/\s+(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|co|app|shop|store)(?:\.au)?(?:\/\S*)?$/i, "").trim();
  return without || s;
}

// Words that mean "this is a purchase" when a notification names no shop.
const PURCHASE_WORDS = /\b(spent|purchase|paid|payment|tap|contactless|charged|debited)\b/i;

function looksLikeAppName(s: string) {
  return /^(google )?(wallet|pay)$|^anz|^nab\b|^payment|^purchase|^transaction|^card (payment|purchase)/i.test(s);
}

export function parseNotification(raw: string, app = ""): NotificationResult {
  const text = squash(raw);
  if (!text) return { kind: "unparsed", reason: "empty notification" };

  const sep = text.indexOf(" | ");
  const title = sep >= 0 ? stripLabel(text.slice(0, sep)) : "";
  const body = sep >= 0 ? text.slice(sep + 3).trim() : text;

  for (const [re, reason] of NOT_A_PURCHASE) {
    // A wallet title is the merchant name, so only check it for other apps.
    if (re.test(body) || (appKind(app) !== "wallet" && re.test(title))) return { kind: "ignored", reason };
  }

  const amountMatch = AMOUNT.exec(body) ?? AMOUNT.exec(title);
  if (!amountMatch) return { kind: "unparsed", reason: "no amount found" };
  const cents = Math.round(Number(amountMatch[1].replace(/,/g, "")) * 100);
  if (!(cents > 0)) return { kind: "unparsed", reason: "amount is zero" };

  // Google Wallet sometimes titles the notification with the card, not the shop
  // ("Visa ••1234 | $23.50"), when the terminal didn't send a merchant name.
  const titleIsCard = looksLikeCard(title);
  const last4 = CARD_LAST4.exec(body)?.[1] ?? (titleIsCard ? CARD_LAST4.exec(title)?.[1] : undefined);
  const cardName = CARD_NAME.exec(body)?.[1]?.trim() ?? (titleIsCard ? title.replace(/[•·*xX]{2,}\s*\d{4}|ending(?:\s+in)?\s*\d{4}/i, "").trim() || undefined : undefined);
  const card = cardName && last4 ? `${cardName} ${last4}` : (last4 ?? cardName ?? null);

  const field = FIELD_MERCHANT.exec(body)?.[1];
  let merchant = (field && !looksLikeCard(field) ? dropTrailingDomain(field) : "") || (AT_MERCHANT.exec(body)?.[1] ?? TO_MERCHANT.exec(body)?.[1] ?? "");
  if (!merchant && appKind(app) === "wallet") {
    // Google Wallet: the title is the merchant, the body is "$23.50 with Visa ••1234".
    if (title && !looksLikeAppName(title) && !titleIsCard) merchant = title;
    else {
      // No usable title: "Woolworths $23.50 with Visa ••1234" → text before the
      // amount; "$23.50 · Woolworths" → text after it (minus the card part).
      const at = body.indexOf(amountMatch[0]);
      const before = body.slice(0, at).replace(/\b(paid|payment|purchase)\b/gi, "").replace(/^[\s|·•:–-]+|[\s|·•:–-]+$/g, "");
      const after = body
        .slice(at + amountMatch[0].length)
        .replace(/\b(?:with|using|on)\s+(?:your\s+)?\S.*$/i, "")
        .replace(/^[\s|·•:–-]+|[\s|·•:–-]+$/g, "");
      merchant = squash(before) || squash(after);
    }
  }
  if (!merchant && appKind(app) !== "wallet") {
    // Bank alerts like "Tap & go: $6.50 Ryde Bakehouse": the merchant follows the amount.
    const after = body.slice(body.indexOf(amountMatch[0]) + amountMatch[0].length);
    const m = /^\s*(?:[-–:]\s*)?(?:spent\s+|paid\s+)?(?:at|to)?\s*([A-Za-z][^;]*?)(?=\s+(?:on|with|using|via)\s|\s+card\b|\s*[.;](?:\s|$)|\s*$)/i.exec(after);
    if (m && !/^(was|has|is|spent|paid|made|debited|charged)\b/i.test(m[1])) merchant = m[1];
  }
  merchant = stripLabel(squash(merchant.replace(/^the\s+merchant\s+/i, ""))).replace(/[.,;:]+$/, "");
  if (!/[A-Za-z]/.test(merchant) || looksLikeCard(merchant)) merchant = "";

  if (!merchant) {
    // Still a purchase (Wallet only notifies for payments; a bank alert that says
    // "spent"/"purchase"): save it without a shop name rather than lose it.
    if (appKind(app) === "wallet" || PURCHASE_WORDS.test(text)) return { kind: "purchase", cents, merchant: null, card };
    return { kind: "unparsed", reason: "no merchant found" };
  }
  return { kind: "purchase", cents, merchant: merchant.slice(0, 200), card };
}

const FIELDS = ["raw", "app", "source", "amount", "merchant", "card", "occurred_at"];

/**
 * Reads the ingest body however it arrives. MacroDroid pastes notification text
 * straight into its JSON template, so a quote or line break in the text makes
 * invalid JSON; fall back to pulling out the known fields, then to form data.
 */
export function readIngestBody(text: string, contentType: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (/x-www-form-urlencoded/i.test(contentType)) {
    return Object.fromEntries(new URLSearchParams(trimmed));
  }
  try {
    const v = JSON.parse(trimmed);
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    // fall through to the forgiving reader
  }
  if (!trimmed.startsWith("{")) return null;
  const keys = FIELDS.join("|");
  const re = new RegExp(`"(${keys})"\\s*:\\s*(?:"([\\s\\S]*?)"|(-?[\\d.]+))\\s*(?=,\\s*"(?:${keys})"\\s*:|\\s*}\\s*$)`, "g");
  const out: Record<string, unknown> = {};
  for (const m of trimmed.matchAll(re)) out[m[1]] = m[2] !== undefined ? m[2].replace(/\\"/g, '"') : Number(m[3]);
  return Object.keys(out).length ? out : null;
}
