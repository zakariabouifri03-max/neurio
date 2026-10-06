// ── Filebox — pure-JS ZIP writer/reader ─────────────────────────────────────
//
// Supported on WRITE:
//   · STORE (0) and DEFLATE (8)
//   · ZIP64 (entries/offsets > 4 GB)
//   · encryption: Filebox AES-256-GCM (default, authenticated, ~800 MB/s)
//
// Supported on READ: everything above, plus WinZip AE-2 AES-256 (method 99,
// extra 0x9901) so archives made by 7-Zip / WinZip can be imported.
//
// No dependencies — only WebCrypto + CompressionStream.
//
// ── byte layouts (the part that is easy to get wrong, so it is written down) ─
//
// WinZip AE extra field  (header id 0x9901, body size 7):
//   ex[0..1]   01 99          header id, little-endian
//   ex[2..3]   07 00          body size, little-endian
//   ex[4..5]   02 00          AE version 2  (body[0..1])
//   ex[6..7]   45 41          vendor "AE"   (body[2..3])
//   ex[8]      03             key strength 3 = 256-bit  (body[4])
//   ex[9..10]  <method>       real compression method   (body[5..6])
//
// WinZip AE payload:  salt(8/12/16) | verify(2) | cipher | tag(10)
//   key material = PBKDF2-SHA1(password, salt, 1000, 2*keyLen + 2)
//     [0, keyLen)            AES-256 key          (keyLen = 2 * saltLen)
//     [keyLen, 2*keyLen)     HMAC-SHA1 key
//     [2*keyLen, +2)         password verification value
//   keystream[i] = AES-ECB(key, i) with i a 128-bit LITTLE-ENDIAN counter from 1
//
// Filebox GCM extra field (header id 0xFB01, body size 4):
//   ex[0..1]   01 FB          header id
//   ex[2..3]   04 00          body size
//   ex[4..5]   46 42          "FB"
//   ex[6..7]   <method>       real compression method
//
// Filebox GCM payload:  salt(32) | iv(12) | ciphertext+GCM tag(16)
//   key = PBKDF2-SHA256(password, salt, 250000, 32 bytes)

