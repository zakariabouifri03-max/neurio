// ═══════════════════════════════════════════════════════════════════════════
//  STRUCTURES + DECORATION — village house, watch tower, farm, dock, well,
//  campfire, mine entrance, paths, trees, flowers, boulders.
//  Every block is placed by hand-written rules: no assets, no randomness
//  without a seed. Emitters (torches, lanterns, campfire) are returned as
//  entity descriptors for the renderer.
// ═══════════════════════════════════════════════════════════════════════════
import { B, PALETTE } from './textures.js';
import { BIO_PLAINS, BIO_FOREST, BIO_BEACH, BIO_MOUNTAIN, SIZE } from './terrain.js';
import { clamp } from '../util.js';

const W = (T) => T.world;
const set = (T, x, y, z, id) => T.world.raw(Math.round(x), Math.round(y), Math.round(z), id);
const setB = (T, x, y, z, id, bio) => T.world.raw(Math.round(x), Math.round(y), Math.round(z), id, bio === undefined ? -1 : bio);
const get = (T, x, y, z) => T.world.get(Math.round(x), Math.round(y), Math.round(z));
const air = (T, x, y, z) => T.world.raw(x, y, z, B.AIR);

function fillBox(T, x0, y0, z0, x1, y1, z1, id, skipSolid = false) {
  const [a, b] = x0 < x1 ? [x0, x1] : [x1, x0];
  const [c, d] = y0 < y1 ? [y0, y1] : [y1, y0];
  const [e, f] = z0 < z1 ? [z0, z1] : [z1, z0];
  for (let x = a; x <= b; x++) for (let y = c; y <= d; y++) for (let z = e; z <= f; z++) {
    if (skipSolid && get(T, x, y, z) !== B.AIR) continue;
    set(T, x, y, z, id);
  }
}

function hollow(T, x0, y0, z0, x1, y1, z1) {
  for (let x = x0 + 1; x < x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0 + 1; z < z1; z++) air(T, x, y, z);
}

// ── site selection ──────────────────────────────────────────────────────────
export function pickSite(T, cx, cz, radius, size, opts = {}) {
  let best = null;
  for (let x = cx - radius; x <= cx + radius; x += 2) {
    for (let z = cz - radius; z <= cz + radius; z += 2) {
      if (Math.hypot(x, z) > SIZE - size - 6) continue;
      if (Math.hypot(x - T.pond.x, z - T.pond.z) < T.pond.r + size + 6) continue;
      if (T.isReserved(x, z, size + 2)) continue;
      const f = T.flatness(x, z, size + 3);
      if (f.avg <= (opts.minY ?? T.SEA + 1.6)) continue;
      if (opts.maxY !== undefined && f.avg > opts.maxY) continue;
      let score = f.spread * 2.4;
      score += Math.abs(f.avg - (opts.want ?? T.SEA + 7)) * (opts.wantWeight ?? 0.9);
      score += Math.hypot(x - cx, z - cz) * (opts.near ?? 0.12);
      if (Math.hypot(x - T.mntCenter.x, z - T.mntCenter.z) < SIZE * 0.6) score += 6;
      if (!best || score < best.score) best = { x, z, y: Math.round(f.avg), ySurf: T.surface(x, z), score, ...f };
    }
  }
  return best;
}

function beachSite(T) {
  // pick the compass direction whose shoreline is furthest out (longest beach run)
  let best = null;
  for (let a = 0; a < 48; a++) {
    const ang = a / 48 * Math.PI * 2 + 0.35;
    const dx = Math.cos(ang), dz = Math.sin(ang);
    let shore = null;
    for (let i = 6; i < SIZE + 12; i++) {
      const hx = Math.round(dx * i), hz = Math.round(dz * i);
      const h = T.height(hx, hz);
      if (h === undefined || h < T.SEA - 1) { shore = i; break; }
    }
    if (!shore) continue;
    // prefer a direction with a wide, walkable beach and no mountain behind it
    let width = 0;
    for (let off = -4; off <= 4; off++) {
      const px = -dz, pz = dx;
      const hx = Math.round(dx * (shore - 3) + px * off), hz = Math.round(dz * (shore - 3) + pz * off);
      const h = T.height(hx, hz);
      if (h !== undefined && h > T.SEA && h < T.SEA + 5) width++;
    }
    const score = width * 2 + shore * 0.2 - Math.hypot(dx * shore - T.mntCenter.x, dz * shore - T.mntCenter.z) * 0.06;
    if (!best || score > best.score) best = { ang, dx: Math.round(dx), dz: Math.round(dz), shore, width, score };
  }
  return best || { ang: 0.6, dx: 1, dz: 0, shore: SIZE * 0.8, width: 0, score: 0 };
}

// ── paths ───────────────────────────────────────────────────────────────────
function stampPath(T, pts, brush = 1, material = B.DIRT_PATH, alt = B.COBBLE, rnd = null) {
  for (let s = 0; s < pts.length - 1; s++) {
    const [x0, z0] = pts[s], [x1, z1] = pts[s + 1];
    const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) * 2);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = Math.round(x0 + (x1 - x0) * t), z = Math.round(z0 + (z1 - z0) * t);
      for (let dx = -brush; dx <= brush; dx++) for (let dz = -brush; dz <= brush; dz++) {
        if (dx * dx + dz * dz > brush * brush + 0.6) continue;
        const px = x + dx, pz = z + dz;
        const top = T.surface(px, pz) - 1;
        if (top <= T.SEA) continue;
        const cur = get(T, px, top, pz);
        if (cur !== B.GRASS && cur !== B.DIRT && cur !== B.SAND && cur !== B.TALLGRASS && cur !== B.POPPY) continue;
        const r = rnd ? rnd() : 0.5;
        set(T, px, top, pz, r < 0.82 ? material : alt);
        if (r > 0.93) set(T, px, top + 1, pz, B.COBBLE);
      }
    }
  }
}

