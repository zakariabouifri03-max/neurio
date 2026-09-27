// ============================================================
// npc.js — procedural low-poly humans with primitive rigs and
// code-driven animation (walk, run, idle, peer, head tracking).
// ============================================================
import * as THREE from 'three';
import { clamp, lerp, damp, angleLerp } from './utils.js';

export class Human {
  constructor(world, {
    height = 1.8, bulk = 1, skin = 0xc9a184, shirt = 0x4a5240, pants = 0x2c3038,
    shoes = 0x1a1712, faceTex = null, hair = 0x2a2018, hood = null, noFace = false,
  } = {}) {
    this.world = world;
    this.group = new THREE.Group();
    const hipH = height * 0.52, torsoH = height * 0.34, armLen = height * 0.40;
    const legH = hipH;
    const mat = (c) => world.mat({ color: c });

    // legs
    const legG = (side) => {
      const g = new THREE.Group();
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.13 * bulk, legH, 0.15 * bulk), mat(pants));
      leg.position.y = -legH / 2;
      const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.13 * bulk, 0.07, 0.24 * bulk), mat(shoes));
      shoe.position.set(0, -legH + 0.035, 0.04);
      g.add(leg, shoe);
      g.position.set(side * 0.11 * bulk, legH, 0);
      this.group.add(g);
      return g;
    };
    this.legL = legG(-1); this.legR = legG(1);

    // torso
    this.torso = new THREE.Mesh(new THREE.BoxGeometry(0.42 * bulk, torsoH, 0.24 * bulk), mat(shirt));
    this.torso.position.y = hipH + torsoH / 2 - 0.02;
    this.group.add(this.torso);

    // arms
    const armG = (side) => {
      const g = new THREE.Group();
      const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.11 * bulk, armLen * 0.45, 0.12 * bulk), mat(shirt));
      sleeve.position.y = -armLen * 0.22;
      const fore = new THREE.Mesh(new THREE.BoxGeometry(0.09 * bulk, armLen * 0.45, 0.1 * bulk), mat(skin));
      fore.position.y = -armLen * 0.68;
      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.09 * bulk, 0.11, 0.05), mat(skin));
      hand.position.set(0, -armLen * 0.95, 0.02);
      g.add(sleeve, fore, hand);
      g.position.set(side * (0.21 * bulk + 0.05), hipH + torsoH - 0.08, 0);
      this.group.add(g);
      return g;
    };
    this.armL = armG(-1); this.armR = armG(1);

    // head (+z front face gets the face texture)
    const neckY = hipH + torsoH - 0.02;
    this.headG = new THREE.Group();
    this.headG.position.set(0, neckY, 0);
    const headH = height * 0.135, headW = headH * 0.86, headD = headH * 0.9;
    const headGeo = new THREE.BoxGeometry(headW, headH, headD);
    const skinM = mat(skin);
    let mats = [skinM, skinM, skinM, skinM, skinM, skinM];
    if (faceTex) {
      mats[4] = new THREE.MeshLambertMaterial({ map: faceTex });
    }
    this.headMesh = new THREE.Mesh(headGeo, mats);
    this.headMesh.position.y = headH / 2 + 0.015;
    this.headG.add(this.headMesh);
    if (hair !== null) {
      const h = new THREE.Mesh(new THREE.BoxGeometry(headW + 0.012, headH * 0.3, headD + 0.012), mat(hair));
      h.position.set(0, headH * 0.86, -0.008);
      this.headMesh.add(h);
    }
    if (hood) {
      const hd = new THREE.Mesh(new THREE.BoxGeometry(headW + 0.06, headH + 0.05, headD + 0.08), mat(hood));
      hd.position.set(0, headH / 2 + 0.03, -0.05);
      this.headG.add(hd);
    }
    this.group.add(this.headG);
    this.group.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = false; } });

    this.height = height;
    this.phase = 0;
    this.motion = 'idle'; this.speedFactor = 0;
    this._amp = 0;
    this._lookYaw = 0; this._lookPitch = 0; this._lookTarget = null;
    this._tilt = 0; this._tiltTarget = 0;
    this.peer = 0; this._peerTarget = 0;
  }

  setMotion(mode, speedFactor = 1) { this.motion = mode; this.speedFactor = speedFactor; }
  lookAt(x, y, z, immediate = false) {
    this._lookTarget = new THREE.Vector3(x, y, z);
    if (immediate) this._updateLook(10);
  }
  clearLook() { this._lookTarget = null; }
  headTilt(a) { this._tiltTarget = a; }
  setPeer(on) { this._peerTarget = on ? 1 : 0; }

  _updateLook(dt) {
    let yaw = 0, pitch = 0;
    if (this._lookTarget) {
      const hp = new THREE.Vector3();
      this.headG.getWorldPosition(hp);
      const local = this._lookTarget.clone().sub(hp);
      // remove group world rotation to get local yaw
      const gy = this.group.rotation.y;
      const dx = local.x, dz = local.z, dy = local.y;
      const worldYaw = Math.atan2(dx, dz);
      yaw = worldYaw - gy;
      while (yaw > Math.PI) yaw -= Math.PI * 2;
      while (yaw < -Math.PI) yaw += Math.PI * 2;
      pitch = -Math.atan2(dy, Math.hypot(dx, dz));
      yaw = clamp(yaw, -1.25, 1.25); pitch = clamp(pitch, -0.6, 0.65);
    }
    this._lookYaw = angleLerp(this._lookYaw, yaw, Math.min(1, dt * 5));
    this._lookPitch = lerp(this._lookPitch, pitch, Math.min(1, dt * 5));
  }

  update(dt, time = 0) {
    const moving = this.motion === 'walk' || this.motion === 'run';
    const targetAmp = moving ? (this.motion === 'run' ? 0.95 : 0.55) * clamp(this.speedFactor, 0.3, 1.4) : 0;
    this._amp = damp(this._amp, targetAmp, 8, dt);
    if (moving) this.phase += dt * this.speedFactor * (this.motion === 'run' ? 11 : 6.2);
    const s = Math.sin(this.phase), c = Math.cos(this.phase);
    this.legL.rotation.x = s * this._amp;
    this.legR.rotation.x = -s * this._amp;
    this.armL.rotation.x = -s * this._amp * 0.8;
    this.armR.rotation.x = s * this._amp * 0.8;
    this.armL.rotation.z = 0.07; this.armR.rotation.z = -0.07;
    // body bob + lean
    const bob = Math.abs(Math.sin(this.phase)) * 0.045 * this._amp;
    if (this.torso.userData.y0 === undefined) this.torso.userData.y0 = this.torso.position.y;
    this.torso.position.y = this.torso.userData.y0 + bob * 0.4;
    this.torso.rotation.x = this._amp * 0.06 + this.peer * 0.5;
    this.torso.rotation.y = Math.sin(this.phase * 0.5) * 0.02 * this._amp;
    this.torso.scale.y = 1 + Math.sin(time * 1.4) * 0.005; // breathing
    if (this.headG.userData.y0 === undefined) this.headG.userData.y0 = this.headG.position.y;
    this.headG.position.y = this.headG.userData.y0 + bob * 0.3;
    // peer lean
    this.peer = damp(this.peer, this._peerTarget, 5, dt);
    this.headG.rotation.x = 0;
    // look
    this._updateLook(dt);
    this.headG.rotation.y = this._lookYaw;
    this.headG.rotation.x = this._lookPitch - this.peer * 0.28;
    this._tilt = damp(this._tilt, this._tiltTarget, 3, dt);
    this.headG.rotation.z = this._tilt;
    // idle sway
    if (!moving) {
      this.torso.rotation.y = Math.sin(time * 0.6) * 0.03;
      this.armL.rotation.z = 0.07 + Math.sin(time * 0.7) * 0.01;
      this.armR.rotation.z = -0.07 - Math.sin(time * 0.7) * 0.01;
      this.group.position.y = Math.sin(time * 1.1) * 0.004;
    }
  }
}

// A disembodied pale arm used for the room-4 towel delivery scare.
export class PaleArm {
  constructor(scene) {
    this.group = new THREE.Group();
    const skin = new THREE.MeshLambertMaterial({ color: 0xd8c4b2 });
    const sleeve = new THREE.MeshLambertMaterial({ color: 0x3a3632 });
    const upper = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.42), sleeve);
    upper.position.z = 0.2;
    const fore = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.075, 0.34), skin);
    fore.position.z = 0.58;
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.045, 0.16), skin);
    hand.position.set(0, -0.01, 0.82);
    const fingers = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.03, 0.09), skin);
    fingers.position.set(0, -0.02, 0.94);
    this.group.add(upper, fore, hand, fingers);
    this.group.visible = false;
    this.group.traverse(m => { if (m.isMesh) m.castShadow = true; });
    scene.add(this.group);
    this.fingers = fingers; this.hand = hand;
  }
  show(x, y, z, yaw) {
    this.group.position.set(x, y, z);
    this.group.rotation.y = yaw;
    this.group.visible = true;
  }
  hide() { this.group.visible = false; }
  grab() { // fingers curl
    this.fingers.rotation.x = 0.9; this.fingers.position.z = 0.9;
  }
}
