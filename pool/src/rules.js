// ─────────────────────────────────────────────────────────────────────────────
//  rules.js — 8-BALL and 9-BALL rules engines (WPA-style)
//
//  Pure and deterministic: nothing here reads the DOM, the wall clock or
//  Math.random. The exact same module runs in the browser (for instant, local
//  feedback) and on the server (as the authority), so a match replayed from the
//  same inputs always resolves identically.
// ─────────────────────────────────────────────────────────────────────────────
import { TABLE, BALL, POCKETS, HL, HW, SPOTS, HEAD_STRING_X, rackPositions, rack9, groupOf } from './table.js';

export const GROUP = { NONE: null, SOLIDS: 'solids', STRIPES: 'stripes' };
export const PHASE = { BREAK: 'break', PLAY: 'play', OVER: 'over' };
export { groupOf };

const membersOf = (g) => (g === GROUP.SOLIDS ? [1, 2, 3, 4, 5, 6, 7] : [9, 10, 11, 12, 13, 14, 15]);
const onTable = (state, n) => state.balls[n] && state.balls[n].state === 'table';

/** how many of a group are still on the bed */
export function groupLeft(state, g) {
  if (!g) return 7;
  return membersOf(g).filter((n) => onTable(state, n)).length;
}

/** lowest ball on the table (9-ball) */
export function lowestBall(state) {
  for (let n = 1; n <= 9; n++) if (onTable(state, n)) return n;
  return 0;
}

/** the shooter is on the 8-ball once their whole group is down */
export function onEight(state, pi = state.turn) {
  const p = state.players[pi];
  return !!p.group && groupLeft(state, p.group) === 0;
}

/** ball numbers the shooter may legally strike FIRST */
export function legalFirstBalls(state, pi = state.turn) {
  const p = state.players[pi];
  if (state.phase === PHASE.BREAK) {
    const top = state.game === '9ball' ? 9 : 15;
    const out = [];
    for (let n = 1; n <= top; n++) if (onTable(state, n)) out.push(n);
    return out;
  }
  if (state.game === '9ball') return [lowestBall(state)].filter((n) => n > 0);
  if (!p.group) return [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15].filter((n) => onTable(state, n));
  if (onEight(state, pi)) return [8];
  return membersOf(p.group).filter((n) => onTable(state, n));
}

// ── match construction ──────────────────────────────────────────────────────

/**
 * @param {object} o
 * @param {'8ball'|'9ball'} o.game
 * @param {{name:string,avatar?:string,isAI?:boolean,level?:number}[]} o.players
 * @param {number} o.breaker   who breaks (0/1)
 * @param {number} o.cueZ      cue-ball offset inside the kitchen on the break
 * @param {number} o.stake     coins each player puts in (the pot is 2×stake)
 * @param {number} o.shotClock seconds per shot (0 = none)
 */
export function newMatch(o = {}) {
  const game = o.game === '9ball' ? '9ball' : '8ball';
  const names = o.players && o.players.length >= 2 ? o.players : [{ name: 'Player 1' }, { name: 'Player 2' }];
  const balls = [];
  for (let n = 0; n <= 15; n++) balls.push({ n, x: 0, z: 0, state: 'pocketed', pocket: -1 });

  balls[0].x = HEAD_STRING_X; balls[0].z = o.cueZ || 0; balls[0].state = 'table';

  // rackPositions()/rack9() return {x,z} indexed by ball number (index 0 = cue)
  const rack = game === '9ball' ? rack9() : rackPositions();
  for (let n = 1; n < rack.length; n++) {
    const p = rack[n];
    if (!p) continue;
    balls[n].x = p.x; balls[n].z = p.z; balls[n].state = 'table';
  }

  return {
    game,
    balls,
    players: names.slice(0, 2).map((p, i) => ({
      name: p.name || `Player ${i + 1}`,
      avatar: p.avatar || (i ? '🤖' : '🎱'),
      isAI: !!p.isAI,
      level: p.level || 3,
      group: GROUP.NONE,
      pocketed: [],
      fouls: 0,
      streak: 0,          // consecutive fouls (3 = loss in 8-ball)
      warned: false,
      score: 0,
    })),
    turn: o.breaker ? 1 : 0,
    phase: PHASE.BREAK,
    open: game === '8ball',
    ballInHand: false,
    kitchenOnly: false,   // ball in hand restricted behind the head string
    shotNumber: 0,
    shotClock: o.shotClock === undefined ? 30 : o.shotClock,
    shotClockLeft: o.shotClock === undefined ? 30 : o.shotClock,
    stake: o.stake || 0,
    pot: (o.stake || 0) * 2,
    winner: null,
    winReason: '',
    loseReason: '',
    log: [],
    lastShot: null,
  };
}

