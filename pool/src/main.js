// ─────────────────────────────────────────────────────────────────────────────
//  main.js — boot, the frame loop, and the wiring between systems
//
//  Boot → device probe → renderer → table → balls → hall → shaders → auth
//  → the walkable hall (menu over it) → a table (match) → back to the hall.
//
//  Everything below is real: the physics, the rules, the AI, the wallet and the
//  progression all run locally and deterministically; the server (when it is
//  reachable) is the authority for accounts, coins and online matches, and the
//  client says so plainly when it is not.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import Scene3D, { detectQuality, QUALITY } from './scene.js';
import Audio from './audio.js';
import Profile from './profile.js';
import Match from './game.js';
import Hall from './hall.js';
import net from './net.js';
import { openPanelByName } from './panels.js';
import { newRack } from './physics.js';
import { $, el, toast, notify, modal, show, screen, txt, fmt, clamp, isModalOpen, currentPanel, closePanel } from './ui.js';

// ── error surface (there is no console on a phone) ──────────────────────────
const errLog = $('errLog');
let errCount = 0;
/** a fatal error stays on screen — fading would hide the reason */
function fatal(msg) {
  console.error('[neurio] FATAL', msg);
  if (!errLog) return;
  errLog.textContent = `⚠ FATAL — ${msg}`;
  errLog.style.opacity = '1';
  clearTimeout(reportError._t);
}
function reportError(where, err) {
  errCount++;
  const msg = `${where}: ${err && err.message ? err.message : err}`;
  console.error('[neurio]', msg, err && err.stack ? '\n' + err.stack : '');
  if (!errLog) return;
  errLog.textContent = `⚠ ${errCount} issue${errCount > 1 ? 's' : ''} — ${msg}`;
  errLog.style.opacity = '1';
  clearTimeout(reportError._t);
  reportError._t = setTimeout(() => { if (errLog) errLog.style.opacity = '0'; }, 9000);
}
window.addEventListener('error', (e) => reportError('script', e.error || e.message));
window.addEventListener('unhandledrejection', (e) => reportError('promise', e.reason));

// ── app state ───────────────────────────────────────────────────────────────
const App = {
  scene: null,
  audio: Audio,
  profile: Profile,
  net,
  hall: null,
  match: null,
  frameCap: 0,
  booted: false,
  inMatch: false,
  menuOpen: true,
};
window.__NEURIO__ = App;                       // handy from a devtools console

const raf = () => new Promise((r) => requestAnimationFrame(() => r()));

// ── boot ────────────────────────────────────────────────────────────────────
async function boot() {
  const fill = $('loadFill');
  const tip = $('loadTip');
  const setProgress = (p, msg) => {
    if (fill) fill.style.width = `${Math.round(p * 100)}%`;
    if (msg && tip) tip.textContent = msg;
  };

  const steps = [
    ['probing the device…', () => {
      const q = Profile.settings.quality === 'auto' ? detectQuality() : Profile.settings.quality;
      Profile._probe = { quality: q, dpr: window.devicePixelRatio || 1, cores: navigator.hardwareConcurrency || 4, touch: matchMedia('(pointer: coarse)').matches };
      return `detected ${q} · ${navigator.hardwareConcurrency || '?'} cores · dpr ${(window.devicePixelRatio || 1).toFixed(1)}`;
    }],
    ['building the renderer…', () => {
      const canvas = $('gl');
      App.scene = new Scene3D(canvas, Profile.settings);
      if (!App.scene.renderer.capabilities.isWebGL2) console.warn('[neurio] WebGL1 fallback');
      canvas.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        reportError('webgl', 'context lost — reload the page');
      });
      return 'webgl ready';
    }],
    ['stretching the cloth…', () => {
      App.scene.buildTable({ cloth: Profile.settings.clothColor, finish: Profile.settings.tableFinish });
      return '9-foot table built';
    }],
    ['hanging the lamps…', () => { App.scene.buildLights(); return 'lamps on'; }],
    ['racking the balls…', () => {
      const balls = newRack('8ball');
      App.scene.syncBalls(balls);
      App._demoBalls = balls;
      return '16 balls racked';
    }],
    ['opening the hall…', () => { App.scene.buildHall(); App.scene.setShowHall(true); return 'hall open'; }],
    ['selecting your cue…', () => { App.scene.buildCue(Profile.cue(Profile.me.equipped)); return Profile.cue(Profile.me.equipped).name; }],
    ['compiling shaders…', () => {
      try { App.scene.renderer.compile(App.scene.scene, App.scene.camera); } catch (e) { /* older three: no-op */ }
      App.scene.render(0.016);
      return 'shaders compiled';
    }],
  ];

  for (let i = 0; i < steps.length; i++) {
    setProgress(i / steps.length, steps[i][0]);
    await raf(); await raf();
    try {
      const note = steps[i][1]();
      setProgress((i + 1) / steps.length, note || steps[i][0]);
    } catch (e) {
      reportError(steps[i][0], e);
      setProgress((i + 1) / steps.length, `${steps[i][0]} (failed)`);
    }
    await raf();
  }

  setProgress(1, 'ready');
  if (!App.scene) {
    // never pretend: a boot that lost its renderer cannot enter the hall
    const why = errLog && errLog.textContent ? errLog.textContent : 'unknown error';
    if (tip) tip.textContent = 'The 3D renderer could not start on this device.';
    show($('authBox'), false);
    fatal(`boot failed: ${why}`);
    return;
  }
  App.booted = true;
  startLoop();
  showAuth();
}

