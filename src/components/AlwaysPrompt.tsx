"use client";

import { useState } from "react";
import { type AmountRange, type AmountScope, rangeFor, suggestedThreshold } from "@/lib/rules";
import { Field, Segmented, inputClass } from "./ui";

export interface AlwaysChoice {
  always: boolean;
  scope: AmountScope;
  dollars: string;
}

/** State for the "Always put X in Y?" prompt; `amountCents` sets the default $X. */
export function useAlwaysChoice(amountCents: number, initiallyAlways = false) {
  const [choice, setChoice] = useState<AlwaysChoice>({ always: initiallyAlways, scope: "any", dollars: "" });
  const setScope = (scope: AmountScope) =>
    setChoice((c) => ({
      ...c,
      scope,
      dollars: scope === "any" ? "" : String(suggestedThreshold(amountCents, scope) / 100),
    }));
  const range: AmountRange | { error: string } | null = choice.always ? rangeFor(choice.scope, choice.dollars) : null;
  return { choice, setChoice, setScope, range };
}

/**
 * "Always put 7-Eleven in Coffee?" — Just this one / Always, and with Always,
 * "Only for amounts under/over $X".
 */
export function AlwaysPrompt({
  merchant,
  category,
  onceLabel,
  state,
}: {
  merchant: string;
  category: string;
  onceLabel: string;
  state: ReturnType<typeof useAlwaysChoice>;
}) {
  const { choice, setChoice, setScope, range } = state;
  const dollars = choice.dollars || "X";
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[13px] text-muted">
        Always put {merchant} in {category}?
      </div>
      <Segmented
        label="Remember this category"
        options={[
          { value: "once", label: onceLabel },
          { value: "always", label: "Always" },
        ]}
        value={choice.always ? "always" : "once"}
        onChange={(v) => setChoice((c) => ({ ...c, always: v === "always" }))}
      />
      {choice.always && (
        <>
          <Segmented
            label="Which amounts"
            options={[
              { value: "any", label: "Any amount" },
              { value: "under", label: `Under $${choice.scope === "under" ? dollars : "X"}` },
              { value: "over", label: `$${choice.scope === "over" ? dollars : "X"}+` },
            ]}
            value={choice.scope}
            onChange={setScope}
          />
          {choice.scope !== "any" && (
            <Field
              label={choice.scope === "under" ? "Only for amounts under ($)" : "Only for amounts of at least ($)"}
              hint={
                range && "error" in range
                  ? range.error
                  : `Other amounts at ${merchant} can have their own category.`
              }
            >
              {(id) => (
                <input
                  id={id}
                  className={`${inputClass} font-num`}
                  inputMode="decimal"
                  value={choice.dollars}
                  onChange={(e) => setChoice((c) => ({ ...c, dollars: e.target.value }))}
                />
              )}
            </Field>
          )}
        </>
      )}
    </div>
  );
}

/** Request-body fields for the prompt's choice, or an error to show. */
export function alwaysBody(state: ReturnType<typeof useAlwaysChoice>, enabled: boolean) {
  if (!enabled || !state.choice.always) return { remember: false };
  const r = state.range;
  if (!r || "error" in r) return { error: r?.error ?? "Enter an amount" };
  return { remember: true, ...r };
}
