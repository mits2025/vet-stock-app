import { useState, useEffect } from 'react'
import { initialProducts } from './data/initialProducts'
import Dashboard from './components/Dashboard'
import ProductTable from './components/ProductTable'
import ProductModal from './components/ProductModal'
import RestockModal from './components/RestockModal'
import UndoCountModal from './components/UndoCountModal'
import Analytics from './components/Analytics'
import Report from './components/Report'

export default function App() {
  const [products, setProducts] = useState(() => {
    const saved = localStorage.getItem('vet-products')
    return saved ? JSON.parse(saved) : initialProducts
  })
  const [tab, setTab]                   = useState('inventory')
  const [modalOpen, setModalOpen]       = useState(false)
  const [editProduct, setEditProduct]   = useState(null)
  const [restockProduct, setRestockProduct] = useState(null)
  const [undoProduct, setUndoProduct]       = useState(null)

  // Auto-save to localStorage every time products change
  useEffect(() => {
    localStorage.setItem('vet-products', JSON.stringify(products))
  }, [products])

  function saveProduct(data) {
    if (data.id) {
      setProducts(prev => prev.map(p => p.id === data.id ? data : p))
    } else {
      setProducts(prev => [...prev, { ...data, id: Date.now(), sold: 0 }])
    }
    setModalOpen(false)
    setEditProduct(null)
  }

  function saveRestock(data) {
    setProducts(prev => prev.map(p => p.id === data.id ? data : p))
    setRestockProduct(null)
  }

  function saveUndo(data) {
    setProducts(prev => prev.map(p => p.id === data.id ? data : p))
    setUndoProduct(null)
  }

  function deleteProduct(id) {
    if (confirm('Remove this product from inventory?')) {
      setProducts(prev => prev.filter(p => p.id !== id))
    }
  }

  function openEdit(product) {
    setEditProduct(product)
    setModalOpen(true)
  }

  function exportBackup() {
    const data = JSON.stringify(products, null, 2)
    const blob = new Blob([data], { type: 'application/json' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `vet-stock-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  function importBackup(e) {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = evt => {
      try {
        const imported = JSON.parse(evt.target.result)
        if (Array.isArray(imported)) {
          setProducts(imported)
          alert(`Successfully imported ${imported.length} products!`)
        } else {
          alert('Invalid file. Please use a valid backup JSON file.')
        }
      } catch {
        alert('Could not read file. Make sure it is a valid JSON backup.')
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const tabs = ['inventory', 'analytics', 'report']

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '1.5rem 1rem' }}>

      {/* Top bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700 }}>🐾 Vet Clinic Stock Manager</h1>
          <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
            {new Date().toLocaleDateString('en-PH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={exportBackup}
            style={{ padding: '8px 14px', border: '1px solid #ddd', borderRadius: 8, cursor: 'pointer', background: '#fff', fontSize: 13, fontWeight: 500 }}>
            ⬇ Export backup
          </button>
          <label style={{ padding: '8px 14px', border: '1px solid #ddd', borderRadius: 8, cursor: 'pointer', background: '#fff', fontSize: 13, fontWeight: 500 }}>
            ⬆ Import backup
            <input type="file" accept=".json" onChange={importBackup} style={{ display: 'none' }} />
          </label>
          <button
            onClick={() => { setEditProduct(null); setModalOpen(true) }}
            style={{ padding: '8px 16px', background: '#1D9E75', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
            + Add product
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <Dashboard products={products} />

      {/* Tab navigation */}
      <div style={{ display: 'flex', gap: 8, marginBottom: '1.25rem' }}>
        {tabs.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '7px 18px', borderRadius: 8, border: '1px solid #ddd',
            cursor: 'pointer', fontWeight: 500, textTransform: 'capitalize',
            background: tab === t ? '#1D9E75' : '#fff',
            color:      tab === t ? '#fff'     : '#444',
            fontSize: 13
          }}>{t}</button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'inventory' && (
        <ProductTable
          products={products}
          onEdit={openEdit}
          onDelete={deleteProduct}
          onRestock={p => setRestockProduct(p)}
          onUndo={p => setUndoProduct(p)}
        />
      )}
      {tab === 'analytics' && <Analytics products={products} />}
      {tab === 'report'    && <Report products={products} />}

      {/* Add / Edit modal */}
      {modalOpen && (
        <ProductModal
          product={editProduct}
          onSave={saveProduct}
          onClose={() => { setModalOpen(false); setEditProduct(null) }}
        />
      )}

      {/* Restock modal */}
      {restockProduct && (
        <RestockModal
          product={restockProduct}
          onSave={saveRestock}
          onClose={() => setRestockProduct(null)}
        />
      )}

      {/* Undo last count modal */}
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
