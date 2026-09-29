// Generates icons/icon-192.png, icon-512.png, icon-maskable-512.png
import { writeFileSync, mkdirSync } from 'node:fs';
import { Raster as C, encodePNG, hex } from './pngkit.mjs';

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
