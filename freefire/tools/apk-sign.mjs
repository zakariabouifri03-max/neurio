// APK container + signature toolbox (pure Node, no Android SDK).
//
// Implements the two signature schemes that matter for sideloading:
//   • v1 (JAR signing)      — MANIFEST.MF / CERT.SF / CERT.RSA
//   • v2 (APK Signing Block) — the format Android 7+ verifies before install
// Both are implemented from the format spec, and `verifyApk()` can read them
// back independently — including APKs signed by Google's apksigner, which is
// how this code was validated (see tools/test-apk-sign.mjs).
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import forge from 'node-forge';

export const SIG_BLOCK_MAGIC = 'APK Sig Block 42';
const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;
const LFH_SIG = 0x04034b50;

// signature algorithm IDs (Android)
export const ALG = { RSASSA_PKCS1V15_SHA256: 0x0103 };

// ── little-endian helpers ───────────────────────────────────────────────────
const u16 = (b, o) => b.readUInt16LE(o);
const u32 = (b, o) => b.readUInt32LE(o);
const u64 = (b, o) => Number(b.readBigUInt64LE(o));

export function u32le(v) { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0); return b; }
export function u64le(v) { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return b; }
// a length-prefixed field: uint32 content length, then the content (the length
// does not include its own four bytes — that is what apksig writes)
export const lenPrefixed = (bufs) => {
  const body = Buffer.concat(bufs);
  return Buffer.concat([u32le(body.length), body]);
};

// ── ZIP reading ─────────────────────────────────────────────────────────────
export function findEOCD(buf) {
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (u32(buf, i) === EOCD_SIG) return i;
  }
  throw new Error('EOCD not found — not a zip/apk');
}

export function parseZip(buf) {
  const eocd = findEOCD(buf);
  const count = u16(buf, eocd + 10);
  const cdSize = u32(buf, eocd + 12);
  const cdOffset = u32(buf, eocd + 16);
  const commentLen = u16(buf, eocd + 20);
  const entries = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (u32(buf, p) !== CD_SIG) throw new Error(`bad central directory record at ${p}`);
    const flags = u16(buf, p + 8);
    const method = u16(buf, p + 10);
    const crc = u32(buf, p + 16);
    const compSize = u32(buf, p + 20);
    const uncompSize = u32(buf, p + 24);
    const nameLen = u16(buf, p + 28);
    const extraLen = u16(buf, p + 30);
    const commentLen2 = u16(buf, p + 32);
    const localOffset = u32(buf, p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const extra = buf.subarray(p + 46 + nameLen, p + 46 + nameLen + extraLen);
    // local header: find the payload
    if (u32(buf, localOffset) !== LFH_SIG) throw new Error(`bad local header for ${name}`);
    const lNameLen = u16(buf, localOffset + 26);
    const lExtraLen = u16(buf, localOffset + 28);
    const dataOffset = localOffset + 30 + lNameLen + lExtraLen;
    const lFlags = u16(buf, localOffset + 6);
    entries.push({ name, flags, lFlags, method, crc, compSize, uncompSize, localOffset, dataOffset, extra, cdRecord: p });
    p += 46 + nameLen + extraLen + commentLen2;
  }
  return { entries, cdOffset, cdSize, eocd, commentLen, comment: buf.subarray(eocd + 22, eocd + 22 + commentLen) };
}

export function entryData(buf, e) {
  const raw = buf.subarray(e.dataOffset, e.dataOffset + e.compSize);
  return e.method === 0 ? raw : zlib.inflateRawSync(raw);
}

