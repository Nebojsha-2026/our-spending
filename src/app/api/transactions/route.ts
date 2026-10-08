import { NextResponse } from "next/server";
import { UUID, jsonError, readJson, requireMember } from "@/lib/api";
import { queueBudgetAlerts } from "@/lib/push";
import { TRANSACTION_COLUMNS, type Category, type Transaction } from "@/lib/types";

const MAX_CENTS = 100_000_000; // $1,000,000

/**
 * POST /api/transactions — manual quick-add.
 * Body: { amount_cents: positive integer (the amount spent), member_id,
 *         category_id?, merchant?, note?, occurred_at? }
 */
export async function POST(req: Request) {
  const auth = await requireMember();
  if ("error" in auth) return auth.error;
  const { supabase, me } = auth;

  const body = await readJson(req);
  if (!body) return jsonError("Expected a JSON body", 400);

  const amount = body.amount_cents;
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0 || amount > MAX_CENTS) {
    return jsonError("amount_cents must be a positive whole number of cents", 400);
  }

  const memberId = body.member_id ?? me.id;
  if (typeof memberId !== "string" || !UUID.test(memberId)) return jsonError("Invalid member_id", 400);

  const categoryId = body.category_id ?? null;
  if (categoryId !== null && (typeof categoryId !== "string" || !UUID.test(categoryId))) {
    return jsonError("Invalid category_id", 400);
  }

  let category: Pick<Category, "id" | "name"> | null = null;
  if (categoryId) {
    const { data } = await supabase.from("categories").select("id,name").eq("id", categoryId).maybeSingle();
    if (!data) return jsonError("Unknown category", 400);
    category = data;
  }

  const merchantInput = typeof body.merchant === "string" ? body.merchant.trim().slice(0, 120) : "";
  const merchant = merchantInput || category?.name || "Manual entry";
  const note = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 500) : null;

  let occurredAt: string | undefined;
  if (body.occurred_at !== undefined) {
    const t = typeof body.occurred_at === "string" ? Date.parse(body.occurred_at) : NaN;
    if (Number.isNaN(t)) return jsonError("Invalid occurred_at", 400);
    occurredAt = new Date(t).toISOString();
  }

  const { data, error } = await supabase
    .from("transactions")
    .insert({
      household_id: me.household_id,
      member_id: memberId,
      amount_cents: -amount, // spending is negative
      merchant,
      category_id: categoryId,
      note,
      source: "manual",
      status: "confirmed", // typed in by hand, nothing to confirm against
      ...(occurredAt && { occurred_at: occurredAt }),
    })
    .select(TRANSACTION_COLUMNS)
    .single<Transaction>();

  if (error) {
    // 23503: member/category isn't in this household (composite foreign keys).
    return jsonError(error.code === "23503" ? "Unknown member or category" : error.message, 400);
  }
  if (categoryId) queueBudgetAlerts(supabase, req);
  return NextResponse.json(
    { id: data.id, merchant: data.merchant, category: category?.name ?? null, transaction: data },
    { status: 201 },
  );
}
