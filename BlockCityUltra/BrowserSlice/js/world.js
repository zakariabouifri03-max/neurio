// BLOCK CITY ULTRA — browser slice: procedural city generation.
// Original code and original city. Deterministic: same seed → same city.

import * as THREE from './three.module.js';
import {
  VOXEL, CITY_BLOCKS, BLOCK_SIZE, ROAD_HALF, SIDEWALK, WORLD_SIZE,
  DISTRICTS, districtAt,
} from './config.js';
import { makeRng, hash3, fractalNoise2D, clamp } from './util.js';
import { buildMergedMesh } from './mesher.js';

// ── Voxel materials ────────────────────────────────────────────────────────
// Every entry is a real cubic surface with PBR-ish properties. The blocky look
// comes from the geometry, never from a pixelation filter.
export const MAT = {
  AIR: 0,
  ASPHALT: 1, ROAD_LINE: 2, CROSSWALK: 3, PAVING: 4, KERB: 5,
  CONCRETE: 6, BRICK: 7, SANDSTONE: 8, STEEL: 9, GLASS_DARK: 10,
  WIN_WARM: 11, WIN_COOL: 12, NEON_A: 13, NEON_B: 14, NEON_C: 15,
  GRASS: 16, DIRT: 17, TREE_TRUNK: 18, LEAVES: 19, WATER: 20, SAND: 21,
  MARBLE: 22, CORRUGATED: 23, PAINTED_RED: 24, LAMP: 25, ROOF: 26,
};

/** Base colour, roughness, metallic, emissive per material. */
export const MATERIAL_TABLE = {
  [MAT.ASPHALT]:     { c: 0x1c1e22, r: 0.92, m: 0.0, e: 0 },
  [MAT.ROAD_LINE]:   { c: 0xd8c85a, r: 0.70, m: 0.0, e: 0 },
  [MAT.CROSSWALK]:   { c: 0xd2d2ce, r: 0.72, m: 0.0, e: 0 },
  [MAT.PAVING]:      { c: 0x787a7e, r: 0.88, m: 0.0, e: 0 },
  [MAT.KERB]:        { c: 0x8e9094, r: 0.86, m: 0.0, e: 0 },
  [MAT.CONCRETE]:    { c: 0x9a9c9e, r: 0.86, m: 0.0, e: 0 },
  [MAT.BRICK]:       { c: 0x7a3a2e, r: 0.82, m: 0.0, e: 0 },
  [MAT.SANDSTONE]:   { c: 0xc2ab82, r: 0.80, m: 0.0, e: 0 },
  [MAT.STEEL]:       { c: 0x6f757c, r: 0.38, m: 0.92, e: 0 },
  [MAT.GLASS_DARK]:  { c: 0x24313c, r: 0.08, m: 0.35, e: 0 },
  [MAT.WIN_WARM]:    { c: 0xffd9a0, r: 0.20, m: 0.0, e: 1.9 },
  [MAT.WIN_COOL]:    { c: 0xa8d4ff, r: 0.20, m: 0.0, e: 1.3 },
  [MAT.NEON_A]:      { c: 0xff3f9c, r: 0.30, m: 0.0, e: 3.6 },
  [MAT.NEON_B]:      { c: 0x35e6ff, r: 0.30, m: 0.0, e: 3.6 },
  [MAT.NEON_C]:      { c: 0xffb02e, r: 0.30, m: 0.0, e: 3.2 },
  [MAT.GRASS]:       { c: 0x3f7a34, r: 0.92, m: 0.0, e: 0 },
  [MAT.DIRT]:        { c: 0x4a3a2a, r: 0.95, m: 0.0, e: 0 },
  [MAT.TREE_TRUNK]:  { c: 0x43301f, r: 0.92, m: 0.0, e: 0 },
  [MAT.LEAVES]:      { c: 0x2f6b2a, r: 0.88, m: 0.0, e: 0 },
  [MAT.WATER]:       { c: 0x123a52, r: 0.05, m: 0.0, e: 0 },
  [MAT.SAND]:        { c: 0xcbb892, r: 0.96, m: 0.0, e: 0 },
  [MAT.MARBLE]:      { c: 0xdedcd6, r: 0.22, m: 0.0, e: 0 },
  [MAT.CORRUGATED]:  { c: 0x7d8288, r: 0.55, m: 0.88, e: 0 },
  [MAT.PAINTED_RED]: { c: 0xa32420, r: 0.62, m: 0.0, e: 0 },
  [MAT.LAMP]:        { c: 0xfff4d6, r: 0.25, m: 0.0, e: 4.4 },
  [MAT.ROOF]:        { c: 0x35383c, r: 0.94, m: 0.0, e: 0 },
};

/**
 * The generated city.
 *
 * Geometry is stored as an axis-aligned box list per material rather than a
 * dense voxel array: a 1.4 km slice at 0.5 m voxels would be 2800³ cells, which
 * no browser can hold. Box merging gives identical visuals at ~1% the memory,
 * and buildMergedMesh() turns the boxes into one draw call per material.
 */
