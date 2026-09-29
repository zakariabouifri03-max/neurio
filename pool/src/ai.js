// ─────────────────────────────────────────────────────────────────────────────
//  ai.js — the computer opponent
//
//  This is a real player, not a script. It reads the table, generates every
//  legal pot candidate, VERIFIES each one by running the actual physics engine,
//  scores where the cue ball ends up (one ply of shape for the better levels),
//  and plays a genuine safety — searched one ply deep — when nothing is
//  makeable. Difficulty is human error (aim, power, english) and how much of
//  the table it bothers to read; the AI is never allowed to be perfect, and it
//  never gets information a human player does not have.
//
//  The decision core is a generator so the browser can time-slice it and keep
//  rendering at 60 fps while the opponent "thinks".
// ─────────────────────────────────────────────────────────────────────────────
import { TABLE, BALL, POCKETS, HL, HW, PHYS, cloneBalls, castCue, makeStrike, resolveShot } from './physics.js';
import { legalFirstBalls, onEight, canPlace, PHASE } from './rules.js';

const D = BALL.D;
const R = BALL.R;
const FOOT_X = TABLE.L * 0.25;                    // the foot spot
const A_ROLL = PHYS.MU_ROLL * PHYS.G;             // 0.167 m/s² rolling deceleration
const A_SKID = PHYS.MU_SLIDE * PHYS.G;            // 1.373 m/s² while skidding

// ── difficulty tiers ────────────────────────────────────────────────────────
//   aimErr   σ of the aim error in radians, scaled by cut angle and distance
//   powerErr σ of the power error, as a fraction
//   spotErr  σ of the english placement error, as a fraction of the tip radius
//   read     how many pot candidates get verified with the real simulator
//   shape    does it care where the cue ball ends up (one ply)?
//   safety   does it search for real safeties instead of blasting away?
//   bih      does it search for the best ball-in-hand placement?
//   potBias  chance it plays its best shot rather than a worse one
export const LEVELS = [
  { id: 1, name: 'Beginner', aimErr: 0.062, powerErr: 0.26, spotErr: 0.45, read: 3, shape: false, safety: false, bih: false, think: [420, 780], potBias: 0.55 },
  { id: 2, name: 'Amateur', aimErr: 0.036, powerErr: 0.18, spotErr: 0.32, read: 4, shape: false, safety: true, bih: false, think: [600, 1100], potBias: 0.75 },
  { id: 3, name: 'Club', aimErr: 0.019, powerErr: 0.11, spotErr: 0.20, read: 6, shape: true, safety: true, bih: true, think: [800, 1500], potBias: 0.90 },
  { id: 4, name: 'Pro', aimErr: 0.0095, powerErr: 0.062, spotErr: 0.11, read: 8, shape: true, safety: true, bih: true, think: [1000, 1900], potBias: 0.97 },
  { id: 5, name: 'Legend', aimErr: 0.0045, powerErr: 0.032, spotErr: 0.05, read: 11, shape: true, safety: true, bih: true, think: [1200, 2200], potBias: 1.0 },
];

export function levelDef(id) {
  const i = Math.max(1, Math.min(LEVELS.length, id | 0)) - 1;
  return LEVELS[i];
}
export const levelName = (id) => levelDef(id).name;

// ── deterministic RNG (so the server can re-run an AI shot exactly) ─────────
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function gaussian(rng) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ── geometry helpers ────────────────────────────────────────────────────────
const unit = (x, z) => { const l = Math.hypot(x, z) || 1; return [x / l, z / l]; };

/** is the segment (x,z) → (x+dx·dist, z+dz·dist) free of other balls? */
export function pathClear(balls, x, z, dx, dz, dist, ignore) {
  for (const b of balls) {
    if (!b || b.state !== 'table' || ignore.has(b.n)) continue;
    const ex = b.x - x, ez = b.z - z;
    const proj = ex * dx + ez * dz;
    if (proj <= 0 || proj >= dist) continue;
    const perp2 = ex * ex + ez * ez - proj * proj;
    if (perp2 < D * D * 0.999) return false;
  }
  return true;
}

