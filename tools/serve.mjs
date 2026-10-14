// Dev server for the preview: serves the repo, but `/` opens WARFRONT.
//   node tools/serve.mjs [port]        →  http://localhost:8000/  (WARFRONT)
//                                        http://localhost:8000/index.html (Bash Baqi Racing)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const port = Number(process.argv[2] || 8000);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.webmanifest': 'application/manifest+json',
  '.wav': 'audio/wav', '.ico': 'image/x-icon',
};

createServer(async (req, res) => {
  try {
    let p = decodeURIComponent((req.url || '/').split('?')[0]);
    if (p === '/' || p === '') p = '/warfront.html';          // the new game is the landing page
    const file = normalize(join(root, p));
    if (!file.startsWith(root)) { res.writeHead(403).end('nope'); return; }
    let st = await stat(file).catch(() => null);
    if (st && st.isDirectory()) st = null;                       // no directory listing
    if (!st) { res.writeHead(404, { 'content-type': 'text/plain' }).end('404 ' + p); return; }
    const buf = await readFile(file);
    res.writeHead(200, {
      'content-type': MIME[extname(file)] || 'application/octet-stream',
      'cache-control': 'no-cache',
      'access-control-allow-origin': '*',
    });
    res.end(buf);
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' }).end(String(e && e.message));
  }
}).listen(port, '0.0.0.0', () => console.log('WARFRONT on http://0.0.0.0:' + port + '/'));
