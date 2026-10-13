// ── Neurio City · world generation ─────────────────────────────────────────
// Everything is procedural: a 7×7 block grid with roads, lane markings,
// crosswalks, PBR facades (albedo + roughness + night-window emissive maps),
// setbacks, rooftop units, street lamps, trees, traffic signals and pedestrians.
// Static geometry is batched into a handful of meshes so the city stays cheap.
import * as THREE from 'three';
import { mulberry32, clamp } from '../src/util.js';

export const PITCH = 72;                 // road-centre to road-centre (m)
export const HW = 7;                     // half road width → 14 m roads
export const GRID = 8;                   // road lines per axis → 7×7 blocks
export const CURB = 0.16;                // sidewalk height (m)
export const ISLAND_R = 1250;            // land radius, water beyond
export const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];            // +x −x +z −z
export const LANE = [[0, 3.5], [0, -3.5], [-3.5, 0], [3.5, 0]];    // right-hand lanes
export const SIGNAL_PHASE = 9;           // seconds per green phase
export const STOP_DIST = 12.5;           // stop distance from intersection centre

export const lineCoord = (k) => (k - (GRID - 1) / 2) * PITCH;
export const GRID_MIN = lineCoord(0) - HW;
export const GRID_MAX = lineCoord(GRID - 1) + HW;

const TU = 14, TV = 14.4;                // facade texture tile (4 bays × 4 floors)

/** axis: 0 = x-road (east/west traffic), 1 = z-road */
export function signalGreen(i, j, axis, clock) {
  const ph = (Math.floor(clock / SIGNAL_PHASE) + ((i + j) & 1)) & 1;
  return axis === 0 ? ph === 0 : ph === 1;
}

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);

// ── tiny batched geometry builder (non-indexed quads) ──────────────────────
class GeoB {
  constructor() { this.pos = []; this.nor = []; this.uv = []; }
  quad(pts, n, uvf) {
    const [a, b, c, d] = pts;
    const cr = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    const q = cr.dot(n) >= 0 ? [a, b, c, d] : [a, d, c, b];   // auto-wind to the normal
    for (const k of [0, 1, 2, 0, 2, 3]) {
      const p = q[k];
      this.pos.push(p.x, p.y, p.z);
      this.nor.push(n.x, n.y, n.z);
      const t = uvf(p);
      this.uv.push(t[0], t[1]);
    }
    return this;
  }
  empty() { return this.pos.length === 0; }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeBoundingSphere();
    return g;
  }
}

const quadUp = (b, xa, xb, za, zb, y, s, ox = 0, oz = 0) =>
  b.quad([V(xa, y, za), V(xb, y, za), V(xb, y, zb), V(xa, y, zb)], UP,
    (p) => [(p.x - ox) * s, (p.z - oz) * s]);

function wallQuads(b, x0, x1, y0, y1, z0, z1) {
  const uvZ = (p) => [p.x / TU, p.y / TV];
  const uvX = (p) => [p.z / TU, p.y / TV];
  b.quad([V(x0, y0, z1), V(x1, y0, z1), V(x1, y1, z1), V(x0, y1, z1)], V(0, 0, 1), uvZ);
  b.quad([V(x0, y0, z0), V(x1, y0, z0), V(x1, y1, z0), V(x0, y1, z0)], V(0, 0, -1), uvZ);
  b.quad([V(x1, y0, z0), V(x1, y0, z1), V(x1, y1, z1), V(x1, y1, z0)], V(1, 0, 0), uvX);
  b.quad([V(x0, y0, z0), V(x0, y0, z1), V(x0, y1, z1), V(x0, y1, z0)], V(-1, 0, 0), uvX);
}

function boxQuads(b, x0, x1, y0, y1, z0, z1, s = 0.5) {
  wallQuads(b, x0, x1, y0, y1, z0, z1);
  quadUp(b, x0, x1, z0, z1, y1, s);
}

// ── canvas textures ────────────────────────────────────────────────────────
function canvas(w, h, fn) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  fn(c.getContext('2d'), w, h);
  return c;
}
function tex(c, aniso, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = aniso;
  return t;
}
const gray = (v, a = 1) => `rgba(${v},${v},${v},${a})`;

