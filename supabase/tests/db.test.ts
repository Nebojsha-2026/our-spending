// Runs the real migrations against PGlite (in-process Postgres) with a minimal
// stand-in for Supabase's auth schema, then checks RLS and the dashboard views
// as the `authenticated` role. `npm test` runs it.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { cleanMerchant } from "../../src/lib/ingest";

const MIGRATIONS = join(__dirname, "..", "migrations");

const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.jwt() returns jsonb language sql stable as
    $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  grant usage on schema auth to anon, authenticated;
  grant usage on schema public to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on functions to anon, authenticated;
`;

const A = "00000000-0000-0000-0000-00000000000a"; // first person, household 1
const B = "00000000-0000-0000-0000-00000000000b"; // invited partner, household 1
const X = "00000000-0000-0000-0000-00000000000c"; // stranger, household 2

let db: PGlite;

async function as<T>(uid: string, email: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`
    set role authenticated;
    select set_config('request.jwt.claim.sub', '${uid}', false);
    select set_config('request.jwt.claims', '{"sub":"${uid}","email":"${email}"}', false);
  `);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role;`);
  }
}

const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  (await db.query<T>(sql, params)).rows;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUB);
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
  }
  await db.exec(`
    insert into auth.users values
      ('${A}', 'a@example.com'), ('${B}', 'b@example.com'), ('${X}', 'x@example.com');
  `);
});

describe("onboarding", () => {
  it("creates a household with the default categories", async () => {
    await as(A, "a@example.com", async () => {
      await rows(`select public.create_household('Home', 'Alex')`);
      const cats = await rows<{ name: string }>(`select name from public.categories order by sort`);
      expect(cats.map((c) => c.name)).toEqual([
        "Groceries", "Eating out", "Transport & fuel", "Rent", "Bills & utilities", "Shopping",
        "Health", "Entertainment", "Subscriptions", "Travel", "Gifts", "Other", "Transfers",
      ]);
      await expect(rows(`select public.create_household('Again', 'Me')`)).rejects.toThrow(
        /already belong/,
      );
    });
  });

  it("lets an invited partner claim their member row by email", async () => {
    await as(A, "a@example.com", () =>
      rows(`insert into public.members (household_id, email, display_name, colour)
            select household_id, 'B@Example.com', 'Sam', '#C2410C' from public.members`),
    );
    await as(B, "b@example.com", async () => {
      const [{ claim_membership }] = await rows<{ claim_membership: string | null }>(
        `select public.claim_membership()`,
      );
      expect(claim_membership).not.toBeNull();
      expect(await rows(`select display_name from public.members order by display_name`)).toEqual([
        { display_name: "Alex" },
        { display_name: "Sam" },
      ]);
    });
  });

  it("does not let members set user_id directly", async () => {
    await as(A, "a@example.com", async () => {
      await expect(rows(`update public.members set user_id = '${X}'`)).rejects.toThrow(
        /permission denied/,
      );
    });
  });
});

describe("row-level security", () => {
  beforeAll(async () => {
    await as(X, "x@example.com", () => rows(`select public.create_household('Other', 'Stranger')`));
    await as(A, "a@example.com", () =>
      rows(`
        insert into public.transactions (household_id, member_id, amount_cents, merchant, category_id, source, status, occurred_at)
        select m.household_id, m.id, -2350, 'Woolworths',
               (select id from public.categories where name = 'Groceries'), 'manual', 'confirmed',
               '2026-10-05 23:30:00+11'
        from public.members m where m.user_id = auth.uid()`),
    );
  });

  it("hides other households' rows", async () => {
    await as(X, "x@example.com", async () => {
      expect(await rows(`select * from public.transactions`)).toHaveLength(0);
      expect(await rows(`select * from public.members`)).toHaveLength(1);
      expect(await rows(`select * from public.v_spend_by_period`)).toHaveLength(0);
      expect(await rows(`select count(*)::int as n from public.categories`)).toEqual([{ n: 13 }]);
    });
  });

  it("rejects writes into another household", async () => {
    const [{ householdA, memberA }] = await rows<{ householdA: string; memberA: string }>(
      `select household_id as "householdA", id as "memberA" from public.members where user_id = '${A}'`,
    );
    await as(X, "x@example.com", async () => {
      await expect(
        rows(
          `insert into public.categories (household_id, name) values ($1, 'Sneaky')`,
          [householdA],
        ),
      ).rejects.toThrow(/row-level security/);
      // Pointing at another household's member is blocked by the composite FK.
      const [{ hid }] = await rows<{ hid: string }>(`select household_id as hid from public.members`);
      await expect(
        rows(
          `insert into public.transactions (household_id, member_id, amount_cents, merchant, source)
           values ($1, $2, -100, 'x', 'manual')`,
          [hid, memberA],
        ),
      ).rejects.toThrow(/foreign key/);
    });
  });

  it("gives anon nothing", async () => {
    await db.exec(`set role anon`);
    try {
      await expect(rows(`select * from public.transactions`)).rejects.toThrow(/permission denied/);
    } finally {
      await db.exec(`reset role`);
    }
  });
});

describe("dashboard views", () => {
  it("buckets by Sydney week (Mon–Sun), month and year", async () => {
    // Sunday 11 Oct 10:00 Sydney is Saturday 23:00 UTC; it must land in the week of Mon 5 Oct.
    await as(A, "a@example.com", async () => {
      await rows(`
        insert into public.transactions (household_id, member_id, amount_cents, merchant, source, occurred_at)
        select household_id, id, -1000, 'KAFE 88', 'apple_pay', '2026-10-11 10:00:00+11'
        from public.members where user_id = auth.uid()`);
      const weeks = await rows<{ period_start: Date; spent: number }>(`
        select period_start, sum(spent_cents)::int as spent from public.v_spend_by_period
        where period = 'week' group by period_start`);
      expect(weeks).toHaveLength(1);
      expect(weeks[0].period_start.toISOString().slice(0, 10)).toBe("2026-10-05");
      expect(weeks[0].spent).toBe(3350);

      const review = await rows<{ merchant: string }>(`select merchant from public.v_needs_review`);
      expect(review.map((r) => r.merchant)).toEqual(["KAFE 88"]);

      const top = await rows(`select * from public.top_merchants('2026-10-01', '2026-11-01')`);
      expect(top).toEqual([
        { merchant: "Woolworths", spent_cents: 2350, txn_count: 1 },
        { merchant: "KAFE 88", spent_cents: 1000, txn_count: 1 },
      ]);
    });
  });

  it("treats a Sunday-night Sydney purchase as that week, not the next", async () => {
    await as(A, "a@example.com", async () => {
      // Sunday 11 Oct 23:59 Sydney (12:59 UTC Sunday) stays in week of 5 Oct.
      await rows(`
        insert into public.transactions (household_id, member_id, amount_cents, merchant, category_id, source, occurred_at)
        select household_id, id, -500, 'Late', (select id from public.categories where name = 'Other'),
               'manual', '2026-10-11 23:59:00+11'
        from public.members where user_id = auth.uid()`);
      // Monday 12 Oct 00:30 Sydney (Sun 13:30 UTC) is the next week.
      await rows(`
        insert into public.transactions (household_id, member_id, amount_cents, merchant, category_id, source, occurred_at)
        select household_id, id, -700, 'Early', (select id from public.categories where name = 'Other'),
               'manual', '2026-10-12 00:30:00+11'
        from public.members where user_id = auth.uid()`);
      const weeks = await rows<{ period_start: Date; spent: number }>(`
        select period_start, sum(spent_cents)::int as spent from public.v_spend_by_period
        where period = 'week' group by period_start order by period_start`);
      expect(weeks.map((w) => [w.period_start.toISOString().slice(0, 10), w.spent])).toEqual([
        ["2026-10-05", 3850],
        ["2026-10-12", 700],
      ]);
    });
  });
});

