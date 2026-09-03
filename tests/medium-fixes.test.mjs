import test from 'node:test'
import assert from 'node:assert/strict'
import { createPasswordRecord, parsePasswordRecord, verifyPassword } from '../src/utils/auth.js'
import { createBackup, parseBackupText } from '../src/utils/backup.js'
import { localDateString } from '../src/utils/date.js'

test('local date formatting does not shift an early-morning calendar day to UTC', () => {
  assert.equal(localDateString(new Date(2026, 8, 2, 1, 30)), '2026-09-02')
})

test('password records use PBKDF2 and reject corrupted storage', async () => {
  const record = await createPasswordRecord('correct horse battery staple')
  assert.equal(record.kdf, 'pbkdf2-sha256')
  assert.equal((await verifyPassword('correct horse battery staple', record)).valid, true)
  assert.equal((await verifyPassword('incorrect password', record)).valid, false)
  assert.equal(parsePasswordRecord('{broken'), null)
  assert.equal(parsePasswordRecord({ salt: 'bad', hash: 'bad' }), null)
})

test('versioned backups preserve open orders and validate record shapes', () => {
  const backup = createBackup({
    products: [{ id: 1, name: 'Vaccine', qty: 4 }],
    sales: [],
    clients: [],
    expenses: [],
    cashDrawer: {},
    categories: ['Vaccine'],
    receiptSettings: {},
    orders: [{ id: 'order-1', cart: [{ productId: 1, qty: 1 }] }],
    activeOrderId: 'order-1',
  })
  const result = parseBackupText(JSON.stringify(backup))
  assert.equal(result.records.orders.length, 1)
  assert.equal(result.records.activeOrderId, 'order-1')
  assert.throws(
    () => parseBackupText(JSON.stringify(createBackup({ products: [{ id: 1 }], sales: [], clients: [], expenses: [], orders: [] }))),
    /invalid record/
  )
})
