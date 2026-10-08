import { app, BrowserWindow, Menu, shell, nativeTheme } from 'electron';
import path from 'node:path';
import { registerIpc } from './ipc';
import { settings } from './services/settings';

const isDev = process.env.NODE_ENV === 'development' || Boolean(process.env.VITE_DEV_SERVER_URL);
let mainWindow: BrowserWindow | null = null;

// Single instance: reopening the installer shortcut focuses the running app.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1540,
    height: 960,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: '#0d0d14',
    autoHideMenuBar: true,
    title: 'Lumora Studio',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
      spellcheck: false
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (isDev && devUrl) {
    void mainWindow.loadURL(devUrl);
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../dist-renderer/index.html'));
  }

  // Security: block in-app navigation and popups to arbitrary origins.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = devUrl ? [devUrl] : [];
    if (!allowed.some((a) => url.startsWith(a))) event.preventDefault();
  });
  mainWindow.webContents.session.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function buildMenu(): void {
  const send = (action: string) => () => mainWindow?.webContents.send('menu:action', action);
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        { label: 'New Design', accelerator: 'CmdOrCtrl+N', click: send('new') },
        { label: 'Open Project…', accelerator: 'CmdOrCtrl+O', click: send('open') },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: send('save') },
        { label: 'Export…', accelerator: 'CmdOrCtrl+E', click: send('export') },
        { type: 'separator' },
        { label: 'Settings', accelerator: 'CmdOrCtrl+,', click: send('settings') },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: send('undo') },
        { label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', click: send('redo') },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { label: 'Duplicate', accelerator: 'CmdOrCtrl+D', click: send('duplicate') },
        { label: 'Select All', accelerator: 'CmdOrCtrl+A', click: send('selectAll') }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Preview', accelerator: 'CmdOrCtrl+P', click: send('preview') },
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', click: send('zoomIn') },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: send('zoomOut') },
        { label: 'Fit to Screen', accelerator: 'CmdOrCtrl+0', click: send('zoomFit') },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { role: 'togglefullscreen' }
      ]
    },
    { label: 'Help', submenu: [{ label: 'About Lumora Studio', click: send('about') }] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  if (!settings.get().hardwareAcceleration) app.disableHardwareAcceleration();
  nativeTheme.themeSource = 'dark';
  registerIpc(() => mainWindow);
  buildMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

process.on('uncaughtException', (err) => {
  console.error('[lumora] uncaught exception:', err);
});
process.on('unhandledRejection', (err) => {
  console.error('[lumora] unhandled rejection:', err);
});
