import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { signAsync } from '@noble/ed25519'

const PRODUCT = 'stockflow-pos'

function isDateString(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))
}

function todayDateString() {
  const date = new Date()
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function base64Url(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function hexToBytes(hex) {
  const clean = String(hex || '').trim().replace(/[^a-fA-F0-9]/g, '')
  if (clean.length !== 64) {
    throw new Error('Private key must be 32 bytes encoded as 64 hex characters.')
  }
  return Uint8Array.from(clean.match(/.{2}/g).map(byte => Number.parseInt(byte, 16)))
}

const [installationId, expiresAt] = process.argv.slice(2)

if (!installationId?.trim()) {
  console.error('Usage: node scripts/issue-license.mjs "<installation-id>" "2027-06-28"')
  console.error('Missing installation ID.')
  process.exit(1)
}

if (!isDateString(expiresAt)) {
  console.error('Usage: node scripts/issue-license.mjs "<installation-id>" "2027-06-28"')
  console.error('Expiry date must be YYYY-MM-DD.')
  process.exit(1)
}

const privateKeyPath = resolve('licenses/private-key.hex')
let privateKey

try {
  privateKey = hexToBytes(await readFile(privateKeyPath, 'utf8'))
} catch {
  console.error(`Could not read signing key at ${privateKeyPath}.`)
  console.error('Run: node scripts/generate-license-keys.mjs')
  process.exit(1)
}

const payload = {
  v: 1,
  product: PRODUCT,
  licenseId: randomUUID(),
  installationId: installationId.trim(),
  issuedAt: todayDateString(),
  expiresAt,
}

const payloadPart = base64Url(JSON.stringify(payload))
const signingInput = `SFP1.${payloadPart}`
const signature = await signAsync(new TextEncoder().encode(signingInput), privateKey)
const signaturePart = base64Url(signature)

console.log(`${signingInput}.${signaturePart}`)
