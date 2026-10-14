// ── WARFRONT · boot, menu, settings, save — the glue that starts the match ───

import * as THREE from 'three';
import { Game, DIFFS } from './game.js';
import { WEAPONS, PRIMARY_ORDER, SECONDARY_ORDER, PERKS, buildGun } from './weapons.js';
import { audio } from './audio.js';
import { clamp, lerp, fmt, fmtTime } from './util.js';

const $ = (id) => document.getElementById(id);
const KEY = 'warfront.save.v1';
const RANKS = [
  ['PVT', 'Private', 0], ['PFC', 'Private First Class', 500], ['SPC', 'Specialist', 1400], ['CPL', 'Corporal', 2800],
  ['SGT', 'Sergeant', 4800], ['SSG', 'Staff Sergeant', 7600], ['SFC', 'Sergeant First Class', 11500], ['LT', 'Lieutenant', 16500],
  ['CAPT', 'Captain', 23000], ['MAJ', 'Major', 32000], ['LTC', 'Lt. Colonel', 44000], ['COL', 'Colonel', 60000],
  ['BRIG', 'Brigadier', 80000], ['GEN', 'General', 110000],
];

function loadSave() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { s = {}; }
  return Object.assign({
    xp: 0, kills: 0, deaths: 0, runs: 0, wins: 0, bestWave: 0, bestScore: 0, playtime: 0,
    wpnKills: {}, loadout: { primary: 'm4', secondary: 'm1911', perk: 'none' },
    sens: .0022, fov: 78, invert: false, quality: 'high', vol: .9, music: true, sfx: true, diff: 'recruit',
  }, s);
}
function persist(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { } }

const save = loadSave();
const bootMsg = $('bootMsg');
const say = (t) => { if (bootMsg) bootMsg.textContent = t; };

// ── dev error overlay ────────────────────────────────────────────────────────
addEventListener('error', (e) => {
  const el = $('errLog');
  if (!el) return;
  el.style.display = 'block';
  el.textContent = '⚠ ' + (e.message || 'Error') + (e.filename ? ` — ${e.filename.split('/').pop()}:${e.lineno}` : '');
});

function rankFor(xp) {
  let i = 0;
  for (let k = 0; k < RANKS.length; k++) if (xp >= RANKS[k][2]) i = k;
  const cur = RANKS[i], nxt = RANKS[Math.min(RANKS.length - 1, i + 1)];
  const p = cur[2] === nxt[2] ? 1 : clamp((xp - cur[2]) / (nxt[2] - cur[2]), 0, 1);
  return { i, cur, nxt, p };
}
const unlocked = (id) => (WEAPONS[id].unlock || 0) <= Math.max(1, (save.bestWave || 0) + 0);

// ── boot ─────────────────────────────────────────────────────────────────────
let game = null, preview = null, raf = 0, last = 0, started = false;

async function boot() {
  say('building the town…');
  await frame();
  const canvas = $('view');
  const q = save.quality || 'high';
  game = new Game(canvas, {
    quality: q,
    dpr: q === 'low' ? 1 : q === 'med' ? 1.25 : 1.6,
    aa: q !== 'low',
  });
  game.save = save;
  game.fovBase = save.fov || 78;
  game.sens = save.sens;
  game.invertY = save.invert;
  game.detail = q === 'low' ? .4 : q === 'med' ? .8 : 1;
  game.renderer.shadowMap.enabled = q !== 'low';
  say('briefing the squad…');
  await frame();
  game.bindInput();
  installEndHandler();
  wireKeys();
  game.resize();
  addEventListener('resize', () => game.resize());
  preview = makePreview($('prevPrimary'));
  refreshMenu();
  $('boot').style.display = 'none';
  $('menu').classList.add('on');
  game.state = 'menu';
  started = true;
  last = performance.now();
  raf = requestAnimationFrame(loop);
  // audio needs a gesture
  addEventListener('pointerdown', () => { audio.unlock(); audio.setMaster(save.vol); audio.set('music', save.music); audio.set('sfx', save.sfx); }, { once: true });
}

function frame() { return new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0))); }

