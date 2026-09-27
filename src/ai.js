// ============================================================
// ai.js — the man. A human enemy with vision, hearing, door
// use, investigation, searching and a full chase state.
// Plus Vale's window-watcher. Plus path-follow helpers used by
// scripted scares.
// ============================================================
import * as THREE from 'three';
import { Human, PaleArm } from './npc.js';
import { clamp, lerp, damp, angleLerp, rand, losClear } from './utils.js';

const AIWALK = 1.55, INVEST = 2.5, CHASE = 4.4;

export class Stalker {
  constructor(G) {
    this.G = G;
    this.human = new Human(G.world, {
      height: 1.97, bulk: 1.1, skin: 0xd4c2b0, shirt: 0x23251f, pants: 0x181a16,
      shoes: 0x0d0c0b, faceTex: G.T.faceStalker, hair: null, hood: 0x1a1c17,
    });
    this.group = this.human.group;
    this.group.visible = false;
    G.scene.add(this.group);
    this.pos = this.group.position;
    this.yaw = 0; this.yawTarget = 0;
    this.mode = 'off';
    this.path = null; this.pathIdx = 0; this.onPathDone = null;
    this.speed = 0; this.speedTarget = 0;
    this.motion = 'walk';
    this.detect = 0;            // 0..1 suspicion
    this.lastKnown = new THREE.Vector3();
    this.lostT = 0;
    this.patrolWps = []; this.patrolIdx = 0;
    this.pauseT = 0;
    this.stepAcc = 0;
    this.sawHide = false;
    this.poundT = 0; this.poundDoorRef = null;
    this.investigateTarget = null;
    this.awareT = 0; this.awareStung = false;
    this.searchT = 0; this.searchSpots = [];
    this.finale = false;        // script-driven chase, always knows where you are
    this.grabRange = 0.85;
    this._stuckT = 0; this._lastPos = new THREE.Vector3();
    this._avoidSign = 1;
  }

  spawn(x, z, yaw = 0) {
    this.pos.set(x, 0, z);
    this.yaw = this.yawTarget = yaw;
    this.group.visible = true;
    this.mode = 'idle';
    this.speed = this.speedTarget = 0;
    this.human.setMotion('idle');
  }
  despawn() {
    this.group.visible = false;
    this.mode = 'off';
    this.path = null;
    this.detect = 0;
    this.finale = false;
  }

  // ---------- orders ----------
  followPath(points, { speed = AIWALK, motion = 'walk', onDone = null, faceEnd = null } = {}) {
    this.path = points.map(p => new THREE.Vector3(p.x, 0, p.z ?? p.y));
    this.pathIdx = 0;
    this.onPathDone = onDone;
    this.speedPath = speed;
    this.motion = motion;
    this.faceEnd = faceEnd;
    this.mode = 'path';
  }
  idleAt(x, z, yaw = 0, watchPlayer = false) {
    this.spawn(x, z, yaw);
    this.mode = watchPlayer ? 'watch' : 'idle';
  }
  startHunt(waypoints) {
    this.patrolWps = waypoints;
    this.patrolIdx = 0;
    this.mode = 'patrol';
    this.detect = 0.15;
    this.pauseT = 0;
  }
  startChase({ finale = false } = {}) {
    this.mode = 'chase';
    this.finale = finale;
    this.lostT = 0;
    this.detect = 1;
    this.sawHide = false;
    this.G.ai && (this.G.ai._chasing = true);
  }
  hearNoise(pos, radius, loud = false) {
    if (this.mode === 'off' || this.mode === 'chase' || this.mode === 'watch' || this.mode === 'script' || this.mode === 'doorpound') return;
    const d = Math.hypot(pos.x - this.pos.x, pos.z - this.pos.z);
    if (d < radius) {
      this.investigateTarget = new THREE.Vector3(pos.x + rand(-1, 1), 0, pos.z + rand(-1, 1));
      if (this.mode !== 'investigate' || loud) this.mode = 'investigate';
      if (loud && d < radius * 0.5) this.detect = Math.min(1, this.detect + 0.4);
    }
  }

