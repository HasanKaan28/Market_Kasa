-- Server-side hardening from the 2026-11-20 security review (S-01, S-02, S-03, S-04 in part).
--
-- Functions only: no table, column or stored row changes, and no new function names, so a later
-- migration from the other app sharing this server (Restoran Kasa) that creates its own helper
-- functions does not collide with one made here. Each function is replaced whole from its latest
-- definition; `create or replace` keeps the grants but drops the settings, so every definition
-- states its empty search_path again. `app.entity_tables()` and `app.event_tables()` are left
-- alone: the live server's lists also carry Restoran Kasa's tables.
--
-- 1. One push carries at most a thousand operations (the app sends 500). A record over a
--    megabyte, as sent or once merged, is refused as too_large: a full stock count of a few
--    thousand products stays well under it, a register filling the shared disk does not.
-- 2. A record is kept under its own id: an insert whose record names another id, or a patch that
--    clears or changes the id, is refused (id_mismatch). A staff row keeps its name, role and PIN
--    hash (missing_field), a PIN hash of at most two million iterations (bad_pin_iterations), and
--    the market keeps at least one active owner (last_owner), as the registers already enforce.
--    Every other table, Restoran Kasa's among them, gets only the size and id checks.
-- 3. A suspended market's registers are refused by sync (market_suspended); they keep their
--    queue and sell offline until the market is active again. The licence end is not enforced
--    here: my_device reports it, with the market's status, for the register to show.
-- 4. Market ids and pairing codes are drawn from gen_random_uuid (pg_strong_random) instead of
--    random(), which is predictable.
-- 5. Opening a market takes a lock per person first, so parallel calls cannot pass the limit of
--    three markets each.

/** Applies one queued operation; returns null when applied, else why it was refused. */
create or replace function app.apply_op(p_market text, p_op jsonb) returns text
language plpgsql set search_path = '' as $$
declare
  v_table text := p_op ->> 'table';
  v_id text := p_op ->> 'recordId';
  v_kind text := p_op ->> 'kind';
  -- Far above any record a register writes (the largest live row is under a kilobyte; a stock
  -- count line is about 170 bytes), far below what fills a disk.
  v_max_bytes constant integer := 1048576;
  v_max_pin_iterations constant numeric := 2000000;
  v_fields jsonb;
  v_row jsonb;
  v_new jsonb;
  v_was_owner boolean;
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
  if pg_column_size(v_fields) > v_max_bytes then
    return 'too_large';
  end if;
  -- Stored under another id, a record would overwrite that record on every register that pulls
  -- it. A record sent without an id is kept as it was sent.
  if v_fields ? 'id' and (v_fields ->> 'id') is distinct from v_id then
    return 'id_mismatch';
  end if;

  select row into v_row from app.rows
  where market_id = p_market and tbl = v_table and id = v_id
  for update;
  if not found then
    if v_kind = 'patch' then
      -- A patch for a record the server never received changes nothing, as on the fake server.
      return null;
    end if;
    v_new := app.normalized(v_table, v_fields);
  elsif v_table = any (app.event_tables()) then
    -- An event is written once; a second copy of it changes nothing.
    return null;
  else
    -- A patch, or a second insert of an entity (two registers saving the same fixed-id record
    -- offline): merged field by field, so the later arrival wins each field it sends.
    -- A null field clears it; every other field replaces the stored one.
    v_new := (v_row || coalesce(
        (select jsonb_object_agg(key, value) from jsonb_each(v_fields) where value <> 'null'::jsonb),
        '{}'::jsonb))
      - coalesce(
        (select array_agg(key) from jsonb_each(v_fields) where value = 'null'::jsonb),
        array[]::text[]);
    v_new := app.normalized(v_table, v_new);
    if pg_column_size(v_new) > v_max_bytes then
      return 'too_large';
    end if;
  end if;

  if v_table = 'staff' then
    -- A person without a name, a role or a PIN hash breaks the sign-in screen of every register.
    if v_new -> 'name' is null or v_new -> 'name' = 'null'::jsonb
      or v_new -> 'role' is null or v_new -> 'role' = 'null'::jsonb
      or v_new -> 'pinHash' is null or v_new -> 'pinHash' = 'null'::jsonb then
      return 'missing_field';
    end if;
    -- Every register runs this many PBKDF2 rounds at each sign-in; the app uses 150,000.
    if v_new ? 'pinIterations' and (
      jsonb_typeof(v_new -> 'pinIterations') is distinct from 'number'
      or (v_new ->> 'pinIterations')::numeric not between 1 and v_max_pin_iterations
    ) then
      return 'bad_pin_iterations';
    end if;
    -- The last active owner stays an owner and is not archived (src/data/staff.ts).
    v_was_owner := v_row is not null
      and v_row ->> 'role' = 'owner' and v_row ->> 'archivedAt' is null;
    if v_was_owner
      and not (v_new ->> 'role' = 'owner' and v_new ->> 'archivedAt' is null)
      and not exists (
        select 1 from app.rows
        where market_id = p_market and tbl = 'staff' and id <> v_id
          and row ->> 'role' = 'owner' and row ->> 'archivedAt' is null)
    then
      return 'last_owner';
    end if;
  end if;

  if v_row is null then
    insert into app.rows (market_id, tbl, id, server_seq, row)
    values (p_market, v_table, v_id, nextval('app.server_seq'), v_new);
  else
    update app.rows set row = v_new, server_seq = nextval('app.server_seq'), received_at = now()
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

