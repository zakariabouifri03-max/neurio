// ── IRONVOW — the argument: swept blade physics · armour · wounds ────────────
// The rule that makes this a sword game rather than a stat fight: a blow is
// resolved from where the steel was, how fast it was going, and WHICH FACE it
// presented. Swing the edge through a man and he opens. Hit him with the flat
// and he only learns to hate you.
import * as THREE from 'three';
import { COMBAT, LAYERS } from './tuning.js';
import { clamp, clamp01, lerp, _q1, _q2, _v1, _v2, _v3, makeSegOut, segSeg } from './mathx.js';
import { classifyContact } from './weapons.js';

const TMP = {
  a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), d: new THREE.Vector3(),
  seg: makeSegOut(), q: new THREE.Quaternion(), q2: new THREE.Quaternion(),
  m: new THREE.Matrix4(), p: new THREE.Vector3(), s: new THREE.Vector3(),
  v1: new THREE.Vector3(), v2: new THREE.Vector3(), v3: new THREE.Vector3(),
  wa1: new THREE.Vector3(), wa2: new THREE.Vector3(),
  wb1: new THREE.Vector3(), wb2: new THREE.Vector3(),
};

// ════════════════════════════════════════════════════════════════════════════
//  MATERIAL COVERAGE — how much of each body region a material layer protects
// ════════════════════════════════════════════════════════════════════════════
// The head is the one region every man armours first, even when he can afford
// nothing else: a padded coif under a cap, a leather skullcap, a mail coif. A
// duel between two men in cloth is still a duel, not an execution.
export const COVERAGE = {
  plate: { head: 0.92, throat: 0.22, chest: 1.0, abdomen: 0.92, upperArm: 0.85, foreArm: 0.72, hand: 0.80, thigh: 0.58, shin: 0.52, foot: 0.45 },
  mail: { head: 0.72, throat: 0.72, chest: 1.0, abdomen: 1.0, upperArm: 1.0, foreArm: 0.88, hand: 0.25, thigh: 0.72, shin: 0.52, foot: 0.18 },
  leather: { head: 0.62, throat: 0.45, chest: 0.92, abdomen: 0.92, upperArm: 0.82, foreArm: 0.75, hand: 0.62, thigh: 0.72, shin: 0.70, foot: 0.45 },
  gambeson: { head: 0.50, throat: 0.55, chest: 1.0, abdomen: 1.0, upperArm: 0.92, foreArm: 0.92, hand: 0.70, thigh: 0.92, shin: 0.82, foot: 0.5 },
};

const CHANNEL_OF_LAYER = { plate: ['pierce', 'blunt', 'cut'], mail: ['cut', 'pierce', 'blunt'], leather: ['cut', 'pierce', 'blunt'], gambeson: ['cut', 'blunt', 'pierce'] };

// ════════════════════════════════════════════════════════════════════════════
//  WEAPON BODY — a held object sampled against the world each frame
// ════════════════════════════════════════════════════════════════════════════
export class WeaponBody {
  /**
   * @param {THREE.Object3D} group  mesh whose local frame matches the file header
   * @param {object} def            weapon/shield definition from data.js
   * @param {boolean} offhand
   */
  constructor(group, def, offhand = false) {
    this.group = group;
    this.def = def;
    this.offhand = offhand;
    const segs = (group.userData.segs || []).filter((s) => s.part !== 'face' || s.r > 0.05);
    this.segs = segs;
    const n = segs.length;
    this.world = new Array(n); this.prev = new Array(n);
    for (let i = 0; i < n; i++) {
      this.world[i] = { a: new THREE.Vector3(), b: new THREE.Vector3(), r: segs[i].r };
      this.prev[i] = { a: new THREE.Vector3(), b: new THREE.Vector3(), r: segs[i].r };
    }
    this.pos = new THREE.Vector3(); this.quat = new THREE.Quaternion();
    this.prevPos = new THREE.Vector3(); this.prevQuat = new THREE.Quaternion();
    this._posLast = new THREE.Vector3(); this._quatLast = new THREE.Quaternion();
    this._lastPos = new THREE.Vector3(); this._lastQuat = new THREE.Quaternion();
    this._primed = false;
    this.owner = null;
    this.lastHitAgain = 0;
    this.insideSweep = 0;
    this.mass = def?.mass || 1;
    this.length = def?.length || 1;
    this.name = def?.short || def?.name || 'weapon';
  }

