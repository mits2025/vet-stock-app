import { useState } from 'react'
import { getUsageInLastDaysWithPendingCount } from '../utils/usage'

function ModalDropdown({ value, options, placeholder, onChange }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState(() => options.find(option => option.value === value)?.label || '')
  const normalizedQuery = query.trim().toLowerCase()
  const filteredOptions = options.filter(option => {
    if (!normalizedQuery) return true
    return `${option.label} ${option.meta || ''}`.toLowerCase().includes(normalizedQuery)
  })

  function chooseOption(option) {
    onChange(option.value)
    setQuery(option.label)
    setOpen(false)
  }

  return (
    <div className="product-modal-dropdown" onBlur={() => setOpen(false)}>
      <div
        className={open ? 'product-modal-dropdown-trigger open' : 'product-modal-dropdown-trigger'}
      >
        <input
          value={query}
          placeholder={placeholder}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onChange={event => {
            const nextQuery = event.target.value
            setQuery(nextQuery)
            setOpen(true)
          }}
          onKeyDown={event => {
            if (event.key === 'Escape') {
              setOpen(false)
              setQuery('')
            }
            if (event.key === 'Enter') {
              event.preventDefault()
              if (filteredOptions[0]) {
                chooseOption(filteredOptions[0])
              }
            }
          }}
          aria-haspopup="listbox"
          aria-expanded={open}
        />
        <i className="fi fi-rr-angle-small-down" aria-hidden="true"></i>
      </div>
      {open && (
        <div className="product-modal-dropdown-menu" role="listbox">
          {filteredOptions.map(option => (
            <button
              key={option.value}
              type="button"
              className={option.value === value ? 'selected' : ''}
              onMouseDown={event => event.preventDefault()}
              onClick={() => chooseOption(option)}
              role="option"
              aria-selected={option.value === value}
            >
              <span>{option.label}</span>
              {option.meta && <small>{option.meta}</small>}
            </button>
          ))}
          {filteredOptions.length === 0 && (
            <div className="product-modal-dropdown-empty">No matching item.</div>
          )}
        </div>
      )}
    </div>
  )
}