describe("phone ingest", () => {
  const HASH = "a".repeat(64);
  const ingest = (overrides: Record<string, unknown> = {}) => {
    const p = {
      hash: HASH, cents: -2350, raw: "WOOLWORTHS 1234 NEWTOWN", fallback: "Woolworths",
      card: "ANZ Visa", source: "apple_pay", at: "2026-10-07T18:40:00+11:00", ...overrides,
    };
    return rows<{ r: { id: string; merchant: string; category: string | null; duplicate: boolean } }>(
      `select public.ingest_transaction($1, $2, $3, $4, $5, $6, $7) as r`,
      [p.hash, p.cents, p.raw, p.fallback, p.card, p.source, p.at],
    ).then((x) => x[0].r);
  };
  const asAnon = async <T>(fn: () => Promise<T>) => {
    await db.exec(`set role anon`);
    try {
      return await fn();
    } finally {
      await db.exec(`reset role`);
    }
  };

  beforeAll(async () => {
    await as(A, "a@example.com", () =>
      rows(`
        with me as (select id, household_id from public.members where user_id = auth.uid())
        , tok as (insert into public.device_tokens (member_id, label, token_hash)
                  select id, 'iPhone', '${HASH}' from me)
        , acct as (insert into public.accounts (household_id, member_id, bank, nickname, last4, type, is_default)
                   select household_id, id, 'ANZ', 'ANZ Visa', '1234', 'debit', true from me)
        insert into public.merchant_rules (household_id, match_pattern, clean_name, category_id)
        select household_id, 'WOOLWORTHS%', 'Woolworths',
               (select id from public.categories where name = 'Groceries') from me`),
    );
  });

  it("lets signed-in users create tokens but never read another household's", async () => {
    await as(X, "x@example.com", async () => {
      expect(await rows(`select * from public.device_tokens`)).toHaveLength(0);
    });
  });

  it("applies the merchant rule, matches the card and returns a summary", async () => {
    const r = await asAnon(() => ingest());
    expect(r).toMatchObject({ merchant: "Woolworths", category: "Groceries", duplicate: false });
    const [t] = await rows<Record<string, unknown>>(
      `select t.amount_cents, t.status, t.source, a.nickname, t.device_token_id is not null as by_token
       from public.transactions t left join public.accounts a on a.id = t.account_id where t.id = $1`,
      [r.id],
    );
    expect(t).toEqual({ amount_cents: -2350, status: "captured", source: "apple_pay", nickname: "ANZ Visa", by_token: true });
  });

  it("treats a repeat within 2 minutes as the same purchase", async () => {
    const r = await asAnon(() => ingest({ at: "2026-10-07T18:41:30+11:00" }));
    expect(r.duplicate).toBe(true);
    const later = await asAnon(() => ingest({ at: "2026-10-07T18:45:00+11:00" }));
    expect(later.duplicate).toBe(false);
  });

  it("falls back to the tidy name and the default card, uncategorised", async () => {
    const r = await asAnon(() => ingest({ raw: "KAFE 88 SYDNEY", fallback: "Kafe", card: "Some other card", cents: -1240 }));
    expect(r).toMatchObject({ merchant: "Kafe", category: null });
    const [t] = await rows<{ nickname: string }>(
      `select a.nickname from public.transactions t join public.accounts a on a.id = t.account_id where t.id = $1`,
      [r.id],
    );
    expect(t.nickname).toBe("ANZ Visa");
  });

  it("rejects bad tokens, revoked tokens and bad input", async () => {
    await expect(asAnon(() => ingest({ hash: "b".repeat(64) }))).rejects.toThrow(/Invalid or revoked/);
    await expect(asAnon(() => ingest({ cents: 500 }))).rejects.toThrow(/negative/);
    await expect(asAnon(() => ingest({ source: "csv" }))).rejects.toThrow(/Unknown source/);
    await rows(`update public.device_tokens set revoked_at = now() where token_hash = '${HASH}'`);
    await expect(asAnon(() => ingest({ at: "2026-10-07T20:00:00+11:00" }))).rejects.toThrow(/Invalid or revoked/);
    await rows(`update public.device_tokens set revoked_at = null where token_hash = '${HASH}'`);
  });

  it("rate-limits a token to 20 captures per 10 minutes", async () => {
    // 3 captured so far; fill up to 20.
    for (let i = 0; i < 17; i++) {
      await asAnon(() => ingest({ cents: -(100 + i), at: `2026-10-07T21:${String(i).padStart(2, "0")}:00+11:00` }));
    }
    await expect(asAnon(() => ingest({ cents: -999, at: "2026-10-07T22:00:00+11:00" }))).rejects.toThrow(/Too many/);
  });

  it("gives anon no direct table access", async () => {
    await expect(asAnon(() => rows(`select * from public.device_tokens`))).rejects.toThrow(/permission denied/);
  });
});

