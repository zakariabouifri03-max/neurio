// Block Front 1944 — a Minecraft-style voxel war game, 100% procedural.
// Uses the vendored three.js r170 from ../vendor (no CDN, no build step).
import * as THREE from '../vendor/three.module.js';

/* ════════════════════════ CONSTANTS ════════════════════════ */
const CS = 16;                       // chunk size (blocks)
const MW = 128, MD = 128, MH = 40;   // world size (x, z, y)
const NCX = MW / CS, NCZ = MD / CS;

const AIR = 0, GRASS = 1, DIRT = 2, STONE = 3, SAND = 4, WOOD = 5, LEAVES = 6, BRICK = 7, BAG = 8, STEEL = 9;
// c = colour, h = hardness (explosions remove a block if its distance < radius - h; 99 = indestructible)
const BT = {
  [GRASS]:  { n: 'Grass',   c: 0x63a844, h: 0.2 },
  [DIRT]:   { n: 'Dirt',    c: 0x8a5a32, h: 0.2 },
  [STONE]:  { n: 'Stone',   c: 0x8b8e93, h: 0.9 },
  [SAND]:   { n: 'Sand',    c: 0xe3cd8e, h: 0.1 },
  [WOOD]:   { n: 'Wood',    c: 0x7a4f26, h: 0.4 },
  [LEAVES]: { n: 'Leaves',  c: 0x2f7d2a, h: 0.0 },
  [BRICK]:  { n: 'Brick',   c: 0xb0492f, h: 0.5 },
  [BAG]:    { n: 'Sandbag', c: 0xc7b47e, h: 0.3 },
  [STEEL]:  { n: 'Steel',   c: 0x5d6572, h: 99 },
};
const HOTBAR = [BRICK, BAG, STONE, DIRT, WOOD, STEEL];

const HW = 0.3, PH = 1.75, EYE = 1.6;   // player half-width, height, eye height
const GRAV = 28, JUMP = 8.6;
const MAG = 30;
const SHOT_INTERVAL = 1 / 9;
const $ = (id) => document.getElementById(id);

/* ════════════════════════ RANDOM / NOISE ════════════════════════ */
function hash(x, y, s = 0) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, s) {
  let t = 0, amp = 0.5, f = 1, n = 0;
  for (let i = 0; i < 4; i++) { t += vnoise(x * f, y * f, s + i) * amp; n += amp; amp *= 0.5; f *= 2; }
  return t / n;
}
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function angDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/* ════════════════════════ VOXEL WORLD ════════════════════════ */
const blocks = new Uint8Array(MW * MH * MD);
const idx = (x, y, z) => x + z * MW + y * MW * MD;
const inB = (x, z) => x >= 0 && z >= 0 && x < MW && z < MD;

// Solid for collision/rays: bottom & horizontal map edges are solid, sky is not.
function solidAt(x, y, z) {
  if (y < 0) return true;
  if (y >= MH) return false;
  if (!inB(x, z)) return true;
  return blocks[idx(x, y, z)] !== 0;
}
function surfaceAt(x, z) {                     // number of solid cells in the column
  x = Math.floor(x); z = Math.floor(z);
  if (!inB(x, z)) return 0;
  for (let y = MH - 1; y >= 0; y--) if (blocks[idx(x, y, z)]) return y + 1;
  return 0;
}

const chunkMeshes = new Array(NCX * NCZ).fill(null);
const dirty = new Set();
const chunkOf = (x, z) => Math.floor(x / CS) + Math.floor(z / CS) * NCX;
function markDirty(x, y, z) {
  const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
  const lx = x - cx * CS, lz = z - cz * CS;
  dirty.add(cx + cz * NCX);
  if (lx === 0 && cx > 0) dirty.add(cx - 1 + cz * NCX);
  if (lx === CS - 1 && cx < NCX - 1) dirty.add(cx + 1 + cz * NCX);
  if (lz === 0 && cz > 0) dirty.add(cx + (cz - 1) * NCX);
  if (lz === CS - 1 && cz < NCZ - 1) dirty.add(cx + (cz + 1) * NCX);
}
function setBlock(x, y, z, t) {
  if (!inB(x, z) || y < 0 || y >= MH) return;
  blocks[idx(x, y, z)] = t;
  markDirty(x, y, z);
}

const FACES = [
  { n: [1, 0, 0],  v: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
  { n: [-1, 0, 0], v: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]] },
  { n: [0, 1, 0],  v: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { n: [0, -1, 0], v: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { n: [0, 0, 1],  v: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]] },
  { n: [0, 0, -1], v: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] },
];
const blockMat = new THREE.MeshLambertMaterial({ vertexColors: true });
const tmpCol = new THREE.Color();

