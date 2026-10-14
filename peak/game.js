// Peak Climb — a procedural 3D mountain-climbing game (Three.js, no build step).
// Core loop: grab the rock with your left/right hand (mouse buttons), pull yourself
// up on tethers, manage stamina, rest on ledges, light campfires, reach the summit.
import * as THREE from '../vendor/three.module.js';

/* ============================== config ============================== */
const MR = 175;            // mountain base radius (m)
const PEAK = 120;          // approximate summit height (m)
const TERR = 6.5;          // cliff / ledge step height (m)
const WORLD = 235;         // playable radius (m)
const ARM = 2.0;           // arm reach (m)
const SHOULDER = 1.35;     // shoulder height above feet (m)
const EYE = 1.6;           // eye height above feet (m)
const G = 16;              // fall gravity
const G_HANG = 4;          // gravity while holding a grip
const FIRE_HEIGHTS = [20, 42, 64, 86];

const params = new URLSearchParams(location.search);
const SEED = params.has('seed')
  ? (parseInt(params.get('seed'), 10) >>> 0)
  : ((Math.random() * 1e9) | 0);

/* ============================== noise & terrain ============================== */
function hash2(x, y, s) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(s, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s);
  const c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, s) {
  let sum = 0, amp = 0.5, f = 1;
  for (let i = 0; i < 5; i++) {
    sum += amp * vnoise(x * f, y * f, s + i * 17);
    f *= 2.03; amp *= 0.5;
  }
  return sum; // roughly 0..1
}
function smooth(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Terrain height (m) at world x,z. Everything (mesh, physics, campfires) uses this. */
function terrainH(x, z) {
  const r = Math.hypot(x, z);
  const rr = Math.sqrt(r * r + 36) - 6;           // rounded summit plateau
  const t = Math.max(0, 1 - rr / MR);
  if (t <= 0) return 0;
  const hb = PEAK * Math.pow(t, 1.45);            // base dome
  const n = fbm(x * 0.011, z * 0.011, SEED);
  const rg = fbm(x * 0.035 + 7.3, z * 0.035 - 3.1, SEED + 5);
  let h = hb + (n - 0.5) * 34 * t + (rg - 0.5) * 9 * t;
  // Terraces: ledges you can rest on, separated by climbable rock walls.
  const k = smooth(14, 45, hb) * 0.8;
  if (k > 0) {
    const tf = h / TERR, fl = Math.floor(tf), f = tf - fl;
    const stepped = (fl + smooth(0.6, 0.82, f)) * TERR;
    h += (stepped - h) * k;
  }
  return Math.max(0, h);
}

function normalAt(x, z) {
  const e = 0.5;
  const gx = (terrainH(x + e, z) - terrainH(x - e, z)) / (2 * e);
  const gz = (terrainH(x, z + e) - terrainH(x, z - e)) / (2 * e);
  return new THREE.Vector3(-gx, 1, -gz).normalize();
}

/**
 * March a ray against the heightfield. Returns {p, n} for the first surface hit within maxD.
 * The heightfield is a function, so there are no overhangs — marching is exact enough.
 */
function probe(o, d, maxD) {
  const steps = 26, dt = maxD / steps;
  let prev = 0;
  for (let k = 1; k <= steps; k++) {
    const t = k * dt;
    if (o.y + d.y * t <= terrainH(o.x + d.x * t, o.z + d.z * t)) {
      let lo = prev, hi = t;
      for (let i = 0; i < 8; i++) {
        const m = (lo + hi) / 2;
        if (o.y + d.y * m <= terrainH(o.x + d.x * m, o.z + d.z * m)) hi = m; else lo = m;
      }
      const p = new THREE.Vector3(o.x + d.x * hi, o.y + d.y * hi, o.z + d.z * hi);
      return { p, n: normalAt(p.x, p.z) };
    }
    prev = t;
  }
  return null;
}

/* ============================== renderer & scene ============================== */
const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9ad6f2);
scene.fog = new THREE.Fog(0xbfe3f5, 170, 900);

