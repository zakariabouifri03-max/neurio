// ── IRONVOW — choreography ───────────────────────────────────────────────────
// Poses are authored in camera space: +X right, +Y up, -Z forward.
//
// A keyframe gives the fist position and where the blade points. The EDGE is not
// authored: it is derived from the motion of the blade's tip, because an edge
// that is not leading the cut is just a steel bar. The physics layer reads the
// finished pose back and asks "which face of the blade arrived?" — so a pose
// that sweeps the flat of the blade does a flat's worth of damage.
//
// Five keys per move: rest → wind (cocked) → mid (over the top) → hit (on the
// man) → through (past him). Reach is checked against a 0.57 m arm.
import * as THREE from 'three';
import { clamp01, lerp } from './mathx.js';

const V = (a, b, c) => new THREE.Vector3(a, b, c);
const smooth = (t) => t * t * (3 - 2 * t);
const easeOut = (t) => 1 - Math.pow(1 - t, 2.2);
const easeIn = (t) => Math.pow(t, 1.45);

/** Build the hand quaternion from blade direction (local +Y) and edge (local +Z). */
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
const _m = new THREE.Matrix4();
export function handFrame(blade, edge, out = new THREE.Quaternion()) {
  _y.copy(blade).normalize();
  _z.copy(edge).addScaledVector(_y, -edge.dot(_y));
  if (_z.lengthSq() < 1e-6) {
    // degenerate: pick any perpendicular, preferring "up"
    _z.set(0, 1, 0).addScaledVector(_y, -_y.y);
    if (_z.lengthSq() < 1e-6) _z.set(0, 0, 1).addScaledVector(_y, -_y.z);
  }
  _z.normalize();
  _x.crossVectors(_y, _z).normalize();
  _z.crossVectors(_x, _y).normalize();
  _m.makeBasis(_x, _y, _z);
  return out.setFromRotationMatrix(_m);
}

