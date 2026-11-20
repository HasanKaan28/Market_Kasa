-- The operator panel (#/operator): the developer issues and manages activation codes and
-- suspends or activates markets from the app, without the SQL editor. Restoran Kasa's yönetim
-- page is the model (its operators table and is_operator), cut down to what Market Kasa has.
--
-- 1. app.operators lists who is an operator, by auth user id. Never by email: email confirmation
--    is off on this project, so anyone can sign up with someone else's address. A row is added
--    by hand in the SQL editor (docs/v2/ACTIVATION.md); no client role can read or write it.
--    The one exception is the first operator: public.op_claim() lets the account whose email is
--    in app.operator_claims (filled by hand, never from the repository) become the operator, but
--    only while app.operators is empty, and spends the claim.
-- 2. app.is_operator() is true for a password session (not an anonymous register) whose user id
--    is in that table. It lives in `app`, which no client role can reach.
-- 3. The panel's functions are in `public`, each security definer with an empty search path, and
--    each raises not_operator before it reads or changes anything. Only `authenticated` may
--    execute them; `anon` and `service_role` may not.
--
-- Live-safe: two new tables, one new function in `app` and eight new functions in `public`. No
-- existing table, row or function changes: `apply_op`, `sync_push`, `sync_pull`,
-- `current_device`, `claim_device`, `create_pairing`, `create_own_market`, `entity_tables` and
-- `event_tables` are not touched. Suspending a market from the panel sets the same
-- `app.markets.status` the server already reads (its registers keep selling offline and sync
-- again once it is active).

create table app.operators (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Defence in depth, as for every app table: no policy and no grant.
alter table app.operators enable row level security;
revoke all on app.operators from public, anon, authenticated, service_role;

/** True when the caller signed in with a password (not as a register) and is an operator. */
create function app.is_operator() returns boolean
language sql stable set search_path = '' as $$
  select auth.uid() is not null
    and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is false
    and exists (select 1 from app.operators o where o.user_id = auth.uid())
$$;

/**
 * A one-time way in for the first operator: an email address the developer puts here by hand
 * in the SQL editor, before he signs up in the panel. Never written in this repository.
 */
create table app.operator_claims (
  email text primary key check (email = lower(trim(email)) and length(email) between 3 and 320),
  created_at timestamptz not null default now()
);
alter table app.operator_claims enable row level security;
revoke all on app.operator_claims from public, anon, authenticated, service_role;

/**
 * Makes the caller the first operator when there is no operator yet and their account's email
 * is claimed, and spends the claim. Otherwise changes nothing and answers false. The panel calls
 * it after every sign-in; once an operator exists, no one can claim again.
 */
create function public.op_claim() returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_email text;
begin
  if auth.uid() is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    return false;
  end if;
  -- Two first sign-ins at once would both find the table empty without it.
  perform pg_advisory_xact_lock(hashtext('operator_claim'));
  if exists (select 1 from app.operators) then
    return false;
  end if;
  select lower(trim(u.email)) into v_email from auth.users u where u.id = auth.uid();
  if v_email is null or not exists (
    select 1 from app.operator_claims c where c.email = v_email
  ) then
    return false;
  end if;
  insert into app.operators (user_id) values (auth.uid());
  delete from app.operator_claims c where c.email = v_email;
  return true;
end
$$;

/** True for an operator; the panel asks before it shows anything. */
create function public.op_whoami() returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_operator() then
    raise exception 'not_operator';
  end if;
  return true;
end
$$;

/** A new, unused code for the shop the note names, valid for `days` (1–365) days. */
create function public.op_issue_code(note text, days integer) returns text
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not app.is_operator() then
    raise exception 'not_operator';
  end if;
  return app.issue_activation_code(op_issue_code.note, op_issue_code.days);
end
$$;

/**
 * The latest 500 codes, newest first, each with its status (used, revoked, expired or unused)
 * and the market it opened.
 */
create function public.op_list_codes() returns jsonb
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
        'marketId', m.id, 'marketName', m.name)
        order by c.created_at desc, c.code), '[]'::jsonb)
    from (
      select * from app.activation_codes
      order by created_at desc, code
      limit 500
    ) c
    left join app.markets m on m.activation_code = c.code);
