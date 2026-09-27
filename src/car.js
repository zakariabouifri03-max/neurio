// 🏎️ Ferrari 458 driving sim — model: three.js examples (github.com/mrdoob/three.js)
// Physics: bicycle model with tyre slip, friction circle, weight transfer,
// 6-speed automatic gearbox, aero drag, handbrake drift.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildWorld } from './world.js';

// ───────────────────────── renderer / scene ─────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const SKY = 0xbfd6ea;
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 250, 1700);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 4000);

scene.add(new THREE.HemisphereLight(0xffffff, 0x556070, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -15, right: 15, top: 15, bottom: -15, near: 1, far: 80 });
sun.shadow.bias = -0.0005;
scene.add(sun, sun.target);

// ───────────────────────── open world ─────────────────────────
// sky dome (gradient) — rendered behind everything, follows the camera
const skyDome = new THREE.Mesh(new THREE.SphereGeometry(3000, 32, 16), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  vertexShader: 'varying vec3 vp; void main(){ vp = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
  fragmentShader: 'varying vec3 vp; void main(){ float h = vp.y; vec3 top = vec3(.22,.45,.82), hor = vec3(.75,.84,.92), gnd = vec3(.62,.7,.76);'
    + ' vec3 c = h > 0. ? mix(hor, top, pow(h, .55)) : gnd; vec3 sd = normalize(vec3(.5,.55,.3)); c += vec3(1.,.9,.7) * pow(max(dot(vp, sd), 0.), 400.) * 2.; c += vec3(1.,.8,.5) * pow(max(dot(vp, sd), 0.), 8.) * .25; gl_FragColor = vec4(c,1.); }',
}));
skyDome.renderOrder = -1; scene.add(skyDome);
const world = buildWorld(scene, renderer);

// ───────────────────────── skid marks ─────────────────────────
const SKID_MAX = 6000;
const skids = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.24, 0.35).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }), SKID_MAX);
skids.count = 0; skids.frustumCulled = false; skids.renderOrder = 1;
scene.add(skids);
let skidIdx = 0; const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0);
function addSkid(x, z, yaw) {
  _q.setFromAxisAngle(_up, yaw);
  _m.compose(new THREE.Vector3(x, world.heightAt(x, z) + 0.1, z), _q, new THREE.Vector3(1, 1, 1));
  skids.setMatrixAt(skidIdx, _m);
  skidIdx = (skidIdx + 1) % SKID_MAX;
  skids.count = Math.min(skids.count + 1, SKID_MAX);
  skids.instanceMatrix.needsUpdate = true;
}

// ───────────────────────── garage: 19 realistic cars, weakest → strongest ─────────────────────────
// Models: Sketchfab artists via GitHub repos (see assets/real/LICENSES.txt) + Ferrari 458 (three.js examples)
// hp · torque Nm · redline rpm · top km/h · mass kg · mu grip · drag · gears · cg height · downforce
const CARS = [
  { id: 'merc190', engine: 'i4',  name: 'Mercedes 190E Evo',          year: 1982, hp: 235, torque: 245, redline: 7200, top: 250, mass: 1340, mu: 1.0,  drag: 0.36, gears: 5, cg: 0.5 },
  { id: 'gt350_65', engine: 'v8x', name: 'Shelby GT350',               year: 1965, hp: 306, torque: 447, redline: 6500, top: 215, mass: 1270, mu: 0.95, drag: 0.42, gears: 4, cg: 0.5 },
  { id: 'mach1', engine: 'v8big',    name: 'Mustang Mach 1 428 CJ',      year: 1969, hp: 335, torque: 597, redline: 5600, top: 200, mass: 1600, mu: 0.95, drag: 0.45, gears: 4, cg: 0.55 },
  { id: 'gt500_67', engine: 'v8big', name: 'Shelby Cobra GT500',         year: 1967, hp: 355, torque: 570, redline: 5400, top: 210, mass: 1500, mu: 0.95, drag: 0.43, gears: 4, cg: 0.55 },
  { id: 'p930', engine: 'f6t',     name: 'Porsche 911 (930) Turbo',    year: 1975, hp: 260, torque: 343, redline: 6500, top: 250, mass: 1140, mu: 1.05, drag: 0.36, gears: 4, cg: 0.45 },
  { id: 'supra', engine: 'i6t',    name: 'Toyota Supra',               year: 1998, hp: 320, torque: 427, redline: 6800, top: 250, mass: 1510, mu: 1.05, drag: 0.34, gears: 6, cg: 0.48 },
  { id: 'ghost', engine: 'v12lux',    name: 'Rolls-Royce Ghost',          year: 2021, hp: 563, torque: 850, redline: 5250, top: 250, mass: 2490, mu: 1.0,  drag: 0.44, gears: 8, cg: 0.6 },
  { id: 'raptor', engine: 'v8sc',   name: 'Ford F-150 Raptor R',        year: 2024, hp: 700, torque: 868, redline: 6500, top: 180, mass: 2700, mu: 0.95, drag: 0.75, gears: 8, cg: 0.8, steer: 0.55 },
  { id: 'ftype', engine: 'v8sc',    name: 'Jaguar F-Type R',            year: 2020, hp: 575, torque: 700, redline: 6500, top: 300, mass: 1700, mu: 1.1,  drag: 0.34, gears: 8, cg: 0.45 },
  { id: 'gt350r', engine: 'v8f',   name: 'Shelby GT350R',              year: 2016, hp: 526, torque: 582, redline: 8250, top: 290, mass: 1700, mu: 1.15, drag: 0.36, gears: 6, cg: 0.47 },
  { id: 'db11', engine: 'v12',     name: 'Aston Martin DB11 V12',      year: 2017, hp: 630, torque: 700, redline: 7000, top: 322, mass: 1760, mu: 1.1,  drag: 0.32, gears: 8, cg: 0.46 },
  { id: 'm8', engine: 'v8tt',       name: 'BMW M8 Competition',         year: 2020, hp: 625, torque: 750, redline: 7200, top: 305, mass: 1885, mu: 1.12, drag: 0.34, gears: 8, cg: 0.47 },
  { id: 'gt500_20', engine: 'v8sc', name: 'Shelby GT500',               year: 2020, hp: 760, torque: 847, redline: 7500, top: 290, mass: 1900, mu: 1.12, drag: 0.40, gears: 7, cg: 0.47 },
  { id: 'gt3', engine: 'f6',      name: 'Porsche 911 GT3 (992)',      year: 2022, hp: 510, torque: 470, redline: 9000, top: 318, mass: 1435, mu: 1.25, drag: 0.33, gears: 7, cg: 0.42, df: 0.3 },
  { id: 'ferrari', engine: 'v8f',  name: 'Ferrari 458 Italia',         year: 2010, hp: 562, torque: 540, redline: 8500, top: 325, mass: 1480, mu: 1.2,  drag: 0.30, gears: 6, cg: 0.45, df: 0.25 },
  { id: 'r8', engine: 'v10',       name: 'Audi R8 V10 Performance',    year: 2021, hp: 620, torque: 580, redline: 8700, top: 331, mass: 1595, mu: 1.2,  drag: 0.30, gears: 7, cg: 0.44, df: 0.2 },
  { id: 'fordgt', engine: 'v6tt',   name: 'Ford GT',                    year: 2017, hp: 647, torque: 746, redline: 7000, top: 348, mass: 1385, mu: 1.25, drag: 0.30, gears: 7, cg: 0.40, df: 0.6 },
  { id: 'ccgt', engine: 'v8race',     name: 'Koenigsegg CCGT (GT1)',      year: 2007, hp: 600, torque: 600, redline: 8500, top: 340, mass: 1100, mu: 1.35, drag: 0.36, gears: 6, cg: 0.36, df: 1.0 },
];