  /** Copy the armature transform into world, keeping the previous frame's. */
  sample() {
    this.group.updateWorldMatrix(true, false);
    this.group.matrixWorld.decompose(this.pos, this.quat, TMP.s);
    const p = this.pos, q = this.quat;
    this.prevPos.copy(this._posLast); this.prevQuat.copy(this._quatLast);
    this._posLast.copy(p); this._quatLast.copy(q);
    if (!this._primed) {
      // first sample: no history, so nothing can be "moving"
      this.prevPos.copy(p); this.prevQuat.copy(q);
      for (let i = 0; i < this.segs.length; i++) {
        const s = this.segs[i];
        this.world[i].a.copy(s.a).applyQuaternion(q).add(p);
        this.world[i].b.copy(s.b).applyQuaternion(q).add(p);
        this.prev[i].a.copy(this.world[i].a); this.prev[i].b.copy(this.world[i].b);
      }
      this._primed = true;
      return;
    }
    for (let i = 0; i < this.segs.length; i++) {
      this.prev[i].a.copy(this.world[i].a); this.prev[i].b.copy(this.world[i].b);
      const s = this.segs[i];
      this.world[i].a.copy(s.a).applyQuaternion(q).add(p);
      this.world[i].b.copy(s.b).applyQuaternion(q).add(p);
    }
  }

  /**
   * World velocity of a point fixed in the weapon's frame, from the frame's own
   * motion since the previous sample. This is the speed that matters: a man who
   * walks his chest into a held point is the one generating the energy.
   */
  pointVelocity(localPoint, out) {
    const q = this.quat, qp = this.prevQuat, p = this.pos, pp = this.prevPos;
    TMP.a.copy(localPoint).applyQuaternion(q).add(p);
    TMP.b.copy(localPoint).applyQuaternion(qp).add(pp);
    return out.copy(TMP.a).sub(TMP.b).multiplyScalar(1 / Math.max(1e-4, this._dt || 1 / 60));
  }

  /** Interpolated segment endpoints at t∈[0,1] between prev and current pose. */
  segAt(i, t, outA, outB) {
    const w = this.world[i], pv = this.prev[i];
    outA.lerpVectors(pv.a, w.a, t);
    outB.lerpVectors(pv.b, w.b, t);
    return outA;
  }

  /** Fastest linear speed of any sample point this frame (m/s). */
  tipSpeed() {
    const i = this.segs.length - 1;
    return this.prev[i].b.distanceTo(this.world[i].b) / Math.max(1e-4, this._dt || 1 / 60);
  }
  setDt(dt) { this._dt = dt; }
}

// ════════════════════════════════════════════════════════════════════════════
//  THE BODY — regions, layers, wounds
// ════════════════════════════════════════════════════════════════════════════
export class BodyState {
  constructor(harnessDef, opts = {}) {
    this.harness = harnessDef;
    this.health = COMBAT.maxHealth;
    this.maxHealth = COMBAT.maxHealth;
    this.alive = true;
    this.regions = {};
    this.bleed = 0;
    this.pain = 0;
    this.stagger = 0;
    this.stun = 0;
    this.down = 0;
    this.lastRegion = null;
    this.deathCause = null;
    this.reviveScale = opts.reviveScale || 1;
    const L = harnessDef.layers;
    for (const r of ['head', 'throat', 'chest', 'abdomen', 'upperArm', 'foreArm', 'hand', 'thigh', 'shin', 'foot']) {
      const layers = {};
      for (const k of ['gambeson', 'leather', 'mail', 'plate']) {
        const amt = (L[k] || 0) * (COVERAGE[k][r] ?? 0);
        if (amt > 0.04) layers[k] = { amount: amt, dur: 1, dents: 0 };
      }
      const vit = r === 'head' || r === 'throat' || r === 'chest' || r === 'abdomen';
      this.regions[r] = {
        hp: vit ? 100 : 62, maxHp: vit ? 100 : 62, layers, vital: vit,
        disabled: false, bleeding: 0, gap: harnessDef.gaps?.[r] ?? 0,
      };
    }
    // named weak points — hit within `r` of one of these on the rig and armour
    // effectively stops existing for that blow.
    this.gaps = [];
  }

