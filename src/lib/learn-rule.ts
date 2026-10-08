import type { SupabaseClient } from "@supabase/supabase-js";
import { rulePatternFor } from "./ingest";
import type { AmountRange } from "./rules";

/**
 * "Always put X in Y": save a merchant rule against the cleaned merchant name
 * (and optional amount range), then apply it to every existing transaction it
 * now decides. Returns how many transactions it applied to.
 */
export async function learnRule(
  supabase: SupabaseClient,
  householdId: string,
  opts: { raw: string; cleanName: string; categoryId: string; range: AmountRange },
): Promise<{ pattern: string; ruleId: string; applied: number } | { error: string }> {
  const pattern = rulePatternFor(opts.raw);
  if (!pattern) return { error: "There's no merchant name to remember" };
  const { min_amount_cents: min, max_amount_cents: max } = opts.range;

  let find = supabase.from("merchant_rules").select("id").eq("household_id", householdId).eq("match_pattern", pattern);
  find = min == null ? find.is("min_amount_cents", null) : find.eq("min_amount_cents", min);
  find = max == null ? find.is("max_amount_cents", null) : find.eq("max_amount_cents", max);
  const { data: existing, error: findError } = await find.limit(1);
  if (findError) return { error: findError.message };

  const rule = {
    match_pattern: pattern,
    clean_name: opts.cleanName.slice(0, 80),
    category_id: opts.categoryId,
    min_amount_cents: min,
    max_amount_cents: max,
  };
  const saved = existing?.length
    ? await supabase.from("merchant_rules").update(rule).eq("id", existing[0].id).select("id").single<{ id: string }>()
    : await supabase.from("merchant_rules").insert({ household_id: householdId, priority: 100, ...rule }).select("id").single<{ id: string }>();
  if (saved.error) return { error: saved.error.message };

  const { data: applied, error } = await supabase.rpc("apply_merchant_rule", { p_rule_id: saved.data.id });
  if (error) return { error: error.message };
  return { pattern, ruleId: saved.data.id, applied: Number(applied) };
}
