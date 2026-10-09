"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useHousehold } from "@/components/HouseholdProvider";
import { SettingsScreen } from "@/components/settings";
import { Card, ErrorNote, List, ListRow, PersonDot, PrimaryButton, SecondaryButton, SectionLabel } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

// Inlined at build time by next.config.ts; empty when alerts aren't set up.
const PUBLIC_KEY = process.env.PUSH_PUBLIC_KEY ?? "";

interface Subscription {
  id: string;
  member_id: string;
  endpoint: string;
  label: string | null;
}

type Support = "ok" | "install-first" | "unsupported" | "not-configured";

function support(): Support {
  if (!PUBLIC_KEY) return "not-configured";
  if ("serviceWorker" in navigator && "PushManager" in window && "Notification" in window) return "ok";
  // iPhone/iPad Safari only offers push to apps added to the Home Screen.
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return ios ? "install-first" : "unsupported";
}

function deviceLabel() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) return "iPad";
  if (/Android/.test(ua)) return "Android phone";
  if (/Mac/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows PC";
  return "Browser";
}

/**
 * The service worker, made current: a phone can still be running a copy from
 * before budget alerts, which receives pushes but doesn't show them.
 * (Registered here too so alerts can be tried in `next dev`.)
 */
async function registration() {
  const reg =
    (await navigator.serviceWorker.getRegistration("/")) ??
    (await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }));
  await reg.update().catch(() => {});
  await navigator.serviceWorker.ready;
  return (await navigator.serviceWorker.getRegistration("/")) ?? reg;
}

function keyBytes(base64url: string) {
  const b64 = base64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(base64url.length / 4) * 4, "=");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/** This browser's push state and the household's saved subscriptions. */
async function readState() {
  const s = support();
  let endpoint: string | null = null;
  if (s === "ok") {
    const reg = await navigator.serviceWorker.getRegistration("/");
    endpoint = (await reg?.pushManager.getSubscription())?.endpoint ?? null;
  }
  const { data, error } = await createClient()
    .from("push_subscriptions")
    .select("id,member_id,endpoint,label")
    .order("created_at")
    .returns<Subscription[]>();
  return {
    subs: data ?? [],
    error: error?.message ?? null,
    state: { support: s, endpoint, blocked: s === "ok" && Notification.permission === "denied" },
  };
}

