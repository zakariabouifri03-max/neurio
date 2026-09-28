// vehicles.js — drivable cars & boats with arcade physics, buoyancy and damage
import * as THREE from 'three';
import { clamp, clamp01, lerp, damp, rand, pick, mulberry32, TAU, colorGeo, xf, roundedBox } from './util.js';
import { hullGeometry } from './city.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

function buildCarMesh(spec, colorHex) {
  const g = new THREE.Group();
  const L = spec.length, W = spec.width, wheelR = spec.wheelR;
  const body = new THREE.Mesh(roundedBox(W, 0.78, L, 0.18), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.45 }));
  body.geometry = colorGeo(body.geometry, new THREE.Color(colorHex));
  body.position.y = 0.72;
  body.castShadow = true;
  g.add(body);
  const mat = body.material;
  const add = (geo, color, pos, rot, m = mat) => {
    const mesh = new THREE.Mesh(colorGeo(geo, new THREE.Color(color)), m);
    mesh.position.set(pos[0], pos[1], pos[2]);
    if (rot) mesh.rotation.set(rot[0], rot[1], rot[2]);
    mesh.castShadow = true;
    g.add(mesh);
    return mesh;
  };
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x101c22, roughness: 0.07, metalness: 0.4, transparent: true, opacity: 0.85 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.85, metalness: 0.1 });
  const chromeMat = new THREE.MeshStandardMaterial({ color: 0xb9bcc0, roughness: 0.25, metalness: 0.9 });
  // cabin
  const cab = new THREE.Mesh(new THREE.BoxGeometry(W * 0.9, spec.cabinH, L * spec.cabinL), glassMat);
  cab.position.set(0, 0.72 + 0.39 + spec.cabinH / 2, -L * 0.02);
  cab.rotation.x = 0;
  g.add(cab);
  add(roundedBox(W * 0.94, 0.14, L * spec.cabinL * 1.02), colorHex, [0, 0.72 + 0.42 + spec.cabinH, -L * 0.02]);
  // windows divider
  add(new THREE.BoxGeometry(W * 0.95, spec.cabinH * 0.9, 0.06), colorHex, [0, 0.72 + 0.39 + spec.cabinH / 2, L * spec.cabinL * 0.45]);
  // wheels
  const wheels = [];
  const halfW = W * 0.5 - 0.08;
  for (const sx of [-1, 1]) for (const sz of [1, -1]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(wheelR, wheelR, 0.26, 14), darkMat);
    w.rotation.z = Math.PI / 2;
    w.position.set(sx * halfW, wheelR, sz * L * 0.31);
    w.castShadow = true;
    g.add(w);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(wheelR * 0.55, wheelR * 0.55, 0.28, 10), chromeMat);
    rim.rotation.z = Math.PI / 2;
    rim.position.copy(w.position);
    g.add(rim);
    wheels.push(w);
  }
  // bumpers, lights, mirrors, exhaust, roof rack
  add(new THREE.BoxGeometry(W * 0.98, 0.24, 0.3), 0x2c2c30, [0, 0.55, L * 0.5], null, darkMat);
  add(new THREE.BoxGeometry(W * 0.98, 0.24, 0.3), 0x2c2c30, [0, 0.55, -L * 0.5], null, darkMat);
  const lightMat = new THREE.MeshStandardMaterial({ color: 0xfff6dc, emissive: 0xffe9b0, emissiveIntensity: 0.6, roughness: 0.2 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x8c1f14, emissive: 0x5a0f08, emissiveIntensity: 0.4 });
  for (const sx of [-1, 1]) {
    add(new THREE.BoxGeometry(0.4, 0.22, 0.12), 0xffffff, [sx * W * 0.32, 0.85, L * 0.5 + 0.02], null, lightMat);
    add(new THREE.BoxGeometry(0.36, 0.2, 0.12), 0xffffff, [sx * W * 0.33, 0.85, -L * 0.5 - 0.02], null, tailMat);
    add(new THREE.BoxGeometry(0.16, 0.12, 0.06), 0x2c2c30, [sx * (W * 0.5 + 0.06), 1.2, L * 0.22], null, darkMat);
  }
  if (spec.roof) {
    add(new THREE.BoxGeometry(W * 0.8, 0.1, L * 0.35), 0x3a3a3e, [0, 0.72 + 0.5 + spec.cabinH + 0.08, -L * 0.02], null, darkMat);
    add(new THREE.BoxGeometry(0.4, 0.5, 0.3), 0x6b6f52, [W * 0.24, 0.72 + 0.9 + spec.cabinH, L * 0.06], null, darkMat);
  }
  g.userData.wheels = wheels;
  g.userData.materials = { body: mat };
  return g;
}

