# StockFlow POS Offline License Setup

StockFlow POS uses offline Ed25519 signed licenses.

## One-Time Key Generation

Run this once on your own computer:

```bash
npm run license:keys
```

This creates:

- `licenses/private-key.hex` - private signing key. Keep this secret.
- `src/config/licensePublicKey.js` - public verification key. This is safe to bundle in the app.

Do not share, commit, upload, or include `licenses/private-key.hex` in APK/build output. It is ignored by `.gitignore`.

## Customer Installation ID

When the APK opens for the first time, it shows an installation ID.

Ask the customer/user to send you that installation ID.

## Issue a License

Run:

```bash
node scripts/issue-license.mjs "<installation-id>" "2027-06-28"
```

Example:

```bash
node scripts/issue-license.mjs "550e8400-e29b-41d4-a716-446655440000" "2027-06-28"
```

The script prints one copy-paste license:

```text
SFP1.<payload>.<signature>
```

Paste that into the app activation screen.

## Expiration

The license payload contains `expiresAt` as `YYYY-MM-DD`.

The app verifies the license offline on every launch and rejects expired licenses.

## Replacing Keys Later

For a future app version, run `npm run license:keys` in a clean/private workspace or move the old private key first. Ship the new APK with the new `src/config/licensePublicKey.js`.

Licenses signed with the old private key will not work with an APK that contains a new public key.

## Security Notes

Offline signatures prevent users from generating valid licenses from the APK because the private key is not inside the app.

However, offline checks cannot fully prevent:

- APK patching by a skilled attacker
- Device-date tampering
- Removing the activation screen from a modified APK

The app includes basic rollback detection: if the local date moves backward by more than one day after successful verification, the license is rejected until the device date is corrected.