const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 2000);

scene.add(new THREE.HemisphereLight(0xe6f6ff, 0x7a6a45, 1.2));
const sun = new THREE.DirectionalLight(0xfff0d0, 2.4);
sun.position.set(120, 220, 80);
scene.add(sun);

// Terrain mesh
function buildTerrain() {
  const S = 480, N = 320;
  const geo = new THREE.PlaneGeometry(S, S, N, N);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, terrainH(pos.getX(i), pos.getZ(i)));
  geo.computeVertexNormals();
  const nor = geo.attributes.normal;

  const cRock = [0.42, 0.39, 0.35], cGrass = [0.3, 0.52, 0.24], cSnow = [0.95, 0.96, 1.0];
  const cSand = [0.88, 0.82, 0.6], cDirt = [0.5, 0.42, 0.3];
  const colors = new Float32Array(pos.count * 3);
  const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), h = pos.getY(i), ny = nor.getY(i);
    let c = mix(cRock, cDirt, smooth(0.2, 0.5, hash2(Math.round(x * 0.2), Math.round(z * 0.2), 9)) * 0.5);
    c = mix(c, cGrass, smooth(0.8, 0.93, ny) * (1 - smooth(40, 70, h)));
    c = mix(c, cSnow, smooth(0.7, 0.88, ny) * smooth(88, 104, h));
    c = mix(c, cSand, 1 - smooth(1.5, 4, h));
    const j = (hash2(Math.round(x * 3), Math.round(z * 3), 99) - 0.5) * 0.06;
    colors[i * 3] = c[0] + j; colors[i * 3 + 1] = c[1] + j; colors[i * 3 + 2] = c[2] + j;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
  scene.add(mesh);
}
buildTerrain();

// Sea around the island
{
  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(5000, 5000),
    new THREE.MeshStandardMaterial({ color: 0x2d8fc4, roughness: 0.35 })
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = -0.6;
  scene.add(sea);
}

// Clouds drifting around the peak
const clouds = new THREE.Group();
{
  const cm = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, emissive: 0x222222 });
  for (let i = 0; i < 26; i++) {
    const g = new THREE.Group();
    for (let k = 0; k < 4; k++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(10 + Math.random() * 10, 10, 8), cm);
      s.position.set((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 16);
      s.scale.y = 0.55;
      g.add(s);
    }
    const a = Math.random() * Math.PI * 2, r = 220 + Math.random() * 300;
    g.position.set(Math.cos(a) * r, 150 + Math.random() * 90, Math.sin(a) * r);
    clouds.add(g);
  }
  scene.add(clouds);
}

