import { useCallback, useMemo, useState } from 'react'
import { getUsageInLastDays } from '../utils/usage'

const money = value => `PHP ${Number(value || 0).toFixed(2)}`
const withUnit = (value, unit) => unit ? `${value} ${unit}` : String(value)
const priceLabel = item => item.unit ? `${money(item.price)} / ${item.unit}` : money(item.price)
const tracksStock = product => product.trackStock !== false
const consumesStock = product => product.trackStock === false && product.consumesProductId && Number(product.consumptionPerSale) > 0
const OVERSTOCK_REORDER_MULTIPLE = 3
const LOW_USAGE_WEEKLY_THRESHOLD = 1
const PAYMENT_OPTIONS = ['Cash', 'GCash', 'Bank transfer', 'Card']
const discountAmount = (lineSubtotal, value) => {
  const percent = Math.min(100, Math.max(0, Number(value) || 0))
  return lineSubtotal * (percent / 100)
}
const defaultClientLabel = () => `Client ${new Date().toLocaleString('en-PH', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})}`

export default function POS({
  products,
  sales,
  clients = [],
  orders,
  activeOrderId,
  setOrders,
  setActiveOrderId,
  onCompleteSale,
  onEditProduct,
  onRestockProduct,
  onSaveClient,
}) {
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState('All')
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState('Cash')
  const [clientModalOpen, setClientModalOpen] = useState(false)
  const [clientDraftName, setClientDraftName] = useState('')
  const [clientSuggestionsOpen, setClientSuggestionsOpen] = useState(false)
  const activeOrder = orders.find(order => order.id === activeOrderId) || orders[0]
  const cart = activeOrder?.cart || []
  const itemDiscounts = activeOrder?.itemDiscounts || {}
  const clientSuggestions = clients
    .filter(client => {
      const term = clientDraftName.trim().toLowerCase()
      return !term || client.name.toLowerCase().includes(term)
    })
    .slice(0, 5)

  const categories = useMemo(() => {
    const unique = [...new Set(products.map(product => product.cat).filter(Boolean))].sort()
    return ['All', ...unique]
  }, [products])

  const productsById = useMemo(
    () => products.reduce((map, product) => ({ ...map, [product.id]: product }), {}),
    [products]
  )

  const getServiceCapacity = useCallback(product => {
    if (!consumesStock(product)) return Infinity
    const source = productsById[product.consumesProductId]
    const perSale = Number(product.consumptionPerSale) || 0
    if (!source || perSale <= 0) return 0
    return Math.floor((Number(source.qty) || 0) / perSale)
  }, [productsById])

  function getStockSourceLabel(product) {
    const source = productsById[product.consumesProductId]
    if (!source) return ''
    return `${Number(product.consumptionPerSale)} ${source.unit || 'unit'} ${source.name}`
  }

  const counterProducts = useMemo(
    () => [...products]
      .sort((a, b) => {
        const aAvailable = tracksStock(a) ? Number(a.qty) > 0 : getServiceCapacity(a) > 0
        const bAvailable = tracksStock(b) ? Number(b.qty) > 0 : getServiceCapacity(b) > 0
        const stockDiff = Number(bAvailable) - Number(aAvailable)
        if (stockDiff !== 0) return stockDiff

        const soldDiff = (Number(b.sold) || 0) - (Number(a.sold) || 0)
        if (soldDiff !== 0) return soldDiff

        const recentDiff = getUsageInLastDays(b) - getUsageInLastDays(a)
        if (recentDiff !== 0) return recentDiff

        return a.name.localeCompare(b.name)
      }),
    [products, getServiceCapacity]
  )

  const filteredProducts = counterProducts.filter(product => {
    const term = search.trim().toLowerCase()
    const matchesSearch = !term
      || product.name.toLowerCase().includes(term)
      || product.cat.toLowerCase().includes(term)
    const matchesCategory = activeCategory === 'All' || product.cat === activeCategory
    return matchesSearch && matchesCategory
  })

  const subtotal = cart.reduce((sum, item) => sum + item.qty * item.price, 0)
  const discountTotal = cart.reduce((sum, item) => {
    const lineSubtotal = item.qty * item.price
    return sum + discountAmount(lineSubtotal, itemDiscounts[item.productId])
  }, 0)
  const total = Math.max(0, subtotal - discountTotal)
  const itemCount = cart.reduce((sum, item) => sum + item.qty, 0)
  const todayKey = new Date().toISOString().slice(0, 10)
  const todaySales = sales.filter(sale => !sale.voided && sale.date?.slice(0, 10) === todayKey)
  const todayRevenue = todaySales.reduce((sum, sale) => sum + (Number(sale.total) || 0), 0)

  function updateActiveOrder(updater) {
    setOrders(prev => prev.map(order => {
      if (order.id !== activeOrderId) return order
      return { ...order, ...updater(order) }
    }))
  }

  function setActiveCart(updater) {
    updateActiveOrder(order => ({
      cart: typeof updater === 'function' ? updater(order.cart) : updater,
    }))
  }

  function setActiveDiscounts(updater) {
    updateActiveOrder(order => ({
      itemDiscounts: typeof updater === 'function' ? updater(order.itemDiscounts) : updater,
    }))
  }

  function openClientModal() {
    setClientDraftName('')
    setClientSuggestionsOpen(false)
    setClientModalOpen(true)
  }

  function addOrderPage() {
    const clientName = clientDraftName.trim()
    const label = clientName || defaultClientLabel()
    const order = {
      id: `client-${Date.now()}`,
      label,
      clientName,
      cart: [],
      itemDiscounts: {},
    }
    setOrders(prev => [...prev, order])
    setActiveOrderId(order.id)
    setCheckoutOpen(false)
    setClientModalOpen(false)
    setClientDraftName('')
    setClientSuggestionsOpen(false)
    if (clientName && onSaveClient) onSaveClient(clientName)
  }

  function removeOrderPage(orderId) {
    if (orders.length === 1) {
      setOrders([])
      setActiveOrderId('')
      setCheckoutOpen(false)
      return
    }

    const remaining = orders.filter(order => order.id !== orderId)
    setOrders(remaining)
    if (activeOrderId === orderId) {
      setActiveOrderId(remaining[0].id)
      setCheckoutOpen(false)
    }
  }

  function addToCart(product) {
    if (!activeOrder) {
      setClientModalOpen(true)
      return
    }

    const price = Number(product.price) || 0
    if (price <= 0) {
      alert('Add a sale price to this product before selling it.')
      return
    }

    setActiveCart(prev => {
      const existing = prev.find(item => item.productId === product.id)
      const stockAvailable = tracksStock(product) ? (Number(product.qty) || 0) : getServiceCapacity(product)
      if (existing) {
        if (Number.isFinite(stockAvailable) && existing.qty >= stockAvailable) return prev
        return prev.map(item => item.productId === product.id ? { ...item, qty: item.qty + 1 } : item)
      }

      const consumedProduct = productsById[product.consumesProductId]
      return [
        ...prev,
        {
          productId: product.id,
          name: product.name,
          category: product.cat,
          unit: product.unit,
          trackStock: product.trackStock !== false,
          consumesProductId: product.consumesProductId || '',
          consumedProductName: consumedProduct?.name || '',
          consumedProductUnit: consumedProduct?.unit || '',
          consumptionPerSale: Number(product.consumptionPerSale) || 0,
          price,
          qty: 1,
          stockAvailable,
        },
      ]
    })
  }

  function updateQty(productId, nextQty) {
    setActiveCart(prev => prev.flatMap(item => {
      if (item.productId !== productId) return [item]
      const qty = Math.max(0, Math.min(Number(nextQty) || 0, item.stockAvailable))
      return qty === 0 ? [] : [{ ...item, qty }]
    }))
  }

  function adjustQty(productId, delta) {
    const item = cart.find(cartItem => cartItem.productId === productId)
    if (!item) return
    updateQty(productId, item.qty + delta)
  }

  function clearCart() {
    if (!activeOrder || cart.length === 0) return
    if (confirm('Clear the current cart?')) {
      setActiveCart([])
      setActiveDiscounts({})
      setCheckoutOpen(false)
    }
  }

  function openCheckout() {
    if (!activeOrder) {
      setClientModalOpen(true)
      return
    }

    if (cart.length === 0) {
      alert('Add at least one product to the cart.')
      return
    }
    setCheckoutOpen(true)
  }

  function setItemDiscount(productId, value) {
    setActiveDiscounts(prev => ({ ...prev, [productId]: value }))
  }

  function checkoutOrder() {
    if (cart.length === 0) {
      alert('Add at least one product to the cart.')
      setCheckoutOpen(false)
      return
    }

    onCompleteSale({
      items: cart.map(item => {
        const lineSubtotal = item.qty * item.price
        const discountPercent = Math.min(100, Math.max(0, Number(itemDiscounts[item.productId]) || 0))
        const discount = discountAmount(lineSubtotal, discountPercent)
        return {
          productId: item.productId,
          name: item.name,
          unit: item.unit,
          price: item.price,
          qty: item.qty,
          consumesProductId: item.consumesProductId,
          consumedProductName: item.consumedProductName,
          consumedProductUnit: item.consumedProductUnit,
          consumptionPerSale: item.consumptionPerSale,
          discount,
          discountPercent,
          lineSubtotal,
          lineTotal: Math.max(0, lineSubtotal - discount),
        }
      }),
      paymentMethod,
      discount: discountTotal,
      clientName: activeOrder?.clientName?.trim() || '',
    })
    if (activeOrder) removeOrderPage(activeOrder.id)
    setCheckoutOpen(false)
    setPaymentMethod('Cash')
  }

  function handleProductTile(product) {
    if (tracksStock(product) && Number(product.qty) <= 0) {
      if (onEditProduct) onEditProduct(product)
      return
    }

    if (!tracksStock(product) && getServiceCapacity(product) <= 0) {
      if (onEditProduct) onEditProduct(product)
      return
    }

    if (Number(product.price) > 0) {
      addToCart(product)
      return
    }

    if (onEditProduct) onEditProduct(product)
  }

  function handleTileKeyDown(event, product) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      handleProductTile(product)
    }
  }

  if (checkoutOpen) {
    return (
      <div className="checkout-page">
        <section className="checkout-main">
          <div className="checkout-page-header">
            <div>
              <span className="eyebrow">Payment step</span>
              <h3>Checkout</h3>
              <p>Review the order, apply item discounts, then choose the buyer payment mode.</p>
            </div>
            <button onClick={() => setCheckoutOpen(false)} className="secondary-page-button danger-page-button">Back to POS</button>
          </div>

          <div className="checkout-item-list">
            {cart.map(item => {
              const lineSubtotal = item.qty * item.price
              const discountPercent = Math.min(100, Math.max(0, Number(itemDiscounts[item.productId]) || 0))
              const discount = discountAmount(lineSubtotal, discountPercent)
              const lineTotal = Math.max(0, lineSubtotal - discount)
              return (
                <div key={item.productId} className="checkout-item-row">
                  <div>
                    <strong>{item.name}</strong>
                    <span>{item.qty} x {priceLabel(item)}</span>
                  </div>
                  <label>
                    Discount %
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="1"
                      value={itemDiscounts[item.productId] ?? ''}
                      onChange={event => setItemDiscount(item.productId, event.target.value)}
                      placeholder="0"
                    />
                  </label>
                  <div className="checkout-line-total">
                    <span>{discount > 0 ? `${money(lineSubtotal)} - ${discountPercent}% (${money(discount)})` : money(lineSubtotal)}</span>
                    <strong>{money(lineTotal)}</strong>
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        <aside className="checkout-payment-panel">
          <div>
            <span className="eyebrow">Buyer payment</span>
            <h3>Total due</h3>
          </div>

          <div className="payment-mode-buttons" aria-label="Payment mode">
            {PAYMENT_OPTIONS.map(option => (
              <button
                key={option}
                type="button"
                onClick={() => setPaymentMethod(option)}
                className={[
                  'payment-mode-button',
                  `payment-${option.toLowerCase().replace(/\s+/g, '-')}`,
                  paymentMethod === option ? 'active' : '',
                ].filter(Boolean).join(' ')}
                aria-pressed={paymentMethod === option}
              >
                {option}
              </button>
            ))}
          </div>

          <div className="totals-panel">
            <div><span>Subtotal</span><strong>{money(subtotal)}</strong></div>
            <div><span>Item discounts</span><strong>-{money(discountTotal)}</strong></div>
            <div className="grand-total"><span>Total</span><strong>{money(total)}</strong></div>
          </div>

          <button onClick={checkoutOrder} className="complete-sale-button">
            Confirm payment
          </button>
        </aside>
      </div>
    )
  }

  return (
    <>
      <div className="order-page-strip" aria-label="Client order pages">
        {orders.map(order => {
          const orderCount = order.cart.reduce((sum, item) => sum + item.qty, 0)
          const orderTotal = order.cart.reduce((sum, item) => sum + item.qty * item.price, 0)
          const isActive = order.id === activeOrderId
          const tabLabel = order.clientName?.trim() || order.label
          return (
            <div
              key={order.id}
              role="button"
              tabIndex={0}
              onClick={() => { setActiveOrderId(order.id); setCheckoutOpen(false) }}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  setActiveOrderId(order.id)
                  setCheckoutOpen(false)
                }
              }}
              className={isActive ? 'order-page-tab active' : 'order-page-tab'}
            >
              <span>
                <strong>{tabLabel}</strong>
                <small>{orderCount} items | {money(orderTotal)}</small>
              </span>
              <span
                role="button"
                tabIndex={0}
                className="order-close"
                onClick={event => {
                  event.stopPropagation()
                  removeOrderPage(order.id)
                }}
                onKeyDown={event => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    event.stopPropagation()
                    removeOrderPage(order.id)
                  }
                }}
              >
                x
              </span>
            </div>
          )
        })}
        <button type="button" onClick={openClientModal} className="add-order-tab">
          <span className="add-order-plus" aria-hidden="true">+</span>
          <span>Add client</span>
        </button>
      </div>

      <div className="pos-screen">
        <section className="pos-products-panel">
        <div className="pos-toolbar">
          <div className="pos-search-wrap">
            <label htmlFor="pos-search">Product search</label>
            <input
              id="pos-search"
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Search item or category"
              autoComplete="off"
            />
          </div>
          <div className="pos-today-strip">
            <div>
              <span>Today sales</span>
              <strong>{todaySales.length}</strong>
            </div>
            <div>
              <span>Revenue</span>
              <strong>{money(todayRevenue)}</strong>
            </div>
          </div>
        </div>

        <div className="category-scroll" aria-label="Product categories">
          {categories.map(category => (
            <button
              key={category}
              onClick={() => setActiveCategory(category)}
              className={activeCategory === category ? 'category-chip active' : 'category-chip'}
            >
              {category}
            </button>
          ))}
        </div>

        {products.length === 0 ? (
          <div className="empty-pos-state">
            <strong>No products yet</strong>
            <span>Add products with price and stock before using checkout.</span>
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="empty-pos-state">
            <strong>No matching in-stock products</strong>
            <span>Try another search or category.</span>
          </div>
        ) : (
          <div className="product-tile-grid">
            {filteredProducts.map(product => {
              const hasPrice = Number(product.price) > 0
              const isService = !tracksStock(product)
              const serviceCapacity = isService ? getServiceCapacity(product) : Infinity
              const serviceStockLabel = isService ? getStockSourceLabel(product) : ''
              const outOfStock = tracksStock(product) ? Number(product.qty) <= 0 : serviceCapacity <= 0
              const lowStock = tracksStock(product) && Number(product.qty) <= Number(product.reorder)
              const isOverstocked = tracksStock(product)
                && Number(product.reorder) > 0
                && Number(product.qty) >= Number(product.reorder) * OVERSTOCK_REORDER_MULTIPLE
                && getUsageInLastDays(product) <= LOW_USAGE_WEEKLY_THRESHOLD
              const tileClass = [
                'product-tile',
                !hasPrice ? 'missing-price' : '',
                outOfStock ? 'out-of-stock' : '',
                isOverstocked ? 'overstocked' : '',
              ].filter(Boolean).join(' ')
              return (
                <div
                  key={product.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleProductTile(product)}
                  onKeyDown={event => handleTileKeyDown(event, product)}
                  className={tileClass}
                >
                  <span className="tile-category">{product.cat}</span>
                  <strong>{product.name}</strong>
                  <span className="tile-meta">
                    <span>{isService ? (serviceStockLabel || 'Service') : withUnit(product.qty, product.unit)}</span>
                    {isService
                      ? <span className="service-pill">{Number.isFinite(serviceCapacity) ? `${serviceCapacity} left` : 'Service'}</span>
                      : outOfStock
                      ? <span className="out-stock-pill">Out</span>
                      : isOverstocked
                      ? <span className="overstock-pill">Overstock</span>
                      : lowStock && <span className="low-stock-pill">Low</span>}
                  </span>
                  <span className="tile-price">{hasPrice ? money(product.price) : 'Set price'}</span>
                  {outOfStock && (
                    <span className="tile-actions">
                      <button
                        type="button"
                        onClick={event => {
                          event.stopPropagation()
                          if (onEditProduct) onEditProduct(product)
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="tile-restock-button"
                        onClick={event => {
                          event.stopPropagation()
                          if (onRestockProduct) onRestockProduct(product)
                        }}
                      >
                        Restock
                      </button>
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

      <aside className="cart-panel">
        <div className="cart-header">
          <div>
            <span className="eyebrow">Pending order</span>
            <h3>Order summary</h3>
            <p>{activeOrder ? `${itemCount} ${itemCount === 1 ? 'item selected' : 'items selected'}` : 'Add client to begin order'}</p>
          </div>
          <button onClick={clearCart} disabled={cart.length === 0} className="clear-cart-button">
            Clear
          </button>
        </div>

        <div className="client-name-display">
          <span>Client</span>
          <strong>{activeOrder ? (activeOrder.clientName || activeOrder.label) : 'No client selected'}</strong>
        </div>

        <div className="cart-list">
          {!activeOrder ? (
            <div className="cart-empty">Tap Add client to start an order.</div>
          ) : cart.length === 0 ? (
            <div className="cart-empty">Tap products to build the order list.</div>
          ) : cart.map(item => (
            <div key={item.productId} className="cart-row">
              <div className="cart-row-title">
                <div>
                  <strong>{item.name}</strong>
                  <span>{priceLabel(item)}</span>
                </div>
                <strong>{money(item.qty * item.price)}</strong>
              </div>
              <div className="quantity-controls">
                <button onClick={() => adjustQty(item.productId, -1)}>-</button>
                <input
                  type="number"
                  min="1"
                  max={Number.isFinite(item.stockAvailable) ? item.stockAvailable : undefined}
                  value={item.qty}
                  onChange={event => updateQty(item.productId, event.target.value)}
                />
                <button onClick={() => adjustQty(item.productId, 1)}>+</button>
              </div>
            </div>
          ))}
        </div>

        <div className="totals-panel">
          <div className="grand-total order-summary-total"><span>Total</span><strong>{money(subtotal)}</strong></div>
        </div>

        <button onClick={openCheckout} disabled={cart.length === 0} className="complete-sale-button">
          Checkout
        </button>
      </aside>

      </div>

      {clientModalOpen && (
        <div className="client-modal-backdrop">
          <div className="client-modal" role="dialog" aria-modal="true" aria-labelledby="client-modal-title">
            <div>
              <span className="eyebrow">New order</span>
              <h3 id="client-modal-title">Add client</h3>
              <p>Client name is optional. Leave it blank to use the current date and time.</p>
            </div>

            <div className="client-combobox">
              <label className="client-name-field">
                <span>Client name <small>(optional)</small></span>
                <input
                  value={clientDraftName}
                  onFocus={() => setClientSuggestionsOpen(true)}
                  onClick={() => setClientSuggestionsOpen(true)}
                  onBlur={() => setTimeout(() => setClientSuggestionsOpen(false), 120)}
                  onChange={event => {
                    setClientDraftName(event.target.value)
                    setClientSuggestionsOpen(true)
                  }}
                  onKeyDown={event => {
                    if (event.key === 'Enter') addOrderPage()
                    if (event.key === 'Escape') {
                      setClientSuggestionsOpen(false)
                      setClientModalOpen(false)
                    }
                  }}
                  placeholder="Search or type client name"
                  autoComplete="off"
                  autoFocus
                />
              </label>

            {clientSuggestionsOpen && clientSuggestions.length > 0 && (
              <div className="client-suggestion-list" aria-label="Saved clients">
                {clientSuggestions.map(client => (
                  <button
                    key={client.id || client.name}
                    type="button"
                    onMouseDown={event => event.preventDefault()}
                    onClick={() => {
                      setClientDraftName(client.name)
                      setClientSuggestionsOpen(false)
                    }}
                  >
                    <span className="client-suggestion-mark">{client.name.slice(0, 1).toUpperCase()}</span>
                    <span>{client.name}</span>
                  </button>
                ))}
              </div>
            )}
            </div>

            <div className="client-modal-actions">
              <button type="button" onClick={() => setClientModalOpen(false)} className="secondary-page-button">
                Cancel
              </button>
              <button type="button" onClick={addOrderPage} className="complete-sale-button">
                Start order
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
