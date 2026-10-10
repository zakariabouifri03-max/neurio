// BLOCK CITY ULTRA — browser slice: vehicles and traffic.
// Original vehicle names, silhouettes and behaviour.

import * as THREE from './three.module.js';
import { VEHICLES, VOXEL } from './config.js';
import { buildBoxMesh } from './mesher.js';
import { clamp, lerp, damp, angleDelta, dist2, makeRng } from './util.js';

// ── Voxel car body ───────────────────────────────────────────────────────────

/**
 * Builds a car out of boxes. The silhouette comes from a parametric profile,
 * exactly like UBCUVehicleVoxelBuilder in the UE5 project: a supercar is a low
 * wedge, a van is a tall box, a pickup is a cab plus a bed.
 */
const PROFILES = {
  Compact:   { roof: [0.42, 0.62, 0.86, 0.88, 0.80, 0.58, 0.44], belt: [0.40, 0.48, 0.56, 0.56, 0.54, 0.48, 0.42] },
  Sedan:     { roof: [0.40, 0.60, 0.84, 0.86, 0.78, 0.56, 0.42], belt: [0.40, 0.48, 0.56, 0.56, 0.54, 0.48, 0.42] },
  Muscle:    { roof: [0.34, 0.50, 0.68, 0.70, 0.62, 0.46, 0.34], belt: [0.32, 0.38, 0.46, 0.46, 0.42, 0.36, 0.32] },
  Supercar:  { roof: [0.30, 0.42, 0.55, 0.58, 0.52, 0.38, 0.28], belt: [0.28, 0.34, 0.40, 0.40, 0.36, 0.30, 0.26] },
  SUV:       { roof: [0.62, 0.78, 0.90, 0.92, 0.90, 0.80, 0.66], belt: [0.50, 0.58, 0.64, 0.64, 0.62, 0.56, 0.50] },
  Van:       { roof: [0.82, 0.95, 0.96, 0.96, 0.94, 0.86, 0.72], belt: [0.66, 0.74, 0.74, 0.74, 0.72, 0.66, 0.58] },
  Pickup:    { roof: [0.50, 0.72, 0.88, 0.88, 0.52, 0.48, 0.46], belt: [0.46, 0.54, 0.62, 0.62, 0.46, 0.44, 0.42] },
  Police:    { roof: [0.40, 0.60, 0.84, 0.86, 0.78, 0.56, 0.42], belt: [0.40, 0.48, 0.56, 0.56, 0.54, 0.48, 0.42] },
};

/**
 * Creates a voxel car mesh group.
 * @returns {THREE.Group} with userData { lights, brakeLights, lightbar }
 */
