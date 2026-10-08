"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { SubHeader, cx } from "./ui";

/** Sub-screen inside Settings: back button header and a scrolling body (sections keep their height so it scrolls). */
export function SettingsScreen({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto [&>*]:shrink-0 px-5 pt-[calc(20px+env(safe-area-inset-top))] pb-5">
      <SubHeader title={title} backHref="/settings" />
      {children}
    </div>
  );
}

type DbResult = { error: { message: string; code?: string } | null };

/** Runs Supabase writes, turns errors into readable text, then reloads household data. */
export function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(...steps: (() => PromiseLike<DbResult>)[]): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      for (const step of steps) {
        const { error } = await step();
        if (error) {
          setError(
            error.code === "23505"
              ? "That name is already in use."
              : error.code === "23503"
                ? "Transactions still point at this, so it can't be removed."
                : error.code === "23514"
                ? "Please check the values — one of them isn't allowed."
                : error.message,
          );
          return false;
        }
      }
      router.refresh();
      return true;
    } finally {
      setBusy(false);
    }
  }

  return { busy, error, setError, run };
}

export const SWATCHES = ["#1D4ED8", "#C2410C", "#7C3AED", "#047857", "#BE185D", "#0369A1"];

export function ColourPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[12px] text-muted">Colour in charts</div>
      <div className="flex flex-wrap gap-3">
        {SWATCHES.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={c}
            aria-pressed={c.toLowerCase() === value.toLowerCase()}
            onClick={() => onChange(c)}
            className={cx(
              "size-11 cursor-pointer rounded-full border-[3px]",
              c.toLowerCase() === value.toLowerCase() ? "border-ink" : "border-surface",
            )}
            style={{ background: c }}
          />
        ))}
      </div>
    </div>
  );
}
