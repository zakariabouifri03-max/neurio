// ─────────────────────────────────────────────────────────────────────────────
//  gamestest.mjs — end-to-end rules + AI validation, no browser needed.
//  Plays full matches with the real physics engine and the real rules engine.
// ─────────────────────────────────────────────────────────────────────────────
import { newMatch, applyResult, validateShot, placeCue, legalFirstBalls, groupLeft, onEight, situation, PHASE } from '../src/rules.js';
import { newRack, cloneBalls, makeStrike, resolveShot, TABLE } from '../src/physics.js';
import { planShot, mulberry32, LEVELS } from '../src/ai.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`✅ ${name}  ${extra}`); }
  else { fail++; console.log(`❌ ${name}  ${extra}`); }
};

// balls for the simulator, kept in step with the rules state
function syncBalls(balls, state) {
  for (const b of state.balls) {
    const t = balls[b.n];
    if (!t) continue;
    t.x = b.x; t.z = b.z;
    t.state = b.state === 'pocketed' ? 'pocketed' : 'table';
    t.vx = t.vz = t.wx = t.wy = t.wz = 0;
    if (t.state === 'pocketed') t.sink = 0.06;
  }
  return balls;
}

function playMatch(aLevel, bLevel, seed, opts = {}) {
  const rng = mulberry32(seed);
  const state = newMatch({
    game: opts.game || '8ball',
    players: [
      { name: `AI-${LEVELS[aLevel - 1].name}`, isAI: true, level: aLevel },
      { name: `AI-${LEVELS[bLevel - 1].name}`, isAI: true, level: bLevel },
    ],
    breaker: seed % 2,
    stake: opts.stake || 0,
    shotClock: 30,
  });
  const balls = syncBalls(newRack(state.game), state);
  const stats = { shots: 0, pots: 0, fouls: 0, scratches: 0, aiMs: 0, simMs: 0, placements: 0, safeties: 0, invalid: 0 };
  const seen = [];

  while (state.phase !== PHASE.OVER && state.shotNumber < 120) {
    const pi = state.turn;
    const L = pi === 0 ? aLevel : bLevel;
    if (state.ballInHand) {
      // place the cue ball where the player (AI) wants it
      const plan0 = (() => {
        const t0 = performance.now();
        const p = planShot(state, balls, L, rng);
        stats.aiMs += performance.now() - t0;
        return p;
      })();
      if (plan0.placement) { placeCue(state, plan0.placement.x, plan0.placement.z); stats.placements++; }
      else {
        // find any legal spot
        let placed = false;
        for (let x = -TABLE.HL / 2; x <= TABLE.HL / 2 && !placed; x += 0.04) {
          for (let z = -TABLE.HW / 2; z <= TABLE.HW / 2 && !placed; z += 0.04) {
            if (placeCue(state, x, z).ok) placed = true;
          }
        }
        if (!placed) { state.ballInHand = false; }
      }
      syncBalls(balls, state);
    }

    const t0 = performance.now();
    const plan = planShot(state, balls, L, rng);
    stats.aiMs += performance.now() - t0;

    const strike = {
      dirX: plan.dirX, dirZ: plan.dirZ, power: plan.power,
      tipSide: plan.tipSide, tipVert: plan.tipVert,
    };
    const v = validateShot(state, strike);
    if (!v.ok) { stats.invalid++; seen.push(`shot ${state.shotNumber} rejected: ${v.why}`); break; }

    syncBalls(balls, state);
    const t1 = performance.now();
    const shot = resolveShot(balls, makeStrike(strike.dirX, strike.dirZ, strike.power, strike.tipSide, strike.tipVert));
    stats.simMs += performance.now() - t1;
    const res = shot.result();

    const before = { turn: state.turn, phase: state.phase };
    const out = applyResult(state, res);
    stats.shots++;
    if (out.foul) { stats.fouls++; if (res.pocketed.some((p) => p.n === 0)) stats.scratch++; }
    stats.pots += res.pocketed.filter((p) => p.n !== 0).length;
    if (plan.plan.kind === 'safety') stats.safeties++;
    seen.push(`#${state.shotNumber} ${state.players[before.turn].name.slice(3)} ${plan.plan.kind} ${plan.plan.target ?? ''} p=${strike.power.toFixed(2)} → ${out.foul ? 'FOUL: ' + out.reason : out.continuesTurn ? 'made, keep' : 'pass'}${out.pocketed && out.pocketed.length ? ' [' + res.pocketed.map((p) => p.n).join(',') + ']' : ''}`);
    syncBalls(balls, state);
  }
  return { state, stats, seen };
}

