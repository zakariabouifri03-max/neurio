// One-Armed Robber — a first-person 3D heist, built with Three.js (vendored, no build step).
import * as THREE from 'three';

const PI = Math.PI;
const TAU = PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rnd = (a, b) => a + Math.random() * (b - a);
const fmt$ = (n) => '$' + Math.round(n).toLocaleString('en-US');
const fmtT = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ───────────────────────── tunables ─────────────────────────
const CFG = {
  radius: 0.35,        // player/guard collision radius
  walk: 4.0,
  sprint: 6.6,
  crouch: 2.0,
  maxHp: 100,
  policeTime: 60,      // seconds from alarm until police arrive
  heatDecay: 9,        // heat/s when nobody sees you
  guardHeat: 60,       // heat/s while a guard can see you (crouched: 28)
  camHeat: 38,         // heat/s while a camera sees you
  guardSpeed: 1.6,     // patrol speed
  chaseSpeed: 4.6,     // guard speed during alarm
  guardFov: 0.75,      // half-angle of guard vision (rad)
  guardRange: 14,
  camFov: 0.5,
  camRange: 13,
};

const WORLD = { minX: -24, maxX: 24, minZ: -22, maxZ: 30 };
const ESCAPE = { minX: -4, maxX: 4, minZ: 15, maxZ: 20.5 };
const START = { x: -6, z: 19.5 };
const BEST_KEY = 'oneArmedRobber.best';

// ───────────────────────── DOM ─────────────────────────
const $ = (id) => document.getElementById(id);
const el = {
  menu: $('menu'), pause: $('pause'), over: $('over'), hack: $('hack'), hud: $('hud'),
  heat: $('heatFill'), hp: $('hpFill'), bagVal: $('bagVal'), bagW: $('bagW'), time: $('time'),
  police: $('police'), policeT: $('policeT'), objective: $('objective'),
  prompt: $('prompt'), promptText: $('promptText'), promptFill: $('promptFill'),
  toast: $('toast'), hurt: $('hurt'), mini: $('minimap').getContext('2d'),
  overTitle: $('overTitle'), overBody: $('overBody'), best: $('best'), bestMenu: $('bestMenu'),
  hackMsg: $('hackMsg'), pads: [...document.querySelectorAll('.pad')],
};

// ───────────────────────── renderer / scene ─────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
$('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x070b16);
scene.fog = new THREE.Fog(0x070b16, 24, 62);

const camera = new THREE.PerspectiveCamera(74, innerWidth / innerHeight, 0.05, 120);
scene.add(camera);

scene.add(new THREE.HemisphereLight(0x9db4ff, 0x20202a, 0.6));
const moon = new THREE.DirectionalLight(0x9db7ff, 0.45);
moon.position.set(-18, 30, 12);
scene.add(moon);

// ───────────────────────── materials ─────────────────────────
const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra });
const M = {
  wall: std(0xe9dfca, { roughness: 0.92 }),
  outer: std(0x5d564e, { roughness: 1 }),
  counter: std(0x7a4f2a, { roughness: 0.55 }),
  steel: std(0x8d969e, { roughness: 0.35, metalness: 0.6 }),
  steelDark: std(0x4b535c, { roughness: 0.5, metalness: 0.5 }),
  gold: std(0xffc83d, { roughness: 0.25, metalness: 0.9, emissive: 0x4a3300, emissiveIntensity: 0.4 }),
  cash: std(0x3f7d3a, { roughness: 0.85 }),
  cashBand: std(0xe2f5d4, { roughness: 0.9 }),
  glass: new THREE.MeshStandardMaterial({ color: 0xa5dcff, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.32 }),
  gem: std(0xd946ef, { emissive: 0x6b1576, roughness: 0.2, metalness: 0.4 }),
  lamp: new THREE.MeshStandardMaterial({ color: 0xfff4d0, emissive: 0xfff0c0, emissiveIntensity: 1.6 }),
  dark: std(0x1d2330, { roughness: 0.85 }),
  van: std(0xf1f5f9, { roughness: 0.6 }),
  vanStripe: std(0x16a34a, { roughness: 0.5 }),
  zone: new THREE.MeshBasicMaterial({ color: 0x22c55e, transparent: true, opacity: 0.22, depthWrite: false }),
  uniform: std(0x1e3a8a, { roughness: 0.8 }),
  cap: std(0x0b1020, { roughness: 0.7 }),
  skin: std(0xd99a6c, { roughness: 0.7 }),
  sleeve: std(0x1b2430, { roughness: 0.9 }),
  sack: std(0x9a6b35, { roughness: 0.95 }),
  lens: new THREE.MeshBasicMaterial({ color: 0xff3b3b }),
  led: new THREE.MeshBasicMaterial({ color: 0x22c55e }),
};

// tiny procedural canvas textures (no image files)
function canvasTex(size, draw, rx = 1, ry = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
const TEX = {
  tile: canvasTex(128, (g, s) => {
    g.fillStyle = '#e8e2d4'; g.fillRect(0, 0, s, s);
    g.fillStyle = '#cfc6b2'; g.fillRect(0, 0, s / 2, s / 2); g.fillRect(s / 2, s / 2, s / 2, s / 2);
    g.strokeStyle = 'rgba(0,0,0,.18)'; g.lineWidth = 2; g.strokeRect(0, 0, s, s);
  }, 9, 7),
  asphalt: canvasTex(256, (g, s) => {
    g.fillStyle = '#2a2f37'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 900; i++) {
      g.fillStyle = `rgba(255,255,255,${Math.random() * 0.06})`;
      g.fillRect(Math.random() * s, Math.random() * s, 2, 2);
    }
  }, 12, 13),
};
M.floor = new THREE.MeshStandardMaterial({ map: TEX.tile, roughness: 0.6 });
M.ground = new THREE.MeshStandardMaterial({ map: TEX.asphalt, roughness: 1 });

// ───────────────────────── game state ─────────────────────────
let state = 'menu'; // menu | play | pause | hack | over
let world = null;
let solids = [];    // 2D AABBs { minX,maxX,minZ,maxZ } used for collision + line of sight
let items = [];     // loot / doors / keypads
let guards = [];
let cams = [];
let tracers = [];
let alarmLight = null;
let P = null;       // player
let heat = 0, alarm = false, policeT = 0, elapsed = 0;
let alarmTimer = null;
let hackSeq = [], hackIdx = 0, hackAccept = false, hackToken = 0;
let bestLoot = Number(localStorage.getItem(BEST_KEY) || 0) || 0;
const keys = {};
let mouseDown = false;

