import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { G, tier } from './state.js';
import { Rand, clamp } from './util.js';
import { mat, skyTexture, getTex } from './tex.js';

// ══════════════════════════════════════════════════════════════
//  WORLD — procedural island: terrain, villages, trees, rocks,
//  water, sky and the shrinking zone, plus ALL collision data.
//
//  Performance strategy (this is what makes a 2 GB phone work):
//   • every static structure is baked into ONE merged mesh per
//     material (walls, roofs, wood, metal, glass) → ~8 draw calls
//     for 40+ buildings instead of 400
//   • vegetation is InstancedMesh (1 draw call per kind)
//   • per-object tint is baked into vertex colours so we never
//     need extra materials
//   • colliders live in a uniform spatial grid → O(1) lookups
// ══════════════════════════════════════════════════════════════

export const ISLAND_R = 116;      // playable radius in metres
export const WATER_Y = 0.15;

// ── value noise ────────────────────────────────────────────────
let NSEED = 1;
function hash2(ix, iz) {
  let n = (ix * 1619 + iz * 31337 + NSEED * 6971) | 0;
  n = (n << 13) ^ n;
  n = (n * (n * n * 15731 + 789221) + 1376312589) & 0x7fffffff;
  return 1 - n / 1073741824;           // -1 .. 1
}
const fade = (t) => t * t * (3 - 2 * t);
function vnoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = fade(x - ix), fz = fade(z - iz);
  const a = hash2(ix, iz), b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  const top = a + (b - a) * fx, bot = c + (d - c) * fx;
  return top + (bot - top) * fz;
}
function fbm(x, z) {
  return vnoise(x, z) * 0.58 + vnoise(x * 2.13 + 9.1, z * 2.13 - 4.7) * 0.27 + vnoise(x * 4.7 - 2.3, z * 4.7 + 8.2) * 0.13;
}
function smooth(a, b, x) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }

/** terrain height in metres — pure function, no geometry lookup */
export function heightAt(x, z) {
  const d = Math.hypot(x, z) / ISLAND_R;
  const land = 1 - smooth(0.58, 1.0, d);
  if (land <= 0) return -2.2 - (d - 1) * 8;
  const n = fbm(x * 0.0165, z * 0.0165);
  const ridge = Math.pow(Math.max(0, fbm(x * 0.0062 + 40, z * 0.0062 - 25)), 1.6) * 16;
  return (n * 5.4 + 1.5 + ridge) * land - (1 - land) * 3.2;
}