export function buildVehicleMesh(def) {
  const group = new THREE.Group();
  const profile = PROFILES[def.class] || PROFILES.Sedan;

  const L = def.l * 0.5;          // metres long
  const W = def.w * 0.5;          // metres wide
  const H = (def.h * 0.5) * 0.55; // body height

  const boxes = [];
  const glassBoxes = [];
  const segments = profile.roof.length - 1;

  // ── Body shell: march along the length, interpolating the profile ────────
  const steps = Math.max(8, Math.round(L / 0.28));
  for (let i = 0; i < steps; i++) {
    const t0 = i / steps, t1 = (i + 1) / steps;
    const roofT = profileAt(profile.roof, t0, segments);
    const beltT = profileAt(profile.belt, t0, segments);
    const roofNext = profileAt(profile.roof, t1, segments);
    const roof = Math.max(roofT, roofNext);

    const segZ = -L / 2 + t0 * L;
    const segLen = (L / steps) * 1.02;

    // Taper the nose and tail so the car is not a brick with wheels.
    const taper = Math.min(smoothEnd(t0, 0.10), smoothEnd(1 - t0, 0.10));
    const halfW = (W / 2) * lerp(0.74, 1.0, taper);

    const beltY = H * beltT;
    const roofY = H * roof;

    // Lower body (always solid).
    boxes.push({ x: -halfW, y: H * 0.16, z: segZ, w: halfW * 2, h: Math.max(0.05, beltY - H * 0.16), d: segLen });

    // Greenhouse: roof panel and pillars only (glass fills the sides).
    if (roofY > beltY + 0.02) {
      const isEnd = (t0 < 0.14 || t0 > 0.88);
      if (isEnd) {
        boxes.push({ x: -halfW, y: beltY, z: segZ, w: halfW * 2, h: roofY - beltY, d: segLen });
      } else {
        // Side pillars.
        boxes.push({ x: -halfW, y: beltY, z: segZ, w: halfW * 0.22, h: roofY - beltY, d: segLen });
        boxes.push({ x: halfW * 0.78, y: beltY, z: segZ, w: halfW * 0.22, h: roofY - beltY, d: segLen });
        glassBoxes.push({ x: -halfW * 0.80, y: beltY, z: segZ, w: halfW * 1.6, h: roofY - beltY, d: segLen });
      }
    }
  }

  // Roof panel across the cabin.
  const cabinZ0 = -L * 0.30, cabinZ1 = L * 0.30;
  const cabinRoofY = H * Math.max(...profile.roof.slice(1, 5));
  boxes.push({ x: -W * 0.40, y: cabinRoofY - 0.06, z: cabinZ0, w: W * 0.80, h: 0.10, d: cabinZ1 - cabinZ0 });

  // Windscreen and rear window.
  glassBoxes.push({ x: -W * 0.38, y: H * profile.belt[2], z: cabinZ0 - 0.10, w: W * 0.76, h: cabinRoofY - H * profile.belt[2], d: 0.10 });
  glassBoxes.push({ x: -W * 0.38, y: H * profile.belt[4], z: cabinZ1, w: W * 0.76, h: cabinRoofY - H * profile.belt[4], d: 0.10 });

  // Wheels: blocky discs (a filled square with corners dropped).
  const wheelR = def.class === 'Van' || def.class === 'SUV' ? 0.42 : 0.36;
  const wheelY = wheelR;
  const wheelPositions = [
    [-W / 2 - 0.04, -L * 0.31], [W / 2 - 0.20, -L * 0.31],
    [-W / 2 - 0.04, L * 0.31], [W / 2 - 0.20, L * 0.31],
  ];

  const wheelGroup = new THREE.Group();
  for (const [wx, wz] of wheelPositions) {
    const wheel = buildBlockyWheel(wheelR, 0.24);
    wheel.position.set(wx + 0.12, wheelY, wz);
    wheelGroup.add(wheel);
  }
  group.add(wheelGroup);

  // Body.
  const body = buildBoxMesh(boxes, def.color, 0.30, 0.55);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  // Glass.
  const glass = buildBoxMesh(glassBoxes, 0x1b2733, 0.06, 0.45);
  glass.material.transparent = true;
  glass.material.opacity = 0.72;
  group.add(glass);

  // Headlights + taillights (emissive voxels).
  const lights = buildBoxMesh([
    { x: -W * 0.38, y: H * 0.44, z: -L / 2 - 0.04, w: W * 0.24, h: 0.16, d: 0.08 },
    { x: W * 0.14, y: H * 0.44, z: -L / 2 - 0.04, w: W * 0.24, h: 0.16, d: 0.08 },
  ], 0xfff2d8, 0.2, 0.0);
  lights.material.emissive = new THREE.Color(0xfff2d8);
  lights.material.emissiveIntensity = 0.0;
  group.add(lights);

  const brakeLights = buildBoxMesh([
    { x: -W * 0.38, y: H * 0.48, z: L / 2 - 0.04, w: W * 0.24, h: 0.14, d: 0.08 },
    { x: W * 0.14, y: H * 0.48, z: L / 2 - 0.04, w: W * 0.24, h: 0.14, d: 0.08 },
  ], 0xff2010, 0.3, 0.0);
  brakeLights.material.emissive = new THREE.Color(0xff2010);
  brakeLights.material.emissiveIntensity = 0.35;
  group.add(brakeLights);

  // Police lightbar.
  let lightbar = null;
  if (def.police) {
    lightbar = new THREE.Group();
    const barA = buildBoxMesh([{ x: -W * 0.34, y: cabinRoofY, z: -0.5, w: W * 0.34, h: 0.16, d: 1.0 }], 0xff2020, 0.3, 0);
    barA.material.emissive = new THREE.Color(0xff2020);
    barA.material.emissiveIntensity = 0;
    const barB = buildBoxMesh([{ x: 0, y: cabinRoofY, z: -0.5, w: W * 0.34, h: 0.16, d: 1.0 }], 0x2060ff, 0.3, 0);
    barB.material.emissive = new THREE.Color(0x2060ff);
    barB.material.emissiveIntensity = 0;
    lightbar.add(barA, barB);
    lightbar.userData = { a: barA, b: barB };
    group.add(lightbar);

    // Police livery: a dark band along the flanks.
    const livery = buildBoxMesh([
      { x: -W / 2 - 0.02, y: H * 0.30, z: -L * 0.34, w: 0.05, h: H * 0.22, d: L * 0.68 },
      { x: W / 2 - 0.03, y: H * 0.30, z: -L * 0.34, w: 0.05, h: H * 0.22, d: L * 0.68 },
    ], 0x14181f, 0.5, 0.2);
    group.add(livery);
  }

  group.userData = { def, lights, brakeLights, lightbar, wheels: wheelGroup, body, glass };
  return group;
}

