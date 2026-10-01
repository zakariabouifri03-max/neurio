// ── IRONVOW — the view: a head on a neck, not a floating camera ──────────────
// Every blow the player lands or stops comes back through here: the jolt of a
// parry, the shove of a shield, the way a winded man's head sinks between his
// shoulders. None of it changes where the steel goes — the pose layer owns
// that — it only changes what the fight FEELS like from inside a helmet.
import * as THREE from 'three';
import { clamp, clamp01, damp, rnd, jitter } from './mathx.js';

const UP = new THREE.Vector3(0, 1, 0);

export class View {
  constructor(camera) {
    this.cam = camera;
    this.yaw = 0;
    this.pitch = 0;
    this.maxPitch = 1.15;
    this.baseFov = camera.fov;
    this.kick = { pitch: 0, yaw: 0, roll: 0, z: 0 };
    this.shake = 0;
    this.bobT = 0;
    this.bob = { x: 0, y: 0, roll: 0 };
    this.breathT = rnd() * 10;
    this.stepT = 0;
    this.sens = 1;
    this.sway = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
  }

  setLook(yaw, pitch) {
    this.yaw = yaw;
    this.pitch = clamp(pitch, -this.maxPitch, this.maxPitch);
  }

  addLook(dyaw, dpitch) {
    this.yaw += dyaw;
    this.pitch = clamp(this.pitch + dpitch, -this.maxPitch, this.maxPitch);
  }

  /** A blow came in: the head snaps, the view kicks. */
  impact(power, dir = 'front') {
    const p = clamp01(power);
    this.kick.pitch += 0.16 * p * (dir === 'front' ? -1 : -0.4);
    this.kick.yaw += (dir === 'left' ? -1 : dir === 'right' ? 1 : 0) * 0.2 * p;
    this.kick.roll += jitter(0.1) * p;
    this.kick.z += 0.05 * p;
    this.shake = Math.min(1, this.shake + p * 0.9);
  }

  /** Steel met steel under your hands. */
  jolt(power) {
    const p = clamp01(power);
    this.kick.pitch += 0.05 * p;
    this.kick.z += 0.02 * p;
    this.shake = Math.min(1, this.shake + p * 0.5);
  }

  update(dt, f) {
    // ── head bob and the weight of the harness ──
    const speed = clamp01((f.speed || 0) / 3.2);
    this.bobT += dt * (2.2 + (f.speed || 0) * 1.6);
    this.stepT += dt * (1.4 + (f.speed || 0) * 1.9);
    this.bob.x = Math.cos(this.bobT) * 0.012 * speed;
    this.bob.y = Math.abs(Math.sin(this.bobT)) * 0.018 * speed;
    this.bob.roll = Math.cos(this.bobT) * 0.012 * speed;
    // ── breathing: calm at rest, ragged when the wind is gone ──
    this.breathT += dt * (f.exhausted ? 3.1 : 1.35);
    const breath = (f.exhausted ? 0.02 : 0.008) + clamp01(1 - f.stamina / f.maxStamina) * 0.014;
    const bx = Math.sin(this.breathT) * breath;
    const by = Math.cos(this.breathT * 0.8) * breath;
    // ── the guard pulls the head behind the steel ──
    const guard = f.blocking ? 1 : 0;
    // ── decaying kicks ──
    const k = this.kick;
    k.pitch = damp(k.pitch, 0, 9, dt);
    k.yaw = damp(k.yaw, 0, 9, dt);
    k.roll = damp(k.roll, 0, 7, dt);
    k.z = damp(k.z, 0, 10, dt);
    this.shake = Math.max(0, this.shake - dt * 2.6);
    const sh = this.shake * this.shake;
    const sx = jitter(0.02) * sh;
    const sy = jitter(0.02) * sh;

    const eye = f.eyeWorld(this._tmp, 0);
    const pos = this.cam.position;
    pos.copy(eye);
    pos.y += this.bob.y + by - this.pitch * 0.02;
    const fwd = f.forward();
    const right = new THREE.Vector3().crossVectors(fwd, UP).normalize();
    pos.addScaledVector(right, this.bob.x + bx - 0.05 * guard);
    pos.addScaledVector(fwd, -k.z - 0.04 * guard);

    this.cam.rotation.order = 'YXZ';
    this.cam.rotation.y = this.yaw + k.yaw + sx * 0.3;
    this.cam.rotation.x = this.pitch + k.pitch + sy;
    this.cam.rotation.z = this.bob.roll + k.roll + sx;
    // a sprint opens the view; a broken guard closes it
    const fov = this.baseFov + (f.speed > 2.6 ? 4 : 0) - (f.guardBroken > 0 ? 3 : 0);
    if (Math.abs(this.cam.fov - fov) > 0.01) { this.cam.fov = damp(this.cam.fov, fov, 5, dt); this.cam.updateProjectionMatrix(); }
    return this.cam;
  }
}