// ── colliders ──────────────────────────────────────────────────
// Boxes are ORIENTED (cx,cz,hw,hd,yaw): a rotated wall must not
// become a huge axis-aligned blob, or whole villages turn solid and
// every bullet gets eaten. Cylinders cover trees / rocks / barrels.
export class Colliders {
  constructor(cell = 8) {
    this.boxes = []; this.cyls = []; this.cell = cell;
    this.grid = new Map(); this._q = []; this._seen = new Set();
  }
  /** b: {cx,cz,hw,hd,yaw,y0,y1} */
  addBox(b) {
    b.cos = Math.cos(b.yaw); b.sin = Math.sin(b.yaw);
    const ex = Math.abs(b.hw * b.cos) + Math.abs(b.hd * b.sin);
    const ez = Math.abs(b.hw * b.sin) + Math.abs(b.hd * b.cos);
    b.x0 = b.cx - ex; b.x1 = b.cx + ex; b.z0 = b.cz - ez; b.z1 = b.cz + ez;
    const i = this.boxes.push(b) - 1;
    this._index(i, b.x0, b.z0, b.x1, b.z1);
  }
  addCyl(c) { const i = this.cyls.push(c) - 1; this._index(-1 - i, c.x - c.r, c.z - c.r, c.x + c.r, c.z + c.r); }
  _key(cx, cz) { return ((cx * 73856093) ^ (cz * 19349663)) | 0; }
  _index(id, x0, z0, x1, z1) {
    const c = this.cell;
    for (let gx = Math.floor(x0 / c); gx <= Math.floor(x1 / c); gx++)
      for (let gz = Math.floor(z0 / c); gz <= Math.floor(z1 / c); gz++) {
        const k = this._key(gx, gz);
        let a = this.grid.get(k); if (!a) { a = []; this.grid.set(k, a); }
        a.push(id);
      }
  }
  query(x0, z0, x1, z1, out) {
    out = out || []; out.length = 0;
    const c = this.cell, seen = this._seen; seen.clear();
    for (let gx = Math.floor(x0 / c); gx <= Math.floor(x1 / c); gx++)
      for (let gz = Math.floor(z0 / c); gz <= Math.floor(z1 / c); gz++) {
        const a = this.grid.get(this._key(gx, gz));
        if (!a) continue;
        for (let i = 0; i < a.length; i++) { const id = a[i]; if (!seen.has(id)) { seen.add(id); out.push(id); } }
      }
    return out;
  }
  _hits(b, y) { return !(y + 1.7 < b.y0 || y > b.y1); }
  /** push a circle of radius r (feet at height y) out of every solid */
  resolve(pos, r, y, stepH = 1.05) {
    const ids = this.query(pos.x - r - 0.1, pos.z - r - 0.1, pos.x + r + 0.1, pos.z + r + 0.1, this._q);
    let hit = false;
    for (let k = 0; k < ids.length; k++) {
      const id = ids[k];
      if (id >= 0) {
        const b = this.boxes[id];
        if (!this._hits(b, y) || b.y0 - y > stepH) continue;
        const dx = pos.x - b.cx, dz = pos.z - b.cz;
        const lx = dx * b.cos + dz * b.sin;
        const lz = -dx * b.sin + dz * b.cos;
        const qx = clamp(lx, -b.hw, b.hw), qz = clamp(lz, -b.hd, b.hd);
        let ox = lx - qx, oz = lz - qz;
        const d2 = ox * ox + oz * oz;
        if (d2 > r * r) continue;
        hit = true;
        let nlx, nlz;
        if (d2 > 1e-7) {
          // push from the closest point on the box out to exactly radius r
          const d = Math.sqrt(d2);
          nlx = qx + (ox / d) * r;
          nlz = qz + (oz / d) * r;
        } else {
          // centre is inside the box: eject along the shallowest axis
          const ex = b.hw + r - Math.abs(lx), ez = b.hd + r - Math.abs(lz);
          if (ex < ez) { nlx = lx >= 0 ? b.hw + r : -(b.hw + r); nlz = lz; }
          else { nlz = lz >= 0 ? b.hd + r : -(b.hd + r); nlx = lx; }
        }
        pos.x = b.cx + nlx * b.cos - nlz * b.sin;
        pos.z = b.cz + nlx * b.sin + nlz * b.cos;
      } else {
        const c = this.cyls[-1 - id];
        if (y + 1.7 < c.y0 || y > c.y1) continue;
        const dx = pos.x - c.x, dz = pos.z - c.z;
        const rr = r + c.r, d2 = dx * dx + dz * dz;
        if (d2 > rr * rr || d2 < 1e-9) continue;
        const d = Math.sqrt(d2), push = (rr - d) / d;
        pos.x += dx * push; pos.z += dz * push;
        hit = true;
      }
    }
    return hit;
  }
  /** is the 2D segment blocked by anything spanning height y? */
  segmentBlocked(ax, az, bx, bz, y) {
    const ids = this.query(Math.min(ax, bx) - 0.6, Math.min(az, bz) - 0.6, Math.max(ax, bx) + 0.6, Math.max(az, bz) + 0.6, this._q);
    for (let k = 0; k < ids.length; k++) {
      const id = ids[k];
      if (id >= 0) {
        const b = this.boxes[id];
        if (y < b.y0 - 0.35 || y > b.y1 + 0.25) continue;
        // rotate the segment into box space, then Liang-Barsky
        const ox = ax - b.cx, oz = az - b.cz;
        const ex = bx - b.cx, ez = bz - b.cz;
        const p0x = ox * b.cos + oz * b.sin, p0z = -ox * b.sin + oz * b.cos;
        const p1x = ex * b.cos + ez * b.sin, p1z = -ex * b.sin + ez * b.cos;
        if (segBox(p0x, p0z, p1x - p0x, p1z - p0z, -b.hw, -b.hd, b.hw, b.hd)) return true;
      } else {
        const c = this.cyls[-1 - id];
        if (y < c.y0 - 0.35 || y > c.y1 + 0.25) continue;
        const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz || 1e-9;
        const t = clamp(((c.x - ax) * dx + (c.z - az) * dz) / len2, 0, 1);
        const px = ax + dx * t, pz = az + dz * t;
        if ((px - c.x) ** 2 + (pz - c.z) ** 2 < c.r * c.r) return true;
      }
    }
    return false;
  }
  /**
   * Line of sight. Pass y1 for a sloped line (eye -> eye on a hill): the ray is
   * split into chunks and each chunk is tested at its own height, because
   * colliders are height gated and a flat ray at the HIGH end flies over roofs.
   */
  los(ax, az, bx, bz, y = 1.5, y1) {
    if (y1 === undefined || Math.abs(y1 - y) < 0.6) return !this.segmentBlocked(ax, az, bx, bz, y);
    const N = 4, dx = bx - ax, dz = bz - az;
    for (let i = 0; i < N; i++) {
      const t0 = i / N, t1 = (i + 1) / N;
      const ym = y + (y1 - y) * ((t0 + t1) * 0.5);
      if (this.segmentBlocked(ax + dx * t0, az + dz * t0, ax + dx * t1, az + dz * t1, ym)) return false;
    }
    return true;
  }
}
function segBox(ax, az, dx, dz, x0, z0, x1, z1) {
  let t0 = 0, t1 = 1;
  const p = [-dx, dx, -dz, dz], q = [ax - x0, x1 - ax, az - z0, z1 - az];
  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]) < 1e-9) { if (q[i] < 0) return false; continue; }
    const r = q[i] / p[i];
    if (p[i] < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
    else { if (r < t0) return false; if (r < t1) t1 = r; }
  }
  return true;
}

// ── static geometry baker ──────────────────────────────────────
const UNIT = {};
function unitGeo() {
  if (UNIT.box) return;
  const seg = G.tier === 0 ? 6 : G.tier === 1 ? 8 : 12;
  UNIT.box = new THREE.BoxGeometry(1, 1, 1);
  UNIT.cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, seg);
  UNIT.cone = new THREE.ConeGeometry(0.5, 1, seg);
  UNIT.plane = new THREE.PlaneGeometry(1, 1);
  UNIT.ico = new THREE.IcosahedronGeometry(0.5, 0);
  UNIT.dodeca = new THREE.DodecahedronGeometry(0.5, 0);
  UNIT.sphere = new THREE.SphereGeometry(0.5, seg, Math.max(4, seg >> 1));
}

