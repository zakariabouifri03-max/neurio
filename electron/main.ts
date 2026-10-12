/**
 * Electron main process.
 *
 * Responsibilities:
 *   • start (or attach to) the local Neurio server,
 *   • open the desktop window that loads the renderer,
 *   • tray icon, taskbar badge, native notifications, "save attachment",
 *     run-at-login and window-state persistence.
 *
 * Everything stays on this machine. The only network traffic is what the user
 * causes (messages to their own server, WebRTC media between call peers).
 */
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, shell, Tray, session } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fork, type ChildProcess } from 'node:child_process';

const isDev = !app.isPackaged;
const DEV_SERVER_URL = process.env.NEURIO_DEV_URL ?? 'http://127.0.0.1:5173';
const DEV_API_PORT = Number(process.env.NEURIO_PORT ?? 8790);

interface ServerInfo {
  url: string;
  port: number;
  child: ChildProcess | null;
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let serverInfo: ServerInfo | null = null;
let quitting = false;
let unreadCount = 0;

/** ------------------------------------------------------------------ */
/** server                                                             */
/** ------------------------------------------------------------------ */

function serverEntryPath(): string {
  // Production: bundled next to the Electron main file.
  const bundled = join(__dirname, '..', 'server', 'index.cjs');
  if (existsSync(bundled)) return bundled;
  // Development fallback: run the TypeScript entry through tsx.
  return join(__dirname, '..', '..', 'server', 'index.ts');
}

function startServer(): Promise<ServerInfo> {
  return new Promise((resolve, reject) => {
    const dataDir = app.getPath('userData');
    const port = String(DEV_API_PORT);
    const args = [
      '--port', port,
      '--host', '127.0.0.1',
      '--data-dir', dataDir,
      '--log-level', isDev ? 'debug' : 'info',
    ];

    if (process.env.NEURIO_SERVER_URL) {
      // Attach to an already-running self-hosted server instead of starting one.
      resolve({ url: process.env.NEURIO_SERVER_URL, port: Number(new URL(process.env.NEURIO_SERVER_URL).port || 80), child: null });
      return;
    }

    const entry = serverEntryPath();
    const useTsx = entry.endsWith('.ts');
    const command = useTsx ? join(__dirname, '..', '..', 'node_modules', 'tsx', 'dist', 'cli.mjs') : entry;
    const child = fork(command, useTsx ? [entry, ...args] : args, {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: { ...process.env, NEURIO_EMBEDDED: '1' },
      execPath: useTsx ? process.execPath : undefined,
      silent: true,
    });

    let settled = false;
    const readyTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ url: `http://127.0.0.1:${port}`, port: Number(port), child });
    }, 6000);

    const onData = (chunk: Buffer): void => {
      const text = chunk.toString();
      if (isDev) process.stdout.write(`[server] ${text}`);
      if (!settled && /listening on/.test(text)) {
        settled = true;
        clearTimeout(readyTimer);
        resolve({ url: `http://127.0.0.1:${port}`, port: Number(port), child });
      }
    };

    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('exit', (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(readyTimer);
        reject(new Error(`Neurio server exited with code ${code}`));
      }
    });
  });
}

/** ------------------------------------------------------------------ */
/** window                                                             */
/** ------------------------------------------------------------------ */

function createWindow(url: string): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 940,
    minHeight: 600,
    backgroundColor: '#1a1b1e',
    title: 'Neurio',
    autoHideMenuBar: true,
    icon: join(__dirname, '..', '..', 'build', 'icon.ico'),
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: true,
    },
  });

  window.once('ready-to-show', () => window.show());

  const target = isDev && !process.env.NEURIO_LOAD_LOCAL ? DEV_SERVER_URL : url;
  void window.loadURL(target);

  if (isDev && !process.env.NEURIO_LOAD_LOCAL) {
    window.webContents.openDevTools({ mode: 'detach' });
  }

  window.webContents.setWindowOpenHandler(({ url: external }) => {
    void shell.openExternal(external);
    return { action: 'deny' };
  });

  window.on('close', (event) => {
    if (!quitting && process.env.NEURIO_CLOSE_TO_TRAY !== '0') {
      event.preventDefault();
      window.hide();
      return;
    }
    mainWindow = null;
  });

  return window;
}

function createTray(url: string): void {
  const iconPath = join(__dirname, '..', '..', 'build', 'icon.ico');
  const image = existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();
  tray = new Tray(image.isEmpty() ? nativeImage.createFromDataURL(FALLBACK_ICON) : image);
  tray.setToolTip('Neurio');
  tray.on('click', () => {
    mainWindow?.show();
  });
  refreshTrayMenu(url);
}

const FALLBACK_ICON =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAaUlEQVR42mNgGAWjYBSMglEwCkbBKBgFo2AUjIJRMApGwSgYBaNgFIyCUTAKRsEoGAWjYBSMglEwCkbBKBgFo2AUjIJRMApGwSgYBaNgFIyCUTAKRsEoGAWjYBSMglEwCkbBKBgFwwYAAAcuAAG0m5KcAAAAAElFTkSuQmCC';

