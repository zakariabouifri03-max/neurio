import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { DownloadManager } from '../engine/download-manager.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(here, '..');
const rendererRoot = path.join(repositoryRoot, 'desktop', 'renderer');
const previewData = process.env.AIDMP_PREVIEW_DATA || path.join(os.tmpdir(), 'ai-download-manager-pro-preview');
const downloadDirectory = process.env.AIDMP_DOWNLOAD_DIR || path.join(os.homedir(), 'Downloads', 'AI Download Manager Pro');
const port = Math.max(1, Number(process.env.PORT) || 4173);
const manager = new DownloadManager({ appDataDirectory: previewData, downloadDirectory });
const clients = new Set();

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function sendJson(response, status, value) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  response.end(JSON.stringify(value));
}

function checkSameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === request.headers.host; } catch { return false; }
}

async function readJson(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > 2 * 1024 * 1024) throw Object.assign(new Error('Request is too large.'), { statusCode: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Request body must be valid JSON.'), { statusCode: 400 }); }
}

function broadcast(event) {
  const frame = `data: ${JSON.stringify(event)}\n\n`;
  for (const response of clients) {
    try { response.write(frame); } catch { clients.delete(response); }
  }
}

function scheduleHeartbeat() {
  const timer = setInterval(() => {
    for (const response of clients) {
      try { response.write(': keep-alive\n\n'); } catch { clients.delete(response); }
    }
  }, 15_000);
  timer.unref?.();
  return timer;
}

async function handleApi(request, response, url) {
  if (request.method === 'GET' && url.pathname === '/api/state') return sendJson(response, 200, manager.getState());
  if (request.method === 'GET' && url.pathname === '/api/health') return sendJson(response, 200, { ok: true, engine: 'real-http', version: '1.0.0' });
  if (request.method === 'GET' && url.pathname === '/api/logs') {
    const limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit')) || 200));
    return sendJson(response, 200, await manager.logs(limit));
  }
  if (request.method === 'GET' && url.pathname === '/api/logs/export') {
    response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': 'attachment; filename="ai-download-manager-pro.log"', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(await manager.readLogs());
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/events') {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Content-Type-Options': 'nosniff',
    });
    response.write(`data: ${JSON.stringify({ type: 'state', state: manager.getState() })}\n\n`);
    clients.add(response);
    request.on('close', () => clients.delete(response));
    return;
  }
  if (request.method !== 'POST') return sendJson(response, 404, { error: 'Not found.' });
  if (!checkSameOrigin(request)) return sendJson(response, 403, { error: 'Cross-origin preview API requests are blocked.' });

  const body = await readJson(request);
  let result;
  switch (url.pathname) {
    case '/api/add': result = await manager.addDownload(body); break;
    case '/api/pause': result = await manager.pauseDownload(body.id); break;
    case '/api/resume': result = await manager.resumeDownload(body.id); break;
    case '/api/cancel': result = await manager.cancelDownload(body.id); break;
    case '/api/remove': result = await manager.removeDownload(body.id); break;
    case '/api/pause-all': result = await manager.pauseAll(); break;
    case '/api/resume-all': result = await manager.resumeAll(); break;
    case '/api/cancel-all': result = await manager.cancelAll(); break;
    case '/api/reorder': result = await manager.reorderQueue(Array.isArray(body.ids) ? body.ids : []); break;
    case '/api/priority': result = await manager.setPriority(body.id, body.priority); break;
    case '/api/settings': result = await manager.updateSettings(body); break;
    default: return sendJson(response, 404, { error: 'Not found.' });
  }
  sendJson(response, 200, result ?? { ok: true });
}

async function handler(request, response) {
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) {
    try { await handleApi(request, response, url); }
    catch (error) {
      if (!response.headersSent) sendJson(response, error.statusCode || 400, { error: error.message || 'The request could not be completed.' });
      else response.destroy();
    }
    return;
  }
  if (!['GET', 'HEAD'].includes(request.method)) return sendJson(response, 405, { error: 'Method not allowed.' });
  let relative;
  try { relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname); }
  catch { return sendJson(response, 400, { error: 'Invalid path.' }); }
  const resolved = path.resolve(rendererRoot, `.${relative}`);
  if (!resolved.startsWith(`${rendererRoot}${path.sep}`) && resolved !== rendererRoot) return sendJson(response, 403, { error: 'Forbidden.' });
  try {
    const data = await fs.readFile(resolved);
    response.writeHead(200, {
      'Content-Type': mime[path.extname(resolved).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': path.extname(resolved) === '.html' ? 'no-store' : 'public, max-age=60',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    response.end(request.method === 'HEAD' ? undefined : data);
  } catch (error) {
    sendJson(response, error.code === 'ENOENT' ? 404 : 500, { error: error.code === 'ENOENT' ? 'Not found.' : 'Could not read the app asset.' });
  }
}

await manager.initialize();
manager.on('event', broadcast);
const server = http.createServer((request, response) => void handler(request, response));
server.keepAliveTimeout = 60_000;
server.headersTimeout = 65_000;
const heartbeat = scheduleHeartbeat();
server.listen(port, '0.0.0.0', () => {
  console.log(`AI Download Manager Pro preview ready on http://0.0.0.0:${port}`);
  console.log(`Download folder: ${manager.settings.downloadDirectory}`);
  console.log('This is a real local engine preview. It does not simulate transfer speed or progress.');
});

async function close() {
  clearInterval(heartbeat);
  for (const response of clients) response.end();
  clients.clear();
  server.close();
  await manager.shutdown();
  process.exit(0);
}
process.on('SIGINT', close);
process.on('SIGTERM', close);
