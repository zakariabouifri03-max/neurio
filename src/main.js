/* ============================================================
   Botola 25 — main.js
   Boots the game, routes the screens, owns the match loop and
   all the input (keyboard + touch joystick + pads).
   ============================================================ */

import * as THREE from '../vendor/three.module.js';
import { createMatch, stepMatch, ST, possessionPct } from './engine.js';
import { CLUBS, clubById, makeSquad, PITCH } from './data.js';
import {
  createRenderer, createScene, buildStadium, createTeamMaterials,
  createPlayerMesh, createBallMesh, syncPlayer, syncBall,
  updateCamera, createCamera, joystickToWorld,
} from './render.js';
import { shadowTexture } from './tex.js';
import { Sfx } from './audio.js';
import {
  newCareer, commitUserResult, mySquad, refreshMarket, buyPlayer,
  trainPlayer, sellPlayer, teamStrength,
} from './career.js';
import { loadSave, writeSave, clearSave } from './save.js';
import { $, show, renderMenu, renderClubs, renderCareer, renderSquad, renderMarket, renderTable, renderResult, renderQuick, initHud, updateHud, drawRadar, toast } from './ui.js';
import { clamp } from './util.js';

/* ------------------------------------------------------------------ */
const state = {
  career: null,
  screen: 'menu',
  settings: { sound: true, half: 120, diff: 1, cam: 1 },
  quick: { home: 'fes', away: 'cas' },
  pending: null,
};

let renderer = null, scene = null, camera = null, stadium = null;
let match = null, rigs = [], ballRig = null, playersGroup = null, shadowTex = null;
let running = false, paused = false, rafId = 0, lastT = 0;
let lastWhistle = 0, lastGoal = -1, lastKicker = -1, lastPost = 0, lastSave = 0;
let pendingResult = null;

/* ------------------------------------------------------------------ */
function boot() {
  const saved = loadSave();
  if (saved) {
    state.career = saved.career || null;
    Object.assign(state.settings, saved.settings || {});
  }
  renderer = createRenderer($('gl'));
  scene = createScene();
  stadium = buildStadium(scene);
  stadium.visible = false;
  camera = createCamera();
  shadowTex = shadowTexture();
  playersGroup = new THREE.Group();
  scene.add(playersGroup);

  wireNav();
  wireTouch();
  wireKeys();
  wireSettings();
  wirePwa();
  applySettings();
  go('menu');
  requestAnimationFrame(loop);
  window.addEventListener('resize', resize);
  resize();
  setInterval(() => { if (state.career) writeSave({ career: state.career, settings: state.settings }); }, 8000);
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  document.body.classList.toggle('portrait', h > w);
}

/* ------------------------------------------------------------------ */
function go(name) {
  state.screen = name;
  if (name === 'menu') renderMenu(state.career);
  else if (name === 'club') renderClubs(null, pickClub);
  else if (name === 'career') renderCareer(state.career, playCareerMatch);
  else if (name === 'squad') renderSquad(state.career, onTrain);
  else if (name === 'market') renderMarket(state.career, onBuy, onRefresh, onSell);
  else if (name === 'table') renderTable(state.career);
  else if (name === 'quick') renderQuick(state.quick, quickPick);
  else if (name === 'match') { initHud(match); }
  else if (name === 'result') renderResult(pendingResult);
  show(name);
  if (name !== 'match') { Sfx.crowd(0); }
}

function quickPick(key, id) {
  state.quick[key] = id;
  renderQuick(state.quick, quickPick);
  Sfx.ui();
}

function pickClub(id) {
  state.career = newCareer(id, { halfSeconds: state.settings.half, difficulty: state.settings.diff });
  writeSave({ career: state.career, settings: state.settings });
  Sfx.ui();
  toast('مرحبا بيك ف ' + clubById(id).name + ' 🔥');
  go('career');
}

