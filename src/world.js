import * as THREE from '../vendor/three.module.js';
import { BLOCK, CHUNK_SIZE, ID, ITEM_BY_ID, MAX_Y, SEA_LEVEL } from './blocks.js';

const CS = CHUNK_SIZE;
const CHUNK_AREA = CS * CS;
const INDEX = (x, y, z) => y * CHUNK_AREA + z * CS + x;
const key3 = (x, y, z) => `${x},${y},${z}`;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (v) => v * v * (3 - 2 * v);

export function hashSeed(value) {
  const text = String(value ?? 'world');
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function hash2(seed, x, z, salt = 0) {
  let h = seed ^ Math.imul(x | 0, 0x1f123bb5) ^ Math.imul(z | 0, 0x5f356495) ^ Math.imul(salt | 0, 0x6c8e9cf5);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}
function hash3(seed, x, y, z, salt = 0) {
  let h = seed ^ Math.imul(x | 0, 0x1f123bb5) ^ Math.imul(y | 0, 0x5f356495) ^ Math.imul(z | 0, 0x6c8e9cf5) ^ Math.imul(salt | 0, 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}
function value2(seed, x, z, scale, salt = 0) {
  const sx = x * scale, sz = z * scale;
  const x0 = Math.floor(sx), z0 = Math.floor(sz);
  const tx = smooth(sx - x0), tz = smooth(sz - z0);
  const a = hash2(seed, x0, z0, salt), b = hash2(seed, x0 + 1, z0, salt);
  const c = hash2(seed, x0, z0 + 1, salt), d = hash2(seed, x0 + 1, z0 + 1, salt);
  const top = a + (b - a) * tx, bottom = c + (d - c) * tx;
  return top + (bottom - top) * tz;
}
function value3(seed, x, y, z, sx, sy, sz, salt = 0) {
  const px = x * sx, py = y * sy, pz = z * sz;
  const x0 = Math.floor(px), y0 = Math.floor(py), z0 = Math.floor(pz);
  const tx = smooth(px - x0), ty = smooth(py - y0), tz = smooth(pz - z0);
  const c00 = hash3(seed, x0, y0, z0, salt) + (hash3(seed, x0 + 1, y0, z0, salt) - hash3(seed, x0, y0, z0, salt)) * tx;
  const c10 = hash3(seed, x0, y0 + 1, z0, salt) + (hash3(seed, x0 + 1, y0 + 1, z0, salt) - hash3(seed, x0, y0 + 1, z0, salt)) * tx;
  const c01 = hash3(seed, x0, y0, z0 + 1, salt) + (hash3(seed, x0 + 1, y0, z0 + 1, salt) - hash3(seed, x0, y0, z0 + 1, salt)) * tx;
  const c11 = hash3(seed, x0, y0 + 1, z0 + 1, salt) + (hash3(seed, x0 + 1, y0 + 1, z0 + 1, salt) - hash3(seed, x0, y0 + 1, z0 + 1, salt)) * tx;
  const z0v = c00 + (c01 - c00) * tz, z1v = c10 + (c11 - c10) * tz;
  return z0v + (z1v - z0v) * ty;
}
function fbm2(seed, x, z, scale, salt) {
  let sum = 0, weight = 0, amp = 1, frequency = 1;
  for (let i = 0; i < 4; i++) {
    sum += value2(seed, x + i * 137, z - i * 71, scale * frequency, salt + i * 17) * amp;
    weight += amp; amp *= 0.5; frequency *= 2;
  }
  return sum / weight;
}

function hexRgb(hex) {
  return [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255];
}

export function makeBlockAtlas() {
  const tile = 16, cols = 16;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = tile * cols;
  const ctx = canvas.getContext('2d', { alpha: false });
  const all = [...ITEM_BY_ID.values()];
  for (let id = 1; id < 256; id++) {
    const def = ITEM_BY_ID.get(id);
    if (!def) continue;
    const x0 = (id % cols) * tile, y0 = Math.floor(id / cols) * tile;
    ctx.fillStyle = def.color; ctx.fillRect(x0, y0, tile, tile);
    const rnd = (x, y, n = 0) => hash2(id * 521 + 93, x, y, n);
    if (id === ID.LOG) {
      ctx.fillStyle = '#644324';
      for (let x = 1; x < 16; x += 4) ctx.fillRect(x0 + x, y0, 1, 16);
      ctx.fillStyle = '#aa8050'; ctx.fillRect(x0 + 2, y0 + 1, 1, 14);
      ctx.strokeStyle = '#dfba77'; ctx.beginPath(); ctx.arc(x0 + 8, y0 + 8, 4, 0, Math.PI * 2); ctx.stroke();
      continue;
    }
    if (id === ID.WATER) {
      ctx.fillStyle = 'rgba(195,231,255,.3)';
      for (let y = 2; y < 16; y += 5) ctx.fillRect(x0 + 1, y0 + y, 14, 1);
      continue;
    }
    if (id === ID.GRASS) {
      ctx.fillStyle = '#347b38';
      for (let i = 0; i < 18; i++) { const x = Math.floor(rnd(i, 1) * 16), y = Math.floor(rnd(i, 2) * 16); ctx.fillRect(x0 + x, y0 + y, 1, 1); }
    }
    for (let i = 0; i < 27; i++) {
      const x = Math.floor(rnd(i, 7) * 16), y = Math.floor(rnd(i, 11) * 16);
      const dark = rnd(i, 19) > 0.52;
      const c = hexRgb(def.color).map((v) => Math.round(v * (dark ? 0.72 : 1.16)));
      ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
      ctx.fillRect(x0 + x, y0 + y, 1 + Math.floor(rnd(i, 23) * 2), 1 + Math.floor(rnd(i, 29) * 2));
    }
    if ([ID.COAL_ORE, ID.IRON_ORE, ID.GOLD_ORE, ID.DIAMOND_ORE, ID.REDSTONE_ORE, ID.COPPER_ORE, ID.LAPIS_ORE].includes(id)) {
      const oreColor = def.color;
      ctx.fillStyle = oreColor;
      for (let i = 0; i < 8; i++) {
        const x = Math.floor(rnd(i + 60, 4) * 14) + 1, y = Math.floor(rnd(i + 60, 8) * 14) + 1;
        ctx.fillRect(x0 + x, y0 + y, 2, 2);
      }
    }
    if (id === ID.PLANKS || id === ID.BOOKSHELF || id === ID.DOOR || id === ID.CRAFTING) {
      ctx.strokeStyle = 'rgba(65,38,18,.34)'; ctx.lineWidth = 1;
      for (let y = 3; y < 16; y += 5) { ctx.beginPath(); ctx.moveTo(x0, y0 + y); ctx.lineTo(x0 + 16, y0 + y); ctx.stroke(); }
    }
    if (id === ID.LEAVES || id === ID.SAPLING) {
      ctx.fillStyle = 'rgba(183,231,113,.72)';
      for (let i = 0; i < 9; i++) { const x = Math.floor(rnd(i + 31, 3) * 15); const y = Math.floor(rnd(i + 31, 9) * 15); ctx.fillRect(x0 + x, y0 + y, 2, 2); }
    }
  }
  // Special face tiles used by blocks whose top/side differs from their main texture.
  const special = (id, base, draw) => {
    const x0 = (id % cols) * tile, y0 = Math.floor(id / cols) * tile;
    ctx.fillStyle = base; ctx.fillRect(x0, y0, tile, tile); draw(x0, y0);
  };
  special(73, '#8c6040', (x, y) => {
    ctx.fillStyle = '#4c913d'; ctx.fillRect(x, y, 16, 4);
    ctx.fillStyle = '#65ad49'; ctx.fillRect(x + 1, y + 3, 14, 2);
    ctx.fillStyle = 'rgba(54,35,23,.3)';
    for (let i = 0; i < 18; i++) ctx.fillRect(x + (i * 7 + 3) % 16, y + 5 + (i * 5) % 11, 1, 1);
  });
  special(74, '#8b613d', (x, y) => {
    ctx.strokeStyle = '#d1a66a'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x + 8, y + 8, 5, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(x + 8, y + 8, 2, 0, Math.PI * 2); ctx.stroke();
  });
  special(75, '#aa7a43', (x, y) => {
    ctx.fillStyle = '#714d2f'; ctx.fillRect(x + 2, y + 2, 12, 12); ctx.fillStyle = '#d0a15b';
    ctx.fillRect(x + 4, y + 4, 3, 3); ctx.fillRect(x + 9, y + 4, 3, 3); ctx.fillRect(x + 4, y + 9, 3, 3); ctx.fillRect(x + 9, y + 9, 3, 3);
  });
  special(76, '#8f6030', (x, y) => {
    ctx.fillStyle = '#c2914d'; ctx.fillRect(x + 2, y + 2, 12, 12); ctx.fillStyle = '#633e24';
    ctx.fillRect(x + 2, y + 6, 12, 3); ctx.fillStyle = '#e6bf69'; ctx.fillRect(x + 7, y + 7, 2, 2);
  });
  special(77, '#56585d', (x, y) => {
    ctx.fillStyle = '#34363a'; ctx.fillRect(x + 2, y + 2, 12, 12); ctx.fillStyle = '#17191c'; ctx.fillRect(x + 5, y + 5, 6, 6);
    ctx.fillStyle = '#d18a3d'; ctx.fillRect(x + 7, y + 7, 2, 2);
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  return texture;
}

const FACES = [
  { n: [1, 0, 0], v: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]], shade: 0.82 },
  { n: [-1, 0, 0], v: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]], shade: 0.74 },
  { n: [0, 1, 0], v: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]], shade: 1.08 },
  { n: [0, -1, 0], v: [[0, 0, 1], [0, 0, 0], [1, 0, 0], [1, 0, 1]], shade: 0.54 },
  { n: [0, 0, 1], v: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]], shade: 0.91 },
  { n: [0, 0, -1], v: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]], shade: 0.79 },
];

