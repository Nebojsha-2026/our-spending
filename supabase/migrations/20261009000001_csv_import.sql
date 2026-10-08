-- Phase 4: ANZ / NAB CSV import with de-duplication against phone captures.

-- Set when an imported row could be one of several phone captures; it shows
-- in Needs review until someone keeps both or deletes one.
alter table public.transactions add column review_reason text check (review_reason is null or length(review_reason) <= 200);

-- v_needs_review gains possible duplicates. t.* changed shape, so recreate it.
drop view public.v_needs_review;
create view public.v_needs_review with (security_invoker = on) as
select t.*,
       (t.category_id is null) as needs_category,
       (t.status = 'captured' and t.occurred_at < now() - interval '7 days') as needs_confirmation,
       (t.review_reason is not null) as possible_duplicate
from public.transactions t
where t.category_id is null
   or (t.status = 'captured' and t.occurred_at < now() - interval '7 days')
   or t.review_reason is not null;
revoke all on public.v_needs_review from anon;
grant select on public.v_needs_review to authenticated;

-- ---------------------------------------------------------------------------
-- import_bank_rows(account, rows, commit)
--
-- rows: [{ idx, date: 'YYYY-MM-DD', amount_cents, description, merchant_fallback,
--          external_ref, include }]  (parsed and hashed by POST /api/import/csv)
-- With commit = false it only reports what would happen (the preview).
--
-- For each row, oldest first:
--   already_imported  external_ref exists → nothing (re-importing a file is a no-op)
--   merge             exactly one phone capture on this card (or with no card, by
--                     the same person), same amount, within 3 days → keep the
--                     phone's time and person, take the bank's description,
--                     mark confirmed
--   ambiguous         several such captures → insert, flagged for review
--   new               insert as confirmed
-- Runs as the caller (security invoker), so RLS limits it to their household.
-- ---------------------------------------------------------------------------
create function public.import_bank_rows(p_account_id uuid, p_rows jsonb, p_commit boolean)
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
    v_match := null;
    v_rule_name := null;
    v_rule_cat := null;

    if v_amount is null or v_amount = 0 or v_date is null or v_ref is null then
      v_action := 'invalid';
    elsif exists (select 1 from public.transactions t
                   where t.household_id = v_household_id and t.external_ref = v_ref) then
      v_action := 'already_imported';
    else
      if v_amount < 0 then
        select coalesce(array_agg(t.id order by t.occurred_at), '{}') into v_ids
          from public.transactions t
         where t.household_id = v_household_id
           and (t.account_id = p_account_id or (t.account_id is null and t.member_id = v_member_id))
           and t.amount_cents = v_amount
           and t.source in ('apple_pay', 'android')
           and t.status = 'captured'
           and t.external_ref is null
           and not (t.id = any (v_used))
           and (t.occurred_at at time zone 'Australia/Sydney')::date between v_date - 3 and v_date + 3;
      end if;
      v_action := case cardinality(v_ids) when 0 then 'new' when 1 then 'merge' else 'ambiguous' end;
    end if;

    if v_action = 'merge' then
      select jsonb_build_object('id', t.id, 'merchant', t.merchant, 'occurred_at', t.occurred_at)
        into v_match from public.transactions t where t.id = v_ids[1];
      -- Included rows claim their phone capture so a later row can't take it too.
      if v_include then v_used := v_used || v_ids[1]; end if;
    end if;

    if p_commit and v_include and v_action in ('new', 'merge', 'ambiguous') then
      select mr.clean_name, mr.category_id into v_rule_name, v_rule_cat
        from public.merchant_rules mr
       where mr.household_id = v_household_id and v_desc ilike mr.match_pattern
       order by mr.priority, length(mr.match_pattern) desc
       limit 1;

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
           case when v_action = 'ambiguous'
                then format('Possible duplicate: %s phone captures could be this purchase', cardinality(v_ids)) end);
      end if;
    end if;

    v_out := v_out || jsonb_build_object(
      'idx', (r ->> 'idx')::int,
      'action', v_action,
      'include', v_include,
      'candidates', cardinality(v_ids),
      'match', v_match);
  end loop;

  return v_out;
end;
$$;
revoke all on function public.import_bank_rows(uuid, jsonb, boolean) from public, anon;
grant execute on function public.import_bank_rows(uuid, jsonb, boolean) to authenticated;