/* ------------------------------------------------------------------ */
function wireNav() {
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-go]');
    if (!b) return;
    const dest = b.dataset.go;
    Sfx.init(); Sfx.resume(); Sfx.ui();
    if (dest === 'restart') {
      if (confirm('واش متأكد؟ غادي تمسح المسيرة كاملة.')) { clearSave(); state.career = null; go('menu'); }
      return;
    }
    if ((dest === 'career' || dest === 'squad' || dest === 'market' || dest === 'table') && !state.career) {
      toast('بدا موسم الأول'); go('club'); return;
    }
    go(dest);
  });
  $('btnPause').onclick = () => togglePause(true);
  $('pmResume').onclick = () => togglePause(false);
  $('pmQuit').onclick = () => quitMatch();
  $('resContinue').onclick = () => { Sfx.ui(); go(state.career ? 'career' : 'menu'); };
  $('qPlay').onclick = () => startQuick();
}

function togglePause(on) {
  paused = on;
  $('pauseMenu').classList.toggle('on', on);
  if (on && match) {
    const me = match.human;
    $('pauseStats').innerHTML =
      `<span>النتيجة <b>${match.teams[0].score}-${match.teams[1].score}</b></span>` +
      `<span>الدقيقة <b>${Math.floor(match.minute)}'</b></span>` +
      `<span>استحواذ <b>${me === 0 ? possessionPct(match) : 100 - possessionPct(match)}%</b></span>`;
  }
  Sfx.ui();
}

function quitMatch() {
  running = false; paused = false;
  cancelAnimationFrame(rafId);
  clearPlayers();
  stadium.visible = false;
  match = null;
  Sfx.crowd(0);
  go('menu');
}

/* ------------------------------------------------------------------ */
/*  Starting a match                                                   */
/* ------------------------------------------------------------------ */
function startMatch(homeClub, awayClub, squads, human, meta) {
  Sfx.init(); Sfx.resume();
  match = createMatch({
    home: homeClub, away: awayClub,
    squads, seed: (Date.now() & 0xffffff) ^ 0x5f3a,
    halfSeconds: state.settings.half,
    human, aiLevel: state.settings.diff,
  });
  match.meta = meta;
  buildPlayers(match);
  stadium.visible = true;
  initHud(match);
  lastWhistle = 0; lastGoal = -1; lastKicker = -1; lastPost = 0; lastSave = 0;
  running = true; paused = false; lastT = performance.now();
  go('match');
}

function buildPlayers(m) {
  clearPlayers();
  const mats = [createTeamMaterials(m.teams[0].club), createTeamMaterials(m.teams[1].club)];
  rigs = [];
  for (const pl of m.players) {
    const rig = createPlayerMesh(mats[pl.team], pl.data, shadowTex);
    playersGroup.add(rig.grp);
    rigs[pl.i] = rig;
  }
  ballRig = createBallMesh();
  playersGroup.add(ballRig.mesh, ballRig.shadow);
}

function clearPlayers() {
  if (!playersGroup) return;
  // shared geometry + canvas textures live on; per-player materials do not
  for (const child of playersGroup.children.slice()) {
    child.traverse?.((o) => {
      if (o.isMesh && o.material && !o.material.map) o.material.dispose();
    });
    playersGroup.remove(child);
  }
  rigs = []; ballRig = null;
}

function playCareerMatch(fixture, round) {
  const c = state.career;
  const userHome = fixture.home === c.clubId;
  const me = clubById(c.clubId);
  const opId = userHome ? fixture.away : fixture.home;
  const op = clubById(opId);
  const homeClub = userHome ? me : op;
  const awayClub = userHome ? op : me;
  const squads = userHome
    ? [mySquad(c), c.squads[opId]]
    : [c.squads[opId], mySquad(c)];
  pendingResult = { fixture, round, userHome };
  startMatch(homeClub, awayClub, squads, userHome ? 0 : 1, { career: true });
}

function startQuick() {
  const h = clubById(state.quick.home), a = clubById(state.quick.away);
  if (h.id === a.id) { toast('ختار جوج أندية مختالفين'); return; }
  startMatch(h, a, [makeSquad(1234, h.rate), makeSquad(5678, a.rate)], 0, { career: false });
}