// ── fence ───────────────────────────────────────────────────────────────────
function fenceRect(T, x0, z0, x1, z1, y, id = B.PLANK_OAK, step = 2) {
  for (let x = x0; x <= x1; x++) { if ((x - x0) % step === 0 || x === x1) set(T, x, y, z0, id); }
  for (let x = x0; x <= x1; x++) { if ((x - x0) % step === 0 || x === x1) set(T, x, y, z1, id); }
  for (let z = z0; z <= z1; z++) { if ((z - z0) % step === 0 || z === z1) set(T, x0, y, z, id); }
  for (let z = z0; z <= z1; z++) { if ((z - z0) % step === 0 || z === z1) set(T, x1, y, z, id); }
}

// ═══════════════════════════════════════════════════════════════════════════
//  HOUSE — stone-brick foundation, oak plank walls, spruce gable roof,
//  glass windows, chimney, furnished interior
// ═══════════════════════════════════════════════════════════════════════════
export function buildHouse(T, site, E) {
  const w = 11, d = 9;                       // footprint
  const x0 = site.x - ((w / 2) | 0), z0 = site.z - ((d / 2) | 0);
  const x1 = x0 + w - 1, z1 = z0 + d - 1;
  T.reserve(x0, z0, x1, z1, 3);
  const y = clamp(site.y, T.SEA + 2, 60);
  T.flatten({ x0: x0 - 3, z0: z0 - 3, x1: x1 + 3, z1: z1 + 3, y, top: B.GRASS, bio: BIO_PLAINS });

  const y0 = y + 1;                          // first wall course
  const wallH = 4;
  const ridge = y0 + wallH + 3;

  // foundation + floor
  fillBox(T, x0, y - 1, z0, x1, y - 1, z1, B.STONEBRICK);
  fillBox(T, x0 + 1, y, z0 + 1, x1 - 1, y, z1 - 1, B.PLANK_OAK);

  // walls
  for (let yy = y0; yy < y0 + wallH; yy++) {
    for (let x = x0; x <= x1; x++) {
      const edge = (x === x0 || x === x1);
      for (const z of [z0, z1]) {
        let id = B.PLANK_OAK;
        if (edge) id = B.LOG_OAK;
        else if (yy >= y0 + 1 && yy <= y0 + 2 && (x - x0) % 3 === 1) id = B.GLASS;
        set(T, x, yy, z, id);
      }
    }
    for (let z = z0; z <= z1; z++) {
      const edge = (z === z0 || z === z1);
      for (const x of [x0, x1]) {
        let id = B.PLANK_OAK;
        if (edge) id = B.LOG_OAK;
        else if (yy >= y0 + 1 && yy <= y0 + 2 && (z - z0) % 4 === 2) id = B.GLASS;
        set(T, x, yy, z, id);
      }
    }
  }
  // door on the +z face
  const doorX = site.x;
  set(T, doorX, y0, z1, B.AIR); set(T, doorX, y0 + 1, z1, B.AIR);
  set(T, doorX - 1, y0, z1, B.LOG_SPRUCE); set(T, doorX + 1, y0, z1, B.LOG_SPRUCE);
  set(T, doorX - 1, y0 + 1, z1, B.LOG_SPRUCE); set(T, doorX + 1, y0 + 1, z1, B.LOG_SPRUCE);
  set(T, doorX, y0 + 2, z1, B.PLANK_SPRUCE);
  // porch step
  set(T, doorX, y, z1 + 1, B.STONEBRICK);
  set(T, doorX - 1, y, z1 + 1, B.COBBLE);
  set(T, doorX + 1, y, z1 + 1, B.COBBLE);

  // gable ends (triangles on the ±x faces) + roof
  const cz = (z0 + z1) / 2;
  for (const gx of [x0, x1]) {
    for (let level = 0; level <= 3; level++) {
      const yy = y0 + wallH + level;
      const half = ((d / 2) | 0) - level;
      for (let z = Math.round(cz - half); z <= Math.round(cz + half); z++) set(T, gx, yy, z, B.PLANK_OAK);
      set(T, gx, yy, Math.round(cz - half), B.LOG_SPRUCE);
      set(T, gx, yy, Math.round(cz + half), B.LOG_SPRUCE);
    }
  }
  for (let z = z0 - 1; z <= z1 + 1; z++) {
    const dist = Math.abs(z - cz);
    const rise = Math.round(clamp(Math.floor(d / 2) + 1 - dist, 0, 4));
    const yy = y0 + wallH + rise;
    for (const x of [x0 - 1, x1 + 1]) set(T, x, yy - 1, z, B.PLANK_SPRUCE);   // eaves
    for (let x = x0; x <= x1; x++) {
      set(T, x, yy, z, rise === 4 ? B.LOG_SPRUCE : B.PLANK_SPRUCE);
      if (dist > Math.floor(d / 2) + 1) set(T, x, yy, z, B.AIR);
    }
  }
  // ridge cap
  for (let x = x0; x <= x1; x++) set(T, x, ridge, Math.round(cz), B.LOG_SPRUCE);

  // chimney — a cobble breast on the −x wall, punched through the roof
  const chx = x0 + 1;
  fillBox(T, chx, y0, z0, chx + 1, ridge + 3, z0 + 1, B.COBBLE);
  fillBox(T, chx, ridge + 3, z0, chx + 1, ridge + 3, z0 + 1, B.STONEBRICK);
  set(T, chx + 1, y0, z0 + 2, B.FURNACE_LIT);

  // interior furniture
  const fy = y;
  set(T, x0 + 3, fy + 1, z0 + 1, B.CRAFTING);
  set(T, x0 + 3, fy + 1, z0 + 2, B.BOOKSHELF);
  set(T, x0 + 3, fy + 2, z0 + 2, B.BOOKSHELF);
  set(T, x1 - 1, fy + 1, z0 + 1, B.HAY);
  set(T, x1 - 2, fy + 1, z0 + 1, B.HAY);
  // bed (wool + pumpkin headboard)
  set(T, x1 - 1, fy + 1, z1 - 2, B.WOOL); set(T, x1 - 1, fy + 1, z1 - 3, B.WOOL);
  set(T, x1 - 1, fy + 1, z1 - 1, B.PUMPKIN);
  set(T, x0 + 2, fy + 1, z1 - 1, B.PLANK_SPRUCE); set(T, x0 + 3, fy + 1, z1 - 1, B.PLANK_SPRUCE);
  // hanging lantern
  set(T, Math.round(site.x), y0 + wallH - 1, Math.round(cz), B.LANTERN);

  E.torches.push({ x: doorX - 2, y: y0 + 1, z: z1 + 1, kind: 'wall' });
  E.torches.push({ x: doorX + 2, y: y0 + 1, z: z1 + 1, kind: 'wall' });
  E.lights.push({ x: Math.round(site.x) + 0.5, y: y0 + wallH - 0.4, z: Math.round(cz) + 0.5, color: 0xffc46a, intensity: 9, dist: 12 });
  E.lights.push({ x: chx + 1.5, y: y0 + 0.8, z: z0 + 2.5, color: 0xff7a2a, intensity: 7, dist: 9, flicker: 1.8 });
  E.spawn.house = { x: doorX + 0.5, y: y + 1, z: z1 + 2.5, face: Math.PI };
  E.spawn.houseIn = { x: site.x + 0.5, y: y + 1, z: cz + 0.5 };
  return { x0, z0, x1, z1, y, doorX, cz };
}

