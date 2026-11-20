# Activation codes: operator guide

A new market can only be opened with a one-time **activation code** that you issue and hand to
the shop (by phone or WhatsApp). The shop types it into **Kurulum kodu** on the first screen's
**Market kur** form. The schema is `supabase/migrations/20261120170000_m4_activation_codes.sql`.

## What needs a code and what does not

- **Needs a code:** opening a brand-new market (`public.create_own_market(name, code)`).
- **Never needs a code:** every market that existed when the migration ran (marked activated,
  `app.markets.activated_at` set and `activation_code` null), pairing a new register to an
  existing market (`create_pairing` / `claim_device`), reinstalling the app on a device, signing
  in again, and the owner signing in on a new device ("Markete giriş yap").
- Nothing limits a market once it is open. There is no licence expiry and no sync blocking.
- Apps released before codes (2.0.15 and earlier) call `create_own_market(name)` without a code.
  The server answers `activation_required`, so **Market kur** fails on those apps until they
  update. Their existing markets and registers keep working.

## Code format

`ABCD-2345`: eight characters in two groups of four, from the Crockford base32 alphabet
(`0-9` and `A-Z` without `I`, `L`, `O`, `U`), drawn from `gen_random_uuid()`. The server reads a
code in any case, with or without the dash or spaces, and reads `O` as zero and `I` or `L` as one,
so a code read out on the phone is hard to get wrong.

Each code has a note (who it is for) and an expiry (30 days unless you say otherwise, at most
365). Opening a market uses the code up in the same statement, so a code opens one market only.
The shop sees:

| Server error         | When                               | Message on the form                                               |
| -------------------- | ---------------------------------- | ----------------------------------------------------------------- |
| `activation_invalid` | unknown, malformed or revoked code | Kurulum kodu geçersiz. Kodu kontrol edin ya da bize ulaşın.       |
| `activation_used`    | the code already opened a market   | Bu kurulum kodu daha önce kullanılmış. Yeni kod için bize ulaşın. |
| `activation_expired` | past `expires_at`                  | Bu kurulum kodunun süresi dolmuş. Yeni kod için bize ulaşın.      |

If a used code belongs to the same account that already opened a market with it (for example the
first try opened the market but could not bind the device), the form tells the owner to use
**Markete giriş yap** instead. That needs no code.

## Running the SQL

Run these in the Supabase dashboard's SQL editor for project `catjrsaeeebdvudnpysp`, or through
the Supabase MCP `execute_sql`. Both run as `postgres`. The generator lives in the `app` schema,
which no client role (`anon`, `authenticated`) can reach, and only `postgres` and `service_role`
hold execute on it.

### Generate a code

```sql
-- 30 days (default)
select app.issue_activation_code('Kurşunlu Market - Emin, 0555 000 00 00');

-- another validity, in days (1-365)
select app.issue_activation_code('Yıldız Bakkal - deneme', 7);
```

Each call returns one code, for example `7KQ4-M2XD`. Give it to the shop.

### List unused codes

```sql
select code, note, created_at, expires_at
from app.activation_codes
where used_at is null and revoked_at is null and expires_at > now()
order by created_at desc;
```

### See which market each used code opened

```sql
select c.code, c.note, c.used_at, m.id as market_id, m.name as market_name, u.email
from app.activation_codes c
left join app.markets m on m.activation_code = c.code
left join auth.users u on u.id = c.used_by
where c.used_at is not null
order by c.used_at desc;
```

### Revoke a code

An unused code can be revoked; it then opens nothing (`activation_invalid`). A used code is left
as it is, since revoking it would change nothing.

```sql
update app.activation_codes
set revoked_at = now()
where code = app.canonical_activation_code('7KQ4-M2XD')
  and used_at is null
  and revoked_at is null
returning code, note, revoked_at;
```

No row returned means the code does not exist, was already used, or was already revoked.

### Extend an unused code

```sql
update app.activation_codes
set expires_at = now() + interval '30 days'
where code = app.canonical_activation_code('7KQ4-M2XD') and used_at is null
returning code, expires_at;
```
