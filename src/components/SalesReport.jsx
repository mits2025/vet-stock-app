import { useMemo, useState } from 'react'

const money = value => `PHP ${Number(value || 0).toFixed(2)}`
const signedMoney = value => {
  const amount = Number(value) || 0
  return `${amount > 0 ? '+' : ''}${money(amount)}`
}

const E_CASH_METHODS = ['GCash', 'Card', 'Bank transfer', 'E-cash']
const VOID_REASONS = ['Refund', 'Wrong payment', 'Wrong item', 'Duplicate sale', 'Customer cancelled']
const OWNER_PERIODS = [
  { id: 'month', label: 'This month' },
  { id: 'year', label: 'This year' },
  { id: 'all', label: 'All time' },
]

function dateKey(dateValue) {
  const date = new Date(dateValue)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('en-CA')
}

function isToday(dateValue) {
  return dateKey(dateValue) === dateKey(new Date())
}

function isInOwnerPeriod(dateValue, period) {
  if (period === 'all') return true

  const date = new Date(dateValue)
  if (Number.isNaN(date.getTime())) return false

  const now = new Date()
  if (period === 'year') return date.getFullYear() === now.getFullYear()
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()
}

function getPaymentGroup(method) {
  return E_CASH_METHODS.includes(method) ? 'E-cash' : 'Cash'
}

function getSalePayments(sale) {
  if (Array.isArray(sale.payments) && sale.payments.length > 0) {
    return sale.payments
      .map(payment => ({
        method: payment.method || 'Cash',
        amount: Math.max(0, Number(payment.amount) || 0),
      }))
      .filter(payment => payment.amount > 0)
  }

  const amount = Math.max(0, Number(sale.total) || 0)
  return amount > 0 ? [{ method: sale.paymentMethod || 'Cash', amount }] : []
}

function summarizeSalePayments(sale) {
  const parts = getSalePayments(sale).map(payment => `${payment.method} ${money(payment.amount)}`)
  const pendingBalance = Math.max(0, Number(sale.pendingBalance) || 0)
  if (pendingBalance > 0) parts.push(`Pending ${money(pendingBalance)}`)
  return parts.length ? parts.join(' + ') : 'No payment recorded'
}

function buildSalesByMethod(periodSales) {
  return periodSales.reduce((totals, sale) => {
    getSalePayments(sale).forEach(payment => {
      totals[payment.method] = (totals[payment.method] || 0) + payment.amount
    })
    return totals
  }, {})
}

function getPaidByGroup(periodSales, group) {
  return periodSales.reduce((sum, sale) => {
    return sum + getSalePayments(sale)
      .filter(payment => getPaymentGroup(payment.method) === group)
      .reduce((paymentSum, payment) => paymentSum + payment.amount, 0)
  }, 0)
}

