#!/usr/bin/env node
/**
 * Static preview server for the built interface.
 *
 * This is a *review tool*, not part of the application: it serves `dist/` so the
 * layout can be looked at in a normal browser (or through a remote preview).
 * Without the Tauri shell the UI has no engine, so it renders its empty states
 * and labels itself "preview mode" — no download is ever simulated here.
 *
 * Usage:
 *   npm run build && node dev/preview-server.mjs [port] [host]
 */

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";

const port = Number(process.argv[2] ?? process.env.PORT ?? 4173);
const host = process.argv[3] ?? process.env.HOST ?? "0.0.0.0";
const root = resolve(process.cwd(), "dist");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

async function resolveFile(urlPath) {
  const clean = decodeURIComponent(urlPath.split("?")[0]);
  const candidate = resolve(join(root, clean));
  // Never serve anything outside dist/.
  if (!candidate.startsWith(root + sep) && candidate !== root) return null;
  try {
    const info = await stat(candidate);
    if (info.isDirectory()) return resolveFile(join(clean, "index.html"));
    return candidate;
  } catch {
    return null;
  }
}

const server = createServer(async (request, response) => {
  const url = request.url ?? "/";
  let file = await resolveFile(url === "/" ? "/index.html" : url);
  if (!file) file = await resolveFile("/index.html"); // SPA fallback
  if (!file) {
    response.writeHead(404, { "content-type": "text/plain" });
    response.end("not found");
    return;
  }
  try {
    const body = await readFile(file);
    response.writeHead(200, {
      "content-type": MIME[extname(file).toLowerCase()] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    response.end(body);
  } catch (error) {
    response.writeHead(500, { "content-type": "text/plain" });
    response.end(String(error));
  }
});

server.listen(port, host, () => {
  console.log(`SwiftLoad UI preview on http://${host}:${port} (serving ${root})`);
  console.log("Preview mode: the interface runs without the Rust engine.");
});