// ═══════════════════════════════════════════════════════════════════════════
//  WATCH TOWER — stone bricks, interior ladder, overhanging deck, beacon
// ═══════════════════════════════════════════════════════════════════════════
export function buildTower(T, site, E) {
  const w = 7;
  const x0 = site.x - 3, z0 = site.z - 3, x1 = x0 + w - 1, z1 = z0 + w - 1;
  T.reserve(x0, z0, x1, z1, 4);
  const y = clamp(site.y, T.SEA + 2, 60);
  T.flatten({ x0: x0 - 3, z0: z0 - 3, x1: x1 + 3, z1: z1 + 3, y, top: B.GRASS, bio: BIO_PLAINS });

  const H = 13;
  for (let yy = y; yy <= y + H; yy++) {
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const edge = x === x0 || x === x1 || z === z0 || z === z1;
      if (!edge) continue;
      const t = T.rnd();
      let id = B.STONEBRICK;
      if (t < 0.12) id = B.MOSSYBRICK; else if (t < 0.2) id = B.CRACKED;
      if ((x + z) % 7 === 0 && yy > y + 2 && yy < y + H - 1) id = B.COBBLE;
      set(T, x, yy, z, id);
    }
  }
  hollow(T, x0, y, z0, x1, y + H, z1);
  fillBox(T, x0, y, z0, x1, y, z1, B.STONEBRICK);          // floor
  // door
  set(T, site.x, y + 1, z1, B.AIR); set(T, site.x, y + 2, z1, B.AIR);
  // window slits
  for (const lvl of [4, 8]) {
    set(T, x0, y + lvl, site.z, B.AIR); set(T, x1, y + lvl, site.z, B.GLASS);
    set(T, site.x, y + lvl, z0, B.GLASS);
  }
  // interior ladder + glow
  for (let yy = y + 1; yy <= y + H; yy++) set(T, x1 - 1, yy, z0 + 1, B.LADDER);
  set(T, x0 + 1, y + 6, z0 + 1, B.GLOWSTONE);
  set(T, x0 + 1, y + 11, z1 - 1, B.GLOWSTONE);
  set(T, x1 - 1, y + 1, z1 - 1, B.FURNACE_LIT);

  // deck
  const dy = y + H + 1;
  fillBox(T, x0 - 1, dy, z0 - 1, x1 + 1, dy, z1 + 1, B.PLANK_SPRUCE);
  for (let x = x0 - 1; x <= x1 + 1; x++) for (let z = z0 - 1; z <= z1 + 1; z++) {
    const edge = x === x0 - 1 || x === x1 + 1 || z === z0 - 1 || z === z1 + 1;
    if (!edge) continue;
    set(T, x, dy + 1, z, (x + z) % 2 === 0 ? B.PLANK_OAK : B.AIR);
  }
  // pyramid roof
  for (let level = 0; level <= 2; level++) {
    const a = x0 - 1 + level, b = x1 + 1 - level, c = z0 - 1 + level, d = z1 + 1 - level;
    for (let x = a; x <= b; x++) for (let z = c; z <= d; z++) {
      if (x === a || x === b || z === c || z === d) set(T, x, dy + 2 + level, z, B.PLANK_SPRUCE);
    }
  }
  set(T, site.x, dy + 1, site.z, B.GLOWSTONE);             // beacon lantern
  set(T, site.x, dy + 5, site.z, B.PLANK_SPRUCE);

  E.beacons.push({ x: site.x + 0.5, y: dy + 1.5, z: site.z + 0.5 });
  E.torches.push({ x: site.x - 1, y: y + 1, z: z1 + 1, kind: 'ground' });
  E.torches.push({ x: site.x + 1, y: y + 1, z: z1 + 1, kind: 'ground' });
  E.spawn.tower = { x: site.x + 0.5, y: dy + 2, z: site.z + 2.5 };
  return { x0, z0, x1, z1, y, dy, cx: site.x, cz: site.z };
}

