// ── Bash Baqi Racing — bootstrap & game state machine ───────────────────────
import * as THREE from 'three';
import { loadSave, persist } from './save.js';
import { MAPS, RIVALS, REWARDS, UPGRADES, carById } from './data.js';
import { Race } from './race.js';
import { Garage, openShop, openCustomize, openUpgrades, openSeries, openHelp, openGfx, showResults, showChampion, closePanel } from './menu.js';
import { BloomFX } from './post.js';
import { audio } from './audio.js';
import { clamp, fmt } from './util.js';

const $ = (id) => document.getElementById(id);

// dev error overlay (helps the user report issues)
addEventListener('error', (e) => {
  const el = $('errLog');
  el.style.display = 'block';
  el.textContent = '⚠️ ' + (e.message || 'Error') + (e.filename ? `\n${e.filename.split('/').pop()}:${e.lineno}` : '');
});

const game = {
  state: 'boot',
  paused: false,
  save: loadSave(),
  persist: () => persist(game.save),
  highQ: !(matchMedia('(pointer: coarse)').matches && Math.min(innerWidth, innerHeight) < 700),
  touch: { left: false, right: false, gas: false, brake: false },
  autoGas: 'ontouchstart' in window && !matchMedia('(pointer: fine)').matches,
  race: null,
  garage: null,
  renderer: null,
  fx: null,
  _shake: 0,
  _pendingSeason: null,
  _fpsT: 0, _fpsN: 0, _fpsNow: 0,
  _gfxLvl: 0, _okN: 0, _acc: 0,
};
window.GAME = game;

// ── economy / stats ─────────────────────────────────────────────────────────
game.spend = ({ coins = 0, gems = 0 }) => {
  if (game.save.coins < coins || game.save.gems < gems) return false;
  game.save.coins -= coins;
  game.save.gems -= gems;
  game.persist();
  return true;
};

game.getUpgrades = (carId) => {
  if (!game.save.upgrades[carId]) game.save.upgrades[carId] = { spd: 0, acc: 0, hnd: 0 };
  return game.save.upgrades[carId];
};

game.carStats = (car) => {
  const u = game.getUpgrades(car.id);
  return {
    topSpeed: (25 + car.spd * 0.235) * (1 + 0.04 * u.spd),
    accel: (9 + car.acc * 0.155) * (1 + 0.04 * u.acc),
    turn: (2.15 + car.hnd * 0.0105) * (1 + 0.04 * u.hnd),
  };
};

game.getStandings = () => {
  if (!game.save.standings) {
    game.save.standings = { YOU: 0 };
    for (const r of RIVALS) game.save.standings[r.name] = 0;
  }
  return game.save.standings;
};

game.refreshTopbar = () => {
  $('statCoins').textContent = fmt(game.save.coins);
  $('statGems').textContent = fmt(game.save.gems);
  $('statTrophies').textContent = fmt(game.save.trophies);
};

// ── fx helpers ───────────────────────────────────────────────────────────────
let toastT = null;
game.toast = (html, warn = false) => {
  const t = $('toast');
  t.innerHTML = html;
  t.classList.toggle('warn', warn);
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), 2600);
};

game.coinPop = function (worldPos) {
  if (!game.race) return;
  const v = worldPos.clone().project(game.race.camera);
  if (v.z > 1) return;
  const x = (v.x * 0.5 + 0.5) * innerWidth, y = (-v.y * 0.5 + 0.5) * innerHeight;
  const s = document.createElement('span');
  s.className = 'coinPop';
  s.textContent = '+5';
  s.style.left = x + 'px'; s.style.top = y + 'px';
  $('coinPops').appendChild(s);
  setTimeout(() => s.remove(), 1100);
};

game.shake = () => { game._shake = 0.9; };
game.speedLines = (on) => { $('speedLines').classList.toggle('on', !!on); };

game.togglePause = () => {
  if (game.state !== 'race') return;
  game.paused = !game.paused;
  $('pauseModal').classList.toggle('open', game.paused);
  if (audio.ctx) { audio.engineOn = false; audio.engine(0, false); }
  audio.click();
};

// ── state transitions ────────────────────────────────────────────────────────
function disposeRace() {
  if (game.race) { game.race.dispose(); game.race = null; }
}

game.startRace = () => {
  closePanel();
  $('results').classList.remove('open');
  disposeRace();
  game.paused = false;
  $('pauseModal').classList.remove('open');
  const map = MAPS[(Math.random() * MAPS.length) | 0];
  game.race = new Race(game, map, onRaceFinish);
  game.state = 'race';
  $('hud').classList.add('on');
  $('garageUI').classList.remove('on');
};

game.maybeSeasonModal = () => {
  const p = game._pendingSeason;
  if (!p) return false;
  game._pendingSeason = null;
  if (p.champIsPlayer) {
    game.save.coins += REWARDS.champReward.coins;
    game.save.gems += REWARDS.champReward.gems;
    game.save.trophies += REWARDS.champReward.trophies;
  } else {
    game.save.coins += 200; // participation
  }
  game.save.standings = null;
  game.save.seasonRace = 0;
  game.save.seasonNum++;
  game.persist();
  game.refreshTopbar();
  showChampion(game, p.standings, p.seasonNum, REWARDS.champReward);
  return true;
};