function buildBlockyWheel(radius, thickness) {
  // A square with the corners dropped reads as a wheel at speed and stays true
  // to the voxel identity.
  const boxes = [];
  const steps = 5;
  const step = (radius * 2) / steps;
  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < steps; j++) {
      const cx = -radius + step * (i + 0.5);
      const cy = -radius + step * (j + 0.5);
      if (Math.hypot(cx, cy) > radius * 0.98) continue;      // drop the corners
      const inner = Math.hypot(cx, cy) < radius * 0.52;
      boxes.push({
        x: cx - step / 2, y: cy - step / 2, z: -thickness / 2,
        w: step * 1.02, h: step * 1.02, d: thickness,
        _inner: inner,
      });
    }
  }

  const tyre = boxes.filter(b => !b._inner).map(({ _inner, ...b }) => b);
  const rim = boxes.filter(b => b._inner).map(({ _inner, ...b }) => b);

  const group = new THREE.Group();
  if (tyre.length) group.add(buildBoxMesh(tyre, 0x14151a, 0.95, 0.0));
  if (rim.length) group.add(buildBoxMesh(rim, 0xb9bfc7, 0.28, 0.9));
  group.rotation.z = Math.PI / 2; // axle along X
  return group;
}

function profileAt(profile, t, segments) {
  const station = t * segments;
  const i0 = clamp(Math.floor(station), 0, segments - 1);
  const i1 = Math.min(i0 + 1, segments);
  return lerp(profile[i0], profile[i1], station - i0);
}

function smoothEnd(t, width) {
  return clamp(t / width, 0, 1);
}

// ── Vehicle simulation ───────────────────────────────────────────────────────

/**
 * Arcade-but-weighted vehicle physics: separate longitudinal and lateral
 * dynamics, speed-sensitive steering, grip loss above the tyre limit, and a
 * handbrake that breaks traction deliberately.
 */
export class Vehicle {
  constructor(def, city) {
    this.def = def;
    this.city = city;
    this.mesh = buildVehicleMesh(def);

    this.position = new THREE.Vector3();
    this.yaw = 0;
    this.velocity = new THREE.Vector3();   // world space, m/s
    this.speed = 0;                        // signed forward speed, m/s
    this.lateralSpeed = 0;
    this.yawRate = 0;
    this.wheelSpin = 0;
    this.steerAngle = 0;

    this.throttle = 0;
    this.brake = 0;
    this.steerInput = 0;
    this.handbrake = false;

    this.health = 1.0;
    this.fuel = 1.0;
    this.odometer = 0;
    this.drifting = false;
    this.slipAngle = 0;
    this.gear = 0;
    this.rpm = 800;
    this.airborne = false;
    this.verticalVelocity = 0;

    // Traffic AI state.
    this.isTraffic = false;
    this.laneNodeIndex = -1;
    this.targetNode = null;
    this.aiThrottle = 0;
    this.aiSteer = 0;
    this.aiBrake = 0;
    this.desiredSpeed = 13.9; // 50 km/h
  }

