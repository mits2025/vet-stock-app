import { useState } from 'react'
import { getStatus } from '../utils/status'

const statusStyle = {
  ok:       { background: '#E1F5EE', color: '#085041' },
  low:      { background: '#FAEEDA', color: '#633806' },
  critical: { background: '#FCEBEB', color: '#791F1F' },
}

const statusLabel = { ok: 'OK', low: 'Low stock', critical: 'Critical' }

export default function ProductTable({ products, onEdit, onDelete, onRestock, onUndo }) {
  const [search, setSearch]             = useState('')
  const [filterCat, setFilterCat]       = useState('')
  const [filterStatus, setFilterStatus] = useState('')

  const cats = [...new Set(products.map(p => p.cat))].sort()

  const filtered = products.filter(p => {
    const s = getStatus(p)
    return (
      (!search       || p.name.toLowerCase().includes(search.toLowerCase()) || p.cat.toLowerCase().includes(search.toLowerCase()))
      && (!filterCat    || p.cat === filterCat)
      && (!filterStatus || s === filterStatus)
    )
  })

  if (products.length === 0) {
    return (
      <div style={{ background: '#fff', border: '1px solid #eee', borderRadius: 10, padding: '3rem', textAlign: 'center', color: '#888' }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>📦</div>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>No products yet</div>
        <div style={{ fontSize: 13 }}>Click <strong>+ Add product</strong> to start building your inventory.</div>
      </div>
    )
  }

  return (
    <div>
      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <input
          placeholder="Search product or category..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: 160, padding: '7px 10px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13 }}
        />
        <select value={filterCat} onChange={e => setFilterCat(e.target.value)}
          style={{ padding: '7px 10px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13 }}>
          <option value="">All categories</option>
          {cats.map(c => <option key={c}>{c}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          style={{ padding: '7px 10px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13 }}>
          <option value="">All status</option>
          <option value="ok">OK</option>
          <option value="low">Low stock</option>
          <option value="critical">Critical</option>
        </select>
      </div>

      {/* Table */}
      <div style={{ overflowX: 'auto', border: '1px solid #eee', borderRadius: 10 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f9f9f9' }}>
              {['Product', 'Category', 'Qty', 'Unit', 'Reorder at', 'Used this week', 'Status', 'Actions'].map(h => (
                <th key={h} style={{ textAlign: 'left', padding: '9px 12px', borderBottom: '1px solid #eee', fontWeight: 500, color: '#666', fontSize: 12, whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ padding: '2rem', textAlign: 'center', color: '#aaa' }}>No products match your filters.</td>
              </tr>
            ) : filtered.map(p => {
              const s            = getStatus(p)
              const usedThisWeek = Math.max(0, (p.lastQty || p.qty) - p.qty)
              const needsRestock = s === 'low' || s === 'critical'

              return (
                <tr key={p.id} style={{ borderBottom: '1px solid #f5f5f5', background: s === 'critical' ? '#fff9f9' : 'transparent' }}>
                  <td style={{ padding: '9px 12px', fontWeight: 500 }}>{p.name}</td>
                  <td style={{ padding: '9px 12px' }}>
                    <span style={{ background: '#f0f0f0', color: '#555', padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 500 }}>{p.cat}</span>
                  </td>
                  <td style={{ padding: '9px 12px', fontWeight: 700, color: s === 'critical' ? '#A32D2D' : s === 'low' ? '#BA7517' : '#1a1a1a' }}>{p.qty}</td>
                  <td style={{ padding: '9px 12px', color: '#888' }}>{p.unit}</td>
                  <td style={{ padding: '9px 12px', color: '#888' }}>{p.reorder}</td>
                  <td style={{ padding: '9px 12px', color: usedThisWeek > 0 ? '#0F6E56' : '#bbb', fontWeight: usedThisWeek > 0 ? 600 : 400 }}>
                    {usedThisWeek > 0 ? `${usedThisWeek} ${p.unit}` : '—'}
                  </td>
                  <td style={{ padding: '9px 12px' }}>
                    <span style={{ ...statusStyle[s], padding: '3px 9px', borderRadius: 20, fontSize: 11, fontWeight: 500 }}>
                      {statusLabel[s]}
                    </span>
                  </td>
                  <td style={{ padding: '9px 12px', whiteSpace: 'nowrap' }}>
                    {/* Restock button — highlighted when low or critical */}
                    <button
                      onClick={() => onRestock(p)}
                      style={{
                        marginRight: 4, padding: '4px 10px',
                        border: needsRestock ? '1px solid #185FA5' : '1px solid #ddd',
                        borderRadius: 6, cursor: 'pointer', fontSize: 12,
                        background: needsRestock ? '#185FA5' : '#fff',
                        color:      needsRestock ? '#fff'     : '#444',
                        fontWeight: needsRestock ? 600        : 400,
                      }}
                      title="Add received stock to current quantity"
                    >
                      + Restock
                    </button>
                    <button onClick={() => onEdit(p)}
                      style={{ marginRight: 4, padding: '4px 10px', border: '1px solid #ddd', borderRadius: 6, cursor: 'pointer', background: '#fff', fontSize: 12 }}>
                      Edit
                    </button>
                    {/* Undo button - shown when a count or restock can be reversed */}
                    {((p.countHistory && p.countHistory.length > 0) || (p.restockHistory && p.restockHistory.length > 0)) && (
                      <button onClick={() => onUndo(p)}
                        style={{ marginRight: 4, padding: '4px 10px', border: '1px solid #F9C97C', borderRadius: 6, cursor: 'pointer', background: '#FFF4E5', color: '#92580A', fontSize: 12, fontWeight: 500 }}
                        title="Undo the latest stock count or restock">
                        ↩ Undo
                      </button>
                    )}
                    <button onClick={() => onDelete(p.id)}
                      style={{ padding: '4px 10px', border: '1px solid #fcc', borderRadius: 6, cursor: 'pointer', background: '#fff', color: '#c00', fontSize: 12 }}>
                      Delete
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
