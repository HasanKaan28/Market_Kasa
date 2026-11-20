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

## Operator panel

Everything above can also be done in the app, without SQL, in the **operator panel**. Schema:
`supabase/migrations/20261120190000_m5_operator_panel.sql`.

### Opening it

The panel has its own address and no link anywhere in the shop's screens:

- Local dev server (`npm run dev`): `http://localhost:5173/#/operator`
- Deployed web app: `https://hasankaan28.github.io/Market_Kasa/app/#/operator`

Sign in with your own email and password, or create the account there with **Hesap oluştur**.
The panel keeps its session under its own storage key (`mk2.operator`), apart from the register's
device session (`mk2.auth`), so signing in or out of the panel never signs a register out on the
same browser. It never opens the shop's local data.

An account without operator rights sees "Bu hesabın yetkisi yok." and nothing else.

The panel has four tabs (on a phone they sit at the bottom). Its detail views and log come from
`supabase/migrations/20261121090000_m6_operator_panel_detail.sql`; until that migration is run,
Özet, market details and Geçmiş show an error and the rest works as before.

- **Özet:** sales today and over the last 30 days across every market; markets (total, active,
  suspended, opened in 30 days); codes (issued, used, waiting, expired, revoked); registers
  (connected, seen in 24 hours). Below: unused codes ending within 7 days (+30 days in one tap),
  markets whose recorded plan date is within 7 days or up to 30 days past (+1 month / +1 year),
  and quiet markets (active, with registers, no sync for 7 days).
- **Marketler:** every market with its owner email, registers and staff, last sync, last sale,
  30-day sales (count and sum), plan record, opening day and the code that opened it. Search by
  name, id, email or plan; filter Tümü / Etkin / Askıda / Sessiz; sort by newest, name, last sync
  or 30-day sales. A market opens its detail.
- **Market detail:** owners and managers, registers and staff counts, the activation code and its
  note, last sync and last sale, sales today / 30 days / all time (voided sales left out), voids
  and returns over 30 days, records per table and their size, every register (platform, added,
  last seen, revoked), the plan record and the private note, its last 10 log lines, and its state.
- **Kodlar:** one code or up to 50 at once with a note and a validity (7, 30, 90 days or 1-365),
  shown large with WhatsApp and copy. The latest 500 codes, filtered by state (with counts) and
  searched by code, note, market or the account that used it; the list can be copied. An unused
  or expired code can be extended by 30 days or revoked.
- **Geçmiş:** every change made from the panel, newest first, 50 at a time, with who made it.

What the panel can change in a shop, each behind a dialog that names the market:

- **Askıya al / Etkinleştir:** a suspended market's registers stop syncing and keep selling
  offline; activating it lets them sync again.
- **Cihazı iptal et:** one register's next sync is refused (`device_revoked`), as when the owner
  revokes it. Its records stay; the owner can pair it again.

**Paket and Özel not are information only.** They are kept in `app.operator_market_info`, which
no register, owner or sync function reads. A plan date that has passed limits nothing: there is
no licence expiry, no device limit and no sync blocking. Sales figures are counts and sums only;
no receipt, customer or product row leaves the server through the panel.

Every change made from the panel (codes issued, extended or revoked, state changes, register
revokes, plan records and notes) is written to `app.operator_log`.

### Granting operator rights

Operators are listed in `app.operators` by auth user id, never by email: email confirmation is off
on this project, so anyone could sign up with someone else's address. First create the account
(in the panel or the Supabase dashboard), check in **Authentication > Users** that it is yours,
then run this once in the SQL editor, with the address in place of the placeholder:

```sql
insert into app.operators (user_id)
select id from auth.users where lower(email) = lower('<operator-email>');
```

It inserts nothing when no account has that address. To take the rights away:

```sql
delete from app.operators
where user_id = (select id from auth.users where lower(email) = lower('<operator-email>'));
```

### One-time claim (first operator only)

While `app.operators` is empty, the panel can make the first operator itself. Put the address in
`app.operator_claims` by hand:

```sql
insert into app.operator_claims (email) values (lower('<operator-email>'));
```

After every sign-in the panel calls `public.op_claim()`. It makes the caller an operator only when
`app.operators` is still empty and the caller's account email matches a claim, then deletes that
claim. Once any operator exists, no one can claim again. Since email confirmation is off, keep the
window short: add the claim only right before you sign up or sign in, and check
`select * from app.operator_claims;` is empty afterwards.

Never write a real address in this repository; the claim and the grant are run only in the SQL
editor.