  _eye() { return new THREE.Vector3(this.pos.x, 1.82, this.pos.z); }

  canSeePlayer() {
    const G = this.G, p = G.player;
    if (p.hidden) return false;
    const eye = this._eye(), pp = p.eyePos();
    const dx = pp.x - eye.x, dz = pp.z - eye.z;
    const d = Math.hypot(dx, dz);
    let range = 13;
    if (p.flashOn) range = 24;
    if (G.story && G.story.flags.powerOut) range = p.flashOn ? 22 : 8;
    if (d > range) return false;
    // fov ~110°
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const dot = (dx * fx + dz * fz) / (d || 1);
    if (dot < 0.42 && d > 1.6) return false;
    return losClear(G.world.colliders, eye.x, eye.z, pp.x, pp.z, Math.min(eye.y, pp.y) + 0.3);
  }

  _moveToward(tx, tz, speed, dt) {
    const G = this.G;
    let dx = tx - this.pos.x, dz = tz - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.12) return true;
    dx /= d; dz /= d;
    // stuck detection & side-step
    this._stuckT += dt;
    if (this._stuckT > 0.45) {
      const moved = Math.hypot(this.pos.x - this._lastPos.x, this.pos.z - this._lastPos.z);
      if (moved < 0.06 * speed * this._stuckT) { this._avoidSign *= -1; }
      this._lastPos.copy(this.pos);
      this._stuckT = 0;
    }
    // door handling: probe ahead
    const probeX = this.pos.x + dx * 0.85, probeZ = this.pos.z + dz * 0.85;
    for (const door of G.world.doors.values()) {
      if (!door.closedBox.solid) continue;
      if (door.closedBox.contains2D(probeX, probeZ, 0.15)) {
        if (!door.locked) {
          if (door.target < 1) { G.audio.doorCreak(true, { x: door.cx, y: 1.2, z: door.z }, true); door.open(true); }
          return false; // wait for it to swing
        } else if (this.mode === 'chase') {
          // hammer on it, stuck here
          this.poundT -= dt;
          if (this.poundT <= 0) {
            this.poundT = 1.5;
            door.pound();
            G.audio.knock(2, { x: door.cx, y: 1.2, z: door.z }, 1.0, true);
          }
          this.yawTarget = Math.atan2(door.cx - this.pos.x, door.z - this.pos.z);
          return false;
        }
      }
    }
    // steering w/ wall slide
    const sidestep = this._avoidSign * 0.0; // resolved by collision slide instead
    let nx = this.pos.x + dx * speed * dt;
    let nz = this.pos.z + dz * speed * dt;
    for (let pass = 0; pass < 2; pass++)
      for (const c of G.world.colliders) {
        if (!c.solid) continue;
        [nx, nz] = c.resolveCircle(nx, nz, 0.34, 1.0);
      }
    // keep inside bounds
    nx = clamp(nx, -46, 46); nz = clamp(nz, -32.5, 11.5);
    const vx = (nx - this.pos.x) / dt, vz = (nz - this.pos.z) / dt;
    this.pos.x = nx; this.pos.z = nz;
    const realSpeed = Math.hypot(vx, vz);
    this.yawTarget = Math.atan2(dx, dz);
    this.human.setMotion(realSpeed > 3 ? 'run' : 'walk', clamp(realSpeed / 2.2, 0.5, 2.2));
    // footsteps
    this.stepAcc += realSpeed * dt;
    const stride = realSpeed > 3 ? 2.3 : 1.9;
    if (this.stepAcc > stride) {
      this.stepAcc = 0;
      const surf = G.world.surfaceAt(this.pos.x, this.pos.z);
      G.audio.footstep(surf, realSpeed > 3 ? 0.65 : 0.42, { x: this.pos.x, y: 0.2, z: this.pos.z }, realSpeed > 3);
    }
    return d < 0.35;
  }

  _face(dt, rate = 7) {
    this.yaw = angleLerp(this.yaw, this.yawTarget, 1 - Math.exp(-rate * dt));
    this.group.rotation.y = this.yaw;
  }

  update(dt) {
    if (this.mode === 'off') return;
    const G = this.G, p = G.player;
    this.speed = damp(this.speed, this.speedTarget, 6, dt);

    switch (this.mode) {
      case 'script': break; // story moves him
      case 'idle':
      case 'watch': {
        this.speedTarget = 0;
        this.human.setMotion('idle');
        if (this.mode === 'watch') {
          const pp = p.eyePos();
          this.group.lookAt ? null : null;
          // slow, awful head tracking + body yaw
          this.yawTarget = Math.atan2(pp.x - this.pos.x, pp.z - this.pos.z);
          this._face(dt, 2.2);
          this.human.lookAt(pp.x, pp.y, pp.z);
          // head tilt if you shine your light at him
          this.human.headTilt(p.flashOn ? 0.42 : 0);
        }
        break;
      }
      case 'path': {
        if (!this.path) { this.mode = 'idle'; break; }
        const target = this.path[this.pathIdx];
        if (this._moveToward(target.x, target.z, this.speedPath, dt)) {
          this.pathIdx++;
          if (this.pathIdx >= this.path.length) {
            const cb = this.onPathDone; this.path = null; this.onPathDone = null;
            this.mode = 'idle';
            this.speedTarget = 0;
            this.human.setMotion('idle');
            if (this.faceEnd) this.yawTarget = this.faceEnd;
            cb && cb();
          }
        }
        this._face(dt, 6);
        break;
      }
      case 'patrol': {
        if (this.pauseT > 0) {
          this.pauseT -= dt;
          this.human.setMotion('idle');
          this.speedTarget = 0;
        } else {
          const wp = this.patrolWps[this.patrolIdx];
          if (wp && this._moveToward(wp.x, wp.z, AIWALK, dt)) {
            this.patrolIdx = (this.patrolIdx + 1) % this.patrolWps.length;
            if (Math.random() < 0.4) this.pauseT = rand(1, 3.2);
          }
          this.speedTarget = AIWALK;
        }
        this._face(dt, 5);
        this._senses(dt);
        break;
      }
      case 'investigate': {
        if (!this.investigateTarget) { this.mode = 'patrol'; break; }
        if (this._moveToward(this.investigateTarget.x, this.investigateTarget.z, INVEST, dt)) {
          this.investigateTarget = null;
          this.searchT = 2.6;
          this.mode = 'search';
          this.human.setMotion('idle');
        }
        this._face(dt, 6);
        this._senses(dt, 1.3);
        break;
      }
      case 'search': {
        this.searchT -= dt;
        this.yawTarget += Math.sin(G.time * 1.2) * dt * 2.2;
        this._face(dt, 3);
        if (this._senses(dt, 1.3)) break;
        if (this.searchT <= 0) this.mode = 'patrol';
        break;
      }
      case 'aware': { // he saw something — stops dead and stares before acting
        this.awareT -= dt;
        const pp = p.eyePos();
        this.yawTarget = Math.atan2(pp.x - this.pos.x, pp.z - this.pos.z);
        this._face(dt, 3.5);
        this.human.lookAt(pp.x, pp.y, pp.z);
        this.human.setMotion('idle');
        if (this.awareT <= 0) this.startChase();
        break;
      }
      case 'chase': {
        const pp = p.pos;
        const d = Math.hypot(pp.x - this.pos.x, pp.z - this.pos.z);
        const seen = this.canSeePlayer();
        if (this.finale) {
          // scripted chase: always knows, rubber-banded for terror & fairness
          let sp = 4.95;
          if (d > 13) sp = 6.4; else if (d < 3.5) sp = 4.5;
          this._moveToward(pp.x, pp.z, sp, dt);
          this._face(dt, 8);
          this.lostT = 0;
        } else {
          if (seen) {
            this.lastKnown.set(pp.x, 0, pp.z);
            this.lostT = 0;
          } else this.lostT += dt;
          const tgt = this.lostT < 0.4 ? pp : this.lastKnown;
          this._moveToward(tgt.x, tgt.z, CHASE, dt);
          this._face(dt, 8);
          if (p.hidden) {
            // did he see you slip in?
            if (this.sawHide && d < 2.4) { G.story.onCaught('hide'); return; }
            this.lostT += dt * 1.5;
          }
          if (this.lostT > 4.5) {
            // give up and search around
            this.searchT = 5;
            this.mode = 'search';
            G.story.hook('lostYou');
          }
        }
        if (!p.hidden && d < this.grabRange) { G.story.onCaught('grab'); return; }
        break;
      }
      case 'doorpound': {
        if (!this.poundDoorRef) { this.mode = 'idle'; break; }
        const door = this.poundDoorRef;
        this.yawTarget = Math.atan2(door.cx - this.pos.x, door.z - this.pos.z);
        this._face(dt, 5);
        this.poundT -= dt;
        if (this.poundT <= 0) {
          this.poundT = rand(1.1, 1.7);
          door.pound();
          this.G.audio.knock(this.mode === 'doorpound' ? 3 : 2, { x: door.cx, y: 1.2, z: door.z }, 1.0, true);
        }
        break;
      }
    }

    // anim + breathing
    this.human.update(dt, G.time);
  }

  _senses(dt, mult = 1) {
    const G = this.G, p = G.player;
    const seen = this.canSeePlayer();
    if (seen) {
      const d = Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
      let rate = 0.5;
      const spd = Math.hypot(p.vel.x, p.vel.z);
      if (spd > 4) rate = 1.6; else if (spd > 1) rate = 0.8; else if (p.crouched) rate = 0.3;
      rate *= mult * clamp(1.4 - d / 18, 0.15, 1.3);
      this.detect += dt * rate;
      if (this.detect > 0.55 && !this.awareStung) {
        this.awareStung = true;
        this.mode = 'aware'; this.awareT = 1.5;
        G.audio.stingLow(0.5);
        G.story.hook('heSawYou');
      }
      if (this.detect >= 1) { this.startChase(); return true; }
    } else {
      this.detect = Math.max(0.12, this.detect - dt * 0.05);
      if (this.mode !== 'aware') this.awareStung = false;
    }
    return false;
  }

  poundDoorAt(door) { this.poundDoorRef = door; this.mode = 'doorpound'; this.poundT = 0; }
  stopPound() { if (this.mode === 'doorpound') this.mode = 'idle'; this.poundDoorRef = null; }
}

