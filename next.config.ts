import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { NextConfig } from "next";

/**
 * Budget alert push keys: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY env vars, or
 * the pair scripts/setup.mjs keeps in the database and writes to
 * .push-keys.json before each build. Empty when neither exists (alerts off).
 * Inlined at build time; the private key is only referenced from
 * src/lib/push.ts, which only route handlers import.
 */
function pushKeys() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  }
  const file = join(process.cwd(), ".push-keys.json");
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")) as { publicKey: string; privateKey: string };
  return { publicKey: "", privateKey: "" };
}

const keys = pushKeys();

const nextConfig: NextConfig = {
  env: {
    PUSH_PUBLIC_KEY: keys.publicKey,
    PUSH_PRIVATE_KEY: keys.privateKey,
  },
};

export default nextConfig;
