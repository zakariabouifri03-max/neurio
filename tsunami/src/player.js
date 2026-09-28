// player.js — first/third person character controller: walking, climbing steps, swimming, diving
import * as THREE from 'three';
import { clamp, clamp01, lerp, damp, smoothstep, TAU } from './util.js';

export const STANCE = { STAND: 1.78, CROUCH: 1.12, SWIM: 1.2 };

export class Player {
  constructor(world, ocean, opts = {}) {
    this.world = world;
    this.ocean = ocean;
    this.pos = new THREE.Vector3(0, 10, 0);
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.radius = 0.45;
    this.height = STANCE.STAND;
    this.eyeHeight = STANCE.STAND - 0.16;
    this.crouching = false;
    this.onGround = false;
    this.coyote = 0;
    this.stepPhase = 0;
    this.bob = 0;
    this.speed = 0;
    this.inWater = 0;          // how deep the feet are below the surface
    this.swimming = false;
    this.underwater = false;
    this.breath = 100;
    this.stamina = 100;
    this.maxStamina = 100;
    this.health = 100;
    this.hunger = 100;
    this.thirst = 100;
    this.warmth = 100;
    this.wet = 0;
    this.bleeding = 0;
    this.sick = 0;
    this.alive = true;
    this.exhausted = false;
    this.fallStart = null;
    this.events = [];
    this.vehicle = null;
    this.mode = 'walk';
    this.noise = 0;           // how loud the player currently is
    this.distanceWalked = 0;
    this.water = { depth: 0, surface: 0, ground: 0 };
    this.splashCooldown = 0;
    this.lookTarget = null;
    this.camera = opts.camera || null;
    this.headR = 0;
  }

  setPosition(x, y, z) {
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.fallStart = null;
  }

  emit(type, data) { this.events.push({ type, t: performance.now(), ...data }); }
  drain(type) { /* consumed by main */ }

  get eye() {
    const h = this.swimming ? 0.62 : (this.crouching ? STANCE.CROUCH : this.height) - 0.16;
    return new THREE.Vector3(this.pos.x, this.pos.y + h + this.bob, this.pos.z);
  }

  /* ------------------------------------------------------------ collision */
  resolveCollisions(prevY) {
    const r = this.radius;
    const feet = this.pos.y;
    const head = this.pos.y + this.height;
    for (const c of this.world.colliders) {
      if (feet > c.y1 - 0.32 || head < c.y0) continue;
      const cos = Math.cos(-c.rot), sin = Math.sin(-c.rot);
      const dx = this.pos.x - c.cx, dz = this.pos.z - c.cz;
      let lx = dx * cos - dz * sin, lz = dx * sin + dz * cos;
      const px = (c.hx + r) - Math.abs(lx);
      const pz = (c.hz + r) - Math.abs(lz);
      if (px <= 0 || pz <= 0) continue;
      // step-up: if the obstacle top is a small step, just climb it
      const stepTop = c.y1;
      if (stepTop - feet <= 0.62 && stepTop - feet > -0.1 && this.onGround) {
        const g = this.world.heightAt(this.pos.x, this.pos.z);
        if (Math.abs(stepTop - g) < 0.9) { this.pos.y = Math.max(this.pos.y, stepTop + 0.01); this.vel.y = Math.max(0, this.vel.y); continue; }
      }
      if (px < pz) lx += Math.sign(lx) * px;
      else lz += Math.sign(lz) * pz;
      const cos2 = Math.cos(c.rot), sin2 = Math.sin(c.rot);
      this.pos.x = c.cx + (lx * cos2 - lz * sin2);
      this.pos.z = c.cz + (lx * sin2 + lz * cos2);
      // kill the velocity component into the wall
      const nx = Math.sign(lx) * cos2, nz = Math.sign(lz) * sin2;
      const vn = this.vel.x * nx + this.vel.z * nz;
      if (vn < 0) { this.vel.x -= nx * vn; this.vel.z -= nz * vn; }
    }
  }

