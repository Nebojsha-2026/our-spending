# How it fits together

- `supabase/migrations/`: tables from SPEC.md (`households`, `members`, `accounts`, `categories`, `merchant_rules`, `transactions`, `device_tokens`), RLS (`household_id` must be one of yours), composite foreign keys so a row can't point at another household's member/card/category, the `v_spend_by_period` / `v_needs_review` views (Mon–Sun weeks in Australia/Sydney), `top_merchants()`, and the `create_household()` / `claim_membership()` onboarding functions.
- `supabase/tests/db.test.ts`: runs those migrations on PGlite and checks RLS isolation, onboarding and Sydney week bucketing.
- `src/proxy.ts`: refreshes the Supabase session cookie and sends signed-out visitors to `/login`.
- `src/app/(app)/layout.tsx`: loads the household (members, categories, cards) once; screens read data straight from Supabase under RLS.
- `src/app/api/transactions`: `POST` (quick add), `PATCH /:id` (edit; `remember: true` saves a merchant rule for the cleaned name, optionally with `min_amount_cents`/`max_amount_cents`, and applies it to every match via `apply_merchant_rule()`), `POST /categorise` (set the category for a Needs review group, optionally as a rule), `DELETE /:id` and `POST /bulk` (delete any transaction; a trigger records deleted bank rows in `deleted_bank_rows` so `import_bank_rows()` reports them as `deleted` and doesn't import them again). `src/app/api/export`: CSV of everything.
- `src/lib/bank-csv.ts` + `src/app/api/import/csv`: CSV parsing, default include rules and row hashes; `import_bank_rows()` (runs as the signed-in user under RLS) does the matching, merging and inserting in one transaction, or just reports it for the preview.
- `src/lib/notifications.ts`: Android notification parsing (amount, merchant, card, what to ignore) and a forgiving body reader for MacroDroid's JSON. Add new bank wordings here, with a test in `notifications.test.ts`.
- `src/app/api/ingest`: phone captures. Parses the amount and tidies the merchant (`cleanMerchant()` in `src/lib/ingest.ts`; the database has the same cleaning as `public.clean_merchant()`, and a test checks they agree), then calls the `ingest_transaction()` database function with the public key. That function checks the token hash, rate-limits, applies merchant rules, matches the card, guards against duplicates and inserts into that token's household only, so no service-role key is needed. `src/app/api/devices` creates tokens (only the SHA-256 hash is stored).
- Budget alerts: `push_subscriptions` (one row per phone with alerts on, saved through `save_push_subscription()`), `budget_alerts` (each category's 80% / 100% alert, once per Sydney month) and `claim_budget_alerts()`, which records the alerts now due and returns them with the household's subscriptions. Routes that add spending or change a category call `queueBudgetAlerts()` (`src/lib/push.ts`), which runs it with `after()` once the response has gone and sends with `web-push`; the wording is in `src/lib/budget-alerts.ts`. `public/sw.js` shows the notification and opens Budgets. `POST /api/push/test` sends a test to one phone. The VAPID key pair lives in `private.push_keys` (out of the API's reach): `scripts/setup.mjs` creates it and writes `.push-keys.json` before each build, and `next.config.ts` inlines it (`VAPID_*` env vars win). See [budget alerts](budget-alerts.md).
- Amounts are integer cents in AUD; spending is negative, refunds positive. Date maths lives in `src/lib/periods.ts`.

## Local development

```bash
cp .env.example .env.local   # your Supabase URL + publishable key
npm install
npm run dev                  # http://localhost:3000
npm test                     # unit tests + migrations/RLS tests on in-process Postgres (PGlite)
npm run lint && npm run typecheck
npm run screenshots          # README images, from the app running against a mock Supabase
```

`npm run build` first runs `scripts/setup.mjs`, which applies pending migrations and prepares the budget alert keys when a database URL is set (see the README's one-click deploy), and does nothing otherwise. To try budget alerts locally, put `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` in `.env.local` (`npx web-push generate-vapid-keys`).

Design tokens and layout rules are in `design/DESIGN.md`; the original product spec is `SPEC.md`.

Also:

- `src/lib/macrodroid.ts`: builds the ready-to-import MacroDroid macro (*Settings → Devices → Android*) in MacroDroid's own export format, with the phone's token filled in.
- `src/components/SupportCard.tsx` + `src/lib/support.ts`: the honour-based "buy me a coffee" card on the Overview (after 50 transactions; "Maybe later" snoozes a month; "I've already supported" hides it for good, on that phone). Nothing is checked or sent anywhere.
- Maintainer notes (publishing the iPhone Shortcut, screenshots, migrations): [maintainers.md](maintainers.md).

