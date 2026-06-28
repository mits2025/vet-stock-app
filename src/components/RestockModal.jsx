import { useState } from 'react'

function localDateString() {
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60 * 1000).toISOString().slice(0, 10)
}

export default function RestockModal({ product, onSave, onClose }) {
  const [qtyToAdd, setQtyToAdd] = useState('')
  const [note, setNote]         = useState('')
  const [deliveryDate, setDeliveryDate] = useState(localDateString)
  const [warning, setWarning] = useState('')

  const added       = Number(qtyToAdd) || 0
  const newTotal    = product.qty + added
  const isValid     = added > 0 && deliveryDate !== ''

  function handleSave() {
    if (added <= 0) {
      setWarning('Enter the quantity received before confirming restock.')
      return
    }
    if (!deliveryDate) {
      setWarning('Select the delivery date before confirming restock.')
      return
    }

    const restockEntry = {
      date:      new Date(`${deliveryDate}T12:00:00`).toISOString(),
      recordedAt: new Date().toISOString(),
      added,
      qtyBefore: product.qty,
      qtyAfter:  newTotal,
      lastQtyBefore: product.lastQty,
      note:      note.trim() || 'Restocked',
    }

    onSave({
      ...product,
      qty:            newTotal,
      lastQty:        product.qty,
      restockHistory: [...(product.restockHistory || []), restockEntry],
    })
  }

  const inputStyle = {
    width: '100%', padding: '8px 10px',
    border: '1px solid #ddd', borderRadius: 8, fontSize: 13
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999
    }}>
      <div style={{ background: '#fff', borderRadius: 12, padding: '1.5rem', width: 380, maxWidth: '95vw' }}>

        {/* Header */}
        <div style={{ marginBottom: '1rem' }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>📦 Restock product</h2>
          <div style={{ fontSize: 13, color: '#666' }}>{product.name}</div>
        </div>

        {warning && (
          <div className="modal-friendly-alert" role="alert">
            <i className="fi fi-rr-triangle-warning" aria-hidden="true"></i>
            <span>{warning}</span>
          </div>
        )}

        {/* Current stock info */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
          <div style={{ background: '#f5f5f5', borderRadius: 8, padding: '10px 12px' }}>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 2 }}>Current stock</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#333' }}>
              {product.qty} <span style={{ fontSize: 13, fontWeight: 400, color: '#666' }}>{product.unit}</span>
            </div>
          </div>
          <div style={{ background: '#f5f5f5', borderRadius: 8, padding: '10px 12px' }}>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 2 }}>Reorder level</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#333' }}>
              {product.reorder} <span style={{ fontSize: 13, fontWeight: 400, color: '#666' }}>{product.unit}</span>
            </div>
          </div>
        </div>

        {/* Qty to add */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', fontSize: 12, color: '#185FA5', fontWeight: 600, marginBottom: 4 }}>
            Quantity received <span style={{ fontWeight: 400, color: '#888' }}>(how many arrived today)</span>
          </label>
          <input
            type="number" min="1"
            value={qtyToAdd}
            onChange={e => { setWarning(''); setQtyToAdd(e.target.value) }}
            placeholder="e.g. 50"
            autoFocus
            style={{ ...inputStyle, border: '2px solid #185FA5' }}
          />
        </div>

        {/* Delivery date */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', fontSize: 12, color: '#666', marginBottom: 4 }}>
            Delivery date
          </label>
          <input
            type="date"
            value={deliveryDate}
            onChange={e => { setWarning(''); setDeliveryDate(e.target.value) }}
            max={localDateString()}
            style={inputStyle}
          />
        </div>

        {/* Note / supplier */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'block', fontSize: 12, color: '#666', marginBottom: 4 }}>
            Note <span style={{ color: '#aaa', fontWeight: 400 }}>(optional — supplier, batch, etc.)</span>
          </label>
          <input
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="e.g. From ABC Pharma, Batch #2024"
            style={inputStyle}
          />
        </div>

        {/* Live preview of new total */}
        {added > 0 && (
          <div style={{
            background: '#E6F1FB', border: '1px solid #B5D4F4',
            borderRadius: 8, padding: '12px 14px', marginBottom: 16
          }}>
            <div style={{ fontSize: 12, color: '#185FA5', marginBottom: 4, fontWeight: 600 }}>New stock total after restock</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 15 }}>
              <span style={{ color: '#666' }}>{product.qty} {product.unit}</span>
              <span style={{ color: '#888' }}>+</span>
              <span style={{ color: '#185FA5', fontWeight: 700 }}>{added} {product.unit}</span>
              <span style={{ color: '#888' }}>=</span>
              <span style={{ color: '#0C447C', fontWeight: 700, fontSize: 20 }}>{newTotal} {product.unit}</span>
            </div>
            {newTotal >= product.reorder && product.qty < product.reorder && (
              <div style={{ marginTop: 8, fontSize: 12, color: '#0F6E56', fontWeight: 600 }}>
                ✅ Stock will be back above reorder level after this restock!
              </div>
            )}
          </div>
        )}

        {/* Restock history */}
        {product.restockHistory && product.restockHistory.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, color: '#888', fontWeight: 600, marginBottom: 6 }}>Previous restocks</div>
            <div style={{ maxHeight: 110, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {[...product.restockHistory].reverse().slice(0, 5).map((r, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '5px 8px', background: '#f9f9f9', borderRadius: 6 }}>
                  <span style={{ color: '#0F6E56', fontWeight: 600 }}>+{r.added} {product.unit}</span>
                  <span style={{ color: '#888' }}>{r.note}</span>
                  <span style={{ color: '#aaa' }}>{new Date(r.date).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose}
            style={{ padding: '8px 16px', border: '1px solid #ddd', borderRadius: 8, cursor: 'pointer', background: '#fff', fontSize: 13 }}>
            Cancel
          </button>
          <button onClick={handleSave} disabled={!isValid}
            style={{
              padding: '8px 20px', background: isValid ? '#185FA5' : '#ccc',
              color: '#fff', border: 'none', borderRadius: 8,
              cursor: isValid ? 'pointer' : 'not-allowed', fontWeight: 600, fontSize: 13
            }}>
            Confirm restock
          </button>
        </div>
      </div>
    </div>
  )
}
