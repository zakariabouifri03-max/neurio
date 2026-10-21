// neurio Craft — main game: renderer, first-person physics, day/night,
// breaking/building, animals, particles, synth SFX, desktop + touch input.
import * as THREE from 'three';
import { Noise } from './noise.js';
import { B, BLOCKS, PLACEABLE, tileFor, isSolid } from './blocks.js';
import { buildAtlas } from './textures.js';
import { World, CHUNK, HEIGHT, SEA, chunkKey } from './world.js';
import { buildChunkGeometries } from './mesher.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const SEED = params.get('seed') || 'neurio-212';
const IS_TOUCH = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const STORE_EDITS = `neurioCraft:edits:${SEED}`;

// ── saved player edits ────────────────────────────────────────────────────────
let editMap = new Map();
try { editMap = new Map(JSON.parse(localStorage.getItem(STORE_EDITS) || '[]')); } catch { editMap = new Map(); }
let saveTimer = 0;
function persistEdits() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(STORE_EDITS, JSON.stringify([...editMap])); } catch { /* storage full */ }
  }, 700);
}

// ── renderer / scene ──────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;   // filmic = the "realistic" look
renderer.toneMappingExposure = 1.12;
renderer.outputColorSpace = THREE.SRGBColorSpace;
$('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 1200);
camera.rotation.order = 'YXZ';

const hemi = new THREE.HemisphereLight(0xbfd9ff, 0x8a7a5f, 0.9);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = sun.shadow.camera.bottom = -90;
sun.shadow.camera.right = sun.shadow.camera.top = 90;
sun.shadow.camera.near = 1; sun.shadow.camera.far = 320;
sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.6;
scene.add(sun, sun.target);

// ── textures & materials ──────────────────────────────────────────────────────
const { atlas, waterTex, cloudTex, icons } = buildAtlas();
const MAT = {
  opaque: new THREE.MeshStandardMaterial({ map: atlas, bumpMap: atlas, bumpScale: 0.6, vertexColors: true, roughness: 0.96, metalness: 0 }),
  trans: new THREE.MeshStandardMaterial({ map: atlas, vertexColors: true, transparent: true, roughness: 0.12, metalness: 0.05, side: THREE.DoubleSide, depthWrite: false }),
  water: new THREE.MeshStandardMaterial({ map: waterTex, vertexColors: true, transparent: true, opacity: 0.72, roughness: 0.15, metalness: 0, side: THREE.DoubleSide, depthWrite: false }),
  plant: new THREE.MeshStandardMaterial({ map: atlas, vertexColors: true, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 1 }),
};

// ── world & chunk streaming ───────────────────────────────────────────────────
const world = new World(SEED, editMap);
const QUALITIES = { low: { R: 4, shadow: 1024, dpr: 1.25 }, med: { R: 6, shadow: 2048, dpr: 1.75 }, high: { R: 8, shadow: 2048, dpr: 2 } };
let quality = 'med';
try { quality = localStorage.getItem('neurioCraft:quality') || (IS_TOUCH ? 'low' : 'med'); } catch { quality = IS_TOUCH ? 'low' : 'med'; }
if (!QUALITIES[quality]) quality = 'med';
let R = QUALITIES[quality].R;
function applyQuality(q) {
  quality = q; try { localStorage.setItem('neurioCraft:quality', q); } catch { /* private mode */ }
  R = QUALITIES[q].R;
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, QUALITIES[q].dpr));
  if (sun.shadow.mapSize.x !== QUALITIES[q].shadow) {
    sun.shadow.mapSize.set(QUALITIES[q].shadow, QUALITIES[q].shadow);
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  }
  scene.fog = new THREE.Fog(0x87ceeb, R * CHUNK * 0.52, R * CHUNK * 0.97);
}
applyQuality(quality);

const meshMap = new Map();   // key → THREE.Group
const dirty = new Set();     // chunk keys needing (re)meshing

function remeshChunk(cx, cz) {
  const key = chunkKey(cx, cz);
  const old = meshMap.get(key);
  if (old) { scene.remove(old); old.traverse((o) => o.geometry?.dispose()); meshMap.delete(key); }
  const geo = buildChunkGeometries(world, cx, cz);
  if (!geo) return;
  const grp = new THREE.Group();
  if (geo.opaque) { const m = new THREE.Mesh(geo.opaque, MAT.opaque); m.castShadow = m.receiveShadow = true; grp.add(m); }
  if (geo.trans) grp.add(new THREE.Mesh(geo.trans, MAT.trans));
  if (geo.water) grp.add(new THREE.Mesh(geo.water, MAT.water));
  if (geo.plant) { const m = new THREE.Mesh(geo.plant, MAT.plant); m.castShadow = true; grp.add(m); }
  scene.add(grp);
  meshMap.set(key, grp);
}

