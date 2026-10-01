// ── IRONVOW — reading the blow before it lands ───────────────────────────────
// A guard is not a wall. To stop a cut you must put steel where the cut is
// going — so this module asks the only question that matters: "where will his
// edge meet my body?" and solves for the fist that lays your blade across it.
//
// The prediction is rotational, not linear. A blade does not travel in a
// straight line: it swings, and a straight-line extrapolation a tenth of a
// second ahead throws the guard metres past the man. We take the weapon's
// transform delta from the last frame, step it forward by the horizon, and read
// the steel back out of the predicted frame.
//
// The main resolver still decides whether you actually intercepted — which is
// why a feint works, and why a late guard does not.
import * as THREE from 'three';
import { clamp, clamp01, lerp, segSeg, makeSegOut, _v1, _v2, _v3, _q1, _q2 } from './mathx.js';

const TMP = {
  pos: new THREE.Vector3(), q: new THREE.Quaternion(), dq: new THREE.Quaternion(),
  p: new THREE.Vector3(), b2: new THREE.Vector3(), q2: new THREE.Quaternion(),
  a0: new THREE.Vector3(), a1: new THREE.Vector3(), a2: new THREE.Vector3(), a3: new THREE.Vector3(),
  best: new THREE.Vector3(), local: new THREE.Vector3(), vel: new THREE.Vector3(),
  across: new THREE.Vector3(), up: new THREE.Vector3(), fwd: new THREE.Vector3(),
  right: new THREE.Vector3(), axis: new THREE.Vector3(),
};
const SEG = makeSegOut();

/** Pull a point toward an origin until it is within `len` of it. */
function clampReach(p, origin, len) {
  const d = TMP.p.copy(p).sub(origin);
  const l = d.length();
  if (l > len) p.copy(origin).addScaledVector(d.multiplyScalar(1 / l), len);
  return p;
}

/** Where a weapon's transform will be `ratio` frames ahead, at its own rate. */
function predictedFrame(wb, ratio, outPos, outQuat) {
  outPos.copy(wb.pos).addScaledVector(_v1.copy(wb.pos).sub(wb.prevPos), ratio);
  TMP.dq.copy(wb.quat).multiply(_q1.copy(wb.prevQuat).invert());
  TMP.q2.identity().slerp(TMP.dq, ratio);     // the per-frame rotation, stepped forward
  outQuat.copy(TMP.q2).multiply(wb.quat);
  return outPos;
}

/**
 * Where an incoming weapon is about to arrive on this body, and how imminent it
 * is. Returns null when nothing threatens.
 * @param horizon seconds to look ahead — 0.05 is a parry, not a premonition
 */
export function threatPoint(defenderRig, wb, horizon, opts = {}) {
  if (!wb || !wb._primed || !wb.segs.length) return null;
  const dtW = Math.max(1e-3, wb._dt || 1 / 60);
  // One frame of read-ahead at most. A blade mid-swing sweeps metres per frame,
  // so a tenth of a second of linear extrapolation puts the guard in the wrong
  // county — worse than standing still.
  // The step is ROTATIONAL (the frame turns, the steel follows the arc), so a
  // few frames of look-ahead is safe where a straight-line extrapolation was
  // not: three or four frames is the difference between a guard that is there
  // and a guard that arrives just after the edge does.
  const ratio = clamp(horizon / dtW, 0, opts.predict ?? 4);
  predictedFrame(wb, ratio, TMP.pos, TMP.q);
  const vols = defenderRig.volumes && defenderRig.volumes.length ? defenderRig.volumes : null;
  let bestScore = Infinity, bestSeg = -1, bestLocal = null;
  for (let i = 0; i < wb.segs.length; i++) {
    const s = wb.segs[i];
    TMP.a0.copy(s.a).applyQuaternion(TMP.q).add(TMP.pos);
    TMP.a1.copy(s.b).applyQuaternion(TMP.q).add(TMP.pos);
    if (vols) {
      for (const v of vols) {
        segSeg(TMP.a0, TMP.a1, v.a, v.b, SEG);
        const d = Math.sqrt(SEG.d2) - s.r - v.r;
        const vital = v.region === 'head' || v.region === 'throat' || v.region === 'chest';
        const score = vital ? d : d + 0.16;
        if (score < bestScore) {
          bestScore = score;
          bestSeg = i;
          TMP.best.copy(SEG.c1);
        }
      }
    }
  }
  if (bestSeg < 0) {
    // no body volumes to test against: fall back to "closest to my chest"
    defenderRig.root.updateWorldMatrix(true, false);
    TMP.axis.setFromMatrixPosition(defenderRig.bones.chest.matrixWorld);
    for (let i = 0; i < wb.segs.length; i++) {
      const s = wb.segs[i];
      TMP.a0.copy(s.a).applyQuaternion(TMP.q).add(TMP.pos);
      TMP.a1.copy(s.b).applyQuaternion(TMP.q).add(TMP.pos);
      segSeg(TMP.a0, TMP.a1, TMP.axis, TMP.axis, SEG);
      const d = Math.sqrt(SEG.d2) - s.r;
      if (d < bestScore) { bestScore = d; bestSeg = i; TMP.best.copy(SEG.c1); }
    }
  }
  if (bestSeg < 0 || bestScore > (opts.maxRange ?? 1.35)) return null;
  if (opts.facing) {
    // a point of steel that is already behind us is not a threat, it is a miss
    defenderRig.root.updateWorldMatrix(true, false);
    TMP.right.setFromMatrixPosition(defenderRig.bones.chest.matrixWorld);
    TMP.fwd.set(0, 0, 1).applyQuaternion(defenderRig.root.getWorldQuaternion(_q2));
    // Only a point that has clearly gone BEHIND us is a miss: a point inside
    // the chest — which is where an arriving thrust puts it — is very much a
    // threat, and the first version of this line threw those away.
    if (TMP.best.clone().sub(TMP.right).dot(TMP.fwd) < -0.2) return null;
  }
  const threat = new THREE.Vector3().copy(TMP.best);
  threat.quality = clamp01(1 - Math.max(0, bestScore) / 0.9);
  threat.distance = bestScore;
  threat.seg = bestSeg;
  return threat;
}

