-- The operator panel in detail (#/operator): an overview, each market's detail, a log of every
-- change the operator makes, bulk codes and revoking a single register. Restoran Kasa's yönetim
-- console (its 20261127120000_operator_console.sql) is the model, cut to what a market needs and
-- to what never restricts a shop.
--
-- 1. app.operator_log keeps every change made from the panel: who, what, which market, when.
--    The panel's existing writes (op_issue_code, op_revoke_code, op_extend_code and
--    op_set_market_status) are replaced with the same signatures and now write a line there.
-- 2. app.operator_market_info is the operator's own record of a market: a plan name, a date and a
--    private note. INFORMATION ONLY: no register, no owner and no sync function reads it, and
--    nothing in the app or on the server limits a market by it. There are no licences, no
--    device limits and no expiry here.
-- 3. The reads (op_overview, op_market, op_history and a richer op_list_markets) give counts and
--    totals only: how many sales and their sum, records per table, registers, staff. No synced
--    row leaves through them.
-- 4. The only new change to a shop is op_revoke_device: one register, by the operator, logged.
--    Suspending and activating a market are unchanged apart from the log line.
--
-- Live-safe and additive: two new tables, new functions, and `create or replace` of `op_*`
-- functions with their signatures and answers kept (op_list_markets and op_list_codes gain keys;
-- the old panel ignores them). `apply_op`, `sync_push`, `sync_pull`, `current_device`,
-- `claim_device`, `create_pairing`, `create_own_market`, `entity_tables` and `event_tables` are
-- not touched, and no existing table or row is changed. It runs top to bottom in the SQL editor
-- and can run again.

-- 1. The log.

/** Every change the operator makes from the panel, newest last. */
create table if not exists app.operator_log (
  id bigint generated always as identity primary key,
  operator_id uuid references auth.users (id) on delete set null,
  action text not null check (action ~ '^[a-z]+[.][a-z_]+$'),
  -- No foreign key: the line outlives anything it names.
  market_id text,
  details jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);
create index if not exists operator_log_by_market on app.operator_log (market_id, id desc);

