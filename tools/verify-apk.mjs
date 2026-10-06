/* ============================================================
   tools/verify-apk.mjs
   Independent verification of Botola25.apk. Nothing here trusts
   build-apk.mjs: the archive is re-parsed, every digest recomputed,
   the signature re-verified by openssl, and the binary manifest and
   resource table decoded from scratch.

   If any check fails the APK will not install on a phone.
   ============================================================ */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { readZip } from './apk/zip.mjs';
import { decodeManifest, decodePool } from './apk/axml.mjs';
import { verifyHeader, describe, adler32 } from './apk/dex.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const APK = join(root, process.argv[2] || 'Botola25.apk');

let fails = 0, checks = 0;
const ok = (m) => { checks++; console.log('  ✅ ' + m); };
const bad = (m) => { checks++; fails++; console.log('  ❌ ' + m); };
const test = (cond, m, extra = '') => (cond ? ok(m + (extra ? ' — ' + extra : '')) : bad(m + (extra ? ' — ' + extra : '')));
const section = (s) => console.log('\n\x1b[1m' + s + '\x1b[0m');

if (!existsSync(APK)) { console.error('no APK at ' + APK); process.exit(1); }
const raw = readFileSync(APK);
console.log(`\nverifying ${APK}  (${(raw.length / 1024).toFixed(0)} KB)`);

/* ---------------- 1. ZIP ---------------- */
section('1  archive');
let zip;
try { zip = readZip(raw); ok(`zip parses, ${Object.keys(zip).length} entries`); }
catch (e) { bad('zip does not parse: ' + e.message); process.exit(1); }
for (const [n, e] of Object.entries(zip)) {
  const crc = createHash('sha256').update(e.data).digest('hex').slice(0, 8);
  if (e.data.length !== e.size) bad(`${n}: inflated ${e.data.length} != declared ${e.size}`);
  else console.log(`     ${n.padEnd(38)} ${String(e.data.length).padStart(8)} B  ${e.method === 8 ? 'deflate' : 'store'}  sha256:${crc}`);
}
test(Object.keys(zip).every((n) => zip[n].data.length === zip[n].size), 'every entry inflates to its declared size');

/* ---------------- 2. no APK Signing Block ---------------- */
section('2  signature scheme');
test(raw.indexOf(Buffer.from('APK Sig Block 42')) === -1,
  'no APK Signature Scheme v2/v3 block present',
  'a broken v2 block makes Android reject the install outright');
const sigFiles = Object.keys(zip).filter((n) => n.startsWith('META-INF/'));
test(sigFiles.length === 3, 'v1 (JAR) signature files present', sigFiles.join(', '));

/* ---------------- 3. AndroidManifest.xml ---------------- */
section('3  AndroidManifest.xml (binary AXML)');
const mf = decodeManifest(zip['AndroidManifest.xml'].data);
const get = (el, k) => mf.find((n) => n.el === el)?.attrs?.[k];
console.log('     ' + mf.map((n) => `<${n.el}>`).join(' '));
test(get('manifest', 'package') === 'com.neurio.botola25', 'package', String(get('manifest', 'package')));
test(get('application', 'label') === 'Botola 25', 'application label', String(get('application', 'label')));
test(get('activity', 'name') === '.MainActivity', 'launcher activity', String(get('activity', 'name')));
test(Number(get('uses-sdk', 'minSdkVersion')) === 21, 'minSdkVersion', String(get('uses-sdk', 'minSdkVersion')));
test(Number(get('uses-sdk', 'targetSdkVersion')) === 29, 'targetSdkVersion ≤ 29 so v1-only signing is accepted',
  String(get('uses-sdk', 'targetSdkVersion')));
test(get('action', 'name') === 'android.intent.action.MAIN', 'intent action MAIN', String(get('action', 'name')));
test(get('category', 'name') === 'android.intent.category.LAUNCHER', 'intent category LAUNCHER',
  String(get('category', 'name')));
test(get('application', 'icon') === '@0x7f010000', 'icon reference', String(get('application', 'icon')));
test(get('application', 'theme') === '@0x1030007', 'theme reference', String(get('application', 'theme')));

/* ---------------- 4. resources.arsc ---------------- */
section('4  resources.arsc');
const arsc = zip['resources.arsc'].data;
let o = 12, pkgName = null, paths = null;
while (o < arsc.length) {
  const t = arsc.readUInt16LE(o), sz = arsc.readUInt32LE(o + 4);
  if (t === 0x0001 && paths === null) paths = decodePool(arsc, o);
  if (t === 0x0200) pkgName = arsc.slice(o + 12, o + 268).toString('utf16le').replace(/\0.*$/, '');
  o += sz;
}
test(pkgName === 'com.neurio.botola25', 'package name in the resource table', String(pkgName));
test(!!paths && paths.length === 5, 'resource file paths', String(paths && paths.length));
for (const p of paths || []) test(!!zip[p], 'resource file is in the archive', p);

