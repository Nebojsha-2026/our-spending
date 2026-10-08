"use client";

import { useCallback, useEffect, useState } from "react";
import { useHousehold } from "@/components/HouseholdProvider";
import { SettingsScreen, useAction } from "@/components/settings";
import {
  ErrorNote,
  Field,
  List,
  ListRow,
  PersonDot,
  PrimaryButton,
  SecondaryButton,
  SectionLabel,
  Segmented,
  Sheet,
  inputClass,
} from "@/components/ui";
import { macroFile } from "@/lib/macrodroid";
import { TZ } from "@/lib/periods";
import { PROJECT } from "@/lib/project";
import { createClient } from "@/lib/supabase/client";
import type { DeviceToken } from "@/lib/types";

const when = new Intl.DateTimeFormat("en-AU", { timeZone: TZ, day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

// MacroDroid magic text; the server parses the notification.
const ANDROID_BODY = '{"raw": "[notification_title] | [notification]", "app": "[app_name]", "source": "android"}';

function lastUsed(t: DeviceToken) {
  if (t.revoked_at) return `Revoked ${when.format(new Date(t.revoked_at))}`;
  return t.last_used_at ? `Last used ${when.format(new Date(t.last_used_at))}` : "Not used yet";
}

export default function DevicesSettings() {
  const { memberById, labelFor } = useHousehold();
  const [tokens, setTokens] = useState<DeviceToken[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<DeviceToken | "new" | null>(null);

  const load = useCallback(() => {
    createClient()
      .from("device_tokens")
      .select("id,member_id,label,last_used_at,revoked_at,created_at")
      .order("created_at", { ascending: false })
      .returns<DeviceToken[]>()
      .then(({ data, error }) => (error ? setError(error.message) : setTokens(data)));
  }, []);
  useEffect(load, [load]);

  const active = tokens?.filter((t) => !t.revoked_at) ?? [];
  const revoked = tokens?.filter((t) => t.revoked_at) ?? [];
  const row = (t: DeviceToken) => (
    <ListRow
      key={t.id}
      leading={<PersonDot label={labelFor(t.member_id)} color={memberById.get(t.member_id)?.colour ?? "#5B6167"} />}
      title={t.label}
      subtitle={`${labelFor(t.member_id)} · ${lastUsed(t)}`}
      onClick={t.revoked_at ? undefined : () => setSheet(t)}
      disabled={Boolean(t.revoked_at)}
    />
  );

  return (
    <SettingsScreen title="Devices">
      <div className="px-1 text-[13px] text-muted">
        Each phone automation gets its own token. Purchases it sends are tagged to that person and show up in Activity
        straight away.
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
      {active.length > 0 && <List>{active.map(row)}</List>}
      <SecondaryButton onClick={() => setSheet("new")}>Add a phone</SecondaryButton>
      <List>
        <ListRow href="/settings/capture-log" title="Capture log" subtitle="Notifications that weren't saved, and why" />
      </List>
      {revoked.length > 0 && (
        <div className="flex flex-col gap-2">
          <SectionLabel>Revoked</SectionLabel>
          <List>{revoked.map(row)}</List>
        </div>
      )}
      {sheet === "new" && <NewDeviceSheet onDone={() => { setSheet(null); load(); }} />}
      {sheet && sheet !== "new" && <RevokeSheet token={sheet} onDone={() => { setSheet(null); load(); }} />}
    </SettingsScreen>
  );
}

function NewDeviceSheet({ onDone }: { onDone: () => void }) {
  const { me, members, labelFor, memberById } = useHousehold();
  const [memberId, setMemberId] = useState(me.id);
  const [kind, setKind] = useState<"iphone" | "android">("iphone");
  const [label, setLabel] = useState(`${me.display_name}'s iPhone`);
  const [touched, setTouched] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [origin] = useState(() => (typeof window === "undefined" ? "" : window.location.origin));

  function relabel(id: string, k: "iphone" | "android") {
    if (!touched) setLabel(`${memberById.get(id)?.display_name ?? ""}'s ${k === "iphone" ? "iPhone" : "Android"}`);
  }

  async function create() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/devices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label, member_id: memberId }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(body.error ?? "Couldn't create the token");
    setToken(body.token);
  }

  async function copy(what: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
    } catch {
      setCopied(null);
    }
  }

  function downloadMacro() {
    const url = URL.createObjectURL(macroFile({ url: `${origin}/api/ingest`, token: token! }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "our-spending.macro";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    setCopied("macro");
  }

  if (token) {
    const values: [string, string, string][] = [
      ["URL", `${origin}/api/ingest`, "Copy URL"],
      ["Authorization header", `Bearer ${token}`, "Copy header"],
      ...(kind === "android"
        ? ([["Request body", ANDROID_BODY, "Copy body"]] as [string, string, string][])
        : []),
    ];
    return (
      <Sheet title={label} open onClose={onDone}>
        <div className="rounded-[14px] bg-warn-bg px-[14px] py-3 text-[14px] text-warn-ink">
          Copy the token now. It won&apos;t be shown again; if you lose it, revoke it and add the phone again.
        </div>
        {kind === "android" && (
          <div className="flex flex-col gap-2 text-[13px] text-muted">
            <div className="font-semibold text-ink">On this Android phone</div>
            <ol className="flex list-decimal flex-col gap-1 pl-5">
              <li>
                Install <strong>MacroDroid</strong> from the Play Store. Allow its <strong>Notification access</strong>, and set
                its battery use to <strong>Unrestricted</strong> (Settings → Apps → MacroDroid).
              </li>
              <li>Tap the button below, then open the downloaded file with MacroDroid and tap Import.</li>
              <li>
                Turn on payment notifications in Google Wallet, and purchase notifications in your bank&apos;s app if it has
                them. Banks other than ANZ, NAB, CommBank and Westpac: add your bank&apos;s app to the macro&apos;s trigger.
              </li>
            </ol>
            <PrimaryButton onClick={downloadMacro}>{copied === "macro" ? "Downloaded" : "Download the MacroDroid macro"}</PrimaryButton>
            <div>
              Can&apos;t find the file? In MacroDroid: ⋮ → Export / Import → Import, and pick <em>our-spending.macro</em> from
              Downloads. It already contains this phone&apos;s token, so keep it to yourself.
            </div>
          </div>
        )}

        {kind === "iphone" && PROJECT.iphoneShortcutUrl && (
          <div className="flex flex-col gap-2 text-[13px] text-muted">
            <div className="font-semibold text-ink">On the iPhone</div>
            <ol className="flex list-decimal flex-col gap-1 pl-5">
              <li>
                Tap <strong>Get the Shortcut</strong> → Add Shortcut. When it asks, paste the URL and the Authorization header
                below.
              </li>
              <li>
                Shortcuts → Automation → + → <strong>Transaction</strong>: pick your cards, choose <strong>Run Immediately</strong>,
                tap Next and pick the <em>Our spending</em> shortcut.
              </li>
            </ol>
            <a
              href={PROJECT.iphoneShortcutUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-[54px] items-center justify-center rounded-[16px] bg-accent text-[16px] font-semibold text-white hover:text-white"
            >
              Get the Shortcut
            </a>
          </div>
        )}

        <details className="flex flex-col gap-3" open={kind === "iphone" && !PROJECT.iphoneShortcutUrl}>
          <summary className="cursor-pointer text-[13px] font-semibold text-accent-link">
            {kind === "android" || PROJECT.iphoneShortcutUrl ? "Values to paste, and setting it up by hand" : "Values to paste"}
          </summary>
          <div className="mt-3 flex flex-col gap-3">
            {values.map(([name, value, copyLabel]) => (
              <div key={name} className="flex flex-col gap-1">
                <div className="text-[12px] text-muted">{name}</div>
                <div className="rounded-[12px] border border-line bg-surface px-[14px] py-3 font-num text-[13px] break-all">{value}</div>
                <SecondaryButton onClick={() => copy(name, value)}>{copied === name ? "Copied" : copyLabel}</SecondaryButton>
              </div>
            ))}
            {kind === "iphone" ? (
              <div className="flex flex-col gap-2 text-[13px] text-muted">
                <div className="font-semibold text-ink">{PROJECT.iphoneShortcutUrl ? "By hand instead" : "On the iPhone"}</div>
                <ol className="flex list-decimal flex-col gap-1 pl-5">
                  <li>Shortcuts → Automation → + → Transaction. Pick your cards, then Run Immediately.</li>
                  <li>Add Get Contents of URL with the URL above, Method POST, and a header Authorization with the value above.</li>
                  <li>
                    Request Body JSON: <span className="font-num">amount</span> → Amount, <span className="font-num">merchant</span>{" "}
                    → Merchant, <span className="font-num">card</span> → Card or Pass, <span className="font-num">source</span> →
                    apple_pay.
                  </li>
                  <li>Optional: Get Dictionary Value <span className="font-num">message</span> → Show Notification.</li>
                </ol>
              </div>
            ) : (
              <div className="flex flex-col gap-2 text-[13px] text-muted">
                <div className="font-semibold text-ink">By hand instead</div>
                <ol className="flex list-decimal flex-col gap-1 pl-5">
                  <li>New macro. Trigger: Notification Received → apps Google Wallet and your bank&apos;s app.</li>
                  <li>
                    Action: HTTP Request → POST to the URL above, header Authorization with the value above, body type
                    application/json with the request body above.
                  </li>
                </ol>
              </div>
            )}
          </div>
        </details>
        <div className="text-[13px] text-muted">Anything the app can&apos;t read shows up in Settings → Capture log.</div>
        <PrimaryButton onClick={onDone}>Done</PrimaryButton>
      </Sheet>
    );
  }

  return (
    <Sheet title="Add a phone" open onClose={onDone}>
      {members.length > 1 && (
        <Segmented
          label="Whose phone"
          options={members.map((m) => ({ value: m.id, label: labelFor(m.id), color: m.colour }))}
          value={memberId}
          onChange={(id) => {
            setMemberId(id);
            relabel(id, kind);
          }}
        />
      )}
      <Segmented
        label="Kind of phone"
        options={[
          { value: "iphone", label: "iPhone" },
          { value: "android", label: "Android" },
        ]}
        value={kind}
        onChange={(k) => {
          setKind(k);
          relabel(memberId, k);
        }}
      />
      <Field label="Label">
        {(id) => (
          <input
            id={id}
            className={inputClass}
            value={label}
            maxLength={60}
            onChange={(e) => {
              setTouched(true);
              setLabel(e.target.value);
            }}
          />
        )}
      </Field>
      {error && <ErrorNote>{error}</ErrorNote>}
      <PrimaryButton onClick={create} disabled={busy || !label.trim()}>
        Create token
      </PrimaryButton>
    </Sheet>
  );
}

function RevokeSheet({ token, onDone }: { token: DeviceToken; onDone: () => void }) {
  const { labelFor } = useHousehold();
  const [confirm, setConfirm] = useState(false);
  const { busy, error, run } = useAction();

  async function revoke() {
    if (!confirm) return setConfirm(true);
    const ok = await run(() =>
      createClient().from("device_tokens").update({ revoked_at: new Date().toISOString() }).eq("id", token.id),
    );
    if (ok) onDone();
  }

  return (
    <Sheet title={token.label} open onClose={onDone}>
      <div className="text-[14px] text-muted">
        {labelFor(token.member_id)} · {lastUsed(token)}. Revoking stops this phone sending purchases straight away. Its past
        transactions stay.
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
      <SecondaryButton danger onClick={revoke} disabled={busy}>
        {confirm ? "Tap again to revoke" : "Revoke token"}
      </SecondaryButton>
    </Sheet>
  );
}
