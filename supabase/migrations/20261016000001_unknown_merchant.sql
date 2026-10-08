-- Android purchases whose notification doesn't name the shop.
--
-- Google Wallet sometimes titles its notification with the card ("Visa ••1234
-- | $23.50") when the terminal sent no merchant name, which used to be saved as
-- a purchase at "Visa". Now the app saves it as "Card payment" with the
-- notification text in the note (so the wording can be checked), and the shop
-- name is filled in later from whichever comes first:
--   * the bank app's own notification for the same purchase (2-minute window),
--   * the bank CSV row that confirms it (import or "Merge").
-- Existing "Visa"-style captures are repaired the same way.

-- ---------------------------------------------------------------------------
-- ingest_transaction: + p_capture_text (the notification, kept when it named
-- no shop), and a later notification can fill in the missing shop name.
-- ---------------------------------------------------------------------------
drop function public.ingest_transaction(text, bigint, text, text, text, text, timestamptz);

create function public.ingest_transaction(
  p_token_hash text,
  p_amount_cents bigint,
  p_merchant_raw text,
  p_merchant_fallback text,
  p_card text,
  p_source text,
  p_occurred_at timestamptz,
  p_capture_text text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token_id uuid;
  v_member_id uuid;
  v_household_id uuid;
  v_rule_name text;
  v_category_id uuid;
  v_merchant text;
  v_account_id uuid;
  v_card text := nullif(trim(coalesce(p_card, '')), '');
  v_last4 text;
  v_raw text := nullif(left(trim(coalesce(p_merchant_raw, '')), 200), '');
  v_at timestamptz := coalesce(p_occurred_at, now());
  v_existing uuid;
  v_id uuid;
  v_note text := case when nullif(left(trim(coalesce(p_merchant_raw, '')), 200), '') is null and nullif(trim(p_capture_text), '') is not null
                      then left('Notification: ' || trim(p_capture_text), 500) end;
begin
  select dt.id, dt.member_id, m.household_id
    into v_token_id, v_member_id, v_household_id
    from public.device_tokens dt
    join public.members m on m.id = dt.member_id
   where dt.token_hash = p_token_hash and dt.revoked_at is null;
  if v_token_id is null then
    raise exception 'Invalid or revoked device token' using errcode = '28000';
  end if;

  -- Rate limit: 20 captures per token per 10 minutes.
  if (select count(*) from public.transactions
       where device_token_id = v_token_id and created_at > now() - interval '10 minutes') >= 20 then
    raise exception 'Too many captures, slow down' using errcode = '54000';
  end if;

  update public.device_tokens set last_used_at = now() where id = v_token_id;

  if p_amount_cents is null or p_amount_cents >= 0 then
    raise exception 'Amount must be a spend (negative cents)' using errcode = '22023';
  end if;
  if p_source is null or p_source not in ('apple_pay', 'android') then
    raise exception 'Unknown source' using errcode = '22023';
  end if;

  -- The winning merchant rule for this text and amount.
  if v_raw is not null then
    select r.clean_name, r.category_id
      into v_rule_name, v_category_id
      from private.merchant_rule_for(v_household_id, v_raw, p_amount_cents) r;
  end if;
  v_merchant := left(coalesce(v_rule_name, nullif(trim(p_merchant_fallback), ''), v_raw, 'Unknown merchant'), 120);

  -- Card → account: last 4 digits if the phone gave them ("Visa ••1234"),
  -- then nickname (exact, then partial), preferring the spender's own cards;
  -- otherwise the spender's default card.
  if v_card is not null then
    v_last4 := substring(v_card from '(\d{4})\D*$');
    if v_last4 is not null then
      select a.id into v_account_id
        from public.accounts a
       where a.household_id = v_household_id and a.last4 = v_last4
       order by (a.member_id = v_member_id) desc, a.is_default desc
       limit 1;
    end if;
    if v_account_id is null then
      select a.id into v_account_id
        from public.accounts a
       where a.household_id = v_household_id
         and (lower(a.nickname) = lower(v_card)
              or strpos(lower(v_card), lower(a.nickname)) > 0
              or strpos(lower(a.nickname), lower(v_card)) > 0)
       order by (lower(a.nickname) = lower(v_card)) desc, (a.member_id = v_member_id) desc, a.is_default desc
       limit 1;
    end if;
  end if;
  if v_account_id is null then
    select a.id into v_account_id
      from public.accounts a
     where a.member_id = v_member_id and a.is_default;
  end if;

  -- One purchase sent twice within 2 minutes by the same person's phone:
  -- a Shortcut retry (same merchant text), or Google Wallet and the bank app
  -- both notifying (different merchant text, so on Android match on amount).
  select t.id into v_existing
    from public.transactions t
   where t.household_id = v_household_id
     and t.member_id = v_member_id
     and t.amount_cents = p_amount_cents
     and t.source in ('apple_pay', 'android')
     and (t.merchant_raw is not distinct from v_raw or p_source = 'android' or t.source = 'android')
     and t.occurred_at between v_at - interval '2 minutes' and v_at + interval '2 minutes'
   order by t.occurred_at
   limit 1;
  if v_existing is not null then
    -- The first notification had no shop name (Wallet titled it with the card);
    -- this one has it (e.g. the bank app's alert): fill it in.
    if v_raw is not null then
      update public.transactions t
         set merchant_raw = v_raw,
             merchant = v_merchant,
             category_id = coalesce(t.category_id, v_category_id),
             note = case when t.note like 'Notification: %' then null else t.note end
       where t.id = v_existing and t.merchant_raw is null;
    end if;
    return (
      select jsonb_build_object('id', t.id, 'merchant', t.merchant, 'category', c.name, 'duplicate', true)
        from public.transactions t
        left join public.categories c on c.id = t.category_id
       where t.id = v_existing);
  end if;

  insert into public.transactions
    (household_id, member_id, account_id, amount_cents, merchant_raw, merchant,
     category_id, occurred_at, source, status, device_token_id, note)
  values
    (v_household_id, v_member_id, v_account_id, p_amount_cents, v_raw, v_merchant,
     v_category_id, v_at, p_source, 'captured', v_token_id, v_note)
  returning id into v_id;

  return jsonb_build_object(
    'id', v_id,
    'merchant', v_merchant,
    'category', (select name from public.categories where id = v_category_id),
    'duplicate', false);
end;
$$;

revoke all on function public.ingest_transaction(text, bigint, text, text, text, text, timestamptz, text) from public;
grant execute on function public.ingest_transaction(text, bigint, text, text, text, text, timestamptz, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- import_bank_rows / merge_duplicates / merge_duplicate_into: a capture without
-- a shop name takes the bank's when they're merged (same signatures).
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


create or replace function public.merge_duplicates(p_ids uuid[]) returns integer
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
           -- An entry that never had a shop name takes the bank's.
           merchant = case when merchant_raw is null and source in ('apple_pay', 'android') then v_t.merchant else merchant end,
           note = case when merchant_raw is null and note like 'Notification: %' then null else note end,
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


create or replace function public.merge_duplicate_into(p_id uuid, p_into uuid) returns boolean
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
         -- An entry that never had a shop name takes the bank's.
         merchant = case when merchant_raw is null and source in ('apple_pay', 'android') then v_t.merchant else merchant end,
         note = case when merchant_raw is null and note like 'Notification: %' then null else note end,
         category_id = coalesce(category_id, v_t.category_id),
         account_id = coalesce(v_t.account_id, account_id),
         status = 'confirmed',
         external_ref = v_t.external_ref,
         review_reason = null
   where id = p_into;
  return true;
end;
$$;


-- ---------------------------------------------------------------------------
-- Repair: phone captures saved with a card name as the shop.
-- ---------------------------------------------------------------------------
-- Already confirmed by a bank row: use the bank's description.
update public.transactions
   set merchant = left(public.clean_merchant(merchant_raw), 120)
 where source = 'android'
   and external_ref is not null
   and merchant ~* '^\s*((anz|nab|cba|commbank|westpac|ing|macquarie)\s+)?(visa|mastercard|amex|eftpos|debit|credit)(\s+(debit|credit|card|platinum|rewards|black|gold))*\s*([•·*x]{2,}\s*[0-9]{4})?\s*$';

-- Not confirmed yet: "Card payment", waiting for the bank's name.
update public.transactions
   set merchant_raw = null,
       merchant = 'Card payment'
 where source = 'android'
   and external_ref is null
   and merchant ~* '^\s*((anz|nab|cba|commbank|westpac|ing|macquarie)\s+)?(visa|mastercard|amex|eftpos|debit|credit)(\s+(debit|credit|card|platinum|rewards|black|gold))*\s*([•·*x]{2,}\s*[0-9]{4})?\s*$';

-- An "Always" rule saved for a card name would file every such payment in one
-- category; those rules are meaningless, so remove them.
delete from public.merchant_rules
 where match_pattern ~* '^\s*((anz|nab|cba|commbank|westpac|ing|macquarie)\s+)?(visa|mastercard|amex|eftpos|debit|credit)(\s+(debit|credit|card|platinum|rewards|black|gold))*\s*([•·*x]{2,}\s*[0-9]{4})?\%?\s*$';
