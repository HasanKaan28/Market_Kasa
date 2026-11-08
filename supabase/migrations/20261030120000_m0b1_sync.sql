-- M0b-1: markets, registers and the sync store (docs/v2/plans/2026-10-30-m0b1-sunucu-esitleme.md).
--
-- Every record a register writes is kept as the JSON it sent, in app.rows, under the same rules
-- as the fake server in src/sync/fakeServer.ts. The app schema is not exposed to the Data API and
-- the client roles hold no privilege in it: registers reach it only through the public functions
-- at the end of this file, each of which checks who is calling.

create schema if not exists app;
revoke all on schema app from public;

create table app.markets (
  id text primary key check (id ~ '^[a-z0-9-]{1,64}$'),
  name text not null check (length(trim(name)) between 1 and 60),
  status text not null default 'active' check (status in ('active', 'suspended')),
  license_expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table app.memberships (
  market_id text not null references app.markets (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'manager')),
  primary key (market_id, user_id)
);

create table app.devices (
  id uuid primary key,
  market_id text not null references app.markets (id) on delete cascade,
  auth_user_id uuid not null unique references auth.users (id) on delete cascade,
  code text not null check (code ~ '^[A-Z][A-Z0-9]{0,3}$'),
  name text not null check (length(trim(name)) between 1 and 60),
  platform text not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  revoked_at timestamptz
);
-- A revoked register gives its code back.
create unique index devices_code_in_market on app.devices (market_id, code) where revoked_at is null;

-- server_seq grows with every change to any row; a market's writes take its lock first, so within
-- a market the sequence follows commit order and a pull cursor never passes a row still to come.
create sequence app.server_seq;

create table app.rows (
  market_id text not null references app.markets (id) on delete cascade,
  tbl text not null,
  id text not null,
  server_seq bigint not null,
  row jsonb not null,
  received_at timestamptz not null default now(),
  primary key (market_id, tbl, id)
);
create index rows_by_seq on app.rows (market_id, server_seq);

create table app.applied_ops (
  market_id text not null references app.markets (id) on delete cascade,
  op_id text not null,
  primary key (market_id, op_id)
);

-- Defence in depth: no policy, so a role that somehow reached these tables would read nothing.
alter table app.markets enable row level security;
alter table app.memberships enable row level security;
alter table app.devices enable row level security;
alter table app.rows enable row level security;
alter table app.applied_ops enable row level security;

-- The tables a register syncs (src/data/types.ts OutboxTable). Entities are patched field by
-- field; events are written once and never change.
create function app.entity_tables() returns text[] language sql immutable as $$
  select array['products', 'customers', 'categories', 'suppliers', 'staff', 'settings', 'invoices']
$$;

create function app.event_tables() returns text[] language sql immutable as $$
  select array['sales', 'stockMovements', 'ledger', 'saleVoids', 'returns', 'purchases',
    'stockCounts', 'supplierLedger', 'cashMovements', 'cashSessions', 'auditLog']
$$;

create function app.lock_market(p_market text) returns void language sql as $$
  select pg_advisory_xact_lock(hashtext('market:' || p_market))
$$;

/** The register the caller signed in as; raises when there is none or it was revoked. */
create function app.current_device() returns app.devices language plpgsql stable as $$
declare
  v_device app.devices;
begin
  select * into v_device from app.devices where auth_user_id = auth.uid();
  if not found then
    raise exception 'device_not_registered';
  end if;
  if v_device.revoked_at is not null then
    raise exception 'device_revoked';
  end if;
  return v_device;
end
$$;

/** Gives a record a new sequence, so every register pulls its current row again. */
create function app.resend(p_market text, p_table text, p_id text) returns void language sql as $$
  update app.rows set server_seq = nextval('app.server_seq')
  where market_id = p_market and tbl = p_table and id = p_id
$$;

/** Barcodes are kept in capitals, as the registers store them (canonicalBarcode). */
create function app.normalized(p_table text, p_row jsonb) returns jsonb language sql immutable as $$
  select case
    when p_table = 'products' and jsonb_typeof(p_row -> 'barcode') = 'string'
      then jsonb_set(p_row, '{barcode}', to_jsonb(upper(trim(p_row ->> 'barcode'))))
    else p_row
  end
