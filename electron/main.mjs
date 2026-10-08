import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DownloadManager } from '../engine/download-manager.mjs';
import { runNativeHost } from './native-host.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nativeHostMode = process.argv.includes('--native-host') || process.env.AIDMP_NATIVE_HOST === '1';

if (nativeHostMode) {
  // Do not create a window or write normal application logs to stdout: Chrome/Edge/Firefox
  // reserve stdout for the Native Messaging protocol.
  runNativeHost().catch(error => {
    process.stderr.write(`[AI Download Manager Pro native host] ${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
} else {
  app.setName('AI Download Manager Pro');
  app.setAppUserModelId('com.neurio.aidownloadmanagerpro');
  const hasSingleInstanceLock = app.requestSingleInstanceLock();
  if (!hasSingleInstanceLock) {
    app.quit();
  } else {
  const appDataDirectory = path.join(app.getPath('appData'), 'AI Download Manager Pro');
  app.setPath('userData', appDataDirectory);

  const defaultDownloadDirectory = path.join(app.getPath('downloads'), 'AI Download Manager Pro');
  const manager = new DownloadManager({
    appDataDirectory,
    defaultDownloadDirectory,
    enableBrowserBridge: true,
    browserInboxDirectory: path.join(appDataDirectory, 'browser-inbox'),
  });

  let mainWindow = null;
  let trustedRendererUrl = null;
  let quitting = false;

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    } else if (app.isReady()) createWindow();
  });

  function sendEvent(event) {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('aidmp:event', event);
  }

  function createWindow() {
    mainWindow = new BrowserWindow({
      width: 1460,
      height: 960,
      minWidth: 1120,
      minHeight: 720,
      show: false,
      title: 'AI Download Manager Pro',
      backgroundColor: '#0b0d14',
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    });
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      try {
        const parsed = new URL(url);
        if (parsed.protocol === 'https:' || parsed.protocol === 'http:') shell.openExternal(url);
      } catch { /* reject unknown schemes */ }
      return { action: 'deny' };
    });
    const rendererPath = path.join(app.getAppPath(), 'desktop', 'index.html');
    trustedRendererUrl = pathToFileURL(rendererPath).href;
    mainWindow.webContents.on('will-navigate', (event, url) => {
      if (url !== trustedRendererUrl) event.preventDefault();
    });
    mainWindow.on('closed', () => { mainWindow = null; });
    mainWindow.once('ready-to-show', () => mainWindow?.show());
    mainWindow.loadFile(rendererPath);
  }

  function withManager(action, payload = {}) {
    switch (action) {
      case 'state': return manager.getState();
      case 'logs': return manager.getLogs(payload.limit || 250);
      case 'inspect': return manager.inspectUrl(payload.url, { fileName: payload.fileName, outputDirectory: payload.outputDirectory });
      case 'add': return manager.addUrl(payload.url, payload);
      case 'addMany': return manager.addMany(payload.urls || [], payload.options || {});
      case 'pause': return manager.pause(payload.id);
      case 'resume': return manager.resume(payload.id);
      case 'retry': return manager.retry(payload.id);
      case 'cancel': return manager.cancel(payload.id);
      case 'pauseAll': return manager.pauseAll();
      case 'resumeAll': return manager.resumeAll();
      case 'cancelAll': return manager.cancelAll();
      case 'resolveDuplicate': return manager.resolveDuplicate(payload.id, payload.action);
      case 'setPriority': return manager.setPriority(payload.id, payload.priority);
      case 'reorder': return manager.reorder(payload.ids || []);
      case 'updateSettings': return manager.updateSettings(payload.settings || {});
      case 'setSchedule': return manager.setSchedule(payload.schedule || {});
      case 'removeHistory': return manager.removeHistory(payload.id);
      case 'clearLogs': return manager.logger.clear();
      case 'reveal': return manager.reveal(payload.id);
      case 'chooseDirectory': return dialog.showOpenDialog(mainWindow, { title: 'Choose download folder', properties: ['openDirectory', 'createDirectory'] }).then(result => result.canceled ? null : result.filePaths[0]);
      case 'openDirectory': return shell.openPath(payload.path || manager.settings.downloadDirectory);
      case 'showInFolder': return shell.showItemInFolder(payload.path);
      default: throw new Error(`Unsupported application action: ${action}`);
    }
  }

  ipcMain.handle('aidmp:invoke', async (event, request = {}) => {
    try {
      if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== event.sender.mainFrame || event.senderFrame?.url !== trustedRendererUrl) {
        throw new Error('The request did not come from the trusted application window.');
      }
      return await withManager(request.action, request.payload || {});
    } catch (error) {
      return { __aidmpError: true, message: error.message || 'The requested action could not be completed.', code: error.code || 'APP_ERROR' };
    }
  });

  app.whenReady().then(async () => {
    try {
      await manager.initialize();
      manager.on('event', sendEvent);
      createWindow();
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
      });
    } catch (error) {
      dialog.showErrorBox('AI Download Manager Pro could not start', error.stack || error.message);
      app.quit();
    }
  });

  app.on('before-quit', event => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    manager.shutdown().finally(() => app.quit());
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  }
}
