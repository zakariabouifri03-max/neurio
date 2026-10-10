// BLOCK CITY ULTRA — vehicle physics + voxel vehicle construction.
// A simplified but weight-transfer-aware model: longitudinal engine/brake/drag,
// lateral tyre slip with a grip circle, speed-sensitive steering and a
// handbrake that breaks rear grip (drift). Mirrors the intent of
// ChaosWheeledVehicle in the engine build, not its exact solver.

import * as THREE from '../vendor/three.module.js';
import { clamp, lerp, damp, angDiff } from './util.js';
import { MAT } from './voxel.js';

export const VEHICLE_CLASSES = {
  Sedan:     { mass: 1500, power: 9000, topSpeed: 46, grip: 1.00, brake: 20, len: 4.6, wid: 2.0, hgt: 1.5, value: 24000 },
  CompactCar:{ mass: 1150, power: 6500, topSpeed: 38, grip: 1.05, brake: 18, len: 3.9, wid: 1.8, hgt: 1.5, value: 15000 },
  MuscleCar: { mass: 1700, power: 15000,topSpeed: 58, grip: 0.92, brake: 22, len: 4.8, wid: 2.1, hgt: 1.4, value: 62000 },
  SuperCar:  { mass: 1300, power: 21000,topSpeed: 78, grip: 1.18, brake: 30, len: 4.5, wid: 2.0, hgt: 1.15, value: 240000 },
  SUV:       { mass: 2100, power: 12000,topSpeed: 52, grip: 0.95, brake: 22, len: 5.0, wid: 2.1, hgt: 1.9, value: 48000 },
  Van:       { mass: 2200, power: 8000, topSpeed: 40, grip: 0.88, brake: 18, len: 5.4, wid: 2.1, hgt: 2.3, value: 32000 },
  PickupTruck:{mass: 2000, power: 11000,topSpeed: 48, grip: 0.90, brake: 20, len: 5.4, wid: 2.1, hgt: 1.9, value: 41000 },
  Bus:       { mass: 9000, power: 16000,topSpeed: 36, grip: 0.80, brake: 16, len: 11.0,wid: 2.5, hgt: 3.2, value: 90000 },
  SemiTruck: { mass: 14000,power: 24000,topSpeed: 34, grip: 0.75, brake: 14, len: 15.0,wid: 2.6, hgt: 3.8, value: 130000 },
  Motorcycle:{ mass: 320,  power: 5200, topSpeed: 62, grip: 1.25, brake: 26, len: 2.2, wid: 0.9, hgt: 1.4, value: 28000 },
  PoliceCruiser:{mass:1800, power: 14000,topSpeed: 60, grip: 1.06, brake: 26, len: 4.8, wid: 2.0, hgt: 1.5, value: 55000 },
};

// ---------------------------------------------------------------------------
// Voxel vehicle mesh
// ---------------------------------------------------------------------------
export function buildVehicleMesh(cls, opts = {}) {
  const S = VEHICLE_CLASSES[cls] || VEHICLE_CLASSES.Sedan;
  const g = new THREE.Group();
  g.name = 'Vehicle:' + cls;

  const paint = opts.color ?? 0x2a5fd6;
  const lights = [];
  const add = (mat, x, y, z, sx, sy, sz, colorOverride) => {
    const params = {
      color: colorOverride ?? (mat === MAT.PAINT ? paint : 0xffffff),
      roughness: mat === MAT.PAINT ? 0.16 : 0.6,
      metalness: mat === MAT.PAINT ? 0.6 : 0.3,
    };
    if (mat === MAT.HEADLIGHT) {
      params.color = 0xfff6e0; params.emissive = new THREE.Color(0xfff2d0); params.emissiveIntensity = 0;
      params.roughness = 0.2;
    } else if (mat === MAT.TAILLIGHT) {
      params.color = 0x3a0a06; params.emissive = new THREE.Color(0xff1a0a); params.emissiveIntensity = 0.4;
      params.roughness = 0.35;
    }
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), new THREE.MeshStandardMaterial(params));
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    if (mat === MAT.HEADLIGHT || mat === MAT.TAILLIGHT) lights.push(m);
    return m;
  };

  const L = S.len, W = S.wid, H = S.hgt;
  const isBike = cls === 'Motorcycle';

  if (isBike) {
    add(MAT.PAINT, 0, 0.62, 0, 0.45, 0.4, 1.9);
    add(MAT.DARKMETAL, 0.0, 0.95, -0.25, 0.35, 0.3, 0.7);
    add(MAT.TIRE, 0, 0.36, 0.95, 0.28, 0.72, 0.28);
    add(MAT.TIRE, 0, 0.36, -0.95, 0.32, 0.72, 0.32);
    add(MAT.HEADLIGHT, 0, 0.8, 1.05, 0.3, 0.22, 0.15);
    add(MAT.TAILLIGHT, 0, 0.8, -1.05, 0.28, 0.16, 0.12);
  } else {
    // chassis + cabin + greenhouse: blocky but proportioned
    add(MAT.PAINT, 0, H * 0.42, 0, W, H * 0.55, L);
    add(MAT.PAINT, 0, H * 0.85, -L * 0.06, W * 0.92, H * 0.5, L * 0.52);
    // windows
    const winMat = new THREE.MeshStandardMaterial({
      color: 0x121a26, roughness: 0.06, metalness: 0.85,
      transparent: true, opacity: 0.72,
    });
    const win = new THREE.Mesh(new THREE.BoxGeometry(W * 0.94, H * 0.36, L * 0.54), winMat);
    win.position.set(0, H * 0.9, -L * 0.06);
    g.add(win);
    // bumpers + skirts
    add(MAT.DARKMETAL, 0, H * 0.28, L * 0.5 + 0.05, W * 0.98, 0.3, 0.35);
    add(MAT.DARKMETAL, 0, H * 0.28, -L * 0.5 - 0.05, W * 0.98, 0.3, 0.35);
    // wheels
    const wr = H * 0.32;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const w = add(MAT.TIRE, sx * (W * 0.5 - 0.05), wr, sz * (L * 0.32), 0.32, wr * 2, wr * 2, 0x15161a);
      w.castShadow = true;
    }
    // lights
    add(MAT.HEADLIGHT, -W * 0.3, H * 0.5, L * 0.5 + 0.06, 0.42, 0.24, 0.12);
    add(MAT.HEADLIGHT, W * 0.3, H * 0.5, L * 0.5 + 0.06, 0.42, 0.24, 0.12);
    add(MAT.TAILLIGHT, -W * 0.3, H * 0.5, -L * 0.5 - 0.06, 0.4, 0.2, 0.1);
    add(MAT.TAILLIGHT, W * 0.3, H * 0.5, -L * 0.5 - 0.06, 0.4, 0.2, 0.1);
  }

  return { group: g, spec: S, lights };
}

