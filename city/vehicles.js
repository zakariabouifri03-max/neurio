// ── Neurio City · vehicles ─────────────────────────────────────────────────
// A car built from extruded side profiles (clear-coated paint, glass, real
// wheels that spin and steer), a grip-based driving model for the player and
// lane-following traffic that stops for red lights and keeps its distance.
import * as THREE from 'three';
import { clamp, angDiff } from '../src/util.js';
import { GRID, DIRS, LANE, lineCoord, signalGreen, STOP_DIST, ISLAND_R } from './world.js';

// ── shared car geometry / materials ────────────────────────────────────────
function extrudeAcross(shape, width, bevel = 0.05) {
  const depth = width - bevel * 2;
  const g = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 2, steps: 1,
  });
  g.translate(0, 0, -depth / 2);      // centre across the width
  g.rotateY(Math.PI / 2);             // profile x (length) → −z (forward)
  return g;
}
function poly(pts) {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let k = 1; k < pts.length; k++) s.lineTo(pts[k][0], pts[k][1]);
  s.closePath();
  return s;
}

let GEO = null;
const MAT = {};
function assets() {
  if (GEO) return;
  GEO = {
    body: extrudeAcross(poly([[-2.15, 0.42], [2.12, 0.42], [2.2, 0.66], [2.04, 0.9], [0.9, 1.0], [-1.65, 1.0], [-2.12, 0.84], [-2.15, 0.62]]), 1.84, 0.07),
    cabin: extrudeAcross(poly([[0.9, 1.0], [0.32, 1.42], [-0.95, 1.42], [-1.65, 1.0]]), 1.5, 0.05),
    roof: extrudeAcross(poly([[0.32, 1.42], [-0.95, 1.42], [-0.95, 1.47], [0.32, 1.47]]), 1.58, 0.02),
    tire: new THREE.CylinderGeometry(0.36, 0.36, 0.27, 20).rotateZ(Math.PI / 2),
    rim: new THREE.CylinderGeometry(0.22, 0.22, 0.28, 10).rotateZ(Math.PI / 2),
    light: new THREE.BoxGeometry(0.2, 0.1, 0.05),
    mirror: new THREE.BoxGeometry(0.14, 0.1, 0.22),
  };
  MAT.glass = new THREE.MeshPhysicalMaterial({ color: 0x0b1118, metalness: 0.2, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.3 });
  MAT.tire = new THREE.MeshStandardMaterial({ color: 0x0e0f11, roughness: 0.9 });
  MAT.rim = new THREE.MeshStandardMaterial({ color: 0xc3c8d0, metalness: 0.95, roughness: 0.22 });
  MAT.trim = new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.5 });
}

export const CAR_COLORS = ['#e11d48', '#2563eb', '#f5f5f4', '#111827', '#f59e0b', '#10b981', '#7c3aed', '#94a3b8', '#fde047', '#0ea5e9'];

/** Builds one car. Local frame: forward = −z, up = +y, origin on the ground. */
export function makeCar(paintHex) {
  assets();
  const group = new THREE.Group();
  const paint = new THREE.MeshPhysicalMaterial({ color: paintHex, metalness: 0.4, roughness: 0.34, clearcoat: 1, clearcoatRoughness: 0.05 });
  const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff1d0, emissiveIntensity: 0 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x3a0505, emissive: 0xff1a1a, emissiveIntensity: 0.35 });

  const add = (geo, mat, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    return m;
  };
  add(GEO.body, paint);
  add(GEO.cabin, MAT.glass);
  add(GEO.roof, paint, 0, 0, 0);

  const steer = [], spins = [];
  for (const [x, z, front] of [[-0.82, -1.36, true], [0.82, -1.36, true], [-0.82, 1.42, false], [0.82, 1.42, false]]) {
    const hub = new THREE.Group();
    hub.position.set(x, 0.36, z);
    const spin = new THREE.Group();
    hub.add(spin);
    const tire = new THREE.Mesh(GEO.tire, MAT.tire);
    const rim = new THREE.Mesh(GEO.rim, MAT.rim);
    tire.castShadow = true; spin.add(tire, rim);
    group.add(hub);
    if (front) steer.push(hub);
    spins.push(spin);
  }
  add(GEO.light, headMat, -0.62, 0.72, -2.12);
  add(GEO.light, headMat, 0.62, 0.72, -2.12);
  add(GEO.light, tailMat, -0.66, 0.74, 2.13);
  add(GEO.light, tailMat, 0.66, 0.74, 2.13);
  add(GEO.mirror, MAT.trim, -1.0, 1.0, -0.8);
  add(GEO.mirror, MAT.trim, 1.0, 1.0, -0.8);
  return { group, paint, headMat, tailMat, steer, spins };
}