export class City {
  constructor(seed, onProgress) {
    this.seed = seed | 0;
    this.rng = makeRng(this.seed);
    this.onProgress = onProgress || (() => {});

    /** material id → array of {x,y,z,w,h,d} in metres, world space. */
    this.boxes = new Map();
    for (const key of Object.keys(MATERIAL_TABLE)) this.boxes.set(+key, []);

    this.roads = [];          // {x1,z1,x2,z2,halfWidth,vertical,highway}
    this.laneNodes = [];      // {x,z,dirX,dirZ,speedLimit} — traffic graph
    this.buildings = [];      // {x,z,w,d,h,district,style,seed}
    this.streetLights = [];   // {x,z} — lamp positions for night lighting
    this.pickups = [];        // {x,z,taken}
    this.spawnPoints = [];    // traffic spawn transforms
    this.pedPoints = [];      // sidewalk points for pedestrians
    this.districtCenters = DISTRICTS.map(() => ({ x: 0, z: 0, n: 0 }));
  }

  // ── Box helpers ──────────────────────────────────────────────────────────
  addBox(mat, x, y, z, w, h, d) {
    if (w <= 0 || h <= 0 || d <= 0) return;
    this.boxes.get(mat).push({ x, y, z, w, h, d });
  }

  /** Adds a box already expressed in voxel coordinates. */
  addVoxelBox(mat, vx, vy, vz, vw, vh, vd) {
    this.addBox(mat, vx * VOXEL, vy * VOXEL, vz * VOXEL, vw * VOXEL, vh * VOXEL, vd * VOXEL);
  }

  // ── Generation ───────────────────────────────────────────────────────────
  generate() {
    const t0 = performance.now();
    this.onProgress(0.05, 'road layout');
    this.#generateRoads();
    this.onProgress(0.20, 'ground and pavement');
    this.#generateGround();
    this.onProgress(0.35, 'building massing');
    this.#generateBuildings();
    this.onProgress(0.62, 'street furniture');
    this.#generateStreetFurniture();
    this.onProgress(0.74, 'vegetation and water');
    this.#generateNature();
    this.onProgress(0.82, 'pickups and spawn points');
    this.#generatePoints();

    this.generationMs = performance.now() - t0;
    return this;
  }

  /** Block coordinates → world metres. The city is centred on the origin. */
  blockOrigin(bx, by) {
    const off = (CITY_BLOCKS * BLOCK_SIZE * VOXEL) / 2;
    return { x: bx * BLOCK_SIZE * VOXEL - off, z: by * BLOCK_SIZE * VOXEL - off };
  }

  #generateRoads() {
    const n = CITY_BLOCKS;
    const pitch = BLOCK_SIZE;                       // voxels between road centres
    const halfWorld = (n * pitch * VOXEL) / 2;

