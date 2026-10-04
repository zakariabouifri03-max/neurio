// Generates streamer/icons PNGs — procedural "camera + LIVE" art
import zlib from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0); out.write(type, 4); data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type), data])), 8 + data.length);
  return out;
}
function encodePNG(px, w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) { raw[y * (1 + w * 4)] = 0; Buffer.from(px.buffer, y * w * 4, w * 4).copy(raw, y * (1 + w * 4) + 1); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

function draw(S) {
  const px = new Uint8ClampedArray(S * S * 4);
  const set = (x, y, r, g, b, a = 255) => {
    if (x < 0 || y < 0 || x >= S || y >= S) return;
    const i = (y * S + x) * 4, f = a / 255;
    px[i] = r * f + px[i] * (1 - f); px[i + 1] = g * f + px[i + 1] * (1 - f); px[i + 2] = b * f + px[i + 2] * (1 - f); px[i + 3] = Math.max(px[i + 3], a);
  };
  const u = S / 64;
  // bg gradient forest night
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const f = y / S;
    set(x, y, 24 + f * 10, 48 + f * 14, 62 - f * 20);
  }
  // pines silhouette
  for (let i = 0; i < 7; i++) {
    const cx = (4 + i * 9) * u, base = 58 * u, hgt = (14 + (i % 3) * 6) * u;
    for (let t = 0; t < hgt; t++) {
      const wdt = (1 - t / hgt) * 5 * u;
      for (let dx = -wdt; dx < wdt; dx++) set(Math.round(cx + dx), Math.round(base - t), 18, 40, 26);
    }
  }
  // camera body
  const bx = 12 * u, by = 22 * u, bw = 30 * u, bh = 20 * u;
  for (let y = by; y < by + bh; y++) for (let x = bx; x < bx + bw; x++) set(Math.round(x), Math.round(y), 40, 46, 56);
  // lens (right trapezoid)
  for (let y = 0; y < 14 * u; y++) for (let x = 0; x < 10 * u; x++) {
    const spread = 4 * u + (y / (14 * u)) * 6 * u;
    if (Math.abs(x - 5 * u) < 5 * u && y > (14 * u - spread) / 1) set(Math.round(42 * u + x), Math.round(25 * u + y), 52, 60, 72);
  }
  // lens glass
  for (let y = 28 * u; y < 38 * u; y++) for (let x = 44 * u; x < 52 * u; x++) set(Math.round(x), Math.round(y), 143, 227, 255);
  // screen glow on body
  for (let y = 25 * u; y < 39 * u; y++) for (let x = 15 * u; x < 27 * u; x++) set(Math.round(x), Math.round(y), 61, 111, 216);
  // LIVE dot + text block
  for (let y = 8 * u; y < 15 * u; y++) for (let x = 12 * u; x < 19 * u; x++) { if ((x - 15.5 * u) ** 2 + (y - 11.5 * u) ** 2 < (3.4 * u) ** 2) set(Math.round(x), Math.round(y), 255, 68, 56); }
  for (let y = 9 * u; y < 14 * u; y++) for (let x = 21 * u; x < 44 * u; x++) set(Math.round(x), Math.round(y), 245, 215, 110);
  // "2" glyph in the yellow block (dark pixels)
  const two = ['111', '001', '111', '100', '111'];
  two.forEach((row, ry) => { for (let rx = 0; rx < 3; rx++) if (row[rx] === '1') for (let dy = 0; dy < 1.2 * u; dy++) for (let dx = 0; dx < 1.2 * u; dx++) set(Math.round(30 * u + rx * 1.4 * u + dx), Math.round(9.4 * u + ry * 1.1 * u + dy), 36, 26, 5); });
  return px;
}

mkdirSync(new URL('../streamer/icons/', import.meta.url), { recursive: true });
for (const S of [192, 512]) {
  writeFileSync(new URL(`../streamer/icons/icon-${S}.png`, import.meta.url), encodePNG(draw(S), S, S));
}
// maskable: same but with safe padding bg
const S = 512;
writeFileSync(new URL('../streamer/icons/icon-maskable-512.png', import.meta.url), encodePNG(draw(S), S, S));
console.log('icons written');