end
$$;

/** Retires a code no one has used yet; it then opens nothing (activation_invalid). */
create function public.op_revoke_code(code text) returns void
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
end
$$;

/**
 * Adds `days` (1–365) to an unused code: from its end while it runs, from now once it has
 * expired. A used or revoked code is refused.
 */
create function public.op_extend_code(code text, days integer) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_code app.activation_codes;
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
  update app.activation_codes c
  set expires_at = greatest(now(), c.expires_at) + op_extend_code.days * interval '1 day'
  where c.code = v_code.code
  returning * into v_code;
  return jsonb_build_object('code', v_code.code, 'expiresAt', v_code.expires_at);
end
$$;

/**
 * Every market, newest first: status, when it was opened and activated, its registers that are
 * not revoked, when it last synced (a register's last push, or the newest record the server
 * took) and its owner's email.
 */
create function public.op_list_markets() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_operator() then
    raise exception 'not_operator';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', m.id, 'name', m.name, 'status', m.status, 'createdAt', m.created_at,
        'activatedAt', m.activated_at, 'activationCode', m.activation_code,
        'devices', d.active,
        'lastSyncAt', nullif(greatest(
          coalesce(d.last_seen, '-infinity'), coalesce(r.received, '-infinity')), '-infinity'),
        'ownerEmail', o.email)
        order by m.created_at desc, m.id), '[]'::jsonb)
    from app.markets m
    cross join lateral (
      select count(*) filter (where dv.revoked_at is null)::int as active,
        max(dv.last_seen_at) as last_seen
      from app.devices dv where dv.market_id = m.id
    ) d
    -- The newest record by server_seq, read from rows_by_seq rather than every row.
    left join lateral (
      select rw.received_at as received from app.rows rw
      where rw.market_id = m.id
      order by rw.server_seq desc limit 1
    ) r on true
    left join lateral (
      select u.email from app.memberships ms join auth.users u on u.id = ms.user_id
      where ms.market_id = m.id and ms.role = 'owner'
      order by u.email limit 1
    ) o on true);
end
$$;

/**
 * Suspends a market (its registers are refused until it is active again; they keep selling
 * offline) or activates it. Only `active` and `suspended`.
 */
create function public.op_set_market_status(market_id text, status text) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not app.is_operator() then
    raise exception 'not_operator';
  end if;
  if op_set_market_status.status is null
    or op_set_market_status.status not in ('active', 'suspended') then
    raise exception 'bad_status';
  end if;
  update app.markets m set status = op_set_market_status.status
  where m.id = op_set_market_status.market_id;
  if not found then
    raise exception 'market_not_found';
  end if;
end
$$;

revoke execute on function app.is_operator() from public, anon, authenticated, service_role;

revoke execute on function public.op_claim() from public, anon, service_role;
revoke execute on function public.op_whoami() from public, anon, service_role;
revoke execute on function public.op_issue_code(text, integer) from public, anon, service_role;
revoke execute on function public.op_list_codes() from public, anon, service_role;
revoke execute on function public.op_revoke_code(text) from public, anon, service_role;
revoke execute on function public.op_extend_code(text, integer) from public, anon, service_role;
revoke execute on function public.op_list_markets() from public, anon, service_role;
revoke execute on function public.op_set_market_status(text, text)
  from public, anon, service_role;

grant execute on function public.op_claim() to authenticated;
grant execute on function public.op_whoami() to authenticated;
grant execute on function public.op_issue_code(text, integer) to authenticated;
grant execute on function public.op_list_codes() to authenticated;
grant execute on function public.op_revoke_code(text) to authenticated;
grant execute on function public.op_extend_code(text, integer) to authenticated;
grant execute on function public.op_list_markets() to authenticated;
grant execute on function public.op_set_market_status(text, text) to authenticated;