/* ------------------------------------------------------------------ */
/*  The loop                                                           */
/* ------------------------------------------------------------------ */
function loop(now) {
  rafId = requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;

  if (match && running && state.screen === 'match') {
    if (!paused) {
      stepMatch(match, dt, readInput());
      stepFx(match);
      syncWorld(match, dt);
      updateHud(match);
      drawRadar($('radar'), match);
      if (match.over) onMatchOver();
    }
    updateCamera(camera, match, paused ? 0 : dt, window.innerWidth, window.innerHeight);
    renderer.render(scene, camera);
  } else if (state.screen === 'menu') {
    // idle 3D backdrop behind the menu
    idleBackdrop(dt);
    renderer.render(scene, camera);
  }
}

function idleBackdrop(dt) {
  stadium.visible = true;
  const t = performance.now() * 0.00006;
  camera.position.set(Math.cos(t) * 70, 26, Math.sin(t) * 55);
  camera.lookAt(0, 2, 0);
  void dt;
}

function syncWorld(m, dt) {
  for (const pl of m.players) {
    const rig = rigs[pl.i];
    if (rig) syncPlayer(rig, pl, pl.i === m.active, dt);
  }
  if (ballRig) syncBall(ballRig, m.ball);
  // crowd gets louder as the game heats up
  const tension = clamp(Math.abs(m.teams[0].score - m.teams[1].score) * 0.12 + m.minute / 300, 0, 1);
  Sfx.crowd(m.state === ST.GOAL ? 1 : 0.15 + tension * 0.5);
}

/* ---- sound + fx triggers, driven by engine counters ---- */
function stepFx(m) {
  if (m.whistle !== lastWhistle) {
    const n = m.whistle - lastWhistle;
    lastWhistle = m.whistle;
    Sfx.whistle(n >= 2 ? 2 : 1);
  }
  const goals = m.teams[0].score + m.teams[1].score;
  if (goals !== lastGoal) {
    if (lastGoal >= 0) { Sfx.goal(); Sfx.crowd(1); }
    lastGoal = goals;
  }
  if (m.lastKicker !== lastKicker) {
    lastKicker = m.lastKicker;
    const pl = m.players[m.lastKicker];
    Sfx.kick(clamp((pl ? pl.data.shoot : 70) / 100, 0.2, 1));
  }
  if (m.postHit !== lastPost) { lastPost = m.postHit; Sfx.post(); }
  if ((m.saved || 0) !== lastSave) {
    if (lastSave > 0 || m.saved > 0) Sfx.kick(0.7);
    lastSave = m.saved || 0;
  }
}

function onMatchOver() {
  running = false;
  const m = match;
  const meta = m.meta || {};
  const me = m.human;
  const myScore = m.teams[me].score, opScore = m.teams[1 - me].score;

  let res = null;
  if (meta.career && state.career) {
    const pr = pendingResult || {};
    const hg = pr.userHome ? myScore : opScore;
    const ag = pr.userHome ? opScore : myScore;
    res = commitUserResult(state.career, { ...pr.fixture, round: pr.round }, hg, ag);
    writeSave({ career: state.career, settings: state.settings });
    if (res.seasonEnd) {
      toast(res.seasonEnd.champion ? '🏆 نتا بطل البوطولا!' : `الموسم سالا — المركز ${res.seasonEnd.pos}`);
    } else Sfx.coin();
  }
  pendingResult = {
    m, res, career: !!meta.career,
    home: m.teams[0].club, away: m.teams[1].club,
  };
  setTimeout(() => { if (match === m) go('result'); }, 2600);
}

/* ------------------------------------------------------------------ */
/*  Input                                                              */
/* ------------------------------------------------------------------ */
const keys = {};
const touch = { active: false, id: null, x: 0, y: 0, dx: 0, dy: 0, sprint: false };
const pads = { pass: false, tackle: false, swap: false, shootHeld: false };

