import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { getPublicKeyAsync, signAsync } from '@noble/ed25519'
import { checkDateRollback, verifyLicenseText } from '../src/utils/licenseCore.js'

function base64Url(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function bytesToHex(bytes) {
  return Buffer.from(bytes).toString('hex')
}

async function createLicense(overrides = {}) {
  const privateKey = randomBytes(32)
  const publicKey = await getPublicKeyAsync(privateKey)
  const payload = {
    v: 1,
    product: 'stockflow-pos',
    licenseId: randomUUID(),
    installationId: 'install-123',
    issuedAt: '2026-06-28',
    expiresAt: '2027-06-28',
    ...overrides,
  }
  const payloadPart = base64Url(JSON.stringify(payload))
  const signingInput = `SFP1.${payloadPart}`
  const signature = await signAsync(new TextEncoder().encode(signingInput), privateKey)
  return {
    license: `${signingInput}.${base64Url(signature)}`,
    publicKeyHex: bytesToHex(publicKey),
    installationId: payload.installationId,
  }
}

test('valid license for matching installation ID', async () => {
  const fixture = await createLicense()
  const result = await verifyLicenseText(fixture.license, {
    publicKeyHex: fixture.publicKeyHex,
    installationId: fixture.installationId,
    today: '2026-06-28',
  })
  assert.equal(result.valid, true)
  assert.equal(result.payload.product, 'stockflow-pos')
})

test('invalid signature is rejected', async () => {
  const fixture = await createLicense()
  const signatureStart = fixture.license.lastIndexOf('.') + 1
  const replacement = fixture.license[signatureStart] === 'A' ? 'B' : 'A'
  const tampered = `${fixture.license.slice(0, signatureStart)}${replacement}${fixture.license.slice(signatureStart + 1)}`
  const result = await verifyLicenseText(tampered, {
    publicKeyHex: fixture.publicKeyHex,
    installationId: fixture.installationId,
    today: '2026-06-28',
  })
  assert.equal(result.valid, false)
  assert.equal(result.reason, 'License signature is invalid.')
})

test('expired license is rejected', async () => {
  const fixture = await createLicense({ expiresAt: '2026-06-27' })
  const result = await verifyLicenseText(fixture.license, {
    publicKeyHex: fixture.publicKeyHex,
    installationId: fixture.installationId,
    today: '2026-06-28',
  })
  assert.equal(result.valid, false)
  assert.equal(result.reason, 'License expired.')
})

test('wrong product is rejected', async () => {
  const fixture = await createLicense({ product: 'other-product' })
  const result = await verifyLicenseText(fixture.license, {
    publicKeyHex: fixture.publicKeyHex,
    installationId: fixture.installationId,
    today: '2026-06-28',
  })
  assert.equal(result.valid, false)
  assert.equal(result.reason, 'License is for a different product.')
})

test('wrong installation ID is rejected', async () => {
  const fixture = await createLicense()
  const result = await verifyLicenseText(fixture.license, {
    publicKeyHex: fixture.publicKeyHex,
    installationId: 'other-installation',
    today: '2026-06-28',
  })
  assert.equal(result.valid, false)
  assert.equal(result.reason, 'License is assigned to another installation.')
})

test('malformed license text is rejected', async () => {
  const result = await verifyLicenseText('not-a-license', {
    publicKeyHex: '00'.repeat(32),
    installationId: 'install-123',
    today: '2026-06-28',
  })
  assert.equal(result.valid, false)
  assert.equal(result.reason, 'License format is invalid.')
})

test('date rollback detection rejects dates moved backward by more than one day', () => {
  const result = checkDateRollback('2026-06-28', '2026-06-26')
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'Device date moved backward. Correct the date and try again.')
})