const car = new THREE.Group(); // physics transform (y-rot only)
scene.add(car);
let body = null, steeringWheel = null, steerQ0 = null, current = null, carIdx = CARS.findIndex((c) => c.id === 'ferrari');
let wheels = {}; // fl fr rl rr → { spin, pivot, base, pos }
const draco = new DRACOLoader().setDecoderPath('./vendor/libs/draco/gltf/');
const loader = new GLTFLoader().setDRACOLoader(draco);
const cache = {};

function prepFerrari(model) {
  const paint = new THREE.MeshPhysicalMaterial({ color: 0xc00000, metalness: 1, roughness: 0.45, clearcoat: 1, clearcoatRoughness: 0.03 });
  const detail = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.4 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0.25, roughness: 0, transmission: 1 });
  model.getObjectByName('body').material = paint;
  ['rim_fl', 'rim_fr', 'rim_rr', 'rim_rl', 'trim'].forEach((n) => { const o = model.getObjectByName(n); if (o) o.material = detail; });
  model.getObjectByName('glass').material = glass;
  const ao = new THREE.Mesh(new THREE.PlaneGeometry(0.655 * 4, 1.3 * 4).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: new THREE.TextureLoader().load('./assets/ferrari_ao.png'), blending: THREE.MultiplyBlending, toneMapped: false, transparent: true, premultipliedAlpha: true }));
  ao.position.y = 0.01; ao.renderOrder = 2;
  model.add(ao);
}

function buildCar(spec, gltf) {
  const isF = spec.id === 'ferrari';
  const model = gltf.scene.clone(true);
  const root = new THREE.Group(); // suspension pitch/roll
  const holder = new THREE.Group(); // orientation/scale → model faces -Z
  root.add(holder); holder.add(model);
  if (isF) prepFerrari(model); // realistic models are pre-normalised offline: face -Z, metric, on the ground
  model.traverse((o) => { if (o.isMesh) o.castShadow = true; });

  const names = isF ? { fl: 'wheel_fl', fr: 'wheel_fr', rl: 'wheel_rl', rr: 'wheel_rr' }
                    : { fl: 'wheel_fl', fr: 'wheel_fr', rl: 'wheel_rl', rr: 'wheel_rr' };
  const ws = {};
  root.updateMatrixWorld(true);
  for (const k in names) {
    const w = model.getObjectByName(names[k]);
    const pivot = new THREE.Group();
    pivot.position.copy(w.position);
    w.parent.add(pivot); pivot.add(w); w.position.set(0, 0, 0);
    root.updateMatrixWorld(true);
    ws[k] = { spin: w, pivot, base: w.quaternion.clone(), pos: pivot.getWorldPosition(new THREE.Vector3()) };
  }
  // geometry → physics: put CG at 47% of wheelbase from the front axle
  const zf = (ws.fl.pos.z + ws.fr.pos.z) / 2, zr = (ws.rl.pos.z + ws.rr.pos.z) / 2;
  const L = zr - zf, cgz = zf + L * 0.47;
  holder.position.z = -cgz;
  for (const k in ws) ws[k].pos.z -= cgz;
  const box = new THREE.Box3().setFromObject(root);
  return {
    root, wheels: ws, a: L * 0.47, b: L * 0.53, wheelR: Math.max(0.2, ws.rl.pos.y), height: box.max.y, length: box.max.z - box.min.z, width: box.max.x - box.min.x,
    spinSign: -1, steeringWheel: isF ? model.getObjectByName('steering_wheel') : null,
  };
}

function specPhysics(spec, geo) {
  const n = spec.gears, spread = n === 1 ? 1 : (n >= 8 ? 4.5 : 3.4);
  const topRatio = spec.redline * 2 * Math.PI / 60 * geo.wheelR / (spec.top / 3.6);
  const gears = [];
  for (let i = 0; i < n; i++) gears.push(topRatio * Math.pow(spread, n === 1 ? 0 : (n - 1 - i) / (n - 1)));
  Object.assign(P, {
    mass: spec.mass, inertia: spec.mass * (geo.a + geo.b) ** 2 / 4.5, a: geo.a, b: geo.b, cgH: spec.cg,
    wheelR: geo.wheelR, mu: spec.mu, gears, reverse: gears[0], final: 1, eff: 0.85,
    idle: Math.min(1000, spec.redline * 0.3), redline: spec.redline, peak: spec.torque,
    dragC: spec.drag, rollC: spec.mass * 0.008, df: spec.df || 0,
    brakeF: spec.mass * 9.81 * Math.min(1.1, spec.mu), handbrakeF: spec.mass * 9.81 * 0.35,
    maxSteer: spec.steer || 0.62, revMax: Math.min(9, spec.top / 3.6 * 0.3),
  });
}