function buildChunk(ci) {
  const cx = ci % NCX, cz = Math.floor(ci / NCX);
  const pos = [], nor = [], col = [], ind = [];
  let vc = 0;
  for (let y = 0; y < MH; y++) {
    for (let lz = 0; lz < CS; lz++) {
      for (let lx = 0; lx < CS; lx++) {
        const x = cx * CS + lx, z = cz * CS + lz;
        const t = blocks[idx(x, y, z)];
        if (!t) continue;
        const base = BT[t].c;
        for (let fi = 0; fi < 6; fi++) {
          const f = FACES[fi];
          if (solidAt(x + f.n[0], y + f.n[1], z + f.n[2])) continue;
          const shade = 0.9 + 0.14 * hash(x * 7 + fi * 131, z * 3 + y * 977, 5);
          tmpCol.setHex(base).multiplyScalar(shade);
          for (const v of f.v) {
            pos.push(x + v[0], y + v[1], z + v[2]);
            nor.push(f.n[0], f.n[1], f.n[2]);
            col.push(tmpCol.r, tmpCol.g, tmpCol.b);
          }
          ind.push(vc, vc + 1, vc + 2, vc, vc + 2, vc + 3);
          vc += 4;
        }
      }
    }
  }
  if (!ind.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(new THREE.Uint32BufferAttribute(ind, 1));
  g.computeBoundingSphere();
  return new THREE.Mesh(g, blockMat);
}
function rebuildChunk(ci) {
  const old = chunkMeshes[ci];
  if (old) { scene.remove(old); old.geometry.dispose(); chunkMeshes[ci] = null; }
  const m = buildChunk(ci);
  if (m) { scene.add(m); chunkMeshes[ci] = m; }
}
function rebuildAll() {
  for (let ci = 0; ci < NCX * NCZ; ci++) rebuildChunk(ci);
  dirty.clear();
}
function updateDirty(limit) {
  let n = 0;
  for (const ci of dirty) {
    rebuildChunk(ci);
    dirty.delete(ci);
    if (++n >= limit) break;
  }
}

/* ════════════════════════ WORLD GENERATION ════════════════════════ */
const PLAYER_SPAWN = { x: 64.5, z: 100.5 };
let seed = 1;
let trenchDist = new Float32Array(MW * MD);
const houseMask = new Uint8Array(MW * MD);

function generateWorld(s) {
  seed = s;
  blocks.fill(0);
  houseMask.fill(0);
  const trenchZ = [30, 46, 62, 78];
  const zcOf = (x, k) => trenchZ[k] + 3.5 * Math.sin(x * 0.09 + k * 1.7);
  const surf = new Int16Array(MW * MD);

  // ---- terrain + trenches + sandbags
  for (let z = 0; z < MD; z++) {
    for (let x = 0; x < MW; x++) {
      const i = x + z * MW;
      const base = 7 + fbm(x / 34, z / 34, seed) * 12 + (fbm(x / 9, z / 9, seed + 50) - 0.5) * 2;
      let s0 = Math.round(base);
      let td = 99;
      if (x >= 12 && x < MW - 12) for (let k = 0; k < trenchZ.length; k++) td = Math.min(td, Math.abs(z - zcOf(x, k)));
      trenchDist[i] = td;
      let s = s0;
      if (td <= 1.0) s = s0 - 2;                       // trench floor
      s = clamp(s, 2, MH - 8);
      const desert = fbm(x / 22 + 100, z / 22, seed + 9) > 0.58;
      for (let y = 0; y < s; y++) {
        blocks[idx(x, y, z)] = y === s - 1 ? (desert ? SAND : GRASS) : y >= s - 4 ? DIRT : STONE;
      }
      // sandbag parapets on both sides of the trenches
      if (td > 1.0 && td <= 2.2 && hash(x, z, seed + 3) > 0.3) {
        blocks[idx(x, s, z)] = BAG;
        if (hash(x, z, seed + 4) > 0.55) blocks[idx(x, s + 1, z)] = BAG;
        s += hash(x, z, seed + 4) > 0.55 ? 2 : 1;
      }
      surf[i] = s;
    }
  }

  // ---- bunkers (brick houses with wood roofs)
  for (let h = 0; h < 6; h++) {
    const hx = 10 + Math.floor(hash(h, 0, seed + 21) * (MW - 34));
    const hz = 36 + Math.floor(hash(h, 1, seed + 22) * (MD - 58));
    const W = 7, D = 6;
    const cxh = hx + 3, czh = hz + 3;
    if (trenchDist[czh * MW + cxh] <= 3) continue;
    if (Math.hypot(cxh - PLAYER_SPAWN.x, czh - PLAYER_SPAWN.z) < 14) continue;
    const base = surf[czh * MW + cxh];
    for (let z = hz - 1; z <= hz + D; z++) for (let x = hx - 1; x <= hx + W; x++) if (inB(x, z)) houseMask[x + z * MW] = 1;
    for (let z = hz; z < hz + D; z++) {
      for (let x = hx; x < hx + W; x++) {
        // flatten: fill up to base, clear above
        for (let y = 0; y < MH; y++) {
          if (y < base) { if (!blocks[idx(x, y, z)]) blocks[idx(x, y, z)] = DIRT; }
          else blocks[idx(x, y, z)] = AIR;
        }
        blocks[idx(x, base - 1, z)] = (x - hx + z - hz) % 3 === 0 ? STONE : DIRT;
        const edge = x === hx || x === hx + W - 1 || z === hz || z === hz + D - 1;
        if (edge) {
          for (let k = 0; k < 4; k++) {
            const doorway = z === hz && x === hx + 3 && k < 2;
            if (!doorway) blocks[idx(x, base + k, z)] = BRICK;
          }
        }
        blocks[idx(x, base + 4, z)] = WOOD;
        surf[x + z * MW] = base + 5;
      }
    }
  }

  // ---- trees
  for (let t = 0; t < 260; t++) {
    const x = 3 + Math.floor(hash(t, 7, seed + 31) * (MW - 6));
    const z = 3 + Math.floor(hash(t, 8, seed + 32) * (MD - 6));
    const i = x + z * MW;
    if (trenchDist[i] < 4 || houseMask[i]) continue;
    if (Math.hypot(x - PLAYER_SPAWN.x, z - PLAYER_SPAWN.z) < 8) continue;
    const top = surf[i];
    if (top < 3 || top + 7 >= MH) continue;
    if (blocks[idx(x, top - 1, z)] !== GRASS) continue;
    const trunk = 3 + Math.floor(hash(t, 9, seed) * 2);
    for (let k = 0; k < trunk; k++) blocks[idx(x, top + k, z)] = WOOD;
    const cy = top + trunk;
    for (let dy = -2; dy <= 1; dy++) for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      const d2 = dx * dx + dz * dz + dy * dy * 1.3;
      if (d2 > 5.2) continue;
      const bx = x + dx, by = cy + dy, bz = z + dz;
      if (inB(bx, bz) && by < MH && blocks[idx(bx, by, bz)] === AIR) blocks[idx(bx, by, bz)] = LEAVES;
    }
    surf[i] = Math.max(surf[i], cy + 2);
  }
}

/* ════════════════════════ THREE.JS SCENE ════════════════════════ */
const app = $('app');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const SKY = 0xa9c9e6;
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 75, 200);

const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, 420);
camera.rotation.order = 'YXZ';
scene.add(camera);

scene.add(new THREE.HemisphereLight(0xdff0ff, 0x5b4a30, 1.0));
const sun = new THREE.DirectionalLight(0xffe6b8, 1.1);
sun.position.set(60, 100, 40);
scene.add(sun);

// shared materials / geometries
const lamCache = new Map();
function lm(c) { if (!lamCache.has(c)) lamCache.set(c, new THREE.MeshLambertMaterial({ color: c })); return lamCache.get(c); }
const basCache = new Map();
function bm(c) { if (!basCache.has(c)) basCache.set(c, new THREE.MeshBasicMaterial({ color: c })); return basCache.get(c); }
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const UNIT_BALL = new THREE.SphereGeometry(1, 10, 8);

function box(w, h, d, c) { return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lm(c)); }
// place a mesh so that its top sits at the pivot (used for limbs)
function limb(pivotParent, x, y, z, w, h, d, c) {
  const p = new THREE.Group();
  p.position.set(x, y, z);
  const m = box(w, h, d, c);
  m.position.y = -h / 2;
  p.add(m);
  pivotParent.add(p);
  return p;
}