// ════════════════════════════════════════════════════════════════════════════
//  MOVE TEMPLATES
// ════════════════════════════════════════════════════════════════════════════
const M = {
  slashR: {
    name: 'Right Slash', dir: 'R', kind: 'cut',
    dur: { windup: 0.2, strike: 0.155, recover: 0.3 },
    rest: { hand: V(0.28, -0.28, -0.34), blade: V(0.30, 0.72, -0.62) },
    wind: { hand: V(0.38, 0.10, -0.02), blade: V(0.42, 0.60, 0.68) },
    mid: { hand: V(0.20, -0.08, -0.36), blade: V(0.02, 0.90, -0.44) },
    hit: { hand: V(0.16, -0.22, -0.52), blade: V(-0.12, -0.26, -0.96) },
    through: { hand: V(-0.12, -0.44, -0.40), blade: V(-0.48, -0.78, -0.40) },
  },
  slashL: {
    name: 'Left Slash', dir: 'L', kind: 'cut',
    dur: { windup: 0.21, strike: 0.185, recover: 0.31 },
    rest: { hand: V(0.28, -0.28, -0.34), blade: V(0.30, 0.72, -0.62) },
    wind: { hand: V(0.42, -0.10, 0.02), blade: V(0.46, 0.66, 0.60) },
    mid: { hand: V(0.24, -0.12, -0.32), blade: V(0.06, 0.90, -0.42) },
    hit: { hand: V(0.22, -0.20, -0.50), blade: V(-0.32, -0.20, -0.92) },
    through: { hand: V(0.02, -0.42, -0.36), blade: V(-0.66, -0.66, -0.36) },
  },
  overhead: {
    name: 'Overhead Cut', dir: 'U', kind: 'cut',
    dur: { windup: 0.24, strike: 0.155, recover: 0.34 },
    rest: { hand: V(0.28, -0.28, -0.34), blade: V(0.30, 0.72, -0.62) },
    wind: { hand: V(0.18, 0.26, 0.04), blade: V(0.24, 0.86, 0.45) },
    mid: { hand: V(0.16, 0.02, -0.30), blade: V(0.02, 0.92, -0.39) },
    hit: { hand: V(0.14, -0.20, -0.48), blade: V(-0.07, -0.30, -0.95) },
    through: { hand: V(0.12, -0.44, -0.40), blade: V(0.02, -0.94, -0.34) },
  },
  thrust: {
    name: 'Thrust', dir: 'D', kind: 'thrust', lunge: 3.2,
    dur: { windup: 0.19, strike: 0.125, recover: 0.3 },
    rest: { hand: V(0.28, -0.28, -0.34), blade: V(0.10, 0.26, -0.96) },
    wind: { hand: V(0.32, -0.22, -0.16), blade: V(0.16, 0.14, -0.98) },
    mid: { hand: V(0.26, -0.24, -0.36), blade: V(0.06, 0.04, -1.00) },
    hit: { hand: V(0.20, -0.26, -0.56), blade: V(-0.12, 0.02, -0.99) },
    through: { hand: V(0.18, -0.27, -0.58), blade: V(-0.14, 0.00, -0.99) },
  },
  rising: {
    name: 'Rising Cut', dir: 'D2', kind: 'cut',
    dur: { windup: 0.22, strike: 0.16, recover: 0.33 },
    rest: { hand: V(0.28, -0.28, -0.34), blade: V(0.30, 0.62, -0.72) },
    wind: { hand: V(0.30, -0.50, -0.16), blade: V(0.20, -0.72, -0.66) },
    mid: { hand: V(0.28, -0.34, -0.34), blade: V(0.14, 0.10, -0.99) },
    hit: { hand: V(0.22, -0.16, -0.54), blade: V(0.06, 0.62, -0.78) },
    through: { hand: V(0.08, 0.02, -0.42), blade: V(-0.12, 0.90, -0.42) },
  },
  sweep: {
    name: 'Haft Sweep', dir: 'R', kind: 'cut',
    dur: { windup: 0.26, strike: 0.175, recover: 0.4 },
    rest: { hand: V(0.30, -0.30, -0.30), blade: V(0.30, 0.84, -0.45) },
    wind: { hand: V(0.44, -0.18, 0.10), blade: V(0.55, 0.62, 0.56) },
    mid: { hand: V(0.32, -0.24, -0.22), blade: V(0.46, 0.74, -0.49) },
    hit: { hand: V(0.12, -0.28, -0.50), blade: V(-0.34, 0.06, -0.94) },
    through: { hand: V(-0.18, -0.34, -0.18), blade: V(-0.80, 0.12, -0.58) },
  },
  smash: {
    name: 'Crushing Blow', dir: 'U', kind: 'blunt',
    dur: { windup: 0.28, strike: 0.165, recover: 0.38 },
    rest: { hand: V(0.28, -0.32, -0.32), blade: V(0.34, 0.72, -0.60) },
    wind: { hand: V(0.20, 0.26, 0.08), blade: V(0.26, 0.88, 0.40) },
    mid: { hand: V(0.18, 0.04, -0.28), blade: V(0.02, 0.92, -0.39) },
    hit: { hand: V(0.14, -0.24, -0.56), blade: V(-0.06, -0.44, -0.90) },
    through: { hand: V(0.14, -0.46, -0.38), blade: V(0.02, -0.96, -0.28) },
  },
  hook: {
    name: 'Beaked Hook', dir: 'L', kind: 'cut',
    dur: { windup: 0.24, strike: 0.16, recover: 0.36 },
    rest: { hand: V(0.28, -0.32, -0.32), blade: V(0.34, 0.72, -0.60) },
    wind: { hand: V(0.48, -0.14, 0.06), blade: V(0.62, 0.50, 0.60) },
    mid: { hand: V(0.26, -0.16, -0.28), blade: V(0.06, 0.90, -0.42) },
    hit: { hand: V(0.12, -0.24, -0.52), blade: V(-0.34, -0.12, -0.93) },
    through: { hand: V(-0.16, -0.30, -0.20), blade: V(-0.86, 0.02, -0.51) },
  },
  jab: {
    name: 'Short Point', dir: 'D', kind: 'thrust', lunge: 2.2,
    dur: { windup: 0.17, strike: 0.115, recover: 0.26 },
    rest: { hand: V(0.28, -0.32, -0.32), blade: V(0.14, 0.28, -0.95) },
    wind: { hand: V(0.32, -0.26, -0.14), blade: V(0.20, 0.16, -0.97) },
    mid: { hand: V(0.26, -0.28, -0.34), blade: V(0.08, 0.06, -0.99) },
    hit: { hand: V(0.20, -0.28, -0.52), blade: V(-0.12, 0.02, -0.99) },
    through: { hand: V(0.18, -0.30, -0.56), blade: V(-0.14, 0.00, -0.99) },
  },
};

