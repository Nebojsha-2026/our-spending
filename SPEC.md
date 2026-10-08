# Household Expense Tracker — Build Spec

## Overview

A private, shared spending tracker for a household (a couple, a family or housemates) that captures card spending automatically from everyone's phones, with your own Supabase database behind it. It answers two questions at any time: how much did we spend this week, month or year, and where did it go.

- **Users:** everyone in the household (works best for 2–4 people), on iPhone or Android. One shared household; every transaction is tagged with who spent it.
- **Banks:** ANZ and NAB cards.
- **Stack:** Next.js app on Vercel (installed on both phones as a PWA), Supabase for Postgres + auth + row-level security, code in a private GitHub repo.
- **Capture, in order of priority:** tap-to-pay captured on the phone the moment you pay; bank CSV import to fill gaps and confirm amounts; manual quick-add as a fallback; Open Banking feed later if it proves worth the cost.
- **Not in scope for v1:** income tracking, investments, bill splitting between household members, native App Store / Play Store apps.

## How spending gets captured

Every source posts to the same ingest endpoint, so the app never cares where a transaction came from. Phone capture gives instant entries; CSV import catches what phones miss and confirms the final amount.

| Source | Catches | Misses | Cost | Phase |
| --- | --- | --- | --- | --- |
| iPhone Shortcuts “Transaction” automation | Every Apple Pay tap on your iPhone (and paired Apple Watch) | Physical card, online card-number payments, direct debits | Free | 2 |
| Pixel notification capture (MacroDroid) | Google Wallet tap payments; ANZ/NAB app purchase alerts if switched on | Anything that doesn’t raise a notification | Free (MacroDroid Pro is a one-off few dollars) | 3 |
| ANZ / NAB CSV import | Everything on the statement, final settled amounts | Nothing, but it’s manual and after the fact | Free | 4 |
| Manual quick-add | Cash, anything missed | — | Free | 1 |
| Open Banking feed (Basiq or Fiskil) | Everything, automatically | — | Platform fee, contract terms vary; get a quote | Later, optional |

**Why not Open Banking from day one:** ANZ and NAB both share data under Australia’s Consumer Data Right, but a personal app can’t connect directly; you go through an accredited provider. Basiq doesn’t publish pricing and lists a 12-month minimum contract, which is hard to justify for one household. Phone capture plus a monthly CSV import covers nearly everything for $0.

**Apple FinanceKit is not an option:** it only covers Apple Card/Apple Cash in the US and open-banking data in the UK.

## Data model (Supabase)

Seven tables, all keyed to a household so row-level security is one rule: you can only see rows whose `household_id` you’re a member of. Amounts are stored as integer cents in AUD; spending is negative, refunds positive.

| Table | Key columns | Notes |
| --- | --- | --- |
| `households` | id, name | One row: your household |
| `members` | id, household\_id, user\_id → auth.users, display\_name, colour | The two people; colour used in charts |
| `accounts` | id, household\_id, member\_id, bank (ANZ/NAB), nickname, last4, type (debit/credit) | Never store full card numbers; last4 + nickname only |
| `categories` | id, household\_id, name, icon, colour, monthly\_budget\_cents, sort | Seeded with defaults (below) |
| `merchant_rules` | id, household\_id, match\_pattern, clean\_name, category\_id, priority | e.g. `WOOLWORTHS%` → “Woolworths”, Groceries |
| `transactions` | id, household\_id, member\_id, account\_id, amount\_cents, merchant\_raw, merchant, category\_id, occurred\_at, source, status, external\_ref, note | source: apple\_pay, android, csv, manual, bank\_feed; status: captured, confirmed |
| `device_tokens` | id, member\_id, label, token\_hash, last\_used\_at, revoked\_at | One per phone automation; only the hash is stored |

**Default categories:** Groceries, Eating out, Transport & fuel, Rent, Bills & utilities, Shopping, Health, Entertainment, Subscriptions, Travel, Gifts, Other.