/** compact, network-safe view of the balls (sync + server authority) */
export function snapshot(state) {
  return state.balls.map((b) => ({
    n: b.n, x: +b.x.toFixed(5), z: +b.z.toFixed(5),
    s: b.state === 'table' ? 0 : b.state === 'falling' ? 1 : 2,
  }));
}

/**
 * Mirror the physics result back into the rules state. The rules state is the
 * authority: after every shot it must know exactly where every ball stopped.
 */
export function commitPositions(state, res) {
  if (!res || !res.balls) return;
  for (const s of res.balls) {
    const b = state.balls[s.n];
    if (!b) continue;
    b.x = s.x; b.z = s.z; b.y = s.y || 0;
    b.state = s.st === 0 ? 'table' : s.st === 1 ? 'falling' : 'pocketed';
    if (s.p !== undefined && s.p >= 0) b.pocket = s.p;
  }
}

export function applySnapshot(state, snap) {
  for (const s of snap) {
    const b = state.balls[s.n];
    if (!b) continue;
    b.x = s.x; b.z = s.z;
    b.state = s.s === 0 ? 'table' : s.s === 1 ? 'falling' : 'pocketed';
  }
}

// ── ball in hand ────────────────────────────────────────────────────────────

export function canPlace(state, x, z) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return { ok: false, why: 'bad position' };
  if (x < -HL + BALL.R || x > HL - BALL.R || z < -HW + BALL.R || z > HW - BALL.R) return { ok: false, why: 'off the bed' };
  if (state.kitchenOnly && x > HEAD_STRING_X) return { ok: false, why: 'must be behind the head string' };
  for (const b of state.balls) {
    if (!b || b.n === 0 || b.state !== 'table') continue;
    if (Math.hypot(b.x - x, b.z - z) < BALL.D + 1e-4) return { ok: false, why: 'touching another ball' };
  }
  for (const p of POCKETS) {
    if (Math.hypot(p.x - x, p.z - z) < p.r + BALL.R * 0.5) return { ok: false, why: 'inside a pocket' };
  }
  return { ok: true };
}

export function placeCue(state, x, z) {
  const c = canPlace(state, x, z);
  if (!c.ok) return c;
  const cue = state.balls[0];
  cue.x = x; cue.z = z; cue.state = 'table'; cue.pocket = -1;
  state.ballInHand = false; state.kitchenOnly = false;
  return { ok: true };
}

/** put the cue ball back on the bed after a scratch (server-side ball in hand) */
export function respawnCue(state, x, z) {
  const cue = state.balls[0];
  cue.state = 'table'; cue.pocket = -1;
  if (x === undefined) {
    // find a legal spot: prefer the head spot, then walk the kitchen, then anywhere
    const trySpot = (px, pz) => { if (canPlace(state, px, pz).ok) { cue.x = px; cue.z = pz; return true; } return false; };
    if (trySpot(HEAD_STRING_X, 0)) return true;
    for (let i = 1; i < 40; i++) {
      if (trySpot(HEAD_STRING_X, i * 0.02) || trySpot(HEAD_STRING_X, -i * 0.02)) return true;
      if (trySpot(HEAD_STRING_X - i * 0.02, 0)) return true;
    }
    for (let x = -HL + BALL.R * 2; x < HL - BALL.R * 2; x += 0.03) {
      for (let z = -HW + BALL.R * 2; z < HW - BALL.R * 2; z += 0.03) if (trySpot(x, z)) return true;
    }
    return false;
  }
  return placeCue(state, x, z).ok;
}

/** re-spot a ball on the foot spot (or the nearest free point behind it) */
export function spotBall(state, n) {
  const b = state.balls[n];
  if (!b) return false;
  let x = SPOTS.foot.x, z = 0;
  const free = () => {
    for (const o of state.balls) {
      if (!o || o.n === n || o.state !== 'table') continue;
      if (Math.hypot(o.x - x, o.z - z) < BALL.D + 1e-4) return false;
    }
    return true;
  };
  for (let i = 0; i < 400 && !free(); i++) {
    x -= 0.012;
    if (x < -HL + BALL.R * 2) { x = SPOTS.foot.x; z = (i % 2 ? 1 : -1) * 0.012 * (1 + (i >> 1)); }
  }
  b.x = x; b.z = z; b.state = 'table'; b.pocket = -1;
  return true;
}

