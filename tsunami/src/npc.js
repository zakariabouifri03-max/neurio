// npc.js — townsfolk crowd (fleeing the wave) + wildlife for hunting
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';
import { clamp, clamp01, lerp, damp, rand, pick, mulberry32, TAU, colorGeo, xf } from './util.js';

function humanGeometry() {
  const parts = [];
  const torso = new THREE.CapsuleGeometry(0.18, 0.52, 3, 8);
  parts.push(colorGeo(torso, new THREE.Color(0x6c7f9a)));
  const head = new THREE.SphereGeometry(0.115, 10, 8);
  parts.push(colorGeo(xf(head, { pos: [0, 0.62, 0] }), new THREE.Color(0xd9a87c)));
  for (const s of [-1, 1]) {
    const leg = new THREE.CapsuleGeometry(0.075, 0.5, 3, 6);
    parts.push(colorGeo(xf(leg, { pos: [s * 0.085, -0.42, 0] }), new THREE.Color(0x2f3844)));
    const arm = new THREE.CapsuleGeometry(0.055, 0.42, 3, 6);
    parts.push(colorGeo(xf(arm, { pos: [s * 0.24, 0.02, 0], rot: [0, 0, s * 0.18] }), new THREE.Color(0x6c7f9a)));
  }
  const g = mergeGeometries(parts, false);
  g.computeVertexNormals();
  return g;
}

function animalGeometry(kind) {
  const parts = [];
  const bodyC = kind === 'goat' ? 0x9c8c72 : kind === 'deer' ? 0x8a6440 : 0xe8e8e4;
  const dark = kind === 'goat' ? 0x4a3a2a : 0x5a3f28;
  parts.push(colorGeo(xf(new THREE.CapsuleGeometry(0.28, 0.62, 3, 8), { rot: [0, 0, Math.PI / 2] }), new THREE.Color(bodyC)));
  const headR = kind === 'deer' ? 0.16 : 0.15;
  parts.push(colorGeo(xf(new THREE.SphereGeometry(headR, 8, 7), { pos: [0.52, 0.16, 0] }), new THREE.Color(bodyC)));
  for (const sx of [-0.25, 0.25]) for (const sz of [-0.17, 0.17]) {
    parts.push(colorGeo(xf(new THREE.CapsuleGeometry(0.065, 0.5, 3, 6), { pos: [sx, -0.42, sz] }), new THREE.Color(dark)));
  }
  if (kind === 'goat') {
    for (const s of [-1, 1]) parts.push(colorGeo(xf(new THREE.ConeGeometry(0.04, 0.22, 5), { pos: [0.5, 0.32, s * 0.08], rot: [s * 0.5, 0, -0.3] }), new THREE.Color(0x3a2f22)));
  }
  if (kind === 'deer') {
    for (const s of [-1, 1]) {
      parts.push(colorGeo(xf(new THREE.CylinderGeometry(0.015, 0.02, 0.4, 5), { pos: [0.52, 0.45, s * 0.07], rot: [s * 0.35, 0, 0] }), new THREE.Color(0x6b5233)));
    }
    parts.push(colorGeo(xf(new THREE.ConeGeometry(0.05, 0.16, 5), { pos: [0.42, 0.1, 0] }), new THREE.Color(0x2c2018)));
  }
  if (kind === 'crab') {
    parts.push(colorGeo(xf(new THREE.SphereGeometry(0.16, 8, 6), { scale: [1.4, 0.7, 1.1] }), new THREE.Color(0xb4462c)));
    for (const s of [-1, 1]) parts.push(colorGeo(xf(new THREE.SphereGeometry(0.06, 6, 5), { pos: [0.22, 0.02, s * 0.18] }), new THREE.Color(0xd46a4a)));
  }
  const g = mergeGeometries(parts, false);
  g.computeVertexNormals();
  return g;
}

const PEOPLE_COUNT = { low: 24, medium: 60, high: 110, ultra: 150 };

