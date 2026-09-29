// Generates scam/icons/icon-192.png, icon-512.png, icon-maskable-512.png
// Hand-rolled PNG encoder + procedural art: a retro office desk with a ringing
// phone and a "quota" board. No dependencies, no network.
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

// ── tiny 2D helper on a Float/Uint8 raster ──
function makeCanvas(size) {
  const px = new Uint8Array(size * size * 4);
  const set = (x, y, r, g, b, a = 255) => {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    const sa = a / 255, da = px[i + 3] / 255;
    const oa = sa + da * (1 - sa);
    if (oa <= 0) return;
    px[i] = Math.round((r * sa + px[i] * da * (1 - sa)) / oa);
    px[i + 1] = Math.round((g * sa + px[i + 1] * da * (1 - sa)) / oa);
    px[i + 2] = Math.round((b * sa + px[i + 2] * da * (1 - sa)) / oa);
    px[i + 3] = Math.round(oa * 255);
  };
  const rect = (x0, y0, w, h, c, a) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) set(x, y, c[0], c[1], c[2], a);
  };
  const roundRect = (x0, y0, w, h, r, c, a) => {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = Math.min(x, w - 1 - x), dy = Math.min(y, h - 1 - y);
        if (dx < r && dy < r) {
          const d = Math.hypot(r - dx, r - dy);
          if (d > r) continue;
          set(x0 + x, y0 + y, c[0], c[1], c[2], a * (d > r - 1 ? r - d : 1));
        } else set(x0 + x, y0 + y, c[0], c[1], c[2], a);
      }
    }
  };
  const disc = (cx, cy, rad, c, a = 255) => {
    for (let y = -rad; y <= rad; y++) for (let x = -rad; x <= rad; x++) {
      const d = Math.hypot(x, y);
      if (d <= rad) set(cx + x, cy + y, c[0], c[1], c[2], a * (d > rad - 1.2 ? rad - d : 1));
    }
  };
  const line = (x0, y0, x1, y1, wdt, c, a = 255) => {
    const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 1.5);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      disc(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, wdt / 2, c, a);
    }
  };
  const grad = (c0, c1) => {
    for (let y = 0; y < size; y++) {
      const t = y / size;
      const c = [0, 1, 2].map((k) => Math.round(c0[k] + (c1[k] - c0[k]) * t));
      rect(0, y, size, 1, c, 255);
    }
  };
  return { px, set, rect, roundRect, disc, line, grad, size };
}

function drawIcon(size, maskable) {
  const c = makeCanvas(size);
  const S = size / 512;                    // design grid is 512×512
  const px = (v) => Math.round(v * S);
  // background
  c.grad([26, 40, 66], [9, 13, 22]);
  // subtle vignette
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - size / 2, y - size / 2) / (size * 0.7);
      if (d > 0.55) c.set(x, y, 0, 0, 0, Math.min(150, (d - 0.55) * 420));
    }
  }
  // floor
  c.rect(0, px(376), size, size, [34, 42, 58], 255);
  c.rect(0, px(372), size, px(6), [70, 84, 110], 200);
  // back wall poster "KOTA"
  c.roundRect(px(56), px(56), px(400), px(150), px(14), [244, 241, 230], 255);
  c.roundRect(px(70), px(70), px(372), px(122), px(8), [18, 26, 42], 255);
  // quota bar on the board
  c.roundRect(px(96), px(120), px(320), px(30), px(15), [20, 30, 48], 255);
  c.roundRect(px(100), px(124), px(240), px(22), px(11), [49, 209, 139], 255);
  c.disc(px(388), px(135), px(9), [255, 93, 108], 255);
  // desk
  c.roundRect(px(40), px(300), px(432), px(56), px(12), [138, 90, 53], 255);
  c.roundRect(px(40), px(300), px(432), px(16), px(8), [168, 114, 70], 255);
  // legs
  c.roundRect(px(62), px(352), px(26), px(96), px(8), [122, 130, 142], 255);
  c.roundRect(px(424), px(352), px(26), px(96), px(8), [122, 130, 142], 255);
  // monitor
  c.roundRect(px(250), px(176), px(180), px(124), px(10), [42, 47, 56], 255);
  c.roundRect(px(260), px(186), px(160), px(104), px(6), [30, 88, 152], 255);
  c.rect(px(268), px(196), px(120), px(8), [120, 190, 255], 210);
  c.rect(px(268), px(212), px(90), px(8), [120, 190, 255], 170);
  c.rect(px(268), px(228), px(140), px(8), [120, 190, 255], 140);
  c.roundRect(px(330), px(300), px(22), px(20), px(4), [60, 68, 80], 255);
  // phone (ringing) on the desk
  c.roundRect(px(70), px(322), px(150), px(46), px(14), [24, 27, 34], 255);
  c.roundRect(px(74), px(318), px(64), px(26), px(12), [32, 36, 44], 255);
  c.roundRect(px(150), px(318), px(64), px(26), px(12), [32, 36, 44], 255);
  // ring waves
  [[14, 150], [22, 200], [30, 250]].forEach(([r, a]) => {
    c.disc(px(300), px(300), px(r), [49, 209, 139], a * 0.20);
  });
  // headset on the desk
  c.line(px(238), px(336), px(300), px(336), px(10), [220, 226, 238], 255);
  c.disc(px(232), px(336), px(16), [220, 226, 238], 255);
  c.disc(px(306), px(336), px(16), [220, 226, 238], 255);
  // warning stamp
  c.roundRect(px(64), px(196), px(150), px(74), px(12), [192, 57, 43], 235);
  c.roundRect(px(72), px(204), px(134), px(58), px(8), [244, 241, 230], 245);
  c.rect(px(84), px(216), px(110), px(10), [192, 57, 43], 255);
  c.rect(px(84), px(234), px(76), px(10), [192, 57, 43], 255);
  // maskable: keep the art inside the safe zone (no extra cropping here)
  if (maskable) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const d = Math.max(Math.abs(x - size / 2), Math.abs(y - size / 2)) / (size / 2);
        if (d > 0.86) c.set(x, y, 8, 12, 20, Math.min(255, (d - 0.86) * 1400));
      }
    }
  }
  return c;
}

const root = new URL('..', import.meta.url).pathname + 'scam/icons/';
mkdirSync(root, { recursive: true });
for (const [name, size, maskable] of [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-512.png', 512, true],
]) {
  const c = drawIcon(size, maskable);
  writeFileSync(root + name, encodePNG(c.px, size, size));
  console.log('wrote scam/icons/' + name);
}
