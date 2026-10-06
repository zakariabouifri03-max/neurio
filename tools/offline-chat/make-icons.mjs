#!/usr/bin/env node
/**
 * Icon generator for «نوريو تواصل» — pure Node, zero dependencies.
 * Draws the icon mathematically and encodes the PNGs by hand (zlib + CRC32),
 * so the app can be re-branded without any image library:
 *
 *   node tools/offline-chat/make-icons.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');

/* ── PNG encoder ──────────────────────────────────────────────────────── */
let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePNG(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;                                        // filter: none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;  // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ── tiny maths / shapes ──────────────────────────────────────────────── */
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

function insideRoundRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = x < x0 + r ? x0 + r : x > x1 - r ? x1 - r : x;
  const cy = y < y0 + r ? y0 + r : y > y1 - r ? y1 - r : y;
  if (cx === x && cy === y) return true;
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}
function insideCircle(x, y, cx, cy, r) { return (x - cx) ** 2 + (y - cy) ** 2 <= r * r; }
function insideTriangle(px, py, a, b, c) {
  const s = (p, q, r) => (p[0] - r[0]) * (q[1] - r[1]) - (q[0] - r[0]) * (p[1] - r[1]);
  const d1 = s([px, py], a, b), d2 = s([px, py], b, c), d3 = s([px, py], c, a);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0, hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

/* ── the actual artwork ───────────────────────────────────────────────── */
function render(size, { maskable = false, rounded = true } = {}) {
  const SS = 3;                                  // supersampling for smooth edges
  const img = Buffer.alloc(size * size * 4);
  const bgTop = hex('#16264a'), bgBot = hex('#070b16'), glow = hex('#22d3ee');
  const bubble = hex('#f2f7ff'), dotCol = hex('#0f1b33');
  const k = maskable ? 0.68 : 1;                 // keep art inside the safe circle
  const S = (v) => (0.5 + (v - 0.5) * k) * size; // scaled coordinate

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const x = px + (sx + 0.5) / SS, y = py + (sy + 0.5) / SS;
        let col = [0, 0, 0], alpha = 0;

        const inCanvas = rounded
          ? insideRoundRect(x, y, 0, 0, size, size, size * 0.22)
          : true;
        if (inCanvas) {
          const t = y / size;
          col = mix(bgTop, bgBot, Math.pow(t, 0.75));
          const d = Math.hypot(x - size * 0.78, y - size * 0.18) / (size * 0.72);
          if (d < 1) col = mix(col, glow, (1 - d) ** 2 * 0.55);
          alpha = 1;

          // chat bubble
          const inBubble = insideRoundRect(x, y, S(0.20), S(0.24), S(0.80), S(0.60), size * 0.085 * k)
            || insideTriangle(x, y, [S(0.30), S(0.56)], [S(0.30), S(0.80)], [S(0.50), S(0.57)]);
          if (inBubble) {
            col = bubble;
            const dy = y - size * 0.42;
            const near = Math.abs(Math.hypot(x - S(0.34), dy) - size * 0.040 * k);
            const dots = [
              insideCircle(x, y, S(0.34), S(0.42), size * 0.040 * k),
              insideCircle(x, y, S(0.50), S(0.42), size * 0.040 * k),
              insideCircle(x, y, S(0.66), S(0.42), size * 0.040 * k),
            ];
            if (dots.some(Boolean)) col = dotCol;
            void near;
          }
        }
        r += col[0] * (alpha ? 1 : 0); g += col[1] * (alpha ? 1 : 0); b += col[2] * (alpha ? 1 : 0); a += alpha;
      }
      const n = SS * SS;
      const out = (py * size + px) * 4;
      const cov = a / n;
      img[out + 0] = cov ? Math.round(r / a) : 0;
      img[out + 1] = cov ? Math.round(g / a) : 0;
      img[out + 2] = cov ? Math.round(b / a) : 0;
      img[out + 3] = Math.round(cov * 255);
    }
  }
  return encodePNG(size, size, img);
}

/* ── write them ───────────────────────────────────────────────────────── */
fs.mkdirSync(OUT, { recursive: true });
const targets = [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['icon-maskable-512.png', 512, { maskable: true, rounded: false }],
  ['apple-touch-icon.png', 180, {}],
  ['icon-32.png', 32, {}],
];
for (const [name, size, opts] of targets) {
  const png = render(size, opts);
  fs.writeFileSync(path.join(OUT, name), png);
  console.log(`   🎨 ${name.padEnd(24)} ${size}×${size}  ${(png.length / 1024).toFixed(1)} KB`);
}
console.log('   ✅ icons written to public/');