function refreshTrayMenu(url: string): void {
  if (!tray) return;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: unreadCount > 0 ? `Neurio — ${unreadCount} unread` : 'Neurio', enabled: false },
      { type: 'separator' },
      { label: 'Open Neurio', click: () => mainWindow?.show() },
      { label: 'Show server URL', click: () => void dialog.showMessageBox({ message: `Local server: ${url}` }) },
      { label: 'Open data folder', click: () => void shell.openPath(app.getPath('userData')) },
      { type: 'separator' },
      {
        label: 'Quit Neurio',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
}

/** ------------------------------------------------------------------ */
/** ipc                                                                */
/** ------------------------------------------------------------------ */

function registerIpc(url: string): void {
  ipcMain.handle('neurio:info', () => ({
    isDesktop: true,
    version: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    platform: process.platform,
    dataDir: app.getPath('userData'),
    serverUrl: url,
    isPackaged: app.isPackaged,
  }));

  ipcMain.handle('neurio:notify', (_event, payload: { title: string; body: string }) => {
    if (!Notification.isSupported()) return false;
    const notification = new Notification({ title: payload.title, body: payload.body, silent: false });
    notification.on('click', () => {
      mainWindow?.show();
      mainWindow?.focus();
    });
    notification.show();
    return true;
  });

  ipcMain.handle('neurio:badge', (_event, count: number) => {
    unreadCount = count;
    if (process.platform === 'win32' && mainWindow) {
      // Windows: overlay a small counter dot on the taskbar button.
      mainWindow.setOverlayIcon(
        count > 0 ? nativeImage.createFromDataURL(BADGE_ICON) : null,
        count > 0 ? `${count} unread messages` : '',
      );
      mainWindow.flashFrame(count > 0);
    } else if (process.platform === 'darwin' || process.platform === 'linux') {
      app.setBadgeCount(process.platform === 'darwin' ? count : 0);
    }
    refreshTrayMenu(url);
    return true;
  });

  ipcMain.handle('neurio:open-external', (_event, target: string) => {
    if (/^https?:\/\//i.test(target)) void shell.openExternal(target);
    return true;
  });

  ipcMain.handle('neurio:pick-files', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] });
    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle('neurio:save-file', async (_event, payload: { url: string; filename: string }) => {
    const result = await dialog.showSaveDialog({ defaultPath: payload.filename });
    if (result.canceled || !result.filePath) return false;
    try {
      const response = await fetch(payload.url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      const { writeFile } = await import('node:fs/promises');
      await writeFile(result.filePath, buffer);
      return true;
    } catch (error) {
      await dialog.showMessageBox({ type: 'error', message: `Could not save the file: ${(error as Error).message}` });
      return false;
    }
  });

  ipcMain.handle('neurio:set-login', (_event, enabled: boolean) => {
    app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath, args: ['--minimised'] });
    return app.getLoginItemSettings().openAtLogin;
  });

  ipcMain.handle('neurio:always-on-top', (_event, enabled: boolean) => {
    mainWindow?.setAlwaysOnTop(enabled);
    return mainWindow?.isAlwaysOnTop() ?? false;
  });

  ipcMain.handle('neurio:minimise-to-tray', () => {
    mainWindow?.hide();
    return true;
  });

  ipcMain.handle('neurio:show-window', () => {
    mainWindow?.show();
    mainWindow?.focus();
    return true;
  });
}

const BADGE_ICON =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAe0lEQVR42u3QMQ6AIAyF4b+JB/AIHsEjeASP4BE8gkfwCB7BI3gEj+ARPIJH8AgEAgFJk0x1mTRp0qRJkyZNmjRp0qRJkyZNmjRp0qRJkyZNmjRp0qRJkyZNmjRp0qRJkyZNmjRp0qRJkyZNmjRp0qRJkyZNmjRp0qRJkyZ9ywuZ1QF1Hf0m6wAAAABJRU5ErkJggg==';

/** ------------------------------------------------------------------ */

// Media permission handler: only allow microphone, camera and screen capture
// from the app itself (nothing else can ask).
function configurePermissions(): void {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    const allowed = ['media', 'display-capture', 'notifications', 'clipboard-read', 'clipboard-sanitized-write'];
    if (!allowed.includes(permission)) {
      callback(false);
      return;
    }
    const requestingUrl = (details as { requestingUrl?: string }).requestingUrl ?? '';
    const isLocal = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])/.test(requestingUrl) || requestingUrl.startsWith('file://');
    callback(isLocal || isDev);
  });

  // Display media (screen sharing) uses the modern handler when available.
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    void request;
    // Let Electron show the picker; on Windows this lists every window/screen.
    callback({} as never);
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });

  app.whenReady().then(async () => {
    configurePermissions();
    try {
      serverInfo = await startServer();
    } catch (error) {
      await dialog.showMessageBox({
        type: 'error',
        message: 'Neurio could not start its local server',
        detail: (error as Error).message,
      });
      app.quit();
      return;
    }

    registerIpc(serverInfo.url);
    mainWindow = createWindow(serverInfo.url);
    createTray(serverInfo.url);
    if (process.argv.includes('--minimised')) mainWindow.hide();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow(serverInfo!.url);
      else mainWindow?.show();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && process.env.NEURIO_CLOSE_TO_TRAY === '0') app.quit();
  });

  app.on('before-quit', () => {
    quitting = true;
    serverInfo?.child?.kill();
  });

  app.on('will-quit', () => {
    tray?.destroy();
    serverInfo?.child?.kill();
  });
}

process.on('uncaughtException', (error) => {
  console.error('[main] uncaught exception', error);
});
