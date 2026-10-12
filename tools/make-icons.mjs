#!/usr/bin/env node
/**
 * Generates the Neurio logo (PNG + Windows .ico + renderer favicon) with plain
 * JavaScript — no image libraries, no downloads.
 *
 *   node tools/make-icons.mjs
 *
 * Output:
 *   build/icon.ico        16/32/48/64/128/256 px, PNG-compressed entries
 *   build/icon-256.png    high-resolution master
 *   public/icon.png       favicon used by the renderer
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

/* ----------------------------- PNG encoding ------------------------------ */

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* --------------------------- logo rasterisation -------------------------- */

const lerp = (a, b, t) => a + (b - a) * t;

/** Distance from point p to the segment ab. */
function segmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function blend(base, overlay, alpha) {
  return [
    Math.round(lerp(base[0], overlay[0], alpha)),
    Math.round(lerp(base[1], overlay[1], alpha)),
    Math.round(lerp(base[2], overlay[2], alpha)),
  ];
}

/**
 * Draws the Neurio mark: a rounded square with a violet→cyan gradient and a
 * three-node neural "N" (two input nodes, one output, connected).
 */
function raster(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const radius = 0.23;             // corner radius, fraction of the icon
  const halfStroke = 0.035;        // half line thickness, fraction
  const nodeRadius = 0.078;        // node radius, fraction
  const aa = 0.5 / size;           // anti-alias ramp in fraction units

  // Four nodes forming an "N": left column, diagonal, right column.
  const nodes = [
    { x: 0.31, y: 0.74 },
    { x: 0.31, y: 0.26 },
    { x: 0.71, y: 0.26 },
    { x: 0.71, y: 0.74 },
  ];
  const links = [
    [0, 1],
    [1, 3],
    [3, 2],
  ];

  const clamp01 = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = (x + 0.5) / size;
      const v = (y + 0.5) / size;

      // Rounded-square mask with anti-aliased corners.
      const dx = Math.max(radius - u, 0, u - (1 - radius));
      const dy = Math.max(radius - v, 0, v - (1 - radius));
      const mask = clamp01((radius - Math.hypot(dx, dy)) / aa + 0.5);
      if (mask <= 0) continue;

      // Background: deep indigo at the edges, violet towards the middle.
      const centre = Math.hypot(u - 0.5, v - 0.5) / 0.71;
      const t = 1 - centre * 0.85;
      let colour = [
        Math.round(lerp(24, 88, t)),
        Math.round(lerp(26, 101, t)),
        Math.round(lerp(40, 242, t)),
      ];

      // Soft glow under the mark.
      let nearest = 1;
      for (const node of nodes) {
        nearest = Math.min(nearest, Math.hypot(u - node.x, v - node.y));
      }
      const glow = clamp01((0.26 - nearest) / 0.26);
      colour = blend(colour, [170, 190, 255], glow * 0.18);

      // Links.
      let linkAlpha = 0;
      for (const [a, b] of links) {
        const distance = segmentDistance(u, v, nodes[a].x, nodes[a].y, nodes[b].x, nodes[b].y);
        linkAlpha = Math.max(linkAlpha, clamp01((halfStroke - distance) / aa + 0.5));
      }
      if (linkAlpha > 0) colour = blend(colour, [226, 232, 255], linkAlpha);

      // Nodes.
      let nodeAlpha = 0;
      for (const node of nodes) {
        const distance = Math.hypot(u - node.x, v - node.y);
        nodeAlpha = Math.max(nodeAlpha, clamp01((nodeRadius - distance) / aa + 0.5));
      }
      if (nodeAlpha > 0) colour = blend(colour, [255, 255, 255], nodeAlpha);

      const offset = (y * size + x) * 4;
      pixels[offset] = colour[0];
      pixels[offset + 1] = colour[1];
      pixels[offset + 2] = colour[2];
      pixels[offset + 3] = Math.round(mask * 255);
    }
  }
  return pixels;
}

/** The same raster, PNG-encoded. */
function renderIcon(size) {
  return encodePng(size, size, raster(size));
}

/**
 * Maskable launcher icon: the mark is drawn at 78 % into a square canvas and the
 * background bleeds to the edges, so Android can crop it to a circle or a squircle
 * without cutting the logo.
 */
