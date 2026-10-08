-- Better duplicate matching between bank CSV rows and what was logged earlier.
--
--   * A CSV row now also matches a phone capture on ANY of the same person's
--     cards when nothing matches on the imported card (Wallet's card name
--     didn't match an account, so the capture landed on the default card).
--   * A CSV row also matches a manual entry (same person, same amount, within
--     3 days). It merges only when the names agree ("Hungry Jacks" typed by
--     hand vs HUNGRY JACKS 1234 on the statement); otherwise it is flagged as
--     a possible duplicate, so a cash purchase typed in by hand is never
--     swallowed by a card purchase of the same amount.
--   * merge_duplicates(ids): merge flagged imports into their closest match,
--     for the "Merge" action in Needs review (one or many at a time).

-- ---------------------------------------------------------------------------
-- bank_match_candidates: what a bank row of p_amount on p_date, imported into
-- p_account_id (owned by p_member_id), could be a copy of. In order:
--   1. phone captures on that card (or with no card, by that person)
--   2. otherwise phone captures by that person on any card
--   3. otherwise that person's manual entries
-- Only entries no bank row has claimed yet (external_ref is null).
-- ---------------------------------------------------------------------------
create function private.bank_match_candidates(
  p_household_id uuid,
  p_account_id uuid,
  p_member_id uuid,
  p_amount bigint,
  p_date date,
  p_exclude uuid[]
) returns table (id uuid, kind text, occurred_at timestamptz, merchant text)
language sql
stable
set search_path = ''
as $$
  with base as (
    select t.id, t.source, t.account_id, t.member_id, t.occurred_at, t.merchant
      from public.transactions t
     where t.household_id = p_household_id
       and p_amount < 0
       and t.amount_cents = p_amount
       and t.external_ref is null
       and not (t.id = any (coalesce(p_exclude, '{}')))
       and (t.occurred_at at time zone 'Australia/Sydney')::date between p_date - 3 and p_date + 3
       and ((t.source in ('apple_pay', 'android') and t.status = 'captured') or t.source = 'manual')
  ),
  on_card as (
    select * from base
     where source <> 'manual'
       and (account_id = p_account_id or (account_id is null and member_id = p_member_id))
  ),
  by_person as (
    select * from base
     where source <> 'manual' and member_id = p_member_id
       and not exists (select 1 from on_card)
  ),
  manual as (
    select * from base
     where source = 'manual' and member_id = p_member_id
       and not exists (select 1 from on_card)
       and not exists (select 1 from by_person)
  )
  select id, 'phone', occurred_at, merchant from on_card
  union all
  select id, 'phone', occurred_at, merchant from by_person
  union all
  select id, 'manual', occurred_at, merchant from manual
$$;
revoke all on function private.bank_match_candidates(uuid, uuid, uuid, bigint, date, uuid[]) from public, anon;
grant execute on function private.bank_match_candidates(uuid, uuid, uuid, bigint, date, uuid[]) to authenticated;

-- Two merchant names that are the same shop: equal or one contains the other,
-- ignoring case, spaces and punctuation ("Hungry Jack's" ~ "HUNGRY JACKS").
create function private.same_merchant(a text, b text) returns boolean
language sql
immutable
set search_path = ''
as $$
  select length(x) >= 3 and length(y) >= 3 and (x = y or strpos(x, y) > 0 or strpos(y, x) > 0)
    from (select lower(regexp_replace(coalesce(a, ''), '[^A-Za-z0-9]', '', 'g')) as x,
                 lower(regexp_replace(coalesce(b, ''), '[^A-Za-z0-9]', '', 'g')) as y) n
$$;

-- ---------------------------------------------------------------------------
-- import_bank_rows (replaces the merchant-cleaning version; same signature).
-- Only the candidate search and the review reason changed.
-- ---------------------------------------------------------------------------
create or replace function public.import_bank_rows(p_account_id uuid, p_rows jsonb, p_commit boolean)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_household_id uuid;
  v_member_id uuid;
  r jsonb;
  v_date date;
  v_amount bigint;
  v_desc text;
  v_ref text;
  v_include boolean;
  v_ids uuid[];
  v_kind text;
  v_used uuid[] := '{}';
  v_action text;
  v_rule_name text;
  v_rule_cat uuid;
  v_match jsonb;
  v_out jsonb := '[]'::jsonb;
begin
  select a.household_id, a.member_id into v_household_id, v_member_id
    from public.accounts a where a.id = p_account_id;
  if v_household_id is null then
    raise exception 'Unknown account' using errcode = '22023';
  end if;

  for r in
    select value from jsonb_array_elements(p_rows) order by value ->> 'date', (value ->> 'idx')::int
  loop
    v_date := (r ->> 'date')::date;
    v_amount := (r ->> 'amount_cents')::bigint;
    v_desc := left(trim(coalesce(r ->> 'description', '')), 200);
    v_ref := r ->> 'external_ref';
    v_include := coalesce((r ->> 'include')::boolean, false);
    v_ids := '{}';
    v_kind := null;
    v_match := null;
    v_rule_name := null;
    v_rule_cat := null;

    if v_amount is null or v_amount = 0 or v_date is null or v_ref is null then
      v_action := 'invalid';
    elsif exists (select 1 from public.transactions t
                   where t.household_id = v_household_id and t.external_ref = v_ref) then
      v_action := 'already_imported';
    else
      select mr.clean_name, mr.category_id into v_rule_name, v_rule_cat
        from private.merchant_rule_for(v_household_id, nullif(v_desc, ''), v_amount) mr;

      select coalesce(array_agg(c.id order by c.occurred_at), '{}'), max(c.kind) into v_ids, v_kind
        from private.bank_match_candidates(v_household_id, p_account_id, v_member_id, v_amount, v_date, v_used) c;

      v_action := case
        when cardinality(v_ids) = 0 then 'new'
        when cardinality(v_ids) = 1 and v_kind = 'phone' then 'merge'
        -- A manual entry merges only when its name is this shop's.
        when cardinality(v_ids) = 1 and exists (
          select 1 from public.transactions t
           where t.id = v_ids[1]
             and (private.same_merchant(t.merchant, coalesce(v_rule_name, r ->> 'merchant_fallback'))
                  or private.same_merchant(t.merchant, public.clean_merchant(v_desc)))) then 'merge'
        else 'ambiguous'
      end;
    end if;

    if v_action = 'merge' then
      select jsonb_build_object('id', t.id, 'merchant', t.merchant, 'occurred_at', t.occurred_at)
        into v_match from public.transactions t where t.id = v_ids[1];
      -- Included rows claim their match so a later row can't take it too.
      if v_include then v_used := v_used || v_ids[1]; end if;
    end if;

    if p_commit and v_include and v_action in ('new', 'merge', 'ambiguous') then
      if v_action = 'merge' then
        update public.transactions
           set merchant_raw = v_desc,
               merchant = coalesce(v_rule_name, merchant),
               category_id = coalesce(category_id, v_rule_cat),
               account_id = p_account_id,
               status = 'confirmed',
               external_ref = v_ref
         where id = v_ids[1];
      else
        insert into public.transactions
          (household_id, member_id, account_id, amount_cents, merchant_raw, merchant, category_id,
           occurred_at, source, status, external_ref, review_reason)
        values
          (v_household_id, v_member_id, p_account_id, v_amount, v_desc,
           left(coalesce(v_rule_name, nullif(trim(r ->> 'merchant_fallback'), ''), nullif(v_desc, ''), 'Unknown merchant'), 120),
           v_rule_cat,
           (v_date + time '12:00') at time zone 'Australia/Sydney',
           'csv', 'confirmed', v_ref,
           case when v_action = 'ambiguous' then
             case when v_kind = 'manual' then
               case cardinality(v_ids) when 1 then 'Possible duplicate: a manual entry could be this purchase'
                    else format('Possible duplicate: %s manual entries could be this purchase', cardinality(v_ids)) end
             else format('Possible duplicate: %s phone captures could be this purchase', cardinality(v_ids)) end
           end);
      end if;
    end if;

    v_out := v_out || jsonb_build_object(
      'idx', (r ->> 'idx')::int,
      'action', v_action,
      'include', v_include,
      'candidates', cardinality(v_ids),
      'match_kind', v_kind,
      'match', v_match);
  end loop;

  return v_out;
end;
$$;

-- ---------------------------------------------------------------------------
-- merge_duplicates(ids) → how many were merged.
-- For each flagged import in ids: merge it into the closest-in-time phone
-- capture or manual entry it could be a copy of. The earlier entry keeps its
-- time, person, name, category and note, and gains the bank's description,
-- card and confirmation; the imported copy is removed. Rows with nothing to
-- merge into are skipped. Runs as the caller, so RLS limits it to their
-- household.
-- ---------------------------------------------------------------------------
create function public.merge_duplicates(p_ids uuid[]) returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_t public.transactions;
  v_target uuid;
  v_n integer := 0;
begin
  for v_t in
    select * from public.transactions
     where id = any (p_ids) and review_reason is not null and external_ref is not null and amount_cents < 0
     order by occurred_at, id
  loop
    select c.id into v_target
      from private.bank_match_candidates(
             v_t.household_id, v_t.account_id, v_t.member_id, v_t.amount_cents,
             (v_t.occurred_at at time zone 'Australia/Sydney')::date, array[v_t.id]) c
     order by abs(extract(epoch from c.occurred_at - v_t.occurred_at)), c.id
     limit 1;
    continue when v_target is null;

    -- external_ref is unique per household, so remove the copy first.
    delete from public.transactions where id = v_t.id;
    update public.transactions
       set merchant_raw = v_t.merchant_raw,
           category_id = coalesce(category_id, v_t.category_id),
           account_id = coalesce(v_t.account_id, account_id),
           status = 'confirmed',
           external_ref = v_t.external_ref,
           review_reason = null
     where id = v_target;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke all on function public.merge_duplicates(uuid[]) from public, anon;
grant execute on function public.merge_duplicates(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- One-off: flag bank rows already imported that have an unclaimed phone
-- capture or manual entry twin (e.g. a coffee typed in by hand that the old
-- import didn't check), so they show in Needs review ready to merge.
-- ---------------------------------------------------------------------------
update public.transactions t
   set review_reason = case
         when c.kind = 'manual' and c.n = 1 then 'Possible duplicate: a manual entry could be this purchase'
         when c.kind = 'manual' then format('Possible duplicate: %s manual entries could be this purchase', c.n)
         when c.n = 1 then 'Possible duplicate: a phone capture could be this purchase'
         else format('Possible duplicate: %s phone captures could be this purchase', c.n)
       end
  from (
    select b.id, m.kind, m.n
      from public.transactions b
      cross join lateral (
        select max(x.kind) as kind, count(*)::int as n
          from private.bank_match_candidates(
                 b.household_id, b.account_id, b.member_id, b.amount_cents,
                 (b.occurred_at at time zone 'Australia/Sydney')::date, array[b.id]) x
      ) m
     where b.source in ('csv', 'bank_feed')
       and b.review_reason is null
       and b.amount_cents < 0
       and b.account_id is not null
       and m.n > 0
  ) c
 where c.id = t.id;
