import { initialProducts } from '../data/initialProducts'
import { Capacitor } from '@capacitor/core'
import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite'

export const RECEIPT_SETTINGS_KEY = 'vet-receipt-settings'
export const DEFAULT_CATEGORIES = ['Medicine', 'Vaccine', 'Test Kits', 'Supplies', 'Food', 'Equipment', 'Service']

export const DEFAULT_RECEIPT_SETTINGS = {
  clinicName: 'Vet POS',
  address: '',
  phone: '',
  tin: '',
  email: '',
  footer: 'Thank you for your visit.',
  paperWidth: '80',
  logo: '',
}

const STORAGE_KEYS = {
  products: 'vet-products',
  sales: 'vet-sales',
  clients: 'vet-clients',
  expenses: 'vet-expenses',
  cashDrawer: 'vet-cash-drawer',
  categories: 'vet-categories',
  receiptSettings: RECEIPT_SETTINGS_KEY,
  orders: 'vet-open-orders',
  activeOrderId: 'vet-active-order-id',
}

const DEFAULT_RECORDS = {
  products: initialProducts,
  sales: [],
  clients: [],
  expenses: [],
  cashDrawer: {},
  categories: DEFAULT_CATEGORIES,
  receiptSettings: DEFAULT_RECEIPT_SETTINGS,
  orders: [],
  activeOrderId: '',
}

const DATABASE_NAME = 'vet_pos_clinic'
const RECORD_TABLE = 'app_records'
const SNAPSHOT_KEY = 'clinicSnapshot'
const LOCAL_SNAPSHOT_KEY = 'vet-clinic-snapshot-v1'
const LOCAL_SERVER_HEADER = { 'X-Vet-POS-Client': '1' }
let dbPromise = null
let saveQueue = Promise.resolve()

function readJson(key, fallback) {
  try {
    const saved = localStorage.getItem(key)
    return saved ? JSON.parse(saved) : fallback
  } catch {
    return fallback
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value))
}

export function loadClinicRecords() {
  const snapshot = readJson(LOCAL_SNAPSHOT_KEY, null)
  if (snapshot && typeof snapshot === 'object') return normalizeRecords(snapshot)

  return normalizeRecords(Object.fromEntries(
    Object.entries(STORAGE_KEYS).map(([recordKey, storageKey]) => [recordKey, readJson(storageKey, DEFAULT_RECORDS[recordKey])])
  ))
}

function normalizeRecords(records = {}) {
  const products = Array.isArray(records.products) ? records.products.filter(item => !item.stressTest) : DEFAULT_RECORDS.products
  const savedCategories = Array.isArray(records.categories) ? records.categories : DEFAULT_RECORDS.categories
  const productCategories = products.map(product => product.cat).filter(Boolean)
  const receiptSettings = records.receiptSettings && typeof records.receiptSettings === 'object'
    ? records.receiptSettings
    : DEFAULT_RECORDS.receiptSettings

  return {
    products,
    sales: Array.isArray(records.sales) ? records.sales.filter(item => !item.stressTest) : [],
    clients: Array.isArray(records.clients) ? records.clients.filter(item => !item.stressTest) : [],
    expenses: Array.isArray(records.expenses) ? records.expenses : [],
    cashDrawer: records.cashDrawer && typeof records.cashDrawer === 'object' ? records.cashDrawer : {},
    categories: [...new Set([...DEFAULT_CATEGORIES, ...savedCategories, ...productCategories])].sort(),
    receiptSettings: { ...DEFAULT_RECEIPT_SETTINGS, ...receiptSettings },
    orders: Array.isArray(records.orders) ? records.orders.filter(item => !item.stressTest) : [],
    activeOrderId: typeof records.activeOrderId === 'string' ? records.activeOrderId : '',
  }
}

function writeLocalSnapshot(records) {
  writeJson(LOCAL_SNAPSHOT_KEY, records)
  // Keep the legacy keys current so existing backups and downgrade recovery work.
  Object.entries(STORAGE_KEYS).forEach(([recordKey, storageKey]) => writeJson(storageKey, records[recordKey]))
}

export function saveClinicRecords(records) {
  const complete = normalizeRecords({ ...loadClinicRecords(), ...records })
  writeLocalSnapshot(complete)
}

async function getDesktopStorage() {
  return typeof window !== 'undefined' && window.vetPosStorage ? window.vetPosStorage : null
}