// ── auth ────────────────────────────────────────────────────────────────────
function showAuth() {
  show($('authBox'), true);
  txt('loadTip', App.net.available ? 'sign in, or play as a guest' : 'no server on this page — guest play');
  let register = false;
  const tabL = $('tabLogin'), tabR = $('tabReg'), btn = $('authBtn'), msg = $('authMsg');
  const setTab = (r) => {
    register = r;
    tabL.classList.toggle('on', !r); tabR.classList.toggle('on', r);
    btn.textContent = r ? 'CREATE ACCOUNT' : 'ENTER THE HALL';
    $('authPass').placeholder = r ? 'Choose a password' : 'Password';
    msg.textContent = '';
  };
  tabL.addEventListener('click', () => { Audio.click(); setTab(false); });
  tabR.addEventListener('click', () => { Audio.click(); setTab(true); });

  btn.addEventListener('click', async () => {
    const name = $('authUser').value.trim();
    const pass = $('authPass').value;
    if (name.length < 2) { msg.textContent = 'Username must be at least 2 characters.'; return; }
    if (pass.length < 4) { msg.textContent = 'Password must be at least 4 characters.'; return; }
    msg.textContent = 'contacting the game server…';
    btn.disabled = true;
    const ok = await net.connect();
    btn.disabled = false;
    if (!ok) {
      msg.innerHTML = `Server not reachable (${net.lastError || 'offline'}). Accounts, ranked play, real-money coins and cross-device saves all live on the server — start it with <code>node server/index.js</code> in <code>pool/</code>.<br><br>You can still play every offline mode as a guest; your progress is saved in this browser.`;
      return;
    }
    try {
      const res = await net.auth(name, pass, register);
      if (res && res.profile) Profile.hydrate(res.profile);
      else Profile.rename(name);
      enterHall();
    } catch (e) {
      const why = String(e.message || e);
      msg.textContent = why;
      if (/no such account/i.test(why)) {
        msg.textContent = `${why} — switch to CREATE ACCOUNT, or play as a guest.`;
        setTab(true);
      }
    }
  });

  $('guestBtn').addEventListener('click', () => {
    try {
      Audio.click('confirm');
      const name = $('authUser').value.trim();
      if (name.length >= 2 && Profile.me.guest) Profile.rename(name);
      enterHall();
    } catch (e) {
      reportError('entering the hall', e);
      msg.textContent = `Could not enter: ${e && e.message ? e.message : e}`;
    }
  });
  // pressing Enter in either field is the same as the big button
  for (const id of ['authUser', 'authPass']) {
    $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') btn.click(); });
  }

  // try the server in the background either way — the chip tells the truth
  net.onStatus = (on, why) => { updateNetChip(on, why); if (on) pullProfile(); };
  wireNet();
  if (net.available) { net.connect().then((ok) => updateNetChip(ok, net.lastError)); net.autoRetry(); }
  else updateNetChip(false, 'opened from a file — no server');
}

function updateNetChip(on, why) {
  const chip = $('netChip');
  if (!chip) return;
  chip.classList.toggle('on', !!on);
  chip.classList.toggle('off', !on);
  chip.innerHTML = `<span class="dot"></span><b>${on ? 'server online' : 'offline'}</b>`;
  chip.title = on ? 'Connected — the server is authoritative for coins, friends and results' : `Not connected: ${why || 'unavailable'}. Local play still works fully.`;
  txt('onlineCount', on ? String(1) : '0');
}