function buildBoatMesh(spec, colorHex) {
  const g = new THREE.Group();
  const L = spec.length, W = spec.width, D = spec.depth;
  const wood = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.05 });
  const hull = new THREE.Mesh(hullGeometry(L, W, D, 14, 8), wood);
  hull.geometry = colorGeo(hull.geometry, new THREE.Color(colorHex));
  hull.castShadow = true; hull.receiveShadow = true;
  g.add(hull);
  const add = (geo, color, pos, rot, m = wood) => {
    const mesh = new THREE.Mesh(colorGeo(geo, new THREE.Color(color)), m);
    mesh.position.set(pos[0], pos[1], pos[2]);
    if (rot) mesh.rotation.set(rot[0], rot[1], rot[2]);
    mesh.castShadow = true;
    g.add(mesh);
    return mesh;
  };
  const deckMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.05 });
  add(new THREE.BoxGeometry(L * 0.92, 0.1, W * 0.86), 0xa8865e, [0, D * 0.72, 0], null, deckMat);
  add(new THREE.BoxGeometry(L * 0.98, 0.2, W * 1.0), spec.stripe || 0x2f6fa8, [0, D * 0.95, 0], null, deckMat);
  if (spec.cabin) {
    const cab = new THREE.Mesh(new THREE.BoxGeometry(L * 0.3, 1.3, W * 0.66), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.1 }));
    cab.geometry = colorGeo(cab.geometry, 0xe8e4da);
    cab.position.set(L * 0.08, D * 0.72 + 0.7, 0);
    cab.castShadow = true;
    g.add(cab);
    const win = new THREE.Mesh(new THREE.BoxGeometry(L * 0.28, 0.42, W * 0.7), new THREE.MeshStandardMaterial({ color: 0x16242c, roughness: 0.1, metalness: 0.3 }));
    win.position.set(L * 0.08, D * 0.72 + 0.95, 0);
    g.add(win);
  }
  if (spec.mast) {
    add(new THREE.CylinderGeometry(0.07, 0.1, spec.mastH, 8), 0x8a6a44, [-L * 0.1, D * 0.72 + spec.mastH / 2, 0]);
  }
  // console + seat + rail
  const console_ = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.9), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.3 }));
  console_.geometry = colorGeo(console_.geometry, 0xcfd4d6);
  console_.position.set(L * 0.28, D * 0.72 + 0.4, 0);
  g.add(console_);
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.035, 6, 12), new THREE.MeshStandardMaterial({ color: 0x2a2a2c }));
  wheel.position.set(L * 0.28, D * 0.72 + 0.78, 0);
  wheel.rotation.y = Math.PI / 2;
  g.add(wheel);
  for (const sx of [-1, 1]) {
    add(new THREE.CylinderGeometry(0.04, 0.04, 0.6, 6), 0x9aa0a6, [sx * W * 0.42, D * 0.85, L * 0.2]);
  }
  // motor
  add(new THREE.BoxGeometry(0.4, 0.6, 0.35), 0x3c4043, [-L * 0.5, D * 0.5, 0]);
  return g;
}

