"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("animaiDesktop", {
  isDesktop: true,
  userDataPath: () => ipcRenderer.invoke("animai:userDataPath"),
  saveDialog: (opts) => ipcRenderer.invoke("animai:saveDialog", opts),
  openDialog: (opts) => ipcRenderer.invoke("animai:openDialog", opts),
  writeFile: (filePath, data, encoding) =>
    ipcRenderer.invoke("animai:writeFile", filePath, data, encoding),
  readFile: (filePath, encoding) => ipcRenderer.invoke("animai:readFile", filePath, encoding),
  writeAutosave: (dataBase64) => ipcRenderer.invoke("animai:writeAutosave", dataBase64),
  readAutosave: () => ipcRenderer.invoke("animai:readAutosave"),
  appendLog: (line) => ipcRenderer.invoke("animai:appendLog", line),
  openPath: (p) => ipcRenderer.invoke("animai:openPath", p),
});
