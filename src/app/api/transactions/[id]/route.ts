import { NextResponse } from "next/server";
import { UUID, jsonError, readJson, requireMember } from "@/lib/api";
import { learnRule } from "@/lib/learn-rule";
import { queueBudgetAlerts } from "@/lib/push";
import { parseRange } from "@/lib/rules";
import { TRANSACTION_COLUMNS, type Transaction } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

/**
 * PATCH /api/transactions/:id — edit category, merchant or note.
 * With `remember: true` ("Always put X in Y?"), also saves a merchant rule for
 * the cleaned merchant name — optionally only for amounts in
 * [min_amount_cents, max_amount_cents) — and applies it to every existing
 * transaction it matches. `learned.applied` is how many that was.
 * With `confirm: true`, marks it confirmed and clears a possible-duplicate flag
 * (Needs review → "Keep both" / "Mark as confirmed").
 */
export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!UUID.test(id)) return jsonError("Not found", 404);

  const auth = await requireMember();
  if ("error" in auth) return auth.error;
  const body = await readJson(req);
  if (!body) return jsonError("Expected a JSON body", 400);

  const patch: Partial<Pick<Transaction, "merchant" | "category_id" | "note" | "status" | "review_reason">> = {};
  if ("merchant" in body) {
    const m = typeof body.merchant === "string" ? body.merchant.trim() : "";
    if (!m || m.length > 120) return jsonError("Merchant must be 1–120 characters", 400);
    patch.merchant = m;
  }
  if ("category_id" in body) {
    const c = body.category_id;
    if (c !== null && (typeof c !== "string" || !UUID.test(c))) return jsonError("Invalid category_id", 400);
    patch.category_id = c;
  }
  if ("note" in body) {
    if (body.note !== null && typeof body.note !== "string") return jsonError("Invalid note", 400);
    const n = typeof body.note === "string" ? body.note.trim() : "";
    if (n.length > 500) return jsonError("Note must be 500 characters or fewer", 400);
    patch.note = n || null;
  }
  if (body.confirm === true) {
    patch.status = "confirmed";
    patch.review_reason = null;
  }
  if (Object.keys(patch).length === 0) return jsonError("Nothing to update", 400);
  const range = parseRange(body);
  if ("error" in range) return jsonError(range.error, 400);

  const { data, error } = await auth.supabase
    .from("transactions")
    .update(patch)
    .eq("id", id)
    .select(TRANSACTION_COLUMNS)
    .maybeSingle<Transaction>();
  if (error) return jsonError(error.code === "23503" ? "Unknown category" : error.message, 400);
  if (!data) return jsonError("Not found", 404);

  let learned: { pattern: string; applied: number } | null = null;
  if (body.remember === true && data.category_id) {
    const result = await learnRule(auth.supabase, auth.me.household_id, {
      raw: data.merchant_raw ?? data.merchant,
      cleanName: data.merchant,
      categoryId: data.category_id,
      range,
    });
    if ("error" in result) return jsonError(`Saved, but couldn't create the rule: ${result.error}`, 500);
    learned = { pattern: result.pattern, applied: result.applied };
  }
  if (patch.category_id) queueBudgetAlerts(auth.supabase, req);
  return NextResponse.json({ transaction: data, learned });
}

/**
 * DELETE /api/transactions/:id — any transaction (test entries, duplicates,
 * mistakes). A deleted bank row isn't imported again from a later CSV
 * (deleted_bank_rows).
 */
export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!UUID.test(id)) return jsonError("Not found", 404);

  const auth = await requireMember();
  if ("error" in auth) return auth.error;

  const { data, error } = await auth.supabase
    .from("transactions")
    .delete()
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) return jsonError(error.message, 400);
  if (!data) return jsonError("Not found", 404);
  return NextResponse.json({ id });
}