// ── APK Signing Block ───────────────────────────────────────────────────────
export function parseSigningBlock(buf) {
  const eocd = findEOCD(buf);
  const magic = Buffer.from(SIG_BLOCK_MAGIC, 'utf8');
  // the magic sits immediately before the central directory (i.e. before EOCD's cd offset)
  const cdOffset = u32(buf, eocd + 16);
  const magicPos = cdOffset - 16;
  if (magicPos < 0 || !buf.subarray(magicPos, magicPos + 16).equals(magic)) return null;
  const size = u64(buf, magicPos - 8);
  const blockStart = magicPos + 16 - 8 - size;
  if (u64(buf, blockStart) !== size) throw new Error('signing block size fields disagree');
  const pairs = [];
  let p = blockStart + 8;
  const end = magicPos - 8;
  while (p < end) {
    const len = u64(buf, p); p += 8;
    const id = u32(buf, p); p += 4;
    pairs.push({ id, value: buf.subarray(p, p + len - 4) });
    p += len - 4;
  }
  return { blockStart, blockEnd: magicPos + 16, size, pairs, position: blockStart };
}

// ── v2 digest computation (byte-for-byte compatible with apksig) ────────────
// All three sections are split into 1 MB chunks and their per-chunk hashes are
// collected into ONE flat list; the final digest is
//     SHA-256( 0x5a || uint32le(chunkCount) || chunkHash1 || chunkHash2 … )
// where each chunk hash is SHA-256( 0xa5 || uint32le(chunkLength) || chunk ).
// The EOCD's "offset of central directory" field is read as the offset of the
// APK Signing Block for this computation. Verified against an APK signed by
// Google's apksigner — see tools/test-apk-sign.mjs.
const CHUNK = 1048576;

export function v2Digests(buf, blockStart, blockSize) {
  const eocd = findEOCD(buf);
  const section3 = Buffer.from(buf.subarray(eocd));
  section3.writeUInt32LE(blockStart, 16);
  const sections = [buf.subarray(0, blockStart), buf.subarray(blockStart + 8 + blockSize, eocd), section3];
  const hashes = [];
  for (const sec of sections) {
    for (let off = 0; off < sec.length; off += CHUNK) {
      const chunk = sec.subarray(off, Math.min(off + CHUNK, sec.length));
      const head = Buffer.alloc(5);
      head[0] = 0xa5;
      head.writeUInt32LE(chunk.length, 1);
      hashes.push(crypto.createHash('sha256').update(head).update(chunk).digest());
    }
  }
  const top = Buffer.alloc(5);
  top[0] = 0x5a;
  top.writeUInt32LE(hashes.length, 1);
  return {
    top: crypto.createHash('sha256').update(top).update(Buffer.concat(hashes)).digest(),
    chunks: hashes.length,
    sections: sections.map((s) => s.length),
  };
}

// ── v2 verification ─────────────────────────────────────────────────────────
// Wire format (confirmed byte-for-byte against an apksigner-signed APK):
// every "length-prefixed" field is `uint32 length` followed by exactly that many
// bytes of content — the length does NOT count its own prefix.
export function parseV2Signers(value) {
  let p = 0;
  const seqLen = u32(value, p); p += 4;
  const seqEnd = p + seqLen;
  const signers = [];
  while (p < seqEnd) {
    const signerLen = u32(value, p); p += 4;
    const signer = value.subarray(p, p + signerLen); p += signerLen;
    let q = 0;
    const sdLen = u32(signer, q); q += 4;
    const signedData = signer.subarray(q, q + sdLen); q += sdLen;

    // digests
    let r = 0;
    const dgLen = u32(signedData, r); r += 4;
    const digests = [];
    const dgEnd = r + dgLen;
    while (r < dgEnd) {
      const eStart = r;
      const eLen = u32(signedData, r); r += 4;
      const alg = u32(signedData, r); r += 4;
      const dl = u32(signedData, r); r += 4;
      digests.push({ alg, digest: signedData.subarray(r, r + dl) });
      r += dl;
      if (r !== eStart + 4 + eLen) throw new Error(`digest entry length mismatch (${eLen} declared, ${r - eStart - 4} consumed)`);
    }
    // certificates
    const certsLen = u32(signedData, r); r += 4;
    const certs = [];
    const certsEnd = r + certsLen;
    while (r < certsEnd) {
      const cl = u32(signedData, r); r += 4;
      certs.push(signedData.subarray(r, r + cl));
      r += cl;
    }
    // attributes
    const attrsLen = u32(signedData, r); r += 4;
    const attributes = signedData.subarray(r, r + attrsLen);

    // signatures
    const sigsLen = u32(signer, q); q += 4;
    const sigs = [];
    const sigsEnd = q + sigsLen;
    while (q < sigsEnd) {
      q += 4;                                  // signature entry length (alg + sig only)
      const alg = u32(signer, q); q += 4;
      const bl = u32(signer, q); q += 4;
      sigs.push({ alg, bytes: signer.subarray(q, q + bl) });
      q += bl;
    }
    // public keys
    const pkLen = u32(signer, q); q += 4;
    const pks = [];
    const pkEnd = q + pkLen;
    while (q < pkEnd) {
      const l = u32(signer, q); q += 4;
      pks.push(signer.subarray(q, q + l));
      q += l;
    }
    signers.push({ signedData, digests, certs, attributes, sigs, publicKeys: pks });
  }
  return signers;
}

