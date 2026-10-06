const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('nexusDesktop', {
  isDesktop: true,
  onMenu: (fn) => ipcRenderer.on('menu', (_e, cmd) => fn(cmd)),
});