// ---------------------------------------------------------------------------
// Vehicle body (physics)
// ---------------------------------------------------------------------------
export class VehicleBody {
  constructor(cls, x, z, heading = 0) {
    const S = VEHICLE_CLASSES[cls] || VEHICLE_CLASSES.Sedan;
    this.cls = cls;
    this.S = S;
    this.pos = new THREE.Vector2(x, z);
    this.vel = new THREE.Vector2(0, 0);
    this.heading = heading;
    this.yawRate = 0;
    this.steer = 0;
    this.throttle = 0;
    this.brake = 0;
    this.handbrake = false;
    this.damage = 0;
    this.fuel = 1;
    this.slip = 0;
    this.wheelSpin = 0;
    this.engineRpm = 0;
    this.gear = 1;
    this.mass = S.mass;
    this.onGround = true;
    this.halfLen = S.len * 0.5;
    this.halfWid = S.wid * 0.5;
  }

  get speed() { return this.vel.length(); }
  get kph() { return this.speed * 3.6; }
  get forward() { return new THREE.Vector2(Math.sin(this.heading), Math.cos(this.heading)); }
  get right() { return new THREE.Vector2(Math.cos(this.heading), -Math.sin(this.heading)); }

  step(dt, world) {
    const S = this.S;
    const fwd = this.forward;
    const rgt = this.right;

    // ---- decompose velocity ---------------------------------------------------
    let vLong = fwd.x * this.vel.x + fwd.y * this.vel.y;
    let vLat = rgt.x * this.vel.x + rgt.y * this.vel.y;

    // ---- engine / brake / drag ------------------------------------------------
    const maxSpeed = S.topSpeed * (1 - this.damage * 0.35);
    const throttleForce = this.throttle * S.power * (1 - clamp(Math.abs(vLong) / maxSpeed, 0, 1) ** 1.6);
    const brakeForce = -Math.sign(vLong) * this.brake * S.brake * 60 * (this.brake > 0 ? 1 : 0);
    const drag = -vLong * Math.abs(vLong) * (0.42 + this.damage * 0.2);
    const roll = -vLong * 3.2;

    let aLong = (throttleForce + brakeForce + drag + roll) / this.mass;
    if (this.handbrake) aLong += -Math.sign(vLong) * 9;

    // ---- steering: speed sensitive -------------------------------------------
    const speedFactor = 1 - clamp(this.speed / (maxSpeed * 1.35), 0, 1) * 0.72;
    const maxYaw = (this.S.grip * 2.1) * speedFactor;
    let targetYaw = this.steer * maxYaw * clamp(Math.abs(vLong) / 3, 0, 1) * Math.sign(vLong || 1);

    // handbrake: rear grip loss -> the car rotates faster than it travels
    if (this.handbrake && Math.abs(vLong) > 4) {
      targetYaw *= 1.75;
      vLat *= 0.965;      // rear steps out
    }

    this.yawRate = damp(this.yawRate, targetYaw, 9, dt);
    this.heading += this.yawRate * dt;

    // ---- lateral grip with a slip limit --------------------------------------
    const gripLimit = S.grip * 26 * (this.handbrake ? 0.42 : 1) * (1 - this.damage * 0.25);
    let aLat = -vLat * 12;
    const latForce = Math.abs(aLat);
    if (latForce > gripLimit) {
      aLat = -Math.sign(vLat) * gripLimit;
      this.slip = clamp(latForce / gripLimit - 1, 0, 2);
    } else {
      this.slip = damp(this.slip, 0, 6, dt);
    }
    // tyres also scrub off lateral speed directly (they're not springs)
    vLat = damp(vLat, 0, this.handbrake ? 2.4 : 7.5, dt);

    // ---- integrate ------------------------------------------------------------
    vLong += aLong * dt;
    if (Math.abs(vLong) > maxSpeed) vLong = Math.sign(vLong) * maxSpeed;

    const nf = this.forward, nr = this.right;
    this.vel.set(nf.x * vLong + nr.x * vLat, nf.y * vLong + nr.y * vLat);

    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;

    // --- engine / gear simulation (audio + HUD) ---------------------------------
    const rpmNorm = clamp(Math.abs(vLong) / maxSpeed, 0, 1);
    this.engineRpm = 900 + rpmNorm * 6200 + (this.throttle > 0.2 ? 900 : 0);
    this.gear = Math.max(1, Math.min(6, 1 + Math.floor(rpmNorm * 5.6)));
    this.wheelSpin += vLong * dt * 2.2;
    if (this.throttle > 0.05) this.fuel = Math.max(0, this.fuel - dt * 0.00035);

    // ---- collision --------------------------------------------------------------
    if (world) this.resolveCollisions(world);
  }