game.showGarage = () => {
  if (game.maybeSeasonModal()) return;
  closePanel();
  disposeRace();
  game.state = 'garage';
  $('hud').classList.remove('on');
  $('garageUI').classList.add('on');
  if (!game.garage) game.garage = new Garage(game);
  else game.garage.refresh();
  game.refreshTopbar();
};

function onRaceFinish(res) {
  const save = game.save;
  save.races++;
  save.coins += res.coins;
  save.gems += res.gems;
  if (res.trophy) { save.trophies++; save.wins++; }
  // championship points for everyone, in finishing order
  const standings = game.getStandings();
  res.order.forEach((k, i) => {
    const name = k.isPlayer ? 'YOU' : k.rival.name;
    standings[name] = (standings[name] || 0) + REWARDS.champPoints[i];
  });
  save.seasonRace++;
  // season end?
  if (save.seasonRace >= REWARDS.seasonRaces) {
    const champ = Object.entries(standings).sort((a, b) => b[1] - a[1])[0];
    game._pendingSeason = {
      standings: { ...standings },
      seasonNum: save.seasonNum,
      champIsPlayer: champ[0] === 'YOU',
    };
  }
  game.persist();
  game.refreshTopbar();
  showResults(game, res, () => {
    if (!game.maybeSeasonModal()) game.startRace();
  });
}

// ── graphics: resolution presets (up to 4K), FPS cap, 60-FPS stabilizer ────
const RES_TARGETS = { '720': 720, '1080': 1080, '1440': 1440, '2160': 2160 };
const RES_LABELS = { auto: 'AUTO', '720': '720p', '1080': '1080p', '1440': '1440p', '2160': '4K' };
// stabilizer ladder: each step trades quality for framerate
const GFX_STEPS = [
  { scale: 1.0, fx: true },   // L0 full quality
  { scale: 1.0, fx: false },  // L1 bloom off
  { scale: 0.8, fx: false },  // L2 80% resolution
  { scale: 0.62, fx: false }, // L3 62% resolution
  { scale: 0.5, fx: false },  // L4 50% resolution
];

game.fpsCap = () => { const f = game.save.gfx.fps; return f === '30' ? 30 : f === 'max' ? 0 : 60; };

game.gfxBaseRatio = () => {
  const target = RES_TARGETS[game.save.gfx.res];
  if (!target) return Math.min(devicePixelRatio || 1, 2);        // AUTO = native (≤2x)
  let r = clamp(target / innerHeight, 0.5, 5.5);                 // buffer ≈ target height
  const px = innerWidth * innerHeight * r * r;
  if (px > 3840 * 2160) r = Math.sqrt((3840 * 2160) / (innerWidth * innerHeight)); // ≤ ~4K pixels
  return r;
};

game.applyGfx = () => {
  if (!game.renderer) return;
  const step = GFX_STEPS[game._gfxLvl || 0];
  const ratio = game.gfxBaseRatio() * step.scale;
  game.renderer.setPixelRatio(ratio);
  game.renderer.setSize(innerWidth, innerHeight);
  game.fx.enabled = step.fx;
  game.fx.setSize(innerWidth, innerHeight);
  game.updateFpsBadge();
};

game.gfxDown = () => { if ((game._gfxLvl || 0) < GFX_STEPS.length - 1) { game._gfxLvl++; game.applyGfx(); } };
game.gfxUp = () => { if ((game._gfxLvl || 0) > 0) { game._gfxLvl--; game.applyGfx(); } };

game.updateFpsBadge = () => {
  const b = $('hudFps');
  if (b) {
    const fps = Math.round(game._fpsNow || 0);
    const label = RES_LABELS[game.save.gfx.res] || 'AUTO';
    b.textContent = `${fps || '--'} · ${label}${game._gfxLvl > 0 ? ' ▾' + game._gfxLvl : ''}`;
    const target = game.fpsCap() || 60;
    b.classList.toggle('ok', fps > 0 && fps >= target - 6);
    b.classList.toggle('low', fps > 0 && fps < target - 6);
  }
  if (game._gfxInfo) {
    const c = game.renderer.domElement;
    game._gfxInfo.textContent =
      `Rendering ${c.width}×${c.height} @ ${game.renderer.getPixelRatio().toFixed(2)}x · Screen ${innerWidth}×${innerHeight} (DPR ${(devicePixelRatio || 1).toFixed(1)}) · ${Math.round(game._fpsNow || 0)} FPS`;
  }
};

