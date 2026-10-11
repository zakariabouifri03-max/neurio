// ═══════════════════════════════════════════════════════════════════════════
//  MINECRAFT VOXEL ENGINE — world storage + greedy face-culled chunk mesher
//  with baked per-vertex ambient occlusion, biome colour tinting and
//  material layers (opaque / cutout / transparent / emissive).
//  Core three.js only, zero assets, zero network.
// ═══════════════════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { clamp } from '../util.js';

export const key = (x, y, z) => ((x + 512) << 20) | ((z + 512) << 8) | (y + 128);
export const unkey = (k) => [((k >> 20) & 1023) - 512, (k & 255) - 128, ((k >> 8) & 1023) - 512];

const CHUNK = 16;
const Y_MIN = -16;          // world floor (inclusive)
const Y_MAX = 112;          // world ceiling (exclusive)
const Y_SPAN = Y_MAX - Y_MIN;

// face table — Minecraft block geometry: unit cubes on an integer lattice.
// vertex order is a CCW quad seen from outside; u runs along U, v along V.
const FACES = [
  { d: [1, 0, 0], n: [1, 0, 0], o: [1, 0, 0], U: [0, 0, -1], V: [0, 1, 0], sh: 0.74 },
  { d: [-1, 0, 0], n: [-1, 0, 0], o: [0, 0, 1], U: [0, 0, 1], V: [0, 1, 0], sh: 0.74 },
  { d: [0, 1, 0], n: [0, 1, 0], o: [0, 1, 0], U: [1, 0, 0], V: [0, 0, -1], sh: 1.00 },
  { d: [0, -1, 0], n: [0, -1, 0], o: [0, 0, 0], U: [1, 0, 0], V: [0, 0, 1], sh: 0.46 },
  { d: [0, 0, 1], n: [0, 0, 1], o: [0, 0, 1], U: [1, 0, 0], V: [0, 1, 0], sh: 0.88 },
  { d: [0, 0, -1], n: [0, 0, -1], o: [1, 0, 0], U: [-1, 0, 0], V: [0, 1, 0], sh: 0.88 },
];
// per-corner offsets in (U,V) space, matching the vertex order above
const CORNERS = [[0, 0], [1, 0], [1, 1], [0, 1]];
const AO_LEVELS = [0.44, 0.64, 0.82, 1.0];

export const LAYERS = ['opaque', 'cutout', 'transparent', 'emissive'];

// ─── tiny growable float buffer ────────────────────────────────────────────
class Buf {
  constructor() { this.a = new Float32Array(1 << 16); this.n = 0; }
  push(v) { if (this.n === this.a.length) { const b = new Float32Array(this.n * 2); b.set(this.a); this.a = b; } this.a[this.n++] = v; }
  push3(x, y, z) { this.push(x); this.push(y); this.push(z); }
  push4(x, y, z, w) { this.push(x); this.push(y); this.push(z); this.push(w); }
  out() { return this.a.subarray(0, this.n); }
}
class IBuf {
  constructor() { this.a = []; }
  push(...v) { for (let i = 0; i < v.length; i++) this.a.push(v[i]); }
  out() { return this.a.length > 65535 ? Uint32Array.from(this.a) : Uint16Array.from(this.a); }
  get count() { return this.a.length; }
}

// ═══════════════════════════════════════════════════════════════════════════
export class VoxelWorld {
  constructor(palette, opts = {}) {
    this.palette = palette;
    this.chunkSize = opts.chunkSize || CHUNK;
    this.blocks = new Map();          // key → id
    this.biomes = new Map();          // key → biome index (grass/leaf tint)
    this.chunks = new Map();          // "cx,cz" → { meshes, dirty, minY, maxY }
    this.group = new THREE.Group();
    this.group.name = 'VoxelWorld';
    this.stats = { faces: 0, chunks: 0 };
    this.materials = null;            // set by setMaterials()
  }

  // ── block access ─────────────────────────────────────────────────────────
  get(x, y, z) { return this.blocks.get(key(x, y, z)) | 0; }
  isSolid(x, y, z) { return (this.palette[this.get(x, y, z)] || {}).solid === true; }
  biome(x, y, z) { return this.biomes.get(key(x, y, z)) | 0; }

  set(x, y, z, id, biome = -1) {
    if (y < Y_MIN || y >= Y_MAX) return;
    const k = key(x, y, z);
    if (id === 0) { this.blocks.delete(k); this.biomes.delete(k); }
    else {
      this.blocks.set(k, id);
      if (biome >= 0) this.biomes.set(k, biome);
    }
    this._touch(x, y, z);
  }