function selectCar(i) {
  carIdx = (i + CARS.length) % CARS.length;
  const spec = CARS[carIdx];
  const url = spec.id === 'ferrari' ? './assets/ferrari.glb' : `./assets/real/${spec.id}.glb`;
  toast('⏳ ' + spec.name);
  const done = (gltf) => {
    cache[url] = gltf;
    if (CARS[carIdx] !== spec) return; // user switched again meanwhile
    const geo = buildCar(spec, gltf);
    if (current) car.remove(current.root);
    current = geo; car.add(geo.root);
    body = geo.root; wheels = geo.wheels;
    steeringWheel = geo.steeringWheel; steerQ0 = steeringWheel ? steeringWheel.quaternion.clone() : null;
    specPhysics(spec, geo);
    applyEngine(ENGINES[spec.engine] || ENGINES.v8f);
    Object.assign(S, { vx: 0, vz: 0, w: 0, steer: 0, gear: 1, ax: 0, ay: 0 });
    toast(`${carIdx + 1}/${CARS.length} · ${spec.name} · ${ENGINES[spec.engine].label} · ${spec.hp} hp · ${spec.top} km/h`);
    renderGarage();
    const l = document.getElementById('loader'); if (l) { l.style.opacity = 0; setTimeout(() => l.remove(), 500); }
  };
  if (cache[url]) done(cache[url]);
  else loader.load(url, done, undefined, (e) => toast('⚠️ ' + e.message));
}

// garage UI
const garage = document.getElementById('garage');
function renderGarage() {
  const maxHp = Math.max(...CARS.map((c) => c.hp));
  garage.querySelector('.list').innerHTML = CARS.map((c, i) => `
    <button class="car-item${i === carIdx ? ' on' : ''}" data-i="${i}">
      <span class="n">${i + 1}</span>
      <span class="nm">${c.name} <small>${c.year}</small></span>
      <span class="st">${ENGINES[c.engine].label} · ${c.hp} hp · ${c.top} km/h · ${c.mass} kg</span>
      <span class="bar"><i style="width:${(Math.sqrt(c.hp / maxHp) * 100).toFixed(0)}%"></i></span>
    </button>`).join('');
}
garage.addEventListener('click', (e) => {
  const b = e.target.closest('.car-item'); if (b) { selectCar(+b.dataset.i); garage.classList.remove('open'); }
});
document.getElementById('btn-garage').onclick = () => garage.classList.toggle('open');
document.getElementById('btn-prev').onclick = () => selectCar(carIdx - 1);
document.getElementById('btn-next').onclick = () => selectCar(carIdx + 1);

// ───────────────────────── input ─────────────────────────
const keys = { fwd: 0, back: 0, left: 0, right: 0, hand: 0 };
const map = { KeyW: 'fwd', ArrowUp: 'fwd', KeyS: 'back', ArrowDown: 'back', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', Space: 'hand' };
addEventListener('keydown', (e) => {
  if (map[e.code]) { keys[map[e.code]] = 1; e.preventDefault(); }
  if (e.code === 'KeyC') cycleCam();
  if (e.code === 'KeyR') resetCar();
  if (e.code === 'KeyG') garage.classList.toggle('open');
  if (e.code === 'KeyQ') selectCar(carIdx - 1);
  if (e.code === 'KeyE') selectCar(carIdx + 1);
  if (e.code === 'KeyH') horn(true);
  if (e.code === 'KeyT') { P.tc = !P.tc; toast(P.tc ? '🛡️ TC: ON' : '🔥 TC: OFF — درِيفت!'); }
  initAudio();
});
addEventListener('keyup', (e) => { if (map[e.code]) keys[map[e.code]] = 0; if (e.code === 'KeyH') horn(false); });
document.querySelectorAll('#touch button').forEach((b) => {
  const k = b.dataset.k;
  const on = (e) => { e.preventDefault(); keys[k] = 1; b.classList.add('on'); initAudio(); };
  const off = (e) => { e.preventDefault(); keys[k] = 0; b.classList.remove('on'); };
  b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off);
  b.addEventListener('pointerleave', off); b.addEventListener('pointercancel', off);
});

const toastEl = Object.assign(document.createElement('div'), { className: 'glass' });
Object.assign(toastEl.style, { position: 'fixed', top: '70px', left: '50%', transform: 'translateX(-50%)', padding: '8px 16px', opacity: 0, transition: 'opacity .3s' });
document.body.appendChild(toastEl);
let toastT; function toast(t) { toastEl.textContent = t; toastEl.style.opacity = 1; clearTimeout(toastT); toastT = setTimeout(() => (toastEl.style.opacity = 0), 1500); }

// ───────────────────────── vehicle physics ─────────────────────────
const P = {
  mass: 1480, inertia: 2300, g: 9.81,
  a: 1.25, b: 1.40,          // CG → front / rear axle (m)
  cgH: 0.45, track: 1.67,
  wheelR: 0.34, mu: 1.15,
  gears: [3.08, 2.19, 1.63, 1.29, 1.03, 0.84], reverse: 2.9, final: 3.4, eff: 0.85,
  idle: 1000, redline: 8500,
  dragC: 0.40, rollC: 12,
  brakeF: 15000, handbrakeF: 5000,
  maxSteer: 0.62,
  tc: true,
};
const S = { x: 0, z: 0, yaw: 0, vx: 0, vz: 0, w: 0, steer: 0, gear: 1, rpm: 1000, ax: 0, ay: 0, wheelRot: 0, shiftT: 0, slipR: 0, slipF: 0 };
function resetCar() { const sp = world.spawnNear(S.x, S.z); Object.assign(S, { x: sp.x, z: sp.z, yaw: sp.yaw, vx: 0, vz: 0, w: 0, steer: 0, gear: 1, ax: 0, ay: 0 }); }
{ const F = world.spawnNear(-340, 110); Object.assign(S, { x: F.x, z: F.z, yaw: F.yaw }); } // start next to the festival

function torqueCurve(rpm) {
  if (rpm >= P.redline) return 0;
  const t = rpm / P.redline;
  return P.peak * (0.62 + 0.55 * t - 0.25 * t * t);
}

