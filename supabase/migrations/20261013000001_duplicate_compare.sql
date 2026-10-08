-- Compare a possible duplicate with what it could be a copy of, and merge
-- into the one you pick.
--
--   duplicate_candidates(id)       the earlier entries a flagged bank row could
--                                  be, closest in time first
--   merge_duplicate_into(id, into) merge the bank row into that entry
-- Both run as the caller, so RLS limits them to their household.

create function public.duplicate_candidates(p_id uuid) returns setof public.transactions
language sql
stable
security invoker
set search_path = ''
as $$
  select t.*
    from public.transactions b
    cross join lateral private.bank_match_candidates(
           b.household_id, b.account_id, b.member_id, b.amount_cents,
           (b.occurred_at at time zone 'Australia/Sydney')::date, array[b.id]) c
    join public.transactions t on t.id = c.id
   where b.id = p_id and b.review_reason is not null and b.external_ref is not null
   order by abs(extract(epoch from t.occurred_at - b.occurred_at)), t.id
$$;
revoke all on function public.duplicate_candidates(uuid) from public, anon;
grant execute on function public.duplicate_candidates(uuid) to authenticated;

-- Returns false (and changes nothing) when p_into isn't one of the candidates.
create function public.merge_duplicate_into(p_id uuid, p_into uuid) returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_t public.transactions;
begin
  if not exists (select 1 from public.duplicate_candidates(p_id) c where c.id = p_into) then
    return false;
  end if;
  select * into v_t from public.transactions where id = p_id;

  -- external_ref is unique per household, so remove the copy first.
  delete from public.transactions where id = v_t.id;
  update public.transactions
     set merchant_raw = v_t.merchant_raw,
         category_id = coalesce(category_id, v_t.category_id),
         account_id = coalesce(v_t.account_id, account_id),
         status = 'confirmed',
         external_ref = v_t.external_ref,
         review_reason = null
   where id = p_into;
  return true;
end;
$$;
revoke all on function public.merge_duplicate_into(uuid, uuid) from public, anon;
grant execute on function public.merge_duplicate_into(uuid, uuid) to authenticated;