function readInput() {
  let mx = 0, mz = 0;
  if (keys.left) mx -= 1;
  if (keys.right) mx += 1;
  if (keys.up) mz -= 1;
  if (keys.down) mz += 1;
  if (touch.active) { mx += touch.dx; mz += touch.dy; }
  const mag = Math.hypot(mx, mz);
  if (mag > 1) { mx /= mag; mz /= mag; }
  // screen space → pitch space (camera looks down the attacking axis)
  const dir = match && match.human >= 0 ? match.teams[match.human].dir : 1;
  const w = joystickToWorld(mx, -mz, dir);
  return {
    mx: w.x * w.mag, mz: w.z * w.mag,
    sprint: keys.sprint || touch.sprint,
    pass: pads.pass,
    tackle: pads.tackle,
    switch: pads.swap,
    shootHeld: pads.shootHeld || keys.shoot,
  };
}

function wireKeys() {
  const map = {
    ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
    ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
    ShiftLeft: 'sprint', ShiftRight: 'sprint', Space: 'shoot',
  };
  addEventListener('keydown', (e) => {
    if (map[e.code]) { keys[map[e.code]] = true; e.preventDefault(); }
    if (e.code === 'KeyE') pads.pass = true;
    if (e.code === 'KeyF') pads.tackle = true;
    if (e.code === 'KeyQ') pads.swap = true;
    if (e.code === 'Escape') { if (state.screen === 'match') togglePause(!paused); }
    if (e.code === 'KeyP') { if (state.screen === 'match') togglePause(!paused); }
    Sfx.init(); Sfx.resume();
  });
  addEventListener('keyup', (e) => {
    if (map[e.code]) keys[map[e.code]] = false;
    if (e.code === 'KeyE' || e.code === 'KeyF' || e.code === 'KeyQ') { pads.pass = pads.tackle = pads.swap = false; }
  });
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
}

function wireTouch() {
  const stick = $('stick'), knob = $('knob');
  const R = 46;
  const start = (e) => {
    const t = e.changedTouches ? e.changedTouches[0] : e;
    touch.active = true; touch.id = t.identifier ?? 'mouse';
    move(e); Sfx.init(); Sfx.resume(); e.preventDefault();
  };
  const move = (e) => {
    if (!touch.active) return;
    const list = e.changedTouches || [e];
    let t = list[0];
    for (const x of list) if ((x.identifier ?? 'mouse') === touch.id) t = x;
    const r = stick.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let dx = t.clientX - cx, dy = t.clientY - cy;
    const l = Math.hypot(dx, dy) || 1;
    const k = Math.min(1, l / R);
    dx /= l; dy /= l;
    touch.dx = dx * k; touch.dy = dy * k;
    knob.style.transform = `translate(${dx * k * R}px, ${dy * k * R}px)`;
    e.preventDefault?.();
  };
  const end = () => {
    touch.active = false; touch.dx = touch.dy = 0;
    knob.style.transform = 'translate(0,0)';
  };
  stick.addEventListener('touchstart', start, { passive: false });
  stick.addEventListener('touchmove', move, { passive: false });
  stick.addEventListener('touchend', end);
  stick.addEventListener('touchcancel', end);
  stick.addEventListener('mousedown', start);
  addEventListener('mousemove', (e) => { if (touch.active && touch.id === 'mouse') move(e); });
  addEventListener('mouseup', () => { if (touch.id === 'mouse') end(); });

  const bind = (id, key) => {
    const b = $(id);
    const on = (e) => { pads[key] = true; b.classList.add('on'); e.preventDefault(); Sfx.init(); Sfx.resume(); };
    const off = (e) => { pads[key] = false; b.classList.remove('on'); e?.preventDefault?.(); };
    b.addEventListener('touchstart', on, { passive: false });
    b.addEventListener('touchend', off);
    b.addEventListener('touchcancel', off);
    b.addEventListener('mousedown', on);
    b.addEventListener('mouseup', off);
    b.addEventListener('mouseleave', off);
  };
  bind('pPass', 'pass');
  bind('pTackle', 'tackle');
  bind('pSwap', 'swap');
  bind('pShoot', 'shootHeld');
  // sprint is a hold
  const sp = $('pSprint');
  const spOn = (e) => { touch.sprint = true; sp.classList.add('on'); e.preventDefault(); };
  const spOff = () => { touch.sprint = false; sp.classList.remove('on'); };
  sp.addEventListener('touchstart', spOn, { passive: false });
  sp.addEventListener('touchend', spOff);
  sp.addEventListener('touchcancel', spOff);
  sp.addEventListener('mousedown', spOn);
  sp.addEventListener('mouseup', spOff);
  sp.addEventListener('mouseleave', spOff);
}