function updateChunks(centreX, centreZ, meshBudget = 1) {
  const pcx = Math.floor(centreX / CHUNK), pcz = Math.floor(centreZ / CHUNK);
  // 1) generate raw chunk data out to R+1 (mesher needs the border ring)
  const needData = [];
  for (let dz = -R - 1; dz <= R + 1; dz++) for (let dx = -R - 1; dx <= R + 1; dx++) {
    if (!world.chunks.has(chunkKey(pcx + dx, pcz + dz))) needData.push([dx * dx + dz * dz, pcx + dx, pcz + dz]);
  }
  needData.sort((a, b) => a[0] - b[0]);
  for (let i = 0; i < Math.min(3, needData.length); i++) world.getChunkData(needData[i][1], needData[i][2], true);

  // 2) mesh dirty / missing chunks inside R, nearest first
  const want = [];
  for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
    const key = chunkKey(pcx + dx, pcz + dz);
    if (!meshMap.has(key) || dirty.has(key)) want.push([dx * dx + dz * dz, pcx + dx, pcz + dz, key]);
  }
  want.sort((a, b) => a[0] - b[0]);
  let meshed = 0;
  for (const [, cx, cz, key] of want) {
    if (meshed >= meshBudget) break;
    if (!world.chunks.has(key)) continue;
    remeshChunk(cx, cz); dirty.delete(key); meshed++;
  }
  // 3) unload far-away meshes/data
  for (const [key, grp] of meshMap) {
    const [cx, cz] = key.split(',').map(Number);
    if (Math.abs(cx - pcx) > R + 2 || Math.abs(cz - pcz) > R + 2) {
      scene.remove(grp); grp.traverse((o) => o.geometry?.dispose()); meshMap.delete(key);
    }
  }
  if (world.chunks.size > 900) {
    for (const key of world.chunks.keys()) {
      const [cx, cz] = key.split(',').map(Number);
      if (Math.abs(cx - pcx) > R + 5 || Math.abs(cz - pcz) > R + 5) world.chunks.delete(key);
    }
  }
  return { loading: needData.length + want.length };
}

// ── spawn: search a nice dry spot near origin using pure terrain height ──────
function findSpawn() {
  for (let rad = 0; rad < 90; rad += 3) {
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 7) {
      const x = Math.round(8 + Math.cos(a) * rad), z = Math.round(8 + Math.sin(a) * rad);
      const h = world.terrainHeight(x, z);
      if (h > SEA + 1 && h < 38) return new THREE.Vector3(x + 0.5, h + 1.01, z + 0.5);
    }
  }
  return new THREE.Vector3(8.5, 45, 8.5);
}
const spawn = findSpawn();
// pre-build the neighbourhood so the menu cinematic & first frame are solid
{
  const scx = Math.floor(spawn.x / CHUNK), scz = Math.floor(spawn.z / CHUNK);
  for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) world.getChunkData(scx + dx, scz + dz, true);
  for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) remeshChunk(scx + dx, scz + dz);
  spawn.y = world.surfaceY(Math.floor(spawn.x), Math.floor(spawn.z)) + 1.01;
}

// ── sky: sun/moon discs, stars, drifting clouds ───────────────────────────────
const skyGroup = new THREE.Group(); scene.add(skyGroup);
const sunDisc = new THREE.Mesh(new THREE.CircleGeometry(18, 24), new THREE.MeshBasicMaterial({ color: 0xffdf6b, fog: false }));
const moonDisc = new THREE.Mesh(new THREE.CircleGeometry(11, 24), new THREE.MeshBasicMaterial({ color: 0xe8edf5, fog: false }));
skyGroup.add(sunDisc, moonDisc);
{
  const n = 700, p = new Float32Array(n * 3), rnd = new Noise('stars');
  for (let i = 0; i < n; i++) {
    const t = rnd.hash2(i, 1) * Math.PI * 2, ph = Math.acos(2 * rnd.hash2(i, 2) - 1);
    p[i * 3] = 430 * Math.sin(ph) * Math.cos(t); p[i * 3 + 1] = Math.abs(430 * Math.cos(ph)); p[i * 3 + 2] = 430 * Math.sin(ph) * Math.sin(t);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  var stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
  skyGroup.add(stars);
}
cloudTex.repeat.set(7, 7);
const clouds = new THREE.Mesh(
  new THREE.PlaneGeometry(900, 900),
  new THREE.MeshBasicMaterial({ map: cloudTex, transparent: true, opacity: 0.5, depthWrite: false, fog: false })
);
clouds.rotation.x = -Math.PI / 2; clouds.position.y = 88;
scene.add(clouds);

// ── player ────────────────────────────────────────────────────────────────────
const player = {
  pos: spawn.clone(), vel: new THREE.Vector3(),
  yaw: Math.PI * 0.75, pitch: -0.08,
  onGround: false, fly: false, inWater: false, bobT: 0, stepAcc: 0,
};
const HALF = 0.3, PHEIGHT = 1.8, EYE = 1.62;
const getB = (x, y, z) => world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z));

function collides(p) {
  const x0 = Math.floor(p.x - HALF), x1 = Math.floor(p.x + HALF - 1e-4);
  const y0 = Math.floor(p.y), y1 = Math.floor(p.y + PHEIGHT - 1e-4);
  const z0 = Math.floor(p.z - HALF), z1 = Math.floor(p.z + HALF - 1e-4);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
    if (isSolid(world.getBlock(x, y, z))) return true;
  }
  return false;
}

