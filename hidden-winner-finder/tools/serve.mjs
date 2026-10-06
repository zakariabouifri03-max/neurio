#!/usr/bin/env node
/**
 * serve.mjs - tiny static server for the browser preview and for loading the
 * extension folder unpacked during development.
 *
 *   node tools/serve.mjs            # http://localhost:8080/preview.html
 *   node tools/serve.mjs 9000       # custom port
 *
 * Binds 0.0.0.0 so the preview works through a sandbox/tunnel proxy, and sets no
 * host or origin allowlist (that would break proxied previews).
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const root = resolve(join(dirname(fileURLToPath(import.meta.url)), '..'));
const port = Number(process.argv[2] || process.env.PORT || 8080);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.md': 'text/markdown; charset=utf-8',
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/' || pathname === '') pathname = '/preview.html';

    const target = resolve(join(root, normalize(pathname)));
    if (!target.startsWith(root)) {
      response.writeHead(403).end('Forbidden');
      return;
    }

    const info = await stat(target).catch(() => null);
    if (!info || info.isDirectory()) {
      response.writeHead(404, { 'content-type': 'text/plain' }).end(`Not found: ${pathname}`);
      return;
    }

    const body = await readFile(target);
    response.writeHead(200, {
      'content-type': TYPES[extname(target).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    });
    response.end(body);
  } catch (error) {
    response.writeHead(500, { 'content-type': 'text/plain' }).end(`Server error: ${error.message}`);
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Hidden Winner Finder preview → http://localhost:${port}/preview.html`);
  console.log(`Extension popup (as a page)   → http://localhost:${port}/src/ui/popup.html`);
  console.log('Load the folder unpacked in Chrome (chrome://extensions → Load unpacked) for the real thing.');
});