// ── player ────────────────────────────────────────────────────────────────
export class PlayerCar {
  constructor(scene, x, z, h = 0) {
    this.car = makeCar('#e11d48');
    this.group = this.car.group;
    scene.add(this.group);
    this.x = x; this.z = z; this.h = h;
    this.s = 0;          // forward speed (m/s)
    this.lat = 0;        // lateral (slip) speed, + = right
    this.steerAng = 0;
    this.spin = 0;
    this.brakeLight = 0;
    this.bump = 0;
    this.headlight = new THREE.SpotLight(0xfff0d2, 0, 160, Math.PI / 6.5, 0.45, 1.5);
    this.headlight.position.set(0, 0.9, -2.2);
    this.headlight.target.position.set(0, 0.2, -30);
    this.group.add(this.headlight, this.headlight.target);
    this.update(0, { throttle: 0, brake: 0, steer: 0, handbrake: false }, null, null);
  }

  get speedKmh() { return Math.abs(this.s) * 3.6; }

  update(dt, inp, colliders, traffic) {
    if (dt > 0) {
      // longitudinal: power curve, brakes, reverse, drag
      if (inp.throttle > 0) {
        if (this.s >= -0.5) this.s += 9.5 * Math.pow(Math.max(0, 1 - this.s / 62), 1.4) * inp.throttle * dt;
        else this.s += 5 * dt;
      }
      if (inp.brake > 0) {
        if (this.s > 0.8) this.s -= 16 * inp.brake * dt;
        else this.s -= 4.5 * inp.brake * dt;
      }
      if (!inp.throttle && !inp.brake) this.s -= Math.sign(this.s) * Math.min(Math.abs(this.s), 1.2 * dt);
      this.s -= this.s * Math.abs(this.s) * 0.00045 * dt;          // aero drag
      if (inp.handbrake) this.s -= Math.sign(this.s) * Math.min(Math.abs(this.s), 10 * dt);
      this.s = clamp(this.s, -14, 66);

      // steering: lock shrinks with speed
      const lock = 0.6 - 0.53 * clamp(Math.abs(this.s) / 40, 0, 1);   // 0.6 rad parking → 0.07 rad at speed
      const target = inp.steer * lock;
      this.steerAng += (target - this.steerAng) * Math.min(1, dt * (inp.steer ? 7 : 10));

      // planar bicycle model with lateral slip
      const yaw = (this.s * Math.tan(this.steerAng)) / 2.7 * (inp.handbrake ? 1.35 : 1);
      const grip = inp.handbrake ? 2.4 : 9.0;
      this.lat += (yaw * this.s - grip * this.lat) * dt;
      this.lat = clamp(this.lat, -12, 12);
      this.h += yaw * dt;
      this.h = Math.atan2(Math.sin(this.h), Math.cos(this.h));

      const fx = -Math.sin(this.h), fz = -Math.cos(this.h);
      const rx = Math.cos(this.h), rz = -Math.sin(this.h);
      this.x += (fx * this.s + rx * this.lat) * dt;
      this.z += (fz * this.s + rz * this.lat) * dt;
      this.spin += (this.s * dt) / 0.36;
      this.brakeLight += ((inp.brake > 0 || inp.handbrake || this.s < -0.5 ? 1 : 0) - this.brakeLight) * Math.min(1, dt * 12);
      this.bump = Math.max(0, this.bump - dt * 2);

      if (colliders) this.resolve(colliders, traffic);
    }
    this.apply();
  }

