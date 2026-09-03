const { app, ipcMain, shell } = require('electron')
const crypto = require('node:crypto')
const fs = require('node:fs/promises')
const fsSync = require('node:fs')
const path = require('node:path')
const { isNewerVersion } = require('./update-utils.cjs')

const GITHUB_REPOSITORY = 'mits2025/vet-stock-app'
const GITHUB_RELEASE_API = `https://api.github.com/repos/${GITHUB_REPOSITORY}/releases/latest`
const bundledPublicKeyPath = path.join(__dirname, 'update-public-key.pem')
const bundledPublisherPath = path.join(__dirname, 'update-publisher.txt')
const UPDATE_PUBLIC_KEY_PEM = (fsSync.existsSync(bundledPublicKeyPath)
  ? fsSync.readFileSync(bundledPublicKeyPath, 'utf8')
  : `${process.env.VET_POS_UPDATE_PUBLIC_KEY_PEM || ''}`.replace(/\\n/g, '\n')).trim()
const EXPECTED_WINDOWS_PUBLISHER = (fsSync.existsSync(bundledPublisherPath)
  ? fsSync.readFileSync(bundledPublisherPath, 'utf8')
  : `${process.env.VET_POS_UPDATE_PUBLISHER || ''}`).trim()
let updateWindow = null
let release = null
let installerPath = ''
let state = {
  status: 'idle',
  currentVersion: app.getVersion(),
  latestVersion: '',
  progress: 0,
  releaseNotes: '',
  message: 'Check for updates to get the latest Vet POS version.',
}

function publish(patch) {
  state = { ...state, ...patch }
  if (updateWindow && !updateWindow.isDestroyed()) updateWindow.webContents.send('updater:state', state)
  return state
}

async function checkForUpdates() {
  publish({ status: 'checking', progress: 0, message: 'Checking for updates…' })
  try {
    const response = await fetch(GITHUB_RELEASE_API, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Vet-POS-Updater',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })
    if (response.status === 404) throw new Error('No published GitHub release was found for Vet POS.')
    if (!response.ok) throw new Error(`GitHub returned ${response.status} while checking for updates.`)
    const body = await response.json()
    const version = `${body.tag_name || ''}`.trim().replace(/^v/i, '')
    const expectedName = `Vet-POS-Setup-${version}.exe`
    const asset = body.assets?.find(item => item.name === expectedName)
      || body.assets?.find(item => /^Vet-POS-Setup-.*\.exe$/i.test(item.name))
    if (!version || !asset) throw new Error('The latest GitHub release does not contain a Vet POS Windows installer.')
    if (!UPDATE_PUBLIC_KEY_PEM) throw new Error('Secure updates are not configured with a pinned metadata public key.')
    const metadataAsset = body.assets?.find(item => item.name === `Vet-POS-Update-${version}.json`)
    const signatureAsset = body.assets?.find(item => item.name === `Vet-POS-Update-${version}.json.sig`)
    if (!metadataAsset || !signatureAsset) throw new Error('The release is missing signed update metadata.')
    const [metadataResponse, signatureResponse] = await Promise.all([
      fetch(metadataAsset.browser_download_url),
      fetch(signatureAsset.browser_download_url),
    ])
    if (!metadataResponse.ok || !signatureResponse.ok) throw new Error('Signed update metadata could not be downloaded.')
    const metadataBytes = Buffer.from(await metadataResponse.arrayBuffer())
    const signature = Buffer.from((await signatureResponse.text()).trim(), 'base64')
    if (!crypto.verify(null, metadataBytes, UPDATE_PUBLIC_KEY_PEM, signature)) {
      throw new Error('The update metadata signature is invalid.')
    }
    const metadata = JSON.parse(metadataBytes.toString('utf8'))
    if (metadata.version !== version || metadata.installer !== asset.name || !/^[a-f0-9]{64}$/i.test(metadata.sha256 || '')) {
      throw new Error('The signed update metadata does not match this release.')
    }
    release = {
      version,
      downloadUrl: asset.browser_download_url,
      sha256: metadata.sha256,
      sizeBytes: asset.size,
      releaseNotes: body.body || '',
    }
    if (!release || !isNewerVersion(release.version, app.getVersion())) {
      return publish({
        status: 'up-to-date',
        latestVersion: release?.version || app.getVersion(),
        releaseNotes: release?.releaseNotes || '',
        message: 'Vet POS is up to date.',
      })
    }
    const download = new URL(release.downloadUrl)
    if (download.protocol !== 'https:' || download.hostname !== 'github.com'
      || !download.pathname.startsWith(`/${GITHUB_REPOSITORY}/releases/download/`)) {
      throw new Error('The update download address is not trusted.')
    }
    if (!/^[a-f0-9]{64}$/i.test(release.sha256 || '')) throw new Error('The update checksum is invalid.')
    return publish({
      status: 'available',
      latestVersion: release.version,
      releaseNotes: release.releaseNotes || '',
      message: `Vet POS ${release.version} is available.`,
    })
  } catch (error) {
    return publish({ status: 'error', message: error.message || 'Could not check for updates.' })
  }
}

async function downloadUpdate() {
  if (!release || !isNewerVersion(release.version, app.getVersion())) await checkForUpdates()
  if (!release || state.status === 'error' || !isNewerVersion(release.version, app.getVersion())) return state

  publish({ status: 'downloading', progress: 0, message: `Downloading Vet POS ${release.version}…` })
  const updateDirectory = path.join(app.getPath('temp'), 'vet-pos-updates')
  const partialPath = path.join(updateDirectory, `Vet-POS-Setup-${release.version}.exe.download`)
  const finalPath = path.join(updateDirectory, `Vet-POS-Setup-${release.version}.exe`)
  try {
    await fs.mkdir(updateDirectory, { recursive: true })
    const response = await fetch(release.downloadUrl)
    if (!response.ok || !response.body) throw new Error(`Update download returned ${response.status}.`)
    const expectedLength = Number(response.headers.get('content-length') || release.sizeBytes || 0)
    const reader = response.body.getReader()
    const file = await fs.open(partialPath, 'w')
    const hash = crypto.createHash('sha256')
    let downloaded = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = Buffer.from(value)
        await file.write(chunk)
        hash.update(chunk)
        downloaded += chunk.length
        const progress = expectedLength ? Math.min(99, Math.round((downloaded / expectedLength) * 100)) : 0
        publish({ progress })
      }
    } finally {
      await file.close()
    }
    if (hash.digest('hex').toLowerCase() !== release.sha256.toLowerCase()) {
      await fs.rm(partialPath, { force: true })
      throw new Error('The downloaded update failed its security check.')
    }
    await fs.rm(finalPath, { force: true })
    await fs.rename(partialPath, finalPath)
    installerPath = finalPath
    return publish({ status: 'downloaded', progress: 100, message: 'Update downloaded. Restart Vet POS to install it.' })
  } catch (error) {
    await fs.rm(partialPath, { force: true }).catch(() => {})
    return publish({ status: 'error', message: error.message || 'Could not download the update.' })
  }
}

