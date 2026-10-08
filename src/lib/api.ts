import { NextResponse } from "next/server";
import { createClient } from "./supabase/server";
import type { Member } from "./types";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

/**
 * Route handlers act as the signed-in user, so every query below runs under
 * RLS exactly like the dashboard does.
 */
export async function requireMember() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: jsonError("Not signed in", 401) } as const;
  const { data: me } = await supabase.from("members").select("*").eq("user_id", user.id).maybeSingle<Member>();
  if (!me) return { error: jsonError("You're not in a household yet", 403) } as const;
  return { supabase, me } as const;
}

export async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === "object" && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}
