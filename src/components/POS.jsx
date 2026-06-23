import { useMemo, useState } from 'react'
import { getUsageInLastDays } from '../utils/usage'

const money = value => `PHP ${Number(value || 0).toFixed(2)}`
const withUnit = (value, unit) => unit ? `${value} ${unit}` : String(value)
const priceLabel = item => item.unit ? `${money(item.price)} / ${item.unit}` : money(item.price)
const tracksStock = product => product.trackStock !== false

export default function POS({ products, sales, onCompleteSale, onEditProduct, onRestockProduct }) {
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState('All')
  const [cart, setCart] = useState([])
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState('Cash')
  const [itemDiscounts, setItemDiscounts] = useState({})

  const categories = useMemo(() => {
    const unique = [...new Set(products.map(product => product.cat).filter(Boolean))].sort()
    return ['All', ...unique]
  }, [products])

  const counterProducts = useMemo(
    () => products
      .sort((a, b) => {
        const aAvailable = !tracksStock(a) || Number(a.qty) > 0
        const bAvailable = !tracksStock(b) || Number(b.qty) > 0
        const stockDiff = Number(bAvailable) - Number(aAvailable)
        if (stockDiff !== 0) return stockDiff

        const soldDiff = (Number(b.sold) || 0) - (Number(a.sold) || 0)
        if (soldDiff !== 0) return soldDiff

        const recentDiff = getUsageInLastDays(b) - getUsageInLastDays(a)
        if (recentDiff !== 0) return recentDiff

        return a.name.localeCompare(b.name)
      }),
    [products]
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
    const discount = Math.min(lineSubtotal, Math.max(0, Number(itemDiscounts[item.productId]) || 0))
    return sum + discount
  }, 0)
  const total = Math.max(0, subtotal - discountTotal)
  const itemCount = cart.reduce((sum, item) => sum + item.qty, 0)
  const todayKey = new Date().toISOString().slice(0, 10)
  const todaySales = sales.filter(sale => sale.date?.slice(0, 10) === todayKey)
  const todayRevenue = todaySales.reduce((sum, sale) => sum + (Number(sale.total) || 0), 0)

  function addToCart(product) {
    const price = Number(product.price) || 0
    if (price <= 0) {
      alert('Add a sale price to this product before selling it.')
      return
    }

    setCart(prev => {
      const existing = prev.find(item => item.productId === product.id)
      if (existing) {
        if (tracksStock(product) && existing.qty >= Number(product.qty)) return prev
        return prev.map(item => item.productId === product.id ? { ...item, qty: item.qty + 1 } : item)
      }

      return [
        ...prev,
        {
          productId: product.id,
          name: product.name,
          category: product.cat,
          unit: product.unit,
          trackStock: product.trackStock !== false,
          price,
          qty: 1,
          stockAvailable: product.trackStock === false ? Infinity : (Number(product.qty) || 0),
        },
      ]
    })
  }

  function updateQty(productId, nextQty) {
    setCart(prev => prev.flatMap(item => {
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
    if (cart.length === 0) return
    if (confirm('Clear the current cart?')) {
      setCart([])
      setItemDiscounts({})
      setCheckoutOpen(false)
    }
  }

  function openCheckout() {
    if (cart.length === 0) {
      alert('Add at least one product to the cart.')
      return
    }
    setCheckoutOpen(true)
  }

  function setItemDiscount(productId, value) {
    setItemDiscounts(prev => ({ ...prev, [productId]: value }))
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
        const discount = Math.min(lineSubtotal, Math.max(0, Number(itemDiscounts[item.productId]) || 0))
        return {
          productId: item.productId,
          name: item.name,
          unit: item.unit,
          price: item.price,
          qty: item.qty,
          discount,
          lineSubtotal,
          lineTotal: Math.max(0, lineSubtotal - discount),
        }
      }),
      paymentMethod,
      discount: discountTotal,
    })
    setCart([])
    setItemDiscounts({})
    setCheckoutOpen(false)
    setPaymentMethod('Cash')
  }

  function handleProductTile(product) {
    if (tracksStock(product) && Number(product.qty) <= 0) {
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
            <button onClick={() => setCheckoutOpen(false)} className="secondary-page-button">Back to POS</button>
          </div>

          <div className="checkout-item-list">
            {cart.map(item => {
              const lineSubtotal = item.qty * item.price
              const discount = Math.min(lineSubtotal, Math.max(0, Number(itemDiscounts[item.productId]) || 0))
              const lineTotal = Math.max(0, lineSubtotal - discount)
              return (
                <div key={item.productId} className="checkout-item-row">
                  <div>
                    <strong>{item.name}</strong>
                    <span>{item.qty} x {priceLabel(item)}</span>
                  </div>
                  <label>
                    Discount
                    <input
                      type="number"
                      min="0"
                      max={lineSubtotal}
                      step="0.01"
                      value={itemDiscounts[item.productId] ?? ''}
                      onChange={event => setItemDiscount(item.productId, event.target.value)}
                      placeholder="0.00"
                    />
                  </label>
                  <div className="checkout-line-total">
                    <span>{discount > 0 ? `${money(lineSubtotal)} - ${money(discount)}` : money(lineSubtotal)}</span>
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

          <div className="checkout-controls">
            <label>
              Payment mode
              <select value={paymentMethod} onChange={event => setPaymentMethod(event.target.value)}>
                <option>Cash</option>
                <option>GCash</option>
                <option>Card</option>
                <option>Bank transfer</option>
              </select>
            </label>
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
              const outOfStock = tracksStock(product) && Number(product.qty) <= 0
              const lowStock = tracksStock(product) && Number(product.qty) <= Number(product.reorder)
              const tileClass = [
                'product-tile',
                !hasPrice ? 'missing-price' : '',
                outOfStock ? 'out-of-stock' : '',
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
                    <span>{isService ? 'Service' : withUnit(product.qty, product.unit)}</span>
                    {isService
                      ? <span className="service-pill">Service</span>
                      : outOfStock
                      ? <span className="out-stock-pill">Out</span>
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
            <p>{itemCount} {itemCount === 1 ? 'item selected' : 'items selected'}</p>
          </div>
          <button onClick={clearCart} disabled={cart.length === 0} className="clear-cart-button">
            Clear
          </button>
        </div>

        <div className="cart-list">
          {cart.length === 0 ? (
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
  )
}