  resolveCollisions(world) {
    const list = world.queryBuildings(this.pos.x, this.pos.y, this.halfLen + 2);
    for (const c of list) {
      const dx = this.pos.x - c.x, dz = this.pos.y - c.z;
      const ox = Math.abs(dx) - (c.hw + this.halfWid);
      const oz = Math.abs(dz) - (c.hd + this.halfLen);
      if (ox > 0 || oz > 0) continue;

      // push out along the shallowest axis
      if (ox > oz) {
        this.pos.x = c.x + Math.sign(dx || 1) * (c.hw + this.halfWid);
        const impact = Math.abs(this.vel.x);
        this.vel.x *= -0.28;
        this.vel.y *= 0.72;
        this.applyDamage(impact);
      } else {
        this.pos.y = c.z + Math.sign(dz || 1) * (c.hd + this.halfLen);
        const impact = Math.abs(this.vel.y);
        this.vel.y *= -0.28;
        this.vel.x *= 0.72;
        this.applyDamage(impact);
      }
      this.yawRate *= 0.4;
    }
  }

  applyDamage(impactSpeed) {
    const sev = clamp((impactSpeed * 3.6 - 12) / 80, 0, 1);
    if (sev <= 0) return 0;
    this.damage = clamp(this.damage + sev * 0.28, 0, 1);
    return sev;
  }
}

// ---------------------------------------------------------------------------
// Third / first-person chase camera
// ---------------------------------------------------------------------------
export class ChaseCamera {
  constructor(camera) {
    this.cam = camera;
    this.target = new THREE.Vector3();
    this.smoothPos = new THREE.Vector3();
    this.dist = 11;
    this.height = 5.2;
    this.initialized = false;
    this.shake = 0;
  }

  update(dt, veh, speedNorm, lookBack = false) {
    const h = veh.heading + (lookBack ? Math.PI : 0);
    const back = this.dist * (1 + speedNorm * 0.42);
    const desired = new THREE.Vector3(
      veh.pos.x - Math.sin(h) * back,
      this.height + speedNorm * 1.6,
      veh.pos.y - Math.cos(h) * back
    );
    if (!this.initialized) { this.smoothPos.copy(desired); this.initialized = true; }
    this.smoothPos.lerp(desired, 1 - Math.exp(-(6 + speedNorm * 5) * dt));

    if (this.shake > 0) {
      this.smoothPos.x += (Math.random() - 0.5) * this.shake;
      this.smoothPos.y += (Math.random() - 0.5) * this.shake;
      this.shake = Math.max(0, this.shake - dt * 2.4);
    }

    this.cam.position.copy(this.smoothPos);
    this.target.set(
      veh.pos.x + Math.sin(h) * 6,
      1.8,
      veh.pos.y + Math.cos(h) * 6
    );
    this.cam.lookAt(this.target);
    this.cam.fov = lerp(this.cam.fov, 62 + speedNorm * 20, dt * 3);
    this.cam.updateProjectionMatrix();
  }
}