// ════════════════════════════════════════════════════════════════════════════
//  ARCHETYPE MOVESETS
// ════════════════════════════════════════════════════════════════════════════
const KEYNAMES = ['rest', 'wind', 'mid', 'hit', 'through'];
function variant(base, tweak = {}) {
  const out = { dur: {} };
  for (const k of KEYNAMES) {
    out[k] = {
      hand: base[k].hand.clone().multiplyScalar(tweak.reach ?? 1),
      blade: base[k].blade.clone().normalize(),
    };
    if (tweak.handShift) out[k].hand.add(tweak.handShift);
  }
  out.name = base.name;
  out.dir = tweak.dir ?? base.dir;
  out.kind = tweak.kind ?? base.kind;
  out.chaos = tweak.chaos ?? 0;
  out.lunge = (base.lunge ?? 0) * (tweak.lunge ?? 1);
  const sp = tweak.speed ?? 1;
  for (const k of ['windup', 'strike', 'recover']) out.dur[k] = base.dur[k] / sp;
  return out;
}

const SETS = {
  sword: {
    R: variant(M.slashR), L: variant(M.slashL), U: variant(M.overhead), D: variant(M.thrust), D2: variant(M.rising),
  },
  greatsword: {
    R: variant(M.slashR, { reach: 1.04, speed: 0.78 }), L: variant(M.slashL, { reach: 1.04, speed: 0.78 }),
    U: variant(M.overhead, { reach: 1.03, speed: 0.76 }), D: variant(M.thrust, { reach: 1.06, speed: 0.80 }),
    D2: variant(M.rising, { reach: 1.03, speed: 0.8 }),
  },
  mace: {
    R: variant(M.smash, { dir: 'R', speed: 0.92 }), L: variant(M.hook, { speed: 0.98 }),
    U: variant(M.smash, { speed: 0.90 }), D: variant(M.jab, { speed: 1.05 }), D2: variant(M.rising, { speed: 0.95 }),
  },
  polearm: {
    R: variant(M.sweep, { speed: 0.82 }), L: variant(M.hook, { reach: 1.06, speed: 0.84 }),
    U: variant(M.smash, { reach: 1.05, speed: 0.76 }), D: variant(M.thrust, { reach: 1.08, speed: 0.86 }),
    D2: variant(M.rising, { reach: 1.05, speed: 0.82 }),
  },
  spear: {
    R: variant(M.sweep, { speed: 0.86, reach: 1.05 }), L: variant(M.sweep, { dir: 'L', speed: 0.86, reach: 1.05 }),
    U: variant(M.thrust, { reach: 1.17, speed: 0.92 }), D: variant(M.thrust, { reach: 1.19, speed: 0.94 }),
    D2: variant(M.rising, { reach: 1.06, speed: 0.86 }),
  },
};

export function movesetFor(archetype) { return SETS[archetype] || SETS.sword; }

// ════════════════════════════════════════════════════════════════════════════
//  GUARDS — a stance is a position, not a wall
// ════════════════════════════════════════════════════════════════════════════
export const GUARDS = {
  // Every guard keeps the point between you and the man in front of you, aimed
  // ACROSS the body at his centre — that is what makes a blade meet a blade.
  center: { hand: V(0.26, -0.30, -0.34), blade: V(-0.13, 0.34, -0.93), edge: V(0.30, -0.3, -0.90) },
  high: { hand: V(0.20, -0.12, -0.36), blade: V(-0.10, 0.54, -0.83), edge: V(0.20, -0.4, -0.89) },
  left: { hand: V(0.38, -0.18, -0.30), blade: V(0.26, 0.38, -0.89), edge: V(-0.30, -0.2, -0.93) },
  right: { hand: V(0.08, -0.20, -0.34), blade: V(-0.48, 0.40, -0.78), edge: V(0.34, -0.2, -0.92) },
  low: { hand: V(0.20, -0.46, -0.30), blade: V(-0.09, -0.12, -0.99), edge: V(0.30, -0.5, -0.81) },
};

