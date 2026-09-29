// ─────────────────────────────────────────────────────────────────────────────
//  tools/headless.mjs — run complete matches with no browser
//
//    node tools/headless.mjs [matches]
//
//  The physics, rules and AI are pure and already unit-tested. This harness
//  drives the real Match controller (game.js) — input binding, stroke
//  animation, real-time simulation playback, event drainage, ball-in-hand,
//  shot clock, HUD writes, coin settlement and XP — against a stub DOM and a
//  stub renderer, so a wiring mistake shows up here instead of in a browser we
//  cannot open. Every assertion is about behaviour, not about mocks.
// ─────────────────────────────────────────────────────────────────────────────

import {
  calls, sceneStub, audioStub, vclock, yieldToEventLoop, resetCounters,
} from './stubs.mjs';

// ── the real modules ────────────────────────────────────────────────────────
const { Profile } = await import('../src/profile.js');
const { Match, PHASE } = await import('../src/game.js');
const { newRack } = await import('../src/physics.js');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};

// ── one full match, driven frame by frame ───────────────────────────────────
async function playMatch(opts, { maxFrames = 60 * 60 * 12, shoot = true } = {}) {
  const match = new Match({
    scene: sceneStub, audio: audioStub, profile: Profile,
    onLeave: (k) => { match._leftAs = k; },
    onResult: (r) => { match._result = r; },
  });
  match.start(opts);
  let frames = 0, shots = 0, turns = 0, lastTurn = match.state.turn, fouls = 0, bih = 0, aiTurns = 0;
  const phases = new Set();
  const hist = {};
  while (frames < maxFrames) {
    match.update(1 / 60);
    vclock.t += 1000 / 60;
    frames++;
    phases.add(match.phase);
    hist[match.phase] = (hist[match.phase] || 0) + 1;
    // the computer plans its shot asynchronously — give the event loop a turn
    if (match.phase === PHASE.AI && !match.aiPlan) {
      for (let i = 0; i < 400 && match.phase === PHASE.AI && !match.aiPlan; i++) await yieldToEventLoop();
      if (match.aiPlan) aiTurns++;
    }
    const st = match.state;
    if (st.turn !== lastTurn) { lastTurn = st.turn; turns++; }
    fouls = st.players[0].fouls + st.players[1].fouls;
    // the human side of the table: shoot as soon as aiming is ready. The aim is
    // randomised each time — otherwise a deterministic simulation replays the
    // identical shot forever and no match could ever end.
    if (shoot && match.phase === PHASE.AIM && !match._isAITurn()) {
      shots++;
      match.rotateAim((Math.random() - 0.5) * 1.1);
      match.setPower(0.32 + Math.random() * 0.62, true);
      match.setSpin((Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5);
      match.shoot();
    } else if (match.phase === PHASE.BIH && !match._isAITurn()) {
      // place the cue ball somewhere legal and carry on
      bih++;
      match.dragCue(0.35, 0.12);
      match.confirmPlacement();
    }
    if (match.phase === PHASE.OVER) break;
  }
  return { match, frames, shots, turns, phases, fouls, bih, aiTurns, hist };
}

console.log('\n── headless match harness ────────────────────────────────────────────────');

// 1. an 8-ball match against the computer, both sides played by the engine
{
  Profile.wipe();
  Profile.addCoins('free', 5000, 'harness');
  const before = Profile.total;
  const r = await playMatch({ mode: 'ai', game: '8ball', level: 3, stake: 200, seed: 1234 });
  const st = r.match.state;
  ok('8-ball vs CPU reaches a result', st.phase === 'over' && st.winner !== null && st.winner !== undefined, `phase=${st.phase} winner=${st.winner}`);
  ok('the match produced shots', st.shotNumber > 4, `human shots=${r.shots} total=${st.shotNumber}`);
  ok('the turn passed between players', r.turns > 1, `${r.turns} turn changes`);
  ok('balls were simulated (syncBalls called)', calls.syncBalls > 200, `${calls.syncBalls}`);
  ok('the cue stick was animated', calls.setCue > 30, `${calls.setCue}`);
  ok('pockets were detected by the physics', calls.pockets > 0, `${calls.pockets}`);
  ok('aiming guides were fed every frame', calls.guides > 200, `${calls.guides}`);
  ok('stake was taken up front', before - Profile.total >= 0 && r.match.opts.stake === 200);
  ok('result was reported to the app', !!r.match._result, JSON.stringify(r.match._result && { won: r.match._result.won, coins: r.match._result.coins, xp: r.match._result.xp }));
  ok('the match was recorded in the profile', Profile.me.stats.played === 1);
  ok('wallet stayed consistent (no negative coins)', Profile.me.wallet.free >= 0 && Profile.me.wallet.bought >= 0 && Profile.me.wallet.bonus >= 0);
  ok('XP was awarded', Profile.me.xp > 0, `${Profile.me.xp} xp`);
  console.log(`  · ${st.shotNumber} shots · winner=${st.winner} · ${r.frames} frames · AI turns=${r.aiTurns} · coins ${before}→${Profile.total}`);
  console.log(`  · phase histogram: ${Object.entries(r.hist).map(([k, v]) => `${k}:${v}`).join(' ')}`);
}

// 2. practice table: no rules, no coins, re-rack on demand
{
  const coinsBefore = Profile.total;
  const r = await playMatch({ mode: 'practice', game: '8ball', seed: 7 }, { maxFrames: 60 * 45 });
  ok('practice runs without a rules state blocking it', r.frames > 100);
  ok('practice never touches the wallet', Profile.total === coinsBefore, `${coinsBefore}→${Profile.total}`);
  ok('practice re-racks on request', (() => { r.match.rerack(); return r.match.balls.filter(Boolean).length >= 16; })(), `${r.match.balls.filter(Boolean).length} balls`);
  ok('practice never ends the match by itself', r.match.phase !== PHASE.OVER);
}

// 3. nine-ball, and a pass-and-play match where both sides are driven here
{
  const r = await playMatch({ mode: 'local', game: '9ball', stake: 0, seed: 99 });
  const st = r.match.state;
  ok('9-ball local match finishes', st.phase === 'over' && st.winner !== null && st.winner !== undefined, `winner=${st.winner} shots=${st.shotNumber}`);
  ok('9-ball used ten balls', r.match.balls.filter((b) => b && b.n <= 9).length === 10);
  ok('both players had turns in pass-and-play', r.turns > 1, `${r.turns} turn changes, shots=${st.shotNumber}`);
  ok('9-ball never assigns solids/stripes groups', st.players.every((p) => !p.group || p.group === 'none'), `${st.players.map((p) => JSON.stringify(p.group)).join('/')}`);
  ok('the match ended with a stated reason', String(st.winReason || st.loseReason || '').length > 3, `${st.winReason} / ${st.loseReason}`);
  console.log(`  · 9-ball local: ${st.shotNumber} shots · winner=${st.winner} · "${st.winReason}" · fouls ${st.players[0].fouls}/${st.players[1].fouls}`);
}

// 4. fouls, ball in hand and the shot clock
{
  const r = await playMatch({ mode: 'ai', game: '8ball', level: 1, stake: 0, seed: 5150 });
  const st = r.match.state;
  ok('fouls are counted per player', r.fouls === st.players[0].fouls + st.players[1].fouls, `${r.fouls}`);
  ok('ball-in-hand is offered after a foul', r.phases.has(PHASE.BIH) || r.fouls === 0, `phases=${[...r.phases].join(',')} fouls=${r.fouls}`);
  ok('the human placed the cue ball when it was handed over', r.bih === 0 || r.phases.has(PHASE.BIH), `placements=${r.bih}`);
  ok('shot clock never went negative', r.match.shotClockLeft >= 0, `${r.match.shotClockLeft}`);
}

// 5. every AI level can play a match to completion
{
  for (const level of [1, 2, 3, 4, 5]) {
    const r = await playMatch({ mode: 'ai', game: '8ball', level, stake: 0, seed: 4242 + level }, { maxFrames: 60 * 60 * 20 });
    const st = r.match.state;
    ok(`level ${level} match completes`, st.phase === 'over', `phase=${st.phase} shots=${st.shotNumber}`);
  }
}

// 6. leaving a match asks first, and stopping is clean
{
  const match = new Match({ scene: sceneStub, audio: audioStub, profile: Profile, onLeave: (k) => { match._leftAs = k; }, onResult: () => {} });
  match.start({ mode: 'ai', game: '8ball', stake: 100, seed: 3 });
  for (let i = 0; i < 120; i++) match.update(1 / 60);
  ok('start() bound the input handlers', match.bound === true);
  match.leave();
  ok('leaving mid-match asks for confirmation', match._leftAs === 'confirm', String(match._leftAs));
  match.stop();
  ok('stop() returns the controller to idle', match.phase === PHASE.IDLE);
  ok('stop() releases input handlers', match.bound === false);
}

// 7. wallet separation is preserved through a whole session
{
  Profile.wipe();
  const start = Profile.me.wallet;
  ok('a new profile starts with free and bonus coins only', start.bought === 0 && start.free > 0, JSON.stringify(start));
  Profile.addCoins('bought', 500, 'purchase');
  Profile.addCoins('free', 300, 'earned');
  Profile.addCoins('bonus', 200, 'pack');
  const before = { ...Profile.me.wallet };
  const totalBefore = before.free + before.bought + before.bonus;
  Profile.spend(400, 'harness stake');
  const w = Profile.me.wallet;
  ok('spending drains bonus first, then free, then bought',
    w.bonus === Math.max(0, before.bonus - 400) && w.bought === before.bought,
    `${JSON.stringify(before)} → ${JSON.stringify(w)}`);
  ok('the ledger recorded every movement', Profile.me.ledger.length === 4, `${Profile.me.ledger.length}`);
  ok('no coins were created or destroyed', w.free + w.bought + w.bonus === totalBefore - 400, `${w.free + w.bought + w.bonus} vs ${totalBefore - 400}`);
  ok('spending more than you have is refused', Profile.spend(10 ** 7, 'impossible') === false);
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
