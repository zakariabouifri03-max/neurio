// ---------- first-person controller + driving ----------
import * as THREE from './threejs.js';
import { clamp, damp } from './util.js';
import { engineStart, engineUpdate, engineStop, sDoor } from './audio.js';

export class Player {
  constructor(camera, W) {
    this.cam = camera;
    this.W = W;
    this.yaw = 0; this.pitch = 0;
    this.pos = new THREE.Vector3(-13, 1.7, 70);
    this.mode = 'walk';           // walk | car
    this.car = null;
    this.sens = 1; this.invertY = false;
    this.bobT = 0;
  }

  look(dx, dy) {
    if (this.mode === 'car') {
      this._yo = clamp((this._yo || 0) - dx * 0.0016 * this.sens, -1.3, 1.3);
      this.pitch = clamp(this.pitch - dy * 0.0016 * this.sens * (this.invertY ? -1 : 1), -0.7, 0.7);
      return;
    }
    this.yaw -= dx * 0.0023 * this.sens;
    this.pitch = clamp(this.pitch - dy * 0.0023 * this.sens * (this.invertY ? -1 : 1), -1.45, 1.45);
  }

  update(dt, inp) {
    if (this.mode === 'car') return this.updateCar(dt, inp);
    // walking
    const speed = inp.run ? 6.2 : 3.4;
    const f = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const r = new THREE.Vector3(-f.z, 0, f.x);
    const move = new THREE.Vector3();
    move.addScaledVector(f, inp.fwd).addScaledVector(r, inp.strafe);
    if (move.lengthSq() > 0) move.normalize().multiplyScalar(speed * dt);
    this.pos.add(move);
    this.collide(this.pos, 0.45);
    this.pos.x = clamp(this.pos.x, -200, 200);
    this.pos.z = clamp(this.pos.z, -200, 200);
    const moving = move.lengthSq() > 1e-6;
    this.bobT += dt * (inp.run ? 11 : 7) * (moving ? 1 : 0);
    const bob = moving ? Math.sin(this.bobT) * 0.035 : 0;
    this.cam.position.set(this.pos.x, 1.7 + bob, this.pos.z);
    this.cam.rotation.order = 'YXZ';
    this.cam.rotation.y = this.yaw;
    this.cam.rotation.x = this.pitch;
    return { moving };
  }

  collide(p, radius) {
    const W = this.W;
    for (const c of W.collidersBox) {
      const dx = p.x - c.x, dz = p.z - c.z;
      const ex = c.hx + radius - Math.abs(dx), ez = c.hz + radius - Math.abs(dz);
      if (ex > 0 && ez > 0) {
        if (ex < ez) p.x += Math.sign(dx || 1) * ex; else p.z += Math.sign(dz || 1) * ez;
      }
    }
    for (const c of W.collidersCirc) {
      const dx = p.x - c.x, dz = p.z - c.z;
      const d2 = dx * dx + dz * dz, rr = c.r + radius;
      if (d2 < rr * rr && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        p.x = c.x + dx / d * rr; p.z = c.z + dz / d * rr;
      }
    }
  }

  enterCar(car) {
    this.car = car; this.mode = 'car';
    car.speed = 0;
    sDoor();
    engineStart();
  }

  exitCar() {
    const car = this.car;
    // place player beside car
    const side = new THREE.Vector3(Math.cos(car.yaw), 0, -Math.sin(car.yaw));
    const p = car.group.position.clone().addScaledVector(side, -1.8);
    p.y = 1.7;
    // try other side if blocked
    this.pos.copy(p);
    const before = p.clone();
    this.collide(this.pos, 0.45);
    if (this.pos.distanceTo(before) > 0.5) {
      this.pos.copy(car.group.position.clone().addScaledVector(side, 1.8)); this.pos.y = 1.7;
      this.collide(this.pos, 0.45);
    }
    this.yaw = car.yaw + (this._yo || 0);
    this._yo = 0; this.pitch = 0;
    this.car = null; this.mode = 'walk';
    sDoor();
    engineStop();
  }

