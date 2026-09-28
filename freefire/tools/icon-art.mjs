// BOOYAH FIRE icon artwork: hand-rolled PNG encoder + a procedural flame badge.
// Imported by tools/make-icons-ff.mjs (web/PWA icons) and tools/build-apk.mjs
// (Android mipmap launcher icons).
import zlib from 'node:zlib';

export const ICON_PNG = true;

// ── minimal PNG encoder ─────────────────────────────────────────────────────
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
export function encodePNG(px, w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;                       // 8-bit RGBA
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0;                      // no filter
    Buffer.from(px.buffer, y * w * 4, w * 4).copy(raw, y * (1 + w * 4) + 1);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── tiny raster canvas ──────────────────────────────────────────────────────
export class C {
  constructor(w, h) { this.w = w; this.h = h; this.px = new Uint8ClampedArray(w * h * 4); }
  blend(x, y, r, g, b, a) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || a <= 0) return;
    const i = ((y | 0) * this.w + (x | 0)) * 4, ia = Math.min(1, a);
    this.px[i] = r * ia + this.px[i] * (1 - ia);
    this.px[i + 1] = g * ia + this.px[i + 1] * (1 - ia);
    this.px[i + 2] = b * ia + this.px[i + 2] * (1 - ia);
    this.px[i + 3] = Math.max(this.px[i + 3], ia * 255);
  }
  // soft edge coverage via 2×2 supersample
  poly(pts, color, alpha = 1) {
    const [r, g, b] = color;
    let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity;
    for (const [x, y] of pts) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
    for (let y = Math.max(0, minY | 0); y <= Math.min(this.h - 1, maxY | 0); y++) {
      for (let x = Math.max(0, minX | 0); x <= Math.min(this.w - 1, maxX | 0); x++) {
        let inside = 0;
        for (let sy = 0; sy < 2; sy++) for (let sx = 0; sx < 2; sx++) {
          const px = x + 0.25 + sx * 0.5, py = y + 0.25 + sy * 0.5;
          let hit = false;
          for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
            const [xi, yi] = pts[i], [xj, yj] = pts[j];
            if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) hit = !hit;
          }
          if (hit) inside++;
        }
        if (inside) this.blend(x, y, r, g, b, alpha * (inside / 4));
      }
    }
  }
  circle(cx, cy, rad, color, alpha = 1) {
    const pts = [];
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      pts.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad]);
    }
    this.poly(pts, color, alpha);
  }
  ring(cx, cy, rad, width, color, alpha = 1) {
    const outer = [], inner = [], N = 64;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      outer.push([cx + Math.cos(a) * (rad + width / 2), cy + Math.sin(a) * (rad + width / 2)]);
    }
    for (let i = N - 1; i >= 0; i--) {
      const a = (i / N) * Math.PI * 2;
      inner.push([cx + Math.cos(a) * (rad - width / 2), cy + Math.sin(a) * (rad - width / 2)]);
    }
    this.poly(outer.concat(inner), color, alpha);
  }
  gradientDisc(cx, cy, rad, stops, alpha = 1) {
    for (let y = Math.max(0, cy - rad | 0); y <= Math.min(this.h - 1, cy + rad | 0); y++) {
      for (let x = Math.max(0, cx - rad | 0); x <= Math.min(this.w - 1, cx + rad | 0); x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d > rad) continue;
        const t = d / rad;
        let c1 = stops[0], c2 = stops[stops.length - 1];
        for (let i = 0; i < stops.length - 1; i++) {
          if (t >= stops[i][0] && t <= stops[i + 1][0]) { c1 = stops[i]; c2 = stops[i + 1]; break; }
        }
        const k = (t - c1[0]) / Math.max(1e-6, c2[0] - c1[0]);
        const col = [0, 1, 2].map((i) => c1[1][i] + (c2[1][i] - c1[1][i]) * k);
        const edge = Math.min(1, (rad - d) / 1.5);
        this.blend(x, y, col[0], col[1], col[2], alpha * edge);
      }
    }
  }
}