// ── shot validation (server-authoritative) ──────────────────────────────────

/**
 * Reject anything a tampered client could invent BEFORE the shot is simulated.
 * @returns {{ok:boolean, why?:string}}
 */
export function validateShot(state, strike) {
  if (!strike || typeof strike !== 'object') return { ok: false, why: 'no shot' };
  if (state.phase === PHASE.OVER) return { ok: false, why: 'the match is over' };
  const num = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
  if (!num(strike.dirX, -1.001, 1.001) || !num(strike.dirZ, -1.001, 1.001)) return { ok: false, why: 'bad direction' };
  if (Math.hypot(strike.dirX, strike.dirZ) < 1e-3) return { ok: false, why: 'no direction' };
  if (!num(strike.power, 0.02, 1)) return { ok: false, why: 'bad power' };
  if (!num(strike.tipSide, -1, 1) || !num(strike.tipVert, -1, 1)) return { ok: false, why: 'bad english' };
  if (Math.hypot(strike.tipSide, strike.tipVert) > 1.0001) return { ok: false, why: 'english off the tip' };

  const cue = state.balls[0];
  if (state.ballInHand) {
    if (!strike.placement) return { ok: false, why: 'ball in hand needs a placement' };
    const c = canPlace(state, strike.placement.x, strike.placement.z);
    if (!c.ok) return { ok: false, why: `ball in hand: ${c.why}` };
  } else if (!cue || cue.state !== 'table') {
    return { ok: false, why: 'the cue ball is not on the bed' };
  }
  if (state.phase === PHASE.BREAK && !state.ballInHand && cue.x > HEAD_STRING_X + 1e-6) {
    return { ok: false, why: 'break from behind the head string' };
  }
  return { ok: true };
}

// ── shot resolution ─────────────────────────────────────────────────────────

/**
 * Fold a physics result (Shot.result()) into the match state.
 * @returns {{foul:boolean, reason:string, pocketed:Array, continuesTurn:boolean,
 *            winner:number|null, events:Array, assignment:object|null}}
 */
