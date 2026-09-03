import { lazy, Suspense, useEffect, useState } from 'react'
import Dashboard from './components/Dashboard'
import ProductTable from './components/ProductTable'
import ProductModal from './components/ProductModal'
import RestockModal from './components/RestockModal'
import UndoCountModal from './components/UndoCountModal'
import POS from './components/POS'
import { DEFAULT_CATEGORIES, DEFAULT_RECEIPT_SETTINGS, loadClinicRecords, loadClinicRecordsAsync, saveClinicRecordsAsync } from './utils/storage'
import {
  activateLicense,
  getInstallationId,
  verifySavedLicense,
} from './utils/license'
import {
  checkPaymentRequest,
  getPaymentConfig,
  isPaymentLicensingConfigured,
  submitPaymentRequest,
} from './utils/paymentLicensing'
import { validateCheckoutStock } from './utils/checkout'
import { localDateString } from './utils/date'
import { authThrottleStatus, clearAuthThrottle, createPasswordRecord, parsePasswordRecord, recordAuthFailure, verifyPassword } from './utils/auth'
import { createBackup, MAX_BACKUP_BYTES, parseBackupText } from './utils/backup'

const Analytics = lazy(() => import('./components/Analytics'))
const Report = lazy(() => import('./components/Report'))
const SalesReport = lazy(() => import('./components/SalesReport'))
const ClientHistory = lazy(() => import('./components/ClientHistory'))
const Settings = lazy(() => import('./components/Settings'))

const tabs = [
  { id: 'pos', label: 'Checkout', short: 'POS', icon: 'fi-rr-shopping-cart' },
  { id: 'inventory', label: 'Inventory', short: 'Stock', icon: 'fi-rr-boxes' },
  { id: 'analytics', label: 'Analytics', short: 'Stats', icon: 'fi-rr-chart-histogram' },
  { id: 'sales-report', label: 'Sales Report', short: 'Sales', icon: 'fi-rr-cash-register' },
  { id: 'clients', label: 'Clients', short: 'Clients', icon: 'fi-rr-users' },
  { id: 'report', label: 'Reports', short: 'Report', icon: 'fi-rr-document' },
  { id: 'settings', label: 'Settings', short: 'Settings', icon: 'fi-rr-settings' },
]

const PASSWORD_KEY = 'vet-app-password'
const OWNER_PASSWORD_KEY = 'vet-owner-password'
const PAYMENT_REQUEST_KEY = 'vet-pos-gcash-payment-request'

function todayKey() {
  return localDateString()
}

function licenseMessage(reason) {
  if (!reason) return 'Invalid license.'
  if (reason.includes('expired')) return 'License expired.'
  if (reason.includes('Installation ID') || reason.includes('another installation')) {
    return 'This license belongs to another installation.'
  }
  if (reason.includes('Device date moved backward')) return reason
  if (reason.includes('missing')) return 'License is missing.'
  return 'Invalid license.'
}

function formatPeso(centavos) {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' })
    .format((Number(centavos) || 0) / 100)
}

