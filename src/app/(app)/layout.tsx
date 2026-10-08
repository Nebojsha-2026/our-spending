import { redirect } from "next/navigation";
import { HouseholdProvider, type HouseholdData } from "@/components/HouseholdProvider";
import { createClient } from "@/lib/supabase/server";
import type { Account, Category, Household, Member } from "@/lib/types";

// Everything under (app) needs a signed-in user who belongs to a household.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  let { data: me } = await supabase.from("members").select("*").eq("user_id", user.id).maybeSingle<Member>();
  if (!me) {
    // Someone may have added this email in Settings → Household.
    const { data: claimed } = await supabase.rpc("claim_membership");
    if (!claimed) redirect("/welcome");
    ({ data: me } = await supabase.from("members").select("*").eq("user_id", user.id).maybeSingle<Member>());
    if (!me) redirect("/welcome");
  }

  const [household, members, categories, accounts] = await Promise.all([
    supabase.from("households").select("id,name").eq("id", me.household_id).single<Household>(),
    supabase.from("members").select("*").order("created_at").returns<Member[]>(),
    supabase.from("categories").select("*").order("sort").order("name").returns<Category[]>(),
    supabase.from("accounts").select("*").order("created_at").returns<Account[]>(),
  ]);
  const failed = [household, members, categories, accounts].find((r) => r.error);
  if (failed?.error) throw new Error(failed.error.message);

  const value: HouseholdData = {
    email: user.email ?? "",
    household: household.data!,
    me,
    members: [me, ...members.data!.filter((m) => m.id !== me.id)],
    categories: categories.data!,
    accounts: accounts.data!,
  };

  return <HouseholdProvider value={value}>{children}</HouseholdProvider>;
}