  addGap(region, local, r, label) { this.gaps.push({ region, local: local.clone(), r, label }); }

  /** 0..1 protection against a channel at a region, with layer wear folded in. */
  protection(region, channel) {
    const st = this.regions[region];
    if (!st) return 0;
    let keep = 1;
    for (const k in st.layers) {
      const l = st.layers[k];
      const abs = LAYERS[k]['absorb' + channel[0].toUpperCase() + channel.slice(1)];
      keep *= 1 - abs * l.amount * clamp01(l.dur);
    }
    return clamp01(1 - keep);
  }

  /** Wear the layers with the joules that actually landed on them. */
  wear(region, ch, joules, piercing) {
    const st = this.regions[region];
    if (!st) return;
    const j = clamp(joules, 0, 400);
    if (st.layers.plate) {
      st.layers.plate.dur -= j * (ch === 'blunt' ? COMBAT.plateDentPerBlunt : ch === 'pierce' ? COMBAT.plateDentPerPierce : COMBAT.plateDentPerPierce * 0.4) * 3.2;
      st.layers.plate.dur = clamp01(st.layers.plate.dur);
    }
    if (st.layers.mail) {
      st.layers.mail.dur -= j * (ch === 'pierce' ? COMBAT.mailRingBurstPerPierce : COMBAT.mailRingBurstPerCut) * 3.2;
      st.layers.mail.dur = clamp01(st.layers.mail.dur);
    }
    if (st.layers.gambeson) {
      st.layers.gambeson.dur -= j * (ch === 'cut' ? COMBAT.gambesonTearPerCut : COMBAT.softTearPerPierce) * 3.2;
      st.layers.gambeson.dur = clamp01(st.layers.gambeson.dur);
    }
    if (st.layers.leather) {
      st.layers.leather.dur -= j * COMBAT.softTearPerPierce * 2.4;
      st.layers.leather.dur = clamp01(st.layers.leather.dur);
    }
  }

  /**
   * Apply a resolved strike.
   * @returns {{applied, absorbed, lethal, label, region, layersBroken:string[]}}
   */
  apply(region, channels, joules, opts = {}) {
    const st = this.regions[region] || this.regions.chest;
    const gap = opts.gapMult ?? 1;      // <1 when the blade found a seam
    let total = 0, absorbed = 0;
    const broken = [];
    const out = {};
    for (const ch of ['cut', 'blunt', 'pierce']) {
      const raw = (channels[ch] || 0) * COMBAT.jouleToDamage[ch];
      if (raw <= 0.001) continue;
      let prot = this.protection(region, ch);
      if (gap < 1) prot *= gap;
      // a worn-through layer stops absorbing
      const eff = raw * (1 - prot);
      absorbed += raw - eff;
      total += eff;
      out[ch] = { raw, eff, prot };
    }
    this.wear(region, (channels.cut || 0) > (channels.blunt || 0) ? 'cut' : (channels.pierce > channels.blunt ? 'pierce' : 'blunt'), joules, 1);
    const before = Object.keys(st.layers).map((k) => [k, st.layers[k].dur]);
    // layer-break feedback
    for (const [k, was] of before) {
      if (was > 0.35 && st.layers[k].dur <= 0.35) broken.push(k);
    }

    st.hp = Math.max(0, st.hp - total);
    this.pain += total;
    if (total > 0) {
      if (region === 'head' || region === 'throat' || region === 'chest' || region === 'abdomen') {
        this.health = Math.max(0, this.health - total);
      } else {
        // limb hits bleed the whole body but slower; disabling hurts a lot
        this.health = Math.max(0, this.health - total * 0.35);
        if (st.hp <= 0 && !st.disabled) { st.disabled = true; this.health = Math.max(0, this.health - 22); }
      }
      const bleedBase = out.cut ? out.cut.eff : 0;
      st.bleeding += bleedBase * (opts.gapMult < 1 ? 1.5 : 1) * (region === 'throat' ? 2.2 : 1);
      this.bleed += bleedBase * (region === 'throat' ? 2.2 : region === 'chest' ? 1.1 : 0.6);
      st.bleeding = Math.min(st.bleeding, 16);
      this.bleed = Math.min(this.bleed, 26);
      this.lastRegion = region;
    }
    if (this.health <= 0) { this.alive = false; this.deathCause = region; }
    return { applied: total, absorbed, region, broken, breakdown: out, lethal: !this.alive };
  }

