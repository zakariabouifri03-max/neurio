// Neurio Futsal — app entry: screens, match sessions, tournament flow, renderer and fixed-step loop.
import * as THREE from 'three';
import { QUALITY, MATCH, DIFFICULTY, CAMERA_MODES } from './config.js';
import { TEAM_DEFS } from './data/teams.js';
import { MatchManager } from './sim/MatchManager.js';
import { TeamManager } from './sim/TeamManager.js';
import { InputManager } from './input.js';
import { SaveManager, DEFAULT_SETTINGS } from './save.js';
import { AudioManager } from './audio.js';
import { buildArena } from './render/arena.js';
import { MatchView } from './render/matchView.js';
import { CameraController } from './render/camera.js';
import { UIManager } from './ui/UIManager.js';
import { TournamentManager } from './tournament.js';

const STEP = 1 / 60;
const RESTART_NAMES = { kickoff: 'Kick-off', kickIn: 'Kick-in', corner: 'Corner', goalKick: 'Goal kick', freeKick: 'Free kick', penalty: 'Penalty' };
const CAM_NAMES = { broadcast: 'Broadcast', player: 'Player', close: 'Close', training: 'Training' };
const KEY_HINTS = 'WASD move · Shift sprint · Space tackle · J pass · K shoot · L through · Q switch · E press · C skill · R keeper rush · F lob · V camera · Esc pause';
const PAD_HINTS = 'Left stick move · A pass · B shoot · X tackle · Y through · LB/RB switch · LT sprint · R3 press · L3 skill · D-pad ↑ keeper rush · Back camera · Start pause';

// ---------- core services ----------
const save = new SaveManager();
const input = new InputManager();
const audio = new AudioManager();
const ui = new UIManager();
const settings = save.settings;

const stage = document.getElementById('stage');
const viewEl = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
viewEl.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 400);
const cam = new CameraController(camera);

let q = QUALITY[settings.quality] || QUALITY.MEDIUM;
let arena = null;
let session = null;     // { match, view, pc, mode, paused, acc, cfg, bg, tournamentMatchId, ... }
let tournament = TournamentManager.fromState(save.data.tournament);
let quickPick = null;   // remembered selection for the team screen

// ---------- rendering setup ----------
function applyQuality() {
  q = QUALITY[settings.quality] || QUALITY.MEDIUM;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2) * q.pixelRatio);
  renderer.shadowMap.enabled = q.shadows;
  rebuildArena();
}

function rebuildArena() {
  if (arena) {
    scene.remove(arena.group);
    arena.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
    });
  }
  arena = buildArena(scene, q);
  if (session && session.view) {
    // the view lives in the scene; rebuild the figures with the new shadow setting
    const { match } = session;
    session.view.dispose();
    session.view = new MatchView(scene, match, q);
  }
}

function applyDisplay() {
  stage.classList.remove('windowed', 'borderless', 'fullscreen');
  stage.classList.add(settings.display);
  const aspect = settings.aspect === '16:10' ? 16 / 10 : 16 / 9;
  document.documentElement.style.setProperty('--aspect', String(aspect));
  if (settings.display === 'fullscreen') {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  } else if (document.fullscreenElement && document.exitFullscreen) {
    document.exitFullscreen().catch(() => {});
  }
  resize();
}

