// A tiny stand-in for Supabase (auth + PostgREST) with a sample household, so
// the app can run without a real project: used by `npm run screenshots` to
// produce the README images. Read-only, and only as smart as those screens
// need: eq/neq/gte/gt/lte/lt/is filters, limit/offset, single-object
// responses, counts, and the views/RPCs the dashboard reads.

import { createServer } from "node:http";

const TZ = "Australia/Sydney";
const HOUSEHOLD = "00000000-0000-4000-8000-000000000001";
const ALEX = "00000000-0000-4000-8000-0000000000a1";
const SAM = "00000000-0000-4000-8000-0000000000a2";
export const USER = { id: "00000000-0000-4000-8000-0000000000f1", email: "alex@example.com" };

const day = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const sydneyDate = (d) => day.format(new Date(d));

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------
const members = [
  { id: ALEX, household_id: HOUSEHOLD, user_id: USER.id, email: USER.email, display_name: "Alex", colour: "#1D4ED8", created_at: "2026-01-01T00:00:00Z" },
  { id: SAM, household_id: HOUSEHOLD, user_id: "00000000-0000-4000-8000-0000000000f2", email: "sam@example.com", display_name: "Sam", colour: "#C2410C", created_at: "2026-01-02T00:00:00Z" },
];
const households = [{ id: HOUSEHOLD, name: "Our place" }];

const catDefs = [
  ["Groceries", "shopping-cart", 80000],
  ["Eating out", "utensils", 30000],
  ["Coffee", "coffee", 8000],
  ["Transport & fuel", "fuel", 25000],
  ["Rent", "house", null],
  ["Bills & utilities", "receipt", 40000],
  ["Shopping", "shopping-bag", 20000],
  ["Health", "heart-pulse", null],
  ["Entertainment", "clapperboard", 10000],
  ["Subscriptions", "repeat", 6000],
  ["Travel", "plane", null],
  ["Gifts", "gift", null],
  ["Transfers", "arrow-left-right", null],
];
const categories = catDefs.map(([name, icon, budget], i) => ({
  id: `00000000-0000-4000-8000-0000000c${String(i).padStart(4, "0")}`,
  household_id: HOUSEHOLD,
  name,
  icon,
  colour: "#0F766E",
  monthly_budget_cents: budget,
  sort: (i + 1) * 10,
  counts_as_spending: name !== "Transfers",
}));
const cat = (name) => categories.find((c) => c.name === name)?.id ?? null;

const accounts = [
  { id: "00000000-0000-4000-8000-00000000ac01", household_id: HOUSEHOLD, member_id: ALEX, bank: "ANZ", nickname: "ANZ Visa", last4: "4821", type: "debit", is_default: true, created_at: "2026-01-01T00:00:00Z" },
  { id: "00000000-0000-4000-8000-00000000ac02", household_id: HOUSEHOLD, member_id: SAM, bank: "NAB", nickname: "NAB Visa", last4: "1357", type: "debit", is_default: true, created_at: "2026-01-02T00:00:00Z" },
];

// [days ago, hour, member, merchant, dollars, category, source]
const recent = [
  [0, 8, ALEX, "Bakery Newtown", 6.5, "Coffee", "apple_pay"],
  [0, 12, SAM, "Guzman y Gomez", 18.9, "Eating out", "android"],
  [0, 17, ALEX, "Woolworths", 64.2, "Groceries", "apple_pay"],
  [1, 9, SAM, "7-Eleven", 4.5, "Coffee", "android"],
  [1, 18, ALEX, "Shell Coles Express", 71.4, "Transport & fuel", "apple_pay"],
  [1, 19, SAM, "Coles", 38.5, "Groceries", "android"],
  [2, 13, ALEX, "Kmart", 46, "Shopping", "csv"],
  [2, 20, SAM, "Netflix", 18.99, "Subscriptions", "csv"],
  [3, 8, ALEX, "Bakery Newtown", 6.5, "Coffee", "apple_pay"],
  [3, 19, SAM, "Thai Riffic", 52, "Eating out", "android"],
  [4, 10, ALEX, "Chemist Warehouse", 23.4, "Health", "apple_pay"],
  [4, 16, SAM, "Aldi", 41.8, "Groceries", "android"],
  [5, 11, ALEX, "Bunnings", 37.6, null, "csv"],
  [5, 14, SAM, "Hoyts", 34, "Entertainment", "android"],
  [6, 9, ALEX, "Origin Energy", 142.3, "Bills & utilities", "csv"],
  [6, 12, SAM, "KBC Surry Hills", 2.5, null, "csv"],
  [7, 18, ALEX, "Woolworths", 88.1, "Groceries", "apple_pay"],
  [8, 8, SAM, "7-Eleven", 4.5, "Coffee", "android"],
  [9, 19, ALEX, "Domino's", 27.95, "Eating out", "apple_pay"],
  [10, 10, SAM, "Telstra", 65, "Bills & utilities", "csv"],
  [11, 9, ALEX, "Rent – Ray White", 650, "Rent", "csv"],
  [12, 14, SAM, "JB Hi-Fi", 89, "Shopping", "android"],
  [13, 18, ALEX, "Coles", 52.3, "Groceries", "apple_pay"],
  [14, 9, SAM, "Spotify", 13.99, "Subscriptions", "csv"],
  [15, 11, ALEX, "To savings", 500, "Transfers", "csv"],
  [16, 13, SAM, "Bunnings", 12.4, null, "csv"],
  [17, 8, ALEX, "Bakery Newtown", 6.5, "Coffee", "apple_pay"],
  [18, 17, SAM, "Woolworths", 72.6, "Groceries", "android"],
  [20, 19, ALEX, "Mary's Burgers", 41, "Eating out", "apple_pay"],
  [22, 15, SAM, "Priceline", 19.95, "Health", "android"],
];

