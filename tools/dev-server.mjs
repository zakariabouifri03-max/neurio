import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { DownloadManager } from '../engine/download-manager.mjs';
import { friendlyError } from '../engine/errors.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const desktopRoot = path.join(repoRoot, 'desktop');
const previewRoot = path.join(os.tmpdir(), 'ai-download-manager-pro-preview');
const manager = new DownloadManager({
  appDataDirectory: path.join(previewRoot, 'state'),
  defaultDownloadDirectory: process.env.AIDMP_DOWNLOAD_DIR || path.join(previewRoot, 'downloads'),
  enableBrowserBridge: false,
});

const mimeTypes = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
};
const clients = new Set();

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body) });
  response.end(body);
}

async function readJson(request) {
  const pieces = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 2 * 1024 * 1024) throw new Error('Request body exceeded the 2 MB limit.');
    pieces.push(chunk);
  }
  if (!length) return {};
  return JSON.parse(Buffer.concat(pieces).toString('utf8'));
}

async function serveStatic(requestPath, response) {
  if (requestPath === '/') {
    response.writeHead(302, { Location: '/desktop/' });
    response.end();
    return;
  }
  let relative = requestPath.startsWith('/desktop/') ? requestPath.slice('/desktop/'.length) : null;
  if (relative == null) {
    response.writeHead(404); response.end('Not found'); return;
  }
  if (!relative) relative = 'index.html';
  let decoded;
  try { decoded = decodeURIComponent(relative); } catch { response.writeHead(400); response.end('Bad path'); return; }
  const filePath = path.resolve(desktopRoot, decoded);
  if (!filePath.startsWith(`${desktopRoot}${path.sep}`) && filePath !== desktopRoot) { response.writeHead(403); response.end('Forbidden'); return; }
  try {
    const content = await fs.readFile(filePath);
    response.writeHead(200, {
      'Content-Type': mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(content);
  } catch (error) {
    response.writeHead(error.code === 'ENOENT' ? 404 : 500);
    response.end(error.code === 'ENOENT' ? 'Not found' : 'Could not read file');
  }
}

async function handleApi(request, response, url) {
  const { pathname } = url;
  const idMatch = /^\/api\/downloads\/([^/]+)(?:\/(pause|resume|retry|cancel|duplicate|priority|reveal))?$/.exec(pathname);
  try {
    if (request.method === 'GET' && pathname === '/api/state') return sendJson(response, 200, manager.getState());
    if (request.method === 'GET' && pathname === '/api/logs') return sendJson(response, 200, manager.getLogs(Number(url.searchParams.get('limit')) || 250));
    if (request.method === 'GET' && pathname === '/api/events') {
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
      response.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
      clients.add(response);
      request.on('close', () => clients.delete(response));
      return;
    }
    if (request.method === 'POST' && pathname === '/api/inspect') {
      const body = await readJson(request);
      return sendJson(response, 200, await manager.inspectUrl(body.url, { fileName: body.fileName, outputDirectory: body.outputDirectory }));
    }
    if (request.method === 'POST' && pathname === '/api/downloads') {
      const body = await readJson(request);
      return sendJson(response, 202, await manager.addUrl(body.url, body));
    }
    if (request.method === 'POST' && pathname === '/api/downloads/batch') {
      const body = await readJson(request);
      return sendJson(response, 202, await manager.addMany(body.urls || [], body.options || {}));
    }
    if (request.method === 'POST' && pathname === '/api/actions/pause-all') return sendJson(response, 200, await manager.pauseAll());
    if (request.method === 'POST' && pathname === '/api/actions/resume-all') return sendJson(response, 200, await manager.resumeAll());
    if (request.method === 'POST' && pathname === '/api/actions/cancel-all') return sendJson(response, 200, await manager.cancelAll());
    if (request.method === 'POST' && pathname === '/api/queue/reorder') {
      const body = await readJson(request);
      return sendJson(response, 200, await manager.reorder(body.ids || []));
    }
    if (request.method === 'PATCH' && pathname === '/api/settings') {
      const body = await readJson(request);
      return sendJson(response, 200, await manager.updateSettings(body));
    }
    if (request.method === 'PUT' && pathname === '/api/schedule') {
      const body = await readJson(request);
      return sendJson(response, 200, await manager.setSchedule(body));
    }
    if (request.method === 'DELETE' && pathname === '/api/logs') {
      await manager.logger.clear();
      return sendJson(response, 200, { cleared: true });
    }
    if (request.method === 'POST' && pathname === '/api/choose-directory') return sendJson(response, 200, null);
    if (request.method === 'POST' && pathname === '/api/open-directory') {
      const body = await readJson(request);
      return sendJson(response, 200, { path: body.path || manager.settings.downloadDirectory });
    }
    if (request.method === 'POST' && pathname === '/api/show-in-folder') return sendJson(response, 200, { shown: true });
    if (idMatch) {
      const [, rawId, action] = idMatch;
      const id = decodeURIComponent(rawId);
      if (request.method === 'GET' && action === 'reveal') return sendJson(response, 200, await manager.reveal(id));
      if (request.method === 'POST' && ['pause','resume','retry','cancel','duplicate'].includes(action)) {
        const body = action === 'duplicate' ? await readJson(request) : {};
        const method = action === 'duplicate' ? manager.resolveDuplicate(id, body.action) : manager[action](id);
        return sendJson(response, 200, await method);
      }
      if (request.method === 'PATCH' && action === 'priority') {
        const body = await readJson(request);
        return sendJson(response, 200, await manager.setPriority(id, body.priority));
      }
      if (request.method === 'DELETE' && !action) return sendJson(response, 200, { removed: await manager.removeHistory(id) });
    }
    return sendJson(response, 404, { message: 'API endpoint not found.' });
  } catch (error) {
    const status = error.code === 'INVALID_URL' ? 400 : error.status && error.status >= 400 ? 502 : 400;
    return sendJson(response, status, { message: friendlyError(error), code: error.code || 'API_ERROR' });
  }
}

await manager.initialize();
manager.on('event', event => {
  const message = `data: ${JSON.stringify({ type: event.type })}\n\n`;
  for (const client of clients) {
    try { client.write(message); } catch { clients.delete(client); }
  }
});

const server = http.createServer(async (request, response) => {
  const baseHost = request.headers.host || 'localhost';
  const url = new URL(request.url || '/', `http://${baseHost}`);
  if (url.pathname.startsWith('/api/')) return handleApi(request, response, url);
  return serveStatic(url.pathname, response);
});
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || '0.0.0.0';
server.listen(port, host, () => console.log(`AI Download Manager Pro preview listening on http://${host}:${port}/desktop/`));

const heartbeat = setInterval(() => {
  for (const client of clients) {
    try { client.write(': keep-alive\n\n'); } catch { clients.delete(client); }
  }
}, 20_000);
heartbeat.unref?.();

async function close() {
  clearInterval(heartbeat);
  for (const client of clients) client.end();
  clients.clear();
  await manager.shutdown();
  server.close();
}
process.once('SIGINT', () => close().finally(() => process.exit(0)));
process.once('SIGTERM', () => close().finally(() => process.exit(0)));
