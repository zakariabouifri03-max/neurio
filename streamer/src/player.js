// ── First-person controller + cockpit driving ───────────────────────────────
import * as THREE from 'three';
import { clamp } from './util.js';
import { buildCockpit } from './npc.js';
import { audio } from './audio.js';

export class Player {
  constructor(camera) {
    this.camera = camera;
    this.pos = new THREE.Vector3(0, 0, 0);
    this.yaw = 0; this.pitch = 0;
    this.vel = new THREE.Vector3();
    this.keys = { f: false, b: false, l: false, r: false, run: false };
    this.enabled = true;
    this.bob = 0;
    this.stepAcc = 0;
    this.onStep = null;
    // driving
    this.car = null;         // {mesh, stats, id}
    this.carSpeed = 0;
    this.steer = 0;
    this.cockpit = null;
    this.onDriveKey = null;  // main handles Q exit
  }

  teleport(x, z, yaw) {
    this.pos.set(x, 0, z);
    this.yaw = yaw ?? this.yaw;
    this.vel.set(0, 0, 0);
  }

  addLook(dx, dy, sens) {
    this.yaw -= dx * 0.0024 * sens;
    this.pitch = clamp(this.pitch - dy * 0.0022 * sens, -1.35, 1.35);
  }

  forward() {
    return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  collide(px, pz, r, colliders) {
    for (const c of colliders) {
      const dx = px - c.x, dz = pz - c.z;
      const ox = c.hx + r - Math.abs(dx);
      const oz = c.hz + r - Math.abs(dz);
      if (ox > 0 && oz > 0) {
        if (ox < oz) px += ox * Math.sign(dx || 1);
        else pz += oz * Math.sign(dz || 1);
      }
    }
    return [px, pz];
  }

  enterCar(car) {
    this.car = car;
    this.carSpeed = 0; this.steer = 0;
    this.cockpit = buildCockpit();
    this.camera.add(this.cockpit);
    audio.engineStart();
  }

  exitCar() {
    if (!this.car) return;
    const c = this.car;
    // place player to the side of the car
    const side = new THREE.Vector3(Math.cos(c.mesh.rotation.y), 0, -Math.sin(c.mesh.rotation.y)).multiplyScalar(1.6);
    this.pos.copy(c.mesh.position).add(side);
    this.pos.y = 0;
    this.yaw = c.mesh.rotation.y + Math.PI;
    this.camera.remove(this.cockpit);
    this.cockpit = null;
    this.car = null;
    this.carSpeed = 0;
    audio.engine(0, false);
  }

  update(dt, colliders, opts = {}) {
    const cam = this.camera;
    if (this.car) {
      const car = this.car;
      const st = car.stats;
      const accelIn = this.keys.f ? 1 : 0;
      const brakeIn = this.keys.b ? 1 : 0;
      const hand = opts.handbrake;
      // speed
      if (accelIn) this.carSpeed += st.accel * dt;
      else if (brakeIn) this.carSpeed -= (this.carSpeed > 0.5 ? st.accel * 1.8 : st.accel * 0.6) * dt;
      else this.carSpeed -= this.carSpeed * 0.6 * dt;
      if (hand) this.carSpeed -= this.carSpeed * 3.2 * dt;
      this.carSpeed = clamp(this.carSpeed, -st.speed * 0.35, st.speed);
      // steer
      const steerIn = (this.keys.l ? 1 : 0) - (this.keys.r ? 1 : 0);
      this.steer += (steerIn - this.steer) * Math.min(1, dt * 7);
      const spdN = Math.abs(this.carSpeed) / st.speed;
      car.mesh.rotation.y += this.steer * st.turn * dt * clamp(this.carSpeed / 6, -1, 1) * (hand ? 1.5 : 1);
      const fx = -Math.sin(car.mesh.rotation.y), fz = -Math.cos(car.mesh.rotation.y);
      let nx = car.mesh.position.x + fx * this.carSpeed * dt;
      let nz = car.mesh.position.z + fz * this.carSpeed * dt;
      // collide
      let hit = false;
      for (const c of colliders) {
        const ox = c.hx + 1.1 - Math.abs(nx - c.x);
        const oz = c.hz + 1.1 - Math.abs(nz - c.z);
        if (ox > 0 && oz > 0) { hit = true; break; }
      }
      if (Math.abs(nx) > 155 || Math.abs(nz) > 145) hit = true;
      if (hit) {
        if (Math.abs(this.carSpeed) > 4) audio._noise(0.2, 0.3, 300);
        this.carSpeed *= -0.25;
      } else {
        car.mesh.position.x = nx; car.mesh.position.z = nz;
      }
      car.mesh.userData.wheels.forEach((w) => (w.rotation.x += this.carSpeed * dt * 2.6));
      if (this.cockpit) {
        this.cockpit.userData.wheel.rotation.z = -this.steer * 1.9;
        const nd = this.cockpit.userData.needles;
        if (nd) { nd[0].rotation.z = -1.1 + spdN * 2.2; nd[1].rotation.z = 0.9 - spdN * 1.4; }
      }
      // camera in cockpit
      cam.position.set(
        car.mesh.position.x - fx * 0.35,
        1.18,
        car.mesh.position.z - fz * 0.35
      );
      cam.rotation.order = 'YXZ';
      cam.rotation.set(0, car.mesh.rotation.y, 0);
      audio.engine(spdN, Math.abs(this.carSpeed) > 0.3 || accelIn);
      this.pos.copy(car.mesh.position);
      return { driving: true, speed: Math.abs(this.carSpeed) };
    }

    // ── walking ──
    if (!this.enabled) { cam.position.set(this.pos.x, 1.62, this.pos.z); cam.rotation.set(this.pitch, this.yaw, 0, 'YXZ'); cam.rotation.order = 'YXZ'; return { driving: false, speed: 0 }; }
    const f = this.forward();
    const right = new THREE.Vector3(-f.z, 0, f.x);
    const wish = new THREE.Vector3();
    if (this.keys.f) wish.add(f);
    if (this.keys.b) wish.sub(f);
    if (this.keys.r) wish.add(right);
    if (this.keys.l) wish.sub(right);
    const moving = wish.lengthSq() > 0;
    if (moving) wish.normalize();
    const speed = this.keys.run ? 5.6 : 3.1;
    this.vel.lerp(wish.multiplyScalar(speed), Math.min(1, dt * 10));
    let nx = this.pos.x + this.vel.x * dt;
    let nz = this.pos.z + this.vel.z * dt;
    [nx, nz] = this.collide(nx, nz, 0.35, colliders);
    nx = clamp(nx, -75.2, 155); nz = clamp(nz, -145, 145);
    this.pos.x = nx; this.pos.z = nz;

    const hSpeed = Math.hypot(this.vel.x, this.vel.z);
    if (hSpeed > 0.5) {
      this.bob += dt * hSpeed * 1.9;
      this.stepAcc += hSpeed * dt;
      if (this.stepAcc > 2.2) { this.stepAcc = 0; if (this.onStep) this.onStep(); }
    }
    const eyeY = 1.62 + (hSpeed > 0.5 ? Math.sin(this.bob) * 0.035 : 0);
    cam.position.set(this.pos.x, eyeY, this.pos.z);
    cam.rotation.order = 'YXZ';
    cam.rotation.set(this.pitch, this.yaw, 0);
    return { driving: false, speed: hSpeed, moving };
  }
}
