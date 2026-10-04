// ── first-person player + car driving ───────────────────────────────────────
import * as THREE from 'three';
import { clamp, lerp } from './util.js';

const UP = new THREE.Vector3(0, 1, 0);

export class Player {
  constructor(game) {
    this.game = game;
    this.pos = new THREE.Vector3(-60, 0, -55);
    this.vel = new THREE.Vector3();
    this.yaw = Math.PI; this.pitch = 0;
    this.height = 1.72; this.radius = .42;
    this.bob = 0; this.speedMul = 1;
    this.inCar = false; this.car = null;
    this.keys = {};
    this.look = { x: 0, y: 0 };
    this.move = { x: 0, y: 0 };
    this.sprinting = false;
  }

  get eye() { return new THREE.Vector3(this.pos.x, this.pos.y + this.height + Math.sin(this.bob) * .045, this.pos.z); }

  collide(nx, nz) {
    const r = this.radius;
    let x = nx, z = nz;
    for (const c of this.game.world.colliders) {
      if (c.miny > this.pos.y + 2.2) continue;
      if (x + r > c.minx && x - r < c.maxx && z + r > c.minz && z - r < c.maxz) {
        // push out along smallest penetration
        const pxr = c.maxx + r - x, pxl = x - (c.minx - r);
        const pzf = c.maxz + r - z, pzb = z - (c.minz - r);
        const m = Math.min(pxr, pxl, pzf, pzb);
        if (m === pxr) x = c.maxx + r; else if (m === pxl) x = c.minx - r;
        else if (m === pzf) z = c.maxz + r; else z = c.minz - r;
      }
    }
    return [x, z];
  }

  update(dt) {
    const g = this.game;
    // look
    this.yaw -= this.look.x; this.pitch = clamp(this.pitch - this.look.y, -1.35, 1.35);
    this.look.x = this.look.y = 0;

    if (this.inCar) { this.updateCar(dt); return; }

    const k = this.keys;
    let fw = (k['KeyW'] || k['ArrowUp'] ? 1 : 0) - (k['KeyS'] || k['ArrowDown'] ? 1 : 0);
    let st = (k['KeyD'] || k['ArrowRight'] ? 1 : 0) - (k['KeyA'] || k['ArrowLeft'] ? 1 : 0);
    fw += this.move.y; st += this.move.x;
    fw = clamp(fw, -1, 1); st = clamp(st, -1, 1);
    const run = (k['ShiftLeft'] || this.sprinting) && g.save.stats.energy > 8;
    const base = (run ? 7.2 : 3.6) * this.speedMul;
    const dir = new THREE.Vector3(Math.sin(this.yaw) * -fw + Math.cos(this.yaw) * st, 0,
      -Math.cos(this.yaw) * -fw - Math.sin(this.yaw) * st);
    if (dir.lengthSq() > 0) dir.normalize();
    this.vel.x = lerp(this.vel.x, dir.x * base, 1 - Math.pow(.0015, dt));
    this.vel.z = lerp(this.vel.z, dir.z * base, 1 - Math.pow(.0015, dt));
    const sp = Math.hypot(this.vel.x, this.vel.z);
    this.bob += dt * sp * 1.9;
    const [nx, nz] = this.collide(this.pos.x + this.vel.x * dt, this.pos.z + this.vel.z * dt);
    this.pos.x = nx; this.pos.z = nz;
    if (run && sp > 1) g.addStat('energy', -dt * 1.1);
    g.walkDistance = (g.walkDistance || 0) + sp * dt;
  }

  // ── car ───────────────────────────────────────────────────────────────
  enterCar(car) {
    this.inCar = true; this.car = car;
    this.carSpeed = 0;
    this.game.toast('🚗 Driving — W/S gas & brake, A/D steer, F to exit');
  }
  exitCar() {
    this.inCar = false;
    const c = this.car;
    this.pos.set(c.position.x + Math.cos(c.rotation.y) * 2.4, 0, c.position.z - Math.sin(c.rotation.y) * 2.4);
    const [x, z] = this.collide(this.pos.x, this.pos.z); this.pos.x = x; this.pos.z = z;
    this.car = null;
  }
  updateCar(dt) {
    const c = this.car, k = this.keys;
    const gas = (k['KeyW'] || k['ArrowUp'] ? 1 : 0) + Math.max(0, this.move.y);
    const brk = (k['KeyS'] || k['ArrowDown'] ? 1 : 0) + Math.max(0, -this.move.y);
    const steer = (k['KeyA'] || k['ArrowLeft'] ? 1 : 0) - (k['KeyD'] || k['ArrowRight'] ? 1 : 0) - this.move.x;
    const max = c.userData.topSpeed || 22;
    this.carSpeed += (gas * max * .55 - brk * max * .9) * dt;
    this.carSpeed *= Math.pow(.55, dt);
    this.carSpeed = clamp(this.carSpeed, -max * .35, max);
    c.rotation.y += steer * dt * 1.5 * clamp(Math.abs(this.carSpeed) / 8, 0, 1) * Math.sign(this.carSpeed || 1);
    const dx = -Math.sin(c.rotation.y) * this.carSpeed * dt;
    const dz = -Math.cos(c.rotation.y) * this.carSpeed * dt;
    const r = 1.6;
    let nx = c.position.x + dx, nz = c.position.z + dz, hit = false;
    for (const col of this.game.world.colliders) {
      if (col.miny > 2.5) continue;
      if (nx + r > col.minx && nx - r < col.maxx && nz + r > col.minz && nz - r < col.maxz) { hit = true; break; }
    }
    if (hit) { this.carSpeed *= -.25; } else { c.position.x = nx; c.position.z = nz; }
    c.children.forEach(ch => { if (ch.userData.wheel) ch.rotation.x += this.carSpeed * dt * 2; });
    this.pos.set(c.position.x, 0, c.position.z);
    this.game.kmDriven = (this.game.kmDriven || 0) + Math.abs(this.carSpeed) * dt / 1000;
  }

  applyCamera(cam) {
    if (this.inCar) {
      const c = this.car;
      const back = new THREE.Vector3(Math.sin(c.rotation.y) * 8.5, 4.2, Math.cos(c.rotation.y) * 8.5);
      const target = c.position.clone().add(back);
      cam.position.lerp(target, .16);
      const look = c.position.clone().add(new THREE.Vector3(0, 1.4, 0));
      cam.lookAt(look);
      cam.rotateY(0); // keep behind-car view
      return;
    }
    cam.position.copy(this.eye);
    cam.rotation.set(0, 0, 0, 'YXZ');
    cam.rotation.order = 'YXZ';
    cam.rotation.y = this.yaw; cam.rotation.x = this.pitch;
  }
}