export class VoxelWorld {
  constructor(seed, editList = [], scene = null, viewDistance = 2) {
    this.seedText = String(seed || '381742');
    this.seed = hashSeed(this.seedText);
    this.scene = scene;
    this.viewDistance = Math.max(1, Math.min(4, viewDistance | 0));
    this.chunks = new Map();
    this.surfaceCache = new Map();
    this.edits = new Map();
    this.editIndex = new Map();
    this.atlas = makeBlockAtlas();
    this.opaqueMaterial = new THREE.MeshLambertMaterial({ map: this.atlas, vertexColors: true });
    this.waterMaterial = new THREE.MeshLambertMaterial({ map: this.atlas, vertexColors: true, transparent: true, opacity: 0.76, depthWrite: false });
    this.glassMaterial = new THREE.MeshLambertMaterial({ map: this.atlas, vertexColors: true, transparent: true, opacity: 0.48, depthWrite: false });
    this.onChange = null;
    for (const item of editList || []) {
      let x, y, z, id;
      if (Array.isArray(item)) [x, y, z, id] = item;
      else { ({ x, y, z, id } = item || {}); }
      if ([x, y, z, id].every(Number.isFinite)) this._putEdit(x | 0, y | 0, z | 0, id | 0);
    }
  }

  _chunkKey(cx, cz) { return `${cx},${cz}`; }
  _coords(x, z) {
    const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
    return { cx, cz, lx: x - cx * CS, lz: z - cz * CS };
  }