/* ───── 3D models: Allied rifleman (viewmodel), Axis soldier, Axis tank ───── */
function buildSoldier() {
  const g = new THREE.Group();
  const UNI = 0x5e6b58, PANT = 0x3d4a3a, SKIN = 0xf0c59a, HELM = 0x3c423d, BOOT = 0x2a211b, GUN = 0x1d1d1d;
  const legL = limb(g, -0.13, 0.8, 0, 0.22, 0.8, 0.24, PANT);
  const legR = limb(g, 0.13, 0.8, 0, 0.22, 0.8, 0.24, PANT);
  g.add(box(0.5, 0.75, 0.3, UNI).translateY(1.2));          // torso
  g.add(box(0.5, 0.12, 0.32, 0x3a3f33).translateY(0.85));   // belt
  const armL = limb(g, -0.34, 1.52, 0, 0.18, 0.7, 0.2, UNI);
  const armR = limb(g, 0.34, 1.52, 0, 0.18, 0.7, 0.2, UNI);
  g.add(box(0.28, 0.28, 0.28, SKIN).translateY(1.7));       // head
  g.add(box(0.06, 0.04, 0.03, 0x121212).translateX(-0.07).translateY(1.72).translateZ(0.15));
  g.add(box(0.06, 0.04, 0.03, 0x121212).translateX(0.07).translateY(1.72).translateZ(0.15));
  g.add(box(0.1, 0.05, 0.03, 0x7a3b2b).translateY(1.6).translateZ(0.15));  // mouth
  g.add(box(0.36, 0.14, 0.36, HELM).translateY(1.88));      // helmet
  g.add(box(0.42, 0.04, 0.12, HELM).translateY(1.84).translateZ(0.2));  // helmet brim
  g.add(box(0.1, 0.12, 0.1, BOOT).translateX(-0.13).translateY(0.06).translateZ(0.04));
  g.add(box(0.1, 0.12, 0.1, BOOT).translateX(0.13).translateY(0.06).translateZ(0.04));
  g.add(box(0.09, 0.12, 0.95, GUN).translateX(0.15).translateY(1.25).translateZ(0.5)); // rifle
  g.add(box(0.07, 0.18, 0.1, 0x4a3520).translateX(0.15).translateY(1.12).translateZ(0.2)); // stock/grip
  g.traverse((o) => { if (o.isMesh) o.castShadow = false; });
  return { g, legL, legR, armL, armR, turret: null };
}

function buildTank() {
  const g = new THREE.Group();
  const OLIVE = 0x4f5c3d, TRACK = 0x222222, TUR = 0x5d6a4b, BARREL = 0x2b2f27;
  g.add(box(1.7, 0.6, 2.5, OLIVE).translateY(0.55));           // hull
  g.add(box(1.5, 0.28, 0.6, OLIVE).translateY(0.82).translateZ(1.1).rotateX(-0.4));  // glacis
  g.add(box(0.38, 0.7, 2.7, TRACK).translateX(-1.0).translateY(0.38));
  g.add(box(0.38, 0.7, 2.7, TRACK).translateX(1.0).translateY(0.38));
  for (let i = -3; i <= 3; i++) {                              // track links
    g.add(box(0.42, 0.06, 0.1, 0x3a3a3a).translateX(-1.0).translateY(0.06).translateZ(i * 0.38));
    g.add(box(0.42, 0.06, 0.1, 0x3a3a3a).translateX(1.0).translateY(0.06).translateZ(i * 0.38));
  }
  const turret = new THREE.Group();
  turret.position.set(0, 0.85, -0.1);
  const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.7, 0.5, 14), lm(TUR));
  cyl.position.y = 0.25;
  turret.add(cyl);
  const barrel = box(0.2, 0.2, 1.7, BARREL).translateY(0.32).translateZ(1.0);
  turret.add(barrel);
  turret.add(box(0.3, 0.18, 0.3, BARREL).translateY(0.4).translateZ(0.2));  // cupola / muzzle brake base
  turret.add(box(0.44, 0.12, 0.44, 0x2a2a2a).translateY(0.52));           // hatch
  g.add(turret);
  return { g, turret, legL: null, legR: null, armL: null, armR: null, muzzleZ: 1.92, muzzleY: 0.32 };
}

// First-person rifle viewmodel (child of camera)
const viewmodel = new THREE.Group();
(function buildViewmodel() {
  const STEEL_C = 0x2a2d2f, WOODC = 0x6b4a2a;
  viewmodel.add(box(0.075, 0.11, 0.6, STEEL_C).translateZ(-0.3));          // receiver
  viewmodel.add(box(0.05, 0.05, 0.55, 0x1b1c1e).translateY(0.02).translateZ(-0.78)); // barrel
  viewmodel.add(box(0.07, 0.13, 0.23, WOODC).translateY(-0.02).translateZ(0.25));    // stock
  viewmodel.add(box(0.04, 0.06, 0.28, 0x1c1c1c).translateY(-0.14).translateZ(-0.27)); // grip/mag housing
  viewmodel.add(box(0.05, 0.16, 0.08, 0x202020).translateY(-0.17).translateZ(-0.36)); // magazine
  viewmodel.add(box(0.02, 0.05, 0.02, 0x111111).translateY(0.08).translateZ(-0.7));   // front sight
  viewmodel.add(box(0.1, 0.12, 0.2, 0xc9a77c).translateX(0.05).translateY(-0.12).translateZ(-0.05)); // hand
  viewmodel.position.set(0.24, -0.22, -0.46);
  camera.add(viewmodel);
  viewmodel.muzzleLocal = new THREE.Vector3(0, 0.02, -1.1);
})();

/* ════════════════════════ GAME STATE ════════════════════════ */
const P = {
  x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0,
  onGround: false, moving: false, hp: 100, hurtT: 99, ammo: MAG, reserve: 120, nades: 3,
  reloadT: 0, sel: 0, flash: 0, shake: 0, lastShot: -10, kick: 0,
};
let state = 'menu';          // menu | play | paused | over
let wave = 0, score = 0, kills = 0;
let intermission = 3;        // seconds until next wave (null = wave in progress)
let spawnQueue = [], spawnT = 0;
let lockGrace = 0;
let noLock = false;          // fallback when pointer lock isn't available (drag to look)
let mouseDown = { 0: false, 2: false };
let ignoreMouseUntil = 0;

const enemies = [];
const shells = [];
const grenades = [];
const parts = [];
const tracers = [];
const keys = {};

/* ════════════════════════ AUDIO (synthesised) ════════════════════════ */
let AC = null, master = null, noiseBuf = null;
function ac() {
  if (!AC) {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    master = AC.createGain();
    master.gain.value = 0.45;
    master.connect(AC.destination);
  }
  if (AC.state === 'suspended') AC.resume();
  return AC;
}
function getNoise() {
  const a = ac();
  if (!noiseBuf) {
    noiseBuf = a.createBuffer(1, a.sampleRate * 1.5, a.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}
function sndNoise(dur, vol, freq, type = 'lowpass') {
  if (!AC && !window.__gestured) return;
  const a = ac(), t = a.currentTime;
  const src = a.createBufferSource();
  src.buffer = getNoise();
  const f = a.createBiquadFilter();
  f.type = type; f.frequency.value = freq;
  const g = a.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t); src.stop(t + dur + 0.05);
}
function sndTone(fA, fB, dur, vol, type = 'sine') {
  if (!AC) return;
  const a = ac(), t = a.currentTime;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(fA, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, fB), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.05);
}
const sfx = {
  shot: () => { sndNoise(0.12, 0.5, 3200); sndTone(190, 60, 0.08, 0.2, 'triangle'); },
  enemyShot: () => { sndNoise(0.1, 0.12, 1500); },
  boom: () => { sndNoise(0.9, 0.9, 500); sndTone(90, 28, 0.7, 0.55); },
  tank: () => { sndNoise(0.5, 0.55, 400); sndTone(75, 32, 0.5, 0.35); },
  hit: () => sndTone(950, 380, 0.07, 0.15, 'square'),
  hurt: () => sndTone(170, 70, 0.22, 0.3, 'sawtooth'),
  click: () => sndTone(1400, 1100, 0.03, 0.12, 'square'),
  place: () => sndTone(300, 260, 0.06, 0.2, 'triangle'),
  reload: () => { sndTone(700, 900, 0.05, 0.12, 'square'); setTimeout(() => sndTone(1000, 1300, 0.06, 0.12, 'square'), 180); },
};