function asphaltCanvas(rnd) {
  return canvas(512, 512, (g, w, h) => {
    g.fillStyle = '#44474d'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 12000; i++) {
      const x = rnd() * w, y = rnd() * h, s = 0.6 + rnd() * 1.8;
      g.fillStyle = rnd() > 0.5 ? `rgba(255,255,255,${0.04 + rnd() * 0.07})` : `rgba(0,0,0,${0.08 + rnd() * 0.12})`;
      g.fillRect(x, y, s, s);
    }
    // faint tyre-wear streaks along the lane direction
    for (let i = 0; i < 26; i++) {
      g.fillStyle = `rgba(0,0,0,${0.03 + rnd() * 0.03})`;
      g.fillRect(rnd() * w, 0, 14 + rnd() * 30, h);
    }
  });
}

function markingCanvas() {
  return canvas(512, 512, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(241,240,234,0.95)';
    g.fillRect(0, 250, 256, 12);            // centre dash: 3 m on / 3 m off over a 6 m tile
    g.fillRect(0, 30, w, 9);                // edge lines
    g.fillRect(0, h - 39, w, 9);
  });
}

function concreteCanvas(rnd) {
  return canvas(256, 256, (g, w, h) => {
    g.fillStyle = '#b8b4aa'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(90,86,80,0.45)'; g.lineWidth = 2;
    for (let k = 0; k <= w; k += 64) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k, h); g.stroke(); g.beginPath(); g.moveTo(0, k); g.lineTo(w, k); g.stroke(); }
    for (let i = 0; i < 3000; i++) { g.fillStyle = gray(rnd() > 0.5 ? 255 : 60, 0.05 + rnd() * 0.07); g.fillRect(rnd() * w, rnd() * h, 1.5, 1.5); }
  });
}