// ── the hall ────────────────────────────────────────────────────────────────
function enterHall() {
  screen($('boot'), false);
  screen($('menu'), true);
  App.menuOpen = true;
  refreshMenu();

  if (!App.hall) {
    App.hall = new Hall({
      scene: App.scene, audio: Audio, profile: Profile,
      onPlayTable: (t) => startMatch({ mode: t.mode, game: '8ball', level: Profile.settings.aiLevel || 3, stake: t.mode === 'ai' ? (Profile.settings.stake || 0) : 0, table: t.table, hallLabel: t.label }),
    });
    App.hall.build();
  }
  App.hall.enter();

  // menu buttons
  for (const b of document.querySelectorAll('#menu .mbtn')) {
    if (b._bound) continue;
    b._bound = true;
    b.addEventListener('click', () => {
      Audio.init(); Audio.click();
      openPanelByName(b.dataset.panel, App);
    });
  }
  const bm = $('btnMenu');
  if (bm && !bm._bound) {
    bm._bound = true;
    bm.addEventListener('click', () => { Audio.click(); toggleMenu(); });
  }
  // spectator cameras (available from the hall too, for the demo table)
  for (const b of document.querySelectorAll('#specBar [data-sc]')) {
    b.addEventListener('click', () => {
      Audio.click();
      if (App.match && App.inMatch) App.match.setCamera(b.dataset.sc);
      else App.scene.cam.setMode(b.dataset.sc === 'p1' || b.dataset.sc === 'p2' ? 'aim' : b.dataset.sc, true);
    });
  }
  const sl = $('specLeave');
  if (sl) sl.addEventListener('click', () => { show($('specBar'), false); });

  window.addEventListener('resize', () => App.scene.resize());
  window.addEventListener('orientationchange', () => setTimeout(() => App.scene.resize(), 350));

  // first gesture unlocks WebAudio (browser rule)
  const unlock = () => { Audio.init(); Audio.resume(); if (Profile.settings.music) Audio.setMusic(true); };
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) Audio.suspend(); else Audio.resume();
  });

  notify('Welcome to the hall', 'Walk up to any table with WASD and press PLAY, or open the menu. Press F to wave.', '🎱');
}

function toggleMenu(force) {
  App.menuOpen = force === undefined ? !App.menuOpen : force;
  screen($('menu'), App.menuOpen);
}

function refreshMenu() {
  const me = Profile.me;
  const lv = Profile.levelFromXp(me.xp);
  txt('mName', me.name);
  txt('mAvatar', me.avatar);
  txt('mTitle', Profile.title);
  txt('mLvl', String(lv.level));
  const ring = $('mLvlRing');
  if (ring) ring.style.background = `conic-gradient(var(--teal) ${(lv.into / lv.need * 360).toFixed(0)}deg, rgba(255,255,255,.14) 0deg)`;
  const setW = (id, v) => { const n = $(id); if (n) n.querySelector('b').textContent = fmt(v); };
  setW('wFree', me.wallet.free);
  setW('wBought', me.wallet.bought);
  setW('wBonus', me.wallet.bonus);
  txt('friendBadge', String(me.friends.length));
  txt('inboxBadge', String((me.inbox || []).length));
  txt('hudCoins', fmt(Profile.total));
  const hs = $('hallSub');
  if (hs) hs.innerHTML = `6 tables · ${net.online ? 'server online' : 'offline play'} · ${me.guest ? 'guest profile' : 'saved profile'}`;
}
App.refreshMenu = refreshMenu;