// ═══════════════════════════════════════════════════════════════════════════
//  FARM — tilled soil, irrigation channel, crops, fence, hay + pumpkins
// ═══════════════════════════════════════════════════════════════════════════
export function buildFarm(T, site, E) {
  const w = 15, d = 11;
  const x0 = site.x - 7, z0 = site.z - 5, x1 = x0 + w - 1, z1 = z0 + d - 1;
  T.reserve(x0, z0, x1, z1, 3);
  const y = clamp(site.y, T.SEA + 2, 60);
  T.flatten({ x0: x0 - 2, z0: z0 - 2, x1: x1 + 2, z1: z1 + 2, y, top: B.GRASS, bio: BIO_PLAINS });

  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) {
      const waterRow = Math.abs(z - site.z) <= 0;
      if (waterRow && (x - x0) % 5 !== 0) {
        set(T, x, y, z, B.WATER);
        set(T, x, y - 1, z, B.DIRT);
        continue;
      }
      set(T, x, y, z, waterRow ? B.PLANK_OAK : B.FARMLAND_WET);
      if (waterRow) continue;
      const dist = Math.abs(z - site.z);
      const cropRow = (x + z) % 7;
      let crop = B.WHEAT3;
      if (dist === 1) crop = cropRow < 3 ? B.WHEAT3 : B.WHEAT2;
      else if (dist === 2) crop = cropRow < 4 ? B.WHEAT2 : B.WHEAT1;
      else crop = (x * 7 + z * 13) % 5 === 0 ? B.CARROT : (cropRow < 2 ? B.WHEAT1 : B.WHEAT3);
      if (T.rnd() < 0.88) set(T, x, y + 1, z, crop);
    }
  }
  fenceRect(T, x0 - 1, z0 - 1, x1 + 1, z1 + 1, y + 1, B.PLANK_OAK, 2);
  // gate
  set(T, site.x, y + 1, z1 + 1, B.AIR); set(T, site.x + 1, y + 1, z1 + 1, B.AIR);
  // hay + pumpkins beside the barn side
  fillBox(T, x1 - 2, y + 1, z0 - 1, x1 - 1, y + 2, z0 - 1, B.HAY);
  set(T, x0 + 1, y + 1, z0 - 1, B.PUMPKIN);
  set(T, x0 + 2, y + 1, z0 - 1, B.PUMPKIN);
  set(T, x0 - 1, y + 1, z1 - 1, B.CRAFTING);
  E.torches.push({ x: x0 - 1, y: y + 2, z: z0 - 1, kind: 'ground' });
  E.torches.push({ x: x1 + 1, y: y + 2, z: z1 + 1, kind: 'ground' });
  E.spawn.farm = { x: site.x + 0.5, y: y + 1, z: z1 + 2.5 };
  return { x0, z0, x1, z1, y };
}