// ── CRC-32 ──────────────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf, prev = 0) {
  let c = prev ^ 0xffffffff;
  const v = new Uint8Array(buf);
  for (let i = 0; i < v.length; i++) c = CRC_TABLE[(c ^ v[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ── little-endian field helpers ─────────────────────────────────────────────
const u16 = (a, o, v) => { a[o] = v & 255; a[o + 1] = (v >>> 8) & 255; };
const u32 = (a, o, v) => { a[o] = v & 255; a[o + 1] = (v >>> 8) & 255; a[o + 2] = (v >>> 16) & 255; a[o + 3] = (v >>> 24) & 255; };
const u64 = (a, o, v) => { for (let i = 0; i < 8; i++) { a[o + i] = Number(v & 0xffn); v >>= 8n; } };
const r16 = (v, o) => v[o] | (v[o + 1] << 8);
const r32 = (v, o) => (v[o] | (v[o + 1] << 8) | (v[o + 2] << 16) | (v[o + 3] << 24)) >>> 0;
const r64 = (v, o) => { let x = 0n; for (let i = 7; i >= 0; i--) x = (x << 8n) | BigInt(v[o + i]); return x; };

const enc = new TextEncoder();
const dec = new TextDecoder();

const GCM_ID = 0xfb01;
const WZ_ID = 0x9901;
const AE_SALT_LEN = { 1: 8, 2: 12, 3: 16 };

function dosDateTime(d) {
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}
function safeDosDateTime(ms) {
  try { return dosDateTime(new Date(ms || Date.now())); } catch { return dosDateTime(new Date()); }
}

// copy a Uint8Array so we never hand a shared/detached buffer to WebCrypto
const own = (u8) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);

// ── zlib wrapper (RFC 1950) ─────────────────────────────────────────────────
// java.util.zip's Deflater/Inflater default to the zlib-wrapped format, so the
// bytes we encrypt inside a Filebox vault carry the 2-byte header + adler32.
// That is what lets a vault move between the phone and the browser.
function adler32(u8) {
  let a = 1, b = 0;
  for (let i = 0; i < u8.length; i++) {
    a = (a + u8[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}
// RFC 1950:  CMF FLG <raw deflate stream> ADLER32(original, big-endian)
function zlibWrap(deflated, original) {
  const cmf = 0x78;                                   // deflate, 32K window
  const flg = 0x01;                                   // check bits: (cmf<<8|flg)%31==0, no dict
  const ad = adler32(original);                       // over the UNcompressed bytes
  const out = new Uint8Array(deflated.length + 6);
  out[0] = cmf; out[1] = flg;
  out.set(deflated, 2);
  out[out.length - 4] = (ad >>> 24) & 0xff;
  out[out.length - 3] = (ad >>> 16) & 0xff;
  out[out.length - 2] = (ad >>> 8) & 0xff;
  out[out.length - 1] = ad & 0xff;
  return out;
}
function zlibUnwrap(u8) {
  return u8.subarray(2, u8.length - 4);
}
async function deflateZlib(u8) {
  const r = await deflateRaw(u8, 'normal');
  return r.stored ? null : zlibWrap(r.data, u8);
}
async function inflateZlib(u8) {
  return inflateRaw(zlibUnwrap(u8));
}

// ── crypto primitives ───────────────────────────────────────────────────────
const keyCache = new WeakMap();
function subtleKey(raw, algo, usages) {
  let p = keyCache.get(raw);
  if (!p) {
    p = crypto.subtle.importKey('raw', raw, algo, false, usages);
    keyCache.set(raw, p);
  }
  return p;
}

async function gcmKey(password, salt, usage) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: own(salt), iterations: 250000, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, [usage]);
}

async function gcmSeal(password, plain) {
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await gcmKey(password, salt, 'encrypt');
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, own(plain)));
  const out = new Uint8Array(32 + 12 + sealed.length);
  out.set(salt, 0); out.set(iv, 32); out.set(sealed, 44);
  return out;
}

async function gcmOpen(password, blob) {
  const salt = blob.subarray(0, 32);
  const iv = blob.subarray(32, 44);
  const sealed = blob.subarray(44);
  const key = await gcmKey(password, salt, 'decrypt');
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, own(sealed)));
}

// WinZip AE key material
async function wzKeys(password, salt) {
  const keyLen = salt.length * 2;                                  // 16 / 24 / 32
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const mat = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: own(salt), iterations: 1000, hash: 'SHA-1' }, base, (keyLen * 2 + 2) * 8));
  return {
    encKey: mat.slice(0, keyLen),
    macKey: mat.slice(keyLen, keyLen * 2),
    verify: mat.slice(keyLen * 2),
  };
}

function hmacSha1(key, data) {
  return crypto.subtle
    .importKey('raw', key, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])
    .then((k) => crypto.subtle.sign('HMAC', k, own(data)))
    .then((t) => new Uint8Array(t).slice(0, 10));
}

// 128-bit LITTLE-endian counter block (byte 0 = least significant).
// Verified against pycryptodome's Counter.new(nbits=128, little_endian=True),
// which is what pyzipper — and every other WinZip-AES implementation — uses.
function counterBlock(n) {
  const b = new Uint8Array(16);
  let v = BigInt(n);
  for (let i = 0; i < 16; i++) { b[i] = Number(v & 0xffn); v >>= 8n; }
  return b;
}

// keystream[i] = AES-ECB(key, counter_i).  WebCrypto has no ECB, so each
// counter block is encrypted as a one-block AES-CBC call with a zero IV
// (identical to ECB), batched in parallel.
// NOTE: one AES-CBC call over many blocks does NOT work — CBC chains the
// previous *cipher* block, and it also appends a PKCS#7 padding block.
const CTR_BATCH = 128;
async function wzCtr(key, data, counterStart = 1) {
  if (!data.length) return new Uint8Array(0);
  const cryptoKey = await subtleKey(key, { name: 'AES-CBC' }, ['encrypt']);
  const zeroIv = new Uint8Array(16);
  const n = Math.ceil(data.length / 16);
  const out = new Uint8Array(data.length);
  for (let start = 0; start < n; start += CTR_BATCH) {
    const count = Math.min(CTR_BATCH, n - start);
    const ks = await Promise.all(Array.from({ length: count }, (_, i) =>
      crypto.subtle.encrypt({ name: 'AES-CBC', iv: zeroIv }, cryptoKey,
        counterBlock(counterStart + start + i).buffer)));
    for (let i = 0; i < count; i++) {
      const block = new Uint8Array(ks[i], 0, 16);
      const o = (start + i) * 16;
      const end = Math.min(16, data.length - o);
      for (let b = 0; b < end; b++) out[o + b] = data[o + b] ^ block[b];
    }
  }
  return out;
}

