// neurio Craft — voxel world: chunk storage + procedural terrain generation.
// Pure data, no three.js — generation is fully determined by the seed.
import { Noise } from './noise.js';
import { B } from './blocks.js';

export const CHUNK = 16;      // chunk footprint (x,z)
export const HEIGHT = 64;     // world height (y)
export const SEA = 23;        // sea level

const idx = (lx, y, lz) => y * 256 + lz * 16 + lx;
export const chunkKey = (cx, cz) => `${cx},${cz}`;

export class World {
  constructor(seed, edits = new Map()) {
    this.seed = String(seed);
    this.noise = new Noise(this.seed);
    this.chunks = new Map();   // key → Uint8Array(CHUNK*HEIGHT*CHUNK)
    this.edits = edits;        // "x,y,z" → block id (player changes, persisted)
  }

  // ── heightmap / biome ──────────────────────────────────────────────────────
  // Rolling plains + occasional mountain ridges, carved by lakes/seas.
  terrainHeight(x, z) {
    const n = this.noise;
    const continent = n.fbm2(x * 0.006, z * 0.006, 4);        // big landmasses
    const hills = n.fbm2(x * 0.035 + 100, z * 0.035 + 100, 3);
    const ridge = 1 - Math.abs(2 * n.fbm2(x * 0.011 + 500, z * 0.011 + 500, 3) - 1); // 0..1 peaky
    const mountains = Math.pow(Math.max(0, ridge - 0.62) / 0.38, 2) * 26;
    let h = 6 + continent * 22 + hills * 7 + mountains;
    return Math.max(3, Math.min(HEIGHT - 8, Math.floor(h)));
  }

  temperature(x, z) { // 0 cold … 1 hot (desert)
    return this.noise.fbm2(x * 0.004 + 900, z * 0.004 + 900, 2);
  }

