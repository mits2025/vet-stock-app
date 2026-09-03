const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('vetPosUpdater', {
  getState: () => ipcRenderer.invoke('updater:get-state'),
  check: () => ipcRenderer.invoke('updater:check'),
  download: () => ipcRenderer.invoke('updater:download'),
  install: () => ipcRenderer.invoke('updater:install'),
  onState: callback => {
    const listener = (_event, state) => callback(state)
    ipcRenderer.on('updater:state', listener)
    return () => ipcRenderer.removeListener('updater:state', listener)
  },
})

contextBridge.exposeInMainWorld('vetPosStorage', {
  loadSnapshot: () => ipcRenderer.invoke('storage:load-snapshot'),
  saveSnapshot: snapshot => ipcRenderer.invoke('storage:save-snapshot', snapshot),
})
