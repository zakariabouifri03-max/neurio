/* ============================================================
   tools/make-icons.mjs
   Draws every app icon from scratch (no image files, no canvas
   dependency) and writes real PNGs with a tiny built-in encoder.
   ============================================================ */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ---------------- minimal PNG encoder ---------------- */
const CRC_T = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_T[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
export function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;                       // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------------- the drawing ---------------- */
const mix = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function drawIcon(size, { maskable = false } = {}) {
  const px = Buffer.alloc(size * size * 4);
  const put = (x, y, r, g, b, a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
  };
  const S = size;
  const pad = maskable ? S * 0.12 : 0;         // maskable needs a safe zone
  const rad = maskable ? 0 : S * 0.22;

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      // rounded-rect alpha
      let a = 255;
      if (!maskable && rad > 0) {
        const cx = clamp(x, rad, S - rad), cy = clamp(y, rad, S - rad);
        const d = Math.hypot(x - cx, y - cy);
        if (d > rad) a = clamp((rad - d + 0.5) * 255, 0, 255) | 0;
      }
      // pitch-green gradient + a light sweep
      const t = (x + y) / (2 * S);
      let r = mix(0x0c, 0x1e, t), g = mix(0x8a, 0xd0, t), b = mix(0x4c, 0x7a, t);
      const sweep = Math.max(0, 1 - Math.hypot(x - S * 0.3, y - S * 0.22) / (S * 0.9));
      r = mix(r, 0x6f, sweep * 0.25); g = mix(g, 0xff, sweep * 0.18); b = mix(b, 0xa8, sweep * 0.12);
      put(x, y, r | 0, g | 0, b | 0, a);
    }
  }

  // ---- the ball ----
  const c = { x: S / 2, y: S * 0.52 };
  const R = S * (maskable ? 0.26 : 0.31);

  const pentagon = (cx, cy, rr, rot) => {
    const pts = [];
    for (let i = 0; i < 5; i++) {
      const a = rot - Math.PI / 2 + (i * 2 * Math.PI) / 5;
      pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
    return pts;
  };
  const inPoly = (x, y, pts) => {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  // dark patches in ball space (-1..1)
  const patches = [pentagon(0, 0, 0.4, 0)];
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
    patches.push(pentagon(Math.cos(a) * 0.95, Math.sin(a) * 0.95, 0.32, a + Math.PI / 2));
  }

  for (let y = Math.floor(c.y - R - 2); y <= Math.ceil(c.y + R + 2); y++) {
    for (let x = Math.floor(c.x - R - 2); x <= Math.ceil(c.x + R + 2); x++) {
      const d = Math.hypot(x - c.x, y - c.y);
      if (d > R + 0.5) continue;
      const edge = clamp((R + 0.5 - d) * 255, 0, 255) | 0;
      // shading (light from the top-left)
      const l = clamp(1 - ((x - c.x) * 0.5 + (y - c.y) * 0.7) / (R * 2.4), 0.5, 1.2);
      let r = 250 * l, g = 250 * l, b = 246 * l;
      const nx = (x - c.x) / R, ny = (y - c.y) / R;
      let dark = false;
      for (const pts of patches) { if (inPoly(nx, ny, pts)) { dark = true; break; } }
      if (dark) { r *= 0.13; g *= 0.13; b *= 0.16; }
      // rim shading
      const rim = clamp(1 - Math.pow(d / R, 6) * 0.25, 0.6, 1);
      r *= rim; g *= rim; b *= rim;
      put(x, y, clamp(r, 0, 255) | 0, clamp(g, 0, 255) | 0, clamp(b, 0, 255) | 0,
        Math.min(edge, px[(y * S + x) * 4 + 3] || 255));
    }
  }
  void pad;
  return px;
}

/* ---------------- write them all ---------------- */
const TARGETS = [
  ['res-mipmap-mdpi/ic_launcher.png', 48, {}],
  ['res-mipmap-hdpi/ic_launcher.png', 72, {}],
  ['res-mipmap-xhdpi/ic_launcher.png', 96, {}],
  ['res-mipmap-xxhdpi/ic_launcher.png', 144, {}],
  ['res-mipmap-xxxhdpi/ic_launcher.png', 192, {}],
  ['icons/icon-192.png', 192, {}],
  ['icons/icon-512.png', 512, {}],
  ['icons/icon-maskable-512.png', 512, { maskable: true }],
];

if (process.argv[1] && process.argv[1].endsWith('make-icons.mjs')) {
  for (const [rel, size, opt] of TARGETS) {
    const out = join(root, rel);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, encodePng(size, drawIcon(size, opt)));
    console.log(`  ✓ ${rel}  (${size}×${size})`);
  }
  console.log(`\n✅ ${TARGETS.length} icons written`);
}