  biomeAt(x, z) {
    const temperature = value2(this.seed, x + 1331, z - 771, 0.0033, 211);
    const moisture = value2(this.seed, x - 2123, z + 991, 0.003, 307);
    if (temperature < 0.21) return 'snow';
    if (moisture < 0.2 && temperature > 0.36) return 'desert';
    if (moisture > 0.78) return 'swamp';
    if (moisture > 0.55) return 'forest';
    if (temperature > 0.78 && moisture < 0.45) return 'savanna';
    return 'meadow';
  }

  surfaceAt(x, z) {
    const key = `${x},${z}`;
    const cached = this.surfaceCache.get(key);
    if (cached) return cached;
    const broad = fbm2(this.seed, x, z, 0.009, 41);
    const detail = value2(this.seed, x + 880, z - 139, 0.028, 97);
    const value = { height: Math.max(5, Math.min(MAX_Y - 20, Math.round(8 + broad * 16 + detail * 4))), biome: this.biomeAt(x, z) };
    this.surfaceCache.set(key, value);
    return value;
  }

  _treeSpec(x, z) {
    const { height, biome } = this.surfaceAt(x, z);
    if (height <= SEA_LEVEL + 1) return null;
    if (biome === 'desert') {
      if (hash2(this.seed, x, z, 509) < 0.008) return { kind: 'cactus', height: 2 + Math.floor(hash2(this.seed, x, z, 510) * 3), base: height, biome };
      return null;
    }
    const density = biome === 'forest' ? 0.045 : biome === 'snow' ? 0.032 : biome === 'swamp' ? 0.024 : biome === 'meadow' ? 0.009 : 0.006;
    if (hash2(this.seed, x, z, 501) > density) return null;
    return { kind: 'tree', height: 4 + Math.floor(hash2(this.seed, x, z, 502) * 3), base: height, biome };
  }