  resolve(c, traffic) {
    const R = 1.25;
    let hit = 0;
    for (const b of c.boxes) {
      const cx = clamp(this.x, b.x0, b.x1), cz = clamp(this.z, b.z0, b.z1);
      let dx = this.x - cx, dz = this.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= R * R) continue;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2), push = R - d;
        this.x += (dx / d) * push; this.z += (dz / d) * push;
      } else {
        // centre inside the footprint: push out through the nearest face
        const opts = [[b.x0 - this.x, -1, 0], [b.x1 - this.x, 1, 0], [b.z0 - this.z, 0, -1], [b.z1 - this.z, 0, 1]];
        opts.sort((p, q) => Math.abs(p[0]) - Math.abs(q[0]));
        const [dist, nx, nz] = opts[0];
        this.x += nx * (Math.abs(dist) + R); this.z += nz * (Math.abs(dist) + R);
      }
      hit = Math.max(hit, Math.abs(this.s));
      this.s *= 0.55; this.lat *= 0.4;
    }
    for (const o of c.circles) {
      const dx = this.x - o.x, dz = this.z - o.z;
      const min = R + o.r, d2 = dx * dx + dz * dz;
      if (d2 >= min * min || d2 < 1e-8) continue;
      const d = Math.sqrt(d2), push = min - d;
      this.x += (dx / d) * push; this.z += (dz / d) * push;
      hit = Math.max(hit, Math.abs(this.s));
      this.s *= 0.7;
    }
    if (traffic) {
      for (const t of traffic.cars) {
        const dx = this.x - t.x, dz = this.z - t.z, min = 2.5, d2 = dx * dx + dz * dz;
        if (d2 >= min * min || d2 < 1e-8) continue;
        // shove both cars apart (traffic gives way) and bleed a little speed per contact
        const d = Math.sqrt(d2), push = min - d;
        this.x += (dx / d) * push * 0.6; this.z += (dz / d) * push * 0.6;
        t.x -= (dx / d) * push * 0.4; t.z -= (dz / d) * push * 0.4;
        if (Math.abs(this.s) > Math.abs(t.v)) { hit = Math.max(hit, Math.abs(this.s) - t.v); this.s = this.s * 0.9 + t.v * 0.1; }
        this.lat *= 0.8;
      }
    }
    if (hit > 6) this.bump = Math.min(1, hit / 25);
    // soft world edge
    const r = Math.hypot(this.x, this.z), lim = ISLAND_R - 25;
    if (r > lim) { this.x *= lim / r; this.z *= lim / r; this.s *= 0.5; }
  }

  apply() {
    this.group.position.set(this.x, 0, this.z);
    this.group.rotation.y = this.h;
    this.car.steer.forEach((w) => (w.rotation.y = this.steerAng));
    this.car.spins.forEach((w) => (w.rotation.x = this.spin));
    this.car.tailMat.emissiveIntensity = 0.35 + this.brakeLight * 2.2;
  }

  forward() { return [-Math.sin(this.h), -Math.cos(this.h)]; }
}

// ── traffic ───────────────────────────────────────────────────────────────
function validDirs(i, j, prev) {
  const out = [];
  for (let d = 0; d < 4; d++) {
    if (prev !== undefined && d === (prev ^ 1)) continue;   // never U-turn
    const ni = i + DIRS[d][0], nj = j + DIRS[d][1];
    if (ni < 0 || nj < 0 || ni >= GRID || nj >= GRID) continue;
    out.push(d);
  }
  return out;
}

function pickDir(i, j, prev, rnd) {
  const opts = validDirs(i, j, prev);
  if (!opts.length) return prev ^ 1;
  const w = opts.map((d) => (d === prev ? 5 : 1));
  let r = rnd() * w.reduce((a, b) => a + b, 0);
  for (let k = 0; k < opts.length; k++) { r -= w[k]; if (r <= 0) return opts[k]; }
  return opts[opts.length - 1];
}

const laneXY = (i, j, d) => ({ x: lineCoord(i) + LANE[d][0], z: lineCoord(j) + LANE[d][1] });

