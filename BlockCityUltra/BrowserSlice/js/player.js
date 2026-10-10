// BLOCK CITY ULTRA — browser slice: player character, camera and input.

import * as THREE from './three.module.js';
import { PLAYER, VEHICLES } from './config.js';
import { buildBoxMesh } from './mesher.js';
import { clamp, lerp, damp, angleDelta, dist2 } from './util.js';

/**
 * A character built from cubes — 13 instanced parts, matching the UE5
 * UBCUVoxelBodyComponent recipe so the two versions look like the same person.
 */
export function buildCharacterMesh(palette) {
  const p = palette || { skin: 0xc99a76, shirt: 0x2a528c, trousers: 0x24262c, shoes: 0x141312 };
  const group = new THREE.Group();

  const parts = {
    head:      { s: [0.24, 0.26, 0.24], y: 1.58, c: p.skin },
    torso:     { s: [0.44, 0.52, 0.26], y: 1.12, c: p.shirt },
    hips:      { s: [0.42, 0.20, 0.25], y: 0.78, c: p.trousers },
    armL:      { s: [0.14, 0.50, 0.15], y: 1.16, x: -0.30, c: p.shirt },
    armR:      { s: [0.14, 0.50, 0.15], y: 1.16, x: 0.30, c: p.shirt },
    handL:     { s: [0.13, 0.14, 0.14], y: 0.84, x: -0.30, c: p.skin },
    handR:     { s: [0.13, 0.14, 0.14], y: 0.84, x: 0.30, c: p.skin },
    legL:      { s: [0.17, 0.62, 0.18], y: 0.40, x: -0.12, c: p.trousers },
    legR:      { s: [0.17, 0.62, 0.18], y: 0.40, x: 0.12, c: p.trousers },
    shoeL:     { s: [0.18, 0.11, 0.28], y: 0.055, x: -0.12, z: 0.03, c: p.shoes },
    shoeR:     { s: [0.18, 0.11, 0.28], y: 0.055, x: 0.12, z: 0.03, c: p.shoes },
  };

  for (const [name, spec] of Object.entries(parts)) {
    const [w, h, d] = spec.s;
    const mesh = buildBoxMesh([{ x: -w / 2, y: -h / 2, z: -d / 2, w, h, d }], spec.c, 0.82, 0.02);
    mesh.position.set(spec.x || 0, spec.y, spec.z || 0);
    mesh.castShadow = true;
    mesh.name = name;
    group.add(mesh);
  }

  group.userData.parts = parts;
  return group;
}

/** Pedestrian: a cheaper version of the same recipe, one draw call. */
export function buildPedestrianMesh(palette) {
  const g = buildCharacterMesh(palette);
  g.traverse(o => { if (o.isMesh) o.castShadow = false; });
  return g;
}

// ── Input ────────────────────────────────────────────────────────────────────

export class Input {
  constructor(domElement) {
    this.keys = new Set();
    this.mouse = { dx: 0, dy: 0, locked: false };
    this.pressed = new Set();   // edge-triggered, cleared each frame

    window.addEventListener('keydown', e => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
      // Stop the page scrolling / the browser stealing Space and Tab.
      if (['Space', 'Tab', 'KeyM', 'KeyF', 'KeyR'].includes(e.code)) e.preventDefault();
    });

    window.addEventListener('keyup', e => { this.keys.delete(e.code); });
    window.addEventListener('blur', () => { this.keys.clear(); });

    domElement.addEventListener('click', () => {
      if (!this.mouse.locked) domElement.requestPointerLock?.();
    });

    document.addEventListener('pointerlockchange', () => {
      this.mouse.locked = document.pointerLockElement === domElement;
    });

    document.addEventListener('mousemove', e => {
      if (!this.mouse.locked) return;
      this.mouse.dx += e.movementX || 0;
      this.mouse.dy += e.movementY || 0;
    });

