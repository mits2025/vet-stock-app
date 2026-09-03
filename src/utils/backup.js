export const BACKUP_SCHEMA = 'vet-pos-backup'
export const BACKUP_VERSION = 1
export const MAX_BACKUP_BYTES = 25 * 1024 * 1024

const MAX_COUNTS = { products: 100000, sales: 500000, clients: 100000, expenses: 500000, orders: 500 }

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function assertArray(records, key, validator) {
  const value = records[key] ?? []
  if (!Array.isArray(value) || value.length > MAX_COUNTS[key]) throw new Error(`Backup ${key} are invalid or exceed the safe limit.`)
  value.forEach((item, index) => {
    if (!isObject(item) || !validator(item)) throw new Error(`Backup ${key} contain an invalid record at position ${index + 1}.`)
  })
  return value
}

const hasId = item => ['string', 'number'].includes(typeof item.id)
const validName = item => hasId(item) && typeof item.name === 'string' && item.name.trim().length > 0 && item.name.length <= 300
const validSale = item => hasId(item) && typeof item.date === 'string' && Array.isArray(item.items) && item.items.length <= 1000
const validExpense = item => hasId(item) && typeof item.date === 'string' && Number.isFinite(Number(item.amount))
const validOrder = item => hasId(item) && Array.isArray(item.cart) && item.cart.length <= 1000

export function createBackup(records) {
  return {
    schema: BACKUP_SCHEMA,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    records,
  }
}

export function parseBackupText(text) {
  if (new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES) throw new Error('Backup exceeds the 25 MB safety limit.')
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('Backup is not valid JSON.')
  }

  let records
  let migrated = false
  if (Array.isArray(parsed)) {
    records = { products: parsed }
    migrated = true
  } else if (parsed?.schema === BACKUP_SCHEMA) {
    if (parsed.version !== BACKUP_VERSION || !isObject(parsed.records)) throw new Error('Backup version is not supported.')
    records = parsed.records
  } else if (isObject(parsed) && Array.isArray(parsed.products)) {
    records = parsed
    migrated = true
  } else {
    throw new Error('File is not a Vet POS backup.')
  }

  const normalized = {
    products: assertArray(records, 'products', validName),
    sales: assertArray(records, 'sales', validSale),
    clients: assertArray(records, 'clients', validName),
    expenses: assertArray(records, 'expenses', validExpense),
    orders: assertArray(records, 'orders', validOrder),
    cashDrawer: isObject(records.cashDrawer) ? records.cashDrawer : {},
    categories: Array.isArray(records.categories)
      ? records.categories.filter(item => typeof item === 'string' && item.trim() && item.length <= 100).slice(0, 1000)
      : [],
    receiptSettings: isObject(records.receiptSettings) ? records.receiptSettings : {},
    activeOrderId: typeof records.activeOrderId === 'string' ? records.activeOrderId : '',
  }
  if (normalized.activeOrderId && !normalized.orders.some(order => order.id === normalized.activeOrderId)) {
    normalized.activeOrderId = normalized.orders[0]?.id || ''
  }

  return {
    records: normalized,
    migrated,
    summary: Object.fromEntries(['products', 'sales', 'clients', 'expenses', 'orders'].map(key => [key, normalized[key].length])),
  }
}