  get speedKmh() { return Math.abs(this.speed) * 3.6; }
  get isPolice() { return !!this.def.police; }

  place(x, z, yaw) {
    this.position.set(x, 0.36, z);
    this.yaw = yaw;
    this.velocity.set(0, 0, 0);
    this.speed = 0;
    this.mesh.position.copy(this.position);
    this.mesh.rotation.y = yaw;
  }

  /** Per-frame simulation. `dt` is clamped by the caller. */
  update(dt) {
    const def = this.def;
    const maxSpeed = def.top / 3.6;                  // m/s
    const accel = (def.torque / def.mass) * 12.5;      // m/s² at the wheels
    const brakeDecel = 9.8 * def.brake;
    const grip = def.grip;

    // ── Longitudinal ───────────────────────────────────────────────────────
    let forward = this.throttle * accel;

    // Reverse: negative throttle from a standstill, brake otherwise.
    if (this.throttle < 0) {
      if (this.speed > 0.6) {
        forward = 0;
        this.brake = Math.max(this.brake, -this.throttle);
      } else {
        forward = this.throttle * accel * 0.45;
      }
    }

    if (this.brake > 0) {
      const sign = Math.sign(this.speed) || 1;
      this.speed -= sign * brakeDecel * this.brake * dt;
      if (Math.sign(this.speed) !== sign) this.speed = 0;
    }

    this.speed += forward * dt;

    // Drag and rolling resistance.
    const drag = 0.42 * (def.class === 'Supercar' ? 0.30 : 0.40) * this.speed * Math.abs(this.speed) / def.mass * 12;
    const rolling = 0.9 * this.speed;
    this.speed -= (drag + rolling) * dt * 0.06;

    // Handbrake locks the rears: kills speed, kills grip.
    if (this.handbrake) {
      this.speed *= Math.pow(0.28, dt);
    }

    this.speed = clamp(this.speed, -maxSpeed * 0.32, maxSpeed);

    // ── Lateral / steering ─────────────────────────────────────────────────
    // Full lock at walking pace, 35% of it at top speed.
    const speedFraction = clamp(Math.abs(this.speed) / maxSpeed, 0, 1);
    const maxSteer = lerp(0.62, 0.22, speedFraction);
    this.steerAngle = damp(this.steerAngle, this.steerInput * maxSteer, 11, dt);

    // Bicycle-model yaw rate, reduced when the handbrake is on (that is the drift).
    const wheelbase = def.l * 0.5 * 0.62;
    let targetYawRate = (this.speed / wheelbase) * Math.tan(this.steerAngle);
    if (this.handbrake) targetYawRate *= 1.75;

    // Grip limit: above it the car slides instead of turning.
    const lateralG = Math.abs(targetYawRate * this.speed) / 9.81;
    const gripLimit = 1.15 * grip * (this.handbrake ? 0.55 : 1.0);
    this.drifting = lateralG > gripLimit && Math.abs(this.speed) > 6;

    if (this.drifting) {
      targetYawRate *= gripLimit / Math.max(0.001, lateralG);
      this.speed *= Math.pow(0.94, dt * 60 * 0.05);
    }

    this.yawRate = damp(this.yawRate, targetYawRate, 7.5, dt);
    this.yaw += this.yawRate * dt;

    // Slip angle for the smoke and the sound.
    const forwardDir = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const flatVelocity = new THREE.Vector3(this.velocity.x, 0, this.velocity.z);
    if (flatVelocity.lengthSq() > 1) {
      const flat = flatVelocity.clone().normalize();
      this.slipAngle = Math.atan2(
        forwardDir.clone().cross(flat).y,
        forwardDir.dot(flat)
      ) * 180 / Math.PI;
    } else {
      this.slipAngle = 0;
    }

    // ── Integrate ──────────────────────────────────────────────────────────
    const dir = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.velocity.copy(dir).multiplyScalar(this.speed);
    this.velocity.y = this.verticalVelocity;

    const next = this.position.clone().addScaledVector(this.velocity, dt);

    // Gravity + ground.
    const groundY = 0.36;
    if (next.y > groundY || this.verticalVelocity !== 0) {
      this.verticalVelocity -= 18 * dt;
      next.y += this.verticalVelocity * dt;
      this.airborne = next.y > groundY + 0.05;
      if (next.y <= groundY) {
        next.y = groundY;
        this.verticalVelocity = 0;
        this.airborne = false;
      }
    } else {
      this.airborne = false;
    }

    // Collision with buildings: bounce and lose speed, which is what makes
    // crashing into a tower a real cost rather than a slide along a wall.
    const before = next.clone();
    this.city.resolveCollision(next, 1.1);
    if (before.distanceToSquared(next) > 1e-6) {
      const impact = Math.abs(this.speed);
      this.speed *= -0.24;
      this.health = clamp(this.health - impact * 0.006, 0, 1);
      this.onImpact && this.onImpact(impact);
    }

    // World bounds.
    const bound = 380;
    if (Math.abs(next.x) > bound || Math.abs(next.z) > bound) {
      next.x = clamp(next.x, -bound, bound);
      next.z = clamp(next.z, -bound, bound);
      this.speed *= 0.4;
    }

    this.odometer += next.distanceTo(this.position) / 1000;
    this.position.copy(next);

    // ── Drivetrain readouts ────────────────────────────────────────────────
    const gearCount = 6;
    const gearFraction = clamp(Math.abs(this.speed) / maxSpeed, 0, 0.999);
    this.gear = Math.floor(gearFraction * gearCount);
    const inGear = gearFraction * gearCount - this.gear;
    this.rpm = lerp(900, def.top > 260 ? 8200 : 6400, clamp(this.throttle * 0.4 + inGear * 0.7, 0, 1));

    this.fuel = clamp(this.fuel - Math.abs(this.speed) * dt * 0.000012 * (1 + Math.abs(this.throttle)), 0, 1);
    if (this.fuel <= 0) this.speed *= Math.pow(0.5, dt);

    // ── Visuals ────────────────────────────────────────────────────────────
    this.mesh.position.copy(this.position);
    this.mesh.rotation.y = this.yaw;

    // Body roll and pitch from lateral/longitudinal load. Small, but it is what
    // makes a heavy SUV feel heavy.
    const roll = clamp(-this.yawRate * this.speed * 0.012, -0.09, 0.09);
    const pitch = clamp(-this.throttle * 0.022 + this.brake * 0.038, -0.06, 0.06);
    this.mesh.rotation.z = damp(this.mesh.rotation.z, roll, 8, dt);
    this.mesh.rotation.x = damp(this.mesh.rotation.x, pitch, 8, dt);

    // Wheels spin and steer.
    this.wheelSpin += (this.speed / 0.36) * dt;
    const wheels = this.mesh.userData.wheels;
    if (wheels) {
      wheels.children.forEach((w, i) => {
        w.rotation.x = -this.wheelSpin;
        if (i < 2) w.rotation.y = this.steerAngle;
      });
    }

    const ud = this.mesh.userData;
    if (ud.brakeLights) {
      ud.brakeLights.material.emissiveIntensity = (this.brake > 0.05 || this.handbrake) ? 3.2 : 0.5;
    }
    if (ud.lightbar) {
      const phase = (performance.now() * 0.006) % 2;
      ud.lightbar.userData.a.material.emissiveIntensity = phase < 1 ? 5.0 : 0.0;
      ud.lightbar.userData.b.material.emissiveIntensity = phase < 1 ? 0.0 : 5.0;
    }
  }