function physics(dt) {
  const s = Math.sin(S.yaw), c = Math.cos(S.yaw);
  const fx = -s, fz = -c;           // forward (model faces -Z)
  const rx = c, rz = -s;            // right
  const vF = S.vx * fx + S.vz * fz; // longitudinal speed
  const vR = S.vx * rx + S.vz * rz; // lateral speed
  const speed = Math.hypot(S.vx, S.vz);
  const L = P.a + P.b;

  // steering: less lock at speed, smooth rack
  const steerIn = keys.left - keys.right;
  const lock = P.maxSteer / (1 + speed * speed / 150);
  const target = steerIn * lock;
  const rate = steerIn ? 2.6 : 4.0;
  S.steer += THREE.MathUtils.clamp(target - S.steer, -rate * dt, rate * dt);

  // gearbox (automatic) + throttle / brake logic
  let throttle = 0, brake = 0;
  if (S.gear > 0) {
    if (keys.fwd) throttle = 1;
    if (keys.back) { if (vF > 1) brake = 1; else if (!keys.fwd) S.gear = -1; }
  } else {
    if (keys.back) throttle = 1;
    if (keys.fwd) { if (vF < -1) brake = 1; else S.gear = 1; }
  }
  const ratio = S.gear > 0 ? P.gears[S.gear - 1] : -P.reverse;
  const wheelRpm = (vF / P.wheelR) * 60 / (2 * Math.PI);
  S.rpm = Math.max(P.idle, Math.abs(wheelRpm * ratio * P.final));
  if (S.shiftT > 0) S.shiftT -= dt;
  if (S.gear > 0 && S.shiftT <= 0) {
    if (S.rpm > P.redline * 0.94 && S.gear < P.gears.length) { S.gear++; S.shiftT = 0.35; }
    else if (S.gear > 1 && S.rpm * P.gears[S.gear - 2] / P.gears[S.gear - 1] < P.redline * 0.8) { S.gear--; S.shiftT = 0.35; }
  }
  const shifting = S.shiftT > 0.2;
  S.thr = throttle; S.shifting = shifting;
  let engineF = 0;
  if (throttle && !shifting) {
    engineF = torqueCurve(S.rpm) * ratio * P.final * P.eff / P.wheelR;
    if (S.gear < 0 && vF < -P.revMax) engineF = 0; // reverse speed limit
  }

  // weight transfer (uses last step accelerations)
  const W = P.mass * P.g; const DF = P.df * speed * speed; // downforce
  const Nf = Math.max(0, (W + DF) * P.b / L - P.mass * S.ax * P.cgH / L);
  const Nr = Math.max(0, (W + DF) * P.a / L + P.mass * S.ax * P.cgH / L);

  // longitudinal forces
  const sgn = Math.sign(vF) || 0;
  let FxR = engineF, FxF = 0;
  if (brake) { FxF -= sgn * P.brakeF * 0.6; FxR -= sgn * P.brakeF * 0.4; }
  if (keys.hand) FxR -= sgn * P.handbrakeF;
  // don't let brakes reverse the car
  if (Math.abs(vF) < 0.5 && (brake || keys.hand)) { FxF = 0; FxR = engineF; }

  // tyre lateral forces (slip angle, saturating)
  const vlong = Math.max(Math.abs(vF), 2);
  const vLatF = vR - S.w * P.a;   // lateral velocity at front axle
  const vLatR = vR + S.w * P.b;   // lateral velocity at rear axle
  const alphaF = Math.atan2(vLatF, vlong) + S.steer * Math.sign(vF || 1);
  const alphaR = Math.atan2(vLatR, vlong);
  const tyre = (alpha, N, mu, fall) => { const k = alpha * 9; const f = Math.abs(k) < 1 ? k : Math.sign(k) * (1 - fall * Math.min(1, Math.abs(k) - 1)); return -f * mu * N; };
  const surf = S.surf || { mu: 1, drag: 0 };
  const muS = P.mu * surf.mu;
  const muR = keys.hand ? muS * 0.45 : muS * 1.1; // wider rear tyres → stable understeer balance
  let FyF = tyre(alphaF, Nf, muS, 0.15); // front: slight drop past peak → understeer
  let FyR = tyre(alphaR, Nr, muR, keys.hand ? 0.3 : 0); // rear: holds (stable) unless handbrake
  // friction circle at rear: wheelspin/braking reduces side grip → power oversteer
  const maxR = muR * Nr;
  if (P.tc && FxR > 0) { // traction control: keep drive force inside what the tyre has left
    const avail = Math.sqrt(Math.max(0, maxR * maxR - FyR * FyR));
    FxR = Math.min(FxR, Math.max(avail * 0.9, maxR * 0.25));
  }
  FxR = THREE.MathUtils.clamp(FxR, -maxR, maxR);
  FyR *= Math.sqrt(Math.max(0, 1 - (FxR / maxR) ** 2)) || 0;
  const maxF = muS * Nf; FxF = THREE.MathUtils.clamp(FxF, -maxF, maxF);
  S.slipR = Math.abs(alphaR) * 9 + (engineF > maxR * 1.05 ? 1.5 : 0) + (keys.hand && speed > 3 ? 1.5 : 0);
  S.slipF = Math.abs(alphaF) * 9 + (brake && speed > 3 && FxF === -sgn * maxF ? 1.2 : 0);

  // front wheel forces in car frame (rotate by steer)
  const cs = Math.cos(S.steer), sn = Math.sin(S.steer);
  const fF_long = FxF * cs + FyF * sn;       // front force along car forward
  const fF_lat = FyF * cs - FxF * sn;          // along car right (steer left => -right)
  // total force (car frame) + resistances
  let Flong = FxR + fF_long;
  let Flat = FyR + fF_lat;
  Flong -= P.dragC * vF * Math.abs(vF) + P.rollC * vF;
  // off-road drag (sand/water) + gravity along the slope
  Flong -= P.mass * surf.drag * 0.1 * vF;
  Flat -= P.mass * surf.drag * 0.3 * vR;
  Flong -= P.mass * P.g * Math.sin(S.slopeP || 0);
  Flat -= P.mass * P.g * Math.sin(S.slopeR || 0);
  Flat -= P.dragC * 2 * vR * Math.abs(vR);

  // yaw torque: front lateral acts at +a (forward), rear at -b
  const torque = -fF_lat * P.a + FyR * P.b; // sign: +yaw = left turn; lateral force to the right at front turns right
  const ax = Flong / P.mass, ay = Flat / P.mass;
  S.ax += (ax - S.ax) * Math.min(1, dt * 8);
  S.ay += (ay - S.ay) * Math.min(1, dt * 8);

  S.vx += (fx * ax + rx * ay) * dt;
  S.vz += (fz * ax + rz * ay) * dt;
  S.w += (torque / P.inertia) * dt;
  if (speed < 0.3 && !throttle) { S.vx *= 0.9; S.vz *= 0.9; S.w *= 0.8; }
  S.yaw += S.w * dt;
  S.x += S.vx * dt; S.z += S.vz * dt;
  // collisions: three circles along the car body
  const rad = current ? Math.max(0.8, current.width / 2 - 0.1) : 1;
  for (const off of [-P.a * 0.85, 0, P.b * 0.85]) {
    const hit = world.collide(S.x + fx * off, S.z + fz * off, rad);
    if (!hit) continue;
    S.x += hit.nx * hit.pen; S.z += hit.nz * hit.pen;
    const vn = S.vx * hit.nx + S.vz * hit.nz;
    if (vn < 0) {
      S.vx -= 1.35 * vn * hit.nx; S.vz -= 1.35 * vn * hit.nz;   // bounce (35 % restitution)
      S.vx *= 0.9; S.vz *= 0.9;
      S.w += (off * (fx * hit.nz - fz * hit.nx)) * vn * 0.08;     // spin from off-centre hits
      if (-vn > 4) S.crash = Math.min(1, -vn / 25);
    }
  }
  S.wheelRot += (vF / P.wheelR) * dt;
  S.vF = vF;
}