/** The operator's own record of a market. Nothing but the operator panel reads it. */
create table if not exists app.operator_market_info (
  market_id text primary key references app.markets (id) on delete cascade,
  plan text check (plan is null or length(trim(plan)) between 1 and 40),
  -- A date the operator wants to remember (a paid period's end). Never enforced.
  plan_until date,
  note text check (note is null or length(note) between 1 and 2000),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

-- Defence in depth, as for every app table: no policy and no grant.
alter table app.operator_log enable row level security;
alter table app.operator_market_info enable row level security;
revoke all on app.operator_log, app.operator_market_info
  from public, anon, authenticated, service_role;

/** Writes one line of the operator's log, as the calling operator. */
create or replace function app.op_log(p_action text, p_market text, p_details jsonb)
returns void
language sql volatile set search_path = '' as $$
  insert into app.operator_log (operator_id, action, market_id, details)
  values (auth.uid(), p_action, p_market, coalesce(p_details, '{}'::jsonb))
$$;

-- 2. Counting helpers (read only).

/** Today in Turkey (UTC+3 all year) as a register writes businessDate: YYYY-MM-DD. */
create or replace function app.op_today() returns text
language sql stable set search_path = '' as $$
  select to_char((now() at time zone 'UTC') + interval '3 hours', 'YYYY-MM-DD')
$$;

/** The first business day of the last 30 days, today included. */
create or replace function app.op_month_start() returns text
language sql stable set search_path = '' as $$
  select to_char((now() at time zone 'UTC') + interval '3 hours' - interval '29 days', 'YYYY-MM-DD')
$$;

/**
 * A market's sales on or after the business day `p_from` (all of them when null), voided sales
 * left out: how many, and their totals added up in kuruş. A total that is not a number counts 0.
 */
create or replace function app.op_sales(p_market text, p_from text) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('count', count(*), 'total', coalesce(sum(
      case when jsonb_typeof(s.row -> 'total') = 'number' then (s.row ->> 'total')::numeric
      else 0 end), 0))
  from app.rows s
  where s.market_id = p_market and s.tbl = 'sales'
    and (p_from is null or s.row ->> 'businessDate' >= p_from)
    and not exists (
      select 1 from app.rows v
      where v.market_id = p_market and v.tbl = 'saleVoids' and v.row ->> 'saleId' = s.id)
$$;

/** When a market last reached the server: a register's last push, or the newest record taken. */
create or replace function app.op_last_sync(p_market text) returns timestamptz
language sql stable set search_path = '' as $$
  select nullif(greatest(
      coalesce((select max(d.last_seen_at) from app.devices d where d.market_id = p_market),
        '-infinity'),
      coalesce((select r.received_at from app.rows r where r.market_id = p_market
        order by r.server_seq desc limit 1), '-infinity')), '-infinity')
$$;

/** The moment of a market's newest sale, as the register wrote it (an ISO string), or null. */
create or replace function app.op_last_sale(p_market text) returns text
language sql stable set search_path = '' as $$
  select max(s.row ->> 'occurredAt') from app.rows s
  where s.market_id = p_market and s.tbl = 'sales'
$$;

/** People who work a market: how many are not archived, and how many are. */
create or replace function app.op_staff(p_market text) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'active', count(*) filter (where coalesce(s.row ->> 'archivedAt', '') = ''),
    'archived', count(*) filter (where coalesce(s.row ->> 'archivedAt', '') <> ''))
  from app.rows s
  where s.market_id = p_market and s.tbl = 'staff'
$$;

-- 3. Reads.

/**
 * The panel's first look: markets by state, codes by what became of them, registers, sales
 * today and over the last 30 days across every market, the unused codes ending within seven
 * days, the markets whose recorded plan date is near or just past (a reminder only), and the
 * active markets with registers that have not synced for seven days.
 */
create or replace function public.op_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today text := app.op_today();
  v_month text := app.op_month_start();
begin
  if not app.is_operator() then
    raise exception 'not_operator';
  end if;
  return jsonb_build_object(
    'markets', (
      select jsonb_build_object(
        'total', count(*),
        'active', count(*) filter (where m.status = 'active'),
        'suspended', count(*) filter (where m.status = 'suspended'),
        'new30', count(*) filter (where m.created_at > now() - interval '30 days'))
      from app.markets m),
    'codes', (
      select jsonb_build_object(
        'issued', count(*),
        'used', count(*) filter (where c.used_at is not null),
        'unused', count(*) filter (where c.used_at is null and c.revoked_at is null
          and c.expires_at > now()),
        'expired', count(*) filter (where c.used_at is null and c.revoked_at is null
          and c.expires_at <= now()),
        'revoked', count(*) filter (where c.used_at is null and c.revoked_at is not null))
      from app.activation_codes c),
    'devices', (
      select jsonb_build_object(
        'total', count(*),
        'seenToday', count(*) filter (where d.last_seen_at > now() - interval '1 day'))
      from app.devices d where d.revoked_at is null),
    'sales', (
      select jsonb_build_object(
        'today', jsonb_build_object(
          'count', coalesce(sum((t.today ->> 'count')::bigint), 0),
          'total', coalesce(sum((t.today ->> 'total')::numeric), 0)),
        'last30', jsonb_build_object(
          'count', coalesce(sum((t.last30 ->> 'count')::bigint), 0),
          'total', coalesce(sum((t.last30 ->> 'total')::numeric), 0)))
      from (
        select app.op_sales(m.id, v_today) as today, app.op_sales(m.id, v_month) as last30
        from app.markets m
      ) t),
    'expiringCodes', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'code', e.code, 'note', e.note, 'expiresAt', e.expires_at)
          order by e.expires_at, e.code), '[]'::jsonb)
      from (
        select c.code, c.note, c.expires_at from app.activation_codes c
        where c.used_at is null and c.revoked_at is null
          and c.expires_at > now() and c.expires_at <= now() + interval '7 days'
        order by c.expires_at, c.code
        limit 20
      ) e),
    'planDue', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'id', p.id, 'name', p.name, 'plan', p.plan, 'planUntil', p.plan_until)
          order by p.plan_until, p.id), '[]'::jsonb)
      from (
        select m.id, m.name, i.plan, i.plan_until
        from app.operator_market_info i join app.markets m on m.id = i.market_id
        where i.plan_until is not null
          and i.plan_until <= v_today::date + 7
          and i.plan_until >= v_today::date - 30
        order by i.plan_until, m.id
        limit 20
      ) p),
    'quiet', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'id', q.id, 'name', q.name, 'lastSyncAt', q.last_sync)
          order by q.last_sync nulls first, q.id), '[]'::jsonb)
      from (
        select m.id, m.name, app.op_last_sync(m.id) as last_sync
        from app.markets m
        where m.status = 'active'
          and exists (select 1 from app.devices d where d.market_id = m.id and d.revoked_at is null)
          and coalesce(app.op_last_sync(m.id), '-infinity') < now() - interval '7 days'
        order by 3 nulls first, m.id
        limit 20
      ) q));
