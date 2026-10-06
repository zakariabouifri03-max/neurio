#!/usr/bin/env node
/**
 * make-icons.mjs - generates the extension icons procedurally (no binary assets
 * checked in from anywhere else, no image libraries needed).
 *
 * Mark: rounded gradient tile + a magnifier whose handle is a rising sparkline.
 * Run: node tools/make-icons.mjs
 */

import zlib from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ── minimal PNG encoder (RGBA, filter 0) ─────────────────────────────── */

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (buffer) => {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) c = crcTable[(c ^ buffer[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type), data])), 8 + data.length);
  return out;
};

function encodePNG(pixels, width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0; // filter: none
    Buffer.from(pixels.buffer, y * width * 4, width * 4).copy(raw, y * (1 + width * 4) + 1);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ── tiny anti-aliased raster canvas ──────────────────────────────────── */

class Canvas {
  constructor(size) {
    this.size = size;
    this.px = new Float32Array(size * size * 4);
  }

  blend(x, y, [r, g, b], alpha) {
    if (alpha <= 0 || x < 0 || y < 0 || x >= this.size || y >= this.size) return;
    const i = (y * this.size + x) * 4;
    const a = Math.min(1, alpha);
    this.px[i] = this.px[i] * (1 - a) + r * a;
    this.px[i + 1] = this.px[i + 1] * (1 - a) + g * a;
    this.px[i + 2] = this.px[i + 2] * (1 - a) + b * a;
    this.px[i + 3] = Math.max(this.px[i + 3], a);
  }

  /** Signed-distance rounded rectangle, 4x supersampled edges. */
  roundedRect(x0, y0, x1, y1, radius, color, alpha = 1) {
    const S = 3;
    for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
      for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
        let hits = 0;
        for (let sy = 0; sy < S; sy++) {
          for (let sx = 0; sx < S; sx++) {
            const px = x + (sx + 0.5) / S;
            const py = y + (sy + 0.5) / S;
            const dx = Math.max(x0 + radius - px, 0, px - (x1 - radius));
            const dy = Math.max(y0 + radius - py, 0, py - (y1 - radius));
            const inside = Math.hypot(dx, dy) <= radius || (px >= x0 + radius && px <= x1 - radius && py >= y0 && py <= y1)
              || (py >= y0 + radius && py <= y1 - radius && px >= x0 && px <= x1);
            if (inside) hits++;
          }
        }
        if (hits) this.blend(x, y, color, (hits / (S * S)) * alpha);
      }
    }
  }

  circle(cx, cy, radius, color, alpha = 1, thickness = 0) {
    const S = 3;
    for (let y = Math.floor(cy - radius - 2); y <= Math.ceil(cy + radius + 2); y++) {
      for (let x = Math.floor(cx - radius - 2); x <= Math.ceil(cx + radius + 2); x++) {
        let hits = 0;
        for (let sy = 0; sy < S; sy++) {
          for (let sx = 0; sx < S; sx++) {
            const d = Math.hypot(x + (sx + 0.5) / S - cx, y + (sy + 0.5) / S - cy);
            const inRing = thickness ? Math.abs(d - radius) <= thickness / 2 : d <= radius;
            if (inRing) hits++;
          }
        }
        if (hits) this.blend(x, y, color, (hits / (S * S)) * alpha);
      }
    }
  }

  line(x0, y0, x1, y1, width, color, alpha = 1) {
    const steps = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 3));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this.circle(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, width / 2, color, alpha, 0);
    }
  }

  gradientRect(x0, y0, x1, y1, from, to) {
    const S = 3;
    for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
      for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
        let hits = 0;
        for (let sy = 0; sy < S; sy++) {
          for (let sx = 0; sx < S; sx++) {
            const px = x + (sx + 0.5) / S;
            const py = y + (sy + 0.5) / S;
            if (px >= x0 && px <= x1 && py >= y0 && py <= y1) hits++;
          }
        }
        if (!hits) continue;
        const t = ((x - x0) / Math.max(1, x1 - x0) + (y - y0) / Math.max(1, y1 - y0)) / 2;
        const color = [0, 1, 2].map((c) => from[c] + (to[c] - from[c]) * t);
        this.blend(x, y, color, hits / (S * S));
      }
    }
  }

  toBuffer() {
    const out = new Uint8ClampedArray(this.size * this.size * 4);
    for (let i = 0; i < out.length; i += 4) {
      out[i] = this.px[i];
      out[i + 1] = this.px[i + 1];
      out[i + 2] = this.px[i + 2];
      out[i + 3] = Math.round(this.px[i + 3] * 255);
    }
    return out;
  }
}

/* ── the mark ─────────────────────────────────────────────────────────── */

function drawIcon(size) {
  const canvas = new Canvas(size);
  const s = size / 128;   // design grid is 128×128
  const pad = 6 * s;
  const radius = 26 * s;

  // Tile background (same gradient language as the UI hero button).
  canvas.gradientRect(pad, pad, 128 * s - pad, 128 * s - pad, [244, 63, 94], [168, 85, 247]);

  // Rounded mask so the tile keeps its corners.
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = Math.max(pad + radius - x, 0, x - (size - pad - radius));
      const dy = Math.max(pad + radius - y, 0, y - (size - pad - radius));
      if (Math.hypot(dx, dy) > radius) {
        const i = (y * size + x) * 4;
        canvas.px[i + 3] = 0;
      }
    }
  }

  // Magnifier lens.
  const cx = 56 * s;
  const cy = 56 * s;
  const lensR = 27 * s;
  canvas.circle(cx, cy, lensR + 3.2 * s, [255, 255, 255], 0.95);
  canvas.circle(cx, cy, lensR, [255, 255, 255], 0.16);
  canvas.circle(cx, cy, lensR, [255, 255, 255], 0.95, 4.6 * s);

  // Rising sparkline inside the lens (the "hidden winner" signal).
  const points = [[cx - 16 * s, cy + 10 * s], [cx - 7 * s, cy + 1 * s], [cx + 1 * s, cy + 6 * s], [cx + 15 * s, cy - 12 * s]];
  for (let i = 0; i < points.length - 1; i++) {
    canvas.line(points[i][0], points[i][1], points[i + 1][0], points[i + 1][1], 4.4 * s, [255, 255, 255]);
  }

  // Handle with an arrow tip.
  canvas.line(cx + lensR * 0.78, cy + lensR * 0.78, 95 * s, 95 * s, 10.5 * s, [255, 255, 255]);
  canvas.circle(95 * s, 95 * s, 7 * s, [255, 255, 255]);

  return canvas.toBuffer();
}

mkdirSync(join(root, 'icons'), { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const png = encodePNG(drawIcon(size), size, size);
  writeFileSync(join(root, `icons/icon${size}.png`), png);
  console.log(`✓ icons/icon${size}.png (${png.length} bytes)`);
}
