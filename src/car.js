// 🏎️ Ferrari 458 driving sim — model: three.js examples (github.com/mrdoob/three.js)
// Physics: bicycle model with tyre slip, friction circle, weight transfer,
// 6-speed automatic gearbox, aero drag, handbrake drift.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

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
scene.fog = new THREE.Fog(SKY, 80, 600);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 2000);

scene.add(new THREE.HemisphereLight(0xffffff, 0x556070, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -15, right: 15, top: 15, bottom: -15, near: 1, far: 80 });
sun.shadow.bias = -0.0005;
scene.add(sun, sun.target);

// ───────────────────────── empty world: endless grid ground ─────────────────────────
function gridTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#6d747c'; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 4000; i++) { // asphalt noise
    const v = 90 + Math.random() * 40 | 0;
    g.fillStyle = `rgba(${v},${v},${v + 5},.35)`;
    g.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
  }
  g.strokeStyle = 'rgba(255,255,255,.25)'; g.lineWidth = 2;
  for (let i = 0; i <= 512; i += 64) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 512); g.moveTo(0, i); g.lineTo(512, i); g.stroke(); }
  g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 4; g.strokeRect(0, 0, 512, 512);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(250, 250); // each tile = 16 m, lines every 2 m
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000),
  new THREE.MeshStandardMaterial({ map: gridTexture(), roughness: 0.95 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// ───────────────────────── skid marks ─────────────────────────
const SKID_MAX = 6000;
const skids = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.24, 0.35).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }), SKID_MAX);
skids.count = 0; skids.frustumCulled = false; skids.renderOrder = 1;
scene.add(skids);
let skidIdx = 0; const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0);
function addSkid(x, z, yaw) {
  _q.setFromAxisAngle(_up, yaw);
  _m.compose(new THREE.Vector3(x, 0.012, z), _q, new THREE.Vector3(1, 1, 1));
  skids.setMatrixAt(skidIdx, _m);
  skidIdx = (skidIdx + 1) % SKID_MAX;
  skids.count = Math.min(skids.count + 1, SKID_MAX);
  skids.instanceMatrix.needsUpdate = true;
}

// ───────────────────────── garage: 21 cars, weakest → strongest ─────────────────────────
// Kenney Car Kit (CC0, github.com/Arslan12216775/kenney_car-kit) + Ferrari 458 (three.js examples)
// torque Nm · redline rpm · top km/h · mass kg · mu grip · drag · gears · cg height · downforce
const CARS = [
  { id: 'tractor-shovel',   name: 'جرّافة · Shovel',        torque: 300,  redline: 2400,  top: 30,  mass: 5200, mu: 0.9,  drag: 1.2,  gears: 3, cg: 1.0, steer: 0.55 },
  { id: 'tractor',          name: 'تراكتور · Tractor',      torque: 330,  redline: 2500,  top: 42,  mass: 3500, mu: 0.9,  drag: 1.0,  gears: 4, cg: 0.9 },
  { id: 'garbage-truck',    name: 'كاميو الزبل · Garbage',  torque: 950,  redline: 2600,  top: 85,  mass: 12000, mu: 0.85, drag: 1.4, gears: 6, cg: 1.1, steer: 0.55 },
  { id: 'truck-flat',       name: 'بلاطو · Flatbed',        torque: 800,  redline: 2800,  top: 100, mass: 6500, mu: 0.9,  drag: 1.1,  gears: 6, cg: 0.9, steer: 0.55 },
  { id: 'truck',            name: 'كاميو · Truck',          torque: 900,  redline: 2800,  top: 105, mass: 7800, mu: 0.9,  drag: 1.2,  gears: 6, cg: 1.0, steer: 0.55 },
  { id: 'firetruck',        name: 'لپومپيي · Firetruck',    torque: 1150, redline: 2800,  top: 115, mass: 11000, mu: 0.9, drag: 1.3,  gears: 6, cg: 1.0, steer: 0.55 },
  { id: 'delivery',         name: 'ديليفري · Delivery',     torque: 400,  redline: 4200,  top: 125, mass: 3200, mu: 0.95, drag: 0.8,  gears: 5, cg: 0.8 },
  { id: 'van',              name: 'فاركونيط · Van',         torque: 360,  redline: 5000,  top: 145, mass: 2400, mu: 1.0,  drag: 0.7,  gears: 5, cg: 0.75 },
  { id: 'ambulance',        name: 'لانبيلانس · Ambulance',  torque: 470,  redline: 4800,  top: 155, mass: 3000, mu: 1.0,  drag: 0.75, gears: 5, cg: 0.8 },
  { id: 'taxi',             name: 'طاكسي · Taxi',           torque: 260,  redline: 6000,  top: 175, mass: 1400, mu: 1.0,  drag: 0.45, gears: 5, cg: 0.55 },
  { id: 'kart-oobi',        name: 'كارتينغ · Kart',         torque: 32,   redline: 9000,  top: 95,  mass: 170,  mu: 1.15, drag: 0.12, gears: 1, cg: 0.25, scale: 1.6, steer: 0.5 },
  { id: 'sedan',            name: 'سيدان · Sedan',          torque: 320,  redline: 6200,  top: 195, mass: 1450, mu: 1.0,  drag: 0.42, gears: 5, cg: 0.55 },
  { id: 'suv',              name: 'SUV · 4x4',              torque: 420,  redline: 5800,  top: 205, mass: 2100, mu: 0.95, drag: 0.5,  gears: 6, cg: 0.75 },
  { id: 'kart-oozi',        name: 'كارتينغ سبور · Kart S',  torque: 48,   redline: 11000, top: 125, mass: 175,  mu: 1.2,  drag: 0.12, gears: 1, cg: 0.25, scale: 1.6, steer: 0.5 },
  { id: 'police',           name: 'البوليس · Police',       torque: 470,  redline: 6500,  top: 240, mass: 1700, mu: 1.05, drag: 0.38, gears: 6, cg: 0.55 },
  { id: 'suv-luxury',       name: 'SUV لوكس · Luxury',      torque: 680,  redline: 6500,  top: 255, mass: 2300, mu: 1.0,  drag: 0.42, gears: 8, cg: 0.7 },
  { id: 'hatchback-sports', name: 'هاتشباك · Hot Hatch',    torque: 420,  redline: 7500,  top: 255, mass: 1300, mu: 1.1,  drag: 0.36, gears: 6, cg: 0.5 },
  { id: 'sedan-sports',     name: 'سيدان سبور · Sport',     torque: 620,  redline: 7500,  top: 290, mass: 1600, mu: 1.12, drag: 0.34, gears: 7, cg: 0.5 },
  { id: 'ferrari',          name: 'فيراري 458 · Ferrari',   torque: 540,  redline: 8500,  top: 325, mass: 1480, mu: 1.15, drag: 0.30, gears: 6, cg: 0.45, df: 0.25 },
  { id: 'race',             name: 'فورمولا · Formula',      torque: 720,  redline: 11000, top: 345, mass: 800,  mu: 1.4,  drag: 0.50, gears: 7, cg: 0.3,  df: 1.6 },
  { id: 'race-future',      name: 'المستقبل · Future',      torque: 1150, redline: 12000, top: 420, mass: 900,  mu: 1.6,  drag: 0.42, gears: 8, cg: 0.3,  df: 2.2 },
];
for (const c of CARS) c.hp = Math.round(c.torque * c.redline * 0.85 / 7127); // approx peak hp

