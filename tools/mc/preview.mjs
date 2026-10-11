// ═══════════════════════════════════════════════════════════════════════════
//  PREVIEW RENDER — a tiny CPU ray-caster that renders the *real* generated
//  voxel world through the *real* procedural texture atlas, with the same face
//  shading, biome tint and sun direction the WebGL viewer uses. It exists so
//  the world can be eyeballed without a GPU (and it doubles as a regression
//  test: if a house is missing or a texture is garbled, it shows up here).
//  Usage: node tools/mc/preview.mjs [seed] [out.png] [azimuth] [elevation]
// ═══════════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import zlib from 'node:zlib';
import './stub.js';

const THREE_PATH = '/home/user/neurio/node_modules/three/build/three.module.js';
await import(THREE_PATH);
const { generateTerrain, SEA, SIZE } = await import('/home/user/neurio/src/minecraft/terrain.js');
const { populate } = await import('/home/user/neurio/src/minecraft/structures.js');
const { buildAtlas, PALETTE, TILES, ATLAS, GRID, TILE, B } = await import('/home/user/neurio/src/minecraft/textures.js');
const { BIOME_TINT } = await import('/home/user/neurio/src/minecraft/voxels.js');

const seed = Number(process.argv[2] || 20261011);
const out = process.argv[3] || '/home/user/neurio/tools/mc/preview.png';
const az = Number(process.argv[4] ?? 0.72);
const el = Number(process.argv[5] ?? 0.34);
const W = Number(process.env.PW || 1280), H = Number(process.env.PH || 720);
const AIM = process.env.AIM || 'house';
const HOUR = Number(process.argv[6] ?? 9.4);

const t0 = Date.now();
const T = generateTerrain(seed);
const E = { torches: [], lights: [], campfires: [], beacons: [], spawn: {} };
populate(T, E);
const atlas = buildAtlas(seed);
const world = T.world;
console.log('generated in', Date.now() - t0, 'ms —', world.blockCount, 'blocks');

// ── atlas pixels ────────────────────────────────────────────────────────────
const ac = atlas.atlasCanvas.getContext('2d');
const PIX = ac._img.data;                       // stub canvas keeps raw RGBA
const px = (tile, u, v) => {
  const tx = (tile % GRID) * TILE, ty = Math.floor(tile / GRID) * TILE;
  let iu = Math.floor(u * TILE), iv = Math.floor(v * TILE);
  iu = Math.max(0, Math.min(TILE - 1, iu)); iv = Math.max(0, Math.min(TILE - 1, iv));
  const o = ((ty + iv) * ATLAS + (tx + iu)) * 4;
  return [PIX[o], PIX[o + 1], PIX[o + 2], PIX[o + 3]];
};

// ── camera ──────────────────────────────────────────────────────────────────
const house = E.layout.house;
const targets = {
  house: house ? { x: house.doorX, y: house.y + 3, z: house.cz } : { x: 0, y: SEA + 3, z: 0 },
  tower: E.layout.tower ? { x: E.layout.tower.cx, y: E.layout.tower.dy + 2, z: E.layout.tower.cz } : null,
  farm: E.layout.farm ? { x: (E.layout.farm.x0 + E.layout.farm.x1) / 2, y: E.layout.farm.y + 1, z: (E.layout.farm.z0 + E.layout.farm.z1) / 2 } : null,
  camp: E.campfires[0] ? { x: E.campfires[0].x, y: E.campfires[0].y + 1, z: E.campfires[0].z } : null,
  dock: E.dock ? { x: (E.dock.start.x + E.dock.end.x) / 2, y: SEA + 1, z: (E.dock.start.z + E.dock.end.z) / 2 } : null,
  mine: E.layout.mine ? { x: E.layout.mine.x, y: E.layout.mine.y + 2, z: E.layout.mine.z } : null,
};
const target = targets[AIM] || targets.house;
const dist = AIM === 'dock' ? 40 : AIM === 'camp' ? 16 : AIM === 'tower' ? 46 : 62;
const eye = {
  x: target.x + Math.sin(az) * Math.cos(el) * dist,
  y: target.y + Math.sin(el) * dist,
  z: target.z + Math.cos(az) * Math.cos(el) * dist,
};
// never let the camera sit inside terrain (same rule as the WebGL viewer)
eye.y = Math.max(eye.y, T.surface(eye.x, eye.z) + 2.5, SEA + 2);
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const norm = (a) => { const l = Math.hypot(a.x, a.y, a.z) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l }; };
const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const F = norm(sub(target, eye));
const R = norm(cross(F, { x: 0, y: 1, z: 0 }));
const U = cross(R, F);
const FOV = 52 * Math.PI / 180;
const halfH = Math.tan(FOV / 2), halfW = halfH * (W / H);