export function verifyV2(buf) {
  const block = parseSigningBlock(buf);
  if (!block) return { ok: false, reason: 'no APK Signing Block' };
  const pair = block.pairs.find((p) => p.id === 0x7109871a);
  if (!pair) return { ok: false, reason: 'signing block has no v2 entry' };
  let signers;
  try { signers = parseV2Signers(pair.value); }
  catch (e) { return { ok: false, reason: 'malformed v2 block: ' + e.message }; }
  const signer = signers[0];
  if (!signer) return { ok: false, reason: 'no signers' };

  const { top } = v2Digests(buf, block.blockStart, block.size);
  const entry = signer.digests[0];
  if (!entry) return { ok: false, reason: 'no content digest' };
  if (!entry.digest.equals(top)) return { ok: false, reason: 'content digest mismatch' };
  if (entry.alg !== ALG.RSASSA_PKCS1V15_SHA256) return { ok: false, reason: `unsupported digest alg 0x${entry.alg.toString(16)}` };

  let cert;
  try { cert = forge.pki.certificateFromAsn1(forge.asn1.fromDer(signer.certs[0].toString('binary'))); }
  catch (e) { return { ok: false, reason: 'cannot parse signer certificate: ' + e.message }; }
  const pem = forge.pki.publicKeyToPem(cert.publicKey);
  const sig = signer.sigs.find((s) => s.alg === ALG.RSASSA_PKCS1V15_SHA256);
  if (!sig) return { ok: false, reason: 'no RSASSA-PKCS1-v1_5 SHA-256 signature' };
  const ok = crypto.verify('sha256', signer.signedData, pem, sig.bytes);
  const cn = cert.subject.getField('CN');
  return {
    ok, reason: ok ? 'ok' : 'signature does not verify',
    blockStart: block.blockStart, blockSize: block.size,
    signer: cn ? cn.value : '(no CN)',
    extraBlocks: block.pairs.filter((p) => p.id !== 0x7109871a).map((p) => p.id.toString(16)),
    signedDataBytes: signer.signedData.length,
  };
}