  // set without invalidating chunks (bulk terrain generation)
  raw(x, y, z, id, biome = -1) {
    if (y < Y_MIN || y >= Y_MAX) return;
    const k = key(x, y, z);
    if (id === 0) { this.blocks.delete(k); this.biomes.delete(k); }
    else { this.blocks.set(k, id); if (biome >= 0) this.biomes.set(k, biome); }
  }

  _touch(x, y, z) {
    const c = this.chunkSize;
    this.dirty(x >> 4 << 4, z, true);
    const cx = Math.floor(x / c), cz = Math.floor(z / c);
    if (x - cx * c === 0) this.dirtyChunk(cx - 1, cz);
    if (x - cx * c === c - 1) this.dirtyChunk(cx + 1, cz);
    if (z - cz * c === 0) this.dirtyChunk(cx, cz - 1);
    if (z - cz * c === c - 1) this.dirtyChunk(cx, cz + 1);
  }
  dirty(x, y, z) { this.dirtyChunk(Math.floor(x / this.chunkSize), Math.floor(z / this.chunkSize)); }
  dirtyChunk(cx, cz) { const c = this.chunks.get(cx + ',' + cz); if (c) c.dirty = true; }

  /** highest non-air block y at column (or Y_MIN-1 when empty) */
  topY(x, z) {
    for (let y = Y_MAX - 1; y >= Y_MIN; y--) if (this.get(x, y, z)) return y;
    return Y_MIN - 1;
  }
  /** y of the topmost *walkable* surface: first solid block from the top */
  groundY(x, z) {
    for (let y = Y_MAX - 1; y >= Y_MIN; y--) {
      const id = this.get(x, y, z);
      if (id && this.palette[id] && this.palette[id].solid) return y;
    }
    return Y_MIN - 1;
  }
  /** eye-level height for the first-person camera (top of the highest solid) */
  surfaceY(x, z) { return this.groundY(Math.floor(x), Math.floor(z)) + 1; }

  inBounds(x, z) { return this._inBounds ? this._inBounds(x, z) : true; }
  setBounds(fn) { this._inBounds = fn; }

  // ── materials ────────────────────────────────────────────────────────────
  setMaterials(mats) { this.materials = mats; }

  // ── mesher ───────────────────────────────────────────────────────────────
  get blockCount() { return this.blocks.size; }

  buildAll(onProgress) {
    const c = this.chunkSize;
    this.stats.blocks = this.blocks.size;
    this.stats.faces = 0;
    const keys = new Set();
    for (const k of this.blocks.keys()) {
      const [x, , z] = unkey(k);
      keys.add(Math.floor(x / c) + ',' + Math.floor(z / c));
    }
    const list = [...keys].sort();
    this.stats.chunks = list.length;
    let i = 0;
    for (const ck of list) {
      const [cx, cz] = ck.split(',').map(Number);
      this.buildChunk(cx, cz);
      if (onProgress && (i % 6 === 0)) onProgress(i / list.length);
      i++;
    }
    if (onProgress) onProgress(1);
    return this.group;
  }

  update() {
    for (const [ck, c] of this.chunks) {
      if (!c.dirty) continue;
      const [cx, cz] = ck.split(',').map(Number);
      this.buildChunk(cx, cz);
    }
  }

