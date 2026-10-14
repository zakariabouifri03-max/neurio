// ── Explorer: your body on the planet ───────────────────────────────────────
// Real-world scale: eye at 1.7 m, walking 1.5 m/s, sprint 5 m/s, flight up to
// 40 m/s so you can rise above a 60 m canopy. Planet gravity scales the jump.

import * as THREE from 'three';
import { TERRAIN_SIZE, EYE_HEIGHT } from './world.js';
import { clamp } from './rng.js';

const G = 9.81;

export class Explorer {
  constructor(camera, world, opts = {}) {
    this.camera = camera;
    this.world = world;
    this.opts = opts;

    this.pos = new THREE.Vector3(world.spawn.x, world.spawn.y + EYE_HEIGHT, world.spawn.z);
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.grounded = true;
    this.flying = false;
    this.move = new THREE.Vector2(0, 0);   // x = strafe, y = forward (-1..1)
    this.keys = new Set();

    this.walkSpeed = 1.55;
    this.sprintSpeed = 5.4;
    this.flySpeed = 14;
    this.flyBoost = 42;
    this.playerRadius = 0.65;
    this.bobT = 0;
    this._tmpV = new THREE.Vector3();
    this._tmpF = new THREE.Vector3();
    this._tmpR = new THREE.Vector3();
    this.lastSpeed = 0;
    this.altitude = 0;
  }

  get gravity() { return this.world.planet.gravity * G; }

  attach(dom) {
    this.dom = dom;
    this._onKeyDown = (e) => this._key(e, true);
    this._onKeyUp = (e) => this._key(e, false);
    addEventListener('keydown', this._onKeyDown);
    addEventListener('keyup', this._onKeyUp);

    this._onMouseMove = (e) => {
      if (document.pointerLockElement !== this.dom) return;
      this.look(e.movementX, e.movementY);
    };
    addEventListener('mousemove', this._onMouseMove);
  }

  detach() {
    removeEventListener('keydown', this._onKeyDown);
    removeEventListener('keyup', this._onKeyUp);
    removeEventListener('mousemove', this._onMouseMove);
  }

  _key(e, down) {
    const k = e.key.toLowerCase();
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
    if (down) this.keys.add(k); else this.keys.delete(k);
    if (down && k === 'f') this.toggleFly();
    if (down && (k === ' ' || k === 'spacebar')) this.jump();
  }

  requestLock() { this.dom?.requestPointerLock?.(); }
  get locked() { return document.pointerLockElement === this.dom; }

  look(dx, dy) {
    this.yaw -= dx * 0.0022;
    this.pitch = clamp(this.pitch - dy * 0.0022, -Math.PI / 2 + 0.02, Math.PI / 2 - 0.02);
  }

  setMove(x, y) { this.move.set(clamp(x, -1, 1), clamp(y, -1, 1)); }

  jump() {
    if (this.flying) return;
    if (this.grounded) { this.vel.y = Math.sqrt(2 * this.gravity * 1.15); this.grounded = false; }
  }

  toggleFly(force) {
    this.flying = force === undefined ? !this.flying : !!force;
    if (this.flying) this.vel.y = 0;
    return this.flying;
  }

  _axisFromKeys() {
    const k = this.keys;
    let f = 0, s = 0;
    if (k.has('w') || k.has('arrowup')) f += 1;
    if (k.has('s') || k.has('arrowdown')) f -= 1;
    if (k.has('d') || k.has('arrowright')) s += 1;
    if (k.has('a') || k.has('arrowleft')) s -= 1;
    if (f === 0 && s === 0) { f = -this.move.y; s = this.move.x; }   // touch stick
    const len = Math.hypot(f, s);
    if (len > 1) { f /= len; s /= len; }
    return { f, s };
  }