function renderMaskable(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const innerSize = Math.round(size * 0.78);
  const offset = Math.round((size - innerSize) / 2);
  const inner = raster(innerSize);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const target = (y * size + x) * 4;
      // Background bleeds to the edges: the icon's own corner colour.
      pixels[target] = 26;
      pixels[target + 1] = 28;
      pixels[target + 2] = 44;
      pixels[target + 3] = 255;
    }
  }

  for (let y = 0; y < innerSize; y += 1) {
    for (let x = 0; x < innerSize; x += 1) {
      const source = (y * innerSize + x) * 4;
      const alpha = inner[source + 3] / 255;
      if (alpha <= 0) continue;
      const targetX = x + offset;
      const targetY = y + offset;
      if (targetX >= size || targetY >= size) continue;
      const target = (targetY * size + targetX) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        pixels[target + channel] = Math.round(pixels[target + channel] * (1 - alpha) + inner[source + channel] * alpha);
      }
      pixels[target + 3] = 255;
    }
  }
  return encodePng(size, size, pixels);
}

/* ------------------------------ ICO container ---------------------------- */

function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);

  const directory = Buffer.alloc(entries.length * 16);
  let offset = 6 + entries.length * 16;
  entries.forEach((entry, index) => {
    const base = index * 16;
    directory[base] = entry.size >= 256 ? 0 : entry.size;
    directory[base + 1] = entry.size >= 256 ? 0 : entry.size;
    directory[base + 2] = 0; // palette
    directory[base + 3] = 0; // reserved
    directory.writeUInt16LE(1, base + 4); // colour planes
    directory.writeUInt16LE(32, base + 6); // bits per pixel
    directory.writeUInt32LE(entry.data.length, base + 8);
    directory.writeUInt32LE(offset, base + 12);
    offset += entry.data.length;
  });

  return Buffer.concat([header, directory, ...entries.map((entry) => entry.data)]);
}

/* --------------------------------- main --------------------------------- */

const sizes = [16, 24, 32, 48, 64, 128, 256];
const pngs = new Map(sizes.map((size) => [size, renderIcon(size)]));

mkdirSync(join(root, 'build'), { recursive: true });
mkdirSync(join(root, 'public'), { recursive: true });

const ico = buildIco(sizes.map((size) => ({ size, data: pngs.get(size) })));
writeFileSync(join(root, 'build', 'icon.ico'), ico);
writeFileSync(join(root, 'build', 'icon-256.png'), pngs.get(256));
writeFileSync(join(root, 'build', 'icon-512.png'), renderIcon(512));

/* ------------------------------ web / PWA -------------------------------- */

writeFileSync(join(root, 'public', 'icon.png'), pngs.get(256));
writeFileSync(join(root, 'public', 'icon-192.png'), renderIcon(192));
writeFileSync(join(root, 'public', 'icon-512.png'), renderIcon(512));
// Maskable icons are cropped to a circle by Android: pad the mark into a 512 canvas
// so nothing important sits near the edge.
writeFileSync(join(root, 'public', 'icon-maskable-512.png'), renderMaskable(512));

/* ------------------------------- Android --------------------------------- */

const MIPMAPS = [
  ['mdpi', 48],
  ['hdpi', 72],
  ['xhdpi', 96],
  ['xxhdpi', 144],
  ['xxxhdpi', 192],
];
for (const [density, size] of MIPMAPS) {
  const dir = join(root, 'android', 'app', 'src', 'main', 'res', `mipmap-${density}`);
  mkdirSync(dir, { recursive: true });
  const png = renderIcon(size);
  writeFileSync(join(dir, 'ic_launcher.png'), png);
  writeFileSync(join(dir, 'ic_launcher_round.png'), png);
}

console.log('icons written:');
console.log('  build/icon.ico        ', ico.length, 'bytes');
console.log('  build/icon-256.png    ', pngs.get(256).length, 'bytes');
console.log('  public/icon.png       ', pngs.get(256).length, 'bytes');
console.log('  public/icon-512.png   ', 'maskable + 192 + 512 px');
console.log('  android/…/mipmap-*    ', MIPMAPS.map(([d, s]) => `${d}(${s})`).join(' '));
