-- Merchant cleaning and amount-aware merchant rules.
--
--   * public.clean_merchant(): the same cleaning as cleanMerchant() in
--     src/lib/ingest.ts (card prefixes, dates, times, store numbers, suburbs,
--     a repeated trailing suburb), so the database can re-clean old rows.
--   * merchant_rules gains min_amount_cents / max_amount_cents, and rules are
--     checked against the cleaned merchant name as well as the raw bank text.
--     The most specific matching rule wins.
--   * apply_merchant_rule(): "Always" applies a rule to every past match.
--   * One-off data fix: re-clean every transaction's merchant from
--     merchant_raw, repair rules saved from noisy bank text, then re-apply rules.

-- ---------------------------------------------------------------------------
-- Amount ranges on rules. Amounts are the size of the spend in cents:
-- min is inclusive, max is exclusive ("under $10" = max 1000, "$50 or more" = min 5000).
-- ---------------------------------------------------------------------------
alter table public.merchant_rules
  add column min_amount_cents bigint check (min_amount_cents is null or min_amount_cents >= 0),
  add column max_amount_cents bigint check (max_amount_cents is null or max_amount_cents > 0),
  add constraint merchant_rules_amount_range check (
    min_amount_cents is null or max_amount_cents is null or min_amount_cents < max_amount_cents);

-- ---------------------------------------------------------------------------
-- clean_merchant(raw) → tidy name. Keep in step with cleanMerchant() in
-- src/lib/ingest.ts; supabase/tests/db.test.ts checks they agree.
-- ---------------------------------------------------------------------------
create function private.title_word(p_word text) returns text
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  v_lower text := lower(p_word);
  v_out text := '';
  v_c text;
begin
  if p_word !~* '[AEIOUY]' then
    return upper(p_word); -- BP, KFC, JB
  end if;
  for i in 1 .. length(v_lower) loop
    v_c := substr(v_lower, i, 1);
    if v_c ~ '[a-z]' and (i = 1 or substr(v_lower, i - 1, 1) in ('-', '/', '&', '.')) then
      v_c := upper(v_c);
    end if;
    v_out := v_out || v_c;
  end loop;
  return v_out;
end;
$$;

-- Noise in front of the merchant, stripped repeatedly in this order
-- (LEADING_NOISE in src/lib/ingest.ts).
create function private.merchant_leading_noise() returns text[]
language sql
immutable
parallel safe
set search_path = ''
as $$
  select array[
    '^(SQ ?\*|SP ?\*|SP |PAYPAL ?\*|PP ?\*|ZLR ?\*|LS |TST ?\*|IZ ?\*|SUMUP ?\*|CKO ?\*|DD ?\*) *',
    '^(EFTPOS|POS|VISA (DEBIT )?PURCHASE|DEBIT CARD PURCHASE|CARD PURCHASE|PURCHASE)(?![A-Z0-9]) *',
    '^[VM][0-9]{4}(?![A-Z0-9]) *',
    '^(CARD )?X{2,}[0-9]{4}(?![A-Z0-9]) *',
    '^[0-9]{1,2}/[0-9]{1,2}(/[0-9]{2,4})?(?![A-Z0-9]) *',
    '^[0-9]{1,2}:[0-9]{2}(:[0-9]{2})?( ?[AP]M(?![A-Z]))? *'
  ]
$$;

create function public.clean_merchant(p_raw text) returns text
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  -- Words from here on are a store number, date, time or card — not the name.
  v_cut constant text := '^(#?[0-9][0-9-]*|[0-9]{1,2}/[0-9]{1,2}(/[0-9]{2,4})?|[0-9]{1,2}:[0-9]{2}(:[0-9]{2})?|X{2,}[0-9]{4})$';
  v_trailing constant text[] := array['AU', 'AUS', 'AUSTRALIA', 'NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT', 'PTY', 'LTD'];
  v_noise constant text[] := private.merchant_leading_noise();
  s text;
  v_prev text;
  v_re text;
  w text[];
  n integer;
  v_changed boolean := true;