// ───────────────────────── audio (synth, zero files) ─────────────────────────
let actx = null;
function audio() {
  if (!actx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    actx = new AC();
  }
  if (actx.state === 'suspended') actx.resume();
  return actx;
}
function tone(f, d, type = 'square', v = 0.05, slideTo = 0) {
  const a = audio(); if (!a) return;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(f, a.currentTime);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, a.currentTime + d);
  g.gain.setValueAtTime(v, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + d);
  o.connect(g).connect(a.destination);
  o.start(); o.stop(a.currentTime + d + 0.02);
}
function noise(d, v = 0.2) {
  const a = audio(); if (!a) return;
  const buf = a.createBuffer(1, Math.floor(a.sampleRate * d), a.sampleRate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / ch.length);
  const src = a.createBufferSource(), g = a.createGain();
  g.gain.value = v; src.buffer = buf; src.connect(g).connect(a.destination); src.start();
}
const SFX = {
  coin() { tone(880, 0.08); setTimeout(() => tone(1320, 0.12), 70); },
  lock() { tone(1400, 0.06, 'triangle', 0.06); },
  punch() { noise(0.12, 0.25); tone(220, 0.1, 'triangle', 0.08, 120); },
  hit() { tone(160, 0.2, 'sawtooth', 0.12, 60); },
  shot() { noise(0.16, 0.3); tone(260, 0.08, 'square', 0.04, 110); },
  ok() { tone(523, 0.1); setTimeout(() => tone(784, 0.2), 100); },
  bad() { tone(140, 0.3, 'square', 0.1, 90); },
  blip() { tone(660, 0.05, 'square', 0.03); },
  alarmOn() { tone(1200, 0.4, 'sawtooth', 0.06, 600); },
};
function startAlarmSound() {
  stopAlarmSound();
  alarmTimer = setInterval(() => {
    tone(960, 0.25, 'sawtooth', 0.035);
    setTimeout(() => tone(720, 0.25, 'sawtooth', 0.035), 260);
  }, 540);
}
function stopAlarmSound() { if (alarmTimer) clearInterval(alarmTimer); alarmTimer = null; }

// ───────────────────────── small helpers ─────────────────────────
function addSolid(x0, x1, z0, z1) {
  const s = { minX: x0, maxX: x1, minZ: z0, maxZ: z1 };
  solids.push(s);
  return s;
}
function removeSolid(s) {
  if (!s) return;
  const i = solids.indexOf(s);
  if (i >= 0) { solids.splice(i, 1); rebuildNav(); }
}
function block(x0, x1, z0, z1, h, mat, y0 = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, h, z1 - z0), mat);
  m.position.set((x0 + x1) / 2, y0 + h / 2, (z0 + z1) / 2);
  world.add(m);
  return { mesh: m, solid: addSolid(x0, x1, z0, z1) };
}
// interior partition walls (thickness 0.4)
const wallH = (x0, x1, z) => block(x0, x1, z - 0.2, z + 0.2, 4, M.wall);
const wallV = (x, z0, z1) => block(x - 0.2, x + 0.2, z0, z1, 4, M.wall);

function turnToward(cur, tgt, k) {
  let d = tgt - cur;
  while (d > PI) d -= TAU;
  while (d < -PI) d += TAU;
  return cur + d * Math.min(1, k);
}
// circle vs AABB push-out (player + NPCs)
function collide(o, r) {
  for (const s of solids) {
    const cx = clamp(o.x, s.minX, s.maxX), cz = clamp(o.z, s.minZ, s.maxZ);
    const dx = o.x - cx, dz = o.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= r * r) continue;
    if (d2 > 1e-10) {
      const d = Math.sqrt(d2), k = (r - d) / d;
      o.x += dx * k; o.z += dz * k;
    } else {
      const l = o.x - s.minX, rr = s.maxX - o.x, u = o.z - s.minZ, dn = s.maxZ - o.z;
      const m = Math.min(l, rr, u, dn);
      if (m === l) o.x = s.minX - r;
      else if (m === rr) o.x = s.maxX + r;
      else if (m === u) o.z = s.minZ - r;
      else o.z = s.maxZ + r;
    }
  }
}
// ── navigation grid for chasing guards (BFS over 0.5 m cells) ──
const NAV = { cell: 0.5, ox: -24, oz: -22, nx: 96, nz: 104, blocked: null };
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
function rebuildNav() {
  const { cell, ox, oz, nx, nz } = NAV;
  const b = new Uint8Array(nx * nz);
  const r = CFG.radius + 0.05;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = ox + (i + 0.5) * cell, z = oz + (j + 0.5) * cell;
      for (const s of solids) {
        if (x > s.minX - r && x < s.maxX + r && z > s.minZ - r && z < s.maxZ + r) { b[j * nx + i] = 1; break; }
      }
    }
  }
  NAV.blocked = b;
}
// returns the next waypoint [x,z] on a shortest grid path from (x0,z0) to (x1,z1), or null
function findNextStep(x0, z0, x1, z1) {
  const { cell, ox, oz, nx, nz, blocked } = NAV;
  if (!blocked) return null;
  const si = clamp(Math.floor((x0 - ox) / cell), 0, nx - 1), sj = clamp(Math.floor((z0 - oz) / cell), 0, nz - 1);
  const gi = clamp(Math.floor((x1 - ox) / cell), 0, nx - 1), gj = clamp(Math.floor((z1 - oz) / cell), 0, nz - 1);
  const start = sj * nx + si, goal = gj * nx + gi;
  if (start === goal) return null;
  const prev = new Int32Array(nx * nz).fill(-1);
  const q = new Int32Array(nx * nz);
  let qh = 0, qt = 0, found = false;
  prev[start] = start; q[qt++] = start;
  while (qh < qt) {
    const c = q[qh++];
    if (c === goal) { found = true; break; }
    const ci = c % nx, cj = (c / nx) | 0;
    for (const [di, dj] of DIRS) {
      const ni = ci + di, nj = cj + dj;
      if (ni < 0 || nj < 0 || ni >= nx || nj >= nz) continue;
      const n = nj * nx + ni;
      if (prev[n] !== -1) continue;
      if (blocked[n] && n !== goal) continue;
      prev[n] = c; q[qt++] = n;
    }
  }
  if (!found) return null;
  let c = goal;
  while (prev[c] !== start) c = prev[c];
  return [ox + ((c % nx) + 0.5) * cell, oz + (((c / nx) | 0) + 0.5) * cell];
}

