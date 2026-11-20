-- Server-side hardening, second part (follow-up to 20261120120000_m3_server_hardening.sql).
--
-- This Supabase project is Market Kasa's own. Restoran Kasa has had its own Supabase project
-- since 2026-11-19; the previous migration's header, which says the server is shared with it, is
-- out of date. The restaurant tables still listed in `app.entity_tables()` are leftovers from the
-- shared days and are kept: this migration does not redefine `app.entity_tables()` or
-- `app.event_tables()`.
--
-- Functions only, each replaced whole from its latest live definition; `create or replace` keeps
-- the grants but drops the settings, so every definition states its empty search_path again.
--
-- 1. A push checks its register again once it holds the market's lock. A push that waited on the
--    lock while the market was suspended or the register revoked would otherwise still write.
-- 2. A suspended market's owner gets no pairing code (market_suspended): a register paired then
--    could not sync anyway.

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
  -- The wait for the lock may have outlasted a suspension or a revocation committed meanwhile;
  -- this statement reads them, so such a push raises here instead of writing.
  v_device := app.current_device();
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
 * A one-time code, good for ten minutes, that binds one register to this market. None while the
 * market is suspended.
 */
create or replace function public.create_pairing(market_id text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_code text;
begin
  if not app.is_owner(market_id) then
    raise exception 'not_owner';
  end if;
  if not exists (
    select 1 from app.markets m where m.id = create_pairing.market_id and m.status = 'active'
  ) then
    raise exception 'market_suspended';
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