    // Touch: a virtual stick on the left, drag-to-look on the right.
    this.touch = { moveId: null, lookId: null, moveX: 0, moveZ: 0, startX: 0, startY: 0 };
    domElement.addEventListener('touchstart', e => this.#onTouch(e, 'start'), { passive: false });
    domElement.addEventListener('touchmove', e => this.#onTouch(e, 'move'), { passive: false });
    domElement.addEventListener('touchend', e => this.#onTouch(e, 'end'), { passive: false });
  }

  #onTouch(e, phase) {
    e.preventDefault();
    const w = window.innerWidth;
    for (const t of e.changedTouches) {
      const isLeft = t.clientX < w / 2;
      if (phase === 'start') {
        if (isLeft && this.touch.moveId === null) {
          this.touch.moveId = t.identifier;
          this.touch.startX = t.clientX; this.touch.startY = t.clientY;
        } else if (!isLeft && this.touch.lookId === null) {
          this.touch.lookId = t.identifier;
          this.touch.lookLastX = t.clientX; this.touch.lookLastY = t.clientY;
        }
      } else if (phase === 'move') {
        if (t.identifier === this.touch.moveId) {
          this.touch.moveX = clamp((t.clientX - this.touch.startX) / 60, -1, 1);
          this.touch.moveZ = clamp((t.clientY - this.touch.startY) / 60, -1, 1);
        } else if (t.identifier === this.touch.lookId) {
          this.mouse.dx += (t.clientX - this.touch.lookLastX) * 1.6;
          this.mouse.dy += (t.clientY - this.touch.lookLastY) * 1.6;
          this.touch.lookLastX = t.clientX; this.touch.lookLastY = t.clientY;
        }
      } else {
        if (t.identifier === this.touch.moveId) { this.touch.moveId = null; this.touch.moveX = 0; this.touch.moveZ = 0; }
        if (t.identifier === this.touch.lookId) { this.touch.lookId = null; }
      }
    }
  }

  down(code) { return this.keys.has(code); }
  hit(code) { return this.pressed.has(code); }
  endFrame() { this.pressed.clear(); this.mouse.dx = 0; this.mouse.dy = 0; }

  /** Normalised 2D move axis from keyboard or touch. */
  get moveAxis() {
    let x = 0, z = 0;
    if (this.down('KeyW') || this.down('ArrowUp')) z += 1;
    if (this.down('KeyS') || this.down('ArrowDown')) z -= 1;
    if (this.down('KeyA') || this.down('ArrowLeft')) x -= 1;
    if (this.down('KeyD') || this.down('ArrowRight')) x += 1;
    if (x === 0 && z === 0) { x = this.touch.moveX; z = -this.touch.moveZ; }
    const len = Math.hypot(x, z);
    return len > 1 ? { x: x / len, z: z / len } : { x, z };
  }
}

// ── Player ───────────────────────────────────────────────────────────────────

export class Player {
  constructor(city, scene) {
    this.city = city;
    this.scene = scene;

    this.mesh = buildCharacterMesh();
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.onGround = true;

    this.health = PLAYER.maxHealth;
    this.stamina = 1;
    this.exhausted = false;
    this.wantsSprint = false;
    this.locomotion = 'idle';
    this.distanceWalkedKm = 0;

    this.vehicle = null;         // the Vehicle we are driving, or null
    this.enterCooldown = 0;
    this.animTime = 0;
    this.hidden = false;

    scene.add(this.mesh);
  }

  get isDriving() { return this.vehicle !== null; }
  get eyePosition() {
    if (this.isDriving) {
      const v = this.vehicle;
      return new THREE.Vector3(
        v.position.x - Math.sin(v.yaw) * 0.2,
        v.position.y + 1.25,
        v.position.z - Math.cos(v.yaw) * 0.2
      );
    }
    return new THREE.Vector3(this.position.x, this.position.y + PLAYER.eyeHeight, this.position.z);
  }

  get speedKmh() {
    if (this.isDriving) return this.vehicle.speedKmh;
    return this.velocity.length() * 3.6;
  }

  spawnAt(x, z) {
    this.position.set(x, 0.3, z);
    this.velocity.set(0, 0, 0);
    this.mesh.position.copy(this.position);
    this.health = PLAYER.maxHealth;
    this.stamina = 1;
    this.exhausted = false;
  }

  enterVehicle(vehicle) {
    this.vehicle = vehicle;
    this.hidden = true;
    this.mesh.visible = false;
    this.velocity.set(0, 0, 0);
    this.enterCooldown = 0.4;
  }

  exitVehicle() {
    const v = this.vehicle;
    if (!v) return;

    // Step out on the pavement side, never into the carriageway.
    const side = new THREE.Vector3(Math.cos(v.yaw), 0, -Math.sin(v.yaw));
    const out = v.position.clone().addScaledVector(side, -1.5);
    out.y = 0.3;
    this.city.resolveCollision(out, PLAYER.radius);

    this.position.copy(out);
    this.yaw = v.yaw;
    this.vehicle = null;
    this.hidden = false;
    this.mesh.visible = true;
    this.mesh.position.copy(this.position);
    this.enterCooldown = 0.4;
  }

