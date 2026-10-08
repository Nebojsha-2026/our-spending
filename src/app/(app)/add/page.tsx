"use client";

import { CategoryGlyph } from "@/components/CategoryIcon";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useHousehold } from "@/components/HouseholdProvider";
import { Chip, ErrorNote, PrimaryButton, Segmented, SubHeader } from "@/components/ui";
import { keypadToCents, pressKey } from "@/lib/money";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "del"];

export default function QuickAddPage() {
  const router = useRouter();
  const { me, members, categories, labelFor } = useHousehold();
  const [amount, setAmount] = useState("");
  const [who, setWho] = useState(me.id); // defaults to the signed-in person
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cents = keypadToCents(amount);

  const leave = useCallback(() => {
    if (window.history.length > 1) router.back();
    else router.replace("/");
  }, [router]);

  const save = useCallback(async () => {
    if (cents <= 0 || saving) return;
    setSaving(true);
    setError(null);
    const res = await fetch("/api/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount_cents: cents, member_id: who, category_id: categoryId }),
    });
    if (res.ok) return leave();
    const body = await res.json().catch(() => ({}));
    setError(body.error ?? "Couldn't save. Check your connection and try again.");
    setSaving(false);
  }, [cents, saving, who, categoryId, leave]);

  // Typing on a desktop keyboard works too.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^[0-9.]$/.test(e.key)) setAmount((a) => pressKey(a, e.key));
      else if (e.key === "Backspace") setAmount((a) => pressKey(a, "del"));
      else if (e.key === "Enter") save();
      else if (e.key === "Escape") leave();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save, leave]);

  return (
    <div className="box-border flex min-h-dvh flex-col gap-[18px] px-5 pt-[calc(20px+env(safe-area-inset-top))] pb-[max(28px,env(safe-area-inset-bottom))]">
      <SubHeader title="Add spending" close onBack={leave} />

      <div className="flex flex-col items-center gap-[6px] py-2">
        <div className="text-[13px] text-muted">Amount</div>
        <div aria-live="polite" className="font-num text-[52px] leading-none font-semibold tracking-[-1.5px]">
          ${amount || "0"}
        </div>
      </div>

      {members.length > 1 && (
        <Segmented
          label="Who spent it"
          options={members.map((m) => ({ value: m.id, label: labelFor(m.id), color: m.colour }))}
          value={who}
          onChange={setWho}
        />
      )}

      <div className="flex flex-col gap-2">
        <div className="text-[13px] text-muted">Category</div>
        <div className="flex flex-wrap gap-2">
          {categories.map((c) => (
            <Chip key={c.id} selected={c.id === categoryId} onClick={() => setCategoryId(c.id === categoryId ? null : c.id)}>
              <span className="flex items-center gap-[6px]">
                <CategoryGlyph icon={c.icon} size={15} />
                {c.name}
              </span>
            </Chip>
          ))}
        </div>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="mt-auto grid grid-cols-3 gap-2">
        {KEYS.map((k) => (
          <button
            key={k}
            type="button"
            aria-label={k === "del" ? "Delete digit" : k === "." ? "Decimal point" : k}
            onClick={() => setAmount((a) => pressKey(a, k))}
            className="h-[54px] cursor-pointer rounded-[14px] border-none bg-surface font-num text-[22px] font-medium text-ink active:bg-divider"
          >
            {k === "del" ? "⌫" : k}
          </button>
        ))}
      </div>

      <PrimaryButton onClick={save} disabled={cents <= 0 || saving}>
        {saving ? "Saving…" : "Save"}
      </PrimaryButton>
    </div>
  );
}
