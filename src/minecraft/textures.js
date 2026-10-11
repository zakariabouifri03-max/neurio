// ═══════════════════════════════════════════════════════════════════════════
//  PROCEDURAL 16×16 PIXEL-ART ATLAS  +  derived PBR maps
//  64 tiles on a 256×256 canvas → albedo, height, roughness and a normal map
//  computed from the height channel. Everything is drawn from code: no image
//  files, no CDN, deterministic from a seed.
// ═══════════════════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { mulberry32 } from '../util.js';

export const TILE = 16;
export const GRID = 16;                 // tiles per row
export const ATLAS = TILE * GRID;       // 256 px

// tile index helpers ---------------------------------------------------------
export const T = (col, row) => row * GRID + col;

export const TILES = {
  grass_top: T(0, 0), grass_side: T(1, 0), grass_snow: T(2, 0), dirt: T(3, 0), dirt_path: T(4, 0),
  coarse: T(5, 0), podzol_top: T(6, 0), podzol_side: T(7, 0), farmland: T(8, 0), farmland_wet: T(9, 0),
  hay_side: T(10, 0), hay_top: T(11, 0),

  stone: T(0, 1), cobble: T(1, 1), mossy: T(2, 1), stonebrick: T(3, 1), mossybrick: T(4, 1),
  cracked: T(5, 1), gravel: T(6, 1), sand: T(7, 1), redsand: T(8, 1), sandstone: T(9, 1),
  sandstone_top: T(10, 1), bedrock: T(11, 1),

  planks_oak: T(0, 2), planks_spruce: T(1, 2), log_oak_side: T(2, 2), log_oak_top: T(3, 2),
  log_spruce_side: T(4, 2), log_spruce_top: T(5, 2), log_birch_side: T(6, 2), log_birch_top: T(7, 2),
  leaves_oak: T(8, 2), leaves_spruce: T(9, 2), leaves_birch: T(10, 2), cactus_side: T(11, 2), cactus_top: T(12, 2),

  coal: T(0, 3), iron: T(1, 3), gold: T(2, 3), diamond: T(3, 3), redstone: T(4, 3),
  obsidian: T(5, 3), glowstone: T(6, 3), lantern: T(7, 3), lava: T(8, 3), fire: T(9, 3),
  bricks: T(10, 3), wool: T(11, 3),

  glass: T(0, 4), water: T(1, 4), snow: T(2, 4), snow_side: T(3, 4), ice: T(4, 4),
  clay: T(5, 4), pumpkin_side: T(6, 4), pumpkin_top: T(7, 4), pumpkin_face: T(8, 4),
  bookshelf: T(9, 4), crafting: T(10, 4), furnace: T(11, 4), furnace_lit: T(12, 4),

  poppy: T(0, 5), dandelion: T(1, 5), tallgrass: T(2, 5), fern: T(3, 5),
  wheat1: T(4, 5), wheat2: T(5, 5), wheat3: T(6, 5), carrot: T(7, 5),
  sapling: T(8, 5), vine: T(9, 5), ladder: T(10, 5), torch_flame: T(11, 5),
};

// ─── block ids ─────────────────────────────────────────────────────────────
export const B = {
  AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, COBBLE: 4, MOSSY: 5, STONEBRICK: 6, MOSSYBRICK: 7,
  CRACKED: 8, GRAVEL: 9, SAND: 10, REDSAND: 11, SANDSTONE: 12, BEDROCK: 13,
  PLANK_OAK: 14, PLANK_SPRUCE: 15, LOG_OAK: 16, LOG_SPRUCE: 17, LOG_BIRCH: 18,
  LEAF_OAK: 19, LEAF_SPRUCE: 20, LEAF_BIRCH: 21, GLASS: 22, WATER: 23, LAVA: 24,
  COAL_ORE: 25, IRON_ORE: 26, GOLD_ORE: 27, DIAMOND_ORE: 28, GLOWSTONE: 29,
  BRICK: 30, WOOL: 31, SNOW: 32, SNOW_GRASS: 33, ICE: 34, CLAY: 35, PODZOL: 36,
  COARSE: 37, DIRT_PATH: 38, FARMLAND: 39, FARMLAND_WET: 40, HAY: 41,
  POPPY: 42, DANDELION: 43, TALLGRASS: 44, FERN: 45, WHEAT1: 46, WHEAT2: 47, WHEAT3: 48,
  CARROT: 49, SAPLING: 50, CACTUS: 51, PUMPKIN: 52, LANTERN: 53, OBSIDIAN: 54,
  BOOKSHELF: 55, CRAFTING: 56, FURNACE: 57, FURNACE_LIT: 58, LADDER: 59,
};

const f = (tiles, o = {}) => Object.assign({ tiles }, o);
// tiles order: [top, bottom, +x, −x, +z, −z]; omitted args fall back sensibly
const S = (a, b, c, d, e, g) => {
  const side = c === undefined ? a : c;
  return [a, b === undefined ? a : b, side, d === undefined ? side : d, e === undefined ? side : e, g === undefined ? side : g];
};