$$;

/**
 * Where two products of a market hold one barcode, the smallest id keeps it and the others lose
 * it. The winner is sent again: a register may have taken the barcode off it while its losing
 * edit was pending.
 */
create function app.settle_barcode(p_market text, p_barcode text) returns void
language plpgsql as $$
declare
  v_winner text;
begin
  if p_barcode is null then
    return;
  end if;
  -- A live product beats a deleted one, as on the registers (claimBarcode).
  select id into v_winner from app.rows
  where market_id = p_market and tbl = 'products' and row ->> 'barcode' = p_barcode
  order by (row ? 'deletedAt'), id collate "C" limit 1;
  if not exists (
    select 1 from app.rows
    where market_id = p_market and tbl = 'products' and row ->> 'barcode' = p_barcode
      and id <> v_winner
  ) then
    return;
  end if;
  update app.rows set row = row - 'barcode', server_seq = nextval('app.server_seq')
  where market_id = p_market and tbl = 'products' and row ->> 'barcode' = p_barcode
    and id <> v_winner;
  perform app.resend(p_market, 'products', v_winner);
end
$$;

/** Applies one queued operation; returns null when applied, else why it was refused. */
create function app.apply_op(p_market text, p_op jsonb) returns text language plpgsql as $$
declare
  v_table text := p_op ->> 'table';
  v_id text := p_op ->> 'recordId';
  v_kind text := p_op ->> 'kind';
  v_fields jsonb;
  v_row jsonb;
begin
  if v_table is null or not (v_table = any (app.entity_tables() || app.event_tables())) then
    return 'unknown_table';
  end if;
  if v_id is null or v_id = '' then
    return 'bad_record';
  end if;

  if v_kind not in ('insert', 'patch') then
    return 'unknown_kind';
  end if;
  if v_kind = 'patch' and not (v_table = any (app.entity_tables())) then
    return 'not_patchable';
  end if;
  v_fields := p_op -> (case v_kind when 'insert' then 'record' else 'patch' end);
  if jsonb_typeof(v_fields) is distinct from 'object' then
    return 'bad_record';
  end if;

  select row into v_row from app.rows
  where market_id = p_market and tbl = v_table and id = v_id
  for update;
  if not found then
    if v_kind = 'patch' then
      -- A patch for a record the server never received changes nothing, as on the fake server.
      return null;
    end if;
    insert into app.rows (market_id, tbl, id, server_seq, row)
    values (p_market, v_table, v_id, nextval('app.server_seq'), app.normalized(v_table, v_fields));
  elsif v_table = any (app.event_tables()) then
    -- An event is written once; a second copy of it changes nothing.
    return null;
  else
    -- A patch, or a second insert of an entity (two registers saving the same fixed-id record
    -- offline): merged field by field, so the later arrival wins each field it sends.
    -- A null field clears it; every other field replaces the stored one.
    v_row := (v_row || coalesce(
        (select jsonb_object_agg(key, value) from jsonb_each(v_fields) where value <> 'null'::jsonb),
        '{}'::jsonb))
      - coalesce(
        (select array_agg(key) from jsonb_each(v_fields) where value = 'null'::jsonb),
        array[]::text[]);
    v_row := app.normalized(v_table, v_row);
    update app.rows set row = v_row, server_seq = nextval('app.server_seq'), received_at = now()
    where market_id = p_market and tbl = v_table and id = v_id;
  end if;

  if v_table = 'products' then
    perform app.settle_barcode(p_market, (
      select row ->> 'barcode' from app.rows
      where market_id = p_market and tbl = 'products' and id = v_id));
  end if;
  return null;
end
$$;

revoke all on all tables in schema app from public, anon, authenticated;
revoke all on all sequences in schema app from public, anon, authenticated;
revoke execute on all functions in schema app from public, anon, authenticated;

/**
 * Applies a register's queued operations in order. Each operation is applied once per opId; one
 * that is refused is reported and its record sent again, so the register's value reverts.
 */