class Baker {
  constructor() { this.groups = new Map(); }
  /** geo: unit geometry, m: Matrix4, color: hex tint baked into vertex colours */
  add(key, geo, m, color) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.applyMatrix4(m);
    const n = g.attributes.position.count;
    const c = new Float32Array(n * 3);
    _col.setHex(color === undefined ? 0xffffff : color);
    for (let i = 0; i < n; i++) { c[i * 3] = _col.r; c[i * 3 + 1] = _col.g; c[i * 3 + 2] = _col.b; }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    // keep attributes identical across the group so mergeGeometries is happy
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    let list = this.groups.get(key);
    if (!list) { list = []; this.groups.set(key, list); }
    list.push(g);
  }
  build(scene, matFor) {
    const made = [];
    for (const [key, list] of this.groups) {
      if (!list.length) continue;
      let merged;
      try { merged = list.length === 1 ? list[0] : mergeGeometries(list, false); }
      catch (e) { merged = list[0]; }
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, matFor(key));
      mesh.castShadow = tier().shadows;
      mesh.receiveShadow = tier().shadows;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      scene.add(mesh);
      made.push(mesh);
      list.forEach((g) => { if (g !== merged) g.dispose(); });
    }
    this.groups.clear();
    return made;
  }
}
const _col = new THREE.Color();
const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler(); _e.order = 'YXZ';   // local tilt first, then yaw
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();

/** place a unit geometry: put(baker,key,geo,x,y,z,sx,sy,sz,yaw,rotX,color) */
function put(baker, key, geo, x, y, z, sx, sy, sz, yaw = 0, rotX = 0, color = 0xffffff) {
  _e.set(rotX, yaw, 0);
  _q.setFromEuler(_e);
  _v.set(x, y, z);
  _s.set(sx, sy, sz);
  _m4.compose(_v, _q, _s);
  baker.add(key, geo, _m4, color);
}

// ── build ──────────────────────────────────────────────────────
export function buildWorld(scene, seed) {
  unitGeo();
  const T = tier();
  const rnd = new Rand(seed);
  NSEED = seed;
  const W = {
    seed, group: new THREE.Group(), col: new Colliders(8), baker: new Baker(),
    buildings: [], lootSpots: [], landPoints: [], meshes: [], platforms: [],
    heightAt, groundAt: (x, z) => groundAt(W, x, z),
    zoneMesh: null, zoneRing: null, water: null, sun: null, sky: null,
  };
  scene.add(W.group);

  for (let i = 0; i < 900; i++) {
    const a = rnd.range(0, Math.PI * 2), d = Math.sqrt(rnd.n()) * (ISLAND_R - 8);
    const x = Math.cos(a) * d, z = Math.sin(a) * d, h = heightAt(x, z);
    if (h > 0.7) W.landPoints.push({ x, z, h });
  }
  if (!W.landPoints.length) W.landPoints.push({ x: 0, z: 0, h: heightAt(0, 0) });

  buildSky(scene, W, rnd);
  buildLights(scene, W, T);
  buildTerrain(W, T);
  buildWater(W);
  buildVillages(W, T, rnd);
  buildVegetation(W, T, rnd);
  buildZone(W);
  W.meshes = W.baker.build(W.group, matForBaked);
  return W;
}

/** materials for the merged static batches */
const bakedMats = new Map();
function matForBaked(key) {
  if (bakedMats.has(key)) return bakedMats.get(key);
  const std = G.tier > 0;
  const mk = (o) => { const m = std ? new THREE.MeshStandardMaterial(o) : new THREE.MeshLambertMaterial(o); m.vertexColors = true; return m; };
  let m;
  switch (key) {
    case 'concrete': m = mk({ map: getTex('concrete'), roughness: .95 }); break;
    case 'brick': m = mk({ map: getTex('brick'), roughness: .95 }); break;
    case 'wood': m = mk({ map: getTex('wood'), roughness: .92 }); break;
    case 'roof': m = mk({ map: getTex('roof'), roughness: .88 }); break;
    case 'metal': m = mk({ map: getTex('metal'), roughness: .5, metalness: .6 }); break;
    case 'stone': m = mk({ map: getTex('rock'), roughness: .95 }); break;
    case 'glass': m = new THREE.MeshStandardMaterial({ color: 0x1b2b34, roughness: .12, metalness: .5, emissive: 0x2a4a5a, emissiveIntensity: .55, vertexColors: true }); break;
    default: m = mk({ color: 0xffffff, roughness: .9 });
  }
  bakedMats.set(key, m);
  return m;
}

// ── sky ────────────────────────────────────────────────────────
function buildSky(scene, W, rnd) {
  const g = new THREE.SphereGeometry(560, G.tier === 0 ? 10 : 16, G.tier === 0 ? 7 : 10);
  const m = new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide, fog: false, depthWrite: false });
  W.sky = new THREE.Mesh(g, m);
  W.sky.renderOrder = -1;
  scene.add(W.sky);
  if (G.tier > 0) {
    const cm = new THREE.SpriteMaterial({ map: getTex('sand'), color: 0xffffff, transparent: true, opacity: .26, depthWrite: false, fog: false });
    W.clouds = [];
    for (let i = 0; i < (G.tier === 2 ? 12 : 6); i++) {
      const s = new THREE.Sprite(cm);
      const a = rnd.range(0, 6.283), r = rnd.range(200, 400);
      s.position.set(Math.cos(a) * r, rnd.range(75, 150), Math.sin(a) * r);
      s.scale.set(rnd.range(95, 200), rnd.range(24, 48), 1);
      scene.add(s); W.clouds.push(s);
    }
  }
}