// ── v1 (JAR) verification ───────────────────────────────────────────────────
export function verifyV1(buf) {
  const zip = parseZip(buf);
  const mf = zip.entries.find((e) => e.name === 'META-INF/MANIFEST.MF');
  if (!mf) return { ok: false, reason: 'no META-INF/MANIFEST.MF' };
  const manifest = entryData(buf, mf).toString('binary');
  const attrOf = (text, key) => {
    const m = text.match(new RegExp('^' + key + ': (.*(?:\r\n .*)*)$', 'm'));
    return m ? m[1].replace(/\r\n /g, '') : null;
  };
  const digests = new Map();
  for (const section of manifest.split(/\r\n\r\n/)) {
    const name = attrOf(section, 'Name');
    if (name) digests.set(name, attrOf(section, 'SHA-256-Digest'));
  }
  const bad = [];
  for (const e of zip.entries) {
    if (e.name.startsWith('META-INF/') || e.name.endsWith('/')) continue;
    const want = digests.get(e.name);
    if (!want) { bad.push(`${e.name} missing from MANIFEST.MF`); continue; }
    if (crypto.createHash('sha256').update(entryData(buf, e)).digest('base64') !== want) bad.push(`${e.name} digest mismatch`);
  }
  const sf = zip.entries.find((e) => /^META-INF\/.*\.SF$/.test(e.name));
  const rsa = zip.entries.find((e) => /^META-INF\/.*\.RSA$/.test(e.name));
  if (!sf || !rsa) return { ok: false, reason: 'missing CERT.SF / CERT.RSA' };
  const sfBytes = entryData(buf, sf);
  const sfText = sfBytes.toString('binary');
  const manifestOK = attrOf(sfText, 'SHA-256-Digest-Manifest') === crypto.createHash('sha256').update(entryData(buf, mf)).digest('base64');
  let cert = null, sigOK = false;
  try {
    const asn1 = forge.asn1.fromDer(entryData(buf, rsa).toString('binary'));
    const p7 = forge.pkcs7.messageFromAsn1(asn1);
    cert = p7.certificates[0];
    // the SignerInfo's encryptedDigest is the last OCTET STRING of the structure
    let sigBytes = null;
    (function walk(n) {
      if (n.type === forge.asn1.Type.OCTETSTRING && n.value.length >= 128) sigBytes = Buffer.from(n.value, 'binary');
      if (Array.isArray(n.value)) for (const c of n.value) if (c && c.type !== undefined) walk(c);
    })(asn1);
    if (sigBytes) {
      const pem = forge.pki.publicKeyToPem(cert.publicKey);
      sigOK = crypto.verify('sha256', sfBytes, pem, sigBytes);
    }
  } catch (e) { return { ok: false, reason: 'cannot read CERT.RSA: ' + e.message }; }
  const cn = cert && cert.subject.getField('CN');
  return {
    ok: bad.length === 0 && manifestOK && sigOK,
    reason: bad.length ? bad.slice(0, 3).join('; ') : !manifestOK ? 'SHA-256-Digest-Manifest mismatch' : !sigOK ? 'CERT.RSA signature does not verify' : 'ok',
    files: digests.size,
    signer: cn ? cn.value : '(no CN)',
  };
}

export function verifyApk(buf) {
  return { v1: verifyV1(buf), v2: verifyV2(buf) };
}

// ═══════════════════════════ WRITING ════════════════════════════════════════
const DOS_TIME = 0;
const DOS_DATE = 0x0021;                    // 1980-01-01
const FILE_FLAGS = 0x0800;                  // names are UTF-8 (apksigner sets this)
const ALIGN_EXTRA_ID = 0xd935;              // zipalign/apksigner alignment record
const STRIPPING_PROTECTION_ID = 0xbeeff00d; // "this APK must not be v1-stripped"