  setHeadlights(on) {
    const ud = this.mesh.userData;
    if (ud.lights) ud.lights.material.emissiveIntensity = on ? 3.4 : 0.0;
  }

  damage(amount) {
    this.health = clamp(this.health - amount, 0, 1);
    return this.health <= 0;
  }
}

// ── Traffic ──────────────────────────────────────────────────────────────────

/**
 * Traffic manager: pools vehicles, spawns them on lane nodes outside the
 * player's view, despawns them behind, and drives them along the lane graph
 * with a distance-based simulation rate.
 */
export class TrafficManager {
  constructor(scene, city, preset) {
    this.scene = scene;
    this.city = city;
    this.preset = preset;
    this.vehicles = [];
    this.pool = [];
    this.rng = makeRng(0xc17y >>> 0 || 0xc17);
    this.spawnTimer = 0;
    this.farAccumulator = 0;
  }

  setPreset(preset) {
    this.preset = preset;
    while (this.vehicles.length > preset.trafficCount) {
      this.despawn(this.vehicles.length - 1);
    }
  }

  /** Civilian definitions only — police are spawned by the police system. */
  civilianDefs() { return VEHICLES.filter(v => !v.police); }

  spawnNear(playerPos, count = 1) {
    const nodes = this.city.laneNodes;
    if (!nodes.length) return;

    for (let i = 0; i < count; i++) {
      if (this.vehicles.length >= this.preset.trafficCount) return;

      // Pick a lane node in the ring just outside comfortable visibility.
      let best = null, bestScore = Infinity;
      for (let attempt = 0; attempt < 24; attempt++) {
        const node = nodes[(Math.random() * nodes.length) | 0];
        const d = dist2(node.x, node.z, playerPos.x, playerPos.z);
        if (d < 45 || d > 190) continue;
        const score = Math.abs(d - 95) + Math.random() * 20;
        if (score < bestScore) { bestScore = score; best = node; }
      }
      if (!best) continue;

      const defs = this.civilianDefs();
      const def = defs[(Math.random() * defs.length) | 0];
      const vehicle = this.acquire(def);

      vehicle.isTraffic = true;
      vehicle.place(best.x, best.z, Math.atan2(best.dirX, best.dirZ));
      vehicle.desiredSpeed = best.speedLimit / 3.6 * (0.82 + Math.random() * 0.3);
      vehicle.targetNode = best;
      vehicle.laneNodeIndex = nodes.indexOf(best);
      vehicle.setHeadlights(false);

      this.vehicles.push(vehicle);
      this.scene.add(vehicle.mesh);
    }
  }

