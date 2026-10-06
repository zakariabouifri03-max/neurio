// NEXUS GAME STUDIO — Electron desktop shell
// Wraps the NEXUS server + editor in a native desktop window with the full
// menu bar (File / Edit / Project / Build / Play / AI).
// Run with:  npm i -D electron && npx electron Electron/
const { app, BrowserWindow, Menu, dialog, shell } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

const PORT = parseInt(process.env.NEXUS_PORT || '8756', 10);
const ROOT = path.resolve(__dirname, '..');
let serverProc = null;
let win = null;

function startServer() {
  // prefer the bundled server, fall back to tsx dev server
  const bundled = path.join(ROOT, 'serverout', 'server.mjs');
  const fs = require('fs');
  if (fs.existsSync(bundled)) {
    serverProc = spawn(process.execPath, [bundled], { env: { ...process.env, NEXUS_PORT: String(PORT) }, stdio: 'inherit' });
  } else {
    serverProc = spawn('npx', ['tsx', 'Server/index.ts'], { cwd: ROOT, env: { ...process.env, NEXUS_PORT: String(PORT) }, stdio: 'inherit', shell: true });
  }
}

function waitForServer(cb, tries = 0) {
  http.get({ host: 'localhost', port: PORT, path: '/api/health', timeout: 800 }, (res) => {
    res.resume();
    cb();
  }).on('error', () => {
    if (tries > 60) { dialog.showErrorBox('NEXUS', 'Server failed to start.'); app.quit(); return; }
    setTimeout(() => waitForServer(cb, tries + 1), 500);
  });
}

function send(cmd, arg) { win?.webContents?.send(cmd, arg); }

function buildMenu() {
  const menu = Menu.buildFromTemplate([
    {
      label: 'NEXUS', submenu: [
        { label: 'About NEXUS GAME STUDIO', click: () => dialog.showMessageBox(win, { message: 'NEXUS GAME STUDIO 1.0\nAI-Powered 3D Game Development Environment', buttons: ['OK'] }) },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File', submenu: [
        { label: 'New Project…', accelerator: 'CmdOrCtrl+Shift+N', click: () => send('menu', 'project.new') },
        { label: 'Save Project', accelerator: 'CmdOrCtrl+S', click: () => send('menu', 'project.save') },
        { type: 'separator' },
        { label: 'Open Projects Folder', click: () => shell.openPath(path.join(ROOT, 'Projects')) },
      ],
    },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    {
      label: 'Project', submenu: [
        { label: 'Snapshots…', click: () => send('menu', 'project.snapshots') },
        { label: 'Refresh AI Memory', click: () => send('menu', 'ai.memory') },
      ],
    },
    { label: 'Build', submenu: [{ label: 'Build Game…', accelerator: 'CmdOrCtrl+B', click: () => send('menu', 'build.game') }] },
    { label: 'Play', submenu: [
      { label: 'Play / Stop', accelerator: 'CmdOrCtrl+P', click: () => send('menu', 'play.toggle') },
      { label: 'Pause', click: () => send('menu', 'play.pause') },
    ] },
    { label: 'AI', submenu: [
      { label: 'AI Agent Panel', click: () => send('menu', 'ai.open') },
      { label: 'AI Settings…', click: () => send('menu', 'ai.settings') },
    ] },
    { label: 'View', submenu: [
      { role: 'reload' }, { role: 'toggleDevTools' }, { role: 'togglefullscreen' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' },
    ] },
  ]);
  Menu.setApplicationMenu(menu);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1680, height: 980,
    backgroundColor: '#0b0d11',
    title: 'NEXUS GAME STUDIO',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
    },
  });
  buildMenu();
  win.loadURL(`http://localhost:${PORT}`);
  win.once('ready-to-show', () => win.maximize());
  win.on('closed', () => { win = null; });
}

app.whenReady().then(() => {
  startServer();
  waitForServer(createWindow);
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});

app.on('window-all-closed', () => {
  if (serverProc) serverProc.kill();
  app.quit();
});
