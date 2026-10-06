'use strict';

const { app, BrowserWindow, dialog } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

app.setName('NEXUS Game Studio');
app.setAppUserModelId('com.nexus.gamestudio');

const hasInstanceLock = app.requestSingleInstanceLock();
if (!hasInstanceLock) app.quit();

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.wasm': 'application/wasm',
};

let server;
let mainWindow;
let quitting = false;
let appOrigin;

function createStaticServer(root) {
  return http.createServer((request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }

    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    } catch {
      response.writeHead(400).end('Bad request');
      return;
    }

    if (pathname === '/') pathname = '/index.html';
    const filePath = path.resolve(root, `.${pathname}`);
    if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) {
      response.writeHead(403).end('Forbidden');
      return;
    }

    let stat;
    try {
      stat = fs.statSync(filePath);
      if (!stat.isFile()) throw new Error('Not a file');
    } catch {
      response.writeHead(404).end('Not found');
      return;
    }

    response.writeHead(200, {
      'Content-Type': mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stat.size,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-cache',
    });
    if (request.method === 'HEAD') response.end();
    else fs.createReadStream(filePath).pipe(response);
  });
}

function listen(serverToStart, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => { serverToStart.removeListener('listening', onListening); reject(error); };
    const onListening = () => { serverToStart.removeListener('error', onError); resolve(serverToStart.address().port); };
    serverToStart.once('error', onError);
    serverToStart.once('listening', onListening);
    serverToStart.listen(port, '127.0.0.1');
  });
}

async function startLocalServer() {
  const root = app.getAppPath();
  server = createStaticServer(root);
  const portFile = path.join(app.getPath('userData'), 'local-server-port.json');
  let savedPort = null;
  try {
    const parsed = JSON.parse(fs.readFileSync(portFile, 'utf8'));
    if (Number.isInteger(parsed.port) && parsed.port > 1024 && parsed.port < 65536) savedPort = parsed.port;
  } catch { /* First launch: choose a persistent free port below. */ }

  let port;
  if (savedPort) {
    try { port = await listen(server, savedPort); }
    catch { throw new Error(`NEXUS could not open its saved local app port ${savedPort}. Close the other app using it and restart NEXUS.`); }
  } else {
    port = await listen(server, 0);
    fs.mkdirSync(path.dirname(portFile), { recursive: true });
    fs.writeFileSync(portFile, JSON.stringify({ port }), 'utf8');
  }
  appOrigin = `http://127.0.0.1:${port}`;
  return appOrigin;
}

async function createWindow() {
  if (mainWindow) { mainWindow.focus(); return; }
  const origin = await startLocalServer();
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 960,
    minWidth: 980,
    minHeight: 680,
    show: false,
    backgroundColor: '#0b1116',
    title: 'NEXUS Game Studio',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${appOrigin}/`)) event.preventDefault();
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });
  await mainWindow.loadURL(`${origin}/`);
}

app.on('second-instance', () => mainWindow?.focus());
app.whenReady().then(() => hasInstanceLock ? createWindow() : undefined).catch(async (error) => {
  await dialog.showMessageBox({ type: 'error', title: 'NEXUS Game Studio failed to start', message: error.message });
  app.quit();
});
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow().catch((error) => dialog.showErrorBox('NEXUS Game Studio', error.message)); });
app.on('before-quit', () => { quitting = true; server?.close(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('will-quit', () => { if (!quitting) server?.close(); });