// ── lights ─────────────────────────────────────────────────────
function buildLights(scene, W, T) {
  scene.add(new THREE.HemisphereLight(0xa8d4f5, 0x4a5c30, G.tier === 0 ? 1.25 : 0.95));
  scene.add(new THREE.AmbientLight(0xffffff, G.tier === 0 ? 0.3 : 0.2));
  const sun = new THREE.DirectionalLight(0xfff1cf, G.tier === 0 ? 1.55 : 1.9);
  sun.position.set(78, 118, 46);
  if (T.shadows) {
    sun.castShadow = true;
    const s = 58;
    sun.shadow.camera.left = -s; sun.shadow.camera.right = s;
    sun.shadow.camera.top = s; sun.shadow.camera.bottom = -s;
    sun.shadow.camera.near = 20; sun.shadow.camera.far = 300;
    sun.shadow.mapSize.set(T.shadowMap, T.shadowMap);
    sun.shadow.bias = -0.0011;
    sun.shadow.normalBias = 0.05;
    scene.add(sun.target);
  }
  scene.add(sun);
  W.sun = sun;
}
export function updateSun(W, x, z) {
  if (!W.sun || !W.sun.castShadow) return;
  W.sun.position.set(x + 66, 112, z + 44);
  W.sun.target.position.set(x, 0, z);
  W.sun.target.updateMatrixWorld();
}

// ── terrain ────────────────────────────────────────────────────
function buildTerrain(W, T) {
  const seg = G.tier === 0 ? 80 : G.tier === 1 ? 124 : 164;
  const size = ISLAND_R * 2 + 96;
  const g = new THREE.PlaneGeometry(size, size, seg, seg);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  const colors = new Float32Array(p.count * 3);
  const cSand = new THREE.Color(0xd8c093), cGrass = new THREE.Color(0x5c7f35),
    cGrass2 = new THREE.Color(0x74a041), cRock = new THREE.Color(0x7d786d), cHigh = new THREE.Color(0xb9b39c);
  const tmp = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    const h = heightAt(x, z);
    p.setY(i, h);
    const slope = Math.abs(heightAt(x + 2, z) - h) + Math.abs(heightAt(x, z + 2) - h);
    const n = (vnoise(x * 0.09, z * 0.09) + 1) * 0.5;
    if (h < 0.95) tmp.copy(cSand);
    else if (h > 15) tmp.copy(cHigh).lerp(cRock, clamp((20 - h) / 5, 0, 1));
    else if (slope > 2.1) tmp.copy(cRock);
    else tmp.copy(cGrass).lerp(cGrass2, n);
    const sh2 = 0.9 + n * 0.18;
    colors[i * 3] = tmp.r * sh2; colors[i * 3 + 1] = tmp.g * sh2; colors[i * 3 + 2] = tmp.b * sh2;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  if (G.tier > 0) m.map = getTex('grass');
  const mesh = new THREE.Mesh(g, m);
  mesh.receiveShadow = T.shadows;
  mesh.matrixAutoUpdate = false; mesh.updateMatrix();
  W.group.add(mesh);
  W.terrain = mesh;
}

// ── water ──────────────────────────────────────────────────────
function buildWater(W) {
  const g = new THREE.CircleGeometry(ISLAND_R + 300, G.tier === 0 ? 18 : 32);
  g.rotateX(-Math.PI / 2);
  const w = new THREE.Mesh(g, mat('water'));
  w.position.y = WATER_Y;
  w.matrixAutoUpdate = false; w.updateMatrix();
  W.group.add(w);
  W.water = w;
}
export function animateWater(W, t) {
  if (!W.water || !W.water.material.map) return;
  const m = W.water.material.map;
  m.offset.set(Math.sin(t * 0.05) * 0.04, t * 0.009);
}

// ── villages ───────────────────────────────────────────────────
const NAMES = ['Douar', 'Casbah', 'Port', 'Medina', 'Souk', 'Ksar', 'Riad', 'Oasis', 'Phare', 'Atlas', 'Sahra', 'Tanger', 'Agadir', 'Zawiya'];
const CONT_COLORS = [0xb4472f, 0x2f6b8f, 0x6a8f2f, 0xa8862f, 0x7a4a8f, 0x8f5a2f];
const BARREL_COLORS = [0x9c4a2a, 0x3d6b4a, 0x7a7a7a, 0x6a4a2a];