  /** Natural attrition: blood loss and disabled limbs. */
  tick(dt) {
    if (!this.alive) return;
    if (this.bleed > 0.02) {
      const loss = this.bleed * COMBAT.bleedPerSecond * dt;
      this.health = Math.max(0, this.health - loss);
      this.bleed *= Math.exp(-dt * 0.55);
    }
    this.pain *= Math.exp(-dt * 1.6);
    if (this.health <= 0) { this.alive = false; this.deathCause = 'bleeding'; }
  }

  guardsUp() { return this.regions.upperArm.disabled || this.regions.foreArm.disabled; }
  slows() { return (this.regions.thigh.disabled || this.regions.shin.disabled) ? 0.55 : 1; }
}

// ════════════════════════════════════════════════════════════════════════════
//  SWEEP — the actual strike resolution
// ════════════════════════════════════════════════════════════════════════════
/**
 * Sweep a weapon body's segments against a set of capsule volumes.
 * volumes: [{ region, a, b, r, owner }]
 * Returns the earliest contact or null.
 */
export function sweepBody(wb, volumes, dt, opts = {}) {
  const substeps = opts.substeps || COMBAT.weaponSwingSubsteps;
  const ignore = opts.ignore;
  let best = null;
  const A = TMP.a, B = TMP.b, C = TMP.c, D = TMP.d;
  for (let step = 1; step <= substeps; step++) {
    const t = step / substeps;
    for (let i = 0; i < wb.segs.length; i++) {
      const seg = wb.segs[i];
      if (ignore && ignore(seg)) continue;
      wb.segAt(i, t, A, B);
      for (const v of volumes) {
        if (v.owner && v.owner === wb.owner) continue;
        // cheap reject
        const mx = Math.max(A.x, B.x), mn = Math.min(A.x, B.x);
        if (v.a.x - v.r > mx && v.b.x - v.r > mx) continue;
        if (mn > v.a.x + v.r && mn > v.b.x + v.r) continue;
        const cd = Math.hypot((A.x + B.x) / 2 - (v.a.x + v.b.x) / 2, (A.y + B.y) / 2 - (v.a.y + v.b.y) / 2, (A.z + B.z) / 2 - (v.a.z + v.b.z) / 2);
        if (cd > 4.2) continue;
        segSeg(A, B, v.a, v.b, TMP.seg);
        const rr = seg.r + v.r;
        if (TMP.seg.d2 <= rr * rr) {
          const score = step * 1000 + i;   // earliest substep wins; then the hilt-most segment
          if (!best || score < best.score) {
            const contact = TMP.seg.c1.clone();
            best = {
              score, seg, segIndex: i, volume: v, contact, t,
              sAlong: TMP.seg.s, region: v.region, depth: Math.sqrt(TMP.seg.d2), overlap: rr - Math.sqrt(TMP.seg.d2),
            };
          }
        }
      }
    }
    if (best) break;
  }
  if (!best) return null;
  // express the contact in the weapon's own frame, then let the presentation
  // layer decide which face arrived and how fast
  const p = wb.group;
  p.updateWorldMatrix(true, false);
  TMP.m.copy(p.matrixWorld);
  const local = _v1.copy(best.contact).sub(_v2.setFromMatrixPosition(TMP.m))
    .applyQuaternion(_q1.setFromRotationMatrix(TMP.m).invert()).clone();
  best.localPoint = local;
  best.tVel = new THREE.Vector3();
  wb.pointVelocity(local, best.tVel);
  applyBladeContact(best, wb, dt, opts);
  return best;
}