// ── deflate ─────────────────────────────────────────────────────────────────
const hasCS = typeof CompressionStream !== 'undefined';

// Standard ZIP method 8 is *raw* deflate (RFC 1951), no zlib wrapper.
async function deflateRaw(u8, level) {
  if (!hasCS) return { data: u8, stored: true };
  const cs = new CompressionStream('deflate-raw');
  const w = cs.writable.getWriter();
  w.write(u8);
  w.close();
  const out = new Uint8Array(await new Response(cs.readable).arrayBuffer());
  if (out.length >= u8.length) return { data: u8, stored: true };   // never grow
  if (level === 'max' && out.length > u8.length * 0.95) return { data: u8, stored: true };
  return { data: out, stored: false };
}

async function inflateRaw(u8) {
  const ds = new DecompressionStream('deflate-raw');
  const w = ds.writable.getWriter();
  w.write(u8);
  w.close();
  return new Uint8Array(await new Response(ds.readable).arrayBuffer());
}

// ── WRITER ──────────────────────────────────────────────────────────────────
/**
 * @param entries  [{ name, blob|data, lastModified? }]
 * @param opts     { level: 'store'|'normal'|'max', password?, cipher?: 'gcm'|'wz', onProgress? }
 * @returns Blob   a .zip file
 */