describe("Pixel capture", () => {
  const HASH = "c".repeat(64);
  const ingest = (o: { cents: number; raw: string; card?: string | null; source?: string; at: string }) =>
    rows<{ r: { id: string; merchant: string; duplicate: boolean } }>(
      `select public.ingest_transaction($1, $2, $3, $4, $5, $6, $7) as r`,
      [HASH, o.cents, o.raw, o.raw, o.card ?? null, o.source ?? "android", o.at],
    ).then((x) => x[0].r);
  const asAnon = async <T>(fn: () => Promise<T>) => {
    await db.exec(`set role anon`);
    try {
      return await fn();
    } finally {
      await db.exec(`reset role`);
    }
  };

  beforeAll(async () => {
    await as(A, "a@example.com", () =>
      rows(`
        with me as (select id, household_id from public.members where user_id = auth.uid())
        , tok as (insert into public.device_tokens (member_id, label, token_hash) select id, 'Pixel', '${HASH}' from me)
        insert into public.accounts (household_id, member_id, bank, nickname, last4, type)
        select household_id, id, 'NAB', 'NAB Classic', '5678', 'debit' from me`),
    );
  });

  it("matches the card by its last 4 digits", async () => {
    const r = await asAnon(() => ingest({ cents: -4600, raw: "Kmart", card: "Mastercard 5678", at: "2026-10-08T10:00:00+11:00" }));
    const [t] = await rows<{ nickname: string }>(
      `select a.nickname from public.transactions t join public.accounts a on a.id = t.account_id where t.id = $1`,
      [r.id],
    );
    expect(t.nickname).toBe("NAB Classic");
  });

  it("keeps one transaction when Wallet and the bank app both notify", async () => {
    const wallet = await asAnon(() => ingest({ cents: -2790, raw: "Guzman y Gomez", card: "Visa 1234", at: "2026-10-08T12:30:00+11:00" }));
    const bank = await asAnon(() => ingest({ cents: -2790, raw: "GUZMAN Y GOMEZ 0123 RYDE", card: "1234", at: "2026-10-08T12:31:10+11:00" }));
    expect(wallet.duplicate).toBe(false);
    expect(bank).toMatchObject({ id: wallet.id, duplicate: true, merchant: "Guzman y Gomez" });
    // A different amount, or more than 2 minutes later, is a new purchase.
    expect((await asAnon(() => ingest({ cents: -2791, raw: "X", at: "2026-10-08T12:31:00+11:00" }))).duplicate).toBe(false);
    expect((await asAnon(() => ingest({ cents: -2790, raw: "Y", at: "2026-10-08T12:35:00+11:00" }))).duplicate).toBe(false);
  });

  it("saves a notification with no shop name as 'Card payment', and fills the name in later", async () => {
    const noName = (cents: number, at: string, text = "Visa | $2.50") =>
      rows<{ r: { id: string; merchant: string; duplicate: boolean } }>(
        `select public.ingest_transaction($1, $2, null, 'Card payment', 'Visa', 'android', $3, $4) as r`,
        [HASH, cents, at, text],
      ).then((x) => x[0].r);
    const look = (id: string) =>
      rows<{ merchant: string; merchant_raw: string | null; note: string | null }>(
        `select merchant, merchant_raw, note from public.transactions where id = $1`,
        [id],
      ).then((x) => x[0]);

    // Wallet first (card as title), then the bank app with the shop name.
    const first = await asAnon(() => noName(-250, "2026-10-09T08:00:00+11:00"));
    expect(first).toMatchObject({ merchant: "Card payment", duplicate: false });
    expect(await look(first.id)).toEqual({ merchant: "Card payment", merchant_raw: null, note: "Notification: Visa | $2.50" });
    const bank = await asAnon(() => ingest({ cents: -250, raw: "HUNGRY JACKS 0123 NEWTOWN", card: "1234", at: "2026-10-09T08:00:40+11:00" }));
    expect(bank).toMatchObject({ id: first.id, duplicate: true });
    expect(await look(first.id)).toEqual({ merchant: "HUNGRY JACKS 0123 NEWTOWN", merchant_raw: "HUNGRY JACKS 0123 NEWTOWN", note: null });

    // No second notification: the bank CSV row that confirms it brings the name.
    const lone = await asAnon(() => noName(-1234, "2026-10-09T12:00:00+11:00", "Visa ••5678 | $12.34"));
    await as(A, "a@example.com", async () => {
      const [{ id: card }] = await rows<{ id: string }>(`select id from public.accounts where nickname = 'NAB Classic'`);
      await rows(`select public.import_bank_rows($1, $2::jsonb, true)`, [
        card,
        JSON.stringify([{ idx: 1, date: "2026-10-09", amount_cents: -1234, description: "V5678 09/10 WOOLWORTHS 1234 NEWTOWN", merchant_fallback: "Woolworths", external_ref: "card-pay-1", include: true }]),
      ]);
    });
    expect(await look(lone.id)).toEqual({ merchant: "Woolworths", merchant_raw: "V5678 09/10 WOOLWORTHS 1234 NEWTOWN", note: null });
  });

  it("logs failures for the token's household only", async () => {
    const [{ ok }] = await asAnon(() =>
      rows<{ ok: boolean }>(`select public.log_ingest_failure($1, 'ANZ', 'ANZ | Something odd $5', 'no merchant found') as ok`, [HASH]),
    );
    expect(ok).toBe(true);
    await expect(
      asAnon(() => rows(`select public.log_ingest_failure($1, 'ANZ', 'x', 'y')`, ["d".repeat(64)])),
    ).rejects.toThrow(/Invalid or revoked/);
    await expect(asAnon(() => rows(`select * from public.ingest_failures`))).rejects.toThrow(/permission denied/);

    await as(A, "a@example.com", async () => {
      expect(await rows(`select app, raw, reason from public.ingest_failures`)).toEqual([
        { app: "ANZ", raw: "ANZ | Something odd $5", reason: "no merchant found" },
      ]);
      await expect(rows(`insert into public.ingest_failures (household_id, raw, reason) select household_id, 'x', 'y' from public.members limit 1`)).rejects.toThrow(/permission denied/);
    });
    await as(X, "x@example.com", async () => {
      expect(await rows(`select * from public.ingest_failures`)).toHaveLength(0);
    });
    await as(A, "a@example.com", async () => {
      await rows(`delete from public.ingest_failures`);
      expect(await rows(`select * from public.ingest_failures`)).toHaveLength(0);
    });
  });
});

describe("CSV import", () => {
  let account: string;
  const row = (idx: number, date: string, cents: number, description: string, include = true) => ({
    idx, date, amount_cents: cents, description, merchant_fallback: description, external_ref: `ref|${date}|${cents}|${description}`, include,
  });
  const rowsIn = [
    row(1, "2026-11-02", -2000, "MATCH ONE"),
    row(2, "2026-11-02", -3000, "AMBIG"),
    row(3, "2026-11-02", -4000, "NEW SHOP"),
    row(4, "2026-11-03", -2000, "MATCH ONE AGAIN"),
    row(5, "2026-11-03", -5000, "SKIPPED BY USER", false),
    row(6, "2026-11-04", -1500, "WOOLWORTHS 9 NEWTOWN"),
  ];
  const run = (commit: boolean, acct = account) =>
    rows<{ r: { idx: number; action: string; candidates: number; match: { merchant: string } | null }[] }>(
      `select public.import_bank_rows($1, $2::jsonb, $3) as r`,
      [acct, JSON.stringify(rowsIn), commit],
    ).then((x) => Object.fromEntries(x[0].r.map((o) => [o.idx, o])));

  beforeAll(async () => {
    await as(A, "a@example.com", async () => {
      const [a] = await rows<{ id: string }>(`
        insert into public.accounts (household_id, member_id, bank, nickname, last4, type)
        select household_id, id, 'ANZ', 'ANZ Black', '7777', 'credit' from public.members where user_id = auth.uid()
        returning id`);
      account = a.id;
      await rows(`
        insert into public.transactions (household_id, member_id, account_id, amount_cents, merchant_raw, merchant, occurred_at, source, status)
        select household_id, id, $1::uuid, v.cents, v.raw, v.merchant, v.at::timestamptz, 'apple_pay', 'captured'
        from public.members, (values
          (-2000, 'Phone One', 'Phone One', '2026-11-01 19:15:00+11'),
          (-3000, 'Ambig A', 'Ambig A', '2026-11-01 10:00:00+11'),
          (-3000, 'Ambig B', 'Ambig B', '2026-11-02 10:00:00+11')
        ) as v(cents, raw, merchant, at)
        where user_id = auth.uid()`, [account]);
    });
  });

  it("previews without writing anything", async () => {
    await as(A, "a@example.com", async () => {
      const r = await run(false);
      expect(r[1]).toMatchObject({ action: "merge", match: { merchant: "Phone One" } });
      expect(r[2]).toMatchObject({ action: "ambiguous", candidates: 2 });
      expect(r[3].action).toBe("new");
      expect(r[4].action).toBe("new"); // row 1 already claimed the only -$20 capture
      expect(r[5].action).toBe("new");
      const [{ n }] = await rows<{ n: number }>(`select count(*)::int as n from public.transactions where source = 'csv'`);
      expect(n).toBe(0);
    });
  });

  it("merges, flags and inserts on commit; re-importing does nothing", async () => {
    await as(A, "a@example.com", async () => {
      await run(true);
      const [merged] = await rows<Record<string, unknown>>(
        `select merchant, merchant_raw, status, source, occurred_at = '2026-11-01 19:15:00+11'::timestamptz as kept_time
         from public.transactions where external_ref = 'ref|2026-11-02|-2000|MATCH ONE'`,
      );
      expect(merged).toEqual({ merchant: "Phone One", merchant_raw: "MATCH ONE", status: "confirmed", source: "apple_pay", kept_time: true });

      const csvRows = await rows<{ merchant: string; review_reason: string | null; category: string | null }>(
        `select t.merchant, t.review_reason, c.name as category from public.transactions t
         left join public.categories c on c.id = t.category_id where t.source = 'csv' order by t.merchant`,
      );
      expect(csvRows).toEqual([
        { merchant: "AMBIG", review_reason: "Possible duplicate: 2 phone captures could be this purchase", category: null },
        { merchant: "MATCH ONE AGAIN", review_reason: null, category: null },
        { merchant: "NEW SHOP", review_reason: null, category: null },
        { merchant: "Woolworths", review_reason: null, category: "Groceries" },
      ]);
      const flagged = await rows(`select merchant from public.v_needs_review where possible_duplicate`);
      expect(flagged).toEqual([{ merchant: "AMBIG" }]);

      const again = await run(true);
      expect(Object.values(again).filter((o) => o.idx !== 5).every((o) => o.action === "already_imported")).toBe(true);
      const [{ n }] = await rows<{ n: number }>(`select count(*)::int as n from public.transactions where source = 'csv'`);
      expect(n).toBe(4);
    });
  });

  it("refuses another household's account", async () => {
    await as(X, "x@example.com", async () => {
      await expect(run(false)).rejects.toThrow(/Unknown account/);
    });
  });
});

