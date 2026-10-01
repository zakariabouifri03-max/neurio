// ── IRONVOW — the argument: what happens when two armed men are close ────────
// One place decides the order of questions, every frame, for every pair:
//
//   1. STEEL MEETS STEEL  a blade in the way stops a blow. Whether it holds,
//                         turns it aside (a timed parry) or is beaten down
//                         (a guard break) follows from the energy that crossed
//                         and the strength of the man holding the guard.
//   2. STEEL MEETS FLESH  whatever got through finds a body, and the wound
//                         resolver asks which region, under which layers.
//   3. THE BODY ANSWERS   stagger, blood, wind, footing, death.
//
// The game loop and the headless harness both call resolveExchange(), so the
// numbers the tests check are the numbers the player feels.
import * as THREE from 'three';
import { sweepBody, sweepWeaponVsWeapon, applyBladeContact, resolveStrike } from './combat.js';
import { COMBAT } from './tuning.js';
import { clamp, clamp01 } from './mathx.js';
import { threatPoint } from './defense.js';

const TMP = {
  v: new THREE.Vector3(), p: new THREE.Vector3(), a: new THREE.Vector3(),
  b: new THREE.Vector3(), dir: new THREE.Vector3(),
};

/**
 * How much punishment this guard can take before the arms give way.
 * Bigger is stronger; the number is read against the energy of the blow.
 */
function guardStrength(D, weapon, clash) {
  // The scale is set so that a fresh man holding a square guard stops a full
  // one-handed cut (about 130 J) and does NOT stop a poleaxe, and so that a man
  // whose wind has gone cannot hold a longsword off at all. Those three numbers
  // are the whole of the defensive game.
  let s = 1.6;
  if (weapon === D.sb) s += 0.95 + (D.shieldDef.coverage || 0) * 0.5;
  if (D.weaponDef.hands === 2) s += 0.4;
  if (D.blocking) s += D.parryT > 0 ? 1.0 : 0.5;
  if (clash.speedB > 3) s += 0.25;                 // a moving blade beats a static one
  const wind = D.stamina / Math.max(1, D.maxStamina);
  if (wind < 0.45) s -= 0.3;                       // wind going: the arms sag
  if (wind < 0.25) s -= 0.45;                      // nearly spent: the guard is an opinion
  if (D.exhausted) s -= 0.35;
  if (D.guardBroken > 0) s -= 1.0;
  if (D.bodyState.guardsUp()) s -= 0.25;           // broken arms do not hold a line
  return Math.max(0.28, s);
}

