import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { cleanMerchant, hashToken, parseAmount } from "@/lib/ingest";
import { formatCents } from "@/lib/money";
import { parseNotification, readIngestBody } from "@/lib/notifications";
import { unknownCardReason } from "@/lib/capture-summary";
import { queueBudgetAlerts, queueCaptureSummary } from "@/lib/push";
import { supabaseEnv } from "@/lib/supabase/env";

/**
 * POST /api/ingest — phone automations post a purchase here.
 *   Authorization: Bearer <device token>
 *
 * iPhone Shortcut:
 *   { "amount": "$23.50", "merchant": "WOOLWORTHS 1234 NEWTOWN", "card": "ANZ Visa",
 *     "source": "apple_pay", "occurred_at": "2026-10-06T18:40:00+11:00" }
 * Android / MacroDroid (the server parses the notification):
 *   { "raw": "[notification_title] | [notification]", "app": "[app_name]", "source": "android" }
 *
 * Returns { id, merchant, category, amount, duplicate, message } — `message` is
 * ready for a phone notification. Notifications that aren't purchases, can't
 * be read, or name a card the household hasn't saved are logged to
 * Settings → Capture log instead.
 *
 * Runs with the public key and no user session: the database functions check
 * the token hash and write only to that token's household.
 */
export async function POST(req: Request) {
  const token = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "")?.[1];
  if (!token) return jsonError("Missing Authorization: Bearer <device token>", 401);
  const tokenHash = hashToken(token);

  const body = readIngestBody(await req.text().catch(() => ""), req.headers.get("content-type") ?? "");
  if (!body) return jsonError("Expected a JSON body", 400);

  const { url, key } = supabaseEnv();
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const app = str(body.app, 80);
  const source = body.source === undefined ? (body.raw !== undefined ? "android" : "apple_pay") : body.source;
  if (source !== "apple_pay" && source !== "android") return jsonError("source must be apple_pay or android", 400);

  /** Logs the text to ingest_failures (checks the token too). */
  async function fail(status: number, reason: string, raw: string, extra: Record<string, unknown> = {}) {
    const { error } = await supabase.rpc("log_ingest_failure", {
      p_token_hash: tokenHash,
      p_app: app || source,
      p_raw: raw,
      p_reason: reason,
    });
    if (error?.code === "28000") return jsonError("Invalid or revoked device token", 401);
    queueCaptureSummary(supabase, req, tokenHash);
    return NextResponse.json({ error: reason, logged: !error, ...extra }, { status });
  }

  let cents: number | null;
  /** null: the notification didn't name the shop (saved as "Card payment"). */
  let merchantRaw: string | null;
  let card: string | null;
  let captureText: string | null = null;
  if (body.amount === undefined && body.raw !== undefined) {
    const raw = str(body.raw, 1000);
    const parsed = parseNotification(raw, app);
    if (parsed.kind === "ignored") return fail(200, `Ignored: ${parsed.reason}`, raw, { ignored: true });
    if (parsed.kind === "unparsed") return fail(422, `Couldn't read notification: ${parsed.reason}`, raw);
    cents = parsed.cents;
    merchantRaw = parsed.merchant;
    card = parsed.card;
    // Kept on the transaction (and in its note when it named no shop), so a
    // wrong name can be checked against what the phone actually sent.
    captureText = raw;
  } else {
    cents = parseAmount(body.amount);
    merchantRaw = str(body.merchant, 200);
    card = str(body.card, 80) || null;
    if (cents === null) {
      return fail(400, `Couldn't read an amount from ${JSON.stringify(body.amount ?? null)}`, JSON.stringify(body).slice(0, 1000));
    }
  }

  // Forgiving: a missing or unreadable time means "now".
  const parsedAt = typeof body.occurred_at === "string" ? Date.parse(body.occurred_at) : NaN;
  const occurredAt = new Date(Number.isNaN(parsedAt) ? Date.now() : parsedAt).toISOString();

  const args = {
    p_token_hash: tokenHash,
    p_amount_cents: -cents, // spending is negative
    p_merchant_raw: merchantRaw,
    p_merchant_fallback: merchantRaw ? cleanMerchant(merchantRaw) : "Card payment",
    p_card: card,
    p_source: source,
    p_occurred_at: occurredAt,
  };
  let { data, error } = await supabase.rpc("ingest_transaction", { ...args, p_capture_text: captureText });
  // Database not migrated yet (no p_capture_text): save it without the text.
  if (error?.code === "PGRST202") ({ data, error } = await supabase.rpc("ingest_transaction", args));

  if (error) {
    if (error.code === "28000") return jsonError("Invalid or revoked device token", 401);
    if (error.code === "54000") return jsonError(error.message, 429);
    if (error.code === "22023") return jsonError(error.message, 400);
    console.error("ingest failed", error);
    return jsonError("Couldn't save the transaction", 500);
  }

  // A card the household hasn't saved (e.g. an Afterpay card in Wallet).
  const skipped = data as { skipped?: string; card?: string };
  if (skipped.skipped === "unknown_card") {
    const raw = captureText ?? JSON.stringify(body).slice(0, 1000);
    return fail(200, unknownCardReason(skipped.card ?? card ?? ""), raw, {
      skipped: true,
      message: `Not logged: ${skipped.card ?? "that card"} isn't one of your cards`,
    });
  }

  const r = data as { id: string; merchant: string; category: string | null; duplicate: boolean };
  queueCaptureSummary(supabase, req, tokenHash);
  if (!r.duplicate && r.category) queueBudgetAlerts(supabase, req, tokenHash);
  const amount = formatCents(cents);
  return NextResponse.json(
    {
      ...r,
      amount,
      message: !merchantRaw && !r.duplicate
        ? `Logged ${amount} · shop name to come from your bank`
        : `Logged ${amount} · ${r.category ?? `${r.merchant} (needs a category)`}`,
    },
    { status: r.duplicate ? 200 : 201 },
  );
}
