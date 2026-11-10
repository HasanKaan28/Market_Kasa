-- A shop opens its own market from the app's first screen, and each register it signs in on gets
-- the next free register code. The pairing code stays the mechanism underneath: the app makes one
-- with the owner's session and claims it with the register's own.

/** A market id from its name: Turkish letters folded, a random tail so names may repeat. */
create function app.market_id_for(p_name text) returns text
language sql volatile set search_path = '' as $$
  select coalesce(nullif(left(trim(both '-' from regexp_replace(
      lower(translate(p_name, 'ÇĞİIÖŞÜçğıöşü', 'CGIIOSUcgiosu')), '[^a-z0-9]+', '-', 'g')), 50), ''),
      'market')
    || '-'
    || (select string_agg(substr('abcdefghijklmnopqrstuvwxyz0123456789', 1 + floor(random() * 36)::int, 1), '')
        from generate_series(1, 6))
$$;

/** Opens a market for the signed-in person and makes them its owner. At most three each. */
create function public.create_own_market(name text) returns jsonb
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

/**
 * Binds the caller's session to the market the code was made for, as a new register. Without a
 * register code it takes the next free one (K1, K2…). With `replace`, a register holding the
 * same code is revoked first: the owner's code is the consent.
 */
create or replace function public.claim_device(
  code text, device_code text, device_name text, platform text, replace boolean default false
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
  if v_code <> '' and v_code !~ '^[A-Z][A-Z0-9]{0,3}$' then
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
  if v_code = '' then
    select 'K' || n into v_code
    from generate_series(1, 999) n
    where not exists (
      select 1 from app.devices
      where market_id = v_pairing.market_id and devices.code = 'K' || n and revoked_at is null)
    order by n limit 1;
  elsif replace then
    update app.devices set revoked_at = now()
    where market_id = v_pairing.market_id and devices.code = v_code and revoked_at is null;
  elsif exists (
    select 1 from app.devices
    where market_id = v_pairing.market_id and devices.code = v_code and revoked_at is null
  ) then
    raise exception 'device_code_taken';
  end if;
  insert into app.devices (id, market_id, auth_user_id, code, name, platform, last_seen_at)
  values (v_device_id, v_pairing.market_id, auth.uid(), v_code,
    coalesce(nullif(trim(coalesce(device_name, '')), ''), 'Kasa ' || v_code), platform, now());
  return jsonb_build_object(
    'marketId', v_market.id, 'marketName', v_market.name,
    'deviceId', v_device_id, 'deviceCode', v_code);
end
$$;

revoke execute on function app.market_id_for(text) from public, anon, authenticated;
revoke execute on function public.create_own_market(text) from public, anon;
grant execute on function public.create_own_market(text) to authenticated;
