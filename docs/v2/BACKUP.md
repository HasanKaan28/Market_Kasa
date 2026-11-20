# Backup and restore

The free Supabase plan keeps no backups of its own. Market data is backed up two ways.

| Backup | When | Where | What it holds |
|---|---|---|---|
| **Nightly backup** | Every night at 03:00 (Istanbul) | GitHub -> Actions -> "v2 backup" -> a run -> Artifacts. Kept 30 days. | Every market, register and record on the server (the `app` schema) and the accounts (`auth.users`, `auth.identities`). Encrypted with `age`. |
| **"Yedek al"** | Whenever the market owner wants | Ayarlar -> Yedek -> "Yedek al". The file lands on the device (`market-kasa-yedek-<market>-<date>.json`). | Everything that register sees of the market, including sales not yet sent. Not encrypted: keep it on a USB stick or in e-mail you trust. |

## How the nightly backup is protected

The repository is public, so its artifacts can be downloaded by anyone. They are encrypted to a
**public** key (`docs/v2/backup-recipient.txt`). Only the matching **private** key opens them, and
that key never goes to GitHub. No decryption secret exists in GitHub, so a leaked token, a
malicious workflow change or a compromised runner cannot read old backups. The only secret the
workflow uses is the database connection string, and only in the step that dumps the database.

The dump is checked (`pg_restore --list`) before it is encrypted. The runner cannot decrypt its own
output, so the encrypted file is checked only for the `age` header and a sane size.

The Supabase server runs Postgres 17. The workflow installs the Postgres 17 client from the PGDG
repository (the runner image ships an older one, and `pg_dump` must not be older than the server).
The PGDG signing key is verified against a fixed fingerprint before it is trusted. If Supabase ever
moves the project to another major version, change the version in the workflow (two places).

## Setup (once)

1. **Generate the key pair** on your own computer (install `age` from https://github.com/FiloSottile/age,
   or `winget install FiloSottile.age`):

   ```bash
   age-keygen -o backup-key.txt
   ```

   It prints `Public key: age1...`. The file `backup-key.txt` holds the private key.

2. **Keep the private key offline.** Copy `backup-key.txt` to a USB stick and into a password
   manager, then delete other copies. **Without it the backups cannot be opened, and anyone who has
   it can open them.** Never commit it, never paste it into GitHub or chat.

3. **Commit only the public key.** Replace the placeholder line in `docs/v2/backup-recipient.txt`
   with the `age1...` line (keep or drop the comments) and commit it. The workflow fails with a
   clear message while the file holds no valid key.

4. **Add the one secret.** GitHub -> Settings -> Secrets and variables -> Actions -> **New
   repository secret**: `SUPABASE_DB_URL`. Use Supabase -> project -> **Connect** -> **Session
   pooler** connection string, with the database password in place of `[YOUR-PASSWORD]`. The direct
   `db.<ref>.supabase.co` address does not work: it is IPv6 only and GitHub's runners have no IPv6.
   There is no other secret. `BACKUP_PASSPHRASE` from the old setup is not used any more: delete
   it if it exists.

5. **Run it once by hand.** Actions -> "v2 backup" -> **Run workflow**, and check it ends green.

Scheduled workflows run only from the repository's default branch. If the default branch is not
`v2`, the workflow file must be on the default branch or the nightly run never starts.

The nightly run also queries the database every day, which keeps the free project from being paused
for inactivity.

## Open a nightly backup

Download the artifact from the run page (it is a zip holding `market-kasa-<date>.tar.age`), unzip
it, then:

```bash
age -d -i backup-key.txt market-kasa-2026-11-10.tar.age > backup.tar
tar -xf backup.tar
```

The folder `market-kasa-2026-11-10/` holds `app.dump` and `auth.dump`.

## Restore

Close every register first. Sales that reached the server after the backup are removed by the
restore. Sales still waiting on a register are sent again once the registers open.

**Same project, market data damaged:**

```bash
pg_restore --clean --if-exists --no-owner --schema=app -d "$SUPABASE_DB_URL" market-kasa-2026-11-10/app.dump
```

**New project, the old one is gone:**

```bash
pg_restore --data-only --no-owner -d "$NEW_DB_URL" market-kasa-2026-11-10/auth.dump
pg_restore --no-owner -d "$NEW_DB_URL" market-kasa-2026-11-10/app.dump
```

Then in the new project:

1. Authentication -> Sign In / Providers: **Allow anonymous sign-ins** on, **Confirm email** off.
2. Point the GitHub repository variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` at the new project.
3. Publish a new `v2.x.y` release. Registers connect to the new server once they update.

**From a "Yedek al" file:** the app has no restore button. Give the file to the operator; the records are loaded into the server by hand.