/** Budget alerts: web push when a category reaches 80% and 100% of its monthly budget. */
export default function AlertsSettings() {
  const { me, memberById, labelFor, categories } = useHousehold();
  const [state, setState] = useState<{ support: Support; endpoint: string | null; blocked: boolean } | null>(null);
  const [subs, setSubs] = useState<Subscription[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // What the service worker reported when a push arrived while this screen is open.
  const [received, setReceived] = useState<{ result: string; showing: number | null; permission: string | null } | null>(null);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === "push-received") {
        setReceived({ result: String(e.data.result ?? "shown"), showing: e.data.showing ?? null, permission: e.data.permission ?? null });
      }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, []);

  const load = useCallback(
    () =>
      readState().then(
        (r) => {
          if (r.error) setError(r.error);
          setSubs(r.subs);
          setState(r.state);
        },
        (e: Error) => setError(e.message),
      ),
    [],
  );
  useEffect(() => {
    load();
  }, [load]);

  // On for this phone = the browser has a subscription and the app has it saved.
  const on = Boolean(state?.endpoint && subs?.some((s) => s.endpoint === state.endpoint));
  const budgets = categories.filter((c) => c.counts_as_spending && c.monthly_budget_cents).length;

  async function step(fn: () => Promise<string | null>) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      setNote(await fn());
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const turnOn = () =>
    step(async () => {
      if ((await Notification.requestPermission()) !== "granted") {
        throw new Error("Notifications weren't allowed. Allow them for this app in your phone's settings, then try again.");
      }
      const reg = await registration();
      await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      // Subscribed with an older key (the app was redeployed with new keys): start over.
      const current = sub?.options.applicationServerKey;
      if (sub && current && new Uint8Array(current).join() !== keyBytes(PUBLIC_KEY).join()) {
        await sub.unsubscribe();
        sub = null;
      }
      sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(PUBLIC_KEY) });
      const json = sub.toJSON();
      const { error } = await createClient().rpc("save_push_subscription", {
        p_endpoint: sub.endpoint,
        p_p256dh: json.keys?.p256dh ?? "",
        p_auth: json.keys?.auth ?? "",
        p_label: deviceLabel(),
      });
      if (error) throw new Error(error.message);
      return "Alerts are on for this phone.";
    });

  const turnOff = () =>
    step(async () => {
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await createClient().rpc("forget_push_subscription", { p_endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      return "Alerts are off for this phone.";
    });

  const sendTest = () =>
    step(async () => {
      setReceived(null);
      await registration();
      const res = await fetch("/api/push/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: state?.endpoint }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Couldn't send the test");
      return "Test sent. It should appear in a few seconds.";
    });

  // Shows a notification straight from this phone, no server or push service:
  // tells "the phone can't show notifications" apart from "the push never came".
  const localTest = () =>
    step(async () => {
      if (Notification.permission !== "granted") throw new Error("Notifications aren't allowed for this app yet.");
      const reg = await registration();
      await reg.showNotification("Test from this phone", {
        body: "If you can see this, the phone shows the app's notifications.",
        icon: "/icons/192",
        tag: "local-test",
        data: { url: "/settings/alerts" },
      });
      return "Shown on this phone (no server involved).";
    });

  return (
    <SettingsScreen title="Budget alerts">
      <div className="px-1 text-[13px] text-muted">
        When a category reaches <strong>80%</strong> and <strong>100%</strong> of its monthly budget, every phone with alerts on gets a
        notification, whoever spent it. Each alert goes out once a month. On Mondays they also get a short note if any of last
        week&apos;s payments weren&apos;t logged (see the Capture log).{" "}
        {budgets === 0 ? (
          <>
            You haven&apos;t set any budgets yet: <Link href="/settings/categories">set them in Categories &amp; budgets</Link>.
          </>
        ) : (
          <Link href="/settings/categories">Change budgets</Link>
        )}
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}
      {note && <div className="px-1 text-[14px] font-semibold text-accent-link">{note}</div>}

      {state?.support === "not-configured" && (
        <ErrorNote>
          Alerts aren&apos;t set up on this copy of the app yet. They switch on by themselves on the next deploy when the
          database is connected; see the setup guide (Budget alerts) for other options.
        </ErrorNote>
      )}
      {state?.support === "install-first" && (
        <Card className="gap-1 px-[14px] py-3 text-[14px]">
          <div className="font-semibold">Add the app to your Home Screen first</div>
          <div className="text-muted">
            On iPhone, notifications only work in the installed app: in Safari tap Share → <strong>Add to Home Screen</strong>,
            open it from there (iOS 16.4 or later) and come back to this screen.
          </div>
        </Card>
      )}
      {state?.support === "unsupported" && <ErrorNote>This browser can&apos;t show notifications. Try Chrome, Edge, Firefox or Safari.</ErrorNote>}
      {state?.blocked && !on && (
        <ErrorNote>
          Notifications are blocked for this app. Allow them in the phone&apos;s settings (iPhone: Settings → Notifications;
          Android: long-press the app icon → App info → Notifications), then turn alerts on.
        </ErrorNote>
      )}

      {state?.support === "ok" && (
        <div className="flex flex-col gap-2">
          {on ? (
            <>
              <SecondaryButton onClick={sendTest} disabled={busy}>
                Send a test notification
              </SecondaryButton>
              {received && (
                <div className="flex flex-col gap-1 rounded-[12px] bg-surface px-3 py-2 text-[13px]">
                  <div className="font-semibold text-accent-link">This phone received the test.</div>
                  <div className="text-muted">
                    Background: {received.result}
                    {received.showing !== null && ` · ${received.showing} of the app's notifications showing`}
                    {received.permission && ` · permission ${received.permission}`}
                  </div>
                  {received.result === "shown" && (
                    <div className="text-muted">
                      If you can&apos;t see it, Android is hiding it: check the app&apos;s notification categories (long-press the
                      icon → App info → Notifications).
                    </div>
                  )}
                </div>
              )}
              <SecondaryButton onClick={localTest} disabled={busy}>
                Show a test on this phone only
              </SecondaryButton>
              <div className="px-1 text-[12px] text-muted">
                Nothing arrives? &ldquo;Show a test on this phone only&rdquo; skips the server: if that one appears but the
                sent test doesn&apos;t, turn alerts off and on again for this phone.
              </div>
              <SecondaryButton onClick={turnOff} disabled={busy} danger>
                Turn off for this phone
              </SecondaryButton>
            </>
          ) : (
            <PrimaryButton onClick={turnOn} disabled={busy}>
              Turn on for this phone
            </PrimaryButton>
          )}
        </div>
      )}

      {subs && subs.length > 0 && (
        <div className="flex flex-col gap-2">
          <SectionLabel>Phones with alerts on</SectionLabel>
          <List>
            {subs.map((s) => (
              <ListRow
                key={s.id}
                leading={<PersonDot label={labelFor(s.member_id)} color={memberById.get(s.member_id)?.colour ?? "#5B6167"} />}
                title={s.label ?? "Phone"}
                subtitle={`${labelFor(s.member_id)}${s.endpoint === state?.endpoint && s.member_id === me.id ? " · this phone" : ""}`}
              />
            ))}
          </List>
        </div>
      )}
    </SettingsScreen>
  );
}
