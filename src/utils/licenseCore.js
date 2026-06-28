import { verifyAsync } from '@noble/ed25519'

const LICENSE_PREFIX = 'SFP1'
export const LICENSE_PRODUCT = 'stockflow-pos'

export function todayDateString(now = new Date()) {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function normalizeLicenseText(value) {
  return String(value || '').trim()
}

export function isDateString(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))
}

function base64UrlToBytes(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  const binary = atob(padded)
  return Uint8Array.from(binary, character => character.charCodeAt(0))
}

function bytesToUtf8(bytes) {
  return new TextDecoder().decode(bytes)
}

function hexToBytes(hex) {
  const clean = String(hex || '').replace(/[^a-fA-F0-9]/g, '')
  if (clean.length % 2 !== 0) throw new Error('Invalid hex')
  return Uint8Array.from(clean.match(/.{2}/g)?.map(byte => Number.parseInt(byte, 16)) || [])
}

export function parseLicense(license) {
  const text = normalizeLicenseText(license)
  const parts = text.split('.')
  if (parts.length !== 3 || parts[0] !== LICENSE_PREFIX) {
    return { ok: false, reason: 'License format is invalid.' }
  }

  try {
    const payloadBytes = base64UrlToBytes(parts[1])
    const signatureBytes = base64UrlToBytes(parts[2])
    const payload = JSON.parse(bytesToUtf8(payloadBytes))
    return {
      ok: true,
      signingInput: `${parts[0]}.${parts[1]}`,
      payload,
      signatureBytes,
    }
  } catch {
    return { ok: false, reason: 'License payload is malformed.' }
  }
}

export function checkDateRollback(latestObservedDate, today = todayDateString()) {
  if (!latestObservedDate) return { ok: true }
  if (!isDateString(latestObservedDate) || !isDateString(today)) return { ok: true }

  const latest = Date.parse(`${latestObservedDate}T00:00:00Z`)
  const current = Date.parse(`${today}T00:00:00Z`)
  const daysBackward = Math.floor((latest - current) / 86400000)

  if (daysBackward > 1) {
    return {
      ok: false,
      reason: 'Device date moved backward. Correct the date and try again.',
    }
  }

  return { ok: true }
}

export async function verifyLicenseText(license, {
  publicKeyHex,
  installationId,
  today = todayDateString(),
  latestObservedDate = '',
} = {}) {
  if (!installationId) return { valid: false, reason: 'Installation ID is missing.' }
  if (!publicKeyHex) return { valid: false, reason: 'License public key is missing.' }

  const parsed = parseLicense(license)
  if (!parsed.ok) return { valid: false, reason: parsed.reason }

  const rollback = checkDateRollback(latestObservedDate, today)
  if (!rollback.ok) return { valid: false, reason: rollback.reason }

  try {
    const publicKey = hexToBytes(publicKeyHex)
    const message = new TextEncoder().encode(parsed.signingInput)
    const signatureOk = await verifyAsync(parsed.signatureBytes, message, publicKey)
    if (!signatureOk) return { valid: false, reason: 'License signature is invalid.' }
  } catch {
    return { valid: false, reason: 'License signature is invalid.' }
  }

  const { payload } = parsed
  if (payload?.v !== 1) return { valid: false, reason: 'License version is not supported.' }
  if (payload.product !== LICENSE_PRODUCT) return { valid: false, reason: 'License is for a different product.' }
  if (payload.installationId !== installationId) return { valid: false, reason: 'License is assigned to another installation.' }
  if (!isDateString(payload.expiresAt)) return { valid: false, reason: 'License expiry date is missing.' }
  if (payload.expiresAt < today) return { valid: false, reason: 'License expired.' }

  return { valid: true, payload }
}
