"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { AppMark } from "@/components/AppMark";
import { ErrorNote, Field, PrimaryButton, SecondaryButton, inputClass } from "@/components/ui";
import { PROJECT } from "@/lib/project";
import { createClient } from "@/lib/supabase/client";
import { CreditCard, FileSpreadsheet, ShieldCheck } from "lucide-react";

export default function LoginPage() {
  return (
    <Suspense>
      <Login />
    </Suspense>
  );
}

// Email one-time code is the primary sign-in: the code is typed into the app,
// so it works inside an installed iPhone PWA (a magic link would open Safari,
// which has separate storage). The link in the same email still works in a browser.
function Login() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(params.get("error"));
  const supabase = createClient();

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setBusy(false);
    if (error) return setError(error.message);
    setStep("code");
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "email" });
    if (error) {
      setBusy(false);
      return setError(error.message);
    }
    router.replace("/");
    router.refresh();
  }

  async function google() {
    setBusy(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setBusy(false);
      setError(error.message);
    }
  }

  return (
    <div className="flex min-h-dvh animate-rise flex-col justify-center gap-6 px-5 pt-[calc(28px+env(safe-area-inset-top))] pb-[max(28px,env(safe-area-inset-bottom))]">
      <div className="flex flex-col items-center gap-3 text-center">
        <AppMark />
        <div className="text-[24px] font-bold tracking-[-0.3px]">{PROJECT.name}</div>
        <div className="max-w-[300px] text-[14px] text-muted">
          {step === "email" ? "Where your household's money goes, logged the moment you pay." : `We emailed a code to ${email}.`}
        </div>
      </div>

      {step === "email" && (
        <ul className="m-0 flex list-none flex-col gap-3 rounded-[20px] bg-surface p-5">
          {[
            { Icon: CreditCard, title: "Tap to pay, it's logged", text: "Apple Pay and Android payments are captured on your phones." },
            { Icon: FileSpreadsheet, title: "Bank CSV fills the gaps", text: "Imports confirm what the phones caught — nothing counted twice." },
            { Icon: ShieldCheck, title: "Your data, your database", text: "Runs on your own free Supabase and Vercel. No ads, no tracking." },
          ].map(({ Icon, title, text }) => (
            <li key={title} className="flex gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-soft/60 text-accent-link" aria-hidden>
                <Icon size={18} />
              </span>
              <span className="flex flex-col gap-[2px]">
                <span className="text-[14px] font-semibold">{title}</span>
                <span className="text-[13px] text-muted">{text}</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {error && <ErrorNote>{error}</ErrorNote>}

      {step === "email" ? (
        <>
          <form onSubmit={sendCode} className="flex flex-col gap-[14px]">
            <Field label="Email">
              {(id) => (
                <input
                  id={id}
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  required
                  className={inputClass}
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              )}
            </Field>
            <PrimaryButton type="submit" disabled={busy || !email.includes("@")}>
              Email me a code
            </PrimaryButton>
          </form>
          <div className="flex items-center gap-3 text-[12px] text-muted">
            <div className="h-px grow bg-line" />
            or
            <div className="h-px grow bg-line" />
          </div>
          <SecondaryButton onClick={google} disabled={busy}>
            Continue with Google
          </SecondaryButton>
        </>
      ) : (
        <form onSubmit={verify} className="flex flex-col gap-[14px]">
          <Field label="Code from the email">
            {(id) => (
              <input
                id={id}
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                maxLength={10}
                className={`${inputClass} text-center font-num text-[22px] tracking-[6px]`}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              />
            )}
          </Field>
          <PrimaryButton type="submit" disabled={busy || code.length < 6}>
            Sign in
          </PrimaryButton>
          <div className="flex justify-between text-[14px]">
            <button type="button" className="cursor-pointer bg-transparent font-semibold text-accent-link" onClick={() => setStep("email")}>
              Different email
            </button>
            <button type="button" className="cursor-pointer bg-transparent font-semibold text-accent-link" onClick={() => sendCode()} disabled={busy}>
              Send again
            </button>
          </div>
        </form>
      )}

      {(PROJECT.repoUrl || PROJECT.coffeeUrl) && (
        <div className="flex justify-center gap-4 text-[13px]">
          {PROJECT.repoUrl && (
            <a href={PROJECT.repoUrl} target="_blank" rel="noopener noreferrer">
              Open source on GitHub
            </a>
          )}
          {PROJECT.coffeeUrl && (
            <a href={PROJECT.coffeeUrl} target="_blank" rel="noopener noreferrer">
              Buy me a coffee
            </a>
          )}
        </div>
      )}
    </div>
  );
}