// ═══════════════════════════════════════════════════════════════════════════
//  DOCK + BOAT — walks out over the ocean
// ═══════════════════════════════════════════════════════════════════════════
export function buildDock(T, E) {
  const s = beachSite(T);
  const deckY = T.SEA + 3;
  const dx = s.dx, dz = s.dz;
  const px = -dz, pz = dx;                       // perpendicular
  const landI = Math.max(3, s.shore - 5);        // last dry ground
  const start = { x: Math.round(dx * landI), z: Math.round(dz * landI) };
  // walk out along the actual (axis-aligned) dock axis until we reach open sea
  let wet = 12;
  for (let i = 1; i < SIZE + 16; i++) {
    const h = T.height(start.x + dx * i, start.z + dz * i);
    if (h === undefined || h < T.SEA - 1) { wet = i; break; }
  }
  const len = clamp(wet + 7, 9, 24);             // ~7 blocks of pier over water
  T.reserve(start.x - 3, start.z - 3, start.x + dx * len + 3, start.z + dz * len + 3, 2);
  const pts = [];
  for (let i = 0; i <= len; i++) {
    const x = start.x + dx * i, z = start.z + dz * i;
    pts.push([x, z]);
    for (let o = -1; o <= 1; o++) {
      set(T, x + px * o, deckY, z + pz * o, B.PLANK_SPRUCE);
      set(T, x + px * o, deckY - 1, z + pz * o, T.rnd() < 0.15 ? B.PLANK_OAK : B.PLANK_SPRUCE);
    }
    if (i % 4 === 0 && i > 0) {
      for (const o of [-2, 2]) {
        for (let yy = deckY - 1; yy > 0; yy--) {
          if (get(T, x + px * o, yy, z + pz * o) === B.AIR) set(T, x + px * o, yy, z + pz * o, B.LOG_SPRUCE);
          else break;
        }
      }
    }
    if (i % 5 === 0 && i < len - 1) {
      for (const o of [-1, 1]) set(T, x + px * o * 1, deckY + 1, z + pz * o * 1, B.PLANK_OAK);
    }
  }
  const end = { x: start.x + dx * len, z: start.z + dz * len };
  // railing posts + lantern
  set(T, end.x + px * 2, deckY + 1, end.z + pz * 2, B.LOG_OAK);
  set(T, end.x + px * 2, deckY + 2, end.z + pz * 2, B.LANTERN);
  set(T, end.x - px * 2, deckY + 1, end.z - pz * 2, B.LOG_OAK);
  E.lights.push({ x: end.x + px * 2 + 0.5, y: deckY + 2.4, z: end.z + pz * 2 + 0.5, color: 0xffc46a, intensity: 8, dist: 13 });

  // little rowing boat beside the dock
  const bx = end.x + px * 5, bz = end.z + pz * 5;
  for (let i = -2; i <= 2; i++) {
    set(T, bx + dx * i, deckY - 1, bz + dz * i, B.PLANK_SPRUCE);
    if (Math.abs(i) < 2) {
      set(T, bx + dx * i + px, deckY - 1, bz + dz * i + pz, B.PLANK_SPRUCE);
      set(T, bx + dx * i - px, deckY - 1, bz + dz * i - pz, B.PLANK_SPRUCE);
    } else {
      set(T, bx + dx * i, deckY, bz + dz * i, B.PLANK_SPRUCE);
    }
  }
  set(T, bx, deckY, bz, B.PLANK_OAK);            // seat

  // ramp from the beach up to the deck
  for (let i = 0; i < 6; i++) {
    const x = start.x - dx * (i + 1), z = start.z - dz * (i + 1);
    const yy = deckY - Math.round(i * 0.6);
    set(T, x, yy, z, B.COBBLE);
    set(T, x + px, yy, z + pz, B.COBBLE);
    set(T, x - px, yy, z - pz, B.COBBLE);
    for (let fy = yy - 1; fy > T.surface(x, z) - 2; fy--) if (get(T, x, fy, z) === B.AIR) set(T, x, fy, z, B.COBBLE);
  }
  const landing = { x: start.x - dx * 5, z: start.z - dz * 5 };
  E.spawn.dock = { x: end.x + 0.5, y: deckY + 1, z: end.z + 0.5 };
  E.spawn.beach = { x: landing.x + 0.5, y: T.surface(landing.x, landing.z), z: landing.z + 0.5 };
  E.dock = { start, end, deckY, dx, dz, landing };
  return pts;
}

// ═══════════════════════════════════════════════════════════════════════════
//  WELL, CAMPFIRE, MINE ENTRANCE
// ═══════════════════════════════════════════════════════════════════════════
export function buildWell(T, site, E) {
  const { x, z } = site;
  const y = T.surface(x, z);
  if (y <= T.SEA) return null;
  T.reserve(x - 2, z - 2, x + 2, z + 2, 1);
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    const ring = Math.max(Math.abs(dx), Math.abs(dz)) === 1;
    set(T, x + dx, y, z + dz, ring ? B.COBBLE : B.WATER);
    set(T, x + dx, y + 1, z + dz, ring ? B.COBBLE : B.AIR);
    set(T, x + dx, y + 2, z + dz, ring ? B.COBBLE : B.AIR);
  }
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) set(T, x + dx, y + 3, z + dz, B.PLANK_OAK);
  fillBox(T, x - 1, y + 4, z - 1, x + 1, y + 4, z + 1, B.PLANK_SPRUCE);
  set(T, x, y + 5, z, B.PLANK_SPRUCE);
  set(T, x, y + 3, z, B.AIR);
  E.lights.push({ x: x + 0.5, y: y + 2.4, z: z + 0.5, color: 0x8fd8ff, intensity: 3.2, dist: 7 });
  return { x, y, z };
}

export function buildCampfire(T, site, E) {
  const { x, z } = site;
  const y = T.surface(x, z);
  if (y <= T.SEA) return null;
  T.reserve(x - 3, z - 3, x + 3, z + 3, 2);
  T.flatten({ x0: x - 3, z0: z - 3, x1: x + 3, z1: z + 3, y, top: B.GRASS, bio: BIO_PLAINS });
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
    const d = Math.hypot(dx, dz);
    if (d > 2.3) continue;
    if (d > 1.2) set(T, x + dx, y, z + dz, T.rnd() < 0.5 ? B.COBBLE : B.MOSSY);
    else set(T, x + dx, y, z + dz, B.COARSE);
  }
  set(T, x, y + 1, z, B.LAVA);
  set(T, x + 1, y + 1, z, B.LOG_OAK); set(T, x - 1, y + 1, z, B.LOG_OAK);
  set(T, x, y + 1, z + 1, B.LOG_SPRUCE); set(T, x, y + 1, z - 1, B.LOG_SPRUCE);
  set(T, x, y + 2, z, B.LAVA);
  // log seats
  for (const [dx, dz] of [[3, 0], [-3, 0], [0, 3], [0, -3]]) set(T, x + dx, y + 1, z + dz, B.LOG_OAK);
  E.campfires.push({ x: x + 0.5, y: y + 1.2, z: z + 0.5 });
  E.lights.push({ x: x + 0.5, y: y + 1.6, z: z + 0.5, color: 0xff8a30, intensity: 22, dist: 22, flicker: 2.6, shadow: true });
  E.spawn.camp = { x: x + 3.5, y: y + 1, z: z + 0.5 };
  return { x, y, z };
}

