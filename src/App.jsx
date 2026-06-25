import { useEffect, useState } from 'react'
import { initialProducts } from './data/initialProducts'
import Dashboard from './components/Dashboard'
import ProductTable from './components/ProductTable'
import ProductModal from './components/ProductModal'
import RestockModal from './components/RestockModal'
import UndoCountModal from './components/UndoCountModal'
import Analytics from './components/Analytics'
import Report from './components/Report'
import POS from './components/POS'
import SalesReport from './components/SalesReport'

const tabs = [
  { id: 'pos', label: 'Checkout', short: 'POS' },
  { id: 'inventory', label: 'Inventory', short: 'Stock' },
  { id: 'analytics', label: 'Analytics', short: 'Stats' },
  { id: 'sales-report', label: 'Sales Report', short: 'Sales' },
  { id: 'report', label: 'Reports', short: 'Report' },
]

function todayKey() {
  const date = new Date()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export default function App() {
  const [products, setProducts] = useState(() => {
    const saved = localStorage.getItem('vet-products')
    return saved ? JSON.parse(saved) : initialProducts
  })
  const [sales, setSales] = useState(() => {
    const saved = localStorage.getItem('vet-sales')
    return saved ? JSON.parse(saved) : []
  })
  const [clients, setClients] = useState(() => {
    const saved = localStorage.getItem('vet-clients')
    return saved ? JSON.parse(saved) : []
  })
  const [expenses, setExpenses] = useState(() => {
    const saved = localStorage.getItem('vet-expenses')
    return saved ? JSON.parse(saved) : []
  })
  const [cashDrawer, setCashDrawer] = useState(() => {
    const saved = localStorage.getItem('vet-cash-drawer')
    return saved ? JSON.parse(saved) : {}
  })
  const [tab, setTab] = useState('pos')
  const [modalOpen, setModalOpen] = useState(false)
  const [editProduct, setEditProduct] = useState(null)
  const [productPreset, setProductPreset] = useState(null)
  const [restockProduct, setRestockProduct] = useState(null)
  const [undoProduct, setUndoProduct] = useState(null)
  const [navCollapsed, setNavCollapsed] = useState(false)
  const [openingCashPrompt, setOpeningCashPrompt] = useState('')
  const [orders, setOrders] = useState([])
  const [activeOrderId, setActiveOrderId] = useState('')
  const currentDayKey = todayKey()
  const needsOpeningCash = tab === 'pos' && !cashDrawer[currentDayKey]

  useEffect(() => {
    localStorage.setItem('vet-products', JSON.stringify(products))
  }, [products])

  useEffect(() => {
    localStorage.setItem('vet-sales', JSON.stringify(sales))
  }, [sales])

  useEffect(() => {
    localStorage.setItem('vet-clients', JSON.stringify(clients))
  }, [clients])

  useEffect(() => {
    localStorage.setItem('vet-expenses', JSON.stringify(expenses))
  }, [expenses])

  useEffect(() => {
    localStorage.setItem('vet-cash-drawer', JSON.stringify(cashDrawer))
  }, [cashDrawer])

  function saveProduct(data) {
    if (data.id) {
      setProducts(prev => prev.map(product => product.id === data.id ? data : product))
    } else {
      setProducts(prev => [...prev, { ...data, id: Date.now(), sold: 0 }])
    }
    setModalOpen(false)
    setEditProduct(null)
    setProductPreset(null)
  }

  function saveRestock(data) {
    setProducts(prev => prev.map(product => product.id === data.id ? data : product))
    setRestockProduct(null)
  }

  function saveUndo(data) {
    setProducts(prev => prev.map(product => product.id === data.id ? data : product))
    setUndoProduct(null)
  }

  function applyTrendReorderLevels(updates) {
    setProducts(prev => prev.map(product => {
      const update = updates.find(item => item.id === product.id)
      if (!update) return product
      return {
        ...product,
        reorder: update.reorder,
        reorderAutomatedAt: new Date().toISOString(),
      }
    }))
  }

  function saveClientName(name) {
    const cleanName = name.trim()
    if (!cleanName) return

    setClients(prev => {
      const existing = prev.find(client => client.name.toLowerCase() === cleanName.toLowerCase())
      if (existing) {
        return prev.map(client => client.id === existing.id
          ? { ...client, name: cleanName, lastUsedAt: new Date().toISOString() }
          : client
        )
      }

      return [
        {
          id: Date.now(),
          name: cleanName,
          createdAt: new Date().toISOString(),
          lastUsedAt: new Date().toISOString(),
        },
        ...prev,
      ]
    })
  }

  function completeSale({ items, paymentMethod, discount, clientName }) {
    const subtotal = items.reduce((sum, item) => {
      return sum + (Number(item.lineSubtotal) || Number(item.qty) * Number(item.price))
    }, 0)
    const itemDiscount = items.reduce((sum, item) => sum + (Number(item.discount) || 0), 0)
    const normalizedDiscount = Math.max(0, Number(discount) || itemDiscount)
    const total = Math.max(0, items.reduce((sum, item) => {
      const lineSubtotal = Number(item.lineSubtotal) || Number(item.qty) * Number(item.price)
      return sum + Math.max(0, lineSubtotal - (Number(item.discount) || 0))
    }, 0))
    const sale = {
      id: Date.now(),
      date: new Date().toISOString(),
      items,
      clientName: clientName?.trim() || '',
      paymentMethod,
      discount: normalizedDiscount,
      subtotal,
      total,
    }
    if (sale.clientName) saveClientName(sale.clientName)
    const soldById = items.reduce((map, item) => {
      map[item.productId] = (map[item.productId] || 0) + item.qty
      return map
    }, {})
    const consumedById = items.reduce((map, item) => {
      if (!item.consumesProductId || !Number(item.consumptionPerSale)) return map
      map[item.consumesProductId] = (map[item.consumesProductId] || 0) + (Number(item.qty) || 0) * Number(item.consumptionPerSale)
      return map
    }, {})

    setProducts(prev => prev.map(product => {
      const soldQty = soldById[product.id] || 0
      const consumedQty = consumedById[product.id] || 0
      if (!soldQty && !consumedQty) return product

      if (product.trackStock === false) {
        return {
          ...product,
          sold: (Number(product.sold) || 0) + soldQty,
        }
      }

      const qtyBefore = Number(product.qty) || 0
      const usedQty = soldQty + consumedQty
      const qtyAfter = Math.max(0, qtyBefore - usedQty)
      const saleSnapshot = {
        date: sale.date,
        type: 'sale',
        saleId: sale.id,
        qtyBefore,
        qtyAfter,
        usedWeek: usedQty,
        soldBefore: Number(product.sold) || 0,
        lastQtyBefore: product.lastQty,
      }

      return {
        ...product,
        qty: qtyAfter,
        lastQty: qtyBefore,
        sold: (Number(product.sold) || 0) + usedQty,
        countHistory: [...(product.countHistory || []), saleSnapshot].slice(-20),
      }
    }))
    setSales(prev => [sale, ...prev])
  }

  function addExpense(expense) {
    setExpenses(prev => [
      {
        id: Date.now(),
        date: expense.date || new Date().toISOString().slice(0, 10),
        category: expense.category?.trim() || 'General',
        note: expense.note?.trim() || '',
        paymentMethod: expense.paymentMethod || 'Cash',
        amount: Math.max(0, Number(expense.amount) || 0),
        createdAt: new Date().toISOString(),
      },
      ...prev,
    ])
  }

  function deleteExpense(id) {
    if (confirm('Remove this expense from the sales report?')) {
      setExpenses(prev => prev.filter(expense => expense.id !== id))
    }
  }

  function setOpeningCash(amount) {
    const date = todayKey()
    setCashDrawer(prev => ({
      ...prev,
      [date]: {
        ...(prev[date] || {}),
        openingCash: Math.max(0, Number(amount) || 0),
        setAt: new Date().toISOString(),
      },
    }))
  }

  function setClosingCash(amount) {
    const date = todayKey()
    setCashDrawer(prev => ({
      ...prev,
      [date]: {
        ...(prev[date] || {}),
        closingCash: Math.max(0, Number(amount) || 0),
        closedAt: new Date().toISOString(),
      },
    }))
  }

  function submitOpeningCashPrompt(event) {
    event.preventDefault()
    const trimmed = openingCashPrompt.trim()
    if (trimmed === '') {
      alert('Enter 0 if the money box is empty before starting POS.')
      return
    }
    const amount = Number(trimmed)
    if (!Number.isFinite(amount) || amount < 0) {
      alert('Enter a valid opening cash amount.')
      return
    }
    setOpeningCash(amount)
    setOpeningCashPrompt('')
  }

  function voidSale(saleId, { reason, note }) {
    const sale = sales.find(item => item.id === saleId)
    if (!sale || sale.voided) return

    const soldById = (sale.items || []).reduce((map, item) => {
      map[item.productId] = (map[item.productId] || 0) + (Number(item.qty) || 0)
      return map
    }, {})
    const consumedById = (sale.items || []).reduce((map, item) => {
      if (!item.consumesProductId || !Number(item.consumptionPerSale)) return map
      map[item.consumesProductId] = (map[item.consumesProductId] || 0) + (Number(item.qty) || 0) * Number(item.consumptionPerSale)
      return map
    }, {})

    setProducts(prev => prev.map(product => {
      const soldQty = soldById[product.id] || 0
      const consumedQty = consumedById[product.id] || 0
      if (!soldQty && !consumedQty) return product

      if (product.trackStock === false) {
        return {
          ...product,
          sold: Math.max(0, (Number(product.sold) || 0) - soldQty),
        }
      }

      const restoredQty = soldQty + consumedQty
      const qtyBefore = Number(product.qty) || 0
      const qtyAfter = qtyBefore + restoredQty
      const voidSnapshot = {
        date: new Date().toISOString(),
        type: 'void',
        saleId: sale.id,
        qtyBefore,
        qtyAfter,
        usedWeek: 0,
        restoredQty,
      }

      return {
        ...product,
        qty: qtyAfter,
        lastQty: qtyBefore,
        sold: Math.max(0, (Number(product.sold) || 0) - restoredQty),
        countHistory: [
          ...(product.countHistory || []).map(entry => entry.saleId === sale.id
            ? { ...entry, usedWeek: 0, voided: true }
            : entry
          ),
          voidSnapshot,
        ].slice(-20),
      }
    }))

    setSales(prev => prev.map(item => item.id === saleId
      ? {
          ...item,
          voided: true,
          voidedAt: new Date().toISOString(),
          voidReason: reason,
          voidNote: note?.trim() || '',
        }
      : item
    ))
  }

  function deleteProduct(id) {
    if (confirm('Remove this product from inventory?')) {
      setProducts(prev => prev.filter(product => product.id !== id))
    }
  }

  function openEdit(product) {
    setProductPreset(null)
    setEditProduct(product)
    setModalOpen(true)
  }

  function openNewProduct() {
    setProductPreset(null)
    setEditProduct(null)
    setModalOpen(true)
  }

  function openNewService() {
    setProductPreset({
      cat: 'Service',
      trackStock: false,
      qty: '',
      newQty: '',
      unit: '',
      reorder: '',
    })
    setEditProduct(null)
    setModalOpen(true)
  }

  function exportBackup() {
    const data = JSON.stringify({ products, sales, clients, expenses, cashDrawer }, null, 2)
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `vet-pos-backup-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  function importBackup(event) {
    const file = event.target.files[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = evt => {
      try {
        const imported = JSON.parse(evt.target.result)
        if (Array.isArray(imported)) {
          setProducts(imported)
          alert(`Successfully imported ${imported.length} products!`)
        } else if (Array.isArray(imported.products)) {
          setProducts(imported.products)
          setSales(Array.isArray(imported.sales) ? imported.sales : [])
          setClients(Array.isArray(imported.clients) ? imported.clients : [])
          setExpenses(Array.isArray(imported.expenses) ? imported.expenses : [])
          setCashDrawer(imported.cashDrawer && typeof imported.cashDrawer === 'object' ? imported.cashDrawer : {})
          alert(`Successfully imported ${imported.products.length} products, ${Array.isArray(imported.sales) ? imported.sales.length : 0} sales, ${Array.isArray(imported.clients) ? imported.clients.length : 0} clients, ${Array.isArray(imported.expenses) ? imported.expenses.length : 0} expenses, and cash drawer records!`)
        } else {
          alert('Invalid file. Please use a valid backup JSON file.')
        }
      } catch {
        alert('Could not read file. Make sure it is a valid JSON backup.')
      }
    }
    reader.readAsText(file)
    event.target.value = ''
  }

  return (
    <div className={navCollapsed ? 'app-shell nav-collapsed' : 'app-shell'}>
      <aside className="side-nav">
        <div className="brand-block">
          <div className="brand-mark">VP</div>
          <div>
            <h1>Vet POS</h1>
            <p>{new Date().toLocaleDateString('en-PH', { weekday: 'long', month: 'short', day: 'numeric' })}</p>
          </div>
          <button
            type="button"
            onClick={() => setNavCollapsed(prev => !prev)}
            className="sidebar-toggle"
            aria-label={navCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <span>{navCollapsed ? '›' : '‹'}</span>
          </button>
        </div>

        <nav className="nav-stack" aria-label="Primary">
          {tabs.map(item => (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              className={tab === item.id ? 'nav-button active' : 'nav-button'}
            >
              <span className="nav-full">{item.label}</span>
              <span className="nav-short">{item.short}</span>
            </button>
          ))}
        </nav>

        <div className="nav-actions">
          <div className="create-actions">
            <button onClick={openNewProduct} className="primary-action">
              Add product
            </button>
            <button onClick={openNewService} className="service-action">
              Add service
            </button>
          </div>
          <div className="backup-actions">
            <button onClick={exportBackup} className="secondary-action">Export</button>
            <label className="secondary-action">
              Import
              <input type="file" accept=".json" onChange={importBackup} hidden />
            </label>
          </div>
        </div>
      </aside>

      <main className="main-workspace">
        {tab !== 'pos' && tab !== 'sales-report' && <Dashboard products={products} />}

        {tab === 'inventory' && (
          <ProductTable
            products={products}
            onEdit={openEdit}
            onDelete={deleteProduct}
            onRestock={product => setRestockProduct(product)}
            onUndo={product => setUndoProduct(product)}
          />
        )}
        {tab === 'pos' && (
          <POS
            products={products}
            sales={sales}
            clients={clients}
            orders={orders}
            activeOrderId={activeOrderId}
            setOrders={setOrders}
            setActiveOrderId={setActiveOrderId}
            onCompleteSale={completeSale}
            onSaveClient={saveClientName}
            onEditProduct={openEdit}
            onRestockProduct={product => setRestockProduct(product)}
          />
        )}
        {tab === 'analytics' && <Analytics products={products} onApplyReorderLevels={applyTrendReorderLevels} />}
        {tab === 'sales-report' && (
          <SalesReport
            sales={sales}
            expenses={expenses}
            openingCashRecord={cashDrawer[currentDayKey]}
            onAddExpense={addExpense}
            onDeleteExpense={deleteExpense}
            onVoidSale={voidSale}
            onSetOpeningCash={setOpeningCash}
            onSetClosingCash={setClosingCash}
          />
        )}
        {tab === 'report' && <Report products={products} />}
      </main>

      {modalOpen && (
        <ProductModal
          product={editProduct}
          preset={productPreset}
          products={products}
          onSave={saveProduct}
          onClose={() => { setModalOpen(false); setEditProduct(null); setProductPreset(null) }}
        />
      )}

      {restockProduct && (
        <RestockModal
          product={restockProduct}
          onSave={saveRestock}
          onClose={() => setRestockProduct(null)}
        />
      )}

      {undoProduct && (
        <UndoCountModal
          product={undoProduct}
          onUndo={saveUndo}
          onClose={() => setUndoProduct(null)}
        />
      )}

      {needsOpeningCash && (
        <div className="client-modal-backdrop">
          <form className="client-modal opening-cash-start-modal" onSubmit={submitOpeningCashPrompt}>
            <div>
              <span className="eyebrow">Start of shift</span>
              <h3>Check money box</h3>
              <p>Enter the cash already inside the box before using POS today. Type 0 if the box is empty.</p>
            </div>

            <label className="client-name-field">
              <span>Opening cash</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={openingCashPrompt}
                onChange={event => setOpeningCashPrompt(event.target.value)}
                placeholder="0.00"
                required
                autoFocus
              />
            </label>

            <button type="submit" className="complete-sale-button">
              Start POS
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
