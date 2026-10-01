// ── IRONVOW — a fighter: body, steel, stamina, and the will to keep standing ──
// Player and champion alike run through this class.
//
// FRAMES. Poses in moves.js are authored in camera space: +X right, +Y up,
// −Z forward. A rig, however, is built facing its own local +Z (nose and boots
// both point that way) with its right hand on local −X. So this file is the one
// place that converts:
//     camera space  →  rig local      v' = (−x, y, −z)
//     rig local     →  world          root.localToWorld
// and the hand's world quaternion is  rootWorldQuat · handFrame(blade', edge').
// Get this wrong and a fighter cuts behind his own back — which is exactly what
// the first version of the test harness did.
import * as THREE from 'three';
import { Rig } from './characters.js';
import { buildWeapon, buildShield } from './weapons.js';
import { WeaponBody } from './combat.js';
import {
  handFrame, sampleMove, copyPose, emptyPose, lerpPose, moveRange,
  IDLE, HURT, GUARDS, PARRY_POSE, shieldGuardPose, movesetFor, speedScale,
} from './moves.js';
import { solveGuard } from './defense.js';
import { STAMINA, PLAYER, COMBAT } from './tuning.js';
import { clamp, clamp01, lerp, damp, angDamp, angDiff, rnd, jitter, _v1, _v2, _v3, _q1, _q2 } from './mathx.js';

const CAM_B = new THREE.Vector3(), CAM_E = new THREE.Vector3();
// Poses in moves.js are authored from the eye, not from the ground: a hand at
// (0.28, −0.28, −0.34) is a fist just below the chest of a standing man.
const EYE = 1.63;
const UP = new THREE.Vector3(0, 1, 0);
// solveOffhand needs scratch of its own: it runs while the shared _v/_q set is live
const _p1 = new THREE.Vector3(), _p2 = new THREE.Vector3(), _p3 = new THREE.Vector3();
const _p4 = new THREE.Vector3(), _p5 = new THREE.Vector3(), _p6 = new THREE.Vector3();
const _bl = new THREE.Vector3(), _ac = new THREE.Vector3();
const _inc = new THREE.Vector3();
const _qr = new THREE.Quaternion();
const _f1 = new THREE.Vector3(), _f2 = new THREE.Vector3(), _f3 = new THREE.Vector3();
const _qt = new THREE.Quaternion(), _qt2 = new THREE.Quaternion();

/** eye/camera-space point → rig-local point (rig faces +Z local, root at the floor). */
export function camToLocal(v, out = new THREE.Vector3()) {
  return out.set(-v.x, EYE + v.y, -v.z);
}
/** Same mapping for a DIRECTION: no eye offset, or every blade points at the sky. */
export function camDirToLocal(v, out = new THREE.Vector3()) {
  return out.set(-v.x, v.y, -v.z);
}
export function poseToWorld(rig, v, out = new THREE.Vector3()) {
  camToLocal(v, out);
  out.y *= rig.k ?? 1;
  return rig.root.localToWorld(out);
}
/** camera-space blade+edge → world quaternion for the fist. */
export function poseQuatWorld(rig, blade, edge, out = new THREE.Quaternion()) {
  camDirToLocal(blade, CAM_B); camDirToLocal(edge, CAM_E);
  handFrame(CAM_B, CAM_E, out);
  return out.premultiply(rig.root.getWorldQuaternion(_q1));
}
/** A world-space basis framed like a hand: +Y along the blade, +Z out of the flat. */
const _fb = new THREE.Matrix4();
export function frameWorld(dir, edgeHint, out = new THREE.Quaternion()) {
  _f1.copy(dir).normalize();
  _f2.copy(edgeHint).addScaledVector(_f1, -edgeHint.dot(_f1));
  if (_f2.lengthSq() < 1e-6) _f2.set(0, 0, 1).addScaledVector(_f1, -_f1.z);
  _f2.normalize();
  _f3.crossVectors(_f1, _f2).normalize();
  _f2.crossVectors(_f3, _f1).normalize();
  return out.setFromRotationMatrix(_fb.makeBasis(_f3, _f1, _f2));
}

/** Pull a target toward an origin until it is inside reach (keeps limbs honest). */
function within(target, origin, maxLen) {
  _v1.copy(target).sub(origin);
  const d = _v1.length();
  if (d <= maxLen || d < 1e-5) return target;
  target.copy(origin).addScaledVector(_v1.multiplyScalar(1 / d), maxLen);
  return target;
}