export function buildMine(T, E) {
  const hills = (T.hillsides || []).filter((h) => !T.isReserved(h.x, h.z, 8));
  if (!hills.length) return null;
  const h0 = hills[Math.floor(T.rnd() * hills.length)];
  const d = h0.dir, x = h0.x, z = h0.z;
  const px = d[1] !== 0 ? 1 : 0, pz = d[0] !== 0 ? 1 : 0;   // perpendicular
  const y = Math.max(h0.y, T.SEA + 2);
  const depth = 9;
  T.reserve(x - 4, z - 4, x + d[0] * depth + 4, z + d[1] * depth + 4, 2);

  // clear a mouth and tunnel in
  for (let i = -1; i <= depth; i++) for (let oy = 0; oy < 3; oy++) for (let sd = -1; sd <= 1; sd++) {
    air(T, x + d[0] * i + px * sd, y + oy, z + d[1] * i + pz * sd);
  }
  // floor, timber supports every 3 blocks, stone-brick portal frame
  for (let i = 0; i <= depth; i++) {
    for (let sd = -1; sd <= 1; sd++) set(T, x + d[0] * i + px * sd, y - 1, z + d[1] * i + pz * sd, i % 3 === 0 ? B.PLANK_SPRUCE : B.COBBLE);
    if (i % 3 === 0 && i > 0) {
      for (const sd of [-1, 1]) {
        set(T, x + d[0] * i + px * sd * 2, y, z + d[1] * i + pz * sd * 2, B.LOG_SPRUCE);
        set(T, x + d[0] * i + px * sd * 2, y + 1, z + d[1] * i + pz * sd * 2, B.LOG_SPRUCE);
        set(T, x + d[0] * i + px * sd * 2, y + 2, z + d[1] * i + pz * sd * 2, B.LOG_SPRUCE);
      }
      set(T, x + d[0] * i + px * 2, y + 3, z + d[1] * i + pz * 2, B.PLANK_SPRUCE);
      set(T, x + d[0] * i - px * 2, y + 3, z + d[1] * i - pz * 2, B.PLANK_SPRUCE);
      for (let sd = -2; sd <= 2; sd++) set(T, x + d[0] * i + px * sd, y + 3, z + d[1] * i + pz * sd, B.PLANK_SPRUCE);
    }
  }
  // portal frame at the mouth
  for (let oy = 0; oy < 4; oy++) for (const sd of [-2, 2]) {
    set(T, x + px * sd, y + oy, z + pz * sd, oy === 3 ? B.PLANK_SPRUCE : B.STONEBRICK);
    set(T, x + px * sd - d[0], y + oy, z + pz * sd - d[1], oy === 3 ? B.PLANK_SPRUCE : B.STONEBRICK);
  }
  for (let sd = -2; sd <= 2; sd++) set(T, x + px * sd, y + 3, z + pz * sd, B.STONEBRICK);
  // a small apron + rails outside, torches both sides
  for (let i = 1; i <= 3; i++) for (let sd = -1; sd <= 1; sd++) {
    const ax = x - d[0] * i + px * sd, az = z - d[1] * i + pz * sd;
    if (T.surface(ax, az) > T.SEA) set(T, ax, y - 1, az, B.GRAVEL);
  }
  for (const sd of [-2, 2]) E.torches.push({ x: x + px * sd, y: y, z: z + pz * sd, kind: 'ground', color: 0xffb257 });
  E.lights.push({ x: x + 0.5, y: y + 1.7, z: z + 0.5, color: 0xffa24a, intensity: 7, dist: 11, flicker: 1.4 });
  // a lantern deep inside so the tunnel glows
  set(T, x + d[0] * depth, y + 2, z + d[1] * depth, B.GLOWSTONE);
  E.lights.push({ x: x + d[0] * depth + 0.5, y: y + 2.4, z: z + d[1] * depth + 0.5, color: 0xffd08a, intensity: 5, dist: 10 });
  E.spawn.mine = { x: x - d[0] * 2 + 0.5, y: y, z: z - d[1] * 2 + 0.5 };
  return { x, y, z, dir: d, depth };
}

// ═══════════════════════════════════════════════════════════════════════════
//  TREES
// ═══════════════════════════════════════════════════════════════════════════
export function plantOak(T, x, y, z, scale = 1, leaf = B.LEAF_OAK, log = B.LOG_OAK, bio = -1) {
  const h = Math.round((3 + T.rnd() * 3) * scale);
  for (let i = 0; i < h; i++) set(T, x, y + i, z, log);
  const top = y + h;
  // lower canopy: 5×5 with clipped corners
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
    if (Math.abs(dx) === 2 && Math.abs(dz) === 2 && T.rnd() < 0.75) continue;
    if (get(T, x + dx, top - 2, z + dz) === B.AIR) setB(T, x + dx, top - 2, z + dz, leaf, bio);
    if (Math.abs(dx) + Math.abs(dz) < 4 && get(T, x + dx, top - 1, z + dz) === B.AIR) setB(T, x + dx, top - 1, z + dz, leaf, bio);
  }
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    if (Math.abs(dx) === 1 && Math.abs(dz) === 1 && T.rnd() < 0.6) continue;
    if (get(T, x + dx, top, z + dz) === B.AIR) setB(T, x + dx, top, z + dz, leaf, bio);
  }
  setB(T, x, top + 1, z, leaf, bio);
  if (T.rnd() < 0.4) setB(T, x + (T.rnd() < 0.5 ? 1 : -1), top, z, leaf, bio);
}