// ───────────────────────── audio: per-engine synthesized sound ─────────────────────────
// Each engine type has its own firing order / harmonics / induction:
//  cyl      → firing frequency = rpm/60 · cyl/2
//  uneven   → strength of half-orders (cross-plane V8 burble, boxer rasp)
//  harm     → harmonic recipe of one combustion pulse (timbre)
//  drive    → exhaust distortion  · lp/lpK → muffler brightness (base Hz + Hz per rpm)
//  turbo / whine / crackle / vol
const ENGINES = {
  i4:    { label: 'I4',             cyl: 4,  uneven: 0.10, harm: [1, 0.55, 0.35, 0.2, 0.12, 0.08],            drive: 1.6, lp: 380, lpK: 0.20, turbo: 0,   whine: 0,   crackle: 0.15, vol: 0.85 },
  v8x:   { label: 'V8',             cyl: 8,  uneven: 0.60, harm: [1, 0.8, 0.5, 0.45, 0.25, 0.2, 0.1],          drive: 3.2, lp: 260, lpK: 0.13, turbo: 0,   whine: 0,   crackle: 0.6,  vol: 1.1 },
  v8big: { label: 'V8 big-block',   cyl: 8,  uneven: 0.75, harm: [1, 0.9, 0.6, 0.4, 0.2, 0.12],                drive: 3.8, lp: 220, lpK: 0.11, turbo: 0,   whine: 0,   crackle: 0.7,  vol: 1.2 },
  v8sc:  { label: 'V8 supercharged',cyl: 8,  uneven: 0.50, harm: [1, 0.8, 0.55, 0.45, 0.3, 0.2, 0.12],         drive: 3.0, lp: 300, lpK: 0.16, turbo: 0,   whine: 1.0, crackle: 0.8,  vol: 1.1 },
  v8f:   { label: 'V8 flat-plane',  cyl: 8,  uneven: 0.06, harm: [1, 0.35, 0.6, 0.25, 0.4, 0.15, 0.2, 0.1],    drive: 2.4, lp: 520, lpK: 0.32, turbo: 0,   whine: 0,   crackle: 0.45, vol: 1.0 },
  v8tt:  { label: 'V8 twin-turbo',  cyl: 8,  uneven: 0.30, harm: [1, 0.6, 0.4, 0.25, 0.15, 0.08],              drive: 2.2, lp: 300, lpK: 0.12, turbo: 0.7, whine: 0,   crackle: 0.5,  vol: 0.95 },
  v8race:{ label: 'V8 race',        cyl: 8,  uneven: 0.20, harm: [1, 0.5, 0.6, 0.35, 0.45, 0.2, 0.25, 0.12],   drive: 4.0, lp: 600, lpK: 0.35, turbo: 0,   whine: 0.3, crackle: 1.0,  vol: 1.25 },
  f6:    { label: 'Flat-6',         cyl: 6,  uneven: 0.35, harm: [1, 0.45, 0.55, 0.3, 0.35, 0.15, 0.15],       drive: 2.2, lp: 480, lpK: 0.30, turbo: 0,   whine: 0,   crackle: 0.4,  vol: 1.0 },
  f6t:   { label: 'Flat-6 turbo',   cyl: 6,  uneven: 0.40, harm: [1, 0.6, 0.45, 0.3, 0.2, 0.1],                drive: 2.0, lp: 330, lpK: 0.14, turbo: 1.0, whine: 0,   crackle: 0.3,  vol: 0.95 },
  i6t:   { label: 'I6 turbo',       cyl: 6,  uneven: 0.03, harm: [1, 0.4, 0.3, 0.25, 0.18, 0.12, 0.08],        drive: 1.8, lp: 420, lpK: 0.22, turbo: 0.9, whine: 0,   crackle: 0.35, vol: 0.95 },
  v6tt:  { label: 'V6 twin-turbo',  cyl: 6,  uneven: 0.25, harm: [1, 0.55, 0.45, 0.3, 0.25, 0.12],             drive: 2.6, lp: 380, lpK: 0.20, turbo: 1.0, whine: 0,   crackle: 0.6,  vol: 1.0 },
  v10:   { label: 'V10',            cyl: 10, uneven: 0.15, harm: [1, 0.4, 0.55, 0.3, 0.35, 0.2, 0.2, 0.1],     drive: 2.6, lp: 560, lpK: 0.34, turbo: 0,   whine: 0,   crackle: 0.5,  vol: 1.05 },
  v12:   { label: 'V12',            cyl: 12, uneven: 0.02, harm: [1, 0.3, 0.45, 0.2, 0.3, 0.15, 0.2, 0.1, 0.1],drive: 2.0, lp: 600, lpK: 0.30, turbo: 0,   whine: 0,   crackle: 0.35, vol: 1.0 },
  v12lux:{ label: 'V12 twin-turbo (silent)', cyl: 12, uneven: 0.0, harm: [1, 0.2, 0.15, 0.08],                drive: 1.1, lp: 180, lpK: 0.05, turbo: 0.25,whine: 0,   crackle: 0,    vol: 0.5 },
};
let actx = null, eng = null, hornNode = null, soundOn = false, curEngine = ENGINES.v8f;
function makeNoise(ctx, sec = 2) {
  const buf = ctx.createBuffer(1, ctx.sampleRate * sec, ctx.sampleRate);
  const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}