// ── main loop ────────────────────────────────────────────────────────────────
let menuT = 0, lastState = 'boot';
function loop(now) {
  raf = requestAnimationFrame(loop);
  const dt = clamp((now - last) / 1000, 0.0001, 0.062);
  last = now;
  save.playtime = (save.playtime || 0) + dt;
  const st = game.state;
  if (st === 'menu' || st === 'brief') {
    menuT += dt;
    orbitMenu(dt);
  } else if (st === 'play') {
    game.update(dt);
  } else if (st === 'paused') {
    game.fx.update(dt * .25, game.camera);
  } else if (st === 'complete' || st === 'over') {
    game.time += dt;
    game.fx.update(dt, game.camera);
    for (const s2 of game.soldiers) if (!s2.dead) { s2.think(dt * .4); s2.resolve(dt * .4); s2.render(dt, game.time); }
  }
  game.render();
  // menu-side UI syncing
  if (game.state !== lastState) onStateChange(game.state, lastState);
  lastState = game.state;
  syncDeathCard(dt);
  if (preview && game.state === 'menu') preview.tick(dt);
}

function orbitMenu(dt) {
  const t = menuT * .085;
  const r = 34 + Math.sin(menuT * .18) * 8;
  const cam = game.camera;
  cam.position.set(Math.cos(t) * r, 11 + Math.sin(t * .7) * 3.5, Math.sin(t) * r);
  cam.lookAt(game.world.objective.x, 3.2, game.world.objective.z);
  cam.rotateZ(Math.sin(t * .9) * .01);
  game.world.update(dt, menuT, cam.position.x, cam.position.z);
  game.fx.update(dt, cam);
  game.updateFov && game.updateFov();
}

function onStateChange(now, prev) {
  const menu = $('menu'), pause = $('pause'), res = $('results');
  if (now === 'play') {
    menu.classList.remove('on');
    pause.classList.remove('on');
    res.classList.remove('on');
    game.hud.show(true);
    closeModal();
  } else if (now === 'menu') {
    res.classList.remove('on');
    pause.classList.remove('on');
    menu.classList.add('on');
    game.hud.show(false);
    refreshMenu();
  } else if (now === 'paused') {
    pause.classList.add('on');
  }
  void prev;
}

// ── pause / resume ───────────────────────────────────────────────────────────
$('btnPauseTop').addEventListener('click', () => { audio.ui('click'); game.pause(true); });
$('btnResume').addEventListener('click', () => { audio.ui('click'); $('pause').classList.remove('on'); game.pause(false); });
$('btnRestart').addEventListener('click', () => { audio.ui('click'); $('pause').classList.remove('on'); startRun(); });
$('btnQuit').addEventListener('click', () => { audio.ui('back'); toMenu(); });
$('view').addEventListener('click', () => {
  if (game.state === 'play' && document.pointerLockElement !== $('view')) game.requestLock();
});
function wireKeys() {
  // Escape inside the pause menu resumes
  addEventListener('keydown', (e) => {
    if (!started) return;
    if (e.code === 'Escape' && game.state === 'paused') { $('pause').classList.remove('on'); game.pause(false); }
    if (e.code === 'KeyP' && game.state === 'play') game.pause(true);
  });
}
wireKeys.__done = false;

function toMenu() {
  game.state = 'menu';
  game.exitLock();
  game.hud.show(false);
  game.audio.suspend();
  for (const s of game.soldiers) game.scene.remove(s.obj);
  game.soldiers.length = 0;
  for (const d of game.drops) if (d.para) game.scene.remove(d.para);
  game.drops.length = 0;
  game.grenades.forEach((n) => n.mesh && game.scene.remove(n.mesh));
  game.grenades.length = 0;
  game.rockets.forEach((r) => r.mesh && game.scene.remove(r.mesh));
  game.rockets.length = 0;
  $('results').classList.remove('on');
  $('pause').classList.remove('on');
  persist(save);
  refreshMenu();
}

function startRun() {
  audio.unlock();
  audio.setMaster(save.vol);
  audio.set('sfx', save.sfx);
  audio.set('music', save.music);
  $('results').classList.remove('on');
  $('pause').classList.remove('on');
  game.perk = save.loadout.perk || 'none';
  game.deploy([save.loadout.primary, save.loadout.secondary], save.diff || 'recruit', save.loadout.perk);
  started = true;
  last = performance.now();
}