end
$$;

/**
 * Every market, newest first: status, when it was opened and activated, its registers that are
 * not revoked, when it last synced, its owner's email, and (new) its staff, its sales over the
 * last 30 days, its newest sale and the operator's plan record. Counts and totals only.
 */
create or replace function public.op_list_markets() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_month text := app.op_month_start();
begin
  if not app.is_operator() then
    raise exception 'not_operator';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', m.id, 'name', m.name, 'status', m.status, 'createdAt', m.created_at,
        'activatedAt', m.activated_at, 'activationCode', m.activation_code,
        'devices', d.active,
        'lastSyncAt', app.op_last_sync(m.id),
        'ownerEmail', o.email,
        'staff', (app.op_staff(m.id) ->> 'active')::int,
        'sales30', app.op_sales(m.id, v_month),
        'lastSaleAt', app.op_last_sale(m.id),
        'plan', i.plan, 'planUntil', i.plan_until)
        order by m.created_at desc, m.id), '[]'::jsonb)
    from app.markets m
    cross join lateral (
      select count(*) filter (where dv.revoked_at is null)::int as active
      from app.devices dv where dv.market_id = m.id
    ) d
    left join lateral (
      select u.email from app.memberships ms join auth.users u on u.id = ms.user_id
      where ms.market_id = m.id and ms.role = 'owner'
      order by u.email limit 1
    ) o on true
    left join app.operator_market_info i on i.market_id = m.id);
end
$$;

/**
 * One market as the operator looks after it: who owns and manages it, the code that opened it,
 * its registers (live first, at most 100), its staff, records per table and their size, its
 * sales (today, 30 days, all time) with voids and returns over 30 days, its last sync and sale,
 * and the operator's plan record and note. Counts and totals only: no synced row leaves here.
 */