console.log('── rules unit checks ───────────────────────────────────────────────');
{
  const s = newMatch({ players: [{ name: 'A' }, { name: 'B' }] });
  ok('new match starts on the break', s.phase === PHASE.BREAK && s.open && s.turn === 0);
  ok('break: any object ball may be hit first', legalFirstBalls(s).length === 15);
  ok('rack is complete', s.balls.filter((b) => b.state === 'table').length === 16);
  ok('cue ball starts in the kitchen', s.balls[0].x <= -TABLE.L / 4 + 1e-9);

  // a legal break that pots a solid
  const balls = syncBalls(newRack('8ball'), s);
  const shot = resolveShot(balls, makeStrike(1, 0, 1.0, 0, 0));
  const out = applyResult(s, shot.result());
  ok('break advances to open play', s.phase === PHASE.PLAY, `${out.pocketed.length} potted on the break`);
  ok('table stays open after the break', s.open === true && s.players[0].group === null);
  ok('potting on the break keeps the table', out.continuesTurn === (out.pocketed.filter((p) => p.n !== 0).length > 0));

  // scratch gives ball in hand
  const s2 = newMatch({ players: [{ name: 'A' }, { name: 'B' }] });
  s2.phase = PHASE.PLAY; s2.open = false;
  s2.players[0].group = 'solids'; s2.players[1].group = 'stripes';
  const fake = { t: 2, pocketed: [{ n: 0, pocket: 1, t: 1 }], firstContact: { n: 1, speed: 2 }, railAfterContact: true, cushionHits: 2, cushionBeforeContact: 0, maxSpeed: 3 };
  const o2 = applyResult(s2, fake);
  ok('scratch is a foul', o2.foul && /cue ball/.test(o2.reason), o2.reason);
  ok('scratch hands the ball to the opponent', s2.turn === 1 && s2.ballInHand === true);

  // early 8 = loss
  const s3 = newMatch({ players: [{ name: 'A' }, { name: 'B' }] });
  s3.phase = PHASE.PLAY; s3.open = false;
  s3.players[0].group = 'solids'; s3.players[1].group = 'stripes';
  const o3 = applyResult(s3, { t: 3, pocketed: [{ n: 8, pocket: 0, t: 2 }], firstContact: { n: 8, speed: 3 }, railAfterContact: true, cushionHits: 1, cushionBeforeContact: 0, maxSpeed: 3 });
  ok('potting the 8 early loses the match', o3.winner === 1 && s3.phase === PHASE.OVER, s3.winReason);

  // clean 8 after clearing the group = win
  const s4 = newMatch({ players: [{ name: 'A' }, { name: 'B' }] });
  s4.phase = PHASE.PLAY; s4.open = false;
  s4.players[0].group = 'solids'; s4.players[1].group = 'stripes';
  for (const n of [1, 2, 3, 4, 5, 6, 7]) s4.balls[n].state = 'pocketed';
  ok('group cleared ⇒ shooter is on the 8', onEight(s4, 0) && legalFirstBalls(s4, 0).join() === '8');
  const o4 = applyResult(s4, { t: 5, pocketed: [{ n: 8, pocket: 3, t: 4 }], firstContact: { n: 8, speed: 2 }, railAfterContact: true, cushionHits: 1, cushionBeforeContact: 0, maxSpeed: 2 });
  ok('potting the 8 legally wins', o4.winner === 0 && s4.phase === PHASE.OVER, s4.winReason);

  // scratch while potting the 8 = loss
  const s5 = newMatch({ players: [{ name: 'A' }, { name: 'B' }] });
  s5.phase = PHASE.PLAY; s5.open = false;
  s5.players[0].group = 'stripes'; s5.players[1].group = 'solids';
  for (const n of [9, 10, 11, 12, 13, 14, 15]) s5.balls[n].state = 'pocketed';
  const o5 = applyResult(s5, { t: 5, pocketed: [{ n: 8, pocket: 3, t: 4 }, { n: 0, pocket: 1, t: 4.4 }], firstContact: { n: 8, speed: 2 }, railAfterContact: true, cushionHits: 1, cushionBeforeContact: 0, maxSpeed: 2 });
  ok('scratching on the 8 loses', o5.winner === 1, s5.winReason);

  // no rail after contact = foul
  const s6 = newMatch({ players: [{ name: 'A' }, { name: 'B' }] });
  s6.phase = PHASE.PLAY; s6.open = true;
  const o6 = applyResult(s6, { t: 1, pocketed: [], firstContact: { n: 3, speed: 0.4 }, railAfterContact: false, cushionHits: 0, cushionBeforeContact: 0, maxSpeed: 1 });
  ok('no rail after contact is a foul', o6.foul && /rail/.test(o6.reason), o6.reason);

  // three consecutive fouls
  const s7 = newMatch({ players: [{ name: 'A' }, { name: 'B' }] });
  s7.phase = PHASE.PLAY; s7.open = true;
  const soft = { t: 1, pocketed: [], firstContact: null, railAfterContact: false, cushionHits: 0, cushionBeforeContact: 0, maxSpeed: 0 };
  // fouls hand the turn over, so player A fouls on shots 1, 3 and 5
  applyResult(s7, soft); applyResult(s7, soft); applyResult(s7, soft); applyResult(s7, soft);
  const o7 = applyResult(s7, soft);
  ok('three consecutive fouls lose the match', o7.winner === 1, `${s7.players[0].streak} in a row`);

  // group assignment on an open table
  const s8 = newMatch({ players: [{ name: 'A' }, { name: 'B' }] });
  s8.phase = PHASE.PLAY; s8.open = true;
  const o8 = applyResult(s8, { t: 2, pocketed: [{ n: 12, pocket: 0, t: 1 }], firstContact: { n: 12, speed: 3 }, railAfterContact: true, cushionHits: 2, cushionBeforeContact: 0, maxSpeed: 3 });
  ok('the first legal pot assigns groups', s8.players[0].group === 'stripes' && s8.players[1].group === 'solids' && s8.open === false);
  ok('assignment keeps the turn', o8.continuesTurn === true);

  // validation
  ok('validateShot rejects an impossible power', !validateShot(s8, { dirX: 1, dirZ: 0, power: 9, tipSide: 0, tipVert: 0 }).ok);
  ok('validateShot rejects english off the tip', !validateShot(s8, { dirX: 1, dirZ: 0, power: 0.5, tipSide: 1, tipVert: 1 }).ok);
  ok('validateShot accepts a legal shot', validateShot(s8, { dirX: 0.6, dirZ: 0.8, power: 0.55, tipSide: 0.2, tipVert: -0.3 }).ok);
  ok('ball in hand needs a placement', !validateShot({ ...s8, ballInHand: true }, { dirX: 1, dirZ: 0, power: 0.5, tipSide: 0, tipVert: 0 }).ok);

  // 9-ball
  const s9 = newMatch({ game: '9ball', players: [{ name: 'A' }, { name: 'B' }] });
  ok('9-ball rack has 10 balls', s9.balls.filter((b) => b.state === 'table').length === 10);
  s9.phase = PHASE.PLAY;
  ok('9-ball must hit the lowest first', legalFirstBalls(s9).join() === '1');
  const o9 = applyResult(s9, { t: 2, pocketed: [{ n: 9, pocket: 0, t: 1 }], firstContact: { n: 1, speed: 3 }, railAfterContact: true, cushionHits: 2, cushionBeforeContact: 0, maxSpeed: 3 });
  ok('potting the 9 wins the rack', o9.winner === 0, s9.winReason);
}