  _featureBlock(x, y, z) {
    if (y > this.surfaceAt(x, z).height + 12) return 0;
    for (let tz = z - 2; tz <= z + 2; tz++) for (let tx = x - 2; tx <= x + 2; tx++) {
      const spec = this._treeSpec(tx, tz);
      if (!spec) continue;
      if (spec.kind === 'cactus') {
        if (tx === x && tz === z && y > spec.base && y <= spec.base + spec.height) return ID.CACTUS;
        continue;
      }
      if (tx === x && tz === z && y > spec.base && y <= spec.base + spec.height) return ID.LOG;
      const crown = spec.base + spec.height;
      const dy = y - crown;
      if (dy < -2 || dy > 1) continue;
      const radius = dy === 1 ? 1 : dy === -2 ? 1 : 2;
      const dx = Math.abs(x - tx), dz = Math.abs(z - tz);
      if (dx <= radius && dz <= radius && !(dx === radius && dz === radius && dy !== 0) && y > spec.base + spec.height - 2) return ID.LEAVES;
    }
    return 0;
  }

  _groundBlock(x, y, z) {
    if (y < 0 || y >= MAX_Y) return 0;
    const { height, biome } = this.surfaceAt(x, z);
    if (y > height) return y <= SEA_LEVEL ? ID.WATER : 0;
    if (y === 0) return ID.OBSIDIAN;
    if (y === height) {
      if (biome === 'desert' || height <= SEA_LEVEL + 1) return ID.SAND;
      if (biome === 'snow') return ID.SNOW;
      return ID.GRASS;
    }
    if (y >= height - 3) return biome === 'desert' || height <= SEA_LEVEL + 1 ? ID.SAND : ID.DIRT;
    if (y > 3 && y < height - 4 && value3(this.seed, x, y, z, 0.075, 0.12, 0.075, 699) > 0.72) return 0;
    const r = hash3(this.seed, x, y, z, 801);
    if (y < 10 && r < 0.0019) return ID.DIAMOND_ORE;
    if (y < 16 && r < 0.0036) return ID.GOLD_ORE;
    if (y < 28 && r < 0.0064) return ID.REDSTONE_ORE;
    if (y < 34 && r < 0.009) return ID.LAPIS_ORE;
    if (y < 38 && r < 0.013) return ID.IRON_ORE;
    if (y < 44 && r < 0.017) return ID.COPPER_ORE;
    if (r < 0.038) return ID.COAL_ORE;
    if (r > 0.993 && y < 24) return ID.CLAY;
    return ID.STONE;
  }

  _baseBlockAt(x, y, z) {
    const feature = this._featureBlock(x, y, z);
    if (feature) return feature;
    return this._groundBlock(x, y, z);
  }

