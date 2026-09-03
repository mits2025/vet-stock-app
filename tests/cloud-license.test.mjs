import test from 'node:test'
import assert from 'node:assert/strict'
import { getPublicKey } from '@noble/ed25519'
import { issueLicenseToken } from '../vet-pos-licensing-worker/src/index.js'
import { verifyLicenseText } from '../src/utils/licenseCore.js'

test('Cloudflare issuer creates an SFP1 license accepted by Vet POS', async () => {
  const privateKeyHex = '1f'.repeat(32)
  const publicKeyHex = Buffer.from(getPublicKey(Uint8Array.from({ length: 32 }, () => 0x1f))).toString('hex')
  const installationId = '550e8400-e29b-41d4-a716-446655440000'
  const token = issueLicenseToken({
    installationId,
    customerName: 'Sample Veterinary Clinic',
    issuedAt: '2026-09-02',
    expiresAt: '2026-10-17',
    paymentRequestId: 'payreq_test',
    plan: 'standard',
  }, privateKeyHex)

  const result = await verifyLicenseText(token, {
    publicKeyHex,
    installationId,
    today: '2026-09-03',
  })

  assert.equal(result.valid, true)
  assert.equal(result.payload.customer, 'Sample Veterinary Clinic')
  assert.equal(result.payload.paymentRequestId, 'payreq_test')
})
