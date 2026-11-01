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
  select id into v_winner from app.rows
  where market_id = p_market and tbl = 'products' and row ->> 'barcode' = p_barcode
  order by id collate "C" limit 1;
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

  if v_kind = 'insert' then
    v_fields := p_op -> 'record';
    if jsonb_typeof(v_fields) is distinct from 'object' then
      return 'bad_record';
    end if;
    v_row := app.normalized(v_table, v_fields);
    insert into app.rows (market_id, tbl, id, server_seq, row)
    values (p_market, v_table, v_id, nextval('app.server_seq'), v_row)
    on conflict do nothing;
  elsif v_kind = 'patch' then
    if not (v_table = any (app.entity_tables())) then
      return 'not_patchable';
    end if;
    v_fields := p_op -> 'patch';
    if jsonb_typeof(v_fields) is distinct from 'object' then
      return 'bad_record';
    end if;
    select row into v_row from app.rows
    where market_id = p_market and tbl = v_table and id = v_id
    for update;
    if not found then
      -- A patch for a record the server never received changes nothing, as on the fake server.
      return null;
    end if;
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
  else
    return 'unknown_kind';
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