export function applyResult(state, res) {
  if (state.game === '9ball') return applyNine(state, res);
  const pi = state.turn;
  const me = state.players[pi];
  const opp = state.players[1 - pi];
  const events = [];
  // Everything about legality is judged on the table AS IT WAS when the cue was
  // struck, so these must be read BEFORE the physics result is mirrored in.
  const wasBreak = state.phase === PHASE.BREAK;
  const wasOnEight = onEight(state, pi);
  const legalFirst = legalFirstBalls(state, pi);
  state.shotNumber++;
  commitPositions(state, res);

  const pocketed = recordPocketed(state, res, events);
  state.lastShot = describeShot(state, pi, wasBreak, res, pocketed);

  const cueDown = pocketed.some((p) => p.n === 0);
  const eightDown = pocketed.some((p) => p.n === 8);
  const ownDown = pocketed.filter((p) => p.n !== 0 && p.n !== 8 && (!me.group || groupOf(p.n) === me.group));
  const firstHit = res.firstContact ? res.firstContact.n : null;

  // ── fouls ─────────────────────────────────────────────────────────────────
  let foul = false, reason = '';
  const because = (r) => { if (!foul) { foul = true; reason = r; } };

  if (firstHit === null) because('no ball was hit');
  else if (!legalFirst.includes(firstHit)) {
    if (wasOnEight) because('the 8-ball must be hit first');
    else if (!me.group) because('the 8-ball cannot be hit first on an open table');
    else because(`you must hit one of your ${me.group} first`);
  }
  if (cueDown) because('cue ball pocketed');
  if (!cueDown && firstHit !== null && pocketed.length === 0 && !res.railAfterContact && !res.cushionBeforeContact) {
    because('nothing reached a rail after contact');
  }
  if (wasBreak && !cueDown && pocketed.length === 0 && res.cushionHits < 4) {
    because('illegal break — fewer than four balls reached a rail');
  }

  // ── the 8-ball decides the match ─────────────────────────────────────────
  if (eightDown) {
    if (wasBreak) {
      spotBall(state, 8);                       // WPA: spot it, breaker keeps the table
      events.push({ type: 'respot', n: 8 });
    } else if (!wasOnEight) {
      return finish(state, 1 - pi, 'the 8-ball went down early', events, true);
    } else if (foul) {
      return finish(state, 1 - pi, `foul on the 8-ball — ${reason}`, events, true);
    } else {
      return finish(state, pi, 'the 8-ball was pocketed cleanly', events, false);
    }
  }

  // ── three consecutive fouls ───────────────────────────────────────────────
  if (foul) {
    me.fouls++; me.streak++;
    if (me.streak >= 3) return finish(state, 1 - pi, 'three consecutive fouls', events, true);
    if (me.streak === 2 && !me.warned) { me.warned = true; events.push({ type: 'warn', who: pi }); }
  } else { me.streak = 0; me.warned = false; }

  // ── group assignment (open table, after the break) ────────────────────────
  let assignment = null;
  if (!foul && state.open && !wasBreak) {
    const decider = pocketed.find((p) => p.n !== 0 && p.n !== 8);
    if (decider) {
      const g = groupOf(decider.n);
      me.group = g;
      opp.group = g === GROUP.SOLIDS ? GROUP.STRIPES : GROUP.SOLIDS;
      state.open = false;
      assignment = { who: pi, group: g };
      events.push({ type: 'assign', who: pi, group: g });
    }
  }
  if (wasBreak) state.phase = PHASE.PLAY;

  for (const p of pocketed) {
    if (p.n === 0 || p.n === 8) continue;
    const owner = state.players.find((pl) => pl.group === groupOf(p.n));
    if (owner && !owner.pocketed.includes(p.n)) owner.pocketed.push(p.n);
  }

  // ── turn over? ────────────────────────────────────────────────────────────
  let continuesTurn = false;
  if (foul) {
    state.ballInHand = true;
    state.kitchenOnly = wasBreak;
    state.turn = 1 - pi;
    events.push({ type: 'foul', who: pi, reason, ballInHand: true, kitchen: wasBreak });
  } else if (wasBreak) {
    continuesTurn = pocketed.some((p) => p.n !== 0);
    if (!continuesTurn) state.turn = 1 - pi;
    events.push({ type: 'break', pocketed: pocketed.length, keep: continuesTurn });
  } else if (ownDown.length > 0) {
    continuesTurn = true;
    events.push({ type: 'continue', balls: ownDown.map((p) => p.n) });
  } else {
    state.turn = 1 - pi;
    events.push({ type: 'pass', who: 1 - pi });
  }

  if (cueDown && state.balls[0].state === 'pocketed') respawnCue(state);
  state.shotClockLeft = state.shotClock;
  return {
    foul, reason, pocketed, continuesTurn, winner: null, events, assignment,
    onEightNow: onEight(state), ballInHand: state.ballInHand,
  };
}

/** 9-ball: lowest first, any legal pot wins the shot, the 9 wins the rack */
function applyNine(state, res) {
  const pi = state.turn;
  const me = state.players[pi];
  const events = [];
  const wasBreak = state.phase === PHASE.BREAK;
  const legalFirst = legalFirstBalls(state, pi);   // pre-shot table
  state.shotNumber++;
  commitPositions(state, res);

  const pocketed = recordPocketed(state, res, events);
  state.lastShot = describeShot(state, pi, wasBreak, res, pocketed);

  const cueDown = pocketed.some((p) => p.n === 0);
  const nineDown = pocketed.some((p) => p.n === 9);
  const firstHit = res.firstContact ? res.firstContact.n : null;

  let foul = false, reason = '';
  const because = (r) => { if (!foul) { foul = true; reason = r; } };
  if (firstHit === null) because('no ball was hit');
  else if (!legalFirst.includes(firstHit)) because(`the ${legalFirst[0]}-ball must be hit first`);
  if (cueDown) because('cue ball pocketed');
  if (!cueDown && firstHit !== null && pocketed.length === 0 && !res.railAfterContact && !res.cushionBeforeContact) {
    because('nothing reached a rail after contact');
  }
  if (wasBreak && !cueDown && pocketed.length === 0 && res.cushionHits < 4) {
    because('illegal break — fewer than four balls reached a rail');
  }

  if (nineDown) {
    if (foul) { spotBall(state, 9); events.push({ type: 'respot', n: 9 }); }
    else return finish(state, pi, 'the 9-ball was pocketed', events, false);
  }
  if (foul) { me.fouls++; me.streak++; } else me.streak = 0;
  if (wasBreak) state.phase = PHASE.PLAY;

  let continuesTurn = false;
  if (foul) {
    state.ballInHand = true; state.kitchenOnly = wasBreak; state.turn = 1 - pi;
    events.push({ type: 'foul', who: pi, reason, ballInHand: true, kitchen: wasBreak });
  } else if (pocketed.length > 0) {
    continuesTurn = true;
    events.push({ type: 'continue', balls: pocketed.map((p) => p.n) });
  } else {
    state.turn = 1 - pi;
    events.push({ type: 'pass', who: 1 - pi });
  }

  if (!onTable(state, 9)) { spotBall(state, 9); events.push({ type: 'respot', n: 9 }); }
  if (cueDown) respawnCue(state);
  state.shotClockLeft = state.shotClock;
  return { foul, reason, pocketed, continuesTurn, winner: null, events, ballInHand: state.ballInHand };
}