// ── matches ─────────────────────────────────────────────────────────────────
function startMatch(opts) {
  if (!App.scene) return;
  if (App.hall) { App.hall.exit(); }
  screen($('menu'), false);
  App.menuOpen = false;
  show($('specBar'), false);
  App.inMatch = true;

  if (!App.match) {
    App.match = new Match({
      scene: App.scene, audio: Audio, profile: Profile, net,
      onLeave: (kind) => {
        if (kind === 'hall') { backToHall(); return; }
        const stake = App.match.opts && App.match.opts.stake || 0;
        modal('Leave the match?',
          `<p>Walking out forfeits the table.${stake ? ` Your <b>${fmt(stake)} 🪙</b> stake stays in the pot — an online match pays it to your opponent.</p>` : '</p>'}`,
          [
            { label: 'KEEP PLAYING', value: false, cls: 'primary' },
            { label: 'LEAVE', value: true, cls: 'red' },
          ]).then((v) => { if (v) { App.match.stop(); backToHall(); } });
      },
      onResult: (r) => { refreshMenu(); if (net.online) net.saveProfile(Profile.me); },
    });
  }
  App.match.start({
    playerName: Profile.me.name,
    ...opts,
  });
  show($('matchHud'), true);

  if (opts.mode === 'online') {
    if (!net.online) {
      modal('Server offline', '<p>Online 1v1 is decided by the authoritative server — pairings, escrow, every shot replay and the payout. It cannot be played against a local file.</p><p class="hint">Start it with <code>node server/index.js</code> in <code>pool/</code> and reload the page.</p>', [{ label: 'BACK', value: true, cls: 'primary' }])
        .then(() => backToHall());
      return;
    }
    App.searching = true;
    net.findMatch({ game: opts.game || '8ball', stake: opts.stake || 0 })
      .then((d) => {
        if (!App.searching) return;
        if (d && d.matched === false) toast(`Looking for an opponent… ${d.queue || 1} in queue`, '', 4000);
      })
      .catch((e) => {
        App.searching = false;
        notify('Matchmaking failed', String(e && e.message || e), '⚠️');
        backToHall();
      });
  }
}

/** server → client: everything the authority decides lands here */
function wireNet() {
  net.on('presence', (d) => { updateNetChip(true); txt('onlineCount', String(d.online || 0)); });
  net.on('kicked', () => notify('Signed in elsewhere', 'This session was closed because the account signed in somewhere else.', '🔑'));
  net.on('profile.sync', (d) => { if (d && d.profile) { Profile.hydrate(d.profile); refreshMenu(); } });
  net.on('match.start', (d) => {
    App.searching = false;
    if (!App.match) return;
    App.match.adoptOnline(d);
    show($('matchHud'), true);
    notify('Match found', `${d.opponent} · ${d.game === '9ball' ? '9-ball' : '8-ball'} · stake ${fmt(d.stake || 0)} 🪙`, '🎱');
  });
  net.on('match.resolved', (d) => { if (App.match) App.match.onResolved(d); });
  net.on('match.clock', (d) => { if (App.match) App.match.onClock(d); });
  net.on('match.peer', () => notify('Opponent disconnected', 'They have 20 seconds to come back before the table is forfeited.', '🔌'));
  net.on('match.over', (d) => {
    if (App.match) App.match.finishOnline(d);
    refreshMenu();
  });
  net.on('match.queue', (d) => {
    if (d && d.state === 'timeout') {
      App.searching = false;
      notify('No opponent found', `Your ${fmt(d.refund || 0)} 🪙 entry was refunded.`, '🔍');
      backToHall();
    }
  });
  net.on('chat', (d) => {
    const line = `${d.from}: ${d.text}`;
    if (App.hall && App.hall.active) App.hall._say(d.from, d.text);
    else toast(line, '', 4200);
  });
  net.on('wallet.gift', (d) => { notify('Coins received', `${d.from} sent you ${fmt(d.amount)} 🪙 — added to your bonus balance.`, '🎁'); pullProfile(); });
  net.on('loan.ask', (d) => { notify('Loan requested', `${d.from} borrowed ${fmt(d.amount)} 🪙 from you. They owe ${fmt(d.repay)}.`, '🤝'); pullProfile(); });
  net.on('loan.repay', (d) => { notify('Loan repaid', `${d.from} repaid ${fmt(d.amount)} 🪙.`, '🤝'); pullProfile(); });
  net.on('friend.add', (d) => { notify('New friend', `${d.name} added you.`, '🧑‍🤝‍🧑'); pullProfile(); });
}
function pullProfile() {
  if (!net.online) return;
  net.loadProfile().then((r) => { if (r && r.profile) { Profile.hydrate(r.profile); refreshMenu(); } }).catch(() => {});
}
App.startMatch = startMatch;

function backToHall() {
  App.inMatch = false;
  if (App.match) App.match.stop();
  screen($('result'), false);
  show($('result'), false);
  show($('matchHud'), false);
  show($('specBar'), false);
  App.scene.setShowHall(true);
  if (!App.hall) {
    App.hall = new Hall({ scene: App.scene, audio: Audio, profile: Profile, onPlayTable: (t) => startMatch({ mode: t.mode, game: '8ball', level: Profile.settings.aiLevel || 3, stake: 0, table: t.table, hallLabel: t.label }) });
    App.hall.build();
  } else {
    App.hall._bind();
  }
  App.hall.enter();
  App.scene.cam.setMode('free', true);
  refreshMenu();
  Audio.setAmbience(true, 1);
}
App.backToHall = backToHall;

