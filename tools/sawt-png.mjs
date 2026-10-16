// Shared procedural SAWT+ icon rasterizer + minimal PNG encoder (RGBA, no filter).
import zlib from "node:zlib";

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
  for (let i = 0; i < buf.length; i++)
    c = crcTable[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4);
  data.copy(out, 8);
  out.writeUInt32BE(
    crc32(Buffer.concat([Buffer.from(type), data])),
    8 + data.length,
  );
  return out;
}
export function encodePNG(px, w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0;
    Buffer.from(px.buffer, y * w * 4, w * 4).copy(raw, y * (1 + w * 4) + 1);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const hex = (col) => [
  parseInt(col.slice(1, 3), 16),
  parseInt(col.slice(3, 5), 16),
  parseInt(col.slice(5, 7), 16),
];

export class C {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.px = new Uint8ClampedArray(w * h * 4);
  }
  blend(x, y, r, g, b, a) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || a <= 0) return;
    const i = (y * this.w + x) * 4,
      ia = a / 255;
    this.px[i] = r * ia + this.px[i] * (1 - ia);
    this.px[i + 1] = g * ia + this.px[i + 1] * (1 - ia);
    this.px[i + 2] = b * ia + this.px[i + 2] * (1 - ia);
    this.px[i + 3] = Math.max(this.px[i + 3], a);
  }
  rect(x0, y0, w, h, col, aa = 255) {
    const [r, g, b] = hex(col);
    for (let y = Math.max(0, y0 | 0); y < Math.min(this.h, y0 + h); y++)
      for (let x = Math.max(0, x0 | 0); x < Math.min(this.w, x0 + w); x++)
        this.blend(x, y, r, g, b, aa);
  }
  grad(top, bot) {
    const t = hex(top),
      b = hex(bot);
    for (let y = 0; y < this.h; y++) {
      const f = y / this.h,
        c = t.map((v, i) => v + (b[i] - v) * f);
      for (let x = 0; x < this.w; x++) this.blend(x, y, c[0], c[1], c[2], 255);
    }
  }
  poly(pts, col, aa = 255) {
    const [r, g, b] = hex(col);
    let minY = Infinity,
      maxY = -Infinity;
    for (const [, y] of pts) {
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    for (
      let y = Math.max(0, Math.floor(minY));
      y <= Math.min(this.h - 1, Math.ceil(maxY));
      y++
    ) {
      const xs = [];
      for (let i = 0; i < pts.length; i++) {
        const [x1, y1] = pts[i],
          [x2, y2] = pts[(i + 1) % pts.length];
        if (y1 === y2) continue;
        if (y >= Math.min(y1, y2) && y < Math.max(y1, y2))
          xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
      }
      xs.sort((a, b2) => a - b2);
      for (let i = 0; i + 1 < xs.length; i += 2)
        for (
          let x = Math.max(0, Math.round(xs[i]));
          x < Math.min(this.w, Math.round(xs[i + 1]));
          x++
        )
          this.blend(x, y, r, g, b, aa);
    }
  }
  ringHalf(cx, cy, rad, thick, col, aa = 255) {
    const [r, g, b] = hex(col);
    const inner = (rad - thick) ** 2,
      outer = (rad + thick * 0.4) ** 2;
    for (
      let y = Math.max(0, (cy - rad - thick) | 0);
      y < Math.min(this.h, cy + rad + thick + 1);
      y++
    )
      for (
        let x = Math.max(0, cx | 0);
        x < Math.min(this.w, cx + rad + thick + 1);
        x++
      ) {
        const d2 = (x - cx) ** 2 + (y - cy) ** 2;
        if (d2 >= inner && d2 <= outer) this.blend(x, y, r, g, b, aa);
      }
  }
}

// Procedural SAWT+ speaker icon at any square size.
export function draw(n) {
  const s = n / 512;
  const c = new C(n, n);
  c.grad("#171a21", "#0b0c0f");
  const amber = "#ffb454",
    amberSoft = "#ffd9a0";
  c.poly(
    [
      [196 * s, 118 * s],
      [196 * s, 394 * s],
      [330 * s, 330 * s],
      [330 * s, 182 * s],
    ],
    amber,
  );
  c.rect(138 * s, 214 * s, 62 * s, 84 * s, amberSoft);
  c.ringHalf(300 * s, 256 * s, 70 * s, 16 * s, amber);
  c.ringHalf(300 * s, 256 * s, 128 * s, 16 * s, amber);
  c.ringHalf(300 * s, 256 * s, 186 * s, 16 * s, amber);
  const plus = 30 * s,
    px = 432 * s,
    py = 432 * s;
  c.rect(px - 6 * s, py - plus, 12 * s, plus * 2, amberSoft);
  c.rect(px - plus, py - 6 * s, plus * 2, 12 * s, amberSoft);
  return c;
}