export const PARRY_POSE = {
  // A parry throws the point ACROSS the incoming line, never away from it.
  high: { hand: V(0.16, 0.02, -0.44), blade: V(-0.26, 0.60, -0.76), edge: V(0.5, -0.4, -0.77) },
  left: { hand: V(0.34, -0.14, -0.42), blade: V(0.08, 0.44, -0.89), edge: V(-0.6, -0.2, -0.77) },
  right: { hand: V(0.12, -0.16, -0.44), blade: V(-0.44, 0.42, -0.79), edge: V(0.6, -0.2, -0.77) },
  low: { hand: V(0.18, -0.46, -0.40), blade: V(-0.06, 0.06, -1.0), edge: V(0.5, -0.6, -0.62) },
};

// ════════════════════════════════════════════════════════════════════════════
//  SAMPLING
// ════════════════════════════════════════════════════════════════════════════
function poseAt(move, phase, t, out) {
  let a, b, k;
  if (phase === 'windup') { a = move.rest; b = move.wind; k = smooth(clamp01(t)); }
  else if (phase === 'strike') {
    // two segments so the blade goes over the top and then down onto the man
    if (t < 0.42) { a = move.wind; b = move.mid; k = easeIn(clamp01(t / 0.42)); }
    else { a = move.mid; b = move.hit; k = easeOut(clamp01((t - 0.42) / 0.58)); }
  } else if (phase === 'follow') { a = move.hit; b = move.through; k = easeOut(clamp01(t)); }
  else if (phase === 'recover') { a = move.through; b = move.rest; k = smooth(clamp01(t)); }
  else { a = move.rest; b = move.wind; k = 0; }
  out.hand.lerpVectors(a.hand, b.hand, k);
  out.blade.lerpVectors(a.blade, b.blade, k).normalize();
  return out;
}

export function emptyPose() {
  return { hand: new THREE.Vector3(), blade: new THREE.Vector3(), edge: new THREE.Vector3() };
}

const _h2 = new THREE.Vector3(), _b2 = new THREE.Vector3(), _p2 = { hand: _h2, blade: _b2 };

/**
 * Pose for a move at phase-time t, with the edge derived from the tip's motion.
 * @param tipLen how far the point of the blade is from the fist
 */
export function sampleMove(move, phase, t, out, tipLen = 0.95) {
  out = out || emptyPose();
  poseAt(move, phase, t, out);
  poseAt(move, phase, Math.min(1, t + 0.10), _p2);
  const tipA = _x.copy(out.hand).addScaledVector(out.blade, tipLen);
  const tipB = _y.copy(_h2).addScaledVector(_b2, tipLen);
  const v = _z.copy(tipB).sub(tipA);
  v.addScaledVector(out.blade, -v.dot(out.blade));
  if (v.lengthSq() < 1e-7) {
    // pure thrust: the edge is whatever faces the threat
    v.set(0, -1, 0).addScaledVector(out.blade, out.blade.y);
    if (v.lengthSq() < 1e-7) v.set(1, 0, 0).addScaledVector(out.blade, -out.blade.x);
  }
  out.edge.copy(v.normalize());
  return out;
}

/**
 * How far this blow actually reaches, in metres from the fighter's own centre.
 *
 * Not the weapon's length: a cut that comes down the centre line only threatens
 * the man in front of it, and a thrust threatens him from further off than any
 * cut does. The trick is to run the WHOLE blade through the whole blow — every
 * sample of the fist-to-point segment, through wind-up, strike and follow — and
 * ask, for each one, how far away a body of radius `targetR` could stand and
 * still be touched. Take the furthest answer: that is the move's measure.
 *
 * The pose is in camera space (−Z is forward), so "forward" is −z.
 */
