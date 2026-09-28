// Builds freefire/BOOYAH-FIRE.apk from BashBaqiRacing.apk (the repo's reference
// APK). No Android SDK: the ZIP is assembled and signed here, the binary
// manifest/resources are re-branded by tools/axml.mjs.
//
//   node tools/build-apk.mjs [--out BOOYAH-FIRE.apk]
//
// The launcher activity stays com.bashbaqi.racing.MainActivity (that class is the
// WebView shell compiled into classes.dex), so only the app's package name, label
// and icon change — the APK installs as its own app, next to the racing game.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import { parseZip, entryData, signApk, verifyV1, verifyV2, makeIdentity } from './apk-sign.mjs';
import { patchAxml, axmlStrings, arscPackageName, patchArscPackageName } from './axml.mjs';
import { drawIcon, encodePNG } from './icon-art.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const TEMPLATE = path.join(root, '..', 'BashBaqiRacing.apk');
const KEYSTORE = path.join(root, 'android', 'keystore');

export const APP = {
  id: 'com.booyah.fire',
  label: 'BOOYAH FIRE',
  versionName: '1.0',
  activity: 'com.bashbaqi.racing.MainActivity',   // lives in the template's classes.dex
};

// ── the game, as one self-contained HTML file ───────────────────────────────
// The WebView loads file:///android_asset/game.html, so everything (script, CSS,
// favicon) is inlined: no import map, no module loading, no relative fetches.
export function bundleGame() {
  const r = buildSync({
    entryPoints: [path.join(root, 'src', 'main.js')],
    bundle: true,
    format: 'iife',
    write: false,
    logLevel: 'silent',
    alias: {
      three: path.join(root, 'vendor', 'three.module.js'),
      'three/addons/utils/BufferGeometryUtils.js': path.join(root, 'vendor', 'utils', 'BufferGeometryUtils.js'),
    },
  });
  return r.outputFiles[0].text;
}

export function inlineGameHtml({ minify = false } = {}) {
  let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'src', 'style.css'), 'utf8');
  const js = bundleGame();
  const icon = fs.readFileSync(path.join(root, 'icons', 'icon-192.png')).toString('base64');

  const swap = (from, to, why) => {
    if (!html.includes(from)) throw new Error(`index.html changed — cannot inline ${why}`);
    html = html.replace(from, to);
  };
  swap('<link rel="manifest" href="manifest.webmanifest">\n', '', 'the manifest link');
  swap('<link rel="apple-touch-icon" href="icons/icon-192.png">\n', '', 'the apple-touch-icon link');
  swap('<link rel="icon" href="icons/icon-192.png" type="image/png">',
    `<link rel="icon" href="data:image/png;base64,${icon}" type="image/png">`, 'the favicon');
  swap('<link rel="stylesheet" href="src/style.css">', `<style>\n${css}\n</style>`, 'the stylesheet');
  const map = html.match(/<script type="importmap">[\s\S]*?<\/script>\n/);
  if (!map) throw new Error('index.html changed — no import map to drop');
  html = html.replace(map[0], '');
  swap('<script type="module" src="src/main.js"></script>', `<script>${js}</script>`, 'the game script');
  return html;
}

// ── icons ───────────────────────────────────────────────────────────────────
function mipmapEntries(templateZip, tpl) {
  const out = [];
  for (const e of templateZip.entries) {
    if (!/^res\/mipmap-.*ic_launcher\.png$/.test(e.name)) continue;
    const png = entryData(tpl, e);
    const size = png.readUInt32BE(16);            // IHDR width
    out.push({ name: e.name, data: encodePNG(drawIcon(size, false).px, size, size), size });
  }
  return out;
}

