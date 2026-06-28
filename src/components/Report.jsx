import { useMemo, useState } from 'react'
import { getStatus } from '../utils/status'
import { getUsageInLastDays, USAGE_WINDOW_DAYS } from '../utils/usage'

function formatDate(dateValue, options = { year: 'numeric', month: 'short', day: 'numeric' }) {
  const date = new Date(dateValue)
  if (Number.isNaN(date.getTime())) return 'Unknown date'
  return date.toLocaleDateString('en-PH', options)
}

function quantity(value, unit) {
  return `${Number(value || 0)} ${unit || 'units'}`
}

function statusLabel(status) {
  if (status === 'critical') return 'Critical'
  if (status === 'low') return 'Low'
  return 'OK'
}

export default function Report({ products }) {
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState('')
  const [selectedRestockMonth, setSelectedRestockMonth] = useState('')
  const generatedAt = new Date()
  const dateStr = generatedAt.toLocaleDateString('en-PH', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  const data = useMemo(() => {
    const withUsage = products.map(product => ({
      ...product,
      usedThisWeek: getUsageInLastDays(product),
      status: getStatus(product),
    }))

    const categories = [...new Set(products.map(product => product.cat || 'Uncategorized'))].sort()
    const ok = withUsage.filter(product => product.status === 'ok').length
    const low = withUsage.filter(product => product.status === 'low').length
    const critical = withUsage.filter(product => product.status === 'critical').length
    const usedRecent = withUsage.reduce((sum, product) => sum + product.usedThisWeek, 0)
    const usedAllTime = withUsage.reduce((sum, product) => sum + (Number(product.sold) || 0), 0)

    const topRecent = [...withUsage]
      .filter(product => product.usedThisWeek > 0)
      .sort((a, b) => b.usedThisWeek - a.usedThisWeek)
      .slice(0, 5)

    const topAllTime = [...withUsage]
      .filter(product => (Number(product.sold) || 0) > 0)
      .sort((a, b) => (Number(b.sold) || 0) - (Number(a.sold) || 0))
      .slice(0, 5)

    const reorderItems = withUsage
      .filter(product => product.status !== 'ok')
      .sort((a, b) => {
        const aGap = (Number(a.reorder) || 0) - (Number(a.qty) || 0)
        const bGap = (Number(b.reorder) || 0) - (Number(b.qty) || 0)
        return bGap - aGap
      })

    const restockHistory = products
      .flatMap(product => (product.restockHistory || []).map((entry, index) => ({
        ...entry,
        productId: product.id,
        productName: product.name,
        unit: product.unit,
        entryIndex: index,
      })))
      .sort((a, b) => (new Date(b.date).getTime() || 0) - (new Date(a.date).getTime() || 0))

    const restockMonths = Object.values(restockHistory.reduce((months, entry) => {
      const date = new Date(entry.date)
      const key = Number.isNaN(date.getTime())
        ? 'unknown'
        : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
      if (!months[key]) {
        months[key] = {
          key,
          label: key === 'unknown'
            ? 'Unknown date'
            : date.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' }),
          entries: [],
        }
      }
      months[key].entries.push(entry)
      return months
    }, {})).sort((a, b) => b.key.localeCompare(a.key))

    const restockTotals = Object.entries(restockHistory.reduce((totals, entry) => {
      const unit = entry.unit || 'units'
      totals[unit] = (totals[unit] || 0) + (Number(entry.added) || 0)
      return totals
    }, {}))

    return {
      withUsage,
      categories,
      ok,
      low,
      critical,
      usedRecent,
      usedAllTime,
      topRecent,
      topAllTime,
      reorderItems,
      restockHistory,
      restockMonths,
      restockTotalText: restockTotals.length
        ? restockTotals.map(([unit, total]) => `${total} ${unit}`).join(', ')
        : '0 units',
    }
  }, [products])

  const activeRestockMonth = data.restockMonths.some(month => month.key === selectedRestockMonth)
    ? selectedRestockMonth
    : data.restockMonths[0]?.key
  const selectedMonth = data.restockMonths.find(month => month.key === activeRestockMonth)
  const selectedMonthTotals = Object.entries(
    (selectedMonth?.entries || []).reduce((totals, entry) => {
      const unit = entry.unit || 'units'
      totals[unit] = (totals[unit] || 0) + (Number(entry.added) || 0)
      return totals
    }, {})
  ).map(([unit, total]) => `${total} ${unit}`).join(', ')

  const reportText = useMemo(() => {
    const sep = '='.repeat(58)
    const line = '-'.repeat(58)

    return [
      sep,
      'VETERINARY CLINIC - INVENTORY REPORT',
      dateStr,
      sep,
      '',
      'SUMMARY',
      `Total products: ${products.length}`,
      `OK stock: ${data.ok}`,
      `Low stock: ${data.low}`,
      `Critical stock: ${data.critical}`,
      `Restock events: ${data.restockHistory.length}`,
      `Total restocked: ${data.restockTotalText}`,
      `Used last ${USAGE_WINDOW_DAYS} days: ${data.usedRecent} units`,
      `Used all time: ${data.usedAllTime} units`,
      '',
      line,
      `TOP USED - LAST ${USAGE_WINDOW_DAYS} DAYS`,
      line,
      ...(data.topRecent.length
        ? data.topRecent.map((product, index) => `${index + 1}. ${product.name} - ${quantity(product.usedThisWeek, product.unit)}`)
        : [`No usage recorded in the last ${USAGE_WINDOW_DAYS} days.`]),
      '',
      line,
      'TOP USED - ALL TIME',
      line,
      ...(data.topAllTime.length
        ? data.topAllTime.map((product, index) => `${index + 1}. ${product.name} - ${quantity(product.sold, product.unit)}`)
        : ['No all-time usage recorded yet.']),
      '',
      line,
      'REORDER PRIORITIES',
      line,
      ...(data.reorderItems.length
        ? data.reorderItems.map(product => `${statusLabel(product.status)}: ${product.name} - on hand ${quantity(product.qty, product.unit)}, reorder at ${quantity(product.reorder, product.unit)}`)
        : ['All products are sufficiently stocked.']),
      '',
      line,
      `RESTOCK HISTORY - ${selectedMonth?.label?.toUpperCase() || 'NO RECORDS'}`,
      line,
      ...(selectedMonth?.entries.length
        ? selectedMonth.entries.map(entry => {
            const stockChange = Number.isFinite(Number(entry.qtyBefore)) && Number.isFinite(Number(entry.qtyAfter))
              ? ` (${entry.qtyBefore} -> ${entry.qtyAfter})`
              : ''
            return `${formatDate(entry.date)} - ${entry.productName} +${quantity(entry.added, entry.unit)}${stockChange} - ${entry.note || 'Restocked'}`
          })
        : ['No restocks recorded yet.']),
      '',
      line,
      'INVENTORY SNAPSHOT',
      line,
      ...data.categories.flatMap(category => [
        '',
        `[${category.toUpperCase()}]`,
        ...data.withUsage
          .filter(product => (product.cat || 'Uncategorized') === category)
          .map(product => {
            const recent = product.usedThisWeek > 0 ? `, used ${quantity(product.usedThisWeek, product.unit)} in ${USAGE_WINDOW_DAYS} days` : ''
            return `${product.name}: ${quantity(product.qty, product.unit)} on hand${recent} - ${statusLabel(product.status)}`
          }),
      ]),
      '',
      sep,
      'Report generated by Vet POS',
      sep,
    ].join('\n')
  }, [data, dateStr, products.length, selectedMonth])

  function copy() {
    navigator.clipboard.writeText(reportText)
      .then(() => {
        setCopyError('')
        setCopied(true)
        setTimeout(() => setCopied(false), 2500)
      })
      .catch(() => setCopyError('Copy failed. Please select the report text and copy manually.'))
  }

  if (products.length === 0) {
    return (
      <div className="report-empty-page">
        <strong>No products yet</strong>
        <span>Add inventory first, then come back here to generate a stock report.</span>
      </div>
    )
  }

  return (
    <div className="stock-report-page">
      <section className="sales-report-header stock-report-header">
        <div>
          <span className="eyebrow">Inventory control</span>
          <h3>Stock Report</h3>
          <p>{dateStr}. Built for reorder checks, usage review, and restock records.</p>
        </div>
        <button type="button" className="complete-sale-button report-copy-button" onClick={copy}>
          {copied ? 'Copied' : 'Copy report'}
        </button>
      </section>

      {copyError && (
        <div className="modal-friendly-alert page-friendly-alert" role="alert">
          <i className="fi fi-rr-triangle-warning" aria-hidden="true"></i>
          <span>{copyError}</span>
          <button type="button" onClick={() => setCopyError('')} aria-label="Dismiss warning">×</button>
        </div>
      )}

      <section className="report-kpi-grid">
        <div className="inventory-summary-card">
          <span>Total products</span>
          <strong>{products.length}</strong>
          <small>{data.categories.length} categories</small>
        </div>
        <div className="inventory-summary-card">
          <span>OK stock</span>
          <strong>{data.ok}</strong>
          <small>Ready for normal use</small>
        </div>
        <div className="inventory-summary-card warning">
          <span>Low stock</span>
          <strong>{data.low}</strong>
          <small>Monitor soon</small>
        </div>
        <div className="inventory-summary-card danger">
          <span>Critical</span>
          <strong>{data.critical}</strong>
          <small>Prioritize reorder</small>
        </div>
        <div className="inventory-summary-card">
          <span>Used recently</span>
          <strong>{data.usedRecent}</strong>
          <small>Last {USAGE_WINDOW_DAYS} days</small>
        </div>
        <div className="inventory-summary-card">
          <span>Used all time</span>
          <strong>{data.usedAllTime}</strong>
          <small>Units tracked from sales/counts</small>
        </div>
      </section>

      <section className="stock-report-layout">
        <div className="sales-report-panel">
          <div className="panel-heading compact">
            <div>
              <span className="eyebrow">Action needed</span>
              <h4>Reorder priorities</h4>
            </div>
          </div>
          <div className="report-priority-list">
            {data.reorderItems.length === 0 ? (
              <div className="report-empty">All products are sufficiently stocked.</div>
            ) : data.reorderItems.slice(0, 10).map(product => (
              <div key={product.id} className={`report-priority-row ${product.status}`}>
                <div>
                  <strong>{product.name}</strong>
                  <span>{product.cat || 'Uncategorized'} | reorder at {quantity(product.reorder, product.unit)}</span>
                </div>
                <b>{quantity(product.qty, product.unit)}</b>
              </div>
            ))}
          </div>
        </div>

        <div className="sales-report-panel">
          <div className="panel-heading compact">
            <div>
              <span className="eyebrow">Usage</span>
              <h4>Top moving items</h4>
            </div>
          </div>
          <div className="report-usage-columns">
            <div>
              <h5>Last {USAGE_WINDOW_DAYS} days</h5>
              {data.topRecent.length === 0 ? (
                <div className="report-mini-empty">No recent usage yet.</div>
              ) : data.topRecent.map((product, index) => (
                <div key={product.id} className="owner-mini-row">
                  <span>{index + 1}. {product.name}</span>
                  <strong>{quantity(product.usedThisWeek, product.unit)}</strong>
                </div>
              ))}
            </div>
            <div>
              <h5>All time</h5>
              {data.topAllTime.length === 0 ? (
                <div className="report-mini-empty">No all-time usage yet.</div>
              ) : data.topAllTime.map((product, index) => (
                <div key={product.id} className="owner-mini-row">
                  <span>{index + 1}. {product.name}</span>
                  <strong>{quantity(product.sold, product.unit)}</strong>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="sales-report-panel">
        <div className="stock-report-section-heading">
          <div>
            <span className="eyebrow">Receiving record</span>
            <h4>Restock history</h4>
          </div>
          <span>{selectedMonth?.entries.length || 0} events{selectedMonthTotals ? ` | ${selectedMonthTotals} received` : ''}</span>
        </div>

        {data.restockMonths.length === 0 ? (
          <div className="report-empty">No restocks recorded yet.</div>
        ) : (
          <>
            <div className="owner-period-tabs report-month-tabs" aria-label="Restock month">
              {data.restockMonths.map(month => (
                <button
                  key={month.key}
                  type="button"
                  className={activeRestockMonth === month.key ? 'active' : ''}
                  onClick={() => setSelectedRestockMonth(month.key)}
                >
                  {month.label} ({month.entries.length})
                </button>
              ))}
            </div>
            <div className="report-restock-list">
              {selectedMonth.entries.map(entry => (
                <div key={`${entry.productId}-${entry.entryIndex}`} className="report-restock-row">
                  <span>{formatDate(entry.date)}</span>
                  <div>
                    <strong>{entry.productName}</strong>
                    <small>{entry.note || 'Restocked'}</small>
                  </div>
                  <b>
                    +{quantity(entry.added, entry.unit)}
                    {Number.isFinite(Number(entry.qtyBefore)) && Number.isFinite(Number(entry.qtyAfter)) && (
                      <small>{entry.qtyBefore} to {entry.qtyAfter}</small>
                    )}
                  </b>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="sales-report-panel">
        <div className="panel-heading compact">
          <div>
            <span className="eyebrow">Copyable output</span>
            <h4>Formatted report text</h4>
          </div>
        </div>
        <pre className="report-text-block">{reportText}</pre>
      </section>
    </div>
  )
}
