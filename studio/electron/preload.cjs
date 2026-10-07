// Minimal, sandboxed bridge: the web app only needs to know it runs inside the desktop shell.
const { contextBridge } = require('electron');
contextBridge.exposeInMainWorld('neurioDesktop', { platform: process.platform, versions: { electron: process.versions.electron, chrome: process.versions.chrome } });
