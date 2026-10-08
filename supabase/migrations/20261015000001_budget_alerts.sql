-- Phase 5: budget alerts by web push.
--   * push_subscriptions: one row per phone/browser that turned alerts on.
--   * budget_alerts: which alerts went out, so each category gets its 80% and
--     100% alert at most once per calendar month (Sydney time).
--   * private.push_keys: the VAPID key pair push services use to check the
--     alerts really come from this app. scripts/setup.mjs creates it on the
--     first deploy and hands it to the build, so nobody has to generate keys.
--   * claim_budget_alerts(): called after anything that adds or recategorises
--     spending; records the alerts that are due and returns who to send them to.

create table public.push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  member_id     uuid not null,
  endpoint      text not null unique check (endpoint ~ '^https://' and length(endpoint) <= 1000),
  p256dh        text not null check (length(p256dh) <= 200),
  auth          text not null check (length(auth) <= 100),
  label         text check (length(label) <= 80),
  created_at    timestamptz not null default now(),
  foreign key (household_id, member_id)
    references public.members (household_id, id) on delete cascade
);
create index push_subscriptions_household_idx on public.push_subscriptions (household_id);

create table public.budget_alerts (
  household_id  uuid not null references public.households (id) on delete cascade,
  category_id   uuid not null,
  month         date not null,
  threshold     integer not null check (threshold in (80, 100)),
  spent_cents   bigint not null,
  budget_cents  bigint not null,
  sent_at       timestamptz not null default now(),
  primary key (category_id, month, threshold),
  foreign key (household_id, category_id)
    references public.categories (household_id, id) on delete cascade
);

-- Readable by the household (Settings lists who has alerts on); written only
-- through the functions below.
alter table public.push_subscriptions enable row level security;
alter table public.budget_alerts enable row level security;
revoke all on public.push_subscriptions, public.budget_alerts from anon;
revoke insert, update, delete on public.push_subscriptions, public.budget_alerts from authenticated;
create policy push_subscriptions_select on public.push_subscriptions for select to authenticated
  using (household_id in (select private.my_household_ids()));
create policy budget_alerts_select on public.budget_alerts for select to authenticated
  using (household_id in (select private.my_household_ids()));

-- Never reachable through the API: only the build (with the database URL)
-- reads it. One row.
create table private.push_keys (
  id           boolean primary key default true check (id),
  public_key   text not null,
  private_key  text not null,
  created_at   timestamptz not null default now()
);
revoke all on private.push_keys from public, anon, authenticated;
-- Belt and braces (and no "table without RLS" warning in the SQL Editor):
-- with no policies the API roles see nothing; the build connects as the
-- table's owner, which RLS doesn't apply to.
alter table private.push_keys enable row level security;

-- ---------------------------------------------------------------------------
-- save_push_subscription: the signed-in user's browser turned alerts on.
-- A browser that was someone else's before (shared iPad) moves to this user.
-- ---------------------------------------------------------------------------
create function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_label text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member_id uuid;
  v_household_id uuid;
  v_id uuid;
begin
  select m.id, m.household_id into v_member_id, v_household_id
    from public.members m where m.user_id = auth.uid();
  if v_member_id is null then
    raise exception 'You''re not in a household yet' using errcode = '28000';
  end if;

  insert into public.push_subscriptions (household_id, member_id, endpoint, p256dh, auth, label)
  values (v_household_id, v_member_id, p_endpoint, p_p256dh, p_auth, nullif(left(trim(coalesce(p_label, '')), 80), ''))
  on conflict (endpoint) do update
    set household_id = excluded.household_id, member_id = excluded.member_id,
        p256dh = excluded.p256dh, auth = excluded.auth, label = excluded.label
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.save_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- forget_push_subscription: alerts turned off, or the push service says the
-- subscription is gone. The endpoint is a long unguessable URL only the
-- browser and this app know, so knowing it is enough to remove it; that lets
-- /api/ingest (no user session) prune dead ones too.
-- ---------------------------------------------------------------------------
create function public.forget_push_subscription(p_endpoint text) returns boolean
language sql
security definer
set search_path = ''
as $$
  with gone as (delete from public.push_subscriptions where endpoint = p_endpoint returning 1)
  select exists (select 1 from gone)
$$;
revoke all on function public.forget_push_subscription(text) from public;
grant execute on function public.forget_push_subscription(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- claim_budget_alerts: for the caller's household (the signed-in user's, or
-- the device token's when called from /api/ingest), works out which budgets
-- this month have reached 80% or 100% without an alert yet, records them, and
-- returns them with the household's push subscriptions:
--   { alerts: [{ category_id, category, threshold, spent_cents, budget_cents }],
--     subscriptions: [{ endpoint, p256dh, auth }] }
-- Each category reports only its highest new threshold (jumping from 50% to
-- 110% sends "over budget", not both). Nothing is recorded while nobody has
-- alerts on, so turning them on mid-month still tells you where you stand.
-- ---------------------------------------------------------------------------
create function public.claim_budget_alerts(p_token_hash text default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household_id uuid;
  v_month date := date_trunc('month', now() at time zone 'Australia/Sydney')::date;
  v_alerts jsonb;
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

  if not exists (select 1 from public.push_subscriptions where household_id = v_household_id) then
    return jsonb_build_object('alerts', '[]'::jsonb, 'subscriptions', '[]'::jsonb);
  end if;

  with spend as (
    select c.id, c.monthly_budget_cents as budget,
           coalesce((
             select -sum(t.amount_cents)
               from public.transactions t
              where t.household_id = v_household_id
                and t.category_id = c.id
                and t.occurred_at >= (v_month::timestamp at time zone 'Australia/Sydney')
                and t.occurred_at <  ((v_month + interval '1 month')::timestamp at time zone 'Australia/Sydney')
           ), 0) as spent
      from public.categories c
     where c.household_id = v_household_id
       and c.counts_as_spending
       and c.monthly_budget_cents > 0
  ), claimed as (
    insert into public.budget_alerts (household_id, category_id, month, threshold, spent_cents, budget_cents)
    select v_household_id, s.id, v_month, th.pct, s.spent, s.budget
      from spend s
     cross join (values (80), (100)) as th (pct)
     where s.spent * 100 >= s.budget * th.pct
    on conflict do nothing
    returning category_id, threshold, spent_cents, budget_cents
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'category_id', x.category_id, 'category', c.name, 'threshold', x.threshold,
           'spent_cents', x.spent_cents, 'budget_cents', x.budget_cents) order by c.sort, c.name), '[]'::jsonb)
    into v_alerts
    from (select distinct on (category_id) * from claimed order by category_id, threshold desc) x
    join public.categories c on c.id = x.category_id;

  return jsonb_build_object(
    'alerts', v_alerts,
    'subscriptions', case when jsonb_array_length(v_alerts) = 0 then '[]'::jsonb else (
      select coalesce(jsonb_agg(jsonb_build_object('endpoint', p.endpoint, 'p256dh', p.p256dh, 'auth', p.auth)), '[]'::jsonb)
        from public.push_subscriptions p where p.household_id = v_household_id
    ) end
  );
end;
$$;
revoke all on function public.claim_budget_alerts(text) from public;
grant execute on function public.claim_budget_alerts(text) to anon, authenticated;