/* ════════════════════════ FX HELPERS ════════════════════════ */
function tracer(a, b, color, life = 0.07) {
  const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }));
  scene.add(line);
  tracers.push({ o: line, t: life });
}
function debris(p, color, n = 12, spd = 6, size = 0.12) {
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(UNIT_BOX, bm(color));
    m.scale.setScalar(size * (0.5 + Math.random()));
    m.position.copy(p);
    const v = new THREE.Vector3(rand(-1, 1), rand(0.2, 1), rand(-1, 1)).normalize().multiplyScalar(spd * (0.4 + Math.random() * 0.6));
    scene.add(m);
    parts.push({ o: m, v, t: 0.6 + Math.random() * 0.5, g: true, grow: 0 });
  }
}
function fireball(p, r) {
  const m = new THREE.Mesh(UNIT_BALL, bm(0xffa53a));
  m.position.copy(p);
  m.scale.setScalar(0.3);
  scene.add(m);
  parts.push({ o: m, v: null, t: 0.45, T: 0.45, g: false, grow: r });
  const smoke = new THREE.Mesh(UNIT_BALL, bm(0x333333));
  smoke.position.copy(p).add(new THREE.Vector3(0, 0.3, 0));
  smoke.scale.setScalar(0.4);
  scene.add(smoke);
  parts.push({ o: smoke, v: new THREE.Vector3(0, 1.2, 0), t: 1.4, T: 1.4, g: false, grow: r * 0.9, smoke: true });
}
function clearList(list) {
  for (const it of list) scene.remove(it.o || it.m);
  list.length = 0;
}

/* ════════════════════════ PLAYER PHYSICS ════════════════════════ */
function collides(x, y, z) {
  const x0 = Math.floor(x - HW + 1e-4), x1 = Math.floor(x + HW - 1e-4);
  const y0 = Math.floor(y + 1e-4), y1 = Math.floor(y + PH - 1e-4);
  const z0 = Math.floor(z - HW + 1e-4), z1 = Math.floor(z + HW - 1e-4);
  for (let X = x0; X <= x1; X++) for (let Y = y0; Y <= y1; Y++) for (let Z = z0; Z <= z1; Z++) {
    if (solidAt(X, Y, Z)) return true;
  }
  return false;
}
function playerOverlaps(cx, cy, cz) {  // cell [cx..cx+1]
  return cx < P.x + HW && cx + 1 > P.x - HW && cy < P.y + PH && cy + 1 > P.y && cz < P.z + HW && cz + 1 > P.z - HW;
}

function physics(dt) {
  // gravity
  P.vy = Math.max(-40, P.vy - GRAV * dt);

  // input → target velocity
  const fwdX = -Math.sin(P.yaw), fwdZ = -Math.cos(P.yaw);
  const rgtX = Math.cos(P.yaw), rgtZ = -Math.sin(P.yaw);
  const mx = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  const mz = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
  let dx = fwdX * mz + rgtX * mx, dz = fwdZ * mz + rgtZ * mx;
  const len = Math.hypot(dx, dz);
  P.moving = len > 0.01;
  if (len > 0) { dx /= len; dz /= len; }
  const sprint = keys.ShiftLeft || keys.ShiftRight;
  const speed = (sprint ? 7.2 : 4.9);
  const k = P.onGround ? 14 : 3;
  P.vx += (dx * speed * (len > 0 ? 1 : 0) - P.vx) * Math.min(1, k * dt);
  P.vz += (dz * speed * (len > 0 ? 1 : 0) - P.vz) * Math.min(1, k * dt);

  if (keys.Space && P.onGround) { P.vy = JUMP; P.onGround = false; }

  // X axis (with 1-block step-up)
  let nx = P.x + P.vx * dt;
  if (!collides(nx, P.y, P.z)) P.x = nx;
  else if (P.onGround && !collides(nx, P.y + 1, P.z)) { P.y += 1; P.x = nx; }
  else P.vx = 0;
  // Z axis
  let nz = P.z + P.vz * dt;
  if (!collides(P.x, P.y, nz)) P.z = nz;
  else if (P.onGround && !collides(P.x, P.y + 1, nz)) { P.y += 1; P.z = nz; }
  else P.vz = 0;
  // Y axis
  const ny = P.y + P.vy * dt;
  if (!collides(P.x, ny, P.z)) { P.y = ny; P.onGround = false; }
  else { if (P.vy < 0) P.onGround = true; P.vy = 0; }

  // keep inside the map
  P.x = clamp(P.x, 1.5, MW - 1.5);
  P.z = clamp(P.z, 1.5, MD - 1.5);
  if (P.y < -20) { P.y = surfaceAt(P.x, P.z) + 2; P.vy = 0; }
}

/* ════════════════════════ VOXEL RAYCAST (Amanatides–Woo) ════════════════════════ */
function raycast(ox, oy, oz, dx, dy, dz, maxT) {
  let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
  if (solidAt(x, y, z)) return { hit: true, x, y, z, px: x, py: y, pz: z, t: 0 };
  const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
  const ax = Math.abs(dx) > 1e-9 ? 1 / Math.abs(dx) : Infinity;
  const ay = Math.abs(dy) > 1e-9 ? 1 / Math.abs(dy) : Infinity;
  const az = Math.abs(dz) > 1e-9 ? 1 / Math.abs(dz) : Infinity;
  let tx = ax === Infinity ? Infinity : (dx > 0 ? (x + 1 - ox) : (ox - x)) * ax;
  let ty = ay === Infinity ? Infinity : (dy > 0 ? (y + 1 - oy) : (oy - y)) * ay;
  let tz = az === Infinity ? Infinity : (dz > 0 ? (z + 1 - oz) : (oz - z)) * az;
  let nx = 0, ny = 0, nz = 0, t = 0;
  for (let i = 0; i < 1000; i++) {
    if (tx < ty && tx < tz) {
      t = tx; if (t > maxT) break;
      x += sx; tx += ax; nx = -sx; ny = 0; nz = 0;
    } else if (ty < tz) {
      t = ty; if (t > maxT) break;
      y += sy; ty += ay; ny = -sy; nx = 0; nz = 0;
    } else {
      t = tz; if (t > maxT) break;
      z += sz; tz += az; nz = -sz; nx = 0; ny = 0;
    }
    if (solidAt(x, y, z)) return { hit: true, x, y, z, px: x + nx, py: y + ny, pz: z + nz, t };
  }
  return { hit: false, t: maxT };
}