// Campfires (checkpoints) placed at fixed heights along the mountain
const FIRES = [];
{
  const stoneM = new THREE.MeshStandardMaterial({ color: 0x7d7770, roughness: 1 });
  const logM = new THREE.MeshStandardMaterial({ color: 0x5a3a1f, roughness: 1 });
  const flameM = new THREE.MeshStandardMaterial({ color: 0xff7a1a, emissive: 0xff5000, emissiveIntensity: 1.6 });
  const innerM = new THREE.MeshStandardMaterial({ color: 0xffe066, emissive: 0xffd000, emissiveIntensity: 2 });
  const stoneG = new THREE.DodecahedronGeometry(0.3);
  const logG = new THREE.CylinderGeometry(0.1, 0.12, 1.4, 6);
  const flameG = new THREE.ConeGeometry(0.4, 1.3, 7);
  const innerG = new THREE.ConeGeometry(0.2, 0.8, 6);
  const angles = [];
  for (let i = 0; i < FIRE_HEIGHTS.length; i++) angles.push(hash2(i, 3, SEED) * Math.PI * 2);

  FIRE_HEIGHTS.forEach((h, idx) => {
    // Scan inward from the base to find the spot where the terrain first reaches height h
    const a = angles[idx];
    let fx = 0, fz = 0;
    for (let r = MR; r >= 0; r -= 0.5) {
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (terrainH(x, z) >= h) { fx = x; fz = z; break; }
    }
    const fy = terrainH(fx, fz);
    const group = new THREE.Group();
    group.position.set(fx, fy, fz);
    for (let k = 0; k < 8; k++) {
      const s = new THREE.Mesh(stoneG, stoneM);
      const t = (k / 8) * Math.PI * 2;
      s.position.set(Math.cos(t) * 0.7, 0.12, Math.sin(t) * 0.7);
      s.rotation.set(k, k * 2, 0);
      group.add(s);
    }
    const l1 = new THREE.Mesh(logG, logM); l1.rotation.set(0, 0, Math.PI / 2 - 0.25); l1.position.y = 0.2; group.add(l1);
    const l2 = new THREE.Mesh(logG, logM); l2.rotation.set(0, Math.PI / 2, Math.PI / 2 + 0.25); l2.position.y = 0.2; group.add(l2);
    const flame = new THREE.Group();
    const f1 = new THREE.Mesh(flameG, flameM); f1.position.y = 0.9; flame.add(f1);
    const f2 = new THREE.Mesh(innerG, innerM); f2.position.y = 0.75; flame.add(f2);
    group.add(flame);
    scene.add(group);
    // Respawn point: a few metres outward from the fire, on the ground
    const ux = Math.cos(a), uz = Math.sin(a);
    const sx = fx + ux * 3, sz = fz + uz * 3;
    FIRES.push({
      idx, h, x: fx, z: fz, y: fy, flame,
      spawn: new THREE.Vector3(sx, terrainH(sx, sz), sz),
    });
  });
}

// Summit flag
let SUM = new THREE.Vector3();
{
  let best = -1, bx = 0, bz = 0;
  for (let x = -20; x <= 20; x += 1) for (let z = -20; z <= 20; z += 1) {
    const h = terrainH(x, z);
    if (h > best) { best = h; bx = x; bz = z; }
  }
  SUM = new THREE.Vector3(bx, best, bz);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0xdddddd }));
  pole.position.set(bx, best + 4, bz);
  scene.add(pole);
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(3, 2),
    new THREE.MeshStandardMaterial({ color: 0xe53935, side: THREE.DoubleSide }));
  cloth.position.set(bx + 1.5, best + 7, bz);
  scene.add(cloth);
  SUM.cloth = cloth;
}

/* ============================== player ============================== */
const SH = new THREE.Vector3(0, SHOULDER, 0);
const P = {
  pos: new THREE.Vector3(), vel: new THREE.Vector3(),
  yaw: 0, pitch: 0,
  grounded: false, stamina: 100, hp: 100,
  hands: [null, null],   // [left, right] -> {a: anchor Vector3, n: normal, rope: m, steep: bool}
  time: 0, won: false, running: false, frozen: false,
  cp: null, jumpQ: false,
};

// Spawn at the base, on a random side of the mountain
const spawnAng = hash2(1, 1, SEED) * Math.PI * 2;
const BASE = new THREE.Vector3(Math.cos(spawnAng) * (MR + 12), 0, Math.sin(spawnAng) * (MR + 12));
P.cp = { pos: BASE.clone(), idx: -1 };
P.yaw = Math.atan2(BASE.x, BASE.z); // face the mountain centre (forward = (-sin yaw, -cos yaw))
function respawn() {
  P.pos.copy(P.cp.pos);
  P.vel.set(0, 0, 0);
  P.hands = [null, null];
  P.stamina = 100; P.hp = 100;
  P.grounded = true;
}
respawn();

// Hand visuals
const matSkin = new THREE.MeshStandardMaterial({ color: 0xf2c7a5, roughness: 0.7 });
const matSleeve = new THREE.MeshStandardMaterial({ color: 0xe85d2c, roughness: 0.8 });
const matGlove = new THREE.MeshStandardMaterial({ color: 0xffd23f, roughness: 0.6 });
const sphG = new THREE.SphereGeometry(0.11, 12, 8);
const armG = new THREE.CylinderGeometry(0.045, 0.04, 1, 8, 1);
const HV = [0, 1].map(() => {
  const v = {
    idle: new THREE.Mesh(sphG, matSkin),
    arm: new THREE.Mesh(armG, matSleeve),
    glove: new THREE.Mesh(sphG, matGlove),
  };
  v.glove.scale.setScalar(1.15);
  scene.add(v.idle, v.arm, v.glove);
  return v;
});