function moveCircle(o, dx, dz, r) {
  o.x += dx; collide(o, r);
  o.z += dz; collide(o, r);
}
// Liang–Barsky segment vs AABB
function segHitsRect(x0, z0, x1, z1, s) {
  let t0 = 0, t1 = 1;
  const dx = x1 - x0, dz = z1 - z0;
  const p = [-dx, dx, -dz, dz];
  const q = [x0 - s.minX, s.maxX - x0, z0 - s.minZ, s.maxZ - z0];
  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]) < 1e-9) {
      if (q[i] < 0) return false;
    } else {
      const r = q[i] / p[i];
      if (p[i] < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
      else { if (r < t0) return false; if (r < t1) t1 = r; }
    }
  }
  return true;
}
function segBlocked(x0, z0, x1, z1) {
  for (const s of solids) if (segHitsRect(x0, z0, x1, z1, s)) return true;
  return false;
}
// is point (px,pz) inside a cone from (x,z) facing yaw (forward = sin,cos) ?
function inCone(x, z, yaw, range, half, px, pz) {
  const dx = px - x, dz = pz - z;
  const d = Math.hypot(dx, dz);
  if (d > range || d < 1e-6) return false;
  const cosA = (dx * Math.sin(yaw) + dz * Math.cos(yaw)) / d;
  return cosA >= Math.cos(half);
}
function seesPlayer(x, z, yaw, range, half) {
  if (!inCone(x, z, yaw, range, half, P.x, P.z)) return false;
  return !segBlocked(x, z, P.x, P.z);
}
function makeCone(range, half, color) {
  const r = range * Math.tan(half);
  const geo = new THREE.ConeGeometry(r, range, 20, 1, true);
  geo.translate(0, -range / 2, 0); // apex at origin
  geo.rotateX(-PI / 2);            // apex→origin, base along local +z
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.13, depthWrite: false, side: THREE.DoubleSide });
  return new THREE.Mesh(geo, mat);
}

// ───────────────────────── level ─────────────────────────
function buildLevel() {
  if (world) scene.remove(world);
  world = new THREE.Group();
  scene.add(world);
  solids = []; items = []; guards = []; cams = []; tracers = [];

  // ground + building floor/ceiling
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(48, 52), M.ground);
  ground.rotation.x = -PI / 2; ground.position.set(0, 0, 4);
  world.add(ground);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(36, 28), M.floor);
  floor.rotation.x = -PI / 2; floor.position.set(0, 0.02, 0);
  world.add(floor);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(36, 28), std(0xd9d4c5, { roughness: 1 }));
  ceil.rotation.x = PI / 2; ceil.position.set(0, 4, 0);
  world.add(ceil);

  // outer walls (south has the back door gap at x∈[-1.5,1.5])
  block(-18.2, 18.2, -14.2, -13.8, 4, M.outer);   // north
  block(-18.4, -1.5, 13.8, 14.2, 4, M.outer);     // south-left
  block(1.5, 18.4, 13.8, 14.2, 4, M.outer);       // south-right
  block(-18.2, -17.8, -14, 14, 4, M.outer);       // west
  block(17.8, 18.2, -14, 14, 4, M.outer);         // east

  // interior partitions
  wallV(7, -14, -1); wallV(7, 1, 6); wallV(7, 8, 14);     // lobby ↔ jewelry/office (gaps at z∈[-1,1] and [6,8])
  wallH(7, 10, -5); wallH(12, 18, -5);                    // jewelry ↔ vault (vault door in the gap x∈[10,12])
  wallH(7, 9, 4); wallH(11, 18, 4);                       // jewelry ↔ office (gap x∈[9,11])
  wallH(-18, -10, 6); wallH(-8, -4, 6);                   // storage doorway at x∈[-10,-8]
  wallV(-4, 6, 14);                                        // storage ↔ back corridor

  // lobby furniture + pillars
  block(-12, -4, -8.5, -7.5, 1.1, M.counter);             // teller counter
  block(-14.4, -13.6, -12.4, -11.6, 4, M.wall);           // pillars
  block(-0.4, 0.4, -12.4, -11.6, 4, M.wall);

  // back door (lockpick, hold E) — it's a solid until opened
  const backDoorMesh = new THREE.Mesh(new THREE.BoxGeometry(3, 3.8, 0.35), M.steelDark);
  backDoorMesh.position.set(0, 1.9, 14);
  world.add(backDoorMesh);
  const backDoorSolid = addSolid(-1.5, 1.5, 13.8, 14.2);

  // vault door (keypad)
  const vaultMesh = new THREE.Mesh(new THREE.BoxGeometry(2, 3.8, 0.4), M.steel);
  vaultMesh.position.set(11, 1.9, -5);
  world.add(vaultMesh);
  const vaultSolid = addSolid(10, 12, -5.2, -4.8);
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.06, 8, 20), M.gold);
  wheel.position.set(11, 1.9, -4.7); world.add(wheel);

  // loot items -------------------------------------------------
  const addItem = (o) => { items.push({ done: false, need: 1.2, ...o }); return items[items.length - 1]; };

  // back door
  addItem({ kind: 'door', label: 'Pick the back door lock', need: 3.0, x: 0, z: 14.8, mesh: backDoorMesh, solid: backDoorSolid,
    gone: () => { backDoorMesh.visible = false; } });
  // vault keypad (tap E)
  addItem({ kind: 'vault', label: 'Vault keypad', x: 11, z: -3.4, mesh: vaultMesh, solid: vaultSolid, need: 0,
    gone: () => { vaultMesh.visible = false; wheel.visible = false; } });

  // cash registers on the counter
  for (const x of [-10, -6]) {
    const m = block(x - 0.35, x + 0.35, -8.25, -7.75, 0.35, M.steel, 1.1);
    addItem({ kind: 'loot', label: 'Cash register', value: 800, weight: 1, need: 1.4, x, z: -8, mesh: m.mesh, solid: m.solid });
  }
  // storage cash stacks
  for (const [x, z] of [[-15.5, 8.6], [-12, 12.4], [-7, 12.4], [-15.5, 12.4]]) {
    const m = block(x - 0.55, x + 0.55, z - 0.4, z + 0.4, 0.5, M.cash, 0);
    const band = new THREE.Mesh(new THREE.BoxGeometry(1.12, 0.12, 0.82), M.cashBand);
    band.position.set(x, 0.25, z); world.add(band);
    addItem({ kind: 'loot', label: 'Cash bundle', value: 1200, weight: 1.5, need: 1.0, x, z, mesh: m.mesh, solid: m.solid, extra: band });
  }
  // jewelry cases
  for (const x of [10.5, 13.5, 16.5]) {
    const base = block(x - 0.8, x + 0.8, -0.5, 0.5, 0.95, M.dark);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.03, 1.0), M.glass);
    glass.position.set(x, 0.97, 0); world.add(glass);
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.12), M.gem);
    gem.position.set(x, 1.1, 0); world.add(gem);
    addItem({ kind: 'loot', label: 'Jewelry display', value: 2000, weight: 1, need: 2.0, x, z: 0.0, mesh: base.mesh, solid: base.solid, extra: [glass, gem] });
  }
  // vault gold bars
  for (const [x, z] of [[9.8, -11.5], [12, -11.5], [14.2, -11.5], [16.4, -11.5], [14.2, -8.3]]) {
    const m = block(x - 0.55, x + 0.55, z - 0.4, z + 0.4, 0.55, M.gold);
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.1, 0.7), M.gold);
    top.position.set(x, 0.6, z); world.add(top);
    addItem({ kind: 'loot', label: 'Gold bars', value: 4000, weight: 3, need: 1.3, x, z, mesh: m.mesh, solid: m.solid, extra: top });
  }
  // office safe + desk
  block(12, 14.5, 12.6, 13.4, 0.9, M.counter);
  const safe = block(16, 17, 12, 13, 1.0, M.steelDark);
  addItem({ kind: 'loot', label: 'Office safe', value: 2500, weight: 2, need: 2.5, x: 16.5, z: 12.5, mesh: safe.mesh, solid: safe.solid });

  // outside: van + dumpsters + perimeter (invisible solids)
  const van = new THREE.Group();
  const cargo = new THREE.Mesh(new THREE.BoxGeometry(4.2, 2.6, 4.4), M.van);
  cargo.position.set(0, 1.5, 0.5); van.add(cargo);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.6, 1.4), M.van);
  cab.position.set(0, 1.1, -2.6); van.add(cab);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(4.25, 0.35, 4.45), M.vanStripe);
  stripe.position.set(0, 1.1, 0.5); van.add(stripe);
  van.position.set(0, 0, 24.5); world.add(van);
  addSolid(-2.1, 2.1, 21.8, 27.2);

  block(-10, -8, 17, 18.5, 1.2, M.dark);   // dumpsters
  block(8, 9.6, 18.5, 20, 1.2, M.dark);

  const zone = new THREE.Mesh(new THREE.PlaneGeometry(ESCAPE.maxX - ESCAPE.minX, ESCAPE.maxZ - ESCAPE.minZ), M.zone);
  zone.rotation.x = -PI / 2;
  zone.position.set(0, 0.04, (ESCAPE.minZ + ESCAPE.maxZ) / 2);
  world.add(zone);

  addSolid(WORLD.minX - 1, WORLD.minX + 1, WORLD.minZ, WORLD.maxZ);  // west fence
  addSolid(WORLD.maxX - 1, WORLD.maxX + 1, WORLD.minZ, WORLD.maxZ);  // east fence
  addSolid(WORLD.minX, WORLD.maxX, WORLD.minZ - 1, WORLD.minZ + 1);  // north fence
  addSolid(WORLD.minX, WORLD.maxX, WORLD.maxZ - 1, WORLD.maxZ + 1);  // south fence

  // distant city silhouettes (decor only)
  for (const [x, z, w, d, h] of [[-32, -6, 8, 8, 18], [-30, 20, 10, 8, 26], [34, -4, 10, 10, 22], [30, 22, 8, 10, 14], [-6, -34, 12, 8, 16], [12, -36, 14, 8, 24], [-24, -30, 10, 9, 30]]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), std(0x1a2233, { roughness: 1 }));
    b.position.set(x, h / 2, z); world.add(b);
    const win = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.6, h * 0.5), new THREE.MeshBasicMaterial({ color: 0xffd58a, transparent: true, opacity: 0.25 }));
    win.position.set(x, h * 0.5, z + d / 2 + 0.05); world.add(win);
  }

  // lights: interior ceiling lamps + alley lamps + alarm red
  const LAMPS = [[-12, -3], [-2, -3], [-2, 4], [3, 10], [12, -9], [12, -1], [15, 8], [-11, 10]];
  for (const [x, z] of LAMPS) {
    const pl = new THREE.PointLight(0xffe2b8, 16, 12, 1.4);
    pl.position.set(x, 3.4, z); world.add(pl);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.05, 0.6), M.lamp);
    lamp.position.set(x, 3.97, z); world.add(lamp);
  }
  for (const [x, z] of [[-6, 17], [6, 17]]) {
    const pl = new THREE.PointLight(0xbfd4ff, 12, 14, 1.5);
    pl.position.set(x, 3.6, z); world.add(pl);
  }
  alarmLight = new THREE.PointLight(0xff2020, 0, 22, 1.2);
  alarmLight.position.set(0, 3.2, 0);
  world.add(alarmLight);

  // back-door + guard setup ------------------------------------
  const GUARD_ROUTES = [
    [[-15, -11], [4, -11], [4, 3], [-15, 3]],   // lobby sweep
    [[-2, 9], [5, 9]],                           // back corridor
    [[9, -3], [16, -3], [16, 2], [9, 2]],        // jewelry
    [[12, 6], [16, 6], [16, 10], [12, 10]],      // office
  ];
  for (const route of GUARD_ROUTES) buildGuard(route);
  rebuildNav();

  // cameras
  buildCam(-17.6, -12.5, -8, -6, 0.6, 0.0);
  buildCam(17.6, -10, 10, -6, 0.5, 1.7);
  buildCam(-2, -13.6, -2, 0, 0.7, 3.1);
  buildCam(17.6, 12, 12, 8, 0.5, 4.4);
  buildCam(-17.6, 12, -10, 10, 0.6, 2.2);
}