export const VEHICLE_SPECS = {
  hatch: { id: 'hatch', kind: 'car', name: 'Hatchback', length: 3.9, width: 1.72, wheelR: 0.31, cabinH: 0.62, cabinL: 0.45, mass: 1150, power: 8.4, maxSpeed: 42, fuel: 42, tank: 45, seats: 4 },
  pickup: { id: 'pickup', kind: 'car', name: 'Pickup', length: 5.1, width: 1.92, wheelR: 0.38, cabinH: 0.68, cabinL: 0.34, mass: 2100, power: 7.2, maxSpeed: 38, fuel: 60, tank: 70, roof: true, seats: 2 },
  suv: { id: 'suv', kind: 'car', name: '4x4', length: 4.6, width: 1.95, wheelR: 0.40, cabinH: 0.72, cabinL: 0.5, mass: 1850, power: 7.6, maxSpeed: 40, fuel: 55, tank: 68, roof: true, seats: 5 },
  bus: { id: 'bus', kind: 'car', name: 'Minibus', length: 6.6, width: 2.15, wheelR: 0.42, cabinH: 1.55, cabinL: 0.72, mass: 3400, power: 6.0, maxSpeed: 30, fuel: 70, tank: 90, seats: 12 },
  fishingboat: { id: 'fishingboat', kind: 'boat', name: 'Fishing boat', length: 7.4, width: 2.5, depth: 1.15, mass: 1500, power: 6.5, maxSpeed: 18, cabin: true, mast: true, mastH: 5.6, fuel: 60, tank: 60 },
  dinghy: { id: 'dinghy', kind: 'boat', name: 'Dinghy', length: 4.2, width: 1.7, depth: 0.7, mass: 320, power: 7.5, maxSpeed: 15, cabin: false, fuel: 12, tank: 14 },
};

export class Vehicle {
  constructor(spec, world, ocean, mesh) {
    this.spec = spec;
    this.kind = spec.kind;
    this.world = world;
    this.ocean = ocean;
    this.mesh = mesh;
    this.pos = V(0, 0, 0);
    this.rot = 0;
    this.vel = V(0, 0, 0);
    this.speed = 0;
    this.throttle = 0;
    this.steer = 0;
    this.yawRate = 0;
    this.pitch = 0; this.roll = 0;
    this.onGround = true;
    this.airTime = 0;
    this.fuel = spec.fuel;
    this.damage = 0;
    this.engineOn = spec.kind === 'car';
    this.rpm = 0;
    this.occupied = false;
    this.wheelSpin = 0;
    this.floatage = 0;
    this.destroyed = false;
    this.mud = 0;
    this.lastCrash = 0;
    this.headlights = true;
    this.brake = false;
  }

  placeAt(x, y, z, rot = 0) {
    this.pos.set(x, y, z);
    this.rot = rot;
    this.vel.set(0, 0, 0);
    this.syncMesh();
    return this;
  }

  waterSample(x, z) {
    return this.ocean ? this.ocean.waterYAt(x, z) : -100;
  }

  update(dt, input = {}, player = null) {
    if (this.destroyed) { this.syncMesh(); return; }
    if (this.kind === 'car') this.updateCar(dt, input, player);
    else this.updateBoat(dt, input, player);
    this.syncMesh();
  }

