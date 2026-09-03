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

## Optional GCash and Cloudflare Issuer

The `vet-pos-licensing-worker/` directory provides the same manual GCash review flow used by ClinicOps. Customers submit their GCash sender name and reference from the activation screen. An administrator verifies the payment at the Worker's `/admin` page, and the Worker returns an installation-bound `SFP1` license that activates automatically when the customer checks the request status.

Follow `vet-pos-licensing-worker/README.md` to create its D1 database, store `ADMIN_API_KEY` and `LICENSE_SIGNING_PRIVATE_KEY_HEX` as Cloudflare secrets, and deploy it. Then set `VITE_LICENSE_SERVICE_URL` before building the app. The Worker signing secret must contain the private key paired with `src/config/licensePublicKey.js`.

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

## Secure Windows Releases

Production installers now require code signing (`forceCodeSigning`). Configure electron-builder's standard `CSC_LINK` and `CSC_KEY_PASSWORD` secrets in the release environment; unsigned installer builds fail instead of silently shipping.

The desktop updater accepts only signed metadata named `Vet-POS-Update-<version>.json` plus a matching `.json.sig`. The JSON must contain `version`, `installer`, and `sha256`. Sign the exact JSON bytes with an offline Ed25519 private key, then configure the installed machines with:

- `UPDATE_METADATA_PUBLIC_KEY_PEM`: the pinned public key in PEM form (a release secret; the workflow embeds only this public key).
- `UPDATE_METADATA_PRIVATE_KEY_PEM`: the separate metadata-signing private key.
- `UPDATE_WINDOWS_PUBLISHER`: the expected Authenticode certificate subject/publisher.
- `CSC_LINK` and `CSC_KEY_PASSWORD`: the standard electron-builder code-signing credentials.

The updater verifies both the offline metadata signature and the downloaded installer's valid Authenticode publisher before launch. Keep the update-signing private key separate from GitHub credentials and from the license-signing key.

## Secure Android Releases

Android now derives `versionName` and `versionCode` from the root `package.json`, enables R8 minification/resource shrinking for release builds, and refuses release assembly without these environment variables:

- `ANDROID_KEYSTORE_PATH`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

Use a protected CI environment or local secret manager for these values. Do not commit the keystore or passwords.
