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
let dbPromise = null

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
  const products = readJson(STORAGE_KEYS.products, DEFAULT_RECORDS.products)
  const savedCategories = readJson(STORAGE_KEYS.categories, DEFAULT_RECORDS.categories)
  const productCategories = products.map(product => product.cat).filter(Boolean)
  const receiptSettings = readJson(STORAGE_KEYS.receiptSettings, DEFAULT_RECORDS.receiptSettings)

  return {
    products,
    sales: readJson(STORAGE_KEYS.sales, DEFAULT_RECORDS.sales),
    clients: readJson(STORAGE_KEYS.clients, DEFAULT_RECORDS.clients),
    expenses: readJson(STORAGE_KEYS.expenses, DEFAULT_RECORDS.expenses),
    cashDrawer: readJson(STORAGE_KEYS.cashDrawer, DEFAULT_RECORDS.cashDrawer),
    categories: [...new Set([...DEFAULT_CATEGORIES, ...savedCategories, ...productCategories])].sort(),
    receiptSettings: { ...DEFAULT_RECEIPT_SETTINGS, ...receiptSettings },
    orders: readJson(STORAGE_KEYS.orders, DEFAULT_RECORDS.orders),
    activeOrderId: readJson(STORAGE_KEYS.activeOrderId, DEFAULT_RECORDS.activeOrderId),
  }
}

export function saveClinicRecords(records) {
  Object.entries(STORAGE_KEYS).forEach(([recordKey, storageKey]) => {
    if (Object.hasOwn(records, recordKey)) {
      writeJson(storageKey, records[recordKey])
    }
  })
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
  const db = await getDatabase()
  if (!db) return localRecords

  const hasRows = await db.query(`SELECT key FROM ${RECORD_TABLE} LIMIT 1`)
  if (!hasRows.values?.length) {
    await saveClinicRecordsAsync(localRecords)
    return localRecords
  }

  const products = await readSqlRecord(db, 'products', DEFAULT_RECORDS.products)
  const savedCategories = await readSqlRecord(db, 'categories', DEFAULT_RECORDS.categories)
  const productCategories = products.map(product => product.cat).filter(Boolean)
  const receiptSettings = await readSqlRecord(db, 'receiptSettings', DEFAULT_RECORDS.receiptSettings)
  const records = {
    products,
    sales: await readSqlRecord(db, 'sales', DEFAULT_RECORDS.sales),
    clients: await readSqlRecord(db, 'clients', DEFAULT_RECORDS.clients),
    expenses: await readSqlRecord(db, 'expenses', DEFAULT_RECORDS.expenses),
    cashDrawer: await readSqlRecord(db, 'cashDrawer', DEFAULT_RECORDS.cashDrawer),
    categories: [...new Set([...DEFAULT_CATEGORIES, ...savedCategories, ...productCategories])].sort(),
    receiptSettings: { ...DEFAULT_RECEIPT_SETTINGS, ...receiptSettings },
    orders: await readSqlRecord(db, 'orders', localRecords.orders),
    activeOrderId: await readSqlRecord(db, 'activeOrderId', localRecords.activeOrderId),
  }

  saveClinicRecords(records)
  return records
}

export async function saveClinicRecordsAsync(records) {
  saveClinicRecords(records)

  const db = await getDatabase()
  if (!db) return

  await Promise.all(
    Object.keys(STORAGE_KEYS)
      .filter(recordKey => Object.hasOwn(records, recordKey))
      .map(recordKey => writeSqlRecord(db, recordKey, records[recordKey]))
  )
}

export async function saveClinicRecordAsync(recordKey, value) {
  const storageKey = STORAGE_KEYS[recordKey]
  if (!storageKey) throw new Error(`Unknown clinic record: ${recordKey}`)

  writeJson(storageKey, value)

  const db = await getDatabase()
  if (!db) return
  await writeSqlRecord(db, recordKey, value)
}