  buildChunk(cx, cz) {
    const c = this.chunkSize, ck = cx + ',' + cz;
    const old = this.chunks.get(ck);
    if (old) for (const m of old.meshes) { this.group.remove(m); m.geometry.dispose(); }

    const x0 = cx * c, z0 = cz * c;
    // local id / biome slab (one extra ring on each side for neighbour lookups)
    const W = c + 2;
    const ids = new Uint8Array(W * Y_SPAN * W);
    const bio = new Uint8Array(W * Y_SPAN * W);
    let minY = Y_MAX, maxY = Y_MIN, any = false;
    const li = (lx, y, lz) => ((lx + 1) * W + (lz + 1)) * Y_SPAN + (y - Y_MIN);
    for (let lx = -1; lx <= c; lx++) {
      for (let lz = -1; lz <= c; lz++) {
        const wx = x0 + lx, wz = z0 + lz;
        for (let y = Y_MIN; y < Y_MAX; y++) {
          const k = key(wx, y, wz);
          const id = this.blocks.get(k) | 0;
          if (!id) continue;
          const i = li(lx, y, lz);
          ids[i] = id; bio[i] = this.biomes.get(k) | 0;
          any = true;
          if (lx >= 0 && lx < c && lz >= 0 && lz < c) { if (y < minY) minY = y; if (y > maxY) maxY = y; }
        }
      }
    }
    if (!any || maxY < minY) { this.chunks.set(ck, { meshes: [], dirty: false }); return; }

    const P = this.palette;
    const layers = { opaque: null, cutout: null, transparent: null, emissive: null };
    const grab = (name) => {
      if (!layers[name]) layers[name] = {
        pos: new Buf(), nrm: new Buf(), uv: new Buf(), col: new Buf(), idx: new IBuf(), verts: 0,
      };
      return layers[name];
    };
    const tintCol = new THREE.Color();

    const occ = (lx, y, lz, self) => {
      if (y < Y_MIN || y >= Y_MAX) return false;
      const id = ids[li(lx, y, lz)];
      if (!id) return false;
      return P[id].opaque === true;
    };

    for (let lx = 0; lx < c; lx++) {
      for (let lz = 0; lz < c; lz++) {
        const wx = x0 + lx, wz = z0 + lz;
        for (let y = minY; y <= maxY; y++) {
          const id = ids[li(lx, y, lz)];
          if (!id) continue;
          const p = P[id];
          if (!p) continue;
          const layer = grab(p.layer);
          const tiles = p.tiles;
          const tint = p.tint ? BIOME_TINT[bio[li(lx, y, lz)] | 0] || 1 : 0;
          if (tint) tintCol.setHex(tint); else tintCol.setRGB(1, 1, 1);

          for (let f = 0; f < 6; f++) {
            const F = FACES[f];
            const nx = lx + F.d[0], ny = y + F.d[1], nz = lz + F.d[2];
            const nid = (ny < Y_MIN || ny >= Y_MAX) ? 0 : ids[li(nx, ny, nz)];
            const np = P[nid] || P[0];
            // face culling rules
            if (nid === id && (p.layer === 'transparent' || p.glass)) continue;   // water↔water, glass↔glass
            if (np.opaque) continue;                                              // hidden by a solid neighbour
            if (!p.doubleSided && nid !== 0 && np.layer === 'cutout') continue;

            const tile = f === 2 ? tiles[0] : f === 3 ? tiles[1] : tiles[2];
            const u0 = (tile % 16) / 16, v0 = 1 - (Math.floor(tile / 16) + 1) / 16;
            const ts = 1 / 16;
            const base = layer.verts;
            const ao = [];
            for (let vi = 0; vi < 4; vi++) {
              const [su, sv] = CORNERS[vi];
              const uu = su * 2 - 1, vv = sv * 2 - 1;
              const sx = nx + F.U[0] * uu, sy = ny + F.U[1] * uu, sz = nz + F.U[2] * uu;
              const tx = nx + F.V[0] * vv, ty = ny + F.V[1] * vv, tz = nz + F.V[2] * vv;
              const cx2 = sx + F.V[0] * vv, cy2 = sy + F.V[1] * vv, cz2 = sz + F.V[2] * vv;
              const s1 = occ(sx, sy, sz, id) ? 1 : 0;
              const s2 = occ(tx, ty, tz, id) ? 1 : 0;
              const s3 = occ(cx2, cy2, cz2, id) ? 1 : 0;
              ao.push(AO_LEVELS[s1 && s2 ? 0 : 3 - (s1 + s2 + s3)]);

              // vertex position
              const du = su - 0.5, dv = sv - 0.5;
              layer.pos.push3(
                wx + F.o[0] + F.U[0] * du + F.V[0] * dv,
                y + F.o[1] + F.U[1] * du + F.V[1] * dv,
                wz + F.o[2] + F.U[2] * du + F.V[2] * dv,
              );
              layer.nrm.push3(F.n[0], F.n[1], F.n[2]);
              layer.uv.push(u0 + su * ts * 0.999, v0 + sv * ts * 0.999);
              const l = ao[vi] * F.sh * (p.shade === undefined ? 1 : p.shade);
              layer.col.push3(tintCol.r * l, tintCol.g * l, tintCol.b * l);
            }
            // flip the quad so the AO interpolation has no anisotropy seam
            if (ao[0] + ao[2] > ao[1] + ao[3]) {
              layer.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
            } else {
              layer.idx.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
            }
            layer.verts += 4;
            this.stats.faces++;
          }
        }
      }
    }

    const meshes = [];
    for (const name of LAYERS) {
      const L = layers[name];
      if (!L || !L.idx.count) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(L.pos.out().slice(), 3));
      g.setAttribute('normal', new THREE.BufferAttribute(L.nrm.out().slice(), 3));
      g.setAttribute('uv', new THREE.BufferAttribute(L.uv.out().slice(), 2));
      g.setAttribute('color', new THREE.BufferAttribute(L.col.out().slice(), 3));
      g.setIndex(new THREE.BufferAttribute(L.idx.out(), 1));
      g.computeBoundingSphere();
      const mat = this.materials ? this.materials[name] : null;
      if (!mat) continue;
      const mesh = new THREE.Mesh(g, mat);
      mesh.name = 'chunk_' + ck + '_' + name;
      mesh.castShadow = name !== 'transparent';
      mesh.receiveShadow = true;
      mesh.renderOrder = name === 'transparent' ? 2 : 0;
      this.group.add(mesh);
      meshes.push(mesh);
    }
    this.chunks.set(ck, { meshes, dirty: false });
  }

  dispose() {
    for (const [, c] of this.chunks) for (const m of c.meshes) { this.group.remove(m); m.geometry.dispose(); }
    this.chunks.clear();
    this.blocks.clear();
    this.biomes.clear();
    while (this.group.children.length) this.group.remove(this.group.children[0]);
  }
}

