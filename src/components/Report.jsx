import { useState } from 'react'
import { getStatus } from '../utils/status'
import { getUsageInLastDays, USAGE_WINDOW_DAYS } from '../utils/usage'

export default function Report({ products }) {
  const [copied, setCopied] = useState(false)
  const [selectedRestockMonth, setSelectedRestockMonth] = useState('')

  const now     = new Date()
  const dateStr = now.toLocaleDateString('en-PH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  const formatRestockDate = date => {
    const parsed = new Date(date)
    return Number.isNaN(parsed.getTime())
      ? 'Unknown date'
      : parsed.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' })
  }

  // This week is a rolling 7-day usage window from saved stock-count events.
  const withWeek = products.map(p => ({
    ...p,
    usedThisWeek: getUsageInLastDays(p)
  }))

  const soldThisWeek   = withWeek.reduce((a, p) => a + p.usedThisWeek, 0)
  const soldAllTime    = products.reduce((a, p) => a + (p.sold || 0), 0)

  const topThisWeek    = [...withWeek].filter(p => p.usedThisWeek > 0)
                          .sort((a, b) => b.usedThisWeek - a.usedThisWeek).slice(0, 5)
  const topAllTime     = [...products].sort((a, b) => b.sold - a.sold).slice(0, 5)

  const needReorder    = products
    .filter(p => getStatus(p) !== 'ok')
    .sort((a, b) => (b.reorder - b.qty) - (a.reorder - a.qty))

  const restockHistory = products
    .flatMap(product => (product.restockHistory || []).map((entry, index) => ({
      ...entry,
      productId: product.id,
      productName: product.name,
      unit: product.unit,
      entryIndex: index,
    })))
    .sort((a, b) => {
      const aTime = new Date(a.date).getTime() || 0
      const bTime = new Date(b.date).getTime() || 0
      return bTime - aTime
    })

  const restockTotals = Object.entries(
    restockHistory.reduce((totals, entry) => {
      const unit = entry.unit || 'units'
      totals[unit] = (totals[unit] || 0) + (Number(entry.added) || 0)
      return totals
    }, {})
  )
  const restockTotalText = restockTotals.length > 0
    ? restockTotals.map(([unit, total]) => `${total} ${unit}`).join(', ')
    : '0 units'
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
  const activeRestockMonth = restockMonths.some(month => month.key === selectedRestockMonth)
    ? selectedRestockMonth
    : restockMonths[0]?.key
  const selectedMonth = restockMonths.find(month => month.key === activeRestockMonth)
  const selectedMonthTotals = Object.entries(
    (selectedMonth?.entries || []).reduce((totals, entry) => {
      const unit = entry.unit || 'units'
      totals[unit] = (totals[unit] || 0) + (Number(entry.added) || 0)
      return totals
    }, {})
  ).map(([unit, total]) => `${total} ${unit}`).join(', ')

  const cats   = [...new Set(products.map(p => p.cat))].sort()
  const ok     = products.filter(p => getStatus(p) === 'ok').length
  const low    = products.filter(p => getStatus(p) === 'low').length
  const crit   = products.filter(p => getStatus(p) === 'critical').length

  const sep  = '='.repeat(54)
  const line = '-'.repeat(54)

  const reportLines = [
    sep,
    '        VETERINARY CLINIC — WEEKLY STOCK REPORT',
    `        ${dateStr}`,
    sep,
    '',
    'SUMMARY',
    `  Total products        : ${products.length}`,
    `  OK (well-stocked)     : ${ok}`,
    `  Low stock             : ${low}`,
    `  Critical              : ${crit}`,
    `  Restock events        : ${restockHistory.length}`,
    `  Total restocked       : ${restockTotalText}`,
    `  Used LAST ${USAGE_WINDOW_DAYS} DAYS     : ${soldThisWeek} units`,
    `  Used all time (total) : ${soldAllTime} units `,
    '',
    line,
    `TOP 5 MOST USED - LAST ${USAGE_WINDOW_DAYS} DAYS`,
    line,
    ...(topThisWeek.length > 0
      ? topThisWeek.map((p, i) =>
          `  ${i + 1}. ${p.name.padEnd(30)} ${String(p.usedThisWeek).padStart(4)} ${p.unit}  (last ${USAGE_WINDOW_DAYS} days)`)
      : [`  No usage recorded in the last ${USAGE_WINDOW_DAYS} days yet.`,
         '  Update stock counts via Edit to track weekly usage.']),
    '',
    line,
    'TOP 5 MOST USED — ALL TIME',
    line,
    ...(topAllTime.filter(p => p.sold > 0).length > 0
      ? topAllTime.filter(p => p.sold > 0).map((p, i) =>
          `  ${i + 1}. ${p.name.padEnd(30)} ${String(p.sold).padStart(4)} ${p.unit}  (all time)`)
      : ['  No all-time usage data yet.']),
    '',
    line,
    'ITEMS NEEDING REORDER',
    line,
    ...(needReorder.length > 0
      ? needReorder.map(p => {
          const flag = getStatus(p) === 'critical' ? '[CRITICAL]' : '[LOW]     '
          return `  ${flag} ${p.name.padEnd(26)} have ${String(p.qty).padStart(3)} ${p.unit}`
        })
      : ['  ✓ All products are sufficiently stocked.']),
    '',
    line,
    `RESTOCK HISTORY - ${selectedMonth?.label?.toUpperCase() || 'NO RECORDS'}`,
    line,
    ...(selectedMonth?.entries.length > 0
      ? selectedMonth.entries.map(entry => {
          const stockChange = Number.isFinite(Number(entry.qtyBefore)) && Number.isFinite(Number(entry.qtyAfter))
            ? `  (${entry.qtyBefore} -> ${entry.qtyAfter})`
            : ''
          return `  ${formatRestockDate(entry.date).padEnd(13)} ${entry.productName.padEnd(28)} +${entry.added} ${entry.unit}${stockChange}  - ${entry.note || 'Restocked'}`
        })
      : ['  No restocks recorded yet.']),
    '',
    line,
    'FULL INVENTORY SNAPSHOT',
    line,
    ...cats.flatMap(cat => [
      '',
      `  [ ${cat.toUpperCase()} ]`,
      ...withWeek
        .filter(p => p.cat === cat)
        .map(p => {
          const s       = getStatus(p)
          const flag    = s === 'critical' ? '  ⚠ CRITICAL' : s === 'low' ? '  ↓ LOW' : ''
          const weekStr = p.usedThisWeek > 0 ? `  (-${p.usedThisWeek} last ${USAGE_WINDOW_DAYS}d)` : ''
          return `    ${p.name.padEnd(28)} ${String(p.qty).padStart(4)} ${p.unit}${weekStr}${flag}`
        })
    ]),
    '',
    sep,
    '  Report by Pet Science Veterinary Stock ',
    sep,
  ]

  const reportText = reportLines.join('\n')

  function copy() {
    navigator.clipboard.writeText(reportText)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 2500) })
      .catch(() => alert('Copy failed — please select the text below and copy manually.'))
  }

  if (products.length === 0) {
    return (
      <div style={{ background: '#fff', border: '1px solid #eee', borderRadius: 10, padding: '3rem', textAlign: 'center', color: '#888' }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>📄</div>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>No products yet</div>
        <div style={{ fontSize: 13 }}>Add your inventory first, then come back here to generate the Friday report.</div>
      </div>
    )
  }

  return (
    <div style={{ background: '#fff', border: '1px solid #eee', borderRadius: 10, padding: '1.25rem' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>📄 Friday stock report</div>
          <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{dateStr}</div>
        </div>
        <button onClick={copy} style={{
          padding: '8px 20px',
          background: copied ? '#1D9E75' : '#fff',
          color: copied ? '#fff' : '#333',
          border: '1px solid #ddd', borderRadius: 8,
          cursor: 'pointer', fontWeight: 600, fontSize: 13, transition: 'all 0.2s'
        }}>
          {copied ? '✓ Copied!' : '📋 Copy report'}
        </button>
      </div>

      {/* Quick stats — 6 cards showing both this week and all time clearly */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8, marginBottom: 14 }}>
        {[
          { label: 'Total products', value: products.length, color: '#185FA5', sub: null },
          { label: 'OK',             value: ok,              color: '#0F6E56', sub: null },
          { label: 'Low',            value: low,             color: '#BA7517', sub: null },
          { label: 'Critical',       value: crit,            color: '#A32D2D', sub: null },
          { label: `Used last ${USAGE_WINDOW_DAYS} days`, value: soldThisWeek, color: '#5B21B6', sub: 'units' },
          { label: 'Used all time',  value: soldAllTime,     color: '#92400E', sub: 'units' },
          { label: 'Restock events', value: restockHistory.length, color: '#185FA5', sub: null },
        ].map(c => (
          <div key={c.label} style={{ background: '#f9f9f9', borderRadius: 8, padding: '8px 12px', textAlign: 'center' }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: c.color }}>{c.value}</div>
            <div style={{ fontSize: 11, color: '#888', lineHeight: 1.3 }}>{c.label}</div>
          </div>
        ))}
      </div>

      {/* Inline breakdown: this week vs all time side by side */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>

        {/* Rolling 7-day top used */}
        <div style={{ background: '#F3EEFF', border: '1px solid #DDD6FE', borderRadius: 8, padding: '10px 12px' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#5B21B6', marginBottom: 8 }}>Top used - last {USAGE_WINDOW_DAYS} days</div>
          {topThisWeek.length > 0
            ? topThisWeek.map((p, i) => (
                <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                  <span style={{ color: '#333' }}>{i + 1}. {p.name.length > 20 ? p.name.slice(0, 19) + '…' : p.name}</span>
                  <span style={{ fontWeight: 600, color: '#5B21B6' }}>{p.usedThisWeek} {p.unit}</span>
                </div>
              ))
            : <div style={{ fontSize: 12, color: '#aaa' }}>No usage in the last {USAGE_WINDOW_DAYS} days.</div>
          }
        </div>

        {/* All time top used */}
        <div style={{ background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: 8, padding: '10px 12px' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#92400E', marginBottom: 8 }}>📈 Top used — all time</div>
          {topAllTime.filter(p => p.sold > 0).length > 0
            ? topAllTime.filter(p => p.sold > 0).map((p, i) => (
                <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                  <span style={{ color: '#333' }}>{i + 1}. {p.name.length > 20 ? p.name.slice(0, 19) + '…' : p.name}</span>
                  <span style={{ fontWeight: 600, color: '#92400E' }}>{p.sold} {p.unit}</span>
                </div>
              ))
            : <div style={{ fontSize: 12, color: '#aaa' }}>No all-time data yet.</div>
          }
        </div>
      </div>

      {/* Restock history */}
      <div style={{ border: '1px solid #B5D4F4', borderRadius: 8, marginBottom: 14, overflow: 'hidden' }}>
        <div style={{ background: '#E6F1FB', padding: '10px 12px', display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#0C447C' }}>Monthly restock history</div>
          <div style={{ fontSize: 11, color: '#185FA5' }}>
            {selectedMonth?.entries.length || 0} events
            {selectedMonthTotals ? ` | ${selectedMonthTotals} received` : ''}
          </div>
        </div>
        {restockMonths.length > 0 ? (
          <>
            <div style={{
              display: 'flex', gap: 6, padding: '9px 10px', overflowX: 'auto',
              borderTop: '1px solid #dcecf9', borderBottom: '1px solid #eee', background: '#f8fbfe'
            }}>
              {restockMonths.map(month => (
                <button key={month.key} onClick={() => setSelectedRestockMonth(month.key)} style={{
                  padding: '5px 9px', borderRadius: 6, whiteSpace: 'nowrap', cursor: 'pointer', fontSize: 11,
                  border: activeRestockMonth === month.key ? '1px solid #185FA5' : '1px solid #ddd',
                  background: activeRestockMonth === month.key ? '#185FA5' : '#fff',
                  color: activeRestockMonth === month.key ? '#fff' : '#555',
                  fontWeight: activeRestockMonth === month.key ? 600 : 400,
                }}>
                  {month.label} ({month.entries.length})
                </button>
              ))}
            </div>
          <div style={{ maxHeight: 240, overflowY: 'auto' }}>
            {selectedMonth.entries.map(entry => (
              <div key={`${entry.productId}-${entry.entryIndex}`} style={{
                display: 'grid', gridTemplateColumns: '100px minmax(130px, 1fr) auto',
                gap: 10, alignItems: 'center', padding: '8px 12px',
                borderTop: '1px solid #eee', fontSize: 12
              }}>
                <span style={{ color: '#888' }}>{formatRestockDate(entry.date)}</span>
                <span>
                  <strong style={{ color: '#333' }}>{entry.productName}</strong>
                  <span style={{ display: 'block', color: '#999', marginTop: 2 }}>{entry.note || 'Restocked'}</span>
                </span>
                <span style={{ color: '#0F6E56', fontWeight: 700, textAlign: 'right' }}>
                  +{entry.added} {entry.unit}
                  {Number.isFinite(Number(entry.qtyBefore)) && Number.isFinite(Number(entry.qtyAfter)) && (
                    <span style={{ display: 'block', color: '#999', fontSize: 10, fontWeight: 400 }}>
                      {entry.qtyBefore} -&gt; {entry.qtyAfter}
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
          </>
        ) : (
          <div style={{ padding: '14px 12px', fontSize: 12, color: '#999' }}>No restocks recorded yet.</div>
        )}
      </div>

      {/* Report text */}
      <pre style={{
        fontFamily: 'monospace', fontSize: 12, whiteSpace: 'pre-wrap',
        lineHeight: 1.65, color: '#333', background: '#f9f9f9',
        borderRadius: 8, padding: '1rem', overflowX: 'auto'
      }}>
        {reportText}
      </pre>
    </div>
  )
}
