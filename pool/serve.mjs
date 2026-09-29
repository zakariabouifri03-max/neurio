// ─────────────────────────────────────────────────────────────────────────────
//  serve.mjs — tiny zero-dependency static server for the pool hall
//
//    node serve.mjs [port]
//
//  `/`            the single-file build (neurio-pool.html)
//  `/index.html`  the modular dev version (same game, separate files)
//  `/vendor/*`    Three.js from the repository root
//  Anything else is served from this folder. No directory traversal.
// ─────────────────────────────────────────────────────────────────────────────
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, dirname, resolve, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const VENDOR = resolve(HERE, '..', 'vendor');
const PORT = parseInt(process.argv[2] || process.env.PORT || '8080', 10);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

http.createServer(async (req, res) => {
  try {
    let url = decodeURIComponent((req.url || '/').split('?')[0]);
    if (url === '/' || url === '') url = '/neurio-pool.html';
    const isVendor = url.startsWith('/vendor/');
    const base = isVendor ? VENDOR : HERE;
    const rel = normalize(isVendor ? url.slice('/vendor/'.length) : url).replace(/^(\.\.[/\\])+/, '');
    const file = join(base, rel);
    if (!file.startsWith(base)) { res.writeHead(403); res.end('forbidden'); return; }
    const st = await stat(file).catch(() => null);
    if (!st || !st.isFile()) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found: ' + url); return; }
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
      'content-length': body.length,
      'cache-control': 'no-cache',
      'access-control-allow-origin': '*',
    });
    res.end(body);
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end(String(e && e.message || e));
  }
}).listen(PORT, '0.0.0.0', () => {
  console.log(`NEURIO Pool Hall on http://0.0.0.0:${PORT}/  (single file)  ·  /index.html (modular dev build)`);
});
