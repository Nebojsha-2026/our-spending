import { NextResponse } from "next/server";
import { UUID, jsonError, readJson, requireMember } from "@/lib/api";
import { learnRule } from "@/lib/learn-rule";
import { queueBudgetAlerts } from "@/lib/push";
import { parseRange } from "@/lib/rules";

const MAX_IDS = 1000;

/**
 * POST /api/transactions/categorise — set the category for a group of
 * transactions in one go (Needs review, grouped by merchant).
 * Body: { ids: string[], category_id, remember?: boolean, min_amount_cents?, max_amount_cents? }
 *   remember false: just these transactions
 *   remember true: save a merchant rule for the group's cleaned merchant name
 *                  (optionally only for an amount range) and apply it to every
 *                  existing match. With no amount range, every transaction in
 *                  the group gets the category too.
 * Returns { applied: number } — how many transactions now have the category.
 */
export async function POST(req: Request) {
  const auth = await requireMember();
  if ("error" in auth) return auth.error;
  const body = await readJson(req);
  if (!body) return jsonError("Expected a JSON body", 400);

  const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string" && UUID.test(x)) : [];
  if (ids.length === 0 || ids.length !== (body.ids as unknown[]).length) return jsonError("Expected a list of transaction ids", 400);
  if (ids.length > MAX_IDS) return jsonError(`Up to ${MAX_IDS} transactions at a time`, 413);
  const categoryId = body.category_id;
  if (typeof categoryId !== "string" || !UUID.test(categoryId)) return jsonError("Choose a category", 400);
  const range = parseRange(body);
  if ("error" in range) return jsonError(range.error, 400);
  const { supabase, me } = auth;

  let applied = 0;
  const anyAmount = range.min_amount_cents == null && range.max_amount_cents == null;
  if (body.remember === true) {
    const { data: sample, error } = await supabase
      .from("transactions")
      .select("merchant_raw,merchant")
      .in("id", ids)
      .order("occurred_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ merchant_raw: string | null; merchant: string }>();
    if (error) return jsonError(error.message, 400);
    if (!sample) return jsonError("Not found", 404);
    const learned = await learnRule(supabase, me.household_id, {
      raw: sample.merchant_raw ?? sample.merchant,
      cleanName: sample.merchant,
      categoryId,
      range,
    });
    if ("error" in learned) return jsonError(`Couldn't create the rule: ${learned.error}`, 500);
    applied = learned.applied;
    queueBudgetAlerts(supabase, req);
    if (!anyAmount) return NextResponse.json({ applied, pattern: learned.pattern });
  }

  // The group itself (all of it when there's no amount range), minus any the rule already set.
  let update = supabase.from("transactions").update({ category_id: categoryId }).in("id", ids);
  if (body.remember === true) update = update.or(`category_id.is.null,category_id.neq.${categoryId}`);
  const { data, error } = await update.select("id");
  if (error) return jsonError(error.code === "23503" ? "Unknown category" : error.message, 400);
  if (body.remember !== true) queueBudgetAlerts(supabase, req);
  return NextResponse.json({ applied: applied + data.length });
}
