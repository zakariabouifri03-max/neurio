// ── Neurio City · entry point ──────────────────────────────────────────────
// Renderer, lighting, input, chase/hood camera, engine audio, rain, minimap, HUD.
import * as THREE from 'three';
import { BloomFX } from '../src/post.js';
import { buildWorld, lineCoord, CURB } from './world.js';
import { buildHuman } from './person.js';
import { PlayerCar, Traffic } from './vehicles.js';
import { createSky, dayState, applyLights } from './sky.js';
import { mulberry32, clamp, lerp } from '../src/util.js';

const $ = (id) => document.getElementById(id);
const DAY_SECONDS = 600;                 // real seconds for a full 24 h cycle
const RAIN_N = 2600;

// ── renderer / scene ──
const renderer = new THREE.WebGLRenderer({ antialias: false, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.NoToneMapping;        // BloomFX applies the filmic curve
$('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.5, 5000);
const sky = createSky();
scene.add(sky.mesh);
scene.fog = new THREE.Fog(0xbddfff, 260, 2600);

const key = new THREE.DirectionalLight(0xffffff, 3);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -130, right: 130, top: 130, bottom: -130, near: 10, far: 900 });
key.shadow.camera.updateProjectionMatrix();
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.5;
scene.add(key, key.target);
const hemi = new THREE.HemisphereLight(0xffffff, 0x333333, 1);
scene.add(hemi);

// ── world, player, traffic ──
const world = buildWorld(scene, renderer);
const SPAWN = { x: lineCoord(4) + 3.5, z: lineCoord(4) + 30 };   // heading −z on the east lane
const traffic = new Traffic(scene, mulberry32(99), 26, world, { x: SPAWN.x, z: SPAWN.z, r: 45 });
const player = new PlayerCar(scene, SPAWN.x, SPAWN.z, 0);

// ── on foot ──
let mode = 'car';                                  // 'car' | 'foot'
const hm = buildHuman();
scene.add(hm.group);
hm.group.visible = false;
const human = { x: 0, z: 0, h: 0, s: 0 };
const IDLE = { throttle: 0, brake: 0, steer: 0, handbrake: false };
const nearCarDist = () => Math.hypot(human.x - player.x, human.z - player.z);
function toggleVehicle() {
  if (mode === 'car') {
    if (player.speedKmh > 3) return;               // only when stopped
    const rx = Math.cos(player.h), rz = -Math.sin(player.h);
    human.x = player.x - rx * 2.0; human.z = player.z - rz * 2.0;   // driver's side
    human.h = player.h; human.s = 0;
    mode = 'foot'; hm.group.visible = true;
    player.s = 0; player.lat = 0;
  } else if (nearCarDist() < 3.6) {
    mode = 'car'; hm.group.visible = false; player.s = 0;
  }
}
function pushOutCircle(x, z, r) {
  const dx = human.x - x, dz = human.z - z, min = r + 0.4, d2 = dx * dx + dz * dz;
  if (d2 >= min * min || d2 < 1e-8) return;
  const d = Math.sqrt(d2), p = min - d;
  human.x += (dx / d) * p; human.z += (dz / d) * p;
}
function pushOutBox(b) {
  const R = 0.4;
  const cx = clamp(human.x, b.x0, b.x1), cz = clamp(human.z, b.z0, b.z1);
  const dx = human.x - cx, dz = human.z - cz, d2 = dx * dx + dz * dz;
  if (d2 >= R * R) return;
  if (d2 > 1e-8) { const d = Math.sqrt(d2), p = R - d; human.x += (dx / d) * p; human.z += (dz / d) * p; return; }
  const opts = [[human.x - b.x0, -1, 0], [b.x1 - human.x, 1, 0], [human.z - b.z0, 0, -1], [b.z1 - human.z, 0, 1]];
  opts.sort((p, q) => p[0] - q[0]);
  const [dd, nx, nz] = opts[0];
  human.x += nx * (dd + R); human.z += nz * (dd + R);
}
function updateHuman(dt) {
  human.h += inp.steer * 2.4 * dt;
  const running = keys.has('ShiftLeft') || keys.has('ShiftRight');
  let target = 0;
  if (inp.throttle) target = running ? 7.5 : 4.2;
  else if (inp.brake) target = -1.6;
  human.s += (target - human.s) * Math.min(1, dt * 8);
  human.x += -Math.sin(human.h) * human.s * dt;
  human.z += -Math.cos(human.h) * human.s * dt;
  for (const b of world.colliders.boxes) pushOutBox(b);
  for (const o of world.colliders.circles) pushOutCircle(o.x, o.z, o.r);
  pushOutCircle(player.x, player.z, 1.5);
  for (const t of traffic.cars) pushOutCircle(t.x, t.z, 1.6);
  const r = Math.hypot(human.x, human.z), lim = 1200;
  if (r > lim) { human.x *= lim / r; human.z *= lim / r; }
  const onWalk = world.blocks.some((b) => human.x >= b.x0 && human.x <= b.x1 && human.z >= b.z0 && human.z <= b.z1);
  hm.group.position.set(human.x, onWalk ? CURB : 0, human.z);
  hm.group.rotation.y = human.h;
  hm.update(dt, Math.abs(human.s));
}

// ── image-based reflections from the same sky shader ──
const pmrem = new THREE.PMREMGenerator(renderer);
const envScene = new THREE.Scene();
envScene.add(sky.envMesh);
let envRT = null, envT = -99, envRain = -1, envClock = 0;
function refreshEnv(ds, rain, now) {
  if (Math.abs(ds.t - envT) < 0.03 && Math.abs(rain - envRain) < 0.02) return;
  if (now - envClock < 250) return;
  envClock = now; envT = ds.t; envRain = rain;
  const next = pmrem.fromScene(envScene, 0.02, 0.1, 200);
  if (envRT) envRT.dispose();
  envRT = next;
  scene.environment = envRT.texture;
}

// ── post ──
const bloom = new BloomFX(renderer);
bloom.strength = 0.5;

// ── rain ──
const rainGeo = new THREE.BufferGeometry();
const rainPos = new Float32Array(RAIN_N * 6);
rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
const rainRel = new Float32Array(RAIN_N * 3);
const rnd = mulberry32(4242);
for (let i = 0; i < RAIN_N; i++) {
  rainRel[i * 3] = (rnd() - 0.5) * 140;
  rainRel[i * 3 + 1] = rnd() * 40;
  rainRel[i * 3 + 2] = (rnd() - 0.5) * 140;
}
const rainMat = new THREE.LineBasicMaterial({ color: 0xbfd6ea, transparent: true, opacity: 0, depthWrite: false });
const rainLines = new THREE.LineSegments(rainGeo, rainMat);
rainLines.frustumCulled = false;
scene.add(rainLines);

// ── input ──
const keys = new Set();
const inp = { throttle: 0, brake: 0, steer: 0, handbrake: false };
let camMode = 'chase', autoTime = true, rainTarget = 0, muted = false, helpOpen = true, mapOn = true;
let clockT = 16.5;                         // local time, hours
const bindings = {
  KeyC: () => { camMode = camMode === 'chase' ? 'hood' : 'chase'; $('hCam').textContent = camMode === 'chase' ? 'chase' : 'hood'; },
  KeyR: () => respawn(),
  KeyH: () => { helpOpen = !helpOpen; $('help').classList.toggle('hide', !helpOpen); },
  KeyT: () => { clockT = (clockT + 1) % 24; },
  KeyQ: () => { autoTime = !autoTime; $('hAuto').textContent = autoTime ? 'on' : 'off'; },
  KeyN: () => { rainTarget = rainTarget > 0.5 ? 0 : 1; },
  KeyM: () => { muted = !muted; if (master) master.gain.value = muted ? 0 : 0.7; $('hMute').textContent = muted ? 'off' : 'on'; },
  KeyP: () => { mapOn = !mapOn; $('minimap').classList.toggle('hide', !mapOn); },
  KeyF: () => toggleVehicle(),
};
addEventListener('keydown', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  if (!e.repeat) { keys.add(e.code); bindings[e.code]?.(); initAudio(); $('hint').classList.add('gone'); }
  else keys.add(e.code);
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

function readInput() {
  const k = keys;
  inp.throttle = k.has('KeyW') || k.has('ArrowUp') ? 1 : 0;
  inp.brake = k.has('KeyS') || k.has('ArrowDown') ? 1 : 0;
  inp.steer = (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) - (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0);
  inp.handbrake = k.has('Space');
}

function respawn() {
  // drop back onto the nearest straight road heading the way we're facing
  const P = 72;
  const gx = Math.round((player.x + 252) / P), gz = Math.round((player.z + 252) / P);
  const i = clamp(gx, 0, 7), j = clamp(gz, 0, 7);
  player.x = lineCoord(i) + 3.5; player.z = lineCoord(j) + 30; player.h = 0; player.s = 0; player.lat = 0;
  camInit = false;
}

// ── audio: engine + rain ──
let actx = null, master = null, eng = null, rainGain = null;
function initAudio() {
  if (actx) { if (actx.state === 'suspended') actx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  actx = new AC();
  master = actx.createGain();
  master.gain.value = muted ? 0 : 0.7;
  master.connect(actx.destination);

  const osc = actx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 36;
  const sub = actx.createOscillator(); sub.type = 'square'; sub.frequency.value = 18;
  const lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 650; lp.Q.value = 3;
  const eg = actx.createGain(); eg.gain.value = 0;
  osc.connect(lp); sub.connect(lp); lp.connect(eg); eg.connect(master);
  osc.start(); sub.start();
  eng = { osc, sub, lp, eg };

  const buf = actx.createBuffer(1, actx.sampleRate * 2, actx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = actx.createBufferSource(); src.buffer = buf; src.loop = true;
  const bp = actx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 0.5;
  rainGain = actx.createGain(); rainGain.gain.value = 0;
  src.connect(bp); bp.connect(rainGain); rainGain.connect(master); src.start();
}
function updateAudio(dt, rain) {
  if (!actx || !eng) return;
  const now = actx.currentTime;
  const kmh = player.speedKmh, th = inp.throttle;
  const f = 34 + kmh * 0.62 + th * 22;
  eng.osc.frequency.setTargetAtTime(f, now, 0.08);
  eng.sub.frequency.setTargetAtTime(f * 0.5, now, 0.08);
  eng.lp.frequency.setTargetAtTime(420 + kmh * 9 + th * 500, now, 0.1);
  eng.eg.gain.setTargetAtTime(0.03 + 0.05 * th + Math.min(0.05, kmh * 0.0008), now, 0.1);
  rainGain.gain.setTargetAtTime(rain * 0.11, now, 0.5);
}

// ── camera ──
const camPos = new THREE.Vector3();
let camInit = false, fovNow = 62;
function updateCamera(dt) {
  const foot = mode === 'foot';
  const px = foot ? human.x : player.x, pz = foot ? human.z : player.z;
  const ph = foot ? human.h : player.h;
  const fx = -Math.sin(ph), fz = -Math.cos(ph);
  const sp = foot ? 0 : Math.abs(player.s);
  let desired, look, fovT;
  if (foot) {
    desired = new THREE.Vector3(px - fx * 4.2, 2.4, pz - fz * 4.2);
    look = new THREE.Vector3(px + fx * 2, 1.3, pz + fz * 2);
    fovT = 62;
  } else if (camMode === 'chase') {
    const dist = 7.6 + sp * 0.05, hgt = 2.9 + sp * 0.01;
    desired = new THREE.Vector3(px - fx * dist, hgt, pz - fz * dist);
    look = new THREE.Vector3(px + fx * 5, 1.25, pz + fz * 5);
    fovT = 62 + Math.min(16, sp * 0.22);
  } else {
    desired = new THREE.Vector3(px + fx * 0.45, 1.28, pz + fz * 0.45);
    look = new THREE.Vector3(px + fx * 40, 1.0, pz + fz * 40);
    fovT = 74;
  }
  if (!camInit) { camPos.copy(desired); camInit = true; }
  else camPos.lerp(desired, 1 - Math.exp(-dt * (camMode === 'chase' || foot ? 9 : 60)));
  camera.position.copy(camPos);
  camera.lookAt(look);
  fovNow = lerp(fovNow, fovT, 1 - Math.exp(-dt * 4));
  if (Math.abs(camera.fov - fovNow) > 0.01) { camera.fov = fovNow; camera.updateProjectionMatrix(); }
}

// ── minimap ──
const mm = $('minimap'), mctx = mm.getContext('2d');
function drawMinimap() {
  const W = mm.width, H = mm.height, S = W / 230;
  const [fx, fz] = player.forward();
  const rX = Math.cos(player.h), rZ = -Math.sin(player.h);
  const P = (x, z) => {
    const dx = x - player.x, dz = z - player.z;
    return [W / 2 + (dx * rX + dz * rZ) * S, H / 2 - (dx * fx + dz * fz) * S];
  };
  mctx.save();
  mctx.beginPath(); mctx.arc(W / 2, H / 2, W / 2, 0, Math.PI * 2); mctx.clip();
  mctx.fillStyle = '#2a3441'; mctx.fillRect(0, 0, W, H);
  for (const b of world.blocks) {
    const corners = [P(b.x0, b.z0), P(b.x1, b.z0), P(b.x1, b.z1), P(b.x0, b.z1)];
    mctx.fillStyle = b.park ? '#3f7a3a' : '#8a929c';
    mctx.beginPath();
    corners.forEach(([x, y], k) => (k ? mctx.lineTo(x, y) : mctx.moveTo(x, y)));
    mctx.fill();
  }
  mctx.fillStyle = '#ffd34d';
  for (const c of traffic.cars) {
    const [x, y] = P(c.x, c.z);
    mctx.fillRect(x - 1.5, y - 1.5, 3, 3);
  }
  const [px, py] = [W / 2, H / 2];
  mctx.fillStyle = '#ff3b5c';
  mctx.beginPath(); mctx.moveTo(px, py - 7); mctx.lineTo(px + 5, py + 5); mctx.lineTo(px, py + 2.5); mctx.lineTo(px - 5, py + 5); mctx.closePath(); mctx.fill();
  mctx.restore();
}

// ── HUD ──
const hud = { clock: '', weather: '', speed: '', gear: '', prompt: '' };
function setText(key, id, val) { if (hud[key] !== val) { hud[key] = val; $(id).textContent = val; } }
function clockStr(t) {
  const h = Math.floor(t), m = Math.floor((t - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// ── resize ──
function resize() {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  bloom.setSize(innerWidth, innerHeight);
}
addEventListener('resize', resize);
resize();

// ── loop ──
let last = performance.now(), clock = 0, frames = 0, rain = 0;
const tmpDir = new THREE.Vector3();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  clock += dt;
  if (autoTime) clockT = (clockT + dt * (24 / DAY_SECONDS)) % 24;
  rain += (rainTarget - rain) * Math.min(1, dt * 0.45);

  readInput();
  if (mode === 'car') player.update(dt, inp, world.colliders, traffic);
  else { player.update(dt, IDLE, world.colliders, traffic); updateHuman(dt); }
  traffic.update(dt, clock);

  const ds = dayState(clockT);
  sky.uniforms.time.value += dt;
  sky.apply(ds, rain);
  applyLights(ds, rain, key, hemi, sky);
  key.target.position.set(player.x, 0, player.z);
  tmpDir.copy(key.position);
  key.position.copy(key.target.position).addScaledVector(tmpDir, 320);
  scene.fog.color.copy(sky.uniforms.horizon.value);
  scene.fog.near = lerp(260, 140, rain);
  scene.fog.far = lerp(2600, 1100, rain);
  scene.environmentIntensity = 0.3 + 0.7 * ds.day;
  world.setWet(rain);
  world.update(dt, clock, { lamps: ds.night * 3.2 + 0.1, windows: ds.night * 1.3 });
  player.headlight.intensity = ds.night * 420 + rain * 40;
  player.car.headMat.emissiveIntensity = ds.night * 3.2 + 0.25;

  updateCamera(dt);
  sky.mesh.position.copy(camera.position);
  refreshEnv(ds, rain, now);

  // rain streaks around the camera
  rainMat.opacity = rain * 0.42;
  rainLines.visible = rain > 0.01;
  if (rainLines.visible) {
    const cx = camera.position.x, cz = camera.position.z;
    const fall = 26 * dt, wx = 1.8, wz = 0.6;
    for (let i = 0; i < RAIN_N; i++) {
      const k = i * 3;
      rainRel[k + 1] -= fall * (0.8 + (i % 7) * 0.05);
      if (rainRel[k + 1] < 0) { rainRel[k + 1] += 40; rainRel[k] = (Math.random() - 0.5) * 140; rainRel[k + 2] = (Math.random() - 0.5) * 140; }
      const x = cx + rainRel[k], y = rainRel[k + 1], z = cz + rainRel[k + 2];
      const o = i * 6;
      rainPos[o] = x; rainPos[o + 1] = y; rainPos[o + 2] = z;
      rainPos[o + 3] = x + wx * 0.12; rainPos[o + 4] = y + 1.1; rainPos[o + 5] = z + wz * 0.12;
    }
    rainGeo.attributes.position.needsUpdate = true;
  }

  updateAudio(dt, rain);

  bloom.render(scene, camera);

  // HUD
  const gear = player.s < -0.4 ? 'R' : 'D';
  setText('clock', 'hClock', clockStr(clockT));
  setText('weather', 'hWeather', rain > 0.5 ? 'Rain' : rain > 0.05 ? 'Light rain' : 'Clear');
  const foot = mode === 'foot';
  setText('speed', 'hSpeed', String(Math.round(foot ? Math.abs(human.s) * 3.6 : player.speedKmh)));
  setText('gear', 'hGear', foot ? 'FOOT' : gear);
  $('hGear').classList.toggle('small', foot);
  let prompt = '';
  if (foot && nearCarDist() < 3.6) prompt = 'F · get in';
  else if (!foot && player.speedKmh < 3) prompt = 'F · get out';
  setText('prompt', 'hPrompt', prompt);
  if (mapOn && (frames & 1) === 0) drawMinimap();
  frames++;
  if (frames === 2) $('loading').classList.add('gone');

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// expose a tiny hook for automated checks
window.__city = { player, traffic, world, renderer, human, get mode() { return mode; }, toggleVehicle, setTime: (t) => { clockT = t; autoTime = false; }, setRain: (r) => { rainTarget = r ? 1 : 0; rain = r ? 1 : 0; }, setCam: (m) => { camMode = m; }, get rain() { return rain; } };