// ── settings plumbing (panels call these) ───────────────────────────────────
App.applyQuality = (q, force) => {
  const name = q === 'auto' ? detectQuality() : q;
  App.scene.setQuality(name, { auto: q === 'auto' });
  App.applyResolution(Profile.settings.resolution || 1);
  applyTableLook();
  if (App.hall && App.hall.active) { App.hall.destroy(); App.hall.build(); }
  App.scene.buildCue(Profile.cue(Profile.me.equipped));
  toast(`Graphics: ${QUALITY[App.scene.quality].name}${q === 'auto' ? ' (auto)' : ''}`);
};
App.applyResolution = (v) => {
  const q = App.scene.Q;
  App.scene.renderer.setPixelRatio(clamp((window.devicePixelRatio || 1) * q.dpr * (v || 1), 0.4, 3));
  App.scene.resize();
};
App.applyBloom = (on) => { if (App.scene.bloom) App.scene.bloom.enabled = !!on && App.scene.Q.bloom; };
App.applyFrameCap = (v) => { App.frameCap = v | 0; };
App.applyCue = () => App.scene.buildCue(Profile.cue(Profile.me.equipped));
App.applyTableLook = applyTableLook;
function applyTableLook() {
  App.scene.buildTable({ cloth: Profile.settings.clothColor, finish: Profile.settings.tableFinish });
  if (App._demoBalls && !App.inMatch) App.scene.syncBalls(App._demoBalls);
}
App.setFullscreen = async (on) => {
  try {
    if (on && !document.fullscreenElement) await document.documentElement.requestFullscreen();
    else if (!on && document.fullscreenElement) await document.exitFullscreen();
  } catch (e) { toast('Fullscreen blocked by the browser', 'warn'); }
};

// ── the frame loop ──────────────────────────────────────────────────────────
let last = 0, acc = 0, fpsT = 0;
const _fwd = new THREE.Vector3(), _camPos = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
function startLoop() {
  last = performance.now();
  const frame = (now) => {
    requestAnimationFrame(frame);
    let dt = (now - last) / 1000;
    if (App.frameCap > 0 && dt * 1000 < 1000 / App.frameCap - 1.2) return;
    last = now;
    dt = clamp(dt, 0.0005, 0.05);
    try {
      if (App.hall && App.hall.active) App.hall.update(dt);
      if (App.match && App.inMatch) App.match.update(dt);
      App.scene.tickQuality(dt);
      App.scene.render(dt);

      // spatial audio follows the camera
      if (Audio.ready && Profile.settings.spatialAudio) {
        const cam = App.scene.camera;
        cam.getWorldPosition(_camPos);
        cam.getWorldDirection(_fwd);
        Audio.setListener(_camPos, _fwd, _up);
      }

      fpsT += dt; acc++;
      if (fpsT >= 0.5) {
        const fps = acc / fpsT;
        App.scene.fps = fps; acc = 0; fpsT = 0;
        const n = $('hudFps');
        if (n && Profile.settings.showFps) { n.textContent = `${fps.toFixed(0)} fps`; n.style.opacity = '1'; }
        else if (n) n.style.opacity = '0';
      }
    } catch (e) {
      reportError('frame', e);
      if (!startLoop._stopped) { startLoop._stopped = true; }
    }
  };
  requestAnimationFrame(frame);
}

// ── global keys ─────────────────────────────────────────────────────────────
window.addEventListener('keydown', (e) => {
  if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  if (e.code === 'Escape') {
    if (isModalOpen()) return;
    if (currentPanel()) { closePanel(); Audio.click('back'); return; }
    if (!App.inMatch && App.menuOpen) { toggleMenu(false); return; }
    if (!App.inMatch) { toggleMenu(true); return; }
  }
  if (e.code === 'KeyM' && !App.inMatch) { toggleMenu(); Audio.click(); }
  if (e.code === 'F1') { e.preventDefault(); Profile.set('showFps', !Profile.settings.showFps); refreshMenu(); }
});

// ── profile → server sync ───────────────────────────────────────────────────
let saveTimer = 0;
Profile.onChange(() => {
  refreshMenu();
  if (!net.online) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { net.saveProfile(Profile.me); } catch (e) {} }, 1200);
});

// ── go ──────────────────────────────────────────────────────────────────────
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

export default App;