// ── the artwork: flame badge with a parachute ───────────────────────────────
export function drawIcon(size, maskable) {
  const c = new C(size, size);
  const S = size / 512;                 // design is authored at 512
  const cx = 256 * S, cy = 256 * S;

  // background
  if (maskable) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const t = (x + y) / (size * 2);
        c.blend(x, y, 12 + t * 18, 16 + t * 26, 38 + t * 52, 1);
      }
    }
  } else {
    const r = size / 2;
    c.gradientDisc(cx, cy, r, [
      [0, [40, 60, 120]], [0.62, [18, 26, 58]], [1, [10, 14, 30]],
    ]);
    // outer glow ring
    c.ring(cx, cy, r - 5 * S, 7 * S, [255, 150, 30], 0.9);
  }

  // flame: layered teardrops
  const flame = (scale, color, alpha, dy) => {
    const pts = [];
    const N = 96;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const a = -Math.PI / 2 + t * Math.PI * 2;
      const wob = 1 + 0.16 * Math.sin(a * 3) + 0.08 * Math.sin(a * 5 + 1.1);
      const rr = (150 * scale) * wob * S;
      const yy = cy + dy * S + Math.sin(a) * rr;
      const xx = cx + Math.cos(a) * rr * 0.82;
      pts.push([xx, yy]);
    }
    c.poly(pts, color, alpha);
  };
  flame(1.0, [230, 60, 20], 0.95, 26);
  flame(0.82, [255, 120, 20], 0.95, 34);
  flame(0.6, [255, 190, 40], 1, 44);
  flame(0.38, [255, 240, 170], 1, 56);

  // parachute canopy (white with red panels) above the flame
  const canopyY = 150 * S;
  const canopyR = 128 * S;
  const canopy = [];
  for (let i = 0; i <= 48; i++) {
    const a = Math.PI + (i / 48) * Math.PI;
    canopy.push([cx + Math.cos(a) * canopyR, canopyY + Math.sin(a) * canopyR * 0.78]);
  }
  canopy.push([cx + canopyR, canopyY + 8 * S], [cx - canopyR, canopyY + 8 * S]);
  c.poly(canopy, [244, 246, 250], 1);
  // red panels: clipped to the dome ellipse
  const rim = canopyY + 8 * S;
  for (const off of [-0.66, 0, 0.66]) {
    const w = 0.17 * canopyR;
    const xs = [];
    for (let i = 0; i <= 24; i++) {
      const x = cx + off * canopyR - w + (i / 24) * 2 * w;
      const dx = (x - cx) / canopyR;
      const top = Math.abs(dx) < 1 ? canopyY - 0.78 * canopyR * Math.sqrt(1 - dx * dx) : rim;
      xs.push([x, top]);
    }
    c.poly(xs.concat([[cx + off * canopyR + w, rim], [cx + off * canopyR - w, rim]]), [224, 58, 48], 0.96);
  }
  // suspension lines + soldier
  for (const off of [-0.85, -0.3, 0.3, 0.85]) {
    c.poly([
      [cx + off * canopyR * 0.9, canopyY + 4 * S],
      [cx + off * 14 * S, canopyY + 92 * S],
      [cx + off * 14 * S + 2.5 * S, canopyY + 92 * S],
      [cx + off * canopyR * 0.9 + 2.5 * S, canopyY + 4 * S],
    ], [235, 238, 245], 0.9);
  }
  const sy = canopyY + 92 * S;
  c.poly([[cx - 20 * S, sy], [cx + 20 * S, sy], [cx + 16 * S, sy + 34 * S], [cx - 16 * S, sy + 34 * S]], [34, 42, 62], 1);
  c.circle(cx, sy - 12 * S, 13 * S, [238, 194, 158], 1);
  c.poly([[cx - 15 * S, sy - 18 * S], [cx + 15 * S, sy - 18 * S], [cx + 11 * S, sy - 28 * S], [cx - 11 * S, sy - 28 * S]], [46, 56, 80], 1);

  return c;
}