  /* ------------------------------------------------------------------- car */
  updateCar(dt, input, player) {
    const s = this.spec, world = this.world;
    const cos = Math.cos(this.rot), sin = Math.sin(this.rot);
    const fx = Math.sin(this.rot), fz = Math.cos(this.rot);          // forward
    // wheel ground samples
    const half = s.length * 0.31, halfW = s.width * 0.5;
    const points = [[-halfW, half], [halfW, half], [-halfW, -half], [halfW, -half]];
    let sumH = 0, frontH = 0, backH = 0, leftH = 0, rightH = 0;
    let maxDiff = 0, waterDepth = 0;
    const heights = [];
    for (const [ox, oz] of points) {
      const wx = this.pos.x + ox * cos + oz * sin;
      const wz = this.pos.z - ox * sin + oz * cos;
      const h = world.heightAt(wx, wz);
      heights.push(h);
      sumH += h;
      const wy = this.waterSample(wx, wz);
      waterDepth = Math.max(waterDepth, wy - h);
    }
    frontH = (heights[0] + heights[1]) / 2;
    backH = (heights[2] + heights[3]) / 2;
    leftH = (heights[0] + heights[2]) / 2;
    rightH = (heights[1] + heights[3]) / 2;
    const groundY = sumH / 4;
    maxDiff = Math.max(frontH - backH, leftH - rightH, backH - frontH, rightH - leftH);

    // buoyancy: a car in deep water floats (badly) and gets carried away
    const inWater = waterDepth > s.wheelR * 0.8;
    if (inWater) {
      this.engineOn = false;
      this.floatage = clamp01(this.floatage + dt * 0.4);
      const wl = this.waterSample(this.pos.x, this.pos.z);
      const targetY = wl - this.spec.length * 0.02;
      this.vel.y += clamp((targetY - this.pos.y) * 6, -4, 4) * dt * 3.2;
      this.vel.y *= Math.exp(-1.6 * dt);
      this.pos.y += this.vel.y * dt;
      // flood current drags the car
      const cur = this.ocean.current;
      this.vel.x = damp(this.vel.x, cur.x * cur.speed * 1.5, 0.7, dt);
      this.vel.z = damp(this.vel.z, cur.z * cur.speed * 1.5, 0.7, dt);
      // rocking
      this.pitch = damp(this.pitch, Math.sin(performance.now() * 0.0012) * 0.06, 2, dt);
      this.roll = damp(this.roll, Math.sin(performance.now() * 0.0009 + 1) * 0.08, 2, dt);
      // wave push
      const ahead = this.waterSample(this.pos.x + fx * 3, this.pos.z + fz * 3);
      const behind = this.waterSample(this.pos.x - fx * 3, this.pos.z - fz * 3);
      this.vel.x += fx * (ahead - behind) * 1.4 * dt;
      this.vel.z += fz * (ahead - behind) * 1.4 * dt;
      this.pos.x += this.vel.x * dt;
      this.pos.z += this.vel.z * dt;
      this.speed = Math.hypot(this.vel.x, this.vel.z);
      return;
    }
    this.floatage = Math.max(0, this.floatage - dt);

    // ---- driving
    const hasFuel = this.fuel > 0.01 && !this.destroyed;
    const wantedThrottle = (input.forward ? 1 : 0) + (input.back ? -0.62 : 0);
    const throttle = hasFuel ? wantedThrottle : 0;
    const steerInput = (input.left ? 1 : 0) + (input.right ? -1 : 0);
    const speed = this.speed;
    const steerLimit = lerp(0.62, 0.24, clamp01(Math.abs(speed) / 22));
    this.steer = damp(this.steer, steerInput * steerLimit, 8, dt);
    const handbrake = !!input.handbrake;
    this.brake = handbrake;

    // forward acceleration
    const power = (s.power * 2.1) * (this.damage > 0.7 ? 0.6 : 1);
    let accel = throttle * power;
    if (throttle < 0) accel *= (speed > 0.5 ? 1.5 : 0.8);   // braking / reverse
    // resistances
    const dragC = 0.0016 * s.width * 2.4;
    accel -= speed * dragC * speed;
    accel -= Math.sign(speed) * (handbrake ? 14 : 1.1 + this.mud * 3.2);
    // slope
    const slopeF = Math.sin(Math.atan2(frontH - backH, s.length * 0.62));
    accel -= slopeF * 9.4;
    if (this.fuel > 0 && Math.abs(throttle) > 0.01) this.fuel = Math.max(0, this.fuel - Math.abs(throttle) * (0.055 + speed * 0.0035) * dt * 4);
    this.rpm = damp(this.rpm, Math.abs(throttle) * (0.35 + clamp01(speed / s.maxSpeed) * 0.65), 3.4, dt);

    // integrate longitudinal
    this.speed = clamp(speed + accel * dt, -s.maxSpeed * 0.35, s.maxSpeed * (1 - this.damage * 0.25));
    // lateral grip / drift
    const grip = handbrake ? 0.55 : lerp(6.4, 3.1, this.mud) * (this.damage > 0.6 ? 0.7 : 1);
    const latVel = this.vel.x * cos - this.vel.z * sin;    // sideways component (approx)
    const newLat = damp(latVel, 0, grip, dt);
    this.drift = clamp01(Math.abs(latVel) * 0.22);
    // yaw
    const grip2 = clamp01(Math.abs(this.speed) / 5);
    this.yawRate = this.steer * (this.speed * 0.16) * grip2 * (1 + this.drift * 0.5);
    if (handbrake) this.yawRate *= 1.45;
    this.rot += this.yawRate * dt;
    // world velocity
    this.vel.x = Math.sin(this.rot) * this.speed + cos * newLat;
    this.vel.z = Math.cos(this.rot) * this.speed - sin * newLat;

    const prevX = this.pos.x, prevZ = this.pos.z;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;

    // building / prop collisions: bounce & damage
    this.collideWorld(prevX, prevZ);

    // vertical: follow the ground, with air time over crests
    const targetY = groundY;
    if (this.onGround) {
      const dy = targetY - this.pos.y;
      if (dy > -1.4) {
        this.pos.y = damp(this.pos.y, targetY, 14, dt);
        this.vel.y = 0;
        this.airTime = 0;
      } else {
        this.onGround = false;
      }
    }
    if (!this.onGround) {
      this.vel.y -= 21 * dt;
      this.pos.y += this.vel.y * dt;
      this.airTime += dt;
      if (this.pos.y <= targetY) {
        const impact = Math.abs(this.vel.y);
        this.pos.y = targetY;
        this.vel.y = 0;
        this.onGround = true;
        if (impact > 6.5) {
          this.damage = clamp01(this.damage + impact / 60);
          this.emitCrash(impact);
        }
      }
    }
    // body attitude from the ground samples
    const targetPitch = clamp(Math.atan2(backH - frontH, s.length * 0.62) * (this.onGround ? 1 : 0.4), -0.5, 0.5);
    const targetRoll = clamp(Math.atan2(rightH - leftH, s.width) * (this.onGround ? 1 : 0.4), -0.45, 0.45);
    this.pitch = damp(this.pitch, targetPitch - accel * 0.004, 6, dt);
    this.roll = damp(this.roll, targetRoll + this.yawRate * this.speed * 0.004, 6, dt);

    // wheel spin
    this.wheelSpin += (this.speed / Math.max(0.2, s.wheelR)) * dt;
    // mud/dust on dirt
    const onRoad = world.onRoad(this.pos.x, this.pos.z);
    const onSand = this.pos.y < 3.5;
    this.mud = clamp01((onRoad ? 0 : 1) * (onSand ? 0.6 : 0.25));
    void player;
  }

