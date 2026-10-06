// Generates icons/icon16.png, icon48.png, icon128.png for YouTube Smooth 1080p.
// Hand-rolled PNG encoder (no dependencies) + procedural artwork:
// a red rounded tile, a play triangle and a "buffer runway" arc.
//
//   node tools/make-icons.mjs
import zlib from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');

// ── minimal PNG encoder (RGBA, no filtering) ────────────────────────────────
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type), data])), 8 + data.length);
  return out;
}
function encodePNG(px, w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0;
    Buffer.from(px.buffer, y * w * 4, w * 4).copy(raw, y * (1 + w * 4) + 1);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))
  ]);
}

// ── drawing helpers ─────────────────────────────────────────────────────────
function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }

function roundedRectCover(x, y, w, h, r) {
  // signed distance to a rounded rect centred on (0,0)
  const qx = Math.abs(x) - (w / 2 - r);
  const qy = Math.abs(y) - (h / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

function pointInTriangle(px, py, tri) {
  let sign = 0;
  for (let i = 0; i < 3; i++) {
    const [x1, y1] = tri[i];
    const [x2, y2] = tri[(i + 1) % 3];
    const d = (px - x1) * (y2 - y1) - (py - y1) * (x2 - x1);
    const s = d > 0 ? 1 : d < 0 ? -1 : 0;
    if (s !== 0) { if (sign === 0) sign = s; else if (s !== sign) return false; }
  }
  return true;
}

function render(size) {
  const px = new Uint8Array(size * size * 4);
  const SS = 4; // supersampling
  const c = size / 2;
  const tile = size * 0.92;
  const radius = size * 0.23;

  const top = [255, 107, 129];
  const bottom = [214, 20, 60];

  // play triangle (slightly right of centre, like a real play button)
  const tw = size * 0.34, th = size * 0.40;
  const tx = c + size * 0.035;
  const tri = [[tx - tw / 2, c - th / 2], [tx - tw / 2, c + th / 2], [tx + tw / 2, c]];

  // buffer arc: 3 ticks at the bottom-right, like a filling runway
  const arcR = size * 0.30;
  const ticks = [0.0, 1, 2].map(i => ({
    a: (-35 + i * 26) * Math.PI / 180,
    len: size * (0.055 + i * 0.012)
  }));

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0, n = 0, hit = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const fx = x + (sx + 0.5) / SS - 0.5;
          const fy = y + (sy + 0.5) / SS - 0.5;
          const d = roundedRectCover(fx - c, fy - c, tile, tile, radius);
          n++;
          if (d > 0.5) continue;
          hit++;
          const cover = Math.max(0, Math.min(1, 0.5 - d));
          // vertical gradient + a soft top-left highlight
          const t = fy / size;
          let col = mix(top, bottom, Math.max(0, Math.min(1, t * 1.15)));
          const hl = Math.max(0, 1 - Math.hypot(fx - size * 0.28, fy - size * 0.22) / (size * 0.55));
          col = mix(col, [255, 190, 200], hl * 0.30);

          // drop the play triangle out of the tile
          if (pointInTriangle(fx, fy, tri)) col = [255, 255, 255];

          // runway ticks (white, semi transparent) — only on the larger sizes
          if (size >= 48) {
            for (const tk of ticks) {
              const ax = c + Math.cos(tk.a) * arcR;
              const ay = c + Math.sin(tk.a) * arcR * 0.9;
              const bx = c + Math.cos(tk.a) * (arcR - tk.len);
              const by = c + Math.sin(tk.a) * (arcR - tk.len) * 0.9;
              const d2 = distToSegment(fx, fy, ax, ay, bx, by);
              const w = Math.max(1.2, size * 0.028);
              if (d2 < w) col = mix(col, [255, 255, 255], (1 - d2 / w) * 0.85);
            }
          }

          r += col[0]; g += col[1]; b += col[2]; a += cover * 255;
        }
      }
      const i = (y * size + x) * 4;
      if (hit === 0) continue;
      px[i] = Math.round(r / hit);
      px[i + 1] = Math.round(g / hit);
      px[i + 2] = Math.round(b / hit);
      px[i + 3] = Math.round(a / n);
    }
  }
  return px;
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = dx * dx + dy * dy;
  let t = len === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / len;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

mkdirSync(OUT, { recursive: true });
for (const size of [16, 48, 128]) {
  writeFileSync(join(OUT, `icon${size}.png`), encodePNG(render(size), size, size));
  console.log(`wrote icons/icon${size}.png`);
}
