-- Household Expense Tracker: core schema (SPEC.md → Data model).
-- Amounts are integer cents in AUD; spending is negative, refunds positive.
-- Every table hangs off a household so row-level security is a single rule.

-- ---------------------------------------------------------------------------
-- households
-- ---------------------------------------------------------------------------
create table public.households (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) between 1 and 80),
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- members: people in the household. user_id is null until the person signs in
-- for the first time; `email` lets that first sign-in claim the row.
-- ---------------------------------------------------------------------------
create table public.members (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  user_id       uuid unique references auth.users (id) on delete set null,
  email         text check (email is null or email ~ '^[^@\s]+@[^@\s]+$'),
  display_name  text not null check (length(trim(display_name)) between 1 and 40),
  colour        text not null default '#1D4ED8' check (colour ~ '^#[0-9A-Fa-f]{6}$'),
  created_at    timestamptz not null default now(),
  unique (household_id, id)
);
create unique index members_household_email_key
  on public.members (household_id, lower(email)) where email is not null;

-- ---------------------------------------------------------------------------
-- accounts: cards. Never store full card numbers — last4 + nickname only.
-- ---------------------------------------------------------------------------
create table public.accounts (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  member_id     uuid not null,
  bank          text not null check (bank in ('ANZ', 'NAB')),
  nickname      text not null check (length(trim(nickname)) between 1 and 40),
  last4         text check (last4 is null or last4 ~ '^[0-9]{4}$'),
  type          text not null check (type in ('debit', 'credit')),
  -- Ingest falls back to the member's default account when `card` doesn't match.
  is_default    boolean not null default false,
  created_at    timestamptz not null default now(),
  unique (household_id, id),
  foreign key (household_id, member_id)
    references public.members (household_id, id) on delete cascade
);
create unique index accounts_one_default_per_member
  on public.accounts (member_id) where is_default;

-- ---------------------------------------------------------------------------
-- categories
-- ---------------------------------------------------------------------------
create table public.categories (
  id                    uuid primary key default gen_random_uuid(),
  household_id          uuid not null references public.households (id) on delete cascade,
  name                  text not null check (length(trim(name)) between 1 and 40),
  icon                  text not null default 'circle',
  colour                text not null default '#0F766E' check (colour ~ '^#[0-9A-Fa-f]{6}$'),
  monthly_budget_cents  bigint check (monthly_budget_cents is null or monthly_budget_cents >= 0),
  sort                  integer not null default 0,
  created_at            timestamptz not null default now(),
  unique (household_id, id),
  unique (household_id, name)
);

-- ---------------------------------------------------------------------------
-- merchant_rules: e.g. WOOLWORTHS% → "Woolworths", Groceries
-- match_pattern is an ILIKE pattern applied to merchant_raw (phase 2 ingest).
-- ---------------------------------------------------------------------------
create table public.merchant_rules (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references public.households (id) on delete cascade,
  match_pattern  text not null check (length(trim(match_pattern)) between 1 and 120),
  clean_name     text not null check (length(trim(clean_name)) between 1 and 80),
  category_id    uuid,
  priority       integer not null default 100,
  created_at     timestamptz not null default now(),
  foreign key (household_id, category_id)
    references public.categories (household_id, id) on delete set null (category_id)
);

-- ---------------------------------------------------------------------------
-- transactions
-- ---------------------------------------------------------------------------
create table public.transactions (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  member_id     uuid not null,
  account_id    uuid,
  amount_cents  bigint not null check (amount_cents <> 0),
  merchant_raw  text,
  merchant      text not null check (length(trim(merchant)) between 1 and 120),
  category_id   uuid,
  occurred_at   timestamptz not null default now(),
  source        text not null check (source in ('apple_pay', 'android', 'csv', 'manual', 'bank_feed')),
  status        text not null default 'captured' check (status in ('captured', 'confirmed')),
  external_ref  text,
  note          text check (note is null or length(note) <= 500),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  foreign key (household_id, member_id)
    references public.members (household_id, id) on delete restrict,
  foreign key (household_id, account_id)
    references public.accounts (household_id, id) on delete set null (account_id),
  foreign key (household_id, category_id)
    references public.categories (household_id, id) on delete set null (category_id)
);

create index transactions_household_occurred_idx
  on public.transactions (household_id, occurred_at desc);
create index transactions_dedupe_idx
  on public.transactions (account_id, amount_cents, occurred_at);
-- Re-importing the same CSV inserts nothing (phase 4).
create unique index transactions_external_ref_key
  on public.transactions (household_id, external_ref) where external_ref is not null;
create index transactions_category_idx on public.transactions (category_id);
create index transactions_member_idx on public.transactions (member_id);

-- ---------------------------------------------------------------------------
-- device_tokens: one per phone automation; only the hash is stored.
-- ---------------------------------------------------------------------------
create table public.device_tokens (
  id            uuid primary key default gen_random_uuid(),
  member_id     uuid not null references public.members (id) on delete cascade,
  label         text not null check (length(trim(label)) between 1 and 60),
  token_hash    text not null unique,
  last_used_at  timestamptz,
  revoked_at    timestamptz,
  created_at    timestamptz not null default now()
);
create index device_tokens_member_idx on public.device_tokens (member_id);

-- ---------------------------------------------------------------------------
-- Keep transactions.updated_at current.
-- ---------------------------------------------------------------------------
create function public.set_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger transactions_set_updated_at
  before update on public.transactions
  for each row execute function public.set_updated_at();