describe("merchant cleaning and rules", () => {
  // Same inputs through cleanMerchant() (TS) and public.clean_merchant() (SQL).
  const SAMPLES = [
    "V4821 28/09 7-Eleven",
    "V4821 03/10 7-ELEVEN 2045 SYDNEY",
    "Eftpos 20/09 11:32KBC Surry Hills Surry Hills",
    "EFTPOS 20/09 11:32 KBC SURRY HILLS SURRY HILLS NSW",
    "Eftpos 20/09 9:05am Bakery Newtown Newtown",
    "M1234 01/10/2026 COLES 0745 RYDE",
    "Card xx1234 WOOLWORTHS NEWTOWN",
    "BP NEWTOWN Card xx1234 Value Date: 20/09/2026",
    "VISA PURCHASE 28/09 KFC",
    "WOOLWORTHS 1234 NEWTOWN",
    "SQ *THE CORNER",
    "PAYPAL *NETFLIX",
    "AMAZON MKTPL AU",
    "KMART 1077 PARRAMATTA NSW",
    "Guzman y Gomez",
    "Posh Nails",
    "Bora Bora",
    "11:32AMAZON",
    "V4821 28/09",
    "100%_PURE 12",
    "  JB HI-FI   ONLINE  ",
    "DAN MURPHY'S 5123 ST.PETERS",
    "",
  ];

  it("cleans exactly like the app", async () => {
    const sql = await rows<{ raw: string; clean: string }>(
      `select raw, public.clean_merchant(raw) as clean from unnest($1::text[]) as raw`,
      [SAMPLES],
    );
    expect(Object.fromEntries(sql.map((r) => [r.raw, r.clean]))).toEqual(
      Object.fromEntries(SAMPLES.map((s) => [s, cleanMerchant(s)])),
    );
  });

  describe("amount ranges and Always", () => {
    let household: string;
    const cat = (name: string) => `(select id from public.categories where name = '${name}')`;

    beforeAll(async () => {
      await as(A, "a@example.com", async () => {
        [{ household_id: household }] = await rows<{ household_id: string }>(
          `select household_id from public.members where user_id = auth.uid()`,
        );
        await rows(`
          insert into public.transactions (household_id, member_id, amount_cents, merchant_raw, merchant, source, status, occurred_at)
          select m.household_id, m.id, v.cents, v.raw, public.clean_merchant(v.raw), 'csv', 'confirmed', '2026-09-28 12:00+10'
          from public.members m, (values
            (-450, 'V4821 28/09 7-Eleven'),
            (-380, 'V4821 29/09 7-ELEVEN 2045 SYDNEY'),
            (-6200, 'V4821 30/09 7-Eleven'),
            (-2500, 'V4821 01/10 7-Eleven'),
            (-1800, 'Eftpos 20/09 11:32KBC Surry Hills Surry Hills')
          ) as v(cents, raw)
          where m.user_id = auth.uid()`);
      });
    });

    const sevenEleven = () =>
      rows<{ cents: number; category: string | null }>(
        `select t.amount_cents::int as cents, c.name as category from public.transactions t
         left join public.categories c on c.id = t.category_id
         where t.merchant = '7-Eleven' order by t.amount_cents desc`,
      );

    it("applies a rule to every past match and reports how many", async () => {
      await as(A, "a@example.com", async () => {
        const [rule] = await rows<{ id: string }>(
          `insert into public.merchant_rules (household_id, match_pattern, clean_name, category_id)
           values ($1, '7-Eleven', '7-Eleven', ${cat("Shopping")}) returning id`,
          [household],
        );
        const [{ n }] = await rows<{ n: number }>(`select public.apply_merchant_rule($1) as n`, [rule.id]);
        expect(n).toBe(4);
        expect((await sevenEleven()).every((t) => t.category === "Shopping")).toBe(true);
        const review = await rows(`select 1 from public.v_needs_review where merchant = '7-Eleven'`);
        expect(review).toHaveLength(0);
      });
    });

    it("picks the most specific rule by amount", async () => {
      await as(A, "a@example.com", async () => {
        const under = await rows<{ id: string }>(
          `insert into public.merchant_rules (household_id, match_pattern, clean_name, category_id, max_amount_cents)
           values ($1, '7-Eleven', '7-Eleven', ${cat("Eating out")}, 1000) returning id`,
          [household],
        );
        const over = await rows<{ id: string }>(
          `insert into public.merchant_rules (household_id, match_pattern, clean_name, category_id, min_amount_cents)
           values ($1, '7-Eleven', '7-Eleven', ${cat("Transport & fuel")}, 5000) returning id`,
          [household],
        );
        const [{ n: nUnder }] = await rows<{ n: number }>(`select public.apply_merchant_rule($1) as n`, [under[0].id]);
        const [{ n: nOver }] = await rows<{ n: number }>(`select public.apply_merchant_rule($1) as n`, [over[0].id]);
        expect([nUnder, nOver]).toEqual([2, 1]);
        expect(await sevenEleven()).toEqual([
          { cents: -380, category: "Eating out" },
          { cents: -450, category: "Eating out" },
          { cents: -2500, category: "Shopping" }, // only the any-amount rule matches $25
          { cents: -6200, category: "Transport & fuel" },
        ]);
        await expect(
          rows(`insert into public.merchant_rules (household_id, match_pattern, clean_name, min_amount_cents, max_amount_cents)
                values ($1, 'X', 'X', 5000, 1000)`, [household]),
        ).rejects.toThrow(/merchant_rules_amount_range/);
      });
    });

    it("uses the rules for new CSV rows by amount", async () => {
      await as(A, "a@example.com", async () => {
        const [acct] = await rows<{ id: string }>(`select id from public.accounts where nickname = 'ANZ Black'`);
        await rows(`select public.import_bank_rows($1, $2::jsonb, true)`, [
          acct.id,
          JSON.stringify([
            { idx: 1, date: "2026-10-04", amount_cents: -520, description: "V4821 04/10 7-ELEVEN 2045 SYDNEY", merchant_fallback: "7-Eleven", external_ref: "711-a", include: true },
            { idx: 2, date: "2026-10-04", amount_cents: -7000, description: "V4821 04/10 7-Eleven", merchant_fallback: "7-Eleven", external_ref: "711-b", include: true },
          ]),
        ]);
        const got = await rows<{ category: string }>(
          `select c.name as category from public.transactions t join public.categories c on c.id = t.category_id
           where t.external_ref in ('711-a', '711-b') order by t.external_ref`,
        );
        expect(got.map((g) => g.category)).toEqual(["Eating out", "Transport & fuel"]);
      });
    });
  });
});

