const { contextBridge, ipcRenderer } = require('electron');

const api = Object.freeze({
  isDesktop: true,
  getState: () => ipcRenderer.invoke('manager:state'),
  addDownload: (options) => ipcRenderer.invoke('manager:add', options),
  pauseDownload: (id) => ipcRenderer.invoke('manager:pause', id),
  resumeDownload: (id) => ipcRenderer.invoke('manager:resume', id),
  cancelDownload: (id) => ipcRenderer.invoke('manager:cancel', id),
  removeDownload: (id) => ipcRenderer.invoke('manager:remove', id),
  pauseAll: () => ipcRenderer.invoke('manager:pause-all'),
  resumeAll: () => ipcRenderer.invoke('manager:resume-all'),
  cancelAll: () => ipcRenderer.invoke('manager:cancel-all'),
  reorderQueue: (ids) => ipcRenderer.invoke('manager:reorder', ids),
  setPriority: (id, priority) => ipcRenderer.invoke('manager:priority', { id, priority }),
  updateSettings: (settings) => ipcRenderer.invoke('manager:update-settings', settings),
  chooseDownloadFolder: () => ipcRenderer.invoke('dialog:choose-download-folder'),
  importUrls: () => ipcRenderer.invoke('dialog:import-urls'),
  openFile: (id) => ipcRenderer.invoke('shell:open-file', id),
  showInFolder: (id) => ipcRenderer.invoke('shell:show-in-folder', id),
  getLogs: (limit) => ipcRenderer.invoke('manager:logs', limit),
  exportLogs: () => ipcRenderer.invoke('dialog:export-logs'),
  installBrowserBridge: () => ipcRenderer.invoke('browser:install'),
  uninstallBrowserBridge: () => ipcRenderer.invoke('browser:uninstall'),
  openExtensionFolder: () => ipcRenderer.invoke('browser:open-extension'),
  onEvent: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('manager:event', listener);
    return () => ipcRenderer.removeListener('manager:event', listener);
  },
});

contextBridge.exposeInMainWorld('downloadManager', api);
