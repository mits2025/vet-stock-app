import { useState } from 'react'

const PAPER_OPTIONS = [
  { value: '80', label: '80mm receipt paper' },
  { value: '58', label: '58mm receipt paper' },
]

export default function Settings({ receiptSettings, onSaveReceiptSettings, onExportBackup, onImportBackup }) {
  const [draft, setDraft] = useState(receiptSettings)
  const [saved, setSaved] = useState(false)

  function setField(field, value) {
    setSaved(false)
    setDraft(prev => ({ ...prev, [field]: value }))
  }

  function uploadLogo(event) {
    const file = event.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith('image/')) {
      alert('Please choose an image file for the receipt logo.')
      event.target.value = ''
      return
    }

    if (file.size > 500 * 1024) {
      alert('Please use an image smaller than 500KB so backups and receipts stay fast.')
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
