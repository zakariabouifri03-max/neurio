// NEXUS GAME STUDIO — Electron desktop shell
// Dev:    npx electron Electron/
// Packaged exe: built by Electron/package-win.mjs / GitHub Actions.
// The exe bundles the editor (www/), the server (serverout/), the standalone
// game runtime (www-runtime/) and the sample project — fully offline.
const { app, BrowserWindow, Menu, dialog, shell } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const fs = require('fs');

const PORT = parseInt(process.env.NEXUS_PORT || '8756', 10);
const ROOT = path.resolve(__dirname, '..');
let serverProc = null;
let win = null;

function startServer() {
  const bundled = path.join(ROOT, 'serverout', 'server.mjs');
  if (fs.existsSync(bundled)) {
    // Built/packaged mode: run the bundled server with this very binary
    // acting as plain Node (works for the packaged .exe as well).
    serverProc = spawn(process.execPath, [bundled], {
      env: { ...process.env, NEXUS_PORT: String(PORT), ELECTRON_RUN_AS_NODE: '1' },
      stdio: 'inherit',
    });
  } else {
    // Dev mode: tsx dev server from the source tree.
    serverProc = spawn('npx', ['tsx', 'Server/index.ts'], {
      cwd: ROOT,
      env: { ...process.env, NEXUS_PORT: String(PORT) },
      stdio: 'inherit',
      shell: true,
    });
  }
}

function waitForServer(cb, tries = 0) {
  http.get({ host: 'localhost', port: PORT, path: '/api/health', timeout: 800 }, (res) => {
    res.resume();
    cb();
  }).on('error', () => {
    if (tries > 90) { dialog.showErrorBox('NEXUS', 'The NEXUS server failed to start.'); app.quit(); return; }
    setTimeout(() => waitForServer(cb, tries + 1), 500);
  });
}

// native menu → the web app's command registry (see Editor/main.ts)
function send(cmd) { if (win && !win.isDestroyed()) win.webContents.send('menu', cmd); }

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
        { label: 'New Project…', click: () => send('project.new') },
        { label: 'Save Project', click: () => send('project.save') },
        { type: 'separator' },
        { label: 'Open Projects Folder', click: () => shell.openPath(path.join(ROOT, 'Projects')) },
      ],
    },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    {
      label: 'Project', submenu: [
        { label: 'Snapshots…', click: () => send('project.snapshots') },
        { label: 'Refresh AI Memory', click: () => send('ai.memory') },
      ],
    },
    { label: 'Build', submenu: [{ label: 'Build Game…', click: () => send('build.game') }] },
    {
      label: 'Play', submenu: [
        { label: 'Play / Stop', click: () => send('play.toggle') },
        { label: 'Pause', click: () => send('play.pause') },
      ],
    },
    {
      label: 'AI', submenu: [
        { label: 'AI Agent Panel', click: () => send('ai.open') },
        { label: 'AI Settings…', click: () => send('ai.settings') },
      ],
    },
    {
      label: 'View', submenu: [
        { role: 'reload' }, { role: 'toggleDevTools' }, { role: 'togglefullscreen' },
        { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' },
      ],
    },
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
  if (serverProc) { try { serverProc.kill(); } catch { } }
  app.quit();
});
