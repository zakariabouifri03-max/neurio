// ── IRONVOW — the opponent: what a man on the other side of the steel does ───
// The brain never touches the pose or the physics. It does what a player does:
// reads the wind-up, picks a guard, steps in or out, and commits to a blow. All
// of its mistakes are HUMAN mistakes — it reacts late, it commits early and gets
// feinted, it reaches when it is tired.
import * as THREE from 'three';
import { clamp, clamp01, angDiff, rnd, jitter, pick, _v1, _v2, _v3, _v4, _v5 } from './mathx.js';
import { threatPoint } from './defense.js';

const DIRS = ['R', 'U', 'D', 'L'];
const _qt1 = new THREE.Quaternion();

export class Brain {
  /**
   * @param fighter the man this brain drives
   * @param profile { reaction, feintResist, guardError, aggression, patience,
   *                  footwork, combo, bash, shield }
   */
  constructor(fighter, profile = {}) {
    this.f = fighter;
    this.p = {
      reaction: 0.17, feintResist: 0.8, guardError: 0.07, aggression: 0.6,
      patience: 0.5, footwork: 0.6, combo: 2, bash: 0.3, step: 1.0,
      ...profile,
    };
    this.f.readError = this.p.guardError;
    this.t = 0;
    this.decideT = 0;
    this.reactT = 0;
    this.commitT = 0;
    this.lastDir = 'R';
    this.dirFlip = 0;
    this.mode = 'circle';
    this.modeT = 0;
    this.guardSide = 'center';
    this.raisedAt = -99;
    this.readT = 0;
    this.seenWind = null;
    this._prevWind = false;
    this.staminaCare = 0.35;
    this.foot = new THREE.Vector3();
    this._v = new THREE.Vector3();
  }

  /** Seconds until the foe's steel is on us (a rough read, and that is the point). */
  timeToImpact(foe) {
    const m = foe.move;
    if (!m) return 99;
    if (foe.state === 'windup') {
      const w = m.dur.windup / foe.swingScale;
      return Math.max(0, w - foe.stateT) + (m.dur.strike / foe.swingScale) * 0.45;
    }
    if (foe.attacking) {
      const s = m.dur.strike / foe.swingScale;
      return Math.max(0, s - foe.stateT) * 0.55;
    }
    return 99;
  }

  /**
   * Which line to hold against what is coming.
   *
   * Reading a wind-up means reading where the STEEL WILL BE, not where it is:
   * a man mid-wind-up has his point behind his own shoulder, and a guard raised
   * to that is a guard raised to nothing. So the read is the threat solver's
   * prediction a fifth of a second out — the point of the blow, not its hilt.
   */
  guardFor(foe) {
    const f = this.f;
    f.rig.root.updateWorldMatrix(true, false);
    foe.rig.root.updateWorldMatrix(true, false);
    const chest = _v1.setFromMatrixPosition(f.rig.bones.chest.matrixWorld);
    const right = _v2.set(1, 0, 0).applyQuaternion(f.rig.root.getWorldQuaternion(_qt1));
    const up = _v3.set(0, 1, 0).applyQuaternion(f.rig.root.getWorldQuaternion(_qt1));
    const ahead = threatPoint(f.rig, foe.wb, 0.2, { facing: true, maxRange: 2.2, predict: 24 });
    const p = ahead || foe.weaponTip(_v4);
    const to = _v5.copy(p).sub(chest);
    const h = to.dot(right);
    const v = to.dot(up);
    // steel coming down onto the head is answered high; steel at the waist low;
    // steel off to one side is answered on that side
    let side = 'center';
    if (v > 0.30) side = 'high';
    else if (v < -0.16) side = 'low';
    if (Math.abs(h) > 0.34) side = h > 0 ? 'left' : 'right';
    return side;
  }

