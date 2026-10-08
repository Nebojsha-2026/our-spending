-- Any transaction can be deleted (test entries, duplicates, mistakes), bank
-- imports included. A deleted bank row would come straight back on the next
-- import of an overlapping CSV, so its external_ref is remembered in
-- deleted_bank_rows and import_bank_rows reports it as 'deleted' instead of
-- importing it again. (Add it back with quick add if it was a mistake.)

create table public.deleted_bank_rows (
  household_id  uuid not null references public.households (id) on delete cascade,
  external_ref  text not null,
  deleted_at    timestamptz not null default now(),
  primary key (household_id, external_ref)
);
alter table public.deleted_bank_rows enable row level security;
revoke all on public.deleted_bank_rows from anon;
revoke insert, update, delete on public.deleted_bank_rows from authenticated;
create policy deleted_bank_rows_select on public.deleted_bank_rows for select to authenticated
  using (household_id in (select private.my_household_ids()));

-- Recorded by a trigger, so every way of deleting is covered. Merging a
-- duplicate also deletes the bank copy, but its external_ref moves onto the
-- entry it merged into, which import_bank_rows checks first.
create function private.remember_deleted_bank_row() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Skipped when the whole household is being deleted (cascade).
  insert into public.deleted_bank_rows (household_id, external_ref)
  select old.household_id, old.external_ref
   where exists (select 1 from public.households h where h.id = old.household_id)
  on conflict do nothing;
  return old;
end;
$$;
revoke all on function private.remember_deleted_bank_row() from public;

create trigger transactions_remember_deleted_bank_row
  after delete on public.transactions
  for each row when (old.external_ref is not null)
  execute function private.remember_deleted_bank_row();

-- ---------------------------------------------------------------------------
-- import_bank_rows: + action 'deleted' (same signature).
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
    -- Deleted from Activity after an earlier import: stays deleted.
    elsif exists (select 1 from public.deleted_bank_rows d
                   where d.household_id = v_household_id and d.external_ref = v_ref) then
      v_action := 'deleted';
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
               -- A capture that never had a shop name takes the bank's.
               merchant = coalesce(v_rule_name,
                                   case when merchant_raw is null
                                        then left(coalesce(nullif(trim(r ->> 'merchant_fallback'), ''), nullif(v_desc, '')), 120) end,
                                   merchant),
               note = case when merchant_raw is null and note like 'Notification: %' then null else note end,
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
