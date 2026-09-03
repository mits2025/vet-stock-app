# Vet POS manual GCash licensing Worker

This Cloudflare Worker accepts installation-bound payment requests, stores them in D1 for manual GCash verification, and issues the existing offline-verifiable `SFP1` Ed25519 license after administrator approval.

## Set up and deploy

1. Install dependencies in this directory: `npm install`.
2. Create the database: `npx wrangler d1 create vet-pos-licensing-db`.
3. Put the returned database ID in `wrangler.jsonc`.
4. Confirm the GCash account, plan price, license duration, allowed origins, and message URL in `wrangler.jsonc`.
5. Replace `public/gcash-qr.png` only with the official, unmodified GCash QR image.
6. Add secrets:

   ```powershell
   npx wrangler secret put ADMIN_API_KEY
   npx wrangler secret put LICENSE_SIGNING_PRIVATE_KEY_HEX
   npx wrangler secret put RATE_LIMIT_SALT
   ```

   `LICENSE_SIGNING_PRIVATE_KEY_HEX` must contain the 64-character private key from `../licenses/private-key.hex`. Never put it in `wrangler.jsonc` or source control.

   Use a long random value for `RATE_LIMIT_SALT`. To require bot verification on public payment submissions, also configure Turnstile in the customer UI and store its secret with `npx wrangler secret put TURNSTILE_SECRET_KEY`.

7. Create the remote tables: `npm run db:remote`.
8. Deploy: `npm run deploy`.
9. Build Vet POS with the Worker address:

   ```env
   VITE_LICENSE_SERVICE_URL=https://vet-pos-licensing.YOUR-SUBDOMAIN.workers.dev
   ```

10. Review pending payments at `https://vet-pos-licensing.YOUR-SUBDOMAIN.workers.dev/admin`.

The Worker never stores GCash credentials. An administrator compares the submitted reference and receipt with their GCash history, then approves or rejects the request.

The API enforces D1-backed per-source request limits even when `Content-Length` is missing, audits failed admin attempts, expires abandoned requests after seven days, and runs daily cleanup. Re-run `npm run db:remote` after upgrading an existing deployment so the security tables are created.