/* ------------------------------------------------------------------ */
/*  Career actions                                                     */
/* ------------------------------------------------------------------ */
function onTrain(uid, attr) {
  const r = trainPlayer(state.career, uid, attr);
  if (r.ok) { Sfx.coin(); toast(`⬆️ ${attr} ولّى ${r.value} (-${r.cost} 🪙)`); }
  else { Sfx.sad(); toast(r.why); }
  save(); renderSquad(state.career, onTrain);
}
function onBuy(i) {
  const r = buyPlayer(state.career, i);
  if (r.ok) { Sfx.coin(); toast(`✅ ${r.added} دخل بلاصة ${r.replaced}`); }
  else { Sfx.sad(); toast(r.why); }
  save(); renderMarket(state.career, onBuy, onRefresh, onSell);
}
function onRefresh() {
  const r = refreshMarket(state.career);
  if (!r.ok) { Sfx.sad(); return toast(r.why); }
  Sfx.ui(); save(); renderMarket(state.career, onBuy, onRefresh, onSell);
}
function onSell(uid) {
  const r = sellPlayer(state.career, uid);
  if (r.ok) { Sfx.coin(); toast(`💸 ${r.name} — +${r.price} 🪙`); }
  else { Sfx.sad(); toast(r.why); }
  save(); renderMarket(state.career, onBuy, onRefresh, onSell);
}
const save = () => writeSave({ career: state.career, settings: state.settings });

/* ------------------------------------------------------------------ */
/*  Settings + PWA                                                     */
/* ------------------------------------------------------------------ */
function wireSettings() {
  $('setSound').onclick = () => {
    state.settings.sound = !state.settings.sound;
    Sfx.setEnabled(state.settings.sound);
    applySettings(); save();
  };
  const seg = (id, key, cb) => {
    $(id).querySelectorAll('button').forEach((b) => {
      b.onclick = () => { state.settings[key] = Number(b.dataset.v); applySettings(); save(); Sfx.ui(); cb?.(); };
    });
  };
  seg('setHalf', 'half');
  seg('setDiff', 'diff');
  seg('setCam', 'cam');
  $('btnWipe').onclick = () => {
    if (confirm('واش متأكد؟ غادي تمسح كلشي.')) { clearSave(); state.career = null; go('menu'); }
  };
}

function applySettings() {
  Sfx.setEnabled(state.settings.sound);
  $('setSound').textContent = state.settings.sound ? '🔊 خدّام' : '🔇 مطفّي';
  for (const [id, key] of [['setHalf', 'half'], ['setDiff', 'diff'], ['setCam', 'cam']]) {
    $(id).querySelectorAll('button').forEach((b) =>
      b.classList.toggle('on', Number(b.dataset.v) === Number(state.settings[key])));
  }
}

let deferredPrompt = null;
function wirePwa() {
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    $('installHint').textContent = 'التثبيت متاح دابا — ضغط على الزر.';
  });
  $('btnInstall').onclick = async () => {
    Sfx.ui();
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const r = await deferredPrompt.userChoice;
      toast(r.outcome === 'accepted' ? '✅ ت ثبّت!' : 'ماشي مشكل، تقدر من بعد');
      deferredPrompt = null;
    } else {
      toast('ف المتصفح: ⋮ ← "زيد للشاشة الرئيسية"');
    }
  };
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

/* ------------------------------------------------------------------ */
addEventListener('DOMContentLoaded', boot);
export { state, CLUBS, PITCH, teamStrength, THREE };
