// SWINDLE SQUAD launcher icons — procedural, zero-dependency, original art.
// A brass-framed club emblem: two stacked chips, a mask with narrow eyes, and a
// rose neon underline on the deep teal house colour. Writes swindle/icons/*.png
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { Raster, encodePNG, hex } from './pngkit.mjs';

const NAVY = '#12293a', NAVY2 = '#0b1620', GOLD = '#e8b64a', GOLD2 = '#ffd873', DEEP = '#a4332f';
const ROSE = '#ff3d7f', TEAL = '#1b3a4f', CREAM = '#f4ead3', MINT = '#39e6a0', AMBER = '#ffb347';

function diamond(c, cx, cy, r, col, aa = 255) {
  const [R, G, B] = hex(col);
  for (let y = Math.max(0, cy - r - 1); y < Math.min(c.h, cy + r + 1); y++) {
    for (let x = Math.max(0, cx - r - 1); x < Math.min(c.w, cx + r + 1); x++) {
      const d = Math.abs(x - cx) / r + Math.abs(y - cy) / r;
      if (d <= 1) c.blend(x, y, R, G, B, aa);
      else if (d <= 1.06) c.blend(x, y, R, G, B, aa * 0.4);
    }
  }
}
// mask with two eye slits + a sly smile
function mask(c, cx, cy, w, h2) {
  c.ellipse(cx + w * 0.06, cy + h2 * 0.07, w * 1.03, h2 * 1.02, '#0a1521', 200); // drop shadow
  c.ellipse(cx, cy, w, h2, CREAM);
  c.ellipse(cx, cy - h2 * 0.18, w * 0.94, h2 * 0.7, '#fffaf0');
  // eyes
  for (const s of [-1, 1]) {
    c.ellipse(cx + s * w * 0.42, cy - h2 * 0.16, w * 0.24, h2 * 0.11, NAVY2);
    c.thickLine(cx + s * w * 0.62, cy - h2 * 0.42, cx + s * w * 0.2, cy - h2 * 0.34, w * 0.06, DEEP);
  }
  // mouth
  c.thickLine(cx - w * 0.3, cy + h2 * 0.44, cx + w * 0.3, cy + h2 * 0.4, w * 0.075, DEEP);
  c.thickLine(cx + w * 0.3, cy + h2 * 0.4, cx + w * 0.42, cy + h2 * 0.3, w * 0.055, DEEP);
  // brow shine
  c.ellipse(cx - w * 0.28, cy - h2 * 0.52, w * 0.22, h2 * 0.07, '#ffffff', 110);
}
// filled rotated rectangle (cards, tags, anything tilted)
function rotRect(c, cx, cy, w, h, ang, col, aa = 255) {
  const [R, G, B] = hex(col), ca = Math.cos(ang), sa = Math.sin(ang);
  for (let y = -h / 2; y < h / 2; y += 0.5) {
    for (let x = -w / 2; x < w / 2; x += 0.5) c.blend(cx + x * ca - y * sa, cy + x * sa + y * ca, R, G, B, aa);
  }
}
function chip(c, cx, cy, r, edge, face) {
  c.circle(cx, cy, r, edge);
  c.circle(cx, cy, r * 0.78, face);
  c.circle(cx, cy, r * 0.42, face === GOLD ? DEEP : CREAM);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    c.rect(cx + Math.cos(a) * r * 0.86 - r * 0.07, cy + Math.sin(a) * r * 0.86 - r * 0.15, r * 0.14, r * 0.3, i % 2 ? CREAM : edge, 200);
  }
}

export function drawIcon(S, maskable) {
  const c = new Raster(S, S);
  const u = S / 512;
  c.grad(NAVY, TEAL, NAVY2);
  // warm key light from the chandelier + rose neon wash
  c.circle(S * 0.5, S * 0.12, 190 * u, GOLD, 26);
  c.circle(S * 0.86, S * 0.86, 150 * u, ROSE, 22);
  // carpet weave
  for (let y = 0; y < 8; y++) c.rect(0, S * (0.72 + y * 0.036), S, 1.2 * u, y % 2 ? '#0a1521' : '#1b3a4f', 40);
  // brass ring (the club frame)
  c.circle(S * 0.5, S * 0.5, 196 * u, '#6f5320', 255);
  c.circle(S * 0.5, S * 0.5, 188 * u, GOLD);
  c.circle(S * 0.5, S * 0.5, 168 * u, NAVY);
  c.ellipse(S * 0.5, S * 0.34, 150 * u, 44 * u, '#ffffff', 12);
  // table felt
  c.ellipse(S * 0.5, S * 0.74, 150 * u, 44 * u, '#14663f');
  c.ellipse(S * 0.5, S * 0.735, 132 * u, 34 * u, '#1a7d4d');
  // chips behind the mask
  chip(c, S * 0.27, S * 0.62, 42 * u, DEEP, CREAM);
  chip(c, S * 0.75, S * 0.6, 44 * u, GOLD, AMBER);
  chip(c, S * 0.56, S * 0.72, 38 * u, '#0d2b3a', MINT);
  // a leaning card (the fake deal)
  const tilt = -0.34;
  rotRect(c, S * 0.165, S * 0.42, 50 * u, 72 * u, tilt, '#0a1521', 170);
  rotRect(c, S * 0.16, S * 0.415, 48 * u, 70 * u, tilt, CREAM);
  rotRect(c, S * 0.16, S * 0.3, 48 * u, 9 * u, tilt, DEEP);
  diamond(c, S * 0.2, S * 0.47, 10 * u, DEEP);
  // the mask, front and centre
  mask(c, S * 0.5, S * 0.44, 84 * u, 98 * u);
  // signature underline
  c.thickLine(S * 0.24, S * 0.86, S * 0.76, S * 0.86, 10 * u, ROSE, 210);
  c.thickLine(S * 0.3, S * 0.9, S * 0.7, S * 0.9, 6 * u, GOLD, 190);
  // corner pips
  for (const [x, y] of [[0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9]]) diamond(c, S * x, S * y, 12 * u, GOLD, 150);
  if (!maskable) {
    // rounded tile + brass edge
    c.roundMask(S * 0.2);
    const edge = '#6f5320';
    for (let a = 0; a < 360; a += 1) {
      const t = (a * Math.PI) / 180;
      const x = S * 0.5 + Math.cos(t) * (S * 0.485), y = S * 0.5 + Math.sin(t) * (S * 0.485);
      c.rect(x, y, 2 * u, 2 * u, edge, 60);
    }
  }
  return encodePNG(c.px, S, S);
}

if (process.argv[1] && process.argv[1].endsWith('make-swindle-icons.mjs')) {
  const dir = path.resolve(import.meta.dirname, '..', 'swindle', 'icons');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'icon-192.png'), drawIcon(192, false));
  writeFileSync(path.join(dir, 'icon-512.png'), drawIcon(512, false));
  writeFileSync(path.join(dir, 'icon-maskable-512.png'), drawIcon(512, true));
  writeFileSync(path.join(dir, 'apple-touch-icon.png'), drawIcon(180, true));
  console.log('swindle icons →', dir);
}