describe("migration: re-clean existing merchants", () => {
  it("re-cleans from merchant_raw, repairs noisy rules and re-applies them", async () => {
    const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
    const fix = files.findIndex((f) => f.includes("merchant_cleaning"));
    const old = new PGlite();
    await old.exec(SUPABASE_STUB);
    for (const f of files.slice(0, fix)) await old.exec(readFileSync(join(MIGRATIONS, f), "utf8"));
    await old.exec(`
      insert into auth.users values ('${A}', 'a@example.com');
      set role authenticated;
      select set_config('request.jwt.claim.sub', '${A}', false);
      select set_config('request.jwt.claims', '{"sub":"${A}","email":"a@example.com"}', false);
      select public.create_household('Home', 'Alex');
      -- What the old code wrote: noisy merchants, and an "Always" rule saved from raw text.
      insert into public.merchant_rules (household_id, match_pattern, clean_name, category_id)
      select household_id, 'EFTPOS 20/09 11:32KBC SURRY HILLS SURRY HILLS%', 'Eftpos 20/09 11:32KBC Surry Hills Surry Hills',
             (select id from public.categories where name = 'Eating out')
        from public.members;
      insert into public.transactions (household_id, member_id, amount_cents, merchant_raw, merchant, source, status, category_id)
      select m.household_id, m.id, v.cents, v.raw, v.raw, 'csv', 'confirmed',
             (select id from public.categories where name = v.cat)
        from public.members m, (values
          (-450, 'V4821 28/09 7-Eleven', null),
          (-1800, 'Eftpos 20/09 11:32KBC Surry Hills Surry Hills', 'Eating out'),
          (-1900, 'Eftpos 27/09 12:05KBC Surry Hills Surry Hills', null),
          (-2000, 'Eftpos 27/09 12:05KBC Surry Hills Surry Hills', 'Shopping')
        ) as v(cents, raw, cat);
      reset role;
    `);
    await old.exec(readFileSync(join(MIGRATIONS, files[fix]), "utf8"));
    const got = await old.query<{ merchant: string; category: string | null }>(
      `select t.merchant, c.name as category from public.transactions t
       left join public.categories c on c.id = t.category_id order by t.amount_cents desc`,
    );
    expect(got.rows).toEqual([
      { merchant: "7-Eleven", category: null },
      { merchant: "KBC Surry Hills", category: "Eating out" },
      { merchant: "KBC Surry Hills", category: "Eating out" }, // was uncategorised: the repaired rule fills it
      { merchant: "KBC Surry Hills", category: "Shopping" }, // picked by hand: kept
    ]);
    const rules = await old.query(`select match_pattern, clean_name from public.merchant_rules`);
    expect(rules.rows).toEqual([{ match_pattern: "KBC Surry Hills", clean_name: "KBC Surry Hills" }]);
    await old.close();
  });
});

describe("non-spending categories", () => {
  it("leaves transfers out of spending totals and top merchants", async () => {
    await as(A, "a@example.com", async () => {
      const [t] = await rows<{ counts_as_spending: boolean }>(
        `select counts_as_spending from public.categories where name = 'Transfers'`,
      );
      expect(t.counts_as_spending).toBe(false);
      await rows(`
        insert into public.transactions (household_id, member_id, amount_cents, merchant, category_id, source, status, occurred_at)
        select m.household_id, m.id, v.cents, v.merchant, (select id from public.categories where name = v.cat), 'manual', 'confirmed', '2027-01-10 12:00+11'
        from public.members m, (values
          (-50000, 'To savings', 'Transfers'),
          (-2000, 'Cafe', 'Eating out'),
          (-700, 'Mystery', null)
        ) as v(cents, merchant, cat)
        where m.user_id = auth.uid()`);
      const spend = () =>
        rows<{ cents: number }>(
          `select coalesce(sum(spent_cents), 0)::int as cents from public.v_spend_by_period where period = 'month' and period_start = '2027-01-01'`,
        );
      expect(await spend()).toEqual([{ cents: 2700 }]); // uncategorised still counts
      const top = await rows<{ merchant: string }>(`select merchant from public.top_merchants('2027-01-01', '2027-02-01')`);
      expect(top.map((r) => r.merchant)).toEqual(["Cafe", "Mystery"]);

      await rows(`update public.categories set counts_as_spending = true where name = 'Transfers'`);
      expect(await spend()).toEqual([{ cents: 52700 }]);
      await rows(`update public.categories set counts_as_spending = false where name = 'Transfers'`);
    });
  });
});