function shaperCurve(k) {
  const c = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; c[i] = Math.tanh(k * x) / Math.tanh(k); }
  return c;
}
function initAudio() {
  if (actx) return;
  actx = new (window.AudioContext || window.webkitAudioContext)();
  const A = actx;
  const master = A.createGain(); master.gain.value = 0;
  const comp = A.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
  master.connect(comp).connect(A.destination);

  // engine core: firing-order oscillator + half-order (burble) + crank order → distortion → muffler
  const mix = A.createGain();
  const fire = A.createOscillator(); const fireG = A.createGain(); fire.connect(fireG).connect(mix);
  const half = A.createOscillator(); half.type = 'sawtooth'; const halfG = A.createGain(); half.connect(halfG).connect(mix);
  const crank = A.createOscillator(); crank.type = 'triangle'; const crankG = A.createGain(); crank.connect(crankG).connect(mix);
  // roughness: noise amplitude-modulating the mix (combustion variance)
  const rough = A.createBufferSource(); rough.buffer = makeNoise(A); rough.loop = true;
  const roughLP = A.createBiquadFilter(); roughLP.type = 'lowpass'; roughLP.frequency.value = 60;
  const roughG = A.createGain(); roughG.gain.value = 0.25;
  const amp = A.createGain(); amp.gain.value = 1;
  rough.connect(roughLP).connect(roughG).connect(amp.gain);
  const shaper = A.createWaveShaper(); shaper.oversample = '2x';
  const muffler = A.createBiquadFilter(); muffler.type = 'lowpass'; muffler.Q.value = 1.2;
  const body = A.createBiquadFilter(); body.type = 'peaking'; body.frequency.value = 120; body.gain.value = 6; body.Q.value = 0.8;
  const engG = A.createGain();
  mix.connect(amp).connect(shaper).connect(muffler).connect(body).connect(engG).connect(master);

  // intake / induction noise (louder on throttle)
  const intake = A.createBufferSource(); intake.buffer = makeNoise(A); intake.loop = true;
  const intakeBP = A.createBiquadFilter(); intakeBP.type = 'bandpass'; intakeBP.Q.value = 1.5;
  const intakeG = A.createGain(); intakeG.gain.value = 0;
  intake.connect(intakeBP).connect(intakeG).connect(master);

  // turbo whistle + blow-off valve
  const turbo = A.createOscillator(); turbo.type = 'sine'; const turboG = A.createGain(); turboG.gain.value = 0;
  turbo.connect(turboG).connect(master);
  const bov = A.createBufferSource(); bov.buffer = makeNoise(A); bov.loop = true;
  const bovHP = A.createBiquadFilter(); bovHP.type = 'bandpass'; bovHP.frequency.value = 2500; bovHP.Q.value = 0.7;
  const bovG = A.createGain(); bovG.gain.value = 0; bov.connect(bovHP).connect(bovG).connect(master);

  // supercharger whine (gear-driven → pitch locked to rpm)
  const whine = A.createOscillator(); whine.type = 'triangle'; const whineG = A.createGain(); whineG.gain.value = 0;
  whine.connect(whineG).connect(master);

  // overrun crackle / pops
  const pop = A.createBufferSource(); pop.buffer = makeNoise(A); pop.loop = true;
  const popBP = A.createBiquadFilter(); popBP.type = 'bandpass'; popBP.frequency.value = 900; popBP.Q.value = 0.9;
  const popG = A.createGain(); popG.gain.value = 0; pop.connect(popBP).connect(popG).connect(master);

  // tyre screech
  const scr = A.createBufferSource(); scr.buffer = makeNoise(A); scr.loop = true;
  const bp = A.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 6;
  const sg = A.createGain(); sg.gain.value = 0;
  scr.connect(bp).connect(sg).connect(master);

  [fire, half, crank, rough, intake, turbo, bov, whine, pop, scr].forEach((n) => n.start());
  eng = { master, fire, fireG, half, halfG, crank, crankG, roughG, shaper, muffler, body, engG, intakeBP, intakeG, turbo, turboG, bovG, whine, whineG, popG, popBP, sg, boost: 0, lastThr: 0, popT: 0 };
  applyEngine(curEngine);
  soundOn = true; updateSoundBtn();
}
function applyEngine(e) {
  curEngine = e;
  if (!eng) return;
  const n = e.harm.length + 1, re = new Float32Array(n), im = new Float32Array(n);
  e.harm.forEach((h, i) => (im[i + 1] = h));
  eng.fire.setPeriodicWave(actx.createPeriodicWave(re, im));
  eng.shaper.curve = shaperCurve(e.drive);
  eng.halfG.gain.value = e.uneven * 0.9;
  eng.crankG.gain.value = e.uneven * 0.5 + 0.05;
  eng.roughG.gain.value = 0.12 + e.uneven * 0.5;
  eng.body.frequency.value = 60 + e.cyl * 12;
}
function updateAudio(dt) {
  if (!eng) return;
  const t = actx.currentTime, e = curEngine;
  const rpm = S.rpm, rn = Math.min(1, rpm / P.redline);
  const thr = S.shifting ? 0.15 : (S.thr || 0);
  const ff = rpm / 60 * e.cyl / 2;               // firing frequency
  eng.fire.frequency.setTargetAtTime(ff, t, 0.02);
  eng.half.frequency.setTargetAtTime(ff / 2, t, 0.02);   // half-order: uneven firing
  eng.crank.frequency.setTargetAtTime(rpm / 60, t, 0.02); // crank order
  eng.fireG.gain.setTargetAtTime(0.55 + 0.45 * thr, t, 0.04);
  eng.muffler.frequency.setTargetAtTime(e.lp + rpm * e.lpK * (0.55 + 0.45 * thr) + ff * 1.5, t, 0.05);
  eng.engG.gain.setTargetAtTime(e.vol * (0.45 + 0.55 * thr) * (0.7 + 0.3 * rn), t, 0.05);
  eng.intakeBP.frequency.setTargetAtTime(ff * 3 + 400, t, 0.05);
  eng.intakeG.gain.setTargetAtTime(0.05 * thr * rn * (e.turbo ? 0.4 : 1), t, 0.05);
  // turbo: boost spools with rpm under load; whistle pitch follows boost
  if (e.turbo) {
    const target = thr > 0.5 ? Math.min(1, Math.max(0, (rn - 0.25) / 0.5)) : 0;
    eng.boost += (target - eng.boost) * Math.min(1, dt * (target > eng.boost ? 1.8 : 6));
    eng.turbo.frequency.setTargetAtTime(1800 + eng.boost * 4200, t, 0.05);
    eng.turboG.gain.setTargetAtTime(0.035 * e.turbo * eng.boost, t, 0.05);
    if (eng.lastThr > 0.5 && thr < 0.5 && eng.boost > 0.4) { // lift-off: pssssh
      eng.bovG.gain.cancelScheduledValues(t); eng.bovG.gain.setValueAtTime(0.18 * e.turbo * eng.boost, t);
      eng.bovG.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    }
  } else eng.turboG.gain.setTargetAtTime(0, t, 0.05);
  eng.whine.frequency.setTargetAtTime(rpm / 60 * 18, t, 0.03);
  eng.whineG.gain.setTargetAtTime(0.03 * e.whine * rn * (0.3 + 0.7 * thr), t, 0.05);
  // overrun crackle: off-throttle at high rpm → random pops
  eng.popT -= dt;
  if (e.crackle && thr < 0.1 && rn > 0.45 && eng.popT <= 0 && Math.random() < e.crackle * rn * 0.5) {
    eng.popT = 0.03 + Math.random() * 0.12;
    eng.popBP.frequency.setValueAtTime(500 + Math.random() * 900, t);
    eng.popG.gain.cancelScheduledValues(t); eng.popG.gain.setValueAtTime(0.5 * e.crackle, t);
    eng.popG.gain.exponentialRampToValueAtTime(0.0001, t + 0.05 + Math.random() * 0.05);
  }
  eng.lastThr = thr;
  eng.master.gain.setTargetAtTime(soundOn ? 0.3 : 0, t, 0.05);
  const screech = Math.min(1, Math.max(0, Math.max(S.slipR, S.slipF) - 1.1)) * Math.min(1, Math.hypot(S.vx, S.vz) / 5);
  eng.sg.gain.setTargetAtTime(screech * 0.4, t, 0.05);
}
function horn(on) {
  if (!actx) return;
  if (on && !hornNode) {
    const g = actx.createGain(); g.gain.value = 0.15; g.connect(actx.destination);
    const a = actx.createOscillator(), b = actx.createOscillator();
    a.type = b.type = 'square'; a.frequency.value = 415; b.frequency.value = 523;
    a.connect(g); b.connect(g); a.start(); b.start();
    hornNode = { g, a, b };
  } else if (!on && hornNode) { hornNode.a.stop(); hornNode.b.stop(); hornNode.g.disconnect(); hornNode = null; }
}
const btnSound = document.getElementById('btn-sound');
function updateSoundBtn() { btnSound.textContent = soundOn ? '🔊 الصوت' : '🔇 الصوت'; }
btnSound.onclick = () => { if (!actx) initAudio(); else { soundOn = !soundOn; updateSoundBtn(); } };