function build(today = new Date()) {
  const txns = [];
  let n = 0;
  const add = (at, member, merchant, dollars, category, source, extra = {}) => {
    n += 1;
    txns.push({
      id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
      household_id: HOUSEHOLD,
      member_id: member,
      account_id: member === ALEX ? accounts[0].id : accounts[1].id,
      amount_cents: -Math.round(dollars * 100),
      merchant_raw: source === "manual" ? null : merchant.toUpperCase(),
      merchant,
      category_id: cat(category),
      occurred_at: at.toISOString(),
      source,
      status: source === "apple_pay" || source === "android" ? "captured" : "confirmed",
      external_ref: source === "csv" ? `ref-${n}` : null,
      note: null,
      review_reason: null,
      ...extra,
    });
  };
  for (const [ago, hour, member, merchant, dollars, category, source] of recent) {
    const at = new Date(today);
    at.setDate(at.getDate() - ago);
    at.setHours(hour, 15, 0, 0);
    if (at > today) at.setTime(today.getTime() - 3600_000);
    add(at, member, merchant, dollars, category, source, source === "apple_pay" || source === "android" ? { status: "confirmed" } : {});
  }
  // A coffee typed in by hand and the same one from the bank: a possible duplicate.
  const coffee = new Date(today);
  coffee.setDate(coffee.getDate() - 6);
  coffee.setHours(7, 40, 0, 0);
  add(coffee, SAM, "Coffee", 2.5, "Coffee", "manual");
  txns.find((t) => t.merchant === "KBC Surry Hills").review_reason = "Possible duplicate: a manual entry could be this purchase";

  // Earlier months for the trend: a steady pattern with some variation.
  const pattern = [
    ["Rent – Ray White", 650, "Rent"], ["Woolworths", 320, "Groceries"], ["Coles", 190, "Groceries"],
    ["Eating out", 210, "Eating out"], ["Shell", 160, "Transport & fuel"], ["Origin Energy", 140, "Bills & utilities"],
    ["Telstra", 65, "Bills & utilities"], ["Kmart", 90, "Shopping"], ["Netflix", 18.99, "Subscriptions"], ["Cafés", 70, "Coffee"],
  ];
  for (let m = 1; m <= 6; m++) {
    pattern.forEach(([merchant, dollars, category], i) => {
      const at = new Date(today.getFullYear(), today.getMonth() - m, 3 + i * 2, 12);
      add(at, i % 2 ? SAM : ALEX, merchant, dollars * (0.8 + ((m * 7 + i * 3) % 9) / 20), category, "csv");
    });
  }
  return txns.sort((a, b) => b.occurred_at.localeCompare(a.occurred_at) || a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------------------
// Views and RPCs
// ---------------------------------------------------------------------------
function periodStart(kind, d) {
  const [y, m, dd] = d.split("-").map(Number);
  if (kind === "year") return `${y}-01-01`;
  if (kind === "month") return `${y}-${String(m).padStart(2, "0")}-01`;
  const x = new Date(Date.UTC(y, m - 1, dd));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x.toISOString().slice(0, 10);
}

function spendByPeriod(txns) {
  const counts = new Map(categories.map((c) => [c.id, c.counts_as_spending]));
  const groups = new Map();
  for (const t of txns) {
    if (t.category_id && counts.get(t.category_id) === false) continue;
    const d = sydneyDate(t.occurred_at);
    for (const period of ["week", "month", "year"]) {
      const key = [period, periodStart(period, d), t.member_id, t.category_id].join("|");
      const g = groups.get(key) ?? { household_id: HOUSEHOLD, period, period_start: periodStart(period, d), member_id: t.member_id, category_id: t.category_id, spent_cents: 0, txn_count: 0 };
      g.spent_cents -= t.amount_cents;
      g.txn_count += 1;
      groups.set(key, g);
    }
  }
  return [...groups.values()];
}

function needsReview(txns) {
  const week = Date.now() - 7 * 86_400_000;
  return txns
    .filter((t) => !t.category_id || (t.status === "captured" && Date.parse(t.occurred_at) < week) || t.review_reason)
    .map((t) => ({
      ...t,
      needs_category: !t.category_id,
      needs_confirmation: t.status === "captured" && Date.parse(t.occurred_at) < week,
      possible_duplicate: Boolean(t.review_reason),
    }));
}

function rpc(name, body, txns) {
  if (name === "top_merchants") {
    const counts = new Map(categories.map((c) => [c.id, c.counts_as_spending]));
    const by = new Map();
    for (const t of txns) {
      const d = sydneyDate(t.occurred_at);
      if (d < body.p_from || d >= body.p_to || (t.category_id && counts.get(t.category_id) === false)) continue;
      const g = by.get(t.merchant) ?? { merchant: t.merchant, spent_cents: 0, txn_count: 0 };
      g.spent_cents -= t.amount_cents;
      g.txn_count += 1;
      by.set(t.merchant, g);
    }
    return [...by.values()].sort((a, b) => b.spent_cents - a.spent_cents).slice(0, body.p_limit ?? 5);
  }
  if (name === "duplicate_candidates") {
    const t = txns.find((x) => x.id === body.p_id);
    return t ? txns.filter((x) => x.source === "manual" && x.amount_cents === t.amount_cents) : [];
  }
  if (name === "claim_membership") return null;
  return null;
}

// ---------------------------------------------------------------------------
// PostgREST-ish querying
// ---------------------------------------------------------------------------
function applyFilters(rows, params) {
  let out = rows;
  for (const [key, raw] of params) {
    if (["select", "order", "limit", "offset", "or", "columns"].includes(key)) continue;
    const m = /^(not\.)?(eq|neq|gte|gt|lte|lt|is|in)\.(.*)$/.exec(raw);
    if (!m) continue;
    const [, not, op, v] = m;
    const val = v === "null" ? null : v;
    const test = (x) => {
      const a = x[key] == null ? null : String(x[key]);
      switch (op) {
        case "eq": return a === val;
        case "neq": return a !== val;
        case "is": return val === null ? a === null : a === val;
        case "gte": return a !== null && a >= val;
        case "gt": return a !== null && a > val;
        case "lte": return a !== null && a <= val;
        case "lt": return a !== null && a < val;
        case "in": return v.replace(/^\(|\)$/g, "").split(",").includes(a);
      }
      return true;
    };
    out = out.filter((x) => (not ? !test(x) : test(x)));
  }
  const offset = Number(params.get("offset") ?? 0);
  const limit = params.has("limit") ? Number(params.get("limit")) : Infinity;
  return { total: out.length, rows: out.slice(offset, offset + limit) };
}

export function startMock(port = 54321) {
  const txns = build();
  const tables = {
    members,
    households,
    categories,
    accounts,
    transactions: txns,
    v_spend_by_period: spendByPeriod(txns),
    v_needs_review: needsReview(txns),
    merchant_rules: [],
    device_tokens: [{ id: "d1", member_id: ALEX, label: "Alex's iPhone", last_used_at: new Date().toISOString(), revoked_at: null, created_at: "2026-01-01T00:00:00Z" }],
    ingest_failures: [],
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const send = (status, body, headers = {}) => {
      res.writeHead(status, {
        "Access-Control-Allow-Origin": req.headers.origin ?? "*",
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Headers": req.headers["access-control-request-headers"] ?? "*",
        "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,HEAD,OPTIONS",
        "Access-Control-Expose-Headers": "Content-Range",
        "Content-Type": "application/json",
        ...headers,
      });
      res.end(body === undefined ? undefined : JSON.stringify(body));
    };
    if (req.method === "OPTIONS") return send(204);

    let body = {};
    if (req.method === "POST" || req.method === "PATCH") {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      try {
        body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
      } catch {
        body = {};
      }
    }

    if (url.pathname === "/auth/v1/user") {
      return send(200, { ...USER, aud: "authenticated", role: "authenticated", app_metadata: { provider: "email" }, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" });
    }
    if (url.pathname.startsWith("/auth/v1/.well-known")) return send(200, { keys: [] });
    if (url.pathname.startsWith("/auth/v1/")) return send(200, {});

    const rpcMatch = /^\/rest\/v1\/rpc\/([a-z_]+)$/.exec(url.pathname);
    if (rpcMatch) return send(200, rpc(rpcMatch[1], { ...Object.fromEntries(url.searchParams), ...body }, txns));

    const table = /^\/rest\/v1\/([a-z_]+)$/.exec(url.pathname)?.[1];
    if (!table) return send(404, { message: "not found" });
    if (req.method !== "GET" && req.method !== "HEAD") return send(200, []); // writes are no-ops
    const { total, rows } = applyFilters(tables[table] ?? [], url.searchParams);
    const headers = { "Content-Range": `0-${Math.max(0, rows.length - 1)}/${total}` };
    if (req.method === "HEAD") return send(200, undefined, headers);
    if ((req.headers.accept ?? "").includes("vnd.pgrst.object")) {
      return rows.length ? send(200, rows[0], headers) : send(406, { code: "PGRST116", message: "no rows" });
    }
    return send(200, rows, headers);
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startMock().then(() => console.log("mock Supabase on http://localhost:54321"));
}
