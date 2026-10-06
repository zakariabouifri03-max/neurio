'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const invoke = (channel, args) => ipcRenderer.invoke(channel, args || {});
const listeners = {};
const api = {
  invoke,
  on(channel, fn) { const wrapped = (_, data) => fn(data); listeners[channel] = listeners[channel] || []; listeners[channel].push({ fn, wrapped }); ipcRenderer.on(channel, wrapped); return () => ipcRenderer.removeListener(channel, wrapped); },
  off(channel, fn) { for (const x of listeners[channel] || []) if (!fn || x.fn === fn) ipcRenderer.removeListener(channel, x.wrapped); },
};
contextBridge.exposeInMainWorld('neurio', api);