// Vale — the guest in room 4, mostly seen as a motionless silhouette
// in the gap of his curtains, watching the lot. He never blinks.
export class ValeWatcher {
  constructor(G) {
    this.G = G;
    this.human = new Human(G.world, {
      height: 1.86, bulk: 1.0, skin: 0xb99a80, shirt: 0x4a3226, pants: 0x24211c,
      shoes: 0x15120f, faceTex: G.T.faceVale, hair: 0x3a2f24,
    });
    this.group = this.human.group;
    this.group.visible = false;
    G.scene.add(this.group);
    this.active = false;
    this._tick = 0;
  }
  // stand at his window looking out over the lot
  setWatching(on) {
    this.active = on;
    this.group.visible = on;
    if (on) {
      // inside room 4, right at the window gap
      this.group.position.set(-19.3, 0, 0.55);
      this.group.rotation.y = Math.PI; // face -z (the lot)
    }
  }
  // pale shape glimpsed standing in the office doorway on the CCTV beat
  update(dt) {
    if (!this.active) return;
    const G = this.G, p = G.player;
    this._tick -= dt;
    if (this._tick <= 0) {
      this._tick = 0.9; // laggy tracking = wrong-feeling
      const pp = p.eyePos();
      this.human.lookAt(pp.x, pp.y, pp.z);
    }
    this.human.setMotion('idle');
    this.human.update(dt, G.time);
  }
}