function formatDate(dateValue) {
  if (!dateValue) return 'No date'
  const date = new Date(dateValue)
  if (Number.isNaN(date.getTime())) return dateValue
  return date.toLocaleString('en-PH', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function varianceClass(value) {
  if (value < 0) return 'negative'
  if (value > 0) return 'positive'
  return 'neutral'
}

export default function SalesReport({
  sales = [],
  expenses = [],
  openingCashRecord,
  ownerUnlocked = false,
  ownerAccessPanel = null,
  onAddExpense,
  onDeleteExpense,
  onVoidSale,
  onSetOpeningCash,
  onSetClosingCash,
}) {
  const openingCash = Number(openingCashRecord?.openingCash) || 0
  const hasClosingCash = openingCashRecord && Object.hasOwn(openingCashRecord, 'closingCash')
  const closingCash = hasClosingCash ? Number(openingCashRecord.closingCash) || 0 : null
  const [expenseDraft, setExpenseDraft] = useState({
    amount: '',
    category: '',
    note: '',
    paymentMethod: 'Cash',
    date: new Date().toISOString().slice(0, 10),
  })
  const [voidDraft, setVoidDraft] = useState({
    sale: null,
    reason: 'Refund',
    note: '',
  })
  const [ownerPeriod, setOwnerPeriod] = useState('month')
  const [openingCashDraft, setOpeningCashDraft] = useState(String(openingCash || ''))
  const [closingCashDraft, setClosingCashDraft] = useState(hasClosingCash ? String(closingCash) : '')
  const [warning, setWarning] = useState('')

  const report = useMemo(() => {
    const todaySales = sales.filter(sale => isToday(sale.date))
    const periodSales = todaySales.filter(sale => !sale.voided)
    const voidedSales = todaySales.filter(sale => sale.voided)
    const periodExpenses = expenses.filter(expense => isToday(expense.date || expense.createdAt))

    const salesByMethod = buildSalesByMethod(periodSales)

    const expensesByMethod = periodExpenses.reduce((totals, expense) => {
      const group = getPaymentGroup(expense.paymentMethod)
      totals[group] = (totals[group] || 0) + (Number(expense.amount) || 0)
      return totals
    }, {})

    const grossSales = periodSales.reduce((sum, sale) => sum + (Number(sale.total) || 0), 0)
    const costOfGoods = periodSales.reduce((sum, sale) => sum + (sale.items || []).reduce((itemSum, item) => (
      itemSum + (Number(item.qty) || 0) * (Number(item.costPrice) || 0)
    ), 0), 0)
    const totalExpenses = periodExpenses.reduce((sum, expense) => sum + (Number(expense.amount) || 0), 0)
    const cashSales = getPaidByGroup(periodSales, 'Cash')
    const eCashSales = getPaidByGroup(periodSales, 'E-cash')
    const paidSales = cashSales + eCashSales
    const pendingBalance = periodSales.reduce((sum, sale) => sum + (Number(sale.pendingBalance) || 0), 0)

    return {
      sales: periodSales,
      voidedSales,
      expenses: periodExpenses,
      salesByMethod,
      grossSales,
      costOfGoods,
      grossProfit: grossSales - costOfGoods,
      totalExpenses,
      cashSales,
      eCashSales,
      paidSales,
      pendingBalance,
      cashExpenses: expensesByMethod.Cash || 0,
      eCashExpenses: expensesByMethod['E-cash'] || 0,
      netTotal: paidSales - totalExpenses,
      netCash: cashSales - (expensesByMethod.Cash || 0),
      expectedCash: openingCash + cashSales - (expensesByMethod.Cash || 0),
      cashVariance: hasClosingCash ? closingCash - (openingCash + cashSales - (expensesByMethod.Cash || 0)) : null,
      netECash: eCashSales - (expensesByMethod['E-cash'] || 0),
    }
  }, [sales, expenses, openingCash, closingCash, hasClosingCash])

  const ownerReport = useMemo(() => {
    const periodSales = sales.filter(sale => !sale.voided && isInOwnerPeriod(sale.date, ownerPeriod))
    const voidedSales = sales.filter(sale => sale.voided && isInOwnerPeriod(sale.date, ownerPeriod))
    const periodExpenses = expenses.filter(expense => isInOwnerPeriod(expense.date || expense.createdAt, ownerPeriod))

    const salesByMethod = buildSalesByMethod(periodSales)

    const expensesByCategory = periodExpenses.reduce((totals, expense) => {
      const category = expense.category || 'General'
      totals[category] = (totals[category] || 0) + (Number(expense.amount) || 0)
      return totals
    }, {})

    const itemSales = periodSales.reduce((totals, sale) => {
      const saleItems = sale.items || []
      saleItems.forEach(item => {
        const name = item.name || item.productName || 'Item'
        const current = totals[name] || { name, qty: 0, total: 0 }
        current.qty += Number(item.qty) || 0
        current.total += Number(item.lineSubtotal) || (Number(item.qty) || 0) * (Number(item.price) || 0)
        totals[name] = current
      })
      return totals
    }, {})

    const grossSales = periodSales.reduce((sum, sale) => sum + (Number(sale.total) || 0), 0)
    const costOfGoods = periodSales.reduce((sum, sale) => sum + (sale.items || []).reduce((itemSum, item) => (
      itemSum + (Number(item.qty) || 0) * (Number(item.costPrice) || 0)
    ), 0), 0)
    const totalExpenses = periodExpenses.reduce((sum, expense) => sum + (Number(expense.amount) || 0), 0)
    const pendingBalance = periodSales.reduce((sum, sale) => sum + (Number(sale.pendingBalance) || 0), 0)
    const paidSales = getPaidByGroup(periodSales, 'Cash') + getPaidByGroup(periodSales, 'E-cash')
    const averageSale = periodSales.length ? grossSales / periodSales.length : 0

    return {
      sales: periodSales,
      voidedSales,
      expenses: periodExpenses,
      salesByMethod,
      expensesByCategory,
      topItems: Object.values(itemSales)
        .sort((a, b) => b.total - a.total)
        .slice(0, 6),
      grossSales,
      costOfGoods,
      grossProfit: grossSales - costOfGoods,
      netProfit: grossSales - costOfGoods - totalExpenses,
      totalExpenses,
      paidSales,
      pendingBalance,
      netRevenue: paidSales - totalExpenses,
      averageSale,
    }
  }, [sales, expenses, ownerPeriod])

  function submitExpense(event) {
    event.preventDefault()
    const amount = Number(expenseDraft.amount)
    if (!amount || amount <= 0) {
      setWarning('Enter a valid expense amount before adding it.')
      return
    }

    onAddExpense(expenseDraft)
    setExpenseDraft({
      amount: '',
      category: '',
      note: '',
      paymentMethod: 'Cash',
      date: new Date().toISOString().slice(0, 10),
    })
  }

  function submitOpeningCash(event) {
    event.preventDefault()
    const amount = Number(openingCashDraft)
    if (!Number.isFinite(amount) || amount < 0) {
      setWarning('Enter a valid opening cash amount. Use 0 if the box is empty.')
      return
    }
    if (onSetOpeningCash) onSetOpeningCash(amount)
    setOpeningCashDraft(String(amount))
  }

  function submitClosingCash(event) {
    event.preventDefault()
    const amount = Number(closingCashDraft)
    if (!Number.isFinite(amount) || amount < 0) {
      setWarning('Enter a valid counted cash amount before closing the shift.')
      return
    }
    if (onSetClosingCash) onSetClosingCash(amount)
    setClosingCashDraft(String(amount))
  }

  function openVoidModal(sale) {
    setVoidDraft({
      sale,
      reason: 'Refund',
      note: '',
    })
  }

  function closeVoidModal() {
    setVoidDraft({
      sale: null,
      reason: 'Refund',
      note: '',
    })
  }

  function confirmVoidSale(event) {
    event.preventDefault()
    if (!voidDraft.sale || !onVoidSale) return
    onVoidSale(voidDraft.sale.id, {
      reason: voidDraft.reason,
      note: voidDraft.note,
    })
    closeVoidModal()
  }

  return (
    <div className="sales-report-page">
      <section className="sales-report-header">
        <div>
          <span className="eyebrow">Money movement</span>
          <h3>Daily Sales Report</h3>
          <p>Today only. This report starts clean automatically when a new day begins.</p>
        </div>
        <div className="daily-report-date">
          {new Date().toLocaleDateString('en-PH', {
            weekday: 'long',
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })}
        </div>
      </section>

      {warning && (
        <div className="modal-friendly-alert page-friendly-alert" role="alert">
          <i className="fi fi-rr-triangle-warning" aria-hidden="true"></i>
          <span>{warning}</span>
          <button type="button" onClick={() => setWarning('')} aria-label="Dismiss warning">×</button>
        </div>
      )}

      <section className="opening-cash-panel">
        <div>
          <span className="eyebrow">Before shift starts</span>
          <h4>Opening cash</h4>
          <p>Enter the money already inside the cash box before accepting payments today.</p>
        </div>
        <form onSubmit={submitOpeningCash} className="opening-cash-form">
          <label>
            Starting cash
            <input
              type="number"
              min="0"
              step="0.01"
              value={openingCashDraft}
              onChange={event => setOpeningCashDraft(event.target.value)}
              placeholder="0.00"
            />
          </label>
          <button type="submit">{openingCashRecord ? 'Update' : 'Set'}</button>
        </form>
        <div className="opening-cash-total">
          <span>Expected cash box</span>
          <strong>{money(report.expectedCash)}</strong>
          <small>{money(openingCash)} opening + {money(report.cashSales)} cash sales - {money(report.cashExpenses)} cash expenses</small>
        </div>
      </section>

      <section className={hasClosingCash ? 'shift-close-panel closed' : 'shift-close-panel'}>
        <div>
          <span className="eyebrow">End of shift</span>
          <h4>Close cash box</h4>
          <p>Count the actual cash in the box, then compare it against the expected cash total.</p>
        </div>
        <form onSubmit={submitClosingCash} className="opening-cash-form">
          <label>
            Counted cash
            <input
              type="number"
              min="0"
              step="0.01"
              value={closingCashDraft}
              onChange={event => setClosingCashDraft(event.target.value)}
              placeholder="0.00"
            />
          </label>
          <button type="submit">{hasClosingCash ? 'Update' : 'Close'}</button>
        </form>
        <div className="shift-close-total">
          <span>{hasClosingCash ? 'Cash variance' : 'Ready to close'}</span>
          <strong className={hasClosingCash ? varianceClass(report.cashVariance) : 'neutral'}>
            {hasClosingCash ? signedMoney(report.cashVariance) : money(report.expectedCash)}
          </strong>
          <small>
            {hasClosingCash
              ? `${money(closingCash)} counted - ${money(report.expectedCash)} expected`
              : `${money(report.expectedCash)} expected in the cash box`}
          </small>
        </div>
      </section>

      <section className="money-summary-grid">
        <div className="money-card primary">
          <span>Gross sales</span>
          <strong>{money(report.grossSales)}</strong>
          <small>{report.pendingBalance > 0 ? `${money(report.pendingBalance)} pending` : `${report.sales.length} completed sales`}</small>
        </div>
        <div className="money-card cash">
          <span>Expected cash box</span>
          <strong>{money(report.expectedCash)}</strong>
          <small>{money(openingCash)} opening + {money(report.netCash)} cash movement</small>
        </div>
        <div className="money-card ecash">
          <span>E-cash balance</span>
          <strong>{money(report.netECash)}</strong>
          <small>{money(report.eCashSales)} sales - {money(report.eCashExpenses)} expenses</small>
        </div>
        <div className={hasClosingCash ? `money-card variance ${varianceClass(report.cashVariance)}` : report.netTotal < 0 ? 'money-card net negative' : 'money-card net'}>
          <span>{hasClosingCash ? 'Cash variance' : 'Net after expenses'}</span>
          <strong>{hasClosingCash ? signedMoney(report.cashVariance) : money(report.netTotal)}</strong>
          <small>{hasClosingCash ? `${money(closingCash)} counted cash` : `${money(report.paidSales)} collected - ${money(report.totalExpenses)} expenses`}</small>
        </div>
      </section>

      <div className="sales-report-layout">
        <section className="sales-report-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Payment breakdown</span>
              <h4>Sales by mode</h4>
            </div>
          </div>

          <div className="payment-breakdown-list">
            {['Cash', 'GCash', 'Card', 'Bank transfer'].map(method => (
              <div key={method}>
                <span>{method}</span>
                <strong>{money(report.salesByMethod[method] || 0)}</strong>
              </div>
            ))}
          </div>

          <div className="recent-report-list">
            <div className="panel-heading compact">
              <div>
                <span className="eyebrow">Recent sales</span>
                <h4>Completed orders</h4>
              </div>
            </div>
            {report.sales.length === 0 ? (
              <div className="report-empty">No sales today.</div>
            ) : report.sales.slice(0, 8).map(sale => (
              <div key={sale.id} className="report-row">
                <div>
                  <strong>{sale.clientName || 'Walk-in client'}</strong>
                  <span>{formatDate(sale.date)} | {summarizeSalePayments(sale)} | {sale.items?.length || 0} items</span>
                </div>
                <b>{money(sale.total)}</b>
                <button type="button" className="void-sale-button" onClick={() => openVoidModal(sale)}>
                  Void
                </button>
              </div>
            ))}
          </div>

          {report.voidedSales.length > 0 && (
            <div className="recent-report-list">
              <div className="panel-heading compact">
                <div>
                  <span className="eyebrow">Voided payments</span>
                  <h4>Refunds and corrections</h4>
                </div>
              </div>
              {report.voidedSales.slice(0, 8).map(sale => (
                <div key={sale.id} className="report-row voided">
                  <div>
                    <strong>{sale.clientName || 'Walk-in client'}</strong>
                    <span>{formatDate(sale.voidedAt)} | {sale.voidReason || 'Voided'}{sale.voidNote ? ` | ${sale.voidNote}` : ''}</span>
                  </div>
                  <b>-{money(sale.total)}</b>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="sales-report-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Expenses</span>
              <h4>Add clinic expense</h4>
            </div>
          </div>

          <form className="expense-form" onSubmit={submitExpense}>
            <label>
              Amount
              <input
                type="number"
                min="0"
                step="0.01"
                value={expenseDraft.amount}
              onChange={event => setExpenseDraft(prev => ({ ...prev, amount: event.target.value }))}
                placeholder="0.00"
              />
            </label>
            <label>
              Paid from
              <select
                value={expenseDraft.paymentMethod}
              onChange={event => setExpenseDraft(prev => ({ ...prev, paymentMethod: event.target.value }))}
              >
                <option>Cash</option>
                <option>E-cash</option>
              </select>
            </label>
            <label>
              Date
              <input
                type="date"
                value={expenseDraft.date}
                onChange={event => setExpenseDraft(prev => ({ ...prev, date: event.target.value }))}
              />
            </label>
            <label>
              Category
              <input
                value={expenseDraft.category}
                onChange={event => setExpenseDraft(prev => ({ ...prev, category: event.target.value }))}
                placeholder="Supplies, utilities, rent"
              />
            </label>
            <label className="expense-note-field">
              Note
              <input
                value={expenseDraft.note}
                onChange={event => setExpenseDraft(prev => ({ ...prev, note: event.target.value }))}
                placeholder="Optional details"
              />
            </label>
            <button type="submit" className="complete-sale-button">Add expense</button>
          </form>

          <div className="recent-report-list">
            <div className="panel-heading compact">
              <div>
                <span className="eyebrow">Expense log</span>
                <h4>Recorded costs</h4>
              </div>
            </div>
            {report.expenses.length === 0 ? (
              <div className="report-empty">No expenses today.</div>
            ) : report.expenses.slice(0, 8).map(expense => (
              <div key={expense.id} className="report-row expense">
                <div>
                  <strong>{expense.category || 'General'}</strong>
                  <span>{formatDate(expense.date || expense.createdAt)} | {expense.paymentMethod || 'Cash'}{expense.note ? ` | ${expense.note}` : ''}</span>
                </div>
                <b>-{money(expense.amount)}</b>
                <button type="button" onClick={() => onDeleteExpense(expense.id)}>Remove</button>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="owner-report-section">
        <div className="owner-report-header">
          <div>
            <span className="eyebrow">Owner only</span>
            <h3>Business report</h3>
            <p>Monthly, yearly, and all-time sales, expenses, and revenue for business review.</p>
          </div>
          {ownerUnlocked && (
            <div className="owner-period-tabs" aria-label="Owner report period">
              {OWNER_PERIODS.map(period => (
                <button
                  key={period.id}
                  type="button"
                  className={ownerPeriod === period.id ? 'active' : ''}
                  onClick={() => setOwnerPeriod(period.id)}
                >
                  {period.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {!ownerUnlocked ? ownerAccessPanel : (
          <div className="owner-report-body">
            <div className="money-summary-grid owner-summary-grid">
              <div className="money-card primary">
                <span>Gross sales</span>
                <strong>{money(ownerReport.grossSales)}</strong>
                <small>{ownerReport.pendingBalance > 0 ? `${money(ownerReport.pendingBalance)} pending` : `${ownerReport.sales.length} completed sales`}</small>
              </div>
              <div className="money-card negative">
                <span>Cost of goods</span>
                <strong>{money(ownerReport.costOfGoods)}</strong>
                <small>Original cost of products sold</small>
              </div>
              <div className={ownerReport.grossProfit < 0 ? 'money-card net negative' : 'money-card net'}>
                <span>Gross profit</span>
                <strong>{money(ownerReport.grossProfit)}</strong>
                <small>Gross sales minus product costs</small>
              </div>
              <div className={ownerReport.netRevenue < 0 ? 'money-card net negative' : 'money-card net'}>
                <span>Net collected</span>
                <strong>{money(ownerReport.netRevenue)}</strong>
                <small>{money(ownerReport.paidSales)} collected minus expenses</small>
              </div>
              <div className={ownerReport.netProfit < 0 ? 'money-card net negative' : 'money-card cash'}>
                <span>Net profit</span>
                <strong>{money(ownerReport.netProfit)}</strong>
                <small>Gross profit minus {money(ownerReport.totalExpenses)} expenses</small>
              </div>
              <div className="money-card cash">
                <span>Average sale</span>
                <strong>{money(ownerReport.averageSale)}</strong>
                <small>{ownerReport.voidedSales.length} voided sales excluded</small>
              </div>
            </div>

            <div className="owner-report-grid">
              <section className="sales-report-panel">
                <div className="panel-heading compact">
                  <div>
                    <span className="eyebrow">Revenue source</span>
                    <h4>Sales by payment</h4>
                  </div>
                </div>
                <div className="payment-breakdown-list">
                  {['Cash', 'GCash', 'Card', 'Bank transfer'].map(method => (
                    <div key={method}>
                      <span>{method}</span>
                      <strong>{money(ownerReport.salesByMethod[method] || 0)}</strong>
                    </div>
                  ))}
                </div>
              </section>

              <section className="sales-report-panel">
                <div className="panel-heading compact">
                  <div>
                    <span className="eyebrow">Cost control</span>
                    <h4>Expenses by category</h4>
                  </div>
                </div>
                <div className="owner-mini-list">
                  {Object.entries(ownerReport.expensesByCategory).length === 0 ? (
                    <div className="report-empty">No expenses in this period.</div>
                  ) : Object.entries(ownerReport.expensesByCategory)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 6)
                    .map(([category, amount]) => (
                      <div key={category} className="owner-mini-row">
                        <span>{category}</span>
                        <strong>{money(amount)}</strong>
                      </div>
                    ))}
                </div>
              </section>

              <section className="sales-report-panel">
                <div className="panel-heading compact">
                  <div>
                    <span className="eyebrow">Performance</span>
                    <h4>Top items and services</h4>
                  </div>
                </div>
                <div className="owner-mini-list">
                  {ownerReport.topItems.length === 0 ? (
                    <div className="report-empty">No item sales in this period.</div>
                  ) : ownerReport.topItems.map(item => (
                    <div key={item.name} className="owner-mini-row">
                      <span>{item.name} <small>{item.qty} sold</small></span>
                      <strong>{money(item.total)}</strong>
                    </div>
                  ))}
                </div>
              </section>

              <section className="sales-report-panel">
                <div className="panel-heading compact">
                  <div>
                    <span className="eyebrow">Audit</span>
                    <h4>Recent business activity</h4>
                  </div>
                </div>
                <div className="recent-report-list">
                  {ownerReport.sales.length === 0 && ownerReport.expenses.length === 0 ? (
                    <div className="report-empty">No activity in this period.</div>
                  ) : [
                    ...ownerReport.sales.slice(0, 4).map(sale => ({
                      id: `sale-${sale.id}`,
                      title: sale.clientName || 'Walk-in client',
                      detail: `${formatDate(sale.date)} | ${summarizeSalePayments(sale)}`,
                      amount: money(sale.total),
                      type: 'sale',
                    })),
                    ...ownerReport.expenses.slice(0, 4).map(expense => ({
                      id: `expense-${expense.id}`,
                      title: expense.category || 'General',
                      detail: `${formatDate(expense.date || expense.createdAt)} | ${expense.paymentMethod || 'Cash'}`,
                      amount: `-${money(expense.amount)}`,
                      type: 'expense',
                    })),
                  ].slice(0, 8).map(activity => (
                    <div key={activity.id} className={activity.type === 'expense' ? 'report-row expense compact-row' : 'report-row compact-row'}>
                      <div>
                        <strong>{activity.title}</strong>
                        <span>{activity.detail}</span>
                      </div>
                      <b>{activity.amount}</b>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </div>
        )}
      </section>

      {voidDraft.sale && (
        <div className="client-modal-backdrop">
          <form className="client-modal void-sale-modal" onSubmit={confirmVoidSale}>
            <div>
              <span className="eyebrow">Payment correction</span>
              <h3>Void sale</h3>
              <p>This removes the payment from today&apos;s totals and returns sold stock to inventory.</p>
            </div>

            <div className="void-sale-summary">
              <span>{voidDraft.sale.clientName || 'Walk-in client'}</span>
              <strong>{money(voidDraft.sale.total)}</strong>
              <small>{formatDate(voidDraft.sale.date)} | {summarizeSalePayments(voidDraft.sale)}</small>
            </div>

            <label className="client-name-field">
              <span>Reason</span>
              <select
                value={voidDraft.reason}
                onChange={event => setVoidDraft(prev => ({ ...prev, reason: event.target.value }))}
              >
                {VOID_REASONS.map(reason => (
                  <option key={reason}>{reason}</option>
                ))}
              </select>
            </label>

            <label className="client-name-field">
              <span>Note <small>(optional)</small></span>
              <input
                value={voidDraft.note}
                onChange={event => setVoidDraft(prev => ({ ...prev, note: event.target.value }))}
                placeholder="Add detail for your record"
              />
            </label>

            <div className="client-modal-actions">
              <button type="button" onClick={closeVoidModal} className="secondary-page-button">
                Cancel
              </button>
              <button type="submit" className="danger-page-button confirm-void-button">
                Void payment
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
