/* ============================================================
   tools/build-apk.mjs  —  builds a real, installable .apk with no
   Android SDK, no Gradle and no Java.

   What it assembles:
     AndroidManifest.xml   binary AXML written by tools/apk/axml.mjs
     resources.arsc        the reference table, package name patched
     res/mipmap-…/ic_launcher.png   icons drawn by tools/make-icons.mjs
     assets/game.html      the whole game inlined (single-file build)
     classes.dex           D8-compiled WebView shell, class renamed
     META-INF/…            v1 (JAR) signature via openssl

   Then tools/verify-apk.mjs proves the result is sound.
   ============================================================ */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { encodeManifest } from './apk/axml.mjs';
import { buildZip } from './apk/zip.mjs';
import { ensureKeystore, signV1, certSubject } from './apk/sign.mjs';
import { loadShell, patchClass, describe, verifyHeader } from './apk/dex.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = {
  id: 'com.neurio.botola25',
  label: 'Botola 25',
  versionCode: 1,
  versionName: '1.0',
  minSdk: 21,          // Android 5.0
  targetSdk: 29,       // v1-only signing is accepted up to targetSdk 29
  shellClassFrom: 'Lcom/bashbaqi/racing/MainActivity;',
  out: 'Botola25.apk',
};

const step = (s) => console.log('\n\x1b[1m' + s + '\x1b[0m');

/* ---------- 1. the game, as one file ---------- */
step('1/6  single-file build');
if (!existsSync(join(root, 'build/game.html'))) console.log('  build/game.html missing — generating');
execFileSync(process.execPath, [join(root, 'tools/build-singlefile.mjs')], { stdio: 'inherit' });
const gameHtml = readFileSync(join(root, 'build/game.html'));

/* ---------- 2. icons ---------- */
step('2/6  icons');
execFileSync(process.execPath, [join(root, 'tools/make-icons.mjs')], { stdio: 'inherit' });

/* ---------- 3. binary AndroidManifest.xml ---------- */
step('3/6  AndroidManifest.xml (binary AXML)');
const manifest = encodeManifest({
  pkg: APP.id,
  label: APP.label,
  activity: '.MainActivity',
  minSdk: APP.minSdk,
  targetSdk: APP.targetSdk,
  versionCode: APP.versionCode,
  versionName: APP.versionName,
});
console.log(`  ${manifest.length} bytes, package=${APP.id}, targetSdk=${APP.targetSdk}`);

/* ---------- 4. resources.arsc (reference table, package patched) ---------- */
step('4/6  resources.arsc');
const arscTmpl = readFileSync(join(root, 'tools/apk/resources.arsc'));
const arsc = patchArscPackage(arscTmpl, APP.id);
console.log(`  package field rewritten → ${APP.id} (${arsc.length} bytes, size unchanged: ${arsc.length === arscTmpl.length})`);

function patchArscPackage(buf, name) {
  const out = Buffer.from(buf);
  let o = 12;                                   // skip the table header
  while (o < out.length) {
    const type = out.readUInt16LE(o);
    const size = out.readUInt32LE(o + 4);
    if (type === 0x0200) {                      // RES_TABLE_PACKAGE
      const field = o + 12;
      if (field + 256 > out.length) throw new Error('arsc: package name field out of range');
      out.fill(0, field, field + 256);
      out.write(name, field, 256, 'utf16le');
      return out;
    }
    o += size;
  }
  throw new Error('arsc: no package chunk found');
}

/* ---------- 5. classes.dex ---------- */
step('5/6  classes.dex (WebView shell)');
const shell = loadShell(join(root, 'tools/apk/webview-shell.dex'));
const newDesc = 'L' + APP.id.replace(/\./g, '/') + '/MainActivity;';
const dex = patchClass(shell, APP.shellClassFrom, newDesc);
const info = describe(dex);
const hdr = verifyHeader(dex);
if (!hdr.okSha || !hdr.okCrc) throw new Error('dex: header checksums did not verify after patching');
if (hdr.size !== hdr.actual) throw new Error(`dex: file_size ${hdr.size} != ${hdr.actual}`);
console.log(`  class → ${newDesc}`);
console.log(`  dex v${info.version} · ${info.strings} strings · ${info.classes} class · WebView=${info.hasWebView} · assetUrl=${info.hasAssetUrl}`);
console.log(`  header adler32+sha1 recomputed ✓`);

/* ---------- 6. zip + v1 signature ---------- */
step('6/6  package + sign');
const iconEntry = (density) => ({
  name: `res/mipmap-${density}-v4/ic_launcher.png`,
  data: readFileSync(join(root, `res-mipmap-${density}/ic_launcher.png`)),
  store: true,
});
const payload = [
  { name: 'AndroidManifest.xml', data: manifest, store: true },
  iconEntry('mdpi'), iconEntry('hdpi'), iconEntry('xhdpi'), iconEntry('xxhdpi'), iconEntry('xxxhdpi'),
  { name: 'resources.arsc', data: arsc, store: true },
  { name: 'assets/game.html', data: gameHtml },
  { name: 'classes.dex', data: dex, store: true },
];
const ks = ensureKeystore(join(root, 'tools/apk/keystore'),
  '/C=MA/O=Neurio/OU=Games/CN=Botola 25');
if (ks.created) console.log('  generated a fresh self-signed release key (tools/apk/keystore, git-ignored)');
console.log('  signer: ' + certSubject(ks.cert));

const sig = signV1(payload, ks);
const apk = buildZip([...payload, ...sig]);
const outPath = join(root, APP.out);
writeFileSync(outPath, apk);
console.log(`  ${payload.length + sig.length} entries, ${(apk.length / 1024).toFixed(0)} KB`);
console.log(`\n✅ wrote ${APP.out}`);
console.log('   → run:  node tools/verify-apk.mjs');
