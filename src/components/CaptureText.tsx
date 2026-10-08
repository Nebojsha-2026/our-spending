"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * The notification exactly as the phone sent it (Android captures), so a
 * wrong shop name can be checked against what the phone actually said.
 * Shows nothing if there isn't one (or the database predates capture_text).
 */
export function CaptureText({ id }: { id: string }) {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    createClient()
      .from("transactions")
      .select("capture_text")
      .eq("id", id)
      .maybeSingle<{ capture_text: string | null }>()
      .then(({ data }) => live && setText(data?.capture_text ?? null));
    return () => {
      live = false;
    };
  }, [id]);

  if (!text) return null;
  return (
    <div className="flex flex-col gap-1">
      <div className="text-[12px] text-muted">Phone notification</div>
      <div className="rounded-[12px] border border-line bg-surface px-[14px] py-3 text-[13px] break-words text-muted">{text}</div>
    </div>
  );
}
