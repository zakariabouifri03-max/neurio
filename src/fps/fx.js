// ── WARFRONT · pooled visual effects: tracers, impacts, decals, big booms ───
// Everything is pooled / instanced so a firefight never allocates.

import * as THREE from 'three';
import { clamp, RNG } from './util.js';

function radial(stops, size = 64) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) g.addColorStop(o, col);
  x.fillStyle = g; x.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

class Pool {
  constructor(geo, mat, n, scene) {
    this.n = n;
    this.items = [];
    this.mesh = new THREE.InstancedMesh(geo, mat, n);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.dummy = new THREE.Object3D();
    for (let i = 0; i < n; i++) {
      this.items.push({ life: 0, max: 1, x: 0, y: -999, z: 0, vx: 0, vy: 0, vz: 0, s: 1, rot: 0, spin: 0, grav: 0, drag: 0, col: new THREE.Color(1, 1, 1), grow: 0 });
      this.mesh.setColorAt(i, new THREE.Color(0, 0, 0));
    }
    this.cursor = 0;
    scene.add(this.mesh);
    this.colDirty = false;
  }
  spawn(o) {
    // find a free slot (ring buffer)
    let idx = -1;
    for (let k = 0; k < this.n; k++) {
      const i = (this.cursor + k) % this.n;
      if (this.items[i].life <= 0) { idx = i; this.cursor = (i + 1) % this.n; break; }
    }
    if (idx < 0) { idx = this.cursor; this.cursor = (this.cursor + 1) % this.n; }
    const it = this.items[idx];
    it.x = o.x; it.y = o.y; it.z = o.z;
    it.vx = o.vx || 0; it.vy = o.vy || 0; it.vz = o.vz || 0;
    it.s = o.s || 1; it.grow = o.grow || 0;
    it.life = it.max = o.life || 0.5;
    it.grav = o.grav || 0; it.drag = o.drag === undefined ? 1.4 : o.drag;
    it.rot = o.rot || 0; it.spin = o.spin || 0;
    it.col.setRGB(o.r === undefined ? 1 : o.r, o.g === undefined ? 1 : o.g, o.b === undefined ? 1 : o.b);
    if (o.jit) {
      const j = o.jit;
      it.vx += (Math.random() - .5) * j; it.vy += (Math.random() - .5) * j * .7; it.vz += (Math.random() - .5) * j;
    }
    it.idx = idx;
    this.colDirty = true;
    return it;
  }
  update(dt, groundY) {
    const d = this.dummy;
    let alive = 0;
    for (let i = 0; i < this.n; i++) {
      const it = this.items[i];
      if (it.life <= 0) {
        if (it.seen) { d.position.set(0, -9999, 0); d.scale.setScalar(0.0001); d.rotation.set(0, 0, 0); d.updateMatrix(); this.mesh.setMatrixAt(i, d.matrix); it.seen = false; }
        continue;
      }
      alive++;
      it.life -= dt;
      const t = clamp(it.life / it.max, 0, 1);
      it.vy -= it.grav * dt;
      const dm = Math.exp(-it.drag * dt);
      it.vx *= dm; it.vy *= dm; it.vz *= dm;
      it.x += it.vx * dt; it.y += it.vy * dt; it.z += it.vz * dt;
      if (groundY !== undefined && it.y < groundY) { it.y = groundY; it.vy = Math.abs(it.vy) * .3; it.vx *= .5; it.vz *= .5; it.grav *= .4; }
      it.rot += it.spin * dt;
      const s = it.s * (it.grow ? (1 + (1 - t) * it.grow) : t);
      d.position.set(it.x, it.y, it.z);
      d.rotation.set(it.rot * 1.3, it.rot, it.rot * .7);
      d.scale.setScalar(Math.max(0.001, s));
      d.updateMatrix();
      this.mesh.setMatrixAt(i, d.matrix);
      it.seen = true;
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.colDirty) {
      for (let i = 0; i < this.n; i++) this.mesh.setColorAt(i, this.items[i].life > 0 ? this.items[i].col : BLACK);
      this.mesh.instanceColor.needsUpdate = true;
      this.colDirty = false;
    }
    return alive;
  }
}
const BLACK = new THREE.Color(0, 0, 0);