/** palette — tiles order: [top, bottom, side] */
export const PALETTE = [];
PALETTE[B.AIR] = { name: 'air', solid: false, opaque: false, layer: 'opaque', tiles: [0, 0, 0] };
PALETTE[B.GRASS] = { name: 'grass', solid: true, opaque: true, layer: 'opaque', tint: true, tiles: S(TILES.grass_top, TILES.dirt, TILES.grass_side) };
PALETTE[B.DIRT] = { name: 'dirt', solid: true, opaque: true, layer: 'opaque', tiles: S(TILES.dirt) };
PALETTE[B.STONE] = { name: 'stone', solid: true, opaque: true, layer: 'opaque', tiles: S(TILES.stone) };
PALETTE[B.COBBLE] = { name: 'cobblestone', solid: true, opaque: true, layer: 'opaque', tiles: S(TILES.cobble), rough: 0.95 };
PALETTE[B.MOSSY] = { name: 'mossy_cobblestone', solid: true, opaque: true, layer: 'opaque', tiles: S(TILES.mossy) };
PALETTE[B.STONEBRICK] = { name: 'stone_bricks', solid: true, opaque: true, layer: 'opaque', tiles: S(TILES.stonebrick) };
PALETTE[B.MOSSYBRICK] = { name: 'mossy_stone_bricks', solid: true, opaque: true, layer: 'opaque', tiles: S(TILES.mossybrick) };
PALETTE[B.CRACKED] = { name: 'cracked_stone_bricks', solid: true, opaque: true, layer: 'opaque', tiles: S(TILES.cracked) };
PALETTE[B.GRAVEL] = { name: 'gravel', solid: true, opaque: true, layer: 'opaque', tiles: S(TILES.gravel) };
PALETTE[B.SAND] = { name: 'sand', solid: true, opaque: true, layer: 'opaque', tiles: S(TILES.sand) };
PALETTE[B.REDSAND] = { name: 'red_sand', solid: true, opaque: true, layer: 'opaque', tiles: S(TILES.redsand) };
PALETTE[B.SANDSTONE] = { name: 'sandstone', solid: true, opaque: true, layer: 'opaque', tiles: S(TILES.sandstone_top, TILES.sandstone_top, TILES.sandstone) };
PALETTE[B.BEDROCK] = { name: 'bedrock', solid: true, opaque: true, layer: 'opaque', tiles: S(TILES.bedrock) };
PALETTE[B.PLANK_OAK] = { name: 'oak_planks', solid: true, opaque: true, layer: 'opaque', tiles: S(TILES.planks_oak) };
PALETTE[B.PLANK_SPRUCE] = { name: 'spruce_planks', solid: true, opaque: true, layer: 'opaque', tiles: S(TILES.planks_spruce) };
PALETTE[B.LOG_OAK] = { name: 'oak_log', solid: true, opaque: true, layer: 'opaque', tiles: S(TILES.log_oak_top, TILES.log_oak_top, TILES.log_oak_side) };
PALETTE[B.LOG_SPRUCE] = { name: 'spruce_log', solid: true, opaque: true, layer: 'opaque', tiles: S(TILES.log_spruce_top, TILES.log_spruce_top, TILES.log_spruce_side) };
PALETTE[B.LOG_BIRCH] = { name: 'birch_log', solid: true, opaque: true, layer: 'opaque', tiles: S(TILES.log_birch_top, TILES.log_birch_top, TILES.log_birch_side) };
PALETTE[B.LEAF_OAK] = { name: 'oak_leaves', solid: true, opaque: false, layer: 'cutout', tint: true, tiles: S(TILES.leaves_oak) };
PALETTE[B.LEAF_SPRUCE] = { name: 'spruce_leaves', solid: true, opaque: false, layer: 'cutout', tint: true, tiles: S(TILES.leaves_spruce) };
PALETTE[B.LEAF_BIRCH] = { name: 'birch_leaves', solid: true, opaque: false, layer: 'cutout', tint: true, tiles: S(TILES.leaves_birch) };
PALETTE[B.GLASS] = { name: 'glass', solid: true, opaque: false, layer: 'transparent', glass: true, tiles: S(TILES.glass) };
PALETTE[B.WATER] = { name: 'water', solid: false, opaque: false, layer: 'transparent', tiles: S(TILES.water) };
PALETTE[B.LAVA] = { name: 'lava', solid: true, opaque: true, layer: 'emissive', emissive: 2.6, tiles: S(TILES.lava) };
PALETTE[B.COAL_ORE] = { name: 'coal_ore', solid: true, opaque: true, layer: 'opaque', tiles: S(TILES.coal) };
PALETTE[B.IRON_ORE] = { name: 'iron_ore', solid: true, opaque: true, layer: 'opaque', tiles: S(TILES.iron) };
PALETTE[B.GOLD_ORE] = { name: 'gold_ore', solid: true, opaque: true, layer: 'opaque', tiles: S(TILES.gold) };
PALETTE[B.DIAMOND_ORE] = { name: 'diamond_ore', solid: true, opaque: true, layer: 'opaque', tiles: S(TILES.diamond) };
PALETTE[B.GLOWSTONE] = { name: 'glowstone', solid: true, opaque: true, layer: 'emissive', emissive: 1.9, tiles: S(TILES.glowstone) };
PALETTE[B.BRICK] = { name: 'bricks', solid: true, opaque: true, layer: 'opaque', tiles: S(TILES.bricks) };
PALETTE[B.WOOL] = { name: 'white_wool', solid: true, opaque: true, layer: 'opaque', tiles: S(TILES.wool) };
PALETTE[B.SNOW] = { name: 'snow', solid: true, opaque: true, layer: 'opaque', tiles: S(TILES.snow) };
PALETTE[B.SNOW_GRASS] = { name: 'snowy_grass', solid: true, opaque: true, layer: 'opaque', tiles: S(TILES.snow, TILES.dirt, TILES.snow_side) };
PALETTE[B.ICE] = { name: 'ice', solid: true, opaque: false, layer: 'transparent', tiles: S(TILES.ice) };
PALETTE[B.CLAY] = { name: 'clay', solid: true, opaque: true, layer: 'opaque', tiles: S(TILES.clay) };
PALETTE[B.PODZOL] = { name: 'podzol', solid: true, opaque: true, layer: 'opaque', tiles: S(TILES.podzol_top, TILES.dirt, TILES.podzol_side) };
PALETTE[B.COARSE] = { name: 'coarse_dirt', solid: true, opaque: true, layer: 'opaque', tiles: S(TILES.coarse) };
PALETTE[B.DIRT_PATH] = { name: 'dirt_path', solid: true, opaque: true, layer: 'opaque', tiles: S(TILES.dirt_path, TILES.dirt, TILES.dirt_path) };
PALETTE[B.FARMLAND] = { name: 'farmland', solid: true, opaque: true, layer: 'opaque', tiles: S(TILES.farmland, TILES.dirt, TILES.dirt) };
PALETTE[B.FARMLAND_WET] = { name: 'wet_farmland', solid: true, opaque: true, layer: 'opaque', tiles: S(TILES.farmland_wet, TILES.dirt, TILES.dirt) };
PALETTE[B.HAY] = { name: 'hay_bale', solid: true, opaque: true, layer: 'opaque', tiles: S(TILES.hay_top, TILES.hay_top, TILES.hay_side) };
PALETTE[B.POPPY] = { name: 'poppy', solid: false, opaque: false, layer: 'cutout', cross: true, tiles: S(TILES.poppy) };
PALETTE[B.DANDELION] = { name: 'dandelion', solid: false, opaque: false, layer: 'cutout', cross: true, tiles: S(TILES.dandelion) };
PALETTE[B.TALLGRASS] = { name: 'tall_grass', solid: false, opaque: false, layer: 'cutout', cross: true, tint: true, tiles: S(TILES.tallgrass) };
PALETTE[B.FERN] = { name: 'fern', solid: false, opaque: false, layer: 'cutout', cross: true, tint: true, tiles: S(TILES.fern) };
PALETTE[B.WHEAT1] = { name: 'wheat_young', solid: false, opaque: false, layer: 'cutout', cross: true, tiles: S(TILES.wheat1) };
PALETTE[B.WHEAT2] = { name: 'wheat_growing', solid: false, opaque: false, layer: 'cutout', cross: true, tiles: S(TILES.wheat2) };
PALETTE[B.WHEAT3] = { name: 'wheat_ripe', solid: false, opaque: false, layer: 'cutout', cross: true, tiles: S(TILES.wheat3) };
PALETTE[B.CARROT] = { name: 'carrots', solid: false, opaque: false, layer: 'cutout', cross: true, tiles: S(TILES.carrot) };
PALETTE[B.SAPLING] = { name: 'sapling', solid: false, opaque: false, layer: 'cutout', cross: true, tiles: S(TILES.sapling) };
PALETTE[B.CACTUS] = { name: 'cactus', solid: true, opaque: true, layer: 'opaque', tiles: S(TILES.cactus_top, TILES.cactus_top, TILES.cactus_side) };
PALETTE[B.PUMPKIN] = { name: 'pumpkin', solid: true, opaque: true, layer: 'opaque', tiles: S(TILES.pumpkin_top, TILES.pumpkin_top, TILES.pumpkin_side) };
PALETTE[B.LANTERN] = { name: 'lantern', solid: true, opaque: true, layer: 'emissive', emissive: 2.2, tiles: S(TILES.lantern) };
PALETTE[B.OBSIDIAN] = { name: 'obsidian', solid: true, opaque: true, layer: 'opaque', tiles: S(TILES.obsidian) };
PALETTE[B.BOOKSHELF] = { name: 'bookshelf', solid: true, opaque: true, layer: 'opaque', tiles: S(TILES.planks_oak, TILES.planks_oak, TILES.bookshelf) };
PALETTE[B.CRAFTING] = { name: 'crafting_table', solid: true, opaque: true, layer: 'opaque', tiles: S(TILES.crafting, TILES.planks_oak, TILES.crafting) };
PALETTE[B.FURNACE] = { name: 'furnace', solid: true, opaque: true, layer: 'opaque', tiles: S(TILES.stonebrick, TILES.stonebrick, TILES.furnace) };
PALETTE[B.FURNACE_LIT] = { name: 'lit_furnace', solid: true, opaque: true, layer: 'emissive', emissive: 1.1, tiles: S(TILES.stonebrick, TILES.stonebrick, TILES.furnace_lit) };
PALETTE[B.LADDER] = { name: 'ladder', solid: false, opaque: false, layer: 'cutout', cross: true, tiles: S(TILES.ladder) };