  _putEdit(x, y, z, id) {
    const key = key3(x, y, z);
    this.edits.set(key, id);
    const { cx, cz } = this._coords(x, z);
    const ck = this._chunkKey(cx, cz);
    let list = this.editIndex.get(ck);
    if (!list) this.editIndex.set(ck, list = []);
    const existing = list.findIndex((e) => e[0] === x && e[1] === y && e[2] === z);
    const edit = [x, y, z, id];
    if (existing >= 0) list[existing] = edit; else list.push(edit);
  }

  _removeEdit(x, y, z) {
    this.edits.delete(key3(x, y, z));
    const { cx, cz } = this._coords(x, z);
    const ck = this._chunkKey(cx, cz), list = this.editIndex.get(ck);
    if (!list) return;
    const index = list.findIndex((e) => e[0] === x && e[1] === y && e[2] === z);
    if (index >= 0) list.splice(index, 1);
    if (!list.length) this.editIndex.delete(ck);
  }

  _createChunk(cx, cz) {
    const chunk = { cx, cz, data: new Uint8Array(CS * CS * MAX_Y), mesh: null, water: null, glass: null };
    this.chunks.set(this._chunkKey(cx, cz), chunk);
    const startX = cx * CS, startZ = cz * CS;
    for (let lz = 0; lz < CS; lz++) for (let lx = 0; lx < CS; lx++) {
      const x = startX + lx, z = startZ + lz;
      const { height } = this.surfaceAt(x, z);
      for (let y = 0; y <= Math.max(height, SEA_LEVEL); y++) {
        chunk.data[INDEX(lx, y, lz)] = this._groundBlock(x, y, z);
      }
    }
    // Trees and cacti are generated from global coordinates, so their canopies line up across chunks.
    for (let tz = startZ - 2; tz < startZ + CS + 2; tz++) for (let tx = startX - 2; tx < startX + CS + 2; tx++) {
      const spec = this._treeSpec(tx, tz);
      if (!spec) continue;
      if (spec.kind === 'cactus') {
        for (let y = spec.base + 1; y <= spec.base + spec.height; y++) this._writeIfInside(chunk, tx, y, tz, ID.CACTUS);
        continue;
      }
      for (let y = spec.base + 1; y <= spec.base + spec.height; y++) this._writeIfInside(chunk, tx, y, tz, ID.LOG);
      const crown = spec.base + spec.height;
      for (let dy = -2; dy <= 1; dy++) {
        const radius = dy === 1 || dy === -2 ? 1 : 2;
        for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) {
          if (Math.abs(dx) === radius && Math.abs(dz) === radius && dy !== 0) continue;
          if (dy === 0 && dx === 0 && dz === 0) continue;
          this._writeIfInside(chunk, tx + dx, crown + dy, tz + dz, ID.LEAVES, true);
        }
      }
    }
    for (const [x, y, z, id] of this.editIndex.get(this._chunkKey(cx, cz)) || []) {
      const lx = x - startX, lz = z - startZ;
      if (y >= 0 && y < MAX_Y) chunk.data[INDEX(lx, y, lz)] = id;
    }
    return chunk;
  }

  _writeIfInside(chunk, x, y, z, id, leaves = false) {
    if (y <= 0 || y >= MAX_Y) return;
    const lx = x - chunk.cx * CS, lz = z - chunk.cz * CS;
    if (lx < 0 || lx >= CS || lz < 0 || lz >= CS) return;
    const i = INDEX(lx, y, lz);
    if (!leaves || chunk.data[i] === 0) chunk.data[i] = id;
  }

  _rawFromChunk(chunk, x, y, z) {
    const lx = x - chunk.cx * CS, lz = z - chunk.cz * CS;
    return y < 0 || y >= MAX_Y ? 0 : chunk.data[INDEX(lx, y, lz)];
  }

  peek(x, y, z) {
    if (y < 0 || y >= MAX_Y) return y < 0 ? ID.OBSIDIAN : 0;
    const { cx, cz } = this._coords(x, z);
    const chunk = this.chunks.get(this._chunkKey(cx, cz));
    if (chunk) return this._rawFromChunk(chunk, x, y, z);
    const edited = this.edits.get(key3(x, y, z));
    return edited === undefined ? this._baseBlockAt(x, y, z) : edited;
  }

  getBlock(x, y, z) {
    if (y < 0 || y >= MAX_Y) return y < 0 ? ID.OBSIDIAN : 0;
    const { cx, cz } = this._coords(x, z);
    const chunk = this.ensureChunk(cx, cz);
    return this._rawFromChunk(chunk, x, y, z);
  }

  ensureChunk(cx, cz) {
    const key = this._chunkKey(cx, cz);
    return this.chunks.get(key) || this._createChunk(cx, cz);
  }

  ensureAround(x, z, distance = this.viewDistance) {
    const centerX = Math.floor(x / CS), centerZ = Math.floor(z / CS);
    const newChunks = [];
    for (let dz = -distance; dz <= distance; dz++) for (let dx = -distance; dx <= distance; dx++) {
      const cx = centerX + dx, cz = centerZ + dz;
      const key = this._chunkKey(cx, cz);
      if (!this.chunks.has(key)) newChunks.push(this.ensureChunk(cx, cz));
    }
    const toBuild = new Set(newChunks);
    if (newChunks.length) {
      for (const chunk of newChunks) {
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const n = this.chunks.get(this._chunkKey(chunk.cx + dx, chunk.cz + dz));
          if (n) toBuild.add(n);
        }
      }
      for (const c of toBuild) this.rebuildChunk(c);
    }
    const keep = distance + 1;
    for (const [key, chunk] of this.chunks) {
      if (Math.abs(chunk.cx - centerX) > keep || Math.abs(chunk.cz - centerZ) > keep) this._removeChunk(key, chunk);
    }
  }

  setViewDistance(distance, x = 0, z = 0) {
    this.viewDistance = Math.max(1, Math.min(4, distance | 0));
    this.ensureAround(x, z, this.viewDistance);
  }

  setBlock(x, y, z, id, remote = false) {
    x |= 0; y |= 0; z |= 0; id |= 0;
    if (y < 1 || y >= MAX_Y || id < 0 || id > 255) return false;
    const { cx, cz, lx, lz } = this._coords(x, z);
    const chunk = this.ensureChunk(cx, cz);
    const i = INDEX(lx, y, lz);
    if (chunk.data[i] === id) return false;
    const base = this._baseBlockAt(x, y, z);
    if (base === id) this._removeEdit(x, y, z);
    else this._putEdit(x, y, z, id);
    chunk.data[i] = id;
    const dirty = [chunk];
    if (lx === 0) dirty.push(this.chunks.get(this._chunkKey(cx - 1, cz)));
    if (lx === CS - 1) dirty.push(this.chunks.get(this._chunkKey(cx + 1, cz)));
    if (lz === 0) dirty.push(this.chunks.get(this._chunkKey(cx, cz - 1)));
    if (lz === CS - 1) dirty.push(this.chunks.get(this._chunkKey(cx, cz + 1)));
    for (const c of dirty) if (c) this.rebuildChunk(c);
    if (!remote) this.onChange?.({ x, y, z, id });
    return true;
  }

  _visible(current, neighbor) {
    if (!neighbor) return true;
    const cur = BLOCK[current];
    const next = BLOCK[neighbor];
    if (!cur) return false;
    if (cur.transparent) {
      if (neighbor === current) return false;
      return !next?.solid || next?.transparent;
    }
    return !next?.solid || next?.transparent;
  }

  _tileFor(id, faceIndex) {
    if (id === ID.GRASS) return faceIndex === 2 ? ID.GRASS : faceIndex === 3 ? ID.DIRT : 73;
    if (id === ID.LOG) return faceIndex === 2 || faceIndex === 3 ? 74 : ID.LOG;
    if (id === ID.CRAFTING && faceIndex === 2) return 75;
    if (id === ID.CHEST && faceIndex === 2) return 76;
    if (id === ID.FURNACE && faceIndex === 2) return 77;
    return id;
  }

  rebuildChunk(chunk) {
    if (!this.scene) return;
    for (const name of ['mesh', 'water', 'glass']) {
      const mesh = chunk[name];
      if (mesh) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        chunk[name] = null;
      }
    }
    const opaque = { p: [], n: [], c: [], uv: [], ix: [] };
    const water = { p: [], n: [], c: [], uv: [], ix: [] };
    const glass = { p: [], n: [], c: [], uv: [], ix: [] };
    const originX = chunk.cx * CS, originZ = chunk.cz * CS;
    const faceColors = [0.94, 0.86, 1.08, 0.54, 0.96, 0.79];
    for (let y = 0; y < MAX_Y; y++) for (let lz = 0; lz < CS; lz++) for (let lx = 0; lx < CS; lx++) {
      const id = chunk.data[INDEX(lx, y, lz)];
      if (!id || !BLOCK[id]) continue;
      const def = BLOCK[id];
      const target = id === ID.WATER ? water : id === ID.GLASS ? glass : opaque;
      const x = originX + lx, z = originZ + lz;
      const variation = 0.94 + hash2(this.seed, x, z, y + id * 31) * 0.12;
      const rgb = [variation, variation, variation];
      for (let f = 0; f < FACES.length; f++) {
        const face = FACES[f];
        const neighbor = this.peek(x + face.n[0], y + face.n[1], z + face.n[2]);
        if (!this._visible(id, neighbor)) continue;
        const tileId = this._tileFor(id, f);
        const col = tileId % 16, row = Math.floor(tileId / 16);
        const vBase = target.p.length / 3;
        for (let k = 0; k < 4; k++) {
          const v = face.v[k];
          target.p.push(lx + v[0], y + v[1], lz + v[2]);
          target.n.push(face.n[0], face.n[1], face.n[2]);
          const shade = faceColors[f] * variation;
          target.c.push(rgb[0] * shade, rgb[1] * shade, rgb[2] * shade);
          const uv = [[0, 0], [0, 1], [1, 1], [1, 0]][k];
          target.uv.push((col + uv[0]) / 16, 1 - (row + uv[1]) / 16);
        }
        target.ix.push(vBase, vBase + 1, vBase + 2, vBase, vBase + 2, vBase + 3);
      }
    }
    const create = (data, material, name) => {
      if (!data.ix.length) return null;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(data.p, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(data.n, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(data.c, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(data.uv, 2));
      geo.setIndex(data.ix);
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, material);
      mesh.position.set(originX, 0, originZ);
      mesh.name = `chunk-${name}-${chunk.cx}-${chunk.cz}`;
      mesh.frustumCulled = true;
      mesh.userData.chunk = { cx: chunk.cx, cz: chunk.cz };
      this.scene.add(mesh);
      return mesh;
    };
    chunk.mesh = create(opaque, this.opaqueMaterial, 'solid');
    chunk.water = create(water, this.waterMaterial, 'water');
    chunk.glass = create(glass, this.glassMaterial, 'glass');
  }

  _removeChunk(key, chunk) {
    for (const name of ['mesh', 'water', 'glass']) {
      if (chunk[name]) { this.scene?.remove(chunk[name]); chunk[name].geometry.dispose(); }
    }
    this.chunks.delete(key);
  }

  highestSolid(x, z) {
    for (let y = MAX_Y - 1; y >= 0; y--) {
      const id = this.peek(x, y, z);
      if (BLOCK[id]?.solid && id !== ID.LEAVES) return y;
    }
    return 1;
  }

  serializeEdits() {
    const out = [];
    for (const [key, id] of this.edits) {
      const [x, y, z] = key.split(',').map(Number);
      out.push([x, y, z, id]);
    }
    return out;
  }

  dispose() {
    for (const [key, chunk] of this.chunks) this._removeChunk(key, chunk);
    this.atlas.dispose();
    this.opaqueMaterial.dispose(); this.waterMaterial.dispose(); this.glassMaterial.dispose();
  }
}
