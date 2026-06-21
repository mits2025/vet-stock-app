import { useState } from 'react'
import { Bar, Doughnut, Line } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  ArcElement,
  BarElement,
  CategoryScale,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
} from 'chart.js'
import { getStatus } from '../utils/status'

ChartJS.register(
  ArcElement,
  BarElement,
  CategoryScale,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip
)

const RANGE_OPTIONS = [
  { value: '4', label: 'Last 4 weeks' },
  { value: '12', label: 'Last 12 weeks' },
  { value: 'all', label: 'All time' },
]

function validDate(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function startOfWeek(value) {
  const date = new Date(value)
  const day = date.getDay()
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() - day)
  return date
}

function formatWeek(date) {
  return date.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })
}

function monthKey(value) {
  const date = new Date(value)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function formatMonth(value) {
  return new Date(value).toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

export default function Analytics({ products }) {
  const [range, setRange] = useState('12')
  const [copied, setCopied] = useState(false)

  if (products.length === 0) {
    return (
      <div style={{ background: '#fff', border: '1px solid #eee', borderRadius: 10, padding: '3rem', textAlign: 'center', color: '#888' }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>Analytics</div>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>No data yet</div>
        <div style={{ fontSize: 13 }}>Add products and update stock counts to see analytics.</div>
      </div>
    )
  }

  const now = new Date()
  const cutoff = range === 'all'
    ? null
    : new Date(now.getTime() - Number(range) * 7 * 24 * 60 * 60 * 1000)

  const historyInRange = product => (product.countHistory || []).filter(entry => {
    const date = validDate(entry.date)
    return date && (!cutoff || date >= cutoff)
  })
  const restocksInRange = product => (product.restockHistory || []).filter(entry => {
    const date = validDate(entry.date)
    return date && (!cutoff || date >= cutoff)
  })

  const productMetrics = products.map(product => {
    const entries = historyInRange(product)
    const totalUsed = entries.reduce((sum, entry) => sum + (Number(entry.usedWeek) || 0), 0)
    const averageWeeklyUsage = entries.length > 0 ? totalUsed / entries.length : 0
    const weeksRemaining = averageWeeklyUsage > 0 ? product.qty / averageWeeklyUsage : null
    const suggestedRestock = Math.max(
      0,
      Math.ceil(averageWeeklyUsage * 4 - product.qty),
      Number(product.reorder) - Number(product.qty)
    )
    const lastCount = [...(product.countHistory || [])]
      .map(entry => validDate(entry.date))
      .filter(Boolean)
      .sort((a, b) => b - a)[0]

    return {
      ...product,
      totalUsed,
      averageWeeklyUsage,
      weeksRemaining,
      suggestedRestock,
      lastCount,
    }
  })

  const datedEntries = products.flatMap(product =>
    historyInRange(product).map(entry => ({ ...entry, productName: product.name }))
  )
  const datedRestocks = products.flatMap(product =>
    restocksInRange(product).map((entry, index) => ({
      ...entry,
      productId: product.id,
      productName: product.name,
      unit: product.unit,
      index,
    }))
  ).sort((a, b) => validDate(b.date) - validDate(a.date))

  const earliestEntry = [...datedEntries, ...datedRestocks]
    .map(entry => validDate(entry.date))
    .filter(Boolean)
    .sort((a, b) => a - b)[0]

  const firstWeek = startOfWeek(
    cutoff || earliestEntry || new Date(now.getTime() - 3 * 7 * 24 * 60 * 60 * 1000)
  )
  const currentWeek = startOfWeek(now)
  const weeklyBuckets = []

  for (let date = new Date(firstWeek); date <= currentWeek; date.setDate(date.getDate() + 7)) {
    weeklyBuckets.push({
      key: date.toISOString().slice(0, 10),
      label: formatWeek(date),
      used: 0,
    })
  }

  datedEntries.forEach(entry => {
    const date = validDate(entry.date)
    const key = startOfWeek(date).toISOString().slice(0, 10)
    const bucket = weeklyBuckets.find(item => item.key === key)
    if (bucket) bucket.used += Number(entry.usedWeek) || 0
  })
  const monthlyRestocks = Object.values(datedRestocks.reduce((months, entry) => {
    const date = validDate(entry.date)
    const key = monthKey(date)
    if (!months[key]) {
      months[key] = {
        key,
        label: formatMonth(date),
        restocks: [],
      }
    }
    months[key].restocks.push(entry)
    return months
  }, {})).sort((a, b) => a.key.localeCompare(b.key))

  const ok = products.filter(product => getStatus(product) === 'ok').length
  const low = products.filter(product => getStatus(product) === 'low').length
  const critical = products.filter(product => getStatus(product) === 'critical').length
  const outOfStock = products.filter(product => product.qty <= 0).length
  const needReorder = productMetrics
    .filter(product => getStatus(product) !== 'ok')
    .sort((a, b) => (b.reorder - b.qty) - (a.reorder - a.qty))
  const fastestMoving = [...productMetrics]
    .filter(product => product.averageWeeklyUsage > 0)
    .sort((a, b) => b.averageWeeklyUsage - a.averageWeeklyUsage)
    .slice(0, 6)
  const leastUsed = [...productMetrics]
    .filter(product => product.averageWeeklyUsage > 0)
    .sort((a, b) => a.averageWeeklyUsage - b.averageWeeklyUsage)
    .slice(0, 6)
  const slowMoving = productMetrics.filter(product => product.totalUsed === 0)
  const categoryMovingAverages = Object.values(productMetrics.reduce((categories, product) => {
    const category = product.cat || 'Uncategorized'
    if (!categories[category]) {
      categories[category] = {
        category,
        products: [],
      }
    }
    categories[category].products.push(product)
    return categories
  }, {}))
    .map(group => {
      const usedProducts = group.products.filter(product => product.averageWeeklyUsage > 0)
      const totalUsed = group.products.reduce((sum, product) => sum + product.totalUsed, 0)
      return {
        ...group,
        totalUsed,
        usedProducts: [...usedProducts].sort((a, b) => b.averageWeeklyUsage - a.averageWeeklyUsage),
        fastMovingRanked: [...usedProducts].sort((a, b) => b.averageWeeklyUsage - a.averageWeeklyUsage),
        leastMovingRanked: [...usedProducts].sort((a, b) => a.averageWeeklyUsage - b.averageWeeklyUsage),
      }
    })
    .sort((a, b) => b.totalUsed - a.totalUsed || a.category.localeCompare(b.category))
  const runningLow = [...productMetrics]
    .filter(product => product.weeksRemaining !== null)
    .sort((a, b) => a.weeksRemaining - b.weeksRemaining)
  const staleProducts = productMetrics.filter(product =>
    !product.lastCount || now - product.lastCount > 14 * 24 * 60 * 60 * 1000
  )
  const planningProducts = [...productMetrics]
    .filter(product => product.averageWeeklyUsage > 0 || getStatus(product) !== 'ok')
    .sort((a, b) => {
      if (a.weeksRemaining === null) return 1
      if (b.weeksRemaining === null) return -1
      return a.weeksRemaining - b.weeksRemaining
    })
  const suggestedRestockByCategory = Object.values(planningProducts
    .filter(product => product.suggestedRestock > 0)
    .reduce((categories, product) => {
      const category = product.cat || 'Uncategorized'
      if (!categories[category]) {
        categories[category] = {
          category,
          products: [],
          totalSuggested: 0,
        }
      }
      categories[category].products.push(product)
      categories[category].totalSuggested += product.suggestedRestock
      return categories
    }, {}))
    .map(group => ({
      ...group,
      products: group.products.sort((a, b) => {
        if (a.weeksRemaining === null) return 1
        if (b.weeksRemaining === null) return -1
        return a.weeksRemaining - b.weeksRemaining
      }),
    }))
    .sort((a, b) => b.totalSuggested - a.totalSuggested || a.category.localeCompare(b.category))

  const cardStyle = {
    background: '#fff', border: '1px solid #eee',
    borderRadius: 10, padding: '1rem 1.25rem'
  }
  const sectionTitle = text => (
    <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12, color: '#333' }}>{text}</div>
  )
  const totalUsed = productMetrics.reduce((sum, product) => sum + product.totalUsed, 0)
  const suggestedOrders = planningProducts.filter(product => product.suggestedRestock > 0).length
  const rangeLabel = RANGE_OPTIONS.find(option => option.value === range)?.label || 'Selected period'
  const reportLine = '-'.repeat(58)
  const analyticsReport = [
    'INVENTORY ANALYTICS REPORT',
    `Generated: ${now.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })}`,
    `Period: ${rangeLabel}`,
    reportLine,
    'SUMMARY',
    `  Products                  : ${products.length}`,
    `  Used in period            : ${totalUsed} units`,
    `  Restock deliveries        : ${datedRestocks.length}`,
    `  Need reorder              : ${needReorder.length}`,
    `  Out of stock              : ${outOfStock}`,
    `  Suggested product orders  : ${suggestedOrders}`,
    '',
    'STOCK HEALTH',
    `  OK                        : ${ok}`,
    `  Low stock                 : ${low}`,
    `  Critical                  : ${critical}`,
    '',
    'FAST-MOVING PRODUCTS',
    ...(fastestMoving.length > 0
      ? fastestMoving.map((product, index) =>
          `  ${index + 1}. ${product.name}: ${product.averageWeeklyUsage.toFixed(1)} ${product.unit} average per count`)
      : ['  No usage recorded in this period.']),
    '',
    'LEAST-USED PRODUCTS',
    ...(leastUsed.length > 0
      ? leastUsed.map((product, index) =>
          `  ${index + 1}. ${product.name}: ${product.averageWeeklyUsage.toFixed(1)} ${product.unit} average per count`)
      : ['  No usage recorded in this period.']),
    '',
    'CATEGORY PRODUCT MOVING AVERAGES',
    ...(categoryMovingAverages.length > 0
      ? categoryMovingAverages.flatMap(group => [
          `  ${group.category}: ${group.totalUsed} units used across ${group.usedProducts.length} moving ${group.usedProducts.length === 1 ? 'item' : 'items'}`,
          ...(group.usedProducts.length > 0
            ? [
                '    Fast-moving ranking:',
                ...group.fastMovingRanked.slice(0, 5).map((product, index) =>
                  `      ${index + 1}. ${product.name}: ${product.averageWeeklyUsage.toFixed(1)} ${product.unit} average; ${product.totalUsed} used`),
                '    Least-moving ranking:',
                ...group.leastMovingRanked.slice(0, 5).map((product, index) =>
                  `      ${index + 1}. ${product.name}: ${product.averageWeeklyUsage.toFixed(1)} ${product.unit} average; ${product.totalUsed} used`)
              ]
            : ['    No product usage recorded in this category.']),
        ])
      : ['  No categories found.']),
    '',
    'RESTOCK RECOMMENDATIONS',
    ...(suggestedRestockByCategory.length > 0
      ? suggestedRestockByCategory.flatMap(group => [
          `  ${group.category}: ${group.products.length} ${group.products.length === 1 ? 'item' : 'items'} to restock`,
          ...group.products.map(product =>
            `    - ${product.name}: +${product.suggestedRestock} ${product.unit}` +
            (product.weeksRemaining === null ? ' (no usage data)' : ` (${product.weeksRemaining.toFixed(1)} weeks remaining)`))
        ])
      : ['  No products currently need a suggested restock.']),
    reportLine,
  ].join('\n')

  function copyAnalyticsReport() {
    const richReport = `<pre style="font-family: 'Courier New', Courier, monospace; white-space: pre-wrap;">${escapeHtml(analyticsReport)}</pre>`
    const copyPromise = typeof ClipboardItem === 'undefined'
      ? navigator.clipboard.writeText(analyticsReport)
      : navigator.clipboard.write([new ClipboardItem({
          'text/plain': new Blob([analyticsReport], { type: 'text/plain' }),
          'text/html': new Blob([richReport], { type: 'text/html' }),
        })])

    copyPromise
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2500)
      })
      .catch(() => alert('Copy failed. Please try again.'))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Inventory analytics</div>
          <div style={{ color: '#888', fontSize: 12, marginTop: 2 }}>Usage averages are calculated from recorded stock counts.</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select value={range} onChange={event => setRange(event.target.value)}
            style={{ padding: '7px 10px', border: '1px solid #ddd', borderRadius: 8, background: '#fff', fontSize: 13 }}>
            {RANGE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <button onClick={copyAnalyticsReport} style={{
            padding: '7px 12px', border: '1px solid #ddd', borderRadius: 8,
            background: copied ? '#1D9E75' : '#fff', color: copied ? '#fff' : '#333',
            cursor: 'pointer', fontSize: 13, fontWeight: 600
          }}>
            {copied ? 'Copied!' : 'Copy analytics report'}
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 10 }}>
        {[
          { label: 'Used in period', value: totalUsed, sub: 'units', color: '#5B21B6' },
          { label: 'Restocks in period', value: datedRestocks.length, sub: 'recorded deliveries', color: '#0F6E56' },
          { label: 'Need reorder', value: needReorder.length, sub: 'products', color: '#A32D2D' },
          { label: 'Out of stock', value: outOfStock, sub: 'products', color: '#791F1F' },
          { label: 'Suggested orders', value: suggestedOrders, sub: 'products to restock', color: '#185FA5' },
          { label: 'Count overdue', value: staleProducts.length, sub: 'over 14 days', color: '#BA7517' },
        ].map(card => (
          <div key={card.label} style={cardStyle}>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>{card.label}</div>
            <div style={{ fontSize: 23, fontWeight: 700, color: card.color }}>{card.value}</div>
            <div style={{ fontSize: 10, color: '#aaa', marginTop: 2 }}>{card.sub}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 14 }}>
        <div style={cardStyle}>
          {sectionTitle('Weekly usage trend')}
          {datedEntries.length > 0 ? (
            <Line
              data={{
                labels: weeklyBuckets.map(bucket => bucket.label),
                datasets: [{
                  label: 'Units used',
                  data: weeklyBuckets.map(bucket => bucket.used),
                  borderColor: '#5B21B6',
                  backgroundColor: '#DDD6FE',
                  pointBackgroundColor: '#5B21B6',
                  tension: 0.25,
                }]
              }}
              options={{ responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }}
            />
          ) : <div style={{ color: '#aaa', fontSize: 13 }}>No stock-count usage recorded in this period.</div>}
        </div>

        <div style={cardStyle}>
          {sectionTitle('Monthly restock activity')}
          {datedRestocks.length > 0 ? (
            <Bar
              data={{
                labels: monthlyRestocks.map(month => month.label),
                datasets: [{
                  label: 'Restock events',
                  data: monthlyRestocks.map(month => month.restocks.length),
                  backgroundColor: '#1D9E75',
                  borderRadius: 4,
                }]
              }}
              options={{
                responsive: true,
                plugins: { legend: { display: false } },
                scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
              }}
            />
          ) : <div style={{ color: '#aaa', fontSize: 13 }}>No restocks recorded in this period.</div>}
        </div>

        <div style={cardStyle}>
          {sectionTitle('Stock health')}
          <Doughnut
            data={{
              labels: ['OK', 'Low stock', 'Critical'],
              datasets: [{
                data: [ok, low, critical],
                backgroundColor: ['#1D9E75', '#EF9F27', '#E24B4A'],
                borderWidth: 1,
                borderColor: '#fff'
              }]
            }}
            options={{ responsive: true, plugins: { legend: { position: 'bottom', labels: { font: { size: 11 }, padding: 12 } } } }}
          />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 14 }}>
        <div style={cardStyle}>
          {sectionTitle('Fast-moving products - highest average usage')}
          {fastestMoving.length > 0 ? (
            <Bar
              data={{
                labels: fastestMoving.map(product => product.name.length > 16 ? `${product.name.slice(0, 15)}...` : product.name),
                datasets: [{
                  label: 'Average used per count',
                  data: fastestMoving.map(product => Number(product.averageWeeklyUsage.toFixed(1))),
                  backgroundColor: '#1D9E75',
                  borderRadius: 4,
                }]
              }}
              options={{ indexAxis: 'y', responsive: true, plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true } } }}
            />
          ) : <div style={{ color: '#aaa', fontSize: 13 }}>No usage recorded in this period.</div>}
        </div>

        <div style={cardStyle}>
          {sectionTitle('Least-used products - lowest average usage')}
          {leastUsed.length > 0 ? (
            <Bar
              data={{
                labels: leastUsed.map(product => product.name.length > 16 ? `${product.name.slice(0, 15)}...` : product.name),
                datasets: [{
                  label: 'Average used per count',
                  data: leastUsed.map(product => Number(product.averageWeeklyUsage.toFixed(1))),
                  backgroundColor: '#EF9F27',
                  borderRadius: 4,
                }]
              }}
              options={{ indexAxis: 'y', responsive: true, plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true } } }}
            />
          ) : <div style={{ color: '#aaa', fontSize: 13 }}>No usage recorded in this period.</div>}
        </div>

        <div style={cardStyle}>
          {sectionTitle('Lowest estimated stock coverage')}
          {runningLow.length > 0 ? runningLow.slice(0, 6).map(product => (
            <div key={product.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '7px 0', borderBottom: '1px solid #f2f2f2', fontSize: 12 }}>
              <span>{product.name}</span>
              <strong style={{ color: product.weeksRemaining < 2 ? '#A32D2D' : '#BA7517' }}>
                {product.weeksRemaining.toFixed(1)} weeks
              </strong>
            </div>
          )) : <div style={{ color: '#aaa', fontSize: 13 }}>Record usage to estimate weeks remaining.</div>}
        </div>
      </div>

      <div style={cardStyle}>
        {sectionTitle('Category product moving averages')}
        {categoryMovingAverages.length > 0 ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 12 }}>
            {categoryMovingAverages.map(group => (
              <div key={group.category} style={{ border: '1px solid #eee', borderRadius: 8, overflow: 'hidden' }}>
                <div style={{
                  display: 'flex', justifyContent: 'space-between', gap: 10,
                  padding: '8px 10px', background: '#F7FAFC', borderBottom: '1px solid #eee'
                }}>
                  <strong style={{ fontSize: 13, color: '#333' }}>{group.category}</strong>
                  <span style={{ fontSize: 11, color: '#888' }}>{group.totalUsed} used</span>
                </div>
                <div style={{ padding: 10, borderBottom: '1px solid #f2f2f2' }}>
                  <div style={{ fontSize: 11, color: '#185FA5', fontWeight: 700, marginBottom: 4 }}>Items moving</div>
                  <strong style={{ fontSize: 18, color: '#185FA5' }}>{group.usedProducts.length}</strong>
                </div>
                {group.usedProducts.length > 0 ? (
                  <div style={{ padding: '8px 10px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 12 }}>
                      <div>
                        <div style={{ fontSize: 11, color: '#0F6E56', fontWeight: 700, marginBottom: 6 }}>Fast-moving ranking</div>
                        {group.fastMovingRanked.slice(0, 5).map((product, index) => (
                          <div key={product.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '4px 0', fontSize: 12 }}>
                            <span>{index + 1}. {product.name}</span>
                            <strong style={{ color: '#0F6E56', whiteSpace: 'nowrap' }}>{product.averageWeeklyUsage.toFixed(1)} avg</strong>
                          </div>
                        ))}
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: '#BA7517', fontWeight: 700, marginBottom: 6 }}>Least-moving ranking</div>
                        {group.leastMovingRanked.slice(0, 5).map((product, index) => (
                          <div key={product.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '4px 0', fontSize: 12 }}>
                            <span>{index + 1}. {product.name}</span>
                            <strong style={{ color: '#BA7517', whiteSpace: 'nowrap' }}>{product.averageWeeklyUsage.toFixed(1)} avg</strong>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={{ padding: '10px', color: '#aaa', fontSize: 12 }}>No product usage recorded in this category.</div>
                )}
              </div>
            ))}
          </div>
        ) : <div style={{ color: '#aaa', fontSize: 13 }}>No categories found.</div>}
      </div>

      <div style={cardStyle}>
        {sectionTitle('Suggested restock planning by category - target: 4 weeks')}
        {suggestedRestockByCategory.length > 0 ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 12 }}>
            {suggestedRestockByCategory.map(group => (
              <div key={group.category} style={{ border: '1px solid #eee', borderRadius: 8, overflow: 'hidden' }}>
                <div style={{
                  display: 'flex', justifyContent: 'space-between', gap: 10,
                  background: '#F7FAFC', borderBottom: '1px solid #eee', padding: '8px 10px'
                }}>
                  <strong style={{ fontSize: 13, color: '#333' }}>{group.category}</strong>
                  <span style={{ fontSize: 11, color: '#185FA5', fontWeight: 700 }}>
                    {group.products.length} {group.products.length === 1 ? 'item' : 'items'}
                  </span>
                </div>
                {group.products.map(product => {
                  const status = getStatus(product)
                  return (
                    <div key={product.id} style={{ padding: '9px 10px', borderTop: '1px solid #f5f5f5', fontSize: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 4 }}>
                        <strong style={{ color: '#333' }}>{product.name}</strong>
                        <strong style={{ color: '#185FA5', whiteSpace: 'nowrap' }}>+{product.suggestedRestock} {product.unit}</strong>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8, color: '#666' }}>
                        <span>Stock: {product.qty} {product.unit}</span>
                        <span>Avg: {product.averageWeeklyUsage.toFixed(1)}</span>
                        <span style={{ color: product.weeksRemaining !== null && product.weeksRemaining < 2 ? '#A32D2D' : '#666', fontWeight: 600 }}>
                          {product.weeksRemaining === null ? 'No usage data' : `${product.weeksRemaining.toFixed(1)} wks`}
                        </span>
                      </div>
                      <div style={{ color: status === 'critical' ? '#A32D2D' : status === 'low' ? '#BA7517' : '#888', fontSize: 11, marginTop: 5, textTransform: 'capitalize' }}>
                        {status}
                      </div>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        ) : <div style={{ color: '#0F6E56', fontSize: 13 }}>No products currently need suggested restock planning.</div>}
      </div>

      {(staleProducts.length > 0 || slowMoving.length > 0) && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 14 }}>
          {staleProducts.length > 0 && (
            <div style={{ ...cardStyle, borderColor: '#F9C97C', background: '#FFF9F0' }}>
              {sectionTitle(`Count overdue (${staleProducts.length})`)}
              <div style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>These products have not been counted in the last 14 days.</div>
              {staleProducts.slice(0, 8).map(product => (
                <div key={product.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: 12 }}>
                  <span>{product.name}</span>
                  <span style={{ color: '#BA7517' }}>{product.lastCount ? product.lastCount.toLocaleDateString('en-PH') : 'Never counted'}</span>
                </div>
              ))}
            </div>
          )}

          {slowMoving.length > 0 && (
            <div style={cardStyle}>
              {sectionTitle(`No usage in selected period (${slowMoving.length})`)}
              <div style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>Review these products for excess stock or missing count data.</div>
              {slowMoving.slice(0, 8).map(product => (
                <div key={product.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: 12 }}>
                  <span>{product.name}</span>
                  <span style={{ color: '#888' }}>{product.qty} {product.unit} on hand</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div style={cardStyle}>
        {sectionTitle('Current stock vs reorder level')}
        <Bar
          data={{
            labels: products.map(product => product.name.length > 13 ? `${product.name.slice(0, 12)}...` : product.name),
            datasets: [
              { label: 'Current qty', data: products.map(product => product.qty), backgroundColor: '#378ADD', borderRadius: 3 },
              { label: 'Reorder level', data: products.map(product => product.reorder), backgroundColor: '#E24B4A', borderRadius: 3 }
            ]
          }}
          options={{
            responsive: true,
            plugins: { legend: { position: 'top', labels: { font: { size: 11 } } } },
            scales: { x: { ticks: { font: { size: 10 }, maxRotation: 45 } }, y: { beginAtZero: true } }
          }}
        />
      </div>
    </div>
  )
}