// ═══════════════════════════════════════════════════════════════════════════
//  tile painters — each receives (ctx) with pixel helpers
// ═══════════════════════════════════════════════════════════════════════════
const C = (r, g, b, a = 255) => [r | 0, g | 0, b | 0, a | 0];

function makeCtx(img, hgt, rgh, tx, ty, rnd) {
  const ctx = {
    rnd,
    h: 140, r: 210,     // current height / roughness for set()
    set(x, y, col, h, r) {
      if (x < 0 || y < 0 || x > 15 || y > 15) return;
      const i = ((ty + y) * ATLAS + (tx + x)) * 4;
      img[i] = col[0]; img[i + 1] = col[1]; img[i + 2] = col[2]; img[i + 3] = col.length > 3 ? col[3] : 255;
      const hv = h === undefined ? ctx.h : h;
      const rv = r === undefined ? ctx.r : r;
      hgt[i] = hv; hgt[i + 1] = hv; hgt[i + 2] = hv; hgt[i + 3] = 255;
      rgh[i] = rv; rgh[i + 1] = rv; rgh[i + 2] = rv; rgh[i + 3] = 255;
    },
    get(x, y) {
      if (x < 0 || y < 0 || x > 15 || y > 15) return C(0, 0, 0, 0);
      const i = ((ty + y) * ATLAS + (tx + x)) * 4;
      return [img[i], img[i + 1], img[i + 2], img[i + 3]];
    },
    rect(x, y, w, h, col, hh, rr) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) ctx.set(x + i, y + j, col, hh, rr); },
    fill(col, hh, rr) { ctx.rect(0, 0, 16, 16, col, hh, rr); },
    // every opaque pixel gets a small deterministic brightness jitter
    noise(amt, hh = 0) {
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const c = ctx.get(x, y);
        if (c[3] === 0) continue;
        const v = Math.round((rnd() - 0.5) * 2 * amt);
        ctx.set(x, y, C(c[0] + v, c[1] + v, c[2] + v, c[3]), hh ? (ctx.h + Math.round((rnd() - 0.5) * 2 * hh)) : undefined);
      }
    },
    blob(cx, cy, rad, col, hh, rr) {
      for (let y = -rad; y <= rad; y++) for (let x = -rad; x <= rad; x++) {
        const d = Math.hypot(x, y * 1.05);
        if (d <= rad - 0.15 + rnd() * 0.9) ctx.set(cx + x, cy + y, col, hh, rr);
      }
    },
    line(x0, y0, x1, y1, col, hh, rr) {
      const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2 + 1;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        ctx.set(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), col, hh, rr);
      }
    },
  };
  return ctx;
}

// reusable stone base ---------------------------------------------------------
function stoneBase(ctx, base = [128, 128, 130]) {
  ctx.fill(base, 132, 205);
  ctx.noise(11, 9);
  for (let i = 0; i < 3; i++) {
    const x = Math.floor(ctx.rnd() * 13) + 1, y = Math.floor(ctx.rnd() * 13) + 1;
    ctx.blob(x, y, 1.6, C(base[0] - 17, base[1] - 17, base[2] - 16), 120);
  }
  for (let i = 0; i < 4; i++) ctx.set(Math.floor(ctx.rnd() * 16), Math.floor(ctx.rnd() * 16), C(base[0] + 16, base[1] + 16, base[2] + 17), 142);
}

function dirtBase(ctx, base = [134, 96, 67], amt = 15) {
  ctx.fill(base, 126, 226);
  for (let i = 0; i < 42; i++) {
    const s = Math.round((ctx.rnd() - 0.5) * 2 * amt);
    ctx.set(Math.floor(ctx.rnd() * 16), Math.floor(ctx.rnd() * 16), C(base[0] + s, base[1] + s * 0.8, base[2] + s * 0.6), 126 + Math.round((ctx.rnd() - 0.5) * 22));
  }
}

function plankBase(ctx, base, dark, light, seedRow) {
  for (let by = 0; by < 4; by++) {
    const y0 = by * 4;
    for (let y = y0; y < y0 + 4; y++) {
      for (let x = 0; x < 16; x++) {
        let c = C(base[0], base[1], base[2]);
        const g = Math.round((ctx.rnd() - 0.5) * 12);
        c = C(c[0] + g, c[1] + g, c[2] + g);
        if ((x + seedRow[by]) % 7 === 0) c = C(c[0] - 12, c[1] - 10, c[2] - 8);   // grain streak
        ctx.set(x, y, c, 150 + (y - y0) * 3, 205);
      }
    }
    ctx.rect(0, y0 + 3, 16, 1, dark, 96, 220);                                   // board seam
  }
  for (let by = 0; by < 4; by++) {
    const seam = (by % 2 === 0) ? 4 + (by * 3) % 8 : 11 - (by * 2) % 6;
    ctx.rect(seam, by * 4, 1, 3, dark, 100, 220);
  }
  ctx.rect(0, 0, 16, 1, light, 158, 200);
}

function leafBase(ctx, base, holeP) {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    if (ctx.rnd() < holeP) { ctx.set(x, y, C(0, 0, 0, 0), 0); continue; }
    const v = Math.round((ctx.rnd() - 0.5) * 46);
    const dark = ctx.rnd() < 0.16;
    ctx.set(x, y, C(base[0] + v * (dark ? 0.5 : 1) - (dark ? 26 : 0), base[1] + v - (dark ? 22 : 0), base[2] + v * 0.6 - (dark ? 14 : 0)), 150 + Math.round(ctx.rnd() * 26), 235);
  }
}

function oreBase(ctx, spots, hi, dark) {
  stoneBase(ctx);
  for (let i = 0; i < 5; i++) {
    const cx = Math.floor(ctx.rnd() * 13) + 1, cy = Math.floor(ctx.rnd() * 13) + 1;
    const r = 1.1 + ctx.rnd() * 0.9;
    for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) {
      const d = Math.hypot(x, y);
      if (d > r) continue;
      const edge = d > r - 0.6;
      ctx.set(cx + x, cy + y, edge ? dark : (ctx.rnd() < 0.35 ? hi : spots), 168, 150);
    }
  }
}