**Views for the dashboard:**

- `v_spend_by_period`: totals grouped by week (Mon–Sun), month and year in `Australia/Sydney` time, split by member and category.
- `v_needs_review`: transactions with no category or status still `captured` after 7 days.

**Indexes:** `(household_id, occurred_at desc)` on transactions; `(account_id, amount_cents, occurred_at)` for de-duplication lookups.

## API and ingest logic

The phones talk to one endpoint authenticated by a per-device token; the dashboard reads Supabase directly under RLS. All routes are Next.js route handlers on Vercel.

| Route | Auth | Purpose |
| --- | --- | --- |
| `POST /api/ingest` | `Authorization: Bearer <device token>` | Phone automations post a transaction here |
| `POST /api/import/csv` | Logged-in session | Upload an ANZ or NAB CSV export; parse, de-dupe, insert |
| `POST /api/transactions` | Logged-in session | Manual quick-add |
| `PATCH /api/transactions/:id` | Logged-in session | Edit category, merchant, note; optionally create a merchant rule |
| `POST /api/devices` | Logged-in session | Create a device token, shown once |

**Ingest payload** (what the Shortcut and MacroDroid send):

```json
{ "amount": "$23.50", "merchant": "WOOLWORTHS 1234 NEWTOWN", "card": "ANZ Visa", "source": "apple_pay", "occurred_at": "2026-10-06T18:40:00+11:00" }
```

The server is forgiving: `amount` may arrive as text with a currency sign; `occurred_at` defaults to now; the token identifies who spent it; `card` is matched to an account by nickname, falling back to the member’s default account.

**Ingest steps:**

1. Verify token (hash compare), rate-limit per token.
2. Parse amount to cents (spend = negative). Reject zero or unparseable amounts with a 400.
3. Clean the merchant: apply the first matching `merchant_rules` row; otherwise strip store numbers and suburbs into a tidy name.
4. Categorise from the rule; if none, leave uncategorised so it shows in Needs review.
5. De-dupe (below), then insert with status `captured` (phone) or `confirmed` (CSV/bank feed).
6. Return `{ id, merchant, category }` so the Shortcut can show a confirmation banner.

**De-duplication** (a tap captured on the phone and the same purchase later in the CSV):

- Candidate match = same account, same amount in cents, `occurred_at` within 3 days.
- If one candidate: merge, keep the phone’s time and member, take the bank’s settled amount and description, set status `confirmed`.
- If several candidates: keep both and flag for review, never silently merge.
- CSV rows also carry an `external_ref` hash of date + amount + description so re-importing the same file inserts nothing.

**Learning categories:** when you change a transaction’s category, the app asks “Always put \<merchant> in \<category>?”; yes writes a `merchant_rules` row and recategorises past matches.

## Dashboard screens

Five screens behind a bottom tab bar, built mobile-first because everyone uses it on their phones; it also works on desktop.

1. **Overview:** period switcher (Week / Month / Year / Custom) with arrows to step back; total spent with the change vs the previous period; split by who spent it; spending by category as ranked bars; a trend line over the last 6 periods; the top 5 merchants.
2. **Transactions:** a searchable list grouped by day, filters for person, category, account and source; tap a row to edit category, merchant or note. A “Needs review” chip at the top shows uncategorised or unconfirmed items.
3. **Budgets:** a monthly budget per category with a progress bar, how much is left and the daily pace (“$12/day left for Eating out”).
4. **Quick add:** a floating + button on every screen; amount keypad first, then category chips, who spent defaults to the logged-in person. Target: under 5 seconds.
5. **Settings:** accounts and cards, categories, merchant rules, device tokens (create, label, revoke), CSV import, export everything to CSV.

**PWA details:** installable from Safari (“Add to Home Screen”) and Chrome; app icon and splash; Supabase magic-link or Google sign-in; everyone stays logged in. Push notifications for budget alerts come in phase 5 (iOS supports web push for installed PWAs); built, see `docs/budget-alerts.md`.