/* ============================== input ============================== */
const keys = {};
const canvas = renderer.domElement;
const isLocked = () => document.pointerLockElement === canvas;

addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (['Space', 'Tab'].includes(e.code)) e.preventDefault();
  if (e.code === 'Space' && !e.repeat && isLocked()) P.jumpQ = true;
  if (e.code === 'KeyR' && isLocked() && !P.frozen) { die(false); }
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

addEventListener('mousedown', (e) => {
  if (!isLocked()) return;
  if (e.button === 0) toggleHand(0);
  else if (e.button === 2) toggleHand(1);
});
addEventListener('mousemove', (e) => {
  if (!isLocked()) return;
  P.yaw -= e.movementX * 0.0022;
  P.pitch = Math.max(-1.4, Math.min(1.4, P.pitch - e.movementY * 0.0022));
});
addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('mousedown', () => { if (P.running && !isLocked() && !P.won) canvas.requestPointerLock(); });

/* ============================== grabbing ============================== */
function eyePos() { return new THREE.Vector3(P.pos.x, P.pos.y + EYE, P.pos.z); }
function aimDir() {
  const cp = Math.cos(P.pitch);
  return new THREE.Vector3(-Math.sin(P.yaw) * cp, Math.sin(P.pitch), -Math.cos(P.yaw) * cp);
}
function shoulderPos() { return P.pos.clone().add(SH); }

function tryGrab(i) {
  if (P.stamina < 8) return toast('Arms too tired to grab');
  const hit = probe(eyePos(), aimDir(), 2.6);
  if (!hit) return;
  const d = hit.p.distanceTo(shoulderPos());
  if (d > ARM + 0.45) return;
  P.hands[i] = { a: hit.p.clone(), n: hit.n.clone(), rope: Math.min(ARM + 0.5, d + 0.2), steep: hit.n.y < 0.6 };
}
function toggleHand(i) {
  if (P.hands[i]) P.hands[i] = null;
  else tryGrab(i);
}

/* ============================== physics ============================== */
function blocked(x, z) {
  const lim = P.grounded ? 0.55 : 0.0;  // can step up small ledges only
  return terrainH(x, z) > P.pos.y + lim;
}

function hurt(dmg, impact) {
  P.hp -= dmg;
  if (dmg > 2) toast(`Ouch! −${Math.round(dmg)} HP`);
  if (P.hp <= 0) die(true);
}

let fadeTimer = null;
function die(hurtDeath) {
  if (P.frozen) return;
  P.frozen = true;
  keys.KeyW = keys.KeyA = keys.KeyS = keys.KeyD = false;
  toast(hurtDeath ? 'Wiped out! Back to the last campfire' : 'Back to the last campfire');
  const fade = document.getElementById('fade');
  fade.classList.add('on');
  clearTimeout(fadeTimer);
  fadeTimer = setTimeout(() => {
    respawn();
    fade.classList.remove('on');
    P.frozen = false;
  }, 900);
}