  update(dt, input, cameraYaw, cameraPitch) {
    this.enterCooldown = Math.max(0, this.enterCooldown - dt);

    if (this.isDriving) {
      this.#driveVehicle(dt, input, cameraYaw);
      this.mesh.position.copy(this.vehicle.position);
      this.position.copy(this.vehicle.position);
      this.yaw = this.vehicle.yaw;
      return;
    }

    this.#walk(dt, input, cameraYaw);
    this.#animate(dt);
  }

  #walk(dt, input, cameraYaw) {
    const axis = input.moveAxis;
    const moving = Math.hypot(axis.x, axis.z) > 0.05;

    this.wantsSprint = (input.down('ShiftLeft') || input.down('ShiftRight')) && !this.exhausted;

    // Stamina.
    const draining = this.wantsSprint && moving;
    if (draining) {
      this.stamina = Math.max(0, this.stamina - PLAYER.staminaDrain * dt);
      if (this.stamina <= 0) { this.exhausted = true; this.wantsSprint = false; }
    } else {
      this.stamina = Math.min(1, this.stamina + PLAYER.staminaRegen * dt);
      if (this.stamina > 0.45) this.exhausted = false;
    }

    const targetSpeed = !moving ? 0
      : this.wantsSprint ? PLAYER.sprintSpeed
      : (Math.hypot(axis.x, axis.z) > 0.9 ? PLAYER.jogSpeed : PLAYER.walkSpeed);

    // Camera-relative movement.
    const sin = Math.sin(cameraYaw), cos = Math.cos(cameraYaw);
    const wishX = axis.x * cos - axis.z * sin;
    const wishZ = axis.x * sin + axis.z * cos;

    const wish = new THREE.Vector3(wishX, 0, wishZ);
    if (wish.lengthSq() > 1) wish.normalize();
    wish.multiplyScalar(targetSpeed);

    // Accelerate / decelerate horizontally.
    const rate = targetSpeed > this.velocity.length() ? PLAYER.accel : PLAYER.decel;
    this.velocity.x = damp(this.velocity.x, wish.x, rate * 0.42, dt);
    this.velocity.z = damp(this.velocity.z, wish.z, rate * 0.42, dt);

    // Jump + gravity.
    if (this.onGround && input.hit('Space') && this.stamina > 0.05) {
      this.velocity.y = PLAYER.jumpVelocity;
      this.stamina = Math.max(0, this.stamina - 0.06);
      this.onGround = false;
    }
    this.velocity.y -= PLAYER.gravity * dt;

    // Integrate.
    const next = this.position.clone().addScaledVector(this.velocity, dt);

    // Ground: the terrain slab, or a building roof if we are on one.
    const groundY = this.#groundHeight(next.x, next.z, this.position.y);
    if (next.y <= groundY) {
      if (!this.onGround && this.velocity.y < -12) this.takeDamage((-this.velocity.y - 12) * 2.2);
      next.y = groundY;
      this.velocity.y = 0;
      this.onGround = true;
    } else {
      this.onGround = false;
    }

    // Buildings block us unless we are above them.
    if (next.y < groundY + 0.05) this.city.resolveCollision(next, PLAYER.radius);

    // World bounds.
    const bound = 392;
    next.x = clamp(next.x, -bound, bound);
    next.z = clamp(next.z, -bound, bound);

    this.distanceWalkedKm += next.distanceTo(this.position) / 1000;
    this.position.copy(next);

    // Face the movement direction (not the camera) — the classic third-person read.
    if (moving) {
      const targetYaw = Math.atan2(this.velocity.x, this.velocity.z);
      this.yaw += angleDelta(this.yaw, targetYaw) * Math.min(1, dt * 12);
    }

    // Locomotion state.
    const kmh = this.velocity.length() * 3.6;
    this.locomotion = !this.onGround ? 'falling'
      : kmh < 0.6 ? (this.wantsSprint ? 'sprint' : 'idle')
      : kmh < 6 ? 'walk' : kmh < 14 ? 'jog' : 'sprint';

    this.mesh.position.copy(this.position);
    this.mesh.rotation.y = this.yaw;
  }

