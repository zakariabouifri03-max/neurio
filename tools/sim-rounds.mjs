// Headless authority test: plays full games with bots and asserts the invariants.
//   node tools/sim-rounds.mjs [games] [rounds]
import { Room } from '../shared/engine.js';
import { ALL_ROUNDS, TAGS } from '../shared/content.js';

const GAMES = Number(process.argv[2] || 8);
const ROUNDS_PER = Number(process.argv[3] || 6);
let errors = 0;
const seenTags = new Set();
const seenRound = new Set();

function fail(msg) { errors++; console.log('  ✗ ' + msg); }

for (let g = 0; g < GAMES; g++) {
  let clock = 1000;
  const room = new Room({ rngSeed: 1000 + g * 77, now: () => clock });
  const n = 2 + (g % 7);
  const pids = [];
  for (let i = 0; i < n; i++) pids.push(room.addBot('B' + i).pid);
  for (const p of room.players.values()) p.ready = true;
  room.settings.rounds = ROUNDS_PER;
  room.settings.strictReady = false;
  room.startGame();

  let guard = 0;
  let finalPhase = false;
  while (guard++ < 40000) {
    clock += 50;
    room.now = clock;
    // let a "human" seat exist: emulate a client that reads its view and clicks things
    for (const pid of pids) {
      const v = room.view(pid);
      if (!v.me) continue;
      if (v.phase === 'submit' && !v.me.locked && v.options && v.options.length) {
        if (Math.random() < 0.35) room.handle(pid, { t: 'act', id: 'commit', p: { choice: v.options[Math.floor(Math.random() * v.options.length)].id } });
      }
      if (v.phase === 'submit' && v.roundInfo?.accuse && Math.random() < 0.2) {
        const other = pids.find((x) => x !== pid);
        if (other) room.handle(pid, { t: 'accuse', target: other });
      }
      if (v.phase === 'talk' && v.actions?.length && Math.random() < 0.25) {
        const a = v.actions[Math.floor(Math.random() * v.actions.length)];
        room.handle(pid, { t: 'act', id: a.id, p: { target: pids.find((x) => x !== pid), cases: [0, 1], lots: [0], amount: 2, choice: undefined } });
      }
      if (v.offers?.length) {
        for (const o of v.offers) if (o.to === pid && o.status === 'open' && Math.random() < 0.5) room.handle(pid, { t: 'offerResp', id: o.id, accept: Math.random() < 0.6 });
      }
      if (v.roundInfo?.offers && v.phase === 'talk' && Math.random() < 0.12) {
        const to = pids.find((x) => x !== pid);
        const inv = v.inv || [];
        room.handle(pid, {
          t: 'offer', to,
          giveItem: inv[0]?.uid, wantItem: (room.view(to).inv || [])[0]?.uid,
          giveChips: inv.length ? 0 : 60, wantChips: 40, note: 'quick, no pressure',
        });
      }
      if (v.roundInfo?.push && Math.random() < 0.1) room.handle(pid, { t: 'push', on: true });
      if (Math.random() < 0.02) room.handle(pid, { t: 'chat', text: 'i would never fold on you here' });
      if (Math.random() < 0.02) room.handle(pid, { t: 'emote', id: Math.floor(Math.random() * 12) });
      if (Math.random() < 0.05) room.handle(pid, { t: 'move', x: (Math.random() - 0.5) * 30, z: (Math.random() - 0.5) * 30, r: Math.random() * 9 });
    }
    for (const p of room.players.values()) { p.isBot = false; } // stop bots so the human path is exercised too
    room.tick(50);
    for (const a of room.round?.awards || []) seenTags.add(a.tag);
    if (room.round) seenRound.add(room.round.id);
    if (room.state === 'final') { finalPhase = true; break; }
    if (room.state === 'lobby' && guard > 40) break;
  }
  // invariants
  if (!finalPhase) fail('game ' + g + ' never reached FINAL (guard=' + guard + ', phase=' + room.state + ')');
  for (const p of room.players.values()) {
    if (!Number.isFinite(p.chips)) fail('NaN chips for ' + p.name);
    if (p.chips < 0) fail('negative chips for ' + p.name);
    if (p.chips > 100000) fail('absurd chips for ' + p.name + ': ' + p.chips);
  }
  if (finalPhase) {
    const board = [...room.players.values()].sort((a, b) => b.chips - a.chips);
    console.log('  game ' + g + ' · ' + n + 'p · ' + board.map((p) => p.name + ':' + p.chips).join('  '));
  }
}

// every scenario must at least run
for (const def of ALL_ROUNDS) {
  let clock = 0;
  const room = new Room({ rngSeed: 42, now: () => clock });
  const ids = []; for (let i = 0; i < 4; i++) ids.push(room.addBot('T' + i).pid);
  for (const p of room.players.values()) p.ready = true;
  room.plan = [{ id: def.id, kind: def.kind }];
  room.roundIndex = -1; room.state = 'lobby';
  try {
    room.nextRound();
    clock += (room.round.times.talk + room.round.times.brief + room.round.times.submit + 5000);
    room.now = clock;
    // force commits so resolve has data
    for (const pid of ids) {
      const opts = def.optionsFor?.(room.roundCtx, pid) || [];
      if (opts.length) room.handle(pid, { t: 'act', id: 'commit', p: { choice: opts[0].id } });
      for (const a of (room.actionsFor(pid) || [])) {
        room.handle(pid, { t: 'act', id: a.id, p: { target: ids.find((x) => x !== pid), cases: [0, 1], lots: [0], amount: 1 } });
      }
    }
    while (room.state !== 'reveal' && room.state !== 'results' && clock < 1e9) { clock += 100; room.now = clock; room.tick(100); }
    if (!room.round.beats.length && def.kind !== 'minigame') fail(def.id + ': deception round produced no reveal beats');
    if (!room.round.awards.length) fail(def.id + ': no awards at all');
    console.log('  ✓ ' + def.id.padEnd(14) + ' beats=' + String(room.round.beats.length).padStart(2) + ' awards=' + String(room.round.awards.length).padStart(2) + ' tag=' + room.state);
  } catch (e) {
    errors++;
    console.log('  ✗ ' + def.id + ' threw: ' + (e?.stack || e));
  }
}

console.log('\nrounds seen: ' + [...seenRound].length + '/' + ALL_ROUNDS.length + ' · tags seen: ' + [...seenTags].join(','));
const missingTags = Object.keys(TAGS).filter((t) => !seenTags.has(t));
if (missingTags.length) console.log('tags never awarded this run: ' + missingTags.join(', '));
console.log(errors ? '\n' + errors + ' PROBLEM(S)' : '\nALL GOOD');
process.exit(errors ? 1 : 0);