function update(dt) {
  const nHold = (P.hands[0] ? 1 : 0) + (P.hands[1] ? 1 : 0);
  const sy = Math.sin(P.yaw), cy = Math.cos(P.yaw);
  const cp = Math.cos(P.pitch), sp = Math.sin(P.pitch);
  const fwdIn = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
  const sideIn = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);

  // Wish direction: when hanging, looking up and pressing W pulls you upward
  let wx, wy, wz;
  if (nHold) { wx = -sy * cp * fwdIn + cy * sideIn; wy = sp * fwdIn; wz = -cy * cp * fwdIn - sy * sideIn; }
  else { wx = -sy * fwdIn + cy * sideIn; wy = 0; wz = -cy * fwdIn - sy * sideIn; }
  const wl = Math.hypot(wx, wy, wz);
  const moving = wl > 0.1;
  if (wl > 1) { wx /= wl; wy /= wl; wz /= wl; }

  // Slope under the feet
  const px = P.pos.x, pz = P.pos.z, e = 0.5;
  const gx = (terrainH(px + e, pz) - terrainH(px - e, pz)) / (2 * e);
  const gz = (terrainH(px, pz + e) - terrainH(px, pz - e)) / (2 * e);
  const gm = Math.hypot(gx, gz);
  const ny = 1 / Math.sqrt(1 + gm * gm);
  const onSteep = P.grounded && ny < 0.62 && nHold === 0;

  // Stamina: holding costs, resting recovers
  if (nHold) {
    let drain = 0;
    for (const h of P.hands) if (h) drain += h.steep ? 4.5 : 2.2;
    if (moving) drain *= 1.5;
    if (P.grounded) drain *= 0.25;      // resting on a ledge while holding
    P.stamina -= drain * dt;
    if (P.stamina <= 0) {
      P.stamina = 0; P.hands = [null, null];
      toast('Arms gave out! Find a ledge to rest');
    }
  } else {
    P.stamina = Math.min(100, P.stamina + (P.grounded ? 18 : 6) * dt);
  }

  // Jump (ground) or lunge (release grips and launch toward the aim direction)
  if (P.jumpQ) {
    P.jumpQ = false;
    if (nHold) {
      if (P.stamina >= 20) {
        P.stamina -= 20;
        P.vel.set(-sy * cp * 9, sp * 9 + 1.5, -cy * cp * 9);
        toast('Lunge!');
      }
      P.hands = [null, null];
      P.grounded = false;
    } else if (P.grounded && !onSteep) {
      P.vel.y = 7.2;
      P.grounded = false;
    }
  }

  // Horizontal velocity
  const sprint = (keys.ShiftLeft || keys.ShiftRight) && P.stamina > 5 && !onSteep;
  const spd = nHold ? 2.4 : (sprint ? 6.5 : 4.2);
  const wgt = onSteep ? 0.25 : 1;
  const tx = wx * spd * wgt, tz = wz * spd * wgt;
  if (nHold || P.grounded) {
    if (!onSteep) {
      const k = Math.min(1, (nHold ? 5 : (moving ? 12 : 14)) * dt);
      P.vel.x += (tx - P.vel.x) * k;
      P.vel.z += (tz - P.vel.z) * k;
    }
  } else if (moving) {
    P.vel.x += wx * 6 * dt; P.vel.z += wz * 6 * dt;
    const hs = Math.hypot(P.vel.x, P.vel.z);
    if (hs > 7) { P.vel.x *= 7 / hs; P.vel.z *= 7 / hs; }
  }
  // Sliding down steep rock with no grip
  if (onSteep && gm > 0) {
    const acc = 9.8 * Math.sqrt(1 - ny * ny);
    P.vel.x += (-gx / gm) * acc * dt;
    P.vel.z += (-gz / gm) * acc * dt;
    const hs = Math.hypot(P.vel.x, P.vel.z);
    if (hs > 14) { P.vel.x *= 14 / hs; P.vel.z *= 14 / hs; }
  }

  // Vertical velocity
  if (nHold) {
    if (moving) P.vel.y += (wy * spd - P.vel.y) * Math.min(1, 5 * dt);
    P.vel.y -= G_HANG * dt;
  } else if (!P.grounded) {
    P.vel.y -= G * dt;
  }

  // Integrate horizontally with wall blocking
  const dX = P.vel.x * dt, dZ = P.vel.z * dt;
  if (!blocked(px + dX, pz)) P.pos.x += dX; else P.vel.x *= 0.2;
  if (!blocked(P.pos.x, pz + dZ)) P.pos.z += dZ; else P.vel.z *= 0.2;

  // Integrate vertically
  P.pos.y += P.vel.y * dt;

  // Grip tethers: keep each shoulder within rope length of its anchor
  for (const h of P.hands) {
    if (!h) continue;
    for (let it = 0; it < 2; it++) {
      const s = P.pos.clone().add(SH);
      const d = s.clone().sub(h.a);
      const dl = d.length();
      if (dl > h.rope) {
        d.multiplyScalar(1 / dl);
        s.copy(h.a).addScaledVector(d, h.rope);
        P.pos.copy(s).sub(SH);
        const vn = P.vel.dot(d);
        if (vn > 0) P.vel.addScaledVector(d, -vn);
      }
    }
  }

  // Ground / ledges
  const hgt = terrainH(P.pos.x, P.pos.z);
  if (P.pos.y <= hgt) {
    if (!P.grounded && !nHold) {
      const impact = -P.vel.y;
      if (impact > 11) hurt((impact - 11) * 5, impact);
    }
    P.pos.y = hgt;
    if (P.vel.y < 0) P.vel.y = 0;
    P.grounded = true;
  } else if (P.grounded && P.vel.y <= 0 && P.pos.y - hgt < 0.9) {
    P.pos.y = hgt;     // stick to the ground when walking downhill
  } else {
    P.grounded = false;
  }

  // Passive healing when standing still on the ground
  if (P.grounded && !nHold && !moving && !onSteep) P.hp = Math.min(100, P.hp + 3 * dt);

  // Out of bounds / fell into the sea
  if (P.pos.y < -20 || Math.hypot(P.pos.x, P.pos.z) > WORLD) {
    if (!P.frozen) die(false);
  }

  // Campfire checkpoints
  for (const f of FIRES) {
    if (f.idx > P.cp.idx && Math.hypot(P.pos.x - f.x, P.pos.z - f.z) < 4.5 && Math.abs(P.pos.y - f.y) < 4) {
      P.cp = { pos: f.spawn.clone(), idx: f.idx };
      toast(`🔥 Campfire — ${f.h} m`);
    }
  }

  // Summit
  if (!P.won && Math.hypot(P.pos.x - SUM.x, P.pos.z - SUM.z) < 7 && P.pos.y > SUM.y - 4) win();
}

