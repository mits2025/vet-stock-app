import { useState } from 'react'

const CATS = ['Medicine', 'Vaccine', 'Supplies', 'Food', 'Equipment']

export default function ProductModal({ product, onSave, onClose }) {
  const isEdit = !!product

  const [form, setForm] = useState(
    isEdit
      ? { ...product, newQty: product.qty }
      : { name: '', cat: 'Medicine', qty: '', unit: '', reorder: '', newQty: '' }
  )

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const usedThisWeek = isEdit
    ? Math.max(0, (Number(form.qty) || 0) - (Number(form.newQty) || 0))
    : 0

  function handleSave() {
    if (!form.name.trim()) return alert('Please enter a product name.')
    if (form.unit.trim() === '') return alert('Please enter a unit (e.g. pcs, vials, bottles).')

    const oldQty     = Number(form.qty) || 0
    const enteredQty = Number(form.newQty)
    const newQty     = isEdit && Number.isFinite(enteredQty) ? enteredQty : (Number(form.qty) || 0)
    const qtyChanged = isEdit && newQty !== oldQty
    const usedWeek  = isEdit ? Math.max(0, oldQty - newQty) : 0
    const totalSold = (Number(form.sold)  || 0) + usedWeek

    // Metadata-only edits must not create an undoable stock count.
    const snapshot = qtyChanged ? {
      date:        new Date().toISOString(),
      qtyBefore:   oldQty,
      qtyAfter:    newQty,
      usedWeek,
      soldBefore:  Number(form.sold) || 0,
      lastQtyBefore: form.lastQty,
    } : null

    const prevHistory = form.countHistory || []

    onSave({
      ...form,
      qty:          newQty,
      lastQty:      qtyChanged ? oldQty : (form.lastQty ?? newQty),
      sold:         totalSold,
      reorder:      Number(form.reorder) || 0,
      // Keep last 10 snapshots only
      countHistory: snapshot
        ? [...prevHistory, snapshot].slice(-10)
        : prevHistory,
    })
  }

  const inputStyle = {
    width: '100%', padding: '8px 10px',
    border: '1px solid #ddd', borderRadius: 8, fontSize: 13
  }

  const highlightInput = {
    ...inputStyle,
    border: '2px solid #1D9E75',
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999
    }}>
      <div style={{ background: '#fff', borderRadius: 12, padding: '1.5rem', width: 380, maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto' }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: '1rem' }}>
          {isEdit ? '📋 Update stock count' : '➕ Add new product'}
        </h2>

        {/* Product name */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', fontSize: 12, color: '#666', marginBottom: 4 }}>Product name</label>
          <input
            value={form.name}
            onChange={e => set('name', e.target.value)}
            placeholder="e.g. Amoxicillin 250mg"
            style={inputStyle}
          />
        </div>

        {/* Category */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', fontSize: 12, color: '#666', marginBottom: 4 }}>Category</label>
          <select value={form.cat} onChange={e => set('cat', e.target.value)} style={inputStyle}>
            {CATS.map(c => <option key={c}>{c}</option>)}
          </select>
        </div>

        {isEdit ? (
          /* ── EDIT MODE: show last week qty, enter new count ── */
          <>
            <div style={{ background: '#f5f5f5', borderRadius: 8, padding: '10px 12px', marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: '#888', marginBottom: 2 }}>Stock count last week</div>
              <div style={{ fontWeight: 700, fontSize: 18 }}>{form.qty} <span style={{ fontSize: 13, fontWeight: 400, color: '#666' }}>{form.unit}</span></div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', fontSize: 12, color: '#1D9E75', fontWeight: 600, marginBottom: 4 }}>
                New stock count <span style={{ fontWeight: 400, color: '#888' }}>(what you counted today)</span>
              </label>
              <input
                type="number" min="0"
                value={form.newQty}
                onChange={e => set('newQty', e.target.value)}
                style={highlightInput}
                autoFocus
              />
            </div>

            {/* Auto-calculated used this week */}
            <div style={{
              background: usedThisWeek > 0 ? '#E1F5EE' : '#f9f9f9',
              border: `1px solid ${usedThisWeek > 0 ? '#9FE1CB' : '#eee'}`,
              borderRadius: 8, padding: '10px 12px', marginBottom: 12
            }}>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 2 }}>Units used / sold this week</div>
              <div style={{ fontWeight: 700, fontSize: 18, color: usedThisWeek > 0 ? '#0F6E56' : '#bbb' }}>
                {usedThisWeek} {form.unit}
                {usedThisWeek > 0 && (
                  <span style={{ fontSize: 11, fontWeight: 400, color: '#0F6E56', marginLeft: 8 }}>auto-calculated ✓</span>
                )}
              </div>
            </div>
          </>
        ) : (
          /* ── ADD MODE: enter starting quantity ── */
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 12, color: '#666', marginBottom: 4 }}>Starting quantity</label>
            <input
              type="number" min="0"
              value={form.qty}
              onChange={e => { set('qty', e.target.value); set('newQty', e.target.value) }}
              style={inputStyle}
              autoFocus
            />
          </div>
        )}

        {/* Unit */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', fontSize: 12, color: '#666', marginBottom: 4 }}>Unit</label>
          <input
            value={form.unit}
            onChange={e => set('unit', e.target.value)}
            placeholder="pcs / box / ml / vials / bags"
            style={inputStyle}
          />
        </div>

        {/* Reorder level */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 12, color: '#666', marginBottom: 4 }}>
            Reorder level <span style={{ color: '#aaa', fontWeight: 400 }}>(alert when stock falls below this)</span>
          </label>
          <input
            type="number" min="0"
            value={form.reorder}
            onChange={e => set('reorder', e.target.value)}
            placeholder="e.g. 10"
            style={inputStyle}
          />
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose}
            style={{ padding: '8px 16px', border: '1px solid #ddd', borderRadius: 8, cursor: 'pointer', background: '#fff', fontSize: 13 }}>
            Cancel
          </button>
          <button onClick={handleSave}
            style={{ padding: '8px 20px', background: '#1D9E75', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
