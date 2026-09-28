// Binary Android resource editing — just enough of AXML (AndroidManifest.xml) and
// ARSC (resources.arsc) to re-brand a compiled APK without aapt.
//
// The two edits we need are string replacements:
//   • AXML keeps every string in one pool at the top of the file. Rebuilding that
//     pool changes the file length, so the chunk walk re-emits every ancestor with
//     a corrected `size` field. Nothing else in an AXML file uses absolute offsets
//     (element/attribute references are string-pool indices), so this is safe.
//   • ARSC keeps the package name in a fixed 128-code-unit field inside the
//     ResTable_package header, so that one is an in-place patch.
//
// Chunk types (frameworks/base/libs/androidfw/include/androidfw/ResourceTypes.h):
const RES_STRING_POOL_TYPE = 0x0001;
const RES_XML_TYPE = 0x0003;
const RES_TABLE_TYPE = 0x0002;
const RES_TABLE_PACKAGE_TYPE = 0x0200;
// only these carry child chunks: the AXML root, the resource table and each package
const CONTAINERS = new Set([RES_XML_TYPE, RES_TABLE_TYPE, RES_TABLE_PACKAGE_TYPE]);
const UTF8_FLAG = 0x0100;

const u16 = (b, o) => b.readUInt16LE(o);
const u32 = (b, o) => b.readUInt32LE(o);

// ── string pool ─────────────────────────────────────────────────────────────
// A pool is a 28-byte header followed by `stringCount` (and `styleCount`) uint32
// offsets, then the string data. UTF-8 pools write two lengths per string (UTF-16
// code units, then bytes); UTF-16 pools write one, in code units. Both use a
// 1-or-2 byte varint: a high bit in the first byte means "one more byte follows".
function readLength(buf, p, width) {
  if (width === 1) {
    const b0 = buf[p];
    if (b0 & 0x80) return [((b0 & 0x7f) << 8) | buf[p + 1], p + 2];
    return [b0, p + 1];
  }
  const w0 = buf.readUInt16LE(p);
  if (w0 & 0x8000) return [((w0 & 0x7fff) << 16) | buf.readUInt16LE(p + 2), p + 4];
  return [w0, p + 2];
}

function writeLength(out, len, width) {
  if (width === 1) {
    if (len > 0x7f) out.push(0x80 | (len >> 8), len & 0xff);
    else out.push(len);
    return;
  }
  if (len > 0x7fff) out.push((len >> 24) | 0x80, (len >> 16) & 0xff, len & 0xff, (len >> 8) & 0xff);
  else out.push(len & 0xff, len >> 8);
}

export function decodeStringPool(buf, start) {
  const size = u32(buf, start + 4);
  const stringCount = u32(buf, start + 8);
  const styleCount = u32(buf, start + 12);
  const flags = u32(buf, start + 16);
  const stringsStart = u32(buf, start + 20);
  const stylesStart = u32(buf, start + 24);
  const utf8 = (flags & UTF8_FLAG) !== 0;
  const strings = [];
  for (let i = 0; i < stringCount; i++) {
    const off = stringsStart + u32(buf, start + 28 + i * 4);
    let p = start + off;
    if (utf8) {
      const [, p2] = readLength(buf, p, 1); p = p2;
      const [bytes, p3] = readLength(buf, p, 1); p = p3;
      strings.push(buf.toString('utf8', p, p + bytes));
    } else {
      const [units, p2] = readLength(buf, p, 2);
      strings.push(buf.toString('utf16le', p2, p2 + units * 2));
    }
  }
  const styles = styleCount && stylesStart
    ? Buffer.from(buf.subarray(start + stylesStart, start + stylesStart + (size - stylesStart)))
    : null;
  return { size, stringCount, styleCount, flags, utf8, strings, styles };
}