function buildGuard(route) {
  const root = new THREE.Group();
  root.rotation.order = 'YXZ';
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.3, 1.1, 10), M.uniform);
  body.position.y = 0.85; root.add(body);
  const vest = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.5, 10), M.dark);
  vest.position.y = 0.95; root.add(vest);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 12, 10), M.skin);
  head.position.y = 1.5; root.add(head);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.09, 12), M.cap);
  cap.position.y = 1.67; root.add(cap);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.5, 0.14), M.dark); legL.position.set(-0.12, 0.25, 0); root.add(legL);
  const legR = legL.clone(); legR.position.x = 0.12; root.add(legR);
  const cone = makeCone(CFG.guardRange, CFG.guardFov, 0xfff3a0);
  cone.position.y = 1.5; root.add(cone);
  root.position.set(route[0][0], 0, route[0][1]);
  world.add(root);
  guards.push({
    x: route[0][0], z: route[0][1], yaw: 0, route, wp: 1 % route.length,
    state: 'patrol', root, cone, downT: 0, memT: 0, stuck: 0, side: 1, sideT: 0, shootCd: rnd(0.5, 1.5),
    path: null, pathT: 0,
  });
}

function buildCam(x, z, tx, tz, sweep, phase) {
  const group = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.3, 0.3), M.dark);
  group.add(base);
  const lens = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), M.lens);
  lens.position.z = 0.2; group.add(lens);
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 6), M.led);
  led.position.set(0, 0.14, 0.15); group.add(led);
  const cone = makeCone(CFG.camRange, CFG.camFov, 0xffe066);
  group.add(cone);
  group.position.set(x, 3.0, z);
  world.add(group);
  const base0 = Math.atan2(tx - x, tz - z);
  cams.push({ x, z, base: base0, sweep, ph: phase, t: 0, yaw: base0, group, cone, led, off: 0 });
}

