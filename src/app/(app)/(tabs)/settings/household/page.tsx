"use client";

import { useState } from "react";
import { useHousehold } from "@/components/HouseholdProvider";
import { ColourPicker, SWATCHES, SettingsScreen, useAction } from "@/components/settings";
import {
  ErrorNote,
  Field,
  List,
  ListRow,
  PersonDot,
  PrimaryButton,
  SecondaryButton,
  SectionLabel,
  Sheet,
  inputClass,
} from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import type { Member } from "@/lib/types";

export default function HouseholdSettings() {
  const { household, members, me, labelFor } = useHousehold();
  const [name, setName] = useState(household.name);
  const [editing, setEditing] = useState<Member | "new" | null>(null);
  const action = useAction();

  return (
    <SettingsScreen title="Household">
      <Field label="Household name">
        {(id) => <input id={id} className={inputClass} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />}
      </Field>
      {name.trim() !== household.name && (
        <SecondaryButton
          disabled={action.busy || !name.trim()}
          onClick={() => action.run(() => createClient().from("households").update({ name: name.trim() }).eq("id", household.id))}
        >
          Save name
        </SecondaryButton>
      )}
      {action.error && <ErrorNote>{action.error}</ErrorNote>}

      <div className="flex flex-col gap-2">
        <SectionLabel>People</SectionLabel>
        <List>
          {members.map((m) => (
            <ListRow
              key={m.id}
              leading={<PersonDot label={m.display_name} color={m.colour} />}
              title={m.id === me.id ? `${m.display_name} (you)` : m.display_name}
              subtitle={[m.email, m.user_id ? "Signed in" : "Hasn't signed in yet"].filter(Boolean).join(" · ")}
              onClick={() => setEditing(m)}
            />
          ))}
        </List>
      </div>
      <SecondaryButton onClick={() => setEditing("new")}>Add a person</SecondaryButton>
      <div className="px-1 text-[12px] text-muted">
        Add each person (partner, family member or housemate) with the email they&apos;ll sign in with. The first time they sign in, they join this household
        and see everything you see. Spending is tagged {members.map((m) => labelFor(m.id)).join(" / ")}.
      </div>

      {editing && (
        <MemberSheet
          member={editing === "new" ? null : editing}
          isMe={editing !== "new" && editing.id === me.id}
          nextColour={SWATCHES.find((c) => !members.some((m) => m.colour.toLowerCase() === c.toLowerCase())) ?? SWATCHES[1]}
          householdId={household.id}
          onDone={() => setEditing(null)}
        />
      )}
    </SettingsScreen>
  );
}

function MemberSheet({
  member,
  isMe,
  nextColour,
  householdId,
  onDone,
}: {
  member: Member | null;
  isMe: boolean;
  nextColour: string;
  householdId: string;
  onDone: () => void;
}) {
  const [name, setName] = useState(member?.display_name ?? "");
  const [email, setEmail] = useState(member?.email ?? "");
  const [colour, setColour] = useState(member?.colour ?? nextColour);
  const [confirm, setConfirm] = useState(false);
  const { busy, error, run } = useAction();
  const supabase = createClient();
  const emailLocked = Boolean(member?.user_id);

  async function save() {
    const values = { display_name: name.trim(), colour, email: email.trim() || null };
    const ok = member
      ? await run(() => supabase.from("members").update(emailLocked ? { display_name: values.display_name, colour } : values).eq("id", member.id))
      : await run(() => supabase.from("members").insert({ household_id: householdId, ...values }));
    if (ok) onDone();
  }

  async function remove() {
    if (!confirm) return setConfirm(true);
    if (member && (await run(() => supabase.from("members").delete().eq("id", member.id)))) onDone();
  }

  return (
    <Sheet title={member ? `Edit ${member.display_name}` : "Add a person"} open onClose={onDone}>
      <Field label="Name">
        {(id) => <input id={id} className={inputClass} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />}
      </Field>
      <Field
        label="Email they sign in with"
        hint={emailLocked ? "Linked to their sign-in, so it can't be changed here." : undefined}
      >
        {(id) => (
          <input
            id={id}
            type="email"
            autoComplete="off"
            className={`${inputClass} disabled:text-muted`}
            value={email}
            disabled={emailLocked}
            onChange={(e) => setEmail(e.target.value)}
          />
        )}
      </Field>
      <ColourPicker value={colour} onChange={setColour} />
      {error && <ErrorNote>{error}</ErrorNote>}
      <PrimaryButton onClick={save} disabled={busy || !name.trim() || (!member && !email.trim())}>
        Save
      </PrimaryButton>
      {member && !member.user_id && !isMe && (
        <SecondaryButton danger onClick={remove} disabled={busy}>
          {confirm ? "Tap again to remove" : "Remove"}
        </SecondaryButton>
      )}
    </Sheet>
  );
}