/* ============================== UI helpers ============================== */
const $ = (id) => document.getElementById(id);
const toastEl = $('toast');
let toastTimer = null;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
}
function fmtTime(s) {
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}
const bestKey = 'peak-best-time';
function bestTime() { return parseFloat(localStorage.getItem(bestKey) || 'NaN'); }

let maxHeight = 0;
function win() {
  P.won = true;
  if (document.pointerLockElement) document.exitPointerLock();
  const bt = bestTime();
  if (!(bt <= P.time)) localStorage.setItem(bestKey, String(P.time));
  $('winTime').textContent = fmtTime(P.time);
  $('winH').textContent = Math.round(maxHeight);
  $('win').classList.remove('hidden');
  $('hud').classList.add('hidden');
}

function setupAltitudeMarks() {
  const bar = $('altitude');
  for (const f of FIRES) {
    const m = document.createElement('div');
    m.className = 'altMark';
    m.style.bottom = `${(f.h / SUM.y) * 100}%`;
    bar.appendChild(m);
  }
}
setupAltitudeMarks();

const hudEls = {
  hgt: $('hgt'), time: $('time'), best: $('best'), stam: $('stam'), hp: $('hp'),
  hL: $('hL'), hR: $('hR'), cross: $('cross'), altFill: $('altFill'),
};
const seedTxt = $('seedTxt'); seedTxt.textContent = String(SEED);
const fmtBest = () => { const b = bestTime(); return isNaN(b) ? '–' : fmtTime(b); };
hudEls.best.textContent = fmtBest();

function updateHUD() {
  const h = Math.max(0, P.pos.y);
  if (h > maxHeight) maxHeight = h;
  hudEls.hgt.textContent = Math.round(h);
  hudEls.time.textContent = fmtTime(P.time);
  hudEls.stam.style.width = `${P.stamina}%`;
  hudEls.hp.style.width = `${Math.max(0, P.hp)}%`;
  hudEls.hL.classList.toggle('on', !!P.hands[0]);
  hudEls.hR.classList.toggle('on', !!P.hands[1]);
  hudEls.altFill.style.height = `${Math.min(100, (h / SUM.y) * 100)}%`;
}