// ───────────────────────── player ─────────────────────────
const vm = new THREE.Group(); // first-person viewmodel
camera.add(vm);
const armR = new THREE.Group();
armR.position.set(0.3, -0.32, -0.55);
vm.add(armR);
{
  const upper = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.5), M.sleeve);
  upper.position.set(0, 0, -0.1); armR.add(upper);
  const cuff = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.19, 0.06), M.dark);
  cuff.position.set(0, 0, -0.37); armR.add(cuff);
  const hand = new THREE.Mesh(new THREE.SphereGeometry(0.1, 14, 10), M.skin);
  hand.position.set(0, 0, -0.44); armR.add(hand);
}
const bagVM = new THREE.Group();
bagVM.position.set(0, -0.05, -0.5);
bagVM.visible = false;
armR.add(bagVM);
{
  const sack = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.24, 0.2), M.sack);
  bagVM.add(sack);
  const knot = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), M.sack);
  knot.position.y = 0.16; bagVM.add(knot);
}
// the missing arm: a pinned-up empty sleeve on the left
{
  const sl = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.17, 0.36), M.sleeve);
  sl.position.set(-0.28, -0.34, -0.5); sl.rotation.y = 0.35; vm.add(sl);
  const pin = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), M.gold);
  pin.position.set(-0.2, -0.26, -0.44); vm.add(pin);
}

function resetPlayer() {
  P = {
    x: START.x, z: START.z, yaw: 0, pitch: 0,
    crouchT: 0, hp: CFG.maxHp, lastHurt: -99, bob: 0,
    bagValue: 0, bagW: 0, punchT: 0, punchCd: 0,
    prog: 0, target: null, moving: false,
  };
  camera.position.set(P.x, 1.65, P.z);
  camera.rotation.set(0, 0, 0, 'YXZ');
}

const isCrouched = () => P && P.crouchT > 0.5;

function updatePlayer(dt) {
  const crouchHeld = keys.KeyC || keys.ControlLeft || keys.ControlRight;
  P.crouchT = lerp(P.crouchT, crouchHeld ? 1 : 0, Math.min(1, dt * 10));

  let mx = 0, mz = 0;
  if (keys.KeyW || keys.ArrowUp) mz += 1;
  if (keys.KeyS || keys.ArrowDown) mz -= 1;
  if (keys.KeyD || keys.ArrowRight) mx += 1;
  if (keys.KeyA || keys.ArrowLeft) mx -= 1;
  const moving = mx !== 0 || mz !== 0;
  P.moving = moving;

  const sprint = keys.ShiftLeft || keys.ShiftRight;
  let sp = CFG.walk;
  if (P.crouchT > 0.5) sp = CFG.crouch;
  else if (sprint && moving && P.bagW < 8) sp = CFG.sprint;
  if (P.target && P.prog > 0) sp = 0; // frozen while holding E
  sp *= 1 - Math.min(0.42, P.bagW * 0.03);

  if (moving && sp > 0) {
    const len = Math.hypot(mx, mz);
    const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw);  // forward
    const rx = Math.cos(P.yaw), rz = -Math.sin(P.yaw);   // right
    const dx = (fx * mz + rx * mx) / len;
    const dz = (fz * mz + rz * mx) / len;
    moveCircle(P, dx * sp * dt, dz * sp * dt, CFG.radius);
    P.bob += dt * (sp > 3 ? 11 : 7);
  }
  // view
  const eye = lerp(1.65, 0.95, P.crouchT);
  const bob = moving && sp > 0 ? Math.sin(P.bob) * 0.04 * (sp / CFG.walk) : 0;
  camera.position.set(P.x, eye + bob, P.z);
  camera.rotation.set(P.pitch, P.yaw, 0, 'YXZ');
}

function nearestItem() {
  let best = null, bd = 2.1;
  for (const it of items) {
    if (it.done) continue;
    const d = Math.hypot(it.x - P.x, it.z - P.z);
    if (d < bd) { bd = d; best = it; }
  }
  return best;
}

function updateInteract(dt) {
  const t = state === 'play' ? nearestItem() : null;
  if (!t) {
    P.prog = 0; P.target = null;
    el.prompt.classList.add('hidden');
    return;
  }
  el.prompt.classList.remove('hidden');
  if (t.kind === 'vault') {
    el.promptText.textContent = '[E] ' + t.label;
    el.promptFill.style.width = '0%';
    P.prog = 0; P.target = null;
    return;
  }
  el.promptText.textContent = `[HOLD E] ${t.label}${t.value ? '  ·  ' + fmt$(t.value) : ''}`;
  if (keys.KeyE) {
    if (P.target !== t) { P.target = t; P.prog = 0; }
    P.prog += dt;
    el.promptFill.style.width = clamp(P.prog / t.need, 0, 1) * 100 + '%';
    if (P.prog >= t.need) {
      P.prog = 0; P.target = null;
      completeItem(t);
    }
  } else {
    P.prog = 0; P.target = null;
    el.promptFill.style.width = '0%';
  }
}

function completeItem(t) {
  t.done = true;
  if (t.kind === 'door') {
    removeSolid(t.solid);
    t.gone();
    SFX.lock();
    toast('🔓 LOCK PICKED — IN!', '#86efac');
    return;
  }
  // loot
  P.bagValue += t.value;
  P.bagW += t.weight;
  if (t.mesh) t.mesh.visible = false;
  if (t.extra) (Array.isArray(t.extra) ? t.extra : [t.extra]).forEach((m) => (m.visible = false));
  removeSolid(t.solid);
  SFX.coin();
  toast(`+${fmt$(t.value)}`, '#fcd34d');
}

function openKeypad() {
  if (state !== 'play') return;
  exitLock();
  state = 'hack';
  el.hack.classList.remove('hidden');
  hackToken++;
  newSequence();
  playSequence(hackToken);
}