function moveAxis(axis, amt) {
  if (!amt) return;
  const p = player.pos, old = p[axis];
  p[axis] += amt;
  if (!collides(p)) return;
  // one-block auto-step: walk up ledges & climb out of water like in Minecraft
  if (axis !== 'y' && (player.onGround || player.inWater)) {
    const oldY = p.y; p.y += 1.01;
    if (!collides(p)) return;
    p.y = oldY;
  }
  p[axis] = old;
  if (axis === 'y') { if (amt < 0) player.onGround = true; player.vel.y = 0; }
}

const keys = {};
let joyVec = { x: 0, y: 0 }, touchJump = false, touchBreak = false, touchPlace = false;

function stepPlayer(dt) {
  const p = player;
  p.inWater = getB(p.pos.x, p.pos.y + 0.4, p.pos.z) === B.WATER || getB(p.pos.x, p.pos.y + EYE, p.pos.z) === B.WATER;

  const fwdIn = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0) - joyVec.y;
  const strIn = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0) + joyVec.x;
  const sprint = keys.ShiftLeft && !p.fly;
  const speed = (p.fly ? 13 : sprint ? 8.4 : 5.3) * (p.inWater && !p.fly ? 0.55 : 1);
  const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
  const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
  let mx = (fx * fwdIn + rx * strIn), mz = (fz * fwdIn + rz * strIn);
  const len = Math.hypot(mx, mz) || 1;
  mx = mx / len * speed; mz = mz / len * speed;
  if (!fwdIn && !strIn) { mx = 0; mz = 0; }

  const accel = p.onGround || p.fly ? 14 : 3.5; // snappy on ground, drifty in air
  p.vel.x += (mx - p.vel.x) * Math.min(1, accel * dt);
  p.vel.z += (mz - p.vel.z) * Math.min(1, accel * dt);

  const jumping = keys.Space || touchJump;
  if (p.fly) {
    const vy = (jumping ? 10 : 0) - (keys.ShiftLeft || keys.KeyC ? 10 : 0);
    p.vel.y += (vy - p.vel.y) * Math.min(1, 10 * dt);
  } else if (p.inWater) {
    p.vel.y -= 7 * dt;
    if (jumping) p.vel.y = Math.min(p.vel.y + 32 * dt, 3.6);
    p.vel.y *= Math.pow(0.12, dt); // water drag
  } else {
    p.vel.y -= 27 * dt;
    if (p.vel.y < -48) p.vel.y = -48;
    if (jumping && p.onGround) { p.vel.y = 9.3; p.onGround = false; }
  }

  p.onGround = false;
  moveAxis('x', p.vel.x * dt);
  moveAxis('z', p.vel.z * dt);
  moveAxis('y', p.vel.y * dt);
  if (p.fly && p.vel.y < 0 && collides(p)) p.fly = false;

  const hSpeed = Math.hypot(p.vel.x, p.vel.z);
  if (p.onGround && hSpeed > 0.6) {
    p.bobT += dt * hSpeed * 1.5;
    p.stepAcc += hSpeed * dt;
    if (p.stepAcc > 2.3) { p.stepAcc = 0; SFX.step(); }
  }
  if (p.pos.y < -12) { p.pos.copy(spawn); p.vel.set(0, 0, 0); toast('↩️ Rje3ti l bidaya — رجعتي للبداية'); }

  camera.position.set(p.pos.x, p.pos.y + EYE + Math.sin(p.bobT) * 0.05, p.pos.z);
  camera.rotation.y = p.yaw; camera.rotation.x = p.pitch;
  const targetFov = sprint && hSpeed > 5 ? 82 : 75;
  if (Math.abs(camera.fov - targetFov) > 0.1) { camera.fov += (targetFov - camera.fov) * Math.min(1, 8 * dt); camera.updateProjectionMatrix(); }
}

// ── voxel raycast (Amanatides & Woo DDA) ──────────────────────────────────────
const _dir = new THREE.Vector3();
function raycast(maxDist = 7) {
  camera.getWorldDirection(_dir);
  const o = camera.position;
  let x = Math.floor(o.x), y = Math.floor(o.y), z = Math.floor(o.z);
  const stepX = _dir.x > 0 ? 1 : -1, stepY = _dir.y > 0 ? 1 : -1, stepZ = _dir.z > 0 ? 1 : -1;
  const tDeltaX = Math.abs(1 / (_dir.x || 1e-9)), tDeltaY = Math.abs(1 / (_dir.y || 1e-9)), tDeltaZ = Math.abs(1 / (_dir.z || 1e-9));
  let tMaxX = ((_dir.x > 0 ? x + 1 - o.x : o.x - x)) * tDeltaX;
  let tMaxY = ((_dir.y > 0 ? y + 1 - o.y : o.y - y)) * tDeltaY;
  let tMaxZ = ((_dir.z > 0 ? z + 1 - o.z : o.z - z)) * tDeltaZ;
  let nx = 0, ny = 0, nz = 0, t = 0;
  for (let i = 0; i < 128; i++) {
    const id = world.getBlock(x, y, z);
    if (id && id !== B.WATER && t > 0) return { x, y, z, nx, ny, nz, id };
    if (tMaxX < tMaxY && tMaxX < tMaxZ) { x += stepX; t = tMaxX; tMaxX += tDeltaX; nx = -stepX; ny = nz = 0; }
    else if (tMaxY < tMaxZ) { y += stepY; t = tMaxY; tMaxY += tDeltaY; ny = -stepY; nx = nz = 0; }
    else { z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; nz = -stepZ; nx = ny = 0; }
    if (t > maxDist) return null;
  }
  return null;
}