begin
  if p_raw is null then
    return null;
  end if;
  s := btrim(regexp_replace(p_raw, '\s+', ' ', 'g'));
  loop
    v_prev := s;
    foreach v_re in array v_noise loop
      s := regexp_replace(s, v_re, '', 'i');
    end loop;
    exit when s = v_prev;
  end loop;

  w := coalesce(string_to_array(nullif(s, ''), ' '), '{}');
  n := coalesce(array_length(w, 1), 0);
  for i in 2 .. n loop
    if w[i] ~* v_cut
       or (w[i] ~* '^card$' and coalesce(w[i + 1], '') ~* v_cut)
       or (w[i] ~* '^value$' and coalesce(w[i + 1], '') ~* '^date:?$') then
      w := w[1:i - 1];
      exit;
    end if;
  end loop;

  while v_changed loop
    v_changed := false;
    while coalesce(array_length(w, 1), 0) > 1 and upper(w[array_length(w, 1)]) = any (v_trailing) loop
      w := w[1:array_length(w, 1) - 1];
      v_changed := true;
    end loop;
    -- A repeated trailing suburb: "KBC Surry Hills Surry Hills" → "KBC Surry Hills".
    n := coalesce(array_length(w, 1), 0);
    for k in reverse (n / 2) .. 1 loop
      if lower(array_to_string(w[n - k + 1:n], ' ')) = lower(array_to_string(w[n - 2 * k + 1:n - k], ' '))
         and (n - 2 * k >= 1 or k >= 2) then
        w := w[1:n - k];
        v_changed := true;
        exit;
      end if;
    end loop;
  end loop;

  if coalesce(array_length(w, 1), 0) = 0 then
    return left(regexp_replace(p_raw, '^\s+|\s+$', '', 'g'), 120);
  end if;
  s := array_to_string(w, ' ');
  if s !~ '[a-z]' then
    select string_agg(private.title_word(u.word), ' ' order by u.ord) into s
      from unnest(w) with ordinality as u(word, ord);
  end if;
  return left(s, 120);
end;
$$;
revoke all on function public.clean_merchant(text) from public, anon;
grant execute on function public.clean_merchant(text) to authenticated;

-- ---------------------------------------------------------------------------
-- merchant_rule_for(household, raw text, amount) → the winning rule, if any.
-- A rule matches when its ILIKE pattern matches the raw text or the cleaned
-- name, and the amount is inside its range. Order: priority, then rules with
-- an amount range before those without (the narrower range first), then the
-- longer pattern, then the newest.
-- ---------------------------------------------------------------------------
create function private.merchant_rule_for(p_household_id uuid, p_raw text, p_amount_cents bigint)
returns setof public.merchant_rules
language sql
stable
set search_path = ''
as $$
  select r.*
    from public.merchant_rules r
   where r.household_id = p_household_id
     and p_raw is not null
     and (p_raw ilike r.match_pattern or public.clean_merchant(p_raw) ilike r.match_pattern)
     and (r.min_amount_cents is null or abs(p_amount_cents) >= r.min_amount_cents)
     and (r.max_amount_cents is null or abs(p_amount_cents) < r.max_amount_cents)
   order by r.priority,
            (r.min_amount_cents is not null)::int + (r.max_amount_cents is not null)::int desc,
            coalesce(r.max_amount_cents, 9223372036854775807) - coalesce(r.min_amount_cents, 0),
            length(r.match_pattern) desc,
            r.created_at desc,
            r.id
   limit 1
