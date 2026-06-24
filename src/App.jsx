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

const tabs = [
  { id: 'pos', label: 'Checkout', short: 'POS' },
  { id: 'inventory', label: 'Inventory', short: 'Stock' },
  { id: 'analytics', label: 'Analytics', short: 'Stats' },
  { id: 'report', label: 'Reports', short: 'Report' },
]

export default function App() {
  const [products, setProducts] = useState(() => {
    const saved = localStorage.getItem('vet-products')
    return saved ? JSON.parse(saved) : initialProducts
  })
  const [sales, setSales] = useState(() => {
    const saved = localStorage.getItem('vet-sales')
    return saved ? JSON.parse(saved) : []
  })
  const [tab, setTab] = useState('pos')
  const [modalOpen, setModalOpen] = useState(false)
  const [editProduct, setEditProduct] = useState(null)
  const [productPreset, setProductPreset] = useState(null)
  const [restockProduct, setRestockProduct] = useState(null)
  const [undoProduct, setUndoProduct] = useState(null)
  const [navCollapsed, setNavCollapsed] = useState(false)

  useEffect(() => {
    localStorage.setItem('vet-products', JSON.stringify(products))
  }, [products])

  useEffect(() => {
    localStorage.setItem('vet-sales', JSON.stringify(sales))
  }, [sales])

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

  function completeSale({ items, paymentMethod, discount }) {
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
      paymentMethod,
      discount: normalizedDiscount,
      subtotal,
      total,
    }
    const soldById = items.reduce((map, item) => {
      map[item.productId] = (map[item.productId] || 0) + item.qty
      return map
    }, {})

    setProducts(prev => prev.map(product => {
      const soldQty = soldById[product.id] || 0
      if (!soldQty) return product

      if (product.trackStock === false) {
        return {
          ...product,
          sold: (Number(product.sold) || 0) + soldQty,
        }
      }

      const qtyBefore = Number(product.qty) || 0
      const qtyAfter = Math.max(0, qtyBefore - soldQty)
      const saleSnapshot = {
        date: sale.date,
        type: 'sale',
        saleId: sale.id,
        qtyBefore,
        qtyAfter,
        usedWeek: soldQty,
        soldBefore: Number(product.sold) || 0,
        lastQtyBefore: product.lastQty,
      }

      return {
        ...product,
        qty: qtyAfter,
        lastQty: qtyBefore,
        sold: (Number(product.sold) || 0) + soldQty,
        countHistory: [...(product.countHistory || []), saleSnapshot].slice(-20),
      }
    }))
    setSales(prev => [sale, ...prev])
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
    const data = JSON.stringify({ products, sales }, null, 2)
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
          alert(`Successfully imported ${imported.products.length} products and ${Array.isArray(imported.sales) ? imported.sales.length : 0} sales!`)
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

  const activeTab = tabs.find(item => item.id === tab)

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
        <header className="workspace-header">
          <div>
            <div className="eyebrow">Counter mode</div>
            <h2>{activeTab?.label}</h2>
          </div>
          <div className="header-actions">
            <button onClick={openNewProduct} className="header-add-button">
              Add product
            </button>
            <button onClick={openNewService} className="header-service-button">
              Add service
            </button>
          </div>
        </header>

        {tab !== 'pos' && <Dashboard products={products} />}

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
            onCompleteSale={completeSale}
            onEditProduct={openEdit}
            onRestockProduct={product => setRestockProduct(product)}
          />
        )}
        {tab === 'analytics' && <Analytics products={products} />}
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
    </div>
  )
}