// grass / leaf biome tint palette (index matches the biome field)
export const BIOME_TINT = [
  0x8db958,   // 0 plains — warm mid green
  0x6fae4f,   // 1 forest — deeper green
  0xa6c46a,   // 2 beach / dry — pale yellow-green
  0x7fb069,   // 3 swamp — olive
  0x9dc26b,   // 4 mountain — cool green
  0xbcd68a,   // 5 snow — frosty
];

// ─── helpers used by the world generator ───────────────────────────────────
export function box(world, x0, y0, z0, x1, y1, z1, id, biome = -1) {
  const [a, b] = x0 < x1 ? [x0, x1] : [x1, x0];
  const [c, d] = y0 < y1 ? [y0, y1] : [y1, y0];
  const [e, f] = z0 < z1 ? [z0, z1] : [z1, z0];
  for (let x = a; x <= b; x++) for (let y = c; y <= d; y++) for (let z = e; z <= f; z++) world.raw(x, y, z, id, biome);
}

export function fillIf(world, x, y, z, id, onlyAir = true, biome = -1) {
  if (onlyAir && world.get(x, y, z) !== 0) return false;
  world.raw(x, y, z, id, biome);
  return true;
}

/** axis-aligned DDA voxel ray — returns { x,y,z, nx,ny,nz, id } or null */
export function raycast(world, origin, dir, maxDist = 120) {
  let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
  const sx = dir.x > 0 ? 1 : -1, sy = dir.y > 0 ? 1 : -1, sz = dir.z > 0 ? 1 : -1;
  const idx = Math.abs(dir.x) < 1e-9 ? Infinity : (dir.x > 0 ? (x + 1 - origin.x) : (origin.x - x)) / Math.abs(dir.x);
  const idy = Math.abs(dir.y) < 1e-9 ? Infinity : (dir.y > 0 ? (y + 1 - origin.y) : (origin.y - y)) / Math.abs(dir.y);
  const idz = Math.abs(dir.z) < 1e-9 ? Infinity : (dir.z > 0 ? (z + 1 - origin.z) : (origin.z - z)) / Math.abs(dir.z);
  const ddx = Math.abs(dir.x) < 1e-9 ? Infinity : 1 / Math.abs(dir.x);
  const ddy = Math.abs(dir.y) < 1e-9 ? Infinity : 1 / Math.abs(dir.y);
  const ddz = Math.abs(dir.z) < 1e-9 ? Infinity : 1 / Math.abs(dir.z);
  let tx = idx, ty = idy, tz = idz, n = [0, 0, 0], t = 0;
  while (t <= maxDist) {
    const id = world.get(x, y, z);
    if (id && world.palette[id].solid) return { x, y, z, nx: n[0], ny: n[1], nz: n[2], id, dist: t };
    if (tx < ty && tx < tz) { x += sx; t = tx; tx += ddx; n = [-sx, 0, 0]; }
    else if (ty < tz) { y += sy; t = ty; ty += ddy; n = [0, -sy, 0]; }
    else { z += sz; t = tz; tz += ddz; n = [0, 0, -sz]; }
  }
  return null;
}

export const clampY = (y) => clamp(y, Y_MIN, Y_MAX - 1);
export { CHUNK, Y_MIN, Y_MAX };