// sun direction + sky palette for the chosen hour
const hour = HOUR;
const KEYS = [
  [0, [0.02, 0.03, 0.06], [0.04, 0.06, 0.13]],
  [5.6, [0.16, 0.25, 0.47], [0.88, 0.51, 0.31]],
  [7.2, [0.24, 0.5, 0.83], [1.0, 0.85, 0.65]],
  [12, [0.19, 0.47, 0.85], [0.71, 0.86, 0.97]],
  [18.6, [0.16, 0.21, 0.42], [0.95, 0.47, 0.25]],
  [20, [0.04, 0.07, 0.19], [0.17, 0.13, 0.27]],
  [24, [0.02, 0.03, 0.06], [0.04, 0.06, 0.13]],
];
let ka = KEYS[0], kb = KEYS[KEYS.length - 1];
for (let i = 0; i < KEYS.length - 1; i++) if (hour >= KEYS[i][0] && hour <= KEYS[i + 1][0]) { ka = KEYS[i]; kb = KEYS[i + 1]; break; }
const kt = (hour - ka[0]) / Math.max(1e-6, kb[0] - ka[0]);
const SKY_ZEN = ka[1].map((v, i) => v + (kb[1][i] - v) * kt);
const SKY_HOR = ka[2].map((v, i) => v + (kb[2][i] - v) * kt);
const ang = (hour / 24) * Math.PI * 2 - Math.PI / 2;
const SUN = norm({ x: Math.cos(ang) * 0.86, y: Math.sin(ang), z: 0.34 });
const elevSun = Math.sin(ang);
const SUN_COL = elevSun < 0.12 ? [1, 0.55, 0.32] : [1, 0.965, 0.9];
const SUN_I = Math.max(0, elevSun) * 1.35 + (hour > 19.5 || hour < 4.8 ? 0.0 : 0);
const MOON_I = (hour > 19.2 || hour < 5.0) ? 0.22 : 0;
const FACE_SH = [0.74, 0.74, 1.0, 0.46, 0.88, 0.88];     // +x,−x,+y,−y,+z,−z
const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

function march(o, d, maxT, stopWater) {
  let x = Math.floor(o.x), y = Math.floor(o.y), z = Math.floor(o.z);
  const sx = d.x > 0 ? 1 : -1, sy = d.y > 0 ? 1 : -1, sz = d.z > 0 ? 1 : -1;
  const ddx = Math.abs(d.x) < 1e-9 ? Infinity : Math.abs(1 / d.x);
  const ddy = Math.abs(d.y) < 1e-9 ? Infinity : Math.abs(1 / d.y);
  const ddz = Math.abs(d.z) < 1e-9 ? Infinity : Math.abs(1 / d.z);
  let tx = ddx === Infinity ? Infinity : (d.x > 0 ? (x + 1 - o.x) : (o.x - x)) * ddx;
  let ty = ddy === Infinity ? Infinity : (d.y > 0 ? (y + 1 - o.y) : (o.y - y)) * ddy;
  let tz = ddz === Infinity ? Infinity : (d.z > 0 ? (z + 1 - o.z) : (o.z - z)) * ddz;
  let face = -1, t = 0;
  let skip = world.get(x, y, z) ? 1 : 0;      // never test the containing cell
  while (t <= maxT) {
    const id = skip ? 0 : world.get(x, y, z);
    skip = 0;
    if (id) {
      const p = PALETTE[id];
      if (id !== B.WATER || stopWater) return { x, y, z, id, face, t, p };
    }
    if (tx < ty && tx < tz) { x += sx; t = tx; tx += ddx; face = sx > 0 ? 1 : 0; }
    else if (ty < tz) { y += sy; t = ty; ty += ddy; face = sy > 0 ? 3 : 2; }
    else { z += sz; t = tz; tz += ddz; face = sz > 0 ? 5 : 4; }
  }
  return null;
}

// face index → tile + local uv from the hit point
function faceUV(hit, hx, hy, hz) {
  const p = hit.p, tiles = p.tiles;
  const f = hit.face < 0 ? 2 : hit.face;
  const tile = f === 2 ? tiles[0] : f === 3 ? tiles[1] : tiles[2];
  const dx = hx - hit.x, dy = hy - hit.y, dz = hz - hit.z;
  let u = 0, v = 0;
  switch (f) {
    case 0: u = 1 - dz; v = dy; break;
    case 1: u = dz; v = dy; break;
    case 2: u = dx; v = 1 - dz; break;
    case 3: u = dx; v = dz; break;
    case 4: u = dx; v = dy; break;
    case 5: u = 1 - dx; v = dy; break;
  }
  return { tile, u: Math.max(0, Math.min(0.9999, u)), v: Math.max(0, Math.min(0.9999, v)), f };
}

