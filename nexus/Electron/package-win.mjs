// ============================================================================
// NEXUS GAME STUDIO — Windows packaging script
// Packages the editor as a standalone Windows application (NEXUS.exe).
// Run:  npm run package:win
// Requires Node.js + network (downloads Electron ~100 MB on first run).
// ============================================================================
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const staging = path.join(root, 'dist', 'nexus-editor');

function run(cmd, opts = {}) {
  console.log('>', cmd);
  execSync(cmd, { stdio: 'inherit', cwd: root, ...opts });
}

console.log('── NEXUS editor packaging (Windows x64) ──\n');

// 1. build all bundles
console.log('[1/4] Building editor + runtime + server bundles…');
run('npm run build');
run('npm run build:server');

// 2. stage the app
console.log('[2/4] Staging application files…');
fs.rmSync(staging, { recursive: true, force: true });
fs.mkdirSync(staging, { recursive: true });
fs.cpSync(path.join(root, 'www'), path.join(staging, 'www'), { recursive: true });
fs.cpSync(path.join(root, 'www-runtime'), path.join(staging, 'www-runtime'), { recursive: true });
fs.cpSync(path.join(root, 'serverout'), path.join(staging, 'serverout'), { recursive: true });
fs.cpSync(path.join(root, 'Electron'), path.join(staging, 'electron'), { recursive: true });
fs.cpSync(path.join(root, 'node_modules', 'express'), path.join(staging, 'node_modules', 'express'), { recursive: true });
fs.cpSync(path.join(root, 'node_modules', 'multer'), path.join(staging, 'node_modules', 'multer'), { recursive: true });
// express deps needed at runtime
for (const dep of ['accepts', 'body-parser', 'bytes', 'call-bind-apply-helpers', 'content-disposition', 'content-type',
  'cookie', 'cookie-signature', 'debug', 'depd', 'destroy', 'encodeurl', 'escape-html', 'etag', 'finalhandler',
  'fresh', 'function-bind', 'get-intrinsic', 'has-proto', 'has-symbols', 'http-errors', 'iconv-lite', 'inherits',
  'ipaddr.js', 'media-typer', 'merge-descriptors', 'methods', 'mime', 'mime-db', 'mime-types', 'ms', 'negotiator',
  'object-inspect', 'on-finished', 'parseurl', 'path-to-regexp', 'proxy-addr', 'qs', 'range-parser', 'raw-body',
  'safe-buffer', 'safer-buffer', 'send', 'serve-static', 'setprototypeof', 'side-channel', 'statuses',
  'toidentifier', 'type-is', 'unpipe', 'utils-merge', 'vary', 'busboy', 'stream-wormhole', 'raw-body']) {
  const src = path.join(root, 'node_modules', dep);
  if (fs.existsSync(src)) fs.cpSync(src, path.join(staging, 'node_modules', dep), { recursive: true });
}
// minimal package.json for the app
fs.writeFileSync(path.join(staging, 'package.json'), JSON.stringify({
  name: 'nexus-game-studio',
  productName: 'NEXUS GAME STUDIO',
  version: '1.0.0',
  description: 'AI-powered 3D game development environment',
  main: 'electron/main.cjs',
  scripts: { start: 'electron .' },
  devDependencies: { electron: '^33.0.0', 'electron-packager': '^17.1.2' },
}, null, 2));
// projects folder
fs.mkdirSync(path.join(staging, 'Projects'), { recursive: true });
const sampleSrc = path.join(root, 'Projects', 'island-survival');
if (fs.existsSync(sampleSrc)) fs.cpSync(sampleSrc, path.join(staging, 'Projects', 'island-survival'), { recursive: true });

// 3. install electron in staging
console.log('[3/4] Installing Electron in staging (first run downloads ~100 MB)…');
run('npm install --no-audit --no-fund', { cwd: staging });

// 4. package
console.log('[4/4] Packaging NEXUS GAME STUDIO.exe…');
run('npx electron-packager . "NEXUS GAME STUDIO" --platform=win32 --arch=x64 --out=.. --overwrite --asar', { cwd: staging });

console.log(`
── PACKAGING COMPLETE ──
Output: dist/nexus-game-studio-win32-x64/NEXUS GAME STUDIO.exe
The app bundles the editor, engine, server and AI agent — fully offline.
Projects are stored in the Projects/ folder next to the executable.
`);