  /** Ground height, including standing on top of a building when we jumped there. */
  #groundHeight(x, z, currentY) {
    let best = 0.3;
    for (const b of this.city.buildings) {
      if (x > b.x && x < b.x + b.w && z > b.z && z < b.z + b.d) {
        const top = b.h + 0.28;
        // Only snap to a roof we are already near or above.
        if (top <= currentY + 0.6 && top > best) best = top;
      }
    }
    return best;
  }

  #driveVehicle(dt, input, cameraYaw) {
    const v = this.vehicle;
    const axis = input.moveAxis;

    // Throttle from W/S; the same keys drive the car and the character, which is
    // what makes entering and leaving a car feel continuous.
    v.throttle = clamp(axis.z, -1, 1);
    v.brake = axis.z < -0.1 ? -axis.z : 0;
    v.steerInput = clamp(-axis.x, -1, 1);
    v.handbrake = input.down('Space');

    if (input.hit('KeyH')) this.onHorn?.();

    v.update(dt);
  }

  #animate(dt) {
    // Procedural limb swing: no animation files needed, and it reads correctly
    // at every speed because the frequency follows the velocity.
    const speed = this.velocity.length();
    const stride = this.locomotion === 'sprint' ? 11.5 : this.locomotion === 'jog' ? 8.6 : 5.4;
    this.animTime += dt * (speed > 0.4 ? stride : 0);

    const swing = speed > 0.4 ? Math.sin(this.animTime) * clamp(speed / 5, 0.2, 1) * 0.75 : 0;
    const bob = speed > 0.4 ? Math.abs(Math.sin(this.animTime)) * 0.045 * clamp(speed / 5, 0.2, 1) : 0;

    const parts = this.mesh.children;
    const byName = {};
    for (const p of parts) byName[p.name] = p;

    if (byName.legL) byName.legL.rotation.x = swing;
    if (byName.legR) byName.legR.rotation.x = -swing;
    if (byName.armL) byName.armL.rotation.x = -swing * 0.85;
    if (byName.armR) byName.armR.rotation.x = swing * 0.85;
    if (byName.handL) byName.handL.rotation.x = -swing * 0.85;
    if (byName.handR) byName.handR.rotation.x = swing * 0.85;
    if (byName.shoeL) byName.shoeL.rotation.x = swing;
    if (byName.shoeR) byName.shoeR.rotation.x = -swing;
    if (byName.head) byName.head.position.y = 1.58 + bob;
    if (byName.torso) byName.torso.position.y = 1.12 + bob * 0.8;
  }

  takeDamage(amount) {
    if (amount <= 0 || this.health <= 0) return;
    this.health = clamp(this.health - amount, 0, PLAYER.maxHealth);
    this.onDamaged?.(amount);
    if (this.health <= 0) this.onDowned?.();
  }

  heal(amount) { this.health = clamp(this.health + amount, 0, PLAYER.maxHealth); }

  revive() {
    this.health = PLAYER.maxHealth;
    this.stamina = 1;
    this.exhausted = false;
  }

  /** The nearest vehicle we could enter, and the prompt text for it. */
  findEnterableVehicle(traffic, policeUnits) {
    if (this.isDriving || this.enterCooldown > 0) return null;

    const all = [...traffic.vehicles, ...(policeUnits || [])];
    const eye = this.position;
    let best = null, bestD = 3.6;

    for (const v of all) {
      const d = dist2(v.position.x, v.position.z, eye.x, eye.z);
      if (d < bestD) {
        // Must be roughly in front of us, not behind our back.
        const dx = v.position.x - eye.x, dz = v.position.z - eye.z;
        const facing = dx * Math.sin(this.yaw) + dz * Math.cos(this.yaw);
        if (facing > -1.2 || d < 2.2) { bestD = d; best = v; }
      }
    }

    return best;
  }
}

// ── Camera ───────────────────────────────────────────────────────────────────

/**
 * One camera system for both on foot and driving, mirroring UBCUCameraSystem:
 * a lag-compensated third-person boom on foot, and a speed-reactive chase cam
 * whose distance and FOV both rise with velocity.
 */