function buildVillages(W, T, rnd) {
  const bk = W.baker;
  const clusters = G.tier === 0 ? 7 : G.tier === 1 ? 9 : 11;
  let ci = 0;
  for (let c = 0; c < clusters; c++) {
    let bx = 0, bz = 0, bh = 0, best = -1e9;
    for (let tries = 0; tries < 24; tries++) {
      const p = rnd.pick(W.landPoints);
      const flat = 4 - (Math.abs(heightAt(p.x + 4, p.z) - p.h) + Math.abs(heightAt(p.x, p.z + 4) - p.h));
      let minD = 1e9;
      for (const b of W.buildings) minD = Math.min(minD, Math.hypot(b.x - p.x, b.z - p.z));
      const score = flat * 6 + Math.min(minD, 70) * 0.7 - Math.hypot(p.x, p.z) * 0.05;
      if (score > best) { best = score; bx = p.x; bz = p.z; bh = p.h; }
    }
    if (bh < 1.1) continue;
    const label = NAMES[ci++ % NAMES.length];
    const count = rnd.int(3, 6);
    for (let i = 0; i < count; i++) {
      const a = rnd.range(0, 6.283), rr = i === 0 ? 0 : rnd.range(8, 23);
      const x = bx + Math.cos(a) * rr, z = bz + Math.sin(a) * rr;
      const h = heightAt(x, z);
      if (h < 1.0) continue;
      makeBuilding(W, rnd, x, z, h, rnd.range(6.5, 11.5), rnd.range(6, 10.5), rnd.range(0, 6.283), label);
    }
    for (let i = 0; i < rnd.int(2, 5); i++) {
      const a = rnd.range(0, 6.283), rr = rnd.range(9, 25);
      const x = bx + Math.cos(a) * rr, z = bz + Math.sin(a) * rr, h = heightAt(x, z);
      if (h < 0.8) continue;
      if (rnd.chance(0.5)) makeContainer(W, rnd, x, z, h);
      else makeCrates(W, rnd, x, z, h);
    }
  }
  for (let i = 0; i < 3; i++) {
    let best = null;
    for (let t = 0; t < 30; t++) { const p = rnd.pick(W.landPoints); if (!best || p.h > best.h) best = p; }
    if (best && best.h > 8) makeTower(W, rnd, best.x, best.z, best.h);
  }
  makePier(W, rnd);
  for (let i = 0; i < (G.tier === 0 ? 10 : 22); i++) {
    const p = rnd.pick(W.landPoints);
    if (p.h < 1.2) continue;
    if (rnd.chance(0.45)) makeFence(W, rnd, p.x, p.z, p.h);
    else makeBarrels(W, rnd, p.x, p.z, p.h);
  }
}

function makeBuilding(W, rnd, x, z, y, w, d, yaw, label) {
  const bk = W.baker;
  const wallH = rnd.chance(0.28) ? 6.2 : 3.5;
  const th = 0.34;
  const hw = w / 2, hd = d / 2;
  const wallKey = rnd.chance(0.42) ? 'brick' : 'concrete';
  const tint = rnd.chance(0.5) ? 0xffffff : rnd.pick([0xe8ddc8, 0xd8cbb4, 0xcfc0a8, 0xe0d0b8]);
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const rot = (lx, lz) => ({ x: x + lx * cy - lz * sy, z: z + lx * sy + lz * cy });

  const sides = [[[-hw, -hd], [hw, -hd]], [[hw, -hd], [hw, hd]], [[hw, hd], [-hw, hd]], [[-hw, hd], [-hw, -hd]]];
  const doorSide = rnd.int(0, 3);
  const dp = rnd.range(0.3, 0.7);
  const doorW = 1.3;

  const wallSeg = (ax, az, bx2, bz2) => {
    const p1 = rot(ax, az), p2 = rot(bx2, bz2);
    const dx = p2.x - p1.x, dz = p2.z - p1.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.25) return;
    const a = Math.atan2(dx, dz) + Math.PI / 2;
    put(bk, wallKey, UNIT.box, (p1.x + p2.x) / 2, y + wallH / 2, (p1.z + p2.z) / 2, len, wallH, th, a, 0, tint);
    // oriented collider that follows the wall exactly (no AABB blob)
    W.col.addBox({
      cx: (p1.x + p2.x) / 2, cz: (p1.z + p2.z) / 2,
      hw: len / 2 + 0.05, hd: th / 2 + 0.05, yaw: Math.atan2(dz, dx),
      y0: y, y1: y + wallH,
    });
  };

  sides.forEach((s, i) => {
    const [a, b] = s;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (i === doorSide) {
      const k = doorW / len;
      wallSeg(a[0], a[1], a[0] + (b[0] - a[0]) * (dp - k / 2), a[1] + (b[1] - a[1]) * (dp - k / 2));
      wallSeg(a[0] + (b[0] - a[0]) * (dp + k / 2), a[1] + (b[1] - a[1]) * (dp + k / 2), b[0], b[1]);
      // lintel
      const lp = rot(a[0] + (b[0] - a[0]) * dp, a[1] + (b[1] - a[1]) * dp);
      const la = Math.atan2(b[0] - a[0], b[1] - a[1]) + Math.PI / 2;
      put(bk, wallKey, UNIT.box, lp.x, y + 2.15 + (wallH - 2.15) / 2, lp.z, doorW + 0.6, wallH - 2.15, th, la, 0, tint);
    } else wallSeg(a[0], a[1], b[0], b[1]);
  });

  // windows
  const nWin = rnd.int(1, 3);
  for (let i = 0; i < nWin; i++) {
    const side = rnd.int(0, 3);
    const [a, b] = sides[side];
    const t = rnd.range(0.18, 0.82);
    const p = rot(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
    const ang = Math.atan2(b[0] - a[0], b[1] - a[1]) + Math.PI / 2;
    const nx = Math.cos(ang) * (th / 2 + 0.03), nz = -Math.sin(ang) * (th / 2 + 0.03);
    put(bk, 'glass', UNIT.plane, p.x + nx, y + 2.0, p.z + nz, 1.15, 1.0, 1, ang + Math.PI / 2, 0, 0xffffff);
  }

  // floor
  put(bk, 'wood', UNIT.box, x, y + 0.11, z, w, 0.22, d, yaw, 0, 0xc9b48d);

  if (rnd.chance(0.5)) {
    put(bk, 'concrete', UNIT.box, x, y + wallH + 0.15, z, w + 0.7, 0.3, d + 0.7, yaw, 0, tint);
    for (let i = 0; i < 4; i++) {
      const lx = i === 1 ? hw + 0.3 : i === 3 ? -hw - 0.3 : 0;
      const lz = i === 0 ? -hd - 0.3 : i === 2 ? hd + 0.3 : 0;
      const p = rot(lx, lz);
      put(bk, wallKey, UNIT.box, p.x, y + wallH + 0.55, p.z, i % 2 ? 0.22 : w + 0.7, 0.5, i % 2 ? d + 0.7 : 0.22, yaw, 0, tint);
    }
  } else {
    const slope = 0.62, rise = Math.tan(slope) * (d / 2 + 0.5);
    const slabLen = Math.hypot(d / 2 + 0.5, rise);
    for (const s of [-1, 1]) {
      const lz = s * (d / 4 + 0.25);
      const p = rot(0, lz);
      put(bk, 'roof', UNIT.box, p.x, y + wallH + rise / 2 + 0.1, p.z, w + 1.0, 0.18, slabLen, yaw, s * slope, 0xffffff);
    }
    // gable ends
    for (const s of [-1, 1]) {
      const p = rot(s * hw, 0);
      put(bk, wallKey, UNIT.box, p.x, y + wallH + rise / 2, p.z, 0.2, rise, d, yaw, 0, tint);
    }
  }

  W.buildings.push({ x, z, y, w, d, yaw, wallH, label, kind: 'building' });
  W.lootSpots.push({ x, z, y: y + 0.25, inside: true, label });
  for (let i = 0; i < 2; i++) {
    const a = yaw + rnd.range(0, 6.283), rr = rnd.range(w * 0.75, w * 1.6);
    const lx = x + Math.cos(a) * rr, lz = z + Math.sin(a) * rr, lh = heightAt(lx, lz);
    if (lh > 0.6) W.lootSpots.push({ x: lx, z: lz, y: lh, inside: false, label });
  }
}