export default function ProductModal({ product, preset = null, products = [], categories = [], onSave, onClose }) {
  const isEdit = !!product
  const savedCats = products.map(item => item.cat).filter(Boolean)
  const cats = [...new Set([...categories, ...savedCats])].sort()
  const initialCat = isEdit ? product.cat : preset?.cat || ''

  const [form, setForm] = useState(
    isEdit
      ? { trackStock: product.trackStock !== false, ...product, newQty: product.qty }
      : { name: '', cat: initialCat, qty: '', unit: '', reorder: '', costPrice: '', price: '', priceByWeight: false, weightUnit: 'kg', expirationDate: '', newQty: '', trackStock: true, ...preset }
  )
  const [warning, setWarning] = useState('')

  const set = (k, v) => {
    setWarning('')
    setForm(f => ({ ...f, [k]: v }))
  }

  const usedThisWeek = isEdit
    ? getUsageInLastDaysWithPendingCount(form, form.newQty)
    : 0
  const stockProducts = products.filter(item => item.trackStock !== false && item.id !== product?.id)
  const categoryOptions = cats.map(cat => ({ value: cat, label: cat }))
  const stockProductOptions = [
    { value: '', label: 'No stock deduction', meta: 'Service does not consume inventory' },
    ...stockProducts.map(item => ({
      value: String(item.id),
      label: item.name,
      meta: `${item.qty} ${item.unit || 'units'} available`,
    })),
  ]

  function handleSave() {
    if (!form.name.trim()) {
      setWarning('Product name is required before saving.')
      return
    }
    const category = form.cat
    if (!category) {
      setWarning('Choose a category before saving. You can add or rename categories in Settings.')
      return
    }
    const trackStock = form.trackStock !== false

    const oldQty     = Number(form.qty) || 0
    const enteredQty = Number(form.newQty)
    const newQty     = trackStock
      ? (isEdit && Number.isFinite(enteredQty) ? enteredQty : (Number(form.qty) || 0))
      : 0
    const qtyChanged = trackStock && isEdit && newQty !== oldQty
    const usedWeek  = trackStock && isEdit ? Math.max(0, oldQty - newQty) : 0
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
      cat:          category,
      trackStock,
      unit:         form.priceByWeight === true ? (form.weightUnit || 'kg') : form.unit.trim(),
      qty:          newQty,
      price:        Math.max(0, Number(form.price) || 0),
      costPrice:    Math.max(0, Number(form.costPrice) || 0),
      priceByWeight: form.priceByWeight === true,
      weightUnit: form.priceByWeight === true ? (form.weightUnit || 'kg') : '',
      lastQty:      qtyChanged ? oldQty : (form.lastQty ?? newQty),
      sold:         totalSold,
      reorder:      Number(form.reorder) || 0,
      expirationDate: trackStock ? (form.expirationDate || '') : '',
      consumesProductId: trackStock ? '' : (form.consumesProductId || ''),
      consumptionPerSale: trackStock ? 0 : Math.max(0, Number(form.consumptionPerSale) || 0),
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

        {warning && (
          <div className="modal-friendly-alert" role="alert">
            <i className="fi fi-rr-triangle-warning" aria-hidden="true"></i>
            <span>{warning}</span>
          </div>
        )}

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
          <ModalDropdown
            value={form.cat}
            options={categoryOptions}
            placeholder="Search category"
            onChange={value => set('cat', value)}
          />
        </div>

        <label style={{
          display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12,
          padding: '9px 10px', border: '1px solid #eee', borderRadius: 8,
          background: '#f9f9f9', fontSize: 13, color: '#444'
        }}>
          <input
            type="checkbox"
            checked={form.trackStock !== false}
            onChange={e => set('trackStock', e.target.checked)}
          />
          Track stock quantity
          <span style={{ color: '#999', fontSize: 12 }}>(turn off for services)</span>
        </label>

        {isEdit && form.trackStock !== false ? (
          /* ── EDIT MODE: show last week qty, enter new count ── */
          <>
            <div style={{ background: '#f5f5f5', borderRadius: 8, padding: '10px 12px', marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: '#888', marginBottom: 2 }}>Stock count last week</div>
              <div style={{ fontWeight: 700, fontSize: 18 }}>
                {form.qty}
                {form.unit && <span style={{ fontSize: 13, fontWeight: 400, color: '#666' }}> {form.unit}</span>}
              </div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', fontSize: 12, color: '#1D9E75', fontWeight: 600, marginBottom: 4 }}>
                New stock count <span style={{ fontWeight: 400, color: '#888' }}>(what you counted today)</span>
              </label>
              <input
                type="number" min="0"
                step={form.priceByWeight === true ? '0.001' : '1'}
                value={form.newQty}
                onChange={e => set('newQty', e.target.value)}
                style={highlightInput}
                autoFocus
              />
            </div>

            {/* Auto-calculated usage for the rolling 7-day window */}
            <div style={{
              background: usedThisWeek > 0 ? '#E1F5EE' : '#f9f9f9',
              border: `1px solid ${usedThisWeek > 0 ? '#9FE1CB' : '#eee'}`,
              borderRadius: 8, padding: '10px 12px', marginBottom: 12
            }}>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 2 }}>Units used / sold in last 7 days</div>
              <div style={{ fontWeight: 700, fontSize: 18, color: usedThisWeek > 0 ? '#0F6E56' : '#bbb' }}>
                {usedThisWeek}{form.unit ? ` ${form.unit}` : ''}
                {usedThisWeek > 0 && (
                  <span style={{ fontSize: 11, fontWeight: 400, color: '#0F6E56', marginLeft: 8 }}>auto-calculated ✓</span>
                )}
              </div>
            </div>
          </>
        ) : form.trackStock !== false ? (
          /* ── ADD MODE: enter starting quantity ── */
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 12, color: '#666', marginBottom: 4 }}>Starting quantity</label>
            <input
              type="number" min="0"
              step={form.priceByWeight === true ? '0.001' : '1'}
              value={form.qty}
              onChange={e => { set('qty', e.target.value); set('newQty', e.target.value) }}
              style={inputStyle}
              autoFocus
            />
          </div>
        ) : (
          <>
            <div style={{ background: '#EAF7F2', border: '1px solid #BFE7D8', borderRadius: 8, padding: '10px 12px', marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: '#0F6E56', fontWeight: 700 }}>Service item</div>
              <div style={{ fontSize: 12, color: '#55756B', marginTop: 2 }}>Sell this as a service. You can optionally deduct stock from a linked product like vaccine vials.</div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', fontSize: 12, color: '#666', marginBottom: 4 }}>
                Consumes stock item <span style={{ color: '#aaa', fontWeight: 400 }}>(optional)</span>
              </label>
              <ModalDropdown
                value={String(form.consumesProductId || '')}
                options={stockProductOptions}
                placeholder="Search stock item"
                onChange={value => set('consumesProductId', value)}
              />
            </div>

            {form.consumesProductId && (
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 12, color: '#666', marginBottom: 4 }}>
                  Stock used per sale <span style={{ color: '#aaa', fontWeight: 400 }}>(example: 0.1 vial per client)</span>
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.consumptionPerSale || ''}
                  onChange={e => set('consumptionPerSale', e.target.value)}
                  placeholder="0.1"
                  style={inputStyle}
                />
              </div>
            )}
          </>
        )}

        {/* Unit */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', fontSize: 12, color: '#666', marginBottom: 4 }}>
            Unit <span style={{ color: '#aaa', fontWeight: 400 }}>(optional)</span>
          </label>
          <input
            value={form.priceByWeight === true ? (form.weightUnit || 'kg') : form.unit}
            onChange={e => set('unit', e.target.value)}
            placeholder="pcs / box / ml / vials / bags"
            style={inputStyle}
            disabled={form.priceByWeight === true}
          />
          {form.priceByWeight === true && (
            <small style={{ display: 'block', marginTop: 4, color: '#0F6E56' }}>
              Stock uses the same weight unit as sales so checkout deducts the entered weight.
            </small>
          )}
        </div>

        {/* Reorder level */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 12, color: '#666', marginBottom: 4 }}>
            Reorder level <span style={{ color: '#aaa', fontWeight: 400 }}>(alert when stock falls below this)</span>
          </label>
          <input
            type="number" min="0"
            step={form.priceByWeight === true ? '0.001' : '1'}
            value={form.reorder}
            onChange={e => set('reorder', e.target.value)}
            placeholder="e.g. 10"
            style={inputStyle}
            disabled={form.trackStock === false}
          />
        </div>

        {form.trackStock !== false && (
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 12, color: '#666', marginBottom: 4 }}>
              Expiration date <span style={{ color: '#aaa', fontWeight: 400 }}>(optional)</span>
            </label>
            <input
              type="date"
              value={form.expirationDate || ''}
              onChange={e => set('expirationDate', e.target.value)}
              style={inputStyle}
            />
          </div>
        )}

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 12, color: '#666', marginBottom: 4 }}>
            Original cost price <span style={{ color: '#aaa', fontWeight: 400 }}>(what you paid)</span>
          </label>
          <input
            type="number" min="0" step="0.01"
            value={form.costPrice ?? ''}
            onChange={e => set('costPrice', e.target.value)}
            placeholder="e.g. 150"
            style={inputStyle}
          />
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', fontSize: 12, color: '#666', marginBottom: 4 }}>
            Pricing method
          </label>
          <select
            value={form.priceByWeight === true ? 'weight' : 'unit'}
            onChange={e => {
              const priceByWeight = e.target.value === 'weight'
              set('priceByWeight', priceByWeight)
              if (priceByWeight) set('unit', form.weightUnit || 'kg')
            }}
            style={inputStyle}
          >
            <option value="unit">Per item / unit</option>
            <option value="weight">By weight</option>
          </select>
        </div>

        {form.priceByWeight === true && (
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 12, color: '#666', marginBottom: 4 }}>
              Weight unit
            </label>
            <select
              value={form.weightUnit || 'kg'}
              onChange={e => {
                set('weightUnit', e.target.value)
                set('unit', e.target.value)
              }}
              style={inputStyle}
            >
              <option value="kg">Kilogram (kg)</option>
              <option value="g">Gram (g)</option>
              <option value="lb">Pound (lb)</option>
              <option value="oz">Ounce (oz)</option>
            </select>
          </div>
        )}

        {/* Sale price */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 12, color: '#666', marginBottom: 4 }}>
            Sale price {form.priceByWeight === true ? `per ${form.weightUnit || 'kg'}` : ''}
            <span style={{ color: '#aaa', fontWeight: 400 }}> (for POS checkout)</span>
          </label>
          <input
            type="number" min="0" step="0.01"
            value={form.price ?? ''}
            onChange={e => set('price', e.target.value)}
            placeholder="e.g. 250"
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
