/** Serves the built renderer (used by browser mode and by the Electron shell). */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { ServerResponse } from 'node:http';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
};

export interface StaticOptions {
  dir: string;
}

export function createStaticHandler(options: StaticOptions) {
  const root = resolve(options.dir);

  return function handleStatic(urlPath: string, res: ServerResponse): boolean {
    let relative = decodeURIComponent(urlPath.split('?')[0]);
    if (relative === '/' || relative === '') relative = '/index.html';

    // Path-traversal guard: the resolved path must stay inside the root.
    const candidate = resolve(join(root, normalize(relative)));
    if (candidate !== root && !candidate.startsWith(root + sep)) {
      return false;
    }

    let file = candidate;
    if (!existsSync(file) || statSync(file).isDirectory()) {
      // SPA fallback: unknown paths render the app shell.
      file = join(root, 'index.html');
      if (!existsSync(file)) return false;
    }

    const ext = extname(file).toLowerCase();
    const isHashed = /-[A-Za-z0-9_]{8,}\.(js|css|woff2?)$/.test(file);
    res.writeHead(200, {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      'content-length': String(statSync(file).size),
      'cache-control': isHashed ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    createReadStream(file).pipe(res);
    return true;
  };
}
