import { NextResponse } from "next/server";
import { jsonError, readJson, requireMember } from "@/lib/api";
import { sendPush, vapidFor, type PushTarget } from "@/lib/push";

/**
 * POST /api/push/test — sends a test notification to this phone.
 * Body: { endpoint } (the browser's push subscription endpoint)
 * Returns { sent: true }, or an error saying why it didn't go.
 */
export async function POST(req: Request) {
  const auth = await requireMember();
  if ("error" in auth) return auth.error;
  const vapid = vapidFor(req);
  if (!vapid) return jsonError("Budget alerts aren't set up on this deployment yet", 503);
  const body = await readJson(req);
  if (typeof body?.endpoint !== "string") return jsonError("Expected the subscription endpoint", 400);

  const { data: target } = await auth.supabase
    .from("push_subscriptions")
    .select("endpoint,p256dh,auth")
    .eq("endpoint", body.endpoint)
    .eq("member_id", auth.me.id)
    .maybeSingle<PushTarget>();
  if (!target) return jsonError("Alerts aren't on for this phone; turn them on first", 404);

  const { sent, errors } = await sendPush(auth.supabase, vapid, [target], {
    title: "Budget alerts are on",
    body: "You'll get a notification like this when a category reaches 80% and 100% of its monthly budget.",
    url: "/budgets",
    // A fresh tag each time: Android silently replaces a notification that
    // shares its tag with one still in the shade.
    tag: `budget-test-${Date.now()}`,
  });
  if (!sent) return jsonError(`Couldn't send: ${errors.join("; ")}`, 502);
  return NextResponse.json({ sent: true });
}
