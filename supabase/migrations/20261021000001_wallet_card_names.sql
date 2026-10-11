-- Wallet's plain card names ("Debit", "ANZ Debit", "Visa Credit").
--
-- The saved-card check (20261020000001) wanted Wallet's name to contain the
-- card's nickname, but Wallet often names a bank card plainly: an ANZ debit
-- card comes through as "Debit". Those payments went to the Capture log.
--
--   * ingest_transaction: a name made only of bank and card words is one of
--     the spender's own cards (same bank and type when it says them, else
--     their default). "Afterpay Card" and the like are still skipped.
--   * Repair: payments skipped that way are logged now, at the time they
--     were made, and taken out of the Capture log.

-- Bank and card words, as a regex alternation.
create function private.card_words() returns text
language sql immutable
set search_path = ''
as $$
  select 'anz|nab|cba|commbank|commonwealth( bank)?|westpac|st\.? ?george|ing|macquarie|bendigo|suncorp|amp|boq|'
      || 'visa|mastercard|master card|amex|american express|eftpos|debit|credit|card|everyday|access|'
      || 'platinum|rewards|classic|gold|black|low rate|signature|business|savings|cheque|account'
$$;

-- ---------------------------------------------------------------------------
-- ingest_transaction: same as 20261020000001, plus plain Wallet names.
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

  -- Card → account. Only the household's own cards are logged, so a tap
  -- with an Afterpay card or a gift card in Wallet doesn't count twice (its
  -- repayments come off a saved card anyway).
  --   * Last 4 digits given ("Visa ••1234", "card ending 6800"): a saved card
  --     with those digits. While one of the spender's cards has no digits
  --     saved, a miss falls through to the name and default, as before.
  --   * iPhone (Wallet's card name, e.g. "ANZ Visa"): a saved card whose
  --     nickname is that name or part of it. Wallet often names a bank card
  --     plainly ("Debit", "ANZ Debit", "Visa Credit"); a name made only of
  --     such words is one of the spender's own cards: the same bank and type
  --     if it says them, else their default. A name with anything else in it
  --     ("Afterpay Card", "Coles Gift Card") is not.
  --   * Android without digits ("Visa"): the name if it matches, else the
  --     spender's default card.
  --   * No card at all: the spender's default card.
  -- A card that isn't saved is reported back, not logged; the route puts it
  -- in the Capture log. Someone with no cards saved yet is logged as before.
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
         and (lower(trim(a.nickname)) = lower(v_card)
              or (length(trim(a.nickname)) >= 3 and strpos(lower(v_card), lower(trim(a.nickname))) > 0))
       order by (lower(trim(a.nickname)) = lower(v_card)) desc, (a.member_id = v_member_id) desc,
                length(a.nickname) desc, a.is_default desc
       limit 1;
    end if;
    if v_account_id is null and v_card ~* ('^\s*((' || private.card_words() || ')\s*)+$') then
      select a.id into v_account_id
        from public.accounts a
       where a.member_id = v_member_id
       order by strpos(lower(v_card), lower(a.bank)) > 0 desc, strpos(lower(v_card), lower(a.type)) > 0 desc, a.is_default desc
       limit 1;
    end if;
    if v_account_id is null
       and exists (select 1 from public.accounts a where a.member_id = v_member_id)
       and (p_source = 'apple_pay'
            or (v_last4 is not null and not exists (
                  select 1 from public.accounts a where a.member_id = v_member_id and a.last4 is null))) then
      return jsonb_build_object('skipped', 'unknown_card', 'card', v_card);
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
-- Repair: log iPhone payments skipped only because of a plain Wallet name.
-- The Capture log kept what the phone sent: {"amount","merchant","card",...}.
-- ---------------------------------------------------------------------------
do $$
declare
  f record;
  v_body jsonb;
  v_cents bigint;
  v_raw text;
begin
  for f in
    select i.id, i.raw, i.created_at, dt.token_hash
      from public.ingest_failures i
      join public.device_tokens dt on dt.id = i.device_token_id and dt.revoked_at is null
     where i.reason like 'Not one of your cards%' and i.raw ~ '^\s*\{'
     order by i.created_at
  loop
    begin
      v_body := f.raw::jsonb;
      continue when v_body ->> 'source' is distinct from 'apple_pay'
                 or coalesce(v_body ->> 'card', '') !~* ('^\s*((' || private.card_words() || ')\s*)+$');
      v_cents := round(abs(nullif(regexp_replace(coalesce(v_body ->> 'amount', ''), '[^0-9.]', '', 'g'), '')::numeric) * 100);
      continue when v_cents is null or v_cents = 0;
      v_raw := nullif(left(trim(coalesce(v_body ->> 'merchant', '')), 200), '');
      perform public.ingest_transaction(
        f.token_hash, -v_cents, v_raw, coalesce(public.clean_merchant(v_raw), 'Card payment'),
        v_body ->> 'card', 'apple_pay',
        coalesce((v_body ->> 'occurred_at')::timestamptz, f.created_at), null);
      delete from public.ingest_failures where id = f.id;
    exception when others then
      null;  -- left in the Capture log
    end;
  end loop;
end;
$$;
