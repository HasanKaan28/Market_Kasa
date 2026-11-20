-- Activation codes. A new market opens only with a one-time code the operator (the developer)
-- issues in the Supabase SQL editor and hands to the shop, usually over the phone. Ported from
-- Restoran Kasa's 20261121120000_activation.sql, without its plans, licences, operator table and
-- yönetim page: Market Kasa has none of them, and nothing here limits a market once it is open.
--
-- 1. Every market that exists when this runs is marked activated (activated_at, no code), so no
--    check, now or later, asks it for a code. Only opening a NEW market with create_own_market
--    needs one; pairing a register (create_pairing, claim_device), reinstalling the app and
--    signing in again are unchanged and never ask.
-- 2. Codes look like ABCD-2345: eight Crockford base32 characters (no I, L, O or U), drawn from
--    gen_random_uuid(). They are read the way Crockford reads them: any case, with or without the
--    dash or spaces, O as zero and I or L as one. Each carries a note (who it is for) and an
--    expiry, 30 days by default.
-- 3. app.issue_activation_code(note, days) issues one. It lives in the `app` schema, which no
--    client role can reach, and only postgres (the SQL editor, the Supabase MCP) and service_role
--    hold execute on it.
-- 4. public.create_own_market(name, code) opens the market and uses the code up in one statement,
--    after the per-person lock and the three-market limit, so of two shops sending one code at once
--    the second finds it used; anything refused later rolls the use back with the market. A code
--    is refused as activation_used, activation_expired, or activation_invalid (unknown, malformed
--    or revoked).
-- 5. public.create_own_market(name), the call of the apps released before codes (2.0.15 and
--    earlier), now answers activation_required. Opening a market on such an app fails until it
--    updates; existing markets are not affected.
--
-- `app.entity_tables()`, `app.event_tables()`, `app.apply_op` and `public.sync_push` are not
-- touched. Each replaced function states its empty search_path again (`create or replace` keeps
-- the grants but drops the settings).

create table app.activation_codes (
  code text primary key check (code ~ '^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$'),
  note text not null check (length(trim(note)) between 1 and 200),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  used_at timestamptz,
  used_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz
);
create index activation_codes_recent on app.activation_codes (created_at desc);

-- Defence in depth, as for every app table: no policy and no grant.
alter table app.activation_codes enable row level security;
revoke all on app.activation_codes from public, anon, authenticated;

-- How each market was activated: by a code, or (activation_code null) because it existed before
-- codes. No function reads these to refuse anything.
alter table app.markets
  add column activated_at timestamptz,
  add column activation_code text references app.activation_codes (code);
update app.markets set activated_at = created_at where activated_at is null;

/**
 * Eight characters from one random UUID (pg_strong_random), leaving out the two bytes that carry
 * its version and variant. 32 letters and digits, so each byte gives five even bits: 40 in all.
 */
create function app.new_activation_code() returns text
language sql volatile set search_path = '' as $$
  select substr(drawn.chars, 1, 4) || '-' || substr(drawn.chars, 5, 4)
  from (
    select string_agg(substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ',
        1 + get_byte(random.bytes, byte.n) % 32, 1), '' order by byte.n) as chars
    from (select uuid_send(gen_random_uuid()) as bytes) random,
      generate_series(0, 9) byte(n)
    where byte.n not in (6, 8)
  ) drawn
$$;

/**
 * The code as stored (XXXX-XXXX) from however it was typed: any case, dashes and spaces anywhere,
 * O for zero, I or L for one. Null when it cannot be a code.
 */
create function app.canonical_activation_code(p_code text) returns text
language sql immutable set search_path = '' as $$
  select case when bare.chars ~ '^[0-9A-HJKMNP-TV-Z]{8}$'
    then substr(bare.chars, 1, 4) || '-' || substr(bare.chars, 5, 4)
  end
  from (
    select translate(regexp_replace(upper(coalesce(p_code, '')), '[^A-Z0-9]', '', 'g'), 'OIL', '011')
      as chars
  ) bare
$$;

/**
 * A new, unused code for the shop the note names, valid for `p_days` (1–365) days. For the
 * operator only: run it in the SQL editor.
 */
create function app.issue_activation_code(p_note text, p_days integer default 30) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_note text := trim(coalesce(p_note, ''));
  v_code text;
begin
  if length(v_note) not between 1 and 200 then
    raise exception 'bad_note';
  end if;
  if p_days is null or p_days not between 1 and 365 then
    raise exception 'bad_days';
  end if;
  loop
    v_code := app.new_activation_code();
    exit when not exists (select 1 from app.activation_codes c where c.code = v_code);
  end loop;
  insert into app.activation_codes (code, note, expires_at)
  values (v_code, v_note, now() + p_days * interval '1 day');
  return v_code;
end
$$;

/**
 * Opens a market for the signed-in person with an activation code, and makes them its owner. At
 * most three each. The code is taken in the statement that marks it used, after the per-person
 * lock and the count, so a refused market leaves it unused.
 */
create function public.create_own_market(name text, code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_name text := trim(coalesce(create_own_market.name, ''));
  v_code text := app.canonical_activation_code(create_own_market.code);
  v_found app.activation_codes;
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
  update app.activation_codes c set used_at = now(), used_by = auth.uid()
  where c.code = v_code and c.used_at is null and c.revoked_at is null and c.expires_at > now()
  returning * into v_found;
  if not found then
    select * into v_found from app.activation_codes c where c.code = v_code;
    if not found or v_found.revoked_at is not null then
      raise exception 'activation_invalid';
    elsif v_found.used_at is not null then
      raise exception 'activation_used';
    else
      raise exception 'activation_expired';
    end if;
  end if;
  loop
    v_id := app.market_id_for(v_name);
    exit when not exists (select 1 from app.markets where id = v_id);
  end loop;
  insert into app.markets (id, name, activated_at, activation_code)
  values (v_id, v_name, now(), v_code);
  insert into app.memberships (market_id, user_id, role) values (v_id, auth.uid(), 'owner');
  return jsonb_build_object('id', v_id, 'name', v_name);
end
$$;

/** The call of an app built before codes: it is told to update instead of opening a market. */
create or replace function public.create_own_market(name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'activation_required';
end
$$;

revoke execute on function app.new_activation_code() from public, anon, authenticated;
revoke execute on function app.canonical_activation_code(text) from public, anon, authenticated;
revoke execute on function app.issue_activation_code(text, integer) from public, anon, authenticated;
-- service_role has no usage on schema app today, so in practice only postgres reaches it.
grant execute on function app.issue_activation_code(text, integer) to service_role;

revoke execute on function public.create_own_market(text, text) from public, anon;
grant execute on function public.create_own_market(text, text) to authenticated;