function resize() {
  const w = viewEl.clientWidth || window.innerWidth;
  const h = viewEl.clientHeight || window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(viewEl);
window.addEventListener('resize', resize);

audio.setVolumes(settings.sfxVolume, settings.crowdVolume);
ui.onSound = (name) => { if (name === 'click') audio.uiClick(); };
const unlockAudio = () => audio.ensure();
window.addEventListener('pointerdown', unlockAudio);
window.addEventListener('keydown', unlockAudio);

// ---------- helpers ----------
const teamOptions = () => TEAM_DEFS.map((t) => t.name);
const pick = (arr, i) => arr[((i % arr.length) + arr.length) % arr.length];
const halfOptions = MATCH.halfMinuteOptions;
const diffKeys = Object.keys(DIFFICULTY);
const cycle = (list, cur, dir) => list[(list.indexOf(cur) + dir + list.length) % list.length];

function teamIndexById(id) { return Math.max(0, TEAM_DEFS.findIndex((t) => t.id === id)); }

// Headless match: used for AI-vs-AI games inside a tournament. Runs the full simulation fast.
function simulateHeadless(homeId, awayId, seed) {
  const m = new MatchManager({
    mode: 'quick', halfMinutes: 3, difficulty: 'normal', seed,
    homeDef: TeamManager.findDef(homeId), awayDef: TeamManager.findDef(awayId), humanHome: false,
  });
  let guard = 0;
  while (!m.finished && guard++ < 400000) m.update(STEP, null);
  return m.summary();
}

// ---------- match sessions ----------
function endSession() {
  if (!session) return;
  if (session.view) session.view.dispose();
  session.unsubs.forEach((u) => u());
  session = null;
}

function startSession(cfg) {
  endSession();
  const homeDef = TeamManager.findDef(cfg.homeId);
  const awayDef = TeamManager.findDef(cfg.awayId);
  const seed = cfg.seed || ((Math.random() * 1e9) | 0);
  const match = new MatchManager({
    mode: cfg.mode,
    halfMinutes: cfg.halfMinutes || settings.halfMinutes,
    difficulty: cfg.difficulty || settings.difficulty,
    seed,
    homeDef, awayDef,
    humanHome: cfg.mode !== 'demo' && cfg.human !== false,
    opponents: cfg.opponents,
  });
  const view = new MatchView(scene, match, q);
  session = {
    match, view, cfg,
    pc: match.controllers[0] || null,
    paused: false, acc: 0,
    bg: cfg.mode === 'demo' && !cfg.watch,
    unsubs: [],
    lastCallout: '',
    finished: false,
  };
  bindMatchEvents(session);
  if (session.pc) session.pc.input = input;
  const camMode = cfg.mode === 'training' || cfg.mode === 'shooting' ? (settings.camera === 'broadcast' ? 'training' : settings.camera) : settings.camera;
  cam.setMode(cfg.mode === 'demo' ? 'broadcast' : camMode);
  const hintHtml = `${KEY_HINTS}${settings.showHints ? `<br>${PAD_HINTS}` : ''}`;
  session.hints = hintHtml;
  const showHud = !session.bg;
  ui.showHud(showHud);
  if (showHud) {
    ui.setHud({ homeName: match.teams[0].short, awayName: match.teams[1].short, homeColor: match.teams[0].kit.shirt, awayColor: match.teams[1].kit.shirt, score: [0, 0], clock: '00:00', half: '', ctlName: '', ctlMeta: '', stamina: 1, charge: 0, camLabel: CAM_NAMES[cam.mode], hints: session.hints, showControl: true });
    ui.say(cfg.mode === 'shooting' ? 'Shooting drill' : cfg.mode === 'training' ? 'Practice' : 'Kick-off', '', 1.6);
  }
  ui.hideOverlay();
  audio.ensure();
  return session;
}

function bindMatchEvents(s) {
  const m = s.match;
  const on = (name, fn) => s.unsubs.push(m.on(name, fn));
  on('kick', (e) => { audio.kick(e.power || 0.5); });
  on('bounce', (e) => { audio.bounce(e.strength || 0.5); });
  on('post', () => audio.post());
  on('save', () => audio.save());
  on('tackleWon', () => audio.tackle());
  on('slideContact', () => audio.tackle());
  on('whistle', (e) => audio.whistle(e.kind));
  on('callout', (e) => {
    if (s.bg) return;
    ui.say(e.text, e.text.includes('FOUL') ? 'warn' : '', 1.1);
    audio.callout();
  });
  on('goal', (e) => {
    audio.goal();
    audio.setCrowdLevel(1);
    ui.flash();
    if (s.bg) return;
    const who = e.scorer ? e.scorer.name : 'Goal';
    ui.say(`GOAL! ${m.teams[e.teamIndex].short}`, 'goal', 2.4);
    ui.restart(`${who}${e.assist ? ` · assist ${e.assist.name}` : ''}${e.own ? ' (own goal)' : ''}`, 3.2);
  });
  on('restart', (e) => {
    if (s.bg) return;
    const name = RESTART_NAMES[e.type] || 'Play on';
    ui.restart(`${name} — ${m.teams[e.teamIndex].short}`, 1.8);
  });
  on('card', (e) => {
    audio.card(e.type === 'red');
    if (!s.bg) ui.say(`${e.type === 'red' ? 'Red' : 'Yellow'} card — ${e.f.name}`, 'warn', 2.2);
  });
  on('sentOff', (e) => { if (!s.bg) ui.say(`${e.f.name} is off`, 'warn', 2.2); });
  on('halftime', () => { if (!s.bg) ui.say('Half-time', '', 2.4); audio.setCrowdLevel(0.4); });
  on('secondHalf', () => { if (!s.bg) ui.say('Second half', '', 2.0); });
  on('drillEnd', (e) => { s.drill = e; });
}

// ---------- results + flow ----------
function showResults(summary, ctx = {}) {
  endSession();
  ui.showHud(false);
  if (ctx.mode === 'shooting') {
    const d = summary.drill || {};
    const html = `<p class="sub">Shooting drill complete</p><div class="scoreLine"><span>${d.goals || 0}</span><span class="tn">goals from ${d.shots || 0} shots</span></div>`;
    ui.show({ title: 'Drill results', html, items: [
      { id: 'again', label: 'Drill again', onOk: () => startTraining('shooting') },
      { id: 'menu', label: 'Back to menu', onOk: () => showMenu() },
    ], onBack: () => showMenu() });
    return;
  }
  const names = summary.names;
  const players = summary.players.flat().filter((p) => p.rating > 0).sort((a, b) => b.rating - a.rating).slice(0, 5);
  const teamRows = [
    ['Possession', `${summary.possession[0]}%`, `${summary.possession[1]}%`],
    ['Shots (on target)', `${summary.shots[0]} (${summary.shotsOn[0]})`, `${summary.shots[1]} (${summary.shotsOn[1]})`],
    ['Pass accuracy', `${summary.passAcc[0]}%`, `${summary.passAcc[1]}%`],
    ['Fouls', summary.fouls[0], summary.fouls[1]],
    ['Corners', summary.corners[0], summary.corners[1]],
    ['Saves', summary.saves[0], summary.saves[1]],
    ['Cards (Y/R)', `${summary.cards[0].yellow}/${summary.cards[0].red}`, `${summary.cards[1].yellow}/${summary.cards[1].red}`],
  ];
  const table = `<table class="stats"><tr><th>Stat</th><th>${names[0]}</th><th>${names[1]}</th></tr>${teamRows.map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join('')}</table>`;
  const playerTable = `<h2>Top players</h2><table class="stats"><tr><th>Player</th><th>Team</th><th>G</th><th>A</th><th>Pass</th><th>Rating</th></tr>${players.map((p) => `<tr><td>${p.number} ${p.name}</td><td>${summary.shortNames[p.team]}</td><td>${p.goals}</td><td>${p.assists}</td><td>${p.passesOk}/${p.passes}</td><td>${p.rating.toFixed(1)}</td></tr>`).join('')}</table>`;
  const goalLog = summary.goalLog.length ? `<h2>Goals</h2><div class="goalLog">${summary.goalLog.map((g) => `${g.minute || ''} ${g.scorer ? g.scorer.name : 'Goal'} (${summary.shortNames[g.teamIndex]})`).join('<br>')}</div>` : '';
  const html = `<div class="scoreLine"><span>${summary.score[0]}</span><span class="tn">${names[0]}</span><span>–</span><span class="tn">${names[1]}</span><span>${summary.score[1]}</span></div>${table}${playerTable}${goalLog}`;
  save.addResult(summary);
  const items = [];
  if (ctx.tournament) {
    items.push({ id: 'bracket', label: 'Continue tournament', onOk: () => showBracket() });
  }
  if (ctx.mode === 'quick') items.push({ id: 'rematch', label: 'Rematch', onOk: () => startQuick(ctx.cfg) });
  items.push({ id: 'menu', label: 'Back to menu', onOk: () => showMenu() });
  ui.show({ title: ctx.tournament ? 'Full time' : 'Full time', wide: true, html, items, onBack: () => showMenu() });
}

function showMenu() {
  endSession();
  ui.showHud(false);
  startBackgroundDemo();
  const hasT = !!(save.data.tournament && !save.data.tournament.champion);
  const items = [
    { id: 'quick', label: 'Quick Match', onOk: () => showTeamSelect('quick') },
    { id: 'tournament', label: 'Tournament', onOk: () => (hasT ? showBracket() : showTournamentSetup()) },
    { id: 'career', label: 'Career', disabled: true, tag: 'Not in this build' },
    { id: 'training', label: 'Training', onOk: () => showTraining() },
    { id: 'ai', label: 'AI vs AI', onOk: () => showTeamSelect('demo') },
    { id: 'settings', label: 'Settings', onOk: () => showSettings('menu') },
    { id: 'controls', label: 'Controls', onOk: () => showControls('menu') },
    { id: 'exit', label: 'Exit', onOk: () => showExit() },
  ];
  ui.show({ title: 'Neurio Futsal', sub: '5v5 indoor football · original teams and kits', items, bg: true, onBack: () => {} });
}

function showExit() {
  ui.show({ title: 'Exit', sub: 'This game runs in your browser. Close the tab or window to leave.', items: [
    { id: 'back', label: 'Back', onOk: () => showMenu() },
  ], onBack: () => showMenu() }, { bg: true });
  try { window.close(); } catch (e) { /* browsers may ignore this */ }
}

function showControls(back) {
  const html = `<div class="controlsGrid">
    <div><b>WASD</b> / arrows — move</div><div><b>Shift</b> — sprint</div>
    <div><b>J</b> — pass (hold for power)</div><div><b>K</b> — shoot (hold for power)</div>
    <div><b>L</b> — through pass</div><div><b>F</b> — lob modifier</div>
    <div><b>Space</b> — tackle / intercept</div><div><b>Q</b> — switch player</div>
    <div><b>E</b> — teammate press</div><div><b>C</b> — skill / dribble</div>
    <div><b>R</b> — keeper rush</div><div><b>V</b> — camera mode</div>
    <div><b>Esc</b> — pause</div><div></div>
    <div><b>Left stick</b> — move</div><div><b>Right stick</b> — aim</div>
    <div><b>A</b> pass · <b>B</b> shoot · <b>X</b> tackle</div><div><b>Y</b> through · <b>LB/RB</b> switch</div>
    <div><b>LT</b> — sprint / control modifier</div><div><b>R3</b> press · <b>L3</b> skill</div>
  </div>`;
  ui.show({ title: 'Controls', wide: true, html, items: [{ id: 'back', label: 'Back', onOk: () => (back === 'pause' ? showPause() : showMenu()) }], onBack: () => (back === 'pause' ? showPause() : showMenu()) });
}

function showTeamSelect(mode) {
  if (!quickPick || quickPick.mode !== mode) {
    quickPick = { mode, home: 0, away: 1, half: halfOptions.indexOf(settings.halfMinutes) >= 0 ? halfOptions.indexOf(settings.halfMinutes) : 1, diff: diffKeys.indexOf(settings.difficulty) };
  }
  const p = quickPick;
  const items = [
    { id: 'home', label: mode === 'demo' ? 'Team A' : 'Your team', value: TEAM_DEFS[p.home].name,
      onLeft: () => { p.home = (p.home + TEAM_DEFS.length - 1) % TEAM_DEFS.length; if (p.home === p.away) p.away = (p.away + 1) % TEAM_DEFS.length; ui.render(); },
      onRight: () => { p.home = (p.home + 1) % TEAM_DEFS.length; if (p.home === p.away) p.away = (p.away + 1) % TEAM_DEFS.length; ui.render(); } },
    { id: 'away', label: 'Opponent', value: TEAM_DEFS[p.away].name,
      onLeft: () => { p.away = (p.away + TEAM_DEFS.length - 1) % TEAM_DEFS.length; if (p.away === p.home) p.away = (p.away + TEAM_DEFS.length - 1) % TEAM_DEFS.length; ui.render(); },
      onRight: () => { p.away = (p.away + 1) % TEAM_DEFS.length; if (p.away === p.home) p.away = (p.away + 1) % TEAM_DEFS.length; ui.render(); } },
    { id: 'half', label: 'Half length', value: `${halfOptions[p.half]} min`,
      onLeft: () => { p.half = (p.half + halfOptions.length - 1) % halfOptions.length; ui.render(); },
      onRight: () => { p.half = (p.half + 1) % halfOptions.length; ui.render(); } },
    { id: 'diff', label: 'Difficulty', value: DIFFICULTY[diffKeys[p.diff]].label,
      onLeft: () => { p.diff = (p.diff + diffKeys.length - 1) % diffKeys.length; ui.render(); },
      onRight: () => { p.diff = (p.diff + 1) % diffKeys.length; ui.render(); } },
    { id: 'start', label: mode === 'demo' ? 'Watch the match' : 'Kick off', onOk: () => {
      settings.halfMinutes = halfOptions[p.half];
      settings.difficulty = diffKeys[p.diff];
      save.save();
      if (mode === 'demo') return startBackgroundDemo(TEAM_DEFS[p.home].id, TEAM_DEFS[p.away].id, true);
      startSession({ mode: 'quick', homeId: TEAM_DEFS[p.home].id, awayId: TEAM_DEFS[p.away].id, halfMinutes: halfOptions[p.half], difficulty: diffKeys[p.diff] });
      quickCfg = { mode: 'quick', homeId: TEAM_DEFS[p.home].id, awayId: TEAM_DEFS[p.away].id, halfMinutes: halfOptions[p.half], difficulty: diffKeys[p.diff] };
    } },
    { id: 'back', label: 'Back', onOk: () => showMenu() },
  ];
  ui.show({ title: mode === 'demo' ? 'AI vs AI' : 'Quick Match', sub: 'Pick the teams and match length. Original teams and kits.', items, onBack: () => showMenu(), bg: true });
}
let quickCfg = null;
function startQuick(cfg) {
  startSession({ ...cfg, mode: 'quick' });
  quickCfg = { ...cfg, mode: 'quick' };
}

function startTraining(kind) {
  const cfg = { mode: kind === 'shooting' ? 'shooting' : 'training', homeId: TEAM_DEFS[0].id, awayId: TEAM_DEFS[1].id, opponents: false };
  startSession(cfg);
}

function showTraining() {
  const items = [
    { id: 'free', label: 'Free practice', tag: 'no referee', onOk: () => startTraining('free') },
    { id: 'shoot', label: 'Shooting drill (60 s)', tag: 'score as many as you can', onOk: () => startTraining('shooting') },
    { id: 'back', label: 'Back', onOk: () => showMenu() },
  ];
  ui.show({ title: 'Training', sub: 'Practise on an empty pitch. Pause with Esc to change camera or settings.', items, onBack: () => showMenu(), bg: true });
}

function showTournamentSetup() {
  const p = { home: 0 };
  const items = [
    { id: 'team', label: 'Your team', value: TEAM_DEFS[p.home].name,
      onLeft: () => { p.home = (p.home + TEAM_DEFS.length - 1) % TEAM_DEFS.length; ui.render(); },
      onRight: () => { p.home = (p.home + 1) % TEAM_DEFS.length; ui.render(); } },
    { id: 'start', label: 'Start tournament', onOk: () => {
      tournament = TournamentManager.create(TEAM_DEFS[p.home].id);
      save.setTournament(tournament.toJSON());
      showBracket();
    } },
    { id: 'back', label: 'Back', onOk: () => showMenu() },
  ];
  ui.show({ title: 'Tournament', sub: 'Four teams, two semi-finals and a final. Your team is always in the first semi-final.', items, onBack: () => showMenu(), bg: true });
}

function bracketHtml() {
  const b = tournament.bracket();
  const row = (m) => {
    const name = (id) => TEAM_DEFS.find((t) => t.id === id).name;
    const sc = m.score ? `${m.score[0]} – ${m.score[1]}${m.penalties ? ` (pens: ${name(m.winner)})` : ''}` : 'vs';
    return `<div class="m ${m.user ? 'user' : ''}"><div class="label">${m.round === 'final' ? 'Final' : 'Semi-final'}${m.user ? ' · your team' : ''}</div><div>${name(m.home)} ${m.score ? '' : 'vs'} ${name(m.away)}</div><div style="color:var(--muted)">${sc}</div></div>`;
  };
  const champ = b.champion ? `<p class="sub">Champion: <b>${TEAM_DEFS.find((t) => t.id === b.champion).name}</b></p>` : '';
  return `${champ}<div class="bracket">${b.semi.map(row).join('')}${b.final ? row(b.final) : '<div class="m"><div class="label">Final</div><div>Winners of the semi-finals</div></div>'}</div>`;
}

function showBracket() {
  if (!tournament) return showTournamentSetup();
  const next = tournament.nextMatch();
  const items = [];
  if (next) {
    items.push({ id: 'play', label: next.user ? 'Play your match' : 'Simulate other matches', onOk: () => advanceTournament() });
  }
  items.push({ id: 'abandon', label: 'Abandon tournament', onOk: () => { tournament = null; save.clearTournament(); showMenu(); } });
  items.push({ id: 'back', label: 'Back', onOk: () => showMenu() });
  ui.show({ title: 'Tournament', wide: true, html: bracketHtml(), items, onBack: () => showMenu(), bg: true });
}

// Play AI games until the user's match is next (or the tournament ends), then start it.
function advanceTournament() {
  if (!tournament) return showMenu();
  let m = tournament.nextMatch();
  while (m && !m.user) {
    const sum = simulateHeadless(m.home, m.away, (Math.random() * 1e9) | 0);
    tournament.record(m.id, sum.score, strengthMap(), Math.random);
    m = tournament.nextMatch();
  }
  save.setTournament(tournament.toJSON());
  if (!m) return showChampion();
  const home = m.home === tournament.userTeamId ? m.home : m.home;
  const away = m.away;
  // the user's team always plays as home so their keyboard/pad controls the home side
  const userIsHome = home === tournament.userTeamId;
  const homeId = userIsHome ? home : away;
  const awayId = userIsHome ? away : home;
  startSession({ mode: 'quick', homeId, awayId, halfMinutes: settings.halfMinutes, difficulty: settings.difficulty, tournamentMatchId: m.id });
  quickCfg = { mode: 'quick', homeId, awayId, halfMinutes: settings.halfMinutes, difficulty: settings.difficulty };
}

function strengthMap() {
  const out = {};
  for (const t of TEAM_DEFS) out[t.id] = t.strength || 7;
  return out;
}

function showChampion() {
  const champ = TEAM_DEFS.find((t) => t.id === tournament.state.champion);
  const html = `<p class="sub">${champ ? `${champ.name} win the tournament.` : 'Tournament complete.'}</p>${bracketHtml()}`;
  ui.show({ title: 'Champions', wide: true, html, items: [
    { id: 'new', label: 'New tournament', onOk: () => { tournament = null; save.clearTournament(); showTournamentSetup(); } },
    { id: 'menu', label: 'Back to menu', onOk: () => showMenu() },
  ], onBack: () => showMenu(), bg: true });
}

function showSettings(back) {
  const s = settings;
  const onChange = (fn) => () => { fn(); save.save(); };
  const items = [
    { id: 'quality', label: 'Graphics', value: s.quality,
      onLeft: onChange(() => { s.quality = cycle(Object.keys(QUALITY), s.quality, -1); applyQuality(); }),
      onRight: onChange(() => { s.quality = cycle(Object.keys(QUALITY), s.quality, 1); applyQuality(); }) },
    { id: 'display', label: 'Display', value: s.display === 'windowed' ? 'Windowed' : s.display === 'borderless' ? 'Borderless' : 'Fullscreen',
      onLeft: onChange(() => { s.display = cycle(['windowed', 'borderless', 'fullscreen'], s.display, -1); applyDisplay(); }),
      onRight: onChange(() => { s.display = cycle(['windowed', 'borderless', 'fullscreen'], s.display, 1); applyDisplay(); }) },
    { id: 'aspect', label: 'Aspect ratio', value: s.aspect,
      onLeft: onChange(() => { s.aspect = cycle(['16:9', '16:10'], s.aspect, -1); applyDisplay(); }),
      onRight: onChange(() => { s.aspect = cycle(['16:9', '16:10'], s.aspect, 1); applyDisplay(); }) },
    { id: 'camera', label: 'Default camera', value: CAM_NAMES[s.camera],
      onLeft: onChange(() => { s.camera = cycle(CAMERA_MODES, s.camera, -1); }),
      onRight: onChange(() => { s.camera = cycle(CAMERA_MODES, s.camera, 1); }) },
    { id: 'sfx', label: 'Effects volume', value: `${Math.round(s.sfxVolume * 100)}`,
      onLeft: onChange(() => { s.sfxVolume = Math.max(0, +(s.sfxVolume - 0.1).toFixed(1)); audio.setVolumes(s.sfxVolume, s.crowdVolume); }),
      onRight: onChange(() => { s.sfxVolume = Math.min(1, +(s.sfxVolume + 0.1).toFixed(1)); audio.setVolumes(s.sfxVolume, s.crowdVolume); }) },
    { id: 'crowd', label: 'Crowd volume', value: `${Math.round(s.crowdVolume * 100)}`,
      onLeft: onChange(() => { s.crowdVolume = Math.max(0, +(s.crowdVolume - 0.1).toFixed(1)); audio.setVolumes(s.sfxVolume, s.crowdVolume); }),
      onRight: onChange(() => { s.crowdVolume = Math.min(1, +(s.crowdVolume + 0.1).toFixed(1)); audio.setVolumes(s.sfxVolume, s.crowdVolume); }) },
    { id: 'diff', label: 'Difficulty', value: DIFFICULTY[s.difficulty].label,
      onLeft: onChange(() => { s.difficulty = cycle(diffKeys, s.difficulty, -1); }),
      onRight: onChange(() => { s.difficulty = cycle(diffKeys, s.difficulty, 1); }) },
    { id: 'half', label: 'Half length', value: `${s.halfMinutes} min`,
      onLeft: onChange(() => { s.halfMinutes = cycle(halfOptions, s.halfMinutes, -1); }),
      onRight: onChange(() => { s.halfMinutes = cycle(halfOptions, s.halfMinutes, 1); }) },
    { id: 'hints', label: 'Control hints', value: s.showHints ? 'On' : 'Off',
      onOk: onChange(() => { s.showHints = !s.showHints; }), onLeft: onChange(() => { s.showHints = !s.showHints; }), onRight: onChange(() => { s.showHints = !s.showHints; }) },
    { id: 'back', label: 'Back', onOk: () => (back === 'pause' ? showPause() : showMenu()) },
  ];
  const html = `<p class="sub">Saved automatically. ${s.quality === 'LOW' ? 'LOW: no shadows, fewer spectators.' : s.quality === 'ULTRA' ? 'ULTRA: 4K-class shadows, most spectators.' : ''}</p>`;
  ui.show({ title: 'Settings', html, items, onBack: () => (back === 'pause' ? showPause() : showMenu()), bg: back !== 'pause' });
}

function showPause() {
  if (!session) return showMenu();
  session.paused = true;
  const items = [
    { id: 'resume', label: 'Resume', onOk: () => resumeSession() },
    { id: 'cam', label: 'Camera', value: CAM_NAMES[cam.mode], onOk: () => { cam.cycle(1); showPause(); }, onRight: () => { cam.cycle(1); showPause(); }, onLeft: () => { cam.cycle(-1); showPause(); } },
    { id: 'settings', label: 'Settings', onOk: () => showSettings('pause') },
    { id: 'controls', label: 'Controls', onOk: () => showControls('pause') },
    { id: 'quit', label: 'Quit to menu', onOk: () => { endSession(); tournamentPauseQuit(); } },
  ];
  ui.show({ title: 'Paused', items, onBack: () => resumeSession(), onPause: () => resumeSession() });
}

function tournamentPauseQuit() {
  showMenu();
}

function resumeSession() {
  if (!session) return showMenu();
  session.paused = false;
  ui.hideOverlay();
  ui.showHud(!session.bg);
}

// Full-time for a session: record and show the results.
function onSessionFinished(s) {
  s.finished = true;
  const summary = s.match.summary();
  if (s.match.mode === 'shooting') {
    showResults({ ...summary, drill: s.match.drill }, { mode: 'shooting' });
    return;
  }
  if (s.cfg.tournamentMatchId && tournament) {
    tournament.record(s.cfg.tournamentMatchId, summary.score, strengthMap(), Math.random);
    save.setTournament(tournament.toJSON());
    showResults(summary, { tournament: true, mode: 'quick', cfg: s.cfg });
    return;
  }
  showResults(summary, { mode: s.cfg.mode, cfg: s.cfg });
}

// Background AI match behind the menus (also used by the AI vs AI mode).
function startBackgroundDemo(homeId, awayId, watch = false) {
  const hi = Math.floor(Math.random() * TEAM_DEFS.length);
  const ai = (hi + 1 + Math.floor(Math.random() * (TEAM_DEFS.length - 1))) % TEAM_DEFS.length;
  const cfg = { mode: 'demo', homeId: homeId || TEAM_DEFS[hi].id, awayId: awayId || TEAM_DEFS[ai].id, halfMinutes: 3, watch };
  startSession(cfg);
  if (watch) {
    ui.showHud(true);
    session.bg = false;
    ui.setHud({ homeName: TEAM_DEFS.find((t) => t.id === cfg.homeId).short, awayName: TEAM_DEFS.find((t) => t.id === cfg.awayId).short, homeColor: session.match.teams[0].kit.shirt, awayColor: session.match.teams[1].kit.shirt, score: [0, 0], clock: '00:00', half: '', ctlName: 'AI vs AI', ctlMeta: 'watch only', stamina: 1, charge: 0, camLabel: CAM_NAMES[cam.mode], hints: 'Esc — menu', showControl: true });
  }
}

// ---------- main loop ----------
let last = performance.now();
let cameraHeld = false;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  input.poll(dt);
  const menuEvents = input.menuEvents();

  // global pause / menu input
  const pausePressed = input.consume('pause') || menuEvents.includes('pause');
  if (session && !session.bg && !session.finished) {
    if (pausePressed) {
      if (session.paused) resumeSession(); else showPause();
    }
    if (!ui.visible && menuEvents.length) { /* nothing, match input comes via input */ }
    if (ui.visible && session.paused) ui.handleMenu(menuEvents.filter((e) => e !== 'pause'));
    if (!session.paused) {
      const camPress = input.consume('camera');
      if (camPress) { cam.cycle(1); ui.restart(`${CAM_NAMES[cam.mode]} camera`, 1.2); }
      // step the simulation at a fixed rate
      session.acc += dt;
      let steps = 0;
      while (session.acc >= STEP && steps < 6) {
        session.match.update(STEP, input);
        session.acc -= STEP;
        steps++;
        if (session.match.finished) break;
      }
      if (session.acc > STEP * 6) session.acc = 0;
    }
  } else if (session && session.bg) {
    // background demo: keep it moving; any menu key just passes through to the menus
    session.acc += dt;
    let steps = 0;
    while (session.acc >= STEP && steps < 6) { session.match.update(STEP, null); session.acc -= STEP; steps++; }
    if (session.match.finished) startBackgroundDemo(undefined, undefined, false);
  }
  if (!session || session.bg) {
    if (ui.visible) ui.handleMenu(menuEvents);
  } else if (ui.visible && !session.paused) {
    ui.handleMenu(menuEvents);
  }
  if (session && session.match.finished && !session.finished && !session.bg) onSessionFinished(session);

  // sync view + camera + HUD
  if (session) {
    const m = session.match;
    const pc = session.pc;
    if (pc) pc.camFwd = cam.camFwd;
    const ctl = pc && pc.current && pc.current.isActive ? pc.current : null;
    session.view.sync(dt, ctl);
    const b = m.ball.pos;
    const subject = ctl ? { pos: ctl.pos, heading: ctl.heading } : null;
    cam.update(dt, { x: session.view.ballVis.x, y: session.view.ballVis.y, z: session.view.ballVis.z }, subject, ctl ? (ctl.teamIndex === 0 ? 1 : -1) : 1);
    if (!session.bg) {
      const stoppage = m.stoppage > 0 && m.half === 2 && m.time > m.halfSeconds ? ' · +time' : '';
      const half = m.mode === 'training' ? 'Practice' : m.mode === 'shooting' ? `Drill · ${Math.ceil(m.drill.timeLeft)}s · ${m.drill.goals} goals` : (m.half === 1 ? '1st half' : '2nd half') + stoppage;
      ui.setHud({
        homeName: m.teams[0].short, awayName: m.teams[1].short,
        homeColor: m.teams[0].kit.shirt, awayColor: m.teams[1].kit.shirt,
        score: [m.teams[0].score, m.teams[1].score],
        clock: m.clockText(), half,
        ctlName: ctl ? `${ctl.number} ${ctl.name}` : (session.bg ? '' : 'Ball'),
        ctlMeta: ctl ? `${ctl.role} · OVR ${ctl.overall}` : '',
        stamina: ctl ? ctl.stamina : 1,
        charge: pc ? pc.chargeFrac : 0,
        camLabel: CAM_NAMES[cam.mode],
        hints: session.hints || '',
        showControl: !!ctl || m.mode === 'training' || m.mode === 'shooting',
      });
      void b;
    }
  }
  ui.tick(dt);
  audio.update(dt);
  if (session && !session.bg && session.match.finished === false) {
    // keep the crowd bed in step with the match intensity
    const m = session.match;
    audio.setCrowdLevel(m.ball.owner ? 0.5 : 0.3);
  }
  renderer.render(scene, camera);
  void cameraHeld;
}

// ---------- boot ----------
applyQuality();
applyDisplay();
showMenu();
requestAnimationFrame(frame);
// dev hooks for the headless smoke test
window.__futsal = { get session() { return session; }, save, input, ui, cam, renderer, scene, camera, startQuick, startTraining, showMenu };
