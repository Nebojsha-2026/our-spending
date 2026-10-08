// Screenshots for the README, from the real app running against the mock
// Supabase in mock-supabase.mjs. Run with `npm run screenshots` (it builds the
// app pointed at the mock first). Needs a Chromium: set CHROMIUM_PATH, or run
// `npx playwright install chromium` once.
//
// Output: docs/screenshots/<name>-<light|dark>.png (OUT_DIR to change it) at iPhone size (390×844 @2x).

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { USER, startMock } from "./mock-supabase.mjs";

const ROOT = join(import.meta.dirname, "..", "..");
const OUT = process.env.OUT_DIR || join(ROOT, "docs", "screenshots");
const PORT = 3100;
const BASE = `http://localhost:${PORT}`;

function b64url(s) {
  return Buffer.from(s).toString("base64url");
}

// A session cookie in @supabase/ssr's format. The mock accepts any token.
function sessionCookie() {
  const now = Math.floor(Date.now() / 1000);
  const jwt = [
    b64url(JSON.stringify({ alg: "HS256", typ: "JWT" })),
    b64url(JSON.stringify({ sub: USER.id, email: USER.email, role: "authenticated", aud: "authenticated", iat: now, exp: now + 86400 })),
    "mock",
  ].join(".");
  const session = { access_token: jwt, refresh_token: "mock", token_type: "bearer", expires_in: 86400, expires_at: now + 86400, user: { ...USER, aud: "authenticated", role: "authenticated" } };
  return { name: "sb-localhost-auth-token", value: "base64-" + b64url(JSON.stringify(session)), domain: "localhost", path: "/" };
}

async function waitFor(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      if ((await fetch(url)).status < 500) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${url} didn't start`);
}

const SHOTS = [
  { name: "sign-in", path: "/login", signedIn: false },
  { name: "overview", path: "/" },
  { name: "overview-category", path: "/", act: (p) => p.getByRole("button", { name: /Groceries/ }).first().click(), after: "text=Tap one to edit it" },
  { name: "activity", path: "/activity" },
  { name: "needs-review", path: "/activity?filter=review", wait: "text=by merchant" },
  { name: "duplicate", path: "/activity?filter=review", wait: "text=by merchant", act: (p) => p.getByRole("button", { name: /KBC Surry Hills/ }).click(), after: "text=Compare with the earlier entry" },
  { name: "quick-add", path: "/add" },
  { name: "budgets", path: "/budgets" },
  { name: "settings", path: "/settings" },
  { name: "tour", path: "/", tour: true, wait: "text=Tap, and it's logged" },
  {
    name: "tour-last",
    path: "/",
    tour: true,
    wait: "text=Tap, and it's logged",
    act: async (p) => {
      for (let i = 0; i < 3; i++) {
        await p.getByRole("button", { name: "Continue" }).click();
        await p.waitForTimeout(600);
      }
    },
    after: "text=Set up my phone",
  },
];

async function main() {
  mkdirSync(OUT, { recursive: true });
  const mock = await startMock();
  const app = spawn("npx", ["next", "start", "-p", String(PORT)], { cwd: ROOT, stdio: "inherit" });
  try {
    await waitFor(`${BASE}/login`);
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
    for (const scheme of ["light", "dark"]) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme, locale: "en-AU", timezoneId: "Australia/Sydney" });
      // ONLY=overview,quick-add npm run screenshots → just those.
      const only = process.env.ONLY?.split(",");
      for (const s of SHOTS.filter((x) => !only || only.includes(x.name))) {
        await ctx.clearCookies();
        if (s.signedIn !== false) await ctx.addCookies([sessionCookie()]);
        const page = await ctx.newPage();
        // The welcome tour shows once per phone; only the tour shots want it.
        await page.addInitScript((tour) => (tour ? localStorage.removeItem("tour-v1") : localStorage.setItem("tour-v1", "1")), Boolean(s.tour));
        await page.goto(BASE + s.path, { waitUntil: "networkidle" });
        if (s.wait) await page.waitForSelector(s.wait);
        if (s.act) await s.act(page);
        if (s.after) await page.waitForSelector(s.after);
        await page.waitForTimeout(700); // let entrance animations finish
        await page.screenshot({ path: join(OUT, `${s.name}-${scheme}.png`) });
        console.log(`saved ${s.name}-${scheme}.png`);
        await page.close();
      }
      await ctx.close();
    }
    await browser.close();
  } finally {
    app.kill();
    mock.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