console.log('\n── full AI matches (real physics, real rules) ──────────────────────');
{
  const t0 = performance.now();
  const m = playMatch(3, 3, 12345);
  const s = m.state;
  ok('a club-vs-club match finishes', s.phase === PHASE.OVER, `${m.stats.shots} shots · ${s.winReason}`);
  ok('a winner was decided', s.winner === 0 || s.winner === 1, `winner: ${s.players[s.winner].name}`);
  ok('balls were actually potted', m.stats.pots >= 8, `${m.stats.pots} object balls down`);
  ok('no shot was rejected by validation', m.stats.invalid === 0, m.seen.filter((x) => x.includes('rejected')).join('; '));
  ok('every ball ended in a legal state', s.balls.every((b) => ['table', 'pocketed'].includes(b.state)));
  ok('the match is fast enough to play', m.stats.aiMs / Math.max(1, m.stats.shots) < 900, `AI ${(m.stats.aiMs / m.stats.shots).toFixed(0)} ms/shot · sim ${(m.stats.simMs / m.stats.shots).toFixed(0)} ms/shot`);
  console.log('   shot log:');
  m.seen.slice(0, 14).forEach((x) => console.log('    ' + x));
  console.log(`   (total ${(performance.now() - t0).toFixed(0)} ms)`);
}

console.log('\n── difficulty actually means something ─────────────────────────────');
{
  const N = Number(process.argv[2] || 6);
  const tally = { expert: 0, rookie: 0, drawn: 0 };
  const t0 = performance.now();
  for (let i = 0; i < N; i++) {
    const m = playMatch(5, 1, 9000 + i * 37);
    if (m.state.phase !== PHASE.OVER) { tally.drawn++; continue; }
    if (m.state.winner === 0) tally.expert++; else tally.rookie++;
    process.stdout.write(`   match ${i + 1}: ${m.state.players[m.state.winner].name} wins in ${m.stats.shots} shots (${m.stats.pots} potted, ${m.stats.fouls} fouls)\n`);
  }
  ok('Legend beats Beginner most of the time', tally.expert > tally.rookie, `legend ${tally.expert} · beginner ${tally.rookie} · unfinished ${tally.drawn}  in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  ok('matches finish inside a sane shot count', tally.drawn === 0);
}

console.log(fail ? `\n❌ ${fail} check(s) failed\n` : `\n🎱 all game checks passed\n`);
process.exit(fail ? 1 : 0);