export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.yaw = 0;
    this.pitch = -0.12;
    this.distance = 4.2;
    this.targetDistance = 4.2;
    this.fov = 72;
    this.targetFov = 72;
    this.height = 1.7;
    this.shake = 0;
    this.lookBack = false;
    this.mode = 'third';   // third | close | first
    this.smoothTarget = new THREE.Vector3();
    this.sensitivity = 0.0026;
  }

  cycleMode() {
    this.mode = this.mode === 'third' ? 'close' : this.mode === 'close' ? 'first' : 'third';
    this.targetDistance = this.mode === 'third' ? 4.6 : this.mode === 'close' ? 2.6 : 0;
    return this.mode;
  }

  addLook(dx, dy) {
    this.yaw -= dx * this.sensitivity;
    this.pitch = clamp(this.pitch - dy * this.sensitivity, -1.32, 1.28);
  }

  notifyImpact(severity) { this.shake = Math.min(1.2, this.shake + severity); }

  update(dt, player, driving) {
    const target = player.eyePosition;

    // Smooth the aim point so entering/exiting a car does not snap the camera.
    this.smoothTarget.lerp(target, 1 - Math.exp(-16 * dt));

    if (driving) {
      const v = player.vehicle;
      const speedFraction = clamp(v.speedKmh / 220, 0, 1);

      // Pull back and widen with speed: the cheapest way to make 300 km/h feel
      // dangerous.
      this.targetDistance = lerp(5.6, 9.4, speedFraction);
      this.targetFov = lerp(68, 92, speedFraction);
      this.height = lerp(1.9, 2.6, speedFraction);

      // Behind the car, not behind the camera: driving uses the car's yaw plus a
      // lagged correction so a drift swings the camera.
      const behindYaw = v.yaw + Math.PI;
      const yawError = angleDelta(this.yaw, behindYaw);
      this.yaw += yawError * Math.min(1, dt * (v.drifting ? 2.4 : 4.6));
      this.pitch = damp(this.pitch, -0.10 - speedFraction * 0.05, 4, dt);
    } else {
      this.targetDistance = this.mode === 'first' ? 0 : this.mode === 'close' ? 2.6 : 4.6;
      this.targetFov = 72;
      this.height = 1.7;
    }

    this.distance = damp(this.distance, this.targetDistance, 6, dt);
    this.fov = damp(this.fov, this.targetFov, 5, dt);
    if (Math.abs(this.camera.fov - this.fov) > 0.05) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }

    // Shake decays fast.
    this.shake = Math.max(0, this.shake - dt * 2.4);
    const shakeX = this.shake > 0 ? (Math.random() - 0.5) * this.shake * 0.5 : 0;
    const shakeY = this.shake > 0 ? (Math.random() - 0.5) * this.shake * 0.5 : 0;

    const yaw = this.lookBack ? this.yaw + Math.PI : this.yaw;
    const dist = this.lookBack ? Math.max(this.distance, 2.4) : this.distance;

    const offset = new THREE.Vector3(
      Math.sin(yaw) * Math.cos(this.pitch) * dist,
      Math.sin(-this.pitch) * dist + this.height,
      Math.cos(yaw) * Math.cos(this.pitch) * dist
    );

    const desired = this.smoothTarget.clone().add(offset);

    // Pull the camera in when geometry is between it and the player.
    const dir = desired.clone().sub(this.smoothTarget);
    const len = dir.length();
    if (len > 0.2) {
      dir.normalize();
      const ray = new THREE.Raycaster(this.smoothTarget.clone(), dir, 0.1, len);
      // Cheap proxy: clamp against building boxes rather than a full raycast.
      const blocked = this.#cameraBlocked(this.smoothTarget, desired);
      if (blocked) desired.copy(blocked);
    }

    this.camera.position.lerp(desired, 1 - Math.exp(-18 * dt));
    this.camera.position.x += shakeX;
    this.camera.position.y += shakeY;
    this.camera.lookAt(this.smoothTarget);
  }

  #cameraBlocked(from, to) {
    const city = window.__bcuCity;
    if (!city || !city.colliders) return null;

    const dir = to.clone().sub(from);
    const len = dir.length();
    dir.normalize();

    let bestT = len;
    for (const c of city.colliders) {
      // Slab test in XZ only, with the camera's Y treated as inside when it is
      // below the building's height.
      if (from.y > c.height && to.y > c.height) continue;

      const tMinX = (c.minX - from.x) / (dir.x || 1e-9);
      const tMaxX = (c.maxX - from.x) / (dir.x || 1e-9);
      const tMinZ = (c.minZ - from.z) / (dir.z || 1e-9);
      const tMaxZ = (c.maxZ - from.z) / (dir.z || 1e-9);

      const t0 = Math.max(Math.min(tMinX, tMaxX), Math.min(tMinZ, tMinZ), Math.min(tMinZ, tMaxZ));
      const t1 = Math.min(Math.max(tMinX, tMaxX), Math.max(tMinZ, tMaxZ));

      const enter = Math.max(Math.min(tMinX, tMaxX), Math.min(tMinZ, tMaxZ));
      const exit = Math.min(Math.max(tMinX, tMaxX), Math.max(tMinZ, tMaxZ));

      if (enter < exit && enter > 0.05 && enter < bestT) bestT = enter - 0.18;
      void t0; void t1;
    }

    if (bestT >= len) return null;
    return from.clone().addScaledVector(dir, Math.max(0.4, bestT));
  }
}