export class Fighter {
  constructor(cfg = {}) {
    this.cfg = cfg;
    this.name = cfg.name || 'fighter';
    this.id = cfg.id || this.name;
    this.side = cfg.side || 'enemy';
    const body = cfg.body || {};
    this.rig = new Rig({
      height: body.height ?? 1.78,
      build: body.build ?? 1,
      skin: body.skin, hair: body.hair, hairStyle: body.hairStyle, beard: body.beard,
      cloth: cfg.cloth, accent: cfg.accent, harness: cfg.harness, hollow: body.hollow,
    });
    this.height = body.height ?? 1.78;
    this.harness = cfg.harness;
    this.bodyState = this.rig.body;
    this.mass = 76 + (this.harness?.mass || 0) * 1.1;

    // ── steel ──
    this.weaponDef = cfg.weapon;
    this.weapon = buildWeapon(cfg.weapon);
    // The weapon's own origin is the guard, not the fist: slide it down the
    // hand's axis so the authored grip point lands in the palm.
    const parts = this.weapon.userData;
    this.gripY = parts.gripY ?? -0.06;
    this.weapon.position.y = -this.gripY;
    this.rig.grip.R.add(this.weapon);
    this.wb = new WeaponBody(this.weapon, cfg.weapon);
    this.wb.owner = this.rig;
    this.hands = cfg.weapon.hands || 1;
    // negative: the off hand sits further down the haft, toward the butt
    this.gripOffset = Math.min(0, (parts.gripY2 ?? this.gripY) - this.gripY);
    this.shieldDef = cfg.shield || { id: 'none', model: null };
    this.shield = null; this.sb = null;
    if (this.shieldDef.model) {
      this.shield = buildShield(this.shieldDef, cfg.house || 'ashcombe', cfg.cloth);
      // the shield mesh faces +Z; the left fist's +Y points outward at the threat,
      // so turn the face onto the fist's −Y
      this.shield.rotation.set(Math.PI / 2, 0, 0);
      this.rig.grip.L.add(this.shield);
      this.sb = new WeaponBody(this.shield, this.shieldDef, true);
      this.sb.owner = this.rig;
    }
    this.moveSet = movesetFor(cfg.weapon.archetype);
    this.swingScale = speedScale(cfg.weapon.mass) * (this.harness?.mass > 20 ? 0.92 : 1) * (body.speed ?? 1);
    this.tipLen = parts.reachTip ?? Math.max(0.4, cfg.weapon.length * 0.8);
    this.reach = cfg.weapon.reach ?? (0.6 + this.tipLen);
    // What each blow is worth in DISTANCE, measured from the authored poses:
    // a thrust threatens from further off than a cut, and a heavy blade cannot
    // be used at knife range. `measure` is the best of them.
    this.ranges = {};
    for (const k in this.moveSet) this.ranges[k] = moveRange(this.moveSet[k], this.tipLen);
    this.measure = Math.max(...Object.values(this.ranges));
    this.measureClose = Math.min(...Object.values(this.ranges));

    // ── place & locomotion ──
    this.pos = this.rig.root.position;
    // What the fighter WANTS to do this frame: a player's keys, or a brain's
    // plan. Physics below turns it into movement if the state allows it.
    this.intent = { x: 0, z: 0, sprint: false, guard: null };
    this.pos.copy(cfg.position || _v1.set(0, 0, 0));
    this.vel = new THREE.Vector3();
    this.yaw = cfg.yaw || 0;
    this.lookPitch = 0;
    this.rig.root.rotation.y = this.yaw;
    this.radius = PLAYER.radius * (body.build ?? 1) * 0.5 + PLAYER.radius * 0.5;
    this.speed = 0;
    this.maxSpeed = PLAYER.walkSpeed * (body.speed ?? 1);

    // ── combat state ──
    this.state = 'idle';
    this.stateT = 0;
    this.stamina = STAMINA.max * (cfg.stamina ?? 1);
    this.maxStamina = STAMINA.max;
    this.staminaDelay = 0;
    this.exhausted = false;
    this.move = null;
    this.moveDir = 'R';
    this.charge = 0;
    this.comboCount = 0;
    this.guardDir = 'center';
    this.guardT = 0;
    this.parryT = 0;
    this.staggerT = 0;
    this.guardBroken = 0;
    this.guardMemory = null;
    this.guardAim = new THREE.Vector3(0, 0, 1);   // the world direction the point is holding
    this.strikeLanded = false;
    this.hurtDir = 'front';
    this.hitFlash = 0;
    this.dead = false;
    this.yielded = false;         // a beaten man can ask for quarter, and live
    this.deathT = 0;
    this.deathSide = 0;
    this.edgeRoll = 0;                 // debug/utility: rotate the blade about its axis
    // how badly this fighter reads an incoming blow: the player reads it with
    // his own eyes, everyone else gets a margin of error
    this.readError = cfg.readError ?? (this.side === 'player' ? 0 : 0.17);
    this.guardWeapon = null;           // set by the director: the opponent's steel
    this.guardShield = null;
    this._swingHint = 0;
    this.breath = rnd() * 10;
    this.lean = 0;
    this.twist = 0;
    this.stepPhase = 0;
    this.lastResolve = null;
    this.events = [];
    this.aiState = 'idle';
    this.aiT = 0;
    this.frozen = null;                 // a pose held still because steel met steel
    this.bindT = 0;
    this.passThrough = 0;               // a broken guard lets a fraction through
    this.passThroughT = 0;
    this.opponentRange = 2;
    this.targets = new Set();          // per-swing hit bookkeeping

    // ── pose machinery ──
    this.pose = emptyPose();
    this.off = emptyPose();
    this.arm = {
      R: { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), ready: false },
      L: { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), ready: false },
    };
    this.guardOut = { fist: new THREE.Vector3(), bladeDir: new THREE.Vector3(), cross: 0, quality: 0, scratch: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] };
    this.offKind = this.shieldDef.model ? 'shield' : (this.hands === 2 ? 'grip' : 'free');

    // footwork, in rig-local space
    this.feet = {
      L: { x: 0.12, z: 0.04, y: 0 },
      R: { x: -0.12, z: -0.04, y: 0 },
    };
    this.volumes = [];
    this.stateT = 0;
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  queries
  // ══════════════════════════════════════════════════════════════════════════
  get alive() { return this.bodyState.alive; }
  get busy() { return this.state !== 'idle' && this.state !== 'block'; }
  get blocking() { return this.state === 'block' && this.guardBroken <= 0; }
  get attacking() { return this.state === 'strike' || this.state === 'follow'; }
  get weapons() { return this.sb ? [this.wb, this.sb] : [this.wb]; }
  /** What a blow can meet on this man, in the order it would meet it. */
  planes() { return this.sb ? [this.sb, this.wb] : [this.wb]; }

  worldQuat(out = _q2) { return this.rig.root.getWorldQuaternion(out); }
  forward(out = _v1) { return out.set(0, 0, 1).applyQuaternion(this.worldQuat()); }
  /** First-person camera anchor. */
  eyeWorld(out = new THREE.Vector3(), fwd = 0) {
    this.rig.root.updateWorldMatrix(true, false);
    out.setFromMatrixPosition(this.rig.bones.head.matrixWorld);
    const f = this.forward(_v1);
    out.addScaledVector(f, 0.06 + fwd);
    out.y += 0.06;
    return out;
  }
  weaponTip(out = new THREE.Vector3()) {
    const s = this.wb.world[this.wb.segs.length - 1];
    return s ? out.copy(s.b) : out.setFromMatrixPosition(this.weapon.matrixWorld);
  }
  /** Distance from this fighter's chest to another's chest, along the ground. */
  chestDistance(other) {
    this.rig.root.updateWorldMatrix(true, false);
    other.rig.root.updateWorldMatrix(true, false);
    _v1.setFromMatrixPosition(this.rig.bones.chest.matrixWorld);
    _v2.setFromMatrixPosition(other.rig.bones.chest.matrixWorld);
    return _v1.setY(0).distanceTo(_v2.setY(0));
  }
  say(type, data) { this.events.push({ type, data, t: this._t || 0 }); }

  // ══════════════════════════════════════════════════════════════════════════
  //  intent
  // ══════════════════════════════════════════════════════════════════════════
  canAct() {
    return !this.dead && !this.yielded && this.state !== 'stagger' && this.state !== 'bind' && this.guardBroken <= 0;
  }

  startAttack(dir = 'R') {
    if (!this.canAct()) return false;
    if (this.state === 'windup' || this.state === 'strike' || this.state === 'follow' || this.state === 'recover') return false;
    if (this.stamina < 10 || this.exhausted) { this.say('tooTired'); return false; }
    const m = this.moveSet[dir] || this.moveSet.R;
    this.move = m;
    this.moveDir = dir;
    this.state = 'windup';
    this.stateT = 0;
    this.charge = 0;
    this.strikeLanded = false;
    this.targets.clear();
    // Winding a blow costs a quarter of the wind it will finally take; letting
    // it go costs the rest. That is why a feint is cheap and a full swing is not.
    this.stamina -= this.weaponDef.stamina.swing * 0.15;
    this.staminaDelay = STAMINA.regenDelay;
    return true;
  }

  /** Let the blow go. Called on button release (a held button charges the cut). */
  releaseAttack() {
    if (this.state !== 'windup' || !this.move) return false;
    this.stamina = clamp(this.stamina - (this.weaponDef.stamina.swing * 0.45 + 2), 0, this.maxStamina);
    this.staminaDelay = STAMINA.regenDelay;
    this.state = 'strike';
    this.stateT = 0;
    this.strikeLanded = false;
    this.comboCount++;
    return true;
  }

  /** Abandon a wind-up before it commits. */
  feint() {
    if (this.state !== 'windup' || !this.move) return false;
    const w = this.move.dur.windup / this.swingScale;
    if (this.stateT > w * COMBAT.feintWindow) return false;
    this.state = 'recover';
    this.stateT = 0.42;
    this.stamina -= 4;
    this.say('feint');
    return true;
  }

  startBlock(dir) {
    // A parry is a COMMITMENT: the wrist sets a line and the feet carry the
    // guard to meet the blow. It is latched here for a moment so the blade does
    // not re-solve its own angle every frame — and so that a man who commits to
    // the wrong line can be beaten by the edge he did not cover.
    this.guardLockT = COMBAT.guardLockTime;
    // A beaten man can still get his hands up: the instinct to cover is older
    // than the ability to strike. He cannot ATTACK while his head is ringing —
    // that is what the stagger costs him — but if he could not defend either,
    // one good blow would be the whole fight, and it very nearly was.
    if (this.dead || this.yielded || this.state === 'bind' || this.guardBroken > 0) return false;
    if (dir) this.guardDir = dir;
    if (this.state === 'windup' || this.state === 'recover') {
      if (!this.feint()) return false;
    } else if (this.state === 'stagger') {
      this.parryT *= 0.55;
    }
    if (this.state !== 'block') {
      this.state = 'block';
      this.stateT = 0;
      this.guardT = 0;
      // a rattled man's parry is worth less than a fresh one's
      this.parryT = COMBAT.parryWindow * (this.state === 'stagger' ? 0.55 : 1);
      // where he thinks the blow is going: zero for a player behind his own
      // eyes, up to a hand's width for a tired or inexperienced man
      if (!this.guardMisread) this.guardMisread = new THREE.Vector3();
      const e = this.readError || 0;
      this.guardMisread.set(jitter(e), jitter(e * 0.55), jitter(e * 0.8));
      this.guardMemory = null;
    }
    return true;
  }
  endBlock() {
    this.guardMisread = null;
    if (this.state === 'block') { this.state = 'idle'; this.stateT = 0; }
  }

  /**
   * Steel has met steel. The blow stops where it stopped — the pose is held so
   * the swing does not carry on through a parry it never earned.
   */
  bind(seconds) {
    if (this.dead) return;
    if (!this.frozen) { this.frozen = emptyPose(); copyPose(this.pose, this.frozen); }
    this.state = 'bind';
    this.stateT = 0;
    this.bindT = Math.max(this.bindT || 0, seconds);
    this.strikeLanded = true;
    this.say('bind');
  }

  /** Shove or bash: costs a little steel, moves a man. */
  shove(power = 1) {
    if (!this.canAct() || this.stamina < 12) return false;
    this.stamina -= 10;
    this.staminaDelay = STAMINA.regenDelay;
    this.state = 'recover';
    this.stateT = 0.25;
    this.say('shove', { power });
    return true;
  }

  /**
   * Hold the pose the blow stopped in. Steel that meets steel does not carry
   * on through it: the arms are checked, and for the length of the bind the
   * fighter stands in the position his blade was actually stopped in.
   */
  freezePose(seconds) {
    if (this.dead) return;
    if (!this.frozen) { this.frozen = emptyPose(); copyPose(this.pose, this.frozen); }
    this.bindT = Math.max(this.bindT, seconds);
    if (this.state === 'strike' || this.state === 'follow') { this.state = 'bind'; this.stateT = 0; }
  }

  push(dir, strength) {
    this.vel.addScaledVector(dir, strength / Math.max(40, this.mass) * 62);
  }

  onHitLanded(res) {
    this.hitFlash = 0.16;
    this.stamina = clamp(this.stamina - 5, 0, this.maxStamina);
    this.staminaDelay = STAMINA.regenDelay;
    this.say('landed', { res });
  }

  /** Being struck: pain, stagger, and the swing comes apart. */
  takeHit(res, dir) {
    this.lastResolve = res;
    const imp = res.applied + res.absorbed * 0.25;
    const heavy = res.reaction === 'heavy';
    const medium = res.reaction === 'medium';
    this.hurtDir = dir || 'front';
    this.stamina = clamp(this.stamina - (7 + clamp01(imp / 40) * 30), 0, this.maxStamina);
    this.staminaDelay = STAMINA.regenDelay;
    this.hitFlash = 0.25;
    this.say('hurt', { res, dir: this.hurtDir });
    if (this.dead) return;
    if (this.attacking || this.state === 'windup') {
      this.move = null;
      this.state = 'idle';
      this.stateT = 0;
    }
    if (heavy || medium) {
      this.state = 'stagger';
      this.stateT = 0;
      this.staggerT = heavy ? 0.72 : 0.4;
      this.guardBroken = Math.max(this.guardBroken, heavy ? 0.55 : 0.2);
    }
    if (!this.alive) this.die(res);
  }

  /**
   * Ask for quarter. A beaten man in a hall under a roof of witnesses does not
   * have to die: he drops his point and takes his beating. Nothing else in the
   * game changes, except that the man who yields is still there tomorrow.
   */
  yield() {
    if (this.dead || this.yielded || !this.bodyState.alive) return false;
    this.yielded = true;
    this.state = 'stagger';
    this.stateT = 0;
    this.staggerT = 1.2;
    this.move = null;
    this.charge = 0;
    this.say('yield');
    return true;
  }

  die(res) {
    if (this.dead) return;
    this.dead = true;
    this.state = 'dead';
    this.stateT = 0;
    this.deathT = 0;
    this.deathSide = jitter(0.9);
    this.vel.multiplyScalar(0.2);
    this.say('death', { res });
  }

  setHarness(h) { this.harness = h; this.rig.setHarness(h); }

  // ══════════════════════════════════════════════════════════════════════════
  //  frame
  // ══════════════════════════════════════════════════════════════════════════
  update(dt, world, time) {
    this._t = time ?? (this._t || 0) + dt;
    this._dt = dt;
    const wasAlive = this.bodyState.alive;
    this.bodyState.tick(dt);
    if (wasAlive && !this.bodyState.alive) this.die(this.lastResolve);
    this.events.length = 0;

    if (!this.dead) {
      // ── stamina ──
      this.staminaDelay = Math.max(0, this.staminaDelay - dt);
      if (this.staminaDelay <= 0) {
        let regen = this.speed > 0.9 ? STAMINA.regenMoving : STAMINA.regen;
        // holding a guard overhead is work, not rest: it is paid for below and
        // it does not pay you back
        if (this.state === 'block') regen = 0;
        if (this.exhausted) regen *= STAMINA.exhaustedRegenMult;
        this.stamina = clamp(this.stamina + regen * dt, 0, this.maxStamina);
      }
      // being winded sticks: it takes a while to get your wind back, and until
      // you do your guard is worth less than your arms think
      const wasWinded = this.exhausted;
      this.exhausted = wasWinded
        ? this.stamina < STAMINA.exhaustedBelow + 9
        : this.stamina < STAMINA.exhaustedBelow;
      if (this.guardBroken > 0) this.guardBroken -= dt;
      if (this.state === 'block') {
        this.guardT += dt;
        this.stamina = clamp(this.stamina - STAMINA.blockHold * dt * (this.shieldDef.model ? 0.4 : 0.55), 0, this.maxStamina);
      }
      if (this.parryT > 0) this.parryT -= dt;
      if (this.exhausted && (this.state === 'windup' || this.state === 'strike')) {
        this.state = 'recover'; this.stateT = 0.3; this.move = null;
      }
      this.stateT += dt;
      this.advanceState(dt);
    } else {
      this.deathT += dt;
    }
    this.hitFlash = Math.max(0, this.hitFlash - dt);

    this.applyIntent(dt);
    this.updateFeet(dt);
    this.updatePose(dt);
    this.updatePhysics(dt, world);

    // ── armature is final; read the steel back out of it ──
    this.rig.root.updateWorldMatrix(true, true);
    this.wb.setDt(dt); this.wb.sample();
    if (this.sb) { this.sb.setDt(dt); this.sb.sample(); }
    this.rig.updateVolumes();
    this.volumes = this.rig.volumes;
  }

  advanceState(dt) {
    const m = this.move;
    switch (this.state) {
      case 'windup': {
        // hold the cocked position and it charges; past the window it starts to fail
        const w = (m?.dur.windup ?? 0.2) / (this.swingScale * (1 + 0.16 * this.charge));
        if (this.stateT > w) {
          this.charge = clamp01((this.stateT - w) / 0.55);
          this.stamina = clamp(this.stamina - 6 * dt, 0, this.maxStamina);
          if (this.stateT > w + 1.5) { this.state = 'recover'; this.stateT = 0; this.move = null; }
        }
        break;
      }
      case 'strike': {
        const s = (m?.dur.strike ?? 0.15) / (this.swingScale * (1 + 0.2 * this.charge));
        // a committed blow steps in: a thrust drives the man forward, a cut
        // turns the hips into the blow
        if (m?.lunge) this.vel.addScaledVector(this.forward(_v1), m.lunge * dt);
        if (this.stateT >= s) { this.state = 'follow'; this.stateT = 0; }
        break;
      }
      case 'follow': {
        if (this.stateT >= (m?.dur.recover ?? 0.3) * 0.32 / this.swingScale) { this.state = 'recover'; this.stateT = 0; }
        break;
      }
      case 'recover': {
        if (this.stateT >= (m?.dur.recover ?? 0.3) * 0.6 / this.swingScale) {
          this.state = 'idle'; this.stateT = 0; this.move = null; this.charge = 0; this.comboCount = 0;
        }
        break;
      }
      case 'bind': {
        this.bindT -= dt;
        if (this.bindT <= 0) {
          this.state = 'recover'; this.stateT = 0; this.move = null; this.frozen = null;
        }
        break;
      }
      case 'stagger': {
        this.staggerT -= dt;
        if (this.staggerT <= 0 && this.guardBroken <= 0) { this.state = 'idle'; this.stateT = 0; }
        break;
      }
      default: break;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  pose → arms
  // ══════════════════════════════════════════════════════════════════════════
  updatePose(dt) {
    const pose = this.pose;
    const m = this.move;
    if (this.dead) {
      this.poseDeath(dt, pose);
    } else if (this.frozen) {
      copyPose(this.frozen, pose);
      if (this.state !== 'bind') { this.state = 'bind'; this.stateT = 0; }
    } else if (this.attacking || this.state === 'windup' || this.state === 'recover') {
      if (!m) copyPose(IDLE, pose);
      else {
        const phase = this.state;
        const scale = this.swingScale * (1 + (phase === 'windup' ? 0.16 : 0.2) * this.charge);
        const dur = phase === 'windup' ? m.dur.windup / scale
          : phase === 'strike' ? m.dur.strike / scale
          : phase === 'follow' ? m.dur.recover * 0.32 / scale
          : m.dur.recover * 0.6 / scale;
        sampleMove(m, phase, clamp01(this.stateT / Math.max(0.02, dur)), pose, this.tipLen);
      }
    } else if (this.state === 'stagger') {
      const hurt = HURT[this.hurtDir] || HURT.front;
      const k = clamp01(this.staggerT / 0.45);
      lerpPose(IDLE, hurt, k, pose);
    } else {
      // idle: breathing steel, and the weight of it
      const b = this.breath + this._t * 2.1;
      pose.hand.copy(IDLE.hand);
      pose.hand.y += Math.sin(b * 1.1) * 0.012 + Math.sin(b * 0.43) * 0.008;
      pose.hand.x += Math.cos(b * 0.7) * 0.009;
      pose.hand.z += Math.sin(b * 0.5) * 0.011;
      pose.blade.copy(IDLE.blade);
      pose.blade.x += Math.sin(b * 0.8) * 0.05;
      pose.blade.y += Math.cos(b * 0.9) * 0.04;
      pose.blade.normalize();
      pose.edge.copy(IDLE.edge);
      if (this.state === 'block') {
        const g = GUARDS[this.guardDir] || GUARDS.center;
        const p = (this.guardT < 0.14 && PARRY_POSE[this.guardDir]) ? PARRY_POSE[this.guardDir] : g;
        copyPose(p, pose);
      }
    }
    this.poseSway(dt, pose);
    this.applyPose(pose, dt);
  }

  poseSway(dt, pose) {
    const s = clamp01(this.speed / 2.4);
    this.stepPhase += dt * (1.5 + this.speed * 1.9);
    pose.hand.x += Math.sin(this.stepPhase) * 0.03 * s;
    pose.hand.y += Math.abs(Math.cos(this.stepPhase)) * 0.012 * s;
    this.lean = damp(this.lean, clamp(this.speed * 0.05, 0, 0.13) + (this.exhausted ? 0.05 : 0), 6, dt);
  }

  poseDeath(dt, pose) {
    const k = clamp01(this.deathT / 1.25);
    const fall = k * k * (3 - 2 * k);
    lerpPose(HURT[this.hurtDir] || HURT.front, { hand: _v1.set(0.34, -0.72, -0.14), blade: _v2.set(0.18, -0.3, -0.94), edge: _v3.set(0.2, -0.3, -0.93) }, fall, pose);
  }

  applyPose(pose, dt) {
    const rig = this.rig;
    rig.root.updateWorldMatrix(true, false);
    // arms chase the pose; during a blow they must keep up with it
    const rate = this.dead ? 8 : (this.attacking || this.state === 'windup' ? 44 : 26);
    const k = 1 - Math.exp(-rate * dt);

    // ── right hand: the pose, or the guard solver when a blade is coming ──
    const rot = poseToWorld(rig, pose.hand, new THREE.Vector3());
    const blade = _bl.set(-pose.blade.x, pose.blade.y, -pose.blade.z).normalize();
    const qWorld = poseQuatWorld(rig, pose.blade, pose.edge, new THREE.Quaternion());
    // edgeRoll turns the blade about its own axis: the flats are what a
    // gauntlet, a pommel or a shield edge presents, and the test harness uses
    // it to prove the resolver can tell an edge from a flat.
    if (this.edgeRoll) qWorld.multiply(_qr.setFromAxisAngle(UP, this.edgeRoll));
    if (this.blocking && this.guardWeapon) {
      const aim = _f1.set(0, 1, 0).applyQuaternion(qWorld);   // where the stance points
      if (this.guardLockT > 0) this.guardLockT -= dt;
      const out = solveGuard(rig, 'R', this.guardWeapon, this.guardHorizon ?? 0.055,
        {
          reach: this.tipLen, error: this.readError * 0.5, maxRange: 1.9, t: this._t || 0,
          facing: true, fist: rot, aim,
          kind: this.opponentKind, pointWeapon: !!this.guardWeapon?.userData?.parts?.spike,
          misread: this.guardMisread,
          prev: this.guardAim, dt: this._dt || 1 / 60,
          // How fast the point can be carried from one line to another. Raising
          // the guard is a DECISION — the line you think you need, taken at
          // once — and after that the arm can only turn like an arm. That
          // difference is what makes switching sides beat a set guard, and what
          // makes a parry (a fresh decision, inside the window) worth more.
          maxTurn: this.guardT < 0.16 ? 14 : (this.parryT > 0 ? 4.6 : 3.0),
          locked: this.guardLockT > 0 ? this.guardLock : null,
          shield: this.offKind === 'shield', coverage: this.shieldDef.coverage || 0,
        },
        this.guardOut);
      if (!out.noThreat && !out.noFist && this.guardLockT <= 0) {
        if (!this.guardLock) this.guardLock = { dir: new THREE.Vector3(), edge: new THREE.Vector3() };
        this.guardLock.dir.copy(out.bladeDir);
        this.guardLock.edge.copy(out.edgeDir);
      }
      if (!out.noThreat && out.noFist === false && out.fist) {
        // a thrust has to be crossed, and a cross is built from both ends: the
        // solver had to move the fist to build it
        rot.copy(out.fist);
        if (!this.guardCross) this.guardCross = { fist: new THREE.Vector3(), dir: new THREE.Vector3() };
      }
      if (out.noThreat) {
        // His steel has swept past us — but the next blow may already be in the
        // air. Hold the last guard for a moment instead of dropping the hands.
        if (this.guardMemory && this._t - this.guardMemory.t < 0.3) {
          frameWorld(this.guardMemory.dir, this.guardMemory.edge, qWorld);
        } else {
          frameWorld(out.bladeDir, out.edgeDir, qWorld);
          this.guardAim.copy(out.bladeDir);
        }
      } else {
        this.guardMemory = { dir: out.bladeDir.clone(), edge: out.edgeDir.clone(), t: this._t };
        frameWorld(out.bladeDir, out.edgeDir, qWorld);
        this.guardAim.copy(out.bladeDir);
      }
    }
    // lean the torso into the blow
    if (this.attacking || this.state === 'windup') {
      const f = this.forward(_v1);
      rot.addScaledVector(f, 0.05 * this.charge);
    }
    const armR = this.arm.R;
    if (!armR.ready) { armR.pos.copy(rot); armR.quat.copy(qWorld); armR.ready = true; }
    else { armR.pos.lerp(rot, k); armR.quat.slerp(qWorld, k); }
    rig.solveArm('R', armR.pos, this.poleFor('R', _v1), armR.quat);

    // ── left hand: shield, second grip, or a free counterweight ──
    this.solveOffhand(pose, armR, this.arm.L, k, dt);
  }

  poleFor(side, out) {
    // elbows are pushed out and down; outward is local −X for the right arm
    out.set(side === 'R' ? -0.75 : 0.75, -0.55, -0.34);
    return out.applyQuaternion(this.worldQuat(_q2)).normalize();
  }

  solveOffhand(pose, armR, armL, k, dt) {
    const rig = this.rig;
    const off = this.off;
    rig.root.updateWorldMatrix(true, false);
    const chest = _p1.setFromMatrixPosition(rig.bones.chest.matrixWorld);
    const f = _p2.set(0, 0, 1).applyQuaternion(this.worldQuat(_qt));
    const right = _p3.set(1, 0, 0).applyQuaternion(_qt);
    const qq = _qt2;
    if (this.offKind === 'grip') {
      // both fists on one haft, stacked along the blade
      const y = _p4.set(0, 1, 0).applyQuaternion(armR.quat);
      const fist = _p5.copy(armR.pos).addScaledVector(y, this.gripOffset);
      const shoulder = _p6.setFromMatrixPosition(rig.bones.armL.matrixWorld);
      within(fist, shoulder, rig.dims.upperArmL + rig.dims.foreArmL - 0.06);
      off.hand.copy(fist);
      qq.copy(armR.quat);
      off.blade.copy(y); off.edge.set(0, 0, 1);
    } else if (this.offKind === 'shield') {
      let side = 0.28, up = -0.03, fwd = 0.32;
      if (this.blocking) {
        // angle the shield at wherever the blow is coming from
        const tp = this.guardShield || null;
        if (tp) {
          const local = _p4.copy(tp).sub(chest);
          const h = local.dot(right), v = local.y;
          const a = Math.abs(h) + Math.abs(v) + 0.001;
          side += clamp(h / a, -1, 1) * 0.17;
          if (this.shieldDef.coverage > 0.4) up += clamp(v / a, -1, 1) * 0.14;
          this.rig.bones.chest.rotation.x += clamp(v / a, -1, 1) * 0.05;
        }
        fwd += 0.05 + this.shieldDef.coverage * 0.16;
        up += this.shieldDef.coverage * 0.05;
      }
      off.hand.copy(chest).addScaledVector(right, side).addScaledVector(f, fwd);
      off.hand.y += up;
      off.blade.copy(f).multiplyScalar(-1);   // face is the fist's −Y: turn it outward
      off.edge.set(0, 1, 0);                  // the shield's long axis stands up
      frameWorld(off.blade, off.edge, qq);
    } else {
      // free hand: counterweight and guard, never idle
      off.hand.copy(chest).addScaledVector(right, -0.29).addScaledVector(f, 0.19);
      off.hand.y -= 0.14;
      off.blade.copy(f).multiplyScalar(0.72).setY(0.62).normalize();
      off.edge.set(0, -1, 0.2).normalize();
      frameWorld(off.blade, off.edge, qq);
    }
    if (!armL.ready) { armL.pos.copy(off.hand); armL.quat.copy(qq); armL.ready = true; }
    else { armL.pos.lerp(off.hand, k); armL.quat.slerp(qq, k); }
    rig.solveArm('L', armL.pos, this.poleFor('L', _p1), armL.quat);
    this.poseTorso(dt, this.lean);
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  torso, hit reactions, death
  // ══════════════════════════════════════════════════════════════════════════
  poseTorso(dt, lean) {
    const b = this.rig.bones;
    const t = this._t || 0;
    const swing = (this.state === 'strike' || this.state === 'follow') ? 0.3 : 0;
    const wind = this.state === 'windup' ? -0.26 : 0;
    const hurt = this.state === 'stagger' ? Math.sin(t * 24) * 0.14 * clamp01(this.staggerT) : 0;
    this.twist = damp(this.twist, swing + wind + hurt, 9, dt);
    b.spine.rotation.y = this.twist * 0.5;
    b.chest.rotation.y = this.twist * 0.5;
    b.spine.rotation.x = lean * 0.5;
    b.chest.rotation.x = lean * 0.4 + (this.blocking ? 0.06 : 0);
    b.head.rotation.y = damp(b.head.rotation.y, -this.twist * 0.4, 6, dt);
    b.head.rotation.x = damp(b.head.rotation.x, this.dead ? 0.4 : this.state === 'stagger' ? -0.3 : (this.lookPitch || 0) * 0.35, 6, dt);
    if (this.dead) {
      const k = clamp01(this.deathT / 1.15);
      const fall = k * k * (3 - 2 * k);
      b.hips.rotation.x = fall * 1.0;
      b.hips.position.y = this.rig.dims.hipsY * (1 - 0.66 * fall);
      b.spine.rotation.x = fall * 0.5 + lean * 0.2;
      b.kneeL.rotation.x = fall * 0.95;
      b.kneeR.rotation.x = fall * 1.15;
      b.hipL.rotation.x = -fall * 0.75;
      b.hipR.rotation.x = -fall * 0.55;
      this.rig.root.rotation.z = damp(this.rig.root.rotation.z, fall * this.deathSide, 4, dt);
      this.rig.root.rotation.y = this.yaw;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  feet, movement, collision
  // ══════════════════════════════════════════════════════════════════════════
  /**
   * Intent → velocity. A committed blow roots a man: he can shuffle a little,
   * but his feet are busy. Holding a guard and walking forward is how a duel
   * closes, and sprinting is what leaves you winded.
   */
  applyIntent(dt) {
    const it = this.intent;
    if (!it) return;
    const mag = Math.min(1, Math.hypot(it.x || 0, it.z || 0));
    let max = this.maxSpeed;
    if (this.state === 'block') max *= 0.52;
    else if (this.state === 'windup') max *= 0.34;
    else if (this.state === 'strike' || this.state === 'follow') max *= 0.10;
    else if (this.state === 'recover' || this.state === 'stagger') max *= 0.45;
    const sprinting = !!it.sprint && this.stamina > 6 && this.state === 'idle';
    if (sprinting) max *= 1.5;
    if (this.exhausted) max *= 0.66;
    if (this.bodyState.guardsUp()) max *= 0.6;
    _v1.set(0, 0, 1).applyQuaternion(this.worldQuat(_q2));
    _v2.set(1, 0, 0).applyQuaternion(this.worldQuat(_q1));
    _v3.set(0, 0, 0).addScaledVector(_v1, it.z || 0).addScaledVector(_v2, it.x || 0);
    if (_v3.lengthSq() > 1e-6) _v3.normalize().multiplyScalar(max * mag);
    const k = 1 - Math.exp(-PLAYER.accel * 0.6 * dt);
    this.vel.x += (_v3.x - this.vel.x) * k;
    this.vel.z += (_v3.z - this.vel.z) * k;
    // Shuffling around a man is not exertion: only a real stride costs wind, and
    // only a real stride holds the breath back. Bleed a man for every sidestep
    // and the whole duel becomes two exhausted men leaning on each other.
    if (sprinting) {
      this.stamina = clamp(this.stamina - STAMINA.sprintDrain * dt, 0, this.maxStamina);
      this.staminaDelay = Math.max(this.staminaDelay, 0.35);
    } else if (mag > 0.55) {
      this.stamina = clamp(this.stamina - 1.1 * mag * dt, 0, this.maxStamina);
      this.staminaDelay = Math.max(this.staminaDelay, 0.16);
    }
  }

  updateFeet(dt) {
    const rig = this.rig;
    rig.root.updateWorldMatrix(true, false);
    const stride = clamp(this.speed * 0.2, 0.08, 0.4);
    const build = this.cfg.body?.build ?? 1;
    for (const s of ['L', 'R']) {
      const f = this.feet[s];
      const phase = this.stepPhase + (s === 'L' ? 0 : Math.PI);
      const want = s === 'L' ? 1 : -1;
      const swing = this.speed > 0.3 ? Math.sin(phase) : 0;
      f.x = damp(f.x, want * 0.11 * build + swing * 0.02, 10, dt);
      f.z = damp(f.z, swing * stride * 1.15, 8, dt);
      f.y = Math.max(0, Math.sin(phase + Math.PI / 2)) * clamp01(this.speed / 2.2) * 0.07;
      _v1.set(f.x, f.y, f.z);
      rig.root.localToWorld(_v1);
      if (_v1.y < 0.02) _v1.y = 0.02;
      rig.solveLeg(s, _v1, _v2.set(0, 0, -0.65).applyQuaternion(this.worldQuat(_q2)));
    }
  }

  updatePhysics(dt, world) {
    const r = this.rig.root;
    this.pos.addScaledVector(this.vel, dt);
    this.vel.multiplyScalar(Math.exp(-PLAYER.friction * dt * 0.45));
    if (this.vel.lengthSq() < 1e-5) this.vel.set(0, 0, 0);
    this.speed = this.vel.length();
    if (world) {
      const b = world.bounds || world.def?.bounds;
      if (b) {
        this.pos.x = clamp(this.pos.x, -b.x + this.radius, b.x - this.radius);
        this.pos.z = clamp(this.pos.z, -b.z + this.radius, b.z - this.radius);
      }
      for (const c of (world.colliders || [])) this.resolveBox(c);
    }
    this.pos.y = 0;
    r.position.copy(this.pos);
    r.rotation.y = this.yaw;
  }

  resolveBox(c) {
    const p = this.pos, rad = this.radius;
    if (p.y + this.height < c.min.y || p.y > c.max.y) return;
    const cx = clamp(p.x, c.min.x, c.max.x);
    const cz = clamp(p.z, c.min.z, c.max.z);
    const dx = p.x - cx, dz = p.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 > rad * rad) return;
    if (d2 > 1e-6) {
      const d = Math.sqrt(d2);
      p.x = cx + (dx / d) * rad;
      p.z = cz + (dz / d) * rad;
    } else {
      const left = p.x - c.min.x, right = c.max.x - p.x, back = p.z - c.min.z, front = c.max.z - p.z;
      const m = Math.min(left, right, back, front);
      if (m === left) p.x = c.min.x - rad;
      else if (m === right) p.x = c.max.x + rad;
      else if (m === back) p.z = c.min.z - rad;
      else p.z = c.max.z + rad;
    }
    this.vel.multiplyScalar(0.35);
  }

  /** Two fighters cannot occupy the same ground. */
  separate(other) {
    const dx = this.pos.x - other.pos.x, dz = this.pos.z - other.pos.z;
    const min = this.radius + other.radius;
    const d2 = dx * dx + dz * dz;
    if (d2 > min * min) return false;
    const d = Math.max(Math.sqrt(d2), 1e-4);
    const push = (min - d) / 2;
    this.pos.x += (dx / d) * push; this.pos.z += (dz / d) * push;
    other.pos.x -= (dx / d) * push; other.pos.z -= (dz / d) * push;
    return true;
  }

  faceTowards(target, rate, dt) {
    const dx = target.x - this.pos.x, dz = target.z - this.pos.z;
    if (dx * dx + dz * dz < 1e-6) return;
    this.yaw = angDamp(this.yaw, Math.atan2(dx, dz), rate, dt);
  }

  /** Count down the broken-guard window (called by the exchange director). */
  passThroughTick(dt) {
    if (this.passThroughT > 0) {
      this.passThroughT -= dt;
      if (this.passThroughT <= 0) { this.passThrough = 0; this.passThroughT = 0; }
    }
  }

  /** Where is this fighter's steel relative to its own chest? For AI reads. */
  tipRelative(out = new THREE.Vector3()) {
    this.rig.root.updateWorldMatrix(true, false);
    out.setFromMatrixPosition(this.rig.bones.chest.matrixWorld);
    return this.weaponTip(_v1).sub(out);
  }
}
