// Sends budget alerts by web push. Server only: route handlers import this,
// never client components (it holds the private key).
import type { SupabaseClient } from "@supabase/supabase-js";
import { after } from "next/server";
import webpush from "web-push";
import { budgetAlertMessage, type BudgetAlert, type PushMessage } from "./budget-alerts";
import { sydneyDate } from "./periods";

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

interface Vapid {
  subject: string;
  publicKey: string;
  privateKey: string;
}

/**
 * The key pair next.config.ts inlined at build time, or null when alerts
 * aren't set up. The subject tells push services who to contact: VAPID_SUBJECT
 * (a mailto: or https: URL) if set, otherwise this app's own address.
 */
export function vapidFor(req: Request): Vapid | null {
  const publicKey = process.env.PUSH_PUBLIC_KEY;
  const privateKey = process.env.PUSH_PRIVATE_KEY;
  if (!publicKey || !privateKey) return null;
  return { subject: process.env.VAPID_SUBJECT || new URL(req.url).origin, publicKey, privateKey };
}

/**
 * Sends one message to each target. Subscriptions the push service says are
 * gone (the app was removed, notifications were reset) are forgotten.
 */
export async function sendPush(supabase: SupabaseClient, vapid: Vapid, targets: PushTarget[], message: PushMessage) {
  let sent = 0;
  const errors: string[] = [];
  await Promise.all(
    targets.map(async (t) => {
      try {
        await webpush.sendNotification({ endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } }, JSON.stringify(message), {
          vapidDetails: vapid,
          TTL: 12 * 60 * 60, // a phone that's off for the night still gets it
          // Android holds back "normal" pushes while the phone is idle; budget
          // alerts are worth waking it for. (iPhone shows either right away.)
          urgency: "high",
        });
        sent++;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await supabase.rpc("forget_push_subscription", { p_endpoint: t.endpoint });
          errors.push("subscription expired");
        } else {
          errors.push(status ? `push service answered ${status}` : (e as Error).message);
        }
      }
    }),
  );
  return { sent, errors };
}

/**
 * Call after anything that adds spending or changes a category. Once the
 * response has gone out, sends any 80% / 100% budget alerts that are now due
 * to every phone in the household with alerts on. `tokenHash` identifies the
 * household for phone captures, which have no user session.
 */
export function queueBudgetAlerts(supabase: SupabaseClient, req: Request, tokenHash?: string) {
  const vapid = vapidFor(req);
  if (!vapid) return;
  after(async () => {
    try {
      const { data, error } = await supabase.rpc("claim_budget_alerts", { p_token_hash: tokenHash ?? null });
      if (error) throw error;
      const { alerts, subscriptions } = data as { alerts: BudgetAlert[]; subscriptions: PushTarget[] };
      const today = sydneyDate();
      for (const alert of alerts) {
        const { errors } = await sendPush(supabase, vapid, subscriptions, budgetAlertMessage(alert, today));
        if (errors.length) console.warn("budget alert not delivered everywhere:", errors.join("; "));
      }
    } catch (e) {
      console.error("budget alerts failed", e);
    }
  });
}