export class Traffic {
  /** avoid: {x, z, r} keeps the spawn area clear of traffic. */
  constructor(scene, rnd, count, world, avoid = null) {
    this.cars = [];
    this.world = world;
    for (let n = 0; n < count; n++) {
      let i, j, d, B, p, a, b, x, z;
      for (let tries = 0; tries < 40; tries++) {
        i = Math.floor(rnd() * GRID); j = Math.floor(rnd() * GRID);
        const opts = validDirs(i, j);
        d = opts[Math.floor(rnd() * opts.length)];
        B = { i: i + DIRS[d][0], j: j + DIRS[d][1] };
        p = rnd();
        a = laneXY(i, j, d); b = laneXY(B.i, B.j, d);
        x = a.x + (b.x - a.x) * p; z = a.z + (b.z - a.z) * p;
        if (!avoid || Math.hypot(x - avoid.x, z - avoid.z) > avoid.r) break;
      }
      const car = makeCar(CAR_COLORS[n % CAR_COLORS.length]);
      scene.add(car.group);
      const c = {
        car, x, z, h: 0,
        v: 0, desired: 9 + rnd() * 5, d, ni: B.i, nj: B.j,
        wps: [laneXY(B.i, B.j, d)], fx: DIRS[d][0], fz: DIRS[d][1], rnd, spin: 0,
      };
      c.h = Math.atan2(-c.fx, -c.fz);
      this.cars.push(c);
    }
  }

  extend(c) {
    const B = { i: c.ni, j: c.nj };
    const d2 = pickDir(B.i, B.j, c.d, c.rnd);
    if (d2 !== c.d) c.wps.push(laneXY(B.i, B.j, d2));
    const C = { i: B.i + DIRS[d2][0], j: B.j + DIRS[d2][1] };
    c.wps.push(laneXY(C.i, C.j, d2));
    c.d = d2; c.ni = C.i; c.nj = C.j;
  }

  update(dt, clock) {
    const cars = this.cars;
    for (const c of cars) {
      // ── speed limit from signals and cars ahead ──
      let want = c.desired;
      if (!c.wps.length) this.extend(c);
      const nx = lineCoord(c.ni), nz = lineCoord(c.nj);
      const axis = c.d < 2 ? 0 : 1;
      const dn = Math.hypot(c.x - nx, c.z - nz);
      const stopD = dn - STOP_DIST;
      if (!signalGreen(c.ni, c.nj, axis, clock) && stopD > -0.5 && stopD < 45) {
        want = Math.min(want, Math.sqrt(Math.max(0, 2 * 5 * stopD)));
      }
      for (const o of cars) {
        if (o === c) continue;
        const rx = o.x - c.x, rz = o.z - c.z;
        const f = rx * c.fx + rz * c.fz;
        const lat = Math.abs(rx * c.fz - rz * c.fx);
        if (f > 0 && f < 10 && lat < 2.2) {
          want = Math.min(want, o.v * 0.9);
          if (f < 6.5) want = 0;
        }
      }
      if (c.v < want) c.v += Math.min(want - c.v, 3.2 * dt);
      else c.v -= Math.min(c.v - want, 7 * dt);
      c.v = Math.max(0, c.v);

      // ── follow waypoints ──
      let step = c.v * dt;
      let guard = 0;
      while (step > 0 && c.wps.length && guard++ < 6) {
        const t = c.wps[0];
        const dx = t.x - c.x, dz = t.z - c.z, dist = Math.hypot(dx, dz);
        if (dist > 1e-6) { c.fx = dx / dist; c.fz = dz / dist; }
        if (dist <= step) {
          c.x = t.x; c.z = t.z; step -= dist;
          c.wps.shift();
          if (!c.wps.length) this.extend(c);
        } else {
          c.x += (dx / dist) * step; c.z += (dz / dist) * step; step = 0;
        }
      }
      const want_h = Math.atan2(-c.fx, -c.fz);
      c.h += angDiff(c.h, want_h) * Math.min(1, dt * 9);
      c.spin += (c.v * dt) / 0.36;
      c.car.group.position.set(c.x, 0, c.z);
      c.car.group.rotation.y = c.h;
      c.car.spins.forEach((w) => (w.rotation.x = c.spin));
      c.car.tailMat.emissiveIntensity = 0.35 + (c.v < c.desired * 0.5 ? 0.9 : 0);
    }
  }
}