create or replace function public.op_market(market_id text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_market app.markets;
  v_month text := app.op_month_start();
begin
  if not app.is_operator() then
    raise exception 'not_operator';
  end if;
  select * into v_market from app.markets m where m.id = op_market.market_id;
  if not found then
    raise exception 'market_not_found';
  end if;
  return jsonb_build_object(
    'id', v_market.id, 'name', v_market.name, 'status', v_market.status,
    'createdAt', v_market.created_at, 'activatedAt', v_market.activated_at,
    'activationCode', v_market.activation_code,
    'code', (
      select jsonb_build_object('note', c.note, 'createdAt', c.created_at, 'usedAt', c.used_at)
      from app.activation_codes c where c.code = v_market.activation_code),
    'people', (
      select coalesce(jsonb_agg(jsonb_build_object('email', u.email, 'role', ms.role)
          order by ms.role = 'manager', u.email), '[]'::jsonb)
      from app.memberships ms join auth.users u on u.id = ms.user_id
      where ms.market_id = v_market.id),
    'devices', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'id', d.id, 'code', d.code, 'name', d.name, 'platform', d.platform,
          'createdAt', d.created_at, 'lastSeenAt', d.last_seen_at, 'revokedAt', d.revoked_at)
          order by d.revoked_at is not null, d.created_at, d.code), '[]'::jsonb)
      from (
        select * from app.devices dv
        where dv.market_id = v_market.id
        order by dv.revoked_at is not null, dv.created_at, dv.code
        limit 100
      ) d),
    'staff', app.op_staff(v_market.id),
    'rowCounts', (
      select coalesce(jsonb_agg(jsonb_build_object('table', c.tbl, 'count', c.n)
          order by c.tbl), '[]'::jsonb)
      from (
        select r.tbl, count(*) as n from app.rows r
        where r.market_id = v_market.id
        group by r.tbl order by r.tbl limit 50
      ) c),
    'bytes', (
      select coalesce(sum(pg_column_size(r.row)), 0) from app.rows r
      where r.market_id = v_market.id),
    'lastSyncAt', app.op_last_sync(v_market.id),
    'lastSaleAt', app.op_last_sale(v_market.id),
    'sales', jsonb_build_object(
      'today', app.op_sales(v_market.id, app.op_today()),
      'last30', app.op_sales(v_market.id, v_month),
      'all', app.op_sales(v_market.id, null)),
    'voids30', (
      select count(*) from app.rows v
      where v.market_id = v_market.id and v.tbl = 'saleVoids'
        and v.row ->> 'businessDate' >= v_month),
    'returns30', (
      select jsonb_build_object('count', count(*), 'total', coalesce(sum(
          case when jsonb_typeof(r.row -> 'amount') = 'number' then (r.row ->> 'amount')::numeric
          else 0 end), 0))
      from app.rows r
      where r.market_id = v_market.id and r.tbl = 'returns'
        and r.row ->> 'businessDate' >= v_month),
    'activeDevices30', (
      select count(*) from app.devices d
      where d.market_id = v_market.id and d.revoked_at is null
        and d.last_seen_at > now() - interval '30 days'),
    'info', (
      select jsonb_build_object(
        'plan', i.plan, 'planUntil', i.plan_until, 'note', i.note, 'updatedAt', i.updated_at)
      from app.operator_market_info i where i.market_id = v_market.id));
end
$$;

/**
 * The operator's log, newest first: at most `lim` (1–200) lines older than `before_id` when one
 * is given, and only one market's when `market_id` is.
 */
create or replace function public.op_history(lim integer, before_id bigint, market_id text)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_operator() then
    raise exception 'not_operator';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', l.id, 'at', l.at, 'action', l.action, 'marketId', l.market_id,
        'marketName', mk.name, 'operatorEmail', u.email, 'details', l.details)
        order by l.id desc), '[]'::jsonb)
    from (
      select * from app.operator_log ol
      where (op_history.before_id is null or ol.id < op_history.before_id)
        and (op_history.market_id is null or ol.market_id = op_history.market_id)
      order by ol.id desc
      limit least(greatest(coalesce(lim, 50), 1), 200)
    ) l
    left join app.markets mk on mk.id = l.market_id
    left join auth.users u on u.id = l.operator_id);
end
$$;

/**
 * The latest 500 codes, newest first, each with its status (used, revoked, expired or unused),
 * the market it opened and (new) the email of the account that used it.
 */