// ── death card + results ─────────────────────────────────────────────────────
let resMode = '';
function syncDeathCard() {
  if (!game) return;
  const res = $('results');
  if (game.state === 'play' && game.player.dead) {
    if (resMode !== 'kia') {
      resMode = 'kia';
      renderKia();
      res.classList.add('on');
    }
    const cd = $('respawnCd');
    if (cd) cd.textContent = Math.max(0, game.respawnIn || 0).toFixed(1) + 's';
  } else if (resMode === 'kia' && !game.player.dead) {
    resMode = '';
    res.classList.remove('on');
  }
}
function renderKia() {
  $('resTitle').textContent = 'K.I.A.';
  $('resTitle').className = 'resTitle kia';
  $('resSub').textContent = 'You were killed in action — scorestreaks reset';
  $('resGrid').innerHTML = statCells([
    ['SCORE', fmt(game.score)], ['KILLS', game.kills], ['DEATHS', game.deaths],
    ['ACCURACY', (game.player.stats.shots ? game.player.stats.hits / game.player.stats.shots * 100 : 0).toFixed(1) + '%'],
    ['BEST STREAK', game.bestStreak], ['WAVE', game.wave + '/' + game.totalWaves],
  ]);
  $('resRank').innerHTML = '';
  $('btnRespawn').classList.remove('hide');
}
$('btnRespawn').addEventListener('click', () => { game.hideDeath(); game.respawnIn = 0; game.respawn(); resMode = ''; $('results').classList.remove('on'); });
$('btnQuitRes').addEventListener('click', () => { toMenu(); resMode = ''; });

function installEndHandler() {
  game.onEnd = (sum) => {
      // persist progression
      const gained = Math.round((sum.score / 10 + sum.kills * 4 + (sum.win ? 400 : 0)) * (DIFFS[save.diff] ? (save.diff === 'veteran' ? 3 : save.diff === 'operator' ? 2 : 1) : 1));
      const before = rankFor(save.xp);
      save.xp += gained;
      save.kills += sum.kills;
      save.deaths += sum.deaths;
      save.runs++;
      if (sum.win) save.wins++;
      save.bestWave = Math.max(save.bestWave || 0, sum.wave || 0);
      save.bestScore = Math.max(save.bestScore || 0, sum.score || 0);
      save.xpWave = sum.win ? Math.max(save.xpWave || 0, sum.wave) : save.xpWave || 0;
      if (sum.win) save.bestWave = Math.max(save.bestWave, game.totalWaves);
      for (const [k, v] of Object.entries(game.killsByWeapon || {})) save.wpnKills[k] = (save.wpnKills[k] || 0) + v;
      persist(save);
      const after = rankFor(save.xp);
      resMode = 'end';
      const res = $('results');
      $('resTitle').textContent = sum.win ? 'MISSION ACCOMPLISHED' : 'OPERATION FAILED';
      $('resTitle').className = 'resTitle ' + (sum.win ? 'win' : 'fail');
      $('resSub').textContent = sum.win
        ? `${sum.diff} · all ${sum.totalWaves} waves cleared in ${fmtTime(sum.time)}`
        : `Overrun on wave ${sum.wave} of ${sum.totalWaves}`;
      $('resGrid').innerHTML = statCells([
        ['KILLS', sum.kills], ['DEATHS', sum.deaths], ['SCORE', fmt(sum.score)],
        ['HEADSHOTS', sum.headshots], ['LONG SHOTS', sum.longShots], ['BEST STREAK', sum.bestStreak],
        ['ACCURACY', sum.accuracy.toFixed(1) + '%'], ['DMG TAKEN', sum.dmgTaken], ['MEDALS', sum.medals.length],
      ]);
      $('resRank').innerHTML = `
        <div class="xpRow"><span>XP</span><b>+${fmt(gained)}</b></div>
        <div class="xpBar big"><i style="width:${(after.p * 100).toFixed(1)}%"></i></div>
        <div class="rkRow">${before.i !== after.i ? `<em class="up">▲ PROMOTED — ${after.cur[1]}</em>` : `<em>${after.cur[1]} · ${fmt(save.xp)} XP</em>`}
        ${sum.kills ? `<em class="wpn">${topWeapon()}</em>` : ''}</div>`;
      $('btnRespawn').classList.add('hide');
      $('btnQuitRes').textContent = '⏻ CONTINUE';
      res.classList.add('on');
      if (sum.win) audio.medal(); else audio.ui('back');
      refreshMenu();
  };
}