create function public.sync_push(ops jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_device app.devices := app.current_device();
  v_op jsonb;
  v_reason text;
  v_acknowledged jsonb := '[]'::jsonb;
  v_rejected jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(ops) is distinct from 'array' then
    raise exception 'bad_request';
  end if;
  perform app.lock_market(v_device.market_id);
  for v_op in select value from jsonb_array_elements(ops) loop
    if jsonb_typeof(v_op -> 'opId') is distinct from 'string' then
      v_reason := 'bad_op';
    elsif exists (
      select 1 from app.applied_ops where market_id = v_device.market_id and op_id = v_op ->> 'opId'
    ) then
      v_reason := null;
      -- A retry of an edit whose answer was lost. The register has kept replaying it over newer
      -- rows from other registers; sending the record again gives it the current value.
      if (v_op ->> 'table') = any (app.entity_tables()) then
        perform app.resend(v_device.market_id, v_op ->> 'table', v_op ->> 'recordId');
      end if;
    else
      v_reason := app.apply_op(v_device.market_id, v_op);
      if v_reason is null then
        insert into app.applied_ops (market_id, op_id) values (v_device.market_id, v_op ->> 'opId');
      else
        perform app.resend(v_device.market_id, v_op ->> 'table', v_op ->> 'recordId');
      end if;
    end if;
    if jsonb_typeof(v_op -> 'seq') = 'number' then
      if v_reason is null then
        v_acknowledged := v_acknowledged || jsonb_build_array(v_op -> 'seq');
      else
        v_rejected := v_rejected || jsonb_build_array(
          jsonb_build_object('seq', v_op -> 'seq', 'reason', v_reason));
      end if;
    end if;
  end loop;
  update app.devices set last_seen_at = now() where id = v_device.id;
  return jsonb_build_object('acknowledged', v_acknowledged)
    || case when jsonb_array_length(v_rejected) > 0
         then jsonb_build_object('rejected', v_rejected) else '{}'::jsonb end;
end
$$;

/** The market's rows changed after `since`, in sequence order, at most `lim` (1–1000) of them. */
create function public.sync_pull(since bigint, lim integer) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_device app.devices := app.current_device();
  v_since bigint := greatest(coalesce(since, 0), 0);
  v_rows jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
      'table', page.tbl, 'id', page.id, 'serverSeq', page.server_seq, 'row', page.row)
      order by page.server_seq), '[]'::jsonb)
  into v_rows
  from (
    select tbl, id, server_seq, row from app.rows
    where market_id = v_device.market_id and server_seq > v_since
    order by server_seq
    limit least(greatest(coalesce(lim, 1), 1), 1000)
  ) page;
  return jsonb_build_object(
    'rows', v_rows,
    'latest', coalesce(
      (select max((item ->> 'serverSeq')::bigint) from jsonb_array_elements(v_rows) item),
      v_since));
end
$$;

revoke execute on function public.sync_push(jsonb) from public, anon;
revoke execute on function public.sync_pull(bigint, integer) from public, anon;
grant execute on function public.sync_push(jsonb) to authenticated;
grant execute on function public.sync_pull(bigint, integer) to authenticated;

-- Pairing a register to its market (DESIGN §8.2). The owner signs in on the register, asks for
-- a one-time code, and the register's own anonymous session claims it. No secret leaves the
-- server and the owner's session is never kept on the register.

create table app.pairings (
  code text primary key,
  market_id text not null references app.markets (id) on delete cascade,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
alter table app.pairings enable row level security;
revoke all on app.pairings from public, anon, authenticated;

/** True when the caller signed in with a password (not anonymously) and owns the market. */
create function app.is_owner(p_market text) returns boolean language sql stable as $$
  select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is false
    and exists (
      select 1 from app.memberships
      where market_id = p_market and user_id = auth.uid() and role = 'owner')
$$;

/** The markets the caller owns, for the pairing screen. */
create function public.owner_markets() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name) order by m.name), '[]')
  from app.markets m
  join app.memberships ms on ms.market_id = m.id
  where ms.user_id = auth.uid() and ms.role = 'owner'
    and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is false
$$;