// highlight wireframe around the targeted block
const highlight = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004)),
  new THREE.LineBasicMaterial({ color: 0x0a0a0a, transparent: true, opacity: 0.75 })
);
highlight.visible = false; scene.add(highlight);

// ── particles ─────────────────────────────────────────────────────────────────
const particleGeo = new THREE.BoxGeometry(0.09, 0.09, 0.09);
const particleMats = new Map();
const particles = [];
function spawnParticles(x, y, z, color, n = 16, power = 3.2) {
  if (!particleMats.has(color)) particleMats.set(color, new THREE.MeshBasicMaterial({ color }));
  const mat = particleMats.get(color);
  for (let i = 0; i < n && particles.length < 380; i++) {
    const m = new THREE.Mesh(particleGeo, mat);
    m.position.set(x + Math.random(), y + Math.random(), z + Math.random());
    m.userData.vel = new THREE.Vector3((Math.random() - 0.5) * power, Math.random() * power, (Math.random() - 0.5) * power);
    m.userData.life = 0.55 + Math.random() * 0.5;
    scene.add(m); particles.push(m);
  }
}
function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const m = particles[i];
    m.userData.vel.y -= 14 * dt;
    m.position.addScaledVector(m.userData.vel, dt);
    m.rotation.x += dt * 6; m.rotation.y += dt * 5;
    if ((m.userData.life -= dt) <= 0) { scene.remove(m); particles.splice(i, 1); }
  }
}

// ── block editing ─────────────────────────────────────────────────────────────
let shake = 0;
function applyEdit(x, y, z, id) {
  for (const k of world.setBlock(x, y, z, id)) dirty.add(k);
  persistEdits();
}
function breakBlock() {
  const hit = raycast();
  if (!hit) return;
  const def = BLOCKS[hit.id];
  if (def.unbreakable) { toast('🪨 Bedrock ma kaytkessarch!'); return; }
  applyEdit(hit.x, hit.y, hit.z, 0);
  const above = world.getBlock(hit.x, hit.y + 1, hit.z); // plants fall with their soil
  if (BLOCKS[above]?.cross) applyEdit(hit.x, hit.y + 1, hit.z, 0);
  spawnParticles(hit.x, hit.y, hit.z, def.color);
  if (def.explosive) { explode(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5); return; }
  SFX.breakBlock(hit.id);
}
function placeBlock() {
  const hit = raycast();
  if (!hit) return;
  const id = hotbar[sel];
  let { x, y, z } = hit;
  if (!BLOCKS[hit.id]?.cross) { x += hit.nx; y += hit.ny; z += hit.nz; } // replace plants in-place
  if (y < 1 || y >= HEIGHT) return;
  const existing = world.getBlock(x, y, z);
  if (existing && existing !== B.WATER && !BLOCKS[existing]?.cross) return;
  if (BLOCKS[id].cross) { // plants need soil below
    const below = world.getBlock(x, y - 1, z);
    if (below !== B.GRASS && below !== B.DIRT && below !== B.SAND) return;
  } else {
    // don't suffocate the player
    const p = player.pos;
    if (x + 1 > p.x - HALF && x < p.x + HALF && z + 1 > p.z - HALF && z < p.z + HALF && y + 1 > p.y && y < p.y + PHEIGHT) return;
  }
  applyEdit(x, y, z, id);
  SFX.place();
}
function explode(cx, cy, cz) {
  SFX.boom(); shake = Math.min(1, shake + 0.7);
  spawnParticles(cx - 0.5, cy - 0.5, cz - 0.5, 0xff7b33, 46, 8);
  spawnParticles(cx - 0.5, cy - 0.5, cz - 0.5, 0x555555, 30, 6);
  const rad = 3.4, chain = [];
  for (let x = Math.floor(cx - rad); x <= cx + rad; x++)
    for (let y = Math.max(1, Math.floor(cy - rad)); y <= cy + rad; y++)
      for (let z = Math.floor(cz - rad); z <= cz + rad; z++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy, z + 0.5 - cz);
        if (d > rad * (0.75 + Math.random() * 0.3)) continue;
        const id = world.getBlock(x, y, z);
        if (!id || id === B.WATER || BLOCKS[id].unbreakable) continue;
        if (BLOCKS[id].explosive && (x + 0.5 !== cx || y + 0.5 !== cy)) chain.push([x + 0.5, y + 0.5, z + 0.5]);
        applyEdit(x, y, z, 0);
      }
  for (const [x, y, z] of chain) setTimeout(() => explode(x, y, z), 130 + Math.random() * 160);
  const d = player.pos.distanceTo(new THREE.Vector3(cx, cy, cz)); // knockback
  if (d < 8) {
    const push = player.pos.clone().sub(new THREE.Vector3(cx, cy, cz)).normalize().multiplyScalar((8 - d) * 2.4);
    player.vel.add(push); player.vel.y += 4.5;
  }
}

