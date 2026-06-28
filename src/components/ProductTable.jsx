import { useMemo, useState } from 'react'
import { getStatus } from '../utils/status'
import { getUsageInLastDays } from '../utils/usage'

const statusLabel = { ok: 'OK', low: 'Low stock', critical: 'Critical' }
const money = value => `PHP ${Number(value || 0).toFixed(2)}`
const withUnit = (value, unit) => unit ? `${value} ${unit}` : String(value)

export default function ProductTable({ products, onEdit, onDelete, onRestock, onUndo }) {
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

              return (
                <tr key={product.id} className={`inventory-row status-${status}`}>
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
                      {Number(product.price) > 0 ? money(product.price) : 'No price'}
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
                    <span className={`inventory-status-pill ${status}`}>{statusLabel[status]}</span>
                  </td>
                  <td data-label="Actions">
                    <div className="inventory-actions">
                      {tracksStock && (
                        <button
                          type="button"
                          onClick={() => onRestock(product)}
                          className={needsRestock ? 'restock urgent' : 'restock'}
                        >
                          Restock
                        </button>
                      )}
                      <button type="button" onClick={() => onEdit(product)}>Edit</button>
                      {canUndo && (
                        <button type="button" onClick={() => onUndo(product)} className="undo">Undo</button>
                      )}
                      <button type="button" onClick={() => onDelete(product)} className="delete">Delete</button>
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
