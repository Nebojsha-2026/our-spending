"use client";

import { useState } from "react";
import { CATEGORY_ICONS, CategoryIcon } from "@/components/CategoryIcon";
import { useHousehold } from "@/components/HouseholdProvider";
import { SettingsScreen, useAction } from "@/components/settings";
import { ErrorNote, Field, List, ListRow, PrimaryButton, SecondaryButton, Segmented, Sheet, cx, inputClass } from "@/components/ui";
import { dollarsToCents, formatCents } from "@/lib/money";
import { createClient } from "@/lib/supabase/client";
import type { Category } from "@/lib/types";

export default function CategoriesSettings() {
  const { categories } = useHousehold();
  const [editing, setEditing] = useState<Category | "new" | null>(null);

  return (
    <SettingsScreen title="Categories & budgets">
      <List>
        {categories.map((c) => (
          <ListRow
            key={c.id}
            leading={<CategoryIcon icon={c.icon} muted={!c.counts_as_spending} />}
            title={c.name}
            subtitle={
              !c.counts_as_spending
                ? "Not counted as spending"
                : c.monthly_budget_cents
                  ? `${formatCents(Number(c.monthly_budget_cents))} a month`
                  : "No budget"
            }
            onClick={() => setEditing(c)}
          />
        ))}
      </List>
      <SecondaryButton onClick={() => setEditing("new")}>Add a category</SecondaryButton>
      <div className="px-1 text-[12px] text-muted">
        The order here is the order of the chips in Quick add. Categories marked “Not counted as spending” (transfers between
        your accounts, paying employees, money passed on) stay in Activity but are left out of totals and budgets.
      </div>
      {editing && <CategorySheet category={editing === "new" ? null : editing} onDone={() => setEditing(null)} />}
    </SettingsScreen>
  );
}

function CategorySheet({ category, onDone }: { category: Category | null; onDone: () => void }) {
  const { categories, household } = useHousehold();
  const [name, setName] = useState(category?.name ?? "");
  const [budget, setBudget] = useState(
    category?.monthly_budget_cents ? (Number(category.monthly_budget_cents) / 100).toFixed(2) : "",
  );
  const [counts, setCounts] = useState(category?.counts_as_spending ?? true);
  const [icon, setIcon] = useState(category?.icon ?? "circle");
  const [confirm, setConfirm] = useState(false);
  const { busy, error, run } = useAction();
  const supabase = createClient();
  const budgetCents = dollarsToCents(budget);
  const budgetOk = budget.trim() === "" || budgetCents !== null;
  const index = category ? categories.findIndex((c) => c.id === category.id) : -1;

  async function save() {
    const values = { name: name.trim(), icon, monthly_budget_cents: counts ? budgetCents || null : null, counts_as_spending: counts };
    const ok = category
      ? await run(() => supabase.from("categories").update(values).eq("id", category.id))
      : await run(() =>
          supabase.from("categories").insert({
            household_id: household.id,
            ...values,
            sort: Math.max(0, ...categories.map((c) => c.sort)) + 10,
          }),
        );
    if (ok) onDone();
  }

  /** Swap sort positions with the neighbour above or below. */
  async function move(dir: -1 | 1) {
    const other = categories[index + dir];
    if (!category || !other) return;
    // Equal sort values would make the swap a no-op, so fall back to list positions.
    const [a, b] = category.sort === other.sort ? [(index + dir) * 10, index * 10] : [other.sort, category.sort];
    if (
      await run(
        () => supabase.from("categories").update({ sort: a }).eq("id", category.id),
        () => supabase.from("categories").update({ sort: b }).eq("id", other.id),
      )
    )
      onDone();
  }

  async function remove() {
    if (!confirm) return setConfirm(true);
    if (category && (await run(() => supabase.from("categories").delete().eq("id", category.id)))) onDone();
  }

  return (
    <Sheet title={category ? `Edit ${category.name}` : "Add a category"} open onClose={onDone}>
      <Field label="Name">
        {(id) => <input id={id} className={inputClass} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />}
      </Field>
      <div className="flex flex-col gap-2">
        <div className="text-[12px] text-muted">Icon</div>
        <div role="radiogroup" aria-label="Icon" className="grid grid-cols-8 gap-2">
          {Object.entries(CATEGORY_ICONS).map(([key, Icon]) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={icon === key}
              aria-label={key.replace(/-/g, " ")}
              onClick={() => setIcon(key)}
              className={cx(
                "flex aspect-square cursor-pointer items-center justify-center rounded-[10px] border",
                icon === key ? "border-accent bg-accent text-white" : "border-line bg-surface text-ink",
              )}
            >
              <Icon size={18} />
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <div className="text-[12px] text-muted">Count as spending?</div>
        <Segmented
          label="Count as spending"
          options={[
            { value: "yes", label: "Yes" },
            { value: "no", label: "No, not spending" },
          ]}
          value={counts ? "yes" : "no"}
          onChange={(v) => setCounts(v === "yes")}
        />
        <div className="text-[12px] text-muted">
          {counts
            ? "Included in Overview totals and budgets."
            : "For transfers, paying employees or money that wasn’t yours: kept in Activity, left out of totals and budgets."}
        </div>
      </div>
      {counts && (
        <Field label="Monthly budget" hint={budgetOk ? "Leave empty for no budget." : "Enter an amount like 600 or 45.50."}>
          {(id) => (
            <input
              id={id}
              className={`${inputClass} font-num`}
              inputMode="decimal"
              placeholder="No budget"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
            />
          )}
        </Field>
      )}
      {category && (
        <div className="grid grid-cols-2 gap-2">
          <SecondaryButton onClick={() => move(-1)} disabled={busy || index <= 0}>
            Move up
          </SecondaryButton>
          <SecondaryButton onClick={() => move(1)} disabled={busy || index >= categories.length - 1}>
            Move down
          </SecondaryButton>
        </div>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}
      <PrimaryButton onClick={save} disabled={busy || !name.trim() || (counts && !budgetOk)}>
        Save
      </PrimaryButton>
      {category && (
        <SecondaryButton danger onClick={remove} disabled={busy}>
          {confirm ? "Tap again — its transactions become uncategorised" : "Delete category"}
        </SecondaryButton>
      )}
    </Sheet>
  );
}
