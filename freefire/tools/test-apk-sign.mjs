// ── regression tests for the APK toolchain (no Android SDK, no device) ───────
// BashBaqiRacing.apk is a real apksigner-signed APK, so it doubles as the test
// vector: if our v1/v2 verifier accepts it, the byte-level wire format is right.
// Everything else is round-tripped through our own signer and re-verified.
//
//   node tools/test-apk-sign.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import forge from 'node-forge';
import {
  parseZip, entryData, signApk, verifyV1, verifyV2, makeIdentity, parseSigningBlock, v2Digests,
} from './apk-sign.mjs';
import { patchAxml, axmlStrings, arscPackageName, patchArscPackageName, rewriteChunks, findPackageChunk } from './axml.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const TEMPLATE = path.join(root, '..', 'BashBaqiRacing.apk');
const BUILT = path.join(root, 'BOOYAH-FIRE.apk');

// ── helpers for the writer invariants ───────────────────────────────────────
function localExtraOf(apk, name) {
  const lh = parseZip(apk).entries.find((e) => e.name === name);
  const start = lh.headerOffset ?? lh.localOffset;
  const nl = apk.readUInt16LE(start + 26);
  const el = apk.readUInt16LE(start + 28);
  return apk.subarray(start + 30 + nl, start + 30 + nl + el);
}

// read the v2 signer blob and pull out the interesting bits
function v2SignerKey(apk) {
  const block = parseSigningBlock(apk);
  const value = block.pairs.find((p) => p.id === 0x7109871a).value;
  const lp = (b, o) => { const n = b.readUInt32LE(o); return [b.subarray(o + 4, o + 4 + n), o + 4 + n]; };
  const [signers] = lp(value, 0);
  const [signer] = lp(signers, 0);
  const [signedData, afterSd] = lp(signer, 0);
  const [digests] = lp(signedData, 0);
  const [digestEntry] = lp(digests, 0);
  const [, p1] = lp(signedData, 0);
  const [certs, p2] = lp(signedData, p1);
  const [certDer] = lp(certs, 0);
  const [attrs] = lp(signedData, p2);
  let protection = false, off = 0;
  while (off < attrs.length) {
    const [item, next] = lp(attrs, off);
    if (item.readUInt32LE(0) === 0xbeeff00d) protection = true;
    off = next;
  }
  const [, afterSigs] = lp(signer, afterSd);
  const [publicKeys] = lp(signer, afterSigs);
  const [inner] = lp(publicKeys, 0);
  const spki = crypto.createPublicKey(forge.pki.certificateToPem(
    forge.pki.certificateFromAsn1(forge.asn1.fromDer(certDer.toString('binary')))))
    .export({ type: 'spki', format: 'der' });
  return { protection, digestAlg: digestEntry.readUInt32LE(4 * 0 + 0), spkiMatchesCert: inner.equals(spki) };
}


let fails = 0;
const fail = (m) => { fails++; console.log('  ✗ ' + m); };
const step = (m) => console.log('  ✓ ' + m);
const check = (ok, m) => (ok ? step(m) : fail(m));
const eq = (a, b, m) => check(a === b, `${m} (${JSON.stringify(a)})`);

console.log('\nAPK signing toolchain');

// ── 1. the real apksigner-signed template ───────────────────────────────────
const tpl = fs.readFileSync(TEMPLATE);
{
  const v1 = verifyV1(tpl);
  const v2 = verifyV2(tpl);
  check(v1.ok, `template v1 verifies — ${v1.files} files, signer ${v1.signer}`);
  check(v2.ok, `template v2 verifies — ${v2.signer}, block ${v2.blockSize} B`);
  eq(v1.signer, 'Bash Baqi Racing', 'template v1 signer');
  eq(v2.signer, 'Bash Baqi Racing', 'template v2 signer');
  eq(v2.extraBlocks.join(','), 'f05368c0,42726577', 'template extra v2 pairs (v3 + padding)');
}

