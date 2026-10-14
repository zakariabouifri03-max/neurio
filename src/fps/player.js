// ── WARFRONT · first person controller ──────────────────────────────────────
// AABB movement with auto step-up, tactical sprint, slide-to-fire, crouch,
// health + armor plates + COD-style regeneration, grenade throws.

import * as THREE from 'three';
import { clamp, lerp, damp, dist, boxAdd, rayBox } from './util.js';

const STAND_H = 1.78, CROUCH_H = 1.12, SLIDE_H = .92, RAD = .36;
const GRAV = 25.5, STEP = .62;

export class Player {
  constructor(game) {
    this.game = game;
    this.world = game.world;
    this.pos = new THREE.Vector3(0, 0, 26);
    this.vel = new THREE.Vector3();
    this.yaw = Math.PI;
    this.pitch = 0;
    this.recPitch = 0; this.recYaw = 0;
    this.h = STAND_H;
    this.wantH = STAND_H;
    this.r = RAD;
    this.grounded = true;
    this.sprinting = false; this.sprintT = 0; this.stamina = 100;
    this.crouch = false; this.slideT = 0; this.slideDir = new THREE.Vector3();
    this.hp = 100; this.maxHp = 100;
    this.armor = 0; this.plates = 3; this.maxPlates = 3;
    this.plateT = 0;
    this.regenDelay = 0;
    this.dead = false; this.deathT = 0;
    this.speed2D = 0; this.strafe = 0; this.bobPhase = 0; this.bobAmp = 0;
    this.lookRateX = 0; this.lookRateY = 0;
    this.nades = 2; this.maxNades = 2; this.nadeCd = 0;
    this.falling = 0; this.lastSafe = new THREE.Vector3(); this.lastSafeT = 0;
    this.bobY = 0; this.roll = 0; this.adsSway = 0;
    this.dmgDir = 0; this.dmgT = 0;
    this.deadproofReady = true;
    this.stats = { shots: 0, hits: 0, damage: 0 };
  }

  respawnAt(x, z, yaw) {
    this.pos.set(x, this.world.groundAt(x, z, this.r, 40, 40) || 0, z);
    if (this.pos.y < 0) this.pos.y = 0;
    this.vel.set(0, 0, 0);
    this.yaw = yaw === undefined ? Math.atan2(x, z) : yaw;
    this.pitch = 0; this.recPitch = 0; this.recYaw = 0;
    this.hp = this.maxHp; this.armor = this.game.diff.plates * 50; this.plates = this.game.diff.plates;
    this.dead = false; this.deathT = 0; this.slideT = 0; this.crouch = false;
    this.h = this.wantH = STAND_H;
    this.stamina = 100; this.nades = this.maxNades;
    this.plateT = 0; this.regenDelay = 0;
    this.game.guns.refitAll();
    this.game.guns.equip(this.game.guns.loadout[0], true);
    this.game.guns.ads = 0;
  }

  // ── look ─────────────────────────────────────────────────────────────────
  look(dx, dy, sens, invert) {
    this.yaw -= dx * sens;
    this.pitch -= dy * sens * (invert ? -1 : 1);
    const lim = Math.PI / 2 - 0.02;
    this.pitch = clamp(this.pitch, -lim, lim);
    this.lookRateX = damp(this.lookRateX, Math.min(.6, Math.abs(dx) * .0022), 10, .016);
    this.lookRateY = damp(this.lookRateY, Math.min(.6, Math.abs(dy) * .0022), 10, .016);
  }

  applyRecoil(p, y) {
    this.recPitch += p;
    this.recYaw += y;
    const lim = Math.PI / 2 - 0.02;
    this.pitch = clamp(this.pitch + p * .55, -lim, lim);
    this.yaw += y * .55;
  }

