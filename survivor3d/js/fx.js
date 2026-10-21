import * as THREE from 'three';
import { G, tier } from './state.js';
import { clamp, lerp, Rand } from './util.js';

// ══════════════════════════════════════════════════════════════
//  FX — ONE THREE.Points cloud renders every particle in the game
//  (blood, dust, sparks, smoke, casings, muzzle flash) through a
//  tiny custom shader so each particle can have its own size and
//  alpha for the cost of a single draw call.
//  Pooled + capped: tier 0 only ever touches 26% of the budget.
// ══════════════════════════════════════════════════════════════

const MAX = 900;
let pts = null, geo = null;
let pos, pcol, psize, palpha;
const vel = new Float32Array(MAX * 3);
const life = new Float32Array(MAX);
const maxLife = new Float32Array(MAX);
const grav = new Float32Array(MAX);
const drag = new Float32Array(MAX);
const size0 = new Float32Array(MAX);
const size1 = new Float32Array(MAX);
let head = 0;
const rnd = new Rand(7);
const _c = new THREE.Color();

function blobCanvas() {
  const S = 64, c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.42, 'rgba(255,255,255,0.82)');
  g.addColorStop(0.75, 'rgba(255,255,255,0.28)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, S, S);
  return c;
}

const VERT = `
attribute vec3 pcolor;
attribute float psize;
attribute float palpha;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vColor = pcolor;
  vAlpha = palpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = psize * (320.0 / max(0.001, -mv.z));
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = `
uniform sampler2D map;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec4 t = texture2D(map, gl_PointCoord);
  float a = t.a * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor, a);
}`;

export function initFX(scene) {
  geo = new THREE.BufferGeometry();
  pos = new Float32Array(MAX * 3);
  pcol = new Float32Array(MAX * 3);
  psize = new Float32Array(MAX);
  palpha = new Float32Array(MAX);
  for (let i = 0; i < MAX; i++) { pos[i * 3 + 1] = -9999; life[i] = 0; }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('pcolor', new THREE.BufferAttribute(pcol, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('psize', new THREE.BufferAttribute(psize, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('palpha', new THREE.BufferAttribute(palpha, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setDrawRange(0, MAX);

  const tex = new THREE.CanvasTexture(blobCanvas());
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.ShaderMaterial({
    uniforms: { map: { value: tex } },
    vertexShader: VERT, fragmentShader: FRAG,
    transparent: true, depthWrite: false, depthTest: true, fog: false,
  });
  pts = new THREE.Points(geo, m);
  pts.frustumCulled = false;
  pts.renderOrder = 6;
  scene.add(pts);
}

const budget = () => Math.max(40, Math.floor(MAX * (G.tier === 0 ? 0.26 : G.tier === 1 ? 0.6 : 1)));

/**
 * size0 → size1 over lifetime; alpha fades out.
 * gravity < 0 = falls, > 0 = rises (smoke).
 */
function emit(x, y, z, vx, vy, vz, hex, s0, s1, lifeS, gravity, dragK, alpha0 = 1) {
  const cap = budget();
  let i = -1;
  for (let k = 0; k < cap; k++) {
    const idx = (head + k) % cap;
    if (life[idx] <= 0) { i = idx; break; }
  }
  if (i < 0) i = head % cap;
  head = (i + 1) % cap;
  const i3 = i * 3;
  pos[i3] = x; pos[i3 + 1] = y; pos[i3 + 2] = z;
  vel[i3] = vx; vel[i3 + 1] = vy; vel[i3 + 2] = vz;
  _c.setHex(hex);
  pcol[i3] = _c.r; pcol[i3 + 1] = _c.g; pcol[i3 + 2] = _c.b;
  size0[i] = s0; size1[i] = s1;
  psize[i] = s0;
  palpha[i] = alpha0;
  life[i] = maxLife[i] = lifeS;
  grav[i] = gravity; drag[i] = dragK;
}

const P = tier();
const q = () => (G.tier === 0 ? 0.45 : G.tier === 1 ? 0.8 : 1) * (tier().particles || 1);

export const fx = {
  blood(x, y, z, n = 8, dir = null) {
    n = Math.max(2, Math.round(n * q()));
    for (let i = 0; i < n; i++) {
      const s = rnd.range(1.6, 5.4);
      emit(x + rnd.range(-.14, .14), y + rnd.range(-.14, .14), z + rnd.range(-.14, .14),
        (dir ? dir.x : 0) + rnd.range(-s, s), rnd.range(0.6, 4.4), (dir ? dir.z : 0) + rnd.range(-s, s),
        rnd.chance(0.6) ? 0x8e1b12 : 0xc22b1c,
        rnd.range(0.1, 0.2), 0.03, rnd.range(0.3, 0.66), -13, 1.7);
    }
  },
  dust(x, y, z, n = 6, hex = 0xbfa882) {
    n = Math.max(1, Math.round(n * q()));
    for (let i = 0; i < n; i++) {
      const s = rnd.range(0.7, 2.8);
      emit(x + rnd.range(-.2, .2), y + rnd.range(0, .22), z + rnd.range(-.2, .2),
        rnd.range(-s, s), rnd.range(0.5, 2.4), rnd.range(-s, s),
        hex, rnd.range(0.14, 0.3), rnd.range(0.5, 0.95), rnd.range(0.35, 0.8), -3.5, 2.4, 0.75);
    }
  },
  spark(x, y, z, n = 7, hex = 0xffd27a) {
    n = Math.max(1, Math.round(n * q()));
    for (let i = 0; i < n; i++) {
      const s = rnd.range(3, 11);
      emit(x, y, z, rnd.range(-s, s), rnd.range(0.5, s * 0.8), rnd.range(-s, s),
        rnd.chance(0.5) ? hex : 0xfff2c4,
        rnd.range(0.06, 0.14), 0.01, rnd.range(0.12, 0.34), -18, 1.1);
    }
  },
  smoke(x, y, z, n = 5, hex = 0x6b6b66) {
    n = Math.max(1, Math.round(n * q()));
    for (let i = 0; i < n; i++) {
      emit(x + rnd.range(-.25, .25), y, z + rnd.range(-.25, .25),
        rnd.range(-.7, .7), rnd.range(0.7, 2.1), rnd.range(-.7, .7),
        hex, rnd.range(0.25, 0.5), rnd.range(1.1, 2.1), rnd.range(0.7, 1.5), 0.7, 1.1, 0.5);
    }
  },
  casing(x, y, z, dx, dz) {
    if (G.tier === 0) return;
    emit(x, y, z, dx * 1.6 + rnd.range(-1, 1), rnd.range(2.2, 3.8), dz * 1.6 + rnd.range(-1, 1),
      0xd8b45a, 0.055, 0.045, 1.0, -16, 0.4);
  },
  muzzle(x, y, z) {
    emit(x, y, z, 0, 0, 0, 0xffe6a8, 0.95, 0.1, 0.05, 0, 0, 1);
    if (G.tier > 0) {
      for (let i = 0; i < 3; i++)
        emit(x, y, z, rnd.range(-2.4, 2.4), rnd.range(-1, 2.4), rnd.range(-2.4, 2.4),
          0xffa63d, 0.22, 0.02, 0.1, 0, 2.2, 0.9);
    }
  },
  explosion(x, y, z) {
    const k = q();
    for (let i = 0; i < Math.round(26 * k); i++) {
      const s = rnd.range(4, 16), a = rnd.range(0, TAU6), e = rnd.range(0.2, 1.2);
      emit(x, y + 0.3, z, Math.cos(a) * s * e, rnd.range(1, 9), Math.sin(a) * s * e,
        rnd.chance(0.5) ? 0xffb03a : 0xff7a2a,
        rnd.range(0.3, 0.6), 0.05, rnd.range(0.25, 0.55), -6, 1.2);
    }
    for (let i = 0; i < Math.round(18 * k); i++) {
      const a = rnd.range(0, TAU6), s = rnd.range(1.5, 6);
      emit(x, y + rnd.range(0, 1), z, Math.cos(a) * s, rnd.range(1.5, 5), Math.sin(a) * s,
        rnd.chance(.5) ? 0x3b3b38 : 0x6b6b66,
        rnd.range(0.7, 1.3), rnd.range(2.2, 3.6), rnd.range(0.9, 1.8), 0.9, 0.9, 0.55);
    }
  },
  splash(x, y, z) { fx.dust(x, y, z, 7, 0x9fd8ef); },
  land(x, y, z) { fx.dust(x, y, z, G.tier === 0 ? 4 : 10, 0xc0a97f); },
};
const TAU6 = 6.283185;

export function updateFX(dt) {
  if (!geo) return;
  const cap = budget();
  for (let i = 0; i < cap; i++) {
    if (life[i] <= 0) continue;
    life[i] -= dt;
    const i3 = i * 3;
    if (life[i] <= 0) { pos[i3 + 1] = -9999; psize[i] = 0; palpha[i] = 0; continue; }
    vel[i3 + 1] += grav[i] * dt;
    const d = Math.max(0, 1 - drag[i] * dt);
    vel[i3] *= d; vel[i3 + 1] *= d; vel[i3 + 2] *= d;
    pos[i3] += vel[i3] * dt; pos[i3 + 1] += vel[i3 + 1] * dt; pos[i3 + 2] += vel[i3 + 2] * dt;
    const k = life[i] / maxLife[i];
    psize[i] = lerp(size1[i], size0[i], k);
    palpha[i] = clamp(k * 1.4, 0, 1);
  }
  geo.attributes.position.needsUpdate = true;
  geo.attributes.psize.needsUpdate = true;
  geo.attributes.palpha.needsUpdate = true;
  geo.attributes.pcolor.needsUpdate = true;
}

// ── floating damage numbers (DOM pool, projected each frame) ────
const pool = [];
let layer = null;
const v3 = new THREE.Vector3();
export function initDamageNumbers() {
  layer = document.getElementById('dmgLayer');
  if (!layer || pool.length) return;
  for (let i = 0; i < 14; i++) {
    const d = document.createElement('div');
    d.className = 'dnum';
    d.style.opacity = '0';
    layer.appendChild(d);
    pool.push({ el: d, life: 0, x: 0, y: 0, vy: 0 });
  }
}
export function damageNumber(worldPos, amount, crit) {
  if (!layer || !pool.length || !G.camera) return;
  let s = null;
  for (const p of pool) if (p.life <= 0) { s = p; break; }
  if (!s) return;
  v3.set(worldPos.x, worldPos.y, worldPos.z).project(G.camera);
  if (v3.z > 1) return;
  s.x = (v3.x * 0.5 + 0.5) * innerWidth + (Math.random() * 22 - 11);
  s.y = (-v3.y * 0.5 + 0.5) * innerHeight;
  s.vy = -52; s.life = 0.85;
  s.el.textContent = (crit ? '✦' : '') + Math.round(amount);
  s.el.className = 'dnum' + (crit ? ' crit' : '');
  s.el.style.opacity = '1';
}
export function updateDamageNumbers(dt) {
  for (const p of pool) {
    if (p.life <= 0) continue;
    p.life -= dt;
    p.y += p.vy * dt; p.vy += 70 * dt;
    if (p.life <= 0) { p.el.style.opacity = '0'; continue; }
    p.el.style.transform = `translate(${p.x.toFixed(0)}px,${p.y.toFixed(0)}px)`;
    p.el.style.opacity = String(clamp(p.life / 0.4, 0, 1));
  }
}

// ── camera shake ───────────────────────────────────────────────
export const shake = { amp: 0, t: 0 };
export function addShake(a) { shake.amp = Math.min(1.5, shake.amp + a); }
export function shakeOffset() {
  if (shake.amp <= 0.002) { shake.amp = 0; return [0, 0]; }
  shake.amp *= 0.87;
  shake.t += 0.7;
  return [Math.sin(shake.t * 9.1) * shake.amp * 0.07, Math.cos(shake.t * 7.7) * shake.amp * 0.055];
}

export function resetFX() {
  if (!geo) return;
  for (let i = 0; i < MAX; i++) { life[i] = 0; pos[i * 3 + 1] = -9999; psize[i] = 0; palpha[i] = 0; }
  geo.attributes.position.needsUpdate = true;
  geo.attributes.psize.needsUpdate = true;
  geo.attributes.palpha.needsUpdate = true;
  for (const p of pool) { p.life = 0; p.el.style.opacity = '0'; }
  shake.amp = 0;
}
void P;