create or replace function public.op_list_codes() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_operator() then
    raise exception 'not_operator';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
        'code', c.code, 'note', c.note, 'createdAt', c.created_at, 'expiresAt', c.expires_at,
        'usedAt', c.used_at, 'revokedAt', c.revoked_at,
        'status', case
          when c.used_at is not null then 'used'
          when c.revoked_at is not null then 'revoked'
          when c.expires_at <= now() then 'expired'
          else 'unused' end,
        'marketId', m.id, 'marketName', m.name, 'usedByEmail', u.email)
        order by c.created_at desc, c.code), '[]'::jsonb)
    from (
      select * from app.activation_codes
      order by created_at desc, code
      limit 500
    ) c
    left join app.markets m on m.activation_code = c.code
    left join auth.users u on u.id = c.used_by);
end
$$;

-- 4. Writes. Each answers only an operator and writes a line of the log.

/** A new, unused code for the shop the note names, valid for `days` (1–365) days. */
create or replace function public.op_issue_code(note text, days integer) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_code text;
begin
  if not app.is_operator() then
    raise exception 'not_operator';
  end if;
  v_code := app.issue_activation_code(op_issue_code.note, op_issue_code.days);
  perform app.op_log('code.issue', null, jsonb_build_object(
    'count', 1, 'days', op_issue_code.days, 'note', trim(op_issue_code.note),
    'codes', jsonb_build_array(v_code)));
  return v_code;
end
$$;

/** `count` (1–50) new codes at once for one note and validity; returns them in order. */
create or replace function public.op_issue_codes(note text, days integer, count integer)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_codes jsonb := '[]'::jsonb;
begin
  if not app.is_operator() then
    raise exception 'not_operator';
  end if;
  if op_issue_codes.count is null or op_issue_codes.count not between 1 and 50 then
    raise exception 'bad_count';
  end if;
  for i in 1..op_issue_codes.count loop
    v_codes := v_codes || jsonb_build_array(
      app.issue_activation_code(op_issue_codes.note, op_issue_codes.days));
  end loop;
  perform app.op_log('code.issue', null, jsonb_build_object(
    'count', op_issue_codes.count, 'days', op_issue_codes.days,
    'note', trim(op_issue_codes.note), 'codes', v_codes));
  return v_codes;
end
$$;