// ── synthesised SFX (Web Audio, zero audio files) ────────────────────────────
const SFX = {
  ctx: null,
  init() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      const len = this.ctx.sampleRate * 0.5;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch { /* no audio */ }
  },
  burst(freq, dur, gain = 0.16, type = 'bandpass') {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = 0.9;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.ctx.destination);
    src.start(t, Math.random() * 0.3); src.stop(t + dur);
  },
  breakBlock(id) {
    const soft = [B.DIRT, B.GRASS, B.SAND, B.GRAVEL, B.SNOW].includes(id);
    this.burst(soft ? 480 : 1150, soft ? 0.16 : 0.12, 0.2);
  },
  place() { this.burst(720, 0.07, 0.12); },
  step() { this.burst(380 + Math.random() * 120, 0.05, 0.045); },
  boom() { this.burst(110, 0.7, 0.55, 'lowpass'); this.burst(600, 0.25, 0.25); },
  chirp() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(2400 + Math.random() * 900, t);
    o.frequency.exponentialRampToValueAtTime(3200 + Math.random() * 700, t + 0.09);
    o.frequency.exponentialRampToValueAtTime(2100, t + 0.18);
    g.gain.setValueAtTime(0.035, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    o.connect(g).connect(this.ctx.destination); o.start(t); o.stop(t + 0.22);
  },
};

// ── animals: blocky pigs / sheep / cows wandering the world ──────────────────
const animals = [];
function box(w, h, d, color, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: 0.95 }));
  m.position.set(x, y, z); m.castShadow = true;
  return m;
}
function makeAnimal(kind) {
  const g = new THREE.Group();
  const cfg = {
    pig:   { body: 0xf2a0b5, head: 0xf2a0b5, leg: 0xd9829c, snout: 0xe07090 },
    sheep: { body: 0xece7dd, head: 0x9a8f80, leg: 0x84796a, snout: 0x9a8f80 },
    cow:   { body: 0x8a6642, head: 0x8a6642, leg: 0x6e5133, snout: 0xc9a186 },
  }[kind];
  g.add(box(0.62, 0.55, 0.95, cfg.body, 0, 0.62, 0));
  if (kind === 'cow') { g.add(box(0.3, 0.2, 0.4, 0xf0e8dd, 0.18, 0.78, -0.15)); g.add(box(0.64, 0.18, 0.5, 0x8a6642, 0, 0.95, 0.12)); }
  const head = box(0.5, 0.46, 0.46, cfg.head, 0, 0.78, 0.68);
  g.add(head, box(0.24, 0.18, 0.08, cfg.snout, 0, 0.7, 0.93));
  g.add(box(0.07, 0.07, 0.03, 0x1a1a1a, -0.14, 0.86, 0.915), box(0.07, 0.07, 0.03, 0x1a1a1a, 0.14, 0.86, 0.915)); // eyes
  const legs = [];
  for (const [lx, lz] of [[-0.2, 0.32], [0.2, 0.32], [-0.2, -0.32], [0.2, -0.32]]) {
    const leg = box(0.15, 0.4, 0.15, cfg.leg, lx, 0.2, lz);
    leg.geometry.translate(0, -0.14, 0); leg.position.y = 0.34;
    legs.push(leg); g.add(leg);
  }
  g.userData = { legs, dir: Math.random() * Math.PI * 2, timer: Math.random() * 4, phase: Math.random() * 9, moving: 0 };
  const a = Math.random() * Math.PI * 2, dist = 8 + Math.random() * 26;
  g.position.set(spawn.x + Math.cos(a) * dist, 40, spawn.z + Math.sin(a) * dist);
  g.position.y = world.surfaceY(Math.floor(g.position.x), Math.floor(g.position.z)) + 1;
  scene.add(g); animals.push(g);
  return g;
}
['pig', 'sheep', 'cow', 'pig', 'sheep', 'cow', 'pig', 'sheep', 'pig', 'cow'].forEach(makeAnimal);

function updateAnimals(dt) {
  for (const g of animals) {
    const u = g.userData;
    u.timer -= dt;
    if (u.timer <= 0) { u.timer = 2 + Math.random() * 4; u.dir = Math.random() * Math.PI * 2; u.moving = Math.random() < 0.65 ? 1 : 0; }
    // stay useful: teleport back near the player if left behind
    if (g.position.distanceTo(player.pos) > 85) {
      const a = Math.random() * Math.PI * 2;
      g.position.set(player.pos.x + Math.cos(a) * 22, 40, player.pos.z + Math.sin(a) * 22);
    }
    if (u.moving) {
      const nx = g.position.x + Math.sin(u.dir) * dt * 1.15;
      const nz = g.position.z + Math.cos(u.dir) * dt * 1.15;
      const surf = world.surfaceY(Math.floor(nx), Math.floor(nz));
      if (world.getBlock(Math.floor(nx), surf + 1, Math.floor(nz)) === B.WATER || Math.abs(surf + 1 - g.position.y) > 1.6) {
        u.dir += Math.PI; // avoid lakes & cliffs — turn around
      } else {
        g.position.x = nx; g.position.z = nz;
        u.phase += dt * 7;
      }
      g.rotation.y = u.dir;
    }
    const targetY = world.surfaceY(Math.floor(g.position.x), Math.floor(g.position.z)) + 1;
    g.position.y += (targetY - g.position.y) * Math.min(1, 9 * dt);
    const swing = u.moving ? Math.sin(u.phase) * 0.55 : 0;
    u.legs[0].rotation.x = u.legs[3].rotation.x = swing;
    u.legs[1].rotation.x = u.legs[2].rotation.x = -swing;
  }
}