## Phone setup

Both setups take about 10 minutes once the ingest endpoint is live, and each phone gets its own device token from Settings → Devices.

### iPhone: Shortcuts “Transaction” automation

1. Open **Shortcuts → Automation → + → Transaction**.
2. Choose your ANZ and NAB cards (or all cards). Leave categories and merchants on “Any”.
3. Select **Run Immediately** and turn off “Notify When Run”.
4. Add **Get Contents of URL**: URL `https://<your-app>.vercel.app/api/ingest`, Method **POST**, header `Authorization` = `Bearer <device token>`, Request Body **JSON** with fields `amount` → Shortcut Input’s Amount, `merchant` → Merchant, `card` → Card or Pass, `source` → `apple_pay`.
5. Optional: add **Show Notification** with the returned merchant and category, so you see “Logged $23.50 · Groceries”.
6. Test with a small tap payment and check it appears in Transactions.

### Android: MacroDroid notification capture

The phone forwards the raw notification text and the server does the parsing, so a bank changing its wording means a code fix, not re-configuring the phone.

1. Install **MacroDroid**, grant **Notification access**, and set its battery usage to **Unrestricted** (Settings → Apps → MacroDroid), or Android may stop it in the background.
2. In Google Wallet, make sure payment notifications are on. In the ANZ and NAB apps, turn on purchase notifications if they offer them.
3. New macro, **Trigger:** Notification Received → apps Google Wallet, ANZ, NAB → text contains `$`.
4. **Action:** HTTP Request → POST to the same `/api/ingest` URL, same Bearer header, JSON body `{"raw": "[notification_title] [notification]", "app": "[app_name]", "source": "android"}` using MacroDroid’s magic-text fields.
5. Server side, `/api/ingest` accepts `raw` + `app` instead of `amount` + `merchant` and extracts them with per-app patterns. Unparseable texts are stored in a small `ingest_failures` log so you can add a pattern.
6. Ingest also ignores duplicates within 2 minutes, since Wallet and the bank app may both notify for one purchase.

**Physical card swipes and online purchases** won’t trigger either phone; the CSV import catches them.

## Build phases and Claude Code handoff

Each phase ends with something you can use, so the app is useful after phase 1 and fully automatic after phase 3.

1. **Foundation:** repo, Supabase project + migrations for all tables, RLS, seed categories, auth, PWA shell, Overview + Transactions + Quick add + Settings.
2. **iPhone capture:** `/api/ingest`, device tokens, merchant cleaning + rules, the Shortcut set up and tested.
3. **Pixel capture:** `raw` + `app` parsing, `ingest_failures` log, 2-minute duplicate guard, MacroDroid set up on the Android phone.
4. **CSV import:** ANZ and NAB parsers, de-dupe and merge with phone captures, Needs review queue.
5. **Budgets and alerts:** Budgets screen, web push when a category passes 80% and 100% (built).
6. **Optional, Open Banking:** quote from Basiq/Fiskil; if worthwhile, a `bank_feed` source that writes through the same ingest path.

- [ ] Create GitHub repo, Supabase project and Vercel project
- [ ] Download one ANZ and one NAB CSV export as sample files for phase 4
- [ ] Check which notifications the ANZ and NAB apps can send on the Pixel

**Prompt to paste into Claude Code** (from an empty repo, with this doc saved as `SPEC.md`):

```text
Read SPEC.md. Build phase 1 only: a Next.js (App Router, TypeScript) PWA deployed to Vercel, with Supabase for Postgres, auth and RLS. Write SQL migrations for every table in the Data model section, RLS so users only see their household's rows, seed the default categories, and build the Overview, Transactions, Quick add and Settings screens mobile-first. Amounts are integer cents in AUD; weeks run Mon-Sun in Australia/Sydney. Use env vars for all Supabase keys. Stop after phase 1 and list what I need to configure in Supabase and Vercel.
```

Then one prompt per phase: “Build phase 2 from SPEC.md”, and so on.
