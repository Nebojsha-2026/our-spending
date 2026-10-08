import { NextResponse } from "next/server";
import { UUID, jsonError, readJson, requireMember } from "@/lib/api";
import { queueBudgetAlerts } from "@/lib/push";

const MAX_IDS = 1000;
const ACTIONS = ["merge", "confirm", "delete"] as const;
type Action = (typeof ACTIONS)[number];

/**
 * POST /api/transactions/bulk — act on many Needs review items at once.
 * Body: { ids: string[], action }
 *   merge    possible duplicates: merge each into the phone capture or manual
 *            entry it copies (closest in time); others are skipped. With one
 *            id and `into`, merge into that entry (from the comparison view)
 *   confirm  keep as is: mark confirmed and clear the duplicate flag
 *   delete   delete (bank rows stay deleted on re-import: deleted_bank_rows)
 * Returns { done, skipped }.
 */
export async function POST(req: Request) {
  const auth = await requireMember();
  if ("error" in auth) return auth.error;
  const body = await readJson(req);
  if (!body) return jsonError("Expected a JSON body", 400);

  const raw = Array.isArray(body.ids) ? body.ids : [];
  const ids = raw.filter((x): x is string => typeof x === "string" && UUID.test(x));
  if (ids.length === 0 || ids.length !== raw.length) return jsonError("Expected a list of transaction ids", 400);
  if (ids.length > MAX_IDS) return jsonError(`Up to ${MAX_IDS} transactions at a time`, 413);
  const action = body.action as Action;
  if (!ACTIONS.includes(action)) return jsonError(`action must be one of ${ACTIONS.join(", ")}`, 400);
  const { supabase } = auth;

  let done: number;
  const into = body.into;
  if (into !== undefined && (action !== "merge" || ids.length !== 1 || typeof into !== "string" || !UUID.test(into))) {
    return jsonError("`into` needs action merge and exactly one id", 400);
  }

  if (action === "merge" && typeof into === "string") {
    const { data, error } = await supabase.rpc("merge_duplicate_into", { p_id: ids[0], p_into: into });
    if (error) return jsonError(error.message, 400);
    done = data === true ? 1 : 0;
  } else if (action === "merge") {
    const { data, error } = await supabase.rpc("merge_duplicates", { p_ids: ids });
    if (error) return jsonError(error.message, 400);
    done = Number(data);
  } else if (action === "confirm") {
    const { data, error } = await supabase
      .from("transactions")
      .update({ status: "confirmed", review_reason: null })
      .in("id", ids)
      .select("id");
    if (error) return jsonError(error.message, 400);
    done = data.length;
  } else {
    const { data, error } = await supabase
      .from("transactions")
      .delete()
      .in("id", ids)
      .select("id");
    if (error) return jsonError(error.message, 400);
    done = data.length;
  }
  // A merge takes the bank's settled amount, which can tip a budget over.
  if (action === "merge" && done > 0) queueBudgetAlerts(supabase, req);
  return NextResponse.json({ done, skipped: ids.length - done });
}