  collideWorld(prevX, prevZ) {
    const s = this.spec;
    const r = Math.max(s.width, s.length * 0.5) * 0.42;
    const speed = Math.abs(this.speed);
    for (const c of this.world.colliders) {
      if (this.pos.y > c.y1 + 0.4 || this.pos.y + 1.6 < c.y0) continue;
      if (c.kind === 'quay' && this.pos.y > c.y1 - 0.6) continue;
      const cos = Math.cos(-c.rot), sin = Math.sin(-c.rot);
      const dx = this.pos.x - c.cx, dz = this.pos.z - c.cz;
      const lx = dx * cos - dz * sin, lz = dx * sin + dz * cos;
      const px = (c.hx + r * 0.6) - Math.abs(lx);
      const pz = (c.hz + r * 0.6) - Math.abs(lz);
      if (px <= 0 || pz <= 0) continue;
      // solid: push out & lose speed
      if (px < pz) {
        const sgn = Math.sign(lx) || 1;
        const nx = sgn * Math.cos(c.rot), nz = sgn * Math.sin(c.rot);
        this.pos.x += nx * px; this.pos.z += nz * px;
        const vn = this.vel.x * nx + this.vel.z * nz;
        this.vel.x -= nx * vn * 1.35; this.vel.z -= nz * vn * 1.35;
      } else {
        const sgn = Math.sign(lz) || 1;
        const nx = -sgn * Math.sin(c.rot), nz = sgn * Math.cos(c.rot);
        this.pos.x += nx * pz; this.pos.z += nz * pz;
        const vn = this.vel.x * nx + this.vel.z * nz;
        this.vel.x -= nx * vn * 1.35; this.vel.z -= nz * vn * 1.35;
      }
      const impact = speed;
      this.speed *= 0.42;
      if (impact > 6 && performance.now() - this.lastCrash > 900) {
        this.damage = clamp01(this.damage + impact / 45);
        this.emitCrash(impact);
        this.lastCrash = performance.now();
      }
      break;
    }
    void prevX; void prevZ;
  }

