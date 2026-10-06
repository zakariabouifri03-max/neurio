// ============================================================================
// NEXUS GAME STUDIO — Windows editor packaging (real electron-packager run)
// Produces dist/nexus-editor-package/NEXUS GAME STUDIO-win32-x64/NEXUS GAME STUDIO.exe
// Run:  npm run package:win      (native on Windows; CI runs it on windows-latest)
// ============================================================================
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const staging = path.join(root, 'dist', 'nexus-editor');
const outDir = path.join(root, 'dist', 'nexus-editor-package');
const APP_NAME = 'NEXUS-GAME-STUDIO';       // exe name — no spaces (cmd/quoting-safe)
const PRODUCT_NAME = 'NEXUS GAME STUDIO';    // window title / productName
const ELECTRON_VERSION = '33.4.11';

function run(cmd, opts = {}) {
  console.log('>', cmd);
  try {
    execSync(cmd, { stdio: 'inherit', cwd: root, ...opts });
  } catch (e) {
    // surface the child's stderr/stdout in the error itself (CI-friendly)
    const out = [...(e.output ?? [])].filter(Boolean).join('\n');
    console.error(`\n[FAILED] ${cmd}\n${out}\n${e.message}`);
    throw new Error(`Command failed: ${cmd}\n${out}`);
  }
}
const copy = (src, dest) => fs.cpSync(src, dest, { recursive: true });

console.log('── NEXUS editor packaging (Windows x64) ──\n');

console.log('[1/4] Building bundles…');
run('npm run build');
run('npm run build:server');

console.log('[2/4] Staging application…');
fs.rmSync(staging, { recursive: true, force: true });
fs.mkdirSync(staging, { recursive: true });
copy(path.join(root, 'www'), path.join(staging, 'www'));                 // editor UI
copy(path.join(root, 'www-runtime'), path.join(staging, 'www-runtime')); // game runtime (for builds)
copy(path.join(root, 'serverout'), path.join(staging, 'serverout'));     // server bundle
fs.mkdirSync(path.join(staging, 'electron'), { recursive: true });
copy(path.join(root, 'Electron', 'main.cjs'), path.join(staging, 'electron', 'main.cjs'));
copy(path.join(root, 'Electron', 'preload.cjs'), path.join(staging, 'electron', 'preload.cjs'));

// sample game (data only — no builds/snapshots/backups)
const sampleSrc = path.join(root, 'Projects', 'island-survival');
if (fs.existsSync(sampleSrc)) {
  fs.mkdirSync(path.join(staging, 'Projects', 'island-survival'), { recursive: true });
  copy(path.join(sampleSrc, 'project.json'), path.join(staging, 'Projects', 'island-survival', 'project.json'));
  const content = path.join(sampleSrc, 'Content');
  if (fs.existsSync(content)) copy(content, path.join(staging, 'Projects', 'island-survival', 'Content'));
}

// server config dir (AI settings are stored here at runtime)
fs.mkdirSync(path.join(staging, 'Server'), { recursive: true });

// app manifest — deps are installed into the staging so the packaged app is self-contained
fs.writeFileSync(path.join(staging, 'package.json'), JSON.stringify({
  name: 'nexus-game-studio',
  productName: PRODUCT_NAME,
  version: '1.0.0',
  description: 'AI-powered 3D game development environment',
  main: 'electron/main.cjs',
  dependencies: { express: '^4.21.2', multer: '^1.4.5-lts.1' },
  devDependencies: { electron: ELECTRON_VERSION },
}, null, 2));

console.log('[3/4] Installing server dependencies into staging…');
run('npm install --omit=dev --no-audit --no-fund', { cwd: staging });

console.log('[4/4] Packaging ' + APP_NAME + '.exe…');
fs.rmSync(outDir, { recursive: true, force: true });
// --no-prune: our staging install is already production-only; galactus's
  // node_modules walk is what crashes packaging on Windows.
  run(`npx electron-packager "${staging}" "${APP_NAME}" --platform=win32 --arch=x64 --out="${outDir}" --overwrite --no-prune`);

console.log(`
── PACKAGING COMPLETE ──
Output: dist/nexus-editor-package/${APP_NAME}-win32-x64/${APP_NAME}.exe

The app bundles the editor, engine, server, AI agent and the Island Survival
sample project — fully offline. Projects are saved in Projects/ next to the app.
`);