function newSequence() {
  hackSeq = [];
  for (let i = 0; i < 4; i++) hackSeq.push(Math.floor(Math.random() * 4));
  hackIdx = 0;
}
async function flashPad(k, ms) {
  const b = el.pads[k];
  b.classList.add('lit');
  await sleep(ms);
  b.classList.remove('lit');
}
async function playSequence(token) {
  hackAccept = false;
  el.hackMsg.textContent = 'Watch the sequence…';
  await sleep(500);
  for (const k of hackSeq) {
    if (token !== hackToken) return;
    flashPad(k, 380);
    await sleep(560);
  }
  if (token !== hackToken) return;
  hackAccept = true;
  el.hackMsg.textContent = `Repeat the ${hackSeq.length}-step sequence!`;
}
function padPress(k) {
  if (!hackAccept || state !== 'hack') return;
  flashPad(k, 160);
  if (k === hackSeq[hackIdx]) {
    SFX.blip();
    hackIdx++;
    if (hackIdx === hackSeq.length) {
      hackAccept = false;
      hackToken++;
      el.hackMsg.textContent = '✅ ACCESS GRANTED';
      SFX.ok();
      const v = items.find((i) => i.kind === 'vault');
      if (v) {
        v.done = true;
        removeSolid(v.solid);
        v.gone();
      }
      toast('🔐 VAULT OPEN', '#86efac');
      const tk = hackToken;
      setTimeout(() => { if (tk === hackToken) closeKeypad(true); }, 800);
    }
  } else {
    hackAccept = false;
    hackToken++;
    heat = Math.min(100, heat + 22);
    SFX.bad();
    el.hackMsg.textContent = '❌ WRONG CODE — heat spiking!';
    const tk = hackToken;
    setTimeout(() => {
      if (tk !== hackToken || state !== 'hack') return;
      newSequence();
      playSequence(hackToken);
    }, 900);
  }
}
function closeKeypad(success) {
  hackToken++;
  hackAccept = false;
  el.hack.classList.add('hidden');
  if (state === 'hack') state = 'pause';
  // success or backing off both return to the pause screen so the player can re-lock
  if (success) { /* ok */ }
  el.pause.classList.remove('hidden');
}

function punch() {
  if (state !== 'play' || P.punchCd > 0) return;
  P.punchCd = 0.45;
  P.punchT = 0.25;
  SFX.punch();
  const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw);
  for (const g of guards) {
    if (g.state === 'down') continue;
    const dx = g.x - P.x, dz = g.z - P.z, d = Math.hypot(dx, dz);
    if (d < 2.0 && (dx * fx + dz * fz) / Math.max(d, 1e-6) > 0.2) {
      knockDown(g);
      return;
    }
  }
  for (const c of cams) {
    if (c.off > 0) continue;
    const dx = c.x - P.x, dz = c.z - P.z, d = Math.hypot(dx, dz);
    if (d < 1.9 && (dx * fx + dz * fz) / Math.max(d, 1e-6) > 0.1) {
      c.off = 25;
      toast('📷 CAMERA SMASHED', '#fde047');
      SFX.hit();
      return;
    }
  }
}
function knockDown(g) {
  g.state = 'down';
  g.downT = 9;
  g.root.rotation.x = -PI / 2;
  g.root.position.y = 0.3;
  g.cone.visible = false;
  SFX.hit();
  toast('🥊 GUARD DOWN', '#fca5a5');
}

// ───────────────────────── guards / cameras / heat ─────────────────────────
function walkNPC(o, tx, tz, speed, dt) {
  let dx = tx - o.x, dz = tz - o.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-4) return;
  let ux = dx / d, uz = dz / d;
  if (o.sideT > 0) {
    o.sideT -= dt;
    const px = -uz * o.side, pz = ux * o.side;
    ux = ux * 0.3 + px; uz = uz * 0.3 + pz;
    const l = Math.hypot(ux, uz) || 1; ux /= l; uz /= l;
  }
  const step = speed * dt;
  const ox = o.x, oz = o.z;
  moveCircle(o, ux * step, uz * step, CFG.radius);
  const moved = Math.hypot(o.x - ox, o.z - oz);
  if (moved < step * 0.25) {
    o.stuck += dt;
    if (o.stuck > 0.6 && o.sideT <= 0) { o.side = Math.random() < 0.5 ? -1 : 1; o.sideT = 0.9; o.stuck = 0; }
  } else o.stuck = 0;
  o.yaw = turnToward(o.yaw, Math.atan2(ux, uz), dt * 6);
}

// chase: straight line when the player is visible, otherwise follow the grid path
function chaseStep(g, dt) {
  if (!segBlocked(g.x, g.z, P.x, P.z)) {
    g.path = null;
    walkNPC(g, P.x, P.z, CFG.chaseSpeed, dt);
    return;
  }
  g.pathT -= dt;
  if (g.path && Math.hypot(g.path[0] - g.x, g.path[1] - g.z) < 0.3) g.pathT = 0;
  if (g.pathT <= 0) {
    g.pathT = 0.35;
    g.path = findNextStep(g.x, g.z, P.x, P.z);
  }
  if (g.path) walkNPC(g, g.path[0], g.path[1], CFG.chaseSpeed, dt);
  else walkNPC(g, P.x, P.z, CFG.chaseSpeed, dt);
}

function fireAt(g) {
  const from = new THREE.Vector3(g.x, 1.5, g.z);
  const hit = Math.random() < 0.5;
  const to = hit
    ? new THREE.Vector3(P.x, 1.2, P.z)
    : new THREE.Vector3(P.x + rnd(-1.4, 1.4), 1.2, P.z + rnd(-1.4, 1.4));
  const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.8 }));
  world.add(line);
  tracers.push({ line, t: 0.12 });
  SFX.shot();
  if (hit) damage(rnd(7, 11));
}

function damage(n, quiet = false) {
  if (state !== 'play') return;
  P.hp -= n;
  P.lastHurt = elapsed;
  el.hurt.style.opacity = '1';
  setTimeout(() => (el.hurt.style.opacity = '0'), 120);
  if (!quiet) SFX.hit();
  if (P.hp <= 0) { P.hp = 0; endGame('shot'); }
}

function triggerAlarm() {
  if (alarm) return;
  alarm = true;
  heat = 100;
  policeT = CFG.policeTime;
  SFX.alarmOn();
  startAlarmSound();
  el.police.classList.remove('hidden');
  toast('🚨 ALARM! GET TO THE VAN!', '#fca5a5');
  for (const g of guards) if (g.state !== 'down') { g.state = 'chase'; g.cone.material.color.set(0xff2a2a); }
}

function updateGuard(g, dt) {
  if (g.state === 'down') {
    g.downT -= dt;
    if (g.downT <= 0) {
      g.state = alarm ? 'chase' : 'patrol';
      g.root.rotation.x = 0;
      g.root.position.y = 0;
      g.cone.visible = true;
    }
    return;
  }
  const crouch = isCrouched();
  const range = crouch ? CFG.guardRange * 0.5 : CFG.guardRange;
  const sees = seesPlayer(g.x, g.z, g.yaw, range, CFG.guardFov);
  const dx = P.x - g.x, dz = P.z - g.z, dist = Math.hypot(dx, dz);

  if (alarm) {
    g.state = 'chase';
    chaseStep(g, dt);
    if (dist < 0.9) damage(dt * 8, true); // melee: guards can grab you when adjacent
    g.shootCd -= dt;
    if (dist < 13 && g.shootCd <= 0 && !segBlocked(g.x, g.z, P.x, P.z)) {
      g.shootCd = rnd(1.0, 1.5);
      fireAt(g);
    }
  } else if (sees) {
    g.state = 'alert';
    g.memT = 1.6;
    heat += dt * (crouch ? CFG.guardHeat * 0.47 : CFG.guardHeat);
    g.yaw = turnToward(g.yaw, Math.atan2(dx, dz), dt * 8);
  } else if (g.memT > 0) {
    g.memT -= dt;
    g.state = 'alert';
  } else {
    g.state = 'patrol';
    const tgt = g.route[g.wp];
    if (Math.hypot(tgt[0] - g.x, tgt[1] - g.z) < 0.5) g.wp = (g.wp + 1) % g.route.length;
    const t2 = g.route[g.wp];
    walkNPC(g, t2[0], t2[1], CFG.guardSpeed, dt);
  }

  // visuals
  g.root.position.x = g.x;
  g.root.position.z = g.z;
  if (g.root.rotation.x === 0) g.root.position.y = 0;
  g.root.rotation.y = g.yaw;
  const col = g.state === 'chase' ? 0xff2a2a : g.state === 'alert' ? 0xffa030 : 0xfff3a0;
  g.cone.material.color.set(col);
  g.cone.material.opacity = g.state === 'chase' ? 0.2 : 0.13;
}

