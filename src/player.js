// ============================================================
// player.js — first-person controller: walk/run/crouch, stamina,
// collisions, head bob & sway, procedural hands, held items,
// throwable objects, hiding, and the phone flashlight.
// ============================================================
import * as THREE from 'three';
import { clamp, lerp, damp, rand, AABB } from './utils.js';

const WALK = 3.1, RUN = 5.35, CROUCH = 1.55;
const EYE = 1.58, EYE_CROUCH = 0.92;
const RADIUS = 0.33;

export class Player {
  constructor(G) {
    this.G = G;
    this.pos = new THREE.Vector3(11.2, 0, -7.8);
    this.vel = new THREE.Vector3();
    this.yaw = Math.PI * 0.94; this.pitch = 0;
    this.crouched = false;
    this.stamina = 1; this.exhausted = false;
    this.bobPhase = 0; this.bobAmp = 0;
    this.eyeY = EYE;
    this.stepAcc = 0;
    this.hidden = null;       // spot id
    this.hideT = 0;
    this.items = new Map();
    this.thrown = [];
    this.reach = 0;           // reach-out anim 0..1
    this.swayX = 0; this.swayY = 0;
    this.swayLagX = 0; this.swayLagY = 0;
    this.speedBoost = 0;      // finale: adrenaline
    this.frozen = false;      // cinematics
    this.camNoiseT = 0;
    this._buildHands();
    this._buildFlash();
  }

  _skinMat() { return this.G.world.mat({ color: 0xc9a184 }); }
  _sleeveMat() { return this.G.world.mat({ color: 0x3a4a3c }); }