/**
 * From a geometric contact, work out HOW the steel arrived: which face of the
 * blade, how fast, and therefore how much energy the man has to absorb.
 * Everything downstream — armour, wounds, reactions — is derived from this.
 * @param contact from sweepBody
 * @param opts { targetVel, massScale }
 */
export function applyBladeContact(contact, wb, dt, opts = {}) {
  const p = wb.group;
  const q = _q1.setFromRotationMatrix(p.matrixWorld);
  const localPoint = contact.localPoint;
  const vel = contact.tVel || _v2.copy(contact.vel || _v2.set(0, 0, 0));
  if (opts.targetVel) vel.sub(opts.targetVel);
  const vel2 = _v3.copy(vel);
  const speed = clamp(vel2.length(), 0, COMBAT.maxContactSpeed);
  const parts = p.userData.parts || {};
  const isShield = parts.kind === 'shield';
  const lv = vel2.applyQuaternion(_q2.copy(q).invert());
  // Which face of the steel arrived? The geometry's own frame answers it.
  // The man swinging knows what he threw: a wound-up thrust is a point coming
  // in, and the resolver is told so rather than guessing from two frames of
  // velocity (a thrust's own wrist-whip looks like an edge on any single frame).
  const c = classifyContact(p, localPoint, lv, wb.def, { kind: opts.kind });
  let strike = c.strike, sharpness = c.sharpness, surface = c.surface;
  if (isShield) { strike = 'bash'; sharpness = 0.02; surface = 'face'; }

  // effective mass of the blow at the contact point
  const dist = Math.max(0, localPoint.y - (parts.gripTop ?? -0.1));
  const frac = clamp01(dist / Math.max(0.2, wb.length));
  let mEff;
  // A thrust is not a swing: the mass behind the point is the man shoving his
  // whole frame down the blade, which is why a point beats mail that a cut fears.
  if (strike === 'thrust') mEff = (wb.def?.hands === 2 ? 3.5 : 2.8) * (opts.massScale || 1);
  else if (strike === 'bash') mEff = wb.mass * 0.55 * (opts.massScale || 1);
  else mEff = wb.mass * (0.12 + 0.28 * frac) * (opts.massScale || 1);
  // percussion point: hitting with the last hand-span of steel is weak
  const sweet = strike === 'thrust' || strike === 'bash' ? 1
    : 0.55 + 0.45 * Math.sin(clamp01((frac - 0.15) / 0.8) * Math.PI * 0.92);
  // No human blow exceeds ~200 J with a one-handed weapon; the clamp also
  // protects against a pose discontinuity being read as a real swing.
  const joules = Math.min(0.5 * mEff * speed * speed * sweet, 220);
  contact.surface = surface;
  contact.part = c.part;
  contact.strike = strike;
  contact.sharpness = sharpness;
  contact.speed = speed;
  contact.joules = joules;
  contact.frac = frac;
  contact.mEff = mEff;
  contact.lv = lv;
  return contact;
}