function skyColor(d) {
  const h = Math.max(0, d.y);
  const t = Math.pow(h * 0.5 + 0.5, 0.52);
  const k = Math.min(1, Math.max(0, (t - 0.42) / 0.53));
  let r = SKY_HOR[0] + (SKY_ZEN[0] - SKY_HOR[0]) * k;
  let g = SKY_HOR[1] + (SKY_ZEN[1] - SKY_HOR[1]) * k;
  let b = SKY_HOR[2] + (SKY_ZEN[2] - SKY_HOR[2]) * k;
  const sd = Math.max(0, dot(d, SUN));
  const disc = sd > 0.9993 ? 8.0 : 0;
  r += SUN_COL[0] * (disc + Math.pow(sd, 200) * 0.8 + Math.pow(sd, 12) * 0.16);
  g += SUN_COL[1] * (disc + Math.pow(sd, 200) * 0.8 + Math.pow(sd, 12) * 0.16);
  b += SUN_COL[2] * (disc + Math.pow(sd, 200) * 0.8 + Math.pow(sd, 12) * 0.16);
  return [r, g, b];
}

// ── render ──────────────────────────────────────────────────────────────────
const img = Buffer.alloc(W * H * 3);
const t1 = Date.now();
for (let py = 0; py < H; py++) {
  const ny = 1 - (py + 0.5) / H * 2;
  for (let pxx = 0; pxx < W; pxx++) {
    const nx = (pxx + 0.5) / W * 2 - 1;
    const d = norm({
      x: F.x + R.x * nx * halfW + U.x * ny * halfH,
      y: F.y + R.y * nx * halfW + U.y * ny * halfH,
      z: F.z + R.z * nx * halfW + U.z * ny * halfH,
    });
    let col = skyColor(d);
    // open-ocean plane (the animated disc in the WebGL viewer)
    const OCEAN_Y = SEA + 0.88;
    if (d.y < -1e-4) {
      const tOc = (OCEAN_Y - eye.y) / d.y;
      if (tOc > 0 && tOc < 500) {
        const sc = skyColor(d);
        const fres = Math.pow(1 - Math.max(0, -d.y), 2.2) * 0.55 + 0.06;
        const ndl = Math.max(0, SUN.y);
        col = [
          0.05 + 0.10 * ndl + sc[0] * fres + 0.02,
          0.22 + 0.16 * ndl + sc[1] * fres + 0.04,
          0.42 + 0.20 * ndl + sc[2] * fres + 0.06,
        ];
        // sun glitter path
        const hx2 = eye.x + d.x * tOc, hz2 = eye.z + d.z * tOc;
        const gl = Math.max(0, (d.x * SUN.x + d.z * SUN.z) / Math.hypot(d.x, d.z) * Math.sign(1));
        const spec = Math.pow(Math.max(0, dot(norm({ x: -d.x, y: -d.y, z: -d.z }), SUN)), 60);
        col[0] += SUN_COL[0] * spec * 0.9; col[1] += SUN_COL[1] * spec * 0.9; col[2] += SUN_COL[2] * spec * 0.9;
        var oceanT = tOc;
      }
    }
    // alpha-tested march: leaves / crops / glass let the ray continue
    let origin = eye, remaining = 420, waterT = -1, totalT = 0;
    let solidHit = null;
    for (let iter = 0; iter < 28; iter++) {
      const h = march(origin, d, remaining, false);
      if (!h) break;
      totalT += h.t;
      const hx = origin.x + d.x * h.t, hy = origin.y + d.y * h.t, hz = origin.z + d.z * h.t;
      origin = { x: hx + d.x * 0.002, y: hy + d.y * 0.002, z: hz + d.z * 0.002 };
      remaining -= h.t + 0.002;
      if (h.id === B.WATER) { if (waterT < 0) waterT = totalT; continue; }
      if (h.p.layer === 'transparent') continue;                       // glass / ice
      if (h.p.layer === 'cutout') {
        const fuv = faceUV(h, hx, hy, hz);
        if (px(fuv.tile, fuv.u, fuv.v)[3] < 128) continue;              // alpha hole
      }
      solidHit = h;
      solidHit._hx = hx; solidHit._hy = hy; solidHit._hz = hz; solidHit._t = totalT;
      break;
    }
    const hit = solidHit;
    if (hit) {
      const t = hit._t;
      const hx = hit._hx, hy = hit._hy, hz = hit._hz;
      if (solidHit && solidHit.face >= 0) {
        const f = solidHit.face;
        const n = DIRS[f];
        const sx = hx, sy = hy, sz = hz;
        const { tile, u, v } = faceUV(solidHit, sx, sy, sz);
        let c = px(tile, u, v);
        // biome tint for grass + leaves
        const p = solidHit.p;
        if (p.tint) {
          const bt = BIOME_TINT[world.biome(solidHit.x, solidHit.y, solidHit.z)] || BIOME_TINT[0];
          c = [c[0] * ((bt >> 16) & 255) / 255, c[1] * ((bt >> 8) & 255) / 255, c[2] * (bt & 255) / 255];
        }
        // lighting: face shade × (sun + sky) with a cheap AO term
        const ndl = Math.max(0, n[0] * SUN.x + n[1] * SUN.y + n[2] * SUN.z);
        let ao = 1;
        const ox = solidHit.x + n[0], oy = solidHit.y + n[1], oz = solidHit.z + n[2];
        let occ = 0;
        for (const dd of DIRS) if (dd !== n && PALETTE[world.get(ox + dd[0], oy + dd[1], oz + dd[2])]?.opaque) occ++;
        ao = 1 - occ * 0.055;
        const sun = ndl * SUN_I * ao, sky = (0.42 + 0.3 * Math.max(0, n[1])) * ao * (0.35 + 0.65 * Math.max(0.15, Math.min(1, SUN_I)));
        const em = p.emissive ? p.emissive * 0.72 : 0;
        const L = FACE_SH[f];
        col = [
          (c[0] / 255) * (sun * SUN_COL[0] + sky * SKY_HOR[0] + em) * L,
          (c[1] / 255) * (sun * SUN_COL[1] + sky * SKY_HOR[1] + em) * L,
          (c[2] / 255) * (sun * SUN_COL[2] + sky * SKY_HOR[2] + em) * L,
        ];
        if (waterT >= 0) {
          const depth = Math.min(1, (waterT > 0 ? 0.35 : 0) + 0.12 * (solidHit.y < SEA ? SEA - solidHit.y : 0));
          const wc = [0.09, 0.36, 0.62];
          const sc = skyColor(d);
          const k = 0.42 + depth * 0.3;
          col = [col[0] * (1 - k) + wc[0] * k * 0.7 + sc[0] * 0.16,
                 col[1] * (1 - k) + wc[1] * k * 0.7 + sc[1] * 0.16,
                 col[2] * (1 - k) + wc[2] * k * 0.7 + sc[2] * 0.16];
        }
      } else if (waterT >= 0) {
        const sc = skyColor(d);
        col = [0.07 + sc[0] * 0.3, 0.28 + sc[1] * 0.3, 0.5 + sc[2] * 0.32];
      }
      // seen through the open-ocean plane → depth-tinted water blend
      if (typeof oceanT === 'number' && t > oceanT && waterT < 0) {
        const k = Math.min(0.94, 0.42 + (t - oceanT) * 0.05);
        const wc = [0.05, 0.24, 0.42];
        const sc = skyColor(d);
        col = [col[0] * (1 - k) + wc[0] * k + sc[0] * 0.1,
               col[1] * (1 - k) + wc[1] * k + sc[1] * 0.1,
               col[2] * (1 - k) + wc[2] * k + sc[2] * 0.1];
      }
      // distance haze
      const fog = Math.min(1, Math.max(0, (t - 120) / 420));
      if (fog > 0) { const sc = skyColor(d); col = [col[0] * (1 - fog) + sc[0] * fog, col[1] * (1 - fog) + sc[1] * fog, col[2] * (1 - fog) + sc[2] * fog]; }
    }
    // filmic-ish tonemap + gamma
    const o = (py * W + pxx) * 3;
    for (let i = 0; i < 3; i++) {
      let x = col[i];
      x = (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14);
      img[o + i] = Math.round(Math.pow(Math.min(1, Math.max(0, x)), 1 / 2.2) * 255);
    }
  }
}
console.log('rendered in', Date.now() - t1, 'ms');

// ── PNG encode ──────────────────────────────────────────────────────────────
const CRC_T = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
function crc32(buf) { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC_T[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y++) {
  raw[y * (W * 3 + 1)] = 0;
  img.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
fs.writeFileSync(out, png);
console.log('wrote', out, (png.length / 1024).toFixed(0) + ' KB');