export function moveRange(move, tipLen = 0.95, targetR = 0.24) {
  const pose = _rangePose;
  let best = 0;
  const phases = [['windup', 0.5], ['windup', 1], ['strike', 0.3], ['strike', 0.55], ['strike', 0.8], ['strike', 1], ['follow', 0.5], ['follow', 1]];
  for (const [ph, t] of phases) {
    sampleMove(move, ph, t, pose, tipLen);
    // the steel runs from the fist to the point: both ends matter, because a
    // descending cut lands with the middle of the blade, not the tip
    for (let i = 0; i <= 6; i++) {
      const k = i / 6;
      const px = pose.hand.x + pose.blade.x * tipLen * k;
      const pz = pose.hand.z + pose.blade.z * tipLen * k;
      if (Math.abs(px) > targetR) continue;
      const d = -pz + Math.sqrt(Math.max(0, targetR * targetR - px * px));
      if (d > best) best = d;
    }
  }
  return best + 0.04;      // a little steel sinks into leather
}
const _rangePose = emptyPose();

export function lerpPose(a, b, k, out) {
  out = out || emptyPose();
  out.hand.lerpVectors(a.hand, b.hand, k);
  out.blade.lerpVectors(a.blade, b.blade, k).normalize();
  out.edge.lerpVectors(a.edge, b.edge, k).normalize();
  return out;
}

export function copyPose(src, out) {
  out = out || emptyPose();
  out.hand.copy(src.hand); out.blade.copy(src.blade); out.edge.copy(src.edge);
  return out;
}

/** Offhand placement: shield discipline, or the second fist on a long haft. */
export function offhandPose(kind, main, handQuat, out) {
  out = out || emptyPose();
  const y = new THREE.Vector3(0, 1, 0).applyQuaternion(handQuat);
  const z = new THREE.Vector3(0, 0, 1).applyQuaternion(handQuat);
  if (kind === 'grip') {
    // two hands on one haft: the left fist rides up the grip and the pommel
    out.hand.copy(main.hand).addScaledVector(y, 0.20).addScaledVector(z, -0.025);
    out.blade.copy(main.blade);
    out.edge.copy(main.edge);
  } else if (kind === 'shield') {
    out.hand.set(-0.17, -0.20, -0.40);
    out.blade.set(-0.5, 0.62, -0.60);
    out.edge.set(-0.15, -0.1, 0.98);
  } else {
    out.hand.set(-0.26, -0.30, -0.28);
    out.blade.set(-0.4, 0.6, -0.7);
    out.edge.set(0.3, -0.2, -0.9);
  }
  return out;
}

/** Guard stance for the offhand shield, per block direction. */
export function shieldGuardPose(dir, out) {
  out = out || emptyPose();
  const P = {
    high: { h: [-0.13, 0.02, -0.38], b: [-0.5, 0.7, -0.5] },
    left: { h: [-0.40, -0.16, -0.32], b: [-0.8, 0.4, -0.44] },
    right: { h: [-0.02, -0.18, -0.40], b: [-0.2, 0.5, -0.84] },
    low: { h: [-0.14, -0.44, -0.32], b: [-0.4, -0.2, -0.88] },
  }[dir] || { h: [-0.16, -0.22, -0.40], b: [-0.45, 0.4, -0.80] };
  out.hand.set(...P.h);
  out.blade.set(...P.b).normalize();
  out.edge.set(0.2, -0.1, 0.97).normalize();
  return out;
}

// ════════════════════════════════════════════════════════════════════════════
//  IDLE / HURT
// ════════════════════════════════════════════════════════════════════════════
export const IDLE = { hand: V(0.28, -0.28, -0.34), blade: V(0.30, 0.72, -0.62), edge: V(0, -0.3, -0.95) };

export const HURT = {
  front: { hand: V(0.22, -0.34, -0.22), blade: V(0.34, 0.44, -0.83), edge: V(0, -0.4, -0.92) },
  left: { hand: V(0.42, -0.32, -0.22), blade: V(0.66, 0.30, -0.69), edge: V(0, -0.4, -0.92) },
  right: { hand: V(0.02, -0.32, -0.26), blade: V(-0.56, 0.34, -0.76), edge: V(0, -0.4, -0.92) },
  head: { hand: V(0.28, -0.40, -0.20), blade: V(0.20, 0.20, -0.96), edge: V(0, -0.4, -0.92) },
};

/** Attack speed scaling: heavier steel is simply slower. */
export function speedScale(mass) { return clamp01(1.32 - mass * 0.19); }
