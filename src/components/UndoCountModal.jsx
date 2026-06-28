function getTime(entry) {
  const time = new Date(entry?.recordedAt || entry?.date).getTime()
  return Number.isNaN(time) ? 0 : time
}

export default function UndoCountModal({ product, onUndo, onClose }) {
  const countHistory = product.countHistory || []
  const restockHistory = product.restockHistory || []
  const lastCount = countHistory[countHistory.length - 1]
  const lastRestock = restockHistory[restockHistory.length - 1]

  const isRestock = lastRestock && (!lastCount || getTime(lastRestock) >= getTime(lastCount))
  const last = isRestock ? lastRestock : lastCount
  const actionName = isRestock ? 'restock' : 'stock count'
  const restoredQty = Number.isFinite(Number(last?.qtyBefore))
    ? Number(last.qtyBefore)
    : Math.max(0, Number(product.qty) - (Number(last?.added) || 0))

  const fmt = iso => new Date(iso).toLocaleDateString('en-PH', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  })

  function handleUndo() {
    if (!last) return

    if (isRestock) {
      onUndo({
        ...product,
        qty: restoredQty,
        lastQty: last.lastQtyBefore ?? restoredQty,
        restockHistory: restockHistory.slice(0, -1),
      })
      return
    }

    const newHistory = countHistory.slice(0, -1)

    onUndo({
      ...product,
      qty: restoredQty,
      lastQty: last.lastQtyBefore ?? restoredQty,
      sold: last.soldBefore,
      countHistory: newHistory,
    })
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999
    }}>
      <div style={{ background: '#fff', borderRadius: 12, padding: '1.5rem', width: 420, maxWidth: '95vw' }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Undo latest stock action</h2>
        <div style={{ fontSize: 13, color: '#666', marginBottom: 16 }}>{product.name}</div>

        {!last ? (
          <div style={{ background: '#f9f9f9', borderRadius: 8, padding: '1rem', fontSize: 13, color: '#888', textAlign: 'center' }}>
            No stock count or restock history exists for this product.
          </div>
        ) : (
          <>
            <div style={{ background: '#FFF4E5', border: '1px solid #F9C97C', borderRadius: 8, padding: '12px 14px', marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: '#92580A', fontWeight: 700, textTransform: 'uppercase', marginBottom: 6 }}>
                Latest action: {actionName}
              </div>
              <div style={{ fontSize: 12, color: '#888', marginBottom: 10 }}>{fmt(last.date)}</div>
              <div style={{ fontSize: 14, color: '#333' }}>
                {isRestock
                  ? <>Restocked <strong>+{last.added} {product.unit}</strong>{last.note ? ` - ${last.note}` : ''}</>
                  : <>Count changed from <strong>{last.qtyBefore}</strong> to <strong>{last.qtyAfter} {product.unit}</strong>, logging <strong>{last.usedWeek} used</strong>.</>
                }
              </div>
            </div>

            <div style={{ background: '#E6F1FB', border: '1px solid #B5D4F4', borderRadius: 8, padding: '12px 14px', marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: '#185FA5', fontWeight: 700, textTransform: 'uppercase', marginBottom: 8 }}>After undo</div>
              <div style={{ fontSize: 14, color: '#333' }}>
                Quantity will change from <strong>{product.qty}</strong> to <strong>{restoredQty} {product.unit}</strong>.
                {!isRestock && <> Total units used will return to <strong>{last.soldBefore || 0}</strong>.</>}
              </div>
            </div>
          </>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button onClick={onClose}
            style={{ padding: '8px 16px', border: '1px solid #ddd', borderRadius: 8, cursor: 'pointer', background: '#fff', fontSize: 13 }}>
            {last ? 'Cancel' : 'Close'}
          </button>
          {last && (
            <button onClick={handleUndo}
              style={{ padding: '8px 20px', background: '#D97706', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
              Undo {actionName}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