  emitCrash(force) {
    this.crashEvent = { force, t: performance.now(), x: this.pos.x, y: this.pos.y, z: this.pos.z };
  }

  /* ------------------------------------------------------------------ boat */
  updateBoat(dt, input, player) {
    const s = this.spec;
    const fx = Math.sin(this.rot), fz = Math.cos(this.rot);
    const half = s.length * 0.35, halfW = s.width * 0.42;
    const pts = [[0, half], [0, -half], [-halfW, 0], [halfW, 0]];
    const hs = [];
    for (const [ox, oz] of pts) {
      const wx = this.pos.x + ox * Math.cos(this.rot) + oz * fx;
      const wz = this.pos.z - ox * Math.sin(this.rot) + oz * fz;
      hs.push(this.waterSample(wx, wz));
    }
    const fh = (hs[0] + hs[2]) / 2, bh = (hs[1] + hs[3]) / 2;
    const lh = (hs[2] + hs[0]) / 2, rh = (hs[3] + hs[1]) / 2;
    const wl = (hs[0] + hs[1] + hs[2] + hs[3]) / 4;
    const ground = this.world.heightAt(this.pos.x, this.pos.z);
    const beached = wl - ground < s.depth * 0.45;

    const hasFuel = this.fuel > 0.01;
    const throttle = hasFuel ? ((input.forward ? 1 : 0) + (input.back ? -0.5 : 0)) : 0;
    const steerInput = (input.left ? 1 : 0) + (input.right ? -1 : 0);
    this.steer = damp(this.steer, steerInput * 0.5, 5, dt);
    if (Math.abs(throttle) > 0.01) this.fuel = Math.max(0, this.fuel - Math.abs(throttle) * dt * 0.22);
    this.rpm = damp(this.rpm, Math.abs(throttle) * 0.9, 2.4, dt);

    const power = s.power * 1.5;
    const speed = Math.hypot(this.vel.x, this.vel.z);
    const accel = throttle * power - speed * speed * 0.045 * (1 / Math.max(0.5, s.length / 5)) - Math.sign(this.speed || 0) * 0.6;
    this.speed = clamp(this.speed + accel * dt, -s.maxSpeed * 0.4, s.maxSpeed);
    this.rot += this.steer * clamp01(speed / 4) * (1.6 / Math.max(1, s.length / 5)) * dt * (throttle >= 0 ? 1 : -1);
    this.vel.x = Math.sin(this.rot) * this.speed + (this.vel.x - Math.sin(this.rot) * this.speed) * 0.94;
    this.vel.z = Math.cos(this.rot) * this.speed + (this.vel.z - Math.cos(this.rot) * this.speed) * 0.94;
    // current
    if (this.ocean.current.speed > 0.01) {
      this.vel.x += this.ocean.current.x * this.ocean.current.speed * dt * 0.5;
      this.vel.z += this.ocean.current.z * this.ocean.current.speed * dt * 0.5;
    }
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    // vertical: buoyancy toward the water surface, ground blocks it
    const targetY = wl - s.depth * 0.42;
    this.vel.y += clamp((targetY - this.pos.y) * 7, -8, 8) * dt * 2.2;
    this.vel.y *= Math.exp(-2.2 * dt);
    this.pos.y += this.vel.y * dt;
    if (this.pos.y < ground - 0.2) { this.pos.y = ground - 0.2; this.vel.y = 0; }
    this.floatage = 1;
    // attitude follows the waves
    this.pitch = damp(this.pitch, clamp(Math.atan2(bh - fh, s.length * 0.7), -0.35, 0.35), 3, dt);
    this.roll = damp(this.roll, clamp(Math.atan2(rh - lh, s.width * 0.9), -0.4, 0.4), 3, dt);
    void beached; void player;
  }

  board(player) {
    this.occupied = true;
    if (this.kind === 'car') this.engineOn = true;
  }
  unboard() { this.occupied = false; }

