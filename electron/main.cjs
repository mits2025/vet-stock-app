const { app, BrowserWindow, Menu, shell } = require('electron')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { attachUpdaterWindow, setupUpdater } = require('./updater.cjs')
const { closeStorage, setupStorage } = require('./storage.cjs')

const appUrl = pathToFileURL(path.join(__dirname, '..', 'dist', 'index.html')).toString()

function createWindow() {
  const window = new BrowserWindow({
    title: 'Vet POS',
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    backgroundColor: '#f4f7fb',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  })

  window.once('ready-to-show', () => window.show())
  attachUpdaterWindow(window)

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(appUrl)) {
      event.preventDefault()
      if (url.startsWith('https://') || url.startsWith('http://')) {
        void shell.openExternal(url)
      }
    }
  })

  void window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
}

app.setAppUserModelId('com.vetpos.desktop')

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  setupStorage()
  setupUpdater()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', closeStorage)