function updateCam(c, dt) {
  if (c.off > 0) {
    c.off -= dt;
    c.cone.visible = false;
    c.led.material.color.set(0x333333);
    if (c.off <= 0) { c.off = 0; c.cone.visible = true; c.led.material.color.set(0x22c55e); }
    return;
  }
  c.t += dt;
  c.yaw = c.base + Math.sin(c.t * 0.7 + c.ph) * c.sweep;
  c.group.rotation.y = c.yaw;
  const range = isCrouched() ? CFG.camRange * 0.5 : CFG.camRange;
  const sees = seesPlayer(c.x, c.z, c.yaw, range, CFG.camFov);
  c.cone.material.color.set(sees ? 0xff3030 : 0xffe066);
  c.cone.material.opacity = sees ? 0.22 : 0.13;
  if (sees && !alarm) heat += dt * CFG.camHeat;
}

// ───────────────────────── main update ─────────────────────────
function updateWorld(dt) {
  elapsed += dt;

  updatePlayer(dt);
  updateInteract(dt);

  if (P.punchCd > 0) P.punchCd -= dt;
  if (P.punchT > 0) P.punchT -= dt;

  // heat
  if (!alarm) heat = Math.max(0, heat - CFG.heatDecay * dt);
  for (const g of guards) updateGuard(g, dt);
  for (const c of cams) updateCam(c, dt);
  if (!alarm && heat >= 100) triggerAlarm();
  if (alarm) {
    policeT -= dt;
    if (policeT <= 0) endGame('police');
  }

  // health regen
  if (P.hp < CFG.maxHp && elapsed - P.lastHurt > 4) P.hp = Math.min(CFG.maxHp, P.hp + 14 * dt);

  // escape
  if (P.bagValue > 0 && P.x > ESCAPE.minX && P.x < ESCAPE.maxX && P.z > ESCAPE.minZ && P.z < ESCAPE.maxZ) {
    endGame('escaped');
  }

  // tracers
  for (let i = tracers.length - 1; i >= 0; i--) {
    tracers[i].t -= dt;
    if (tracers[i].t <= 0) {
      world.remove(tracers[i].line);
      tracers[i].line.geometry.dispose();
      tracers.splice(i, 1);
    }
  }

  // alarm light pulse
  alarmLight.intensity = alarm ? 6 + Math.sin(elapsed * 9) * 5 : 0;

  // viewmodel
  const punchK = P.punchT > 0 ? Math.sin((P.punchT / 0.25) * PI) : 0;
  armR.position.z = -0.55 - punchK * 0.35;
  armR.rotation.x = -punchK * 0.6;
  bagVM.visible = P.bagValue > 0;
  vm.position.y = P.moving ? Math.sin(P.bob * 2) * 0.008 : 0;
}

function updateHUD() {
  el.heat.style.width = clamp(heat, 0, 100) + '%';
  el.hp.style.width = clamp(P.hp / CFG.maxHp * 100, 0, 100) + '%';
  el.bagVal.textContent = fmt$(P.bagValue);
  el.bagW.textContent = Math.round(Math.min(1, P.bagW / 10) * 100) + '%';
  el.time.textContent = fmtT(elapsed);
  if (alarm) el.policeT.textContent = Math.max(0, Math.ceil(policeT));
  let obj;
  if (alarm) obj = '🚨 RUN! Reach the green GETAWAY VAN zone before the police arrive.';
  else if (!items.find((i) => i.kind === 'door').done) obj = 'Objective: pick the back door lock (hold E) — it\'s out back, south wall.';
  else if (P.bagValue === 0) obj = 'Loot the bank: hold E on registers, cash, jewelry, the vault & the safe. Mind the cameras.';
  else obj = `Loot ${fmt$(P.bagValue)} · head for the green GETAWAY VAN zone. Keep the heat down.`;
  el.objective.textContent = obj;
}

// ───────────────────────── minimap ─────────────────────────
const MAP = { x0: -22, z0: -16, w: 44, h: 44, W: 220, H: 200 };
function drawMini() {
  const g = el.mini;
  const sx = MAP.W / MAP.w, sz = MAP.H / MAP.h;
  const X = (x) => (x - MAP.x0) * sx;
  const Z = (z) => (z - MAP.z0) * sz;
  g.fillStyle = 'rgba(8,12,24,.85)';
  g.fillRect(0, 0, MAP.W, MAP.H);
  // building floor
  g.fillStyle = 'rgba(255,255,255,.06)';
  g.fillRect(X(-18), Z(-14), 36 * sx, 28 * sz);
  // escape zone
  g.fillStyle = 'rgba(34,197,94,.35)';
  g.fillRect(X(ESCAPE.minX), Z(ESCAPE.minZ), (ESCAPE.maxX - ESCAPE.minX) * sx, (ESCAPE.maxZ - ESCAPE.minZ) * sz);
  // walls
  g.fillStyle = 'rgba(230,230,240,.5)';
  for (const s of solids) {
    if (s.maxX - s.minX > 40) continue;
    g.fillRect(X(s.minX), Z(s.minZ), Math.max(1, (s.maxX - s.minX) * sx), Math.max(1, (s.maxZ - s.minZ) * sz));
  }
  // loot
  g.fillStyle = '#fcd34d';
  for (const it of items) {
    if (it.done || it.kind === 'vault' || it.kind === 'door') continue;
    g.fillRect(X(it.x) - 2, Z(it.z) - 2, 4, 4);
  }
  if (!items.find((i) => i.kind === 'door').done) {
    const d = items.find((i) => i.kind === 'door');
    g.fillStyle = '#86efac'; g.fillRect(X(d.x) - 2, Z(d.z) - 2, 4, 4);
  }
  // cameras
  for (const c of cams) {
    g.fillStyle = c.off > 0 ? '#555' : '#fde047';
    g.fillRect(X(c.x) - 2, Z(c.z) - 2, 4, 4);
  }
  // guards
  for (const gu of guards) {
    g.fillStyle = gu.state === 'down' ? '#64748b' : gu.state === 'chase' ? '#ef4444' : gu.state === 'alert' ? '#fb923c' : '#60a5fa';
    g.beginPath(); g.arc(X(gu.x), Z(gu.z), 3, 0, TAU); g.fill();
  }
  // player arrow
  const px = X(P.x), pz = Z(P.z);
  const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw);
  const nx = fx * sx, nz = fz * sz; // direction in canvas space
  const l = Math.hypot(nx, nz) || 1;
  const ux = nx / l, uz = nz / l;
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.moveTo(px + ux * 9, pz + uz * 9);
  g.lineTo(px - uz * 5 - ux * 4, pz + ux * 5 - uz * 4);
  g.lineTo(px + uz * 5 - ux * 4, pz - ux * 5 - uz * 4);
  g.closePath(); g.fill();
}