/** Which side of a man a blow came from. */
function hurtDirFor(victim, from) {
  const dx = from.x - victim.pos.x, dz = from.z - victim.pos.z;
  const want = Math.atan2(dx, dz);
  const rel = ((want - victim.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  if (Math.abs(rel) < 0.7) return 'front';
  return rel > 0 ? 'right' : 'left';
}

export function resolveExchange(a, b, dt, out = []) {
  out.length = 0;
  steel(a, b, dt, out);
  steel(b, a, dt, out);
  flesh(a, b, dt, out);
  flesh(b, a, dt, out);
  return out;
}

/**
 * One man's blow against the other man's steel.
 * A guard only buys anything while it is held: a blade hanging where the blow
 * happens to pass still stops it (that is a lucky parry), but it stops it as a
 * static thing and takes the whole blow.
 */
function steel(A, D, dt, out) {
  if (!A.attacking || A.strikeLanded || A.state === 'bind' || !D.alive) return;
  for (const W of D.planes()) {
    if (!W || W === A.wb) continue;
    // A guard that is UP is aimed steel, hilt and gauntlet all in the way: it
    // catches what a blade lying in the grass would miss. The tolerance is the
    // model's way of saying so, and it is the difference between a fight and a
    // lottery. (A man not guarding has only his blade, and steel is thin.)
    const clash = sweepWeaponVsWeapon(A.wb, W, dt, { substeps: 4, slack: D.blocking ? 0.06 : 0.025 });
    if (!clash) continue;
    // Brushing steel is not a parry: something must actually be moving.
    if (clash.closing < 0.9 && clash.relSpeed < 1.4) continue;
    // Steel laid ACROSS the blow stops it; steel lying ALONG the blow only turns
    // it. This is the whole reason a guard has a side and a blow has a line: the
    // man who guesses right stops it dead, and the man who guesses wrong eats a
    // deflected edge at half weight.
    const cross = clash.crossAxes ?? 1;
    if (cross < COMBAT.crossMin) {
      const through = 0.5 + 0.5 * (cross / COMBAT.crossMin);
      A.passThrough = Math.max(A.passThrough, through);
      A.passThroughT = 0.09;
      A.stamina = clamp(A.stamina - COMBAT.grazeStamina, 0, A.maxStamina);
      D.stamina = clamp(D.stamina - COMBAT.grazeStamina * 0.6, 0, D.maxStamina);
      A.staminaDelay = D.staminaDelay = 0.2;
      out.push({
        type: 'graze', attacker: A, victim: D, point: clash.point.clone(), shield: W === D.sb,
        energy: clash.energyA, cross, speedA: clash.speedA, fracA: clash.fracA,
        spark: clamp01(clash.closing / 12),
      });
      continue;             // his steel slid — look for something that really stops it
    }
    applyClash(A, D, W, clash, out, cross);
    return;
  }
}

function applyClash(A, D, W, clash, out, cross = 1) {
  const shield = W === D.sb;
  // a shallow crossing folds a guard much sooner than a square one
  const strength = guardStrength(D, W, clash) * (0.5 + 0.5 * cross);
  // the energy that has to go somewhere. Some is turned aside by the guard,
  // the rest is felt by the man holding it.
  const blunt = clash.energyA;
  const absorbed = blunt / strength;
  const broken = absorbed > COMBAT.guardBreakJoules;
  const parry = D.blocking && D.parryT > 0 && !broken;

  A.strikeLanded = true;
  A.freezePose(0.06 + clamp01(absorbed / 120) * 0.16);
  A.stamina = clamp(A.stamina - COMBAT.clashStamina * (0.35 + clash.speedA / 40), 0, A.maxStamina);
  A.staminaDelay = 0.35;
  // a shield is not free either, but it spreads the blow over an arm and a
  // board instead of asking a wrist to stop it: much less wind for the same stop
  const shieldEase = shield ? clamp(1 - (D.shieldDef.coverage || 0.2) * 0.55, 0.35, 1) : 1;
  D.stamina = clamp(D.stamina - COMBAT.clashStamina * (0.3 + absorbed / 140) * shieldEase, 0, D.maxStamina);
  D.staminaDelay = 0.3;
  if (parry) D.parryT = 0;                 // the parry is spent; it did its work

  // both men are jarred: the shove runs down the blades
  TMP.dir.copy(clash.point).sub(D.pos).setY(0);
  if (TMP.dir.lengthSq() < 1e-6) TMP.dir.set(0, 0, -1);
  TMP.dir.normalize();
  const shove = clamp(absorbed * 0.045, 0.15, 3.0);
  D.push(TMP.dir, shove * (shield ? 0.7 : 1));
  A.push(TMP.dir, -shove * 0.35);
  A.hitFlash = Math.max(A.hitFlash, 0.06);
  D.hitFlash = Math.max(D.hitFlash, 0.1);

  if (broken) {
    // the arms are beaten open: the blow carries on into the man at a discount
    D.guardBroken = COMBAT.guardBreakStun * 0.6;
    D.state = 'stagger';
    D.stateT = 0;
    D.staggerT = COMBAT.guardBreakStun * 0.55;
    D.hurtDir = hurtDirFor(D, A.pos);
    D.say('guardBreak');
    A.passThrough = shield ? 0.36 : 0.55;
    A.passThroughT = 0.22;
    out.push({
      type: 'guardBreak', attacker: A, victim: D, point: clash.point.clone(),
      energy: blunt, absorbed, strength, speedA: clash.speedA, fracA: clash.fracA,
      shield, spark: clamp01(clash.closing / 10),
    });
    return;
  }

  const bind = clamp(0.07 + absorbed / 900, 0.07, 0.24);
  A.bind(bind * (parry ? 1.7 : 1));
  if (!shield) D.bind(bind * 0.65);
  out.push({
    type: parry ? 'parry' : 'clash',
    attacker: A, victim: D, point: clash.point.clone(),
    energy: blunt, absorbed, strength, relSpeed: clash.relSpeed, closing: clash.closing,
    speedA: clash.speedA, fracA: clash.fracA, fracB: clash.fracB, shield,
    spark: clamp01(clash.closing / 10),
  });
}

/** Steel against flesh. */
function flesh(A, D, dt, out) {
  if (!A.attacking || !D.alive || (A.strikeLanded && A.passThroughT <= 0)) return;
  const massScale = A.passThroughT > 0 ? (A.passThrough || 1) : 1;
  const hit = sweepBody(A.wb, D.volumes, dt, { massScale, kind: A.move?.kind, charge: A.charge });
  if (!hit) return;
  applyBladeContact(hit, A.wb, dt, { targetVel: TMP.v.copy(D.vel), massScale, kind: A.move?.kind });
  A.strikeLanded = true;
  A.passThroughT = 0; A.passThrough = 0;
  if (hit.joules < COMBAT.minImpulse) {
    out.push({ type: 'touch', attacker: A, victim: D, point: hit.contact.clone(), strike: hit.strike, joules: hit.joules });
    return;
  }
  const res = resolveStrike(hit, D.bodyState, {
    def: A.weaponDef,
    gapPoints: D.rig.body.gaps,
    gapWorld: D.rig.gapWorld(),
  });
  const dir = hurtDirFor(D, A.pos);
  A.onHitLanded(res);
  D.takeHit(res, dir);

  TMP.p.copy(hit.contact).sub(D.rig.bones.chest.getWorldPosition(TMP.b)).setY(0);
  if (TMP.p.lengthSq() < 1e-6) TMP.p.set(0, 0, -1);
  TMP.p.normalize();
  const react = res.reaction === 'heavy' ? 1 : res.reaction === 'medium' ? 0.62 : 0.3;
  D.push(TMP.p, clamp(res.joules * COMBAT.knockback * react, 0, 3.4));
  A.push(TMP.p, -clamp(res.joules * COMBAT.knockback * react * 0.22, 0, 0.8));
  out.push({
    type: 'hit', attacker: A, victim: D, res,
    point: hit.contact.clone(), strike: res.strike, region: hit.region,
    surface: hit.surface, lv: hit.lv ? hit.lv.clone() : null, speed: hit.speed,
    reaction: res.reaction, joules: res.joules, applied: res.applied,
    gap: res.gap, label: res.label, dir,
    hitStop: clamp(res.applied * COMBAT.hitStopBase * 0.06, 0, COMBAT.hitStopMax),
    blood: clamp01(res.applied / 22) * (res.strike === 'thrust' ? 0.75 : 1),
  });
  if (!D.alive) out.push({ type: 'death', attacker: A, victim: D, res });
}

/** Keep a pair from occupying the same ground, and let each read the other. */
export function bindPair(a, b) {
  a.guardWeapon = b.wb;
  b.guardWeapon = a.wb;
  // Where his steel will be in a moment: the shield arm and the guard both
  // need a target, and a man on the defensive has his eyes on the incoming
  // edge — that is the one thing the game lets you see for free.
  const ahead = (D, A) => {
    const tp = threatPoint(D.rig, A.wb, 0.07, { facing: true, maxRange: 2.0 });
    if (tp) { if (!D.guardShield) D.guardShield = new THREE.Vector3(); D.guardShield.copy(tp); }
    D.guardHorizon = 0.055;
  };
  ahead(a, b); ahead(b, a);
  // what kind of blow is in the air: a guard can see a thrust wound up
  a.opponentKind = b.attacking || b.state === 'windup' ? (b.move?.kind || 'cut') : null;
  b.opponentKind = a.attacking || a.state === 'windup' ? (a.move?.kind || 'cut') : null;
  a.separate(b);
  if (a.alive && b.alive) {
    const d = a.chestDistance(b);
    a.opponentRange = d;
    b.opponentRange = d;
  }
  return a.opponentRange;
}