function makeContainer(W, rnd, x, z, y) {
  const yaw = rnd.range(0, 6.283);
  put(W.baker, 'metal', UNIT.box, x, y + 1.3, z, 6.1, 2.6, 2.5, yaw, 0, rnd.pick(CONT_COLORS));
  W.col.addBox({ cx: x, cz: z, hw: 3.05, hd: 1.25, yaw: -yaw, y0: y, y1: y + 2.6 });
  W.platforms.push({ cx: x, cz: z, hw: 3.05, hd: 1.25, yaw: -yaw, top: y + 2.6 });
}
function makeCrates(W, rnd, x, z, y) {
  const n = rnd.int(1, 3);
  for (let i = 0; i < n; i++) {
    const s = rnd.range(0.9, 1.5);
    const cx = x + rnd.range(-1, 1), cz = z + rnd.range(-1, 1), cy2 = heightAt(cx, cz);
    const yy = cy2 + s / 2 + (i > 0 ? rnd.range(0, 1.0) : 0);
    const cyaw = rnd.range(0, 1.2);
    put(W.baker, 'wood', UNIT.box, cx, yy, cz, s, s, s, cyaw, 0, 0xd8c093);
    W.col.addBox({ cx, cz, hw: s / 2, hd: s / 2, yaw: -cyaw, y0: yy - s / 2, y1: yy + s / 2 });
  }
}
function makeBarrels(W, rnd, x, z, y) {
  for (let i = 0; i < rnd.int(1, 3); i++) {
    const bx = x + rnd.range(-1.6, 1.6), bz = z + rnd.range(-1.6, 1.6), bh = heightAt(bx, bz);
    if (bh < 0.3) continue;
    put(W.baker, 'metal', UNIT.cyl, bx, bh + 0.575, bz, 0.88, 1.15, 0.88, rnd.range(0, 3), 0, rnd.pick(BARREL_COLORS));
    W.col.addCyl({ x: bx, z: bz, r: 0.44, y0: bh, y1: bh + 1.15 });
  }
}
function makeFence(W, rnd, x, z, y) {
  const yaw = rnd.range(0, 6.283), len = rnd.range(5, 11);
  const n = Math.floor(len / 1.7);
  for (let i = 0; i < n; i++) {
    const t = (i / n - 0.5) * len;
    const px = x + Math.cos(yaw) * t, pz = z + Math.sin(yaw) * t, ph = heightAt(px, pz);
    if (ph < 0.5) continue;
    put(W.baker, 'wood', UNIT.box, px, ph + 0.62, pz, 0.14, 1.25, 0.14, yaw, 0, 0xc9b48d);
  }
  for (const ry of [0.45, 0.95]) {
    const mx = x, mz = z;
    put(W.baker, 'wood', UNIT.box, mx, y + ry, mz, len, 0.11, 0.08, yaw, 0, 0xc9b48d);
  }
  W.col.addBox({ cx: x, cz: z, hw: len / 2, hd: 0.09, yaw: -yaw, y0: y, y1: y + 1.1 });
}
function makeTower(W, rnd, x, z, y) {
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * 6.283 + 0.785;
    put(W.baker, 'wood', UNIT.box, x + Math.cos(a) * 1.5, y + 4.5, z + Math.sin(a) * 1.5, 0.28, 9, 0.28, 0, 0, 0xc9b48d);
  }
  put(W.baker, 'wood', UNIT.box, x, y + 8.6, z, 4.2, 0.3, 4.2, 0, 0, 0xc9b48d);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * 6.283;
    put(W.baker, 'wood', UNIT.box, x + Math.cos(a) * 2.0, y + 9.2, z + Math.sin(a) * 2.0, 4.2, 1.0, 0.18, -a + Math.PI / 2, 0, 0xc9b48d);
  }
  put(W.baker, 'roof', UNIT.box, x, y + 10.4, z, 4.8, 0.24, 4.8, 0.4, 0, 0xffffff);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * 6.283 + 0.785;
    W.col.addCyl({ x: x + Math.cos(a) * 1.5, z: z + Math.sin(a) * 1.5, r: 0.18, y0: y, y1: y + 8.4 });
  }
  W.platforms.push({ cx: x, cz: z, hw: 2.1, hd: 2.1, yaw: 0, top: y + 8.75 });
  W.lootSpots.push({ x, z, y: y + 8.8, inside: false, label: 'Tower', high: true });
}
function makePier(W, rnd) {
  let best = null;
  for (let i = 0; i < 500; i++) {
    const a = rnd.range(0, 6.283);
    const x = Math.cos(a) * (ISLAND_R - 12), z = Math.sin(a) * (ISLAND_R - 12);
    const h = heightAt(x, z);
    if (h > 0.3 && h < 2.4 && heightAt(x + Math.cos(a) * 16, z + Math.sin(a) * 16) < 0.2) { best = { x, z, h, a }; break; }
  }
  if (!best) return;
  const len = 26, cy = Math.cos(best.a), sy = Math.sin(best.a);
  put(W.baker, 'wood', UNIT.box, best.x + cy * len / 2, 1.25, best.z + sy * len / 2, 3.6, 0.28, len, -best.a + Math.PI / 2, 0, 0xbda57c);
  for (let i = 0; i < 7; i++) {
    const t = i / 6;
    const px = best.x + cy * len * t, pz = best.z + sy * len * t;
    for (const s of [-1, 1])
      put(W.baker, 'wood', UNIT.cyl, px - sy * 1.6 * s, -0.4, pz + cy * 1.6 * s, 0.34, 3.4, 0.34, 0, 0, 0x9c8663);
  }
  W.platforms.push({ cx: best.x + cy * len / 2, cz: best.z + sy * len / 2, hw: len / 2, hd: 1.8, yaw: best.a, top: 1.39 });
  for (let i = 0; i < 3; i++) {
    const t = 0.3 + i * 0.3;
    W.lootSpots.push({ x: best.x + cy * len * t, z: best.z + sy * len * t, y: 1.45, inside: false, label: 'Pier' });
  }
}

