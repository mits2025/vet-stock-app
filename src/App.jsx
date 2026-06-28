import { useEffect, useState } from 'react'
import Dashboard from './components/Dashboard'
import ProductTable from './components/ProductTable'
import ProductModal from './components/ProductModal'
import RestockModal from './components/RestockModal'
import UndoCountModal from './components/UndoCountModal'
import Analytics from './components/Analytics'
import Report from './components/Report'
import POS from './components/POS'
import SalesReport from './components/SalesReport'
import ClientHistory from './components/ClientHistory'
import Settings from './components/Settings'
import { DEFAULT_CATEGORIES, DEFAULT_RECEIPT_SETTINGS, loadClinicRecords, loadClinicRecordsAsync, saveClinicRecordsAsync } from './utils/storage'
import {
  activateLicense,
  getInstallationId,
  verifySavedLicense,
} from './utils/license'

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

function todayKey() {
  const date = new Date()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function createSalt() {
  const values = new Uint8Array(16)
  crypto.getRandomValues(values)
  return Array.from(values, value => value.toString(16).padStart(2, '0')).join('')
}

async function hashPassword(password, salt) {
  const encoded = new TextEncoder().encode(`${salt}:${password}`)
  const digest = await crypto.subtle.digest('SHA-256', encoded)
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('')
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
  const [orders, setOrders] = useState([])
  const [activeOrderId, setActiveOrderId] = useState('')
  const [passwordRecord, setPasswordRecord] = useState(() => {
    const saved = localStorage.getItem(PASSWORD_KEY)
    return saved ? JSON.parse(saved) : null
  })
  const [ownerPasswordRecord, setOwnerPasswordRecord] = useState(() => {
    const saved = localStorage.getItem(OWNER_PASSWORD_KEY)
    return saved ? JSON.parse(saved) : null
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
  const needsOpeningCash = tab === 'pos' && !cashDrawer[currentDayKey]
  const isActivated = licenseStatus.valid

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
    if (!storageReady) return
    saveClinicRecordsAsync({ products, sales, clients, expenses, cashDrawer, categories, receiptSettings })
      .catch(() => {
        setAppNotice({
          title: 'Storage warning',
          message: 'SQLite save failed. Backup local storage was still updated.',
          tone: 'warning',
        })
      })
  }, [products, sales, clients, expenses, cashDrawer, categories, receiptSettings, storageReady])

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
    setProducts(prev => prev.map(product => product.id === data.id ? data : product))
    setRestockProduct(null)
  }

  function saveUndo(data) {
    setProducts(prev => prev.map(product => product.id === data.id ? data : product))
    setUndoProduct(null)
  }

  function applyTrendReorderLevels(updates) {
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
    const cleanName = name.trim()
    if (!cleanName) return

    setClients(prev => {
      const existing = prev.find(client => client.name.toLowerCase() === cleanName.toLowerCase())
      if (existing) {
        return prev.map(client => client.id === existing.id
          ? { ...client, name: cleanName, lastUsedAt: new Date().toISOString() }
          : client
        )
      }

      return [
        {
          id: Date.now(),
          name: cleanName,
          createdAt: new Date().toISOString(),
          lastUsedAt: new Date().toISOString(),
        },
        ...prev,
      ]
    })
  }

  function deleteClientName(name) {
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

  function completeSale({
    items,
    paymentMethod,
    payments = [],
    pendingBalance = 0,
    cashReceived = 0,
    changeDue = 0,
    discount,
    clientName,
  }) {
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
    if (sale.clientName) saveClientName(sale.clientName)
    const soldById = items.reduce((map, item) => {
      map[item.productId] = (map[item.productId] || 0) + item.qty
      return map
    }, {})
    const consumedById = items.reduce((map, item) => {
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
          sold: (Number(product.sold) || 0) + soldQty,
        }
      }

      const qtyBefore = Number(product.qty) || 0
      const usedQty = soldQty + consumedQty
      const qtyAfter = Math.max(0, qtyBefore - usedQty)
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
    }))
    setSales(prev => [sale, ...prev])
    return sale
  }

  function addExpense(expense) {
    setExpenses(prev => [
      {
        id: Date.now(),
        date: expense.date || new Date().toISOString().slice(0, 10),
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
    const expense = expenses.find(item => item.id === id)
    if (expense) setDeleteExpenseTarget(expense)
  }

  function confirmDeleteExpense() {
    if (!deleteExpenseTarget) return
    setExpenses(prev => prev.filter(expense => expense.id !== deleteExpenseTarget.id))
    setDeleteExpenseTarget(null)
  }

  function setOpeningCash(amount) {
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
    setDeleteProductTarget(product)
  }

  function confirmDeleteProduct() {
    if (!deleteProductTarget) return
    setProducts(prev => prev.filter(product => product.id !== deleteProductTarget.id))
    setDeleteProductTarget(null)
  }

  function addCategory(name) {
    const cleanName = name.trim()
    if (!cleanName) return false
    const exists = categories.some(category => category.toLowerCase() === cleanName.toLowerCase())
    if (exists) return false
    setCategories(prev => [...prev, cleanName].sort())
    return true
  }

  function renameCategory(oldName, nextName) {
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
    setProductPreset(null)
    setEditProduct(product)
    setModalOpen(true)
  }

  function openNewProduct() {
    setProductPreset(null)
    setEditProduct(null)
    setModalOpen(true)
  }

  function openNewService() {
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
    const data = JSON.stringify({ products, sales, clients, expenses, cashDrawer, categories, receiptSettings }, null, 2)
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `vet-pos-backup-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  function importBackup(event) {
    const file = event.target.files[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = evt => {
      try {
        const imported = JSON.parse(evt.target.result)
        if (Array.isArray(imported)) {
          setProducts(imported)
          setCategories([...new Set([...DEFAULT_CATEGORIES, ...imported.map(product => product.cat).filter(Boolean)])].sort())
          setAppNotice({ title: 'Backup imported', message: `Successfully imported ${imported.length} products.`, tone: 'success' })
        } else if (Array.isArray(imported.products)) {
          setProducts(imported.products)
          setSales(Array.isArray(imported.sales) ? imported.sales : [])
          setClients(Array.isArray(imported.clients) ? imported.clients : [])
          setExpenses(Array.isArray(imported.expenses) ? imported.expenses : [])
          setCashDrawer(imported.cashDrawer && typeof imported.cashDrawer === 'object' ? imported.cashDrawer : {})
          setCategories([
            ...new Set([
              ...DEFAULT_CATEGORIES,
              ...(Array.isArray(imported.categories) ? imported.categories : []),
              ...imported.products.map(product => product.cat).filter(Boolean),
            ]),
          ].sort())
          setReceiptSettings(imported.receiptSettings && typeof imported.receiptSettings === 'object'
            ? { ...DEFAULT_RECEIPT_SETTINGS, ...imported.receiptSettings }
            : DEFAULT_RECEIPT_SETTINGS
          )
          setAppNotice({
            title: 'Backup imported',
            message: `Imported ${imported.products.length} products, ${Array.isArray(imported.sales) ? imported.sales.length : 0} sales, ${Array.isArray(imported.clients) ? imported.clients.length : 0} clients, ${Array.isArray(imported.expenses) ? imported.expenses.length : 0} expenses, and cash drawer records.`,
            tone: 'success',
          })
        } else {
          setAppNotice({ title: 'Invalid backup file', message: 'Please use a valid backup JSON file.', tone: 'warning' })
        }
      } catch {
        setAppNotice({ title: 'Import failed', message: 'Could not read file. Make sure it is a valid JSON backup.', tone: 'warning' })
      }
    }
    reader.readAsText(file)
    event.target.value = ''
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

    if (password.length < 4) {
      setAuthError('Use at least 4 characters for the app password.')
      return
    }

    if (password !== setupConfirm.trim()) {
      setAuthError('The passwords do not match.')
      return
    }

    setAuthBusy(true)
    setAuthError('')

    try {
      const salt = createSalt()
      const record = {
        salt,
        hash: await hashPassword(password, salt),
        createdAt: new Date().toISOString(),
      }
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

    setAuthBusy(true)
    setAuthError('')

    try {
      const hash = await hashPassword(unlockPassword, passwordRecord.salt)
      if (hash !== passwordRecord.hash) {
        setAuthError('Incorrect password.')
        setUnlockPassword('')
        return
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

    if (password.length < 4) {
      setOwnerAuthError('Use at least 4 characters for the owner password.')
      return
    }

    if (password !== ownerSetupConfirm.trim()) {
      setOwnerAuthError('The passwords do not match.')
      return
    }

    setOwnerAuthBusy(true)
    setOwnerAuthError('')

    try {
      const salt = createSalt()
      const record = {
        salt,
        hash: await hashPassword(password, salt),
        createdAt: new Date().toISOString(),
      }
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

    setOwnerAuthBusy(true)
    setOwnerAuthError('')

    try {
      const hash = await hashPassword(ownerPassword, ownerPasswordRecord.salt)
      if (hash !== ownerPasswordRecord.hash) {
        setOwnerAuthError('Incorrect owner password.')
        setOwnerPassword('')
        return
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
              minLength={isSetup ? 4 : undefined}
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
                minLength="4"
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

  if (licenseStatus.loading) {
    return (
      <main className="app-lock-screen">
        <div className="app-lock-card activation-card">
          <div className="app-lock-brand">
            <div className="brand-mark">SF</div>
            <div>
              <span className="eyebrow">App activation</span>
              <h1>Checking license</h1>
              <p>Please wait while StockFlow POS verifies this installation.</p>
            </div>
          </div>
        </div>
      </main>
    )
  }

  if (!isActivated) {
    return (
      <main className="app-lock-screen">
        <form className="app-lock-card activation-card" onSubmit={submitLicense}>
          <div className="app-lock-brand">
            <div className="brand-mark">SF</div>
            <div>
              <span className="eyebrow">App activation</span>
              <h1>Activate this device</h1>
              <p>Send this installation ID to the license issuer, then paste the signed license below.</p>
            </div>
          </div>

          <div className="activation-code-box">
            <span>Installation ID</span>
            <strong>{installationId || 'Preparing...'}</strong>
            <button type="button" className="secondary-page-button" onClick={copyInstallationId} disabled={!installationId}>
              {licenseCopied ? 'Copied' : 'Copy ID'}
            </button>
          </div>

          <label className="client-name-field">
            <span>License code</span>
            <input
              value={licenseInput}
              onChange={event => {
                setLicenseError('')
                setLicenseInput(event.target.value.trim())
              }}
              placeholder="Paste SFP1 license"
              autoComplete="off"
              required
              autoFocus
            />
          </label>

          {(licenseError || licenseStatus.reason) && (
            <div className="app-lock-error">{licenseError || licenseStatus.reason}</div>
          )}

          <button type="submit" className="complete-sale-button" disabled={licenseBusy}>
            {licenseBusy ? 'Checking license...' : 'Activate app'}
          </button>
        </form>
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
              minLength={isSetup ? 4 : undefined}
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
                minLength="4"
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
    <div className={navCollapsed ? 'app-shell nav-collapsed' : 'app-shell'}>
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
              >
                <i className="fi fi-rr-stethoscope" aria-hidden="true"></i>
                <span>Add service</span>
              </button>
            </div>
          </div>
        </div>
      </aside>

      <main className="main-workspace">
        {tab !== 'pos' && tab !== 'sales-report' && tab !== 'clients' && tab !== 'settings' && <Dashboard products={products} />}

        {tab === 'inventory' && (
          <ProductTable
            products={products}
            onEdit={openEdit}
            onDelete={requestDeleteProduct}
            onRestock={product => setRestockProduct(product)}
            onUndo={product => setUndoProduct(product)}
          />
        )}
        {tab === 'pos' && (
          <POS
            products={products}
            clients={clients}
            orders={orders}
            activeOrderId={activeOrderId}
            setOrders={setOrders}
            setActiveOrderId={setActiveOrderId}
            onCompleteSale={completeSale}
            receiptSettings={receiptSettings}
            onSaveClient={saveClientName}
            onEditProduct={openEdit}
            onRestockProduct={product => setRestockProduct(product)}
          />
        )}
        {tab === 'analytics' && <Analytics products={products} onApplyReorderLevels={applyTrendReorderLevels} />}
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
          />
        )}
        {tab === 'clients' && (
          <ClientHistory
            clients={clients}
            sales={sales}
            receiptSettings={receiptSettings}
            onDeleteClient={deleteClientName}
          />
        )}
        {tab === 'report' && <Report products={products} />}
        {tab === 'settings' && (
          <Settings
            receiptSettings={receiptSettings}
            categories={categories}
            products={products}
            onSaveReceiptSettings={setReceiptSettings}
            onAddCategory={addCategory}
            onRenameCategory={renameCategory}
            onExportBackup={exportBackup}
            onImportBackup={importBackup}
          />
        )}
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
