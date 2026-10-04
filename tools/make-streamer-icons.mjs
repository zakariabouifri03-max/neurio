// Generates streamer/icons/icon-192.png + icon-512.png + icon-maskable-512.png
// Hand-rolled PNG encoder + procedural "streamer monitor + LIVE" art.
import zlib from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

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
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
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
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0;
    Buffer.from(px.buffer, y * w * 4, w * 4).copy(raw, y * (1 + w * 4) + 1);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

function draw(size, maskable) {
  const px = new Uint8Array(size * size * 4);
  const S = size;
  const P = (x, y, r, g, b, a = 255) => {
    if (x < 0 || y < 0 || x >= S || y >= S) return;
    const i = (y * S + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
  };
  const inRR = (x, y, rx, ry, rw, rh, rad) => {
    const cx = Math.max(rx, Math.min(x, rx + rw)), cy = Math.max(ry, Math.min(y, ry + rh));
    return (x - cx) ** 2 + (y - cy) ** 2 <= rad * rad || (x >= rx + rad && x <= rx + rw - rad && y >= ry && y <= ry + rh) || (y >= ry + rad && y <= ry + rh - rad && x >= rx && x <= rx + rw);
  };
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S;
    // bg: night-blue gradient
    let r = 16 + v * 14, g = 24 + v * 20, b = 48 + v * 30;
    if (maskable) { P(x, y, r, g, b); continue; }
    if (!inRR(x, y, S * 0.02, S * 0.02, S * 0.96, S * 0.96, S * 0.18)) { P(x, y, 0, 0, 0, 0); continue; }
    // monitor frame (yellow)
    const mx = S * 0.18, my = S * 0.2, mw = S * 0.64, mh = S * 0.44;
    if (inRR(x, y, mx, my, mw, mh, S * 0.03)) { r = 244; g = 200; b = 24; }
    // screen (dark purple)
    if (inRR(x, y, mx + S * 0.035, my + S * 0.035, mw - S * 0.07, mh - S * 0.07, S * 0.02)) { r = 38; g = 26; b = 62; }
    // LIVE dot
    const dx = x - (mx + S * 0.1), dy = y - (my + S * 0.1);
    if (dx * dx + dy * dy < (S * 0.045) ** 2) { r = 255; g = 60; b = 60; }
    // "chat lines" on screen
    if (x > mx + S * 0.18 && x < mx + S * 0.5 && (Math.floor((y - my) / (S * 0.07)) % 2 === 0) && y > my + S * 0.16 && y < my + mh - S * 0.1 && (y % (S * 0.07)) < S * 0.02) { r = 140; g = 220; b = 140; }
    // stand
    if (inRR(x, y, S * 0.44, my + mh, S * 0.12, S * 0.08, S * 0.02)) { r = 200; g = 165; b = 20; }
    if (inRR(x, y, S * 0.34, my + mh + S * 0.08, S * 0.32, S * 0.045, S * 0.02)) { r = 200; g = 165; b = 20; }
    // mic (right side)
    const mcx = S * 0.78, mcy = S * 0.62;
    const mdx = x - mcx, mdy = y - mcy;
    if (mdx * mdx + mdy * mdy < (S * 0.07) ** 2 && y < mcy) { r = 190; g = 190; b = 200; }
    if (Math.abs(x - mcx) < S * 0.015 && y > mcy && y < mcy + S * 0.14) { r = 120; g = 120; b = 130; }
    P(x, y, r, g, b);
  }
  return encodePNG(px, S, S);
}

if (!process.env.NO_MAIN) {
  mkdirSync('streamer/icons', { recursive: true });
  writeFileSync('streamer/icons/icon-192.png', draw(192, false));
  writeFileSync('streamer/icons/icon-512.png', draw(512, false));
  writeFileSync('streamer/icons/icon-maskable-512.png', draw(512, true));
  console.log('streamer icons written');
}
export { draw };