  generateChunk(cx, cz) {
    const data = new Uint8Array(CHUNK * HEIGHT * CHUNK);
    const n = this.noise;
    const heights = new Int16Array(256), temps = new Float32Array(256);

    for (let lz = 0; lz < CHUNK; lz++) for (let lx = 0; lx < CHUNK; lx++) {
      const x = cx * CHUNK + lx, z = cz * CHUNK + lz;
      const h = this.terrainHeight(x, z);
      const temp = this.temperature(x, z);
      heights[lz * 16 + lx] = h; temps[lz * 16 + lx] = temp;
      const desert = temp > 0.62;
      const snowy = h > 40 || temp < 0.3;
      const beach = h <= SEA + 1;

      for (let y = 0; y <= h; y++) {
        let id;
        if (y === 0 || (y === 1 && n.rand2(x * 3 + y, z, 9) < 0.5)) id = B.BEDROCK;
        else if (y < h - 3) {
          id = B.STONE;
          // caves: 3D noise tunnels below the surface crust
          if (y > 2 && y < h - 4 && n.fbm3(x * 0.055, y * 0.085, z * 0.055, 2) > 0.74) continue; // air
          const r = n.hash3(x, y, z); // ores sprinkled in the stone
          if (y < 14 && r < 0.0022) id = B.DIAMOND_ORE;
          else if (y < 22 && r < 0.006) id = B.GOLD_ORE;
          else if (r < 0.02) id = B.COAL_ORE;
          else if (r > 0.985) id = B.GRAVEL;
        }
        else if (y < h) id = desert || beach ? B.SAND : B.DIRT;
        else { // surface block
          if (h < SEA) id = n.rand2(x, z, 4) < 0.3 ? B.GRAVEL : B.SAND;      // lakebed
          else if (desert || beach) id = B.SAND;
          else if (snowy) id = B.SNOW;
          else id = B.GRASS;
        }
        data[idx(lx, y, lz)] = id;
      }
      for (let y = h + 1; y <= SEA; y++) data[idx(lx, y, lz)] = B.WATER;
    }

    // ── decoration pass (2-block margin keeps trees inside the chunk) ──────
    const getLocal = (lx, y, lz) => (lx < 0 || lz < 0 || lx > 15 || lz > 15 || y < 0 || y >= HEIGHT) ? 0 : data[idx(lx, y, lz)];
    const setLocal = (lx, y, lz, id) => { if (lx >= 0 && lz >= 0 && lx < 16 && lz < 16 && y >= 0 && y < HEIGHT) data[idx(lx, y, lz)] = id; };

    for (let lz = 2; lz < 14; lz++) for (let lx = 2; lx < 14; lx++) {
      const x = cx * CHUNK + lx, z = cz * CHUNK + lz;
      const h = heights[lz * 16 + lx], temp = temps[lz * 16 + lx];
      if (h <= SEA + 1 || h >= HEIGHT - 12) continue;
      const ground = getLocal(lx, h, lz);
      const r = n.rand2(x, z, 77);

      if (ground === B.GRASS && r < 0.009) {
        // ── tree ── birch in cold areas, oak elsewhere
        const trunkH = 4 + Math.floor(n.rand2(x, z, 78) * 3);
        const log = temp < 0.36 ? B.BIRCH : B.LOG;
        for (let dy = -2; dy <= 1; dy++) {
          const y = h + trunkH + dy, rad = dy <= -1 ? 2 : 1;
          for (let dx = -rad; dx <= rad; dx++) for (let dz = -rad; dz <= rad; dz++) {
            if (Math.abs(dx) === rad && Math.abs(dz) === rad && n.rand2(x + dx * 7, z + dz * 7 + dy, 79) < 0.6) continue; // ragged corners
            if (getLocal(lx + dx, y, lz + dz) === 0) setLocal(lx + dx, y, lz + dz, B.LEAVES);
          }
        }
        setLocal(lx, h + trunkH + 2, lz, B.LEAVES);
        for (let y = 1; y <= trunkH; y++) setLocal(lx, h + y, lz, log);
      } else if (ground === B.SAND && temp > 0.62 && r < 0.012) {
        const ch = 2 + Math.floor(n.rand2(x, z, 80) * 2); // cactus
        for (let y = 1; y <= ch; y++) setLocal(lx, h + y, lz, B.CACTUS);
      } else if (ground === B.GRASS) {
        if (r < 0.07) setLocal(lx, h + 1, lz, B.TALLGRASS);
        else if (r < 0.082) setLocal(lx, h + 1, lz, B.ROSE);
        else if (r > 0.998) setLocal(lx, h + 1, lz, B.PUMPKIN);
      }
    }

    // ── replay player edits that fall inside this chunk ────────────────────
    if (this.edits.size) {
      const x0 = cx * CHUNK, z0 = cz * CHUNK;
      for (const [key, id] of this.edits) {
        const [x, y, z] = key.split(',').map(Number);
        if (x >= x0 && x < x0 + 16 && z >= z0 && z < z0 + 16 && y >= 0 && y < HEIGHT) {
          data[idx(x - x0, y, z - z0)] = id;
        }
      }
    }
    this.chunks.set(chunkKey(cx, cz), data);
    return data;
  }

  getChunkData(cx, cz, create = false) {
    const key = chunkKey(cx, cz);
    let d = this.chunks.get(key);
    if (!d && create) d = this.generateChunk(cx, cz);
    return d || null;
  }

  getBlock(x, y, z) {
    if (y < 0) return B.BEDROCK;
    if (y >= HEIGHT) return 0;
    const d = this.chunks.get(chunkKey(Math.floor(x / 16), Math.floor(z / 16)));
    if (!d) return 0;
    return d[idx(x & 15, y, z & 15)];
  }

  // Returns the set of chunk keys whose meshes need rebuilding.
  setBlock(x, y, z, id, record = true) {
    if (y < 0 || y >= HEIGHT) return new Set();
    const cx = Math.floor(x / 16), cz = Math.floor(z / 16);
    const d = this.chunks.get(chunkKey(cx, cz));
    if (!d) return new Set();
    d[idx(x & 15, y, z & 15)] = id;
    if (record) this.edits.set(`${x},${y},${z}`, id);
    const keys = new Set([chunkKey(cx, cz)]);
    const lx = x & 15, lz = z & 15;
    if (lx === 0) keys.add(chunkKey(cx - 1, cz));
    if (lx === 15) keys.add(chunkKey(cx + 1, cz));
    if (lz === 0) keys.add(chunkKey(cx, cz - 1));
    if (lz === 15) keys.add(chunkKey(cx, cz + 1));
    return keys;
  }

  surfaceY(x, z) { // first solid block from the top (spawn / animals)
    for (let y = HEIGHT - 1; y > 0; y--) {
      const id = this.getBlock(x, y, z);
      if (id && id !== B.WATER) return y;
    }
    return SEA;
  }
}
