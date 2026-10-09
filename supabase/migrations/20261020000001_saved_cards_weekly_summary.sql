-- Only log payments from the household's saved cards, and a weekly heads-up
-- about payments that weren't logged.
--
--   * ingest_transaction: a capture that names a card the household hasn't
--     saved (an Afterpay or Zip card in Apple Wallet, a gift card, someone's
--     new card) is no longer put on the default card. It comes back as
--     { skipped: 'unknown_card' } and the route records it in the Capture
--     log. Name matching is stricter too: Wallet's name has to contain the
--     saved nickname ("ANZ Visa Debit" matches "ANZ Visa"), not the reverse,
--     so a plain "Visa" no longer matches "ANZ Visa".
--   * claim_capture_summary: once a week (from Monday, Sydney time), the
--     number of last week's payments that weren't logged, for a push to the
--     household's phones. Notifications skipped on purpose (refunds,
--     transfers, declines) don't count. Nothing is sent for a quiet week.

-- ---------------------------------------------------------------------------
-- ingest_transaction: same as 20261018000001, with the saved-card check.
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
  --     nickname is that name or part of it.
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
-- Weekly summary of the Capture log.
-- ---------------------------------------------------------------------------
create table private.capture_summaries (
  household_id  uuid not null references public.households (id) on delete cascade,
  week          date not null,  -- the Monday the summary was sent for (covers the week before)
  missed        integer not null,
  sent_at       timestamptz not null default now(),
  primary key (household_id, week)
);
revoke all on private.capture_summaries from public, anon, authenticated;
alter table private.capture_summaries enable row level security;

create function public.claim_capture_summary(p_token_hash text default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household_id uuid;
  v_week date := date_trunc('week', now() at time zone 'Australia/Sydney')::date;
  v_from timestamptz := ((v_week - 7)::timestamp at time zone 'Australia/Sydney');
  v_to timestamptz := (v_week::timestamp at time zone 'Australia/Sydney');
  v_cards integer;
  v_unread integer;
  v_none constant jsonb := jsonb_build_object('missed', 0, 'unknown_cards', 0, 'unreadable', 0, 'subscriptions', '[]'::jsonb);
begin
  if p_token_hash is not null then
    select m.household_id into v_household_id
      from public.device_tokens dt
      join public.members m on m.id = dt.member_id
     where dt.token_hash = p_token_hash and dt.revoked_at is null;
  else
    select m.household_id into v_household_id from public.members m where m.user_id = auth.uid();
  end if;
  if v_household_id is null then
    raise exception 'Not signed in or invalid device token' using errcode = '28000';
  end if;

  if exists (select 1 from private.capture_summaries where household_id = v_household_id and week = v_week)
     or not exists (select 1 from public.push_subscriptions where household_id = v_household_id) then
    return v_none;
  end if;

  select count(*) filter (where f.reason like 'Not one of your cards%'),
         count(*) filter (where f.reason not like 'Not one of your cards%')
    into v_cards, v_unread
    from public.ingest_failures f
   where f.household_id = v_household_id
     and f.created_at >= v_from and f.created_at < v_to
     and f.reason not like 'Ignored%';
  if v_cards + v_unread = 0 then
    return v_none;
  end if;

  insert into private.capture_summaries (household_id, week, missed)
  values (v_household_id, v_week, v_cards + v_unread)
  on conflict do nothing;
  if not found then
    return v_none;  -- another capture claimed it a moment ago
  end if;

  return jsonb_build_object(
    'missed', v_cards + v_unread,
    'unknown_cards', v_cards,
    'unreadable', v_unread,
    'subscriptions', (
      select coalesce(jsonb_agg(jsonb_build_object('endpoint', p.endpoint, 'p256dh', p.p256dh, 'auth', p.auth)), '[]'::jsonb)
        from public.push_subscriptions p where p.household_id = v_household_id));
end;
$$;
revoke all on function public.claim_capture_summary(text) from public;
grant execute on function public.claim_capture_summary(text) to anon, authenticated;