/* ════════════════════════ EXPLOSIONS & DAMAGE ════════════════════════ */
function damagePlayer(amount) {
  if (state !== 'play' || amount <= 0) return;
  P.hp -= amount;
  P.hurtT = 0;
  P.flash = 0.6;
  P.shake = Math.min(1, P.shake + amount / 40);
  sfx.hurt();
  if (P.hp <= 0) { P.hp = 0; gameOver(); }
}
function destroyBlocks(p, r) {
  const R = Math.ceil(r);
  const cx = Math.floor(p.x), cy = Math.floor(p.y), cz = Math.floor(p.z);
  for (let dy = -R; dy <= R; dy++) for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
    const x = cx + dx, y = cy + dy, z = cz + dz;
    if (!inB(x, z) || y < 0 || y >= MH) continue;
    const t = blocks[idx(x, y, z)];
    if (!t) continue;
    const d = Math.hypot(x + 0.5 - p.x, y + 0.5 - p.y, z + 0.5 - p.z);
    if (d <= r - BT[t].h) { blocks[idx(x, y, z)] = AIR; markDirty(x, y, z); }
  }
}
function explode(p, r, dmgP, hurtEnemies, dmgE, blockBreak) {
  const dp = Math.hypot(p.x - P.x, p.y - (P.y + 0.9), p.z - P.z);
  if (dp < r + 0.5) damagePlayer(dmgP * (1 - dp / (r + 0.5)));
  if (hurtEnemies) {
    for (const e of enemies) {
      if (e.dead) continue;
      const d = Math.hypot(e.x - p.x, e.y + 0.9 - p.y, e.z - p.z);
      if (d < r + 1) damageEnemy(e, dmgE * (1 - d / (r + 1)), false);
    }
  }
  if (blockBreak) destroyBlocks(p, r);
  fireball(p, r);
  debris(p, 0x6b5a48, 18, 9, 0.16);
  sfx.boom();
  P.shake = Math.min(1, P.shake + Math.max(0, 1 - dp / 12) * 0.6);
}

/* ════════════════════════ ENEMIES ════════════════════════ */
function spawnEnemy(type) {
  let x, z, s = 0;
  for (let tries = 0; tries < 30 && s <= 0; tries++) {
    x = rand(5, MW - 5); z = rand(3, 18);
    s = surfaceAt(x, z);
  }
  if (s <= 0) return;
  const soldier = type === 'soldier';
  const m = soldier ? buildSoldier() : buildTank();
  m.g.position.set(x, s, z);
  scene.add(m.g);
  const e = {
    type, ...m, x, z, y: s, yaw: rand(-0.3, 0.3),
    hp: soldier ? 60 : 320, maxHp: soldier ? 60 : 320,
    dead: false, deadT: 0, fireCd: rand(1.0, 2.2), phase: 0, moving: false,
    side: Math.random() < 0.5 ? -1 : 1, sideT: 0, turY: 0, flash: 0,
  };
  enemies.push(e);
}
function aliveCount() { let n = 0; for (const e of enemies) if (!e.dead) n++; return n; }

function standable(nx, nz, curY) {
  const ix = Math.floor(nx), iz = Math.floor(nz);
  if (ix < 2 || iz < 2 || ix >= MW - 2 || iz >= MD - 2) return -1;
  const s = surfaceAt(ix, iz);
  if (s - curY > 1.05) return -1;           // wall too high
  return s;
}

function damageEnemy(e, dmg, head) {
  if (e.dead) return;
  e.hp -= dmg;
  e.flash = 0.12;
  debris(new THREE.Vector3(e.x, e.y + (e.type === 'soldier' ? 1.4 : 1.0), e.z), 0x9a2a1a, e.type === 'soldier' ? 5 : 10, 4, 0.1);
  if (e.hp <= 0) {
    e.dead = true;
    e.deadT = 0;
    kills++;
    const bonus = e.type === 'tank' ? 500 : (head ? 150 : 100);
    score += bonus;
    showMsg(e.type === 'tank' ? `TANK DESTROYED +${bonus}` : (head ? `HEADSHOT +${bonus}` : `+${bonus}`), 0.9);
    if (e.type === 'tank') {
      fireball(new THREE.Vector3(e.x, e.y + 1, e.z), 2);
      sfx.boom();
    }
  }
}

function updateEnemy(e, dt) {
  if (e.dead) {
    e.deadT += dt;
    if (e.type === 'soldier') e.g.rotation.x = Math.min(Math.PI / 2, e.deadT * 6);
    else e.g.position.y = e.y - Math.min(0.5, e.deadT * 0.5);
    return;
  }
  if (e.flash > 0) e.flash -= dt;

  const soldier = e.type === 'soldier';
  const dx = P.x - e.x, dz = P.z - e.z;
  const d = Math.hypot(dx, dz) || 0.001;
  // line of sight to the player's chest
  const ex = e.x, ey = e.y + (soldier ? 1.55 : 1.7), ez = e.z;
  const tx = P.x, ty = P.y + 1.2, tz = P.z;
  const vx = tx - ex, vy = ty - ey, vz = tz - ez;
  const dist3 = Math.hypot(vx, vy, vz);
  const los = !raycast(ex, ey, ez, vx / dist3, vy / dist3, vz / dist3, dist3 - 0.3).hit;

  // movement intent
  const wantRange = soldier ? 16 : 26;
  let mx = 0, mz = 0;
  if (d > wantRange || !los) { mx = dx / d; mz = dz / d; }
  if (soldier && los && d <= wantRange) {
    e.sideT -= dt;
    if (e.sideT <= 0) { e.side = Math.random() < 0.5 ? -1 : 1; e.sideT = 1.2 + Math.random() * 1.5; }
    mx += (-dz / d) * e.side * 0.7;
    mz += (dx / d) * e.side * 0.7;
  }
  const speed = soldier ? 2.6 : 1.5;
  const ml = Math.hypot(mx, mz);
  e.moving = ml > 0.05;
  if (e.moving) {
    const ux = mx / ml, uz = mz / ml;
    const step = speed * dt;
    // try the intended direction, then rotate to slide around obstacles
    const angles = [0, 0.6, -0.6, 1.2, -1.2, 1.9, -1.9];
    for (const a of angles) {
      const c = Math.cos(a), s = Math.sin(a);
      const dirX = ux * c - uz * s, dirZ = ux * s + uz * c;
      const nx = e.x + dirX * step, nz = e.z + dirZ * step;
      const sy = standable(nx, nz, e.y);
      if (sy >= 0) {
        e.x = nx; e.z = nz; e.y = sy;
        if (!soldier) e.yaw += angDiff(e.yaw, Math.atan2(dirX, dirZ)) * Math.min(1, dt * 3);
        break;
      }
    }
  }
  // face the player (soldiers), turret tracks player (tanks)
  const aimYaw = Math.atan2(dx, dz);
  if (soldier) e.yaw += angDiff(e.yaw, aimYaw) * Math.min(1, dt * 5);
  e.turY = e.turY + angDiff(e.turY, aimYaw - e.yaw) * Math.min(1, dt * 4);

  // visuals (done before firing so muzzle transforms are current)
  e.g.position.set(e.x, e.y, e.z);
  e.g.rotation.y = e.yaw;
  if (soldier) {
    e.phase += dt * (e.moving ? 9 : 0);
    e.legL.rotation.x = e.moving ? Math.sin(e.phase) * 0.7 : 0;
    e.legR.rotation.x = e.moving ? -Math.sin(e.phase) * 0.7 : 0;
    e.armL.rotation.x = -1.35 + (e.moving ? Math.sin(e.phase) * 0.08 : 0);
    e.armR.rotation.x = -1.45;
  } else {
    e.turret.rotation.y = e.turY;
  }

  // firing
  e.fireCd -= dt;
  const range = soldier ? 30 : 75;
  if (los && d < range && e.fireCd <= 0) {
    if (soldier) {
      e.fireCd = 1.1 + Math.random() * 1.0;
      e.g.updateMatrixWorld(true);
      const mz2 = e.g.localToWorld(new THREE.Vector3(0.15, 1.25, 1.0));
      const aim = new THREE.Vector3(tx + rand(-0.4, 0.4), ty + rand(-0.4, 0.3), tz + rand(-0.4, 0.4));
      tracer(mz2, aim, 0xff6a4a, 0.06);
      sfx.enemyShot();
      const hc = clamp(0.8 - d * 0.02, 0.12, 0.7) * (P.moving ? 0.7 : 1);
      if (Math.random() < hc) damagePlayer(5 + Math.random() * 5);
    } else {
      e.fireCd = 3.2;
      e.g.updateMatrixWorld(true);
      const mzl = e.g.localToWorld(new THREE.Vector3(0, 1.2, 1.9));
      const dir = new THREE.Vector3(tx - mzl.x, ty - mzl.y, tz - mzl.z).normalize();
      dir.x += rand(-0.03, 0.03); dir.y += rand(-0.02, 0.02); dir.z += rand(-0.03, 0.03);
      dir.normalize();
      const shell = new THREE.Mesh(UNIT_BALL, bm(0xffd060));
      shell.scale.setScalar(0.16);
      shell.position.copy(mzl);
      scene.add(shell);
      shells.push({ m: shell, p: mzl.clone(), v: dir.multiplyScalar(36), t: 6 });
      sfx.tank();
    }
  }

}