/**
 * Solve a guard: WHERE the steel must point, and what it is pointing at.
 *
 * Three rewrites taught this lesson the hard way. Solving the FIST is the trap:
 * reach for the blow and the hand ends up somewhere no fighter would put it
 * (out past his own knee, or across his own throat), and the blade ends up
 * fighting the arm's geometry instead of the enemy. So the division of labour is
 * now clean:
 *
 *   • the POSE owns the fist — the authored guard positions are reachable and
 *     readable, and a fighter's hand goes where his stance puts it;
 *   • this solver owns only the DIRECTION — point the steel at the incoming
 *     steel, and let the crossing angle fall out of where the two men stand.
 *
 * A point aimed at a line will always find that line, so the blades meet; a
 * guard whose steel is aimed somewhere the blow is not, will not. That is the
 * whole mechanic, and it is the same one a man uses when he fences.
 *
 * @returns out {bladeDir, edgeDir, threat, fist, quality, cross, noThreat, noFist}
 */
export function solveGuard(rig, side, attackerWb, horizon, opts = {}, out = {}) {
  out.bladeDir = out.bladeDir || new THREE.Vector3();
  out.edgeDir = out.edgeDir || new THREE.Vector3();
  out.threat = out.threat || new THREE.Vector3();
  out.fist = out.fist || new THREE.Vector3();
  out.quality = 0;
  out.cross = 0;
  rig.root.updateWorldMatrix(true, false);
  const qRoot = rig.root.getWorldQuaternion(_q2);
  TMP.fwd.set(0, 0, 1).applyQuaternion(qRoot).normalize();
  TMP.up.set(0, 1, 0).applyQuaternion(qRoot).normalize();
  const shoulder = TMP.pos.setFromMatrixPosition(rig.bones['arm' + side].matrixWorld);
  const chest = TMP.best.setFromMatrixPosition(rig.bones.chest.matrixWorld);
  const armLen = rig.dims.upperArmL + rig.dims.foreArmL;
  const threat = threatPoint(rig, attackerWb, horizon, { ...opts, maxRange: opts.maxRange ?? 1.7 });

  if (!threat) {
    // Nothing incoming: steel carried up in front of the face, point at the man
    // — the position a fighter waits in, because it stops the blow he has not
    // seen yet. (The caller's pose already holds the fist here.)
    out.bladeDir.copy(TMP.fwd).setY(TMP.fwd.y + 0.5).normalize();
    out.edgeDir.crossVectors(TMP.fwd, TMP.up).setY(-0.2).normalize();
    out.threat.copy(chest).addScaledVector(TMP.fwd, 0.6);
    out.noThreat = true;
    out.noFist = true;
    return out;
  }

  // A guard goes where the man THINKS the blow is going. The read error is
  // fixed when he raises his hands, not re-rolled every frame: a fighter does
  // not wobble, he commits to a mistake and lives inside it.
  if (opts.misread) {
    threat.x += opts.misread.x; threat.y += opts.misread.y; threat.z += opts.misread.z;
  }

  // ── the fist belongs to the pose ──────────────────────────────────────────
  // the caller passes the fist its pose (or its shield) is holding, in world space
  const fist = out.fist;
  if (opts.fist) fist.copy(opts.fist);
  else fist.copy(chest).addScaledVector(TMP.fwd, 0.34);
  const clear = (fist.x - chest.x) * TMP.fwd.x + (fist.y - chest.y) * TMP.fwd.y + (fist.z - chest.z) * TMP.fwd.z;
  if (clear < 0.10) fist.addScaledVector(TMP.fwd, 0.10 - clear);
  clampReach(fist, shoulder, armLen - 0.02);

  // The attacker's own blade axis, in the world: a thrust comes down its axis,
  // a cut crosses it. The difference decides how steel must be laid on it.
  const segW = attackerWb.world[threat.seg];
  const aDir = TMP.axis.set(0, 0, 0);
  if (segW) aDir.copy(segW.b).sub(segW.a).normalize();
  // how the incoming steel is travelling at the threat point
  TMP.local.copy(threat).sub(attackerWb.pos).applyQuaternion(_q1.copy(attackerWb.quat).invert());
  attackerWb.pointVelocity(TMP.local, TMP.vel);
  const travel = TMP.vel;
  if (travel.lengthSq() < 1e-5) travel.copy(out.bladeDir).negate();
  // Is this a point coming at me, or an edge being carried through? The man
  // behind the guard can SEE which — a thrust is wound up straight — and a
  // first-person game is played with a pair of eyes, so the director tells the
  // guard what kind of blow is in the air instead of making it guess from the
  // last two frames of velocity.
  const pointing = opts.kind === 'thrust' || opts.pointWeapon === true;

  if (pointing && aDir.lengthSq() > 0.5) {
    // A THRUST runs down its own axis, so a guard aimed at it would meet it
    // edge-to-edge, blade against blade: a fence with nothing between the
    // posts. Steel has to lie ACROSS it — perpendicular to his axis, with the
    // point of contact a third of the way up ours — and that fixes the fist,
    // because a cross has to be built from both ends.
    const base = opts.aim || TMP.fwd;
    out.bladeDir.copy(base).addScaledVector(aDir, -base.dot(aDir));
    if (out.bladeDir.lengthSq() < 4e-3) out.bladeDir.crossVectors(aDir, TMP.up);
    if (out.bladeDir.lengthSq() < 4e-3) out.bladeDir.crossVectors(aDir, TMP.right);
    out.bladeDir.normalize();
    // put the steel in the way, not the man: the hilt goes to whichever side
    // leaves the fist nearest the stance that raised it
    const grip = clamp(Math.min(opts.reach ?? 0.9, 1.05) * 0.34, 0.2, 0.42);
    const straight = TMP.p.copy(threat).addScaledVector(out.bladeDir, -grip);
    const crossed = TMP.b2.copy(threat).addScaledVector(out.bladeDir, grip);
    const test = TMP.a1.copy(fist);
    fist.copy(test.distanceTo(straight) <= test.distanceTo(crossed) ? straight : crossed);
    const clear2 = (fist.x - chest.x) * TMP.fwd.x + (fist.y - chest.y) * TMP.fwd.y + (fist.z - chest.z) * TMP.fwd.z;
    if (clear2 < 0.12) fist.addScaledVector(TMP.fwd, 0.12 - clear2);
    clampReach(fist, shoulder, armLen - 0.02);
    // The arm may not have reached where the cross wanted to be. Re-aim from
    // where the fist ACTUALLY ended up, or the blade sails past the thrust by
    // exactly the distance the shoulder held it back by.
    TMP.a2.copy(threat).sub(fist);
    TMP.a2.addScaledVector(aDir, -TMP.a2.dot(aDir));
    if (TMP.a2.lengthSq() > 4e-3) out.bladeDir.copy(TMP.a2).normalize();
    out.edgeDir.copy(travel).addScaledVector(out.bladeDir, -travel.dot(out.bladeDir));
    if (out.edgeDir.lengthSq() < 1e-5) out.edgeDir.crossVectors(out.bladeDir, TMP.up);
    out.edgeDir.normalize();
    out.cross = clamp01(1 - Math.abs(aDir.dot(out.bladeDir)));
    out.threat.copy(threat);
    out.distance = threat.distance;
    out.noThreat = false;
    out.noFist = false;              // the caller must take this fist
    out.quality = clamp01((threat.quality || 0) * (0.4 + 0.6 * out.cross));
    return out;
  }

  // A locked guard keeps the line it chose and only slides its fist along it.
  // The latched direction wins over the pose and over the new threat: that is
  // what a commitment IS, and it is why a feint or an off-line cut beats a parry
  // that was set a breath too early.
  if (opts.locked && opts.locked.dir) {
    const lock = TMP.across.copy(opts.locked.dir);
    if (lock.lengthSq() < 1e-4) lock.copy(TMP.fwd);
    out.bladeDir.copy(lock).normalize();
    const grip = clamp(Math.min(opts.reach ?? 0.9, 1.1) * 0.42, 0.2, 0.5);
    const want = TMP.a2.copy(threat).addScaledVector(out.bladeDir, -grip);
    fist.copy(want);
    clampReach(fist, shoulder, armLen - 0.02);
    TMP.a3.copy(threat).sub(fist);
    if (TMP.a3.lengthSq() > 4e-3) out.bladeDir.copy(TMP.a3).normalize();
    out.edgeDir.copy(travel).addScaledVector(out.bladeDir, -travel.dot(out.bladeDir));
    if (out.edgeDir.lengthSq() < 1e-5) out.edgeDir.crossVectors(out.bladeDir, TMP.up);
    out.edgeDir.normalize();
    if (aDir.lengthSq() > 1e-6) out.cross = clamp01(1 - Math.abs(aDir.dot(out.bladeDir)));
    out.threat.copy(threat);
    out.distance = threat.distance;
    out.noThreat = false;
    out.noFist = false;
    out.quality = clamp01((threat.quality || 0) * (0.4 + 0.6 * out.cross));
    return out;
  }

  // ── a cut: the stance owns the fist, the solver owns the direction ────────
  const toThreat = TMP.across.copy(threat).sub(fist);
  if (toThreat.lengthSq() < 1e-4) toThreat.copy(TMP.fwd);
  toThreat.normalize();
  // A guard is a stance with a correction, not a reflex: the pose's own aim
  // anchors it, the incoming steel pulls it, and it turns at a rate a wrist can
  // actually manage. Snapping the point about is how the previous version
  // managed to miss a blow it was looking straight at.
  if (opts.aim) toThreat.addScaledVector(opts.aim, 0.42).normalize();
  if (opts.prev) {
    const maxTurn = (opts.maxTurn ?? 7) * Math.max(1 / 240, opts.dt ?? 1 / 60);
    const dot = clamp(opts.prev.dot(toThreat), -1, 1);
    const ang = Math.acos(dot);
    if (ang > maxTurn) {
      TMP.vel.copy(toThreat).addScaledVector(opts.prev, -dot).normalize();   // perpendicular
      toThreat.copy(opts.prev).addScaledVector(TMP.vel, Math.tan(Math.min(maxTurn, ang))).normalize();
    }
  }
  out.bladeDir.copy(toThreat);

  // the edge leads into the blow
  out.edgeDir.copy(travel).addScaledVector(out.bladeDir, -travel.dot(out.bladeDir));
  if (out.edgeDir.lengthSq() < 1e-5) out.edgeDir.crossVectors(out.bladeDir, TMP.up);
  out.edgeDir.normalize();

  // the crossing angle between our steel and his: 1 is a clean cross, 0 is
  // blade-on-blade flat, which no guard should ever be
  if (aDir.lengthSq() > 1e-6) out.cross = clamp01(1 - Math.abs(aDir.dot(out.bladeDir)));
  out.threat.copy(threat);
  out.distance = threat.distance;
  out.noThreat = false;
  out.noFist = true;
  out.quality = clamp01((threat.quality || 0) * (0.35 + 0.65 * out.cross));
  return out;
}

/** Which side of a defender an attacker stands on, for hurt reactions. */
export function incomingSide(attackerPos, defenderRig) {
  const q = defenderRig.root.getWorldQuaternion(new THREE.Quaternion());
  const fwd = _v1.set(0, 0, 1).applyQuaternion(q);
  const right = _v2.set(1, 0, 0).applyQuaternion(q);
  const to = _v3.copy(attackerPos).sub(_v1.setFromMatrixPosition(defenderRig.bones.chest.matrixWorld));
  to.y = 0;
  const fx = to.dot(fwd), rx = to.dot(right);
  if (Math.abs(rx) > Math.abs(fx)) return rx > 0 ? 'right' : 'left';
  return fx > 0 ? 'front' : 'back';
}
