"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AppMark } from "@/components/AppMark";
import { Card, ErrorNote, Field, PrimaryButton, SecondaryButton, inputClass } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

export function Welcome({ email }: { email: string }) {
  const router = useRouter();
  const [household, setHousehold] = useState("Our household");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const supabase = createClient();

  function go() {
    router.replace("/");
    router.refresh();
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc("create_household", { p_name: household.trim(), p_display_name: name.trim() });
    if (error) {
      setBusy(false);
      return setError(error.message);
    }
    go();
  }

  async function checkInvite() {
    setBusy(true);
    setNotFound(false);
    const { data } = await supabase.rpc("claim_membership");
    if (data) return go();
    setBusy(false);
    setNotFound(true);
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  return (
    <div className="flex min-h-dvh flex-col justify-center gap-6 px-5 pt-[calc(28px+env(safe-area-inset-top))] pb-[max(28px,env(safe-area-inset-bottom))]">
      <div className="flex flex-col items-center gap-3 text-center">
        <AppMark />
        <div className="text-[20px] font-bold">Welcome</div>
        <div className="text-[14px] text-muted">Signed in as {email}</div>
      </div>

      <Card className="gap-[14px] p-5">
        <div className="text-[15px] font-semibold">Start your household</div>
        <form onSubmit={create} className="flex flex-col gap-[14px]">
          <Field label="Your name">
            {(id) => <input id={id} className={inputClass} value={name} maxLength={40} autoComplete="given-name" onChange={(e) => setName(e.target.value)} />}
          </Field>
          <Field label="Household name">
            {(id) => <input id={id} className={inputClass} value={household} maxLength={80} onChange={(e) => setHousehold(e.target.value)} />}
          </Field>
          {error && <ErrorNote>{error}</ErrorNote>}
          <PrimaryButton type="submit" disabled={busy || !name.trim() || !household.trim()}>
            Create household
          </PrimaryButton>
        </form>
      </Card>

      <Card className="gap-3 p-5">
        <div className="text-[15px] font-semibold">Joining someone&apos;s household?</div>
        <div className="text-[14px] text-muted">
          Ask them to add {email || "your email"} in Settings → Household, then check again.
        </div>
        {notFound && <ErrorNote>No invite for {email} yet.</ErrorNote>}
        <SecondaryButton onClick={checkInvite} disabled={busy}>
          Check again
        </SecondaryButton>
      </Card>

      <button type="button" onClick={signOut} className="cursor-pointer bg-transparent text-[14px] font-semibold text-accent-link">
        Use a different account
      </button>
    </div>
  );
}