// ───────────────────────── toast ─────────────────────────
let toastTimer = null;
function toast(msg, color = '#fff') {
  el.toast.textContent = msg;
  el.toast.style.color = color;
  el.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('show'), 1400);
}

// ───────────────────────── flow ─────────────────────────
function exitLock() { if (document.pointerLockElement) document.exitPointerLock(); }
function lock() { renderer.domElement.requestPointerLock?.(); }

function resetRun() {
  buildLevel();
  resetPlayer();
  heat = 0; alarm = false; policeT = 0; elapsed = 0;
  stopAlarmSound();
  el.police.classList.add('hidden');
  el.hack.classList.add('hidden');
  el.pause.classList.add('hidden');
  el.over.classList.add('hidden');
  hackToken++;
  el.hurt.style.opacity = '0';
  tracers = [];
  el.toast.classList.remove('show');
}

function startPlay() {
  audio();
  resetRun();
  state = 'play';
  el.menu.classList.add('hidden');
  el.hud.classList.remove('hidden');
  lock();
}

function endGame(reason) {
  if (state === 'over') return;
  state = 'over';
  exitLock();
  stopAlarmSound();
  el.police.classList.add('hidden');
  el.prompt.classList.add('hidden');
  el.toast.classList.remove('show');
  let title, body;
  if (reason === 'escaped') {
    const stars = P.bagValue >= 20000 ? '★★★' : P.bagValue >= 10000 ? '★★☆' : '★☆☆';
    title = '🚗 GETAWAY!';
    body = `<p class="big-num">${fmt$(P.bagValue)}</p>
      <p>${stars} &nbsp;·&nbsp; Time ${fmtT(elapsed)} ${alarm ? '' : '&nbsp;·&nbsp; <b>silent job</b> 🤫'}</p>`;
    if (P.bagValue > bestLoot) {
      bestLoot = P.bagValue;
      try { localStorage.setItem(BEST_KEY, String(bestLoot)); } catch (e) { /* private mode */ }
      body += '<p class="new">🏆 New personal best!</p>';
    }
  } else if (reason === 'police') {
    title = '🚔 CAUGHT!';
    body = `<p>The police arrived before you reached the van. The loot stayed in the bag — and in their evidence room.</p>`;
  } else {
    title = '🚨 BUSTED!';
    body = `<p>Guards took you down. Your loot was seized.</p>`;
  }
  el.overTitle.textContent = title;
  el.overBody.innerHTML = body;
  el.best.textContent = fmt$(bestLoot);
  el.bestMenu.textContent = fmt$(bestLoot);
  el.over.classList.remove('hidden');
}

function pauseGame() {
  if (state !== 'play') return;
  state = 'pause';
  el.pause.classList.remove('hidden');
}
function resumeGame() {
  if (state !== 'pause') return;
  el.pause.classList.add('hidden');
  state = 'play';
  lock();
}

document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === renderer.domElement;
  if (!locked && state === 'play') pauseGame();
});

// ───────────────────────── input ─────────────────────────
window.addEventListener('keydown', (e) => {
  if (e.repeat && e.code !== 'KeyE') return;
  keys[e.code] = true;
  if (state === 'hack') {
    if (e.code === 'Escape') { closeKeypad(false); return; }
    const map = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Numpad1: 0, Numpad2: 1, Numpad3: 2, Numpad4: 3 };
    if (e.code in map) padPress(map[e.code]);
    return;
  }
  if (e.code === 'KeyE' && !e.repeat && state === 'play') {
    const t = nearestItem();
    if (t && t.kind === 'vault') openKeypad();
  }
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
window.addEventListener('mousedown', (e) => {
  if (state === 'play' && e.button === 0) punch();
});
window.addEventListener('mousemove', (e) => {
  if (state !== 'play' || document.pointerLockElement !== renderer.domElement) return;
  P.yaw -= e.movementX * 0.0022;
  P.pitch = clamp(P.pitch - e.movementY * 0.0022, -1.45, 1.45);
});
window.addEventListener('contextmenu', (e) => e.preventDefault());

el.pads.forEach((b) => b.addEventListener('click', () => padPress(Number(b.dataset.i))));
$('btnHackCancel').addEventListener('click', () => closeKeypad(false));
$('btnStart').addEventListener('click', startPlay);
$('btnResume').addEventListener('click', resumeGame);
$('btnRestart').addEventListener('click', () => { if (state === 'pause') { resetRun(); state = 'play'; el.hud.classList.remove('hidden'); lock(); } });
$('btnAgain').addEventListener('click', () => { resetRun(); state = 'play'; el.hud.classList.remove('hidden'); lock(); });

// ───────────────────────── loop ─────────────────────────
window.addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

el.bestMenu.textContent = fmt$(bestLoot);
resetRun();           // build the level behind the menu so it's visible as a backdrop
state = 'menu';
el.hud.classList.add('hidden');

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (state === 'play') {
    updateWorld(dt);
    updateHUD();
  } else {
    // menu / pause / keypad / results: scene is frozen behind the overlay
    for (const c of cams) if (c.off <= 0) c.group.rotation.y = c.yaw;
  }
  drawMini();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// expose for debugging / automated tests
window.__oar = {
  get state() { return state; }, get P() { return P; }, get guards() { return guards; },
  get heat() { return heat; }, get alarm() { return alarm; }, get items() { return items; },
  get cams() { return cams; }, get hackSeq() { return hackSeq; }, endGame, startPlay, padPress, openKeypad, punch, updateWorld,
  nav: () => NAV, setHeat(v) { heat = v; }, teleport(x, z) { P.x = x; P.z = z; },
  step(n, dt = 1 / 30) { for (let i = 0; i < n && state === 'play'; i++) updateWorld(dt); updateHUD(); },
};
