"use client";

import { useCallback, useEffect, useState } from "react";
import { useHousehold } from "@/components/HouseholdProvider";
import { SettingsScreen, useAction } from "@/components/settings";
import { ErrorNote, Field, List, ListRow, PrimaryButton, SecondaryButton, Sheet, inputClass } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { rangeLabel } from "@/lib/rules";
import type { MerchantRule } from "@/lib/types";

export default function RulesSettings() {
  const { categoryById } = useHousehold();
  const [rules, setRules] = useState<MerchantRule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<MerchantRule | "new" | null>(null);

  const load = useCallback(() => {
    createClient()
      .from("merchant_rules")
      .select("*")
      .order("priority")
      .order("match_pattern")
      .order("min_amount_cents", { nullsFirst: true })
      .returns<MerchantRule[]>()
      .then(({ data, error }) => (error ? setError(error.message) : setRules(data)));
  }, []);
  useEffect(load, [load]);

  return (
    <SettingsScreen title="Merchant rules">
      <div className="px-1 text-[13px] text-muted">
        Rules turn a bank description like <span className="font-semibold text-ink">WOOLWORTHS 1234 NEWTOWN</span> into a tidy
        name and category. They apply automatically to every phone capture and CSV import. A rule can be limited to
        some amounts, so one merchant can go in different categories; the most specific matching rule wins.
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
      {rules && rules.length > 0 && (
        <List>
          {rules.map((r) => (
            <ListRow
              key={r.id}
              title={r.clean_name}
              subtitle={`${r.match_pattern}${rangeLabel(r) ? ` (${rangeLabel(r)})` : ""} → ${r.category_id ? (categoryById.get(r.category_id)?.name ?? "—") : "No category"} · priority ${r.priority}`}
              onClick={() => setEditing(r)}
            />
          ))}
        </List>
      )}
      <SecondaryButton onClick={() => setEditing("new")}>Add a rule</SecondaryButton>
      {editing && (
        <RuleSheet
          rule={editing === "new" ? null : editing}
          onDone={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </SettingsScreen>
  );
}

function RuleSheet({ rule, onDone }: { rule: MerchantRule | null; onDone: () => void }) {
  const { categories, household } = useHousehold();
  const [pattern, setPattern] = useState(rule?.match_pattern ?? "");
  const [cleanName, setCleanName] = useState(rule?.clean_name ?? "");
  const [categoryId, setCategoryId] = useState(rule?.category_id ?? "");
  const [priority, setPriority] = useState(String(rule?.priority ?? 100));
  const [minDollars, setMinDollars] = useState(rule?.min_amount_cents != null ? String(rule.min_amount_cents / 100) : "");
  const [maxDollars, setMaxDollars] = useState(rule?.max_amount_cents != null ? String(rule.max_amount_cents / 100) : "");
  const [confirm, setConfirm] = useState(false);
  const { busy, error, run } = useAction();
  const supabase = createClient();
  const priorityOk = /^-?\d{1,6}$/.test(priority);
  const toCents = (d: string) => (d.trim() === "" ? null : /^\d{1,6}(\.\d{1,2})?$/.test(d.trim()) ? Math.round(Number(d) * 100) : NaN);
  const minCents = toCents(minDollars);
  const maxCents = toCents(maxDollars);
  const rangeOk =
    !Number.isNaN(minCents) && !Number.isNaN(maxCents) && maxCents !== 0 && (minCents == null || maxCents == null || minCents < maxCents);

  async function save() {
    const values = {
      match_pattern: pattern.trim(),
      clean_name: cleanName.trim(),
      category_id: categoryId || null,
      priority: Number(priority),
      min_amount_cents: minCents,
      max_amount_cents: maxCents,
    };
    const ok = rule
      ? await run(() => supabase.from("merchant_rules").update(values).eq("id", rule.id))
      : await run(() => supabase.from("merchant_rules").insert({ household_id: household.id, ...values }));
    if (ok) onDone();
  }

  async function remove() {
    if (!confirm) return setConfirm(true);
    if (rule && (await run(() => supabase.from("merchant_rules").delete().eq("id", rule.id)))) onDone();
  }

  return (
    <Sheet title={rule ? "Edit rule" : "Add a rule"} open onClose={onDone}>
      <Field
        label="Merchant matches"
        hint="Checked against the bank description and the cleaned name. % matches anything, e.g. WOOLWORTHS% or %UBER%EATS%. Not case-sensitive."
      >
        {(id) => (
          <input
            id={id}
            className={inputClass}
            autoCapitalize="characters"
            value={pattern}
            maxLength={120}
            placeholder="WOOLWORTHS%"
            onChange={(e) => setPattern(e.target.value)}
          />
        )}
      </Field>
      <Field label="Show it as">
        {(id) => (
          <input id={id} className={inputClass} value={cleanName} maxLength={80} placeholder="Woolworths" onChange={(e) => setCleanName(e.target.value)} />
        )}
      </Field>
      <Field label="Category">
        {(id) => (
          <select id={id} className={inputClass} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">No category</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Only from ($, optional)">
          {(id) => (
            <input id={id} className={`${inputClass} font-num`} inputMode="decimal" value={minDollars} placeholder="Any" onChange={(e) => setMinDollars(e.target.value)} />
          )}
        </Field>
        <Field label="Only under ($, optional)">
          {(id) => (
            <input id={id} className={`${inputClass} font-num`} inputMode="decimal" value={maxDollars} placeholder="Any" onChange={(e) => setMaxDollars(e.target.value)} />
          )}
        </Field>
      </div>
      {!rangeOk && <div className="px-1 text-[12px] text-up">Enter dollar amounts, with “from” lower than “under”.</div>}
      <Field label="Priority" hint="Lower numbers are checked first; within a priority, rules for an amount range beat rules for any amount.">
        {(id) => (
          <input id={id} className={`${inputClass} font-num`} inputMode="numeric" value={priority} onChange={(e) => setPriority(e.target.value)} />
        )}
      </Field>
      {error && <ErrorNote>{error}</ErrorNote>}
      <PrimaryButton onClick={save} disabled={busy || !pattern.trim() || !cleanName.trim() || !priorityOk || !rangeOk}>
        Save
      </PrimaryButton>
      {rule && (
        <SecondaryButton danger onClick={remove} disabled={busy}>
          {confirm ? "Tap again to delete" : "Delete rule"}
        </SecondaryButton>
      )}
    </Sheet>
  );
}
