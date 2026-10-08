// Runs before `next build` (see package.json). It makes "Deploy to Vercel"
// a one-click setup:
//
//   1. Database: applies any migrations in supabase/migrations/ that haven't
//      run yet, when a database URL is available. The Supabase integration on
//      Vercel sets POSTGRES_URL_NON_POOLING / POSTGRES_URL automatically.
//      Applied versions are recorded in supabase_migrations.schema_migrations,
//      the same table the Supabase CLI uses, so `supabase db push` agrees.
//
//   2. Push keys: budget alerts need a VAPID key pair. The first deploy
//      creates one in the database (private.push_keys, out of the API's
//      reach) and every build writes it to `.push-keys.json`, which
//      next.config.ts hands to the server code. VAPID_PUBLIC_KEY +
//      VAPID_PRIVATE_KEY env vars take precedence. Without either, budget
//      alerts are simply unavailable.
//
//   3. Sign-in settings (optional): with SUPABASE_ACCESS_TOKEN set, points
//      Supabase Auth at this deployment (Site URL + redirect URLs) and puts the
//      6-digit code into the sign-in emails. Without it, do those two steps by
//      hand (README → "Finish sign-in setup").
//
// With neither set (local dev, CI) it does nothing. A failed migration fails
// the build, so a half-migrated database never goes live.