class DecalPool {
  constructor(tex, n, scene, color = 0xffffff, blend = THREE.NormalBlending) {
    this.n = n; this.cursor = 0;
    this.mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: blend, color, polygonOffset: true, polygonOffsetFactor: -4, fog: true });
    this.meshes = [];
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.mat);
      m.visible = false; m.castShadow = false; m.receiveShadow = false;
      scene.add(m);
      this.meshes.push({ m, life: 0, max: 1 });
    }
  }
  spawn(p, n, size, life = 9) {
    let best = null;
    for (let k = 0; k < this.n; k++) {
      const i = (this.cursor + k) % this.n;
      if (!best || this.meshes[i].life < best.life) best = this.meshes[i];
    }
    this.cursor = (this.cursor + 1) % this.n;
    const m = best.m;
    best.life = life; best.max = life;
    m.visible = true;
    m.position.set(p.x + n.x * 0.02, p.y + n.y * 0.02, p.z + n.z * 0.02);
    m.lookAt(p.x + n.x, p.y + n.y, p.z + n.z);
    m.rotation.z = Math.random() * Math.PI * 2;
    m.scale.setScalar(size);
  }
  update(dt) {
    for (const it of this.meshes) {
      if (it.life <= 0) continue;
      it.life -= dt;
      if (it.life <= 0) it.m.visible = false;
    }
  }
}