  update(dt, foe) {
    const f = this.f;
    this.t += dt;
    this.modeT += dt;
    f.intent.x = 0; f.intent.z = 0; f.intent.sprint = false;
    if (!f.alive || !foe.alive || f.yielded) return;
    // A man who cannot hold his guard any more does not have to die for it: the
    // greener he is, the sooner he asks for quarter. Only the last of them would
    // rather be carried out.
    const hurt = f.bodyState.health / f.bodyState.maxHealth;
    if (hurt < (this.p.yieldAt ?? 0.25) && rnd() < 0.02 + (1 - this.p.feintResist) * 0.03) {
      f.yield();
      return;
    }

    const dist = f.chestDistance(foe);
    const range = clamp((f.reach + foe.reach) * 0.5 + 0.15, 0.9, 3.2);
    // Where this weapon WANTS the fight, in the only units that matter: the
    // measure of the blows it actually throws. A man out of measure is a man
    // swinging at the air, which is how the first version of this brain managed
    // to fight for ninety seconds without touching anybody.
    const ideal = clamp(f.measure * 0.70, 0.8, 2.3);
    const tti = this.timeToImpact(foe);
    const incoming = tti < 90;
    const wind = f.stamina / f.maxStamina;

    // ── face him. A duellist does not fight sideways ──
    // angDiff(a, b) answers "how far is b from a", so the target goes second:
    // get this backwards and a duellist turns steadily away from his rival, and
    // the two of them walk off to opposite walls of the hall like a bad marriage.
    const want = Math.atan2(foe.pos.x - f.pos.x, foe.pos.z - f.pos.z);
    const turn = clamp(angDiff(f.yaw, want) * 6, -7, 7);
    f.yaw += turn * dt;

    // ── DEFENCE ──────────────────────────────────────────────────────────────
    // A duellist does not stand with his hands down waiting to be attacked: the
    // guard is UP, and the question is only which line it holds. What costs time
    // is CHANGING the line — reading that the blow is going high and getting the
    // steel there — so a fast cut to the side he is not covering lands, and a
    // slow one does not. That is the whole defensive game, for the player and
    // for the man opposite, and it is why a feint works.
    const winding = foe.state === 'windup';
    if (winding && this._prevWind !== true) this.seenWind = this.t;
    this._prevWind = winding;
    const seen = this.seenWind == null ? 99 : this.t - this.seenWind;
    const needs = this.p.reaction + (f.exhausted ? 0.12 : 0) + (f.bodyState.guardsUp() ? 0.25 : 0);
    const readDone = !winding || seen >= needs;
    // hold the line while the wind is there; a spent man drops his hands to
    // breathe, and that is when he gets hit
    // Inside measure, the guard is up — that IS the stance a swordsman stands
    // in. Nobody walks into a fight with his hands at his sides and then
    // discovers he has to raise them: the first blow of a bout would be free,
    // and it was, until this line existed. But a guard is work: a man who never
    // lowers it is a man who cannot raise a blow, and he will stand there
    // leaning on his own sword until someone hits him.
    if (this._spent === undefined) this._spent = false;
    const inMeasure = dist < f.measure * 1.05;
    if (f.stamina < f.maxStamina * (this._spent ? 0.42 : 0.27)) this._spent = true;
    else if (f.stamina > f.maxStamina * (this._spent ? 0.6 : 0.55)) this._spent = false;
    const spent = this._spent;
    const danger = winding || foe.attacking || tti < 0.5 || (inMeasure && !spent);
    const wantGuard = !spent || danger;
    // A man with a blow in the air has no hands to spare for his guard: raising
    // it mid-swing would turn his own attack into a feint, which is exactly what
    // the first version of this brain did — it feinted away every cut it threw.
    const committed = f.state === 'windup' || f.state === 'strike' || f.state === 'follow' || f.state === 'recover';
    if (committed) {
      this._prevWind = winding;
    } else if (wantGuard) {
      if (this.raisedAt < 0) this.raisedAt = this.t;
      let side = this.guardSide;
      if (readDone && (winding || foe.attacking || f.state === 'idle')) {
        // re-read the line: this is the turn that takes a man `reaction` seconds,
        // and it is the reason a blow down the open side gets through
        if (winding) {
          side = this.guardFor(foe);
          if (rnd() < (1 - this.p.feintResist) * 0.55) side = DIRS[(rnd() * 4) | 0].toLowerCase();
        } else if (this.t - this.readT > 0.6) {
          side = 'center';
        }
      }
      if (side !== this.guardSide || !f.blocking) { this.guardSide = side; this.readT = this.t; }
      if (!f.blocking && tti > 0.01) f.startBlock(side);
    } else {
      if (!winding && !foe.attacking) this.raisedAt = -99;
      if (f.blocking) f.endBlock();
    }

    // ── FOOTWORK: hold the range that suits the weapon ──
    const tooClose = dist < ideal * 0.72;
    const tooFar = dist > ideal * 1.12;
    let wantZ = 0, wantX = 0;
    if (tooFar && wind > this.staminaCare) wantZ = 1;
    else if (tooClose) wantZ = -0.7;
    // circle the man, and change the way round now and then
    this.dirFlip -= dt;
    if (this.dirFlip <= 0) { this.dirFlip = 1.4 + rnd() * 2.2; this.circle = rnd() < 0.5 ? 1 : -1; }
    wantX = this.circle * (0.65 * this.p.footwork);
    if (incoming && tti < 0.3 && rnd() < 0.4) wantX *= -1;   // step off the line
    const stop = f.stamina < 8;
    if (!stop) { f.intent.x = wantX; f.intent.z = wantZ; f.intent.sprint = wantZ > 0 && !incoming && dist > ideal * 1.3; }

    // ── ATTACK: pick a moment, not a rhythm ──
    this.decideT -= dt;
    if (this.decideT <= 0) {
      this.decideT = 0.12 + rnd() * 0.18;
      const canReach = dist < f.measure * 0.92;
      const ready = wind > (0.16 + (1 - this.p.aggression) * 0.18);
      // Do not throw into a man who is already throwing. Every real duelist
      // waits: his steel has to be past you before your own blow is worth
      // anything, and the man who swings into a swing is the man who dies.
      const calm = tti > 0.42;
      // a blow starts from the guard, not from a parade rest
      const settled = f.state === 'idle' || f.state === 'block';
      if (canReach && ready && calm && settled && rnd() < this.p.aggression * 0.9) {
        this.attack(foe, dist);
      } else if (canReach && this.p.bash > 0.5 && f.shieldDef.model && settled && rnd() < 0.1) {
        f.shove(1.2);
      }
    }
    // A committed blow is a bet on the other man's hands: let it go early and
    // it lands before he has moved, hold it and it hits harder but he is ready.
    // The good fencers let it go early.
    if (f.state === 'windup' && f.move) {
      const w = f.move.dur.windup / f.swingScale;
      const read = clamp01(this.p.feintResist);          // skill doubles as timing
      // One blow in four is MEANT to fold the other man's guard: it is held
      // past its wind-up, and it arrives heavier and slower. A heavy weapon does
      // this more often, because that is the only thing a heavy weapon is for.
      if (this._beat === undefined || this._beatBlow !== f.move) {
        this._beatBlow = f.move;
        this._beat = rnd() < 0.18 + (f.weaponDef.mass > 2 ? 0.22 : 0) + (1 - read) * 0.1;
      }
      const hold = this._beat ? 1.22 : 0.72 + (1 - read) * 0.26 - this.p.aggression * 0.06;
      if (f.stateT >= w * clamp(hold, 0.5, 1.35)) { f.releaseAttack(); this._beatBlow = null; }
    }
  }