const car = new THREE.Group(); // physics transform (y-rot only)
scene.add(car);
let body = null, steeringWheel = null, steerQ0 = null, current = null, carIdx = 18;
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
  if (isF) prepFerrari(model);
  else { holder.rotation.y = Math.PI; holder.scale.setScalar(spec.scale || 2.1); }
  model.traverse((o) => { if (o.isMesh) o.castShadow = true; });

  const names = isF ? { fl: 'wheel_fl', fr: 'wheel_fr', rl: 'wheel_rl', rr: 'wheel_rr' }
                    : { fl: 'wheel-front-left', fr: 'wheel-front-right', rl: 'wheel-back-left', rr: 'wheel-back-right' };
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
    root, wheels: ws, a: L * 0.47, b: L * 0.53, wheelR: Math.max(0.2, ws.rl.pos.y), height: box.max.y, length: box.max.z - box.min.z,
    spinSign: isF ? -1 : 1, steeringWheel: isF ? model.getObjectByName('steering_wheel') : null,
  };
}

function specPhysics(spec, geo) {
  const n = spec.gears, spread = n === 1 ? 1 : (spec.mass > 3000 ? 5 : 3.4);
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
  const url = spec.id === 'ferrari' ? './assets/ferrari.glb' : `./assets/cars/${spec.id}.glb`;
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
    Object.assign(S, { vx: 0, vz: 0, w: 0, steer: 0, gear: 1, ax: 0, ay: 0 });
    toast(`${carIdx + 1}/${CARS.length} · ${spec.name} · ${spec.hp} hp · ${spec.top} km/h`);
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
      <span class="nm">${c.name}</span>
      <span class="st">${c.hp} hp · ${c.top} km/h · ${c.mass} kg</span>
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
function resetCar() { Object.assign(S, { vx: 0, vz: 0, w: 0, steer: 0, gear: 1, yaw: S.yaw }); }

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
  const muR = keys.hand ? P.mu * 0.45 : P.mu * 1.1; // wider rear tyres → stable understeer balance
  let FyF = tyre(alphaF, Nf, P.mu, 0.15); // front: slight drop past peak → understeer
  let FyR = tyre(alphaR, Nr, muR, keys.hand ? 0.3 : 0); // rear: holds (stable) unless handbrake
  // friction circle at rear: wheelspin/braking reduces side grip → power oversteer
  const maxR = muR * Nr;
  if (P.tc && FxR > 0) { // traction control: keep drive force inside what the tyre has left
    const avail = Math.sqrt(Math.max(0, maxR * maxR - FyR * FyR));
    FxR = Math.min(FxR, Math.max(avail * 0.9, maxR * 0.25));
  }
  FxR = THREE.MathUtils.clamp(FxR, -maxR, maxR);
  FyR *= Math.sqrt(Math.max(0, 1 - (FxR / maxR) ** 2)) || 0;
  const maxF = P.mu * Nf; FxF = THREE.MathUtils.clamp(FxF, -maxF, maxF);
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
  S.wheelRot += (vF / P.wheelR) * dt;
  S.vF = vF;
}