export class NPCSystem {
  constructor({ scene, world, ocean, fx, audio, quality = 'high' }) {
    this.scene = scene; this.world = world; this.ocean = ocean; this.fx = fx; this.audio = audio;
    this.quality = quality;
    this.rng = mulberry32(6060);
    this.people = [];
    this.animals = [];
    this.flock = [];

    // ---- crowd
    const N = PEOPLE_COUNT[quality] || 60;
    const geo = humanGeometry();
    this.peopleMesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.02 }), N);
    this.peopleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.peopleMesh.castShadow = true;
    this.peopleMesh.frustumCulled = false;
    this.peopleMesh.count = 0;
    scene.add(this.peopleMesh);
    const c = world.city;
    for (let i = 0; i < N; i++) {
      const a = this.rng() * TAU, r = 40 + this.rng() * 300;
      const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
      const y = world.heightAt(x, z);
      if (y < 4 || y > 34) continue;
      this.people.push({
        x, y, z, yaw: this.rng() * TAU, speed: 1.1 + this.rng() * 0.7, state: 'idle', t: this.rng() * 6,
        target: null, safe: null, vx: 0, vz: 0, escaped: false, panic: 0.2 + this.rng() * 0.3,
        swimT: 0, shirt: new THREE.Color().setHSL(this.rng(), 0.35 + this.rng() * 0.4, 0.35 + this.rng() * 0.35),
      });
    }
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3(1, 1, 1);
    this._color = new THREE.Color();
    this.peopleMesh.count = this.people.length;
    this.people.forEach((p, i) => this.peopleMesh.setColorAt(i, p.shirt));

    // ---- wildlife
    this.spawnAnimals();
  }

  spawnAnimals() {
    const specs = [
      { kind: 'goat', n: this.quality === 'low' ? 8 : 20, zone: [500, 1250, -900, 900], yMin: 60, yMax: 320 },
      { kind: 'deer', n: this.quality === 'low' ? 6 : 14, zone: [200, 800, -800, 800], yMin: 8, yMax: 180 },
      { kind: 'crab', n: this.quality === 'low' ? 10 : 26, zone: [-400, 400, -800, 800], yMin: -1, yMax: 6, slow: true },
    ];
    for (const sp of specs) {
      const geo = animalGeometry(sp.kind);
      const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.9 }), sp.n);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.scene.add(mesh);
      const list = [];
      for (let i = 0; i < sp.n; i++) {
        const x = rand(this.rng, sp.zone[0], sp.zone[1]), z = rand(this.rng, sp.zone[2], sp.zone[3]);
        const y = this.world.heightAt(x, z);
        if (y < sp.yMin || y > sp.yMax) continue;
        list.push({
          kind: sp.kind, x, y, z, yaw: this.rng() * TAU, speed: sp.slow ? 0.6 : 1.4 + this.rng() * 1.2,
          state: 'roam', t: this.rng() * 5, tx: x, tz: z, hp: sp.kind === 'crab' ? 6 : 30,
          alive: true, mesh: null, index: list.length, fade: 1, fleeT: 0,
        });
      }
      mesh.count = list.length;
      list.forEach((a, i) => { a.mesh = mesh; a.index = i; });
      this.animals.push(...list);
    }
    // ---- seagulls circling the coast
    const gN = this.quality === 'low' ? 6 : 16;
    const gGeo = new THREE.BufferGeometry();
    const verts = [];
    // simple bent-wing bird silhouette
    verts.push(0, 0, 0.22, 0.5, 0.06, 0, 0, 0, -0.22);
    verts.push(0, 0, 0.22, -0.5, 0.06, 0, 0, 0, -0.22);
    gGeo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    gGeo.computeVertexNormals();
    this.gullMesh = new THREE.InstancedMesh(gGeo, new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.7, side: THREE.DoubleSide }), gN);
    this.gullMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.gullMesh.frustumCulled = false;
    this.scene.add(this.gullMesh);
    for (let i = 0; i < gN; i++) {
      const z = rand(this.rng, -700, 700);
      this.flock.push({ cx: this.rng() < 0.5 ? this.world.coastX(z) + 40 : 900, cz: z, r: 30 + this.rng() * 50, a: this.rng() * TAU, speed: 0.25 + this.rng() * 0.3, y: 18 + this.rng() * 22 });
    }
  }

  /** choose an escape destination: tower, uphill, or the mountain road */
  pickSafe(p) {
    const rng = this.rng;
    const opts = [];
    if (this.world.spawns.tower) opts.push({ x: this.world.spawns.tower.x, z: this.world.spawns.tower.z, w: 3 });
    if (this.world.spawns.roadCamp) opts.push({ x: this.world.spawns.roadCamp.x, z: this.world.spawns.roadCamp.z, w: 1.2 });
    if (this.world.upperTown) opts.push({ x: this.world.upperTown.x, z: this.world.upperTown.z, w: 2.4 });
    if (this.world.spawns.camp) opts.push({ x: this.world.spawns.camp.x, z: this.world.spawns.camp.z, w: 0.5 });
    // uphill sample
    let best = null, bestH = -1e9;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      const x = p.x + Math.cos(a) * 90, z = p.z + Math.sin(a) * 90;
      const h = this.world.heightAt(x, z);
      if (h > bestH) { bestH = h; best = { x, z }; }
    }
    if (best) opts.push({ ...best, w: 2 });
    let total = 0;
    for (const o of opts) total += o.w;
    let r = rng() * total;
    for (const o of opts) { r -= o.w; if (r <= 0) return o; }
    return opts[0];
  }

  scare(x, z, radius = 60) {
    for (const p of this.people) {
      if (Math.hypot(p.x - x, p.z - z) < radius && p.state !== 'flee' && p.state !== 'swim') {
        p.state = 'flee';
        p.safe = this.pickSafe(p);
      }
    }
    for (const a of this.animals) {
      if (a.alive && Math.hypot(a.x - x, a.z - z) < radius) { a.state = 'flee'; a.fleeT = 4; }
    }
  }

  update(dt, player, state = {}) {
    const { panic = 0, tsunami = false } = state;
    const water = this.ocean;
    // ---------- people
    let idx = 0;
    for (const p of this.people) {
      if (p.escaped) continue;
      p.t -= dt;
      const wy = water.waterYAt(p.x, p.z);
      const ground = this.world.heightAt(p.x, p.z);
      const submerged = wy - ground > 0.6 && wy > ground;
      if (submerged) {
        if (p.state !== 'swim') { p.state = 'swim'; p.swimT = 0; this.fx?.splash(p.x, wy, p.z, 0.6); }
      } else if (p.state === 'swim') {
        p.state = 'flee';
      }
      if (tsunami && p.state === 'idle') { p.state = 'flee'; p.safe = this.pickSafe(p); }
      switch (p.state) {
        case 'idle': {
          if (p.t <= 0) { p.t = 2 + this.rng() * 5; p.state = this.rng() < 0.55 ? 'walk' : 'idle'; if (p.state === 'walk') { const a = this.rng() * TAU; p.tx = p.x + Math.cos(a) * 20; p.tz = p.z + Math.sin(a) * 20; } }
          break;
        }
        case 'walk': {
          const dx = (p.tx ?? p.x) - p.x, dz = (p.tz ?? p.z) - p.z;
          const d = Math.hypot(dx, dz);
          if (d < 1.5) p.state = 'idle';
          else { p.x += (dx / d) * p.speed * dt; p.z += (dz / d) * p.speed * dt; p.yaw = Math.atan2(dx, dz); }
          break;
        }
        case 'flee': {
          if (!p.safe) p.safe = this.pickSafe(p);
          const dx = p.safe.x - p.x, dz = p.safe.z - p.z;
          const d = Math.hypot(dx, dz);
          const speed = lerp(3.4, 6.2, clamp01(panic)) * (0.85 + this.rng() * 0.2);
          if (d < 2.5) {
            // reached safety: climb if it's the tower
            if (Math.hypot(p.x - (this.world.spawns.tower?.x ?? 1e9), p.z - (this.world.spawns.tower?.z ?? 1e9)) < 6) p.escaped = true;
            else p.safe = this.pickSafe(p);
          } else {
            let mx = (dx / d) * speed, mz = (dz / d) * speed;
            // avoid running into deep water
            const ahead = 6;
            if (water.waterYAt(p.x + (dx / d) * ahead, p.z + (dz / d) * ahead) > this.world.heightAt(p.x + (dx / d) * ahead, p.z + (dz / d) * ahead) + 0.7) {
              mx += -(dz / d) * speed * 0.8; mz += (dx / d) * speed * 0.8;
            }
            p.x += mx * dt; p.z += mz * dt;
            p.yaw = Math.atan2(mx, mz);
            if (this.rng() < dt * 0.35) this.audio?.play('panic', { position: [p.x, p.y + 1.5, p.z] });
          }
          break;
        }
        case 'swim': {
          p.swimT += dt;
          const cur = water.current;
          p.x += (cur.x * cur.speed * 1.2 + Math.sin(p.swimT * 2.1) * 0.3) * dt;
          p.z += (cur.z * cur.speed * 1.2 + Math.cos(p.swimT * 1.8) * 0.3) * dt;
          p.y = wy - 0.55;
          if (p.swimT > 24 + this.rng() * 30) { p.escaped = true; }  // swept away — gone from the sim
          if (this.rng() < dt * 0.6) this.audio?.play('splash', { position: [p.x, p.y, p.z] });
          break;
        }
        default: break;
      }
      if (p.state !== 'swim') p.y = Math.max(ground, wy - 0.9);
      // write the instance
      const bob = p.state === 'swim' ? Math.sin(performance.now() * 0.004 + p.x) * 0.06 : 0;
      this._q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.yaw);
      this._m.compose(new THREE.Vector3(p.x, p.y + bob, p.z), this._q, this._s);
      this.peopleMesh.setMatrixAt(idx, this._m);
      idx++;
      if (idx >= this.people.length) break;
    }
    this.peopleMesh.count = idx;
    this.peopleMesh.instanceMatrix.needsUpdate = true;

    // ---------- animals
    for (const a of this.animals) {
      if (!a.alive) continue;
      a.t -= dt;
      const dx = player.pos.x - a.x, dz = player.pos.z - a.z;
      const dp = Math.hypot(dx, dz);
      const fleeRange = a.kind === 'crab' ? 6 : 20;
      if (a.state !== 'flee' && dp < fleeRange) { a.state = 'flee'; a.fleeT = 3 + this.rng() * 3; }
      if (a.state === 'flee') {
        a.fleeT -= dt;
        const sp = a.kind === 'crab' ? 2.4 : 6.4;
        a.x -= (dx / Math.max(dp, 0.001)) * sp * dt;
        a.z -= (dz / Math.max(dp, 0.001)) * sp * dt;
        a.yaw = Math.atan2(-dx, -dz);
        if (a.fleeT <= 0) a.state = 'roam';
      } else {
        if (a.t <= 0) {
          a.t = 2 + this.rng() * 5;
          const ang = this.rng() * TAU, rr = 6 + this.rng() * 26;
          a.tx = a.x + Math.cos(ang) * rr; a.tz = a.z + Math.sin(ang) * rr;
        }
        if (a.tx !== undefined) {
          const tdx = a.tx - a.x, tdz = a.tz - a.z;
          const d = Math.hypot(tdx, tdz);
          if (d > 1.2) {
            const sp = a.speed * (a.kind === 'crab' ? 0.5 : 1);
            a.x += (tdx / d) * sp * dt; a.z += (tdz / d) * sp * dt;
            a.yaw = Math.atan2(tdx, tdz);
          }
        }
      }
      a.y = this.world.heightAt(a.x, a.z);
      if (a.hp <= 0) {
        a.alive = false;
        a.mesh.count = Math.max(0, a.mesh.count - 1);
      }
      const scale = a.kind === 'crab' ? 0.6 : 1;
      this._q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), a.yaw);
      this._m.compose(new THREE.Vector3(a.x, a.y + 0.45 * scale, a.z), this._q, new THREE.Vector3(scale, scale, scale));
      a.mesh.setMatrixAt(a.index, this._m);
      a.mesh.instanceMatrix.needsUpdate = true;
    }

    // ---------- gulls
    for (let i = 0; i < this.flock.length; i++) {
      const g = this.flock[i];
      g.a += g.speed * dt * (tsunami ? 2.2 : 1);
      const x = g.cx + Math.cos(g.a) * g.r;
      const z = g.cz + Math.sin(g.a) * g.r;
      const y = g.y + Math.sin(g.a * 3.1) * 2.5;
      this._q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -g.a + Math.PI / 2);
      this._m.compose(new THREE.Vector3(x, y, z), this._q, this._s);
      this.gullMesh.setMatrixAt(i, this._m);
    }
    this.gullMesh.instanceMatrix.needsUpdate = true;

    // ---------- fish jumping near the player (ambience)
    this.fishTimer = (this.fishTimer ?? 3) - dt;
    if (this.fishTimer <= 0) {
      this.fishTimer = 2.5 + this.rng() * 6;
      const ang = this.rng() * TAU, r = 12 + this.rng() * 45;
      const x = player.pos.x + Math.cos(ang) * r, z = player.pos.z + Math.sin(ang) * r;
      const wy = water.waterYAt(x, z);
      if (wy > this.world.heightAt(x, z) + 0.8) this.fx?.splash(x, wy, z, 0.5);
    }
  }

  /** melee / thrown-hit resolution */
  attack(pos, dir, range = 2.6, damage = 22) {
    let best = null, bd = range * range;
    for (const a of this.animals) {
      if (!a.alive) continue;
      const dx = a.x - pos.x, dz = a.z - pos.z, dy = (a.y + 0.5) - pos.y;
      const d2 = dx * dx + dy * dy * 0.6 + dz * dz;
      if (d2 > bd) continue;
      const dot = (dx * dir.x + dz * dir.z) / Math.max(0.001, Math.hypot(dx, dz));
      if (dot < 0.55) continue;
      bd = d2; best = a;
    }
    if (best) {
      best.hp -= damage;
      best.state = 'flee'; best.fleeT = 5;
      this.fx?.blood(best.x, best.y + 0.6, best.z, 6);
      if (best.hp <= 0) { best.alive = false; this.audio?.play('hurt', { position: [best.x, best.y, best.z] }); }
      return best;
    }
    return null;
  }

  nearestCarcass(pos, range = 3.0) {
    let best = null, bd = range * range;
    for (const a of this.animals) {
      if (a.alive) continue;
      const d = (a.x - pos.x) ** 2 + (a.z - pos.z) ** 2;
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  }

  peopleSafe() { let n = 0; for (const p of this.people) if (p.escaped) n++; return n; }
}