  acquire(def) {
    const pooled = this.pool.find(v => v.def === def);
    if (pooled) {
      this.pool.splice(this.pool.indexOf(pooled), 1);
      pooled.mesh.visible = true;
      return pooled;
    }
    return new Vehicle(def, this.city);
  }

  despawn(index) {
    const vehicle = this.vehicles[index];
    if (!vehicle) return;
    this.scene.remove(vehicle.mesh);
    vehicle.mesh.visible = false;
    vehicle.isTraffic = true;
    this.pool.push(vehicle);
    this.vehicles.splice(index, 1);
  }

  update(dt, playerPos, playerVehicle) {
    // Spawn / despawn twice a second.
    this.spawnTimer += dt;
    if (this.spawnTimer > 0.5) {
      this.spawnTimer = 0;
      this.spawnNear(playerPos, 2);

      for (let i = this.vehicles.length - 1; i >= 0; i--) {
        const v = this.vehicles[i];
        if (v === playerVehicle) continue;
        if (dist2(v.position.x, v.position.z, playerPos.x, playerPos.z) > 260) this.despawn(i);
      }
    }

    // Distance LOD: far traffic updates at ~3 Hz.
    this.farAccumulator += dt;
    const runFar = this.farAccumulator >= 0.333;
    if (runFar) this.farAccumulator = 0;

    for (const v of this.vehicles) {
      if (v === playerVehicle || !v.isTraffic) continue;

      const near = dist2(v.position.x, v.position.z, playerPos.x, playerPos.z) < 95;
      if (!near && !runFar) continue;

      this.driveTraffic(v, near ? dt : 0.333, playerVehicle, playerPos);
      v.update(near ? dt : 0.333);
    }
  }