describe("duplicates between bank rows and earlier entries", () => {
  let black: string; // the card the CSV is imported into
  let visa: string; // another card of the same person
  const imp = (rowsIn: object[]) =>
    rows<{ r: { idx: number; action: string; match_kind: string | null }[] }>(
      `select public.import_bank_rows($1, $2::jsonb, true) as r`,
      [black, JSON.stringify(rowsIn)],
    ).then((x) => Object.fromEntries(x[0].r.map((o) => [o.idx, o])));
  const row = (idx: number, cents: number, description: string, fallback: string) => ({
    idx, date: "2027-02-10", amount_cents: cents, description, merchant_fallback: fallback, external_ref: `dup-${idx}`, include: true,
  });
  const add = (cents: number, merchant: string, source: string, account: string | null, category: string | null = null) =>
    rows<{ id: string }>(
      `insert into public.transactions (household_id, member_id, account_id, amount_cents, merchant_raw, merchant, category_id, source, status, occurred_at)
       select household_id, id, $2::uuid, $1, case when $3 = 'manual' then null else $4 end, $4,
              (select id from public.categories where name = $5), $3,
              case when $3 = 'manual' then 'confirmed' else 'captured' end, '2027-02-09 08:15+11'
       from public.members where user_id = auth.uid() returning id`,
      [cents, account, source, merchant, category],
    ).then((r) => r[0].id);

  beforeAll(async () => {
    await as(A, "a@example.com", async () => {
      [{ id: black }] = await rows<{ id: string }>(`select id from public.accounts where nickname = 'ANZ Black'`);
      [{ id: visa }] = await rows<{ id: string }>(`select id from public.accounts where nickname = 'ANZ Visa'`);
    });
  });

  it("merges a manual entry with the same shop's name automatically", async () => {
    await as(A, "a@example.com", async () => {
      const manual = await add(-250, "Hungry Jack's", "manual", null, "Eating out");
      const r = await imp([row(1, -250, "HUNGRY JACKS 1234 SYDNEY", "Hungry Jacks")]);
      expect(r[1]).toMatchObject({ action: "merge", match_kind: "manual" });
      const got = await rows(
        `select t.id, t.status, t.account_id, c.name as category from public.transactions t
         left join public.categories c on c.id = t.category_id where t.external_ref = 'dup-1'`,
      );
      expect(got).toEqual([{ id: manual, status: "confirmed", account_id: black, category: "Eating out" }]);
    });
  });

  it("flags a manual entry with a different name, then merges it on request", async () => {
    await as(A, "a@example.com", async () => {
      const manual = await add(-330, "Coffee", "manual", null, "Eating out");
      const r = await imp([row(2, -330, "V4821 10/02 GLORIA JEANS", "Gloria Jeans")]);
      expect(r[2]).toMatchObject({ action: "ambiguous", match_kind: "manual" });
      const [flagged] = await rows<{ id: string; review_reason: string }>(
        `select id, review_reason from public.transactions where external_ref = 'dup-2'`,
      );
      expect(flagged.review_reason).toBe("Possible duplicate: a manual entry could be this purchase");

      const [{ n }] = await rows<{ n: number }>(`select public.merge_duplicates($1::uuid[]) as n`, [[flagged.id]]);
      expect(n).toBe(1);
      const left = await rows(
        `select id, merchant, merchant_raw, status, review_reason from public.transactions where amount_cents = -330`,
      );
      expect(left).toEqual([
        { id: manual, merchant: "Coffee", merchant_raw: "V4821 10/02 GLORIA JEANS", status: "confirmed", review_reason: null },
      ]);
    });
  });

  it("matches a phone capture that landed on another of the person's cards", async () => {
    await as(A, "a@example.com", async () => {
      const capture = await add(-1890, "BP NEWTOWN", "apple_pay", visa);
      const r = await imp([row(3, -1890, "V4821 10/02 BP NEWTOWN", "BP Newtown")]);
      expect(r[3]).toMatchObject({ action: "merge", match_kind: "phone" });
      const [t] = await rows<{ id: string; account_id: string }>(
        `select id, account_id from public.transactions where external_ref = 'dup-3'`,
      );
      expect(t).toEqual({ id: capture, account_id: black });
    });
  });

  it("skips rows with nothing to merge into", async () => {
    await as(A, "a@example.com", async () => {
      const [{ id }] = await rows<{ id: string }>(`select id from public.transactions where external_ref = 'dup-1'`);
      const [{ n }] = await rows<{ n: number }>(`select public.merge_duplicates($1::uuid[]) as n`, [[id]]);
      expect(n).toBe(0);
    });
  });
});

describe("migration: flag existing duplicates", () => {
  it("flags a bank row already imported next to a manual entry", async () => {
    const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
    const at = files.findIndex((f) => f.includes("duplicate_matching"));
    const old = new PGlite();
    await old.exec(SUPABASE_STUB);
    for (const f of files.slice(0, at)) await old.exec(readFileSync(join(MIGRATIONS, f), "utf8"));
    await old.exec(`
      insert into auth.users values ('${A}', 'a@example.com');
      set role authenticated;
      select set_config('request.jwt.claim.sub', '${A}', false);
      select set_config('request.jwt.claims', '{"sub":"${A}","email":"a@example.com"}', false);
      select public.create_household('Home', 'Alex');
      insert into public.accounts (household_id, member_id, bank, nickname, last4, type)
      select household_id, id, 'NAB', 'NAB Debit', '5555', 'debit' from public.members;
      insert into public.transactions (household_id, member_id, account_id, amount_cents, merchant_raw, merchant, source, status, external_ref, occurred_at)
      select m.household_id, m.id, v.acct, -250, v.raw, v.merchant, v.source, 'confirmed', v.ref, '2026-10-07 09:00+11'
        from public.members m, (values
          (null::uuid, null, 'Coffee', 'manual', null),
          ((select id from public.accounts), 'HUNGRY JACKS 1234', 'Hungry Jacks', 'csv', 'ref-hj'),
          ((select id from public.accounts), 'HUNGRY JACKS 1234', 'Hungry Jacks', 'csv', 'ref-hj-2')
        ) as v(acct, raw, merchant, source, ref);
      reset role;
    `);
    await old.exec(readFileSync(join(MIGRATIONS, files[at]), "utf8"));
    const got = await old.query(`select external_ref, review_reason from public.transactions where source = 'csv' order by external_ref`);
    // Both bank rows could be the one manual coffee: both flagged; merging the first claims it.
    expect(got.rows).toEqual([
      { external_ref: "ref-hj", review_reason: "Possible duplicate: a manual entry could be this purchase" },
      { external_ref: "ref-hj-2", review_reason: "Possible duplicate: a manual entry could be this purchase" },
    ]);
    await old.close();
  });
});

describe("comparing a possible duplicate", () => {
  it("lists what a flagged row could be, closest first, and merges into the chosen one", async () => {
    await as(A, "a@example.com", async () => {
      const [{ id: card }] = await rows<{ id: string }>(`select id from public.accounts where nickname = 'ANZ Black'`);
      const caps = await rows<{ id: string; merchant: string }>(`
        insert into public.transactions (household_id, member_id, account_id, amount_cents, merchant_raw, merchant, source, status, occurred_at)
        select household_id, id, $1::uuid, -990, v.m, v.m, 'apple_pay', 'captured', v.at::timestamptz
        from public.members, (values ('Far', '2027-03-08 09:00+11'), ('Near', '2027-03-10 11:00+11')) as v(m, at)
        where user_id = auth.uid() returning id, merchant`, [card]);
      await rows(`select public.import_bank_rows($1, $2::jsonb, true)`, [
        card,
        JSON.stringify([{ idx: 1, date: "2027-03-10", amount_cents: -990, description: "SOME SHOP", merchant_fallback: "Some Shop", external_ref: "cmp-1", include: true }]),
      ]);
      const [{ id: flagged }] = await rows<{ id: string }>(`select id from public.transactions where external_ref = 'cmp-1'`);

      const cands = await rows<{ merchant: string }>(`select merchant from public.duplicate_candidates($1)`, [flagged]);
      expect(cands.map((c) => c.merchant)).toEqual(["Near", "Far"]);

      const far = caps.find((c) => c.merchant === "Far")!.id;
      const [{ ok: wrong }] = await rows<{ ok: boolean }>(`select public.merge_duplicate_into($1, $2) as ok`, [flagged, flagged]);
      expect(wrong).toBe(false);
      const [{ ok }] = await rows<{ ok: boolean }>(`select public.merge_duplicate_into($1, $2) as ok`, [flagged, far]);
      expect(ok).toBe(true);
      const left = await rows(`select merchant, external_ref, status from public.transactions where amount_cents = -990 order by merchant`);
      expect(left).toEqual([
        { merchant: "Far", external_ref: "cmp-1", status: "confirmed" },
        { merchant: "Near", external_ref: null, status: "captured" },
      ]);
    });
  });
});