function topWeapon() {
  const e = Object.entries(save.wpnKills || {}).sort((a, b) => b[1] - a[1])[0];
  return e ? `Most improved: ${WEAPONS[e[0]].name} (${e[1]} lifetime kills)` : '';
}
function statCells(rows) {
  return rows.map(([k, v]) => `<div class="sc"><span>${k}</span><b>${v}</b></div>`).join('');
}

// ── menu wiring ──────────────────────────────────────────────────────────────
function cyc(list, cur, dir, filter) {
  const avail = list.filter(filter || (() => true));
  let i = Math.max(0, avail.indexOf(cur));
  return avail[(i + dir + avail.length) % avail.length];
}
let lSel = { p: 0, s: 0, k: 0 };
function refreshMenu() {
  const r = rankFor(save.xp);
  $('rankBadge').textContent = r.cur[0];
  $('rankName').textContent = r.cur[1];
  $('xpFill').style.width = (r.p * 100).toFixed(1) + '%';
  $('xpText').textContent = `${fmt(save.xp)} / ${fmt(r.nxt[2])} XP` + (r.i === RANKS.length - 1 ? ' (MAX)' : '');
  $('primaryName').textContent = WEAPONS[save.loadout.primary].name + (unlocked(save.loadout.primary) ? '' : ' 🔒');
  $('secondaryName').textContent = WEAPONS[save.loadout.secondary].name;
  $('perkName').textContent = PERKS[save.loadout.perk || 'none'].name;
  $('perkNote').textContent = PERKS[save.loadout.perk || 'none'].note;
  document.querySelectorAll('.opCard').forEach((c) => c.classList.toggle('active', c.dataset.diff === (save.diff || 'recruit')));
  $('menuStats').innerHTML = statCells([
    ['KILLS', fmt(save.kills || 0)], ['WINS', save.wins || 0], ['BEST SCORE', fmt(save.bestScore || 0)],
  ]);
  $('menuHint').innerHTML = save.bestWave >= 1
    ? `Best wave: <b>${save.bestWave}</b> — mouse is captured on deploy · <kbd>ESC</kbd> pauses`
    : 'New operator: 3 primaries unlocked — earn more by clearing waves. <kbd>ESC</kbd> pauses.';
  if (preview) preview.set(save.loadout.primary, save.loadout.secondary);
}
$('cycPrimary').addEventListener('click', (e) => {
  const dir = e.offsetX > $('cycPrimary').offsetWidth * .5 ? 1 : -1;
  save.loadout.primary = cyc(PRIMARY_ORDER, save.loadout.primary, dir, (id) => unlocked(id));
  audio.ui('click'); persist(save); refreshMenu();
});
$('cycSecondary').addEventListener('click', () => {
  save.loadout.secondary = cyc(SECONDARY_ORDER, save.loadout.secondary, 1);
  audio.ui('click'); persist(save); refreshMenu();
});
$('cycPerk').addEventListener('click', () => {
  const list = Object.keys(PERKS);
  save.loadout.perk = list[(list.indexOf(save.loadout.perk || 'none') + 1) % list.length];
  audio.ui('click'); persist(save); refreshMenu();
});
document.querySelectorAll('.opCard').forEach((c) => {
  c.addEventListener('click', () => { save.diff = c.dataset.diff; audio.ui('click'); persist(save); refreshMenu(); });
});
$('btnDeploy').addEventListener('click', () => { audio.ui('click'); startRun(); });
addEventListener('keydown', (e) => {
  if (!started || game.state !== 'menu') return;
  if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); startRun(); }
});