  /* ---------------------------------------------------------------- update */
  update(dt, input) {
    if (!this.alive) { this.vel.set(0, 0, 0); return; }
    const world = this.world, ocean = this.ocean;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    let ix = 0, iz = 0;
    if (input.forward) iz -= 1;
    if (input.back) iz += 1;
    if (input.left) ix -= 1;
    if (input.right) ix += 1;
    const il = Math.hypot(ix, iz);
    if (il > 0) { ix /= il; iz /= il; }
    // world-space desired direction
    const wx = ix * cos - iz * sin;
    const wz = ix * sin + iz * cos;

    // ---- water state
    const waterY = ocean.waterYAt(this.pos.x, this.pos.z);
    this.water.surface = waterY;
    this.water.ground = world.heightAt(this.pos.x, this.pos.z);
    const depthHere = Math.max(0, waterY - this.water.ground);
    this.inWater = Math.max(0, waterY - this.pos.y);
    const wasSwimming = this.swimming;
    this.swimming = waterY - this.pos.y > 0.75 && depthHere > 1.0;
    this.underwater = waterY > this.pos.y + this.eyeHeight - 0.05;
    if (this.swimming && !wasSwimming) { this.emit('enterWater'); }
    if (!this.swimming && wasSwimming) { this.emit('exitWater'); if (this.isDangerousWater()) this.emit('wet'); }

    // ---- crouch
    this.crouching = !!input.crouch && this.onGround && !this.swimming;
    const targetH = this.swimming ? STANCE.SWIM : (this.crouching ? STANCE.CROUCH : STANCE.STAND);
    this.height = damp(this.height, targetH, 12, dt);

    // ---- speeds
    const sprinting = !!input.sprint && this.stamina > 3 && (il > 0) && !this.underwater;
    let maxSpeed = 4.35;
    if (this.crouching) maxSpeed = 2.0;
    else if (sprinting) maxSpeed = 7.3;
    if (this.swimming) maxSpeed = this.onGround ? 2.2 : (sprinting ? 4.4 : 3.1);
    else if (this.inWater > 0.35) maxSpeed *= lerp(1.0, 0.55, clamp01((this.inWater - 0.35) / 0.6));
    // slope penalty
    const nrm = world.normalAt(this.pos.x, this.pos.z, 1.0);
    const upSlope = -nrm.x * wx - nrm.z * wz;
    maxSpeed *= 1 - clamp(upSlope, 0, 0.55) * 0.55;
    // injuries / exhaustion
    if (this.exhausted) maxSpeed *= 0.72;
    if (this.health < 30) maxSpeed *= 0.85;

    // ---- acceleration
    const accel = this.onGround ? 42 : 12;
    const targetVX = wx * maxSpeed, targetVZ = wz * maxSpeed;
    if (this.swimming) {
      // buoyancy + swim stroke; eye stays near the surface unless diving
      const dive = (this.pitch < -0.35 && il > 0) || input.crouch;
      const surfaceTarget = waterY - (dive ? 1.9 : 1.15);
      const buoy = (surfaceTarget - this.pos.y) * (dive ? 3.2 : 8.5);
      this.vel.y += clamp(buoy, -6, 6) * dt * 1.6;
      this.vel.y *= Math.exp(-2.4 * dt);
      if (dive) this.vel.y += Math.sin(this.pitch) * 5.0 * dt;
      this.vel.x = damp(this.vel.x, targetVX, 4.2, dt);
      this.vel.z = damp(this.vel.z, targetVZ, 4.2, dt);
    } else {
      const airCtl = this.onGround ? 1 : 0.55;
      this.vel.x = damp(this.vel.x, targetVX, accel * airCtl * 0.28, dt);
      this.vel.z = damp(this.vel.z, targetVZ, accel * airCtl * 0.28, dt);
      this.vel.y -= 21.5 * dt;
      if (input.jump && (this.onGround || this.coyote > 0) && !this.underwater) {
        this.vel.y = 7.35; this.onGround = false; this.coyote = 0; this.emit('jump');
      }
    }

    // currents (flood outflow)
    if (ocean.current && ocean.current.speed > 0.01 && this.inWater > 0.1) {
      const c = ocean.current;
      this.vel.x += c.x * c.speed * dt * 0.85;
      this.vel.z += c.z * c.speed * dt * 0.85;
    }

    // integrate
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    const prevY = this.pos.y;
    this.pos.y += this.vel.y * dt;
    this.resolveCollisions(prevY);

    // ---- ground contact
    const ground = Math.max(world.heightAt(this.pos.x, this.pos.z), -80);
    const wasAir = !this.onGround;
    if (this.pos.y <= ground + 0.02 && !this.swimming) {
      if (wasAir && this.fallStart !== null) {
        const fall = this.fallStart - this.pos.y;
        if (fall > 3.4) {
          const dmg = Math.min(95, (fall - 3.4) * 9.5);
          this.damage(dmg, 'fall');
          this.emit('hardLanding', { force: dmg });
        }
      }
      this.pos.y = ground;
      if (this.vel.y < 0) this.vel.y = 0;
      this.onGround = true;
      this.coyote = 0.12;
      this.fallStart = null;
    } else {
      this.onGround = false;
      this.coyote = Math.max(0, this.coyote - dt);
      if (this.vel.y < -0.5 && (this.fallStart === null || this.pos.y > this.fallStart)) this.fallStart = this.pos.y;
      if (this.swimming) this.fallStart = null;
    }
    // steep slopes push the player down
    if (this.onGround && nrm.y < 0.62 && !this.swimming) {
      this.vel.x += nrm.x * 12 * dt; this.vel.z += nrm.z * 12 * dt;
    }
    // keep inside the world
    const lim = world.half - 24;
    this.pos.x = clamp(this.pos.x, -lim, lim);
    this.pos.z = clamp(this.pos.z, -lim, lim);

    // ---- stamina / breath / stats
    this.speed = Math.hypot(this.vel.x, this.vel.z);
    if (this.swimming) {
      this.stamina -= (sprinting ? 3.2 : 1.5) * dt;
      if (this.underwater) {
        this.breath -= (14 + Math.max(0, this.speed - 2) * 3) * dt;
        if (this.breath <= 0) this.damage(9 * dt, 'drown');
      } else this.breath = Math.min(100, this.breath + 8 * dt);
    } else {
      if (sprinting && this.speed > 4.6) {
        this.stamina -= (this.onGround ? 6.4 : 2.0) * dt;
        if (this.stamina <= 0) { this.exhausted = true; }
      } else this.stamina = Math.min(this.maxStamina, this.stamina + (this.exhausted ? 3.4 : 9.5) * dt);
      this.breath = Math.min(100, this.breath + 22 * dt);
      if (this.exhausted && this.stamina > 45) this.exhausted = false;
    }
    this.stamina = clamp(this.stamina, 0, this.maxStamina);

    // wetness & footsteps
    this.wet = clamp01(this.wet + (this.swimming || this.inWater > 0.3 ? dt * 0.35 : -dt * 0.02));
    const moving = this.speed > 0.6;
    if (this.onGround && moving) {
      const stride = this.speed > 6 ? 0.62 : this.crouching ? 1.15 : 0.78;
      this.stepPhase += (this.speed * dt) / stride * TAU;
      this.distanceWalked += this.speed * dt;
      if (this.stepPhase > TAU) {
        this.stepPhase -= TAU;
        this.emit('step', { surface: this.surfaceMaterial(), speed: this.speed });
      }
      this.bob = Math.sin(this.stepPhase) * (this.speed > 6 ? 0.055 : 0.032);
    } else this.bob = damp(this.bob, 0, 6, dt);
    this.noise = this.swimming ? 1.2 : (moving ? (this.crouching ? 2.5 : this.speed > 6 ? 14 : 8) : 0.4);
    return this;
  }

