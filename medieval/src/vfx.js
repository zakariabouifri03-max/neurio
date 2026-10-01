// ── IRONVOW — effects: sparks, blood, dust, and light that moves ─────────────
// Everything here is generated at runtime from the same numbers the fight
// already produced — no textures, no downloads. A clash throws sparks along the
// contact normal; a wound throws blood along the blade's edge; a footfall lifts
// the sand it stands on. The particles are pooled: a duel spends no memory.
import * as THREE from 'three';
import { clamp01, rr, rnd, _v1, _v2 } from './mathx.js';

const MAX = 900;

function softDisc(size = 32, core = 0.55) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(core, 'rgba(255,255,255,0.35)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** One pooled Points cloud per look: sparks, blood, dust, embers. */
class Pool {
  constructor(scene, opts) {
    this.n = opts.count;
    this.pos = new Float32Array(this.n * 3);
    this.col = new Float32Array(this.n * 3);
    this.size = new Float32Array(this.n);
    this.vel = new Float32Array(this.n * 3);
    this.life = new Float32Array(this.n);
    this.maxLife = new Float32Array(this.n);
    this.grav = opts.gravity ?? -9;
    this.drag = opts.drag ?? 0.6;
    this.head = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    const mat = new THREE.PointsMaterial({
      size: 0.045, sizeAttenuation: true, map: opts.map, transparent: true,
      depthWrite: false, vertexColors: true, blending: opts.blending ?? THREE.AdditiveBlending,
      opacity: opts.opacity ?? 1,
    });
    this.mat = mat;
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    scene.add(this.points);
  }

  spawn(p, v, color, life, size, spread = 0) {
    const i = this.head; this.head = (this.head + 1) % this.n;
    const s = spread;
    this.pos[i * 3] = p.x + (rnd() - 0.5) * s;
    this.pos[i * 3 + 1] = p.y + (rnd() - 0.5) * s;
    this.pos[i * 3 + 2] = p.z + (rnd() - 0.5) * s;
    this.vel[i * 3] = v.x; this.vel[i * 3 + 1] = v.y; this.vel[i * 3 + 2] = v.z;
    this.col[i * 3] = color[0]; this.col[i * 3 + 1] = color[1]; this.col[i * 3 + 2] = color[2];
    this.life[i] = life; this.maxLife[i] = life;
    this.size[i] = size;
  }

  update(dt) {
    const p = this.pos, v = this.vel, l = this.life, c = this.col;
    const k = Math.exp(-this.drag * dt);
    let live = false;
    for (let i = 0; i < this.n; i++) {
      if (l[i] <= 0) { if (c[i * 3] !== 0) { c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = 0; } continue; }
      live = true;
      l[i] -= dt;
      const f = clamp01(l[i] / this.maxLife[i]);
      v[i * 3] *= k; v[i * 3 + 1] = v[i * 3 + 1] * k + this.grav * dt; v[i * 3 + 2] *= k;
      p[i * 3] += v[i * 3] * dt; p[i * 3 + 1] += v[i * 3 + 1] * dt; p[i * 3 + 2] += v[i * 3 + 2] * dt;
      // hot things fade through their own colour; blood dries dark
      const g = f * f;
      c[i * 3] *= 0.985; c[i * 3 + 1] *= 0.972; c[i * 3 + 2] *= 0.955;
      if (this.grav < 0 && p[i * 3 + 1] < 0.01) { p[i * 3 + 1] = 0.01; v[i * 3 + 1] *= -0.18; v[i * 3] *= 0.6; v[i * 3 + 2] *= 0.6; }
      if (l[i] <= 0) { this.vel[i * 3 + 1] = 0; }
    }
    if (live || this._dirty) {
      this.points.geometry.attributes.position.needsUpdate = true;
      this.points.geometry.attributes.color.needsUpdate = true;
      this._dirty = true;
    }
  }
}

export class Vfx {
  constructor(scene) {
    this.scene = scene;
    this.disc = softDisc(32, 0.4);
    this.sparks = new Pool(scene, { count: 320, map: this.disc, gravity: -11, drag: 1.1, blending: THREE.AdditiveBlending });
    this.blood = new Pool(scene, { count: 300, map: this.disc, gravity: -13, drag: 2.4, blending: THREE.NormalBlending, opacity: 0.95 });
    this.dust = new Pool(scene, { count: 260, map: this.disc, gravity: -1.2, drag: 3.2, blending: THREE.NormalBlending, opacity: 0.36 });
    this.decals = [];
    this.decalGroup = new THREE.Group();
    this.decalGroup.renderOrder = 1;
    scene.add(this.decalGroup);
    this.time = 0;
  }

  /** Steel on steel: sparks that fall and die, and the smell of a forge. */
  clash(point, normal, power) {
    const p = clamp01(power);
    const n = 6 + Math.round(p * 26);
    for (let i = 0; i < n; i++) {
      _v1.copy(normal).multiplyScalar(rr(0.4, 1.8));
      _v1.x += rr(-1.6, 1.6); _v1.y += rr(0.1, 2.3); _v1.z += rr(-1.6, 1.6);
      _v1.multiplyScalar(0.5 + p);
      const hot = rr(0.5, 1);
      this.sparks.spawn(point, _v1, [1.0, 0.66 * hot + 0.2, 0.16 * hot], rr(0.18, 0.55), rr(0.6, 1.2), 0.03);
    }
    for (let i = 0; i < 3 + (p * 6) | 0; i++) {
      _v1.set(rr(-0.5, 0.5), rr(0.2, 1.0), rr(-0.5, 0.5));
      this.dust.spawn(point, _v1, [0.5, 0.48, 0.44], rr(0.3, 0.8), rr(1.6, 3.4), 0.06);
    }
  }

  /** A blade opening a man: a spurt, then a drip. */
  wound(point, dir, bladePoint, amount, arterial) {
    const p = clamp01(amount);
    const n = 8 + Math.round(p * 34);
    for (let i = 0; i < n; i++) {
      _v1.copy(dir).multiplyScalar(rr(0.4, 2.2));
      _v1.x += rr(-1.3, 1.3); _v1.y += rr(-0.4, 2.2); _v1.z += rr(-1.3, 1.3);
      const v = 1 + p * 2.2;
      _v1.multiplyScalar(v * (arterial ? 1.5 : 1));
      const c = arterial ? [0.62, 0.045, 0.03] : [0.44, 0.05, 0.045];
      this.blood.spawn(point, _v1, c, rr(0.3, 0.9), rr(0.8, 2.2), 0.04);
    }
    // spray along the blade, which is what makes a cut read as a cut
    if (p > 0.35 && bladePoint) {
      for (let i = 0; i < 10 * p; i++) {
        _v2.copy(dir).multiplyScalar(rr(-0.2, 0.8)).multiplyScalar(1.6);
        this.blood.spawn(bladePoint, _v2, [0.4, 0.04, 0.04], rr(0.2, 0.6), rr(0.6, 1.6), 0.05);
      }
    }
  }

  /** Someone is walking: the floor answers. */
  step(point, ground, power = 1) {
    const n = 3 + Math.round(power * 6);
    for (let i = 0; i < n; i++) {
      _v1.set(rr(-0.6, 0.6) + 0.4, rr(0.1, 0.8), rr(-0.6, 0.6) + 0.3);
      this.dust.spawn(point, _v1, ground ?? [0.5, 0.46, 0.4], rr(0.3, 0.8), rr(1.2, 2.6), 0.1);
    }
  }

  /** A wall of air: the shove, and the fall that follows it. */
  burst(point, dir, power = 1) {
    for (let i = 0; i < 26 * power; i++) {
      _v1.copy(dir).multiplyScalar(rr(0.6, 2.4));
      _v1.x += rr(-1, 1); _v1.y += rr(0, 0.9); _v1.z += rr(-1, 1);
      this.dust.spawn(point, _v1, [0.52, 0.5, 0.46], rr(0.4, 0.9), rr(2, 4.6), 0.2);
    }
  }

  /** A man hits the floor for the last time. */
  fall(point) {
    for (let i = 0; i < 40; i++) {
      _v1.set(rr(-1.6, 1.6), rr(0.1, 1.1), rr(-1.6, 1.6));
      this.dust.spawn(point, _v1, [0.5, 0.47, 0.42], rr(0.6, 1.6), rr(2.4, 5.2), 0.3);
    }
  }

  /** Blood on the floor: a small pool that fades with the fight's memory. */
  stain(point, size = 0.35, color = 0x5a0a0a) {
    const geo = new THREE.PlaneGeometry(size * 2, size * 2);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.72, depthWrite: false });
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = rr(0, Math.PI * 2);
    m.position.copy(point).setY(0.012);
    m.renderOrder = 1;
    this.decalGroup.add(m);
    this.decals.push({ m, t: 0, size });
    if (this.decals.length > 26) {
      const old = this.decals.shift();
      old.m.geometry.dispose(); old.m.material.dispose(); this.decalGroup.remove(old.m);
    }
  }

  /** The edge in motion: a short trail that shows where the steel has been. */
  updateTrail(f, dt) {
    if (!this.trail) {
      const g = new THREE.BufferGeometry();
      const n = 24;
      this.trailPos = new Float32Array(n * 3);
      this.trailGeo = g;
      g.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3));
      g.setDrawRange(0, 0);
      this.trailCount = n;
      this.trailHead = 0;
      this.trail = new THREE.Line(g, new THREE.LineBasicMaterial({
        color: 0xdfe6ee, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      this.trail.frustumCulled = false;
      this.scene.add(this.trail);
    }
    const moving = f.attacking || f.state === 'windup';
    const speed = f.wb.tipSpeed ? f.wb.tipSpeed() : 0;
    const show = moving && speed > 6;
    this.trail.material.opacity += ((show ? clamp01((speed - 6) / 16) * 0.5 : 0) - this.trail.material.opacity) * Math.min(1, dt * 10);
    if (show) {
      const i = this.trailHead % this.trailCount;
      const tip = f.weaponTip(_v1);
      this.trailPos[i * 3] = tip.x; this.trailPos[i * 3 + 1] = tip.y; this.trailPos[i * 3 + 2] = tip.z;
      this.trailHead++;
      if (this.trailHead > 2) this.trailGeo.setDrawRange(0, Math.min(this.trailCount, this.trailHead));
      this.trailGeo.attributes.position.needsUpdate = true;
    } else if (this.trailHead !== 0) {
      this.trailHead = 0; this.trailGeo.setDrawRange(0, 0);
    }
  }

  update(dt) {
    this.time += dt;
    this.sparks.update(dt);
    this.blood.update(dt);
    this.dust.update(dt);
    for (const d of this.decals) {
      d.t += dt;
      d.m.material.opacity = Math.max(0, 0.72 * (1 - d.t / 90));
    }
  }
}
