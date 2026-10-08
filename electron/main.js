import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DownloadManager } from '../engine/download-manager.js';
import { installBrowserBridge, uninstallBrowserBridge, browserExtensionDirectory } from './browser-bridge.js';
import { runNativeMessagingHost } from './native-host.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nativeHostMode = process.argv.includes('--native-messaging-host');

if (nativeHostMode) {
  runNativeMessagingHost();
} else {
  const hasSingleInstance = app.requestSingleInstanceLock();
  if (!hasSingleInstance) {
    app.quit();
  } else {
    app.setName('AI Download Manager Pro');
    if (process.platform === 'win32') app.setAppUserModelId('com.aidownloadmanager.pro');

    const appDataDirectory = path.join(app.getPath('userData'));
    const manager = new DownloadManager({
      appDataDirectory,
      downloadDirectory: path.join(app.getPath('downloads'), 'AI Download Manager Pro'),
    });
    let mainWindow = null;
    let isShuttingDown = false;
    let readyToQuit = false;
    let pendingUrls = [];

    const extractOpenUrls = (args = process.argv) => {
      const urls = [];
      for (let i = 0; i < args.length; i += 1) {
        if (args[i] === '--open-url' && args[i + 1]) urls.push(args[i + 1]);
      }
      return urls;
    };

    function showWindow() {
      if (!mainWindow) return;
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }

    async function addIncomingUrls(urls) {
      for (const url of urls) {
        try {
          await manager.addDownload({ url, startImmediately: true, duplicatePolicy: 'rename' });
        } catch (error) {
          manager._publish('notification', { level: 'error', title: 'Could not add browser link', message: error.message || 'The link could not be added.' });
        }
      }
    }

    function sendEvent(event) {
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send('manager:event', event);
      }
    }

    function handle(channel, handler) {
      ipcMain.handle(channel, async (_event, ...args) => handler(...args));
    }

    function registerIpc() {
      handle('manager:state', () => manager.getState());
      handle('manager:add', (options) => manager.addDownload(options));
      handle('manager:pause', (id) => manager.pauseDownload(id));
      handle('manager:resume', (id) => manager.resumeDownload(id));
      handle('manager:cancel', (id) => manager.cancelDownload(id));
      handle('manager:remove', (id) => manager.removeDownload(id));
      handle('manager:pause-all', () => manager.pauseAll());
      handle('manager:resume-all', () => manager.resumeAll());
      handle('manager:cancel-all', () => manager.cancelAll());
      handle('manager:reorder', (ids) => manager.reorderQueue(Array.isArray(ids) ? ids : []));
      handle('manager:priority', ({ id, priority } = {}) => manager.setPriority(id, priority));
      handle('manager:update-settings', (settings) => manager.updateSettings(settings));
      handle('manager:logs', (limit) => manager.logs(limit));

      handle('dialog:choose-download-folder', async () => {
        const result = await dialog.showOpenDialog(mainWindow, {
          title: 'Choose download folder',
          defaultPath: manager.settings.downloadDirectory,
          properties: ['openDirectory', 'createDirectory'],
        });
        return result.canceled || !result.filePaths[0] ? null : result.filePaths[0];
      });

      handle('dialog:import-urls', async () => {
        const result = await dialog.showOpenDialog(mainWindow, {
          title: 'Import download links',
          filters: [{ name: 'URL lists', extensions: ['txt', 'csv', 'list'] }, { name: 'All files', extensions: ['*'] }],
          properties: ['openFile', 'multiSelections'],
        });
        if (result.canceled) return [];
        const urls = [];
        for (const filePath of result.filePaths) {
          const content = await fs.readFile(filePath, 'utf8');
          for (const line of content.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const candidate = trimmed.split(',')[0].trim().replace(/^"|"$/g, '');
            try {
              const url = new URL(candidate);
              if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) urls.push(url.toString());
            } catch { /* Skip non-URL rows such as a CSV header. */ }
          }
        }
        return [...new Set(urls)];
      });

      handle('dialog:export-logs', async () => {
        const result = await dialog.showSaveDialog(mainWindow, {
          title: 'Export diagnostics log',
          defaultPath: path.join(app.getPath('documents'), 'AI Download Manager Pro - diagnostics.log'),
          filters: [{ name: 'Log files', extensions: ['log', 'txt'] }],
        });
        if (result.canceled || !result.filePath) return null;
        await fs.writeFile(result.filePath, await manager.readLogs(), 'utf8');
        return result.filePath;
      });

      handle('shell:open-file', async (id) => {
        const entry = manager.downloads.get(id);
        if (!entry || entry.status !== 'completed') throw new Error('Only completed downloads can be opened.');
        const error = await shell.openPath(entry.finalPath);
        if (error) throw new Error(error);
        return { ok: true };
      });
      handle('shell:show-in-folder', async (id) => {
        const entry = manager.downloads.get(id);
        if (!entry || entry.status !== 'completed') throw new Error('This download is not complete yet.');
        shell.showItemInFolder(entry.finalPath);
        return { ok: true };
      });
      handle('browser:install', async () => installBrowserBridge({ app, appDataDirectory }));
      handle('browser:uninstall', async () => uninstallBrowserBridge());
      handle('browser:open-extension', async () => {
        const directory = browserExtensionDirectory({ isPackaged: app.isPackaged, appPath: app.getAppPath(), resourcesPath: process.resourcesPath });
        const error = await shell.openPath(directory);
        if (error) throw new Error(error);
        return directory;
      });
    }

    function createWindow() {
      mainWindow = new BrowserWindow({
        width: 1440,
        height: 960,
        minWidth: 1040,
        minHeight: 720,
        show: false,
        backgroundColor: '#0b0f17',
        title: 'AI Download Manager Pro',
        autoHideMenuBar: true,
        webPreferences: {
          preload: path.join(__dirname, 'preload.cjs'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      mainWindow.loadFile(path.join(__dirname, '../desktop/renderer/index.html'));
      mainWindow.once('ready-to-show', () => {
        mainWindow.show();
        if (pendingUrls.length) {
          const urls = pendingUrls;
          pendingUrls = [];
          addIncomingUrls(urls);
        }
      });
      mainWindow.on('closed', () => { mainWindow = null; });
    }

    app.on('second-instance', (_event, commandLine) => {
      showWindow();
      const urls = extractOpenUrls(commandLine);
      if (urls.length) {
        if (mainWindow?.webContents.isLoading()) pendingUrls.push(...urls);
        else addIncomingUrls(urls);
      }
    });

    app.whenReady().then(async () => {
      try {
        await manager.initialize();
      } catch (error) {
        dialog.showErrorBox('AI Download Manager Pro', `The download engine could not start.\n\n${error.message}`);
        app.quit();
        return;
      }
      registerIpc();
      manager.on('event', sendEvent);
      createWindow();
      pendingUrls = extractOpenUrls();
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
        else showWindow();
      });
    });

    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') app.quit();
    });

    app.on('before-quit', (event) => {
      if (readyToQuit || isShuttingDown) return;
      event.preventDefault();
      isShuttingDown = true;
      manager.shutdown().finally(() => {
        readyToQuit = true;
        app.quit();
      });
    });
  }
}