// ── vegetation (instanced) ─────────────────────────────────────
function buildVegetation(W, T, rnd) {
  const sh = T.shadows;
  const near = (x, z) => W.buildings.some((b) => Math.hypot(b.x - x, b.z - z) < Math.max(b.w, b.d) * 0.85 + 3);
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), V = new THREE.Vector3(), S = new THREE.Vector3();
  const col = new THREE.Color();

  const instanced = (geo, material, list, fill) => {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(geo, material, list.length);
    list.forEach((o, i) => {
      E.set(o.rx || 0, o.yaw || 0, o.rz || 0); Q.setFromEuler(E);
      V.set(o.x, o.y, o.z); S.set(o.sx, o.sy, o.sz);
      M.compose(V, Q, S); im.setMatrixAt(i, M);
      if (o.color !== undefined) { col.setHex(o.color); im.setColorAt(i, col); }
    });
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.castShadow = sh; im.receiveShadow = sh; im.frustumCulled = false;
    W.group.add(im);
    return im;
  };

  // trees
  const tp = [];
  for (let i = 0; i < T.trees * 4 && tp.length < T.trees; i++) {
    const a = rnd.range(0, 6.283), d = Math.sqrt(rnd.n()) * (ISLAND_R - 4);
    const x = Math.cos(a) * d, z = Math.sin(a) * d, h = heightAt(x, z);
    if (h < 1.3 || h > 17 || near(x, z)) continue;
    tp.push({ x, z, h, s: rnd.range(0.75, 1.5), kind: rnd.chance(0.45) ? 1 : 0, yaw: rnd.range(0, 6.28), tilt: rnd.range(-0.06, 0.06) });
  }
  if (tp.length) {
    const trunkG = new THREE.CylinderGeometry(0.2, 0.34, 1, G.tier === 0 ? 5 : 7);
    const pineG = new THREE.ConeGeometry(1.9, 1, G.tier === 0 ? 6 : 8);
    const blobG = new THREE.IcosahedronGeometry(2.1, G.tier === 2 ? 1 : 0);
    const trunks = [], pines = [], blobs = [];
    tp.forEach((t) => {
      const hgt = 3.4 * t.s * rnd.range(0.9, 1.2);
      trunks.push({ x: t.x, y: t.h - 0.15 + hgt / 2, z: t.z, sx: t.s, sy: hgt, sz: t.s, yaw: t.yaw, rx: t.tilt, color: 0x5b4227 });
      const cc = new THREE.Color().setHSL(rnd.range(0.22, 0.3), rnd.range(0.35, 0.6), rnd.range(0.2, 0.34)).getHex();
      if (t.kind) pines.push({ x: t.x, y: t.h - 0.15 + hgt + 2.4 * t.s, z: t.z, sx: t.s, sy: 5.2 * t.s, sz: t.s, yaw: t.yaw, color: cc });
      else blobs.push({ x: t.x, y: t.h - 0.15 + hgt + 1.5 * t.s, z: t.z, sx: t.s, sy: t.s * rnd.range(0.85, 1.2), sz: t.s, yaw: t.yaw, color: cc });
      W.col.addCyl({ x: t.x, z: t.z, r: 0.34 * t.s, y0: t.h - 0.2, y1: t.h + hgt });
    });
    instanced(trunkG, mat('trunk'), trunks);
    instanced(pineG, mat('leaf'), pines);
    instanced(blobG, mat('leaf2'), blobs);
    W.treeCount = tp.length;
  }

  // rocks
  const rp = [];
  for (let i = 0; i < T.rocks * 4 && rp.length < T.rocks; i++) {
    const a = rnd.range(0, 6.283), d = Math.sqrt(rnd.n()) * (ISLAND_R - 2);
    const x = Math.cos(a) * d, z = Math.sin(a) * d, h = heightAt(x, z);
    if (h < -0.4 || near(x, z)) continue;
    const s = rnd.range(0.5, 2.4);
    rp.push({ x, y: h + s * 0.2, z, sx: s, sy: s * rnd.range(0.55, 0.95), sz: s * rnd.range(0.8, 1.2), yaw: rnd.range(0, 6.28), rx: rnd.range(0, 3.14), color: new THREE.Color().setHSL(0.09, rnd.range(0.02, 0.1), rnd.range(0.3, 0.52)).getHex() });
    if (s > 0.85) W.col.addCyl({ x, z, r: s * 0.8, y0: h - 0.5, y1: h + s * 1.3 });
  }
  instanced(new THREE.DodecahedronGeometry(1, 0), mat('rock'), rp);

  // bushes
  const bp = [];
  for (let i = 0; i < T.bushes * 3 && bp.length < T.bushes; i++) {
    const a = rnd.range(0, 6.283), d = Math.sqrt(rnd.n()) * (ISLAND_R - 6);
    const x = Math.cos(a) * d, z = Math.sin(a) * d, h = heightAt(x, z);
    if (h < 0.8) continue;
    const s = rnd.range(0.6, 1.5);
    bp.push({ x, y: h + s * 0.3, z, sx: s, sy: s * rnd.range(0.7, 1.1), sz: s, yaw: rnd.range(0, 6.28), color: new THREE.Color().setHSL(rnd.range(0.2, 0.29), rnd.range(0.4, 0.65), rnd.range(0.16, 0.29)).getHex() });
  }
  instanced(new THREE.IcosahedronGeometry(0.85, 0), mat('leaf'), bp);

  // grass tufts
  if (T.grass > 0) {
    const gp = [];
    for (let i = 0; i < T.grass * 3 && gp.length < T.grass * 2; i++) {
      const a = rnd.range(0, 6.283), d = Math.sqrt(rnd.n()) * (ISLAND_R - 8);
      const x = Math.cos(a) * d, z = Math.sin(a) * d, h = heightAt(x, z);
      if (h < 1.0 || h > 14) continue;
      const s = rnd.range(0.6, 1.5);
      gp.push({ x, y: h + 0.3 * s, z, sx: s * 0.7, sy: s * 0.75, sz: 1, yaw: rnd.range(0, 6.28), color: new THREE.Color().setHSL(rnd.range(0.2, 0.3), rnd.range(0.4, 0.7), rnd.range(0.24, 0.44)).getHex() });
    }
    const gg = new THREE.PlaneGeometry(1, 1);
    const gm = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, vertexColors: true, transparent: true, alphaTest: 0.35, map: getTex('grass') });
    instanced(gg, gm, gp);
  }
}