const PAINT = {};
PAINT[TILES.grass_top] = (x) => {
  x.fill([106, 172, 62], 168, 232);
  for (let i = 0; i < 130; i++) {
    const px = Math.floor(x.rnd() * 16), py = Math.floor(x.rnd() * 16), t = x.rnd();
    const c = t < 0.3 ? [84, 146, 48] : t < 0.62 ? [122, 186, 74] : t < 0.86 ? [98, 162, 58] : [140, 198, 96];
    x.set(px, py, C(c[0], c[1], c[2]), 160 + Math.round(x.rnd() * 24), 228 + Math.round(x.rnd() * 20));
  }
};
PAINT[TILES.grass_side] = (x) => {
  dirtBase(x);
  const depth = [];
  for (let i = 0; i < 16; i++) depth.push(2 + Math.floor(x.rnd() * 3));
  for (let i = 0; i < 16; i++) {
    for (let y = 0; y < depth[i]; y++) {
      const v = Math.round((x.rnd() - 0.5) * 26);
      x.set(i, y, C(104 + v, 168 + v, 60 + v * 0.6), 172, 228);
    }
    if (x.rnd() < 0.4) x.set(i, depth[i], C(92, 150, 56), 150, 230);   // hanging blade
  }
};
PAINT[TILES.grass_snow] = (x) => {
  dirtBase(x);
  for (let i = 0; i < 16; i++) {
    const d = 3 + Math.floor(x.rnd() * 2);
    for (let y = 0; y < d; y++) { const v = Math.round(x.rnd() * 10); x.set(i, y, C(236 + v, 242 + v, 248), 176, 190); }
  }
};
PAINT[TILES.dirt] = (x) => dirtBase(x);
PAINT[TILES.dirt_path] = (x) => {
  dirtBase(x, [146, 110, 78], 12);
  for (let i = 0; i < 26; i++) x.set(Math.floor(x.rnd() * 16), Math.floor(x.rnd() * 16), C(120, 88, 60), 116, 230);
  x.rect(0, 0, 16, 1, C(160, 124, 90), 160);
};
PAINT[TILES.coarse] = (x) => {
  dirtBase(x, [122, 86, 58], 20);
  for (let i = 0; i < 14; i++) x.blob(Math.floor(x.rnd() * 16), Math.floor(x.rnd() * 16), 1, C(100, 70, 46), 110);
};
PAINT[TILES.podzol_top] = (x) => { dirtBase(x, [92, 64, 38], 16); for (let i = 0; i < 30; i++) x.set(Math.floor(x.rnd() * 16), Math.floor(x.rnd() * 16), C(120, 88, 52), 150); };
PAINT[TILES.podzol_side] = (x) => {
  dirtBase(x);
  for (let i = 0; i < 16; i++) { const d = 3 + Math.floor(x.rnd() * 3); for (let y = 0; y < d; y++) x.set(i, y, C(84, 58, 34), 150, 236); }
};
PAINT[TILES.farmland] = (x) => {
  dirtBase(x, [120, 84, 56], 10);
  for (let i = 0; i < 16; i += 4) x.rect(i, 0, 1, 16, C(92, 62, 40), 96, 240);
  for (let i = 1; i < 16; i += 4) x.rect(i, 0, 1, 16, C(140, 102, 70), 158, 220);
};
PAINT[TILES.farmland_wet] = (x) => {
  dirtBase(x, [74, 50, 32], 8);
  for (let i = 0; i < 16; i += 4) x.rect(i, 0, 1, 16, C(48, 30, 18), 92, 180);
  for (let i = 1; i < 16; i += 4) x.rect(i, 0, 1, 16, C(92, 62, 40), 150, 190);
};
PAINT[TILES.hay_side] = (x) => {
  for (let y = 0; y < 16; y++) for (let px = 0; px < 16; px++) {
    const v = Math.round((x.rnd() - 0.5) * 26);
    x.set(px, y, C(196 + v, 160 + v, 74 + v * 0.6), 140 + (px % 3) * 8, 235);
  }
  x.rect(0, 0, 16, 2, C(120, 88, 34), 120, 240);
  x.rect(0, 14, 16, 2, C(120, 88, 34), 120, 240);
  for (let i = 0; i < 8; i++) x.rect(Math.floor(x.rnd() * 16), 2, 1, 12, C(168, 132, 54), 128);
};
PAINT[TILES.hay_top] = (x) => {
  x.fill([178, 142, 60], 140, 236); x.noise(16);
  for (let r = 7; r > 0; r -= 2) for (let a = 0; a < 40; a++) {
    const t = a / 40 * Math.PI * 2;
    x.set(Math.round(7.5 + Math.cos(t) * r), Math.round(7.5 + Math.sin(t) * r), C(140, 106, 42), 130);
  }
};
PAINT[TILES.stone] = (x) => stoneBase(x);
PAINT[TILES.cobble] = (x) => {
  const cells = [];
  for (let i = 0; i < 9; i++) cells.push([1 + x.rnd() * 14, 1 + x.rnd() * 14]);
  for (let y = 0; y < 16; y++) for (let px = 0; px < 16; px++) {
    let best = 1e9, second = 1e9;
    for (const c of cells) { const d = Math.hypot(px - c[0], y - c[1]); if (d < best) { second = best; best = d; } else if (d < second) second = d; }
    const edge = second - best;
    if (edge < 1.1) { x.set(px, y, C(58, 58, 60), 82, 240); continue; }
    const v = Math.round((x.rnd() - 0.5) * 26);
    const b = 126 + Math.round(best * 5);
    x.set(px, y, C(b + v, b + v, b + 2 + v), 130 + Math.round(edge * 14), 214);
  }
};
PAINT[TILES.mossy] = (x) => {
  PAINT[TILES.cobble](x);
  for (let i = 0; i < 40; i++) {
    const px = Math.floor(x.rnd() * 16), py = Math.floor(x.rnd() * 16);
    if (x.rnd() < 0.6) x.set(px, py, C(88 + Math.round(x.rnd() * 26), 118 + Math.round(x.rnd() * 26), 58), 150, 240);
  }
};
function brickGrid(x, base, mortar, bw, bh) {
  x.fill(mortar, 96, 232);
  for (let row = 0; row * bh < 16; row++) {
    const off = (row % 2) * (bw >> 1);
    for (let col = -1; col * bw + off < 16; col++) {
      const x0 = col * bw + off, y0 = row * bh;
      for (let j = 0; j < bh - 1; j++) for (let i = 0; i < bw - 1; i++) {
        const px = x0 + i, py = y0 + j;
        if (px < 0 || px > 15 || py > 15) continue;
        const v = Math.round((x.rnd() - 0.5) * 20);
        x.set(px, py, C(base[0] + v, base[1] + v, base[2] + v), 150, 205);
      }
    }
  }
}
PAINT[TILES.stonebrick] = (x) => { brickGrid(x, [126, 126, 128], [86, 86, 88], 8, 4); for (let i = 0; i < 8; i++) x.set(Math.floor(x.rnd() * 16), Math.floor(x.rnd() * 16), C(104, 104, 106), 128); };
PAINT[TILES.mossybrick] = (x) => { PAINT[TILES.stonebrick](x); for (let i = 0; i < 44; i++) { const px = Math.floor(x.rnd() * 16), py = Math.floor(x.rnd() * 16); if (x.rnd() < 0.65) x.set(px, py, C(84 + Math.round(x.rnd() * 30), 112 + Math.round(x.rnd() * 30), 56), 152, 240); } };
PAINT[TILES.cracked] = (x) => {
  PAINT[TILES.stonebrick](x);
  for (let i = 0; i < 5; i++) {
    let px = Math.floor(x.rnd() * 16), py = Math.floor(x.rnd() * 16);
    for (let s = 0; s < 7; s++) { x.set(px, py, C(70, 70, 72), 104); px += Math.round((x.rnd() - 0.5) * 2); py += Math.round(x.rnd() * 1.4); px = (px + 16) % 16; if (py > 15) break; }
  }
};
PAINT[TILES.gravel] = (x) => {
  const cells = [];
  for (let i = 0; i < 12; i++) cells.push([x.rnd() * 16, x.rnd() * 16, 118 + Math.round(x.rnd() * 44)]);
  for (let y = 0; y < 16; y++) for (let px = 0; px < 16; px++) {
    let best = 1e9, b = 120;
    for (const c of cells) { const d = Math.hypot(px - c[0], y - c[1]); if (d < best) { best = d; b = c[2]; } }
    const v = Math.round((x.rnd() - 0.5) * 18);
    const shade = best > 2.1 ? -32 : 0;
    x.set(px, y, C(b + v + shade, b + v - 4 + shade, b + v - 8 + shade), 128 + Math.round((2.4 - Math.min(best, 2.4)) * 12), 226);
  }
};
PAINT[TILES.sand] = (x) => {
  x.fill([219, 207, 163], 150, 214);
  for (let i = 0; i < 150; i++) { const v = Math.round((x.rnd() - 0.5) * 22); x.set(Math.floor(x.rnd() * 16), Math.floor(x.rnd() * 16), C(219 + v, 207 + v, 163 + v), 146 + Math.round(x.rnd() * 12), 210 + Math.round(x.rnd() * 16)); }
  for (let y = 0; y < 16; y++) if (x.rnd() < 0.5) for (let px = 0; px < 16; px++) { const c = x.get(px, y); x.set(px, y, C(c[0] + 6, c[1] + 5, c[2] + 2), 152); }
};
PAINT[TILES.redsand] = (x) => { x.fill([190, 102, 36], 150, 216); for (let i = 0; i < 140; i++) { const v = Math.round((x.rnd() - 0.5) * 26); x.set(Math.floor(x.rnd() * 16), Math.floor(x.rnd() * 16), C(190 + v, 102 + v * 0.7, 36 + v * 0.5), 148); } };
PAINT[TILES.sandstone] = (x) => {
  for (let y = 0; y < 16; y++) {
    const band = Math.sin(y * 1.1) * 5 + Math.round((x.rnd() - 0.5) * 7);
    for (let px = 0; px < 16; px++) { const v = Math.round((x.rnd() - 0.5) * 8); x.set(px, y, C(216 + band + v, 202 + band + v, 156 + band + v), 150, 208); }
  }
  x.rect(0, 0, 16, 1, C(232, 220, 178), 158); x.rect(0, 15, 16, 1, C(186, 172, 128), 140);
  x.rect(0, 5, 16, 1, C(198, 184, 140), 142); x.rect(0, 10, 16, 1, C(198, 184, 140), 142);
};
PAINT[TILES.sandstone_top] = (x) => { x.fill([222, 208, 164], 152, 206); x.noise(7); };
PAINT[TILES.bedrock] = (x) => {
  for (let y = 0; y < 16; y++) for (let px = 0; px < 16; px++) {
    const b = 34 + Math.floor(x.rnd() * 62);
    x.set(px, y, C(b, b, b + 3), 100 + Math.round(x.rnd() * 60), 236);
  }
};
PAINT[TILES.planks_oak] = (x) => plankBase(x, [162, 130, 78], [110, 84, 46], [196, 162, 108], [1, 5, 3, 7]);
PAINT[TILES.planks_spruce] = (x) => plankBase(x, [104, 78, 48], [66, 48, 28], [132, 102, 66], [2, 6, 4, 0]);
PAINT[TILES.log_oak_side] = (x) => {
  for (let px = 0; px < 16; px++) {
    const base = 96 + Math.round(Math.sin(px * 0.9) * 8);
    for (let y = 0; y < 16; y++) { const v = Math.round((x.rnd() - 0.5) * 14); x.set(px, y, C(base + 30 + v, base + 12 + v, base - 22 + v), 140 + (px % 3) * 6, 226); }
  }
  for (let i = 0; i < 6; i++) { const px = Math.floor(x.rnd() * 16); x.rect(px, 0, 1, 16, C(78, 58, 34), 118, 236); }
};
PAINT[TILES.log_spruce_side] = (x) => {
  for (let px = 0; px < 16; px++) for (let y = 0; y < 16; y++) {
    const v = Math.round((x.rnd() - 0.5) * 14), b = 58 + Math.round(Math.sin(px * 1.1) * 7);
    x.set(px, y, C(b + 16 + v, b + v, b - 20 + v), 138 + (px % 3) * 6, 230);
  }
  for (let i = 0; i < 5; i++) x.rect(Math.floor(x.rnd() * 16), 0, 1, 16, C(40, 30, 18), 116);
};
PAINT[TILES.log_birch_side] = (x) => {
  for (let px = 0; px < 16; px++) for (let y = 0; y < 16; y++) {
    const v = Math.round((x.rnd() - 0.5) * 10);
    x.set(px, y, C(214 + v, 208 + v, 196 + v), 156, 200);
  }
  for (let i = 0; i < 7; i++) {
    const y = Math.floor(x.rnd() * 16), x0 = Math.floor(x.rnd() * 9), w = 3 + Math.floor(x.rnd() * 5);
    x.rect(x0, y, w, 1 + (x.rnd() < 0.3 ? 1 : 0), C(58, 56, 52), 120, 220);
  }
};
function ringTop(x, base) {
  for (let y = 0; y < 16; y++) for (let px = 0; px < 16; px++) {
    const d = Math.hypot(px - 7.5, y - 7.5);
    const ring = Math.sin(d * 2.5) * 10;
    const v = Math.round((x.rnd() - 0.5) * 10);
    x.set(px, y, C(base[0] + ring + v, base[1] + ring + v, base[2] + ring * 0.6 + v), 148, 224);
  }
  x.rect(0, 0, 16, 1, C(base[0] - 34, base[1] - 30, base[2] - 20), 128);
  x.rect(0, 15, 16, 1, C(base[0] - 34, base[1] - 30, base[2] - 20), 128);
  x.rect(0, 0, 1, 16, C(base[0] - 34, base[1] - 30, base[2] - 20), 128);
  x.rect(15, 0, 1, 16, C(base[0] - 34, base[1] - 30, base[2] - 20), 128);
}
PAINT[TILES.log_oak_top] = (x) => ringTop(x, [176, 146, 92]);
PAINT[TILES.log_spruce_top] = (x) => ringTop(x, [126, 98, 60]);
PAINT[TILES.log_birch_top] = (x) => ringTop(x, [206, 194, 168]);
PAINT[TILES.leaves_oak] = (x) => leafBase(x, [74, 132, 42], 0.14);
PAINT[TILES.leaves_spruce] = (x) => leafBase(x, [48, 96, 48], 0.1);
PAINT[TILES.leaves_birch] = (x) => leafBase(x, [104, 148, 58], 0.13);
PAINT[TILES.cactus_side] = (x) => {
  x.fill([64, 116, 52], 150, 214); x.noise(9);
  x.rect(0, 0, 1, 16, C(44, 86, 36), 130); x.rect(15, 0, 1, 16, C(44, 86, 36), 130);
  for (let i = 0; i < 8; i++) { const px = 2 + Math.floor(x.rnd() * 12), py = Math.floor(x.rnd() * 16); x.set(px, py, C(222, 226, 180), 176, 180); }
};
PAINT[TILES.cactus_top] = (x) => { x.fill([86, 142, 68], 152, 210); x.noise(8); x.rect(6, 6, 4, 4, C(112, 168, 88), 158); x.rect(0, 0, 16, 1, C(50, 96, 40), 132); };
PAINT[TILES.coal] = (x) => oreBase(x, C(38, 38, 42), C(86, 86, 92), C(20, 20, 22));
PAINT[TILES.iron] = (x) => oreBase(x, C(198, 152, 110), C(228, 190, 152), C(150, 108, 74));
PAINT[TILES.gold] = (x) => oreBase(x, C(246, 206, 74), C(255, 236, 150), C(190, 148, 40));
PAINT[TILES.diamond] = (x) => oreBase(x, C(96, 226, 222), C(196, 255, 252), C(48, 168, 172));
PAINT[TILES.redstone] = (x) => oreBase(x, C(206, 34, 34), C(255, 96, 80), C(128, 16, 16));
PAINT[TILES.obsidian] = (x) => {
  x.fill([22, 18, 34], 130, 96); x.noise(7);
  for (let i = 0; i < 5; i++) x.blob(Math.floor(x.rnd() * 16), Math.floor(x.rnd() * 16), 1.2, C(48, 34, 74), 142, 80);
  for (let i = 0; i < 10; i++) x.set(Math.floor(x.rnd() * 16), Math.floor(x.rnd() * 16), C(126, 96, 190), 160, 60);
};
PAINT[TILES.glowstone] = (x) => {
  x.fill([150, 110, 58], 140, 190); x.noise(12);
  for (let i = 0; i < 7; i++) {
    const cx = 2 + Math.floor(x.rnd() * 12), cy = 2 + Math.floor(x.rnd() * 12), r = 1.4 + x.rnd();
    for (let y = -3; y <= 3; y++) for (let px = -3; px <= 3; px++) {
      const d = Math.hypot(px, y); if (d > r + 0.8) continue;
      const t = d < r - 0.5;
      x.set(cx + px, cy + y, t ? C(255, 240, 178) : C(226, 182, 96), 170, 150);
    }
  }
};
PAINT[TILES.lantern] = (x) => {
  x.fill([54, 48, 40], 120, 150); x.noise(8);
  x.rect(1, 1, 14, 14, C(70, 62, 50), 126, 140);
  x.rect(3, 3, 10, 10, C(255, 196, 92), 176, 90);
  x.rect(5, 5, 6, 6, C(255, 240, 190), 186, 70);
  x.rect(2, 2, 12, 1, C(96, 86, 68), 150, 120);
  x.rect(2, 13, 12, 1, C(40, 36, 30), 100, 170);
};
PAINT[TILES.lava] = (x) => {
  x.fill([206, 74, 16], 130, 190);
  for (let i = 0; i < 10; i++) {
    const cx = Math.floor(x.rnd() * 16), cy = Math.floor(x.rnd() * 16), r = 1.2 + x.rnd() * 2;
    for (let y = -3; y <= 3; y++) for (let px = -3; px <= 3; px++) {
      const d = Math.hypot(px, y); if (d > r) continue;
      const t = 1 - d / r;
      x.set(cx + px, cy + y, C(206 + t * 49, 74 + t * 150, 16 + t * 60), 130 + t * 50, 190 - t * 60);
    }
  }
  for (let i = 0; i < 16; i++) x.set(Math.floor(x.rnd() * 16), Math.floor(x.rnd() * 16), C(112, 26, 8), 112, 220);
};
PAINT[TILES.fire] = (x) => {
  for (let px = 0; px < 16; px++) for (let y = 0; y < 16; y++) {
    const t = 1 - y / 15;
    const flick = Math.sin(px * 1.6 + y * 0.7) * 0.14 + x.rnd() * 0.2;
    const a = Math.max(0, Math.min(1, t * 1.5 - 0.25 + flick));
    if (a <= 0.03) { x.set(px, y, C(0, 0, 0, 0), 0); continue; }
    x.set(px, y, C(255, 150 + a * 105, 40 + a * 190, a * 255), 0, 100);
  }
};
PAINT[TILES.bricks] = (x) => { brickGrid(x, [154, 82, 66], [190, 178, 170], 8, 4); };
PAINT[TILES.wool] = (x) => {
  x.fill([232, 232, 232], 158, 246);
  for (let i = 0; i < 150; i++) { const v = Math.round((x.rnd() - 0.5) * 16); x.set(Math.floor(x.rnd() * 16), Math.floor(x.rnd() * 16), C(232 + v, 232 + v, 234 + v), 150 + Math.round(x.rnd() * 20)); }
};
PAINT[TILES.glass] = (x) => {
  for (let y = 0; y < 16; y++) for (let px = 0; px < 16; px++) x.set(px, y, C(198, 226, 236, 26), 190, 26);
  x.rect(0, 0, 16, 1, C(226, 244, 250, 220), 196, 20); x.rect(0, 15, 16, 1, C(226, 244, 250, 220), 196, 20);
  x.rect(0, 0, 1, 16, C(226, 244, 250, 220), 196, 20); x.rect(15, 0, 1, 16, C(226, 244, 250, 220), 196, 20);
  for (let i = 0; i < 9; i++) x.set(3 + i, 12 - i, C(255, 255, 255, 130), 192, 18);
  for (let i = 0; i < 5; i++) x.set(9 + i, 13 - i, C(255, 255, 255, 96), 192, 18);
};
PAINT[TILES.water] = (x) => {
  for (let y = 0; y < 16; y++) for (let px = 0; px < 16; px++) {
    const w = Math.sin((px + y * 0.6) * 0.8) * 10 + Math.round((x.rnd() - 0.5) * 10);
    x.set(px, y, C(44 + w * 0.4, 96 + w, 186 + w, 200), 170, 30);
  }
};
PAINT[TILES.snow] = (x) => { x.fill([238, 244, 250], 168, 186); for (let i = 0; i < 70; i++) { const v = Math.round(x.rnd() * 12); x.set(Math.floor(x.rnd() * 16), Math.floor(x.rnd() * 16), C(228 + v, 236 + v, 246), 162 + Math.round(x.rnd() * 14), 182); } };
PAINT[TILES.snow_side] = (x) => { dirtBase(x); for (let i = 0; i < 16; i++) { const d = 4 + Math.floor(x.rnd() * 2); for (let y = 0; y < d; y++) x.set(i, y, C(236, 242, 250), 170, 186); } };
PAINT[TILES.ice] = (x) => {
  x.fill([146, 176, 226], 170, 40);
  for (let i = 0; i < 8; i++) { const px = Math.floor(x.rnd() * 16), py = Math.floor(x.rnd() * 16); x.line(px, py, px + Math.round((x.rnd() - 0.5) * 8), py + Math.round((x.rnd() - 0.5) * 8), C(196, 216, 246), 178, 30); }
  x.noise(6);
};
PAINT[TILES.clay] = (x) => { x.fill([158, 164, 176], 146, 224); x.noise(10); for (let i = 0; i < 5; i++) x.blob(Math.floor(x.rnd() * 16), Math.floor(x.rnd() * 16), 1.4, C(140, 146, 158), 138); };
PAINT[TILES.pumpkin_side] = (x) => {
  for (let px = 0; px < 16; px++) {
    const rib = Math.cos((px + 0.5) / 16 * Math.PI * 4) * 16;
    for (let y = 0; y < 16; y++) { const v = Math.round((x.rnd() - 0.5) * 12); x.set(px, y, C(206 + rib + v, 116 + rib * 0.6 + v, 26 + v), 140 + Math.round(rib), 214); }
  }
  x.rect(0, 0, 16, 1, C(120, 148, 62), 150); x.rect(0, 15, 16, 1, C(120, 148, 62), 150);
};
PAINT[TILES.pumpkin_top] = (x) => {
  x.fill([196, 112, 28], 146, 214); x.noise(10);
  for (let r = 7; r > 0; r -= 2.5) for (let a = 0; a < 34; a++) { const t = a / 34 * Math.PI * 2; x.set(Math.round(7.5 + Math.cos(t) * r), Math.round(7.5 + Math.sin(t) * r), C(160, 88, 22), 136); }
  x.rect(7, 7, 2, 2, C(96, 118, 48), 168, 230);
};
PAINT[TILES.pumpkin_face] = (x) => {
  PAINT[TILES.pumpkin_side](x);
  const glow = C(255, 214, 96), mid = C(255, 168, 40);
  x.rect(2, 4, 3, 3, glow, 180, 120); x.set(3, 6, mid);
  x.rect(11, 4, 3, 3, glow, 180, 120); x.set(12, 6, mid);
  x.rect(7, 7, 2, 2, mid, 176, 130);
  for (let px = 3; px <= 12; px++) { const y = 10 + (px % 2 ? 0 : 1); x.set(px, y, glow, 180, 120); x.set(px, y + 1, mid, 178, 124); }
};
PAINT[TILES.bookshelf] = (x) => {
  plankBase(x, [162, 130, 78], [110, 84, 46], [196, 162, 108], [1, 5, 3, 7]);
  const cols = [[152, 46, 40], [46, 82, 148], [58, 122, 62], [176, 148, 52], [112, 62, 128], [52, 128, 132]];
  for (let shelf = 0; shelf < 2; shelf++) {
    const y0 = 1 + shelf * 7;
    let px = 1;
    while (px < 15) {
      const w = 1 + Math.floor(x.rnd() * 2), c = cols[Math.floor(x.rnd() * cols.length)];
      x.rect(px, y0, w, 6, C(c[0], c[1], c[2]), 158, 210);
      x.rect(px, y0 + 5, w, 1, C(c[0] * 0.6, c[1] * 0.6, c[2] * 0.6), 150, 220);
      px += w + (x.rnd() < 0.3 ? 1 : 0);
    }
    x.rect(0, y0 + 6, 16, 1, C(110, 84, 46), 120, 226);
  }
};
PAINT[TILES.crafting] = (x) => {
  plankBase(x, [148, 116, 68], [98, 74, 40], [180, 148, 96], [2, 6, 1, 5]);
  x.rect(1, 1, 14, 6, C(96, 72, 42), 168, 214);
  x.rect(2, 2, 12, 4, C(126, 98, 56), 172, 210);
  for (let i = 0; i < 4; i++) x.rect(3 + i * 3, 3, 2, 2, C(78, 58, 34), 160, 220);
  x.rect(4, 9, 8, 3, C(72, 54, 32), 140, 226);
  x.rect(5, 10, 6, 1, C(150, 120, 72), 158, 210);
};
function furnaceFace(x, lit) {
  stoneBase(x, [118, 118, 120]);
  x.rect(2, 2, 12, 2, C(88, 88, 90), 140, 220);
  x.rect(3, 5, 10, 8, C(46, 44, 46), 104, 236);
  x.rect(4, 6, 8, 6, lit ? C(255, 148, 44) : C(28, 26, 28), lit ? 176 : 96, lit ? 120 : 240);
  if (lit) { x.rect(5, 8, 6, 4, C(255, 214, 96), 186, 100); x.rect(6, 10, 4, 2, C(255, 246, 200), 192, 90); }
  x.rect(2, 13, 12, 1, C(96, 96, 98), 128, 226);
}
PAINT[TILES.furnace] = (x) => furnaceFace(x, false);
PAINT[TILES.furnace_lit] = (x) => furnaceFace(x, true);