  update(dt) {
    dt = Math.min(dt, 0.05);
    const { f, s } = this._axisFromKeys();
    const sprint = this.keys.has('shift');

    this._tmpF.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this._tmpR.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    let speed = this.flying ? (sprint ? this.flyBoost : this.flySpeed) : (sprint ? this.sprintSpeed : this.walkSpeed);
    const inWater = this.world.planet.waterLevel !== null &&
      this.pos.y - EYE_HEIGHT < this.world.planet.waterLevel + 0.4;
    if (inWater && !this.flying) speed *= 0.45;

    const wish = this._tmpV.set(0, 0, 0)
      .addScaledVector(this._tmpF, f)
      .addScaledVector(this._tmpR, s);
    if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(speed);

    // horizontal accel (snappy on ground, floaty in flight)
    const accel = this.flying ? 9 : (this.grounded ? 26 : 9);
    this.vel.x += (wish.x - this.vel.x) * Math.min(1, accel * dt);
    this.vel.z += (wish.z - this.vel.z) * Math.min(1, accel * dt);

    // vertical
    if (this.flying) {
      let vy = 0;
      if (this.keys.has(' ') || this.keys.has('spacebar')) vy += 1;
      if (this.keys.has('control') || this.keys.has('c')) vy -= 1;
      this.vel.y += (vy * (sprint ? this.flyBoost : this.flySpeed) - this.vel.y) * Math.min(1, 7 * dt);
    } else {
      this.vel.y -= this.gravity * dt * (inWater ? 0.28 : 1);
      if (inWater) this.vel.y = Math.max(this.vel.y, -2.2);
    }

    this.pos.addScaledVector(this.vel, dt);

    // terrain
    const gy = this.world.terrain.heightAt(this.pos.x, this.pos.z) + EYE_HEIGHT;
    const floor = this.world.planet.waterLevel !== null
      ? Math.max(gy, this.world.planet.waterLevel + EYE_HEIGHT * 0.75)
      : gy;
    if (this.pos.y <= floor + 0.001) {
      this.pos.y = floor;
      if (this.vel.y < 0) this.vel.y = 0;
      this.grounded = true;
    } else if (this.pos.y > floor + 0.08) {
      this.grounded = false;
    }

    // trunk collisions
    const cols = this.world.colliders;
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      const dx = this.pos.x - c.x, dz = this.pos.z - c.z;
      const rr = c.r + this.playerRadius;
      const d2 = dx * dx + dz * dz;
      if (d2 < rr * rr && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        this.pos.x = c.x + (dx / d) * rr;
        this.pos.z = c.z + (dz / d) * rr;
        // kill the velocity pushing us into the trunk
        const nx = dx / d, nz = dz / d;
        const dot = this.vel.x * nx + this.vel.z * nz;
        if (dot < 0) { this.vel.x -= dot * nx; this.vel.z -= dot * nz; }
      }
    }

    // world bounds
    const lim = TERRAIN_SIZE / 2 - 12;
    this.pos.x = clamp(this.pos.x, -lim, lim);
    this.pos.z = clamp(this.pos.z, -lim, lim);

    // head bob
    const hs = Math.hypot(this.vel.x, this.vel.z);
    this.lastSpeed = hs;
    if (this.grounded && !this.flying && hs > 0.4) this.bobT += dt * hs * 2.4;
    const bob = Math.sin(this.bobT) * 0.045 * Math.min(1, hs / 3);
    const sway = Math.cos(this.bobT * 0.5) * 0.03 * Math.min(1, hs / 3);

    this.camera.position.set(this.pos.x + sway, this.pos.y + bob, this.pos.z);
    this.camera.rotation.set(0, 0, 0);
    this.camera.rotateY(this.yaw);
    this.camera.rotateX(this.pitch);
    this.camera.rotateZ(Math.sin(this.bobT * 0.5) * 0.006 * Math.min(1, hs / 3));

    this.altitude = this.pos.y - EYE_HEIGHT - this.world.terrain.heightAt(this.pos.x, this.pos.z);

    // keep the sun's shadow box centred on you
    const st = this.world.sunTarget;
    if (st) {
      st.position.set(this.pos.x, this.pos.y, this.pos.z);
      this.world.sun.position.set(this.pos.x - 180, this.pos.y + 240, this.pos.z + 120);
    }
    // spores follow you
    if (this.world.spores) this.world.spores.position.set(this.pos.x, 0, this.pos.z);
  }

  // nearest giant plant — powers the HUD scale read-out
  nearestPlant() {
    let best = null, bd = Infinity;
    const list = this.world.plantIndex;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const dx = p.x - this.pos.x, dz = p.z - this.pos.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < bd) { bd = d; best = p; }
    }
    return best ? { ...best, dist: bd } : null;
  }

  get headingDeg() { return (((-this.yaw * 180 / Math.PI) % 360) + 360) % 360; }
}
