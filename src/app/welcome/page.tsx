import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Welcome } from "./Welcome";

// First sign-in for someone who isn't in a household yet.
export default async function WelcomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: member } = await supabase.from("members").select("id").eq("user_id", user.id).maybeSingle();
  if (member) redirect("/");

  return <Welcome email={user.email ?? ""} />;
}
