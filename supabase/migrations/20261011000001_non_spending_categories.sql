-- Categories that aren't spending: transfers between your own accounts, paying
-- employees, passing on money that wasn't yours… Transactions in them stay in
-- Activity but are left out of every spending total (Overview, trend, top
-- merchants, Budgets).

alter table public.categories
  add column counts_as_spending boolean not null default true;

-- ---------------------------------------------------------------------------
-- v_spend_by_period: same shape as before, without non-spending categories.
-- Uncategorised transactions still count (until someone says otherwise).
-- ---------------------------------------------------------------------------
create or replace view public.v_spend_by_period with (security_invoker = on) as
with local as (
  select t.household_id, t.member_id, t.category_id, t.amount_cents,
         (t.occurred_at at time zone 'Australia/Sydney') as local_ts
  from public.transactions t
  left join public.categories c on c.id = t.category_id
  where coalesce(c.counts_as_spending, true)
)
select household_id, 'week'::text as period,
       date_trunc('week', local_ts)::date as period_start,
       member_id, category_id,
       (-sum(amount_cents))::bigint as spent_cents, count(*)::integer as txn_count
from local group by household_id, date_trunc('week', local_ts), member_id, category_id
union all
select household_id, 'month', date_trunc('month', local_ts)::date,
       member_id, category_id, (-sum(amount_cents))::bigint, count(*)::integer
from local group by household_id, date_trunc('month', local_ts), member_id, category_id
union all
select household_id, 'year', date_trunc('year', local_ts)::date,
       member_id, category_id, (-sum(amount_cents))::bigint, count(*)::integer
from local group by household_id, date_trunc('year', local_ts), member_id, category_id;

-- ---------------------------------------------------------------------------
-- top_merchants: same, without non-spending categories.
-- ---------------------------------------------------------------------------
create or replace function public.top_merchants(p_from date, p_to date, p_limit integer default 5)
returns table (merchant text, spent_cents bigint, txn_count integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select t.merchant, (-sum(t.amount_cents))::bigint, count(*)::integer
  from public.transactions t
  left join public.categories c on c.id = t.category_id
  where t.occurred_at >= (p_from::timestamp at time zone 'Australia/Sydney')
    and t.occurred_at <  (p_to::timestamp   at time zone 'Australia/Sydney')
    and coalesce(c.counts_as_spending, true)
  group by t.merchant
  having -sum(t.amount_cents) > 0
  order by 2 desc, 1
  limit greatest(p_limit, 0)
$$;

-- ---------------------------------------------------------------------------
-- A default "Transfers" category that doesn't count, for new and existing
-- households (skipped where a category of that name already exists).
-- ---------------------------------------------------------------------------
create or replace function private.seed_default_categories(p_household_id uuid) returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.categories (household_id, name, icon, sort, counts_as_spending)
  select p_household_id, d.name, d.icon, d.sort, d.counts
  from (values
    ('Groceries',         'shopping-cart',   10, true),
    ('Eating out',        'utensils',        20, true),
    ('Transport & fuel',  'fuel',            30, true),
    ('Rent',              'house',           40, true),
    ('Bills & utilities', 'receipt',         50, true),
    ('Shopping',          'shopping-bag',    60, true),
    ('Health',            'heart-pulse',     70, true),
    ('Entertainment',     'clapperboard',    80, true),
    ('Subscriptions',     'repeat',          90, true),
    ('Travel',            'plane',          100, true),
    ('Gifts',             'gift',           110, true),
    ('Other',             'circle-ellipsis', 120, true),
    ('Transfers',         'arrow-left-right', 130, false)
  ) as d (name, icon, sort, counts)
  on conflict (household_id, name) do nothing
$$;
revoke all on function private.seed_default_categories(uuid) from public;

insert into public.categories (household_id, name, icon, sort, counts_as_spending)
select h.id, 'Transfers', 'arrow-left-right',
       coalesce((select max(c.sort) from public.categories c where c.household_id = h.id), 0) + 10, false
  from public.households h
on conflict (household_id, name) do nothing;
