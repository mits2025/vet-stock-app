const PBKDF2_ITERATIONS = 310000
const THROTTLE_PREFIX = 'vet-auth-throttle:'

function bytesToHex(bytes) {
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('')
}

function createSalt() {
  const values = new Uint8Array(16)
  crypto.getRandomValues(values)
  return bytesToHex(values)
}

async function legacyHash(password, salt) {
  const encoded = new TextEncoder().encode(`${salt}:${password}`)
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoded)))
}

async function pbkdf2Hash(password, salt, iterations = PBKDF2_ITERATIONS) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({
    name: 'PBKDF2',
    hash: 'SHA-256',
    salt: new TextEncoder().encode(salt),
    iterations,
  }, key, 256)
  return bytesToHex(new Uint8Array(bits))
}

function constantTimeEqual(left = '', right = '') {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  return difference === 0
}

export function parsePasswordRecord(raw) {
  try {
    const record = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!record || typeof record !== 'object') return null
    if (!/^[a-f0-9]{32}$/i.test(record.salt || '') || !/^[a-f0-9]{64}$/i.test(record.hash || '')) return null
    if (record.kdf && (record.kdf !== 'pbkdf2-sha256' || !Number.isSafeInteger(record.iterations))) return null
    return record
  } catch {
    return null
  }
}

export async function createPasswordRecord(password) {
  const salt = createSalt()
  return {
    kdf: 'pbkdf2-sha256',
    iterations: PBKDF2_ITERATIONS,
    salt,
    hash: await pbkdf2Hash(password, salt),
    createdAt: new Date().toISOString(),
  }
}

export async function verifyPassword(password, record) {
  const parsed = parsePasswordRecord(record)
  if (!parsed) return { valid: false }
  const candidate = parsed.kdf === 'pbkdf2-sha256'
    ? await pbkdf2Hash(password, parsed.salt, parsed.iterations)
    : await legacyHash(password, parsed.salt)
  const valid = constantTimeEqual(candidate, parsed.hash)
  return {
    valid,
    upgradedRecord: valid && !parsed.kdf ? await createPasswordRecord(password) : null,
  }
}

function readThrottle(scope) {
  try {
    const value = JSON.parse(localStorage.getItem(`${THROTTLE_PREFIX}${scope}`) || 'null')
    return value && typeof value === 'object' ? value : { failures: 0, blockedUntil: 0, lastFailure: 0 }
  } catch {
    return { failures: 0, blockedUntil: 0, lastFailure: 0 }
  }
}

export function authThrottleStatus(scope, now = Date.now()) {
  const record = readThrottle(scope)
  return { blocked: Number(record.blockedUntil) > now, retryAfterSeconds: Math.max(0, Math.ceil((Number(record.blockedUntil) - now) / 1000)) }
}

export function recordAuthFailure(scope, now = Date.now()) {
  const previous = readThrottle(scope)
  const failures = now - Number(previous.lastFailure || 0) > 30 * 60 * 1000 ? 1 : Number(previous.failures || 0) + 1
  const delaySeconds = failures >= 5 ? Math.min(300, 30 * (2 ** (failures - 5))) : 0
  const next = { failures, lastFailure: now, blockedUntil: now + delaySeconds * 1000 }
  localStorage.setItem(`${THROTTLE_PREFIX}${scope}`, JSON.stringify(next))
  return { retryAfterSeconds: delaySeconds }
}

export function clearAuthThrottle(scope) {
  localStorage.removeItem(`${THROTTLE_PREFIX}${scope}`)
}
