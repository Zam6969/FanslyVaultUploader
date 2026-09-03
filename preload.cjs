const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vaultdrop', {
  connect: (managementSession) => ipcRenderer.invoke('fansly:connect', managementSession),
  checkConnection: () => ipcRenderer.invoke('fansly:check-connection'),
  disconnect: () => ipcRenderer.invoke('fansly:disconnect'),
  loadVaultLibrary: () => ipcRenderer.invoke('vault:library'),
  repairVault: () => ipcRenderer.invoke('vault:repair'),
  chooseVideos: () => ipcRenderer.invoke('videos:choose'),
  uploadVideos: (paths) => ipcRenderer.invoke('videos:upload', paths),
  onConnection: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('fansly:connection', listener);
    return () => ipcRenderer.removeListener('fansly:connection', listener);
  },
  onProgress: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('videos:progress', listener);
    return () => ipcRenderer.removeListener('videos:progress', listener);
  },
  onVaultProgress: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('vault:progress', listener);
    return () => ipcRenderer.removeListener('vault:progress', listener);
  },
});
