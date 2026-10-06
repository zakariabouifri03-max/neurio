/* ============================================================
   tools/apk/axml.mjs
   Encoder/decoder for Android's *binary* XML (AXML) format — the
   AndroidManifest.xml inside an APK is not text, it is this.

   Verified round-trip: tools/verify-apk.mjs decodes what we encode
   and compares it against the expected attributes.
   ============================================================ */

const RES_STRING_POOL = 0x0001;
const RES_XML = 0x0003;
const RES_XML_START_NS = 0x0100;
const RES_XML_END_NS = 0x0101;
const RES_XML_START_ELEMENT = 0x0102;
const RES_XML_END_ELEMENT = 0x0103;
const RES_XML_RESOURCE_MAP = 0x0180;

const T_REFERENCE = 0x01;
const T_STRING = 0x03;
const T_INT_DEC = 0x10;
const T_INT_HEX = 0x11;
const T_INT_BOOLEAN = 0x12;

const ANDROID_NS = 'http://schemas.android.com/apk/res/android';

/* android: attribute resource ids (the ones this manifest uses) */
export const A = {
  theme: 0x01010000,
  label: 0x01010001,
  icon: 0x01010002,
  name: 0x01010003,
  exported: 0x01010010,
  screenOrientation: 0x0101001e,
  configChanges: 0x0101001f,
  minSdkVersion: 0x0101020c,
  versionCode: 0x0101021b,
  versionName: 0x0101021c,
  targetSdkVersion: 0x01010270,
  allowBackup: 0x01010280,
  required: 0x0101028e,
  hardwareAccelerated: 0x010102d3,
  compileSdkVersion: 0x01010572,
  compileSdkVersionCodename: 0x01010573,
};

/* --------------------------------------------------------------- */
function u16(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n >>> 0, 0); return b; }
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0, 0); return b; }
const pad4 = (b) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)]);

/* UTF-16 string pool, exactly the layout the platform expects */
function stringPool(strings) {
  const offsets = Buffer.alloc(strings.length * 4);
  const chunks = [];
  let pos = 0;
  for (let i = 0; i < strings.length; i++) {
    offsets.writeUInt32LE(pos, i * 4);
    const chars = [...strings[i]];
    const body = Buffer.from(strings[i], 'utf16le');
    const len = Buffer.alloc(chars.length >= 0x8000 ? 4 : 2);
    if (chars.length >= 0x8000) {
      len.writeUInt16LE(0x8000 | (chars.length >> 16), 0);
      len.writeUInt16LE(chars.length & 0xffff, 2);
    } else len.writeUInt16LE(chars.length, 0);
    const part = Buffer.concat([len, body, Buffer.alloc(2)]);
    chunks.push(pad4(part));
    pos += pad4(part).length;
  }
  const data = Buffer.concat(chunks);
  const headerSize = 28;
  const header = Buffer.concat([
    u16(RES_STRING_POOL), u16(headerSize), u32(0),          // size patched later
    u32(strings.length), u32(0),                             // stringCount, styleCount
    u32(0),                                                  // flags (0 = UTF-16)
    u32(headerSize + strings.length * 4),                    // stringsStart
    u32(0),                                                  // stylesStart
    offsets,
  ]);
  const all = Buffer.concat([header, data]);
  all.writeUInt32LE(all.length, 4);
  return all;
}