/* ════════════════════════ SHELLS & GRENADES ════════════════════════ */
function updateShells(dt) {
  for (let i = shells.length - 1; i >= 0; i--) {
    const s = shells[i];
    s.t -= dt;
    const prev = s.p.clone();
    s.p.addScaledVector(s.v, dt);
    s.m.position.copy(s.p);
    let boom = false, at = s.p;
    if (solidAt(Math.floor(s.p.x), Math.floor(s.p.y), Math.floor(s.p.z))) { boom = true; at = prev; }
    const dp = Math.hypot(s.p.x - P.x, s.p.y - (P.y + 1), s.p.z - P.z);
    if (dp < 0.8) boom = true;
    if (boom) {
      explode(at, 2.2, 45, false, 0, true);
      scene.remove(s.m);
      shells.splice(i, 1);
    } else if (s.t <= 0) {
      scene.remove(s.m);
      shells.splice(i, 1);
    }
  }
}
function updateGrenades(dt) {
  for (let i = grenades.length - 1; i >= 0; i--) {
    const g = grenades[i];
    g.t -= dt;
    g.v.y -= 22 * dt;
    const nx = g.p.x + g.v.x * dt, ny = g.p.y + g.v.y * dt, nz = g.p.z + g.v.z * dt;
    if (solidAt(Math.floor(nx), Math.floor(g.p.y), Math.floor(g.p.z))) { g.v.x *= -0.4; } else g.p.x = nx;
    if (solidAt(Math.floor(g.p.x), Math.floor(ny), Math.floor(g.p.z))) { g.v.y *= -0.35; g.v.x *= 0.7; g.v.z *= 0.7; } else g.p.y = ny;
    if (solidAt(Math.floor(g.p.x), Math.floor(g.p.y), Math.floor(nz))) { g.v.z *= -0.4; } else g.p.z = nz;
    g.m.position.copy(g.p);
    if (g.t <= 0) {
      explode(g.p, 3.2, 70, true, 170, true);
      scene.remove(g.m);
      grenades.splice(i, 1);
    }
  }
}
function throwGrenade() {
  if (state !== 'play' || P.nades <= 0) return;
  P.nades--;
  const dir = new THREE.Vector3(-Math.sin(P.yaw) * Math.cos(P.pitch), Math.sin(P.pitch), -Math.cos(P.yaw) * Math.cos(P.pitch));
  const p = new THREE.Vector3(P.x, P.y + EYE, P.z).addScaledVector(dir, 0.6);
  const m = new THREE.Mesh(UNIT_BALL, lm(0x3f5a2a));
  m.scale.setScalar(0.14);
  scene.add(m);
  const v = dir.clone().multiplyScalar(16); v.y += 5;
  grenades.push({ m, p, v, t: 1.8 });
}

/* ════════════════════════ PLAYER ACTIONS ════════════════════════ */
function fire() {
  if (state !== 'play') return;
  const now = performance.now() / 1000;
  if (P.reloadT > 0) return;
  if (P.ammo <= 0) { reload(); return; }
  if (now - P.lastShot < SHOT_INTERVAL) return;
  P.lastShot = now;
  P.ammo--;
  P.kick = 1;
  sfx.shot();

  camera.updateMatrixWorld(true);
  const origin = new THREE.Vector3();
  camera.getWorldPosition(origin);
  const dir = forward();
  const spread = P.moving ? 0.02 : 0.008;
  dir.x += rand(-spread, spread); dir.y += rand(-spread, spread); dir.z += rand(-spread, spread);
  dir.normalize();

  const v = raycast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, 200);
  const td = v.hit ? v.t : 200;
  const ray = new THREE.Ray(origin, dir);
  let best = null;
  for (const e of enemies) {
    if (e.dead) continue;
    const r = e.type === 'tank' ? 1.3 : 0.42;
    const h = e.type === 'tank' ? 1.6 : 1.98;
    const box3 = new THREE.Box3(new THREE.Vector3(e.x - r, e.y, e.z - r), new THREE.Vector3(e.x + r, e.y + h, e.z + r));
    const p = ray.intersectBox(box3, new THREE.Vector3());
    if (!p) continue;
    const dd = p.distanceTo(origin);
    if (dd < td && (!best || dd < best.dd)) best = { e, dd, p: p.clone() };
  }

  const muzzle = viewmodel.localToWorld(viewmodel.muzzleLocal.clone());
  let end;
  if (best) {
    const head = best.e.type === 'soldier' && best.p.y > best.e.y + 1.5;
    if (best.e.type === 'tank') damageEnemy(best.e, 9, false);
    else damageEnemy(best.e, 34 * (head ? 2.5 : 1), head);
    sfx.hit();
    const cr = document.getElementById('cross');
    cr.classList.add('hit');
    setTimeout(() => cr.classList.remove('hit'), 120);
    end = best.p;
  } else if (v.hit) {
    end = origin.clone().addScaledVector(dir, td);
    debris(end, BT[blocks[idx(v.x, v.y, v.z)]]?.c ?? 0x888888, 4, 3, 0.07);
  } else {
    end = origin.clone().addScaledVector(dir, 120);
  }
  tracer(muzzle, end, 0xffe27a, 0.05);
  if (P.ammo === 0) reload();
}
function reload() {
  if (state !== 'play' || P.reloadT > 0 || P.ammo >= MAG || P.reserve <= 0) return;
  P.reloadT = 1.6;
  sfx.reload();
}
function forward() {
  return new THREE.Vector3(-Math.sin(P.yaw) * Math.cos(P.pitch), Math.sin(P.pitch), -Math.cos(P.yaw) * Math.cos(P.pitch));
}
function boxOverlapsPlayer(x, y, z) { return playerOverlaps(x, y, z); }

