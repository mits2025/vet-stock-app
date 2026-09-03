import { useMemo, useState } from 'react'
import { getStatus } from '../utils/status'
import { getUsageInLastDays } from '../utils/usage'

const statusLabel = { ok: 'OK', low: 'Low stock', critical: 'Critical' }
const money = value => `PHP ${Number(value || 0).toFixed(2)}`
const withUnit = (value, unit) => unit ? `${value} ${unit}` : String(value)
const DAY_MS = 24 * 60 * 60 * 1000
const EXPIRATION_RISK_DAYS = 70
const OVERSTOCK_REORDER_MULTIPLE = 3

function daysUntilExpiration(product) {
  if (!product.expirationDate || Number(product.qty) <= 0) return null
  const expiration = new Date(`${product.expirationDate}T23:59:59`)
  if (Number.isNaN(expiration.getTime())) return null
  return Math.ceil((expiration - new Date()) / DAY_MS)
}

function isOverstocked(product) {
  const reorder = Number(product.reorder) || 0
  return product.trackStock !== false
    && reorder > 0
    && Number(product.qty) >= reorder * OVERSTOCK_REORDER_MULTIPLE
}

export default function ProductTable({ products, onEdit, onDelete, onRestock, onUndo, readOnly = false }) {
  const [search, setSearch] = useState('')
  const [filterCat, setFilterCat] = useState('')
  const [filterStatus, setFilterStatus] = useState('')

  const categories = useMemo(
    () => [...new Set(products.map(product => product.cat).filter(Boolean))].sort(),
    [products]
  )

  const summary = useMemo(() => {
    const stockProducts = products.filter(product => product.trackStock !== false)
    return {
      total: products.length,
      services: products.length - stockProducts.length,
      critical: stockProducts.filter(product => getStatus(product) === 'critical').length,
      low: stockProducts.filter(product => getStatus(product) === 'low').length,
    }
  }, [products])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return products
      .filter(product => {
        const status = getStatus(product)
        const matchesSearch = !term
          || product.name.toLowerCase().includes(term)
          || product.cat.toLowerCase().includes(term)
        return matchesSearch
          && (!filterCat || product.cat === filterCat)
          && (!filterStatus || status === filterStatus)
      })
      .sort((a, b) => {
        const aExpiryDays = daysUntilExpiration(a)
        const bExpiryDays = daysUntilExpiration(b)
        const aExpiryRisk = aExpiryDays !== null && aExpiryDays <= EXPIRATION_RISK_DAYS
        const bExpiryRisk = bExpiryDays !== null && bExpiryDays <= EXPIRATION_RISK_DAYS
        const aRiskWeight = aExpiryRisk ? 0 : isOverstocked(a) ? 1 : 2
        const bRiskWeight = bExpiryRisk ? 0 : isOverstocked(b) ? 1 : 2
        if (aRiskWeight !== bRiskWeight) return aRiskWeight - bRiskWeight
        if (aExpiryRisk && bExpiryRisk && aExpiryDays !== bExpiryDays) return aExpiryDays - bExpiryDays

        const statusWeight = { critical: 0, low: 1, ok: 2 }
        const statusDiff = statusWeight[getStatus(a)] - statusWeight[getStatus(b)]
        if (statusDiff !== 0) return statusDiff
        return a.name.localeCompare(b.name)
      })
  }, [products, search, filterCat, filterStatus])

  if (products.length === 0) {
    return (
      <section className="inventory-empty-state">
        <strong>No products yet</strong>
        <span>Add your first product or service to start managing inventory.</span>
      </section>
    )
  }

  return (
    <section className="inventory-page">
      <div className="inventory-summary-grid">
        <div className="inventory-summary-card">
          <span>Total items</span>
          <strong>{summary.total}</strong>
          <small>{summary.services} services included</small>
        </div>
        <div className="inventory-summary-card danger">
          <span>Critical</span>
          <strong>{summary.critical}</strong>
          <small>Need attention first</small>
        </div>
        <div className="inventory-summary-card warning">
          <span>Low stock</span>
          <strong>{summary.low}</strong>
          <small>Watch or restock soon</small>
        </div>
      </div>

      <div className="inventory-toolbar">
        <label className="inventory-search">
          <span>Search inventory</span>
          <input
            placeholder="Search product or category"
            value={search}
            onChange={event => setSearch(event.target.value)}
          />
        </label>
        <label>
          <span>Category</span>
          <select value={filterCat} onChange={event => setFilterCat(event.target.value)}>
            <option value="">All categories</option>
            {categories.map(category => <option key={category}>{category}</option>)}
          </select>
        </label>
        <label>
          <span>Status</span>
          <select value={filterStatus} onChange={event => setFilterStatus(event.target.value)}>
            <option value="">All status</option>
            <option value="critical">Critical</option>
            <option value="low">Low stock</option>
            <option value="ok">OK</option>
          </select>
        </label>
      </div>

      <div className="inventory-table-shell">
        <table className="inventory-table">
          <thead>
            <tr>
              <th>Product</th>
              <th>Stock</th>
              <th>Price</th>
              <th>Reorder</th>
              <th>7-day use</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7}>
                  <div className="inventory-empty-row">No products match your filters.</div>
                </td>
              </tr>
            ) : filtered.map(product => {
              const status = getStatus(product)
              const tracksStock = product.trackStock !== false
              const usedThisWeek = getUsageInLastDays(product)
              const needsRestock = tracksStock && (status === 'low' || status === 'critical')
              const canUndo = (product.countHistory && product.countHistory.length > 0)
                || (product.restockHistory && product.restockHistory.length > 0)
              const expirationDays = daysUntilExpiration(product)
              const expirationRisk = expirationDays !== null && expirationDays <= EXPIRATION_RISK_DAYS
              const overstocked = !expirationRisk && isOverstocked(product)
              const riskClass = expirationRisk ? ' risk-expiration' : overstocked ? ' risk-overstock' : ''

              return (
                <tr key={product.id} className={`inventory-row status-${status}${riskClass}`}>
                  <td data-label="Product">
                    <div className="inventory-product-cell">
                      <strong>{product.name}</strong>
                      <span>{product.cat || 'Uncategorized'}</span>
                    </div>
                  </td>
                  <td data-label="Stock">
                    <strong className="inventory-stock-count">
                      {tracksStock ? withUnit(product.qty, product.unit) : 'Service'}
                    </strong>
                  </td>
                  <td data-label="Price">
                    <strong className={Number(product.price) > 0 ? '' : 'muted-value'}>
                      {Number(product.price) > 0
                        ? `${money(product.price)}${product.priceByWeight ? ` / ${product.weightUnit || 'kg'}` : ''}`
                        : 'No price'}
                    </strong>
                  </td>
                  <td data-label="Reorder">
                    {tracksStock ? withUnit(product.reorder || 0, product.unit) : 'Not tracked'}
                  </td>
                  <td data-label="7-day use">
                    <strong className={usedThisWeek > 0 ? 'usage-active' : 'muted-value'}>
                      {usedThisWeek > 0 ? withUnit(usedThisWeek, product.unit) : 'None'}
                    </strong>
                  </td>
                  <td data-label="Status">
                    <div className="inventory-risk-pills">
                      {expirationRisk && (
                        <span className="inventory-risk-pill expiration">
                          {expirationDays < 0 ? `Expired ${Math.abs(expirationDays)}d` : expirationDays === 0 ? 'Expires today' : `Expires in ${expirationDays}d`}
                        </span>
                      )}
                      {overstocked && <span className="inventory-risk-pill overstock">Overstock</span>}
                      <span className={`inventory-status-pill ${status}`}>{statusLabel[status]}</span>
                    </div>
                  </td>
                  <td data-label="Actions">
                    <div className="inventory-actions">
                      {tracksStock && (
                        <button
                          type="button"
                          onClick={() => onRestock(product)}
                          className={needsRestock ? 'restock urgent' : 'restock'}
                          disabled={readOnly}
                        >
                          Restock
                        </button>
                      )}
                      <button type="button" onClick={() => onEdit(product)} disabled={readOnly}>Edit</button>
                      {canUndo && (
                        <button type="button" onClick={() => onUndo(product)} className="undo" disabled={readOnly}>Undo</button>
                      )}
                      <button type="button" onClick={() => onDelete(product)} className="delete" disabled={readOnly}>Delete</button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
