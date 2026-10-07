const { app, BrowserWindow, Menu, dialog, shell, session } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const APP_ROOT = path.resolve(__dirname, '..');
const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

let mainWindow;
let appServer;
let appOrigin;

function respond(res, status, message) {
  res.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(message);
}

function serveEditor(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    respond(res, 405, 'Method not allowed');
    return;
  }

  let requestedPath;
  try {
    requestedPath = decodeURIComponent(new URL(req.url, appOrigin).pathname);
  } catch {
    respond(res, 400, 'Bad request');
    return;
  }

  if (requestedPath.includes('\\') || requestedPath.split('/').includes('..')) {
    respond(res, 403, 'Forbidden');
    return;
  }

  const relativePath = requestedPath === '/' ? 'index.html' : requestedPath.slice(1);
  const filePath = path.resolve(APP_ROOT, relativePath);
  if (filePath !== APP_ROOT && !filePath.startsWith(`${APP_ROOT}${path.sep}`)) {
    respond(res, 403, 'Forbidden');
    return;
  }

  fs.readFile(filePath, (error, contents) => {
    if (error) {
      respond(res, error.code === 'ENOENT' ? 404 : 500, error.code === 'ENOENT' ? 'Not found' : 'Unable to read app file');
      return;
    }
    res.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Length': contents.length,
      'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(req.method === 'HEAD' ? undefined : contents);
  });
}

function startAppServer() {
  return new Promise((resolve, reject) => {
    appServer = http.createServer(serveEditor);
    appServer.once('error', reject);
    appServer.listen(0, '127.0.0.1', () => {
      const address = appServer.address();
      appOrigin = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
}

function createApplicationMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        { role: 'close', label: 'Close window' },
        { role: 'quit', label: 'Quit Neurio Studio' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'close' }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: '#101116',
    title: 'Neurio Studio',
    autoHideMenuBar: false,
    icon: path.join(APP_ROOT, 'icons', 'icon.ico'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== appOrigin) event.preventDefault();
  });
  mainWindow.on('closed', () => {
    mainWindow = undefined;
  });
  mainWindow.loadURL(`${appOrigin}/`);
}

app.whenReady().then(async () => {
  session.defaultSession.on('will-download', async (_event, item, webContents) => {
    const parentWindow = BrowserWindow.fromWebContents(webContents) || mainWindow;
    item.pause();
    try {
      const { canceled, filePath } = await dialog.showSaveDialog(parentWindow, {
        title: 'Save Neurio Studio export',
        defaultPath: path.join(app.getPath('downloads'), item.getFilename()),
      });
      if (canceled || !filePath) {
        item.cancel();
        return;
      }
      item.setSavePath(filePath);
      item.resume();
    } catch {
      item.cancel();
    }
  });

  await startAppServer();
  createApplicationMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch(error => {
  dialog.showErrorBox('Neurio Studio could not start', error.message || String(error));
  app.quit();
});

app.on('before-quit', () => {
  appServer?.close();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