/* ---------------- 5. classes.dex ---------------- */
section('5  classes.dex');
const dex = zip['classes.dex'].data;
const h = verifyHeader(dex);
test(dex.slice(0, 8).equals(Buffer.from('6465780a30333500', 'hex')), 'DEX magic');
test(h.okSha, 'DEX SHA-1 signature in the header matches bytes[32:]');
test(h.okCrc, 'DEX adler32 checksum matches bytes[12:]', '0x' + dex.readUInt32LE(8).toString(16) + ' vs 0x' + adler32(dex.slice(12)).toString(16));
test(h.size === h.actual, 'DEX file_size field', `${h.size}`);
const di = describe(dex);
test(di.classNames.includes('Lcom/neurio/botola25/MainActivity;'), 'activity class matches the manifest',
  di.classNames.join(', '));
test(!di.classNames.some((c) => c.includes('bashbaqi')), 'no leftover class from the previous app');
test(di.hasWebView, 'loads android.webkit.WebView');
test(di.hasAssetUrl, 'loads file:///android_asset/game.html');

/* ---------------- 6. v1 signature, recomputed ---------------- */
section('6  v1 (JAR) signature');
const MFb = zip['META-INF/MANIFEST.MF'].data;
const SFname = sigFiles.find((n) => n.endsWith('.SF'));
const RSAname = sigFiles.find((n) => n.endsWith('.RSA'));
const SFb = zip[SFname].data;
const RSAb = zip[RSAname].data;

const parseMF = (buf) => {
  const map = new Map();
  for (const blk of buf.toString('binary').split('\r\n\r\n')) {
    if (!blk.trim()) continue;
    const kv = {};
    for (const l of blk.split('\r\n')) { const i = l.indexOf(': '); if (i > 0) kv[l.slice(0, i)] = l.slice(i + 2); }
    map.set(kv.Name || '__main__', { kv, raw: blk + '\r\n\r\n' });
  }
  return map;
};
const MF = parseMF(MFb), SF = parseMF(SFb);

const signed = Object.keys(zip).filter((n) => !n.startsWith('META-INF/'));
test(signed.every((n) => MF.has(n)), 'MANIFEST.MF covers every entry');
let dOk = 0;
for (const n of signed) {
  const want = MF.get(n)?.kv?.['SHA-256-Digest'];
  const got = createHash('sha256').update(zip[n].data).digest('base64');
  if (want === got) dOk++;
}
test(dOk === signed.length, `MANIFEST.MF SHA-256 digests recomputed and matched (${dOk}/${signed.length})`);

const wantM = SF.get('__main__')?.kv?.['SHA-256-Digest-Manifest'];
const gotM = createHash('sha256').update(MFb).digest('base64');
test(wantM === gotM, '.SF digest of the whole MANIFEST.MF matches');

let sOk = 0;
for (const [n, v] of SF) {
  if (n === '__main__') continue;
  const got = createHash('sha256').update(Buffer.from(MF.get(n).raw, 'binary')).digest('base64');
  if (v.kv['SHA-256-Digest'] === got) sOk++;
}
test(sOk === signed.length, `.SF per-section digests recomputed and matched (${sOk}/${signed.length})`);
test(!SF.get('__main__')?.kv?.['X-Android-APK-Signed'],
  'no X-Android-APK-Signed claim (that attribute would promise a v2/v3 block we do not ship)');

/* the RSA signature itself, verified by openssl against the embedded cert */
const tmp = join(process.env.TMPDIR || '/tmp', `verify-${process.pid}`);
writeFileSync(tmp + '.rsa', RSAb);
writeFileSync(tmp + '.sf', SFb);
let sigOk = false, sigOut = '';
try {
  sigOut = execFileSync('openssl', ['cms', '-verify', '-inform', 'DER', '-in', tmp + '.rsa',
    '-content', tmp + '.sf', '-noverify'], { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 24 }).toString('binary');
  sigOk = sigOut === SFb.toString('binary');
} catch (e) { sigOut = (e.stderr || e.message || '').toString().slice(0, 200); }
test(sigOk, 'PKCS#7 signature over the .SF verifies with openssl', sigOk ? 'content returned identical' : sigOut);

const certInfo = execFileSync('openssl', ['pkcs7', '-inform', 'DER', '-in', tmp + '.rsa', '-print_certs', '-noout'],
  { encoding: 'utf8' }).trim();
console.log('     embedded cert: ' + certInfo.split('\n')[0].replace('subject=', ''));
test(/CN\s*=\s*Botola 25/.test(certInfo), 'the signing certificate is embedded in the .RSA');

/* ---------------- 7. the payload is really the game ---------------- */
section('7  payload');
const html = zip['assets/game.html'].data.toString('utf8');
test(html.length > 900000, 'game.html is the full inlined build', `${(html.length / 1024).toFixed(0)} KB`);
test(!html.includes('src="src/main.js"'), 'no external script reference (WebView cannot load ES modules from file://)');
test(!html.includes('href="src/style.css"'), 'no external stylesheet reference');
test(html.includes('createRenderer') && html.includes('stepMatch'), 'engine + renderer are inside the bundle');
test(!/<script[^>]*type=["']module["']/.test(html), 'the bundle is a classic script, not a module');

section('result');
console.log(fails === 0
  ? `\n✅ ${checks} CHECKS PASSED — ${APK} is structurally a valid, v1-signed, installable APK`
  : `\n❌ ${fails}/${checks} CHECKS FAILED`);
process.exit(fails ? 1 : 0);