// ── 2. AXML: a faithful encoder plus the re-branding rewrite ────────────────
{
  const manifest = entryData(tpl, parseZip(tpl).entries.find((e) => e.name === 'AndroidManifest.xml'));
  const same = patchAxml(manifest, (s) => s);
  check(same.equals(manifest), 're-encoding an untouched AXML pool is byte-identical');

  const renames = {
    'com.bashbaqi.racing': 'com.booyah.fire',
    'Bash Baqi Racing': 'BOOYAH FIRE',
    '.MainActivity': 'com.bashbaqi.racing.MainActivity',
  };
  const renamed = patchAxml(manifest, (s) => renames[s]);
  const strings = axmlStrings(renamed);
  check(strings.includes('com.booyah.fire'), 'manifest pool carries the new package');
  check(strings.includes('BOOYAH FIRE'), 'manifest pool carries the new label');
  check(strings.includes('com.bashbaqi.racing.MainActivity'), 'activity name is fully qualified');
  check(!strings.includes('com.bashbaqi.racing'), 'old package name is gone from the pool');
  eq(renamed.readUInt32LE(4), renamed.length, 'root chunk size tracks the file length');
  eq(rewriteChunks(renamed, 0, (s) => s).equals(renamed), true, 'renamed manifest round-trips too');

  // the resource table keeps the package name in a fixed field; patching it must
  // not disturb the package id or the file length
  const arsc = entryData(tpl, parseZip(tpl).entries.find((e) => e.name === 'resources.arsc'));
  eq(arscPackageName(arsc), 'com.bashbaqi.racing', 'resources.arsc package name');
  const patched = patchArscPackageName(arsc, 'com.booyah.fire');
  eq(arscPackageName(patched), 'com.booyah.fire', 'resources.arsc renamed');
  eq(patched.length, arsc.length, 'resources.arsc length unchanged');
  eq(patched.readUInt32LE(findPackageChunk(patched) + 8), 0x7f, 'resources.arsc package id preserved');
  eq([...patched].filter((b, i) => b !== arsc[i]).length, 13, 'only the name bytes changed');
}

// ── 3. sign → verify, and tamper detection ──────────────────────────────────
{
  const identity = makeIdentity({ commonName: 'BOOYAH FIRE TEST' });
  check(identity.certDer.length > 500, `generated a ${identity.certDer.length} B RSA-2048 certificate`);
  const entries = [
    { name: 'AndroidManifest.xml', data: Buffer.from('manifest bytes') },
    { name: 'resources.arsc', data: Buffer.alloc(4096, 7), store: true, align: 4 },
    { name: 'assets/game.html', data: Buffer.from('<html>' + 'y'.repeat(1200000) + '</html>') },
    { name: 'classes.dex', data: Buffer.alloc(2368, 3), store: true, align: 4 },
  ];
  const apk = signApk({ entries, identity });
  const v1 = verifyV1(apk);
  const v2 = verifyV2(apk);
  check(v1.ok, `signed with own key — v1 verifies (${v1.files} files)`);
  check(v2.ok, `signed with own key — v2 verifies (${v2.signer})`);
  eq(v2.signer, 'BOOYAH FIRE TEST', 'v2 signer is our certificate');
  check(v2Digests(apk, parseSigningBlock(apk).blockStart, parseSigningBlock(apk).size).chunks > 1,
    'content digest spans multiple 1 MB chunks');
  eq(parseZip(apk).entries.length, entries.length + 3, 'v1 adds MANIFEST.MF + CERT.SF + CERT.RSA');
  const arscEntry = parseZip(apk).entries.find((e) => e.name === 'resources.arsc');
  eq(arscEntry.dataOffset % 4, 0, 'stored entries stay 4-byte aligned');
  eq(arscEntry.extra.subarray(0, 2).readUInt16LE(0), 0xd935, 'alignment is recorded as a 0xd935 extra field');
  eq(arscEntry.extra.readUInt16LE(4), 4, 'the extra field names the 4-byte alignment');
  eq(localExtraOf(apk, arscEntry.name).equals(arscEntry.extra), true, 'local and central headers carry the same extra field');
  check(parseZip(apk).entries.every((e) => (e.flags & 0x0800) !== 0 && e.lFlags === e.flags),
    'every entry is flagged as UTF-8 named, in both headers');

  // the signer's public-keys field must carry the certificate's own key: senders
  // and verifiers disagree here, and a mismatch makes the installer reject the APK
  const key = v2SignerKey(apk);
  check(key.spkiMatchesCert, 'signer public key matches the certificate');
  check(key.protection, 'signed data carries the 0xbeeff00d stripping-protection attribute');
  eq(key.digestAlg, 0x0103, 'content digest algorithm is RSASSA-PKCS1-v1_5 SHA-256');

  // flip one byte inside assets/game.html → both schemes must reject the file
  const victim = parseZip(apk).entries.find((e) => e.name === 'classes.dex');
  const tampered = Buffer.from(apk);
  tampered[victim.dataOffset] ^= 0xff;
  check(!verifyV1(tampered).ok, 'v1 rejects a modified file');
  check(!verifyV2(tampered).ok, 'v2 rejects a modified file');

  // and a byte in the central directory (outside every file) breaks v2 only
  const eocd = apk.length - 22;
  const cdTamper = Buffer.from(apk);
  cdTamper[eocd - 40] ^= 0x01;
  check(!verifyV2(cdTamper).ok, 'v2 rejects a modified central directory');

  // same key twice → same certificate, so rebuilt APKs stay upgrade-installable
  const again = signApk({ entries, identity: makeIdentity({ keyPem: identity.keyPem, certPem: identity.certPem }) });
  eq(verifyV2(again).signer, 'BOOYAH FIRE TEST', 'a reloaded identity signs identically');
}

