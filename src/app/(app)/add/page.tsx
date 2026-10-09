"use client";

import { CategoryGlyph } from "@/components/CategoryIcon";
import { MoreHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useHousehold } from "@/components/HouseholdProvider";
import { ErrorNote, Field, PrimaryButton, Segmented, Sheet, SubHeader, cx, inputClass } from "@/components/ui";
import { formatCents, keypadToCents, pressKey } from "@/lib/money";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "del"];

export default function QuickAddPage() {
  const router = useRouter();
  const { me, members, categories, labelFor } = useHousehold();
  const [amount, setAmount] = useState("");
  const [who, setWho] = useState(me.id);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [merchant, setMerchant] = useState("");
  const [showCategories, setShowCategories] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const cents = keypadToCents(amount);
  // Keep the full household category order, with an overflow picker for small screens.
  const visibleCategories = categories.slice(0, categories.length > 6 ? 5 : 6);
  const selectedCategory = categories.find((c) => c.id === categoryId);
  if (selectedCategory && !visibleCategories.some((c) => c.id === categoryId)) visibleCategories[visibleCategories.length - 1] = selectedCategory;

  const leave = useCallback(() => {
    if (window.history.length > 1) router.back();
    else router.replace("/");
  }, [router]);

  const save = useCallback(async () => {
    if (cents <= 0 || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount_cents: cents, member_id: who, category_id: categoryId, merchant }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Couldn't save. Please try again.");
      }
      router.replace("/activity?saved=1");
    } catch (e) {
      setError(e instanceof TypeError ? "Couldn't save. Check your connection and try again." : (e as Error).message);
      savingRef.current = false;
      setSaving(false);
    }
  }, [cents, who, categoryId, merchant, router]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || showCategories || savingRef.current) return;
      // Text entry and focused controls retain their native keyboard behaviour.
      if (e.target instanceof HTMLElement && (e.target.closest("input, textarea, select, [contenteditable=true]") || (e.key === "Enter" && e.target.closest("button")))) return;
      if (/^[0-9.]$/.test(e.key)) { e.preventDefault(); setAmount((a) => pressKey(a, e.key)); }
      else if (e.key === "Backspace") { e.preventDefault(); setAmount((a) => pressKey(a, "del")); }
      else if (e.key === "Enter") { e.preventDefault(); save(); }
      else if (e.key === "Escape") leave();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save, leave, showCategories]);

  return (
    <div className="box-border flex min-h-dvh flex-col gap-4 px-5 pt-[calc(16px+env(safe-area-inset-top))] pb-[max(16px,env(safe-area-inset-bottom))]">
      <SubHeader title="Add spending" close onBack={leave} />
      <div className="flex flex-col items-center gap-2 py-2">
        <div aria-live="polite" aria-label="Amount" className="font-num text-[48px] leading-none font-semibold tracking-[-1.5px]">${amount || "0"}</div>
        <div className="text-[11px] font-medium tracking-widest text-muted">AUD</div>
      </div>
      {members.length > 1 && (
        <div className="flex flex-col gap-1.5">
          <div className="text-[12px] text-muted">Paid by</div>
          <Segmented label="Who spent it" options={members.map((m) => ({ value: m.id, label: labelFor(m.id) }))} value={who} onChange={setWho} />
        </div>
      )}
      <Field label="Merchant (optional)">{(id) => <input id={id} value={merchant} onChange={(e) => setMerchant(e.target.value)} maxLength={120} placeholder="e.g. Local café" className={inputClass} />}</Field>
      <div className="flex flex-col gap-2">
        <div className="text-[12px] text-muted">Category</div>
        <div className="grid grid-cols-3 gap-2">
          {visibleCategories.map((c) => (
            <button key={c.id} type="button" aria-pressed={c.id === categoryId} onClick={() => setCategoryId(c.id === categoryId ? null : c.id)}
              className={cx("flex min-h-[64px] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border px-1 py-2 text-center text-[11px]", c.id === categoryId ? "border-accent bg-accent-soft text-accent-link" : "border-line bg-surface text-ink")}>
              <CategoryGlyph icon={c.icon} size={19} /><span>{c.name}</span>
            </button>
          ))}
          {categories.length > 6 && <button type="button" onClick={() => setShowCategories(true)} className="flex min-h-[64px] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-line bg-surface text-[11px]"><MoreHorizontal size={19} aria-hidden />More</button>}
        </div>
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="mt-auto grid grid-cols-3 gap-2">
        {KEYS.map((k) => (
          <button key={k} type="button" disabled={saving} aria-label={k === "del" ? "Delete digit" : k === "." ? "Decimal point" : k}
            onClick={() => setAmount((a) => pressKey(a, k))}
            className="h-11 cursor-pointer rounded-xl border border-line/50 bg-surface font-num text-[22px] font-medium text-ink active:bg-divider">
            {k === "del" ? "⌫" : k}
          </button>
        ))}
      </div>
      <PrimaryButton onClick={save} disabled={cents <= 0 || saving}>{saving ? "Saving…" : cents > 0 ? `Save ${formatCents(cents)}` : "Save spending"}</PrimaryButton>
      <Sheet title="Choose a category" open={showCategories} onClose={() => setShowCategories(false)}>
        <div className="grid grid-cols-2 gap-2">
          {categories.map((c) => <button key={c.id} type="button" aria-pressed={c.id === categoryId} onClick={() => { setCategoryId(c.id); setShowCategories(false); }} className={cx("flex min-h-[52px] cursor-pointer items-center gap-2 rounded-xl border px-3 text-left text-[13px]", c.id === categoryId ? "border-accent bg-accent-soft text-accent-link" : "border-line bg-surface")}><CategoryGlyph icon={c.icon} />{c.name}</button>)}
        </div>
      </Sheet>
    </div>
  );
}
