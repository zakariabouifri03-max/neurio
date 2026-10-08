// Node tests for the futsal simulation, tournament and save logic. Run: node --test futsal/tests
import test from 'node:test';
import assert from 'node:assert/strict';
import { MatchManager } from '../src/sim/MatchManager.js';
import { TeamManager } from '../src/sim/TeamManager.js';
import { TEAM_DEFS } from '../src/data/teams.js';
import { TournamentManager } from '../src/tournament.js';
import { SaveManager, DEFAULT_SETTINGS } from '../src/save.js';
import { QUALITY, CAMERA_MODES, PITCH, BALL } from '../src/config.js';

const STEP = 1 / 60;
function demo(seed) {
  return new MatchManager({
    mode: 'demo', halfMinutes: 3, seed, difficulty: 'normal',
    homeDef: TeamManager.findDef('madrid-lions'), awayDef: TeamManager.findDef('tokyo-falcons'),
  });
}

test('config: presets, camera modes and pitch values exist', () => {
  assert.deepEqual(Object.keys(QUALITY), ['LOW', 'MEDIUM', 'HIGH', 'ULTRA']);
  assert.equal(CAMERA_MODES.length, 4);
  assert.equal(PITCH.halfLength * 2, 40);
  assert.equal(PITCH.halfWidth * 2, 20);
  assert.ok(BALL.radius > 0);
});

test('team data: at least eight original teams with unique ids and kits', () => {
  assert.ok(TEAM_DEFS.length >= 8);
  assert.equal(new Set(TEAM_DEFS.map((t) => t.id)).size, TEAM_DEFS.length);
  for (const t of TEAM_DEFS) {
    assert.ok(t.home.shirt && t.away.shirt, `${t.id} has kits`);
  }
});

test('match: each side has a goalkeeper and four outfield players', () => {
  const m = demo(3);
  for (const team of m.teams) {
    assert.equal(team.players.filter((p) => p.role === 'GK').length, 1);
    assert.equal(team.players.filter((p) => p.role !== 'GK').length, 4);
  }
});

test('match: five simulated minutes stay finite and the ball never tunnels', () => {
  const m = demo(7);
  let nan = 0, maxStep = 0, last = { ...m.ball.pos };
  for (let i = 0; i < 60 * 300; i++) {
    m.update(STEP, null);
    const b = m.ball.pos;
    if (!Number.isFinite(b.x) || !Number.isFinite(b.z)) nan++;
    for (const f of m.allPlayers) if (!Number.isFinite(f.pos.x) || !Number.isFinite(f.pos.z)) nan++;
    if (!m.ball.dead && !m.ball.glide) maxStep = Math.max(maxStep, Math.hypot(b.x - last.x, b.z - last.z));
    last = { ...b };
  }
  assert.equal(nan, 0);
  // kicks may nudge the ball up to ~2 m in one frame (see README "known limits"); anything larger is a bug
  assert.ok(maxStep < 2.5, `max ball step ${maxStep.toFixed(2)}`);
});

test('match: same seed gives the same result (deterministic)', () => {
  const run = (seed) => {
    const m = demo(seed);
    for (let i = 0; i < 60 * 120; i++) m.update(STEP, null);
    return JSON.stringify(m.summary().score) + m.clock.toFixed(3);
  };
  assert.equal(run(11), run(11));
});

test('match: a full quick match finishes and reports a summary', () => {
  const m = new MatchManager({
    mode: 'quick', halfMinutes: 2, seed: 5, difficulty: 'normal',
    homeDef: TeamManager.findDef('madrid-lions'), awayDef: TeamManager.findDef('tokyo-falcons'), humanHome: false,
  });
  let guard = 0;
  while (!m.finished && guard++ < 200000) m.update(STEP, null);
  assert.ok(m.finished, 'match finished');
  const s = m.summary();
  assert.equal(s.score.length, 2);
  assert.equal(s.players.length, 2);
  assert.ok(Math.abs(s.possession[0] + s.possession[1] - 100) < 2);
});

test('tournament: four teams, semis then final, winner recorded', () => {
  const t = TournamentManager.create(TEAM_DEFS[0].id);
  const strength = Object.fromEntries(TEAM_DEFS.map((x) => [x.id, 7]));
  assert.equal(t.state.field.length, 4);
  assert.equal(t.nextMatch().round, 'semi');
  t.record('sf1', [2, 1], strength);
  t.record('sf2', [0, 3], strength);
  assert.equal(t.nextMatch().round, 'final');
  t.record('final', [1, 1], strength, () => 0.1);   // draw: decider goes to home (low roll)
  assert.ok(t.isComplete());
  assert.ok(t.state.champion);
  // a tournament round-trips through JSON (the save format)
  const back = TournamentManager.fromState(JSON.parse(JSON.stringify(t.toJSON())));
  assert.equal(back.state.champion, t.state.champion);
});

test('save: defaults are used when storage is missing or corrupt', () => {
  const store = new Map();
  const fake = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const a = new SaveManager(fake);
  assert.equal(a.settings.quality, DEFAULT_SETTINGS.quality);
  a.setSetting('quality', 'ULTRA');
  const b = new SaveManager(fake);
  assert.equal(b.settings.quality, 'ULTRA');
  store.set('neurio-futsal-v1', '{not json');
  const c = new SaveManager(fake);
  assert.equal(c.settings.quality, DEFAULT_SETTINGS.quality);
});