/**
 * Applies a register's queued operations in order. Each operation is applied once per opId; one
 * that is refused is reported and its record sent again, so the register's value reverts. More
 * than a thousand operations in one call are refused as a whole.
 */
create or replace function public.sync_push(ops jsonb) returns jsonb
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
  if jsonb_array_length(ops) > 1000 then
    raise exception 'too_many_ops';
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

/**
 * The register the caller signed in as; raises when there is none, it was revoked, or its market
 * is suspended. A suspended market's registers keep their queue and sell offline meanwhile.
 */
create or replace function app.current_device() returns app.devices
language plpgsql stable set search_path = '' as $$
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
  if not exists (
    select 1 from app.markets where id = v_device.market_id and status = 'active'
  ) then
    raise exception 'market_suspended';
  end if;
  return v_device;
end
$$;

/** Where the caller's register belongs, with its market's status and licence end; null if none. */
create or replace function public.my_device() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'marketId', m.id, 'marketName', m.name, 'deviceId', d.id, 'deviceCode', d.code,
    'revoked', d.revoked_at is not null,
    'status', m.status, 'licenseExpiresAt', m.license_expires_at)
  from app.devices d join app.markets m on m.id = d.market_id
  where d.auth_user_id = auth.uid()
$$;

/**
 * A market id from its name: Turkish letters folded, a random tail so names may repeat. The tail
 * comes from a random UUID's bytes (pg_strong_random), skipping the version and variant bytes.
 */
create or replace function app.market_id_for(p_name text) returns text
language sql volatile set search_path = '' as $$
  select coalesce(nullif(left(trim(both '-' from regexp_replace(
      lower(translate(p_name, 'ÇĞİIÖŞÜçğıöşü', 'CGIIOSUcgiosu')), '[^a-z0-9]+', '-', 'g')), 50), ''),
      'market')
    || '-'
    || (select string_agg(substr('abcdefghijklmnopqrstuvwxyz0123456789',
          1 + get_byte(random.bytes, byte.n) % 36, 1), '' order by byte.n)
        from (select uuid_send(gen_random_uuid()) as bytes) random,
          generate_series(0, 6) byte(n)
        where byte.n <> 6)
$$;

/** A one-time code, good for ten minutes, that binds one register to this market. */
create or replace function public.create_pairing(market_id text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_code text;
begin
  if not app.is_owner(market_id) then
    raise exception 'not_owner';
  end if;
  loop
    -- No 0/O or 1/I: the code is read out loud or typed from another screen. 32 letters, so
    -- each random byte gives one without bias; the UUID's version and variant bytes are skipped.
    v_code := (
      select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
          1 + get_byte(random.bytes, byte.n) % 32, 1), '' order by byte.n)
      from (select uuid_send(gen_random_uuid()) as bytes) random,
        generate_series(0, 9) byte(n)
      where byte.n not in (6, 8));
    exit when not exists (select 1 from app.pairings where code = v_code);
  end loop;
  insert into app.pairings (code, market_id, created_by, expires_at)
  values (v_code, market_id, auth.uid(), now() + interval '10 minutes');
  return v_code;
end
$$;

/** Opens a market for the signed-in person and makes them its owner. At most three each. */
create or replace function public.create_own_market(name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_name text := trim(coalesce(name, ''));
  v_id text;
begin
  if auth.uid() is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'not_signed_in';
  end if;
  if length(v_name) not between 1 and 60 then
    raise exception 'bad_name';
  end if;
  -- Two calls at once would both count fewer than three markets without it.
  perform pg_advisory_xact_lock(hashtext('owner:' || auth.uid()::text));
  if (select count(*) from app.memberships where user_id = auth.uid() and role = 'owner') >= 3 then
    raise exception 'too_many_markets';
  end if;
  loop
    v_id := app.market_id_for(v_name);
    exit when not exists (select 1 from app.markets where id = v_id);
  end loop;
  insert into app.markets (id, name) values (v_id, v_name);
  insert into app.memberships (market_id, user_id, role) values (v_id, auth.uid(), 'owner');
  return jsonb_build_object('id', v_id, 'name', v_name);
end
$$;
