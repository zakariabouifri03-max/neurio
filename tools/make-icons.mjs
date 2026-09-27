// Generates icons/icon-192.png, icon-512.png, icon-maskable-512.png
// Hand-rolled PNG encoder + procedural beach-buggy art.
import zlib from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

// ── minimal PNG encoder (RGBA, no filter) ──
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
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0;
    Buffer.from(px.buffer, y * w * 4, w * 4).copy(raw, y * (1 + w * 4) + 1);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── tiny raster canvas ──
class C {
  constructor(w, h) { this.w = w; this.h = h; this.px = new Uint8ClampedArray(w * h * 4); }
  blend(x, y, r, g, b, a) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || a <= 0) return;
    const i = (y * this.w + x) * 4, ia = a / 255;
    this.px[i] = r * ia + this.px[i] * (1 - ia);
    this.px[i + 1] = g * ia + this.px[i + 1] * (1 - ia);
    this.px[i + 2] = b * ia + this.px[i + 2] * (1 - ia);
    this.px[i + 3] = Math.max(this.px[i + 3], a);
  }
  grad(top, mid, bot) {
    const [t, m, b] = [top, mid, bot].map((h2) => [parseInt(h2.slice(1, 3), 16), parseInt(h2.slice(3, 5), 16), parseInt(h2.slice(5, 7), 16)]);
    for (let y = 0; y < this.h; y++) {
      const f = y / this.h;
      const c = f < 0.62 ? t.map((v, i) => v + (m[i] - v) * (f / 0.62)) : m.map((v, i) => v + (b[i] - v) * ((f - 0.62) / 0.38));
      for (let x = 0; x < this.w; x++) this.blend(x, y, c[0], c[1], c[2], 255);
    }
  }
  rect(x0, y0, w, h, col, aa = 255) {
    const [r, g, b] = hex(col);
    for (let y = Math.max(0, y0 | 0); y < Math.min(this.h, y0 + h); y++)
      for (let x = Math.max(0, x0 | 0); x < Math.min(this.w, x0 + w); x++) this.blend(x, y, r, g, b, aa);
  }
  circle(cx, cy, rad, col, aa = 255) {
    const [r, g, b] = hex(col), r2 = rad * rad;
    for (let y = Math.max(0, (cy - rad - 1) | 0); y < Math.min(this.h, cy + rad + 1); y++)
      for (let x = Math.max(0, (cx - rad - 1) | 0); x < Math.min(this.w, cx + rad + 1); x++) {
        const d2 = (x - cx) ** 2 + (y - cy) ** 2;
        if (d2 <= r2) this.blend(x, y, r, g, b, aa);
        else if (d2 <= (rad + 1.4) ** 2) this.blend(x, y, r, g, b, aa * 0.35 * (1 - (Math.sqrt(d2) - rad) / 1.4));
      }
  }
  ellipse(cx, cy, rx, ry, col, aa) {
    const [r, g, b] = hex(col);
    for (let y = Math.max(0, (cy - ry - 1) | 0); y < Math.min(this.h, cy + ry + 1); y++)
      for (let x = Math.max(0, (cx - rx - 1) | 0); x < Math.min(this.w, cx + rx + 1); x++)
        if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) this.blend(x, y, r, g, b, aa);
  }
  thickLine(x1, y1, x2, y2, th, col, aa = 255) {
    const steps = Math.ceil(Math.hypot(x2 - x1, y2 - y1) * 1.5);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this.circle(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, th / 2, col, aa);
    }
  }
  roundMask(rad) { // transparent outside rounded rect
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const dx = Math.max(0, Math.max(rad - x, x - (this.w - 1 - rad)));
      const dy = Math.max(0, Math.max(rad - y, y - (this.h - 1 - rad)));
      if (dx * dx + dy * dy > rad * rad) this.px[(y * this.w + x) * 4 + 3] = 0;
    }
  }
}
const hex = (h2) => [parseInt(h2.slice(1, 3), 16), parseInt(h2.slice(3, 5), 16), parseInt(h2.slice(5, 7), 16)];