async function installUpdate() {
  if (!installerPath) return publish({ status: 'error', message: 'Download the update before installing it.' })
  if (!EXPECTED_WINDOWS_PUBLISHER) {
    return publish({ status: 'error', message: 'Secure updates are not configured with the expected Windows publisher.' })
  }
  const { execFile } = require('node:child_process')
  const publisher = await new Promise((resolve, reject) => {
    const script = `$s=Get-AuthenticodeSignature -LiteralPath $args[0]; if($s.Status -ne 'Valid'){exit 2}; $s.SignerCertificate.Subject`
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script, installerPath], { windowsHide: true }, (error, stdout) => {
      if (error) reject(new Error('The installer does not have a valid Windows signature.'))
      else resolve(stdout.trim())
    })
  }).catch(error => {
    publish({ status: 'error', message: error.message })
    return ''
  })
  if (!publisher) return state
  if (!publisher.toLowerCase().includes(EXPECTED_WINDOWS_PUBLISHER.toLowerCase())) {
    return publish({ status: 'error', message: 'The installer publisher does not match the trusted Vet POS publisher.' })
  }
  const errorMessage = await shell.openPath(installerPath)
  if (errorMessage) return publish({ status: 'error', message: errorMessage })
  setTimeout(() => app.quit(), 700)
  return publish({ status: 'installing', message: 'Opening the Vet POS installer…' })
}

function setupUpdater() {
  ipcMain.handle('updater:get-state', () => state)
  ipcMain.handle('updater:check', checkForUpdates)
  ipcMain.handle('updater:download', downloadUpdate)
  ipcMain.handle('updater:install', installUpdate)
}

function attachUpdaterWindow(window) {
  updateWindow = window
}

module.exports = { attachUpdaterWindow, setupUpdater }
