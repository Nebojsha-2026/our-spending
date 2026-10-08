"use client";

import { Coffee } from "lucide-react";
import { useEffect, useState } from "react";
import { PROJECT } from "@/lib/project";
import { createClient } from "@/lib/supabase/client";
import { SUPPORT_MIN_TRANSACTIONS, SUPPORT_SNOOZE_DAYS, type SupportState, shouldShowSupport } from "@/lib/support";
import { Card } from "./ui";

// A friendly, honour-based "buy me a coffee" card on the Overview. It shows up
// only once the app has earned it (50+ transactions), "Maybe later" hides it
// for a month, and "I've already supported" hides it on this phone for good.
// Nothing is checked or sent anywhere: it's a polite ask, not a paywall.

const KEY = "support-card";

function read(): SupportState {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as SupportState;
  } catch {
    return {};
  }
}

function save(v: SupportState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    // Private mode etc.: the card just comes back next time.
  }
}

export function SupportCard() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!PROJECT.coffeeUrl || !shouldShowSupport(read(), SUPPORT_MIN_TRANSACTIONS)) return;
    let live = true;
    createClient()
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .then(({ count }) => live && setShow(shouldShowSupport(read(), count ?? 0)));
    return () => {
      live = false;
    };
  }, []);

  if (!show || !PROJECT.coffeeUrl) return null;
  const snooze = () => {
    save({ ...read(), snoozeUntil: Date.now() + SUPPORT_SNOOZE_DAYS * 86_400_000 });
    setShow(false);
  };

  return (
    <Card className="animate-rise gap-3 p-5">
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-soft/60 text-accent-link" aria-hidden>
          <Coffee size={20} />
        </span>
        <div className="text-[15px] font-semibold">Enjoying {PROJECT.name}?</div>
      </div>
      <div className="text-[14px] text-muted">
        It&apos;s free, has no ads, and is made by one person in their spare time. If it&apos;s helping your household, a
        coffee keeps it going. Thank you!
      </div>
      <a
        href={PROJECT.coffeeUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={snooze}
        className="flex h-11 items-center justify-center gap-2 rounded-[12px] bg-accent text-[15px] font-semibold text-white hover:text-white"
      >
        <Coffee size={18} aria-hidden />
        Buy me a coffee
      </a>
      <div className="flex justify-between text-[13px] font-semibold">
        <button type="button" onClick={snooze} className="cursor-pointer border-none bg-transparent p-0 text-muted">
          Maybe later
        </button>
        <button
          type="button"
          onClick={() => {
            save({ supported: true });
            setShow(false);
          }}
          className="cursor-pointer border-none bg-transparent p-0 text-accent-link"
        >
          I&apos;ve already supported
        </button>
      </div>
    </Card>
  );
}