/** Blade-on-blade: does any part of A's steel meet any part of B's? */
export function sweepWeaponVsWeapon(a, b, dt, opts = {}) {
  const substeps = opts.substeps || 4;
  const slack = opts.slack ?? 0.05;    // steel is thin; a graze still rings
  const A0 = TMP.wa1, A1 = TMP.wa2, B0 = TMP.wb1, B1 = TMP.wb2;
  const fracOf = (wb, local) => {
    const parts = wb.group.userData.parts || {};
    const d = Math.max(0, local.y - (parts.gripTop ?? -0.1));
    return clamp01(d / Math.max(0.2, wb.length));
  };
  // Where along each weapon is the steel? The butt of a sword is not where it
  // fights: when several pieces of two weapons overlap on the same substep,
  // take the meeting that is furthest out along BOTH blades.
  let best = null;
  for (let step = 1; step <= substeps; step++) {
    const t = step / substeps;
    for (let i = 0; i < a.segs.length; i++) {
      a.segAt(i, t, A0, A1);
      for (let j = 0; j < b.segs.length; j++) {
        b.segAt(j, t, B0, B1);
        segSeg(A0, A1, B0, B1, TMP.seg);
        const rr = a.segs[i].r + b.segs[j].r + slack;
        if (TMP.seg.d2 > rr * rr) continue;
        const mid = TMP.seg.c1.clone().add(TMP.seg.c2).multiplyScalar(0.5);
        const la = mid.clone().sub(a.pos).applyQuaternion(_q1.copy(a.quat).invert());
        const lb = mid.clone().sub(b.pos).applyQuaternion(_q2.copy(b.quat).invert());
        const fa = fracOf(a, la), fb = fracOf(b, lb);
        const overlap = rr - Math.sqrt(TMP.seg.d2);
        const score = step * 1e6 - (fa + fb) * 2e5 + (i + j) * 40 - overlap * 100;
        if (!best || score < best.score) {
          best = { score, point: mid, i, j, t, overlap, la, lb, fa, fb };
        }
      }
    }
    if (best) break;
  }
  if (!best) return null;
  const la = best.la, lb = best.lb;
  const va = a.pointVelocity(la, new THREE.Vector3());
  const vb = b.pointVelocity(lb, new THREE.Vector3());
  const rel = va.clone().sub(vb);
  const fa = best.fa, fb = best.fb;
  // The two blades cross; the common perpendicular is the direction the meeting
  // happens along, so the closing speed along it is what must be absorbed.
  const dirA = TMP.a.copy(a.world[best.i].b).sub(a.world[best.i].a).normalize();
  const dirB = TMP.b.copy(b.world[best.j].b).sub(b.world[best.j].a).normalize();
  const n = TMP.c.crossVectors(dirA, dirB);
  let closing;
  if (n.lengthSq() < 1e-6) {
    // parallel blades: the meeting is along the line between the two hilts
    n.copy(best.point).sub(a.pos).addScaledVector(TMP.d.copy(b.pos).sub(a.pos), -0.5).normalize();
    closing = Math.abs(rel.dot(n));
  } else {
    n.normalize();
    closing = Math.abs(rel.dot(n));
  }
  // How squarely the two blades meet: 1 is a clean cross, 0 is edge running
  // along edge. A parallel meeting does not stop a blow — it lets it slide.
  best.crossAxes = clamp01(1 - Math.abs(dirA.dot(dirB)));
  best.localA = la; best.localB = lb;
  best.velA = va; best.velB = vb;
  best.relVel = rel; best.relSpeed = rel.length();
  best.speedA = va.length(); best.speedB = vb.length();
  best.normal = n.clone();
  // Effective mass along the blade: a hilt-heavy sword at the grip moves the
  // man, not the metal; out at the last third it is all blade.
  const mEffA = a.mass * (0.22 + 0.55 * fa);
  const mEffB = b.mass * (0.22 + 0.55 * fb);
  const vClose = Math.min(closing, COMBAT.maxContactSpeed);
  best.energyA = 0.5 * mEffA * vClose * vClose;
  best.energyB = 0.5 * mEffB * vClose * vClose;
  best.mEffA = mEffA; best.mEffB = mEffB; best.closing = closing;
  best.fracA = fa; best.fracB = fb;
  return best;
}

/**
 * Turn a sweep contact into physical consequences on a BodyState.
 * @param hit result of sweepBody
 * @param body BodyState of the victim
 * @param opts { gapPoints, bodyMatrix, attackerName, part }
 */