// cutout plants ---------------------------------------------------------------
function plantStem(x, y0, y1, col) { for (let y = y0; y <= y1; y++) x.set(7 + (y % 2 ? 0 : 1), y, col, 150, 236); }
PAINT[TILES.poppy] = (x) => {
  for (let y = 0; y < 16; y++) for (let px = 0; px < 16; px++) x.set(px, y, C(0, 0, 0, 0), 0);
  plantStem(x, 8, 15, C(58, 122, 44));
  x.set(5, 11, C(66, 138, 48)); x.set(6, 12, C(66, 138, 48)); x.set(10, 10, C(52, 112, 40)); x.set(9, 11, C(52, 112, 40));
  for (let y = 3; y <= 8; y++) for (let px = 4; px <= 11; px++) {
    const d = Math.hypot(px - 7.5, y - 5.5);
    if (d > 3.4) continue;
    const v = Math.round((x.rnd() - 0.5) * 22);
    x.set(px, y, d > 2.6 ? C(158 + v, 26 + v, 24) : C(214 + v, 44 + v, 38), 164, 232);
  }
  x.set(7, 5, C(38, 30, 22)); x.set(8, 5, C(38, 30, 22)); x.set(7, 6, C(246, 214, 90)); x.set(8, 6, C(246, 214, 90));
};
PAINT[TILES.dandelion] = (x) => {
  for (let y = 0; y < 16; y++) for (let px = 0; px < 16; px++) x.set(px, y, C(0, 0, 0, 0), 0);
  plantStem(x, 7, 15, C(64, 128, 46));
  x.set(5, 10, C(70, 142, 50)); x.set(10, 9, C(56, 120, 42));
  for (let y = 3; y <= 7; y++) for (let px = 5; px <= 10; px++) {
    const d = Math.hypot(px - 7.5, y - 5);
    if (d > 2.7) continue;
    const v = Math.round((x.rnd() - 0.5) * 24);
    x.set(px, y, C(250 + v * 0.2, 214 + v, 44 + v), 166, 230);
  }
};
PAINT[TILES.tallgrass] = (x) => {
  for (let y = 0; y < 16; y++) for (let px = 0; px < 16; px++) x.set(px, y, C(0, 0, 0, 0), 0);
  for (let b = 0; b < 7; b++) {
    const x0 = 1 + Math.floor(x.rnd() * 14), h = 6 + Math.floor(x.rnd() * 8), lean = Math.round((x.rnd() - 0.5) * 3);
    for (let i = 0; i < h; i++) {
      const t = i / h, px = Math.round(x0 + lean * t * t), py = 15 - i;
      const g = 96 + Math.round(t * 62) + Math.round((x.rnd() - 0.5) * 18);
      x.set(px, py, C(46 + Math.round(t * 16), g + 26, 38), 150 + i * 3, 234);
    }
  }
};
PAINT[TILES.fern] = (x) => {
  for (let y = 0; y < 16; y++) for (let px = 0; px < 16; px++) x.set(px, y, C(0, 0, 0, 0), 0);
  for (let b = 0; b < 5; b++) {
    const x0 = 2 + b * 3, h = 9 + Math.floor(x.rnd() * 5);
    for (let i = 0; i < h; i++) {
      const py = 15 - i, t = i / h;
      const g = 88 + Math.round(t * 56);
      x.set(x0, py, C(38, g, 34), 150 + i * 3, 236);
      if (i % 2 === 0 && i < h - 2) { x.set(x0 - 1, py, C(44, g - 12, 38)); x.set(x0 + 1, py, C(44, g - 12, 38)); }
    }
  }
};
function wheatTile(x, stage) {
  for (let y = 0; y < 16; y++) for (let px = 0; px < 16; px++) x.set(px, y, C(0, 0, 0, 0), 0);
  const n = 3 + stage * 2;
  const green = stage < 2;
  for (let b = 0; b < n; b++) {
    const x0 = 1 + Math.floor(b * (14 / n)) + Math.floor(x.rnd() * 2);
    const h = 5 + stage * 4 + Math.floor(x.rnd() * 2);
    for (let i = 0; i < h; i++) {
      const py = 15 - i, t = i / h;
      const col = green ? C(72 + Math.round(t * 34), 132 + Math.round(t * 44), 48) : C(206 + Math.round(t * 30), 176 + Math.round(t * 34), 76);
      x.set(x0, py, col, 150 + i * 3, 232);
      if (!green && i > h - 5) { x.set(x0 - 1, py, C(226, 196, 96), 168, 226); x.set(x0 + 1, py, C(190, 158, 66), 160, 230); }
    }
    if (!green) { x.set(x0, 15 - h - 1, C(238, 214, 130), 176, 220); x.set(x0 - 1, 15 - h - 2, C(226, 200, 116), 176); }
  }
}
PAINT[TILES.wheat1] = (x) => wheatTile(x, 0);
PAINT[TILES.wheat2] = (x) => wheatTile(x, 1);
PAINT[TILES.wheat3] = (x) => wheatTile(x, 2);
PAINT[TILES.carrot] = (x) => {
  for (let y = 0; y < 16; y++) for (let px = 0; px < 16; px++) x.set(px, y, C(0, 0, 0, 0), 0);
  for (let b = 0; b < 6; b++) {
    const x0 = 2 + Math.floor(x.rnd() * 12), h = 5 + Math.floor(x.rnd() * 5);
    for (let i = 0; i < h; i++) { const py = 15 - i; x.set(x0, py, C(52 + i * 4, 118 + i * 8, 42), 150 + i * 3, 236); if (i % 3 === 1) { x.set(x0 - 1, py, C(48, 106, 40)); x.set(x0 + 1, py, C(58, 126, 46)); } }
  }
  x.rect(6, 13, 4, 2, C(222, 118, 28), 156, 226);
};
PAINT[TILES.sapling] = (x) => {
  for (let y = 0; y < 16; y++) for (let px = 0; px < 16; px++) x.set(px, y, C(0, 0, 0, 0), 0);
  x.rect(7, 8, 2, 8, C(96, 70, 42), 148, 232);
  for (let y = 2; y <= 9; y++) for (let px = 3; px <= 12; px++) {
    const d = Math.hypot(px - 7.5, y - 5.5);
    if (d > 4.2 || x.rnd() < 0.14) continue;
    x.set(px, y, C(58 + Math.round(x.rnd() * 30), 126 + Math.round(x.rnd() * 40), 46), 160, 234);
  }
};
PAINT[TILES.vine] = (x) => {
  for (let y = 0; y < 16; y++) for (let px = 0; px < 16; px++) x.set(px, y, C(0, 0, 0, 0), 0);
  for (let b = 0; b < 4; b++) {
    const x0 = 1 + b * 4;
    for (let y = 0; y < 12 + Math.floor(x.rnd() * 4); y++) {
      const px = x0 + Math.round(Math.sin(y * 0.6 + b) * 1.4);
      x.set(px, y, C(52, 106 + Math.round(x.rnd() * 26), 40), 150, 238);
      if (y % 3 === 0) { x.set(px - 1, y, C(60, 122, 44)); x.set(px + 1, y, C(46, 96, 36)); }
    }
  }
};
PAINT[TILES.ladder] = (x) => {
  for (let y = 0; y < 16; y++) for (let px = 0; px < 16; px++) x.set(px, y, C(0, 0, 0, 0), 0);
  x.rect(2, 0, 2, 16, C(126, 96, 54), 158, 226); x.rect(12, 0, 2, 16, C(126, 96, 54), 158, 226);
  for (let y = 2; y < 16; y += 4) { x.rect(2, y, 12, 2, C(148, 114, 66), 164, 222); x.rect(2, y + 2, 12, 1, C(96, 72, 40), 148, 232); }
};
PAINT[TILES.torch_flame] = (x) => {
  for (let y = 0; y < 16; y++) for (let px = 0; px < 16; px++) x.set(px, y, C(0, 0, 0, 0), 0);
  for (let y = 0; y < 16; y++) for (let px = 0; px < 16; px++) {
    const d = Math.hypot((px - 7.5) * 1.15, (y - 9) * 0.72);
    const flick = Math.sin(px * 1.3 + y * 0.9) * 0.5;
    const t = 1 - (d + flick) / 6.4;
    if (t <= 0) continue;
    const a = Math.min(1, t * 1.6);
    x.set(px, y, C(255, 168 + t * 87, 62 + t * 190, a * 255), 0, 60);
  }
};