export async function zipCreate(entries, opts = {}) {
  const level = opts.level || 'normal';
  const password = opts.password || null;
  const cipher = opts.cipher || 'gcm';
  const chunks = [];
  const central = [];
  let offset = 0;
  const push = (u8) => { chunks.push(u8); offset += u8.length; };

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const raw = e.data ? new Uint8Array(e.data) : new Uint8Array(await e.blob.arrayBuffer());
    const nameU8 = enc.encode(e.name);
    const dt = safeDosDateTime(e.lastModified);
    const crc = crc32(raw.buffer);

    let method = 0;
    let payload;
    if (level === 'store') {
      payload = raw;
    } else {
      const r = await deflateRaw(raw, level);
      payload = r.data;
      method = r.stored ? 0 : 8;
    }

    // ── encryption wrapper
    let cryptoExtra = null;
    let storedCrc = crc;
    if (password) {
      if (cipher === 'wz') {
        // WinZip AE-2, AES-256
        const salt = crypto.getRandomValues(new Uint8Array(AE_SALT_LEN[3]));
        const { encKey, macKey, verify } = await wzKeys(password, salt);
        const cipherText = await wzCtr(encKey, payload, 1);
        const tag = await hmacSha1(macKey, cipherText);
        const wrapped = new Uint8Array(salt.length + 2 + cipherText.length + 10);
        wrapped.set(salt, 0);
        wrapped.set(verify, salt.length);
        wrapped.set(cipherText, salt.length + 2);
        wrapped.set(tag, salt.length + 2 + cipherText.length);
        cryptoExtra = new Uint8Array(11);
        u16(cryptoExtra, 0, WZ_ID);
        u16(cryptoExtra, 2, 7);
        u16(cryptoExtra, 4, 0x0002);          // AE version 2
        cryptoExtra[6] = 0x45; cryptoExtra[7] = 0x41;   // "AE"
        cryptoExtra[8] = 3;                   // 256-bit
        u16(cryptoExtra, 9, method);          // real method
        payload = wrapped;
        storedCrc = 0;                        // AE-2 does not carry a CRC
      } else {
        // Filebox AES-256-GCM (default).
        // Compress BEFORE encrypting and stash the compressed bytes inside the
        // ciphertext, wrapped in zlib framing so java.util.zip can read it.
        let inner = payload;
        let innerMethod = method;
        if (level !== 'store') {
          const z = await deflateZlib(raw);
          if (z && z.length < raw.length) { inner = z; innerMethod = 8; }
          else innerMethod = 0;
        } else {
          innerMethod = 0;
        }
        payload = await gcmSeal(password, inner);
        cryptoExtra = new Uint8Array(8);
        u16(cryptoExtra, 0, GCM_ID);
        u16(cryptoExtra, 2, 4);
        cryptoExtra[4] = 0x46; cryptoExtra[5] = 0x42;   // "FB"
        u16(cryptoExtra, 6, innerMethod);               // what to do after decrypting
      }
      method = 99;
    }

    const compSize = BigInt(payload.length);
    const uncompSize = BigInt(raw.length);
    const localOffset = BigInt(offset);
    const needZip64 = compSize > 0xffffffffn || uncompSize > 0xffffffffn || localOffset > 0xffffffffn;

    const extra = [];
    if (cryptoExtra) extra.push(cryptoExtra);
    if (needZip64) {
      const z = new Uint8Array(4 + 16);
      u16(z, 0, 1); u16(z, 2, 16);
      u64(z, 4, uncompSize); u64(z, 12, compSize);
      extra.push(z);
    }
    const extraLen = extra.reduce((a, x) => a + x.length, 0);

    // ── local file header (30 bytes + name + extra)
    const local = new Uint8Array(30 + nameU8.length + extraLen);
    u32(local, 0, 0x04034b50);
    u16(local, 4, needZip64 ? 45 : 20);
    u16(local, 6, (password ? 1 : 0) | 0x800);   // encrypted + UTF-8 name
    u16(local, 8, method);
    u16(local, 10, dt.time); u16(local, 12, dt.date);
    u32(local, 14, storedCrc);
    u32(local, 18, Number(compSize & 0xffffffffn));
    u32(local, 22, Number(uncompSize & 0xffffffffn));
    u16(local, 26, nameU8.length);
    u16(local, 28, extraLen);
    local.set(nameU8, 30);
    let p = 30 + nameU8.length;
    for (const x of extra) { local.set(x, p); p += x.length; }
    push(local);
    push(payload);

    // ── central directory record (46 bytes + name + extra)
    const cExtra = [];
    if (cryptoExtra) cExtra.push(cryptoExtra);
    if (needZip64) {
      const z = new Uint8Array(4 + 24);
      u16(z, 0, 1); u16(z, 2, 24);
      u64(z, 4, uncompSize); u64(z, 12, compSize); u64(z, 20, localOffset);
      cExtra.push(z);
    }
    const cExtraLen = cExtra.reduce((a, x) => a + x.length, 0);
    const rec = new Uint8Array(46 + nameU8.length + cExtraLen);
    u32(rec, 0, 0x02014b50);
    u16(rec, 4, needZip64 ? 45 : 20);            // version made by
    u16(rec, 6, needZip64 ? 45 : 20);            // version needed
    u16(rec, 8, (password ? 1 : 0) | 0x800);     // flags
    u16(rec, 10, method);
    u16(rec, 12, dt.time); u16(rec, 14, dt.date);
    u32(rec, 16, storedCrc);
    u32(rec, 20, Number(compSize & 0xffffffffn));
    u32(rec, 24, Number(uncompSize & 0xffffffffn));
    u16(rec, 28, nameU8.length);
    u16(rec, 30, cExtraLen);
    u16(rec, 32, 0);                             // comment length
    u16(rec, 34, 0);                             // disk number start
    u16(rec, 36, 0);                             // internal attributes
    u32(rec, 38, 0o100644 << 16);                // external attributes
    u32(rec, 42, Number(localOffset & 0xffffffffn));
    rec.set(nameU8, 46);
    let q = 46 + nameU8.length;
    for (const x of cExtra) { rec.set(x, q); q += x.length; }
    central.push(rec);

    if (opts.onProgress) opts.onProgress((i + 1) / entries.length);
  }

  let cdSize = 0;
  central.forEach((c) => (cdSize += c.length));
  const cdStart = BigInt(offset);
  central.forEach(push);

  if (cdStart > 0xffffffffn || BigInt(central.length) > 0xffffn) {
    const z64 = new Uint8Array(56);
    u32(z64, 0, 0x06064b50);
    u64(z64, 4, 44n);
    u16(z64, 12, 45); u16(z64, 14, 45);
    u32(z64, 16, 0); u32(z64, 20, 0);
    u64(z64, 24, BigInt(central.length));
    u64(z64, 32, BigInt(central.length));
    u64(z64, 40, BigInt(cdSize));
    u64(z64, 48, cdStart);
    push(z64);
    const loc = new Uint8Array(20);
    u32(loc, 0, 0x07064b50);
    u32(loc, 4, 0);
    u64(loc, 8, cdStart + BigInt(cdSize));
    u32(loc, 16, 0xffff);
    push(loc);
  }

  const end = new Uint8Array(22);
  u32(end, 0, 0x06054b50);
  u16(end, 8, Math.min(central.length, 0xffff));
  u16(end, 10, Math.min(central.length, 0xffff));
  u32(end, 12, Number(BigInt(cdSize) & 0xffffffffn));
  u32(end, 16, Number(cdStart & 0xffffffffn));
  push(end);

  return new Blob(chunks, { type: 'application/zip' });
}