function GcashLicenseIssuer({ installationId, onActivated, compact = false }) {
  const [config, setConfig] = useState(null)
  const [configError, setConfigError] = useState('')
  const [paymentRequest, setPaymentRequest] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(PAYMENT_REQUEST_KEY) || 'null')
    } catch {
      return null
    }
  })
  const [form, setForm] = useState({ customerName: '', plan: 'standard', gcashSenderName: '', gcashReference: '' })
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!isPaymentLicensingConfigured()) return
    let active = true
    const controller = new AbortController()
    getPaymentConfig(controller.signal)
      .then(result => {
        if (!active) return
        setConfig(result)
        setConfigError('')
        const firstPlan = Object.keys(result.plans || {})[0]
        if (firstPlan) setForm(current => ({ ...current, plan: firstPlan }))
      })
      .catch(() => {
        if (active) setConfigError('Online GCash licensing is temporarily unavailable. You can still paste a signed license below.')
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [])

  if (!isPaymentLicensingConfigured()) return null

  async function submit(event) {
    event.preventDefault()
    if (!installationId) return
    setBusy(true)
    setMessage('')
    try {
      const result = await submitPaymentRequest({ ...form, installationId })
      const saved = {
        requestId: result.requestId,
        claimToken: result.claimToken,
        submittedAt: result.submittedAt,
      }
      localStorage.setItem(PAYMENT_REQUEST_KEY, JSON.stringify(saved))
      setPaymentRequest(saved)
      setMessage('Payment submitted. Send your receipt to the provider, then check again after it is verified.')
    } catch (error) {
      setMessage(error.message || 'The payment request could not be submitted.')
    } finally {
      setBusy(false)
    }
  }

  async function checkStatus() {
    if (!paymentRequest) return
    setBusy(true)
    setMessage('')
    try {
      const result = await checkPaymentRequest(paymentRequest.requestId, paymentRequest.claimToken)
      if (result.status === 'approved' && result.licenseToken) {
        const activation = await activateLicense(result.licenseToken)
        if (!activation.valid) throw new Error(activation.reason || 'The issued license could not be activated.')
        localStorage.removeItem(PAYMENT_REQUEST_KEY)
        setPaymentRequest(null)
        onActivated()
        return
      }
      if (result.status === 'rejected') {
        localStorage.removeItem(PAYMENT_REQUEST_KEY)
        setPaymentRequest(null)
        setForm(current => ({ ...current, gcashReference: '' }))
        setMessage(result.rejectionReason || 'The payment request was rejected.')
        return
      }
      setMessage('Payment is still waiting for manual verification.')
    } catch (error) {
      setMessage(error.message || 'The payment status could not be checked.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={compact ? 'gcash-license-panel compact' : 'gcash-license-panel'}>
      <div className="gcash-license-heading">
        <div>
          <span>GCash license issuer</span>
          <strong>{config?.gcashAccountName || 'Online payment'}</strong>
          {config?.gcashNumber && <code>{config.gcashNumber}</code>}
        </div>
        {config?.gcashQrUrl && (
          <a href={config.gcashQrUrl} target="_blank" rel="noreferrer" className="gcash-license-qr">
            <img src={config.gcashQrUrl} alt="Official GCash payment QR code" />
          </a>
        )}
      </div>

      {configError && <p className="gcash-license-message error">{configError}</p>}

      {config && paymentRequest ? (
        <div className="gcash-license-pending">
          <p>Request <code>{paymentRequest.requestId}</code> is waiting for verification.</p>
          <button type="button" className="complete-sale-button" disabled={busy} onClick={checkStatus}>
            {busy ? 'Checking...' : 'Check payment status'}
          </button>
        </div>
      ) : config ? (
        <form className="gcash-license-form" onSubmit={submit}>
          <label>
            <span>Clinic or customer name</span>
            <input value={form.customerName} onChange={event => setForm(current => ({ ...current, customerName: event.target.value }))} required />
          </label>
          <label>
            <span>License plan</span>
            <select value={form.plan} onChange={event => setForm(current => ({ ...current, plan: event.target.value }))}>
              {Object.entries(config.plans || {}).map(([value, plan]) => (
                <option value={value} key={value}>{plan.label} — {formatPeso(plan.amountCentavos)}</option>
              ))}
            </select>
          </label>
          <label>
            <span>GCash sender name</span>
            <input value={form.gcashSenderName} onChange={event => setForm(current => ({ ...current, gcashSenderName: event.target.value }))} required />
          </label>
          <label>
            <span>GCash reference number</span>
            <input value={form.gcashReference} onChange={event => setForm(current => ({ ...current, gcashReference: event.target.value }))} required />
          </label>
          {config.messageUrl && (
            <a href={config.messageUrl} target="_blank" rel="noreferrer" className="gcash-message-provider">
              Send payment receipt to provider
            </a>
          )}
          <button type="submit" className="complete-sale-button" disabled={busy || !installationId}>
            {busy ? 'Submitting...' : 'Submit payment for verification'}
          </button>
        </form>
      ) : null}

      {message && <p className={message.toLowerCase().includes('rejected') || message.toLowerCase().includes('could not') ? 'gcash-license-message error' : 'gcash-license-message'}>{message}</p>}
    </section>
  )
}

export default function App() {
  const [clinicRecordsLoaded] = useState(() => loadClinicRecords())
  const [installationId, setInstallationId] = useState('')
  const [licenseStatus, setLicenseStatus] = useState({ loading: true, valid: false, reason: '' })
  const [products, setProducts] = useState(clinicRecordsLoaded.products)
  const [sales, setSales] = useState(clinicRecordsLoaded.sales)
  const [clients, setClients] = useState(clinicRecordsLoaded.clients)
  const [expenses, setExpenses] = useState(clinicRecordsLoaded.expenses)
  const [cashDrawer, setCashDrawer] = useState(clinicRecordsLoaded.cashDrawer)
  const [categories, setCategories] = useState(clinicRecordsLoaded.categories)
  const [receiptSettings, setReceiptSettings] = useState(clinicRecordsLoaded.receiptSettings)
  const [tab, setTab] = useState('pos')
  const [modalOpen, setModalOpen] = useState(false)
  const [editProduct, setEditProduct] = useState(null)
  const [productPreset, setProductPreset] = useState(null)
  const [restockProduct, setRestockProduct] = useState(null)
  const [undoProduct, setUndoProduct] = useState(null)
  const [deleteProductTarget, setDeleteProductTarget] = useState(null)
  const [deleteExpenseTarget, setDeleteExpenseTarget] = useState(null)
  const [appNotice, setAppNotice] = useState(null)
  const [storageReady, setStorageReady] = useState(false)
  const [navCollapsed, setNavCollapsed] = useState(false)
  const [openingCashPrompt, setOpeningCashPrompt] = useState('')
  const [orders, setOrders] = useState(clinicRecordsLoaded.orders)
  const [activeOrderId, setActiveOrderId] = useState(clinicRecordsLoaded.activeOrderId)
  const [passwordRecord, setPasswordRecord] = useState(() => {
    return parsePasswordRecord(localStorage.getItem(PASSWORD_KEY))
  })
  const [ownerPasswordRecord, setOwnerPasswordRecord] = useState(() => {
    return parsePasswordRecord(localStorage.getItem(OWNER_PASSWORD_KEY))
  })
  const [isUnlocked, setIsUnlocked] = useState(false)
  const [ownerUnlocked, setOwnerUnlocked] = useState(false)
  const [unlockPassword, setUnlockPassword] = useState('')
  const [setupPassword, setSetupPassword] = useState('')
  const [setupConfirm, setSetupConfirm] = useState('')
  const [ownerPassword, setOwnerPassword] = useState('')
  const [ownerSetupPassword, setOwnerSetupPassword] = useState('')
  const [ownerSetupConfirm, setOwnerSetupConfirm] = useState('')
  const [licenseInput, setLicenseInput] = useState('')
  const [licenseError, setLicenseError] = useState('')
  const [licenseBusy, setLicenseBusy] = useState(false)
  const [licenseCopied, setLicenseCopied] = useState(false)
  const [authError, setAuthError] = useState('')
  const [ownerAuthError, setOwnerAuthError] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [ownerAuthBusy, setOwnerAuthBusy] = useState(false)
  const currentDayKey = todayKey()
  const isActivated = licenseStatus.valid
  const isReadOnly = !isActivated && licenseStatus.reason === 'License expired.'
  const needsOpeningCash = !isReadOnly && tab === 'pos' && !cashDrawer[currentDayKey]

  function blockReadOnlyWrite() {
    if (!isReadOnly) return false
    setAppNotice({
      title: 'Read-only mode',
      message: 'The license has expired. Renew the license to change records or complete sales.',
      tone: 'warning',
    })
    return true
  }

  useEffect(() => {
    let active = true

    getInstallationId()
      .then(id => {
        if (active) setInstallationId(id)
      })
      .catch(() => {
        if (active) setLicenseStatus({ loading: false, valid: false, reason: 'Could not prepare activation.' })
      })

    verifySavedLicense()
      .then(result => {
        if (!active) return
        setLicenseStatus({
          loading: false,
          valid: result.valid,
          reason: result.valid ? '' : licenseMessage(result.reason),
        })
      })
      .catch(() => {
        if (active) setLicenseStatus({ loading: false, valid: false, reason: 'Could not verify license.' })
      })

    loadClinicRecordsAsync()
      .then(records => {
        if (!active) return
        setProducts(records.products)
        setSales(records.sales)
        setClients(records.clients)
        setExpenses(records.expenses)
        setCashDrawer(records.cashDrawer)
        setCategories(records.categories)
        setReceiptSettings(records.receiptSettings)
        setOrders(records.orders)
        setActiveOrderId(records.activeOrderId)
      })
      .catch(() => {
        if (!active) return
        setAppNotice({
          title: 'Storage fallback active',
          message: 'SQLite could not start, so Vet POS is using backup local storage for now.',
          tone: 'warning',
        })
      })
      .finally(() => {
        if (active) setStorageReady(true)
      })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!storageReady || isReadOnly) return
    saveClinicRecordsAsync({ products, sales, clients, expenses, cashDrawer, categories, receiptSettings, orders, activeOrderId })
      .catch(() => {
        setAppNotice({
          title: 'Storage warning',
          message: 'SQLite save failed. Backup local storage was still updated.',
          tone: 'warning',
        })
      })
  }, [products, sales, clients, expenses, cashDrawer, categories, receiptSettings, orders, activeOrderId, storageReady, isReadOnly])

  useEffect(() => {
    if (!passwordRecord) return undefined

    const lockApp = () => {
      setIsUnlocked(false)
      setOwnerUnlocked(false)
    }
    const lockWhenHidden = () => {
      if (document.visibilityState === 'hidden') lockApp()
    }

    document.addEventListener('visibilitychange', lockWhenHidden)
    window.addEventListener('pagehide', lockApp)

    return () => {
      document.removeEventListener('visibilitychange', lockWhenHidden)
      window.removeEventListener('pagehide', lockApp)
    }
  }, [passwordRecord])

  function saveProduct(data) {
    if (blockReadOnlyWrite()) return
    if (data.id) {
      setProducts(prev => prev.map(product => product.id === data.id ? data : product))
    } else {
      setProducts(prev => [...prev, { ...data, id: Date.now(), sold: 0 }])
    }
    setModalOpen(false)
    setEditProduct(null)
    setProductPreset(null)
  }

  function saveRestock(data) {
    if (blockReadOnlyWrite()) return
    setProducts(prev => prev.map(product => product.id === data.id ? data : product))
    setRestockProduct(null)
  }

  function saveUndo(data) {
    if (blockReadOnlyWrite()) return
    setProducts(prev => prev.map(product => product.id === data.id ? data : product))
    setUndoProduct(null)
  }

  function applyTrendReorderLevels(updates) {
    if (blockReadOnlyWrite()) return
    setProducts(prev => prev.map(product => {
      const update = updates.find(item => item.id === product.id)
      if (!update) return product
      return {
        ...product,
        reorder: update.reorder,
        reorderAutomatedAt: new Date().toISOString(),
      }
    }))
  }

  function saveClientName(name) {
    if (blockReadOnlyWrite()) return
    const cleanName = name.trim()
    if (!cleanName) return

    const existing = clients.find(client => client.name.toLowerCase() === cleanName.toLowerCase())
    const nextClients = existing
      ? clients.map(client => client.id === existing.id
          ? { ...client, name: cleanName, lastUsedAt: new Date().toISOString() }
          : client
        )
      : [
        {
          id: Date.now(),
          name: cleanName,
          createdAt: new Date().toISOString(),
          lastUsedAt: new Date().toISOString(),
        },
        ...clients,
      ]

    setClients(nextClients)
  }

  function deleteClientName(name) {
    if (blockReadOnlyWrite()) return
    const cleanName = name.trim()
    if (!cleanName) return
    const key = cleanName.toLowerCase()

    setClients(prev => prev.filter(client => client.name?.trim().toLowerCase() !== key))
    setSales(prev => prev.map(sale => (
      sale.clientName?.trim().toLowerCase() === key
        ? { ...sale, clientName: '' }
        : sale
    )))
  }

  async function completeSale({
    items,
    paymentMethod,
    payments = [],
    pendingBalance = 0,
    cashReceived = 0,
    changeDue = 0,
    discount,
    clientName,
  }) {
    if (blockReadOnlyWrite()) return null
    const stockCheck = validateCheckoutStock({ items, products, orders, activeOrderId })
    if (!stockCheck.valid) {
      const product = stockCheck.product
      setAppNotice({
        title: stockCheck.reason === 'invalid-item' ? 'Checkout stopped' : 'Stock changed before checkout',
        message: stockCheck.reason === 'invalid-item'
          ? 'One or more cart items are no longer valid. Refresh the cart and try again.'
          : `${product?.name || 'An item'} no longer has enough unreserved stock. Review the open orders or restock it, then try again.`,
        tone: 'warning',
      })
      return null
    }

    const subtotal = items.reduce((sum, item) => {
      return sum + (Number(item.lineSubtotal) || Number(item.qty) * Number(item.price))
    }, 0)
    const itemDiscount = items.reduce((sum, item) => sum + (Number(item.discount) || 0), 0)
    const normalizedDiscount = Math.max(0, Number(discount) || itemDiscount)
    const total = Math.max(0, items.reduce((sum, item) => {
      const lineSubtotal = Number(item.lineSubtotal) || Number(item.qty) * Number(item.price)
      return sum + Math.max(0, lineSubtotal - (Number(item.discount) || 0))
    }, 0))
    const sale = {
      id: Date.now(),
      date: new Date().toISOString(),
      items,
      clientName: clientName?.trim() || '',
      paymentMethod,
      payments: Array.isArray(payments)
        ? payments
          .map(payment => ({
            method: payment.method || 'Cash',
            amount: Math.max(0, Number(payment.amount) || 0),
          }))
          .filter(payment => payment.amount > 0)
        : [],
      pendingBalance: Math.max(0, Number(pendingBalance) || 0),
      cashReceived: Math.max(0, Number(cashReceived) || 0),
      changeDue: Math.max(0, Number(changeDue) || 0),
      discount: normalizedDiscount,
      subtotal,
      total,
    }
    const soldById = items.reduce((map, item) => {
      map[item.productId] = (map[item.productId] || 0) + item.qty
      return map
    }, {})
    const consumedById = items.reduce((map, item) => {
      if (!item.consumesProductId || !Number(item.consumptionPerSale)) return map
      map[item.consumesProductId] = (map[item.consumesProductId] || 0) + (Number(item.qty) || 0) * Number(item.consumptionPerSale)
      return map
    }, {})

    const nextProducts = products.map(product => {
      const soldQty = soldById[product.id] || 0
      const consumedQty = consumedById[product.id] || 0
      if (!soldQty && !consumedQty) return product

      if (product.trackStock === false) {
        return {
          ...product,
          sold: (Number(product.sold) || 0) + soldQty,
        }
      }

      const qtyBefore = Number(product.qty) || 0
      const usedQty = soldQty + consumedQty
      const qtyAfter = qtyBefore - usedQty
      const saleSnapshot = {
        date: sale.date,
        type: 'sale',
        saleId: sale.id,
        qtyBefore,
        qtyAfter,
        usedWeek: usedQty,
        soldBefore: Number(product.sold) || 0,
        lastQtyBefore: product.lastQty,
      }

      return {
        ...product,
        qty: qtyAfter,
        lastQty: qtyBefore,
        sold: (Number(product.sold) || 0) + usedQty,
        countHistory: [...(product.countHistory || []), saleSnapshot].slice(-20),
      }
    })
    const nextSales = [sale, ...sales]
    const nextClients = sale.clientName
      ? (() => {
          const existing = clients.find(client => client.name.toLowerCase() === sale.clientName.toLowerCase())
          return existing
            ? clients.map(client => client.id === existing.id ? { ...client, name: sale.clientName, lastUsedAt: sale.date } : client)
            : [{ id: Date.now() + 1, name: sale.clientName, createdAt: sale.date, lastUsedAt: sale.date }, ...clients]
        })()
      : clients
    const nextOrders = orders.filter(order => order.id !== activeOrderId)
    const nextActiveOrderId = nextOrders[0]?.id || ''

    try {
      await saveClinicRecordsAsync({
        products: nextProducts,
        sales: nextSales,
        clients: nextClients,
        expenses,
        cashDrawer,
        categories,
        receiptSettings,
        orders: nextOrders,
        activeOrderId: nextActiveOrderId,
      })
    } catch {
      setAppNotice({
        title: 'Sale was not saved',
        message: 'Permanent storage did not confirm the transaction. No stock or sales totals were changed; please try again.',
        tone: 'warning',
      })
      return null
    }

    setProducts(nextProducts)
    setSales(nextSales)
    setClients(nextClients)
    setOrders(nextOrders)
    setActiveOrderId(nextActiveOrderId)
    return sale
  }

  function addExpense(expense) {
    if (blockReadOnlyWrite()) return
    setExpenses(prev => [
      {
        id: Date.now(),
        date: expense.date || localDateString(),
        category: expense.category?.trim() || 'General',
        note: expense.note?.trim() || '',
        paymentMethod: expense.paymentMethod || 'Cash',
        amount: Math.max(0, Number(expense.amount) || 0),
        createdAt: new Date().toISOString(),
      },
      ...prev,
    ])
  }

  function deleteExpense(id) {
    if (blockReadOnlyWrite()) return
    const expense = expenses.find(item => item.id === id)
    if (expense) setDeleteExpenseTarget(expense)
  }

  function confirmDeleteExpense() {
    if (blockReadOnlyWrite()) return
    if (!deleteExpenseTarget) return
    setExpenses(prev => prev.filter(expense => expense.id !== deleteExpenseTarget.id))
    setDeleteExpenseTarget(null)
  }

  function setOpeningCash(amount) {
    if (blockReadOnlyWrite()) return
    const date = todayKey()
    setCashDrawer(prev => ({
      ...prev,
      [date]: {
        ...(prev[date] || {}),
        openingCash: Math.max(0, Number(amount) || 0),
        setAt: new Date().toISOString(),
      },
    }))
  }

  function setClosingCash(amount) {
    if (blockReadOnlyWrite()) return
    const date = todayKey()
    setCashDrawer(prev => ({
      ...prev,
      [date]: {
        ...(prev[date] || {}),
        closingCash: Math.max(0, Number(amount) || 0),
        closedAt: new Date().toISOString(),
      },
    }))
  }

  function submitOpeningCashPrompt(event) {
    event.preventDefault()
    const trimmed = openingCashPrompt.trim()
    if (trimmed === '') {
      setAppNotice({
        title: 'Opening cash needed',
        message: 'Enter 0 if the money box is empty before starting POS.',
        tone: 'warning',
      })
      return
    }
    const amount = Number(trimmed)
    if (!Number.isFinite(amount) || amount < 0) {
      setAppNotice({
        title: 'Check opening cash',
        message: 'Enter a valid opening cash amount. Use 0 if the box is empty.',
        tone: 'warning',
      })
      return
    }
    setOpeningCash(amount)
    setOpeningCashPrompt('')
  }

  function voidSale(saleId, { reason, note }) {
    if (blockReadOnlyWrite()) return
    const sale = sales.find(item => item.id === saleId)
    if (!sale || sale.voided) return

    const soldById = (sale.items || []).reduce((map, item) => {
      map[item.productId] = (map[item.productId] || 0) + (Number(item.qty) || 0)
      return map
    }, {})
    const consumedById = (sale.items || []).reduce((map, item) => {
      if (!item.consumesProductId || !Number(item.consumptionPerSale)) return map
      map[item.consumesProductId] = (map[item.consumesProductId] || 0) + (Number(item.qty) || 0) * Number(item.consumptionPerSale)
      return map
    }, {})

    setProducts(prev => prev.map(product => {
      const soldQty = soldById[product.id] || 0
      const consumedQty = consumedById[product.id] || 0
      if (!soldQty && !consumedQty) return product

      if (product.trackStock === false) {
        return {
          ...product,
          sold: Math.max(0, (Number(product.sold) || 0) - soldQty),
        }
      }

      const restoredQty = soldQty + consumedQty
      const qtyBefore = Number(product.qty) || 0
      const qtyAfter = qtyBefore + restoredQty
      const voidSnapshot = {
        date: new Date().toISOString(),
        type: 'void',
        saleId: sale.id,
        qtyBefore,
        qtyAfter,
        usedWeek: 0,
        restoredQty,
      }

      return {
        ...product,
        qty: qtyAfter,
        lastQty: qtyBefore,
        sold: Math.max(0, (Number(product.sold) || 0) - restoredQty),
        countHistory: [
          ...(product.countHistory || []).map(entry => entry.saleId === sale.id
            ? { ...entry, usedWeek: 0, voided: true }
            : entry
          ),
          voidSnapshot,
        ].slice(-20),
      }
    }))

    setSales(prev => prev.map(item => item.id === saleId
      ? {
          ...item,
          voided: true,
          voidedAt: new Date().toISOString(),
          voidReason: reason,
          voidNote: note?.trim() || '',
        }
      : item
    ))
  }

  function requestDeleteProduct(product) {
    if (blockReadOnlyWrite()) return
    setDeleteProductTarget(product)
  }

  function confirmDeleteProduct() {
    if (blockReadOnlyWrite()) return
    if (!deleteProductTarget) return
    setProducts(prev => prev.filter(product => product.id !== deleteProductTarget.id))
    setDeleteProductTarget(null)
  }

  function addCategory(name) {
    if (blockReadOnlyWrite()) return false
    const cleanName = name.trim()
    if (!cleanName) return false
    const exists = categories.some(category => category.toLowerCase() === cleanName.toLowerCase())
    if (exists) return false
    setCategories(prev => [...prev, cleanName].sort())
    return true
  }

  function renameCategory(oldName, nextName) {
    if (blockReadOnlyWrite()) return false
    const cleanOld = oldName.trim()
    const cleanNext = nextName.trim()
    if (!cleanOld || !cleanNext) return false
    const duplicate = categories.some(category => (
      category.toLowerCase() === cleanNext.toLowerCase()
      && category.toLowerCase() !== cleanOld.toLowerCase()
    ))
    if (duplicate) return false

    setCategories(prev => [...new Set(prev.map(category => (
      category.toLowerCase() === cleanOld.toLowerCase() ? cleanNext : category
    )))].sort())
    setProducts(prev => prev.map(product => (
      product.cat?.toLowerCase() === cleanOld.toLowerCase()
        ? { ...product, cat: cleanNext }
        : product
    )))
    return true
  }

  function openEdit(product) {
    if (blockReadOnlyWrite()) return
    setProductPreset(null)
    setEditProduct(product)
    setModalOpen(true)
  }

  function openNewProduct() {
    if (blockReadOnlyWrite()) return
    setProductPreset(null)
    setEditProduct(null)
    setModalOpen(true)
  }

  function openNewService() {
    if (blockReadOnlyWrite()) return
    setProductPreset({
      cat: 'Service',
      trackStock: false,
      qty: '',
      newQty: '',
      unit: '',
      reorder: '',
    })
    setEditProduct(null)
    setModalOpen(true)
  }

  function exportBackup() {
    const data = JSON.stringify(createBackup({ products, sales, clients, expenses, cashDrawer, categories, receiptSettings, orders, activeOrderId }), null, 2)
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `vet-pos-backup-${localDateString()}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  async function importBackup(event) {
    if (blockReadOnlyWrite()) {
      event.target.value = ''
      return
    }
    const file = event.target.files[0]
    if (!file) return
    event.target.value = ''
    if (file.size > MAX_BACKUP_BYTES) {
      setAppNotice({ title: 'Backup is too large', message: 'Choose a Vet POS backup smaller than 25 MB.', tone: 'warning' })
      return
    }

    try {
      const parsed = parseBackupText(await file.text())
      const { records, summary } = parsed
      const preview = `Import ${summary.products} products, ${summary.sales} sales, ${summary.clients} clients, ${summary.expenses} expenses, and ${summary.orders} open orders? This replaces the current clinic records.`
      if (!window.confirm(preview)) return
      const nextCategories = [...new Set([...DEFAULT_CATEGORIES, ...records.categories, ...records.products.map(product => product.cat).filter(Boolean)])].sort()
      const nextReceiptSettings = { ...DEFAULT_RECEIPT_SETTINGS, ...records.receiptSettings }
      const snapshot = { ...records, categories: nextCategories, receiptSettings: nextReceiptSettings }
      await saveClinicRecordsAsync(snapshot)
      setProducts(snapshot.products)
      setSales(snapshot.sales)
      setClients(snapshot.clients)
      setExpenses(snapshot.expenses)
      setCashDrawer(snapshot.cashDrawer)
      setCategories(snapshot.categories)
      setReceiptSettings(snapshot.receiptSettings)
      setOrders(snapshot.orders)
      setActiveOrderId(snapshot.activeOrderId)
      setAppNotice({ title: 'Backup imported', message: `Imported the validated backup${parsed.migrated ? ' and upgraded it to the current format' : ''}.`, tone: 'success' })
    } catch (error) {
      setAppNotice({ title: 'Import failed', message: error.message || 'The backup could not be validated or saved.', tone: 'warning' })
    }
  }

  async function copyInstallationId() {
    if (!installationId) return
    try {
      await navigator.clipboard.writeText(installationId)
      setLicenseCopied(true)
      setTimeout(() => setLicenseCopied(false), 1800)
    } catch {
      setLicenseError('Could not copy the installation ID. You can still type it manually.')
    }
  }

  async function submitLicense(event) {
    event.preventDefault()
    const cleanLicense = licenseInput.trim()
    if (!cleanLicense) {
      setLicenseError('Paste the license code before activating.')
      return
    }

    setLicenseBusy(true)
    setLicenseError('')

    try {
      const result = await activateLicense(cleanLicense)
      if (!result.valid) {
        const message = licenseMessage(result.reason)
        setLicenseError(message)
        setLicenseStatus({ loading: false, valid: false, reason: message })
        return
      }

      setLicenseStatus({ loading: false, valid: true, reason: '' })
      setLicenseInput('')
    } catch {
      setLicenseError('Could not activate the app. Please check the license and try again.')
    } finally {
      setLicenseBusy(false)
    }
  }

  async function submitPasswordSetup(event) {
    event.preventDefault()
    const password = setupPassword.trim()

    if (password.length < 8) {
      setAuthError('Use at least 8 characters for the app password.')
      return
    }

    if (password !== setupConfirm.trim()) {
      setAuthError('The passwords do not match.')
      return
    }

    setAuthBusy(true)
    setAuthError('')

    try {
      const record = await createPasswordRecord(password)
      localStorage.setItem(PASSWORD_KEY, JSON.stringify(record))
      setPasswordRecord(record)
      setIsUnlocked(true)
      setSetupPassword('')
      setSetupConfirm('')
    } catch {
      setAuthError('Could not save the app password. Please try again.')
    } finally {
      setAuthBusy(false)
    }
  }

  async function submitUnlock(event) {
    event.preventDefault()
    if (!passwordRecord) return
    const throttle = authThrottleStatus('app')
    if (throttle.blocked) {
      setAuthError(`Too many attempts. Try again in ${throttle.retryAfterSeconds} seconds.`)
      return
    }

    setAuthBusy(true)
    setAuthError('')

    try {
      const result = await verifyPassword(unlockPassword, passwordRecord)
      if (!result.valid) {
        const failure = recordAuthFailure('app')
        setAuthError(failure.retryAfterSeconds ? `Too many attempts. Try again in ${failure.retryAfterSeconds} seconds.` : 'Incorrect password.')
        setUnlockPassword('')
        return
      }

      clearAuthThrottle('app')
      if (result.upgradedRecord) {
        localStorage.setItem(PASSWORD_KEY, JSON.stringify(result.upgradedRecord))
        setPasswordRecord(result.upgradedRecord)
      }

      setIsUnlocked(true)
      setUnlockPassword('')
    } catch {
      setAuthError('Could not unlock the app. Please try again.')
    } finally {
      setAuthBusy(false)
    }
  }

  async function submitOwnerPasswordSetup(event) {
    event.preventDefault()
    const password = ownerSetupPassword.trim()

    if (password.length < 8) {
      setOwnerAuthError('Use at least 8 characters for the owner password.')
      return
    }

    if (password !== ownerSetupConfirm.trim()) {
      setOwnerAuthError('The passwords do not match.')
      return
    }

    setOwnerAuthBusy(true)
    setOwnerAuthError('')

    try {
      const record = await createPasswordRecord(password)
      localStorage.setItem(OWNER_PASSWORD_KEY, JSON.stringify(record))
      setOwnerPasswordRecord(record)
      setOwnerUnlocked(true)
      setOwnerSetupPassword('')
      setOwnerSetupConfirm('')
    } catch {
      setOwnerAuthError('Could not save the owner password. Please try again.')
    } finally {
      setOwnerAuthBusy(false)
    }
  }

  async function submitOwnerUnlock(event) {
    event.preventDefault()
    if (!ownerPasswordRecord) return
    const throttle = authThrottleStatus('owner')
    if (throttle.blocked) {
      setOwnerAuthError(`Too many attempts. Try again in ${throttle.retryAfterSeconds} seconds.`)
      return
    }

    setOwnerAuthBusy(true)
    setOwnerAuthError('')

    try {
      const result = await verifyPassword(ownerPassword, ownerPasswordRecord)
      if (!result.valid) {
        const failure = recordAuthFailure('owner')
        setOwnerAuthError(failure.retryAfterSeconds ? `Too many attempts. Try again in ${failure.retryAfterSeconds} seconds.` : 'Incorrect owner password.')
        setOwnerPassword('')
        return
      }

      clearAuthThrottle('owner')
      if (result.upgradedRecord) {
        localStorage.setItem(OWNER_PASSWORD_KEY, JSON.stringify(result.upgradedRecord))
        setOwnerPasswordRecord(result.upgradedRecord)
      }

      setOwnerUnlocked(true)
      setOwnerPassword('')
    } catch {
      setOwnerAuthError('Could not unlock owner sales. Please try again.')
    } finally {
      setOwnerAuthBusy(false)
    }
  }

  function renderOwnerGate() {
    const isSetup = !ownerPasswordRecord

    return (
      <section className="sales-access-screen">
        <form className="app-lock-card sales-access-card" onSubmit={isSetup ? submitOwnerPasswordSetup : submitOwnerUnlock}>
          <div className="app-lock-brand">
            <div className="brand-mark">VP</div>
            <div>
              <span className="eyebrow">{isSetup ? 'Owner setup' : 'Owner access'}</span>
              <h1>{isSetup ? 'Create owner password' : 'Unlock business report'}</h1>
              <p>{isSetup ? 'This password protects monthly, yearly, and all-time sales, expenses, and revenue.' : 'Owner password is required before showing long-range business totals.'}</p>
            </div>
          </div>

          <label className="client-name-field">
            <span>Owner password</span>
            <input
              type="password"
              value={isSetup ? ownerSetupPassword : ownerPassword}
              onChange={event => {
                setOwnerAuthError('')
                if (isSetup) setOwnerSetupPassword(event.target.value)
                else setOwnerPassword(event.target.value)
              }}
              autoComplete={isSetup ? 'new-password' : 'current-password'}
              minLength={isSetup ? 8 : undefined}
              required
            />
          </label>

          {isSetup && (
            <label className="client-name-field">
              <span>Confirm owner password</span>
              <input
                type="password"
                value={ownerSetupConfirm}
                onChange={event => {
                  setOwnerAuthError('')
                  setOwnerSetupConfirm(event.target.value)
                }}
                autoComplete="new-password"
                minLength="8"
                required
              />
            </label>
          )}

          {ownerAuthError && <div className="app-lock-error">{ownerAuthError}</div>}

          <div className="sales-access-actions">
            <button type="button" className="secondary-page-button" onClick={() => setTab('pos')}>
              Back to checkout
            </button>
            <button type="submit" className="complete-sale-button" disabled={ownerAuthBusy}>
              {ownerAuthBusy ? 'Please wait...' : isSetup ? 'Save owner password' : 'Unlock sales'}
            </button>
          </div>
        </form>
      </section>
    )
  }

  if (!storageReady || licenseStatus.loading) {
    return (
      <main className="app-lock-screen">
        <div className="app-lock-card activation-card">
          <div className="app-lock-brand">
            <div className="brand-mark">SF</div>
            <div>
              <span className="eyebrow">App activation</span>
              <h1>Preparing clinic records</h1>
              <p>Please wait while Vet POS verifies the license and safely loads saved clinic data.</p>
            </div>
          </div>
        </div>
      </main>
    )
  }

  if (!isActivated && !isReadOnly) {
    return (
      <main className="app-lock-screen">
        <div className="app-lock-card activation-card">
          <div className="app-lock-brand">
            <div className="brand-mark">SF</div>
            <div>
              <span className="eyebrow">App activation</span>
              <h1>Activate this device</h1>
              <p>Pay through GCash, submit your reference number, then activate after payment verification.</p>
            </div>
          </div>

          <div className="activation-code-box">
            <span>Installation ID</span>
            <strong>{installationId || 'Preparing...'}</strong>
            <button type="button" className="secondary-page-button" onClick={copyInstallationId} disabled={!installationId}>
              {licenseCopied ? 'Copied' : 'Copy ID'}
            </button>
          </div>

          <GcashLicenseIssuer
            installationId={installationId}
            onActivated={() => {
              setLicenseStatus({ loading: false, valid: true, reason: '' })
              setLicenseInput('')
            }}
          />

          <details className="manual-license-details">
            <summary>Already have a signed license code?</summary>
            <form className="manual-license-form" onSubmit={submitLicense}>
              <label className="client-name-field">
                <span>Signed license code</span>
                <input
                  value={licenseInput}
                  onChange={event => {
                    setLicenseError('')
                    setLicenseInput(event.target.value.trim())
                  }}
                  placeholder="Paste SFP1 license"
                  autoComplete="off"
                  required
                />
              </label>

              {(licenseError || (licenseStatus.reason && licenseStatus.reason !== 'License is missing.')) && (
                <div className="app-lock-error">{licenseError || licenseStatus.reason}</div>
              )}

              <button type="submit" className="complete-sale-button" disabled={licenseBusy}>
                {licenseBusy ? 'Checking license...' : 'Activate pasted license'}
              </button>
            </form>
          </details>
        </div>
      </main>
    )
  }

  if (!passwordRecord || !isUnlocked) {
    const isSetup = !passwordRecord

    return (
      <main className="app-lock-screen">
        <form className="app-lock-card" onSubmit={isSetup ? submitPasswordSetup : submitUnlock}>
          <div className="app-lock-brand">
            <div className="brand-mark">VP</div>
            <div>
              <span className="eyebrow">{isSetup ? 'First time setup' : 'App locked'}</span>
              <h1>{isSetup ? 'Create app password' : 'Enter app password'}</h1>
              <p>{isSetup ? 'This password will be required before the tablet can use Vet POS.' : 'Unlock Vet POS to continue.'}</p>
            </div>
          </div>

          <label className="client-name-field">
            <span>Password</span>
            <input
              type="password"
              value={isSetup ? setupPassword : unlockPassword}
              onChange={event => {
                setAuthError('')
                if (isSetup) setSetupPassword(event.target.value)
                else setUnlockPassword(event.target.value)
              }}
              autoComplete={isSetup ? 'new-password' : 'current-password'}
              minLength={isSetup ? 8 : undefined}
              required
              autoFocus
            />
          </label>

          {isSetup && (
            <label className="client-name-field">
              <span>Confirm password</span>
              <input
                type="password"
                value={setupConfirm}
                onChange={event => {
                  setAuthError('')
                  setSetupConfirm(event.target.value)
                }}
                autoComplete="new-password"
                minLength="8"
                required
              />
            </label>
          )}

          {authError && <div className="app-lock-error">{authError}</div>}

          <button type="submit" className="complete-sale-button" disabled={authBusy}>
            {authBusy ? 'Please wait...' : isSetup ? 'Save password' : 'Unlock app'}
          </button>
        </form>
      </main>
    )
  }

  return (
    <div className={`${navCollapsed ? 'app-shell nav-collapsed' : 'app-shell'}${isReadOnly ? ' license-read-only' : ''}`}>
      <aside className="side-nav">
        <button
          type="button"
          onClick={() => setNavCollapsed(prev => !prev)}
          className="sidebar-toggle"
          aria-label={navCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={navCollapsed ? 'Open sidebar' : 'Hide sidebar'}
        >
          <i className={`fi ${navCollapsed ? 'fi-rr-angle-small-right' : 'fi-rr-angle-small-left'}`} aria-hidden="true"></i>
        </button>

        <div className="side-nav-scroll">
          <div className="brand-block">
            <div className="brand-mark">VP</div>
            <div>
              <h1>Vet POS</h1>
              <p>{new Date().toLocaleDateString('en-PH', { weekday: 'long', month: 'short', day: 'numeric' })}</p>
            </div>
          </div>

          <nav className="nav-stack" aria-label="Primary">
            {tabs.map(item => (
              <button
                key={item.id}
                onClick={() => {
                  if (item.id !== 'sales-report') setOwnerUnlocked(false)
                  setTab(item.id)
                  setNavCollapsed(true)
                }}
                className={tab === item.id ? 'nav-button active' : 'nav-button'}
                title={item.label}
              >
                <span className="nav-icon" aria-hidden="true">
                  <i className={`fi ${item.icon}`}></i>
                </span>
                <span className="nav-full">{item.label}</span>
                <span className="nav-short">{item.short}</span>
              </button>
            ))}
          </nav>

          <div className="nav-actions">
            <div className="create-actions">
              <button
                onClick={() => {
                  openNewProduct()
                  setNavCollapsed(true)
                }}
                className="primary-action"
                disabled={isReadOnly}
              >
                <i className="fi fi-rr-box-open" aria-hidden="true"></i>
                <span>Add product</span>
              </button>
              <button
                onClick={() => {
                  openNewService()
                  setNavCollapsed(true)
                }}
                className="service-action"
                disabled={isReadOnly}
              >
                <i className="fi fi-rr-stethoscope" aria-hidden="true"></i>
                <span>Add service</span>
              </button>
            </div>
          </div>
        </div>
      </aside>

      <main className="main-workspace">
        {isReadOnly && (
          <>
            <form className="license-expired-banner" onSubmit={submitLicense}>
              <div className="license-expired-copy">
                <strong>License expired — read-only mode</strong>
                <span>You can view, search, print, and export records. Renew the license to make changes or complete sales.</span>
              </div>
              <div className="license-expired-renewal">
                <button type="button" className="license-installation-id" onClick={copyInstallationId} disabled={!installationId} title="Copy installation ID">
                  <span>Installation ID</span>
                  <strong>{installationId || 'Preparing...'}</strong>
                  <i className="fi fi-rr-copy" aria-hidden="true"></i>
                </button>
                <label>
                  <span>Renewal license</span>
                  <input
                    value={licenseInput}
                    onChange={event => {
                      setLicenseError('')
                      setLicenseInput(event.target.value.trim())
                    }}
                    placeholder="Paste SFP1 license"
                    autoComplete="off"
                    required
                  />
                </label>
                <button type="submit" className="license-renew-button" disabled={licenseBusy}>
                  {licenseBusy ? 'Checking...' : 'Renew'}
                </button>
              </div>
              {(licenseError || licenseCopied) && (
                <div className={licenseError ? 'license-banner-message error' : 'license-banner-message'}>
                  {licenseError || 'Installation ID copied'}
                </div>
              )}
            </form>
            <GcashLicenseIssuer
              compact
              installationId={installationId}
              onActivated={() => {
                setLicenseStatus({ loading: false, valid: true, reason: '' })
                setLicenseInput('')
              }}
            />
          </>
        )}
        {tab !== 'pos' && tab !== 'sales-report' && tab !== 'clients' && tab !== 'settings' && <Dashboard products={products} />}

        {tab === 'inventory' && (
          <ProductTable
            products={products}
            onEdit={openEdit}
            onDelete={requestDeleteProduct}
            onRestock={product => setRestockProduct(product)}
            onUndo={product => setUndoProduct(product)}
            readOnly={isReadOnly}
          />
        )}
        {tab === 'pos' && (
          <POS
            products={products}
            clients={clients}
            orders={orders}
            activeOrderId={activeOrderId}
            setOrders={isReadOnly ? blockReadOnlyWrite : setOrders}
            setActiveOrderId={setActiveOrderId}
            onCompleteSale={completeSale}
            receiptSettings={receiptSettings}
            onSaveClient={saveClientName}
            onEditProduct={openEdit}
            onRestockProduct={product => setRestockProduct(product)}
            readOnly={isReadOnly}
          />
        )}
        <Suspense fallback={<div className="screen-loading-state">Loading screen…</div>}>
          {tab === 'analytics' && <Analytics products={products} onApplyReorderLevels={isReadOnly ? null : applyTrendReorderLevels} />}
          {tab === 'sales-report' && (
          <SalesReport
            sales={sales}
            expenses={expenses}
            openingCashRecord={cashDrawer[currentDayKey]}
            ownerUnlocked={ownerUnlocked}
            ownerAccessPanel={renderOwnerGate()}
            onAddExpense={addExpense}
            onDeleteExpense={deleteExpense}
            onVoidSale={voidSale}
            onSetOpeningCash={setOpeningCash}
            onSetClosingCash={setClosingCash}
            readOnly={isReadOnly}
          />
          )}
          {tab === 'clients' && (
          <ClientHistory
            clients={clients}
            sales={sales}
            receiptSettings={receiptSettings}
            onDeleteClient={deleteClientName}
            readOnly={isReadOnly}
          />
          )}
          {tab === 'report' && <Report products={products} />}
          {tab === 'settings' && (
          <Settings
            receiptSettings={receiptSettings}
            categories={categories}
            products={products}
            onSaveReceiptSettings={settings => {
              if (!blockReadOnlyWrite()) setReceiptSettings(settings)
            }}
            onAddCategory={addCategory}
            onRenameCategory={renameCategory}
            onExportBackup={exportBackup}
            onImportBackup={importBackup}
            readOnly={isReadOnly}
          />
          )}
        </Suspense>
      </main>

      {modalOpen && (
        <ProductModal
          product={editProduct}
          preset={productPreset}
          products={products}
          categories={categories}
          onSave={saveProduct}
          onClose={() => { setModalOpen(false); setEditProduct(null); setProductPreset(null) }}
        />
      )}

      {restockProduct && (
        <RestockModal
          product={restockProduct}
          onSave={saveRestock}
          onClose={() => setRestockProduct(null)}
        />
      )}

      {undoProduct && (
        <UndoCountModal
          product={undoProduct}
          onUndo={saveUndo}
          onClose={() => setUndoProduct(null)}
        />
      )}

      {deleteProductTarget && (
        <div className="client-modal-backdrop">
          <div className="client-modal delete-product-modal" role="dialog" aria-modal="true" aria-labelledby="delete-product-title">
            <div className="delete-product-mark" aria-hidden="true">
              <i className="fi fi-rr-trash"></i>
            </div>
            <div>
              <span className="eyebrow">Delete product</span>
              <h3 id="delete-product-title">Remove this item?</h3>
              <p>
                <strong>{deleteProductTarget.name}</strong> will be removed from inventory. This cannot be undone from the product list.
              </p>
            </div>

            <div className="delete-product-summary">
              <span>Category</span>
              <strong>{deleteProductTarget.cat || 'Uncategorized'}</strong>
              <span>Current stock</span>
              <strong>{deleteProductTarget.trackStock === false ? 'Service' : `${deleteProductTarget.qty || 0}${deleteProductTarget.unit ? ` ${deleteProductTarget.unit}` : ''}`}</strong>
            </div>

            <div className="client-modal-actions">
              <button type="button" className="secondary-page-button" onClick={() => setDeleteProductTarget(null)}>
                Cancel
              </button>
              <button type="button" className="confirm-delete-button" onClick={confirmDeleteProduct}>
                Delete product
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteExpenseTarget && (
        <div className="client-modal-backdrop">
          <div className="client-modal delete-product-modal" role="dialog" aria-modal="true" aria-labelledby="delete-expense-title">
            <div className="delete-product-mark" aria-hidden="true">
              <i className="fi fi-rr-receipt"></i>
            </div>
            <div>
              <span className="eyebrow">Delete expense</span>
              <h3 id="delete-expense-title">Remove this expense?</h3>
              <p>This removes the expense from today&apos;s sales report.</p>
            </div>

            <div className="delete-product-summary">
              <span>Category</span>
              <strong>{deleteExpenseTarget.category || 'General'}</strong>
              <span>Amount</span>
              <strong>PHP {Number(deleteExpenseTarget.amount || 0).toFixed(2)}</strong>
            </div>

            <div className="client-modal-actions">
              <button type="button" className="secondary-page-button" onClick={() => setDeleteExpenseTarget(null)}>
                Cancel
              </button>
              <button type="button" className="confirm-delete-button" onClick={confirmDeleteExpense}>
                Delete expense
              </button>
            </div>
          </div>
        </div>
      )}

      {appNotice && (
        <div className="client-modal-backdrop">
          <div className={`client-modal app-notice-modal ${appNotice.tone || ''}`} role="dialog" aria-modal="true" aria-labelledby="app-notice-title">
            <div className="delete-product-mark" aria-hidden="true">
              <i className={`fi ${appNotice.tone === 'success' ? 'fi-rr-check' : 'fi-rr-triangle-warning'}`}></i>
            </div>
            <div>
              <span className="eyebrow">{appNotice.tone === 'success' ? 'Success' : 'Notice'}</span>
              <h3 id="app-notice-title">{appNotice.title}</h3>
              <p>{appNotice.message}</p>
            </div>
            <button type="button" className="complete-sale-button" onClick={() => setAppNotice(null)}>
              OK
            </button>
          </div>
        </div>
      )}

      {needsOpeningCash && (
        <div className="client-modal-backdrop">
          <form className="client-modal opening-cash-start-modal" onSubmit={submitOpeningCashPrompt}>
            <div>
              <span className="eyebrow">Start of shift</span>
              <h3>Check money box</h3>
              <p>Enter the cash already inside the box before using POS today. Type 0 if the box is empty.</p>
            </div>

            <label className="client-name-field">
              <span>Opening cash</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={openingCashPrompt}
                onChange={event => setOpeningCashPrompt(event.target.value)}
                placeholder="0.00"
                required
                autoFocus
              />
            </label>

            <button type="submit" className="complete-sale-button">
              Start POS
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