// ── 4. the shipped APK ──────────────────────────────────────────────────────
if (fs.existsSync(BUILT)) {
  const apk = fs.readFileSync(BUILT);
  const zip = parseZip(apk);
  const name = (n) => zip.entries.find((e) => e.name === n);
  const v1 = verifyV1(apk);
  const v2 = verifyV2(apk);
  check(v1.ok && v2.ok, `BOOYAH-FIRE.apk verifies — v1 ${v1.files} files + v2 (${v2.signer})`);
  eq(v2.signer, 'BOOYAH FIRE', 'shipped APK signer');

  const strings = axmlStrings(entryData(apk, name('AndroidManifest.xml')));
  check(strings.includes('com.booyah.fire'), 'shipped package is com.booyah.fire');
  check(strings.includes('BOOYAH FIRE'), 'shipped label is BOOYAH FIRE');
  check(strings.includes('com.bashbaqi.racing.MainActivity'), 'shipped activity points at the WebView shell');
  eq(arscPackageName(entryData(apk, name('resources.arsc'))), 'com.booyah.fire', 'shipped arsc package');

  const html = entryData(apk, name('assets/game.html')).toString('utf8');
  check(html.length > 1500000, `shipped game.html is self-contained (${(html.length / 1024).toFixed(0)} kB)`);
  check(!html.includes('importmap') && !html.includes('src="src/main.js"'), 'no module loading left in the WebView build');
  check(html.includes('<style>') && html.includes('<link rel="icon" href="data:image/png;base64,'), 'CSS and favicon inlined');
  check(html.includes('id="app"') && html.includes('id="loading"'), 'game markup preserved');

  const icons = zip.entries.filter((e) => /mipmap.*ic_launcher\.png$/.test(e.name));
  eq(icons.length, 5, 'five launcher icon densities');
  const widths = icons.map((e) => entryData(apk, e).readUInt32BE(16)).join(',');
  eq(widths, '48,72,96,144,192', 'icon sizes match their density folders');
  check(!zip.entries.some((e) => /BASHBAQI/.test(e.name)), 'old v1 signature files dropped');
  check(zip.entries.every((e) => e.method !== 0 || e.dataOffset % 4 === 0), 'every stored entry is 4-byte aligned');

  const dex = entryData(apk, name('classes.dex'));
  check(dex.equals(entryData(tpl, parseZip(tpl).entries.find((e) => e.name === 'classes.dex'))),
    'dex (the WebView shell) is untouched');
} else {
  console.log('  · BOOYAH-FIRE.apk not built — run `npm run build:apk` for the end-to-end checks');
}

console.log(fails ? `\n${fails} check(s) failed\n` : '\nall APK checks passed\n');
process.exit(fails ? 1 : 0);
