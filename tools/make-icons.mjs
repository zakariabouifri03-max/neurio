// Generates icons/icon-192.png, icon-512.png, icon-maskable-512.png
// Hand-rolled PNG encoder + procedural Neurio Studio monogram.
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
  const u = S / 512;
  c.grad('#242034', '#191a23', '#101116');
  // A quiet orbital glow around the custom Neurio monogram.
  c.circle(S * .75, S * .23, 128 * u, '#8c70dc', 18);
  c.circle(S * .29, S * .76, 105 * u, '#58c6a0', 12);
  // Rounded, continuous N mark.
  const stroke = 64 * u;
  c.thickLine(S * .28, S * .69, S * .28, S * .32, stroke, '#b29cff');
  c.thickLine(S * .28, S * .32, S * .71, S * .68, stroke, '#a58bf1');
  c.thickLine(S * .71, S * .68, S * .71, S * .32, stroke, '#9b82e8');
  c.circle(S * .77, S * .75, 17 * u, '#a4f0c4');
  if (!maskable) c.roundMask(S * .2);
  return encodePNG(c.px, S, S);
}

export function makeIcon(S, maskable) {
  return drawIcon(S, maskable);
}

// CLI: writes PWA icons, and (with --mipmap <dir>) Android launcher densities
if (process.argv[1] && process.argv[1].endsWith('make-icons.mjs')) {
  mkdirSync('icons', { recursive: true });
  writeFileSync('icons/icon-192.png', drawIcon(192, false));
  writeFileSync('icons/icon-512.png', drawIcon(512, false));
  writeFileSync('icons/icon-maskable-512.png', drawIcon(512, true));
  const mi = process.argv.indexOf('--mipmap');
  if (mi >= 0 && process.argv[mi + 1]) {
    const dir = process.argv[mi + 1];
    const dens = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
    for (const [d, s] of Object.entries(dens)) {
      mkdirSync(`${dir}/mipmap-${d}`, { recursive: true });
      writeFileSync(`${dir}/mipmap-${d}/ic_launcher.png`, drawIcon(s, false));
    }
    console.log('mipmap icons →', dir);
  }
  console.log('icons written');
}
