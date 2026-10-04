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
    this.inCar = false; this.car = null; this.firstPersonCar = true;
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
    if (this.inCar && this.firstPersonCar) {
      this.camYaw = clamp((this.camYaw || 0) - this.look.x, -1.1, 1.1);
      this.camYaw *= Math.pow(.2, dt);                       // snap back to the road
    } else {
      this.yaw -= this.look.x;
    }
    this.pitch = clamp(this.pitch - this.look.y, -1.35, 1.35);
    this.look.x = this.look.y = 0;

    if (this.inCar) { this.updateCar(dt); return; }

    const k = this.keys;
    let fw = (k['KeyW'] || k['ArrowUp'] ? 1 : 0) - (k['KeyS'] || k['ArrowDown'] ? 1 : 0);
    let st = (k['KeyD'] || k['ArrowRight'] ? 1 : 0) - (k['KeyA'] || k['ArrowLeft'] ? 1 : 0);
    fw += this.move.y; st += this.move.x;
    fw = clamp(fw, -1, 1); st = clamp(st, -1, 1);
    const run = (k['ShiftLeft'] || this.sprinting) && g.save.stats.energy > 8;
    const base = (run ? 8.2 : 4.4) * this.speedMul;
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
    this.carSpeed = 0; this.camYaw = 0; this.pitch = 0;
    this.yaw = car.rotation.y;
    this.game.toast('🚗 W/S gas & brake · A/D steer · V camera · F exit');
  }
  exitCar() {
    this.inCar = false; this.yaw = this.car.rotation.y;
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
    // forgiving arcade handling: strong brakes, assisted steering, no spin-outs
    this.carSpeed += (gas * max * .6 - brk * max * 1.4) * dt;
    if (!gas && !brk) this.carSpeed *= Math.pow(.45, dt);        // engine brake
    this.carSpeed *= Math.pow(.75, dt);
    this.carSpeed = clamp(this.carSpeed, -max * .3, max);
    if (Math.abs(this.carSpeed) < .15) this.carSpeed = 0;
    const st = clamp(steer, -1, 1);
    this.steerVis = lerp(this.steerVis || 0, st, 1 - Math.pow(.004, dt));
    const grip = clamp(Math.abs(this.carSpeed) / 6, 0, 1) * (1 - clamp(Math.abs(this.carSpeed) / (max * 2.2), 0, .45));
    c.rotation.y += this.steerVis * dt * 1.7 * grip * Math.sign(this.carSpeed || 1);
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
      if (this.firstPersonCar) {
        // sit behind the wheel
        const off = new THREE.Vector3(-0.42, 1.42, 0.25).applyAxisAngle(new THREE.Vector3(0, 1, 0), c.rotation.y);
        cam.position.copy(c.position).add(off);
        cam.rotation.order = 'YXZ';
        cam.rotation.set(clamp(this.pitch, -.6, .5), c.rotation.y + clamp(this.camYaw || 0, -1.1, 1.1), 0);
        if (c.userData.wheelMesh) c.userData.wheelMesh.rotation.z = -(this.steerVis || 0) * 1.6;
      } else {
        const back = new THREE.Vector3(Math.sin(c.rotation.y) * 8.5, 4.2, Math.cos(c.rotation.y) * 8.5);
        cam.position.lerp(c.position.clone().add(back), .16);
        cam.lookAt(c.position.clone().add(new THREE.Vector3(0, 1.4, 0)));
      }
      return;
    }
    cam.position.copy(this.eye);
    cam.rotation.set(0, 0, 0, 'YXZ');
    cam.rotation.order = 'YXZ';
    cam.rotation.y = this.yaw; cam.rotation.x = this.pitch;
  }
}
