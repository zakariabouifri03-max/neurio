#!/usr/bin/env node
// ── Filebox backup server ───────────────────────────────────────────────────
// A dependency-free WebDAV-ish endpoint: PROPFIND, MKCOL and PUT with HTTP
// Basic auth. Enough for the app's "Sift l-coffre" button, and nothing else —
// no listing UI, no delete, no fancy DAV.
//
//   node server.mjs --port 8200 --dir ./backups --user zakaria --pass s3cr3t
//
// Run it on a PC, a Raspberry Pi, or a Freebox Delta that has Node. Then in the
// app: Settings → Backup → URL = http://<ip-du-pc>:8200
//
// Put it behind a reverse proxy with TLS if it leaves your LAN.

import { createServer } from 'node:http';
import { mkdir, stat, writeFile, open } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { join, normalize, resolve, dirname } from 'node:path';

const arg = (name, fallback) => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const PORT = Number(arg('port', 8200));
const HOST = arg('host', '0.0.0.0');
const ROOT = resolve(arg('dir', './backups'));
const USER = arg('user', 'filebox');
const PASS = arg('pass', 'filebox');
const MAX_BYTES = Number(arg('max-mb', 4096)) * 1024 * 1024;

await mkdir(ROOT, { recursive: true });

function authorised(req) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Basic ')) return false;
  const [u, p] = Buffer.from(h.slice(6), 'base64').toString('utf8').split(':');
  return u === USER && p === PASS;
}

/** Resolve a request path inside ROOT, refusing anything that escapes it. */
function safePath(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0]).replace(/\/+$/, '') || '/';
  const full = resolve(join(ROOT, normalize(clean).replace(/^(\.\.[/\\])+/, '')));
  if (full !== ROOT && !full.startsWith(ROOT + '/')) return null;
  return full;
}

const xml = (body) => '<?xml version="1.0" encoding="utf-8"?>\n' + body;

const server = createServer(async (req, res) => {
  const send = (code, body = '', type = 'text/plain; charset=utf-8') => {
    res.writeHead(code, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body) });
    res.end(body);
  };

  if (!authorised(req)) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Filebox"' });
    return res.end('authentication required');
  }

  const path = safePath(req.url);
  if (!path) return send(400, 'bad path');

  try {
    if (req.method === 'PROPFIND') {
      let s = null;
      try { s = await stat(path); } catch { /* absent is fine */ }
      if (!s) return send(404, 'not found');
      const href = req.url.replace(/\/+$/, '') || '/';
      return send(207, xml(
        `<D:multistatus xmlns:D="DAV:">` +
        `<D:response><D:href>${href}</D:href>` +
        `<D:propstat><D:prop>` +
        `<D:resourcetype>${s.isDirectory() ? '<D:collection/>' : ''}</D:resourcetype>` +
        `<D:getcontentlength>${s.size}</D:getcontentlength>` +
        `<D:getlastmodified>${s.mtime.toUTCString()}</D:getlastmodified>` +
        `</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>` +
        `</D:response></D:multistatus>`), 'application/xml; charset=utf-8');
    }

    if (req.method === 'MKCOL') {
      try { await mkdir(path, { recursive: true }); return send(201); }
      catch { return send(405, 'already exists'); }
    }

    if (req.method === 'PUT') {
      const len = Number(req.headers['content-length'] || 0);
      if (len > MAX_BYTES) return send(413, 'too large');
      await mkdir(dirname(path), { recursive: true });
      const tmp = path + '.part';
      await new Promise((ok, bad) => {
        const out = createWriteStream(tmp);
        let written = 0;
        req.on('data', (c) => {
          written += c.length;
          if (written > MAX_BYTES) { bad(new Error('too large')); req.destroy(); }
        });
        req.pipe(out);
        out.on('finish', ok);
        out.on('error', bad);
      });
      const { rename } = await import('node:fs/promises');
      await rename(tmp, path);
      const s = await stat(path);
      console.log(`PUT ${req.url}  ${(s.size / 1048576).toFixed(1)} MB`);
      return send(201);
    }

    if (req.method === 'GET') {
      try {
        const s = await stat(path);
        if (s.isDirectory()) return send(405, 'is a collection');
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Length': s.size,
          'Content-Disposition': `attachment; filename="${path.split('/').pop()}"`,
        });
        const f = await open(path, 'r');
        await new Promise((ok) => f.createReadStream().pipe(res).on('finish', ok));
        await f.close();
        return;
      } catch { return send(404, 'not found'); }
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        DAV: '1',
        Allow: 'OPTIONS, PROPFIND, MKCOL, PUT, GET',
        'Content-Length': 0,
      });
      return res.end();
    }

    return send(405, 'method not allowed');
  } catch (err) {
    console.error(err);
    return send(500, String(err.message || err));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Filebox backup server`);
  console.log(`  listening on http://${HOST}:${PORT}`);
  console.log(`  storing in  ${ROOT}`);
  console.log(`  user        ${USER}`);
  console.log(`  limit       ${MAX_BYTES / 1048576} MB per file`);
  console.log(`\nIn the app: Settings → Backup → URL = http://<this machine's IP>:${PORT}`);
});