import { generateKeyPairSync } from "node:crypto";
import { readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const MIGRATIONS = join(import.meta.dirname, "..", "supabase", "migrations");
export const PUSH_KEYS_FILE = join(import.meta.dirname, "..", ".push-keys.json");
const log = (...a) => console.log("[setup]", ...a);

// Tried in order: the direct/session connection can be IPv6-only, which some
// build machines can't reach, so the pooled URL is the fallback.
const dbUrls = [
  ...new Set(
    [process.env.SUPABASE_DB_URL, process.env.POSTGRES_URL_NON_POOLING, process.env.POSTGRES_URL, process.env.DATABASE_URL].filter(Boolean),
  ),
];

/** The first URL that accepts a connection. */
export async function reachable(urls) {
  const errors = [];
  for (const url of urls) {
    const { url: clean, options } = connectionOptions(url);
    const sql = postgres(clean, { ...options, connect_timeout: 15 });
    try {
      await sql`select 1`;
      return url;
    } catch (e) {
      errors.push(`${new URL(url).host}: ${e.message}`);
    } finally {
      await sql.end({ timeout: 5 }).catch(() => {});
    }
  }
  throw new Error(`couldn't connect to the database (${errors.join("; ")})`);
}

/** Pending migrations as [{ version, name, file }], oldest first. */
export function migrationFiles(dir = MIGRATIONS) {
  return readdirSync(dir)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort()
    .map((file) => {
      const [, version, name] = /^(\d+)_(.+)\.sql$/.exec(file);
      return { version, name, file };
    });
}

/**
 * Connection options for a Supabase/Vercel Postgres URL. Query parameters
 * such as `sslmode` or `supa` aren't Postgres settings, so they're dropped.
 */
export function connectionOptions(url) {
  const u = new URL(url);
  const local = ["localhost", "127.0.0.1", "::1"].includes(u.hostname) || u.hostname.startsWith("/");
  const ssl = u.searchParams.get("sslmode") === "disable" || local ? false : "require";
  u.search = "";
  return { url: u.toString(), options: { ssl, prepare: false, max: 1, onnotice: () => {}, connect_timeout: 30 } };
}

export async function migrate(url, dir = MIGRATIONS) {
  const { url: clean, options } = connectionOptions(url);
  const sql = postgres(clean, options);
  try {
    await sql.unsafe(`
      create schema if not exists supabase_migrations;
      create table if not exists supabase_migrations.schema_migrations (
        version text primary key, statements text[], name text);
    `);
    const done = new Set((await sql`select version from supabase_migrations.schema_migrations`).map((r) => r.version));
    const files = migrationFiles(dir);

    // Set up by hand before (SQL Editor) — no history to go on, so don't guess.
    if (done.size === 0) {
      const [{ exists }] = await sql`select to_regclass('public.households') is not null as exists`;
      if (exists) {
        log(
          "The database already has the app's tables but no migration history, so nothing was applied.",
          "Run any newer files from supabase/migrations/ in the SQL Editor, or record the ones you've run with",
          "`insert into supabase_migrations.schema_migrations (version, name) values ('<version>', '<name>');`",
        );
        return { applied: [], skipped: true };
      }
    }

    const applied = [];
    for (const m of files.filter((f) => !done.has(f.version))) {
      const text = readFileSync(join(dir, m.file), "utf8");
      log(`applying ${m.file}`);
      await sql.begin(async (tx) => {
        await tx.unsafe(text);
        await tx`insert into supabase_migrations.schema_migrations (version, name, statements)
                 values (${m.version}, ${m.name}, '{}')`;
      });
      applied.push(m.file);
    }
    log(applied.length ? `database up to date (${applied.length} applied)` : "database already up to date");
    return { applied, skipped: false };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/**
 * A VAPID key pair in the base64url form browsers and web-push use.
 * @returns {{ publicKey: string, privateKey: string }}
 */
export function generateVapidKeys() {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = privateKey.export({ format: "jwk" });
  const point = Buffer.concat([Buffer.from([4]), Buffer.from(String(jwk.x), "base64url"), Buffer.from(String(jwk.y), "base64url")]);
  return { publicKey: point.toString("base64url"), privateKey: String(jwk.d) };
}

/** The database's key pair, created on first use. */
export async function ensurePushKeys(url) {
  const { url: clean, options } = connectionOptions(url);
  const sql = postgres(clean, options);
  try {
    const fresh = generateVapidKeys();
    await sql`insert into private.push_keys (public_key, private_key)
             values (${fresh.publicKey}, ${fresh.privateKey}) on conflict do nothing`;
    const [row] = await sql`select public_key, private_key from private.push_keys`;
    return { publicKey: row.public_key, privateKey: row.private_key };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function preparePushKeys(url) {
  rmSync(PUSH_KEYS_FILE, { force: true });
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) return log("push keys: using VAPID_* env vars");
  if (!url) return;
  try {
    writeFileSync(PUSH_KEYS_FILE, JSON.stringify(await ensurePushKeys(url)));
    log("push keys: ready (budget alerts on)");
  } catch (e) {
    // e.g. a hand-set-up database without the budget alerts migration yet.
    log(`push keys: unavailable (${e.message}); budget alerts stay off`);
  }
}

// What the sign-in emails say: the 6-digit code works in the installed
// iPhone app (a link would open Safari, which has separate storage).
export const CODE_EMAIL = `<h2>Your sign-in code</h2>
<p>Enter this code in the app: <strong style="font-size:20px;letter-spacing:2px">{{ .Token }}</strong></p>
<p>Or on this device, <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email">sign in with this link</a>.</p>
<p style="color:#5b6167">If you didn't ask for this, ignore this email.</p>`;

/** The Management API body for this deployment's auth settings. */
export function authConfigFor(siteUrl, currentAllowList = "") {
  const allow = new Set(
    currentAllowList
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
  allow.add(`${siteUrl}/**`);
  allow.add("http://localhost:3000/**");
  return {
    site_url: siteUrl,
    uri_allow_list: [...allow].join(","),
    mailer_subjects_magic_link: "Your sign-in code",
    mailer_templates_magic_link_content: CODE_EMAIL,
    mailer_subjects_confirmation: "Your sign-in code",
    mailer_templates_confirmation_content: CODE_EMAIL,
  };
}

async function configureAuth() {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (!token || !supabaseUrl) return;
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") return log("auth settings: only set on production deploys");
  if (!host) return log("auth settings: skipped (no VERCEL_PROJECT_PRODUCTION_URL)");

  const ref = new URL(supabaseUrl).hostname.split(".")[0];
  const api = `https://api.supabase.com/v1/projects/${ref}/config/auth`;
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  try {
    const current = await fetch(api, { headers });
    if (!current.ok) throw new Error(`GET ${current.status} ${await current.text()}`);
    const body = authConfigFor(`https://${host}`, (await current.json()).uri_allow_list ?? "");
    const res = await fetch(api, { method: "PATCH", headers, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`PATCH ${res.status} ${await res.text()}`);
    log(`auth settings: Site URL https://${host}, sign-in emails carry the code`);
  } catch (e) {
    // Not worth failing a deploy over; the README has the manual steps.
    log(`auth settings: couldn't update (${e.message}). Do README → "Finish sign-in setup" by hand.`);
  }
}

async function main() {
  if (!dbUrls.length && !process.env.SUPABASE_ACCESS_TOKEN) return log("no database URL or access token set; nothing to do");
  if (dbUrls.length) {
    const url = await reachable(dbUrls);
    await migrate(url);
    await preparePushKeys(url);
  } else log("no database URL set; run supabase/migrations/ yourself (README)");
  await configureAuth();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error("[setup] failed:", e.message);
    process.exit(1);
  });
}