function grassCanvas(rnd) {
  return canvas(256, 256, (g, w, h) => {
    g.fillStyle = '#3f6e2b'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) {
      const r = 6 + rnd() * 26;
      g.fillStyle = `rgba(${60 + rnd() * 50 | 0},${95 + rnd() * 50 | 0},${35 + rnd() * 20 | 0},0.35)`;
      g.beginPath(); g.arc(rnd() * w, rnd() * h, r, 0, Math.PI * 2); g.fill();
    }
    for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(20,40,10,${0.15 + rnd() * 0.2})`; g.fillRect(rnd() * w, rnd() * h, 1, 2 + rnd() * 2); }
  });
}

function gravelCanvas(rnd) {
  return canvas(256, 256, (g, w, h) => {
    g.fillStyle = '#50555c'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2500; i++) { g.fillStyle = rnd() > 0.5 ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.15)'; g.fillRect(rnd() * w, rnd() * h, 2, 2); }
  });
}

// facade palettes: wall colour, window style, glass gradient, frame colour, lit-window chance
const FACADES = [
  { wall: '#7d90a4', style: 'curtain', glass: ['#1b2a3e', '#4d6e90'], frame: '#cdd5dd', lit: 0.3 },   // blue glass tower
  { wall: '#8e3c2c', style: 'punched', glass: ['#1a222b', '#3b5264'], frame: '#ece7dd', lit: 0.35 },  // brick
  { wall: '#cbb99b', style: 'punched', glass: ['#213039', '#55707e'], frame: '#4a3b2e', lit: 0.35 },  // sandstone
  { wall: '#dcd9d1', style: 'punched', glass: ['#1d2832', '#48606f'], frame: '#3b3f46', lit: 0.3 },   // white concrete
  { wall: '#29313c', style: 'curtain', glass: ['#0a1220', '#2b4a6b'], frame: '#596270', lit: 0.25 },  // dark glass
  { wall: '#b5c6ad', style: 'punched', glass: ['#243238', '#5d7a7e'], frame: '#f1efe9', lit: 0.35 },  // sage pastel
];

function shade(hex, d) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => clamp(Math.round(v + d), 0, 255));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function facadeCanvases(f, rnd) {
  const N = 512, C = 128;
  const col = document.createElement('canvas'); col.width = col.height = N;
  const rgh = document.createElement('canvas'); rgh.width = rgh.height = N;
  const emi = document.createElement('canvas'); emi.width = emi.height = N;
  const gc = col.getContext('2d'), gr = rgh.getContext('2d'), ge = emi.getContext('2d');
  gc.fillStyle = f.frame; gc.fillRect(0, 0, N, N);
  gr.fillStyle = gray(205); gr.fillRect(0, 0, N, N);
  ge.fillStyle = '#000'; ge.fillRect(0, 0, N, N);
  const warm = ['#ffd58a', '#ffe3a8', '#ffcf7a', '#fff1cc'];
  for (let cy = 0; cy < 4; cy++) for (let cx = 0; cx < 4; cx++) {
    const x0 = cx * C, y0 = cy * C;
    let wx, wy, ww, wh;
    if (f.style === 'curtain') { wx = x0 + 3; wy = y0 + 3; ww = C - 6; wh = C - 6; }
    else {
      wx = x0 + 22; wy = y0 + 22; ww = 84; wh = 80;
      gc.fillStyle = shade(f.wall, (rnd() - 0.5) * 16); gc.fillRect(x0, y0, C, C);
      gc.fillStyle = f.frame; gc.fillRect(wx - 4, wy - 4, ww + 8, wh + 8);
      gc.fillStyle = shade(f.wall, 22); gc.fillRect(wx - 7, wy + wh + 4, ww + 14, 5);   // sill
      gr.fillStyle = gray(200); gr.fillRect(x0, y0, C, C);
    }
    // glass with vertical gradient + one diagonal reflection
    const gg = gc.createLinearGradient(0, wy, 0, wy + wh);
    gg.addColorStop(0, f.glass[1]); gg.addColorStop(1, f.glass[0]);
    gc.fillStyle = gg; gc.fillRect(wx, wy, ww, wh);
    gc.fillStyle = 'rgba(255,255,255,0.12)';
    gc.beginPath(); gc.moveTo(wx + ww * 0.12, wy + wh); gc.lineTo(wx + ww * 0.42, wy); gc.lineTo(wx + ww * 0.55, wy); gc.lineTo(wx + ww * 0.25, wy + wh); gc.fill();
    gr.fillStyle = gray(24); gr.fillRect(wx, wy, ww, wh);

    // occasional lit interior (emissive at night)
    if (rnd() < f.lit) {
      const c = warm[Math.floor(rnd() * warm.length)];
      ge.fillStyle = c; ge.fillRect(wx + 2, wy + 2, ww - 4, wh - 4);
      if (rnd() < 0.5) { ge.fillStyle = 'rgba(0,0,0,0.55)'; ge.fillRect(wx + ww * 0.5, wy + 2, 2, wh - 4); }
    }
  }
  return { col, rgh, emi };
}

// ── instanced helper ───────────────────────────────────────────────────────
const _M = new THREE.Matrix4(), _Q = new THREE.Quaternion(), _S = new THREE.Vector3(), _P = new THREE.Vector3();
const _E = new THREE.Euler();
function instanced(geo, mat, items, { color = false } = {}) {
  const im = new THREE.InstancedMesh(geo, mat, items.length);
  items.forEach((it, k) => {
    _Q.setFromEuler(_E.set(0, it.ry || 0, 0));
    _S.set(it.sx ?? 1, it.sy ?? 1, it.sz ?? 1);
    _P.set(it.x, it.y, it.z);
    _M.compose(_P, _Q, _S);
    im.setMatrixAt(k, _M);
    if (color) im.setColorAt(k, it.color);
  });
  im.instanceMatrix.needsUpdate = true;
  if (color && im.instanceColor) im.instanceColor.needsUpdate = true;
  im.castShadow = true;
  im.receiveShadow = true;
  return im;
}

// ── pedestrians ────────────────────────────────────────────────────────────
function pedestrianKit(renderer) {
  const box = (w, h, d, y) => new THREE.BoxGeometry(w, h, d).translate(0, y, 0);
  const shirts = ['#e4572e', '#17bebb', '#ffc914', '#2e86ab', '#f2f4f3', '#3d405b', '#81b29a'];
  const pants = ['#26324a', '#4b3f36', '#2f2f35', '#6b5b95'];
  const skins = ['#f1c7a4', '#c68b59', '#8d5a3b'];
  const hairs = ['#1d1a18', '#5a3b22', '#d9b36c'];
  return {
    legGeo: box(0.16, 0.82, 0.18, -0.41),
    armGeo: box(0.12, 0.62, 0.14, -0.31),
    torsoGeo: box(0.42, 0.62, 0.26, 1.16),
    headGeo: new THREE.SphereGeometry(0.13, 14, 10).translate(0, 1.66, 0),
    hairGeo: box(0.27, 0.08, 0.27, 1.77),
    shirts: shirts.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 })),
    pants: pants.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 })),
    skins: skins.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6 })),
    hairs: hairs.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7 })),
  };
}

class Walker {
  constructor(kit, rnd, axis, fixed, a, b, scene) {
    this.axis = axis; this.fixed = fixed; this.a = a; this.b = b;
    this.t = a + rnd() * (b - a); this.dir = rnd() > 0.5 ? 1 : -1;
    this.speed = 1.1 + rnd() * 0.5; this.phase = rnd() * 6;
    const g = new THREE.Group();
    const mk = (geo, mat, x, y) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.position.set(x, y, 0); return m; };
    const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
    const pants = pick(kit.pants), shirt = pick(kit.shirts);
    this.legL = new THREE.Group(); this.legL.position.set(-0.1, 0.82, 0); this.legL.add(new THREE.Mesh(kit.legGeo, pants));
    this.legR = new THREE.Group(); this.legR.position.set(0.1, 0.82, 0); this.legR.add(new THREE.Mesh(kit.legGeo, pants));
    this.armL = new THREE.Group(); this.armL.position.set(-0.27, 1.45, 0); this.armL.add(new THREE.Mesh(kit.armGeo, shirt));
    this.armR = new THREE.Group(); this.armR.position.set(0.27, 1.45, 0); this.armR.add(new THREE.Mesh(kit.armGeo, shirt));
    const torso = new THREE.Mesh(kit.torsoGeo, shirt);
    const head = new THREE.Mesh(kit.headGeo, pick(kit.skins));
    const hair = new THREE.Mesh(kit.hairGeo, pick(kit.hairs));
    for (const m of [torso, head, hair, this.legL.children[0], this.legR.children[0], this.armL.children[0], this.armR.children[0]]) m.castShadow = true;
    g.add(this.legL, this.legR, this.armL, this.armR, torso, head, hair);
    g.position.y = CURB;
    scene.add(g);
    this.g = g;
  }
  update(dt) {
    this.t += this.dir * this.speed * dt;
    if (this.t > this.b) { this.t = this.b; this.dir = -1; }
    else if (this.t < this.a) { this.t = this.a; this.dir = 1; }
    const dx = this.axis === 0 ? this.dir : 0, dz = this.axis === 1 ? this.dir : 0;
    this.g.position.x = this.axis === 0 ? this.t : this.fixed;
    this.g.position.z = this.axis === 1 ? this.t : this.fixed;
    this.g.rotation.y = Math.atan2(-dx, -dz);
    this.phase += this.speed * dt * 2.8;
    const sw = Math.sin(this.phase) * 0.55;
    this.legL.rotation.x = sw; this.legR.rotation.x = -sw;
    this.armL.rotation.x = -sw * 0.8; this.armR.rotation.x = sw * 0.8;
  }
}

// ── the world ──────────────────────────────────────────────────────────────
export function buildWorld(scene, renderer) {
  const rnd = mulberry32(20261013);
  const aniso = renderer.capabilities.getMaxAnisotropy();
  const B = {
    asphalt: new GeoB(), mark: new GeoB(), stripe: new GeoB(), concrete: new GeoB(),
    grass: new GeoB(), roof: new GeoB(), metal: new GeoB(),
    facade: FACADES.map(() => new GeoB()),
  };
  const colliders = { circles: [], boxes: [] };
  const blocks = [];
  const lamps = [];
  const signalPos = [];

  // ── materials ──
  const roadMat = new THREE.MeshStandardMaterial({ map: tex(asphaltCanvas(rnd), aniso), roughness: 0.9, metalness: 0 });
  const markMat = new THREE.MeshStandardMaterial({
    map: tex(markingCanvas(), aniso), transparent: true, roughness: 0.55, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  });
  const stripeMat = new THREE.MeshStandardMaterial({ color: 0xe9e9e2, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  const concMat = new THREE.MeshStandardMaterial({ map: tex(concreteCanvas(rnd), aniso), roughness: 0.92 });
  const grassMat = new THREE.MeshStandardMaterial({ map: tex(grassCanvas(rnd), aniso), roughness: 1 });
  const roofMat = new THREE.MeshStandardMaterial({ map: tex(gravelCanvas(rnd), aniso), roughness: 0.95 });
  const metalMat = new THREE.MeshStandardMaterial({ color: 0x4a4f57, roughness: 0.45, metalness: 0.7 });
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, emissive: 0xffd9a0, emissiveIntensity: 0, roughness: 0.4 });
  const barkMat = new THREE.MeshStandardMaterial({ color: 0x4d3828, roughness: 0.95 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
  const headMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const facadeMats = FACADES.map((f) => {
    const { col, rgh, emi } = facadeCanvases(f, rnd);
    return new THREE.MeshStandardMaterial({
      map: tex(col, aniso), roughnessMap: tex(rgh, aniso, false), emissiveMap: tex(emi, aniso),
      emissive: 0xffffff, emissiveIntensity: 0, roughness: 1, metalness: 0,
    });
  });

  // ── ground: land disc, sand ring, water ──
  const landGeo = new THREE.CircleGeometry(ISLAND_R, 96).rotateX(-Math.PI / 2);
  {
    const p = landGeo.attributes.position, uv = landGeo.attributes.uv;
    for (let i = 0; i < p.count; i++) { uv.setXY(i, p.getX(i) / 8, p.getZ(i) / 8); }
  }
  const land = new THREE.Mesh(landGeo, grassMat);
  land.position.y = -0.02; land.receiveShadow = true;
  scene.add(land);
  const sand = new THREE.Mesh(new THREE.CircleGeometry(ISLAND_R + 170, 64).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0xd9c59b, roughness: 0.95 }));
  sand.position.y = -0.04; sand.receiveShadow = true;
  scene.add(sand);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x0d3f5e, roughness: 0.06, metalness: 0.05 }));
  water.position.y = -0.6;
  scene.add(water);

  // ── roads ──
  for (let j = 0; j < GRID; j++) {                        // horizontal roads (full span)
    const z = lineCoord(j);
    quadUp(B.asphalt, GRID_MIN, GRID_MAX, z - HW, z + HW, 0, 1 / 8);
  }
  for (let i = 0; i < GRID; i++) {                        // vertical roads, skipping intersections
    const x = lineCoord(i);
    for (let j = 0; j < GRID - 1; j++) quadUp(B.asphalt, x - HW, x + HW, lineCoord(j) + HW, lineCoord(j + 1) - HW, 0, 1 / 8);
  }
  for (let j = 0; j < GRID; j++) {                        // lane markings on horizontal roads
    const z = lineCoord(j), z0 = z - HW;
    for (let i = 0; i < GRID - 1; i++) {
      const xa = lineCoord(i) + HW, xb = lineCoord(i + 1) - HW;
      B.mark.quad([V(xa, 0.03, z - HW), V(xb, 0.03, z - HW), V(xb, 0.03, z + HW), V(xa, 0.03, z + HW)], UP,
        (p) => [p.x / 6, (p.z - z0) / (2 * HW)]);
    }
  }
  for (let i = 0; i < GRID; i++) {                        // lane markings on vertical roads
    const x = lineCoord(i), x0 = x - HW;
    for (let j = 0; j < GRID - 1; j++) {
      const za = lineCoord(j) + HW, zb = lineCoord(j + 1) - HW;
      B.mark.quad([V(x - HW, 0.03, za), V(x + HW, 0.03, za), V(x + HW, 0.03, zb), V(x - HW, 0.03, zb)], UP,
        (p) => [p.z / 6, (p.x - x0) / (2 * HW)]);
    }
  }

  // ── intersections: crosswalks + signal heads ──
  for (let i = 0; i < GRID; i++) for (let j = 0; j < GRID; j++) {
    const xc = lineCoord(i), zc = lineCoord(j);
    for (const s of [1, -1]) {                             // crosswalks across x-roads (E/W arms)
      if (i + s < 0 || i + s >= GRID) continue;
      const xa = xc + s * 7.5, xb = xc + s * 10.5;
      for (let t = -6; t <= 6.01; t += 1.5) {
        const z = zc + t;
        B.stripe.quad([V(Math.min(xa, xb), 0.035, z - 0.35), V(Math.max(xa, xb), 0.035, z - 0.35), V(Math.max(xa, xb), 0.035, z + 0.35), V(Math.min(xa, xb), 0.035, z + 0.35)], UP, () => [0, 0]);
      }
    }
    for (const s of [1, -1]) {                             // crosswalks across z-roads (N/S arms)
      if (j + s < 0 || j + s >= GRID) continue;
      const za = zc + s * 7.5, zb = zc + s * 10.5;
      for (let t = -6; t <= 6.01; t += 1.5) {
        const x = xc + t;
        B.stripe.quad([V(x - 0.35, 0.035, Math.min(za, zb)), V(x + 0.35, 0.035, Math.min(za, zb)), V(x + 0.35, 0.035, Math.max(za, zb)), V(x - 0.35, 0.035, Math.max(za, zb))], UP, () => [0, 0]);
      }
    }
    // four corner poles, each head shows the state of its axis
    const corners = [[7.6, -7.6, 0], [-7.6, 7.6, 0], [-7.6, -7.6, 1], [7.6, 7.6, 1]];
    for (const [ox, oz, axis] of corners) {
      const px = xc + ox, pz = zc + oz;
      boxQuads(B.metal, px - 0.14, px + 0.14, 0, 5.4, pz - 0.14, pz + 0.14, 0.5);
      boxQuads(B.metal, px - 0.25, px + 0.25, 4.5, 5.25, pz - 0.2, pz + 0.2, 0.5);
      colliders.circles.push({ x: px, z: pz, r: 0.3 });
      signalPos.push({ i, j, axis, x: px, y: 4.85, z: pz });
    }
  }
  const heads = instanced(new THREE.SphereGeometry(0.2, 12, 8), headMat,
    signalPos.map((s) => ({ x: s.x, y: s.y, z: s.z, color: new THREE.Color(1, 0, 0) })), { color: true });
  heads.castShadow = false;

  // ── blocks: sidewalks, parks, buildings, lamps, trees ──
  const edgeTrees = [];
  for (let bi = 0; bi < GRID - 1; bi++) for (let bj = 0; bj < GRID - 1; bj++) {
    const x0 = lineCoord(bi) + HW, x1 = lineCoord(bi + 1) - HW;
    const z0 = lineCoord(bj) + HW, z1 = lineCoord(bj + 1) - HW;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const dc = Math.hypot(cx, cz) / 260;                  // 0 = centre
    const park = rnd() < (dc > 0.55 ? 0.25 : 0.08);
    blocks.push({ x0, x1, z0, z1, park });

    // curb faces + top
    B.concrete.quad([V(x0, 0, z0), V(x1, 0, z0), V(x1, CURB, z0), V(x0, CURB, z0)], V(0, 0, -1), (p) => [p.x / 6, p.y / 6]);
    B.concrete.quad([V(x0, 0, z1), V(x1, 0, z1), V(x1, CURB, z1), V(x0, CURB, z1)], V(0, 0, 1), (p) => [p.x / 6, p.y / 6]);
    B.concrete.quad([V(x0, 0, z0), V(x0, 0, z1), V(x0, CURB, z1), V(x0, CURB, z0)], V(-1, 0, 0), (p) => [p.z / 6, p.y / 6]);
    B.concrete.quad([V(x1, 0, z0), V(x1, 0, z1), V(x1, CURB, z1), V(x1, CURB, z0)], V(1, 0, 0), (p) => [p.z / 6, p.y / 6]);
    if (park) quadUp(B.grass, x0, x1, z0, z1, CURB + 0.005, 1 / 8);
    else quadUp(B.concrete, x0, x1, z0, z1, CURB, 1 / 6);

    // street lamps + edge trees, each block edge
    const edges = [
      { a: [x0, x1], fixed: z1, axis: 'x', inside: -1, out: 1 },
      { a: [x0, x1], fixed: z0, axis: 'x', inside: 1, out: -1 },
      { a: [z0, z1], fixed: x1, axis: 'z', inside: -1, out: 1 },
      { a: [z0, z1], fixed: x0, axis: 'z', inside: 1, out: -1 },
    ];
    for (const e of edges) {
      const [ea, eb] = e.a;
      // lamps every 16 m
      for (let t = ea + 8; t <= eb - 8; t += 16) {
        const lx = e.axis === 'x' ? t : e.fixed + e.inside * 0.6;
        const lz = e.axis === 'x' ? e.fixed + e.inside * 0.6 : t;
        boxQuads(B.metal, lx - 0.1, lx + 0.1, CURB, 7.0, lz - 0.1, lz + 0.1, 0.5);
        const headX = e.axis === 'x' ? lx : lx + e.out * 0.85;
        const headZ = e.axis === 'x' ? lz + e.out * 0.85 : lz;
        lamps.push({ x: headX, y: 6.95, z: headZ, ry: e.axis === 'x' ? 0 : Math.PI / 2 });
        colliders.circles.push({ x: lx, z: lz, r: 0.3 });
      }
      // street trees, 1.5 m inside the curb
      for (let t = ea + 4; t <= eb - 4; t += 12) {
        const tx = e.axis === 'x' ? t : e.fixed + e.inside * 1.5;
        const tz = e.axis === 'x' ? e.fixed + e.inside * 1.5 : t;
        edgeTrees.push([tx, tz]);
      }
    }

    if (park) {
      const n = 5 + Math.floor(rnd() * 6);
      for (let k = 0; k < n; k++) edgeTrees.push([x0 + 7 + rnd() * (x1 - x0 - 14), z0 + 7 + rnd() * (z1 - z0 - 14)]);
      continue;
    }

    // ── buildings: 1, 2 or 4 parcels per block ──
    const inset = () => 4.6 + rnd() * 1.2;
    const parcels = [];
    const r = rnd();
    if (r < 0.5) {
      parcels.push([x0 + inset(), x1 - inset(), z0 + inset(), z1 - inset()]);
    } else if (r < 0.8) {
      const gap = 5 + rnd() * 3, mid = (x0 + x1) / 2 + (rnd() - 0.5) * 8;
      if (rnd() < 0.5) parcels.push([x0 + inset(), mid - gap / 2, z0 + inset(), z1 - inset()], [mid + gap / 2, x1 - inset(), z0 + inset(), z1 - inset()]);
      else {
        const midz = (z0 + z1) / 2 + (rnd() - 0.5) * 8;
        parcels.push([x0 + inset(), x1 - inset(), z0 + inset(), midz - gap / 2], [x0 + inset(), x1 - inset(), midz + gap / 2, z1 - inset()]);
      }
    } else {
      const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2, g = 4 + rnd() * 2;
      parcels.push([x0 + inset(), mx - g / 2, z0 + inset(), mz - g / 2], [mx + g / 2, x1 - inset(), z0 + inset(), mz - g / 2],
        [x0 + inset(), mx - g / 2, mz + g / 2, z1 - inset()], [mx + g / 2, x1 - inset(), mz + g / 2, z1 - inset()]);
    }

    for (const [px0, px1, pz0, pz1] of parcels) {
      const w = px1 - px0, d = pz1 - pz0;
      if (w < 6 || d < 6) continue;
      let hMin, hMax;
      if (dc < 0.22) { hMin = 55; hMax = 160; } else if (dc < 0.5) { hMin = 18; hMax = 70; } else { hMin = 7; hMax = 28; }
      let h = hMin + (hMax - hMin) * Math.pow(rnd(), 1.35);
      h = Math.max(2, Math.round(h / 3.6)) * 3.6;
      const v = dc < 0.3 ? (rnd() < 0.6 ? 0 : 4) : [1, 2, 3, 5, 0, 2][Math.floor(rnd() * 6)];
      const fb = B.facade[v];

      wallQuads(fb, px0, px1, CURB, CURB + h, pz0, pz1);
      quadUp(B.roof, px0, px1, pz0, pz1, CURB + h, 1 / 10);
      colliders.boxes.push({ x0: px0, x1: px1, z0: pz0, z1: pz1 });

      // setback tower
      let topY = CURB + h;
      if (h > 50 && rnd() < 0.55) {
        const ins = Math.min(w, d) * 0.16;
        const h2 = Math.max(1, Math.round((9 + rnd() * 12) / 3.6)) * 3.6;
        wallQuads(fb, px0 + ins, px1 - ins, topY, topY + h2, pz0 + ins, pz1 - ins);
        quadUp(B.roof, px0 + ins, px1 - ins, pz0 + ins, pz1 - ins, topY + h2, 1 / 10);
        topY += h2;
      }
      // rooftop units
      if (rnd() < 0.55) {
        const n = 1 + Math.floor(rnd() * 3);
        for (let k = 0; k < n; k++) {
          const ux = px0 + 2 + rnd() * Math.max(1, w - 6), uz = pz0 + 2 + rnd() * Math.max(1, d - 6);
          boxQuads(B.metal, ux, ux + 2 + rnd() * 1.5, topY, topY + 1.4 + rnd() * 0.8, uz, uz + 1.8, 0.5);
        }
      }
      // antenna on tall ones
      if (h > 95 && rnd() < 0.7) {
        const ax = (px0 + px1) / 2, az = (pz0 + pz1) / 2;
        boxQuads(B.metal, ax - 0.15, ax + 0.15, topY, topY + 14, az - 0.15, az + 0.15, 0.5);
      }
    }
  }

  // outer island trees (outside the grid, inside the land disc)
  for (let n = 0, guard = 0; n < 650 && guard < 20000; guard++) {
    const x = (rnd() * 2 - 1) * ISLAND_R, z = (rnd() * 2 - 1) * ISLAND_R;
    if (Math.max(Math.abs(x), Math.abs(z)) < 268 || Math.hypot(x, z) > ISLAND_R - 40) continue;
    edgeTrees.push([x, z]);
    n++;
  }

  // ── tree instances ──
  const trunkItems = [], canopyItems = [];
  for (const [x, z] of edgeTrees) {
    const s = 0.85 + rnd() * 0.4;
    trunkItems.push({ x, y: CURB + 1.5, z, sy: s });
    canopyItems.push({ x, y: CURB + 4.6 * s, z, sx: s, sy: s * 0.95, sz: s, color: new THREE.Color().setHSL(0.24 + rnd() * 0.06, 0.45 + rnd() * 0.2, 0.2 + rnd() * 0.12) });
    colliders.circles.push({ x, z, r: 0.42 });
  }
  const trunkGeo = new THREE.CylinderGeometry(0.2, 0.3, 3.1, 7);
  const canopyGeo = new THREE.IcosahedronGeometry(2.4, 1);
  const trunks_ = instanced(trunkGeo, barkMat, trunkItems);
  const canopy_ = instanced(canopyGeo, leafMat, canopyItems, { color: true });

  const lampGeo = new THREE.BoxGeometry(0.9, 0.12, 0.4);
  const lamps_ = instanced(lampGeo, lampMat, lamps);

  // ── batch meshes ──
  const add = (geo, mat, opts = {}) => {
    if (!geo) return null;
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = opts.cast ?? true;
    m.receiveShadow = true;
    scene.add(m);
    return m;
  };
  const batch = (b) => (b.empty() ? null : b.geometry());
  add(batch(B.asphalt), roadMat);
  const marks = add(batch(B.mark), markMat, { cast: false });
  add(batch(B.stripe), stripeMat, { cast: false });
  add(batch(B.concrete), concMat);
  add(batch(B.grass), grassMat);
  add(batch(B.roof), roofMat);
  add(batch(B.metal), metalMat);
  B.facade.forEach((b, k) => add(batch(b), facadeMats[k]));
  if (marks) marks.renderOrder = 2;
  scene.add(trunks_, canopy_, lamps_, heads);

  // ── pedestrians ──
  const kit = pedestrianKit(renderer);
  const walkers = [];
  for (let n = 0; n < 42; n++) {
    const b = blocks[Math.floor(rnd() * blocks.length)];
    const inset = 2.8;
    const side = Math.floor(rnd() * 4);
    if (side === 0) walkers.push(new Walker(kit, rnd, 0, b.z1 - inset, b.x0 + 2, b.x1 - 2, scene));
    else if (side === 1) walkers.push(new Walker(kit, rnd, 0, b.z0 + inset, b.x0 + 2, b.x1 - 2, scene));
    else if (side === 2) walkers.push(new Walker(kit, rnd, 1, b.x1 - inset, b.z0 + 2, b.z1 - 2, scene));
    else walkers.push(new Walker(kit, rnd, 1, b.x0 + inset, b.z0 + 2, b.z1 - 2, scene));
  }

  // ── public API ──
  const sigColor = new THREE.Color();
  let lastSig = '';
  const world = {
    colliders,
    blocks,
    signals: signalPos,
    update(dt, clock, env) {
      for (const w of walkers) w.update(dt);
      lampMat.emissiveIntensity = env.lamps;
      for (const m of facadeMats) m.emissiveIntensity = env.windows;
      // signal colours (only when a phase flips)
      const key = signalPos.map((s) => (signalGreen(s.i, s.j, s.axis, clock) ? 1 : 0)).join('');
      if (key !== lastSig) {
        lastSig = key;
        signalPos.forEach((s, k) => {
          const green = signalGreen(s.i, s.j, s.axis, clock);
          sigColor.setRGB(green ? 0.2 : 3.2, green ? 3.0 : 0.25, green ? 0.4 : 0.1);
          heads.setColorAt(k, sigColor);
        });
        heads.instanceColor.needsUpdate = true;
      }
    },
    setWet(w) {
      roadMat.roughness = 0.9 - 0.62 * w;
      concMat.roughness = 0.92 - 0.45 * w;
      grassMat.roughness = 1 - 0.3 * w;
      for (const m of facadeMats) m.roughness = 1 - 0.25 * w;
      markMat.roughness = 0.55 - 0.3 * w;
    },
    walkerCount: walkers.length,
  };
  return world;
}