/** Retires a code no one has used yet; it then opens nothing (activation_invalid). */
create or replace function public.op_revoke_code(code text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_code app.activation_codes;
begin
  if not app.is_operator() then
    raise exception 'not_operator';
  end if;
  select * into v_code from app.activation_codes c
  where c.code = app.canonical_activation_code(op_revoke_code.code)
  for update;
  if not found then
    raise exception 'code_not_found';
  end if;
  if v_code.used_at is not null then
    raise exception 'code_used';
  end if;
  update app.activation_codes c set revoked_at = coalesce(c.revoked_at, now())
  where c.code = v_code.code;
  perform app.op_log('code.revoke', null, jsonb_build_object(
    'code', v_code.code, 'note', v_code.note));
end
$$;

/**
 * Adds `days` (1–365) to an unused code: from its end while it runs, from now once it has
 * expired. A used or revoked code is refused.
 */
create or replace function public.op_extend_code(code text, days integer) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_code app.activation_codes;
  v_before timestamptz;
begin
  if not app.is_operator() then
    raise exception 'not_operator';
  end if;
  if op_extend_code.days is null or op_extend_code.days not between 1 and 365 then
    raise exception 'bad_days';
  end if;
  select * into v_code from app.activation_codes c
  where c.code = app.canonical_activation_code(op_extend_code.code)
  for update;
  if not found then
    raise exception 'code_not_found';
  end if;
  if v_code.used_at is not null then
    raise exception 'code_used';
  end if;
  if v_code.revoked_at is not null then
    raise exception 'code_revoked';
  end if;
  v_before := v_code.expires_at;
  update app.activation_codes c
  set expires_at = greatest(now(), c.expires_at) + op_extend_code.days * interval '1 day'
  where c.code = v_code.code
  returning * into v_code;
  perform app.op_log('code.extend', null, jsonb_build_object(
    'code', v_code.code, 'days', op_extend_code.days, 'from', v_before, 'to', v_code.expires_at));
  return jsonb_build_object('code', v_code.code, 'expiresAt', v_code.expires_at);
end
$$;

/**
 * Suspends a market (its registers are refused until it is active again; they keep selling
 * offline) or activates it. Only `active` and `suspended`.
 */
create or replace function public.op_set_market_status(market_id text, status text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_before text;
begin
  if not app.is_operator() then
    raise exception 'not_operator';
  end if;
  if op_set_market_status.status is null
    or op_set_market_status.status not in ('active', 'suspended') then
    raise exception 'bad_status';
  end if;
  select m.status into v_before from app.markets m
  where m.id = op_set_market_status.market_id
  for update;
  if not found then
    raise exception 'market_not_found';
  end if;
  update app.markets m set status = op_set_market_status.status
  where m.id = op_set_market_status.market_id;
  perform app.op_log('market.status', op_set_market_status.market_id, jsonb_build_object(
    'from', v_before, 'to', op_set_market_status.status));
end
$$;

/**
 * Shuts one register out of its market, as its owner can: its next sync is refused
 * (device_revoked) and it can be paired again. Its records stay on the device and the server.
 */
create or replace function public.op_revoke_device(device_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_device app.devices;
begin
  if not app.is_operator() then
    raise exception 'not_operator';
  end if;
  select * into v_device from app.devices d where d.id = op_revoke_device.device_id;
  if not found then
    raise exception 'device_not_found';
  end if;
  if v_device.revoked_at is not null then
    raise exception 'device_revoked';
  end if;
  -- The market's lock, as sync_push takes it: a push waiting on it sees the change.
  perform app.lock_market(v_device.market_id);
  update app.devices d set revoked_at = coalesce(d.revoked_at, now())
  where d.id = v_device.id;
  perform app.op_log('device.revoke', v_device.market_id, jsonb_build_object(
    'deviceId', v_device.id, 'code', v_device.code, 'name', v_device.name));
end
$$;

/**
 * Records a plan name (1–40 characters, or empty for none) and a date (within ten years of
 * today, or null) for a market, for the operator's eyes only. Nothing reads it to limit the
 * market.
 */
create or replace function public.op_set_market_plan(market_id text, plan text, plan_until date)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_plan text := nullif(trim(coalesce(op_set_market_plan.plan, '')), '');
  v_before app.operator_market_info;
begin
  if not app.is_operator() then
    raise exception 'not_operator';
  end if;
  if length(v_plan) > 40 then
    raise exception 'bad_plan';
  end if;
  if op_set_market_plan.plan_until is not null and (
    op_set_market_plan.plan_until < current_date - 3660
    or op_set_market_plan.plan_until > current_date + 3660) then
    raise exception 'bad_date';
  end if;
  if not exists (select 1 from app.markets m where m.id = op_set_market_plan.market_id) then
    raise exception 'market_not_found';
  end if;
  select * into v_before from app.operator_market_info i
  where i.market_id = op_set_market_plan.market_id
  for update;
  insert into app.operator_market_info (market_id, plan, plan_until, updated_by)
  values (op_set_market_plan.market_id, v_plan, op_set_market_plan.plan_until, auth.uid())
  on conflict on constraint operator_market_info_pkey do update
    set plan = excluded.plan, plan_until = excluded.plan_until,
      updated_by = excluded.updated_by, updated_at = now();
  delete from app.operator_market_info i
  where i.market_id = op_set_market_plan.market_id
    and i.plan is null and i.plan_until is null and i.note is null;
  perform app.op_log('market.plan', op_set_market_plan.market_id, jsonb_build_object(
    'from', jsonb_build_object('plan', v_before.plan, 'until', v_before.plan_until),
    'to', jsonb_build_object('plan', v_plan, 'until', op_set_market_plan.plan_until)));
  return jsonb_build_object('plan', v_plan, 'planUntil', op_set_market_plan.plan_until);
end
$$;

/** Keeps the operator's note on a market (at most 2000 characters); empty removes it. */
create or replace function public.op_set_market_note(market_id text, note text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_note text := nullif(trim(coalesce(op_set_market_note.note, '')), '');
begin
  if not app.is_operator() then
    raise exception 'not_operator';
  end if;
  if length(v_note) > 2000 then
    raise exception 'note_too_long';
  end if;
  if not exists (select 1 from app.markets m where m.id = op_set_market_note.market_id) then
    raise exception 'market_not_found';
  end if;
  insert into app.operator_market_info (market_id, note, updated_by)
  values (op_set_market_note.market_id, v_note, auth.uid())
  on conflict on constraint operator_market_info_pkey do update
    set note = excluded.note, updated_by = excluded.updated_by, updated_at = now();
  delete from app.operator_market_info i
  where i.market_id = op_set_market_note.market_id
    and i.plan is null and i.plan_until is null and i.note is null;
  perform app.op_log('market.note', op_set_market_note.market_id, jsonb_build_object(
    'length', coalesce(length(v_note), 0)));
end
$$;

-- 5. Who may run what. The helpers in `app` reach no client role; every op_* function only
-- `authenticated`, and each refuses anyone who is not an operator.

revoke execute on function app.op_log(text, text, jsonb) from public, anon, authenticated, service_role;
revoke execute on function app.op_today() from public, anon, authenticated, service_role;
revoke execute on function app.op_month_start() from public, anon, authenticated, service_role;
revoke execute on function app.op_sales(text, text) from public, anon, authenticated, service_role;
revoke execute on function app.op_last_sync(text) from public, anon, authenticated, service_role;
revoke execute on function app.op_last_sale(text) from public, anon, authenticated, service_role;
revoke execute on function app.op_staff(text) from public, anon, authenticated, service_role;

revoke execute on function public.op_overview() from public, anon, service_role;
revoke execute on function public.op_list_markets() from public, anon, service_role;
revoke execute on function public.op_market(text) from public, anon, service_role;
revoke execute on function public.op_history(integer, bigint, text) from public, anon, service_role;
revoke execute on function public.op_list_codes() from public, anon, service_role;
revoke execute on function public.op_issue_code(text, integer) from public, anon, service_role;
revoke execute on function public.op_issue_codes(text, integer, integer)
  from public, anon, service_role;
revoke execute on function public.op_revoke_code(text) from public, anon, service_role;
revoke execute on function public.op_extend_code(text, integer) from public, anon, service_role;
revoke execute on function public.op_set_market_status(text, text)
  from public, anon, service_role;
revoke execute on function public.op_revoke_device(uuid) from public, anon, service_role;
revoke execute on function public.op_set_market_plan(text, text, date)
  from public, anon, service_role;
revoke execute on function public.op_set_market_note(text, text) from public, anon, service_role;

grant execute on function public.op_overview() to authenticated;
grant execute on function public.op_list_markets() to authenticated;
grant execute on function public.op_market(text) to authenticated;
grant execute on function public.op_history(integer, bigint, text) to authenticated;
grant execute on function public.op_list_codes() to authenticated;
grant execute on function public.op_issue_code(text, integer) to authenticated;
grant execute on function public.op_issue_codes(text, integer, integer) to authenticated;
grant execute on function public.op_revoke_code(text) to authenticated;
grant execute on function public.op_extend_code(text, integer) to authenticated;
grant execute on function public.op_set_market_status(text, text) to authenticated;
grant execute on function public.op_revoke_device(uuid) to authenticated;
grant execute on function public.op_set_market_plan(text, text, date) to authenticated;
grant execute on function public.op_set_market_note(text, text) to authenticated;