export function resolveStrike(hit, body, opts = {}) {
  const { strike, joules, sharpness, speed } = hit;
  const def = opts.def || {};
  const phys = def.phys || { cut: 1, blunt: 0.3, pierce: 0.5 };
  const ch = { cut: 0, blunt: 0, pierce: 0 };
  if (strike === 'cut') {
    ch.cut = joules * phys.cut * (0.35 + 0.75 * sharpness);
    ch.blunt = joules * phys.blunt * 0.42;
    ch.pierce = joules * phys.pierce * 0.10;
  } else if (strike === 'thrust') {
    ch.pierce = joules * phys.pierce * (1.0 + 0.25 * (phys.penetration || 0)) * sharpness;
    ch.blunt = joules * phys.blunt * 0.30;
    ch.cut = joules * phys.cut * 0.14;
  } else if (strike === 'flat') {
    ch.blunt = joules * phys.blunt * (0.55 + 0.45 * (1 - sharpness));
    ch.cut = joules * phys.cut * 0.10 * sharpness;
    ch.pierce = joules * phys.pierce * 0.05;
  } else if (strike === 'bash') {
    // a shield in the face: all blunt, and it moves a man
    ch.blunt = joules * phys.blunt * 1.0;
    ch.cut = joules * phys.cut * 0.22;
    ch.pierce = joules * phys.pierce * 0.12;
  } else {
    // a blow with the haft, shaft or pommel: mostly a shove
    ch.blunt = joules * phys.blunt * 0.20;
    ch.cut = joules * phys.cut * 0.04;
  }

  // ── weak points: did the steel meet a seam? ────────────────────────────────
  let gapMult = 1, gapLabel = null;
  if (opts.gapPoints && opts.gapWorld) {
    for (let gi = 0; gi < opts.gapPoints.length; gi++) {
      const gp = opts.gapPoints[gi];
      if (gp.region !== hit.region && strike !== 'thrust') continue;
      const w = opts.gapWorld[gp.i ?? gi] || opts.gapWorld[gi];
      if (!w) continue;
      const d = w.distanceTo(hit.contact);
      const reach = gp.r * (strike === 'thrust' ? 1.35 : 1.0);
      if (d < reach) {
        const closeness = 1 - d / reach;
        const m = lerp(1, 0.18, clamp01(closeness * (strike === 'thrust' ? 1.25 : 0.9)));
        if (m < gapMult) { gapMult = m; gapLabel = gp.label; }
      }
    }
  }

  const res = body.apply(hit.region, ch, joules, { gapMult });
  res.gap = gapLabel;
  res.gapMult = gapMult;
  res.strike = strike;
  res.sharpness = sharpness;
  res.joules = joules;
  res.speed = speed;
  res.contact = hit.contact;

  // ── reaction intensity ────────────────────────────────────────────────────
  const imp = res.applied + res.absorbed * 0.25;
  let reaction = 'light';
  if (imp >= COMBAT.heavyJoules) reaction = 'heavy';
  else if (imp >= COMBAT.staggerJoules) reaction = 'medium';
  if (res.gap) reaction = reaction === 'light' ? 'medium' : 'heavy';
  if (hit.region === 'head' && imp > 18) reaction = 'heavy';
  res.reaction = reaction;
  res.label = buildLabel(res, hit, def);
  return res;
}

function buildLabel(res, hit, def) {
  const b = res.breakdown || {};
  const prot = b.cut?.prot ?? b.blunt?.prot ?? b.pierce?.prot ?? 0;
  const region = hit.region.replace(/([A-Z])/g, ' $1').toUpperCase();
  if (res.gap) return `SEAM FOUND — ${res.gap.toUpperCase()}`;
  if (res.strike === 'bash') return `SHIELD BASH — ${region}`;
  if (res.strike === 'flat') return `FLAT OF THE BLADE — ${region}`;
  if (res.strike === 'haft') return `SHAFT SHOVE — ${region}`;
  if (res.strike === 'thrust') return prot > 0.7 ? `THRUST TURNS ON ARMOUR — ${region}` : `PUNCTURE — ${region}`;
  if (res.strike === 'cut') {
    if (prot > 0.78) return `STEEL RINGS OFF — ${region}`;
    if (prot > 0.45) return `MAIL BITES BACK — ${region}`;
    return `EDGE BITES — ${region}`;
  }
  return `${res.strike.toUpperCase()} — ${region}`;
}

// simple helper for the volume arrays used by sweepBody
export function capsule(region, a, b, r, owner) {
  return { region, a, b, r, owner, kind: 'capsule' };
}
export { _v2, _v3 };
