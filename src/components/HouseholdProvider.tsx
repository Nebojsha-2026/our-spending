"use client";

import { createContext, useContext, useMemo } from "react";
import type { Account, Category, Household, Member } from "@/lib/types";

export interface HouseholdData {
  email: string;
  household: Household;
  me: Member;
  /** The signed-in member first, then everyone else. */
  members: Member[];
  categories: Category[];
  accounts: Account[];
}

interface HouseholdContextValue extends HouseholdData {
  memberById: Map<string, Member>;
  categoryById: Map<string, Category>;
  accountById: Map<string, Account>;
  /** "You" for the signed-in member, otherwise their name. */
  labelFor: (memberId: string) => string;
}

const HouseholdContext = createContext<HouseholdContextValue | null>(null);

export function HouseholdProvider({ value, children }: { value: HouseholdData; children: React.ReactNode }) {
  const ctx = useMemo<HouseholdContextValue>(() => {
    const memberById = new Map(value.members.map((m) => [m.id, m]));
    return {
      ...value,
      memberById,
      categoryById: new Map(value.categories.map((c) => [c.id, c])),
      accountById: new Map(value.accounts.map((a) => [a.id, a])),
      labelFor: (id) => (id === value.me.id ? "You" : (memberById.get(id)?.display_name ?? "Someone")),
    };
  }, [value]);
  return <HouseholdContext.Provider value={ctx}>{children}</HouseholdContext.Provider>;
}

export function useHousehold() {
  const ctx = useContext(HouseholdContext);
  if (!ctx) throw new Error("useHousehold must be used inside HouseholdProvider");
  return ctx;
}