/* --------------------------------------------------------------- */
export function encodeManifest(opts) {
  const {
    pkg, label, activity = '.MainActivity',
    minSdk = 21, targetSdk = 29,
    versionCode = 1, versionName = '1.0',
    compileSdk = 34, compileSdkName = '14',
    orientation = 6, configChanges = 0x5a0,
    theme = 0x01030007, iconRef = 0x7f010000,
  } = opts;

  /* ---- 1. collect every string, attribute names first ---- */
  const attrNames = Object.keys(A);                    // insertion order == A's order
  const others = [];
  const push = (s) => { if (!others.includes(s)) others.push(s); };
  [
    activity, versionName, compileSdkName, label, 'action', 'activity', 'android',
    'android.hardware.touchscreen', 'android.intent.action.MAIN',
    'android.intent.category.LAUNCHER', 'application', 'category', pkg, ANDROID_NS,
    'intent-filter', 'manifest', 'package', 'platformBuildVersionCode',
    'platformBuildVersionName', 'uses-feature', 'uses-sdk',
  ].forEach(push);
  const strings = [...attrNames, ...others];
  const ix = (s) => strings.indexOf(s);
  if (strings.some((s, i) => strings.indexOf(s) !== i)) throw new Error('duplicate string in pool');

  const resIds = attrNames.map((n) => A[n]);
  const NS = ix(ANDROID_NS);
  const NONE = 0xffffffff;

  /* ---- 2. node list ---- */
  const str = (s) => ({ type: T_STRING, data: ix(s), raw: ix(s) });
  const dec = (n) => ({ type: T_INT_DEC, data: n, raw: NONE });
  const hex = (n) => ({ type: T_INT_HEX, data: n, raw: NONE });
  const boo = (v) => ({ type: T_INT_BOOLEAN, data: v ? 0xffffffff : 0, raw: NONE });
  const ref = (v) => ({ type: T_REFERENCE, data: v, raw: NONE });

  const attrs = (list) =>
    list
      .map(([ns, name, val]) => ({ ns, name, val }))
      .sort((a, b) => {
        const ra = a.ns === NS ? A[a.name] : 0x7fffffff;
        const rb = b.ns === NS ? A[b.name] : 0x7fffffff;
        return ra - rb || ix(a.name) - ix(b.name);
      });

  const nodes = [
    { kind: 'startNs' },
    {
      kind: 'start', name: 'manifest', attrs: attrs([
        [NS, 'versionCode', dec(versionCode)],
        [NS, 'versionName', str(versionName)],
        [NS, 'compileSdkVersion', dec(compileSdk)],
        [NS, 'compileSdkVersionCodename', str(compileSdkName)],
        [NONE, 'package', str(pkg)],
        [NONE, 'platformBuildVersionCode', dec(compileSdk)],
        [NONE, 'platformBuildVersionName', dec(Number(compileSdkName))],
      ]),
    },
    {
      kind: 'start', name: 'uses-sdk', attrs: attrs([
        [NS, 'minSdkVersion', dec(minSdk)],
        [NS, 'targetSdkVersion', dec(targetSdk)],
      ]),
    },
    { kind: 'end', name: 'uses-sdk' },
    {
      kind: 'start', name: 'uses-feature', attrs: attrs([
        [NS, 'name', str('android.hardware.touchscreen')],
        [NS, 'required', boo(false)],
      ]),
    },
    { kind: 'end', name: 'uses-feature' },
    {
      kind: 'start', name: 'application', attrs: attrs([
        [NS, 'theme', ref(theme)],
        [NS, 'label', str(label)],
        [NS, 'icon', ref(iconRef)],
        [NS, 'allowBackup', boo(false)],
        [NS, 'hardwareAccelerated', boo(true)],
      ]),
    },
    {
      kind: 'start', name: 'activity', attrs: attrs([
        [NS, 'name', str(activity)],
        [NS, 'exported', boo(true)],
        [NS, 'screenOrientation', dec(orientation)],
        [NS, 'configChanges', hex(configChanges)],
      ]),
    },
    { kind: 'start', name: 'intent-filter', attrs: attrs([]) },
    { kind: 'start', name: 'action', attrs: attrs([[NS, 'name', str('android.intent.action.MAIN')]]) },
    { kind: 'end', name: 'action' },
    { kind: 'start', name: 'category', attrs: attrs([[NS, 'name', str('android.intent.category.LAUNCHER')]]) },
    { kind: 'end', name: 'category' },
    { kind: 'end', name: 'intent-filter' },
    { kind: 'end', name: 'activity' },
    { kind: 'end', name: 'application' },
    { kind: 'end', name: 'manifest' },
    { kind: 'endNs' },
  ];

  /* ---- 3. serialise ---- */
  const out = [];
  let line = 1;
  const nodeHdr = (type, size) => Buffer.concat([u16(type), u16(16), u32(size), u32(line++), u32(NONE)]);

  for (const n of nodes) {
    if (n.kind === 'startNs' || n.kind === 'endNs') {
      out.push(Buffer.concat([nodeHdr(n.kind === 'startNs' ? RES_XML_START_NS : RES_XML_END_NS, 24),
        u32(ix('android')), u32(NS)]));
      continue;
    }
    if (n.kind === 'end') {
      out.push(Buffer.concat([nodeHdr(RES_XML_END_ELEMENT, 24), u32(NONE), u32(ix(n.name))]));
      continue;
    }
    const a = n.attrs;
    const attrBufs = a.map(({ ns, name, val }) => Buffer.concat([
      u32(ns), u32(ix(name)), u32(val.raw),
      u16(8), Buffer.from([0, val.type]), u32(val.data),
    ]));
    const body = Buffer.concat([
      u32(NONE), u32(ix(n.name)),
      u16(20), u16(20), u16(a.length), u16(0), u16(0), u16(0),
      ...attrBufs,
    ]);
    out.push(Buffer.concat([nodeHdr(RES_XML_START_ELEMENT, 16 + body.length), body]));
  }

  const pool = stringPool(strings);
  const rmap = Buffer.concat([u16(RES_XML_RESOURCE_MAP), u16(8), u32(8 + resIds.length * 4),
    ...resIds.map((r) => u32(r))]);
  const bodyNodes = Buffer.concat(out);
  const whole = Buffer.concat([u16(RES_XML), u16(8), u32(0), pool, rmap, bodyNodes]);
  whole.writeUInt32LE(whole.length, 4);
  return whole;
}