// ───────────────────────── audio (synth engine) ─────────────────────────
let actx = null, eng = null, hornNode = null, soundOn = false;
function initAudio() {
  if (actx) return;
  actx = new (window.AudioContext || window.webkitAudioContext)();
  const master = actx.createGain(); master.gain.value = 0; master.connect(actx.destination);
  const lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 3; lp.connect(master);
  const o1 = actx.createOscillator(); o1.type = 'sawtooth';
  const o2 = actx.createOscillator(); o2.type = 'square';
  const g2 = actx.createGain(); g2.gain.value = 0.35;
  o1.connect(lp); o2.connect(g2).connect(lp);
  o1.start(); o2.start();
  // tyre screech: filtered noise
  const buf = actx.createBuffer(1, actx.sampleRate, actx.sampleRate);
  const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const n = actx.createBufferSource(); n.buffer = buf; n.loop = true;
  const bp = actx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 6;
  const sg = actx.createGain(); sg.gain.value = 0;
  n.connect(bp).connect(sg).connect(master); n.start();
  eng = { master, lp, o1, o2, sg };
  soundOn = true; updateSoundBtn();
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
function updateAudio() {
  if (!eng) return;
  const t = actx.currentTime;
  const f = 28 + S.rpm / 60 * 2 * 0.5; // V8: 4 firing pulses per rev
  eng.o1.frequency.setTargetAtTime(f, t, 0.03);
  eng.o2.frequency.setTargetAtTime(f * 0.5, t, 0.03);
  eng.lp.frequency.setTargetAtTime(500 + S.rpm * 0.25 + (keys.fwd || keys.back ? 600 : 0), t, 0.05);
  eng.master.gain.setTargetAtTime(soundOn ? 0.22 : 0, t, 0.05);
  const screech = Math.min(1, Math.max(0, Math.max(S.slipR, S.slipF) - 1.1)) * Math.min(1, Math.hypot(S.vx, S.vz) / 5);
  eng.sg.gain.setTargetAtTime(screech * 0.5, t, 0.05);
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
  camPos.lerp(want, k); camLook.lerp(look, mode === 'cockpit' ? 1 : 1 - Math.exp(-dt * 12));
  camera.position.copy(camPos); camera.lookAt(camLook);
  const fovT = 60 + Math.min(speed, 90) * 0.18;
  camera.fov += (fovT - camera.fov) * k; camera.updateProjectionMatrix();
}

// ───────────────────────── visuals sync ─────────────────────────
const elSpeed = document.getElementById('speed'), elGear = document.getElementById('gear'), elRpm = document.querySelector('#rpmbar span');
const _e = new THREE.Euler(), _qa = new THREE.Quaternion(), steerAxis = new THREE.Vector3(0, 1, 0).applyAxisAngle(new THREE.Vector3(1, 0, 0), 0.35).normalize();
let pitch = 0, roll = 0, skidTimer = 0;

function syncVisuals(dt) {
  car.position.set(S.x, 0, S.z);
  car.rotation.y = S.yaw;
  if (!body) return;
  // suspension: pitch under accel/brake, roll in corners
  pitch += (THREE.MathUtils.clamp(S.ax * 0.006, -0.05, 0.05) - pitch) * Math.min(1, dt * 6);
  roll += (THREE.MathUtils.clamp(S.ay * 0.005, -0.05, 0.05) - roll) * Math.min(1, dt * 6);
  body.rotation.set(pitch, 0, roll); // model root (includes wheels, small angles — fine)
  body.position.y = -Math.abs(pitch) * 0.3;
  for (const k in wheels) {
    const w = wheels[k];
    _qa.setFromAxisAngle(new THREE.Vector3(1, 0, 0), current.spinSign * S.wheelRot);
    w.spin.quaternion.copy(_qa).multiply(w.base);
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
  updateAudio();
  // shadow camera + ground follow the car (endless world)
  sun.position.set(S.x + 20, 35, S.z + 12); sun.target.position.set(S.x, 0, S.z);
  ground.position.set(Math.round(S.x / 16) * 16, 0, Math.round(S.z / 16) * 16);
  renderer.render(scene, camera);
});

selectCar(carIdx);
addEventListener('error', (e) => toast('⚠️ ' + e.message));

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
