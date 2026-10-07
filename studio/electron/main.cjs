// Neurio Studio — Electron shell (Windows / macOS / Linux desktop build)
// Serves the built web app from a custom `app://` scheme so ES modules, module workers, WASM and
// fetch all behave like on a real origin, and IndexedDB (projects + media) persists under a stable origin.
const { app, BrowserWindow, protocol, session, shell, dialog, desktopCapturer, Menu, net } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const DIST = path.join(__dirname, '..', 'dist');
const SCHEME = 'app';
const HOST = 'neurio';

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, bypassCSP: false } },
]);

// GPU / media flags: keep hardware video decode + WebGL on, allow large media
app.commandLine.appendSwitch('enable-features', 'PlatformHEVCDecoderSupport,SharedArrayBuffer');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.mp4': 'video/mp4', '.webm': 'video/webm', '.txt': 'text/plain', '.map': 'application/json',
  '.data': 'application/octet-stream', '.bin': 'application/octet-stream', '.tflite': 'application/octet-stream', '.task': 'application/octet-stream',
};

function registerAppProtocol() {
  protocol.handle(SCHEME, (request) => {
    const url = new URL(request.url);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/' || pathname === '') pathname = '/index.html';
    let file = path.normalize(path.join(DIST, pathname));
    if (!file.startsWith(DIST)) return new Response('Forbidden', { status: 403 });
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      // SPA fallback
      file = path.join(DIST, 'index.html');
    }
    const ext = path.extname(file).toLowerCase();
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
    };
    return net.fetch(pathToFileURL(file).toString(), { headers: {} }).then((r) => new Response(r.body, { status: 200, headers }));
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#0c0e14',
    title: 'Neurio Studio',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'resources', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webgl: true,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });

  // Open external links in the system browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // Exports: let the user choose where to save (blob: downloads from the renderer land here)
  win.webContents.session.on('will-download', (_e, item) => {
    const downloads = app.getPath('downloads');
    item.setSaveDialogOptions({ title: 'Save export', defaultPath: path.join(downloads, item.getFilename()) });
    item.once('done', (_ev, state) => {
      if (state === 'completed') shell.showItemInFolder(item.getSavePath());
    });
  });

  win.loadURL(`${SCHEME}://${HOST}/`);
  return win;
}

function setupPermissions() {
  const ses = session.defaultSession;
  // Camera / microphone / clipboard for recording & paste
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(['media', 'mediaKeySystem', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen', 'display-capture', 'notifications'].includes(permission));
  });
  ses.setPermissionCheckHandler(() => true);
  // Screen recording: getDisplayMedia needs the app to pick a source. Offer the screens + windows via a native chooser.
  ses.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } });
      if (!sources.length) return callback({});
      let pick = sources[0];
      if (sources.length > 1) {
        const idx = dialog.showMessageBoxSync({
          type: 'question',
          title: 'Record screen',
          message: 'What do you want to record?',
          buttons: sources.slice(0, 8).map((s) => s.name.slice(0, 40)),
          cancelId: -1,
          noLink: true,
        });
        if (idx < 0) return callback({});
        pick = sources[idx];
      }
      // 'loopback' captures system audio on Windows; other platforms silently get no system audio
      callback({ video: pick, audio: process.platform === 'win32' && request.audioRequested ? 'loopback' : undefined });
    } catch (e) {
      console.error(e);
      callback({});
    }
  });
}

app.whenReady().then(() => {
  registerAppProtocol();
  setupPermissions();
  Menu.setApplicationMenu(null);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