  syncMesh() {
    const m = this.mesh;
    if (!m) return;
    m.position.copy(this.pos);
    m.rotation.set(this.pitch, this.rot, this.roll, 'YXZ');
    if (this.kind === 'car' && m.userData.wheels) {
      const steer = this.steer * 0.6;
      m.userData.wheels.forEach((w, i) => {
        w.rotation.x = this.wheelSpin;
        if (i < 2) w.rotation.y = steer;
      });
    }
  }
}

/* --------------------------------------------------------------- management */
export class VehicleSystem {
  constructor(scene, world, ocean, quality = 'high') {
    this.scene = scene;
    this.world = world;
    this.ocean = ocean;
    this.quality = quality;
    this.vehicles = [];
    this.group = new THREE.Group();
    this.group.name = 'vehicles';
    scene.add(this.group);
    this.rng = mulberry32(999);
  }
  spawn(kind, x, y, z, rot = 0, colorHex = null, register = true) {
    const spec = VEHICLE_SPECS[kind] || VEHICLE_SPECS.hatch;
    const color = colorHex || new THREE.Color().setHSL(this.rng(), 0.45 + this.rng() * 0.4, 0.35 + this.rng() * 0.32).getHex();
    const mesh = spec.kind === 'car' ? buildCarMesh(spec, color) : buildBoatMesh(spec, color);
    mesh.matrixAutoUpdate = true;
    this.group.add(mesh);
    const v = new Vehicle(spec, this.world, this.ocean, mesh);
    v.placeAt(x, y, z, rot);
    if (register) { v.id = this.vehicles.length; this.vehicles.push(v); }
    return v;
  }
  /** true when a car-sized box would overlap a world collider here */
  blocked(x, z, y) {
    const r = 3.2;
    for (const c of this.world.colliders) {
      if (y > c.y1 + 0.4 || y + 1.6 < c.y0) continue;
      const cos = Math.cos(-c.rot), sin = Math.sin(-c.rot);
      const dx = x - c.cx, dz = z - c.cz;
      const lx = dx * cos - dz * sin, lz = dx * sin + dz * cos;
      if ((c.hx + r) - Math.abs(lx) > 0 && (c.hz + r) - Math.abs(lz) > 0) return true;
    }
    return false;
  }

  /** spiral out from (x,z) until we find a flat, unblocked, preferably on-road spot */
  findCarSpot(x, z, rot = 0, maxR = 26) {
    const world = this.world;
    for (let pass = 0; pass < 2; pass++) {
      const reach = pass === 0 ? 16 : maxR;
      for (let i = 0; i < 700; i++) {
        const a = i * 2.399963;
        const r = 2 + Math.sqrt(i) * (pass === 0 ? 2.4 : 1.6);
        if (r > reach) break;
        const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        const h = world.heightAt(px, pz);
        if (h < 0.8 || world.slopeAt(px, pz) > 0.2) continue;
        if (this.ocean && this.ocean.waterYAt(px, pz) - h > 0.32) continue;   // never park in standing water
        if (this.blocked(px, pz, h)) continue;
        const road = world.onRoad(px, pz);
        if (pass === 0 && !road && r > 16) continue;   // first pass: stay on the tarmac
        return { x: px, y: h, z: pz, rot: road ? Math.atan2(road.dx, road.dz) : rot };
      }
    }
    return { x, y: world.heightAt(x, z), z, rot };
  }

  /** free any car that the flood / rubble buried inside a collider (keeps the escape car drivable) */
  unstickAll() {
    let n = 0;
    for (const v of this.vehicles) {
      if (v.destroyed) continue;
      if (!this.blocked(v.pos.x, v.pos.z, v.pos.y)) continue;
      const spot = this.findCarSpot(v.pos.x, v.pos.z, v.rot, 40);
      if (Math.hypot(spot.x - v.pos.x, spot.z - v.pos.z) < 0.01) continue;
      v.placeAt(spot.x, spot.y + 0.12, spot.z, spot.rot);
      n++;
    }
    return n;
  }