describe("budget alerts", () => {
  const HASH = "d".repeat(64);
  const SUB = { endpoint: "https://push.example.com/send/abc", p256dh: "BKey", auth: "authsecret" };
  type Claim = {
    alerts: { category: string; threshold: number; spent_cents: number; budget_cents: number }[];
    subscriptions: { endpoint: string }[];
  };
  const claim = async (token: string | null = null) =>
    (await rows<{ r: Claim }>(`select public.claim_budget_alerts($1) as r`, [token]))[0].r;
  const asAnon = async <T>(fn: () => Promise<T>) => {
    // No user: `as()` leaves the last one in the session settings.
    await db.exec(`set role anon; select set_config('request.jwt.claim.sub', '', false);`);
    try {
      return await fn();
    } finally {
      await db.exec(`reset role`);
    }
  };
  /** Spends `cents` in a category, now (or `daysAgo` days back). */
  const spend = (category: string, cents: number, daysAgo = 0) =>
    rows(
      `insert into public.transactions (household_id, member_id, amount_cents, merchant, category_id, source, status, occurred_at)
       select m.household_id, m.id, $1, 'Shop', c.id, 'manual', 'confirmed', now() - make_interval(days => $3)
       from public.members m join public.categories c on c.household_id = m.household_id and c.name = $2
       where m.user_id = auth.uid()`,
      [-cents, category, daysAgo],
    );

  beforeAll(async () => {
    await as(A, "a@example.com", () =>
      rows(`
        with me as (select id, household_id from public.members where user_id = auth.uid())
        , tok as (insert into public.device_tokens (member_id, label, token_hash) select id, 'Alert phone', '${HASH}' from me)
        insert into public.categories (household_id, name, sort, monthly_budget_cents)
        select household_id, v.name, v.sort, v.budget from me,
          (values ('Coffee', 200, 10000), ('Pets', 210, 5000), ('Books', 220, 1000), ('Fun', 230, 1000)) as v(name, sort, budget)`),
    );
  });

  it("records nothing while nobody has alerts on", async () => {
    await as(A, "a@example.com", async () => {
      await spend("Coffee", 9000);
      expect(await claim()).toEqual({ alerts: [], subscriptions: [] });
      expect(await rows(`select * from public.budget_alerts`)).toHaveLength(0);
    });
  });

  it("saves subscriptions for the household only, and only through the function", async () => {
    await as(A, "a@example.com", async () => {
      await rows(`select public.save_push_subscription($1, $2, $3, 'iPhone')`, [SUB.endpoint, SUB.p256dh, SUB.auth]);
      // Saving again (key refresh) updates the same row.
      await rows(`select public.save_push_subscription($1, $2, 'newauth', 'iPhone')`, [SUB.endpoint, SUB.p256dh]);
      expect(await rows(`select label, auth from public.push_subscriptions`)).toEqual([{ label: "iPhone", auth: "newauth" }]);
      await expect(rows(`delete from public.push_subscriptions`)).rejects.toThrow(/permission denied/);
      await expect(rows(`insert into public.budget_alerts (household_id, category_id, month, threshold, spent_cents, budget_cents)
                         select household_id, id, '2026-10-01', 80, 0, 0 from public.categories limit 1`)).rejects.toThrow(/permission denied/);
    });
    await as(X, "x@example.com", async () => {
      expect(await rows(`select * from public.push_subscriptions`)).toHaveLength(0);
    });
    await expect(
      asAnon(() => rows(`select public.save_push_subscription('https://push.example.com/x', 'k', 'a', null)`)),
    ).rejects.toThrow(/permission denied/);
    await expect(asAnon(() => rows(`select * from public.push_subscriptions`))).rejects.toThrow(/permission denied/);
    await expect(rows(`select private_key from private.push_keys`)).resolves.toEqual([]);
    await as(A, "a@example.com", () =>
      expect(rows(`select * from private.push_keys`)).rejects.toThrow(/permission denied/),
    );
  });

  it("sends 80% once, then 100% once, to everyone's phones", async () => {
    await as(A, "a@example.com", async () => {
      const first = await claim();
      expect(first.alerts).toEqual([
        { category_id: expect.any(String), category: "Coffee", threshold: 80, spent_cents: 9000, budget_cents: 10000 },
      ]);
      expect(first.subscriptions).toEqual([{ endpoint: SUB.endpoint, p256dh: SUB.p256dh, auth: "newauth" }]);
      expect(await claim()).toEqual({ alerts: [], subscriptions: [] });

      // A refund and a re-spend don't repeat the 80% alert.
      await spend("Coffee", -2000);
      await spend("Coffee", 2000);
      expect((await claim()).alerts).toEqual([]);

      await spend("Coffee", 1500);
      expect((await claim()).alerts).toMatchObject([{ category: "Coffee", threshold: 100, spent_cents: 10500 }]);
      expect((await claim()).alerts).toEqual([]);
    });
  });

  it("sends only 'over budget' when one purchase jumps past both", async () => {
    await as(A, "a@example.com", async () => {
      await spend("Pets", 6000);
      expect((await claim()).alerts).toMatchObject([{ category: "Pets", threshold: 100 }]);
      const sent = await rows<{ threshold: number }>(
        `select threshold from public.budget_alerts a join public.categories c on c.id = a.category_id
         where c.name = 'Pets' order by threshold`,
      );
      expect(sent.map((s) => s.threshold)).toEqual([80, 100]);
    });
  });

  it("ignores last month, non-spending categories and other households", async () => {
    await as(A, "a@example.com", async () => {
      await spend("Fun", 5000, 40);
      await rows(`update public.categories set monthly_budget_cents = 100 where name = 'Transfers'`);
      await spend("Transfers", 500);
      expect((await claim()).alerts).toEqual([]);
    });
    await as(X, "x@example.com", async () => {
      await rows(`select public.save_push_subscription('https://push.example.com/x', 'k', 'a', null)`);
      expect(await claim()).toEqual({ alerts: [], subscriptions: [] });
    });
  });

  it("works from a phone capture's device token, and prunes dead subscriptions", async () => {
    await as(A, "a@example.com", () => spend("Books", 900));
    await expect(asAnon(() => claim("e".repeat(64)))).rejects.toThrow(/invalid device token/);
    await expect(asAnon(() => claim())).rejects.toThrow(/Not signed in/);
    const viaPhone = await asAnon(() => claim(HASH));
    expect(viaPhone.alerts).toMatchObject([{ category: "Books", threshold: 80 }]);
    expect(viaPhone.subscriptions.map((s) => s.endpoint)).toEqual([SUB.endpoint]);

    const [{ gone }] = await asAnon(() => rows<{ gone: boolean }>(`select public.forget_push_subscription($1) as gone`, [SUB.endpoint]));
    expect(gone).toBe(true);
    await as(A, "a@example.com", async () => {
      expect(await rows(`select * from public.push_subscriptions`)).toHaveLength(0);
    });
  });
});

