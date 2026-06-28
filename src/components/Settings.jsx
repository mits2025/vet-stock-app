import { useState } from 'react'

const PAPER_OPTIONS = [
  { value: '80', label: '80mm receipt paper' },
  { value: '58', label: '58mm receipt paper' },
]

export default function Settings({
  receiptSettings,
  categories = [],
  products = [],
  onSaveReceiptSettings,
  onAddCategory,
  onRenameCategory,
  onExportBackup,
  onImportBackup,
}) {
  const [draft, setDraft] = useState(receiptSettings)
  const [saved, setSaved] = useState(false)
  const [warning, setWarning] = useState('')
  const [categorySaved, setCategorySaved] = useState('')
  const [newCategory, setNewCategory] = useState('')
  const [selectedCategory, setSelectedCategory] = useState(categories[0] || '')
  const [renameDraft, setRenameDraft] = useState(categories[0] || '')

  function setField(field, value) {
    setSaved(false)
    setWarning('')
    setDraft(prev => ({ ...prev, [field]: value }))
  }

  function uploadLogo(event) {
    const file = event.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith('image/')) {
      setWarning('Please choose an image file for the receipt logo.')
      event.target.value = ''
      return
    }

    if (file.size > 500 * 1024) {
      setWarning('Please use an image smaller than 500KB so backups and receipts stay fast.')
      event.target.value = ''
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      setField('logo', String(reader.result || ''))
      event.target.value = ''
    }
    reader.readAsDataURL(file)
  }

  function submitSettings(event) {
    event.preventDefault()
    onSaveReceiptSettings({
      clinicName: draft.clinicName.trim() || 'Vet POS',
      address: draft.address.trim(),
      phone: draft.phone.trim(),
      tin: draft.tin.trim(),
      email: draft.email.trim(),
      footer: draft.footer.trim() || 'Thank you for your visit.',
      paperWidth: draft.paperWidth === '58' ? '58' : '80',
      logo: draft.logo || '',
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 2200)
  }

  function submitNewCategory(event) {
    event.preventDefault()
    const cleanName = newCategory.trim()
    if (!cleanName) {
      setWarning('Enter a category name before adding it.')
      return
    }
    const added = onAddCategory?.(cleanName)
    if (!added) {
      setWarning('That category already exists.')
      return
    }
    setNewCategory('')
    setCategorySaved('Category added')
    setTimeout(() => setCategorySaved(''), 2200)
  }

  function submitRenameCategory(event) {
    event.preventDefault()
    if (!selectedCategory) {
      setWarning('Choose a category to rename.')
      return
    }
    const cleanName = renameDraft.trim()
    if (!cleanName) {
      setWarning('Enter the new category name.')
      return
    }
    const renamed = onRenameCategory?.(selectedCategory, cleanName)
    if (!renamed) {
      setWarning('That category name already exists.')
      return
    }
    setSelectedCategory(cleanName)
    setRenameDraft(cleanName)
    setCategorySaved('Category renamed')
    setTimeout(() => setCategorySaved(''), 2200)
  }

  const categoryUsage = categories.reduce((map, category) => ({
    ...map,
    [category]: products.filter(product => product.cat === category).length,
  }), {})

  return (
    <div className="settings-page">
      <section className="sales-report-header">
        <div>
          <span className="eyebrow">App setup</span>
          <h3>Settings</h3>
          <p>Edit the clinic details printed on every receipt.</p>
        </div>
      </section>

      <form className="settings-panel" onSubmit={submitSettings}>
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Receipt info</span>
            <h4>Printed receipt details</h4>
          </div>
          {saved && <span className="settings-saved">Saved</span>}
        </div>

        {warning && (
          <div className="modal-friendly-alert" role="alert">
            <i className="fi fi-rr-triangle-warning" aria-hidden="true"></i>
            <span>{warning}</span>
          </div>
        )}

        <div className="settings-form-grid">
          <label>
            Clinic name
            <input
              value={draft.clinicName}
              onChange={event => setField('clinicName', event.target.value)}
              placeholder="Clinic name"
            />
          </label>

          <label>
            Contact number
            <input
              value={draft.phone}
              onChange={event => setField('phone', event.target.value)}
              placeholder="Phone or mobile number"
            />
          </label>

          <label>
            TIN / Business ID
            <input
              value={draft.tin}
              onChange={event => setField('tin', event.target.value)}
              placeholder="Optional"
            />
          </label>

          <label>
            Email
            <input
              value={draft.email}
              onChange={event => setField('email', event.target.value)}
              placeholder="Optional"
            />
          </label>

          <label className="settings-wide-field">
            Address
            <textarea
              value={draft.address}
              onChange={event => setField('address', event.target.value)}
              placeholder="Clinic address"
              rows="3"
            />
          </label>

          <label className="settings-wide-field">
            Receipt footer
            <input
              value={draft.footer}
              onChange={event => setField('footer', event.target.value)}
              placeholder="Thank you message"
            />
          </label>

          <label>
            Paper width
            <select value={draft.paperWidth} onChange={event => setField('paperWidth', event.target.value)}>
              {PAPER_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          <div className="settings-wide-field receipt-logo-field">
            <div>
              <span>Receipt logo</span>
              <small>Use a simple black and white image for best thermal printing.</small>
            </div>
            {draft.logo ? (
              <div className="receipt-logo-preview">
                <img src={draft.logo} alt="Receipt logo preview" />
                <button type="button" onClick={() => setField('logo', '')}>Remove logo</button>
              </div>
            ) : (
              <span className="receipt-logo-empty">No logo selected</span>
            )}
            <label className="settings-backup-button import receipt-logo-upload">
              <i className="fi fi-rr-picture" aria-hidden="true"></i>
              <span>Upload logo</span>
              <input type="file" accept="image/*" onChange={uploadLogo} hidden />
            </label>
          </div>
        </div>

        <button type="submit" className="complete-sale-button settings-save-button">
          Save receipt settings
        </button>
      </form>

      <section className="settings-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Product categories</span>
            <h4>Manage category names</h4>
          </div>
          {categorySaved && <span className="settings-saved">{categorySaved}</span>}
        </div>

        <div className="category-settings-grid">
          <form className="category-settings-card" onSubmit={submitNewCategory}>
            <label>
              Add category
              <input
                value={newCategory}
                onChange={event => {
                  setWarning('')
                  setNewCategory(event.target.value)
                }}
                placeholder="New category name"
              />
            </label>
            <button type="submit" className="settings-backup-button export">Add category</button>
          </form>

          <form className="category-settings-card" onSubmit={submitRenameCategory}>
            <label>
              Category to edit
              <select
                value={selectedCategory}
                onChange={event => {
                  setWarning('')
                  setSelectedCategory(event.target.value)
                  setRenameDraft(event.target.value)
                }}
              >
                {categories.map(category => (
                  <option key={category} value={category}>
                    {category} ({categoryUsage[category] || 0})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Rename to
              <input
                value={renameDraft}
                onChange={event => {
                  setWarning('')
                  setRenameDraft(event.target.value)
                }}
                placeholder="Updated category name"
              />
            </label>
            <button type="submit" className="settings-backup-button import">Save category name</button>
          </form>
        </div>
      </section>

      <section className="settings-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Backup data</span>
            <h4>Export or restore app records</h4>
          </div>
        </div>

        <div className="settings-backup-row">
          <button type="button" className="settings-backup-button export" onClick={onExportBackup}>
            <i className="fi fi-rr-download" aria-hidden="true"></i>
            <span>Export backup</span>
          </button>
          <label className="settings-backup-button import">
            <i className="fi fi-rr-upload" aria-hidden="true"></i>
            <span>Import backup</span>
            <input type="file" accept=".json" onChange={onImportBackup} hidden />
          </label>
        </div>
      </section>
    </div>
  )
}