// ── day / night cycle ─────────────────────────────────────────────────────────
let tod = 9.2; // time of day, hours
const SKY_STOPS = [
  [0, 0x0b1026], [4.8, 0x0b1026], [6.2, 0xdf8a52], [8, 0x87ceeb], [16.5, 0x87ceeb],
  [18.2, 0xf0924a], [19.6, 0x27304f], [21, 0x0b1026], [24, 0x0b1026],
];
const _c1 = new THREE.Color(), _c2 = new THREE.Color();
function skyColorAt(t) {
  for (let i = 1; i < SKY_STOPS.length; i++) {
    if (t <= SKY_STOPS[i][0]) {
      const [t0, c0] = SKY_STOPS[i - 1], [t1, c1] = SKY_STOPS[i];
      return _c1.setHex(c0).lerp(_c2.setHex(c1), (t - t0) / (t1 - t0));
    }
  }
  return _c1.setHex(0x0b1026);
}
function updateSky(dt) {
  tod = (tod + dt * (24 / 720)) % 24; // a full day = 12 real minutes
  const ang = ((tod - 6) / 12) * Math.PI;           // sunrise 6h → sunset 18h
  const elev = Math.sin(ang);
  const sunDir = new THREE.Vector3(Math.cos(ang) * 0.55, elev, 0.35).normalize();
  const sky = skyColorAt(tod);
  scene.background.copy(sky);
  if (scene.fog) scene.fog.color.copy(sky);

  const isDay = elev > -0.06;
  const lightDir = isDay ? sunDir : sunDir.clone().negate().setY(Math.abs(elev) + 0.25).normalize(); // moonlight
  sun.position.copy(camera.position).addScaledVector(lightDir, 160);
  sun.target.position.copy(camera.position);
  sun.intensity = isDay ? 0.25 + Math.max(0, elev) * 2.3 : 0.32;
  sun.color.setHSL(0.11, isDay ? Math.max(0, 0.55 - elev * 0.55) : 0.05, isDay ? 0.72 : 0.75);
  hemi.intensity = 0.18 + Math.max(0, elev) * 0.85;

  skyGroup.position.copy(camera.position);
  sunDisc.position.copy(sunDir).multiplyScalar(430); sunDisc.lookAt(camera.position);
  sunDisc.material.color.setHSL(0.1, 0.85, 0.55 + Math.max(0, elev) * 0.15);
  sunDisc.visible = elev > -0.12;
  moonDisc.position.copy(sunDir).multiplyScalar(-430); moonDisc.lookAt(camera.position);
  moonDisc.visible = elev < 0.12;
  stars.material.opacity = THREE.MathUtils.clamp(-elev * 1.6, 0, 0.95);
  clouds.position.x = camera.position.x; clouds.position.z = camera.position.z;
  clouds.material.opacity = 0.14 + Math.max(0, elev) * 0.4;
  clouds.material.color.setScalar(0.25 + Math.max(0, elev) * 0.75);
  cloudTex.offset.x += dt * 0.0035; cloudTex.offset.y += dt * 0.0009;
  waterTex.offset.y += dt * 0.035;

  $('timeIcon').textContent = elev > 0.25 ? '☀️' : elev > -0.05 ? '🌅' : '🌙';
  return elev;
}

// ── hotbar / inventory UI ─────────────────────────────────────────────────────
let hotbar = [B.GRASS, B.DIRT, B.STONE, B.LOG, B.PLANKS, B.COBBLE, B.GLASS, B.BRICK, B.TNT];
let sel = 0;
function blockIcon(id) { return icons[tileFor(id, 0)]; }
function renderHotbar() {
  $('hotbar').innerHTML = hotbar.map((id, i) =>
    `<div class="slot${i === sel ? ' sel' : ''}" data-i="${i}"><img src="${blockIcon(id)}" alt=""><span>${i + 1}</span></div>`).join('');
  document.querySelectorAll('#hotbar .slot').forEach((el) =>
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); selectSlot(+el.dataset.i); }));
  showBlockName();
}
let blockNameTimer = 0;
function showBlockName() {
  const d = BLOCKS[hotbar[sel]];
  const el = $('blockName');
  el.textContent = `${d.name} · ${d.ar}`;
  el.style.opacity = 1;
  clearTimeout(blockNameTimer);
  blockNameTimer = setTimeout(() => el.style.opacity = 0, 1400);
}
function selectSlot(i) { sel = ((i % 9) + 9) % 9; renderHotbar(); }
$('invGrid').innerHTML = PLACEABLE.map((id) =>
  `<button class="invItem" data-id="${id}"><img src="${blockIcon(id)}" alt=""><span>${BLOCKS[id].name}</span><small>${BLOCKS[id].ar}</small></button>`).join('');
document.querySelectorAll('.invItem').forEach((el) =>
  el.addEventListener('click', () => { hotbar[sel] = +el.dataset.id; renderHotbar(); SFX.place(); }));