$$;
revoke all on function private.merchant_rule_for(uuid, text, bigint) from public, anon;
grant execute on function private.merchant_rule_for(uuid, text, bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- apply_merchant_rule(rule) → how many transactions it now decides.
-- Sets the rule's name and category on every transaction (past and present)
-- for which this rule is the winning one, which takes uncategorised ones out
-- of Needs review. Runs as the caller, so RLS limits it to their household.
-- ---------------------------------------------------------------------------
create function public.apply_merchant_rule(p_rule_id uuid) returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_rule public.merchant_rules;
  v_n integer;
begin
  select * into v_rule from public.merchant_rules where id = p_rule_id;
  if v_rule.id is null then
    raise exception 'Unknown rule' using errcode = '22023';
  end if;

  update public.transactions t
     set merchant = left(v_rule.clean_name, 120),
         category_id = coalesce(v_rule.category_id, t.category_id)
   where t.household_id = v_rule.household_id
     -- Cheap pre-filter, then the full "is this the winning rule" check.
     and (coalesce(t.merchant_raw, t.merchant) ilike v_rule.match_pattern
          or public.clean_merchant(coalesce(t.merchant_raw, t.merchant)) ilike v_rule.match_pattern)
     and (select w.id
            from private.merchant_rule_for(t.household_id, coalesce(t.merchant_raw, t.merchant), t.amount_cents) w) = p_rule_id;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.apply_merchant_rule(uuid) from public, anon;
grant execute on function public.apply_merchant_rule(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- ingest_transaction (replaces phase 3's version; same signature). Only the
-- rule lookup changed: it now goes through merchant_rule_for().
-- ---------------------------------------------------------------------------
create or replace function public.ingest_transaction(
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
  v_last4 text;
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

-- ---------------------------------------------------------------------------
-- import_bank_rows (replaces phase 4's version; same signature). Only the
-- rule lookup changed: it now goes through merchant_rule_for().
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
        from private.merchant_rule_for(v_household_id, nullif(v_desc, ''), v_amount) mr;

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

-- ---------------------------------------------------------------------------
-- One-off data fix.
-- ---------------------------------------------------------------------------

-- 1. Rules saved by "Always" before this fix used the raw bank text, so they
--    carry its noise ('V4821 28/09 7-ELEVEN%') and only ever matched one day.
--    Rewrite them to the cleaned name, which matches the merchant on any date.
create function pg_temp.has_leading_noise(p_text text) returns boolean
language sql immutable as $$
  select exists (select 1 from unnest(private.merchant_leading_noise()) re where p_text ~* re)
$$;

update public.merchant_rules r
   set match_pattern = left(replace(replace(replace(c.name, '\', '\\'), '%', '\%'), '_', '\_'), 120)
  from (
    select id,
           public.clean_merchant(regexp_replace(regexp_replace(match_pattern, '%+$', ''), '\\(.)', '\1', 'g')) as name
      from public.merchant_rules
     where match_pattern !~ '^%'
  ) c
 where c.id = r.id
   and pg_temp.has_leading_noise(r.match_pattern)
   and btrim(c.name) <> '';

update public.merchant_rules
   set clean_name = left(public.clean_merchant(clean_name), 80)
 where pg_temp.has_leading_noise(clean_name)
   and btrim(public.clean_merchant(clean_name)) <> '';

-- Several noisy rules for one merchant now share a pattern: keep the newest.
delete from public.merchant_rules r
 using public.merchant_rules newer
 where newer.household_id = r.household_id
   and lower(newer.match_pattern) = lower(r.match_pattern)
   and newer.min_amount_cents is not distinct from r.min_amount_cents
   and newer.max_amount_cents is not distinct from r.max_amount_cents
   and (newer.created_at, newer.id) > (r.created_at, r.id);

drop function pg_temp.has_leading_noise(text);

-- 2. Re-clean every merchant from the bank / phone text.
update public.transactions
   set merchant = left(public.clean_merchant(merchant_raw), 120)
 where merchant_raw is not null
   and btrim(merchant_raw) <> ''
   and merchant is distinct from left(public.clean_merchant(merchant_raw), 120);

-- 3. Re-apply rules: the rule's name, and its category where there is none yet
--    (a category someone picked by hand is kept).
with matched as (
  select t.id, r.clean_name, r.category_id
    from public.transactions t
    cross join lateral private.merchant_rule_for(t.household_id, coalesce(t.merchant_raw, t.merchant), t.amount_cents) r
)
update public.transactions t
   set merchant = left(m.clean_name, 120),
       category_id = coalesce(t.category_id, m.category_id)
  from matched m
 where m.id = t.id
   and (t.merchant is distinct from left(m.clean_name, 120)
        or (t.category_id is null and m.category_id is not null));