export class FX {
  constructor(scene, renderer) {
    this.scene = scene;
    this.rng = new RNG(99);

    this.puffs = new Pool(new THREE.PlaneGeometry(1, 1).rotateZ(0), new THREE.MeshBasicMaterial({
      map: radial([[0, 'rgba(255,255,255,.95)'], [.45, 'rgba(210,200,190,.5)'], [1, 'rgba(180,170,160,0)']]),
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    }), 260, scene);
    this.sparks = new Pool(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({
      map: radial([[0, 'rgba(255,255,255,1)'], [.35, 'rgba(255,210,120,.85)'], [1, 'rgba(255,120,40,0)']]),
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }), 260, scene);
    this.debris = new Pool(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ vertexColors: false, color: 0xffffff }), 200, scene);
    this.blood = new Pool(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0x8e1414, transparent: true, opacity: .95 }), 220, scene);

    this.holes = new DecalPool(radial([[0, 'rgba(10,10,10,.95)'], [.32, 'rgba(24,20,18,.8)'], [.62, 'rgba(60,52,44,.28)'], [1, 'rgba(80,70,60,0)']], 48), 54, scene);
    this.gores = new DecalPool(radial([[0, 'rgba(120,10,10,.95)'], [.4, 'rgba(90,8,8,.7)'], [1, 'rgba(60,4,4,0)']], 64), 34, scene);

    // tracers
    this.tracers = [];
    const tGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, .5);
    for (let i = 0; i < 44; i++) {
      const m = new THREE.Mesh(tGeo, new THREE.MeshBasicMaterial({
        map: radial([[0, 'rgba(255,255,235,1)'], [.4, 'rgba(255,200,110,.75)'], [1, 'rgba(255,150,60,0)']]),
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      }));
      m.visible = false;
      scene.add(m);
      this.tracers.push({ m, life: 0, max: .09, a: new THREE.Vector3(), b: new THREE.Vector3() });
    }

    // explosion visuals
    this.booms = [];
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), new THREE.MeshBasicMaterial({
        map: radial([[0, 'rgba(255,250,230,1)'], [.28, 'rgba(255,175,70,.9)'], [.62, 'rgba(180,80,30,.45)'], [1, 'rgba(60,40,30,0)']]),
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      m.visible = false;
      const ring = new THREE.Mesh(new THREE.RingGeometry(.7, 1, 26), new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: .8, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
      ring.rotation.x = -Math.PI / 2;
      m.add(ring);
      const light = new THREE.PointLight(0xffb066, 0, 34, 2);
      m.add(light);
      scene.add(m);
      this.booms.push({ m, ring, light, life: 0, max: .5, size: 6 });
    }

    // muzzle flash lights (shared, few)
    this.flashes = [];
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0xffcb87, 0, 13, 2);
      scene.add(l);
      this.flashes.push({ l, life: 0 });
    }
    this.shake = 0;
    this.hitFlash = 0;
  }

  tracer(a, b, width = 0.05, life = 0.075, colorMul = 1) {
    const t = this.tracers.find((x) => x.life <= 0) || this.tracers[0];
    t.life = t.max = life;
    t.a.copy(a); t.b.copy(b);
    t.m.visible = true;
    t.m.userData.w = width;
    t.m.userData.cm = colorMul;
  }

  /** surface impact */
  impact(p, n, kind = 'concrete') {
    if (kind === 'flesh') return;
    const cnt = kind === 'metal' ? 8 : 6;
    for (let i = 0; i < cnt; i++) {
      this.sparks.spawn({
        x: p.x, y: p.y, z: p.z, life: .12 + Math.random() * .22, s: .05,
        vx: n.x * 4 + (Math.random() - .5) * 7, vy: n.y * 4 + Math.random() * 5, vz: n.z * 4 + (Math.random() - .5) * 7,
        grav: 14, drag: 1.2, r: 1, g: .78, b: .42,
      });
    }
    this.puffs.spawn({ x: p.x + n.x * .06, y: p.y + n.y * .06, z: p.z + n.z * .06, life: .34, s: .18, grow: 3.4, drag: 3, spin: (Math.random() - .5) * 4, r: .82, g: .78, b: .7 });
    const size = kind === 'metal' ? .26 : .2;
    this.holes.spawn(p, n, size);
    for (let i = 0; i < 4; i++) {
      this.debris.spawn({
        x: p.x, y: p.y, z: p.z, life: .5 + Math.random() * .5, s: .05,
        vx: n.x * 3 + (Math.random() - .5) * 5, vy: n.y * 3 + Math.random() * 4.5, vz: n.z * 3 + (Math.random() - .5) * 5,
        grav: 16, drag: .4, spin: this.rng.range(-9, 9),
        r: .42, g: .38, b: .32,
      });
    }
    if (kind === 'metal') {
      const f = this.flashes.find((x) => x.life <= 0);
      if (f) { f.l.position.set(p.x, p.y, p.z); f.life = .06; }
    }
  }

  bloodHit(p, n, big = false) {
    const n2 = big ? 22 : 12;
    for (let i = 0; i < n2; i++) {
      this.blood.spawn({
        x: p.x, y: p.y, z: p.z, life: .25 + Math.random() * (big ? .7 : .4), s: big ? .11 : .08,
        vx: n.x * 2.4 + (Math.random() - .5) * (big ? 6 : 3.4), vy: 1.4 + Math.random() * 3, vz: n.z * 2.4 + (Math.random() - .5) * (big ? 6 : 3.4),
        grav: 15, drag: .5, spin: this.rng.range(-8, 8), r: .5 + Math.random() * .2, g: .07, b: .07,
      });
    }
    this.gores.spawn(p, { x: 0, y: 1, z: 0 }, big ? 1.1 : .7);
    this.puffs.spawn({ x: p.x, y: p.y, z: p.z, life: .3, s: .3, grow: 2, drag: 3.4, r: .5, g: .12, b: .1 });
  }

  explode(pos, radius = 6, opts = {}) {
    const b = this.booms.find((x) => x.life <= 0) || this.booms[0];
    b.life = b.max = .52;
    b.size = radius * (opts.visualScale || 1);
    b.m.position.copy(pos);
    b.m.visible = true;
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * Math.PI;
      const sp = 4 + Math.random() * 14;
      this.sparks.spawn({
        x: pos.x, y: pos.y, z: pos.z, life: .25 + Math.random() * .5, s: .1 + Math.random() * .1,
        vx: Math.sin(e) * Math.cos(a) * sp, vy: Math.abs(Math.cos(e)) * sp * .9, vz: Math.sin(e) * Math.sin(a) * sp,
        grav: 16, drag: 1.1, r: 1, g: .72, b: .3,
      });
    }
    for (let i = 0; i < 22; i++) {
      const a = Math.random() * Math.PI * 2;
      this.puffs.spawn({
        x: pos.x, y: pos.y + .2, z: pos.z, life: .8 + Math.random() * 1.1, s: .7 + Math.random(), grow: 3.6,
        vx: Math.cos(a) * this.rng.range(2, 9), vy: this.rng.range(2, 7), vz: Math.sin(a) * this.rng.range(2, 9),
        drag: 2.1, grav: 1.2, spin: this.rng.range(-2, 2), r: .28, g: .26, b: .24,
      });
    }
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2;
      this.debris.spawn({
        x: pos.x, y: pos.y + .3, z: pos.z, life: 1 + Math.random(), s: .12,
        vx: Math.cos(a) * this.rng.range(3, 12), vy: this.rng.range(4, 12), vz: Math.sin(a) * this.rng.range(3, 12),
        grav: 20, drag: .3, spin: this.rng.range(-14, 14), r: .35, g: .3, b: .26,
      });
    }
    this.shakeAdd(opts.shake === undefined ? Math.min(1.1, radius * .09) : opts.shake);
  }

  dustPuff(p, s = 1) {
    this.puffs.spawn({ x: p.x, y: p.y, z: p.z, life: .5, s: .3 * s, grow: 2.4, drag: 3, vx: 0, vy: .5, vz: 0, r: .72, g: .66, b: .55 });
  }

  muzzleFlash(pos, dir, scale = 1) {
    for (let i = 0; i < 3; i++) {
      this.puffs.spawn({
        x: pos.x, y: pos.y, z: pos.z, life: .07, s: .28 * scale, grow: 1.6, drag: 5,
        vx: dir.x * 5, vy: dir.y * 5 + .5, vz: dir.z * 5, r: 1, g: .85, b: .5,
      });
    }
    const f = this.flashes.find((x) => x.life <= 0) || this.flashes[0];
    f.l.position.copy(pos);
    f.life = .05;
  }

  shell(pos, right, up) {
    this.debris.spawn({
      x: pos.x, y: pos.y, z: pos.z, life: .8, s: .035,
      vx: right.x * 2.2 + (Math.random() - .5), vy: 2.4 + Math.random(), vz: right.z * 2.2 + (Math.random() - .5),
      grav: 18, drag: .2, spin: this.rng.range(-18, 18), r: .85, g: .68, b: .3,
    });
  }

  shakeAdd(v) { this.shake = Math.min(1.6, this.shake + v); }

  update(dt, cam, groundY = 0) {
    this.puffs.update(dt);
    this.sparks.update(dt);
    this.blood.update(dt);
    this.debris.update(dt, groundY);
    for (const t of this.tracers) {
      if (t.life <= 0) { if (t.m.visible) t.m.visible = false; continue; }
      t.life -= dt;
      const { a, b } = t;
      const len = a.distanceTo(b);
      const w = (t.m.userData.w || .05) * (1 + (1 - clamp(t.life / t.max, 0, 1)) * 1.4);
      t.m.position.copy(a);
      t.m.lookAt(b);
      t.m.scale.set(w, w, Math.max(.001, len));
      const op = clamp(t.life / t.max, 0, 1);
      t.m.material.opacity = op;
    }
    // smoke / dust puffs are camera facing as a whole system
    this.puffs.mesh.quaternion.copy(cam.quaternion);
    this.blood.mesh.quaternion.copy(cam.quaternion);
    for (const b of this.booms) {
      if (b.life <= 0) { if (b.m.visible) b.m.visible = false; continue; }
      b.life -= dt;
      const k = 1 - clamp(b.life / b.max, 0, 1);
      const s = b.size * (0.25 + k * 1.15);
      b.m.scale.setScalar(Math.max(.01, s));
      b.m.material.opacity = clamp(1 - k, 0, 1) ** 1.3;
      b.ring.scale.setScalar(Math.max(.01, s * (1.2 + k * 3.4)));
      b.ring.material.opacity = clamp(.75 - k, 0, 1);
      b.light.intensity = clamp((1 - k) * 34, 0, 40);
      if (b.life <= 0) b.m.visible = false;
    }
    for (const f of this.flashes) {
      if (f.life <= 0) { if (f.l.intensity) f.l.intensity = 0; continue; }
      f.life -= dt;
      f.l.intensity = clamp(f.life / .05, 0, 1) * 9;
    }
    this.holes.update(dt);
    this.gores.update(dt);
    this.shake *= Math.exp(-7 * dt);
    if (this.shake < 0.002) this.shake = 0;
  }

  camShakeOffset() {
    if (this.shake <= 0) return null;
    const s = this.shake;
    const t = performance.now() * .021;
    return {
      x: (Math.sin(t * 1.7) + Math.sin(t * 3.3)) * .012 * s,
      y: (Math.cos(t * 2.1) + Math.sin(t * 4.7)) * .012 * s,
      r: Math.sin(t * 1.3) * .012 * s,
    };
  }
}
