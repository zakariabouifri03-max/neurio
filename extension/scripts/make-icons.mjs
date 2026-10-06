/**
 * Generates Etsy Signal extension icons (16/32/48/128) as PNGs with zero
 * dependencies: raw RGBA pixels -> zlib-compressed IDAT -> PNG container.
 * Design: dark slate rounded square with a green "signal" bar chart.
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "icons");
mkdirSync(outDir, { recursive: true });

const CRC_TABLE = (() => {
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
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function drawIcon(size) {
  const px = Buffer.alloc(size * size * 4);
  const bg = [15, 23, 42]; // slate-900
  const green = [34, 197, 94]; // green-500
  const accent = [249, 115, 22]; // orange-500
  const r = size * 0.18; // corner radius

  const inRoundedRect = (x, y) => {
    const cx = Math.min(Math.max(x, r), size - r);
    const cy = Math.min(Math.max(y, r), size - r);
    const dx = x - cx;
    const dy = y - cy;
    return dx * dx + dy * dy <= r * r;
  };

  // Signal bars: 5 bars, rising heights, last one accented.
  const bars = 5;
  const gap = size * 0.08;
  const barW = (size * 0.64 - gap * (bars - 1)) / bars;
  const x0 = size * 0.18;
  const bottom = size * 0.82;
  const heights = [0.18, 0.3, 0.42, 0.56, 0.68];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if (!inRoundedRect(x + 0.5, y + 0.5)) {
        px[i + 3] = 0;
        continue;
      }
      let [cr, cg, cb] = bg;
      for (let b = 0; b < bars; b++) {
        const bx = x0 + b * (barW + gap);
        const h = heights[b] * size;
        if (x >= bx && x <= bx + barW && y >= bottom - h && y <= bottom) {
          [cr, cg, cb] = b === bars - 1 ? accent : green;
        }
      }
      px[i] = cr;
      px[i + 1] = cg;
      px[i + 2] = cb;
      px[i + 3] = 255;
    }
  }
  return px;
}

for (const size of [16, 32, 48, 128]) {
  writeFileSync(join(outDir, `icon-${size}.png`), encodePng(size, drawIcon(size)));
}
console.log("icons written to extension/icons/");