  _buildHands() {
    const cam = this.G.camera;
    this.handRoot = new THREE.Group();
    cam.add(this.handRoot);
    const mkArm = (side) => {
      const g = new THREE.Group();
      const fore = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.065, 0.3), this._sleeveMat());
      fore.position.set(0, 0, -0.12);
      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 0.14), this._skinMat());
      hand.position.set(0, 0, -0.3);
      const fingers = new THREE.Mesh(new THREE.BoxGeometry(0.068, 0.03, 0.06), this._skinMat());
      fingers.position.set(0, -0.005, -0.39);
      g.add(fore, hand, fingers);
      g.userData.base = new THREE.Vector3(side * 0.22, -0.24, -0.32);
      g.position.copy(g.userData.base);
      this.handRoot.add(g);
      return g;
    };
    this.armR = mkArm(1); this.armL = mkArm(-1);
    this.armR.rotation.x = 0.25; this.armL.rotation.x = 0.25;
    // held phone slab (left hand)
    this.phoneMesh = new THREE.Group();
    const slab = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.15, 0.012), this.G.world.mat({ color: 0x0c0c10 }));
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.075, 0.13),
      new THREE.MeshBasicMaterial({ color: 0x9db4d8 }));
    scr.position.z = -0.007; scr.rotation.y = Math.PI;
    this.phoneMesh.add(slab, scr);
    this.phoneMesh.position.set(0, 0.06, -0.36);
    this.phoneMesh.rotation.x = -0.5;
    this.phoneScreen = scr;
    this.armL.add(this.phoneMesh);
    this.phoneMesh.visible = false;
    // held item container (right hand)
    this.heldRoot = new THREE.Group();
    this.heldRoot.position.set(0, 0.03, -0.34);
    this.armR.add(this.heldRoot);
  }

  _buildFlash() {
    const cam = this.G.camera;
    this.flash = new THREE.SpotLight(0xfff2d8, 0, 17, 0.46, 0.55, 1.35);
    this.flash.castShadow = true;
    this.flash.shadow.mapSize.set(512, 512);
    this.flash.shadow.camera.near = 0.15; this.flash.shadow.camera.far = 17;
    this.flash.shadow.bias = -0.008;
    this.flash.position.set(0.09, -0.12, 0.05);
    this.flashTarget = new THREE.Object3D();
    this.flashTarget.position.set(0, -0.16, -3);
    cam.add(this.flash, this.flashTarget);
    this.flash.target = this.flashTarget;
    this.flashOn = false;
  }
  toggleFlash() {
    this.flashOn = !this.flashOn;
    this.flash.intensity = this.flashOn ? 16 : 0;
    this.G.audio.latch('switch');
    this.G.phone && this.G.phone.setFlashIcon(this.flashOn);
  }

  // ---------------- items ----------------
  hasItem(id) { return this.items.has(id); }
  giveItem(id, def = {}) {
    this.items.set(id, def);
    this.G.ui.setVigHint(this._hintText());
    this._heldVisual();
  }
  takeItem(id) {
    this.items.delete(id);
    this.G.ui.setVigHint(this._hintText());
    this._heldVisual();
  }
  currentHeld() { // first throwable-ish or last item
    let last = null;
    for (const [id, def] of this.items) last = { id, ...def };
    return last;
  }
  _heldVisual() {
    // clear
    while (this.heldRoot.children.length) this.heldRoot.remove(this.heldRoot.children[0]);
    const it = this.currentHeld();
    if (!it) return;
    let m = null;
    if (it.id === 'bottle') {
      m = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.18, 8), this.G.world.mat({ color: 0x3a6ea8 }));
    } else if (it.id === 'towels') {
      m = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.14, 0.2), this.G.world.texMat(this.G.T.pillow));
    } else if (it.id === 'trashbag') {
      m = new THREE.Mesh(new THREE.SphereGeometry(0.16, 7, 6), this.G.world.mat({ color: 0x14161a }));
    } else if (it.id === 'fuse') {
      m = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.1, 7), this.G.world.mat({ color: 0x8a6a3a }));
    } else if (it.id === 'carkeys' || it.id === 'masterkey' || it.id === 'registerkey') {
      m = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.007, 5, 10), this.G.world.mat({ color: 0xb0b0b0 }));
      m.rotation.x = Math.PI / 2;
    }
    if (m) { m.rotation.x = it.id === 'towels' ? 0 : 0.3; this.heldRoot.add(m); }
  }
  _hintText() {
    const bits = [];
    for (const [id, def] of this.items) bits.push(def.label || id);
    return bits.length ? 'HOLDING: ' + bits.join(' · ') : '';
  }
  throwHeld() {
    const held = this.currentHeld();
    if (!held || !held.throwable || this.hidden) return;
    const G = this.G;
    this.takeItem(held.id);
    const cam = G.camera;
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.18, 8), G.world.mat({ color: 0x3a6ea8 }));
    mesh.position.copy(cam.getWorldPosition(new THREE.Vector3())).add(dir.clone().multiplyScalar(0.4));
    mesh.position.y -= 0.15;
    G.scene.add(mesh);
    const info = {
      mesh, vel: dir.clone().multiplyScalar(9.5).add(new THREE.Vector3(0, 2.2, 0)),
      spin: new THREE.Vector3(rand(-6, 6), rand(-6, 6), rand(-6, 6)), landed: false,
    };
    this.thrown.push(info);
    G.audio.latch('ui');
    if (G.story) G.story.flags.bottleThrown = true;
  }
  _updateThrown(dt) {
    const G = this.G;
    for (const t of this.thrown) {
      if (t.landed) continue;
      t.vel.y -= 14 * dt;
      t.mesh.position.addScaledVector(t.vel, dt);
      t.mesh.rotation.x += t.spin.x * dt; t.mesh.rotation.y += t.spin.y * dt;
      if (t.mesh.position.y < 0.045) {
        t.mesh.position.y = 0.045;
        t.landed = true;
        t.mesh.rotation.set(Math.PI / 2, 0, rand(0, 6));
        const p = t.mesh.position;
        G.audio.footstep('metal', 0.5, { x: p.x, y: 0.2, z: p.z });
        G.ai && G.ai.hearNoise(p, 15, true);
      }
    }
  }

  // ---------------- hiding ----------------
  hide(spotId) {
    const spot = this.G.world.hideSpots.get(spotId);
    if (!spot || this.hidden) return;
    this.hidden = spotId; this.hideT = 0;
    if (spot.st) spot.st.target = 0; // closet doors slide shut
    this.G.audio.drawerSlide(false);
    this.G.story && this.G.story.hook('hid', spotId);
  }
  unhide() {
    const spot = this.G.world.hideSpots.get(this.hidden);
    if (!spot) { this.hidden = null; return; }
    this.pos.copy(spot.exit);
    if (spot.st) spot.st.target = 0.5;
    this.G.audio.drawerSlide(true);
    this.hidden = null; this.hideT = 0;
    this.G.story && this.G.story.hook('unhid', spot && spot.id);
  }

  applyLook(dx, dy) {
    const s = this.G.settings;
    const k = 0.0021 * s.sens;
    this.yaw -= dx * k;
    this.pitch -= dy * k * (s.invertY ? -1 : 1);
    this.pitch = clamp(this.pitch, -1.45, 1.45);
    this.swayLagX = clamp(this.swayLagX - dx * 0.00012, -0.12, 0.12);
    this.swayLagY = clamp(this.swayLagY - dy * 0.00012, -0.12, 0.12);
  }

  eyePos() {
    return new THREE.Vector3(this.pos.x, this.pos.y + this.eyeY, this.pos.z);
  }

  update(dt, input) {
    const G = this.G, cam = G.camera;
    // ---- hide mode ----
    if (this.hidden) {
      const spot = G.world.hideSpots.get(this.hidden);
      this.hideT = Math.min(1, this.hideT + dt * 2.4);
      const target = spot ? spot.eye : this.eyePos();
      cam.position.x = damp(cam.position.x, target.x, 8, dt);
      cam.position.y = damp(cam.position.y, target.y, 8, dt);
      cam.position.z = damp(cam.position.z, target.z, 8, dt);
      // breathing sway
      cam.position.y += Math.sin(G.time * 1.3) * 0.003;
      cam.rotation.order = 'YXZ';
      cam.rotation.y = this.yaw; cam.rotation.x = this.pitch; cam.rotation.z = 0;
      // inside a hiding spot: hands tucked away unless the phone is raised
      const phUpH = G.phone && G.phone.up;
      this.phoneMesh.visible = phUpH;
      this.handRoot.visible = !!phUpH;
      this._updateFlashFlicker(dt);
      this._updateThrown(dt);
      return;
    }
    if (this.frozen) {
      cam.rotation.order = 'YXZ';
      cam.rotation.y = this.yaw; cam.rotation.x = this.pitch;
      this._updateFlashFlicker(dt);
      return;
    }

    // ---- movement ----
    let fw = 0, st = 0;
    if (input.key('w') || input.key('arrowup')) fw += 1;
    if (input.key('s') || input.key('arrowdown')) fw -= 1;
    if (input.key('a') || input.key('arrowleft')) st -= 1;
    if (input.key('d') || input.key('arrowright')) st += 1;
    const moving = fw !== 0 || st !== 0;
    const wantRun = (input.key('shift') || input.key('shiftleft') || input.key('shiftright')) && moving && !this.crouched;
    let running = wantRun && !this.exhausted && this.stamina > 0.02;
    if ((input.pressed('c') || input.pressed('control'))) this.crouched = !this.crouched;
    // stamina
    if (running) {
      this.stamina -= dt / 6.5;
      if (this.stamina <= 0) { this.stamina = 0; this.exhausted = true; }
    } else {
      this.stamina = Math.min(1, this.stamina + dt / (this.exhausted ? 5 : 9));
      if (this.stamina > 0.4) this.exhausted = false;
    }
    G.ui.showStamina(this.stamina < 0.995 || this.exhausted, this.stamina, this.exhausted);

    const speed = (this.crouched ? CROUCH : running ? RUN : WALK) + this.speedBoost;
    let mx = 0, mz = 0;
    if (moving) {
      // camera-space: forward = -Z at yaw 0
      const f = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      const r = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      mx = f.x * fw + r.x * st; mz = f.z * fw + r.z * st;
      const l = Math.hypot(mx, mz) || 1; mx /= l; mz /= l;
    }
    const accel = 34;
    this.vel.x = damp(this.vel.x, mx * speed, moving ? 12 : 16, dt);
    this.vel.z = damp(this.vel.z, mz * speed, moving ? 12 : 16, dt);

    let px = this.pos.x + this.vel.x * dt;
    let pz = this.pos.z + this.vel.z * dt;
    // collide: circle vs boxes, two passes
    for (let pass = 0; pass < 2; pass++) {
      for (const c of G.world.colliders) {
        if (!c.solid) continue;
        [px, pz] = c.resolveCircle(px, pz, RADIUS, 1.0);
      }
    }
    // world bounds
    px = clamp(px, -46, 46); pz = clamp(pz, -32.5, 11.5);
    // stop if slammed into wall
    if (Math.abs(px - (this.pos.x + this.vel.x * dt)) > 0.001) this.vel.x *= 0.2;
    if (Math.abs(pz - (this.pos.z + this.vel.z * dt)) > 0.001) this.vel.z *= 0.2;
    const distMoved = Math.hypot(px - this.pos.x, pz - this.pos.z);
    this.pos.x = px; this.pos.z = pz;

    // ---- footsteps + noise ----
    const spd = Math.hypot(this.vel.x, this.vel.z);
    if (spd > 0.4 && distMoved > 0) {
      this.stepAcc += distMoved;
      const stride = this.crouched ? 1.5 : running ? 2.1 : 1.8;
      if (this.stepAcc > stride) {
        this.stepAcc = 0;
        const surf = G.world.surfaceAt(this.pos.x, this.pos.z);
        G.audio.footstep(surf, this.crouched ? 0.14 : running ? 0.5 : 0.3, null, running);
        const nr = this.crouched ? 1.6 : running ? 11 : 5;
        G.ai && G.ai.hearNoise(this.pos, nr, false);
      }
    }

    // ---- camera ----
    this.eyeY = damp(this.eyeY, this.crouched ? EYE_CROUCH : EYE, 10, dt);
    this.bobAmp = damp(this.bobAmp, clamp(spd / RUN, 0, 1) * (this.crouched ? 0.5 : 1), 8, dt);
    this.bobPhase += dt * (3.4 + spd * 1.35);
    const bobY = Math.sin(this.bobPhase * 2) * 0.024 * this.bobAmp;
    const bobX = Math.sin(this.bobPhase) * 0.014 * this.bobAmp;
    cam.position.set(this.pos.x + bobX * Math.cos(this.yaw), this.pos.y + this.eyeY + bobY, this.pos.z + bobX * -Math.sin(this.yaw));
    cam.rotation.order = 'YXZ';
    cam.rotation.y = this.yaw;
    cam.rotation.x = this.pitch + Math.sin(this.bobPhase * 2 + 1) * 0.004 * this.bobAmp;
    cam.rotation.z = Math.sin(this.bobPhase) * 0.006 * this.bobAmp;
    // fov subtle kick while sprinting
    G.effects.fovKick = Math.max(G.effects.fovKick, running ? 2.2 : 0);

    // idle breathing sway when standing still
    if (spd < 0.5) {
      cam.rotation.x += Math.sin(G.time * 1.1) * 0.0022;
      cam.position.y += Math.sin(G.time * 1.1) * 0.006;
    }

    // ---- hands sway ----
    this.swayLagX = damp(this.swayLagX || 0, 0, 6, dt);
    this.swayLagY = damp(this.swayLagY || 0, 0, 6, dt);
    const sway = clamp(spd / RUN, 0, 1);
    for (const [arm, side] of [[this.armR, 1], [this.armL, -1]]) {
      const base = arm.userData.base;
      arm.position.x = base.x + this.swayLagX * 0.5 + Math.sin(this.bobPhase) * 0.006 * sway;
      arm.position.y = base.y + this.swayLagY * 0.5 + Math.abs(Math.sin(this.bobPhase * 2)) * 0.008 * sway + Math.sin(G.time * 1.3) * 0.002;
      arm.rotation.x = 0.25 + Math.sin(this.bobPhase * 2) * 0.03 * sway;
      arm.rotation.z = side * -0.06;
    }
    // reach anim (either hand forward while interacting)
    this.reach = damp(this.reach, 0, 8, dt);
    if (this.reach > 0.02) {
      this.armR.position.z = -0.32 - this.reach * 0.18;
      this.armR.rotation.x = 0.25 + this.reach * 0.4;
    }
    // phone raise pose
    const phUp = G.phone && G.phone.up;
    this.phoneMesh.visible = phUp;
    if (phUp) {
      this.armL.position.set(-0.09, -0.16, -0.3);
      this.armL.rotation.x = 0.75;
    }
    this.phoneScreen.material.color.setHex(this.flashOn ? 0xd8e2f0 : 0x8ba0c4);
    this._updateFlashFlicker(dt);
    this._updateThrown(dt);
  }

  _updateFlashFlicker(dt) {
    if (!this.flashOn) return;
    // flashlight breathes & occasionally stutters low
    const t = this.G.time;
    let v = 15.5 + Math.sin(t * 17) * 0.5 + Math.sin(t * 4.3) * 0.4;
    if (this.G.story && this.G.story.flags.flashDip && Math.random() < 0.014) v *= 0.25;
    this.flash.intensity = v;
  }

  startReach() { this.reach = 1; }
}