function digOrPlace(place) {
  if (state !== 'play') return;
  camera.updateMatrixWorld(true);
  const origin = new THREE.Vector3(); camera.getWorldPosition(origin);
  const dir = forward();
  const v = raycast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, 7);
  if (!v.hit) return;
  if (place) {
    if (!inB(v.px, v.pz) || v.py < 0 || v.py >= MH) return;
    if (blocks[idx(v.px, v.py, v.pz)] !== AIR) return;
    if (boxOverlapsPlayer(v.px, v.py, v.pz)) return;
    if (enemies.some((e) => !e.dead && Math.abs(e.x - (v.px + 0.5)) < 0.9 && Math.abs(e.z - (v.pz + 0.5)) < 0.9 && e.y < v.py + 1 && e.y + 1.9 > v.py)) return;
    const t = HOTBAR[P.sel];
    setBlock(v.px, v.py, v.pz, t);
    sfx.place();
  } else {
    const t = blocks[idx(v.x, v.y, v.z)];
    if (!t || t === STEEL) { if (t === STEEL) showMsg('Steel is too strong to dig!', 0.8); return; }
    setBlock(v.x, v.y, v.z, AIR);
    debris(new THREE.Vector3(v.x + 0.5, v.y + 0.5, v.z + 0.5), BT[t].c, 6, 3, 0.12);
    sfx.click();
  }
}

/* ════════════════════════ HUD / UI ════════════════════════ */
const hotbarEl = $('hotbar');
HOTBAR.forEach((t, i) => {
  const d = document.createElement('div');
  d.className = 'slot';
  d.innerHTML = `<span class="k">${i + 1}</span><div class="sw" style="background:#${BT[t].c.toString(16).padStart(6, '0')}"></div><span class="n">${BT[t].n}</span>`;
  hotbarEl.appendChild(d);
});
const hotSlots = [...hotbarEl.children];

let msgTimer = 0;
function showMsg(text, secs = 1.5) {
  const el = $('msg');
  el.textContent = text;
  el.style.opacity = 1;
  msgTimer = secs;
}
function updateHud() {
  $('hpFill').style.width = (P.hp / 100 * 100).toFixed(0) + '%';
  $('hpTxt').textContent = Math.ceil(P.hp);
  $('waveTxt').textContent = wave === 0 ? 'STAND BY' : `WAVE ${wave}`;
  const left = aliveCount() + spawnQueue.length;
  $('infoTxt').textContent = `score ${score} · kills ${kills} · enemies ${left}`;
  $('ammoTxt').textContent = P.reloadT > 0 ? 'RELOADING…' : `${P.ammo} / ${P.reserve}`;
  $('nadeTxt').textContent = `x${P.nades}`;
  hotSlots.forEach((s, i) => s.classList.toggle('on', i === P.sel));
}
function gameOver() {
  state = 'over';
  $('oWave').textContent = wave;
  $('oKills').textContent = kills;
  $('oScore').textContent = score;
  $('over').classList.remove('hide');
  if (document.pointerLockElement) document.exitPointerLock();
}

/* ════════════════════════ GAME FLOW ════════════════════════ */
function startWave(n) {
  wave = n;
  const soldiers = 4 + n * 2;
  const tanks = n >= 2 ? Math.min(6, n - 1) : 0;
  const list = [];
  for (let i = 0; i < soldiers; i++) list.push('soldier');
  for (let i = 0; i < tanks; i++) list.push('tank');
  for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
  spawnQueue = list;
  spawnT = 0.5;
  showMsg(`WAVE ${n}` + (tanks ? ` — ${tanks} TANK${tanks > 1 ? 'S' : ''}!` : ''), 2.5);
}

function resetGame() {
  for (const e of enemies) scene.remove(e.g);
  enemies.length = 0;
  clearList(shells);
  clearList(grenades);
  clearList(parts);
  clearList(tracers);
  generateWorld((Math.random() * 1e9) | 0);
  rebuildAll();
  const sy = surfaceAt(PLAYER_SPAWN.x, PLAYER_SPAWN.z);
  Object.assign(P, {
    x: PLAYER_SPAWN.x, y: sy + 0.01, z: PLAYER_SPAWN.z, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: -0.05,
    onGround: false, moving: false, hp: 100, hurtT: 99, ammo: MAG, reserve: 120, nades: 3,
    reloadT: 0, sel: 0, flash: 0, shake: 0, lastShot: -10, kick: 0,
  });
  wave = 0; score = 0; kills = 0;
  spawnQueue = []; spawnT = 0;
  intermission = 3;
  lockGrace = 1.2;
  ignoreMouseUntil = performance.now() + 600;
  state = 'play';
  $('start').classList.add('hide');
  $('over').classList.add('hide');
  $('pause').classList.add('hide');
  $('hud').style.display = 'block';
  showMsg('Hold the line! First wave incoming…', 2.5);
}

function lockPointer() {
  const el = renderer.domElement;
  try {
    const p = el.requestPointerLock();
    if (p && p.catch) p.catch(enableNoLock);
  } catch (e) { enableNoLock(); }
}

$('btnStart').addEventListener('click', () => {
  window.__gestured = true;
  ac();
  resetGame();
  lockPointer();
});
$('btnRedeploy').addEventListener('click', () => {
  window.__gestured = true;
  resetGame();
  lockPointer();
});
$('btnResume').addEventListener('click', () => { if (state === 'paused') lockPointer(); });
$('pause').addEventListener('click', () => { if (state === 'paused') lockPointer(); });

document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement) {
    if (state === 'paused') { state = 'play'; $('pause').classList.add('hide'); }
  }
});
function enableNoLock() {
  noLock = true;
  if (state === 'paused') { state = 'play'; $('pause').classList.add('hide'); lockGrace = 0.5; }
}
document.addEventListener('pointerlockerror', enableNoLock);