function isLocalServerApp() {
  if (typeof window === 'undefined' || Capacitor.isNativePlatform() || window.location.protocol !== 'http:') return false
  return window.location.port === '4200'
    && (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost')
}

async function loadLocalServerSnapshot() {
  if (!isLocalServerApp()) return undefined
  try {
    const response = await fetch('/api/snapshot', { headers: LOCAL_SERVER_HEADER, cache: 'no-store' })
    if (!response.ok) throw new Error(`Local server returned ${response.status}.`)
    return (await response.json()).snapshot
  } catch (error) {
    console.warn('Vet POS local server storage is unavailable; using browser storage.', error)
    return undefined
  }
}

async function saveLocalServerSnapshot(snapshot) {
  if (!isLocalServerApp()) return false
  const response = await fetch('/api/snapshot', {
    method: 'PUT',
    headers: { ...LOCAL_SERVER_HEADER, 'Content-Type': 'application/json' },
    body: JSON.stringify({ snapshot }),
  })
  if (!response.ok) throw new Error(`Could not save clinic data to the local server (${response.status}).`)
  return true
}

async function getDatabase() {
  if (!Capacitor.isNativePlatform()) return null
  if (dbPromise) return dbPromise

  dbPromise = (async () => {
    const sqlite = new SQLiteConnection(CapacitorSQLite)
    const hasConnection = await sqlite.isConnection(DATABASE_NAME, false)
    const connection = hasConnection.result
      ? await sqlite.retrieveConnection(DATABASE_NAME, false)
      : await sqlite.createConnection(DATABASE_NAME, false, 'no-encryption', 1, false)
    await connection.open()
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS ${RECORD_TABLE} (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `)
    return connection
  })()

  return dbPromise
}

async function readSqlRecord(db, recordKey, fallback) {
  const result = await db.query(`SELECT value FROM ${RECORD_TABLE} WHERE key = ? LIMIT 1`, [recordKey])
  const value = result.values?.[0]?.value
  if (!value) return fallback

  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

async function writeSqlRecord(db, recordKey, value) {
  await db.run(
    `INSERT OR REPLACE INTO ${RECORD_TABLE} (key, value, updated_at) VALUES (?, ?, ?)`,
    [recordKey, JSON.stringify(value), new Date().toISOString()]
  )
}

export async function loadClinicRecordsAsync() {
  const localRecords = loadClinicRecords()
  const desktopStorage = await getDesktopStorage()
  if (desktopStorage) {
    const snapshot = await desktopStorage.loadSnapshot()
    if (!snapshot) {
      await desktopStorage.saveSnapshot(localRecords)
      return localRecords
    }
    const records = normalizeRecords(snapshot)
    writeLocalSnapshot(records)
    return records
  }

  const serverSnapshot = await loadLocalServerSnapshot()
  if (serverSnapshot !== undefined) {
    if (!serverSnapshot) {
      await saveLocalServerSnapshot(localRecords)
      return localRecords
    }
    const records = normalizeRecords(serverSnapshot)
    writeLocalSnapshot(records)
    return records
  }

  const db = await getDatabase()
  if (!db) return localRecords

  const hasRows = await db.query(`SELECT key FROM ${RECORD_TABLE} LIMIT 1`)
  if (!hasRows.values?.length) {
    await saveClinicRecordsAsync(localRecords)
    return localRecords
  }

  const storedSnapshot = await readSqlRecord(db, SNAPSHOT_KEY, null)
  if (storedSnapshot) {
    const records = normalizeRecords(storedSnapshot)
    writeLocalSnapshot(records)
    return records
  }

  const products = (await readSqlRecord(db, 'products', DEFAULT_RECORDS.products)).filter(item => !item.stressTest)
  const savedCategories = await readSqlRecord(db, 'categories', DEFAULT_RECORDS.categories)
  const productCategories = products.map(product => product.cat).filter(Boolean)
  const receiptSettings = await readSqlRecord(db, 'receiptSettings', DEFAULT_RECORDS.receiptSettings)
  const records = {
    products,
    sales: (await readSqlRecord(db, 'sales', DEFAULT_RECORDS.sales)).filter(item => !item.stressTest),
    clients: (await readSqlRecord(db, 'clients', DEFAULT_RECORDS.clients)).filter(item => !item.stressTest),
    expenses: await readSqlRecord(db, 'expenses', DEFAULT_RECORDS.expenses),
    cashDrawer: await readSqlRecord(db, 'cashDrawer', DEFAULT_RECORDS.cashDrawer),
    categories: [...new Set([...DEFAULT_CATEGORIES, ...savedCategories, ...productCategories])].sort(),
    receiptSettings: { ...DEFAULT_RECEIPT_SETTINGS, ...receiptSettings },
    orders: (await readSqlRecord(db, 'orders', localRecords.orders)).filter(item => !item.stressTest),
    activeOrderId: await readSqlRecord(db, 'activeOrderId', localRecords.activeOrderId),
  }

  writeLocalSnapshot(records)
  await writeSnapshotTransaction(db, records)
  return records
}

async function writeSnapshotTransaction(db, records) {
  await db.execute('BEGIN IMMEDIATE TRANSACTION;')
  try {
    await writeSqlRecord(db, SNAPSHOT_KEY, records)
    await db.execute('COMMIT;')
  } catch (error) {
    await db.execute('ROLLBACK;').catch(() => {})
    throw error
  }
}

export function saveClinicRecordsAsync(records) {
  const snapshot = normalizeRecords(records)
  writeLocalSnapshot(snapshot)
  const operation = async () => {
    const desktopStorage = await getDesktopStorage()
    if (desktopStorage) return desktopStorage.saveSnapshot(snapshot)
    if (await saveLocalServerSnapshot(snapshot)) return
    const db = await getDatabase()
    if (db) await writeSnapshotTransaction(db, snapshot)
  }
  saveQueue = saveQueue.catch(() => {}).then(operation)
  return saveQueue
}

export async function saveClinicRecordAsync(recordKey, value) {
  const storageKey = STORAGE_KEYS[recordKey]
  if (!storageKey) throw new Error(`Unknown clinic record: ${recordKey}`)

  const records = { ...loadClinicRecords(), [recordKey]: value }
  return saveClinicRecordsAsync(records)
}