  /** scatter traffic & boats through the world (called once at load) */
  populate(spawns) {
    const rng = this.rng;
    const world = this.world;
    // ---- cars parked in the city & along the coast
    const cities = [
      { x: world.city.x, z: world.city.z, rx: 210, rz: 300, n: this.quality === 'low' ? 8 : 16 },
    ];
    for (const c of cities) {
      for (let i = 0; i < c.n; i++) {
        const x = c.x + (rng() * 2 - 1) * c.rx;
        const z = c.z + (rng() * 2 - 1) * c.rz;
        const h = world.heightAt(x, z);
        if (h < 4 || h > 30) continue;
        const road = world.onRoad(x, z);
        // no cars parked on the sand: the beach strip is for boats, not traffic
        const region = world.regionAt ? world.regionAt(x, z) : 'city';
        if (!road && region !== 'city') continue;
        const rot = road ? Math.atan2(road.dx, road.dz) : world.city.rot + rng() * 0.4;
        const kind = pick(rng, ['hatch', 'hatch', 'pickup', 'suv', 'suv', 'bus']);
        const v = this.spawn(kind, x, h + 0.05, z, rot + (rng() - 0.5) * 0.1);
        v.parked = true;
      }
    }
    // ---- a few cars on the mountain road
    for (const road of world.roads.slice(2)) {
      for (let i = 0; i < 3; i++) {
        const s = road.samples[Math.floor(rng() * road.samples.length)];
        if (!s) continue;
        const kind = pick(rng, ['suv', 'pickup', 'hatch']);
        const v = this.spawn(kind, s.x, s.y + 0.1, s.z, Math.atan2(s.dx, s.dz));
        v.parked = true;
      }
    }
    // ---- boats at the harbour and out at sea
    for (let i = 0; i < 5; i++) {
      const z = -60 + i * 42 + (rng() - 0.5) * 12;
      const x = this.world.coastX(z) - 14 - rng() * 10;
      const v = this.spawn('fishingboat', x, -0.3, z, rng() * TAU);
      v.parked = true;
    }
    if (spawns && spawns.beach) {
      const v = this.spawn('dinghy', spawns.beach.x - 26, 0.4, spawns.beach.z + 8, 1.2);
      v.parked = true;
    }
    // ---- rescue boat out at sea (drifting, plot item)
    this.rescueBoat = this.spawn('fishingboat', -820, -0.3, -60, 1.5);
    this.rescueBoat.parked = true;
    // ---- the player's car, waiting at the harbour
    if (spawns && spawns.harbor) {
      let best = null;
      for (const road of world.roads) {
        for (const smp of road.samples) {
          if (smp.y < 20) continue;                                     // above the flood line (16.5 m)
          const d = Math.hypot(smp.x - world.city.x, smp.z - world.city.z);
          const score = d + Math.max(0, smp.y - 26) * 2.5;              // near town, as low as possible
          if (!best || score < best.score) best = { score, d, x: smp.x, z: smp.z, dx: smp.dx, dz: smp.dz };
        }
      }
      const base = best || { x: spawns.city.x, z: spawns.city.z, dx: 0, dz: 1 };
      const heroSpot = this.findCarSpot(base.x, base.z, Math.atan2(base.dx, base.dz), 14);
      this.hero = this.spawn('pickup', heroSpot.x, heroSpot.y + 0.15, heroSpot.z, heroSpot.rot, 0xd8442c);
      this.hero.fuel = this.hero.spec.tank * 0.85;   // the escape car is fuelled up
      this.heroSpot = { x: heroSpot.x, z: heroSpot.z };
    }
    return this;
  }
  update(dt, driver, input) {
    for (const v of this.vehicles) {
      if (v === driver) continue;
      if (v.kind === 'boat' || v.floatage > 0) v.update(dt, {}, null);   // boats keep floating
    }
    if (driver) driver.update(dt, input, null);
  }
  nearest(pos, radius = 3.4) {
    let best = null, bd = radius * radius;
    for (const v of this.vehicles) {
      const dx = v.pos.x - pos.x, dz = v.pos.z - pos.z;
      const dy = v.pos.y - pos.y;
      const d = dx * dx + dz * dz + dy * dy * 0.4;
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }
}
