#!/usr/bin/env node
/**
 * Bundles the chat client into ONE self-contained HTML file — used by the APK
 * (assets/game.html) and usable standalone (double-click → works offline).
 *
 *   node tools/offline-chat/build-singlefile.mjs
 *   → tools/offline-chat/dist/nurio-tawasol.html
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUB = path.join(HERE, 'public');
const OUT_DIR = path.join(HERE, 'dist');
const OUT = path.join(OUT_DIR, 'nurio-tawasol.html');

const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf8');
const b64 = (f) => fs.readFileSync(path.join(PUB, f)).toString('base64');

let html = read('index.html');
const css = read('style.css');
let js = read('app.js');

/* ── inline the stylesheet ────────────────────────────────────────────── */
html = html.replace(/<link rel="stylesheet" href="style\.css">/, () => `<style>\n${css}\n</style>`);

/* ── inline the client script (it has no imports, so an inline module is fine) ── */
js = js.replace(/<\/script>/gi, '<\\/script>');           // never break out of the tag
html = html.replace(/<script src="app\.js" type="module"><\/script>/,
  () => `<script type="module">\n${js}\n</script>`);

/* ── icons as data URIs (no external requests at all) ─────────────────── */
html = html.replace(/<link rel="icon"[^>]*>/, () => `<link rel="icon" href="data:image/png;base64,${b64('icon-192.png')}">`);
html = html.replace(/<link rel="apple-touch-icon"[^>]*>/, () => `<link rel="apple-touch-icon" href="data:image/png;base64,${b64('apple-touch-icon.png')}">`);
html = html.replace(/<link rel="manifest"[^>]*>\n?/, '');   // nothing to install inside the APK

/* ── little marker so the file knows it is the bundled build ──────────── */
html = html.replace('<head>', '<head>\n<!-- 📡 built by tools/offline-chat/build-singlefile.mjs — single file, zero requests -->');
html = html.replace('<title>', '<title>', 1);
html = html.replace(/<script type="module">/, '<script type="module">\n/* bundled: css + client inlined */\n');

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT, html);

const kb = (n) => (n / 1024).toFixed(1) + ' KB';
console.log(`   📦 ${path.relative(process.cwd(), OUT)}`);
console.log(`      ${kb(Buffer.byteLength(html))} (css ${kb(Buffer.byteLength(css))} · js ${kb(Buffer.byteLength(js))})`);
console.log('   ✅ single file — no server, no build step, no external requests');