// ───────────────────────── cameras ─────────────────────────
const CAMS = ['chase', 'far', 'cockpit', 'side'];
let camMode = 0;
function cycleCam() { camMode = (camMode + 1) % CAMS.length; }
document.getElementById('btn-cam').onclick = cycleCam;
const camPos = new THREE.Vector3(0, 3, 8), camLook = new THREE.Vector3();

function updateCamera(dt) {
  const f = new THREE.Vector3(-Math.sin(S.yaw), 0, -Math.cos(S.yaw));
  const r = new THREE.Vector3(Math.cos(S.yaw), 0, -Math.sin(S.yaw));
  const p = car.position;
  const speed = Math.hypot(S.vx, S.vz);
  const mode = CAMS[camMode];
  const cl = current ? current.length : 4.6, ch = current ? current.height : 1.2;
  let want, look, k = 1 - Math.exp(-dt * 6);
  if (mode === 'chase') {
    // follow the velocity direction a bit so drifts look cool
    want = p.clone().addScaledVector(f, -(1.3 * cl + 0.6) - speed * 0.02).add(new THREE.Vector3(0, 0.6 + ch * 1.1, 0));
    look = p.clone().addScaledVector(f, 3).add(new THREE.Vector3(0, 0.8, 0));
  } else if (mode === 'far') {
    want = p.clone().addScaledVector(f, -(2.8 * cl + 1)).add(new THREE.Vector3(0, 2 + ch * 3, 0));
    look = p.clone().addScaledVector(f, 4);
  } else if (mode === 'cockpit') {
    want = CARS[carIdx].id === 'ferrari'
      ? p.clone().addScaledVector(f, 0.05).addScaledVector(r, -0.35).add(new THREE.Vector3(0, 1.08, 0))
      : p.clone().addScaledVector(f, 0.1 * cl).add(new THREE.Vector3(0, ch + 0.15, 0));
    look = want.clone().addScaledVector(f, 10).add(new THREE.Vector3(0, -0.3, 0));
    k = 1;
  } else {
    want = p.clone().addScaledVector(r, 1.3 * cl).addScaledVector(f, 1.5).add(new THREE.Vector3(0, 1.2, 0));
    look = p.clone().add(new THREE.Vector3(0, 0.6, 0));
    k = 1 - Math.exp(-dt * 10);
  }
  if (mode !== 'cockpit') { const gh = world.heightAt(want.x, want.z) + 0.6; if (want.y < gh) want.y = gh; }
  camPos.lerp(want, k); camLook.lerp(look, mode === 'cockpit' ? 1 : 1 - Math.exp(-dt * 12));
  if (mode !== 'cockpit') camPos.y = Math.max(camPos.y, world.heightAt(camPos.x, camPos.z) + 0.5);
  camera.position.copy(camPos); camera.lookAt(camLook);
  const fovT = 60 + Math.min(speed, 90) * 0.18;
  camera.fov += (fovT - camera.fov) * k; camera.updateProjectionMatrix();
}

// ───────────────────────── visuals sync ─────────────────────────
const elSpeed = document.getElementById('speed'), elGear = document.getElementById('gear'), elRpm = document.querySelector('#rpmbar span');
const _e = new THREE.Euler(), _qa = new THREE.Quaternion(), steerAxis = new THREE.Vector3(0, 1, 0).applyAxisAngle(new THREE.Vector3(1, 0, 0), 0.35).normalize();
let pitch = 0, roll = 0, skidTimer = 0;

