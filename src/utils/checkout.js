function addQuantity(map, productId, quantity) {
  const normalized = Number(quantity)
  if (!productId || !Number.isFinite(normalized) || normalized <= 0) return
  map.set(productId, (map.get(productId) || 0) + normalized)
}

export function stockRequirements(items, products) {
  const productsById = new Map(products.map(product => [product.id, product]))
  const required = new Map()
  for (const item of items || []) {
    const product = productsById.get(item.productId)
    const quantity = Number(item.qty)
    if (!product || !Number.isFinite(quantity) || quantity <= 0) {
      return { valid: false, required, invalidItem: item }
    }
    if (product.trackStock !== false) addQuantity(required, product.id, quantity)
    if (product.trackStock === false) {
      addQuantity(required, product.consumesProductId, quantity * Number(product.consumptionPerSale || 0))
    }
  }
  return { valid: true, required }
}

export function validateCheckoutStock({ items, products, orders = [], activeOrderId = '' }) {
  const current = stockRequirements(items, products)
  if (!current.valid) return { valid: false, reason: 'invalid-item', item: current.invalidItem }

  const productsById = new Map(products.map(product => [product.id, product]))
  const reserved = new Map()
  for (const order of orders) {
    if (order.id === activeOrderId) continue
    const orderRequirements = stockRequirements(order.cart || [], products)
    if (!orderRequirements.valid) continue
    for (const [productId, quantity] of orderRequirements.required) addQuantity(reserved, productId, quantity)
  }

  for (const [productId, required] of current.required) {
    const product = productsById.get(productId)
    const available = (Number(product?.qty) || 0) - (reserved.get(productId) || 0)
    if (!product || required > available + 1e-9) {
      return { valid: false, reason: 'shortage', product, required, available: Math.max(0, available) }
    }
  }
  return { valid: true, required: current.required, reserved }
}
