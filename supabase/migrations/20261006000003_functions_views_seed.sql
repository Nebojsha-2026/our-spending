-- Default categories, household onboarding, and dashboard views.

-- ---------------------------------------------------------------------------
-- Default categories (SPEC.md). Icons are lucide icon names.
-- ---------------------------------------------------------------------------
create function private.seed_default_categories(p_household_id uuid) returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.categories (household_id, name, icon, sort)
  select p_household_id, d.name, d.icon, d.sort
  from (values
    ('Groceries',         'shopping-cart',   10),
    ('Eating out',        'utensils',        20),
    ('Transport & fuel',  'fuel',            30),
    ('Rent',              'house',           40),
    ('Bills & utilities', 'receipt',         50),
    ('Shopping',          'shopping-bag',    60),
    ('Health',            'heart-pulse',     70),
    ('Entertainment',     'clapperboard',    80),
    ('Subscriptions',     'repeat',          90),
    ('Travel',            'plane',          100),
    ('Gifts',             'gift',           110),
    ('Other',             'circle-ellipsis', 120)
  ) as d (name, icon, sort)
  on conflict (household_id, name) do nothing
$$;
revoke all on function private.seed_default_categories(uuid) from public;

-- Seed any household that already exists (no-op on a fresh database).
select private.seed_default_categories(h.id) from public.households h;

-- ---------------------------------------------------------------------------
-- create_household: first sign-in creates the household, makes the caller its
-- first member, and seeds the default categories.
-- ---------------------------------------------------------------------------
create function public.create_household(p_name text, p_display_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_household_id uuid;
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if exists (select 1 from public.members where user_id = v_uid) then
    raise exception 'You already belong to a household' using errcode = '23505';
  end if;

  insert into public.households (name) values (trim(p_name))
  returning id into v_household_id;

  insert into public.members (household_id, user_id, email, display_name, colour)
  values (v_household_id, v_uid, auth.jwt() ->> 'email', trim(p_display_name), '#1D4ED8');

  perform private.seed_default_categories(v_household_id);
  return v_household_id;
end;
$$;
revoke all on function public.create_household(text, text) from public, anon;
grant execute on function public.create_household(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- claim_membership: when someone added in Settings → Household signs in with
-- that email, link their auth user to the waiting member row.
-- ---------------------------------------------------------------------------
create function public.claim_membership() returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text := auth.jwt() ->> 'email';
  v_household_id uuid;
begin
  if v_uid is null or v_email is null then
    return null;
  end if;

  select household_id into v_household_id from public.members where user_id = v_uid;
  if v_household_id is not null then
    return v_household_id;
  end if;

  update public.members
     set user_id = v_uid
   where id = (
     select id from public.members
      where user_id is null and lower(email) = lower(v_email)
      order by created_at
      limit 1)
  returning household_id into v_household_id;

  return v_household_id;
end;
$$;
revoke all on function public.claim_membership() from public, anon;
grant execute on function public.claim_membership() to authenticated;

-- ---------------------------------------------------------------------------
-- v_spend_by_period: totals by week (Mon–Sun), month and year in
-- Australia/Sydney, split by member and category. spent_cents is net spending
-- (refunds reduce it), so it is positive for normal spending.
-- security_invoker makes the view obey the caller's RLS.
-- ---------------------------------------------------------------------------
create view public.v_spend_by_period with (security_invoker = on) as
with local as (
  select household_id, member_id, category_id, amount_cents,
         (occurred_at at time zone 'Australia/Sydney') as local_ts
  from public.transactions
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
-- v_needs_review: no category, or still `captured` after 7 days.
-- ---------------------------------------------------------------------------
create view public.v_needs_review with (security_invoker = on) as
select t.*,
       (t.category_id is null) as needs_category,
       (t.status = 'captured' and t.occurred_at < now() - interval '7 days') as needs_confirmation
from public.transactions t
where t.category_id is null
   or (t.status = 'captured' and t.occurred_at < now() - interval '7 days');

revoke all on public.v_spend_by_period, public.v_needs_review from anon;
grant select on public.v_spend_by_period, public.v_needs_review to authenticated;

-- ---------------------------------------------------------------------------
-- top_merchants: biggest merchants between two Sydney-local dates [from, to).
-- ---------------------------------------------------------------------------
create function public.top_merchants(p_from date, p_to date, p_limit integer default 5)
returns table (merchant text, spent_cents bigint, txn_count integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select t.merchant, (-sum(t.amount_cents))::bigint, count(*)::integer
  from public.transactions t
  where t.occurred_at >= (p_from::timestamp at time zone 'Australia/Sydney')
    and t.occurred_at <  (p_to::timestamp   at time zone 'Australia/Sydney')
  group by t.merchant
  having -sum(t.amount_cents) > 0
  order by 2 desc, 1
  limit greatest(p_limit, 0)
$$;
revoke all on function public.top_merchants(date, date, integer) from public, anon;
grant execute on function public.top_merchants(date, date, integer) to authenticated;
