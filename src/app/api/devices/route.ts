import { NextResponse } from "next/server";
import { UUID, jsonError, readJson, requireMember } from "@/lib/api";
import { generateToken, hashToken } from "@/lib/ingest";

/**
 * POST /api/devices — create a device token for a phone automation.
 * Body: { label, member_id? }. The token is returned once and never stored.
 */
export async function POST(req: Request) {
  const auth = await requireMember();
  if ("error" in auth) return auth.error;
  const body = await readJson(req);
  if (!body) return jsonError("Expected a JSON body", 400);

  const label = typeof body.label === "string" ? body.label.trim() : "";
  if (!label || label.length > 60) return jsonError("Label must be 1–60 characters", 400);
  const memberId = body.member_id ?? auth.me.id;
  if (typeof memberId !== "string" || !UUID.test(memberId)) return jsonError("Invalid member_id", 400);

  const token = generateToken();
  const { data, error } = await auth.supabase
    .from("device_tokens")
    .insert({ member_id: memberId, label, token_hash: hashToken(token) })
    .select("id,label,member_id,created_at")
    .single();
  if (error) {
    // RLS refuses members outside this household.
    return jsonError(error.code === "42501" ? "Unknown member" : error.message, 400);
  }
  return NextResponse.json({ ...data, token }, { status: 201, headers: { "Cache-Control": "no-store" } });
}