function recordPocketed(state, res, events) {
  const out = [];
  for (const p of res.pocketed) {
    const b = state.balls[p.n];
    if (!b) continue;
    b.state = 'pocketed'; b.pocket = p.pocket;
    out.push({ n: p.n, pocket: p.pocket, t: p.t });
    events.push({ type: 'pocketed', n: p.n, pocket: p.pocket });
  }
  return out;
}

function describeShot(state, pi, wasBreak, res, pocketed) {
  return {
    n: state.shotNumber,
    by: pi,
    break: wasBreak,
    first: res.firstContact ? res.firstContact.n : null,
    firstSpeed: res.firstContact ? res.firstContact.speed : 0,
    pocketed: pocketed.map((p) => p.n),
    rails: res.cushionHits,
    railAfter: !!res.railAfterContact,
    maxSpeed: res.maxSpeed,
    t: res.t,
  };
}

function finish(state, winnerPi, why, events, byLoss) {
  state.phase = PHASE.OVER;
  state.winner = winnerPi;
  state.players[winnerPi].score++;
  const loser = state.players[1 - winnerPi];
  state.winReason = byLoss ? `${loser.name}: ${why}` : why;
  state.loseReason = byLoss ? why : `${loser.name}: ${why}`;
  state.turn = winnerPi;
  state.ballInHand = false;
  state.kitchenOnly = false;
  events.push({ type: 'win', who: winnerPi, why });
  return {
    foul: false, reason: '', pocketed: [], continuesTurn: false,
    winner: winnerPi, winReason: state.winReason, events,
  };
}

/** the shot clock ran out — a foul, ball in hand to the opponent */
export function shotClockFoul(state) {
  const pi = state.turn;
  const me = state.players[pi];
  me.fouls++; me.streak++;
  state.ballInHand = true; state.kitchenOnly = false;
  const events = [{ type: 'foul', who: pi, reason: 'shot clock', ballInHand: true }];
  if (state.game === '8ball' && me.streak >= 3) return finish(state, 1 - pi, 'three consecutive fouls', events, true);
  state.turn = 1 - pi;
  state.shotClockLeft = state.shotClock;
  return { foul: true, reason: 'shot clock expired', events, winner: null };
}

/** coins settled when a match ends — the server performs the real transfer */
export function settle(state) {
  const stake = state.stake || 0;
  return { winner: state.winner, coins: state.winner === null ? 0 : stake * 2, stake };
}

/** one-line human description of the current situation, for the HUD */
export function situation(state) {
  const p = state.players[state.turn];
  if (state.phase === PHASE.OVER) return state.winReason;
  if (state.phase === PHASE.BREAK) return `${p.name} to break`;
  if (state.ballInHand) return `${p.name} — ball in hand${state.kitchenOnly ? ' (kitchen)' : ''}`;
  if (state.game === '9ball') return `${p.name} — on the ${lowestBall(state)}`;
  if (!p.group) return `${p.name} — open table`;
  if (onEight(state)) return `${p.name} — on the 8-ball`;
  return `${p.name} — ${p.group} (${groupLeft(state, p.group)} left)`;
}

export default {
  newMatch, applyResult, validateShot, canPlace, placeCue, respawnCue, spotBall, commitPositions,
  legalFirstBalls, onEight, groupLeft, lowestBall, snapshot, applySnapshot,
  shotClockFoul, settle, situation, groupOf, GROUP, PHASE,
};