export function encodeStringPool(pool) {
  const { flags, utf8, strings, styles, styleCount } = pool;
  const width = utf8 ? 1 : 2;
  const offsets = [];
  const data = [];
  for (const s of strings) {
    offsets.push(data.length);
    if (utf8) {
      const bytes = Buffer.from(s, 'utf8');
      writeLength(data, s.length, 1);        // UTF-16 code units, as Android counts
      writeLength(data, bytes.length, 1);
      for (const b of bytes) data.push(b);
      data.push(0);
    } else {
      writeLength(data, s.length, 2);
      for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); data.push(c & 0xff, c >> 8); }
      data.push(0, 0);
    }
    // aapt aligns UTF-8 pools to 4 bytes and UTF-16 pools to 2 (which a 16-bit
    // string never needs) — matching that exactly keeps untouched pools byte-identical
    const stride = utf8 ? 4 : 2;
    while (data.length % stride) data.push(0);
    void width;
  }
  const stringsStart = 28 + (strings.length + styleCount) * 4;
  const body = Buffer.from(data);
  const tail = styles && styleCount ? Buffer.from(styles) : Buffer.alloc(0);
  const total = Math.ceil((stringsStart + body.length + tail.length) / 4) * 4;
  const out = Buffer.alloc(total);
  out.writeUInt16LE(RES_STRING_POOL_TYPE, 0);
  out.writeUInt16LE(28, 2);
  out.writeUInt32LE(total, 4);
  out.writeUInt32LE(strings.length, 8);
  out.writeUInt32LE(styleCount, 12);
  out.writeUInt32LE(flags, 16);
  out.writeUInt32LE(stringsStart, 20);
  out.writeUInt32LE(styleCount ? stringsStart + body.length : 0, 24);
  strings.forEach((_, i) => out.writeUInt32LE(offsets[i], 28 + i * 4));
  body.copy(out, stringsStart);
  tail.copy(out, stringsStart + body.length);
  return out;
}

// ── chunk walk ──────────────────────────────────────────────────────────────
// Containers (AXML root, ResTable) hold their children right after their own
// header; sizes are rewritten bottom-up as children change length.
export function rewriteChunks(buf, start, mapString) {
  const type = u16(buf, start);
  const headerSize = u16(buf, start + 2);
  const size = u32(buf, start + 4);
  if (type === RES_STRING_POOL_TYPE) {
    const pool = decodeStringPool(buf, start);
    const strings = pool.strings.map((s, i) => {
      const r = mapString(s, i, pool);
      return r === undefined || r === null ? s : r;
    });
    return encodeStringPool({ ...pool, strings });
  }
  if (!CONTAINERS.has(type)) return Buffer.from(buf.subarray(start, start + size));   // leaf
  const childrenStart = start + headerSize;
  const parts = [];
  let p = childrenStart;
  while (p + 8 <= start + size) {
    const child = rewriteChunks(buf, p, mapString);
    parts.push(child);
    p += u32(buf, p + 4);
  }
  const header = Buffer.from(buf.subarray(start, childrenStart));
  const body = Buffer.concat(parts);
  header.writeUInt32LE(headerSize + body.length, 4);
  return Buffer.concat([header, body]);
}

export const patchAxml = (buf, mapString) => rewriteChunks(buf, 0, mapString);
export const axmlStrings = (buf) => decodeStringPool(buf, 8).strings;

// ── resources.arsc ──────────────────────────────────────────────────────────
// ResTable_package: type/headerSize/size/id then a 128-code-unit package name.
export function findPackageChunk(buf, start = 0) {
  const type = u16(buf, start);
  const headerSize = u16(buf, start + 2);
  if (type === RES_TABLE_PACKAGE_TYPE) return start;
  if (type !== RES_TABLE_TYPE) return -1;
  let p = start + headerSize;
  const end = start + u32(buf, start + 4);
  while (p < end) {
    if (u16(buf, p) === RES_TABLE_PACKAGE_TYPE) return p;
    p += u32(buf, p + 4);
  }
  return -1;
}

export function arscPackageName(buf) {
  const p = findPackageChunk(buf);
  if (p < 0) return null;
  let end = p + 12;                            // header(8) + id(4), then name[128]
  while (end < p + 268 && buf.readUInt16LE(end) !== 0) end += 2;
  return buf.toString('utf16le', p + 12, end);
}

export function patchArscPackageName(buf, name) {
  const p = findPackageChunk(buf);
  if (p < 0) throw new Error('no ResTable_package chunk in resources.arsc');
  const out = Buffer.from(buf);
  const bytes = Buffer.alloc(256);
  Buffer.from(name, 'utf16le').copy(bytes.subarray(0, 255));   // fixed 128 code units
  bytes.copy(out, p + 12);                                     // leaves the package id alone
  return out;
}