export function plantSpruce(T, x, y, z, scale = 1, bio = -1) {
  const h = Math.round((6 + T.rnd() * 5) * scale);
  for (let i = 0; i < h; i++) set(T, x, y + i, z, B.LOG_SPRUCE);
  let r = 2.4;
  for (let i = h - 1; i >= 2; i--) {
    const rr = Math.round(r);
    for (let dx = -rr; dx <= rr; dx++) for (let dz = -rr; dz <= rr; dz++) {
      if (Math.abs(dx) + Math.abs(dz) > rr + 1) continue;
      if (dx === 0 && dz === 0) continue;
      if (get(T, x + dx, y + i, z + dz) === B.AIR) setB(T, x + dx, y + i, z + dz, B.LEAF_SPRUCE, bio);
    }
    r -= 0.42;
    if (r < 0.6) r = 0.6;
  }
  setB(T, x, y + h, z, B.LEAF_SPRUCE, bio);
  setB(T, x, y + h + 1, z, B.LEAF_SPRUCE, bio);
}

export function plantBirch(T, x, y, z, scale = 1, bio = -1) {
  const h = Math.round((4 + T.rnd() * 3) * scale);
  for (let i = 0; i < h; i++) set(T, x, y + i, z, B.LOG_BIRCH);
  const top = y + h;
  for (let dy = -2; dy <= 1; dy++) {
    const rr = dy <= -1 ? 2 : 1;
    for (let dx = -rr; dx <= rr; dx++) for (let dz = -rr; dz <= rr; dz++) {
      if (Math.abs(dx) === rr && Math.abs(dz) === rr && T.rnd() < 0.55) continue;
      if (dx === 0 && dz === 0 && dy < 1) continue;
      if (get(T, x + dx, top + dy, z + dz) === B.AIR) setB(T, x + dx, top + dy, z + dz, B.LEAF_BIRCH, bio);
    }
  }
}

function scatterTrees(T, E, count) {
  let placed = 0, guard = 0;
  const forestBias = (x, z) => T.N.noise2(x * 0.045 - 60, z * 0.045 + 22);
  while (placed < count && guard++ < count * 40) {
    const x = Math.round((T.rnd() * 2 - 1) * (SIZE - 5));
    const z = Math.round((T.rnd() * 2 - 1) * (SIZE - 5));
    const r = Math.hypot(x, z);
    if (r > SIZE - 5) continue;
    const bio = T.biome(x, z);
    const forest = forestBias(x, z) > 0.3;
    if (forest && T.rnd() < 0.55) continue;         // thin out non-forest areas
    if (!forest && T.rnd() < 0.78) continue;
    if (T.isReserved(x, z, 2)) continue;
    const y = T.surface(x, z);
    if (y <= T.SEA + 1 || y > T.SEA + 26) continue;
    const below = get(T, x, y - 1, z);
    if (below !== B.GRASS && below !== B.DIRT && below !== B.PODZOL) continue;
    const slope = Math.abs(T.surface(x + 1, z) - y) + Math.abs(T.surface(x, z + 1) - y);
    if (slope > 2) continue;
    const mm = Math.hypot(x - T.mntCenter.x, z - T.mntCenter.z) < SIZE * 0.66;
    const tb = forest ? BIO_FOREST : bio;
    if (mm || bio === BIO_MOUNTAIN) plantSpruce(T, x, y, z, 0.8 + T.rnd() * 0.5, tb);
    else if (T.rnd() < 0.22) plantBirch(T, x, y, z, 0.9 + T.rnd() * 0.4, tb);
    else plantOak(T, x, y, z, 0.85 + T.rnd() * 0.6, tb);
    placed++;
  }
  return placed;
}

function scatterPlants(T, E, count) {
  let placed = 0, guard = 0;
  while (placed < count && guard++ < count * 14) {
    const x = Math.round((T.rnd() * 2 - 1) * (SIZE - 3));
    const z = Math.round((T.rnd() * 2 - 1) * (SIZE - 3));
    if (Math.hypot(x, z) > SIZE - 3) continue;
    if (T.isReserved(x, z, 0)) continue;
    const y = T.surface(x, z);
    if (y <= T.SEA + 1 || y > T.SEA + 27) continue;
    if (get(T, x, y - 1, z) !== B.GRASS) continue;
    if (get(T, x, y, z) !== B.AIR) continue;
    const forest = T.N.noise2(x * 0.045 - 60, z * 0.045 + 22) > 0.3;
    const t = T.rnd();
    let id;
    if (t < (forest ? 0.34 : 0.52)) id = B.TALLGRASS;
    else if (t < (forest ? 0.62 : 0.72)) id = B.FERN;
    else if (t < 0.84) id = B.POPPY;
    else if (t < 0.94) id = B.DANDELION;
    else id = B.SAPLING;
    setB(T, x, y, z, id, forest ? BIO_FOREST : T.biome(x, z));
    placed++;
  }
  return placed;
}