// ── READER ──────────────────────────────────────────────────────────────────

/** Parse the central directory of a zip Blob. */
export async function zipList(blob) {
  const tailSize = Math.min(blob.size, 66 * 1024);
  const tail = new Uint8Array(await blob.slice(blob.size - tailSize).arrayBuffer());
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) if (r32(tail, i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a zip file (EOCD not found)');

  let count = r16(tail, eocd + 10);
  let cdSize = r32(tail, eocd + 12);
  let cdOff = r32(tail, eocd + 16);

  if (cdOff === 0xffffffff || count === 0xffff) {
    const locOff = eocd - 20;
    if (locOff >= 0 && r32(tail, locOff) === 0x07064b50) {
      const z64Off = Number(r64(tail, locOff + 8));
      const z64 = new Uint8Array(await blob.slice(z64Off, z64Off + 56).arrayBuffer());
      count = Number(r64(z64, 32));
      cdSize = Number(r64(z64, 40));
      cdOff = Number(r64(z64, 48));
    }
  }

  const cd = new Uint8Array(await blob.slice(cdOff, cdOff + cdSize).arrayBuffer());
  const out = [];
  let p = 0;
  for (let i = 0; i < count && p + 46 <= cd.length; i++) {
    if (r32(cd, p) !== 0x02014b50) break;
    const flags = r16(cd, p + 8);
    const zipMethod = r16(cd, p + 10);
    const mtime = r16(cd, p + 12), mdate = r16(cd, p + 14);
    const crc = r32(cd, p + 16);
    let compSize = r32(cd, p + 20);
    let size = r32(cd, p + 24);
    const nameLen = r16(cd, p + 28);
    const extraLen = r16(cd, p + 30);
    const cmtLen = r16(cd, p + 32);
    let localOff = r32(cd, p + 42);
    const name = dec.decode(cd.subarray(p + 46, p + 46 + nameLen));

    let scheme = 'none', aeStrength = 3, realMethod = zipMethod;
    const ex = cd.subarray(p + 46 + nameLen, p + 46 + nameLen + extraLen);
    let ep = 0;
    while (ep + 4 <= ex.length) {
      const id = r16(ex, ep), len = r16(ex, ep + 2);
      const body = ex.subarray(ep + 4, ep + 4 + len);
      if (id === 1) {                                   // ZIP64
        let o = 0;
        if (size === 0xffffffff) { size = Number(r64(body, o)); o += 8; }
        if (compSize === 0xffffffff) { compSize = Number(r64(body, o)); o += 8; }
        if (localOff === 0xffffffff) { localOff = Number(r64(body, o)); o += 8; }
      } else if (id === WZ_ID && len >= 7) {
        scheme = 'wz';
        aeStrength = body[4];                           // body[4] = key strength
        realMethod = r16(body, 5);                      // body[5..6] = real method
      } else if (id === GCM_ID && len >= 4) {
        scheme = 'gcm';
        realMethod = r16(body, 2);                      // body[2..3] = real method
      }
      ep += 4 + len;
    }

    out.push({
      name, size, compSize, crc, zipMethod, method: realMethod, scheme, aeStrength,
      encrypted: (flags & 1) === 1, localOff, mtime, mdate,
      date: new Date(((mdate >> 9) & 0x7f) + 1980, ((mdate >> 5) & 0xf) - 1, mdate & 0x1f,
        (mtime >> 11) & 0x1f, (mtime >> 5) & 0x3f, (mtime & 0x1f) * 2),
    });
    p += 46 + nameLen + extraLen + cmtLen;
  }
  return out;
}

/** Extract a single entry. `password` is required for encrypted entries. */
export async function zipExtractEntry(blob, entry, password) {
  const head = new Uint8Array(await blob.slice(entry.localOff, entry.localOff + 30).arrayBuffer());
  if (r32(head, 0) !== 0x04034b50) throw new Error('bad local header for ' + entry.name);
  const dataStart = entry.localOff + 30 + r16(head, 26) + r16(head, 28);
  const raw = new Uint8Array(await blob.slice(dataStart, dataStart + entry.compSize).arrayBuffer());

  let plain = raw;
  if (entry.zipMethod === 99) {
    if (!password) throw new Error('password needed for ' + entry.name);
    if (entry.scheme === 'gcm') {
      let opened;
      try {
        opened = await gcmOpen(password, raw);
      } catch {
        throw new Error('wrong password or damaged entry: ' + entry.name);
      }
      return entry.method === 8 ? inflateZlib(opened) : opened;
    } else {
      const saltLen = AE_SALT_LEN[entry.aeStrength] || 16;
      const salt = raw.subarray(0, saltLen);
      const verify = raw.subarray(saltLen, saltLen + 2);
      const tag = raw.subarray(raw.length - 10);
      const cipherText = raw.subarray(saltLen + 2, raw.length - 10);
      const { encKey, macKey, verify: expect } = await wzKeys(password, salt);
      if (verify[0] !== expect[0] || verify[1] !== expect[1]) throw new Error('wrong password');
      const calc = await hmacSha1(macKey, cipherText);
      for (let i = 0; i < 10; i++) if (calc[i] !== tag[i]) throw new Error('damaged entry (HMAC): ' + entry.name);
      plain = await wzCtr(encKey, cipherText, 1);
    }
  }

  if (entry.method === 0) return plain;
  if (entry.method === 8) return inflateRaw(plain);
  throw new Error('unsupported compression method ' + entry.method);
}

/** Extract every entry → [{ name, data, date }] */
export async function zipExtractAll(blob, password, onProgress) {
  const list = await zipList(blob);
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (e.name.endsWith('/')) continue;
    out.push({ name: e.name, data: await zipExtractEntry(blob, e, password), date: e.date });
    if (onProgress) onProgress((i + 1) / list.length);
  }
  return out;
}

/** Verify every entry can be decrypted/decompressed → { ok, entries, error? } */
export async function zipVerify(blob, password) {
  try {
    const list = await zipList(blob);
    let total = 0;
    for (const e of list) {
      if (e.name.endsWith('/')) continue;
      const d = await zipExtractEntry(blob, e, password);
      if (d.length !== e.size) throw new Error(`size mismatch for ${e.name} (${d.length} ≠ ${e.size})`);
      if (!e.encrypted || e.scheme !== 'wz') {
        if (crc32(d.buffer) !== e.crc) throw new Error(`CRC mismatch for ${e.name}`);
      }
      total += 1;
    }
    return { ok: true, entries: total };
  } catch (err) {
    return { ok: false, entries: 0, error: err.message };
  }
}

export const __test = { wzKeys, wzCtr, gcmSeal, gcmOpen, counterBlock, AE_SALT_LEN, GCM_ID, WZ_ID, zlibWrap, zlibUnwrap, adler32 };
