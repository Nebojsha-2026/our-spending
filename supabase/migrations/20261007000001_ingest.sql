-- Phase 2: phone capture through POST /api/ingest.
--
-- The phone authenticates with a device token, not a user session, so the
-- endpoint calls ingest_transaction() with the public (anon) key. That function
-- is SECURITY DEFINER: it checks the token hash itself and only ever writes to
-- the token's own household. No service-role key is needed.

-- Which token captured a transaction (audit + per-token rate limit).
alter table public.transactions
  add column device_token_id uuid references public.device_tokens (id) on delete set null;
create index transactions_device_token_idx
  on public.transactions (device_token_id, created_at desc) where device_token_id is not null;

-- Signed-in users can create tokens for anyone in their household. Only the
-- hash is stored; POST /api/devices generates the token and shows it once.
create policy device_tokens_insert on public.device_tokens for insert to authenticated
  with check (member_id in (
    select m.id from public.members m
    where m.household_id in (select private.my_household_ids())));
grant insert (member_id, label, token_hash) on public.device_tokens to authenticated;

-- ---------------------------------------------------------------------------
-- ingest_transaction
--   p_token_hash         sha256 hex of the bearer token
--   p_amount_cents       negative (spending)
--   p_merchant_raw       merchant text as the phone saw it
--   p_merchant_fallback  tidy name computed by the app, used when no rule matches
--   p_card               card name from the phone, matched to an account nickname
--   p_source             apple_pay | android
--   p_occurred_at        when it happened
-- Returns { id, merchant, category, duplicate }.
-- Errors: 28000 bad/revoked token, 54000 rate limited, 22023 bad input.
-- ---------------------------------------------------------------------------
create function public.ingest_transaction(
  p_token_hash text,
  p_amount_cents bigint,
  p_merchant_raw text,
  p_merchant_fallback text,
  p_card text,
  p_source text,
  p_occurred_at timestamptz
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
  v_raw text := nullif(left(trim(coalesce(p_merchant_raw, '')), 200), '');
  v_at timestamptz := coalesce(p_occurred_at, now());
  v_existing uuid;
  v_id uuid;
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

  -- First matching merchant rule (lowest priority number, then most specific).
  if v_raw is not null then
    select r.clean_name, r.category_id
      into v_rule_name, v_category_id
      from public.merchant_rules r
     where r.household_id = v_household_id and v_raw ilike r.match_pattern
     order by r.priority, length(r.match_pattern) desc
     limit 1;
  end if;
  v_merchant := left(coalesce(v_rule_name, nullif(trim(p_merchant_fallback), ''), v_raw, 'Unknown merchant'), 120);

  -- Card → account: exact nickname, then partial match, preferring the
  -- spender's own cards; otherwise the spender's default card.
  if v_card is not null then
    select a.id into v_account_id
      from public.accounts a
     where a.household_id = v_household_id
       and (lower(a.nickname) = lower(v_card)
            or strpos(lower(v_card), lower(a.nickname)) > 0
            or strpos(lower(a.nickname), lower(v_card)) > 0)
     order by (lower(a.nickname) = lower(v_card)) desc, (a.member_id = v_member_id) desc, a.is_default desc
     limit 1;
  end if;
  if v_account_id is null then
    select a.id into v_account_id
      from public.accounts a
     where a.member_id = v_member_id and a.is_default;
  end if;

  -- Same purchase sent twice (Shortcut retry, or Wallet + bank app both
  -- notifying): same person, amount and merchant text within 2 minutes.
  select t.id into v_existing
    from public.transactions t
   where t.household_id = v_household_id
     and t.member_id = v_member_id
     and t.amount_cents = p_amount_cents
     and t.merchant_raw is not distinct from v_raw
     and t.occurred_at between v_at - interval '2 minutes' and v_at + interval '2 minutes'
   limit 1;
  if v_existing is not null then
    return (
      select jsonb_build_object('id', t.id, 'merchant', t.merchant, 'category', c.name, 'duplicate', true)
        from public.transactions t
        left join public.categories c on c.id = t.category_id
       where t.id = v_existing);
  end if;

  insert into public.transactions
    (household_id, member_id, account_id, amount_cents, merchant_raw, merchant,
     category_id, occurred_at, source, status, device_token_id)
  values
    (v_household_id, v_member_id, v_account_id, p_amount_cents, v_raw, v_merchant,
     v_category_id, v_at, p_source, 'captured', v_token_id)
  returning id into v_id;

  return jsonb_build_object(
    'id', v_id,
    'merchant', v_merchant,
    'category', (select name from public.categories where id = v_category_id),
    'duplicate', false);
end;
$$;
revoke all on function public.ingest_transaction(text, bigint, text, text, text, text, timestamptz) from public;
grant execute on function public.ingest_transaction(text, bigint, text, text, text, text, timestamptz) to anon, authenticated;
