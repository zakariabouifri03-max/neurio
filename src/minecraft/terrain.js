// ═══════════════════════════════════════════════════════════════════════════
//  TERRAIN — a floating-island style Minecraft landscape:
//  fBm heightmap + radial falloff, mountain range, pond, beaches,
//  3D-noise caves with ore veins and lava, biome tags for grass/leaf tinting.
// ═══════════════════════════════════════════════════════════════════════════
import { VoxelWorld } from './voxels.js';
import { B, PALETTE } from './textures.js';
import { makeNoise } from './noise.js';
import { mulberry32, clamp } from '../util.js';

export const SEA = 13;
export const SIZE = 56;          // island half-extent in blocks (beach ring ≈ 0.93·SIZE)
export const EXT = SIZE + 18;    // generated extent — includes the underwater shelf
export const OCEAN_R = 300;      // ocean disc radius

// biome indices (match BIOME_TINT)
export const BIO_PLAINS = 0, BIO_FOREST = 1, BIO_BEACH = 2, BIO_MOUNTAIN = 4, BIO_SNOW = 5;

export function generateTerrain(seed = 20261011) {
  const N = makeNoise(seed);
  const rnd = mulberry32(seed ^ 0x9e37);
  const world = new VoxelWorld(PALETTE);
  const H = new Map();               // "x,z" → surface y
  const BIO = new Map();             // "x,z" → biome index
  const reserved = [];               // structure footprints: {x0,z0,x1,z1,pad}

  const ck = (x, z) => x + ',' + z;
  const mntCenter = { x: -SIZE * 0.44, z: -SIZE * 0.46 };
  const pond = { x: SIZE * 0.52, z: SIZE * 0.34, r: 7.5 };

  const maskAt = (x, z, c, r) => {
    const d = Math.hypot(x - c.x, z - c.z);
    return clamp((r - d) / (r * 0.42), 0, 1);
  };

  function heightAt(x, z) {
    const r = Math.hypot(x, z) / SIZE;
    // radial profile: 1 on the island, 0 beyond the underwater shelf
    let p = clamp((1.34 - r) / 0.44, 0, 1);
    const n1 = N.noise2(x * 0.0085 + 11.3, z * 0.0085 - 4.7);
    p *= 0.86 + 0.14 * (n1 * 0.5 + 0.5);
    p = clamp(p, 0, 1);

    const hills = 5.2 * N.fbm2(x * 0.021 + 30, z * 0.021 - 12, 4);
    // sea floor shelf → beach → island interior
    let h = 4.6 + (SEA + 2.0 - 4.6) * Math.pow(p, 1.35) + Math.pow(p, 1.9) * (8.6 + hills);

    // mountain range in the north-west
    const mm = maskAt(x, z, mntCenter, SIZE * 0.72);
    const mr = Math.pow(clamp(N.ridged2(x * 0.026 - 5, z * 0.026 + 9, 4) * 0.5 + 0.5, 0, 1), 1.25);
    h += mm * mr * 25;

    // a small plateau so the village always has somewhere flat to stand
    const pm = maskAt(x, z, { x: SIZE * 0.06, z: SIZE * 0.16 }, SIZE * 0.36);
    h = h * (1 - pm * 0.42) + (SEA + 6.6) * pm * 0.42;

    // pond basin
    const pd = Math.hypot(x - pond.x, z - pond.z);
    if (pd < pond.r + 4) h -= clamp((pond.r + 4 - pd) / 4.2, 0, 1) * 5.6;

    return h;
  }

  // ── columns ─────────────────────────────────────────────────────────────
  for (let x = -EXT; x <= EXT; x++) {
    for (let z = -EXT; z <= EXT; z++) {
      const hf = heightAt(x, z);
      const h = Math.round(hf);
      H.set(ck(x, z), h);
      const slope = Math.max(
        Math.abs(heightAt(x + 1, z) - heightAt(x - 1, z)),
        Math.abs(heightAt(x, z + 1) - heightAt(x, z - 1)),
      ) * 0.5;

      const mm = maskAt(x, z, mntCenter, SIZE * 0.8);
      let bio = BIO_PLAINS;
      let surf = B.GRASS, sub = B.DIRT;

      if (h >= SEA + 24 || (mm > 0.45 && h >= SEA + 17)) {
        surf = B.SNOW; sub = B.STONE; bio = BIO_SNOW;
      } else if (h <= SEA + 1) {
        surf = B.SAND; sub = B.SAND; bio = BIO_BEACH;
      } else if (h < SEA) {
        surf = h >= SEA - 2 ? B.SAND : (h >= SEA - 5 ? B.GRAVEL : B.STONE);
        sub = h >= SEA - 3 ? B.SAND : B.STONE; bio = BIO_BEACH;
      } else if (h <= SEA + 2 && rnd() < 0.4) {
        surf = B.GRAVEL; sub = B.SAND; bio = BIO_BEACH;
      } else if (slope > 2.05 || (mm > 0.4 && slope > 1.3)) {
        surf = rnd() < 0.28 ? B.GRAVEL : B.STONE; sub = B.STONE; bio = BIO_MOUNTAIN;
      } else if (N.noise2(x * 0.045 - 60, z * 0.045 + 22) > 0.3) {
        bio = BIO_FOREST;
      }
      BIO.set(ck(x, z), bio);

      world.raw(x, 0, z, B.BEDROCK);
      for (let y = 1; y < h; y++) {
        let id;
        if (y >= h - 1) id = surf;
        else if (y >= h - 3) id = sub === B.SAND ? B.SANDSTONE : sub;
        else id = B.STONE;
        world.raw(x, y, z, id, y >= h - 1 ? bio : -1);
      }
      // shallow water column (pond + shoreline + beach shelf); the open ocean
      // beyond is a single animated disc, so deep columns stay empty
      if (h <= SEA && h >= SEA - 5) {
        for (let y = h; y <= SEA; y++) world.raw(x, y, z, B.WATER);
        if (h > 1) {
          // replace the top solid with a water-bed material
          const bed = bio === BIO_BEACH ? B.SAND : B.GRAVEL;
          world.raw(x, h - 1, z, rnd() < 0.12 ? B.CLAY : bed);
        }
      }
    }
  }

  // ── ore veins (before caves so veins get carved too) ─────────────────────
  const VEINS = [
    { id: B.COAL_ORE, freq: 0.085, thresh: 0.63, yMax: 60, yMin: 2 },
    { id: B.IRON_ORE, freq: 0.10, thresh: 0.71, yMax: 42, yMin: 2 },
    { id: B.GOLD_ORE, freq: 0.13, thresh: 0.79, yMax: 26, yMin: 2 },
    { id: B.DIAMOND_ORE, freq: 0.17, thresh: 0.86, yMax: 15, yMin: 1 },
    { id: B.GRAVEL, freq: 0.05, thresh: 0.74, yMax: 30, yMin: 2 },
  ];
  const isStone = (id) => id === B.STONE || id === B.GRAVEL;
  for (const v of VEINS) {
    for (let x = -EXT; x <= EXT; x++) for (let z = -EXT; z <= EXT; z++) {
      for (let y = v.yMin; y <= Math.min(v.yMax, (H.get(ck(x, z)) | 0) - 4); y++) {
        if (!isStone(world.get(x, y, z))) continue;
        if (N.noise3(x * v.freq + v.id * 3.1, y * v.freq * 1.6, z * v.freq - v.id * 1.7) > v.thresh) {
          world.raw(x, y, z, v.id);
        }
      }
    }
  }

  // ── caves ────────────────────────────────────────────────────────────────
  for (let x = -EXT; x <= EXT; x++) for (let z = -EXT; z <= EXT; z++) {
    const h = H.get(ck(x, z)) | 0;
    for (let y = 2; y < h - 2; y++) {
      const id = world.get(x, y, z);
      if (id !== B.STONE && id !== B.COAL_ORE && id !== B.IRON_ORE && id !== B.GOLD_ORE && id !== B.DIAMOND_ORE && id !== B.GRAVEL && id !== B.SANDSTONE) continue;
      const c1 = N.noise3(x * 0.062 + 3.3, y * 0.088 - 7.1, z * 0.062 + 5.9);
      const c2 = N.noise3(x * 0.035 - 9.2, y * 0.047 + 2.4, z * 0.035 + 1.6);
      if (c1 * 0.62 + c2 * 0.38 > 0.44) {
        world.raw(x, y, z, B.AIR);
        // lava lakes + glowstone in the deep
        if (y <= 5) {
          if (world.get(x, y - 1, z) === B.AIR && rnd() < 0.5) world.raw(x, y - 1, z, B.LAVA);
        } else if (rnd() < 0.006 && world.get(x, y + 1, z) !== B.AIR) {
          world.raw(x, y, z, B.GLOWSTONE);
        }
      }
    }
  }

  // hillside candidates for the mine entrance: a spot where the ground rises
  // steeply, so we can tunnel straight into the mountain.
  const hillsides = [];
  for (let tries = 0; tries < 900 && hillsides.length < 8; tries++) {
    const a = rnd() * Math.PI * 2, rr = SIZE * (0.22 + rnd() * 0.6);
    const x = Math.round(Math.cos(a) * rr), z = Math.round(Math.sin(a) * rr);
    const h = H.get(ck(x, z));
    if (h === undefined || h < SEA + 7) continue;
    // direction of steepest ascent
    let dir = null, bestGain = 0;
    for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const h2 = H.get(ck(x + d[0] * 3, z + d[1] * 3));
      if (h2 === undefined) continue;
      const gain = h2 - h;
      if (gain > bestGain) { bestGain = gain; dir = d; }
    }
    if (dir && bestGain >= 5) hillsides.push({ x, z, y: h, dir, gain: bestGain });
  }

  // ── exposed stone weathers to cobble/mossy ───────────────────────────────
  for (let x = -EXT; x <= EXT; x++) for (let z = -EXT; z <= EXT; z++) {
    const h = H.get(ck(x, z)) | 0;
    if (h > 1 && world.get(x, h - 1, z) === B.STONE) {
      const t = rnd();
      world.raw(x, h - 1, z, t < 0.45 ? B.COBBLE : t < 0.62 ? B.MOSSY : B.STONE, BIO.get(ck(x, z)));
    }
  }

  const api = {
    world, N, rnd, seed, H, BIO, reserved, hillsides, pond, mntCenter, SEA,
    height(x, z) { return H.get(ck(Math.round(x), Math.round(z))); },
    biome(x, z) { return BIO.get(ck(Math.round(x), Math.round(z))) ?? BIO_PLAINS; },
    surface(x, z) {
      const ix = Math.round(x), iz = Math.round(z);
      const h = H.get(ck(ix, iz));
      if (h === undefined) return SEA;
      for (let y = Math.min(100, h + 30); y >= 0; y--) {
        const id = world.get(ix, y, iz);
        if (id && PALETTE[id].solid) return y + 1;
      }
      return h;
    },
    reserve(x0, z0, x1, z1, pad = 2) { reserved.push({ x0: x0 - pad, z0: z0 - pad, x1: x1 + pad, z1: z1 + pad }); },
    isReserved(x, z, pad = 1) {
      for (const r of reserved) if (x >= r.x0 - pad && x <= r.x1 + pad && z >= r.z0 - pad && z <= r.z1 + pad) return true;
      return false;
    },
    /** average + variance of the height over a disc — used to find build sites */
    flatness(x, z, r) {
      let sum = 0, n = 0, min = 999, max = -999;
      for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        if (dx * dx + dz * dz > r * r) continue;
        const h = H.get(ck(x + dx, z + dz));
        if (h === undefined) return { avg: 0, spread: 99 };
        sum += h; n++; if (h < min) min = h; if (h > max) max = h;
      }
      return { avg: sum / Math.max(1, n), spread: max - min };
    },
    /** level a disc/rect of terrain to `y`, keeping a dirt/stone base */
    flatten(o) {
      const { x0, z0, x1, z1, y, top = B.GRASS, bio = BIO_PLAINS } = o;
      for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
        const old = H.get(ck(x, z)) ?? y;
        const hi = Math.max(old, y);
        for (let yy = 1; yy <= hi; yy++) {
          if (yy <= y) {
            const id = yy === y ? top : (yy >= y - 2 ? B.DIRT : B.STONE);
            world.raw(x, yy, z, id, yy === y ? bio : -1);
          } else if (yy > y) {
            if (world.get(x, yy, z) !== B.AIR) world.raw(x, yy, z, B.AIR);
          }
        }
        H.set(ck(x, z), y);
        BIO.set(ck(x, z), bio);
      }
    },
  };
  world.setBounds((x, z) => Math.abs(x) <= EXT && Math.abs(z) <= EXT);
  return api;
}

/** soft edge blend so flattened plateaus meet the natural terrain */
export function smoothEdges(T, x0, z0, x1, z1, radius = 2) {
  const { world, H } = T;
  for (let pass = 0; pass < radius; pass++) {
    for (let x = x0 - radius; x <= x1 + radius; x++) {
      for (let z = z0 - radius; z <= z1 + radius; z++) {
        const inside = x >= x0 && x <= x1 && z >= z0 && z <= z1;
        const ring = inside ? 0 : Math.max(x0 - x, x - x1, z0 - z, z - z1);
        if (inside || ring > radius) continue;
        const h = H.get(x + ',' + z);
        if (h === undefined) continue;
        const nh = Math.max(T.surface(x, z) - 1, SEA);
        if (nh > h) {
          for (let y = h; y < nh; y++) world.raw(x, y, z, y === nh - 1 ? B.GRASS : B.DIRT);
          H.set(x + ',' + z, nh);
        }
      }
    }
  }
}
