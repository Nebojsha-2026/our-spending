-- Keep the phone's notification text on every Android capture, and repair
-- names saved with a label in front ("From: VISA").
--
--   * transactions.capture_text: the notification exactly as the phone sent
--     it (Android only). Shown at the bottom of the edit sheet, so a wrong
--     name can be checked against what the phone actually said.
--   * Captures saved as "From: VISA" and the like: the label is removed; if
--     what's left is a card, it becomes "Card payment" (or the bank's name
--     when a bank row already confirmed it), like 20261016000001.

alter table public.transactions
  add column capture_text text check (capture_text is null or length(capture_text) <= 1000);

-- ---------------------------------------------------------------------------
-- ingest_transaction: same as 20261016000001, plus capture_text.
-- ---------------------------------------------------------------------------
create or replace function public.ingest_transaction(
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
     category_id, occurred_at, source, status, device_token_id, note, capture_text)
  values
    (v_household_id, v_member_id, v_account_id, p_amount_cents, v_raw, v_merchant,
     v_category_id, v_at, p_source, 'captured', v_token_id, v_note,
     nullif(left(trim(coalesce(p_capture_text, '')), 1000), ''))
  returning id into v_id;

  return jsonb_build_object(
    'id', v_id,
    'merchant', v_merchant,
    'category', (select name from public.categories where id = v_category_id),
    'duplicate', false);
end;
$$;


-- ---------------------------------------------------------------------------
-- Repair labelled names.
-- ---------------------------------------------------------------------------
with fixed as (
  select id, external_ref, merchant_raw,
         btrim(regexp_replace(merchant, '^\s*(from|to|at|merchant|payee|paid to|payment to|purchase at|spent at|card)\s*:\s*', '', 'i')) as name
    from public.transactions
   where source = 'android' and merchant ~* '^\s*(from|to|at|merchant|payee|paid to|payment to|purchase at|spent at|card)\s*:\s*'
)
update public.transactions t
   set merchant = case
         when f.name ~* '^\s*((anz|nab|cba|commbank|westpac|ing|macquarie)\s+)?(visa|mastercard|amex|eftpos|debit|credit)(\s+(debit|credit|card|platinum|rewards|black|gold))*\s*([•·*x]{2,}\s*[0-9]{4})?\s*$' or f.name = '' then
           case when f.external_ref is null then 'Card payment' else left(public.clean_merchant(f.merchant_raw), 120) end
         else left(f.name, 120)
       end,
       merchant_raw = case when (f.name ~* '^\s*((anz|nab|cba|commbank|westpac|ing|macquarie)\s+)?(visa|mastercard|amex|eftpos|debit|credit)(\s+(debit|credit|card|platinum|rewards|black|gold))*\s*([•·*x]{2,}\s*[0-9]{4})?\s*$' or f.name = '') and f.external_ref is null then null else t.merchant_raw end
  from fixed f
 where f.id = t.id;

-- "Always" rules saved for a labelled card name.
delete from public.merchant_rules
 where btrim(regexp_replace(regexp_replace(match_pattern, '%+$', ''), '^\s*(from|to|at|merchant|payee|paid to|payment to|purchase at|spent at|card)\s*:\s*', '', 'i')) ~* '^\s*((anz|nab|cba|commbank|westpac|ing|macquarie)\s+)?(visa|mastercard|amex|eftpos|debit|credit)(\s+(debit|credit|card|platinum|rewards|black|gold))*\s*([•·*x]{2,}\s*[0-9]{4})?\s*$'
   and match_pattern ~* '^\s*(from|to|at|merchant|payee|paid to|payment to|purchase at|spent at|card)\s*:\s*';