/* --------------------------------------------------------------- */
/*  Decoder — used by verify-apk.mjs to read back what we wrote      */
/* --------------------------------------------------------------- */
export function decodeManifest(buf) {
  const u16r = (o) => buf.readUInt16LE(o);
  const u32r = (o) => buf.readUInt32LE(o);
  const pool = decodePool(buf, 8);
  const out = [];
  let o = 8 + u32r(12);
  while (o < buf.length) {
    const t = u16r(o), size = u32r(o + 4);
    if (t === RES_XML_START_ELEMENT) {
      const name = pool[u32r(o + 20)];
      const start = u16r(o + 24), count = u16r(o + 28);
      const attrs = {};
      for (let i = 0; i < count; i++) {
        const a = o + 16 + start + i * 20;
        const an = pool[u32r(a + 4)];
        const ty = buf[a + 15], data = u32r(a + 16);
        attrs[an] = ty === T_STRING ? pool[data] : ty === T_INT_BOOLEAN ? data !== 0
          : ty === T_REFERENCE ? '@0x' + data.toString(16) : data;
      }
      out.push({ el: name, attrs });
    }
    o += size;
  }
  return out;
}

export function decodePool(buf, off) {
  const count = buf.readUInt32LE(off + 8);
  const flags = buf.readUInt32LE(off + 16);
  const strStart = buf.readUInt32LE(off + 20);
  const utf8 = !!(flags & 0x100);
  const base = off + strStart;
  const out = [];
  for (let i = 0; i < count; i++) {
    let p = base + buf.readUInt32LE(off + 28 + i * 4);
    if (utf8) {
      let n = buf[p]; p += n & 0x80 ? 2 : 1;
      let bl = buf[p]; p += bl & 0x80 ? 2 : 1;
      if (bl & 0x80) bl = ((bl & 0x7f) << 8) | buf[p - 1];
      out.push(buf.slice(p, p + bl).toString('utf8'));
    } else {
      let n = buf.readUInt16LE(p); p += n & 0x8000 ? 4 : 2;
      out.push(buf.slice(p, p + n * 2).toString('utf16le'));
    }
  }
  return out;
}
