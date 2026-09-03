import test from 'node:test'
import assert from 'node:assert/strict'
import { validateCheckoutStock } from '../src/utils/checkout.js'

test('checkout rejects stock reserved by another open order', () => {
  const products = [{ id: 1, name: 'Vaccine', qty: 10, trackStock: true }]
  const result = validateCheckoutStock({
    products,
    items: [{ productId: 1, qty: 6 }],
    orders: [
      { id: 'active', cart: [{ productId: 1, qty: 6 }] },
      { id: 'other', cart: [{ productId: 1, qty: 5 }] },
    ],
    activeOrderId: 'active',
  })
  assert.equal(result.valid, false)
  assert.equal(result.reason, 'shortage')
})

test('checkout combines direct and service consumption from the same stock source', () => {
  const products = [
    { id: 1, name: 'Test strips', qty: 5, trackStock: true },
    { id: 2, name: 'Blood test', trackStock: false, consumesProductId: 1, consumptionPerSale: 2 },
  ]
  const result = validateCheckoutStock({
    products,
    items: [{ productId: 1, qty: 2 }, { productId: 2, qty: 2 }],
  })
  assert.equal(result.valid, false)
  assert.equal(result.required, 6)
  assert.equal(result.available, 5)
})

test('checkout accepts quantities that remain within live unreserved stock', () => {
  const products = [{ id: 1, name: 'Syringe', qty: 10, trackStock: true }]
  const result = validateCheckoutStock({
    products,
    items: [{ productId: 1, qty: 6 }],
    orders: [{ id: 'other', cart: [{ productId: 1, qty: 4 }] }],
    activeOrderId: 'active',
  })
  assert.equal(result.valid, true)
})