describe("migration: repair card names saved as the shop", () => {
  it("turns 'Visa' captures into 'Card payment' (or the bank's name) and drops card-name rules", async () => {
    const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
    const at = files.findIndex((f) => f.includes("unknown_merchant"));
    const old = new PGlite();
    await old.exec(SUPABASE_STUB);
    for (const f of files.slice(0, at)) await old.exec(readFileSync(join(MIGRATIONS, f), "utf8"));
    await old.exec(`
      insert into auth.users values ('${A}', 'a@example.com');
      set role authenticated;
      select set_config('request.jwt.claim.sub', '${A}', false);
      select set_config('request.jwt.claims', '{"sub":"${A}","email":"a@example.com"}', false);
      select public.create_household('Home', 'Alex');
      insert into public.merchant_rules (household_id, match_pattern, clean_name, category_id)
      select household_id, 'Visa', 'Visa', (select id from public.categories where name = 'Groceries') from public.members;
      insert into public.transactions (household_id, member_id, amount_cents, merchant_raw, merchant, source, status, external_ref)
      select m.household_id, m.id, v.cents, v.raw, v.merchant, v.source, 'captured', v.ref
        from public.members m, (values
          (-250, 'Visa', 'Visa', 'android', null),
          (-990, 'Visa ••1234', 'Visa ••1234', 'android', null),
          (-2350, 'V1234 09/10 WOOLWORTHS 1234 NEWTOWN', 'Visa', 'android', 'ref-1'),
          (-500, 'VISA BAR', 'Visa Bar', 'android', null),
          (-700, 'Visa', 'Visa', 'manual', null)
        ) as v(cents, raw, merchant, source, ref);
      reset role;
    `);
    await old.exec(readFileSync(join(MIGRATIONS, files[at]), "utf8"));
    const got = await old.query(`select amount_cents::int as cents, merchant, merchant_raw from public.transactions order by amount_cents`);
    expect(got.rows).toEqual([
      { cents: -2350, merchant: "Woolworths", merchant_raw: "V1234 09/10 WOOLWORTHS 1234 NEWTOWN" },
      { cents: -990, merchant: "Card payment", merchant_raw: null },
      { cents: -700, merchant: "Visa", merchant_raw: "Visa" }, // typed by hand: left alone
      { cents: -500, merchant: "Visa Bar", merchant_raw: "VISA BAR" }, // a real shop
      { cents: -250, merchant: "Card payment", merchant_raw: null },
    ]);
    expect((await old.query(`select * from public.merchant_rules`)).rows).toEqual([]);
    await old.close();
  });
});

describe("deleting any transaction", () => {
  const row = (ref: string, amount = -4321) =>
    JSON.stringify([{ idx: 1, date: "2027-05-03", amount_cents: amount, description: "TEST SHOP SYDNEY", merchant_fallback: "Test Shop", external_ref: ref, include: true }]);
  const importRow = (card: string, ref: string, commit: boolean) =>
    rows<{ r: { action: string }[] }>(`select public.import_bank_rows($1, $2::jsonb, $3) as r`, [card, row(ref), commit]).then((x) => x[0].r[0].action);

  it("keeps a deleted bank row deleted when the file is imported again", async () => {
    await as(A, "a@example.com", async () => {
      const [{ id: card }] = await rows<{ id: string }>(`select id from public.accounts where nickname = 'ANZ Visa'`);
      expect(await importRow(card, "del-1", true)).toBe("new");
      expect(await importRow(card, "del-1", false)).toBe("already_imported");

      // Bank-confirmed, and still deletable.
      const gone = await rows(`delete from public.transactions where external_ref = 'del-1' returning status`);
      expect(gone).toEqual([{ status: "confirmed" }]);

      expect(await importRow(card, "del-1", false)).toBe("deleted");
      expect(await importRow(card, "del-1", true)).toBe("deleted");
      expect(await rows(`select id from public.transactions where external_ref = 'del-1'`)).toHaveLength(0);
      expect(await rows(`select external_ref from public.deleted_bank_rows where external_ref = 'del-1'`)).toHaveLength(1);
      await expect(rows(`delete from public.deleted_bank_rows`)).rejects.toThrow(/permission denied/);
    });
    await as(X, "x@example.com", async () => {
      expect(await rows(`select * from public.deleted_bank_rows`)).toHaveLength(0);
    });
  });

  it("doesn't treat a merged duplicate as deleted", async () => {
    await as(A, "a@example.com", async () => {
      const [{ id: card }] = await rows<{ id: string }>(`select id from public.accounts where nickname = 'ANZ Visa'`);
      // Two phone captures of the same amount: the bank row is flagged, then merged.
      await rows(`
        insert into public.transactions (household_id, member_id, account_id, amount_cents, merchant, source, status, occurred_at)
        select household_id, id, $1::uuid, -777, v.m, 'apple_pay', 'captured', v.at::timestamptz
        from public.members, (values ('One', '2027-06-01 09:00+10'), ('Two', '2027-06-02 09:00+10')) as v(m, at)
        where user_id = auth.uid()`, [card]);
      await rows(`select public.import_bank_rows($1, $2::jsonb, true)`, [
        card,
        JSON.stringify([{ idx: 1, date: "2027-06-02", amount_cents: -777, description: "SHOP", merchant_fallback: "Shop", external_ref: "del-2", include: true }]),
      ]);
      const [{ id }] = await rows<{ id: string }>(`select id from public.transactions where external_ref = 'del-2'`);
      const [{ n }] = await rows<{ n: number }>(`select public.merge_duplicates($1) as n`, [[id]]);
      expect(n).toBe(1);
      expect(
        (await rows<{ r: { action: string }[] }>(`select public.import_bank_rows($1, $2::jsonb, false) as r`, [
          card,
          JSON.stringify([{ idx: 1, date: "2027-06-02", amount_cents: -777, description: "SHOP", merchant_fallback: "Shop", external_ref: "del-2", include: true }]),
        ]))[0].r[0].action,
      ).toBe("already_imported");
    });
  });
});

describe("capture text", () => {
  it("keeps the phone's notification on every Android capture", async () => {
    const [{ r }] = await rows<{ r: { id: string } }>(
      `select public.ingest_transaction($1, -777, 'KFC NEWTOWN', 'Kfc Newtown', null, 'android', '2026-10-20T12:00:00+11:00', 'KFC Newtown | $7.77 with Visa ••5678') as r`,
      ["c".repeat(64)],
    );
    const [t] = await rows<{ capture_text: string; note: string | null }>(`select capture_text, note from public.transactions where id = $1`, [r.id]);
    expect(t).toEqual({ capture_text: "KFC Newtown | $7.77 with Visa ••5678", note: null }); // named a shop: no note
  });
});

describe("migration: labelled names", () => {
  it("turns 'From: VISA' into 'Card payment' and strips labels from real shops", async () => {
    const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
    const at = files.findIndex((f) => f.includes("capture_text"));
    const old = new PGlite();
    await old.exec(SUPABASE_STUB);
    for (const f of files.slice(0, at)) await old.exec(readFileSync(join(MIGRATIONS, f), "utf8"));
    await old.exec(`
      insert into auth.users values ('${A}', 'a@example.com');
      set role authenticated;
      select set_config('request.jwt.claim.sub', '${A}', false);
      select set_config('request.jwt.claims', '{"sub":"${A}","email":"a@example.com"}', false);
      select public.create_household('Home', 'Alex');
      insert into public.transactions (household_id, member_id, amount_cents, merchant_raw, merchant, source, status, external_ref)
      select m.household_id, m.id, v.cents, v.raw, v.merchant, v.source, 'captured', v.ref
        from public.members m, (values
          (-601, 'From: VISA', 'From: VISA', 'android', null),
          (-990, 'V6800 08/10 COLES 0745 RYDE', 'From: VISA', 'android', 'ref-1'),
          (-1250, 'Merchant: KFC Newtown', 'Merchant: KFC Newtown', 'android', null)
        ) as v(cents, raw, merchant, source, ref);
      reset role;
    `);
    await old.exec(readFileSync(join(MIGRATIONS, files[at]), "utf8"));
    const got = await old.query(`select amount_cents::int as cents, merchant, merchant_raw from public.transactions order by amount_cents`);
    expect(got.rows).toEqual([
      { cents: -1250, merchant: "KFC Newtown", merchant_raw: "Merchant: KFC Newtown" },
      { cents: -990, merchant: "Coles", merchant_raw: "V6800 08/10 COLES 0745 RYDE" },
      { cents: -601, merchant: "Card payment", merchant_raw: null },
    ]);
    await old.close();
  });
});
