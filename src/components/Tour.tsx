"use client";

import { CreditCard, FileSpreadsheet, PiggyBank, Sparkles, type LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { PROJECT } from "@/lib/project";
import { PrimaryButton, cx } from "./ui";

// A short welcome tour: four cards, swipeable, skippable. Shown once per phone
// (the first time the Overview opens); Settings → About → "Take the tour" opens
// it again via /?tour=1.

const SEEN_KEY = "tour-v1";

interface Step {
  Icon: LucideIcon;
  title: string;
  body: string;
  /** A small sample of what it looks like in the app. */
  sample: string;
}

const STEPS: Step[] = [
  {
    Icon: CreditCard,
    title: "Tap, and it's logged",
    body: "Connect your phones once. Every Apple Pay or Google Wallet payment lands here as you pay, tagged with who spent it.",
    sample: "Logged $4.50 · Coffee",
  },
  {
    Icon: FileSpreadsheet,
    title: "Your bank fills the gaps",
    body: "Import your bank's CSV now and then. It confirms what the phones caught and adds what they missed, never twice.",
    sample: "12 confirmed · 4 new · 0 duplicates",
  },
  {
    Icon: Sparkles,
    title: "Teach it once",
    body: "Pick a category and tap Always. Every past and future purchase from that shop follows, even by amount.",
    sample: "Always put 7-Eleven in Coffee?",
  },
  {
    Icon: PiggyBank,
    title: "Stay on budget, together",
    body: "Set monthly budgets and everyone gets a heads-up at 80% and 100%. Tap any category to see where it went.",
    sample: "Eating out · 82% of budget",
  },
];

function seen() {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return true; // can't remember it, so don't risk showing it every time
  }
}

function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {}
}

export function Tour() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const touchX = useRef<number | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const last = step === STEPS.length - 1;

  useEffect(() => {
    const asked = new URLSearchParams(window.location.search).get("tour") === "1";
    if (asked) window.history.replaceState(null, "", window.location.pathname);
    if (!asked && seen()) return;
    // After the Overview has painted, so the tour fades in over it.
    const t = setTimeout(() => setOpen(true), 150);
    return () => clearTimeout(t);
  }, []);

  const close = useCallback(() => {
    markSeen();
    setOpen(false);
    setStep(0);
  }, []);
  const go = useCallback((n: number) => setStep(Math.max(0, Math.min(STEPS.length - 1, n))), []);

  useEffect(() => {
    if (!open) return;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight") setStep((s) => Math.min(STEPS.length - 1, s + 1));
      if (e.key === "ArrowLeft") setStep((s) => Math.max(0, s - 1));
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex animate-fade justify-center bg-bg">
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={`Welcome to ${PROJECT.name}`}
        tabIndex={-1}
        className="flex h-full w-full max-w-[480px] flex-col px-6 pt-[calc(16px+env(safe-area-inset-top))] pb-[max(24px,env(safe-area-inset-bottom))] outline-none"
        onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
        onTouchEnd={(e) => {
          if (touchX.current === null) return;
          const dx = e.changedTouches[0].clientX - touchX.current;
          touchX.current = null;
          if (Math.abs(dx) > 50) go(step + (dx < 0 ? 1 : -1));
        }}
      >
        <div className="flex h-11 items-center justify-end">
          {!last && (
            <button type="button" onClick={close} className="cursor-pointer border-none bg-transparent px-1 text-[15px] font-semibold text-muted">
              Skip
            </button>
          )}
        </div>

        <div className="relative flex min-h-0 flex-1 items-center overflow-hidden">
          <div
            className="flex w-full transition-transform duration-500 ease-[cubic-bezier(0.2,0.8,0.2,1)]"
            style={{ transform: `translateX(-${step * 100}%)` }}
          >
            {STEPS.map(({ Icon, title, body, sample }, i) => (
              <section
                key={title}
                aria-hidden={i !== step}
                className={cx("flex w-full shrink-0 flex-col items-center text-center transition-opacity duration-500", i !== step && "opacity-0")}
              >
                <div className="relative mb-8">
                  <div className="absolute inset-0 -z-10 scale-150 rounded-full bg-accent-soft/40 blur-2xl" aria-hidden />
                  <div className="flex size-24 items-center justify-center rounded-[28px] bg-accent text-white shadow-[0_12px_32px_var(--color-shadow)]">
                    <Icon size={44} strokeWidth={1.75} aria-hidden />
                  </div>
                </div>
                <div className="text-[13px] font-semibold tracking-[0.08em] text-accent-link uppercase">
                  {i + 1} of {STEPS.length}
                </div>
                <h2 className="mt-2 mb-0 text-[26px] leading-tight font-bold tracking-[-0.4px]">{title}</h2>
                <p className="mt-3 mb-0 max-w-[320px] text-[15px] leading-[1.55] text-muted">{body}</p>
                <div className="mt-7 rounded-full border border-line bg-surface px-4 py-2 text-[13px] font-semibold shadow-[0_1px_2px_var(--color-shadow)]">
                  {sample}
                </div>
              </section>
            ))}
          </div>
        </div>

        <div className="flex flex-col items-center gap-6">
          <div className="flex gap-2" role="tablist" aria-label="Tour steps">
            {STEPS.map((s, i) => (
              <button
                key={s.title}
                type="button"
                role="tab"
                aria-selected={i === step}
                aria-label={`Step ${i + 1}: ${s.title}`}
                onClick={() => go(i)}
                className={cx(
                  "h-2 cursor-pointer rounded-full border-none p-0 transition-all duration-300",
                  i === step ? "w-6 bg-accent" : "w-2 bg-line",
                )}
              />
            ))}
          </div>
          {last ? (
            <div className="flex w-full flex-col gap-3">
              <PrimaryButton
                onClick={() => {
                  close();
                  router.push("/settings/devices");
                }}
              >
                Set up my phone
              </PrimaryButton>
              <button type="button" onClick={close} className="h-11 cursor-pointer border-none bg-transparent text-[15px] font-semibold text-accent-link">
                Explore first
              </button>
            </div>
          ) : (
            <div className="flex w-full flex-col gap-3">
              <PrimaryButton onClick={() => go(step + 1)}>Continue</PrimaryButton>
              <div className="h-11" aria-hidden />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