let groundY = 0;
function terrainPose() {
  // sample terrain under the 4 wheels → height, pitch, roll
  const s = Math.sin(S.yaw), c = Math.cos(S.yaw), a = P.a, b = P.b, tw = current ? current.width * 0.4 : 0.8;
  const at = (lx, lz) => world.heightAt(S.x + lx * c + lz * s, S.z - lx * s + lz * c);
  const fl = at(-tw, -a), fr = at(tw, -a), rl = at(-tw, b), rr = at(tw, b);
  const hF = (fl + fr) / 2, hR = (rl + rr) / 2, hL = (fl + rl) / 2, hRt = (fr + rr) / 2;
  S.slopeP = Math.atan2(hF - hR, a + b);
  S.slopeR = Math.atan2(hRt - hL, 2 * tw);
  return (hF * b + hR * a) / (a + b);
}
function syncVisuals(dt) {
  const gy = terrainPose();
  groundY += (gy - groundY) * Math.min(1, dt * 25);
  car.position.set(S.x, groundY, S.z);
  car.rotation.set(S.slopeP || 0, S.yaw, S.slopeR || 0, 'YXZ');
  S.surf = world.surfaceAt(S.x, S.z);
  if (S.surf.name === 'water' && S.surf.depth > 1.1) { toast('🌊 الطوموبيل دخلات للما — رجعناك للطريق'); resetCar(); }
  if (S.crash) { toast('💥'); S.crash = 0; }
  if (!body) return;
  // suspension: pitch under accel/brake, roll in corners
  pitch += (THREE.MathUtils.clamp(S.ax * 0.006, -0.05, 0.05) - pitch) * Math.min(1, dt * 6);
  roll += (THREE.MathUtils.clamp(S.ay * 0.005, -0.05, 0.05) - roll) * Math.min(1, dt * 6);
  body.rotation.set(pitch, 0, roll); // model root (includes wheels, small angles — fine)
  body.position.y = -Math.abs(pitch) * 0.3;
  for (const k in wheels) {
    const w = wheels[k];
    _qa.setFromAxisAngle(new THREE.Vector3(1, 0, 0), current.spinSign * S.wheelRot);
    w.spin.quaternion.copy(w.base).multiply(_qa); // spin about the wheel's own axle
    w.pivot.rotation.y = k[0] === 'f' ? S.steer : 0;
  }
  // steering wheel (≈ 14:1 rack → ~ 500° lock to lock)
  _qa.setFromAxisAngle(steerAxis, S.steer * 7);
  if (steeringWheel) steeringWheel.quaternion.copy(steerQ0).multiply(_qa);

  // skid marks at rear (and front when locking)
  skidTimer += dt;
  if (skidTimer > 0.016) {
    skidTimer = 0;
    const s = Math.sin(S.yaw), c = Math.cos(S.yaw);
    const place = (lx, lz) => addSkid(S.x + lx * c + lz * s, S.z - lx * s + lz * c, S.yaw);
    if (S.slipR > 1.2 && Math.hypot(S.vx, S.vz) > 2) { place(wheels.rl.pos.x, wheels.rl.pos.z); place(wheels.rr.pos.x, wheels.rr.pos.z); }
    if (S.slipF > 1.3 && Math.hypot(S.vx, S.vz) > 2) { place(wheels.fl.pos.x, wheels.fl.pos.z); place(wheels.fr.pos.x, wheels.fr.pos.z); }
  }

  elSpeed.textContent = Math.round(Math.abs(S.vF || 0) * 3.6);
  elGear.textContent = S.gear < 0 ? 'R' : (Math.abs(S.vF || 0) < 0.3 && !keys.fwd ? 'N' : S.gear);
  elRpm.style.width = (S.rpm / P.redline * 100).toFixed(1) + '%';
}

// ───────────────────────── loop ─────────────────────────
const clock = new THREE.Clock();
let acc = 0; const STEP = 1 / 240;
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (body) { acc += dt; while (acc >= STEP) { physics(STEP); acc -= STEP; } }
  syncVisuals(dt);
  updateCamera(dt);
  updateAudio(dt);
  // shadow camera follows the car; sky dome follows the camera
  sun.position.set(S.x + 20, groundY + 35, S.z + 12); sun.target.position.set(S.x, groundY, S.z);
  skyDome.position.copy(camera.position);
  world.update(clock.elapsedTime);
  drawMinimap();
  renderer.render(scene, camera);
});

// ───────────────────────── minimap ─────────────────────────
const mmCanvas = document.getElementById('minimap'), mmCtx = mmCanvas.getContext('2d');
const elSurf = document.getElementById('surface');
const SURF_AR = { asphalt: '🛣️ زفت', grass: '🌿 عشب', sand: '🏖️ رملة', snow: '❄️ ثلج', water: '🌊 ما' };
let lastSurf = '';
function drawMinimap() {
  const W = mmCanvas.width, R = W / 2, scale = 2.6; // px per minimap texel
  const mpp = world.size / world.minimap.width;       // metres per texel
  const cx = (S.x + world.size / 2) / mpp, cz = (S.z + world.size / 2) / mpp;
  mmCtx.save(); mmCtx.clearRect(0, 0, W, W);
  mmCtx.beginPath(); mmCtx.arc(R, R, R - 2, 0, 7); mmCtx.clip();
  mmCtx.translate(R, R); mmCtx.rotate(S.yaw); mmCtx.scale(scale, scale); mmCtx.translate(-cx, -cz); // heading-up
  mmCtx.drawImage(world.minimap, 0, 0);
  mmCtx.restore();
  mmCtx.fillStyle = '#ffcc33'; mmCtx.strokeStyle = '#000'; mmCtx.lineWidth = 2;
  mmCtx.beginPath(); mmCtx.moveTo(R, R - 9); mmCtx.lineTo(R + 6, R + 7); mmCtx.lineTo(R, R + 3); mmCtx.lineTo(R - 6, R + 7); mmCtx.closePath(); mmCtx.stroke(); mmCtx.fill();
  // north marker
  const na = S.yaw; mmCtx.fillStyle = '#fff'; mmCtx.font = 'bold 13px system-ui'; mmCtx.textAlign = 'center';
  mmCtx.fillText('N', R + (R - 12) * Math.sin(na), R - (R - 12) * Math.cos(na) + 4);
  mmCtx.strokeStyle = 'rgba(255,255,255,.5)'; mmCtx.lineWidth = 3; mmCtx.beginPath(); mmCtx.arc(R, R, R - 2, 0, 7); mmCtx.stroke();
  const sn = S.surf ? S.surf.name : ''; if (sn !== lastSurf) { lastSurf = sn; elSurf.textContent = SURF_AR[sn] || ''; }
}

selectCar(carIdx);
addEventListener('error', (e) => toast('⚠️ ' + e.message));

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