// ── renderer / loop ──────────────────────────────────────────────────────────
function boot() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  $('app').appendChild(renderer.domElement);
  game.renderer = renderer;
  game.fx = new BloomFX(renderer);
  game.applyGfx();

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    let dt = Math.min(clock.getDelta(), 0.08);

    // ── FPS cap + frame pacing (30 / 60-stable / MAX) ──
    const cap = game.fpsCap();
    if (cap) {
      game._acc += dt;
      if (game._acc < 1 / cap - 0.0004) return; // hold the frame → rock-steady cadence
      dt = Math.min(game._acc, 0.08);
      game._acc = 0;
    }

    // ── FPS meter + auto-stabilizer ──
    game._fpsT += dt; game._fpsN++;
    if (game._fpsT > 1.2) {
      const fps = game._fpsN / game._fpsT;
      game._fpsNow = fps;
      game._fpsT = 0; game._fpsN = 0;
      game.updateFpsBadge();
      if (game.save.gfx.stab) {
        const target = cap || 60;
        if (fps < target - 9) { game._okN = 0; game.gfxDown(); }          // struggling → drop a step
        else if (fps >= target - 3) { if (++game._okN >= 3) { game.gfxUp(); game._okN = 0; } } // headroom → recover
        else game._okN = 0;
      } else if (fps < 28 && game.fx.enabled) { game.fx.enabled = false; }
    }

    if (game.state === 'race' && game.race) {
      if (!game.paused) game.race.update(dt);
      game._shake = Math.max(0, game._shake - dt * 2.2);
      game.fx.render(game.race.scene, game.race.camera);
    } else if (game.state === 'garage' && game.garage) {
      game.garage.update(dt);
      game.fx.render(game.garage.scene, game.garage.camera);
    }
  });

  addEventListener('resize', () => {
    const a = innerWidth / innerHeight;
    if (game.race) { game.race.camera.aspect = a; game.race.camera.updateProjectionMatrix(); }
    if (game.garage) { game.garage.camera.aspect = a; game.garage.camera.updateProjectionMatrix(); }
    game.applyGfx(); // recomputes ratio + buffer size (needed for 720p…4K presets)
  });

  wireUI();

  // go! loading screen already visible; start the first race immediately
  setTimeout(() => {
    $('loading').classList.add('hide');
    setTimeout(() => $('loading').remove(), 700);
    game.startRace();
  }, 900);
}

// ── UI wiring ────────────────────────────────────────────────────────────────
function wireUI() {
  game.refreshTopbar();

  $('btnRace').onclick = () => { audio.click(); game.startRace(); };
  $('btnShop').onclick = () => openShop(game);
  $('btnCustom').onclick = () => openCustomize(game);
  $('btnUpg').onclick = () => openUpgrades(game);
  $('btnSeries').onclick = () => openSeries(game);
  $('btnGfx').onclick = () => openGfx(game);
  $('btnHelp').onclick = () => openHelp(game);
  $('panelClose').onclick = () => { audio.click(); closePanel(); };

  $('btnResume').onclick = () => game.togglePause();
  $('btnQuitRace').onclick = () => {
    game.paused = false;
    $('pauseModal').classList.remove('open');
    audio.click();
    game.showGarage();
  };

  const musicBtn = $('btnMusic'), sfxBtn = $('btnSfx');
  const syncAudioBtns = () => {
    musicBtn.textContent = game.save.music ? '🎵' : '🔇';
    sfxBtn.textContent = game.save.sfx ? '🔊' : '🔈';
    musicBtn.classList.toggle('off', !game.save.music);
    sfxBtn.classList.toggle('off', !game.save.sfx);
  };
  musicBtn.onclick = () => {
    game.save.music = !game.save.music;
    game.persist(); syncAudioBtns(); audio.setMusic(game.save.music); audio.click();
  };
  sfxBtn.onclick = () => {
    game.save.sfx = !game.save.sfx;
    game.persist(); syncAudioBtns(); audio.setSfx(game.save.sfx); audio.click();
  };
  audio.musicOn = game.save.music;
  audio.sfxOn = game.save.sfx;
  syncAudioBtns();

  $('btnFull').onclick = () => {
    audio.click();
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  };

  // 📱 PWA install prompt (Android/desktop Chrome)
  let deferredPrompt = null;
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    $('btnInstall').hidden = false;
  });
  $('btnInstall').onclick = async () => {
    audio.click();
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice.catch(() => null);
    deferredPrompt = null;
    $('btnInstall').hidden = true;
  };
  addEventListener('appinstalled', () => {
    $('btnInstall').hidden = true;
    game.toast('📱 Installed! See you on the track 🏁');
  });

  // audio unlock + first gesture
  const unlock = () => { audio.unlock(); };
  addEventListener('pointerdown', unlock, { once: true });
  addEventListener('keydown', unlock, { once: true });

  // touch controls
  const bind = (id, key) => {
    const el = $(id);
    const on = (e) => { e.preventDefault(); game.touch[key] = true; el.classList.add('held'); };
    const off = () => { game.touch[key] = false; el.classList.remove('held'); };
    el.addEventListener('pointerdown', on);
    el.addEventListener('pointerup', off);
    el.addEventListener('pointercancel', off);
    el.addEventListener('pointerleave', off);
  };
  bind('tLeft', 'left'); bind('tRight', 'right'); bind('tBrake', 'brake');
}

boot();