// ── the APK ─────────────────────────────────────────────────────────────────
export function buildApk({ out = path.join(root, 'BOOYAH-FIRE.apk'), quiet = false } = {}) {
  if (!fs.existsSync(TEMPLATE)) throw new Error(`reference APK missing: ${TEMPLATE}`);
  const tpl = fs.readFileSync(TEMPLATE);
  const zip = parseZip(tpl);
  const byName = new Map(zip.entries.map((e) => [e.name, e]));

  // 1. re-brand the binary manifest: package, label, and a fully-qualified
  //    activity name (".MainActivity" would resolve against the new package)
  const manifestIn = entryData(tpl, byName.get('AndroidManifest.xml'));
  const renames = {
    'com.bashbaqi.racing': APP.id,
    'Bash Baqi Racing': APP.label,
    '.MainActivity': APP.activity,
  };
  const manifest = patchAxml(manifestIn, (s) => renames[s]);
  const found = axmlStrings(manifest);
  for (const want of [APP.id, APP.label, APP.activity]) {
    if (!found.includes(want)) throw new Error(`manifest rewrite lost ${want}`);
  }

  // 2. the resource table keeps the package name in a fixed header field
  const arscIn = entryData(tpl, byName.get('resources.arsc'));
  const arsc = patchArscPackageName(arscIn, APP.id);
  if (arscPackageName(arsc) !== APP.id) throw new Error('resources.arsc rewrite failed');
  if (arsc.length !== arscIn.length) throw new Error('resources.arsc changed length');

  // 3. our game, our icon, everything else straight from the template
  const replaced = new Map([
    ['AndroidManifest.xml', manifest],
    ['resources.arsc', arsc],
    ['assets/game.html', Buffer.from(inlineGameHtml(), 'utf8')],
    ...mipmapEntries(zip, tpl).map((m) => [m.name, m.data]),
  ]);

  const entries = zip.entries
    .filter((e) => !e.name.startsWith('META-INF/'))          // signatures are rebuilt
    .map((e) => ({
      name: e.name,
      data: replaced.get(e.name) || entryData(tpl, e),
      // stored + 4-byte aligned (an uncompressed dex must be mmap-able, and
      // zipalign wants every stored entry aligned)
      store: /\.arsc$|\.png$|\.dex$/.test(e.name),
      align: /\.arsc$|\.png$|\.dex$/.test(e.name) ? 4 : 1,
    }));

  // 4. sign (v1 + v2) with a key that is reused across builds, so a rebuilt APK
  //    still upgrades the installed one
  fs.mkdirSync(KEYSTORE, { recursive: true });
  const keyPath = path.join(KEYSTORE, 'booyah-fire.key.pem');
  const certPath = path.join(KEYSTORE, 'booyah-fire.cert.pem');
  let identity;
  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    identity = makeIdentity({ keyPem: fs.readFileSync(keyPath, 'utf8'), certPem: fs.readFileSync(certPath, 'utf8') });
  } else {
    identity = makeIdentity({ commonName: APP.label });
    fs.writeFileSync(keyPath, identity.keyPem);
    fs.writeFileSync(certPath, identity.certPem);
  }

  const apk = signApk({ entries, identity, v1: true, v2: true });
  const v1 = verifyV1(apk);
  const v2 = verifyV2(apk);
  if (!v1.ok || !v2.ok) throw new Error(`self-check failed — v1 ${v1.reason}; v2 ${v2.reason}`);

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, apk);

  const info = {
    out, bytes: apk.length,
    package: APP.id, label: APP.label, activity: APP.activity,
    versionName: APP.versionName,
    entries: entries.length + 3,   // + MANIFEST.MF, CERT.SF, CERT.RSA
    gameHtmlBytes: replaced.get('assets/game.html').length,
    icons: mipmapEntries(zip, tpl).map((m) => `${m.size}px`).join(' '),
    signer: v2.signer, signerValid: `${v1.files} v1 files · v2 block ${v2.blockSize} B`,
  };
  if (!quiet) {
    console.log(`BOOYAH FIRE → ${out}`);
    console.log(`  ${(apk.length / 1048576).toFixed(2)} MB · ${info.entries} entries · game ${(info.gameHtmlBytes / 1024).toFixed(0)} kB · icons ${info.icons}`);
    console.log(`  ${info.package} · "${info.label}" · ${info.activity}`);
    console.log(`  signed: v1 ${v1.files} files + v2 (${info.signer}) — verified`);
  }
  return info;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const i = process.argv.indexOf('--out');
  const info = buildApk({ out: i > 0 ? path.resolve(process.argv[i + 1]) : undefined });
  void info;
}