function scatterShore(T) {
  // boulders, cacti on dry sand, pumpkins, sugar-cane style reeds at the water line
  let guard = 0, n = 0;
  while (n < 190 && guard++ < 4000) {
    const x = Math.round((T.rnd() * 2 - 1) * (SIZE - 2));
    const z = Math.round((T.rnd() * 2 - 1) * (SIZE - 2));
    if (Math.hypot(x, z) > SIZE - 2) continue;
    if (T.isReserved(x, z, 1)) continue;
    const y = T.surface(x, z);
    const below = get(T, x, y - 1, z);
    const t = T.rnd();
    if (below === B.SAND && y > T.SEA) {
      if (t < 0.14) {                                    // cactus
        const h = 1 + Math.floor(T.rnd() * 3);
        for (let i = 0; i < h; i++) if (get(T, x, y + i, z) === B.AIR) set(T, x, y + i, z, B.CACTUS);
        n++;
      } else if (t < 0.2) { set(T, x, y, z, B.TALLGRASS); n++; }
    } else if (below === B.STONE || below === B.COBBLE) {
      if (t < 0.3) {                                     // boulder
        const s = T.rnd() < 0.3 ? 2 : 1;
        fillBox(T, x, y, z, x + s - 1, y + (s > 1 ? 1 : 0), z + s - 1, T.rnd() < 0.4 ? B.MOSSY : B.COBBLE, true);
        n++;
      }
    } else if (below === B.GRASS && y > T.SEA + 1) {
      if (t < 0.02) { set(T, x, y, z, B.PUMPKIN); n++; }
      else if (t < 0.035) { set(T, x, y, z, B.MOSSY); n++; }
    }
    if (y === T.SEA + 1 && below === B.SAND && t > 0.93) {
      for (let i = 0; i < 2 + Math.floor(T.rnd() * 2); i++) if (get(T, x, y + i, z) === B.AIR) set(T, x, y + i, z, B.TALLGRASS);
      n++;
    }
  }
  return n;
}

// ═══════════════════════════════════════════════════════════════════════════
export function populate(T, E, opts = {}) {
  const counts = { trees: opts.trees ?? 150, plants: opts.plants ?? 620 };

  // village layout — house, tower and farm each get their own flat site
  const houseSite = pickSite(T, 4, 6, 22, 6, { want: T.SEA + 7 });
  const house = buildHouse(T, houseSite, E);

  const towerSite = pickSite(T, houseSite.x - 26, houseSite.z - 20, 20, 4, { want: T.SEA + 12, near: 0.05 });
  const tower = buildTower(T, towerSite, E);

  const farmSite = pickSite(T, houseSite.x + 24, houseSite.z + 14, 20, 8, { want: T.SEA + 6, near: 0.05 });
  const farm = buildFarm(T, farmSite, E);

  const wellSite = pickSite(T, houseSite.x + 10, houseSite.z - 13, 14, 2, { want: T.SEA + 6, maxY: houseSite.y + 5 });
  const well = buildWell(T, wellSite, E);

  const campSite = pickSite(T, houseSite.x - 14, houseSite.z + 15, 14, 4, { want: houseSite.y, wantWeight: 3.0, maxY: houseSite.y + 3 });
  const camp = buildCampfire(T, campSite, E);

  const dockPts = buildDock(T, E);
  const mine = buildMine(T, E);

  // paths tie the village together
  const mid = { x: houseSite.x, z: houseSite.z };
  stampPath(T, [
    [mid.x, mid.z + 6], [mid.x + 2, mid.z + 12],
    [(mid.x + farmSite.x) / 2 | 0, (mid.z + farmSite.z) / 2 | 0],
    [farmSite.x, farmSite.z + 6],
  ], 1, B.DIRT_PATH, B.COBBLE, T.rnd);
  stampPath(T, [[mid.x - 1, mid.z - 5], [towerSite.x + 2, towerSite.z + 5], [towerSite.x, towerSite.z + 4]], 1, B.DIRT_PATH, B.GRAVEL, T.rnd);
  stampPath(T, [[mid.x, mid.z + 6], [campSite.x + 4, campSite.z], [campSite.x + 3, campSite.z]], 1, B.DIRT_PATH, B.COBBLE, T.rnd);
  if (well) stampPath(T, [[mid.x + 3, mid.z + 2], [well.x, well.z + 2]], 0, B.COBBLE, B.STONEBRICK, T.rnd);
  if (E.dock) stampPath(T, [[mid.x + 5, mid.z + 5], [E.dock.landing.x, E.dock.landing.z]], 1, B.DIRT_PATH, B.GRAVEL, T.rnd);
  if (mine) stampPath(T, [[towerSite.x - 3, towerSite.z - 3], [mine.x + mine.dir[0] * 4, mine.z + mine.dir[1] * 4]], 0, B.GRAVEL, B.COBBLE, T.rnd);

  // torches along the main path
  const lampPts = [[mid.x + 3, mid.z + 9], [mid.x - 4, mid.z + 3], [towerSite.x + 4, towerSite.z + 6], [campSite.x + 4, campSite.z + 2], [farmSite.x - 3, farmSite.z + 5]];
  for (const [x, z] of lampPts) {
    const y = T.surface(x, z);
    if (y <= T.SEA) continue;
    set(T, x, y, z, B.LOG_OAK); set(T, x, y + 1, z, B.LOG_OAK); set(T, x, y + 2, z, B.LOG_OAK);
    E.torches.push({ x, y: y + 3, z, kind: 'post' });
  }

  const trees = scatterTrees(T, E, counts.trees);
  const plants = scatterPlants(T, E, counts.plants);
  const shore = scatterShore(T);

  E.layout = { house, tower, farm, well, camp, mine, dockPts, houseSite, towerSite, farmSite };
  return { trees, plants, shore };
}
