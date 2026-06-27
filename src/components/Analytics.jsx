import { useState } from 'react'
import { Line } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  CategoryScale,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
} from 'chart.js'
import { getStatus } from '../utils/status'

ChartJS.register(
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

const ANALYTICS_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'reorder', label: 'Reorder planning' },
  { id: 'risk', label: 'Inventory risk' },
  { id: 'supplier', label: 'Supplier reliability' },
  { id: 'movement', label: 'Movement trends' },
]

const DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_LEAD_TIME_DAYS = 7
const DEFAULT_TARGET_DAYS = 28
const DEAD_STOCK_DAYS = 60
const OVERSTOCK_REORDER_MULTIPLE = 3
const LOW_USAGE_WEEKLY_THRESHOLD = 1

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

function formatMoney(value) {
  return `₱${Number(value || 0).toFixed(2)}`
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function formatPercent(value) {
  if (value === null || !Number.isFinite(value)) return 'No prior period'
  if (Math.abs(value) < 1) return 'Flat vs last period'
  return `${value > 0 ? '+' : ''}${value.toFixed(0)}% vs last period`
}

function comparePeriods(current, previous) {
  if (previous === 0) return current === 0 ? 0 : null
  return ((current - previous) / previous) * 100
}

function compareStyle(value) {
  if (value === null || !Number.isFinite(value) || Math.abs(value) < 1) {
    return { background: '#EEF2F5', color: '#526170' }
  }
  return value > 0
    ? { background: '#E1F5EE', color: '#085041' }
    : { background: '#FCEBEB', color: '#791F1F' }
}

function trendWeightedAverage(entries, now) {
  if (entries.length === 0) return 0

  const weighted = entries.reduce((totals, entry) => {
    const date = validDate(entry.date)
    if (!date) return totals
    const ageDays = Math.max(0, (now - date) / DAY_MS)
    const weight = 1 / (1 + ageDays / 14)
    const used = Math.max(0, Number(entry.usedWeek) || 0)
    return {
      usage: totals.usage + used * weight,
      weight: totals.weight + weight,
    }
  }, { usage: 0, weight: 0 })

  return weighted.weight > 0 ? weighted.usage / weighted.weight : 0
}

function usageVariance(entries) {
  const values = entries.map(entry => Math.max(0, Number(entry.usedWeek) || 0))
  if (values.length < 3) return { isVolatile: false, coefficient: 0 }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  if (mean === 0) return { isVolatile: false, coefficient: 0 }
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length
  const coefficient = Math.sqrt(variance) / mean
  const max = Math.max(...values)
  return {
    isVolatile: coefficient >= 0.75 || max >= mean * 2.5,
    coefficient,
  }
}

function staleThresholdDays(weeklyUsage) {
  if (weeklyUsage >= 10) return 7
  if (weeklyUsage >= 3) return 14
  return 30
}

function getRestockReliability(product, plannedLeadTimeDays, now) {
  const reorderLevel = Number(product.reorder) || 0
  if (reorderLevel <= 0) {
    return { events: [], openLate: null, averageActualDays: null, averageLateDays: 0, onTimeRate: null, isSupplierRisk: false }
  }

  const reorderHits = [...(product.countHistory || [])]
    .map(entry => ({ ...entry, date: validDate(entry.date) }))
    .filter(entry => entry.date && Number(entry.qtyAfter) <= reorderLevel && Number(entry.qtyBefore) > reorderLevel)
    .sort((a, b) => a.date - b.date)
  const restocks = [...(product.restockHistory || [])]
    .map(entry => ({ ...entry, date: validDate(entry.date) }))
    .filter(entry => entry.date)
    .sort((a, b) => a.date - b.date)
  const events = []

  reorderHits.forEach(hit => {
    const nextRestock = restocks.find(restock => restock.date > hit.date)
    if (!nextRestock) return
    const actualDays = Math.max(0, Math.ceil((nextRestock.date - hit.date) / DAY_MS))
    events.push({
      hitDate: hit.date,
      restockDate: nextRestock.date,
      actualDays,
      plannedLeadTimeDays,
      lateDays: actualDays - plannedLeadTimeDays,
      isLate: actualDays > plannedLeadTimeDays,
    })
  })

  const lastOpenHit = [...reorderHits]
    .reverse()
    .find(hit => !restocks.some(restock => restock.date > hit.date))
  const openLate = lastOpenHit && Math.ceil((now - lastOpenHit.date) / DAY_MS) > plannedLeadTimeDays
    ? {
        hitDate: lastOpenHit.date,
        daysWaiting: Math.max(0, Math.ceil((now - lastOpenHit.date) / DAY_MS)),
        plannedLeadTimeDays,
      }
    : null
  const lateEvents = events.filter(event => event.isLate)
  const averageActualDays = events.length > 0
    ? events.reduce((sum, event) => sum + event.actualDays, 0) / events.length
    : null
  const averageLateDays = lateEvents.length > 0
    ? lateEvents.reduce((sum, event) => sum + event.lateDays, 0) / lateEvents.length
    : 0
  const onTimeRate = events.length > 0
    ? ((events.length - lateEvents.length) / events.length) * 100
    : null

  return {
    events,
    openLate,
    averageActualDays,
    averageLateDays,
    onTimeRate,
    isSupplierRisk: lateEvents.length >= 2 || averageLateDays > 2 || Boolean(openLate),
  }
}

export default function Analytics({ products, onApplyReorderLevels }) {
  const [range, setRange] = useState('12')
  const [copied, setCopied] = useState(false)
  const [activeAnalyticsTab, setActiveAnalyticsTab] = useState('overview')

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
  const rangeWeeks = range === 'all' ? null : Number(range)
  const cutoff = range === 'all'
    ? null
    : new Date(now.getTime() - rangeWeeks * 7 * DAY_MS)
  const previousCutoff = range === 'all'
    ? null
    : new Date(now.getTime() - rangeWeeks * 14 * DAY_MS)

  const historyInRange = product => (product.countHistory || []).filter(entry => {
    const date = validDate(entry.date)
    return date && (!cutoff || date >= cutoff)
  })
  const restocksInRange = product => (product.restockHistory || []).filter(entry => {
    const date = validDate(entry.date)
    return date && (!cutoff || date >= cutoff)
  })
  const historyInPreviousRange = product => (product.countHistory || []).filter(entry => {
    const date = validDate(entry.date)
    return date && previousCutoff && cutoff && date >= previousCutoff && date < cutoff
  })
  const restocksInPreviousRange = product => (product.restockHistory || []).filter(entry => {
    const date = validDate(entry.date)
    return date && previousCutoff && cutoff && date >= previousCutoff && date < cutoff
  })

  const stockProducts = products.filter(product => product.trackStock !== false)
  const previousUsedTotal = range === 'all'
    ? null
    : products.reduce((sum, product) => (
        sum + historyInPreviousRange(product).reduce((entrySum, entry) => entrySum + (Number(entry.usedWeek) || 0), 0)
      ), 0)
  const previousRestockTotal = range === 'all'
    ? null
    : products.reduce((sum, product) => sum + restocksInPreviousRange(product).length, 0)

  let productMetrics = stockProducts.map(product => {
    const entries = historyInRange(product)
    const totalUsed = entries.reduce((sum, entry) => sum + (Number(entry.usedWeek) || 0), 0)
    const flatAverageUsage = entries.length > 0 ? totalUsed / entries.length : 0
    const averageWeeklyUsage = trendWeightedAverage(entries, now)
    const weeksRemaining = averageWeeklyUsage > 0 ? Number(product.qty) / averageWeeklyUsage : null
    const leadTimeDays = Math.max(0, Number(product.leadTimeDays) || DEFAULT_LEAD_TIME_DAYS)
    const safetyBuffer = Math.max(0, Number(product.safetyBuffer) || averageWeeklyUsage)
    const leadTimeDemand = averageWeeklyUsage * (leadTimeDays / 7)
    const automatedReorderPoint = Math.ceil(leadTimeDemand + safetyBuffer)
    const smartReorderPoint = Math.ceil(Math.max(Number(product.reorder) || 0, automatedReorderPoint))
    const restockReliability = getRestockReliability(product, leadTimeDays, now)
    const targetStock = Math.ceil(averageWeeklyUsage * (DEFAULT_TARGET_DAYS / 7) + safetyBuffer)
    const suggestedRestock = Math.max(
      0,
      targetStock - Number(product.qty),
      smartReorderPoint - Number(product.qty)
    )
    const volatility = usageVariance(entries)
    const lastCount = [...(product.countHistory || [])]
      .map(entry => validDate(entry.date))
      .filter(Boolean)
      .sort((a, b) => b - a)[0]
    const countStaleAfterDays = staleThresholdDays(averageWeeklyUsage)
    const isCountOverdue = !lastCount || now - lastCount > countStaleAfterDays * DAY_MS
    const usageValue = totalUsed * (Number(product.price) || 0)
    const stockValue = Math.max(0, Number(product.qty) || 0) * Math.max(0, Number(product.price) || 0)
    const reorderLevel = Math.max(0, Number(product.reorder) || 0)
    const overstockUnits = reorderLevel > 0 && Number(product.qty) >= reorderLevel * OVERSTOCK_REORDER_MULTIPLE && averageWeeklyUsage <= LOW_USAGE_WEEKLY_THRESHOLD
      ? Math.max(0, Number(product.qty) - reorderLevel)
      : 0
    const overstockValue = overstockUnits * Math.max(0, Number(product.price) || 0)
    const usedInLast60Days = (product.countHistory || []).some(entry => {
      const date = validDate(entry.date)
      return date && now - date <= DEAD_STOCK_DAYS * DAY_MS && (Number(entry.usedWeek) || 0) > 0
    })
    const lastUsedDate = [...(product.countHistory || [])]
      .filter(entry => (Number(entry.usedWeek) || 0) > 0)
      .map(entry => validDate(entry.date))
      .filter(Boolean)
      .sort((a, b) => b - a)[0]
    const isDeadStock = stockValue > 0 && !usedInLast60Days

    return {
      ...product,
      totalUsed,
      flatAverageUsage,
      averageWeeklyUsage,
      weeksRemaining,
      leadTimeDays,
      safetyBuffer,
      automatedReorderPoint,
      smartReorderPoint,
      restockReliability,
      suggestedRestock,
      lastCount,
      countStaleAfterDays,
      isCountOverdue,
      usageValue,
      stockValue,
      isDeadStock,
      lastUsedDate,
      overstockUnits,
      overstockValue,
      isOverstocked: overstockUnits > 0,
      abcTier: 'C',
      isVolatile: volatility.isVolatile,
      volatilityCoefficient: volatility.coefficient,
    }
  })
  const totalUsageValue = productMetrics.reduce((sum, product) => sum + product.usageValue, 0)
  productMetrics = [...productMetrics]
    .sort((a, b) => b.usageValue - a.usageValue || b.totalUsed - a.totalUsed)
    .reduce((ranked, product) => {
      const cumulativeUsageValue = ranked.cumulativeUsageValue + product.usageValue
      const share = totalUsageValue > 0 ? cumulativeUsageValue / totalUsageValue : 1
      ranked.products.push({
          ...product,
          abcTier: share <= 0.8 ? 'A' : share <= 0.95 ? 'B' : 'C',
        })
      ranked.cumulativeUsageValue = cumulativeUsageValue
      return ranked
    }, { products: [], cumulativeUsageValue: 0 }).products

  const datedEntries = stockProducts.flatMap(product =>
    historyInRange(product).map(entry => ({ ...entry, productName: product.name }))
  )
  const datedRestocks = stockProducts.flatMap(product =>
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
  const ok = stockProducts.filter(product => getStatus(product) === 'ok').length
  const low = stockProducts.filter(product => getStatus(product) === 'low').length
  const critical = stockProducts.filter(product => getStatus(product) === 'critical').length
  const outOfStock = stockProducts.filter(product => product.qty <= 0).length
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
  const staleProducts = productMetrics.filter(product => product.isCountOverdue)
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
  const abcGroups = ['A', 'B', 'C'].map(tier => ({
    tier,
    products: productMetrics.filter(product => product.abcTier === tier),
  }))
  const volatileProducts = productMetrics.filter(product => product.isVolatile)
  const deadStockProducts = [...productMetrics]
    .filter(product => product.isDeadStock)
    .sort((a, b) => b.stockValue - a.stockValue)
  const deadStockValue = deadStockProducts.reduce((sum, product) => sum + product.stockValue, 0)
  const overstockProducts = [...productMetrics]
    .filter(product => product.isOverstocked)
    .sort((a, b) => b.overstockValue - a.overstockValue)
  const overstockValue = overstockProducts.reduce((sum, product) => sum + product.overstockValue, 0)
  const restockReliabilityProducts = [...productMetrics]
    .filter(product => product.restockReliability.events.length > 0 || product.restockReliability.openLate)
  const supplierRiskProducts = [...restockReliabilityProducts]
    .filter(product => product.restockReliability.isSupplierRisk)
    .sort((a, b) => {
      const aLate = a.restockReliability.openLate?.daysWaiting || a.restockReliability.averageLateDays || 0
      const bLate = b.restockReliability.openLate?.daysWaiting || b.restockReliability.averageLateDays || 0
      return bLate - aLate
    })
  const reliabilityEvents = restockReliabilityProducts.flatMap(product =>
    product.restockReliability.events.map(event => ({ ...event, productName: product.name, unit: product.unit }))
  )
  const averageActualLeadTime = reliabilityEvents.length > 0
    ? reliabilityEvents.reduce((sum, event) => sum + event.actualDays, 0) / reliabilityEvents.length
    : null
  const restockOnTimeRate = reliabilityEvents.length > 0
    ? (reliabilityEvents.filter(event => !event.isLate).length / reliabilityEvents.length) * 100
    : null
  const reorderAutomationCandidates = productMetrics
    .filter(product => product.averageWeeklyUsage > 0 && Number(product.reorder) !== product.automatedReorderPoint)
    .map(product => ({
      id: product.id,
      name: product.name,
      reorder: product.automatedReorderPoint,
      previousReorder: Number(product.reorder) || 0,
    }))
  const orderNowProducts = [...planningProducts]
    .filter(product => product.suggestedRestock > 0)
    .sort((a, b) => {
      if (a.weeksRemaining === null) return 1
      if (b.weeksRemaining === null) return -1
      return a.weeksRemaining - b.weeksRemaining
    })
  const watchNextProducts = [...runningLow]
    .filter(product => product.suggestedRestock <= 0)
    .slice(0, 6)

  const cardStyle = {
    background: '#fff', border: '1px solid #eee',
    borderRadius: 10, padding: '1rem 1.25rem'
  }
  const sectionTitle = text => (
    <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12, color: '#333' }}>{text}</div>
  )
  const totalUsed = productMetrics.reduce((sum, product) => sum + product.totalUsed, 0)
  const usedComparison = range === 'all' ? null : comparePeriods(totalUsed, previousUsedTotal)
  const restockComparison = range === 'all' ? null : comparePeriods(datedRestocks.length, previousRestockTotal)
  const suggestedOrders = planningProducts.filter(product => product.suggestedRestock > 0).length
  const rangeLabel = RANGE_OPTIONS.find(option => option.value === range)?.label || 'Selected period'
  const comparisonNote = range === 'all'
    ? 'Period comparison is unavailable for All time. Switch to a 4 or 12-week range to compare against the previous period.'
    : `Compared against the previous ${rangeWeeks}-week period.`
  const reportLine = '-'.repeat(58)
  const analyticsReport = [
    'INVENTORY ANALYTICS REPORT',
    `Generated: ${now.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })}`,
    `Period: ${rangeLabel}`,
    reportLine,
    'SUMMARY',
    `  Products                  : ${stockProducts.length}`,
    `  Used in period            : ${totalUsed} units (${formatPercent(usedComparison)})`,
    `  Restock deliveries        : ${datedRestocks.length} (${formatPercent(restockComparison)})`,
    `  Need reorder              : ${needReorder.length}`,
    `  Out of stock              : ${outOfStock}`,
    `  Suggested product orders  : ${suggestedOrders}`,
    `  Auto reorder updates      : ${reorderAutomationCandidates.length} products have trend-based reorder changes available`,
    `  Supplier reliability      : ${supplierRiskProducts.length} risk flags${restockOnTimeRate === null ? '' : `, ${restockOnTimeRate.toFixed(0)}% on time`}`,
    `  Dead stock value          : ${formatMoney(deadStockValue)} tied up in ${deadStockProducts.length} products with zero usage in ${DEAD_STOCK_DAYS}+ days`,
    `  Overstock value           : ${formatMoney(overstockValue)} above reorder level in ${overstockProducts.length} low-usage products`,
    `  Comparison note           : ${comparisonNote}`,
    '',
    'STOCK HEALTH',
    `  OK                        : ${ok}`,
    `  Low stock                 : ${low}`,
    `  Critical                  : ${critical}`,
    '',
    'FAST-MOVING PRODUCTS',
    ...(fastestMoving.length > 0
      ? fastestMoving.map((product, index) =>
          `  ${index + 1}. ${product.name}: ${product.averageWeeklyUsage.toFixed(1)} ${product.unit} trend-weighted average${product.isVolatile ? ' * volatile usage' : ''}`)
      : ['  No usage recorded in this period.']),
    '',
    'LEAST-USED PRODUCTS',
    ...(leastUsed.length > 0
      ? leastUsed.map((product, index) =>
          `  ${index + 1}. ${product.name}: ${product.averageWeeklyUsage.toFixed(1)} ${product.unit} trend-weighted average${product.isVolatile ? ' * volatile usage' : ''}`)
      : ['  No usage recorded in this period.']),
    '',
    'ABC VALUE RANKING',
    ...(abcGroups.flatMap(group => [
      `  Tier ${group.tier}: ${group.products.length} products`,
      ...group.products.slice(0, 5).map(product =>
        `    - ${product.name}: PHP ${product.usageValue.toFixed(2)} usage value`)
    ])),
    '',
    'VOLATILITY CAUTIONS',
    ...(volatileProducts.length > 0
      ? volatileProducts.map(product => `  * ${product.name}: uneven usage pattern; review before large reorder`)
      : ['  No volatile usage patterns flagged.']),
    '',
    'DEAD STOCK VALUE',
    ...(deadStockProducts.length > 0
      ? [
          `  ${formatMoney(deadStockValue)} tied up in products with zero usage in ${DEAD_STOCK_DAYS}+ days.`,
          ...deadStockProducts.slice(0, 10).map(product =>
            `    - ${product.name}: ${formatMoney(product.stockValue)} (${product.qty} ${product.unit || 'units'} on hand${product.lastUsedDate ? `, last used ${product.lastUsedDate.toLocaleDateString('en-PH')}` : ', never used'})`)
        ]
      : [`  No dead stock value found. Every stocked, priced item has usage in the last ${DEAD_STOCK_DAYS} days or has no capital value recorded.`]),
    '',
    'OVERSTOCK FLAGS',
    ...(overstockProducts.length > 0
      ? [
          `  ${formatMoney(overstockValue)} sitting above reorder level in products stocked at ${OVERSTOCK_REORDER_MULTIPLE}x+ reorder with low usage.`,
          ...overstockProducts.slice(0, 10).map(product =>
            `    - ${product.name}: ${formatMoney(product.overstockValue)} excess (${product.overstockUnits} ${product.unit || 'units'} above reorder, ${product.averageWeeklyUsage.toFixed(1)} weekly trend)`)
        ]
      : [`  No overstock flags. No low-usage product is sitting at ${OVERSTOCK_REORDER_MULTIPLE}x+ its reorder level.`]),
    '',
    'RESTOCK EFFICIENCY / SUPPLIER RELIABILITY',
    ...(restockReliabilityProducts.length > 0
      ? [
          `  Average actual lead time: ${averageActualLeadTime === null ? 'No completed cycles' : `${averageActualLeadTime.toFixed(1)} days`}`,
          `  On-time rate            : ${restockOnTimeRate === null ? 'No completed cycles' : `${restockOnTimeRate.toFixed(0)}%`}`,
          ...(supplierRiskProducts.length > 0
            ? supplierRiskProducts.slice(0, 10).map(product => {
                const reliability = product.restockReliability
                const openText = reliability.openLate
                  ? `; currently waiting ${reliability.openLate.daysWaiting} days`
                  : ''
                return `    - ${product.name}: planned ${product.leadTimeDays} days, actual ${reliability.averageActualDays === null ? 'pending' : `${reliability.averageActualDays.toFixed(1)} days`}, avg late ${reliability.averageLateDays.toFixed(1)} days${openText}`
              })
            : ['    No supplier/product reliability risks flagged.'])
        ]
      : ['  No completed reorder-to-restock cycles yet.']),
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
            `    - ${product.name}: +${product.suggestedRestock} ${product.unit}, reorder point ${product.smartReorderPoint}` +
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

  function applyTrendReorderLevels() {
    if (!onApplyReorderLevels || reorderAutomationCandidates.length === 0) return
    const preview = reorderAutomationCandidates
      .slice(0, 6)
      .map(product => `${product.name}: ${product.previousReorder} -> ${product.reorder}`)
      .join('\n')
    const extra = reorderAutomationCandidates.length > 6
      ? `\n...and ${reorderAutomationCandidates.length - 6} more`
      : ''

    if (confirm(`Apply trend-based reorder levels to ${reorderAutomationCandidates.length} products?\n\n${preview}${extra}`)) {
      onApplyReorderLevels(reorderAutomationCandidates.map(({ id, reorder }) => ({ id, reorder })))
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Inventory analytics</div>
          <div style={{ color: '#888', fontSize: 12, marginTop: 2 }}>Usage averages are trend-weighted from recorded stock counts.</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select value={range} onChange={event => setRange(event.target.value)}
            style={{ padding: '7px 10px', border: '1px solid #ddd', borderRadius: 8, background: '#fff', fontSize: 13 }}>
            {RANGE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <button
            onClick={applyTrendReorderLevels}
            disabled={!onApplyReorderLevels || reorderAutomationCandidates.length === 0}
            style={{
              padding: '7px 12px',
              border: '1px solid #185FA5',
              borderRadius: 8,
              background: reorderAutomationCandidates.length > 0 ? '#185FA5' : '#EEF2F5',
              color: reorderAutomationCandidates.length > 0 ? '#fff' : '#8895A3',
              cursor: reorderAutomationCandidates.length > 0 ? 'pointer' : 'not-allowed',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            Apply smart reorder ({reorderAutomationCandidates.length})
          </button>
          <button onClick={copyAnalyticsReport} style={{
            padding: '7px 12px', border: '1px solid #ddd', borderRadius: 8,
            background: copied ? '#1D9E75' : '#fff', color: copied ? '#fff' : '#333',
            cursor: 'pointer', fontSize: 13, fontWeight: 600
          }}>
            {copied ? 'Copied!' : 'Copy analytics report'}
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
        {ANALYTICS_TABS.map(tab => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveAnalyticsTab(tab.id)}
            style={{
              flex: '0 0 auto',
              minHeight: 38,
              padding: '0 13px',
              border: activeAnalyticsTab === tab.id ? '1px solid #123247' : '1px solid #DCE3EA',
              borderRadius: 8,
              background: activeAnalyticsTab === tab.id ? '#123247' : '#fff',
              color: activeAnalyticsTab === tab.id ? '#fff' : '#384958',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeAnalyticsTab === 'overview' && (
        <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 10 }}>
        {[
          { label: 'Used in period', value: totalUsed, sub: 'units', color: '#5B21B6', change: usedComparison },
          { label: 'Restocks in period', value: datedRestocks.length, sub: 'recorded deliveries', color: '#0F6E56', change: restockComparison },
          { label: 'Need reorder', value: needReorder.length, sub: 'products', color: '#A32D2D' },
          { label: 'Out of stock', value: outOfStock, sub: 'products', color: '#791F1F' },
          { label: 'Suggested orders', value: suggestedOrders, sub: 'products to restock', color: '#185FA5' },
          { label: 'Dead stock value', value: formatMoney(deadStockValue), sub: `${deadStockProducts.length} idle products`, color: '#92400E' },
          { label: 'Overstock value', value: formatMoney(overstockValue), sub: `${overstockProducts.length} low-usage products`, color: '#A15C07' },
          { label: 'Supplier risk', value: supplierRiskProducts.length, sub: restockOnTimeRate === null ? 'no cycle data' : `${restockOnTimeRate.toFixed(0)}% on time`, color: '#A32D2D' },
          { label: 'Volatile items', value: volatileProducts.length, sub: 'usage caution', color: '#BA7517' },
        ].map(card => (
          <div key={card.label} style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', marginBottom: 4 }}>
              <div style={{ fontSize: 11, color: '#888' }}>{card.label}</div>
              {'change' in card && range !== 'all' && (
                <span style={{
                  ...compareStyle(card.change),
                  borderRadius: 20,
                  padding: '2px 7px',
                  fontSize: 10,
                  fontWeight: 700,
                  whiteSpace: 'nowrap',
                }}>
                  {formatPercent(card.change)}
                </span>
              )}
            </div>
            <div style={{ fontSize: typeof card.value === 'string' && card.value.length > 8 ? 20 : 23, fontWeight: 700, color: card.color }}>{card.value}</div>
            <div style={{ fontSize: 10, color: '#aaa', marginTop: 2 }}>{card.sub}</div>
          </div>
        ))}
      </div>
      {range === 'all' && (
        <div style={{ color: '#667789', fontSize: 12, marginTop: -4 }}>
          Period comparison is not shown for All time. Switch to Last 4 weeks or Last 12 weeks to compare with the previous period.
        </div>
      )}
        </>
      )}

      {activeAnalyticsTab === 'reorder' && (
        <>
      <div style={{
        ...cardStyle,
        display: 'grid',
        gap: 10,
        borderColor: reorderAutomationCandidates.length > 0 ? '#B8D7F0' : '#E5EAF0',
        background: reorderAutomationCandidates.length > 0 ? '#F3F9FE' : '#fff',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div>
            {sectionTitle('Automated reorder levels')}
            <div style={{ color: '#667789', fontSize: 12, marginTop: -6 }}>
              Uses trend-weighted usage, {DEFAULT_LEAD_TIME_DAYS}-day default lead time, and safety buffer. Products with no usage trend are skipped.
            </div>
          </div>
          <strong style={{ color: reorderAutomationCandidates.length > 0 ? '#185FA5' : '#667789', fontSize: 18 }}>
            {reorderAutomationCandidates.length} updates
          </strong>
        </div>
        {reorderAutomationCandidates.length > 0 ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 8 }}>
            {reorderAutomationCandidates.slice(0, 6).map(product => (
              <div key={product.id} style={{ border: '1px solid #D8E9F6', borderRadius: 8, padding: '8px 10px', background: '#fff', fontSize: 12 }}>
                <strong>{product.name}</strong>
                <div style={{ color: '#667789', marginTop: 3 }}>
                  Reorder {product.previousReorder} {'->'} <span style={{ color: '#185FA5', fontWeight: 700 }}>{product.reorder}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ color: '#0F6E56', fontSize: 13 }}>
            Current reorder levels already match the trend-based targets, or there is not enough usage history yet.
          </div>
        )}
      </div>
        </>
      )}

      {activeAnalyticsTab === 'supplier' && (
      <div style={{
        ...cardStyle,
        borderColor: supplierRiskProducts.length > 0 ? '#F2B8B8' : '#DDEFE7',
        background: supplierRiskProducts.length > 0 ? '#FFF7F7' : '#F5FBF8',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div>
            {sectionTitle('Restock efficiency / supplier reliability')}
            <div style={{ color: '#667789', fontSize: 12, marginTop: -6 }}>
              Compares planned lead time against the actual gap from hitting reorder level to the next logged restock.
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <strong style={{ display: 'block', color: supplierRiskProducts.length > 0 ? '#A32D2D' : '#0F6E56', fontSize: 18 }}>
              {supplierRiskProducts.length} risk flags
            </strong>
            <span style={{ color: '#667789', fontSize: 12 }}>
              {averageActualLeadTime === null ? 'No completed cycles' : `${averageActualLeadTime.toFixed(1)}d avg actual`}
            </span>
          </div>
        </div>
        {restockReliabilityProducts.length > 0 ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 8, marginTop: 10 }}>
            {(supplierRiskProducts.length > 0 ? supplierRiskProducts : restockReliabilityProducts).slice(0, 6).map(product => {
              const reliability = product.restockReliability
              return (
                <div key={product.id} style={{ border: '1px solid #F0D0D0', borderRadius: 8, padding: '8px 10px', background: '#fff', fontSize: 12 }}>
                  <strong>{product.name}</strong>
                  <div style={{ color: '#667789', marginTop: 3 }}>
                    Planned {product.leadTimeDays}d | Actual {reliability.averageActualDays === null ? 'pending' : `${reliability.averageActualDays.toFixed(1)}d`}
                  </div>
                  <div style={{ color: reliability.isSupplierRisk ? '#A32D2D' : '#0F6E56', marginTop: 3, fontWeight: 700 }}>
                    {reliability.openLate
                      ? `Currently waiting ${reliability.openLate.daysWaiting}d`
                      : reliability.onTimeRate === null
                      ? 'Waiting for next restock'
                      : `${reliability.onTimeRate.toFixed(0)}% on time`}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div style={{ color: '#667789', fontSize: 13, marginTop: 10 }}>
            No completed reorder-to-restock cycles yet. This will populate after stock crosses reorder level and a later restock is logged.
          </div>
        )}
      </div>
      )}

      {activeAnalyticsTab === 'movement' && (
        <>
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
          {sectionTitle('Movement impact')}
          <div style={{ display: 'grid', gap: 8, fontSize: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <span style={{ color: '#667789' }}>Used in period</span>
              <strong style={{ color: '#5B21B6' }}>{totalUsed} units</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <span style={{ color: '#667789' }}>Fast movers</span>
              <strong style={{ color: '#0F6E56' }}>{fastestMoving.length} products</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <span style={{ color: '#667789' }}>No usage</span>
              <strong style={{ color: '#92400E' }}>{slowMoving.length} products</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <span style={{ color: '#667789' }}>Lowest coverage</span>
              <strong style={{ color: runningLow[0]?.weeksRemaining < 2 ? '#A32D2D' : '#BA7517' }}>
                {runningLow[0] ? `${runningLow[0].weeksRemaining.toFixed(1)} weeks` : 'No estimate'}
              </strong>
            </div>
          </div>
        </div>
      </div>
        </>
      )}

      {activeAnalyticsTab === 'movement' && (
        <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 14 }}>
        <div style={cardStyle}>
          {sectionTitle('Products driving stock movement')}
          {fastestMoving.length > 0 ? fastestMoving.slice(0, 6).map(product => (
            <div key={product.id} style={{ display: 'grid', gap: 3, padding: '8px 0', borderBottom: '1px solid #f2f2f2', fontSize: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                <strong>{product.name}</strong>
                <strong style={{ color: '#0F6E56', whiteSpace: 'nowrap' }}>{product.averageWeeklyUsage.toFixed(1)} / wk</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, color: '#667789' }}>
                <span>Stock: {product.qty} {product.unit || 'units'}</span>
                <span>{product.weeksRemaining === null ? 'No coverage estimate' : `${product.weeksRemaining.toFixed(1)} weeks left`}</span>
              </div>
            </div>
          )) : <div style={{ color: '#aaa', fontSize: 13 }}>No usage recorded in this period.</div>}
        </div>

        <div style={cardStyle}>
          {sectionTitle('Slow movement affecting stock')}
          {(slowMoving.length > 0 ? slowMoving : leastUsed).slice(0, 6).map(product => (
            <div key={product.id} style={{ display: 'grid', gap: 3, padding: '8px 0', borderBottom: '1px solid #f2f2f2', fontSize: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                <strong>{product.name}</strong>
                <strong style={{ color: product.stockValue > 0 ? '#92400E' : '#BA7517', whiteSpace: 'nowrap' }}>
                  {formatMoney(product.stockValue || 0)}
                </strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, color: '#667789' }}>
                <span>{product.qty} {product.unit || 'units'} on hand</span>
                <span>{product.totalUsed === 0 ? 'No usage' : `${product.averageWeeklyUsage.toFixed(1)} / wk`}</span>
              </div>
            </div>
          ))}
          {slowMoving.length === 0 && leastUsed.length === 0 && (
            <div style={{ color: '#aaa', fontSize: 13 }}>No slow movement concerns in this period.</div>
          )}
        </div>

        <div style={cardStyle}>
          {sectionTitle('Lowest stock coverage')}
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
        </>
      )}

      {activeAnalyticsTab === 'risk' && (
        <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 14 }}>
        <div style={{ ...cardStyle, borderColor: deadStockValue > 0 ? '#F9C97C' : '#DDEFE7', background: deadStockValue > 0 ? '#FFF9F0' : '#F5FBF8' }}>
          {sectionTitle('Dead stock value')}
          <div style={{ fontSize: 24, fontWeight: 800, color: deadStockValue > 0 ? '#92400E' : '#0F6E56' }}>
            {formatMoney(deadStockValue)}
          </div>
          <div style={{ color: '#667789', fontSize: 12, marginTop: 4, marginBottom: 10 }}>
            tied up in products with zero usage in {DEAD_STOCK_DAYS}+ days
          </div>
          {deadStockProducts.length > 0 ? deadStockProducts.slice(0, 6).map(product => (
            <div key={product.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 10, padding: '7px 0', borderTop: '1px solid rgba(249, 201, 124, 0.55)', fontSize: 12 }}>
              <span>
                <strong>{product.name}</strong>
                <span style={{ display: 'block', color: '#667789', marginTop: 2 }}>
                  {product.qty} {product.unit || 'units'} on hand
                  {product.lastUsedDate ? ` | last used ${product.lastUsedDate.toLocaleDateString('en-PH')}` : ' | never used'}
                </span>
              </span>
              <strong style={{ color: '#92400E', whiteSpace: 'nowrap' }}>{formatMoney(product.stockValue)}</strong>
            </div>
          )) : (
            <div style={{ color: '#0F6E56', fontSize: 13 }}>No priced stock is idle past the 60-day threshold.</div>
          )}
        </div>

        <div style={{ ...cardStyle, borderColor: overstockValue > 0 ? '#F4C27B' : '#DDEFE7', background: overstockValue > 0 ? '#FFF8ED' : '#F5FBF8' }}>
          {sectionTitle('Overstock flags')}
          <div style={{ fontSize: 24, fontWeight: 800, color: overstockValue > 0 ? '#A15C07' : '#0F6E56' }}>
            {formatMoney(overstockValue)}
          </div>
          <div style={{ color: '#667789', fontSize: 12, marginTop: 4, marginBottom: 10 }}>
            above reorder level in products at {OVERSTOCK_REORDER_MULTIPLE}x+ reorder with low usage
          </div>
          {overstockProducts.length > 0 ? overstockProducts.slice(0, 6).map(product => (
            <div key={product.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 10, padding: '7px 0', borderTop: '1px solid rgba(244, 194, 123, 0.6)', fontSize: 12 }}>
              <span>
                <strong>{product.name}</strong>
                <span style={{ display: 'block', color: '#667789', marginTop: 2 }}>
                  {product.qty} {product.unit || 'units'} on hand | reorder {product.reorder} | trend {product.averageWeeklyUsage.toFixed(1)}
                </span>
              </span>
              <strong style={{ color: '#A15C07', whiteSpace: 'nowrap' }}>{formatMoney(product.overstockValue)}</strong>
            </div>
          )) : (
            <div style={{ color: '#0F6E56', fontSize: 13 }}>No low-usage product is sitting at 3x or more of its reorder level.</div>
          )}
        </div>

        <div style={cardStyle}>
          {sectionTitle('ABC value ranking')}
          <div style={{ display: 'grid', gap: 10 }}>
            {abcGroups.map(group => (
              <div key={group.tier} style={{ border: '1px solid #eee', borderRadius: 8, overflow: 'hidden' }}>
                <div style={{
                  display: 'flex', justifyContent: 'space-between', gap: 10,
                  padding: '8px 10px', background: '#F7FAFC', borderBottom: '1px solid #eee'
                }}>
                  <strong style={{ fontSize: 13 }}>Tier {group.tier}</strong>
                  <span style={{ fontSize: 11, color: '#667789' }}>{group.products.length} products</span>
                </div>
                {group.products.length > 0 ? group.products.slice(0, 5).map(product => (
                  <div key={product.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '7px 10px', borderTop: '1px solid #f5f5f5', fontSize: 12 }}>
                    <span>{product.name}{product.isVolatile ? ' *' : ''}</span>
                    <strong style={{ color: '#185FA5', whiteSpace: 'nowrap' }}>PHP {product.usageValue.toFixed(2)}</strong>
                  </div>
                )) : (
                  <div style={{ padding: '8px 10px', color: '#aaa', fontSize: 12 }}>No usage value in this tier.</div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div style={cardStyle}>
          {sectionTitle('Volatility and outlier cautions')}
          {volatileProducts.length > 0 ? volatileProducts.slice(0, 8).map(product => (
            <div key={product.id} style={{ padding: '8px 0', borderBottom: '1px solid #f2f2f2', fontSize: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                <strong>{product.name} *</strong>
                <span style={{ color: '#BA7517', fontWeight: 700 }}>CV {product.volatilityCoefficient.toFixed(2)}</span>
              </div>
              <div style={{ color: '#667789', marginTop: 3 }}>
                Usage has a wide swing. Review counts before making a large order.
              </div>
            </div>
          )) : <div style={{ color: '#0F6E56', fontSize: 13 }}>No volatile usage patterns flagged in this period.</div>}
        </div>
      </div>
        </>
      )}

      {activeAnalyticsTab === 'movement' && (
      <div style={cardStyle}>
        {sectionTitle('Category movement impact')}
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
                  <div style={{ padding: '8px 10px', fontSize: 12 }}>
                    <div style={{ color: '#667789', marginBottom: 5 }}>Top stock driver</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <strong>{group.fastMovingRanked[0].name}</strong>
                      <strong style={{ color: '#0F6E56', whiteSpace: 'nowrap' }}>{group.fastMovingRanked[0].averageWeeklyUsage.toFixed(1)} / wk</strong>
                    </div>
                    <details className="category-movement-dropdown">
                      <summary>Ranked products</summary>
                      <div className="category-movement-rank-list">
                        {group.fastMovingRanked.slice(0, 5).map((product, index) => (
                          <div key={product.id} className="category-movement-rank-row">
                            <span>
                              <b>{index + 1}</b>
                              {product.name}
                            </span>
                            <strong>{product.averageWeeklyUsage.toFixed(1)} / wk</strong>
                          </div>
                        ))}
                      </div>
                    </details>
                  </div>
                ) : (
                  <div style={{ padding: '10px', color: '#aaa', fontSize: 12 }}>No product usage recorded in this category.</div>
                )}
              </div>
            ))}
          </div>
        ) : <div style={{ color: '#aaa', fontSize: 13 }}>No categories found.</div>}
      </div>
      )}

      {activeAnalyticsTab === 'reorder' && (
      <div style={cardStyle}>
        {sectionTitle('Order now')}
        {orderNowProducts.length > 0 ? (
          <div style={{ display: 'grid', gap: 8 }}>
            {orderNowProducts.slice(0, 10).map(product => {
              const status = getStatus(product)
              return (
                <div key={product.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 10, padding: '10px 0', borderBottom: '1px solid #f2f2f2', fontSize: 12 }}>
                  <span>
                    <strong style={{ display: 'block', color: '#333' }}>{product.name}</strong>
                    <span style={{ display: 'block', color: '#667789', marginTop: 3 }}>
                      Stock {product.qty} {product.unit || 'units'} | reorder {product.smartReorderPoint} | {product.weeksRemaining === null ? 'no coverage estimate' : `${product.weeksRemaining.toFixed(1)} weeks left`}
                    </span>
                    <span style={{ display: 'block', color: status === 'critical' ? '#A32D2D' : status === 'low' ? '#BA7517' : '#667789', marginTop: 3, textTransform: 'capitalize' }}>
                      {status}{product.isVolatile ? ' | volatile usage *' : ''}
                    </span>
                  </span>
                  <strong style={{ color: '#185FA5', whiteSpace: 'nowrap' }}>+{product.suggestedRestock} {product.unit || 'units'}</strong>
                </div>
              )
            })}
          </div>
        ) : <div style={{ color: '#0F6E56', fontSize: 13 }}>No products need ordering right now based on current trend and reorder points.</div>}
      </div>
      )}

      {activeAnalyticsTab === 'risk' && (
        <>
      {(staleProducts.length > 0 || slowMoving.length > 0) && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 14 }}>
          {staleProducts.length > 0 && (
            <div style={{ ...cardStyle, borderColor: '#F9C97C', background: '#FFF9F0' }}>
              {sectionTitle(`Count overdue (${staleProducts.length})`)}
              <div style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>Thresholds adjust by velocity: fast items 7 days, medium items 14 days, slow items 30 days.</div>
              {staleProducts.slice(0, 8).map(product => (
                <div key={product.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: 12 }}>
                  <span>{product.name}</span>
                  <span style={{ color: '#BA7517' }}>{product.lastCount ? `${product.lastCount.toLocaleDateString('en-PH')} (${product.countStaleAfterDays}d)` : `Never counted (${product.countStaleAfterDays}d)`}</span>
                </div>
              ))}
            </div>
          )}

          {slowMoving.length > 0 && (
            <div style={cardStyle}>
              {sectionTitle(`No usage in selected period (${slowMoving.length})`)}
              <div style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>Review these products for excess stock, missing count data, or capital sitting idle.</div>
              {slowMoving.slice(0, 8).map(product => (
                <div key={product.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: 12 }}>
                  <span>{product.name}</span>
                  <span style={{ color: product.stockValue > 0 ? '#92400E' : '#888' }}>
                    {product.qty} {product.unit || 'units'} | {formatMoney(product.stockValue)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
        </>
      )}

      {activeAnalyticsTab === 'reorder' && (
        <div style={cardStyle}>
          {sectionTitle('Watch next')}
          {watchNextProducts.length > 0 ? watchNextProducts.map(product => (
            <div key={product.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '8px 0', borderBottom: '1px solid #f2f2f2', fontSize: 12 }}>
              <span>
                <strong style={{ display: 'block' }}>{product.name}</strong>
                <span style={{ color: '#667789' }}>Stock {product.qty} {product.unit || 'units'} | trend {product.averageWeeklyUsage.toFixed(1)} / wk</span>
              </span>
              <strong style={{ color: product.weeksRemaining < 3 ? '#BA7517' : '#667789', whiteSpace: 'nowrap' }}>
                {product.weeksRemaining.toFixed(1)} weeks
              </strong>
            </div>
          )) : (
            <div style={{ color: '#667789', fontSize: 13 }}>No near-term watch items. The current order list covers the important reorder decisions.</div>
          )}
        </div>
      )}
    </div>
  )
}
