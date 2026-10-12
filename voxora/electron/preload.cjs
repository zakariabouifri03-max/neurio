const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld(
  "voxora",
  Object.freeze({
    loadToken: () => ipcRenderer.invoke("vault:read"),
    saveToken: (token) => ipcRenderer.invoke("vault:write", token),
    notify: (title, body) => ipcRenderer.send("notify", title, body),
    badge: (count) => ipcRenderer.send("badge", count),
    captureSources: () => ipcRenderer.invoke("capture:list"),
    selectCapture: (id) => ipcRenderer.invoke("capture:select", id),
  }),
);