let toastTimer = 0;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2300);
}

// ── game state / overlays ─────────────────────────────────────────────────────
let state = 'menu'; // menu | playing
let uiOpen = false; // pause or inventory visible
let menuAngle = 0;

function setPaused(open) {
  uiOpen = open;
  $('pause').classList.toggle('show', open);
  if (!open) $('inventory').classList.remove('show');
}
function lockPointer() {
  if (!IS_TOUCH) renderer.domElement.requestPointerLock?.()?.catch?.(() => {});
}
function startGame() {
  const wantedSeed = $('seedInput').value.trim();
  if (wantedSeed && wantedSeed !== SEED) { location.search = `?seed=${encodeURIComponent(wantedSeed)}`; return; }
  applyQuality($('qualitySel').value);
  SFX.init();
  state = 'playing';
  $('menu').classList.add('hidden');
  $('hud').classList.add('show');
  if (IS_TOUCH) $('touch').classList.add('show');
  lockPointer();
  toast('⛏️ Marhba bik f neurio Craft! WASD + souris — كسّر وبني كيما بغيتي');
}
$('btnPlay').addEventListener('click', startGame);
$('btnResume').addEventListener('click', () => { setPaused(false); lockPointer(); });
$('btnInvClose').addEventListener('click', () => { $('inventory').classList.remove('show'); uiOpen = false; lockPointer(); });
$('btnInv').addEventListener('click', () => toggleInventory());
$('btnResetWorld').addEventListener('click', () => { try { localStorage.removeItem(STORE_EDITS); } catch { /* ignore */ } location.reload(); });
$('btnNewWorld').addEventListener('click', () => { location.search = `?seed=${Math.floor(Math.random() * 99999)}`; });
$('seedInput').value = SEED;
$('pauseSeed').textContent = SEED;
$('qualitySel').value = quality;

function toggleInventory(force) {
  const inv = $('inventory');
  const open = force !== undefined ? force : !inv.classList.contains('show');
  inv.classList.toggle('show', open);
  uiOpen = open;
  if (open) document.exitPointerLock?.();
  else lockPointer();
}
function toggleFly() {
  player.fly = !player.fly;
  player.vel.y = 0;
  $('btnFly').classList.toggle('on', player.fly);
  toast(player.fly ? '🕊️ Mode l-vol (fly) khdam — Space ⬆ / Shift ⬇' : '🚶 Rje3ti katmchi');
}
$('btnFly').addEventListener('click', toggleFly);
$('btnFly2').addEventListener('click', () => { toggleFly(); setPaused(false); lockPointer(); });
function cycleTime() {
  tod = tod < 12 ? 17.4 : tod < 19 ? 22 : 7.8;
  toast(tod === 7.8 ? '☀️ Sbah — صباح' : tod === 17.4 ? '🌅 Ghrub — غروب' : '🌙 Lil — ليل');
}
$('btnTime').addEventListener('click', cycleTime);
$('btnMenuTop').addEventListener('click', () => { document.exitPointerLock?.(); setPaused(true); });
document.addEventListener('pointerlockchange', () => {
  if (state === 'playing' && !document.pointerLockElement && !IS_TOUCH && !$('inventory').classList.contains('show')) setPaused(true);
});