/* ============================== menus ============================== */
function showOverlay(id, on) { $(id).classList.toggle('hidden', !on); }
function startRun() {
  P.running = true;
  showOverlay('start', false);
  $('hud').classList.remove('hidden');
  canvas.requestPointerLock();
}
$('btnStart').addEventListener('click', startRun);
$('btnResume').addEventListener('click', () => canvas.requestPointerLock());
$('btnNew').addEventListener('click', () => { location.search = `?seed=${(Math.random() * 1e9) | 0}`; });
$('btnNew2').addEventListener('click', () => { location.search = `?seed=${(Math.random() * 1e9) | 0}`; });
$('btnAgain').addEventListener('click', () => {
  P.cp = { pos: BASE.clone(), idx: -1 };
  P.time = 0; P.won = false; maxHeight = 0;
  respawn();
  showOverlay('win', false);
  $('hud').classList.remove('hidden');
  hudEls.best.textContent = fmtBest();
  canvas.requestPointerLock();
});

document.addEventListener('pointerlockchange', () => {
  if (isLocked()) {
    showOverlay('pause', false);
    showOverlay('start', false);
  } else if (P.running && !P.won) {
    showOverlay('pause', true);
  }
});

/* ============================== loop ============================== */
const clock = new THREE.Clock();
const tmpRight = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

function updateHands() {
  const eye = eyePos();
  const f = aimDir();
  const right = tmpRight.set(Math.cos(P.yaw), 0, -Math.sin(P.yaw));
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? -1 : 1;
    const o = eye.clone().addScaledVector(right, side * 0.4).addScaledVector(UP, -0.45).addScaledVector(f, 0.45);
    const h = P.hands[i], v = HV[i];
    if (h) {
      v.idle.visible = false; v.arm.visible = true; v.glove.visible = true;
      const d = h.a.clone().sub(o);
      const len = d.length();
      v.arm.position.copy(o).addScaledVector(d, 0.5);
      v.arm.scale.set(1, len, 1);
      v.arm.quaternion.setFromUnitVectors(UP, d.normalize());
      v.glove.position.copy(h.a).addScaledVector(h.n, 0.08);
    } else {
      v.idle.visible = true; v.arm.visible = false; v.glove.visible = false;
      v.idle.position.copy(o);
    }
  }
}

let active = false;
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 1 / 30);
  const t = clock.elapsedTime;

  active = P.running && !P.won && isLocked() && !P.frozen;
  if (active) { update(dt); P.time += dt; }
  else if (P.frozen) { P.vel.set(0, 0, 0); }

  // Camera
  const eye = eyePos();
  camera.position.copy(eye);
  camera.rotation.set(P.pitch, P.yaw, 0, 'YXZ');

  // Crosshair readiness
  const hit = isLocked() && (P.hands[0] === null || P.hands[1] === null)
    ? probe(eye, aimDir(), 2.6) : null;
  const canGrab = !!hit && hit.p.distanceTo(shoulderPos()) <= ARM + 0.45 && P.stamina >= 8;
  hudEls.cross.className = canGrab ? 'ok' : (isLocked() ? 'bad' : '');

  updateHands();
  updateHUD();

  // Flicker campfires and wave the flag
  for (const f of FIRES) {
    const s = 1 + 0.12 * Math.sin(t * 13 + f.idx * 2) + 0.06 * Math.sin(t * 31 + f.idx);
    f.flame.scale.set(s, 1 + 0.2 * Math.sin(t * 9 + f.idx), s);
  }
  SUM.cloth.rotation.y = Math.sin(t * 2) * 0.25;
  clouds.rotation.y = t * 0.01;

  renderer.render(scene, camera);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

frame();

// Expose a tiny debug handle for testing in the console
window.peak = { P, FIRES, SUM, terrainH, probe };