/** how comfortably an object ball entering along (dx,dz) fits the pocket mouth */
export function pocketMargin(p, dx, dz) {
  const [px, pz] = unit(p.x, p.z);            // pocket → out of the table
  const cosEntry = dx * px + dz * pz;         // 1 = straight into the throat
  const need = p.kind === 'side' ? 0.80 : 0.48;
  if (cosEntry < need) return -1;
  return (cosEntry - need) / (1 - need);
}

/** the ghost-ball aim point for target `t` into pocket `p` */
export function ghostFor(balls, t, p) {
  const tb = balls[t];
  if (!tb || tb.state !== 'table') return null;
  const [ox, oz] = unit(p.x - tb.x, p.z - tb.z);
  return { ox, oz, gx: tb.x - ox * D, gz: tb.z - oz * D, dObj: Math.hypot(p.x - tb.x, p.z - tb.z) };
}

// ── candidate generation ────────────────────────────────────────────────────
/** every legal pot on the table, cheaply scored by geometry (best first) */
export function candidates(state, balls, opts = {}) {
  const cue = balls[0];
  if (!cue || cue.state !== 'table') return [];
  const legal = opts.legal || legalFirstBalls(state);
  const out = [];
  for (const t of legal) {
    const tb = balls[t];
    if (!tb || tb.state !== 'table') continue;
    for (const p of POCKETS) {
      const g = ghostFor(balls, t, p);
      if (!g) continue;
      let [ax, az] = unit(g.gx - cue.x, g.gz - cue.z);
      let dCue = Math.hypot(g.gx - cue.x, g.gz - cue.z);
      // frozen to the object ball: the ghost point is inside the cue ball, so
      // just push it along its own line to the pocket (a full, free hit)
      if (dCue < 0.02) { ax = g.ox; az = g.oz; dCue = 0.02; }
      const cosCut = ax * g.ox + az * g.oz;
      if (cosCut < 0.14) continue;                      // beyond ~82° is not a shot
      const margin = pocketMargin(p, g.ox, g.oz);
      if (margin < 0) continue;
      // the cue ball must reach the ghost ball without touching anything else
      const hit = castCue(balls, cue.x, cue.z, ax, az, { ignore: [0, t], maxDist: dCue + 0.006 });
      if (hit.kind !== 'none') continue;
      // and the object ball must reach the pocket
      if (!pathClear(balls, tb.x, tb.z, g.ox, g.oz, g.dObj, new Set([t, 0]))) continue;

      // clearance: how much room the cue path has past every other ball. A shot
      // with a hair of room is a coin flip even for a pro, so it scores badly.
      let clear = 2;
      for (const b of balls) {
        if (!b || b.state !== 'table' || b.n === 0 || b.n === t) continue;
        const ex = b.x - cue.x, ez = b.z - cue.z;
        const proj = ex * ax + ez * az;
        if (proj < 0 || proj > dCue + 0.05) continue;
        const perp = Math.sqrt(Math.max(0, ex * ex + ez * ez - proj * proj));
        clear = Math.min(clear, Math.max(0, (perp - D) / D));
      }
      const clearScore = Math.min(1, clear / 0.6);       // 0.6·D of room = comfortable

      const cut = Math.acos(Math.min(1, cosCut));
      const diff = 0.42 * cut / 1.45
        + 0.18 * Math.min(1, (dCue + g.dObj) / 2.6)
        + 0.20 * (1 - margin)
        + 0.20 * (1 - clearScore);
      out.push({
        kind: 'pot', target: t, pocket: p.id, aimX: ax, aimZ: az, cosCut, cut,
        dCue, dObj: g.dObj, margin, clear, clearScore, diff, score: 1 - diff,
        gx: g.gx, gz: g.gz, ox: g.ox, oz: g.oz, onEight: t === 8,
      });
    }
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

/** speed the cue ball needs at contact for the object ball to reach the pocket */
export function powerFor(dCue, dObj, cosCut, wantArrival = 0.95) {
  const vObj = Math.sqrt(wantArrival * wantArrival + 2 * A_ROLL * dObj);
  const transfer = 0.978 * Math.max(0.2, cosCut);        // equal masses, e ≈ 0.955
  const vContact = vObj / transfer;
  const skidLen = Math.min(dCue, 0.45);                  // it skids first, then rolls
  const v0 = Math.sqrt(vContact * vContact + 2 * A_SKID * skidLen + 2 * A_ROLL * Math.max(0, dCue - skidLen));
  return Math.max(0.16, Math.min(1, v0 / (PHYS.CUE_MAX_SPEED * PHYS.CUE_EFF)));
}

/**
 * English for a pot: a little follow on long straight shots so the cue ball
 * travels with the object ball, a little draw on thin cuts so it does not run
 * into a rail. Weak levels mostly hit centre.
 */
function spinFor(c, L) {
  if (!L.shape) return 0;
  if (c.onEight) return -0.10;                           // stun the 8, keep it simple
  const straight = c.cosCut;                             // 1 = full, 0 = thin
  const far = Math.min(1, c.dObj / 1.6);
  const follow = (straight - 0.55) * 0.85 * (0.35 + far);
  const draw = straight < 0.5 ? -(0.5 - straight) * 0.9 : 0;
  return Math.max(-0.75, Math.min(0.75, follow + draw));
}

// ── simulation probe ────────────────────────────────────────────────────────
/** run the real engine on a candidate and report what actually happened */
export function probe(balls, cand, power, tipSide = 0, tipVert = 0, placement = null) {
  const copy = cloneBalls(balls);
  if (placement) { copy[0].x = placement.x; copy[0].z = placement.z; copy[0].state = 'table'; }
  const strike = makeStrike(cand.aimX, cand.aimZ, power, tipSide, tipVert);
  const shot = resolveShot(copy, strike);
  const res = shot.result();
  const cue = copy[0];
  const pocketed = res.pocketed.map((p) => p.n);
  const hitPocket = res.pocketed.find((p) => p.n === cand.target);
  return {
    made: pocketed.includes(cand.target),
    scratch: pocketed.includes(0),
    eight: pocketed.includes(8),
    pocketedIn: hitPocket ? hitPocket.pocket : -1,
    wrongPocket: !!hitPocket && hitPocket.pocket !== cand.pocket,
    foulFirst: res.firstContact ? res.firstContact.n : null,
    cue: cue.state === 'table' ? { x: cue.x, z: cue.z } : null,
    other: pocketed.filter((n) => n !== 0 && n !== cand.target),
    res, balls: copy,
  };
}

/** how good is the cue ball's resting place for the NEXT shot? (0..1) */
export function positionScore(balls, state, shooterIdx) {
  const cue = balls[0];
  if (!cue || cue.state !== 'table') return -1;
  const railDist = Math.min(HL - R - Math.abs(cue.x), HW - R - Math.abs(cue.z));
  const railPenalty = Math.max(0, 1 - railDist / (R * 2.4));
  let pocketPenalty = 0;
  for (const p of POCKETS) pocketPenalty = Math.max(pocketPenalty, Math.max(0, 1 - Math.hypot(p.x - cue.x, p.z - cue.z) / (p.r * 2.6)));
  const view = { ...state, turn: shooterIdx, phase: PHASE.PLAY };
  const legal = legalFirstBalls(view);
  let best = 0;
  for (const t of legal) {
    const tb = balls[t];
    if (!tb || tb.state !== 'table') continue;
    for (const p of POCKETS) {
      const g = ghostFor(balls, t, p);
      if (!g) continue;
      const [ax, az] = unit(g.gx - cue.x, g.gz - cue.z);
      const dCue = Math.hypot(g.gx - cue.x, g.gz - cue.z);
      if (dCue < 0.05) continue;
      const cosCut = ax * g.ox + az * g.oz;
      if (cosCut < 0.2) continue;
      if (pocketMargin(p, g.ox, g.oz) < 0) continue;
      const hit = castCue(balls, cue.x, cue.z, ax, az, { ignore: [0, t], maxDist: dCue + 0.006 });
      if (hit.kind !== 'none') continue;
      if (!pathClear(balls, tb.x, tb.z, g.ox, g.oz, g.dObj, new Set([t, 0]))) continue;
      best = Math.max(best, cosCut * (1 - Math.min(1, dCue / 3)));
    }
  }
  return Math.max(0, best * 0.85 - railPenalty * 0.5 - pocketPenalty * 0.45);
}

// ── safeties ────────────────────────────────────────────────────────────────
function safetyCandidates(state, balls) {
  const cue = balls[0];
  const legal = legalFirstBalls(state);
  const out = [];
  for (const t of legal) {
    const tb = balls[t];
    if (!tb || tb.state !== 'table') continue;
    for (let a = 0; a < 10; a++) {
      const ang = (a / 10) * Math.PI * 2;
      const dx = Math.cos(ang), dz = Math.sin(ang);
      const d = Math.hypot(tb.x - cue.x, tb.z - cue.z);
      const hit = castCue(balls, cue.x, cue.z, dx, dz, { ignore: 0, maxDist: d + 0.02 });
      if (hit.kind !== 'ball' || hit.ball !== t) continue;
      out.push({
        kind: 'safety', target: t, pocket: -1, aimX: dx, aimZ: dz,
        cosCut: (dx * (tb.x - cue.x) + dz * (tb.z - cue.z)) / d, cut: 0,
        dCue: d, dObj: 0, margin: 0, clear: 0, clearScore: 0, diff: 1, score: 0,
        gx: hit.gx, gz: hit.gz, ox: dx, oz: dz, onEight: t === 8,
      });
      break;
    }
  }
  return out;
}

/** after this safety, how hard is the table for the opponent? (higher = better) */
function safetyScore(state, balls, cand, power) {
  const p = probe(balls, cand, power);
  if (p.scratch || p.eight) return -10;
  const legal = legalFirstBalls(state);
  if (p.foulFirst === null) return -10;
  if (!legal.includes(p.foulFirst)) return -8;
  if (p.res.pocketed.length === 0 && !p.res.railAfterContact && !p.res.cushionBeforeContact) return -6;
  const opp = { ...state, turn: 1 - state.turn, phase: PHASE.PLAY };
  const oppBest = candidates(opp, p.balls).slice(0, 3);
  const oppEase = oppBest.length ? Math.max(...oppBest.map((c) => c.score)) : 0;
  const cue = p.balls[0];
  const railDist = cue.state === 'table' ? Math.min(HL - R - Math.abs(cue.x), HW - R - Math.abs(cue.z)) : 0;
  const sep = oppBest.length ? 0 : 0.28;
  return (1 - oppEase) * 1.7 + sep + Math.max(0, 0.25 - railDist) * 0.5;
}

// ── ball in hand ────────────────────────────────────────────────────────────
const BIH_SPOTS = (() => {
  const out = [];
  for (const x of [-0.95, -0.63, -0.32, 0, 0.32, 0.63, 0.95]) {
    for (const z of [-0.42, -0.21, 0, 0.21, 0.42]) out.push({ x, z });
  }
  return out;
})();
const KITCHEN_SPOTS = BIH_SPOTS.filter((s) => s.x <= -TABLE.L * 0.25 + 1e-6);

/** search a set of legal placements and return the one that plays best */
export function* bestPlacementGen(state, balls, L, rng) {
  const base = state.kitchenOnly ? KITCHEN_SPOTS : BIH_SPOTS;
  const spots = [];
  for (const sp of base) if (canPlace(state, sp.x, sp.z).ok) spots.push(sp);
  // plus a few spots ghosted off the balls we most want to pot
  for (const b of balls) {
    if (!b || b.n === 0 || b.state !== 'table') continue;
    for (const p of POCKETS) {
      const [ux, uz] = unit(b.x - p.x, b.z - p.z);
      const c = { x: b.x + ux * D * 1.7, z: b.z + uz * D * 1.7 };
      if (canPlace(state, c.x, c.z).ok) spots.push(c);
    }
  }
  if (!spots.length) return null;
  let best = null, bestScore = -Infinity;
  for (const sp of spots) {
    yield;
    const copy = cloneBalls(balls);
    copy[0].x = sp.x; copy[0].z = sp.z; copy[0].state = 'table';
    const cands = candidates(state, copy).slice(0, 3);
    let s = 0;
    for (const c of cands) {
      const pw = powerFor(c.dCue, c.dObj, c.cosCut);
      const p = probe(copy, c, pw);
      if (p.scratch || !p.made) continue;
      s = Math.max(s, c.score + (L.shape ? positionScore(p.balls, state, state.turn) * 0.5 : 0));
    }
    s += rng() * 0.03;
    if (s > bestScore) { bestScore = s; best = sp; }
  }
  return bestScore > -0.5 ? best : spots[0];
}

// ── the break ───────────────────────────────────────────────────────────────
/**
 * Real players hit the apex ball as hard as they can control, a hair off centre
 * so the rack explodes sideways, with a touch of follow so the cue ball stays
 * near the middle. Weaker players break softer and less accurately — and
 * sometimes leave an illegal break, which the rules engine punishes properly.
 */
export function breakShot(state, balls, L, rng, out) {
  const cue = balls[0];
  let apex = null;
  for (const n of legalFirstBalls(state)) {
    const b = balls[n];
    if (!b || b.state !== 'table') continue;
    const d = Math.hypot(b.x - FOOT_X, b.z);
    if (!apex || d < apex.d) apex = { n, b, d };
  }
  if (!apex) return out;
  const [bx, bz] = unit(apex.b.x - cue.x, apex.b.z - cue.z);
  const off = (rng() - 0.5) * (L.id >= 4 ? 0.055 : 0.13);
  const [dx, dz] = unit(bx - bz * off, bz + bx * off);
  const base = L.id >= 4 ? 0.94 : L.id === 3 ? 0.86 : 0.62;
  const power = Math.max(0.35, Math.min(1, base + gaussian(rng) * (L.id >= 3 ? 0.05 : 0.18)));
  const tipVert = Math.max(-0.06, Math.min(0.38, (L.id >= 4 ? 0.16 : 0.08) + gaussian(rng) * L.spotErr * 0.6));
  out.dirX = dx; out.dirZ = dz; out.power = power;
  out.tipSide = +(gaussian(rng) * L.spotErr * 0.4).toFixed(3);
  out.tipVert = +tipVert.toFixed(3);
  out.plan = {
    kind: 'break', target: apex.n, pocket: -1, cut: 0, score: 1,
    note: `break into the ${apex.n}-ball`, verified: false, level: L.name,
  };
  return out;
}

// ── the decision (generator so the browser can time-slice it) ───────────────
export function* planGen(state, balls, level, rng = Math.random) {
  const L = levelDef(level);
  const out = {
    dirX: 1, dirZ: 0, power: 0.5, tipSide: 0, tipVert: 0,
    plan: { kind: 'none', note: 'no legal shot' },
    thinkMs: L.think[0] + rng() * (L.think[1] - L.think[0]),
  };

  let work = balls;
  if (state.ballInHand) {
    let placement = null;
    if (L.bih) placement = yield* bestPlacementGen(state, balls, L, rng);
    if (!placement) {
      const sp = state.kitchenOnly ? { x: -TABLE.L * 0.25, z: 0 } : { x: -TABLE.L * 0.1, z: 0 };
      placement = canPlace(state, sp.x, sp.z).ok ? sp : yield* bestPlacementGen(state, balls, LEVELS[0], rng);
    }
    if (placement) {
      work = cloneBalls(balls);
      work[0].x = placement.x; work[0].z = placement.z; work[0].state = 'table';
      out.placement = { x: placement.x, z: placement.z };
    }
  }

  const cue = work[0];
  if (!cue || cue.state !== 'table') return out;
  if (state.phase === PHASE.BREAK) return breakShot(state, work, L, rng, out);

  const legal = legalFirstBalls(state);
  const canPotEight = onEight(state, state.turn);

  // ── 1. generate pot candidates, then verify the best few with real physics ─
  const cands = candidates(state, work).filter((c) => c.target !== 8 || canPotEight);
  const verified = [];
  for (const c of cands.slice(0, Math.max(2, L.read))) {
    yield;
    const basePw = powerFor(c.dCue, c.dObj, c.cosCut);
    const tv = spinFor(c, L);
    let bestTry = null;
    for (const tweak of L.id >= 4 ? [0, 0.12, -0.1, 0.22] : [0]) {
      yield;
      const pw = Math.max(0.06, Math.min(1, basePw + tweak));
      const tp = probe(work, c, pw, 0, tv);
      if (tp.scratch) continue;
      if (!legal.includes(tp.foulFirst)) continue;          // would be a wrong-ball foul
      if (!tp.made) continue;
      const pos = L.shape ? positionScore(tp.balls, state, state.turn) : 0.5;
      const s = c.score * 1.35 + pos * 0.55 - Math.abs(tweak) * 0.5;
      if (!bestTry || s > bestTry.s) bestTry = { s, power: pw, pos };
    }
    if (bestTry) verified.push({ cand: c, ...bestTry });
  }
  verified.sort((a, b) => b.s - a.s);

  // ── 2. choose: the best verified pot, else a searched safety ──────────────
  let chosen = null;
  if (verified.length) {
    const idx = rng() < L.potBias ? 0 : Math.min(verified.length - 1, 1 + Math.floor(rng() * 2));
    const v = verified[idx];
    const pocketNames = ['top left', 'top right', 'bottom left', 'bottom right', 'top side', 'bottom side'];
    chosen = {
      kind: v.cand.onEight ? 'eight' : 'pot', cand: v.cand, power: v.power,
      tipVert: spinFor(v.cand, L), note: v.cand.onEight
        ? 'the 8-ball — for the match'
        : `pot the ${v.cand.target} in the ${pocketNames[v.cand.pocket] || v.cand.pocket} pocket`,
      verified: true, shape: v.pos,
    };
    if (v.cand.onEight) chosen.power = Math.min(0.8, chosen.power);
  }

  if (!chosen) {
    const safeties = safetyCandidates(state, work);
    let best = null;
    for (const s of safeties.slice(0, 12)) {
      for (const pw of L.safety ? [0.26, 0.36, 0.5] : [0.72]) {
        yield;
        const sc = safetyScore(state, work, s, pw);
        if (!best || sc > best.sc) best = { sc, cand: s, power: pw };
      }
    }
    if (best && best.sc > -5) {
      chosen = { kind: 'safety', cand: best.cand, power: best.power, tipVert: 0, note: 'safety — nothing makeable', verified: false };
    }
  }

  if (!chosen) {
    // last resort: hit the nearest legal ball so the shot is at least legal
    let near = null;
    for (const t of legal) {
      const tb = work[t];
      if (!tb || tb.state !== 'table') continue;
      const d = Math.hypot(tb.x - cue.x, tb.z - cue.z);
      if (!near || d < near.d) near = { d, t, tb };
    }
    if (!near) return out;
    const [ax, az] = unit(near.tb.x - cue.x, near.tb.z - cue.z);
    chosen = {
      kind: 'desperate', power: 0.42, tipVert: 0, note: 'no shot — hit and hope', verified: false,
      cand: { aimX: ax, aimZ: az, target: near.t, cosCut: 1, dCue: near.d, dObj: 0, pocket: -1, onEight: near.t === 8 },
    };
  }

  // ── 3. human error ────────────────────────────────────────────────────────
  // Stroke noise is unbiased, but a competent player never *commits* to a line
  // that clips an illegal ball first — so the error is re-drawn (up to 3×) if
  // it would. Missing the pot, scratching and leaving bad shape all still
  // happen exactly as often as the level says they should.
  const c = chosen.cand;
  const distScale = 1 + Math.min(1.1, c.dCue / 2.2) * 0.85;
  const cutScale = 1 + (1 - Math.min(1, c.cosCut || 1)) * 0.9;
  let ax = c.aimX, az = c.aimZ, err = 0;
  for (let attempt = 0; attempt < 4; attempt++) {
    err = gaussian(rng) * L.aimErr * distScale * cutScale * (attempt === 3 ? 0.35 : 1);
    const ca = Math.cos(err), sa = Math.sin(err);
    const [ex, ez] = unit(c.aimX * ca - c.aimZ * sa, c.aimX * sa + c.aimZ * ca);
    const first = castCue(work, cue.x, cue.z, ex, ez, { ignore: 0, maxDist: c.dCue + 0.05 });
    ax = ex; az = ez;
    if (first.kind !== 'ball' || legal.includes(first.ball)) break;
    if (attempt === 3) { ax = c.aimX; az = c.aimZ; }        // tighten up on a thin margin
  }

  let power = chosen.power * (1 + gaussian(rng) * L.powerErr);
  power = Math.max(0.05, Math.min(1, power));
  let tipSide = gaussian(rng) * L.spotErr * 0.5;
  let tipVert = chosen.tipVert + gaussian(rng) * L.spotErr * 0.5;
  const tm = Math.hypot(tipSide, tipVert);
  if (tm > 0.92) { tipSide *= 0.92 / tm; tipVert *= 0.92 / tm; }

  out.dirX = ax; out.dirZ = az; out.power = power;
  out.tipSide = +tipSide.toFixed(3); out.tipVert = +tipVert.toFixed(3);
  out.plan = {
    kind: chosen.kind, target: c.target, pocket: c.pocket, cut: c.cut || 0,
    score: c.score || 0, note: chosen.note, verified: !!chosen.verified,
    aimErrorRad: +err.toFixed(4), level: L.name, shape: chosen.shape || 0,
  };
  return out;
}

/** synchronous driver (server + tests) */
export function planShot(state, balls, level, rng = Math.random) {
  const it = planGen(state, balls, level, rng);
  let r = it.next();
  while (!r.done) r = it.next();
  return r.value;
}

/** time-sliced driver (browser): keeps the frame budget while the AI thinks */
export async function planShotAsync(state, balls, level, rng = Math.random, budgetMs = 6, onProgress) {
  const it = planGen(state, balls, level, rng);
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  let t = now(), r = it.next(), steps = 0;
  while (!r.done) {
    if (now() - t > budgetMs) {
      if (onProgress) onProgress(++steps);
      await new Promise((res) => setTimeout(res, 0));
      t = now();
    }
    r = it.next();
  }
  if (onProgress) onProgress(++steps);
  return r.value;
}

export default {
  LEVELS, levelDef, levelName, mulberry32, gaussian, candidates, ghostFor, probe, powerFor,
  positionScore, planShot, planShotAsync, planGen, breakShot, bestPlacementGen, pathClear, pocketMargin,
};