// ═══════════════════════════════════════════════════════════════════════════
/** normal map from a height canvas (sobel → tangent space) */
function normalFromHeight(hCanvas, strength) {
  const w = hCanvas.width, h = hCanvas.height;
  const hc = hCanvas.getContext('2d');
  const src = hc.getImageData(0, 0, w, h).data;
  const out = hc.createImageData(w, h);
  const at = (px, py) => src[(((py + h) % h) * w + ((px + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) for (let px = 0; px < w; px++) {
    const dx = (at(px + 1, y) - at(px - 1, y)) * strength;
    const dy = (at(px, y + 1) - at(px, y - 1)) * strength;
    let nx = -dx, ny = -dy, nz = 1;
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const i = (y * w + px) * 4;
    out.data[i] = (nx * 0.5 + 0.5) * 255;
    out.data[i + 1] = (ny * 0.5 + 0.5) * 255;
    out.data[i + 2] = (nz * 0.5 + 0.5) * 255;
    out.data[i + 3] = 255;
  }
  hc.putImageData(out, 0, 0);
  return hCanvas;
}

function nearest(tex, srgb = true) {
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 8;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Build the whole material set. Returns { map, normalMap, roughnessMap, materials, atlasCanvas }
 * `THREE` canvas is created via document.createElement — works in browser only.
 */
export function buildAtlas(seed = 1337, renderer = null) {
  const mk = () => { const c = document.createElement('canvas'); c.width = ATLAS; c.height = ATLAS; return c; };
  const cCol = mk(), cHgt = mk(), cRgh = mk();
  const ctxCol = cCol.getContext('2d'), ctxH = cHgt.getContext('2d'), ctxR = cRgh.getContext('2d');
  ctxCol.clearRect(0, 0, ATLAS, ATLAS);
  const img = ctxCol.createImageData(ATLAS, ATLAS).data.slice();   // plain array we poke directly
  const imgOut = ctxCol.createImageData(ATLAS, ATLAS);
  const hImg = ctxH.createImageData(ATLAS, ATLAS);
  const rImg = ctxR.createImageData(ATLAS, ATLAS);
  hImg.data.fill(128); rImg.data.fill(220);
  // keep alpha 0 in height/rough for empty pixels
  for (let i = 3; i < hImg.data.length; i += 4) { hImg.data[i] = 255; rImg.data[i] = 255; }

  for (const name of Object.keys(TILES)) {
    const t = TILES[name];
    const col = (t % GRID) * TILE, row = Math.floor(t / GRID) * TILE;
    const rnd = mulberry32(seed + t * 7919);
    // clear tile
    for (let y = 0; y < TILE; y++) for (let px = 0; px < TILE; px++) {
      const i = ((row + y) * ATLAS + (col + px)) * 4;
      img[i] = img[i + 1] = img[i + 2] = img[i + 3] = 0;
      hImg.data[i] = hImg.data[i + 1] = hImg.data[i + 2] = 128; hImg.data[i + 3] = 255;
      rImg.data[i] = rImg.data[i + 1] = rImg.data[i + 2] = 220; rImg.data[i + 3] = 255;
    }
    const ctx = makeCtx(img, hImg.data, rImg.data, col, row, rnd);
    (PAINT[t] || PAINT[TILES.stone])(ctx);
  }
  imgOut.data.set(img);
  ctxCol.putImageData(imgOut, 0, 0);
  ctxH.putImageData(hImg, 0, 0);
  ctxR.putImageData(rImg, 0, 0);
  normalFromHeight(cHgt, 2.6);

  const map = nearest(new THREE.CanvasTexture(cCol));
  const normalMap = nearest(new THREE.CanvasTexture(cHgt), false);
  normalMap.minFilter = THREE.LinearMipmapLinearFilter;
  normalMap.magFilter = THREE.LinearFilter;
  const roughnessMap = nearest(new THREE.CanvasTexture(cRgh), false);
  roughnessMap.minFilter = THREE.LinearMipmapLinearFilter;
  roughnessMap.magFilter = THREE.LinearFilter;
  if (renderer) { const a = renderer.capabilities.getMaxAnisotropy(); [map, normalMap, roughnessMap].forEach((t) => { t.anisotropy = Math.min(8, a); }); }

  // ── materials ────────────────────────────────────────────────────────────
  const common = { map, normalMap, roughnessMap, vertexColors: true };
  const opaque = new THREE.MeshStandardMaterial({
    ...common, roughness: 1.0, metalness: 0.0,
    normalScale: new THREE.Vector2(0.85, 0.85),
  });
  const cutout = new THREE.MeshStandardMaterial({
    ...common, roughness: 1.0, metalness: 0.0, alphaTest: 0.5, side: THREE.DoubleSide,
    normalScale: new THREE.Vector2(0.7, 0.7),
  });
  cutout.defines = { USE_ALPHATEST: '', ALPHA_TEST: 0.5 };
  const transparent = new THREE.MeshStandardMaterial({
    ...common, transparent: true, opacity: 0.82, roughness: 0.12, metalness: 0.0,
    depthWrite: false, side: THREE.DoubleSide, normalScale: new THREE.Vector2(1.5, 1.5),
    envMapIntensity: 1.6,
  });
  const emissive = new THREE.MeshStandardMaterial({
    ...common, roughness: 0.85, metalness: 0.0,
    emissive: new THREE.Color(0xffffff), emissiveMap: map, emissiveIntensity: 1.35,
    normalScale: new THREE.Vector2(0.6, 0.6),
  });

  return {
    map, normalMap, roughnessMap, atlasCanvas: cCol,
    materials: { opaque, cutout, transparent, emissive },
  };
}

/** flat 16×16 canvas of a single tile (used for UI icons) */
export function tilePreview(atlasCanvas, tile, px = 32) {
  const c = document.createElement('canvas'); c.width = c.height = px;
  const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
  g.drawImage(atlasCanvas, (tile % GRID) * TILE, Math.floor(tile / GRID) * TILE, TILE, TILE, 0, 0, px, px);
  return c;
}