// ── weapon preview ───────────────────────────────────────────────────────────
function makePreview(canvas) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  } catch (e) { return { tick() { }, set() { } }; }
  renderer.setClearColor(0x000000, 0);
  renderer.setSize(420, 150, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(26, 420 / 150, .1, 20);
  cam.position.set(1.15, .5, 1.5);
  cam.lookAt(0, 0, 0);
  scene.add(new THREE.HemisphereLight(0xbfd4e8, 0x493f30, 2.2));
  const key = new THREE.DirectionalLight(0xffe6c0, 3.2); key.position.set(2, 3, 2); scene.add(key);
  const rim = new THREE.DirectionalLight(0x8fb7ff, 1.6); rim.position.set(-3, 1, -2); scene.add(rim);
  let g = null, g2 = null, t = 0;
  const set = (id) => {
    if (g) scene.remove(g);
    if (g2) scene.remove(g2);
    g = buildGun(WEAPONS[id].model, { noHands: true });
    g.rotation.set(.12, -.5, 0);
    g.position.set(.05, .02, 0);
    scene.add(g);
    g2 = buildGun(WEAPONS[save.loadout.secondary].model, { noHands: true });
    g2.scale.setScalar(.62);
    g2.rotation.set(.1, -2.3, 0);
    g2.position.set(-.95, -.3, -.5);
    scene.add(g2);
  };
  return {
    set,
    tick(dt) {
      t += dt;
      if (g) { g.rotation.y = -.5 + Math.sin(t * .7) * .32; g.position.y = .02 + Math.sin(t * 1.4) * .012; }
      if (g2) g2.rotation.y = -2.3 + Math.sin(t * .7) * .32;
      renderer.render(scene, cam);
    },
  };
}

// ── settings / help modal ────────────────────────────────────────────────────
function openModal(title, html) {
  $('modalTitle').textContent = title;
  $('modalBody').innerHTML = html;
  $('modal').classList.add('on');
}
function closeModal() { $('modal').classList.remove('on'); }
$('modalClose').addEventListener('click', () => { audio.ui('back'); closeModal(); });
$('modal').addEventListener('click', (e) => { if (e.target === $('modal')) closeModal(); });

$('btnSettings').addEventListener('click', () => { audio.ui('click'); openSettings(); });
$('btnHelp').addEventListener('click', () => {
  audio.ui('click');
  openModal('CONTROLS', `<div class="helpGrid">
    ${[['W A S D', 'move'], ['SHIFT', 'tactical sprint'], ['CTRL', 'crouch / slide while sprinting'], ['SPACE', 'jump'],
      ['MOUSE', 'look'], ['LMB', 'fire'], ['RMB', 'aim down sights'], ['R', 'reload'], ['Q / WHEEL', 'swap weapon'],
      ['1 2 3', 'primary · secondary · care-kit'], ['G', 'frag grenade'], ['E', 'apply armor plate'], ['F', 'open care package'],
      ['V', 'melee execution'], ['4 / 5 / 6', 'call in scorestreaks'], ['TAB', 'scoreboard'], ['ESC', 'pause']]
      .map(([k, v]) => `<div class="hRow"><kbd>${k}</kbd><span>${v}</span></div>`).join('')}
    </div>
    <div class="helpNote"><b>Field manual</b><br>
      · Standing still and crouching tightens your spread — short bursts beat long ones.<br>
      · Damage falls off past each rifle's effective range; the AX-50 punches through bodies.<br>
      · Armor plates soak 72% of incoming damage. Pop one the moment you break contact.<br>
      · Kill streaks: 3 = UAV, 5 = AIRSTRIKE (aim at where you want it to land), 8 = CARE PACKAGE.<br>
      · Health regenerates out of contact on Recruit/Operator. On Veteran it does not — play cover.</div>`);
});