  surfaceMaterial() {
    const h = this.water.ground;
    const y = this.pos.y;
    if (h < 2.2 || y < 3.4) return 'sand';
    if (y > 150) return 'rock';
    return 'grass';
  }

  isDangerousWater() {
    return this.water.surface > this.water.ground + 1.4;
  }

  damage(amount, cause = '') {
    if (!this.alive) return;
    this.health = Math.max(0, this.health - amount);
    if (cause === 'fall' || cause === 'crash') this.bleeding = Math.min(1, this.bleeding + amount / 120);
    if (this.health <= 0) { this.alive = false; this.emit('death', { cause }); }
    else this.emit('damage', { amount, cause });
  }
  heal(amount, cause = '') {
    this.health = Math.min(100, this.health + amount);
    if (cause === 'bandage') this.bleeding = Math.max(0, this.bleeding - 0.8);
  }
  feed(amount) { this.hunger = Math.min(100, this.hunger + amount); }
  drink(amount) { this.thirst = Math.min(100, this.thirst + amount); }

  /* third person camera helpers */
  cameraTarget(out = new THREE.Vector3()) {
    const eye = this.eye;
    out.copy(eye);
    if (this.swimming) out.y = Math.max(out.y, this.water.surface - 0.5);
    return out;
  }
}