let crc32fn = null;
try { crc32fn = (buf) => zlib.crc32(buf) >>> 0; } catch { crc32fn = null; }
if (!crc32fn) {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  crc32fn = (buf) => {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
}
export const crc32 = (buf) => crc32fn(buf);

// Build a ZIP in parts so a v2 signing block can be spliced in before the
// central directory. Entries: { name, data, store?, align? }.
export function buildZipParts(entries) {
  const locals = [];
  const cds = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    let method = 0, payload = e.data;
    if (!e.store) {
      const deflated = zlib.deflateRawSync(e.data, { level: 9 });
      if (deflated.length < e.data.length) { method = 8; payload = deflated; }
    }
    // align stored entries the way apksigner does: a 0xd935 extra-field record
    // carrying the alignment, padded so the file data starts on a 4-byte boundary
    const align = e.align || 1;
    let extraField = Buffer.alloc(0);
    if (align > 1) {
      const pad = (align - ((offset + 30 + name.length + 6) % align)) % align;
      extraField = Buffer.alloc(6 + pad);
      extraField.writeUInt16LE(ALIGN_EXTRA_ID, 0);
      extraField.writeUInt16LE(2 + pad, 2);
      extraField.writeUInt16LE(align, 4);
    }
    const extra = extraField.length;
    const crc = crc32(e.data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(LFH_SIG, 0);
    lh.writeUInt16LE(20, 4);                 // version needed to extract
    lh.writeUInt16LE(FILE_FLAGS, 6);
    lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(DOS_TIME, 10);
    lh.writeUInt16LE(DOS_DATE, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(payload.length, 18);
    lh.writeUInt32LE(e.data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(extra, 28);
    locals.push(lh, name, extraField, payload);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(CD_SIG, 0);
    cd.writeUInt16LE(20, 4);                 // version made by
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(FILE_FLAGS, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(DOS_TIME, 12);
    cd.writeUInt16LE(DOS_DATE, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(payload.length, 20);
    cd.writeUInt32LE(e.data.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt16LE(extra, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt32LE(0, 36);                 // external attributes
    cd.writeUInt32LE(offset, 42);
    cds.push(cd, name, extraField);
    offset += 30 + name.length + extra + payload.length;
  }
  const cd = Buffer.concat(cds);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIG, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return { entries: Buffer.concat(locals), cd, eocd, entriesEnd: offset, count: entries.length };
}

// [entries][signing block][central directory][EOCD] — the v2 layout
export function assembleApk(parts, block) {
  const eocd = Buffer.from(parts.eocd);
  eocd.writeUInt32LE(parts.entriesEnd + (block ? block.length : 0), 16);
  return Buffer.concat([parts.entries, block || Buffer.alloc(0), parts.cd, eocd]);
}

// ── signing identity ────────────────────────────────────────────────────────
export function makeIdentity({ keyPem, certPem, commonName = 'BOOYAH FIRE', days = 10950 } = {}) {
  if (keyPem && certPem) {
    const cert = forge.pki.certificateFromPem(certPem);
    return {
      key: forge.pki.privateKeyFromPem(keyPem), cert, keyPem, certPem,
      certDer: Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(), 'binary'),
    };
  }
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '00' + forge.util.bytesToHex(forge.random.getBytesSync(15));
  // Backdate the start of the validity window: package installers reject a
  // certificate that is not valid yet, and a phone whose clock is a few hours
  // behind the machine that signed the APK would hit exactly that.
  cert.validity.notBefore = new Date(Date.now() - 30 * 86400000);
  cert.validity.notAfter = new Date(Date.now() + days * 86400000);
  const attrs = [
    { name: 'commonName', value: commonName },
    { shortName: 'OU', value: 'Games' },
    { name: 'organizationName', value: 'BOOYAH FIRE' },
    { shortName: 'C', value: 'MA' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  // a real code-signing profile, like keytool/apksigner produce
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, critical: true },
    { name: 'extKeyUsage', codeSigning: true },
    { name: 'subjectKeyIdentifier' },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());   // not SHA-1: modern Android rejects it
  return {
    key: keys.privateKey, cert,
    keyPem: forge.pki.privateKeyToPem(keys.privateKey),
    certPem: forge.pki.certificateToPem(cert),
    certDer: Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(), 'binary'),
  };
}

// ── v1 (JAR) signing ────────────────────────────────────────────────────────
function pkcs7Sign(content, identity) {
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(content.toString('binary'));
  p7.addCertificate(identity.cert);
  p7.addSigner({ key: identity.key, certificate: identity.cert, digestAlgorithm: forge.pki.oids.sha256 });
  p7.sign({ detached: true });   // no authenticated attributes: the signature covers CERT.SF itself
  return Buffer.from(forge.asn1.toDer(p7.toAsn1()).getBytes(), 'binary');
}

export function v1Files(files, identity, { v2 = true } = {}) {
  const digest = (d) => crypto.createHash('sha256').update(d).digest('base64');
  const sorted = [...files].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  let mf = 'Manifest-Version: 1.0\r\nCreated-By: BOOYAH FIRE\r\n\r\n';
  const sections = [];
  for (const f of sorted) {
    const bytes = Buffer.from(`Name: ${f.name}\r\nSHA-256-Digest: ${digest(f.data)}\r\n\r\n`, 'binary');
    sections.push({ name: f.name, bytes });
    mf += bytes.toString('binary');
  }
  const mfBytes = Buffer.from(mf, 'binary');
  // each CERT.SF section digests its MANIFEST.MF section *including* the blank line
  let sf = 'Signature-Version: 1.0\r\nCreated-By: BOOYAH FIRE\r\n'
    + `SHA-256-Digest-Manifest: ${digest(mfBytes)}\r\n`
    + (v2 ? 'X-Android-APK-Signed: 2\r\n' : '')
    + '\r\n';
  for (const s of sections) sf += `Name: ${s.name}\r\nSHA-256-Digest: ${digest(s.bytes)}\r\n\r\n`;
  const sfBytes = Buffer.from(sf, 'binary');
  return [
    { name: 'META-INF/MANIFEST.MF', data: mfBytes },
    { name: 'META-INF/CERT.SF', data: sfBytes },
    { name: 'META-INF/CERT.RSA', data: pkcs7Sign(sfBytes, identity) },
  ];
}

// ── v2 (APK Signing Block) ──────────────────────────────────────────────────
export function buildV2Block(digest, identity) {
  // every nested item is length-prefixed with the length of its content
  const digestEntry = lenPrefixed([u32le(ALG.RSASSA_PKCS1V15_SHA256), u32le(digest.length), digest]);
  const digests = lenPrefixed([digestEntry]);
  const certs = lenPrefixed([lenPrefixed([identity.certDer])]);
  // apksigner adds one additional attribute to signed data: the "stripping
  // protection" marker (id 0xbeeff00d, value 3), which tells the platform not to
  // accept this APK if its v2/v3 signature is somehow stripped
  const attrs = lenPrefixed([lenPrefixed([u32le(STRIPPING_PROTECTION_ID), u32le(3)])]);
  const signedData = Buffer.concat([digests, certs, attrs]);
  // the signature covers the signed-data *content*; the signer blob carries it
  // behind its own length prefix
  const signature = crypto.sign('sha256', signedData, identity.keyPem);
  const signatures = lenPrefixed([lenPrefixed([u32le(ALG.RSASSA_PKCS1V15_SHA256), u32le(signature.length), signature])]);
  // the public-keys field carries the signer's SubjectPublicKeyInfo — NOT the
  // certificate; verifiers compare it against the certificate's key and reject the
  // APK when they disagree (which is exactly what "package appears to be invalid"
  // from the installer means)
  const spki = crypto.createPublicKey(identity.certPem).export({ type: 'spki', format: 'der' });
  const publicKeys = lenPrefixed([lenPrefixed([spki])]);
  const signer = lenPrefixed([lenPrefixed([signedData]), signatures, publicKeys]);
  const value = lenPrefixed([signer]);
  const pairs = Buffer.concat([u64le(4 + value.length), u32le(0x7109871a), value]);
  const size = pairs.length + 8 + 16;
  return Buffer.concat([u64le(size), pairs, u64le(size), Buffer.from(SIG_BLOCK_MAGIC, 'utf8')]);
}

// ── the whole pipeline ──────────────────────────────────────────────────────
export function signApk({ entries, identity, v1 = true, v2 = true }) {
  const files = v1 ? entries.concat(v1Files(entries, identity, { v2 })) : [...entries];
  const parts = buildZipParts(files);
  if (!v2) return assembleApk(parts, null);
  // the block's length is fixed (digest size and RSA key size are), so build it
  // once with a placeholder to learn the layout, then again with the real digest
  const blockLen = buildV2Block(Buffer.alloc(32), identity).length;
  const probe = assembleApk(parts, Buffer.alloc(blockLen));
  // the digest covers [0, blockStart) and [blockStart + 8 + blockSize, eocd), and
  // the size field counts everything after itself — so exclude the 8-byte header
  const { top } = v2Digests(probe, parts.entriesEnd, blockLen - 8);
  const block = buildV2Block(top, identity);
  if (block.length !== blockLen) throw new Error('signing block size changed between passes');
  return assembleApk(parts, block);
}