function drawIcon(S, maskable) {
  const c = new C(S, S);
  const u = S / 512; // design unit
  if (maskable) c.rect(0, 0, S, S, '#2f9be8');
  c.grad('#2f9be8', '#8fd7ff', '#ffe9a8');
  // sun + glow
  c.circle(S * 0.78, S * 0.2, 66 * u, '#fff2c0', 70);
  c.circle(S * 0.78, S * 0.2, 46 * u, '#fff2c0', 130);
  c.circle(S * 0.78, S * 0.2, 30 * u, '#fff8dd');
  // sand
  c.rect(0, S * 0.8, S, S * 0.2, '#ecd9a0');
  c.ellipse(S * 0.5, S * 0.81, S * 0.42, S * 0.05, '#5c4a2a', 30);
  // checkered strip
  const sq = S / 16;
  for (let i = 0; i < 16; i++) for (let j = 0; j < 2; j++)
    c.rect(i * sq, S * 0.9 + j * sq * 0.55, sq, sq * 0.55, (i + j) % 2 ? '#111318' : '#ffffff');
  // wheels
  const wy = S * 0.745, rW = 52 * u, rWr = 62 * u, x1 = S * 0.33, x2 = S * 0.7;
  c.ellipse(S * 0.51, S * 0.805, 150 * u, 15 * u, '#8a6f3f', 70);
  for (const [cx, r] of [[x1, rW], [x2, rWr]]) {
    c.circle(cx, wy, r, '#1b1e26');
    c.circle(cx, wy, r * 0.55, '#8f97a6');
    c.circle(cx, wy, r * 0.28, '#c8ccd6');
  }
  // body (side view buggy)
  const bx = S * 0.2, by = S * 0.61, bw = S * 0.6, bh = S * 0.11;
  c.ellipse(bx + bw * 0.5, by + bh * 0.5, bw * 0.55, bh * 0.9, '#e63946'); // rounded main body
  c.rect(bx + bw * 0.06, by, bw * 0.9, bh, '#e63946');
  c.rect(bx + bw * 0.06, by, bw * 0.9, bh * 0.3, '#f4f1de'); // stripe
  // nose + headlight
  c.ellipse(bx + bw * 0.97, by + bh * 0.5, 22 * u, bh * 0.42, '#e63946');
  c.circle(bx + bw * 1.03, by + bh * 0.42, 7 * u, '#fff6c9');
  // rear engine + stacks
  c.rect(bx - 6 * u, by - 26 * u, 40 * u, 30 * u, '#aab0bd');
  c.rect(bx + 2 * u, by - 44 * u, 8 * u, 20 * u, '#8f97a6');
  c.rect(bx + 16 * u, by - 48 * u, 8 * u, 24 * u, '#8f97a6');
  c.rect(bx + 30 * u, by - 40 * u, 8 * u, 16 * u, '#8f97a6');
  // driver body + head
  c.rect(bx + bw * 0.42, by - 34 * u, 40 * u, 38 * u, '#e63946');
  c.circle(bx + bw * 0.52, by - 44 * u, 20 * u, '#f2c891');
  c.circle(bx + bw * 0.545, by - 47 * u, 4.6 * u, '#1b1e26'); // eye
  c.rect(bx + bw * 0.44, by - 66 * u, 36 * u, 10 * u, '#d64545'); // brow band
  // rollcage
  const cage = '#23262e';
  c.thickLine(bx + bw * 0.26, by, bx + bw * 0.34, by - 78 * u, 9 * u, cage);
  c.thickLine(bx + bw * 0.34, by - 78 * u, bx + bw * 0.62, by - 74 * u, 9 * u, cage);
  c.thickLine(bx + bw * 0.62, by - 74 * u, bx + bw * 0.56, by - 4 * u, 9 * u, cage);
  // windshield hint
  c.thickLine(bx + bw * 0.68, by - 6 * u, bx + bw * 0.76, by - 40 * u, 7 * u, '#bfe8ff', 220);
  if (!maskable) c.roundMask(S * 0.22);
  return encodePNG(c.px, S, S);
}

mkdirSync('icons', { recursive: true });
writeFileSync('icons/icon-192.png', drawIcon(192, false));
writeFileSync('icons/icon-512.png', drawIcon(512, false));
writeFileSync('icons/icon-maskable-512.png', drawIcon(512, true));
console.log('icons written');