// ── input ─────────────────────────────────────────────────────────────────────
let mouseBreak = false, mousePlace = false, breakTimer = 0, placeTimer = 0;
document.addEventListener('mousemove', (e) => {
  if (state !== 'playing' || uiOpen || document.pointerLockElement !== renderer.domElement) return;
  player.yaw -= e.movementX * 0.0023;
  player.pitch = THREE.MathUtils.clamp(player.pitch - e.movementY * 0.0023, -1.55, 1.55);
});
document.addEventListener('mousedown', (e) => {
  if (state !== 'playing' || uiOpen) return;
  if (!IS_TOUCH && document.pointerLockElement !== renderer.domElement) return;
  if (e.button === 0) { mouseBreak = true; breakBlock(); breakTimer = 0.24; }
  if (e.button === 2) { mousePlace = true; placeBlock(); placeTimer = 0.24; }
  if (e.button === 1) { const h = raycast(); if (h && PLACEABLE.includes(h.id)) { hotbar[sel] = h.id; renderHotbar(); } e.preventDefault(); }
});
document.addEventListener('mouseup', (e) => { if (e.button === 0) mouseBreak = false; if (e.button === 2) mousePlace = false; });
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('wheel', (e) => { if (state === 'playing' && !uiOpen) selectSlot(sel + (e.deltaY > 0 ? 1 : -1)); }, { passive: true });
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  keys[e.code] = true;
  if (e.code === 'Space') e.preventDefault();
  if (state !== 'playing') return;
  if (/^Digit[1-9]$/.test(e.code)) selectSlot(+e.code.slice(5) - 1);
  else if (e.code === 'KeyE') toggleInventory();
  else if (e.code === 'KeyF') toggleFly();
  else if (e.code === 'KeyT') cycleTime();
});
document.addEventListener('keyup', (e) => keys[e.code] = false);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ── touch controls ────────────────────────────────────────────────────────────
if (IS_TOUCH) {
  const joy = $('joy'), knob = $('joyKnob');
  let joyId = null, lookId = null, lookLast = { x: 0, y: 0 };
  const setKnob = (dx, dy) => knob.style.transform = `translate(${dx * 32}px,${dy * 32}px)`;
  addEventListener('touchstart', (e) => {
    if (state !== 'playing' || uiOpen) return;
    for (const t of e.changedTouches) {
      if (t.clientX < innerWidth * 0.42 && t.clientY > innerHeight * 0.45 && joyId === null) {
        joyId = t.identifier;
        joy.style.left = `${t.clientX - 60}px`; joy.style.top = `${t.clientY - 60}px`; joy.style.bottom = 'auto';
        joy.dataset.cx = t.clientX; joy.dataset.cy = t.clientY;
      } else if (lookId === null && !e.target.closest('button,.slot,#hudTop')) {
        lookId = t.identifier; lookLast = { x: t.clientX, y: t.clientY };
      }
    }
  }, { passive: true });
  addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === joyId) {
        let dx = (t.clientX - joy.dataset.cx) / 48, dy = (t.clientY - joy.dataset.cy) / 48;
        const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; }
        joyVec = { x: dx, y: dy }; setKnob(dx, dy);
      } else if (t.identifier === lookId) {
        player.yaw -= (t.clientX - lookLast.x) * 0.006;
        player.pitch = THREE.MathUtils.clamp(player.pitch - (t.clientY - lookLast.y) * 0.006, -1.55, 1.55);
        lookLast = { x: t.clientX, y: t.clientY };
      }
    }
    if (state === 'playing') e.preventDefault();
  }, { passive: false });
  const endTouch = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === joyId) { joyId = null; joyVec = { x: 0, y: 0 }; setKnob(0, 0); }
      if (t.identifier === lookId) lookId = null;
    }
  };
  addEventListener('touchend', endTouch); addEventListener('touchcancel', endTouch);
  const hold = (id, set) => {
    const el = $(id);
    el.addEventListener('touchstart', (e) => { e.preventDefault(); set(true); }, { passive: false });
    el.addEventListener('touchend', (e) => { e.preventDefault(); set(false); }, { passive: false });
  };
  hold('btnJump', (v) => touchJump = v);
  hold('btnBreak', (v) => { touchBreak = v; if (v) { breakBlock(); breakTimer = 0.24; } });
  hold('btnPlace', (v) => { touchPlace = v; if (v) { placeBlock(); placeTimer = 0.24; } });
  $('btnFlyT').addEventListener('click', toggleFly);
}
renderHotbar();

// ── main loop ─────────────────────────────────────────────────────────────────
const clock = new THREE.Clock();
let fpsAcc = 0, fpsN = 0, fpsTimer = 0, birdTimer = 5;
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const elev = updateSky(dt);

  if (state === 'menu') {
    menuAngle += dt * 0.055;
    camera.position.set(spawn.x + Math.cos(menuAngle) * 30, spawn.y + 16 + Math.sin(menuAngle * 0.7) * 3, spawn.z + Math.sin(menuAngle) * 30);
    camera.lookAt(spawn.x, spawn.y + 3, spawn.z);
    const { loading } = updateChunks(spawn.x, spawn.z, 3);
    $('loadTip').textContent = loading > 4 ? `⏳ Kan-3ammer l-3alam… (${loading} chunks)` : '✅ L-3alam wajed — اضغط العب!';
    updateAnimals(dt);
  } else {
    if (!uiOpen) {
      let remaining = dt; // fixed-ish physics substeps
      while (remaining > 0) { const s = Math.min(remaining, 1 / 60); stepPlayer(s); remaining -= s; }
      if (mouseBreak || touchBreak) { breakTimer -= dt; if (breakTimer <= 0) { breakBlock(); breakTimer = 0.22; } }
      if (mousePlace || touchPlace) { placeTimer -= dt; if (placeTimer <= 0) { placeBlock(); placeTimer = 0.22; } }
      if (shake > 0.003) {
        camera.position.x += (Math.random() - 0.5) * shake * 0.35;
        camera.position.y += (Math.random() - 0.5) * shake * 0.35;
        shake *= Math.pow(0.02, dt);
      }
    }
    updateChunks(player.pos.x, player.pos.z);
    updateAnimals(dt);
    birdTimer -= dt;
    if (birdTimer <= 0) { birdTimer = 6 + Math.random() * 9; if (elev > 0.15) SFX.chirp(); }

    const hit = uiOpen ? null : raycast();
    highlight.visible = !!hit;
    if (hit) highlight.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);

    fpsAcc += dt; fpsN++; fpsTimer -= dt;
    if (fpsTimer <= 0) {
      fpsTimer = 0.5;
      const fps = Math.round(fpsN / Math.max(fpsAcc, 1e-4)); fpsAcc = 0; fpsN = 0;
      const p = player.pos;
      $('info').textContent = `📍 ${Math.floor(p.x)}, ${Math.floor(p.y)}, ${Math.floor(p.z)} · ${fps} FPS${hit ? ` · 🎯 ${BLOCKS[hit.id].name}` : ''}`;
    }
  }
  updateParticles(dt);
  renderer.render(scene, camera);
}
animate();