/* ════════════════════════ INPUT ════════════════════════ */
const isPlayingInput = () => state === 'play';
document.addEventListener('keydown', (e) => {
  if (state === 'menu' || state === 'over') { if (e.code === 'Enter' && state === 'menu') $('btnStart').click(); return; }
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
  keys[e.code] = true;
  if (e.repeat) return;
  if (e.code === 'KeyR') reload();
  if (e.code === 'KeyQ') throwGrenade();
  if (e.code === 'KeyF') digOrPlace(false);
  if (e.code.startsWith('Digit')) {
    const n = parseInt(e.code.slice(5), 10);
    if (n >= 1 && n <= 6) P.sel = n - 1;
  }
  if (e.code === 'Escape' && state === 'play') {
    if (document.pointerLockElement) document.exitPointerLock();
    state = 'paused';
    $('pause').classList.remove('hide');
  }
});
document.addEventListener('keyup', (e) => { keys[e.code] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouseDown[0] = mouseDown[2] = false; });

renderer.domElement.addEventListener('mousedown', (e) => {
  mouseDown[e.button] = true;
  if (state !== 'play') return;
  if (e.button === 0) fire();
  if (e.button === 2) digOrPlace(true);
});
window.addEventListener('mouseup', (e) => { mouseDown[e.button] = false; });
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('contextmenu', (e) => e.preventDefault());
renderer.domElement.addEventListener('wheel', (e) => {
  if (state !== 'play') return;
  P.sel = (P.sel + (e.deltaY > 0 ? 1 : -1) + HOTBAR.length) % HOTBAR.length;
}, { passive: true });

document.addEventListener('mousemove', (e) => {
  if (state !== 'play') return;
  const looking = document.pointerLockElement || (noLock && (mouseDown[0] || mouseDown[2]));
  if (!looking) return;
  if (performance.now() < ignoreMouseUntil) return;   // swallow the stale delta from the click that started the game
  const dx = clamp(e.movementX, -80, 80), dy = clamp(e.movementY, -80, 80);
  P.yaw -= dx * 0.0021;
  P.pitch = clamp(P.pitch - dy * 0.0021, -1.45, 1.45);
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

/* ════════════════════════ MAIN LOOP ════════════════════════ */
// Initial world so the start screen has a backdrop
generateWorld((Math.random() * 1e9) | 0);
rebuildAll();
{
  const sy = surfaceAt(PLAYER_SPAWN.x, PLAYER_SPAWN.z);
  Object.assign(P, { x: PLAYER_SPAWN.x, y: sy + 0.01, z: PLAYER_SPAWN.z, yaw: 0, pitch: -0.05, hp: 100 });
}

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (state === 'play') {
    if (lockGrace > 0) lockGrace -= dt;
    else if (!document.pointerLockElement && !noLock) {
      state = 'paused';
      $('pause').classList.remove('hide');
    }

    // reload progress
    if (P.reloadT > 0) {
      P.reloadT -= dt;
      if (P.reloadT <= 0) {
        P.reloadT = 0;
        const take = Math.min(MAG - P.ammo, P.reserve);
        P.ammo += take; P.reserve -= take;
      }
    }
    // hold-to-fire
    if (mouseDown[0]) fire();

    physics(dt);

    // health regen
    P.hurtT += dt;
    if (P.hurtT > 5 && P.hp < 100) P.hp = Math.min(100, P.hp + 12 * dt);

    // wave director
    if (spawnQueue.length) {
      spawnT -= dt;
      if (spawnT <= 0) { spawnEnemy(spawnQueue.shift()); spawnT = 1.0 + Math.random() * 0.8; }
    } else if (aliveCount() === 0) {
      if (intermission === null) {
        intermission = 4;
        if (wave > 0) {
          P.reserve += 40; P.nades = Math.min(5, P.nades + 1);
          showMsg(`Wave ${wave} cleared! +40 ammo +1 grenade`, 3.5);
        }
      }
      intermission -= dt;
      if (intermission <= 0) { intermission = null; startWave(wave + 1); }
    }

    for (const e of enemies) updateEnemy(e, dt);
    // remove long-dead enemies
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      if (e.dead && e.deadT > 6) { scene.remove(e.g); enemies.splice(i, 1); }
    }
    updateShells(dt);
    updateGrenades(dt);
  }

  // particles, tracers (always run for a smooth pause fade)
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    p.t -= dt;
    if (p.v) {
      p.o.position.addScaledVector(p.v, dt);
      if (p.g) p.v.y -= 18 * dt;
    }
    if (p.grow) {
      const k = 1 - Math.max(0, p.t) / (p.T || 0.6);
      const s = p.smoke ? p.grow * (0.4 + k * 1.2) : p.grow * (0.3 + k * 0.9);
      p.o.scale.setScalar(Math.max(0.05, s));
    }
    if (p.t <= 0) { scene.remove(p.o); parts.splice(i, 1); }
  }
  for (let i = tracers.length - 1; i >= 0; i--) {
    tracers[i].t -= dt;
    if (tracers[i].t <= 0) {
      scene.remove(tracers[i].o);
      tracers[i].o.geometry.dispose();
      tracers[i].o.material.dispose();
      tracers.splice(i, 1);
    }
  }

  // world meshing (budgeted)
  updateDirty(6);

  // camera
  P.yaw = P.yaw % (Math.PI * 2);
  camera.position.set(P.x, P.y + EYE, P.z);
  if (P.shake > 0) {
    P.shake = Math.max(0, P.shake - dt * 2.2);
    camera.position.x += (Math.random() - 0.5) * P.shake * 0.25;
    camera.position.y += (Math.random() - 0.5) * P.shake * 0.25;
  }
  camera.rotation.set(P.pitch, P.yaw, 0);
  // viewmodel: bob, recoil, reload dip
  P.kick = Math.max(0, P.kick - dt * 9);
  const bob = P.moving && P.onGround ? Math.sin(now / 110) * 0.012 : 0;
  const reloadDip = P.reloadT > 0 ? Math.sin((1.6 - P.reloadT) / 1.6 * Math.PI) * 0.16 : 0;
  viewmodel.position.set(0.24, -0.22 + bob - reloadDip, -0.46 + P.kick * 0.06);
  viewmodel.rotation.x = P.kick * 0.12 + reloadDip * 0.5;

  // HUD messages
  if (msgTimer > 0) {
    msgTimer -= dt;
    if (msgTimer <= 0) $('msg').style.opacity = 0;
  }
  if (state !== 'menu') updateHud();
  $('flash').style.opacity = clamp(P.flash, 0, 1) * (P.hp < 35 ? 1 : 0.8);
  if (P.flash > 0) P.flash = Math.max(0, P.flash - dt * 1.8);

  renderer.render(scene, camera);
}

// ----- sanity: expose minimal debug handle
window.__ww = { P, enemies, blocks, generateWorld, get state() { return state; } };
requestAnimationFrame(frame);