    for (let i = 0; i <= n; i++) {
      const c = i * pitch * VOXEL - halfWorld;
      const highway = (i === 3 || i === 9);          // two arterials cross the slice

      // North–south
      this.roads.push({ x: c, z1: -halfWorld, z2: halfWorld, halfWidth: highway ? ROAD_HALF + 3 : ROAD_HALF, vertical: true, highway });
      // East–west
      this.roads.push({ x1: -halfWorld, x2: halfWorld, z: c, halfWidth: highway ? ROAD_HALF + 3 : ROAD_HALF, vertical: false, highway });

      // Lane nodes every 16 m along each road, both directions.
      const step = 16;
      for (let s = -halfWorld + step; s < halfWorld; s += step) {
        const limit = highway ? 110 : 50;
        if (!highway) {
          this.laneNodes.push({ x: c - 2.0, z: s, dirX: 0, dirZ: 1, speedLimit: limit });
          this.laneNodes.push({ x: c + 2.0, z: s, dirX: 0, dirZ: -1, speedLimit: limit });
          this.laneNodes.push({ x: s, z: c - 2.0, dirX: 1, dirZ: 0, speedLimit: limit });
          this.laneNodes.push({ x: s, z: c + 2.0, dirX: -1, dirZ: 0, speedLimit: limit });
        } else {
          this.laneNodes.push({ x: c - 3.2, z: s, dirX: 0, dirZ: 1, speedLimit: limit });
          this.laneNodes.push({ x: c + 3.2, z: s, dirX: 0, dirZ: -1, speedLimit: limit });
          this.laneNodes.push({ x: s, z: c - 3.2, dirX: 1, dirZ: 0, speedLimit: limit });
          this.laneNodes.push({ x: s, z: c + 3.2, dirX: -1, dirZ: 0, speedLimit: limit });
        }
      }
    }
  }

  #generateGround() {
    const half = WORLD_SIZE / 2;

    // Terrain slab: grass outside the built-up area, dirt under it.
    this.addBox(MAT.GRASS, -half, -0.6, -half, WORLD_SIZE, 0.6, WORLD_SIZE);

    // Roads on top of the terrain, at y = 0.
    for (const road of this.roads) {
      const hw = road.halfWidth * VOXEL;
      if (road.vertical) {
        const len = road.z2 - road.z1;
        this.addBox(MAT.ASPHALT, road.x - hw, 0, road.z1, hw * 2, 0.16, len);
        // Centre line, dashed.
        for (let s = road.z1 + 2; s < road.z2; s += 6) {
          this.addBox(MAT.ROAD_LINE, road.x - 0.16, 0.17, s, 0.32, 0.02, 3);
        }
        // Kerbs and sidewalks either side.
        const sw = SIDEWALK * VOXEL;
        this.addBox(MAT.PAVING, road.x - hw - sw, 0.06, road.z1, sw, 0.22, len);
        this.addBox(MAT.PAVING, road.x + hw, 0.06, road.z1, sw, 0.22, len);
        this.addBox(MAT.KERB, road.x - hw - 0.34, 0.16, road.z1, 0.34, 0.16, len);
        this.addBox(MAT.KERB, road.x + hw, 0.16, road.z1, 0.34, 0.16, len);
      } else {
        const len = road.x2 - road.x1;
        this.addBox(MAT.ASPHALT, road.x1, 0, road.z - hw, len, 0.16, hw * 2);
        for (let s = road.x1 + 2; s < road.x2; s += 6) {
          this.addBox(MAT.ROAD_LINE, s, 0.17, road.z - 0.16, 3, 0.02, 0.32);
        }
        const sw = SIDEWALK * VOXEL;
        this.addBox(MAT.PAVING, road.x1, 0.06, road.z - hw - sw, len, 0.22, sw);
        this.addBox(MAT.PAVING, road.x1, 0.06, road.z + hw, len, 0.22, sw);
        this.addBox(MAT.KERB, road.x1, 0.16, road.z - hw - 0.34, len, 0.16, 0.34);
        this.addBox(MAT.KERB, road.x1, 0.16, road.z + hw, len, 0.16, 0.34);
      }
    }

    // Crosswalks at every intersection.
    for (const a of this.roads) {
      if (!a.vertical) continue;
      for (const b of this.roads) {
        if (b.vertical) continue;
        const cx = a.x, cz = b.z;
        const hwA = a.halfWidth * VOXEL, hwB = b.halfWidth * VOXEL;
        for (let i = -3; i <= 3; i++) {
          this.addBox(MAT.CROSSWALK, cx + i * 0.9 - 0.32, 0.18, cz + hwB + 0.4, 0.64, 0.02, 2.2);
          this.addBox(MAT.CROSSWALK, cx + i * 0.9 - 0.32, 0.18, cz - hwB - 2.6, 0.64, 0.02, 2.2);
          this.addBox(MAT.CROSSWALK, cx + hwA + 0.4, 0.18, cz + i * 0.9 - 0.32, 2.2, 0.02, 0.64);
          this.addBox(MAT.CROSSWALK, cx - hwA - 2.6, 0.18, cz + i * 0.9 - 0.32, 2.2, 0.02, 0.64);
        }
      }
    }
  }

  #generateBuildings() {
    const n = CITY_BLOCKS;

    for (let by = 0; by < n; by++) {
      for (let bx = 0; bx < n; bx++) {
        const dIdx = districtAt(bx, by, n);
        const district = DISTRICTS[dIdx];
        const origin = this.blockOrigin(bx, by);

        // Track district centres for the map screen.
        const dc = this.districtCenters[dIdx];
        dc.x += origin.x; dc.z += origin.z; dc.n++;

        this.#generateBlock(bx, by, origin, district, dIdx);
      }
    }

    for (const dc of this.districtCenters) {
      if (dc.n > 0) { dc.x /= dc.n; dc.z /= dc.n; }
    }
  }

  /** One city block: subdivide into parcels, mass each parcel into a building. */
  #generateBlock(bx, by, origin, district, dIdx) {
    const rng = makeRng(hash3(bx, by, 0, this.seed));
    const blockSize = BLOCK_SIZE * VOXEL;

    // The carriageway + sidewalk occupy the block's edges; the interior is
    // buildable. Inset by road half-width + sidewalk + a margin.
    const inset = (ROAD_HALF + SIDEWALK + 1) * VOXEL;
    const buildable = blockSize - inset * 2;
    if (buildable < 6) return;

    // Parcel grid: downtown gets tight parcels (many towers), suburbs get wide.
    const parcelsAcross = clamp(Math.round(1 + district.verticality * 2.4), 1, 4);
    const parcelSize = buildable / parcelsAcross;

    for (let py = 0; py < parcelsAcross; py++) {
      for (let px = 0; px < parcelsAcross; px++) {
        const roll = rng();
        // Density culls parcels: parks and car lots are just as important as
        // buildings for making a city read as a city.
        if (roll > district.density) {
          if (rng() < district.nature * 1.4) this.#generatePark(origin.x + inset + px * parcelSize, origin.z + inset + py * parcelSize, parcelSize, rng);
          continue;
        }

        const jitter = 0.72 + rng() * 0.24;
        const w = parcelSize * jitter;
        const d = parcelSize * (0.72 + rng() * 0.24);
        const cx = origin.x + inset + px * parcelSize + (parcelSize - w) / 2;
        const cz = origin.z + inset + py * parcelSize + (parcelSize - d) / 2;

        // Height field. Downtown peaks in the middle of the core so the skyline
        // has a readable silhouette rather than uniform noise, and the "tower"
        // branch is gated on a noise peak so only some parcels get tall — that
        // contrast between a 140 m tower and a 12 m walk-up next to it is what
        // makes a generated city look planned instead of random.
        const coreDistance = clamp(Math.hypot(bx - CITY_BLOCKS / 2, by - CITY_BLOCKS / 2) / (CITY_BLOCKS / 2), 0, 1);
        // Sampled in *blocks*, not metres: a city-scale frequency so the tower
        // peaks form clusters (a financial core) rather than confetti.
        const noise = fractalNoise2D(bx * 0.55, by * 0.55, this.seed + 17, 4);
        const peakBias = clamp(1 - coreDistance * 1.05, 0, 1);

        // Tower threshold falls with verticality, so downtown gets many towers
        // and the suburbs get none.
        const towerThreshold = 0.72 - district.verticality * 0.42;
        const isTower = district.verticality > 0.30 && noise > towerThreshold;

        let h;
        if (isTower) {
          // 38 m up to ~150 m, scaled by proximity to the core and by the noise
          // peak. The extra rng() breaks the grid so no two towers match.
          h = 34 + peakBias * 96 * (0.45 + noise * 0.75) + rng() * 26;
          if (district.verticality > 0.9 && peakBias > 0.55 && rng() < 0.18) {
            h += 30 + rng() * 28;   // the landmark spires at the very centre
          }
        } else {
          h = 5 + district.verticality * 30 * (0.35 + noise * 1.1) + rng() * 5;
        }
        h = clamp(h, 4, 178);

        const style = this.#pickStyle(district, h, rng);
        const spec = { x: cx, z: cz, w, d, h, district: dIdx, style, seed: hash3(bx * 31 + px, by * 17 + py, 0, this.seed) };
        this.buildings.push(spec);
        this.#carveBuilding(spec, rng);
      }
    }
  }

  #pickStyle(district, h, rng) {
    if (h > 60) return rng() < 0.4 ? 'glass' : (rng() < 0.6 ? 'deco' : 'tower');
    if (district.id === 'ironside') return rng() < 0.7 ? 'warehouse' : 'factory';
    if (district.id === 'rowan' || district.id === 'calder') return rng() < 0.6 ? 'house' : 'walkup';
    if (district.id === 'marbella') return rng() < 0.5 ? 'boutique' : 'midrise';
    if (district.id === 'neon') return rng() < 0.45 ? 'venue' : 'midrise';
    return rng() < 0.5 ? 'midrise' : 'walkup';
  }

  /** Carves one building: shell, facade material, windows, roof detail, signage. */
  #carveBuilding(b, rng) {
    const facade = {
      glass: MAT.STEEL, deco: MAT.SANDSTONE, tower: MAT.CONCRETE,
      warehouse: MAT.CORRUGATED, factory: MAT.CORRUGATED, house: MAT.BRICK,
      walkup: MAT.BRICK, boutique: MAT.MARBLE, midrise: MAT.CONCRETE,
      venue: MAT.CONCRETE,
    }[b.style] ?? MAT.CONCRETE;

    const ground = (b.style === 'boutique' || b.style === 'glass') ? MAT.MARBLE : facade;

    // Facade ageing: one of six tints per building so a street never looks
    // stamped from a single colour.
    const ageIndex = b.seed % 6;
    const ageFactor = [1.0, 0.96, 0.91, 0.85, 0.78, 0.70][ageIndex];

    // Ground floor (double height, different material).
    const groundH = Math.min(6.0, b.h * 0.22);
    this.addBox(ground, b.x, 0.28, b.z, b.w, groundH, b.d, ageFactor);

    // Main mass.
    const bodyH = b.h - groundH;
    if (bodyH > 0.2) {
      this.addBox(facade, b.x, groundH + 0.28, b.z, b.w, bodyH, b.d, ageFactor);
    }

    // Setback tiers for skyscrapers — the stepped zoning silhouette.
    let tiers = b.h > 55 ? clamp(Math.floor(b.h / 34), 1, 4) : 0;
    if (tiers > 0) {
      let tw = b.w, td = b.d, tz = groundH + bodyH * 0.62 + 0.28;
      for (let t = 0; t < tiers; t++) {
        tw *= 0.82; td *= 0.82;
        const th = Math.min(bodyH * 0.2, 14 + rng() * 10);
        this.addBox(facade, b.x + (b.w - tw) / 2, tz, b.z + (b.d - td) / 2, tw, th, td, ageFactor);
        tz += th;
      }
    }

    // Parapet.
    const topY = 0.28 + b.h;
    this.addBox(MAT.ROOF, b.x, topY, b.z, b.w, 0.5, b.d);
    this.addBox(facade, b.x, topY + 0.5, b.z, b.w, 0.8, 0.4, ageFactor);
    this.addBox(facade, b.x, topY + 0.5, b.z + b.d - 0.4, b.w, 0.8, 0.4, ageFactor);
    this.addBox(facade, b.x, topY + 0.5, b.z, 0.4, 0.8, b.d, ageFactor);
    this.addBox(facade, b.x + b.w - 0.4, topY + 0.5, b.z, 0.4, 0.8, b.d, ageFactor);

    // Roof furniture: HVAC blocks, water tank, antenna, helipad.
    const hvacCount = clamp(Math.floor((b.w * b.d) / 120), 0, 6);
    for (let i = 0; i < hvacCount; i++) {
      const hx = b.x + 1.5 + ((hash3(i, b.seed, 3, this.seed) % 1000) / 1000) * Math.max(1, b.w - 4);
      const hz = b.z + 1.5 + ((hash3(i, b.seed, 7, this.seed) % 1000) / 1000) * Math.max(1, b.d - 4);
      this.addBox(MAT.STEEL, hx, topY + 1.3, hz, 2.4, 1.6, 2.4);
    }

    if (b.h > 46 && b.seed % 4 === 0) {
      // Water tank on four legs.
      const tx = b.x + b.w / 2 - 1.8, tz = b.z + b.d / 2 - 1.8;
      this.addBox(MAT.TREE_TRUNK, tx, topY + 3.0, tz, 3.6, 4.2, 3.6);
      for (const [lx, lz] of [[0, 0], [3.0, 0], [0, 3.0], [3.0, 3.0]]) {
        this.addBox(MAT.STEEL, tx + lx, topY + 1.3, tz + lz, 0.5, 3.0, 0.5);
      }
    }

    if (b.h > 80 && b.seed % 5 === 0) {
      // Antenna with an aviation warning beacon.
      const ax = b.x + b.w / 2 - 0.2, az = b.z + b.d / 2 - 0.2;
      this.addBox(MAT.STEEL, ax, topY + 1.3, az, 0.4, 18, 0.4);
      this.addBox(MAT.NEON_A, ax - 0.2, topY + 19.3, az - 0.2, 0.8, 0.8, 0.8);
    }

    if (b.h > 62 && b.seed % 11 === 0) {
      // Helipad: painted H.
      const px = b.x + b.w / 2, pz = b.z + b.d / 2;
      this.addBox(MAT.NEON_C, px - 4, topY + 0.52, pz - 4, 8, 0.06, 8);
      this.addBox(MAT.CROSSWALK, px - 2.2, topY + 0.6, pz - 3, 0.8, 0.05, 6);
      this.addBox(MAT.CROSSWALK, px + 1.4, topY + 0.6, pz - 3, 0.8, 0.05, 6);
      this.addBox(MAT.CROSSWALK, px - 2.2, topY + 0.6, pz - 0.4, 4.4, 0.05, 0.8);
    }

    // Windows. Lit fraction is decided once here so the night skyline is stable.
    this.#carveWindows(b, facade, groundH, rng);

    // Neon signage on retail and entertainment buildings.
    if (b.style === 'boutique' || b.style === 'venue' || (b.district === 2 && b.h < 40 && rng() < 0.55)) {
      this.#carveSignage(b, rng);
    }

    // Entrance.
    const doorW = clamp(b.w * 0.22, 1.6, 4.2);
    this.addBox(MAT.GLASS_DARK, b.x + b.w / 2 - doorW / 2, 0.3, b.z - 0.06, doorW, Math.min(3.4, groundH * 0.8), 0.12);
  }

  #carveWindows(b, facade, groundH, rng) {
    const floorHeight = b.style === 'warehouse' || b.style === 'factory' ? 6.0 : 3.6;
    const winW = b.style === 'glass' ? 1.8 : 1.4;
    const winH = b.style === 'glass' ? 2.4 : 1.7;
    const gapX = b.style === 'glass' ? 0.6 : 1.5;
    const litFraction = b.style === 'warehouse' ? 0.16
      : b.style === 'boutique' ? 0.80
      : b.style === 'venue' ? 0.42
      : b.style === 'house' ? 0.70
      : 0.46;

    const startY = groundH + 1.4;
    const floors = Math.max(0, Math.floor((b.h - groundH - 1.2) / floorHeight));
    if (floors <= 0) return;

    const stepX = winW + gapX;
    const colsW = Math.max(1, Math.floor((b.w - 1.2) / stepX));
    const colsD = Math.max(1, Math.floor((b.d - 1.2) / stepX));

    // Merge all windows of one material into a single box per face run, which is
    // what keeps a 4000-window tower at a handful of draw calls.
    for (let f = 0; f < floors; f++) {
      const y = startY + f * floorHeight;
      if (y + winH > b.h + 0.28) break;

      for (let c = 0; c < colsW; c++) {
        const wx = b.x + 0.6 + c * stepX;
        const litFront = this.#windowLit(wx, b.z, y, b.seed, litFraction, rng);
        const litBack = this.#windowLit(wx, b.z + b.d, y, b.seed, litFraction, rng);
        this.addBox(litFront, wx, y, b.z - 0.05, winW, winH, 0.10);
        this.addBox(litBack, wx, y, b.z + b.d - 0.05, winW, winH, 0.10);
      }

      for (let c = 0; c < colsD; c++) {
        const wz = b.z + 0.6 + c * stepX;
        const litLeft = this.#windowLit(b.x, wz, y, b.seed, litFraction, rng);
        const litRight = this.#windowLit(b.x + b.w, wz, y, b.seed, litFraction, rng);
        this.addBox(litLeft, b.x - 0.05, y, wz, 0.10, winH, winW);
        this.addBox(litRight, b.x + b.w - 0.05, y, wz, 0.10, winH, winW);
      }
    }
  }

  /** Which window material: unlit glass, warm interior light, or cool. */
  #windowLit(x, z, y, seed, litFraction, rng) {
    const h = hash3(Math.round(x * 2), Math.round(z * 2), Math.round(y * 2), seed) % 1000 / 1000;
    if (h > litFraction) return MAT.GLASS_DARK;
    return (h * 6 | 0) % 3 === 0 ? MAT.WIN_COOL : MAT.WIN_WARM;
  }

  #carveSignage(b, rng) {
    const neonMats = [MAT.NEON_A, MAT.NEON_B, MAT.NEON_C];

    // Vertical blade sign on the street corner.
    const bladeMat = neonMats[b.seed % 3];
    const bladeH = clamp(4 + (b.seed % 8), 4, 13);
    const bladeY = 6 + (b.seed % 9);
    const bladeX = (b.seed % 2 === 0) ? b.x - 0.6 : b.x + b.w - 0.2;
    this.addBox(bladeMat, bladeX, bladeY, b.z + 0.8, 0.5, bladeH, 1.2);
    this.addBox(MAT.STEEL, bladeX + (bladeX < b.x ? 0.5 : -0.6), bladeY, b.z + 1.2, 0.6, bladeH, 0.3);

    // Horizontal fascia above the ground floor, with gaps so it reads as lettering.
    const fasciaMat = neonMats[(b.seed + 1) % 3];
    const fasciaY = 5.4;
    let x = b.x + 0.8;
    let toggle = 0;
    while (x < b.x + b.w - 1.0) {
      const segLen = 0.9 + (hash3(Math.round(x), b.seed, 2, this.seed) % 100) / 100 * 1.4;
      if (toggle % 3 !== 0) {
        this.addBox(fasciaMat, x, fasciaY, b.z - 0.12, segLen, 0.9, 0.18);
      }
      x += segLen + 0.3;
      toggle++;
    }
  }

  #generatePark(x, z, size, rng) {
    this.addBox(MAT.GRASS, x, 0.28, z, size * 0.92, 0.14, size * 0.92);

    // Path through the middle.
    this.addBox(MAT.PAVING, x + size * 0.42, 0.34, z, size * 0.1, 0.08, size * 0.92);

    // Trees.
    const treeCount = clamp(Math.floor(size / 5), 1, 9);
    for (let i = 0; i < treeCount; i++) {
      const tx = x + 1.5 + rng() * (size - 3);
      const tz = z + 1.5 + rng() * (size - 3);
      this.#carveTree(tx, tz, 2.4 + rng() * 3.2, rng);
    }

    // Flower beds and benches.
    this.addBox(MAT.NEON_A, x + size * 0.12, 0.44, z + size * 0.2, size * 0.16, 0.3, size * 0.16);
    this.addBox(MAT.TREE_TRUNK, x + size * 0.7, 0.42, z + size * 0.62, 2.2, 0.5, 0.7);
  }

  #carveTree(x, z, canopyRadius, rng) {
    const trunkH = canopyRadius * 1.5;
    this.addBox(MAT.TREE_TRUNK, x - 0.25, 0.4, z - 0.25, 0.5, trunkH, 0.5);

    // Blocky canopy: stacked cubes with the extreme corners dropped, so it reads
    // as a tree at distance while staying unmistakably voxel.
    const cy = 0.4 + trunkH;
    const layers = 3;
    for (let l = 0; l < layers; l++) {
      const r = canopyRadius * (1 - l * 0.26);
      const y = cy + l * (canopyRadius * 0.55);
      const h = canopyRadius * 0.7;
      this.addBox(MAT.LEAVES, x - r, y, z - r, r * 2, h, r * 2);
      if (l < layers - 1) {
        const r2 = r * 0.68;
        this.addBox(MAT.LEAVES, x - r2, y + h, z - r2, r2 * 2, h * 0.6, r2 * 2);
      }
    }
  }

  #generateStreetFurniture() {
    const rng = makeRng(this.seed ^ 0x5f3a);

    for (const road of this.roads) {
      if (road.highway) continue;

      const hw = road.halfWidth * VOXEL;
      const sw = SIDEWALK * VOXEL;

      if (road.vertical) {
        for (let z = road.z1 + 18; z < road.z2; z += 26) {
          for (const side of [-1, 1]) {
            const lx = road.x + side * (hw + sw + 0.6);
            this.#carveStreetLight(lx, z, side);
            if (rng() < 0.34) this.#carveBin(lx + side * 1.2, z + 7);
            if (rng() < 0.22) this.#carveBench(lx + side * 1.0, z + 14, true);
            this.streetLights.push({ x: lx, z });
          }
        }
      } else {
        for (let x = road.x1 + 18; x < road.x2; x += 26) {
          for (const side of [-1, 1]) {
            const lz = road.z + side * (hw + sw + 0.6);
            this.#carveStreetLight(x, lz, side);
            if (rng() < 0.34) this.#carveBin(x + 7, lz + side * 1.2);
            if (rng() < 0.22) this.#carveBench(x + 14, lz + side * 1.0, false);
            this.streetLights.push({ x, z: lz });
          }
        }
      }
    }
  }

  #carveStreetLight(x, z, side) {
    // Pole, arm over the carriageway, and an emissive luminaire voxel. The light
    // itself is a single shared point light in the renderer, never one per lamp.
    this.addBox(MAT.STEEL, x - 0.16, 0.3, z - 0.16, 0.32, 7.4, 0.32);
    this.addBox(MAT.STEEL, x - (side > 0 ? 1.6 : 0), 7.5, z - 0.14, 1.6, 0.28, 0.28);
    this.addBox(MAT.LAMP, x - (side > 0 ? 1.5 : -0.1), 7.2, z - 0.3, 0.6, 0.34, 0.6);
  }

  #carveBin(x, z) {
    this.addBox(MAT.STEEL, x - 0.4, 0.34, z - 0.4, 0.8, 1.1, 0.8);
    this.addBox(MAT.CORRUGATED, x - 0.46, 1.4, z - 0.46, 0.92, 0.14, 0.92);
  }

  #carveBench(x, z, alongZ) {
    if (alongZ) {
      this.addBox(MAT.TREE_TRUNK, x - 0.35, 0.5, z - 1.1, 0.7, 0.14, 2.2);
      this.addBox(MAT.STEEL, x - 0.2, 0.3, z - 0.9, 0.4, 0.5, 0.2);
      this.addBox(MAT.STEEL, x - 0.2, 0.3, z + 0.7, 0.4, 0.5, 0.2);
    } else {
      this.addBox(MAT.TREE_TRUNK, x - 1.1, 0.5, z - 0.35, 2.2, 0.14, 0.7);
      this.addBox(MAT.STEEL, x - 0.9, 0.3, z - 0.2, 0.2, 0.5, 0.4);
      this.addBox(MAT.STEEL, x + 0.7, 0.3, z - 0.2, 0.2, 0.5, 0.4);
    }
  }

  #generateNature() {
    const rng = makeRng(this.seed ^ 0x2b17);

    // Riverside: the Ashfall runs along the slice's south-east edge.
    const half = WORLD_SIZE / 2;
    const riverWidth = 34;
    for (let s = -half; s < half; s += 4) {
      const meander = (fractalNoise2D(s * 0.004, 3.0, this.seed + 555, 3) - 0.5) * 46;
      const cx = half - 44 + meander;
      this.addBox(MAT.WATER, cx - riverWidth / 2, -0.34, s, riverWidth, 0.5, 4.2);
      this.addBox(MAT.SAND, cx - riverWidth / 2 - 3, 0.02, s, 3, 0.24, 4.2);
      this.addBox(MAT.SAND, cx + riverWidth / 2, 0.02, s, 3, 0.24, 4.2);
    }

    // Roadside trees along the quieter blocks.
    for (const road of this.roads) {
      if (road.highway) continue;
      const hw = road.halfWidth * VOXEL, sw = SIDEWALK * VOXEL;

      if (road.vertical) {
        for (let z = road.z1 + 30; z < road.z2; z += 22) {
          if (rng() > 0.42) continue;
          const side = rng() < 0.5 ? -1 : 1;
          this.#carveTree(road.x + side * (hw + sw + 2.4), z, 1.8 + rng() * 1.6, rng);
        }
      } else {
        for (let x = road.x1 + 30; x < road.x2; x += 22) {
          if (rng() > 0.42) continue;
          const side = rng() < 0.5 ? -1 : 1;
          this.#carveTree(x, road.z + side * (hw + sw + 2.4), 1.8 + rng() * 1.6, rng);
        }
      }
    }
  }

  #generatePoints() {
    const rng = makeRng(this.seed ^ 0x77b1);
    const half = WORLD_SIZE / 2;

    // Traffic spawns on lane nodes, pedestrians on sidewalks, pickups at random
    // street corners.
    for (let i = 0; i < this.laneNodes.length; i += 7) {
      const node = this.laneNodes[i];
      this.spawnPoints.push({ x: node.x, z: node.z, yaw: Math.atan2(node.dirX, node.dirZ), speedLimit: node.speedLimit });
    }

    for (const road of this.roads) {
      if (road.highway) continue;
      const hw = road.halfWidth * VOXEL, sw = SIDEWALK * VOXEL;
      if (road.vertical) {
        for (let z = road.z1 + 12; z < road.z2; z += 14) {
          this.pedPoints.push({ x: road.x + hw + sw * 0.5, z });
          this.pedPoints.push({ x: road.x - hw - sw * 0.5, z });
        }
      } else {
        for (let x = road.x1 + 12; x < road.x2; x += 14) {
          this.pedPoints.push({ x, z: road.z + hw + sw * 0.5 });
          this.pedPoints.push({ x, z: road.z - hw - sw * 0.5 });
        }
      }
    }

    // Mission pickup crates (the slice's delivery mission).
    for (let i = 0; i < 24; i++) {
      const p = this.pedPoints[(rng() * this.pedPoints.length) | 0];
      if (p) this.pickups.push({ x: p.x, z: p.z, taken: false });
    }

    // Player start: a sidewalk near the centre, facing down a street.
    const start = this.pedPoints.reduce((best, p) => {
      const d = Math.hypot(p.x, p.z);
      return (!best || d < best.d) ? { x: p.x, z: p.z, d } : best;
    }, null) || { x: 0, z: 0 };
    this.playerStart = { x: start.x, z: start.z + 2.0 };

    // Police patrol points: on the arterials.
    this.policePoints = this.laneNodes
      .filter(n => n.speedLimit >= 110)
      .map(n => ({ x: n.x, z: n.z }));
  }

  // ── Queries ──────────────────────────────────────────────────────────────
  /** District index at a world position. */
  districtIndexAt(x, z) {
    const half = WORLD_SIZE / 2;
    const bx = clamp(Math.floor((x + half) / (BLOCK_SIZE * VOXEL)), 0, CITY_BLOCKS - 1);
    const by = clamp(Math.floor((z + half) / (BLOCK_SIZE * VOXEL)), 0, CITY_BLOCKS - 1);
    return districtAt(bx, by, CITY_BLOCKS);
  }

  /** True when (x,z) is inside the footprint of any building. */
  isInsideBuilding(x, z, margin = 0.34) {
    for (const b of this.buildings) {
      if (x > b.x - margin && x < b.x + b.w + margin &&
          z > b.z - margin && z < b.z + b.d + margin) return true;
    }
    return false;
  }

  /** Height of the tallest thing at (x,z) — buildings, furniture, terrain. */
  groundHeightAt(x, z) {
    for (const b of this.buildings) {
      if (x > b.x && x < b.x + b.w && z > b.z && z < b.z + b.d) return b.h + 0.28;
    }
    return 0.3;
  }

  /**
   * Line-of-sight test against the building footprints. Used by the police
   * system: a unit only "sees" the player when no building is in the way, which
   * is what makes breaking line of sight around a tower actually work.
   *
   * Segment-vs-AABB in XZ using the slab method. Returns true when blocked.
   */
  isSegmentBlocked(x1, z1, x2, z2) {
    if (!this.colliders) this.buildCollision();

    const dx = x2 - x1, dz = z2 - z1;

    for (const c of this.colliders) {
      // Slab test. A zero direction component means "parallel to this slab".
      let tMin = 0, tMax = 1;

      for (const [p0, p1, d, lo, hi] of [[x1, x2, dx, c.minX, c.maxX], [z1, z2, dz, c.minZ, c.maxZ]]) {
        if (Math.abs(d) < 1e-9) {
          if (p0 < lo || p0 > hi) { tMin = 2; tMax = -1; break; }
          continue;
        }
        let t0 = (lo - p0) / d, t1 = (hi - p0) / d;
        if (t0 > t1) { const tmp = t0; t0 = t1; t1 = tmp; }
        tMin = Math.max(tMin, t0);
        tMax = Math.min(tMax, t1);
        if (tMin > tMax) break;
      }

      // A hit strictly between the endpoints blocks the view. Ignore hits at
      // t≈0 (the unit is standing next to the wall) and t≈1 (the player is).
      if (tMin <= tMax && tMin > 0.02 && tMax < 0.98) return true;
    }

    return false;
  }

  /** Axis-aligned boxes for collision, in metres. Built once, queried a lot. */
  buildCollision() {
    this.colliders = this.buildings.map(b => ({
      minX: b.x, maxX: b.x + b.w, minZ: b.z, maxZ: b.z + b.d, height: b.h + 0.28,
    }));
    return this.colliders;
  }

  /** Resolves a move against the building colliders (slide along walls). */
  resolveCollision(pos, radius) {
    if (!this.colliders) this.buildCollision();

    for (const c of this.colliders) {
      if (pos.y > c.height) continue; // on a roof, no wall collision

      const nearX = clamp(pos.x, c.minX, c.maxX);
      const nearZ = clamp(pos.z, c.minZ, c.maxZ);
      const dx = pos.x - nearX, dz = pos.z - nearZ;
      const d2 = dx * dx + dz * dz;

      if (d2 < radius * radius) {
        if (d2 < 1e-8) {
          // Deep inside: push out along the shortest axis.
          const pushX = Math.min(pos.x - c.minX, c.maxX - pos.x);
          const pushZ = Math.min(pos.z - c.minZ, c.maxZ - pos.z);
          if (pushX < pushZ) pos.x += (pos.x < (c.minX + c.maxX) / 2 ? -1 : 1) * (pushX + radius);
          else pos.z += (pos.z < (c.minZ + c.maxZ) / 2 ? -1 : 1) * (pushZ + radius);
        } else {
          const d = Math.sqrt(d2);
          const push = (radius - d) / d;
          pos.x += dx * push;
          pos.z += dz * push;
        }
      }
    }

    return pos;
  }

  /** Builds the renderable meshes, one draw call per material. */
  buildMeshes() {
    this.onProgress(0.9, 'merging geometry');
    const result = buildMergedMesh(this.boxes, MATERIAL_TABLE);
    this.onProgress(1.0, 'done');
    return result;
  }

  get boxCount() {
    let n = 0;
    for (const list of this.boxes.values()) n += list.length;
    return n;
  }
}