  updateCar(dt, inp) {
    const car = this.car, def = car.def, g = car.group;
    const thr = clamp(inp.fwd, -1, 1);           // gas / reverse
    const brake = inp.brake || 0;
    // accel
    if (thr > 0) car.speed += def.acc * thr * dt;
    else if (thr < 0) {
      if (car.speed > 0.5) car.speed -= def.acc * 1.8 * dt;   // braking
      else car.speed -= def.acc * 0.45 * dt;                  // reversing
    }
    // drag + brake
    car.speed -= car.speed * 0.6 * dt;
    car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), brake * 22 * dt);
    car.speed = clamp(car.speed, -def.top * 0.35, def.top);
    // steering
    const steerT = clamp(inp.strafe, -1, 1);
    car.steer = damp(car.steer, steerT, 8, dt);
    const steerEff = car.steer * 1.9 * clamp(Math.abs(car.speed) / 8, 0, 1) / (1 + Math.abs(car.speed) * 0.06);
    car.yaw -= steerEff * dt * Math.sign(car.speed || 1);
    // move
    const fwd = new THREE.Vector3(Math.sin(car.yaw), 0, Math.cos(car.yaw));
    const np = g.position.clone().addScaledVector(fwd, car.speed * dt);
    const old = g.position.clone();
    g.position.copy(np);
    this.collideCar(g.position, 1.1);
    if (g.position.distanceTo(np) > 0.01) car.speed *= 0.4; // hit something
    g.position.y = 0;
    g.position.x = clamp(g.position.x, -195, 195);
    g.position.z = clamp(g.position.z, -195, 195);
    g.rotation.y = car.yaw;
    // wheels spin + steer
    for (let i = 0; i < 4; i++) car.wheels[i].rotation.x += car.speed * dt / 0.42;
    car.wheels[0].rotation.y = car.wheels[1].rotation.y = car.steer * 0.4;
    car.swheel.rotation.z = -car.steer * 1.6;
    // camera at driver seat
    const seatLocal = new THREE.Vector3(-0.45, 1.52, -0.1);
    const wp = seatLocal.clone().applyMatrix4(g.matrixWorld);
    this.cam.position.copy(wp);
    this.cam.rotation.order = 'YXZ';
    this.cam.rotation.y = car.yaw + this.yawOffset;
    this.cam.rotation.x = this.pitch * 0.6;
    engineUpdate(Math.abs(car.speed) / def.top, dt);
    return { moving: Math.abs(car.speed) > 0.5, speed: Math.abs(car.speed) };
  }

  collideCar(p, radius) {
    const W = this.W;
    for (const c of W.collidersBox) {
      const dx = p.x - c.x, dz = p.z - c.z;
      const ex = c.hx + radius - Math.abs(dx), ez = c.hz + radius - Math.abs(dz);
      if (ex > 0 && ez > 0) {
        if (ex < ez) p.x += Math.sign(dx || 1) * ex; else p.z += Math.sign(dz || 1) * ez;
      }
    }
    for (const c of W.collidersCirc) {
      const dx = p.x - c.x, dz = p.z - c.z;
      const d2 = dx * dx + dz * dz, rr = c.r + radius;
      if (d2 < rr * rr && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        p.x = c.x + dx / d * rr; p.z = c.z + dz / d * rr;
      }
    }
    // other cars
    for (const id in this.W.cars) {
      const o = this.W.cars[id];
      if (this.car && o === this.car) continue;
      const dx = p.x - o.group.position.x, dz = p.z - o.group.position.z;
      const d2 = dx * dx + dz * dz, rr = 2.4 + radius - 1.1;
      if (d2 < rr * rr && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        p.x = o.group.position.x + dx / d * rr; p.z = o.group.position.z + dz / d * rr;
      }
    }
  }

  get yawOffset() { return this._yo || 0; }
  set yawOffset(v) { this._yo = v; }
}