function openSettings() {
  const row = (label, inner) => `<div class="setRow"><span>${label}</span>${inner}</div>`;
  openModal('SETTINGS', `
    ${row('Mouse sensitivity', `<input type="range" id="s_sens" min="4" max="60" value="${Math.round(save.sens * 10000)}"><b id="v_sens">${(save.sens * 1000).toFixed(1)}</b>`)}
    ${row('Field of view', `<input type="range" id="s_fov" min="65" max="105" value="${save.fov}"><b id="v_fov">${save.fov}</b>`)}
    ${row('Invert vertical look', rangeToggle('s_inv', save.invert))}
    ${row('Master volume', `<input type="range" id="s_vol" min="0" max="100" value="${Math.round(save.vol * 100)}"><b id="v_vol">${Math.round(save.vol * 100)}</b>`)}
    ${row('Sound effects', rangeToggle('s_sfx', save.sfx))}
    ${row('Music', rangeToggle('s_mus', save.music))}
    ${row('Graphics', `<div class="segBtns" id="s_q">${['low', 'med', 'high'].map((q) => `<button data-q="${q}" class="${save.quality === q ? 'on' : ''}">${q.toUpperCase()}</button>`).join('')}</div>`)}
    ${row('Shadows', rangeToggle('s_sh', save.quality !== 'low'))}
    <div class="setFoot"><button class="bigBtn alt" id="s_reset">RESET PROGRESSION</button><span>Runs on Three.js r170 · everything here is generated by code</span></div>
  `);
  const bind = (id, cb) => { const el = $('' + id); if (el) el.addEventListener('input', () => cb(el)); };
  bind('s_sens', (el) => { save.sens = +el.value / 10000; game.sens = save.sens; $('v_sens').textContent = (save.sens * 1000).toFixed(1); persist(save); });
  bind('s_fov', (el) => { save.fov = +el.value; game.fovBase = save.fov; game.updateFov(); $('v_fov').textContent = el.value; persist(save); });
  bind('s_vol', (el) => { save.vol = +el.value / 100; audio.setMaster(save.vol); $('v_vol').textContent = el.value; persist(save); });
  bind('s_inv', (el) => { save.invert = el.dataset.on === '1'; game.invertY = save.invert; persist(save); syncToggles(); });
  bind('s_sfx', (el) => { save.sfx = el.dataset.on === '1'; audio.set('sfx', save.sfx); persist(save); syncToggles(); });
  bind('s_mus', (el) => { save.music = el.dataset.on === '1'; audio.set('music', save.music); persist(save); syncToggles(); });
  bind('s_sh', (el) => { save.shadows = el.dataset.on !== '0'; game.renderer.shadowMap.enabled = el.dataset.on === '1'; persist(save); syncToggles(); });
  $('s_q').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    save.quality = b.dataset.q; persist(save);
    $('s_q').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    applyQuality();
  });
  $('s_reset').addEventListener('click', () => {
    if (!confirm('Wipe rank, unlocks and stats?')) return;
    localStorage.removeItem(KEY);
    location.reload();
  });
  syncToggles();
}
function rangeToggle(id, on) {
  return `<button class="tgl ${on ? 'on' : ''}" id="${id}" data-on="${on ? 1 : 0}"><i></i>${on ? 'ON' : 'OFF'}</button>`;
}
function syncToggles() {
  const setT = (id, on) => { const el = $(id); if (el) { el.classList.toggle('on', !!on); el.dataset.on = on ? '1' : '0'; el.querySelector('i').nextSibling.textContent = on ? 'ON' : 'OFF'; } };
  setT('s_inv', save.invert); setT('s_sfx', save.sfx); setT('s_mus', save.music);
}
function applyQuality() {
  const q = save.quality;
  game.dpr = q === 'low' ? 1 : q === 'med' ? 1.25 : 1.6;
  game.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, game.dpr));
  game.renderer.shadowMap.enabled = q !== 'low';
  game.detail = q === 'low' ? .4 : q === 'med' ? .8 : 1;
  game.quality = q;
  game.renderer.setClearColor(q === 'low' ? 0x000000 : 0x0b0d0f, 1);
  game.resize();
}

// expose for debugging in the console
window.WARFRONT = { get game() { return game; }, save, DIFFS, WEAPONS };

boot().catch((e) => {
  say('failed to start: ' + e.message);
  const el = $('errLog');
  el.style.display = 'block';
  el.textContent = '⚠ boot error: ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n') : e);
  console.error(e);
});
