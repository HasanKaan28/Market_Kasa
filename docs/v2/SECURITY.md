# Release and account security: owner actions

Things the code cannot do for you. None of them is automated.

## 1. Protect the GitHub account

Releases of the desktop app are built from this repository and delivered to every register by
auto-update. Whoever controls the account controls what runs on the tills.

- Turn on two-factor authentication, preferably a passkey or a hardware key (GitHub -> Settings ->
  Password and authentication). Keep the recovery codes offline.
- Review active sessions and authorized apps now and then, and remove what you do not use.

## 2. Restrict who can publish a release

A pushed `v2.x.y` tag starts the release workflow.

- Settings -> Rules -> Rulesets -> New tag ruleset, target tags `v*`: restrict creations, updates
  and deletions so that only you (an admin) can create them.
- Add nobody to the repository as a collaborator with write access unless needed.
- Optionally require the release workflow to run in a protected GitHub environment that needs
  your approval before it publishes.

## 3. Code signing (optional, recommended later)

Unsigned installers make Windows SmartScreen warn on first install, and the updater cannot prove
who built an update. To sign:

- Buy an OV or EV code-signing certificate, or use Azure Trusted Signing.
- Add the certificate or the Azure credentials as repository secrets and configure electron-builder
  (`win.signtoolOptions` or `win.azureSignOptions`) with them. Never commit the certificate.
- **After signing starts, set `win.publisherName` in the `build` section of `package.json`** to the
  exact certificate subject name, so the updater accepts only updates signed by you. It is not set
  now on purpose: with no signature, setting it would make every update fail.

## 4. Backups

See `docs/v2/BACKUP.md`: keep the age private key offline and commit only the public key.
