import { useMemo, useState } from 'react'

const money = value => `PHP ${Number(value || 0).toFixed(2)}`

const DEFAULT_RECEIPT_SETTINGS = {
  clinicName: 'Vet POS',
  address: '',
  phone: '',
  tin: '',
  email: '',
  footer: 'Thank you for your visit.',
  paperWidth: '80',
  logo: '',
}

function formatDate(dateValue) {
  if (!dateValue) return 'No date'
  const date = new Date(dateValue)
  if (Number.isNaN(date.getTime())) return dateValue
  return date.toLocaleString('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function clientKey(name) {
  return name.trim().toLowerCase()
}

export default function ClientHistory({ clients = [], sales = [], receiptSettings = DEFAULT_RECEIPT_SETTINGS }) {
  const [search, setSearch] = useState('')
  const [selectedKey, setSelectedKey] = useState('')
  const [receiptSale, setReceiptSale] = useState(null)
  const settings = { ...DEFAULT_RECEIPT_SETTINGS, ...receiptSettings }

  const clientRecords = useMemo(() => {
    const records = new Map()

    clients.forEach(client => {
      const name = client.name?.trim()
      if (!name) return
      records.set(clientKey(name), {
        name,
        createdAt: client.createdAt,
        lastUsedAt: client.lastUsedAt,
        sales: [],
      })
    })

    sales.forEach(sale => {
      const name = sale.clientName?.trim()
      if (!name) return

      const key = clientKey(name)
      const record = records.get(key) || {
        name,
        createdAt: sale.date,
        lastUsedAt: sale.date,
        sales: [],
      }

      record.sales.push(sale)
      if (!record.lastUsedAt || new Date(sale.date) > new Date(record.lastUsedAt)) {
        record.lastUsedAt = sale.date
      }
      records.set(key, record)
    })

    return [...records.entries()]
      .map(([key, record]) => {
        const completedSales = record.sales.filter(sale => !sale.voided)
        const voidedSales = record.sales.filter(sale => sale.voided)
        const totalSpent = completedSales.reduce((sum, sale) => sum + (Number(sale.total) || 0), 0)
        const sortedSales = [...record.sales].sort((a, b) => new Date(b.date) - new Date(a.date))

        return {
          ...record,
          key,
          sales: sortedSales,
          completedSales,
          voidedSales,
          totalSpent,
          visitCount: completedSales.length,
          lastSale: sortedSales[0],
        }
      })
      .sort((a, b) => {
        const dateDiff = new Date(b.lastUsedAt || 0) - new Date(a.lastUsedAt || 0)
        if (dateDiff !== 0) return dateDiff
        return a.name.localeCompare(b.name)
      })
  }, [clients, sales])

  const filteredClients = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return clientRecords
    return clientRecords.filter(client => client.name.toLowerCase().includes(term))
  }, [clientRecords, search])

  const selectedClient = clientRecords.find(client => client.key === selectedKey) || filteredClients[0]

  function printReceipt() {
    window.print()
  }

  return (
    <div className="client-history-page">
      <section className="sales-report-header client-history-header">
        <div>
          <span className="eyebrow">Client records</span>
          <h3>Client Sales History</h3>
          <p>Search clients and review their previous purchases, visit count, and total spend.</p>
        </div>
        <label className="client-history-search">
          <span>Search client</span>
          <input
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Client name"
            autoComplete="off"
          />
        </label>
      </section>

      <div className="client-history-layout">
        <section className="sales-report-panel client-list-panel">
          <div className="panel-heading compact">
            <div>
              <span className="eyebrow">Saved clients</span>
              <h4>{filteredClients.length} clients</h4>
            </div>
          </div>

          <div className="client-history-list">
            {filteredClients.length === 0 ? (
              <div className="report-empty">No clients found.</div>
            ) : filteredClients.map(client => (
              <button
                key={client.key}
                type="button"
                className={selectedClient?.key === client.key ? 'client-history-button active' : 'client-history-button'}
                onClick={() => setSelectedKey(client.key)}
              >
                <span>
                  <strong>{client.name}</strong>
                  <small>{client.visitCount} completed visits</small>
                </span>
                <b>{money(client.totalSpent)}</b>
              </button>
            ))}
          </div>
        </section>

        <section className="sales-report-panel client-detail-panel">
          {!selectedClient ? (
            <div className="report-empty">Select a client to view history.</div>
          ) : (
            <>
              <div className="client-detail-heading">
                <div>
                  <span className="eyebrow">Selected client</span>
                  <h4>{selectedClient.name}</h4>
                  <p>Last visit: {selectedClient.lastSale ? formatDate(selectedClient.lastSale.date) : 'No sales yet'}</p>
                </div>
              </div>

              <div className="money-summary-grid client-history-summary">
                <div className="money-card primary">
                  <span>Total spent</span>
                  <strong>{money(selectedClient.totalSpent)}</strong>
                  <small>Completed sales only</small>
                </div>
                <div className="money-card cash">
                  <span>Visits</span>
                  <strong>{selectedClient.visitCount}</strong>
                  <small>{selectedClient.voidedSales.length} voided sales excluded</small>
                </div>
                <div className="money-card net">
                  <span>Average sale</span>
                  <strong>{money(selectedClient.visitCount ? selectedClient.totalSpent / selectedClient.visitCount : 0)}</strong>
                  <small>Per completed visit</small>
                </div>
              </div>

              <div className="recent-report-list">
                <div className="panel-heading compact">
                  <div>
                    <span className="eyebrow">Purchase history</span>
                    <h4>Sales and items</h4>
                  </div>
                </div>

                {selectedClient.sales.length === 0 ? (
                  <div className="report-empty">No sales recorded for this client.</div>
                ) : selectedClient.sales.map(sale => (
                  <div key={sale.id} className={sale.voided ? 'client-sale-card voided' : 'client-sale-card'}>
                    <div className="client-sale-card-top">
                      <div>
                        <strong>{formatDate(sale.date)}</strong>
                        <span>{sale.paymentMethod || 'Cash'}{sale.voided ? ` | Voided: ${sale.voidReason || 'Voided'}` : ''}</span>
                      </div>
                      <div className="client-sale-card-actions">
                        <b>{sale.voided ? `-${money(sale.total)}` : money(sale.total)}</b>
                        <button
                          type="button"
                          className="client-receipt-button"
                          onClick={() => setReceiptSale(sale)}
                          aria-label={`View receipt for ${formatDate(sale.date)}`}
                          title="View receipt"
                        >
                          <i className="fi fi-rr-receipt" aria-hidden="true"></i>
                        </button>
                      </div>
                    </div>
                    <div className="client-sale-items">
                      {(sale.items || []).map((item, index) => (
                        <span key={`${sale.id}-${item.productId || item.name}-${index}`}>
                          {item.qty} x {item.name || 'Item'} ({money(item.lineTotal ?? item.lineSubtotal ?? ((Number(item.qty) || 0) * (Number(item.price) || 0)))})
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      </div>

      {receiptSale && (
        <div className="client-modal-backdrop receipt-backdrop">
          <div className="client-modal receipt-modal" role="dialog" aria-modal="true" aria-labelledby="client-receipt-title">
            <div
              className="receipt-paper"
              id="client-receipt-print-area"
              style={{ '--receipt-paper-width': settings.paperWidth === '58' ? '50mm' : '72mm' }}
            >
              <div className="receipt-head">
                {settings.logo && <img className="receipt-logo" src={settings.logo} alt="" />}
                <strong id="client-receipt-title">{settings.clinicName || 'Vet POS'}</strong>
                {settings.address && <span>{settings.address}</span>}
                {settings.phone && <span>{settings.phone}</span>}
                {settings.email && <span>{settings.email}</span>}
                {settings.tin && <span>TIN: {settings.tin}</span>}
                <span>{receiptSale.voided ? 'Voided Receipt' : 'Official Receipt'}</span>
                <small>{formatDate(receiptSale.date)}</small>
              </div>

              <div className="receipt-meta">
                <span>Receipt #</span>
                <strong>{receiptSale.id}</strong>
                <span>Client</span>
                <strong>{receiptSale.clientName || 'Walk-in client'}</strong>
                <span>Payment</span>
                <strong>{receiptSale.paymentMethod || 'Cash'}</strong>
              </div>

              <div className="receipt-items">
                {(receiptSale.items || []).map((item, index) => (
                  <div key={`${receiptSale.id}-${item.productId || item.name}-${index}`} className="receipt-item">
                    <div>
                      <strong>{item.name || 'Item'}</strong>
                      <span>{item.qty} x {money(item.price)}{item.discount ? ` | discount ${money(item.discount)}` : ''}</span>
                    </div>
                    <b>{money(item.lineTotal ?? item.lineSubtotal ?? ((Number(item.qty) || 0) * (Number(item.price) || 0)))}</b>
                  </div>
                ))}
              </div>

              <div className="receipt-totals">
                <div><span>Subtotal</span><strong>{money(receiptSale.subtotal)}</strong></div>
                <div><span>Discount</span><strong>-{money(receiptSale.discount)}</strong></div>
                <div className="receipt-grand-total"><span>Total</span><strong>{money(receiptSale.total)}</strong></div>
              </div>

              {receiptSale.voided && (
                <div className="receipt-foot">
                  <span>Voided: {receiptSale.voidReason || 'Voided sale'}</span>
                </div>
              )}

              <div className="receipt-foot">
                <span>{settings.footer || 'Thank you for your visit.'}</span>
                <small>Generated by Vet POS</small>
              </div>
            </div>

            <div className="receipt-actions">
              <button type="button" className="secondary-page-button" onClick={() => setReceiptSale(null)}>
                Done
              </button>
              <button type="button" className="complete-sale-button" onClick={printReceipt}>
                Print receipt
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