// ── zone ───────────────────────────────────────────────────────
function buildZone(W) {
  const g = new THREE.CylinderGeometry(1, 1, 110, G.tier === 0 ? 24 : 44, 1, true);
  const z = new THREE.Mesh(g, mat('zone'));
  z.position.y = 50;
  z.renderOrder = 5;
  z.frustumCulled = false;
  W.group.add(z);
  W.zoneMesh = z;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.962, 1, G.tier === 0 ? 36 : 64),
    new THREE.MeshBasicMaterial({ color: 0x8fe4ff, transparent: true, opacity: .45, side: THREE.DoubleSide, depthWrite: false })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.renderOrder = 4;
  ring.frustumCulled = false;
  W.group.add(ring);
  W.zoneRing = ring;
}
/** walkable ground height: terrain, or the top of a platform (pier, container, tower) */
export function groundAt(W, x, z) {
  let h = heightAt(x, z);
  const ps = W.platforms;
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    if (p.top <= h + 0.05 || p.top - h > 3.2) continue;
    const dx = x - p.cx, dz = z - p.cz;
    const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
    const lx = dx * c + dz * s, lz = -dx * s + dz * c;
    if (Math.abs(lx) <= p.hw && Math.abs(lz) <= p.hd) h = p.top;
  }
  return h;
}

export function updateZoneMesh(W) {
  if (!W) return;
  const z = G.zone;
  if (W.zoneMesh) { W.zoneMesh.scale.set(z.r, 1, z.r); W.zoneMesh.position.set(z.x, 50, z.z); }
  if (W.zoneRing) {
    W.zoneRing.scale.set(z.r, z.r, 1);
    W.zoneRing.position.set(z.x, heightAt(z.x, z.z) + 0.4, z.z);
  }
}