  /** Lane following + obstacle avoidance for one traffic car. */
  driveTraffic(v, dt, playerVehicle, playerPos) {
    const nodes = this.city.laneNodes;
    if (!nodes.length) return;

    // Advance to the next node when close to the current target.
    if (!v.targetNode || dist2(v.position.x, v.position.z, v.targetNode.x, v.targetNode.z) < 7) {
      v.targetNode = this.pickNextNode(v);
    }
    if (!v.targetNode) return;

    const target = v.targetNode;
    const dx = target.x - v.position.x, dz = target.z - v.position.z;
    const desiredYaw = Math.atan2(dx, dz);
    const yawError = clamp(angleDelta(v.yaw, desiredYaw) / 0.6, -1, 1);

    // Slow for corners.
    const cornerScale = 1 - Math.min(1, Math.abs(yawError)) * 0.55;
    let desiredSpeed = v.desiredSpeed * cornerScale;

    // ── Avoidance: the car ahead, and the player ──────────────────────────
    let blocking = 0;

    const probeDist = clamp(3.5 + Math.abs(v.speed) * 1.3, 3.5, 26);
    const aheadX = v.position.x + Math.sin(v.yaw) * probeDist;
    const aheadZ = v.position.z + Math.cos(v.yaw) * probeDist;

    for (const other of this.vehicles) {
      if (other === v) continue;
      const d = dist2(aheadX, aheadZ, other.position.x, other.position.z);
      if (d < 3.4) {
        // Is it actually ahead of us?
        const relX = other.position.x - v.position.x, relZ = other.position.z - v.position.z;
        const dot = relX * Math.sin(v.yaw) + relZ * Math.cos(v.yaw);
        if (dot > 0) blocking = Math.max(blocking, 1 - d / 3.4);
      }
    }

    // Yield to the player's car: traffic does not ram the player, but it also
    // does not magically disappear.
    if (playerVehicle) {
      const d = dist2(aheadX, aheadZ, playerVehicle.position.x, playerVehicle.position.z);
      if (d < 4.2) {
        const relX = playerVehicle.position.x - v.position.x;
        const relZ = playerVehicle.position.z - v.position.z;
        if (relX * Math.sin(v.yaw) + relZ * Math.cos(v.yaw) > 0) blocking = Math.max(blocking, 1 - d / 4.2);
      }
    }

    if (blocking > 0.05) {
      v.aiBrake = clamp(blocking * 1.4, 0, 1);
      v.aiThrottle = 0;
      // Nudge around a stationary obstacle, never around the player.
      v.aiSteer = clamp(-yawError + (blocking > 0.7 ? 0 : 0.18 * Math.sign(yawError || 1)), -1, 1);
    } else {
      const speedError = (desiredSpeed - v.speed) / Math.max(1, desiredSpeed);
      v.aiThrottle = clamp(speedError * 2.0, -0.2, 1);
      v.aiBrake = v.speed > desiredSpeed * 1.25 ? clamp(-speedError * 1.6, 0, 0.8) : 0;
      v.aiSteer = clamp(-yawError, -1, 1);
    }

    v.throttle = v.aiThrottle;
    v.brake = v.aiBrake;
    v.steerInput = v.aiSteer;
    v.handbrake = false;
  }

  pickNextNode(v) {
    const nodes = this.city.laneNodes;
    let best = null, bestScore = -Infinity;

    for (let attempt = 0; attempt < 26; attempt++) {
      const node = nodes[(Math.random() * nodes.length) | 0];
      const dx = node.x - v.position.x, dz = node.z - v.position.z;
      const d = Math.hypot(dx, dz);
      if (d < 12 || d > 130) continue;

      // Prefer nodes roughly ahead: keeps traffic flowing instead of U-turning.
      const alignment = (dx * Math.sin(v.yaw) + dz * Math.cos(v.yaw)) / d;
      const score = alignment * 2.2 - d * 0.006 + Math.random() * 0.3;
      if (score > bestScore) { bestScore = score; best = node; }
    }

    return best || nodes[(Math.random() * nodes.length) | 0];
  }

  /** Clears a radius of traffic — used by the mission and by explosions. */
  clearRadius(x, z, radius) {
    let cleared = 0;
    for (let i = this.vehicles.length - 1; i >= 0; i--) {
      const v = this.vehicles[i];
      if (dist2(v.position.x, v.position.z, x, z) <= radius) { this.despawn(i); cleared++; }
    }
    return cleared;
  }

  nearestVehicle(x, z, maxDistance = Infinity, exclude = null) {
    let best = null, bestD = maxDistance;
    for (const v of this.vehicles) {
      if (v === exclude) continue;
      const d = dist2(v.position.x, v.position.z, x, z);
      if (d < bestD) { bestD = d; best = v; }
    }
    return best;
  }

  get count() { return this.vehicles.length; }
}
