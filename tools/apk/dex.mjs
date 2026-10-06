/* ============================================================
   tools/apk/dex.mjs
   The APK needs one tiny class: an Activity that opens a WebView
   on file:///android_asset/game.html. That DEX (built with D8) is
   kept as tools/apk/webview-shell.dex; here we rename its class to
   this app's package and recompute the header checksums ART checks.

   DEX header:
     0  magic  "dex\n035\0"
     8  adler32 checksum  of bytes[12:]
    12  SHA-1 signature    of bytes[32:]
    32  file_size
   ============================================================ */

import { readFileSync } from 'node:fs';

const MAGIC = Buffer.from('6465780a30333500', 'hex');

export function adler32(buf) {
  let a = 1, b = 0;
  for (let i = 0; i < buf.length; i++) {
    a = (a + buf[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

import { createHash } from 'node:crypto';

export function fixHeader(dex) {
  const out = Buffer.from(dex);
  if (!out.slice(0, 8).equals(MAGIC)) throw new Error('not a DEX file');
  createHash('sha1').update(out.slice(32)).digest().copy(out, 12);
  out.writeUInt32LE(adler32(out.slice(12)), 8);
  return out;
}

export function verifyHeader(dex) {
  const sha = createHash('sha1').update(dex.slice(32)).digest();
  const okSha = sha.equals(dex.slice(12, 32));
  const okCrc = dex.readUInt32LE(8) === adler32(dex.slice(12));
  return { okSha, okCrc, size: dex.readUInt32LE(32), actual: dex.length };
}

/** Replace a class descriptor, keeping the byte length identical so no
 *  string-pool offset in the DEX has to move. */
export function patchClass(dex, fromDesc, toDesc) {
  const from = Buffer.from(fromDesc, 'utf8');
  const to = Buffer.from(toDesc, 'utf8');
  if (from.length !== to.length) {
    throw new Error(`class descriptors must be the same length (${fromDesc}=${from.length}, ${toDesc}=${to.length})`);
  }
  const out = Buffer.from(dex);
  const at = out.indexOf(from);
  if (at < 0) throw new Error(`class descriptor not found in DEX: ${fromDesc}`);
  to.copy(out, at);
  return fixHeader(out);
}

/* ---- introspection for the verifier ---- */
export function describe(dex) {
  const u32 = (o) => dex.readUInt32LE(o);
  const stringIdsSize = u32(56);
  const stringIdsOff = u32(60);
  const typeIdsSize = u32(64);
  const methodIdsSize = u32(88 - 4 * 3 + 0); // (kept simple; see classDefs below)
  const classDefsSize = u32(96);
  const strings = [];
  for (let i = 0; i < stringIdsSize; i++) {
    const p = u32(stringIdsOff + i * 4);
    let n = dex[p]; let q = p + 1;
    if (n & 0x80) { n = ((n & 0x7f) << 8) | dex[q]; q++; }
    strings.push(dex.slice(q, q + n).toString('utf8'));
  }
  return {
    version: dex.slice(4, 7).toString('utf8'),
    strings: stringIdsSize,
    types: typeIdsSize,
    classes: classDefsSize,
    classNames: strings.filter((s) => s.startsWith('Lcom/')),
    hasWebView: strings.includes('Landroid/webkit/WebView;'),
    hasAssetUrl: strings.includes('file:///android_asset/game.html'),
  };
  void methodIdsSize;
}

export function loadShell(path) { return readFileSync(path); }
