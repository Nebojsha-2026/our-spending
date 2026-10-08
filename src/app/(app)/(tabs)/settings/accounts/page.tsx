"use client";

import { useState } from "react";
import { useHousehold } from "@/components/HouseholdProvider";
import { SettingsScreen, useAction } from "@/components/settings";
import {
  Chip,
  ErrorNote,
  Field,
  List,
  ListRow,
  PersonDot,
  PrimaryButton,
  SecondaryButton,
  Segmented,
  Sheet,
  inputClass,
} from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import type { Account } from "@/lib/types";

// The big four; anything else is typed in under "Other".
const BANKS = ["ANZ", "NAB", "CBA", "Westpac", "Other"];

export default function AccountsSettings() {
  const { accounts, memberById, labelFor } = useHousehold();
  const [editing, setEditing] = useState<Account | "new" | null>(null);

  return (
    <SettingsScreen title="Accounts & cards">
      {accounts.length > 0 ? (
        <List>
          {accounts.map((a) => {
            const m = memberById.get(a.member_id);
            return (
              <ListRow
                key={a.id}
                leading={<PersonDot label={labelFor(a.member_id)} color={m?.colour ?? "#5B6167"} />}
                title={a.nickname}
                subtitle={[
                  a.bank,
                  a.type === "debit" ? "Debit" : "Credit",
                  a.last4 && `••${a.last4}`,
                  labelFor(a.member_id),
                  a.is_default && "Default",
                ]
                  .filter(Boolean)
                  .join(" · ")}
                onClick={() => setEditing(a)}
              />
            );
          })}
        </List>
      ) : (
        <div className="px-1 text-[14px] text-muted">
          Add each card you pay with. Phone captures are matched to a card by its nickname.
        </div>
      )}
      <SecondaryButton onClick={() => setEditing("new")}>Add a card</SecondaryButton>
      <div className="px-1 text-[12px] text-muted">Only the nickname and last 4 digits are stored — never the full card number.</div>
      {editing && <AccountSheet account={editing === "new" ? null : editing} onDone={() => setEditing(null)} />}
    </SettingsScreen>
  );
}

function AccountSheet({ account, onDone }: { account: Account | null; onDone: () => void }) {
  const { me, members, household, labelFor } = useHousehold();
  const [memberId, setMemberId] = useState(account?.member_id ?? me.id);
  const [bank, setBank] = useState<Account["bank"]>(account?.bank ?? "ANZ");
  const [nickname, setNickname] = useState(account?.nickname ?? "");
  const [last4, setLast4] = useState(account?.last4 ?? "");
  const [type, setType] = useState<Account["type"]>(account?.type ?? "debit");
  const [isDefault, setIsDefault] = useState(account?.is_default ?? false);
  const [confirm, setConfirm] = useState(false);
  const { busy, error, run } = useAction();
  const supabase = createClient();
  const last4Ok = last4 === "" || /^\d{4}$/.test(last4);

  async function save() {
    const values = { member_id: memberId, bank: bank.trim(), nickname: nickname.trim(), last4: last4 || null, type, is_default: isDefault };
    // Only one default card per person: clear the old one first.
    const clearDefault = () => {
      let q = supabase.from("accounts").update({ is_default: false }).eq("member_id", memberId).eq("is_default", true);
      if (account) q = q.neq("id", account.id);
      return q;
    };
    const write = () =>
      account
        ? supabase.from("accounts").update(values).eq("id", account.id)
        : supabase.from("accounts").insert({ household_id: household.id, ...values });
    if (await run(...(isDefault ? [clearDefault, write] : [write]))) onDone();
  }

  async function remove() {
    if (!confirm) return setConfirm(true);
    if (account && (await run(() => supabase.from("accounts").delete().eq("id", account.id)))) onDone();
  }

  return (
    <Sheet title={account ? `Edit ${account.nickname}` : "Add a card"} open onClose={onDone}>
      {members.length > 1 && (
        <Segmented
          label="Whose card"
          options={members.map((m) => ({ value: m.id, label: labelFor(m.id), color: m.colour }))}
          value={memberId}
          onChange={setMemberId}
        />
      )}
      <Segmented
        label="Bank"
        options={BANKS.map((b) => ({ value: b, label: b }))}
        value={BANKS.includes(bank) ? bank : "Other"}
        onChange={(b) => setBank(b === "Other" ? (BANKS.includes(bank) ? "" : bank) : b)}
      />
      {!BANKS.slice(0, -1).includes(bank) && (
        <Field label="Bank name">
          {(id) => (
            <input id={id} className={inputClass} value={bank} maxLength={30} placeholder="e.g. ING" onChange={(e) => setBank(e.target.value)} />
          )}
        </Field>
      )}
      <Field label="Nickname" hint='Match the name Wallet shows, e.g. "ANZ Visa".'>
        {(id) => (
          <input id={id} className={inputClass} value={nickname} maxLength={40} placeholder="ANZ Visa" onChange={(e) => setNickname(e.target.value)} />
        )}
      </Field>
      <Field label="Last 4 digits" hint={last4Ok ? undefined : "Exactly 4 digits."}>
        {(id) => (
          <input
            id={id}
            className={inputClass}
            inputMode="numeric"
            autoComplete="off"
            maxLength={4}
            placeholder="1234"
            value={last4}
            onChange={(e) => setLast4(e.target.value.replace(/\D/g, ""))}
          />
        )}
      </Field>
      <Segmented
        label="Card type"
        options={[
          { value: "debit", label: "Debit" },
          { value: "credit", label: "Credit" },
        ]}
        value={type}
        onChange={setType}
      />
      <div className="flex">
        <Chip selected={isDefault} onClick={() => setIsDefault(!isDefault)}>
          {isDefault ? "✓ " : ""}Default card for {labelFor(memberId) === "You" ? "you" : labelFor(memberId)}
        </Chip>
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
      <PrimaryButton onClick={save} disabled={busy || !nickname.trim() || !last4Ok || !bank.trim()}>
        Save
      </PrimaryButton>
      {account && (
        <SecondaryButton danger onClick={remove} disabled={busy}>
          {confirm ? "Tap again to delete — its transactions keep their history" : "Delete card"}
        </SecondaryButton>
      )}
    </Sheet>
  );
}
