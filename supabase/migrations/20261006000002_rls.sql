-- Row-level security: you can only see rows whose household_id you're a member of.

create schema if not exists private;
grant usage on schema private to authenticated;

-- Households the signed-in user belongs to. SECURITY DEFINER so policies on
-- `members` can call it without recursing into themselves.
create function private.my_household_ids() returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.household_id from public.members m where m.user_id = auth.uid()
$$;
revoke all on function private.my_household_ids() from public;
grant execute on function private.my_household_ids() to authenticated;

alter table public.households     enable row level security;
alter table public.members        enable row level security;
alter table public.accounts       enable row level security;
alter table public.categories     enable row level security;
alter table public.merchant_rules enable row level security;
alter table public.transactions   enable row level security;
alter table public.device_tokens  enable row level security;

-- Nothing is readable by anonymous visitors.
revoke all on all tables in schema public from anon;

-- households: read + rename your own. Created only through create_household().
create policy households_select on public.households for select to authenticated
  using (id in (select private.my_household_ids()));
create policy households_update on public.households for update to authenticated
  using (id in (select private.my_household_ids()))
  with check (id in (select private.my_household_ids()));
revoke insert, delete on public.households from authenticated;

-- members: everyone in the household can see and add members. user_id is set
-- only by create_household() / claim_membership(), never directly.
create policy members_select on public.members for select to authenticated
  using (household_id in (select private.my_household_ids()));
create policy members_insert on public.members for insert to authenticated
  with check (household_id in (select private.my_household_ids()));
create policy members_update on public.members for update to authenticated
  using (household_id in (select private.my_household_ids()))
  with check (household_id in (select private.my_household_ids()));
-- Only members who haven't signed in yet can be removed.
create policy members_delete on public.members for delete to authenticated
  using (household_id in (select private.my_household_ids()) and user_id is null);
revoke insert, update on public.members from authenticated;
grant insert (household_id, email, display_name, colour) on public.members to authenticated;
grant update (email, display_name, colour) on public.members to authenticated;

-- The household-scoped tables all share the same four policies.
do $$
declare
  t text;
begin
  foreach t in array array['accounts', 'categories', 'merchant_rules', 'transactions'] loop
    execute format(
      'create policy %1$s_select on public.%1$s for select to authenticated
         using (household_id in (select private.my_household_ids()))', t);
    execute format(
      'create policy %1$s_insert on public.%1$s for insert to authenticated
         with check (household_id in (select private.my_household_ids()))', t);
    execute format(
      'create policy %1$s_update on public.%1$s for update to authenticated
         using (household_id in (select private.my_household_ids()))
         with check (household_id in (select private.my_household_ids()))', t);
    execute format(
      'create policy %1$s_delete on public.%1$s for delete to authenticated
         using (household_id in (select private.my_household_ids()))', t);
  end loop;
end;
$$;

-- device_tokens are keyed by member; reach the household through members.
-- Tokens are created by POST /api/devices (phase 2), which stores only the hash.
create policy device_tokens_select on public.device_tokens for select to authenticated
  using (member_id in (
    select m.id from public.members m
    where m.household_id in (select private.my_household_ids())));
create policy device_tokens_update on public.device_tokens for update to authenticated
  using (member_id in (
    select m.id from public.members m
    where m.household_id in (select private.my_household_ids())))
  with check (member_id in (
    select m.id from public.members m
    where m.household_id in (select private.my_household_ids())));
revoke insert, delete, update on public.device_tokens from authenticated;
-- Signed-in users may label or revoke a token, never rewrite its hash.
grant update (label, revoked_at) on public.device_tokens to authenticated;