  /** Choose a blow: one that can actually reach, at the hole in his guard. */
  attack(foe, dist) {
    const f = this.f;
    const inReach = DIRS.filter((d) => (f.ranges[d] ?? f.reach) >= dist);
    const pool = inReach.length ? inReach : DIRS;
    let dir = pool[(rnd() * pool.length) | 0];
    if (rnd() < 0.55) {
      // strike where he is NOT holding: the guard's side is his strength
      const g = foe.guardDir || 'center';
      // strike where he is NOT holding: his guard's side is his strength
      const opposite = { center: ['R', 'L'], high: ['D', 'R'], low: ['U', 'R'], left: ['R', 'U'], right: ['L', 'U'] }[g] || DIRS;
      const open = opposite.filter((d) => pool.includes(d));
      dir = (open.length ? open : pool)[(rnd() * (open.length || pool.length)) | 0];
    }
    // point weapons thrust; heavy weapons overhead; at close range, short cuts
    if (f.weaponDef.archetype === 'polearm' || f.weaponDef.archetype === 'spear') dir = dist > 1.5 || rnd() < 0.7 ? (rnd() < 0.5 ? 'U' : 'D') : dir;
    else if (f.weaponDef.mass > 2.0 && rnd() < 0.5) dir = 'U';
    // a feint first, sometimes — the counter to a committed guard
    if (rnd() < 0.13 * (1 - this.p.feintResist * 0.4)) {
      f.startAttack(dir);
      f.feint();
      this.lastDir = dir;
      return;
    }
    f.startAttack(dir);
    this.lastDir = dir;
  }
}