/** A one-time code, good for ten minutes, that binds one register to this market. */
create function public.create_pairing(market_id text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  -- No 0/O or 1/I: the code is read out loud or typed from another screen.
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text;
begin
  if not app.is_owner(market_id) then
    raise exception 'not_owner';
  end if;
  loop
    v_code := (
      select string_agg(substr(v_alphabet, 1 + floor(random() * 32)::int, 1), '')
      from generate_series(1, 8));
    exit when not exists (select 1 from app.pairings where code = v_code);
  end loop;
  insert into app.pairings (code, market_id, created_by, expires_at)
  values (v_code, market_id, auth.uid(), now() + interval '10 minutes');
  return v_code;
end
$$;

/** Binds the caller's session to the market the code was made for, as a new register. */
create function public.claim_device(
  code text, device_code text, device_name text, platform text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_pairing app.pairings;
  v_market app.markets;
  v_device_id uuid := gen_random_uuid();
  v_code text := upper(trim(coalesce(device_code, '')));
begin
  if auth.uid() is null then
    raise exception 'not_signed_in';
  end if;
  if platform not in ('windows', 'android', 'web') then
    raise exception 'bad_platform';
  end if;
  if v_code !~ '^[A-Z][A-Z0-9]{0,3}$' then
    raise exception 'bad_device_code';
  end if;
  if exists (select 1 from app.devices where auth_user_id = auth.uid()) then
    raise exception 'already_registered';
  end if;
  -- Claiming marks the code used in the same statement, so two registers cannot share one.
  update app.pairings set used_at = now()
  where pairings.code = upper(trim(claim_device.code))
    and used_at is null and expires_at > now()
  returning * into v_pairing;
  if not found then
    raise exception 'pairing_invalid';
  end if;
  perform app.lock_market(v_pairing.market_id);
  select * into v_market from app.markets where id = v_pairing.market_id;
  if exists (
    select 1 from app.devices
    where market_id = v_pairing.market_id and devices.code = v_code and revoked_at is null
  ) then
    raise exception 'device_code_taken';
  end if;
  insert into app.devices (id, market_id, auth_user_id, code, name, platform, last_seen_at)
  values (v_device_id, v_pairing.market_id, auth.uid(), v_code,
    nullif(trim(coalesce(device_name, '')), ''), platform, now());
  return jsonb_build_object(
    'marketId', v_market.id, 'marketName', v_market.name,
    'deviceId', v_device_id, 'deviceCode', v_code);
end
$$;

/** Where the caller's register belongs, or null when it is not one. */
create function public.my_device() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'marketId', m.id, 'marketName', m.name, 'deviceId', d.id, 'deviceCode', d.code,
    'revoked', d.revoked_at is not null)
  from app.devices d join app.markets m on m.id = d.market_id
  where d.auth_user_id = auth.uid()
$$;

/** Shuts a register out of the market; its next sync is refused. Owners only. */
create function public.revoke_device(device_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_device app.devices;
begin
  select * into v_device from app.devices where id = device_id;
  if not found or not app.is_owner(v_device.market_id) then
    raise exception 'not_owner';
  end if;
  perform app.lock_market(v_device.market_id);
  update app.devices set revoked_at = coalesce(revoked_at, now()) where id = device_id;
end
$$;

/** The operator opens a market for an owner who already has an account. Runs as postgres. */
create function app.create_market(id text, name text, owner_email text) returns void
language plpgsql as $$
declare
  v_owner uuid;
begin
  select u.id into v_owner from auth.users u
  where lower(u.email) = lower(trim(owner_email)) and u.is_anonymous is false;
  if not found then
    raise exception 'owner_not_found';
  end if;
  insert into app.markets (id, name) values (create_market.id, create_market.name);
  insert into app.memberships (market_id, user_id, role) values (create_market.id, v_owner, 'owner');
end
$$;

revoke execute on function app.is_owner(text) from public, anon, authenticated;
revoke execute on function app.create_market(text, text, text) from public, anon, authenticated;
revoke execute on function public.owner_markets() from public, anon;
revoke execute on function public.create_pairing(text) from public, anon;
revoke execute on function public.claim_device(text, text, text, text) from public, anon;
revoke execute on function public.my_device() from public, anon;
revoke execute on function public.revoke_device(uuid) from public, anon;
grant execute on function public.owner_markets() to authenticated;
grant execute on function public.create_pairing(text) to authenticated;
grant execute on function public.claim_device(text, text, text, text) to authenticated;
grant execute on function public.my_device() to authenticated;
grant execute on function public.revoke_device(uuid) to authenticated;