  forward(out = new THREE.Vector3()) {
    const cp = Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp).normalize();
  }

  eyePos(out = new THREE.Vector3()) {
    return out.set(this.pos.x, this.pos.y + this.h - .12, this.pos.z);
  }
  /** centre-of-mass hitbox for enemy fire */
  chestPos(out = new THREE.Vector3()) {
    return out.set(this.pos.x, this.pos.y + this.h * .58, this.pos.z);
  }
  hitBoxes() {
    const y = this.pos.y, h = this.h;
    const spread = this.crouch || this.slideT > 0 ? .18 : 0;
    return [
      boxAdd(null, this.pos.x, this.pos.z, .62 + spread, .5 + spread, y + h * .38, y + h * .86, 'chest'),
      boxAdd(null, this.pos.x, this.pos.z, .34, .34, y + h * .86, y + h * 1.0, 'head'),
      boxAdd(null, this.pos.x, this.pos.z, .5, .46, y, y + h * .38, 'legs'),
    ];
  }

  // ── collision helpers ────────────────────────────────────────────────────
  blocked(x, z, y, h) {
    return this.world.solidAt(x, y, z, this.r, h);
  }

  moveH(dt, input) {
    const p = this.pos;
    const nx = p.x + this.vel.x * dt;
    const nz = p.z + this.vel.z * dt;
    let movedX = false, movedZ = false;
    if (!this.blocked(nx, p.z, p.y, this.h)) { p.x = nx; movedX = true; }
    if (!this.blocked(p.x, nz, p.y, this.h)) { p.z = nz; movedZ = true; }
    // wall slide: kill velocity into the wall
    if (!movedX) this.vel.x = 0;
    if (!movedZ) this.vel.z = 0;
    // corner nudge: if fully stuck, push out along the smaller penetration
    if (!movedX && !movedZ) {
      const b = this.overlapBox(p.x, p.z, p.y, this.h);
      if (b) {
        const px = Math.min(Math.abs(p.x + this.r - b.x0), Math.abs(p.x - this.r - b.x1));
        const pz = Math.min(Math.abs(p.z + this.r - b.z0), Math.abs(p.z - this.r - b.z1));
        if (px < pz) p.x += Math.sign(p.x - (b.x0 + b.x1) / 2) * (px + .01);
        else p.z += Math.sign(p.z - (b.z0 + b.z1) / 2) * (pz + .01);
      }
    }
    this.world.clampToArena(p);
  }
  overlapBox(x, z, y, h) {
    for (const b of this.world.colliders) {
      if (b.y1 > y + STEP && b.y0 < y + h && x + this.r > b.x0 && x - this.r < b.x1 && z + this.r > b.z0 && z - this.r < b.z1) return b;
    }
    return null;
  }

  /** can I see that soldier? (used for spotting + HUD) */
  sees(s) {
    const from = this.eyePos(new THREE.Vector3());
    return this.world.losTo(from, s.chest(new THREE.Vector3()));
  }

  // ── main update ──────────────────────────────────────────────────────────
  update(dt, input, now) {
    const game = this.game;
    if (this.dead) { this.updateDead(dt); return; }
    const g = this.game.guns;

    // ── stance / crouch / slide
    const wantCrouch = input.crouch;
    this.crouch = wantCrouch;
    if (input.crouchEdge && this.sprinting && this.speed2D > 5 && this.slideT <= 0 && this.grounded) {
      this.slideT = .72;
      const f = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      this.slideDir.copy(f);
      this.vel.x = f.x * 9.2; this.vel.z = f.z * 9.2;
      game.audio.slide();
      this.wantH = SLIDE_H;
    }
    if (this.slideT > 0) {
      this.slideT -= dt;
      this.wantH = SLIDE_H;
      this.vel.x = damp(this.vel.x, this.slideDir.x * 2.4, 1.6, dt);
      this.vel.z = damp(this.vel.z, this.slideDir.z * 2.4, 1.6, dt);
      if (this.slideT <= 0) this.wantH = this.crouch ? CROUCH_H : STAND_H;
    } else {
      this.wantH = this.crouch ? CROUCH_H : STAND_H;
    }
    // don't stand up under a low ceiling
    if (this.wantH > this.h) {
      const ceil = this.world.ceilAt(this.pos.x, this.pos.z, this.r, this.pos.y + .05);
      if (ceil - this.pos.y < this.wantH + .05) this.wantH = Math.max(CROUCH_H, ceil - this.pos.y - .06);
    }
    this.h = damp(this.h, this.wantH, 14, dt);

    // ── sprint
    const wantSprint = input.sprint && input.moveMag > .3 && input.fwd > 0 && !this.crouch && this.stamina > 4 && g.reloadT <= .05 && g.ads < .3;
    if (wantSprint) {
      this.sprintT += dt;
      if (this.sprintT > .16) { this.sprinting = true; this.stamina = Math.max(0, this.stamina - dt * 21); }
    } else { this.sprintT = 0; this.sprinting = false; this.stamina = Math.min(100, this.stamina + dt * (this.game.perk === 'lightweight' ? 30 : 19)); }
    if (this.sprinting && this.stamina <= 0) this.sprinting = false;

    // ── desired planar velocity
    const mv = this.game.movementLocked ? 0 : 1;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wishX = (input.x * cos - input.y * sin) * mv;
    const wishZ = (-input.x * sin - input.y * cos) * mv;
    const perkSpeed = this.game.perk === 'lightweight' ? 1.14 : 1;
    const adsSlow = 1 - g.ads * (g.def().cls === 'sniper' ? .68 : .4);
    const gunSlow = (g.def().speed || 1);
    let speed = 5.05 * gunSlow * perkSpeed * adsSlow;
    if (this.sprinting) speed = 7.7 * perkSpeed;
    else if (this.crouch) speed = 2.35 * perkSpeed;
    if (this.slideT > 0) speed = 0;
    const tvx = wishX * speed, tvz = wishZ * speed;
    const acc = this.grounded ? (this.slideT > 0 ? 1.6 : 15) : 2.6;
    this.vel.x = damp(this.vel.x, tvx, acc, dt);
    this.vel.z = damp(this.vel.z, tvz, acc, dt);
    const l = Math.hypot(wishX, wishZ);
    this.strafe = l > .1 ? (input.x * Math.cos(this.yaw) - input.y * Math.sin(this.yaw)) / Math.max(.001, l) : 0;

    // ── jump
    if (input.jump && this.grounded && this.slideT <= 0) {
      this.vel.y = 8.1;
      this.grounded = false;
      game.audio.land(0.4);
      this.sprinting = false; this.sprintT = 0;
    }

    // ── vertical
    const prevY = this.pos.y;
    this.vel.y -= GRAV * dt;
    if (this.vel.y < -46) this.vel.y = -46;
    this.pos.y += this.vel.y * dt;
    const gy = this.world.groundAt(this.pos.x, this.pos.z, this.r, prevY, this.pos.y);
    const support = gy < 0 ? 0 : gy;
    if (this.pos.y <= support + 0.001 && this.vel.y <= 0) {
      const fallSpeed = -this.vel.y;
      if (!this.grounded && fallSpeed > 7) {
        game.audio.land(clamp(fallSpeed / 26, 0, 1));
        this.game.fx.dustPuff(this.pos, clamp(fallSpeed / 10, .4, 1.6));
        if (fallSpeed > 17 && this.game.diff.fallDmg) this.damage(Math.round((fallSpeed - 17) * 5.5), null, 0);
      }
      this.pos.y = support;
      this.vel.y = 0;
      this.grounded = true;
    } else {
      this.grounded = false;
    }
    // prevent tunnelling through floors when falling fast
    if (this.pos.y < -1) { this.pos.y = 0; this.vel.y = 0; this.grounded = true; }

    // ── horizontal
    this.moveH(dt, input);
    this.speed2D = Math.hypot(this.vel.x, this.vel.z);

    // footsteps
    if (this.grounded && this.speed2D > 1.1) {
      this.stepPhase = (this.stepPhase || 0) + this.speed2D * dt * 1.15;
      if (this.stepPhase > 1) {
        this.stepPhase = 0;
        game.audio.step(this.crouch, this.sprinting);
        this.game.footstepPing();
      }
    }

    // view bob
    const bobTarget = this.grounded && this.speed2D > .6 ? clamp(this.speed2D / 6, 0, 1.5) * (this.sprinting ? 1.5 : 1) * (1 - g.ads * .8) : 0;
    this.bobAmp = damp(this.bobAmp, bobTarget, 8, dt);
    this.bobPhase += dt * (5.2 + this.speed2D * 1.05);
    this.bobY = Math.sin(this.bobPhase * 2) * .021 * this.bobAmp;
    const bobX = Math.cos(this.bobPhase) * .026 * this.bobAmp;
    this.roll = damp(this.roll, -this.strafe * .022 - (this.slideT > 0 ? .12 : 0), 8, dt);

    // ── damage / regen
    this.regenDelay = Math.max(0, this.regenDelay - dt);
    const regenRate = this.game.diff.regen;
    if (regenRate > 0 && this.regenDelay <= 0 && this.hp < this.maxHp) {
      this.hp = Math.min(this.maxHp, this.hp + regenRate * dt);
      if (this.hp >= this.maxHp) game.hud.setHp(this.hp, this.maxHp, true);
    }
    if (this.plateT > 0) {
      this.plateT -= dt;
      if (this.plateT <= 0) {
        this.plates--;
        this.armor = Math.min(this.game.diff.maxArmor, this.armor + 50);
        game.audio.plate();
        game.hud.plateApplied(this.armor, this.plates);
      }
    }
    if (this.nadeCd > 0) this.nadeCd -= dt;

    // recoil recovery
    this.recPitch = damp(this.recPitch, 0, 6.2, dt);
    this.recYaw = damp(this.recYaw, 0, 5.4, dt);

    // ── camera
    const cam = game.camera;
    cam.position.set(this.pos.x + bobX * .5, this.pos.y + this.h - .12 + this.bobY + (this.slideT > 0 ? -.05 : 0), this.pos.z);
    if (this.slideT > 0) cam.position.y = this.pos.y + this.h - .08;
    cam.rotation.set(this.pitch + this.recPitch + Math.sin(this.bobPhase) * .004 * this.bobAmp, this.yaw + this.recYaw, this.roll);
    game.world.setCamQuat(cam.quaternion);
  }

  updateDead(dt) {
    this.deathT += dt;
    const cam = this.game.camera;
    this.h = damp(this.h, .6, 4, dt);
    cam.position.set(this.pos.x, this.pos.y + this.h, this.pos.z);
    cam.rotation.set(damp(cam.rotation.x, -.5, 3, dt), cam.rotation.y + dt * .18, damp(cam.rotation.z, .55, 3, dt));
    this.vel.y -= GRAV * dt;
    this.pos.y += this.vel.y * dt;
    const gy = this.world.groundAt(this.pos.x, this.pos.z, this.r, this.pos.y + 1, this.pos.y);
    if (this.pos.y <= (gy < 0 ? 0 : gy)) { this.pos.y = gy < 0 ? 0 : gy; this.vel.y = 0; }
  }

  // ── combat ───────────────────────────────────────────────────────────────
  usePlate() {
    if (this.plates <= 0 || this.plateT > 0) return false;
    this.sprinting = false; this.sprintT = 0;
    if (this.armor >= this.game.diff.maxArmor) return false;
    this.plateT = this.game.perk === 'situational' ? .85 : 1.35;
    this.game.audio.plateStart();
    return true;
  }

  throwNade() {
    if (this.nades <= 0 || this.nadeCd > 0 || this.dead) return null;
    this.nades--;
    this.nadeCd = .55;
    this.game.audio.nadeThrow();
    const dir = this.forward();
    const eye = this.eyePos();
    const start = eye.clone().addScaledVector(dir, .55);
    return {
      pos: start, vel: dir.clone().multiplyScalar(15.5).add(new THREE.Vector3(0, 3.6 + Math.max(0, this.speed2D * .18), 0)),
      fuse: 2.6, spin: 0, rest: 0, owner: 'player', dmg: 118, radius: 8.4,
    };
  }

  damage(amount, srcPos, dmgType) {
    if (this.dead || this.game.state !== 'play') return;
    let left = amount;
    if (this.armor > 0) {
      const soak = Math.min(this.armor, left * .72);
      this.armor -= soak; left -= soak;
    }
    this.hp -= left;
    this.game.dmgThisWave = (this.game.dmgThisWave || 0) + amount;
    this.regenDelay = this.game.diff.regenDelay;
    this.dmgT = 1;
    let ang = 0;
    if (srcPos) ang = Math.atan2(-(srcPos.x - this.pos.x), -(srcPos.z - this.pos.z)) - this.yaw;
    this.dmgDir = ang;
    this.game.hud.damage(this.hp, ang, amount);
    this.game.audio.hurt();
    this.game.fx.shakeAdd(clamp(amount / 130, .05, .4));
    if (this.hp <= 0) {
      if (this.game.perk === 'deadproof' && this.deadproofReady) {
        this.deadproofReady = false;
        this.hp = 25;
        this.armor = 0;
        this.game.hud.notice('DEAD PROOF — you got back up', 'perk');
        this.game.audio.revive();
        return;
      }
      this.die(srcPos);
    }
  }

  die(srcPos) {
    this.dead = true;
    this.hp = 0;
    this.deathT = 0;
    this.slideT = 0;
    this.game.onPlayerDeath(srcPos);
  }

  /** are we behind cover from this thing? */
  inCoverOf(target) {
    const from = this.eyePos();
    const to = target.chest ? target.chest(new THREE.Vector3()) : target;
    return !this.world.blocked3(from.x, from.y, from.z, to.x, to.y, to.z) === false;
  }
}
