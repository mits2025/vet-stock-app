import { Capacitor } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'
import { LICENSE_PUBLIC_KEY_HEX } from '../config/licensePublicKey.js'
import { todayDateString, verifyLicenseText } from './licenseCore.js'

export const INSTALLATION_ID_KEY = 'stockflow-installation-id'
export const LICENSE_RECORD_KEY = 'stockflow-license-record'
export const LATEST_OBSERVED_DATE_KEY = 'stockflow-license-latest-date'

const browserStorage = {
  async get(key) {
    return localStorage.getItem(key)
  },
  async set(key, value) {
    localStorage.setItem(key, value)
  },
}

const preferencesStorage = {
  async get(key) {
    const result = await Preferences.get({ key })
    return result.value
  },
  async set(key, value) {
    await Preferences.set({ key, value })
  },
}

function storageAdapter() {
  return Capacitor.isNativePlatform() ? preferencesStorage : browserStorage
}

async function getStoredJson(key) {
  const stored = await storageAdapter().get(key)
  if (!stored) return null
  try {
    return JSON.parse(stored)
  } catch {
    return null
  }
}

async function setStoredJson(key, value) {
  await storageAdapter().set(key, JSON.stringify(value))
}

async function getLatestObservedDate() {
  return storageAdapter().get(LATEST_OBSERVED_DATE_KEY)
}

async function updateLatestObservedDate(today = todayDateString()) {
  const latest = await getLatestObservedDate()
  if (!latest || today > latest) {
    await storageAdapter().set(LATEST_OBSERVED_DATE_KEY, today)
  }
}

export async function getInstallationId() {
  const saved = await storageAdapter().get(INSTALLATION_ID_KEY)
  if (saved) return saved

  const installationId = crypto.randomUUID()
  await storageAdapter().set(INSTALLATION_ID_KEY, installationId)
  return installationId
}

export async function loadLicenseRecord() {
  return getStoredJson(LICENSE_RECORD_KEY)
}

export async function verifyLicense(license) {
  const installationId = await getInstallationId()
  const today = todayDateString()
  const latestObservedDate = await getLatestObservedDate()
  const result = await verifyLicenseText(license, {
    publicKeyHex: LICENSE_PUBLIC_KEY_HEX,
    installationId,
    today,
    latestObservedDate,
  })

  if (result.valid) await updateLatestObservedDate(today)
  return result
}

export async function activateLicense(license) {
  const result = await verifyLicense(license)
  if (!result.valid) return result

  const record = {
    license,
    activatedAt: new Date().toISOString(),
    licenseId: result.payload.licenseId,
    expiresAt: result.payload.expiresAt,
  }
  await setStoredJson(LICENSE_RECORD_KEY, record)
  return { valid: true, payload: result.payload, record }
}

export async function verifySavedLicense() {
  const record = await loadLicenseRecord()
  if (!record?.license) {
    return { valid: false, reason: 'License is missing.' }
  }

  const result = await verifyLicense(record.license)
  if (!result.valid) return result
  return { valid: true, payload: result.payload, record }
}
