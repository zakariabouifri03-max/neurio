// CameraController: broadcast / player / close / training views, all damped so they never snap.
// Exposes camFwd (camera forward on the pitch plane) so camera-relative controls stay correct.
import * as THREE from 'three';
import { CAMERA_MODES } from '../config.js';

export class CameraController {
  constructor(camera) {
    this.cam = camera;
    this.mode = 'broadcast';
    this.posTarget = new THREE.Vector3(0, 22, 24);
    this.lookTarget = new THREE.Vector3(0, 0, 0);
    this.look = new THREE.Vector3(0, 0, 0);
    this.camFwd = { x: 0, z: -1 };
    this.inited = false;
    this.fovFor = { broadcast: 42, player: 62, close: 58, training: 46 };
    this.shake = 0;
  }

  get modes() { return CAMERA_MODES; }

  setMode(mode) {
    if (!CAMERA_MODES.includes(mode)) return;
    this.mode = mode;
    this.inited = false;
    const fov = this.fovFor[mode] || 45;
    if (this.cam.fov !== fov) { this.cam.fov = fov; this.cam.updateProjectionMatrix(); }
  }

  cycle(dir = 1) {
    const i = CAMERA_MODES.indexOf(this.mode);
    this.setMode(CAMERA_MODES[(i + dir + CAMERA_MODES.length) % CAMERA_MODES.length]);
  }

  // ball: { x, y, z } (visual), subject: { pos, heading } | null, attackDirX: +1 | -1 for the human side
  update(dt, ball, subject, attackDirX = 1) {
    const b = ball;
    const pos = this.posTarget, look = this.lookTarget;
    if (this.mode === 'broadcast') {
      const px = THREE.MathUtils.clamp(b.x * 0.5, -9, 9);
      pos.set(px, 21, 25);
      look.set(b.x * 0.55, 0.2, b.z * 0.25);
    } else if (this.mode === 'player') {
      const s = subject || { pos: { x: b.x, z: b.z }, heading: 0 };
      const dx = Math.cos(s.heading), dz = Math.sin(s.heading);
      pos.set(s.pos.x - dx * 7.5, 4.6, s.pos.z - dz * 7.5);
      look.set(s.pos.x + dx * 5, 0.6, s.pos.z + dz * 5);
    } else if (this.mode === 'close') {
      pos.set(b.x - attackDirX * 3.2, 2.4, b.z + 4.2);
      look.set(b.x + attackDirX * 1.2, 0.3, b.z);
    } else {
      // training: high, nearly top-down over the ball
      pos.set(b.x, 26, b.z + 0.8);
      look.set(b.x, 0, b.z);
    }
    if (!this.inited) {
      this.cam.position.copy(pos);
      this.look.copy(look);
      this.inited = true;
    } else {
      const k = 1 - Math.exp(-dt * (this.mode === 'player' ? 9 : 5));
      this.cam.position.lerp(pos, k);
      this.look.lerp(look, Math.min(1, k * 1.3));
    }
    this.cam.lookAt(this.look);
    const fx = this.look.x - this.cam.position.x, fz = this.look.z - this.cam.position.z;
    const n = Math.hypot(fx, fz) || 1;
    this.camFwd = { x: fx / n, z: fz / n };
  }
}
