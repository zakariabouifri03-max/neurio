const { contextBridge, ipcRenderer } = require('electron');
const listeners = new Set();

ipcRenderer.on('aidmp:event', (_event, payload) => {
  for (const listener of listeners) {
    try { listener(payload); } catch { /* isolate renderer listeners */ }
  }
});

contextBridge.exposeInMainWorld('aidmp', Object.freeze({
  invoke: (action, payload = {}) => ipcRenderer.invoke('aidmp:invoke', { action, payload }),
  onEvent: listener => {
    if (typeof listener !== 'function') return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  platform: process.platform,
}));
