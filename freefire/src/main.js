// ── BOOYAH FIRE — bootstrap: lobby, shop, match lifecycle, input, economy ────
import * as THREE from 'three';
import { Battle } from './sim.js';
import { MatchView } from './view.js';
import { Hud } from './hud.js';
import { BloomFX } from './post.js';
import { audio } from './audio.js';
import { Avatar } from './view.js';
import {
  WEAPONS, CHARACTERS, PETS, SKINS_CHAR, SKINS_GUN, SKINS_CHUTE,
  rankFor, MODES, ISLANDS, WHEEL, ECONOMY, ACHIEVEMENTS,
} from './data.js';
import { clamp, clamp01, pick, fmt, fmtTime } from './util.js';

const $ = (id) => document.getElementById(id);
const SAVE_KEY = 'booyahfire_save_v1';

// ── persistence ─────────────────────────────────────────────────────────────
function defaultSave() {
  return {
    v: 1, coins: 1500, diamonds: 30, xp: 0,
    matches: 0, wins: 0, kills: 0, damage: 0, headshots: 0, survival: 0,
    chars: ['kelly', 'alok'], pets: ['none'], charSkins: ['cs0'], gunSkins: ['gs0'], chuteSkins: ['ps0'],
    sel: { char: 'kelly', pet: 'none', skin: 'cs0', gunSkin: 'gs0', chuteSkin: 'ps0' },
    ach: [], lastSpin: 0,
    settings: { sfx: true, music: true, quality: 'auto', sens: 1, autoFire: false, invertY: false, difficulty: 'normal' },
  };
}
function loadSave() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) { s = null; }
  const d = defaultSave();
  if (!s || typeof s !== 'object') return d;
  const out = { ...d, ...s };
  out.sel = { ...d.sel, ...(s.sel || {}) };
  out.settings = { ...d.settings, ...(s.settings || {}) };
  for (const k of ['chars', 'pets', 'charSkins', 'gunSkins', 'chuteSkins', 'ach']) if (!Array.isArray(out[k])) out[k] = d[k];
  return out;
}
function persist() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(game.save)); } catch (e) { /* private mode */ }
}

// ── the game object ─────────────────────────────────────────────────────────
const game = {
  state: 'boot',
  save: loadSave(),
  audio,
  renderer: null,
  bloom: null,
  battle: null,
  view: null,
  hud: null,
  scene: null,
  camera: null,
  lobby: null,
  paused: false,
  mode: 'solo',
  sens: 1,
  input: null,
  _raf: 0,
  _last: 0,
  _matchRewards: null,
  persist,
};
window.GAME = game;

// ── error overlay (so problems are visible on a phone) ─────────────────────
function showFatal(msg) {
  const el = $('errLog');
  if (!el) return;
  el.style.display = 'block';
  el.textContent = '⚠️ ' + msg;
}
addEventListener('error', (e) => showFatal((e.message || 'Error') + (e.filename ? `\n${String(e.filename).split('/').pop()}:${e.lineno}` : '')));
addEventListener('unhandledrejection', (e) => showFatal('Promise: ' + (e.reason && e.reason.message ? e.reason.message : e.reason)));

// ── renderer / post ─────────────────────────────────────────────────────────
function isLowEnd() {
  const coarse = matchMedia('(pointer: coarse)').matches;
  const small = Math.min(innerWidth, innerHeight) < 720;
  const cores = navigator.hardwareConcurrency || 4;
  const q = game.save.settings.quality;
  if (q === 'low') return true;
  if (q === 'high') return false;
  return (coarse && small) || cores <= 4;
}

function createRenderer() {
  try {
    const r = new THREE.WebGLRenderer({ antialias: !isLowEnd(), powerPreference: 'high-performance', stencil: false });
    r.setPixelRatio(Math.min(devicePixelRatio || 1, isLowEnd() ? 1.25 : 2));
    r.setSize(innerWidth, innerHeight);
    r.shadowMap.enabled = !isLowEnd();
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.outputColorSpace = THREE.SRGBColorSpace;
    document.getElementById('app').appendChild(r.domElement);
    r.domElement.addEventListener('click', () => { if (game.state === 'match' && !game.input.touch) requestLock(); });
    return r;
  } catch (e) {
    showFatal('WebGL is not available in this browser — the game needs WebGL 2.');
    return null;
  }
}

function render(scene, camera) {
  if (!game.renderer) return;
  if (game.bloom && game.state === 'match') game.bloom.render(scene, camera);
  else game.renderer.render(scene, camera);
}

// ═══════════════════════════ LOBBY ═════════════════════════════════════════
function buildLobby() {
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 900);
  scene.background = new THREE.Color('#0b1020');
  scene.fog = new THREE.Fog(new THREE.Color('#0b1020'), 26, 120);

  // podium + spotlights
  const podium = new THREE.Mesh(
    new THREE.CylinderGeometry(2.6, 3.0, 0.5, 42),
    new THREE.MeshLambertMaterial({ color: 0x1b2440 })
  );
  podium.position.y = -0.25;
  scene.add(podium);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(2.62, 2.95, 64),
    new THREE.MeshBasicMaterial({ color: 0x35d0ff, transparent: true, opacity: 0.85, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  scene.add(ring);
  scene.add(new THREE.HemisphereLight(0x9fd8ff, 0x14203a, 1.0));
  const key = new THREE.DirectionalLight(0xffffff, 1.5);
  key.position.set(4, 8, 6);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x4d9cff, 1.1);
  rim.position.set(-6, 4, -7);
  scene.add(rim);
  // decorative crates + a gloo wall behind
  for (let i = 0; i < 5; i++) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.1, 1.1), new THREE.MeshLambertMaterial({ color: i % 2 ? 0xb98a4e : 0x8d6432 }));
    c.position.set(-7 + i * 3.4, 0.55, -7.5);
    c.rotation.y = i * 0.4;
    scene.add(c);
  }
  const star = new THREE.Mesh(new THREE.SphereGeometry(60, 16, 10), new THREE.MeshBasicMaterial({ color: 0x16224a, side: THREE.BackSide }));
  scene.add(star);
  return { scene, cam, ring, t: 0 };
}

function lobbyEntity() {
  const s = game.save.sel;
  const char = CHARACTERS.find((c) => c.id === s.char) || CHARACTERS[0];
  const pet = PETS.find((p) => p.id === s.pet) || PETS[0];
  return {
    id: -1, name: 'YOU', isPlayer: true, team: 0, char, pet,
    perk: { hp: 0, speed: 1, dmg: 1, reload: 1 },
    alive: true, knocked: false, x: 0, y: 0, z: 0, yaw: 0, pitch: -0.05,
    velX: 0, velZ: 0, speed: 0, hp: 100, maxHp: 100, helmet: 3, vest: 3,
    weapons: [{ id: 'ak', ammo: 30, reserve: 90, attach: {} }], cur: 0,
    items: {}, parachuting: false, chuteOpen: false, crouch: false, ads: false, punchT: 0,
    reloading: false, using: null, onGround: true, inWater: false, flash: 0, kick: 0,
    lastDamageTime: -99, lastShotTime: -99, footT: 0, spreadHeat: 0, revivingT: 0, reviveProgress: 0,
  };
}

function showLobby() {
  audio.engine(false);
  game.state = 'lobby';
  if (!game.lobby) game.lobby = buildLobby();
  const { scene } = game.lobby;
  if (game.lobbyAvatar) { scene.remove(game.lobbyAvatar.group); game.lobbyAvatar = null; }
  const s = game.save.sel;
  const av = new Avatar(lobbyEntity(), {
    ally: true,
    skinIndex: Math.max(0, SKINS_CHAR.findIndex((x) => x.id === s.skin)),
    gunSkin: Math.max(0, SKINS_GUN.findIndex((x) => x.id === s.gunSkin)),
    chuteSkin: Math.max(0, SKINS_CHUTE.findIndex((x) => x.id === s.chuteSkin)),
  });
  av.group.position.set(0, 0, 0);
  scene.add(av.group);
  game.lobbyAvatar = av;
  $('lobby').classList.remove('hidden');
  $('hud').classList.add('hidden');
  $('results').classList.add('hidden');
  $('deathScreen').classList.add('hidden');
  $('booyah').classList.add('hidden');
  refreshLobbyUI();
}

function refreshLobbyUI() {
  const s = game.save, sel = s.sel;
  const { rank, next } = rankFor(s.xp);
  $('lobbyRank').textContent = `${rank.emoji} ${rank.n}`;
  $('coins').textContent = fmt(s.coins);
  $('diamonds').textContent = fmt(s.diamonds);
  const lo = rank.xp, hi = next ? next.xp : rank.xp + 1;
  $('lobbyXpBar').style.width = (next ? clamp01((s.xp - lo) / (hi - lo)) * 100 : 100).toFixed(1) + '%';
  $('lobbyXpText').textContent = next ? `${fmt(s.xp - lo)} / ${fmt(hi - lo)} XP` : 'MAX RANK';
  const char = CHARACTERS.find((c) => c.id === sel.char) || CHARACTERS[0];
  $('lobbyName').textContent = char.name + (char.perk.label ? ' · ' + char.perk.label : '');
  $('lobbyStats').innerHTML =
    `<b>${s.matches}</b> matches · <b>${s.wins}</b> BOOYAHs · <b>${fmt(s.kills)}</b> kills · <b>${fmt(s.damage)}</b> damage`;
  $('modeRow').innerHTML = MODES.map((m) => `
    <button class="modeCard ${game.mode === m.id ? 'on' : ''}" data-mode="${m.id}">
      <span class="mi">${m.icon}</span><b>${m.name}</b>
      <small>${m.team === 1 ? '1 player' : m.team + ' player squad'} · ${m.team * (m.bots + 1)} fighters</small>
    </button>`).join('');
  const theme = ISLANDS[(s.matches + 3) % ISLANDS.length];
  $('mapPreview').innerHTML = `<span class="te">${theme.emoji}</span> ${theme.name} <small>· next drop zone</small>`;
  $('btnSpin').classList.toggle('ready', canSpin());
  $('btnSpin').innerHTML = canSpin() ? '🎡 FREE SPIN' : '🎡 SPUN TODAY';
}

function canSpin() {
  const last = game.save.lastSpin || 0;
  const day = 24 * 3600 * 1000;
  return Date.now() - last > day;
}

// ═══════════════════════════ MATCH ══════════════════════════════════════════
function startMatch() {
  audio.unlock();
  const s = game.save;
  const seed = (Math.random() * 1e9) | 0;
  const diff = s.settings.difficulty === 'easy' ? 0.3 : s.settings.difficulty === 'hard' ? 0.85 : 0.55;
  $('loading').classList.remove('hide');
  $('loadingTip').textContent = 'dropping into ' + ISLANDS[seed % ISLANDS.length].name + '…';
  // let the loading screen paint before the (synchronous) island generation
  setTimeout(() => {
    const battle = new Battle({
      seed, mode: game.mode, themeId: ISLANDS[seed % ISLANDS.length].id,
      difficulty: diff,
      playerChar: s.sel.char, playerPet: s.sel.pet,
    });
    const lowQ = isLowEnd();
    const view = new MatchView(battle, {
      lowQ,
      skinIndex: Math.max(0, SKINS_CHAR.findIndex((x) => x.id === s.sel.skin)),
      gunSkin: Math.max(0, SKINS_GUN.findIndex((x) => x.id === s.sel.gunSkin)),
      chuteSkin: Math.max(0, SKINS_CHUTE.findIndex((x) => x.id === s.sel.chuteSkin)),
    });
    game.battle = battle;
    game.view = view;
    game.scene = view.scene;
    game.camera = view.camera;
    if (!game.hud) game.hud = new Hud(game);
    game.hud.init(battle, view);
    if (!game.bloom && !lowQ && game.renderer) {
      try { game.bloom = new BloomFX(game.renderer); } catch (e) { game.bloom = null; }
    }
    if (game.bloom) { game.bloom.strength = 0.42; game.bloom.threshold = 0.85; game.bloom.setSize(innerWidth, innerHeight); }
    game.state = 'match';
    game.paused = false;
    game.mode = battle.mode;
    game.killStreak = 0;
    game._matchStart = performance.now();
    resetInput();
    $('lobby').classList.add('hidden');
    $('panel').classList.add('hidden');
    $('results').classList.add('hidden');
    $('deathScreen').classList.add('hidden');
    $('pauseMenu').classList.add('hidden');
    $('loading').classList.add('hide');
    audio.plane();
    game.hud.banner(`DROP ZONE: ${battle.theme.name.toUpperCase()}`, 3.5);
    if (!game.input.touch) requestLock();
  }, 60);
}

function requestLock() {
  const el = game.renderer && game.renderer.domElement;
  if (!el || !el.requestPointerLock) return;
  try { el.requestPointerLock(); } catch (e) { /* ignore */ }
}

// ── input ───────────────────────────────────────────────────────────────────
function toggleMap(force) {
  if (game.state !== 'match') return;
  game.mapOpen = force === undefined ? !game.mapOpen : !!force;
  audio.ui('nav');
}

// tap/click the tactical map → steer the parachute there
function mapTapAt(clientX, clientY) {
  const cv = $('bigMapCanvas');
  const b = game.battle;
  if (!cv || !b) return;
  if (!game.mapOpen && !b.player.parachuting) return;
  const r = cv.getBoundingClientRect ? cv.getBoundingClientRect() : { left: 0, top: 0, width: 512, height: 512 };
  if (!r.width) return;
  const u = (clientX - r.left) / r.width, v = (clientY - r.top) / r.height;
  if (u < 0 || u > 1 || v < 0 || v > 1) return;
  const size = b.island.size;
  const x = clamp((u - 0.5) * size, -size * 0.47, size * 0.47);
  const z = clamp((v - 0.5) * size, -size * 0.47, size * 0.47);
  if (b.player.parachuting) {
    b.player.targetLandX = x; b.player.targetLandZ = z;
    game.hud.toast('🎯 Landing spot marked', 'info');
  } else {
    game.hud.toast('🎯 Marked on the map', 'info');
  }
  game.mapMark = { x, z };
}

function resetInput() {
  game.input = {
    yaw: game.battle ? game.battle.player.yaw : 0,
    pitch: 0, moveX: 0, moveZ: 0, sprint: false, crouch: false, ads: false,
    fire: false, reload: false, switchSlot: null, useMed: false, useFA: false,
    throwGloo: false, throwNade: null, interact: false, punch: false, jump: false,
    keys: {}, touch: matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window,
    joy: { active: false, id: -1, x: 0, y: 0, cx: 0, cy: 0 },
    look: { id: -1, lx: 0, ly: 0 },
  };
  document.body.classList.toggle('touch', game.input.touch);
}

const KEYMAP = {
  KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  ShiftLeft: 'sprint', ShiftRight: 'sprint', ControlLeft: 'crouch', KeyC: 'crouch',
  Space: 'jump',
};

function bindInput() {
  addEventListener('keydown', (e) => {
    const inp = game.input;
    if (!inp) return;
    inp.keys[KEYMAP[e.code] || e.code] = true;
    if (game.state !== 'match') {
      if (e.code === 'Escape') closePanel(), pause(false);
      return;
    }
    switch (e.code) {
      case 'KeyR': inp.reload = true; break;
      case 'Digit1': inp.switchSlot = 0; break;
      case 'Digit2': inp.switchSlot = 1; break;
      case 'KeyH': inp.useMed = true; break;
      case 'KeyJ': inp.useFA = true; break;
      case 'KeyG': inp.throwGloo = true; break;
      case 'KeyV': inp.throwNade = 'grenade'; break;
      case 'KeyB': inp.throwNade = 'smoke'; break;
      case 'KeyN': inp.throwNade = 'flash'; break;
      case 'KeyF': case 'KeyE': inp.interact = true; break;
      case 'Tab': case 'KeyM': toggleMap(); break;
      case 'Escape': pause(!game.paused); break;
      default: break;
    }
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  });
  addEventListener('keyup', (e) => {
    const inp = game.input;
    if (!inp) return;
    inp.keys[KEYMAP[e.code] || e.code] = false;
    if (e.code === 'KeyR') inp.reload = false;
    if (e.code === 'KeyH') inp.useMed = false;
    if (e.code === 'KeyJ') inp.useFA = false;
    if (e.code === 'KeyG') inp.throwGloo = false;
    if (e.code === 'KeyV' || e.code === 'KeyB' || e.code === 'KeyN') inp.throwNade = null;
    if (e.code === 'KeyF' || e.code === 'KeyE') inp.interact = false;
  });
  addEventListener('mousemove', (e) => {
    const inp = game.input;
    if (!inp || game.state !== 'match' || document.pointerLockElement == null) return;
    const s = 0.0022 * (game.save.settings.sens || 1);
    inp.yaw -= e.movementX * s;
    inp.pitch = clamp(inp.pitch - e.movementY * s * (game.save.settings.invertY ? -1 : 1), -1.3, 1.3);
  });
  addEventListener('mousedown', (e) => {
    const inp = game.input;
    if (!inp || game.state !== 'match') return;
    if (e.button === 0 && !game.input.touch) inp.fire = true;
    if (e.button === 2) inp.ads = true;
  });
  addEventListener('mouseup', (e) => {
    const inp = game.input;
    if (!inp) return;
    if (e.button === 0) inp.fire = false;
    if (e.button === 2) inp.ads = false;
  });
  addEventListener('contextmenu', (e) => e.preventDefault());
  addEventListener('wheel', (e) => {
    const inp = game.input;
    if (!inp || game.state !== 'match') return;
    inp.switchSlot = inp.switchSlot === 0 ? 1 : 0;
  }, { passive: true });

  // touch: left joystick, right-side look, buttons
  const joy = $('joyZone'), knob = $('joyKnob');
  const startJoy = (t) => {
    const inp = game.input; if (!inp) return;
    const r = joy.getBoundingClientRect();
    inp.joy = { active: true, id: t.identifier, cx: r.left + r.width / 2, cy: r.top + r.height / 2, x: 0, y: 0 };
  };
  joy.addEventListener('touchstart', (e) => { e.preventDefault(); startJoy(e.changedTouches[0]); }, { passive: false });
  addEventListener('touchmove', (e) => {
    const inp = game.input; if (!inp || game.state !== 'match') return;
    for (const t of e.changedTouches) {
      if (inp.joy.active && t.identifier === inp.joy.id) {
        const dx = t.clientX - inp.joy.cx, dy = t.clientY - inp.joy.cy;
        const R = 58, d = Math.hypot(dx, dy) || 1;
        const k = Math.min(1, d / R);
        inp.joy.x = (dx / d) * k; inp.joy.y = (dy / d) * k;
        knob.style.transform = `translate(${inp.joy.x * R}px, ${inp.joy.y * R}px)`;
        inp.sprint = k > 0.86;
      }
      if (inp.look.id === t.identifier) {
        const s = 0.0055 * (game.save.settings.sens || 1);
        inp.yaw -= (t.clientX - inp.look.lx) * s;
        inp.pitch = clamp(inp.pitch - (t.clientY - inp.look.ly) * s * (game.save.settings.invertY ? -1 : 1), -1.3, 1.3);
        inp.look.lx = t.clientX; inp.look.ly = t.clientY;
      }
    }
  }, { passive: true });
  const endTouch = (e) => {
    const inp = game.input; if (!inp) return;
    for (const t of e.changedTouches) {
      if (t.identifier === inp.joy.id) {
        inp.joy = { active: false, id: -1, x: 0, y: 0, cx: 0, cy: 0 };
        knob.style.transform = 'translate(0,0)';
        inp.sprint = false;
      }
      if (t.identifier === inp.look.id) inp.look.id = -1;
    }
  };
  addEventListener('touchend', endTouch);
  addEventListener('touchcancel', endTouch);
  const lookZone = $('lookZone');
  lookZone.addEventListener('touchstart', (e) => {
    const inp = game.input; if (!inp) return;
    const t = e.changedTouches[0];
    inp.look = { id: t.identifier, lx: t.clientX, ly: t.clientY };
  }, { passive: true });

  // hold-style buttons
  const hold = (el, down, up) => {
    if (!el) return;
    el.addEventListener('touchstart', (e) => { e.preventDefault(); audio.ui('nav'); down(); }, { passive: false });
    el.addEventListener('touchend', (e) => { e.preventDefault(); up(); }, { passive: false });
    el.addEventListener('mousedown', (e) => { e.preventDefault(); down(); });
    el.addEventListener('mouseup', () => up());
  };
  hold($('btnFire'), () => { game.input.fire = true; }, () => { game.input.fire = false; });
  hold($('btnAds'), () => { game.input.ads = true; }, () => { game.input.ads = false; });
  hold($('btnSprint'), () => { game.input.sprint = true; }, () => { game.input.sprint = false; });
  const tap = (el, fn) => el && el.addEventListener('click', (e) => { e.preventDefault(); fn(); });
  tap($('btnJump'), () => { game.input.jump = true; setTimeout(() => { game.input.jump = false; }, 60); });
  tap($('btnReload'), () => { game.input.reload = true; setTimeout(() => { game.input.reload = false; }, 80); });
  tap($('btnCrouch'), () => { game.input.crouch = !game.input.crouch; $('btnCrouch').classList.toggle('on', game.input.crouch); });
  tap($('btnPickup'), () => { game.input.interact = true; setTimeout(() => { game.input.interact = false; }, 80); });
  tap($('btnPause'), () => pause(!game.paused));

  // item bar (works for mouse + touch)
  document.addEventListener('click', (e) => {
    const itemBtn = e.target.closest && e.target.closest('.itemBtn');
    if (itemBtn && game.state === 'match') {
      const id = itemBtn.dataset.item;
      if (id === 'medkit') game.input.useMed = true;
      else if (id === 'firstaid') game.input.useFA = true;
      else if (id === 'gloo') game.input.throwGloo = true;
      else if (id === 'smoke' || id === 'flash' || id === 'grenade') game.input.throwNade = id;
      setTimeout(() => { game.input.useMed = false; game.input.useFA = false; game.input.throwGloo = false; game.input.throwNade = null; }, 90);
      return;
    }
    const mapEl = e.target.closest && e.target.closest('#bigMap');
    if (mapEl && game.state === 'match') { mapTapAt(e.clientX, e.clientY); return; }
    const miniEl = e.target.closest && e.target.closest('#minimap');
    if (miniEl && game.state === 'match') { toggleMap(); return; }
    const pickRow = e.target.closest && e.target.closest('.pickRow');
    if (pickRow && game.state === 'match') {
      const d = game.battle.drops.find((x) => String(x.uid) === pickRow.dataset.drop);
      if (d) {
        const got = game.battle.pickupDrop(game.battle.player, d);
        if (got) audio.pickup();
      }
      return;
    }
    const modeCard = e.target.closest && e.target.closest('.modeCard');
    if (modeCard) {
      game.mode = modeCard.dataset.mode;
      audio.ui('nav');
      refreshLobbyUI();
    }
  });

  // big map: tap to choose a landing spot while parachuting
  const big = $('bigMapCanvas');
  const choose = (e) => {
    if (game.state !== 'match' || !game.battle || !game.battle.player.parachuting) return;
    const r = big.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    const fx = (t.clientX - r.left) / r.width, fz = (t.clientY - r.top) / r.height;
    const size = game.battle.island.size;
    const x = clamp((fx - 0.5) * size, -size / 2, size / 2);
    const z = clamp((fz - 0.5) * size, -size / 2, size / 2);
    game.battle.player.targetLandX = x;
    game.battle.player.targetLandZ = z;
    game.input.moveX = x - game.battle.player.x;
    game.input.moveZ = z - game.battle.player.z;
    game.hud.banner('LANDING SPOT SET 📍', 1.6);
  };
  big.addEventListener('click', choose);
  big.addEventListener('touchstart', (e) => { e.preventDefault(); choose(e); }, { passive: false });
}

function collectInput() {
  const inp = game.input, b = game.battle;
  if (!inp || !b) return null;
  const k = inp.keys;
  let f = 0, s = 0;
  if (k.up) f += 1;
  if (k.down) f -= 1;
  if (k.left) s -= 1;
  if (k.right) s += 1;
  if (inp.joy.active) { f += -inp.joy.y; s += inp.joy.x; }
  const len = Math.hypot(f, s);
  let mx = 0, mz = 0;
  if (len > 0.12) {
    const yaw = inp.yaw;
    const fwdx = Math.sin(yaw), fwdz = Math.cos(yaw);
    const rgtx = Math.cos(yaw), rgtz = -Math.sin(yaw);
    mx = (fwdx * f + rgtx * s) / Math.max(1, len);
    mz = (fwdz * f + rgtz * s) / Math.max(1, len);
    const m = Math.hypot(mx, mz) || 1;
    mx /= m; mz /= m;
  }
  // sprint: Shift key, the on-screen run button, or a full joystick push
  const sprint = !!(k.sprint || inp.sprint || (inp.joy.active && Math.hypot(inp.joy.x, inp.joy.y) > 0.86));
  return {
    yaw: inp.yaw, pitch: inp.pitch, moveX: mx, moveZ: mz,
    fwd: clamp(f, -1, 1), side: clamp(s, -1, 1),   // unrotated: used for driving
    sprint, crouch: !!inp.crouch || !!k.crouch, ads: !!inp.ads,
    fire: !!inp.fire || (game.save.settings.autoFire && !!inp.autoFireHold),
    reload: !!inp.reload, switchSlot: inp.switchSlot, useMed: !!inp.useMed, useFA: !!inp.useFA,
    throwGloo: !!inp.throwGloo, throwNade: inp.throwNade, interact: !!inp.interact,
    punch: false, jump: !!inp.jump,
  };
}

// ═══════════════════════════ MATCH EVENTS → AUDIO/REWARDS ══════════════════
function handleEvents(events) {
  const b = game.battle, p = b.player;
  for (const ev of events) {
    switch (ev.type) {
      case 'shoot': {
        const d = Math.hypot(ev.e.x - p.x, ev.e.z - p.z);
        if (ev.e.isPlayer) audio.shot(WEAPONS[ev.weapon].kind, 0);
        else if (d < 130) audio.shot(WEAPONS[ev.weapon].kind, d);
        break;
      }
      case 'dryfire': audio.dryfire(); break;
      case 'reload': if (ev.e.isPlayer) audio.reload(); break;
      case 'hitmarker': {
        audio.hitmarker(ev.zone === 'head');
        if (ev.kill) {
          audio.kill();
          game.killStreak = (game.killStreak || 0) + 1;
          const streak = game.killStreak;
          const words = streak === 2 ? 'DOUBLE KILL' : streak === 3 ? 'TRIPLE KILL' : streak === 4 ? 'QUAD KILL' : streak >= 5 ? 'RAMPAGE!' : '';
          if (words) { game.hud.banner(`${words} · ${streak} in a row`, 2.2); audio.ui('win'); }
        }
        break;
      }
      case 'death': {
        if (ev.attacker && ev.attacker.isPlayer) {
          game.save.coins += ECONOMY.perKill.coins;
          game.save.xp += ECONOMY.perKill.xp;
          persist();
          game.hud.toast(`💀 ${ev.e.name} eliminated  +${ECONOMY.perKill.coins}🪙`, 'good');
        }
        if (ev.e.isPlayer) {
          audio.death();
          // squad still alive → keep watching, show the "you are down" card
          if (game.state === 'match' && ev.attacker) {
            $('deathBy').textContent = `${ev.attacker.name} (${WEAPONS[ev.source] ? WEAPONS[ev.source].name : ev.source === 'punch' ? 'fists' : 'the zone'})`;
            $('deathScreen').classList.remove('hidden');
          }
        }
        break;
      }
      case 'knock': {
        audio.knock();
        if (ev.attacker && ev.attacker.isPlayer) { game.save.coins += ECONOMY.perKnock.coins; persist(); }
        break;
      }
      case 'revive': audio.revive(); break;
      case 'explode': {
        const d = Math.hypot(ev.x - p.x, ev.z - p.z);
        if (ev.kind === 'grenade') audio.explode(d);
        else if (ev.kind === 'smoke') audio.gloo(true);
        else audio.ui('click');
        break;
      }
      case 'gloo': {
        const d = Math.hypot(ev.x - p.x, ev.z - p.z);
        if (d < 60) audio.gloo(true);
        break;
      }
      case 'pickup': if (ev.e.isPlayer) audio.pickup(); break;
      case 'used': if (ev.e.isPlayer) audio.heal(); break;
      case 'landed': if (ev.e.isPlayer) { audio.land(); audio.parachute(); } break;
      case 'step': if (ev.e.isPlayer) audio.step(ev.surface); break;
      case 'flashed': audio.ui('error'); break;
      case 'gameover': endMatch(ev.result); break;
      default: break;
    }
  }
}

// ═══════════════════════════ END OF MATCH ═══════════════════════════════════
function endMatch(result) {
  audio.engine(false);
  if (game.state !== 'match') return;
  game.state = 'results';
  if (document.pointerLockElement) document.exitPointerLock();
  const s = game.save;
  const aliveSec = result.time;
  let coins = 0, xp = 0, dia = 0;
  coins += Math.round(result.damage * ECONOMY.perDamage.coins);
  xp += Math.round(result.damage * ECONOMY.perDamage.xp);
  coins += Math.round(aliveSec * ECONOMY.survival.coinsPerSec);
  xp += Math.round(aliveSec * ECONOMY.survival.xpPerSec);
  if (result.place > 10) {
    coins += (result.place - 10) * ECONOMY.perPlace.coins;
    xp += (result.place - 10) * ECONOMY.perPlace.xp;
  }
  if (result.place <= 10) { coins += ECONOMY.top10.coins; xp += ECONOMY.top10.xp; }
  if (result.place <= 3) { coins += ECONOMY.top3.coins; xp += ECONOMY.top3.xp; dia += ECONOMY.top3.diamonds; }
  if (result.won) { coins += ECONOMY.booyah.coins; xp += ECONOMY.booyah.xp; dia += ECONOMY.booyah.diamonds; }
  s.coins += coins; s.diamonds += dia; s.xp += xp;
  s.matches++; s.kills += result.kills; s.damage += result.damage;
  s.headshots += result.headshots; s.survival += aliveSec;
  if (result.won) s.wins++;

  // achievements
  const unlocked = [];
  for (const a of ACHIEVEMENTS) {
    if (s.ach.includes(a.id)) continue;
    if (a.test(s)) { s.ach.push(a.id); s.coins += a.reward; unlocked.push(a); }
  }
  persist();
  game._matchRewards = { coins, xp, dia, unlocked };

  // death screen first (if not a win), then results
  const rankNow = rankFor(s.xp);
  $('resultTitle').textContent = result.won ? 'BOOYAH!' : `#${result.place} / ${result.total}`;
  $('resultTitle').className = result.won ? 'rTitle win' : 'rTitle';
  $('resultStats').innerHTML = `
    <div class="stat"><b>${result.kills}</b><span>KILLS</span></div>
    <div class="stat"><b>${fmt(result.damage)}</b><span>DAMAGE</span></div>
    <div class="stat"><b>${(result.accuracy * 100).toFixed(0)}%</b><span>ACCURACY</span></div>
    <div class="stat"><b>${fmtTime(result.time)}</b><span>SURVIVED</span></div>
    <div class="stat"><b>${result.headshots}</b><span>HEADSHOTS</span></div>
    <div class="stat"><b>${result.knocks || 0}</b><span>KNOCKS</span></div>`;
  $('resultRewards').innerHTML = `
    <div class="rew">🪙 +${fmt(coins)}</div>
    <div class="rew">💎 +${dia}</div>
    <div class="rew">⭐ +${fmt(xp)} XP</div>`;
  $('resultRank').innerHTML = `Rank: <b>${rankNow.rank.emoji} ${rankNow.rank.n}</b>` +
    (rankNow.next ? ` <small>(${fmt(rankNow.next.xp - s.xp)} XP to ${rankNow.next.n})</small>` : ' <small>MAX</small>');
  $('resultAch').innerHTML = unlocked.map((a) => `<div class="achPop">🏅 ${a.name} <small>+${a.reward}🪙</small></div>`).join('');
  $('results').classList.remove('hidden');
  $('hud').classList.add('hidden');
  if (result.won) {
    audio.booyah();
    $('booyah').classList.remove('hidden');
    setTimeout(() => $('booyah').classList.add('hidden'), 4200);
  }
  refreshLobbyUI();
}

function pause(on) {
  audio.engine(false);
  if (on) game.mapOpen = false;
  if (game.state !== 'match') return;
  game.paused = on;
  $('pauseMenu').classList.toggle('hidden', !on);
  if (on && document.pointerLockElement) document.exitPointerLock();
}

function quitMatch() {
  audio.engine(false);
  pause(false);
  game.state = 'lobby';
  game.battle = null;
  game.view = null;
  if (game.hud) { game.hud.battle = null; game.hud.view = null; }
  $('hud').classList.add('hidden');
  $('results').classList.add('hidden');
  $('bigMap').classList.add('hidden');
  game.mapOpen = false;
  if (document.pointerLockElement) document.exitPointerLock();
  showLobby();
}

// ═══════════════════════════ PANELS (shop / loadout / …) ════════════════════
function openPanel(title, html) {
  $('panelTitle').textContent = title;
  $('panelBody').innerHTML = html;
  $('panel').classList.remove('hidden');
  audio.ui('nav');
}
function closePanel() { $('panel').classList.add('hidden'); }

function money(price, coins) {
  return coins ? `<span class="pCoin">🪙 ${fmt(coins)}</span>` : price ? `<span class="pDia">💎 ${price}</span>` : '<span class="owned">OWNED</span>';
}

function openShop(tab = 'chars') {
  const s = game.save;
  const tabs = [['chars', '🧑 Characters'], ['pets', '🐾 Pets'], ['skins', '👕 Outfits'], ['guns', '🔫 Gun Skins'], ['chutes', '🪂 Parachutes']];
  let body = `<div class="tabs">${tabs.map(([id, label]) => `<button class="tab ${tab === id ? 'on' : ''}" data-tab="${id}">${label}</button>`).join('')}</div><div class="grid">`;
  const card = (id, kind, name, sub, price, coins, owned, emoji, color) => `
    <div class="card ${owned ? 'owned' : ''}" style="--accent:${color || '#38bdf8'}">
      <div class="cEmoji">${emoji}</div>
      <div class="cName">${name}</div>
      <div class="cSub">${sub || ''}</div>
      ${owned ? `<button class="buyBtn owned" disabled>OWNED</button>`
        : `<button class="buyBtn" data-buy="${kind}" data-id="${id}" data-price="${price}" data-coins="${coins}">${money(price, coins)}</button>`}
    </div>`;
  if (tab === 'chars') {
    body += CHARACTERS.map((c) => card(c.id, 'char', c.name, c.perk.label, c.price, c.coins, s.chars.includes(c.id), c.emoji, c.skin)).join('');
  } else if (tab === 'pets') {
    body += PETS.map((p) => card(p.id, 'pet', p.name, p.perk.label || 'Cosmetic friend', p.price, p.coins, s.pets.includes(p.id), p.emoji, '#a78bfa')).join('');
  } else if (tab === 'skins') {
    body += SKINS_CHAR.map((k) => card(k.id, 'charSkin', k.name, 'Full outfit', k.price, k.coins, s.charSkins.includes(k.id), '👕', k.colors[0])).join('');
  } else if (tab === 'guns') {
    body += SKINS_GUN.map((k) => card(k.id, 'gunSkin', k.name, 'Weapon paint', k.price, k.coins, s.gunSkins.includes(k.id), '🔫', k.tint)).join('');
  } else {
    body += SKINS_CHUTE.map((k) => card(k.id, 'chuteSkin', k.name, 'Parachute canopy', k.price, k.coins, s.chuteSkins.includes(k.id), '🪂', k.a)).join('');
  }
  body += '</div>';
  openPanel('SHOP', body);
}

function openLoadout() {
  const s = game.save;
  const sel = s.sel;
  const opt = (arr, cur, kind, labelOf) => arr.map((o) => `<button class="pick ${o === cur ? 'on' : ''}" data-eq="${kind}" data-id="${o}">${labelOf(o)}</button>`).join('');
  const body = `
    <div class="loadRow"><h3>🧑 Character</h3><div class="picks">${opt(s.chars, sel.char, 'char', (id) => {
      const c = CHARACTERS.find((x) => x.id === id) || CHARACTERS[0];
      return `${c.emoji} ${c.name}`;
    })}</div></div>
    <div class="loadRow"><h3>🐾 Pet</h3><div class="picks">${opt(s.pets, sel.pet, 'pet', (id) => {
      const p = PETS.find((x) => x.id === id) || PETS[0];
      return `${p.emoji} ${p.name}`;
    })}</div></div>
    <div class="loadRow"><h3>👕 Outfit</h3><div class="picks">${opt(s.charSkins, sel.skin, 'charSkin', (id) => {
      const k = SKINS_CHAR.find((x) => x.id === id) || SKINS_CHAR[0];
      return `<i style="background:${k.colors[0]}" class="swatch"></i>${k.name}`;
    })}</div></div>
    <div class="loadRow"><h3>🔫 Weapon paint</h3><div class="picks">${opt(s.gunSkins, sel.gunSkin, 'gunSkin', (id) => {
      const k = SKINS_GUN.find((x) => x.id === id) || SKINS_GUN[0];
      return `<i style="background:${k.tint}" class="swatch"></i>${k.name}`;
    })}</div></div>
    <div class="loadRow"><h3>🪂 Parachute</h3><div class="picks">${opt(s.chuteSkins, sel.chuteSkin, 'chuteSkin', (id) => {
      const k = SKINS_CHUTE.find((x) => x.id === id) || SKINS_CHUTE[0];
      return `<i style="background:${k.a}" class="swatch"></i>${k.name}`;
    })}</div></div>
    <div class="loadRow"><h3>⚙️ Difficulty</h3><div class="picks">
      ${['easy', 'normal', 'hard'].map((d) => `<button class="pick ${s.settings.difficulty === d ? 'on' : ''}" data-diff="${d}">${d === 'easy' ? '😌 Relaxed' : d === 'normal' ? '😎 Normal' : '💀 Hardcore'}</button>`).join('')}
    </div></div>`;
  openPanel('LOADOUT', body);
}

function openWheel() {
  const ready = canSpin();
  const body = `
    <div class="wheelWrap">
      <div class="wheelPrizes">${WHEEL.map((w, i) => `<div class="wp" data-i="${i}"><span>${w.label}</span></div>`).join('')}</div>
      <button id="btnDoSpin" class="bigBtn ${ready ? '' : 'off'}">${ready ? '🎡 SPIN FOR FREE' : '⏳ COME BACK TOMORROW'}</button>
      <small class="wheelNote">One free spin every 24 hours · extra spins cost 💎15</small>
      <button id="btnBuySpin" class="buyBtn" data-price="15">💎 15 · SPIN NOW</button>
    </div>
    <div id="spinResult" class="spinResult"></div>`;
  openPanel('LUCKY WHEEL', body);
}

function doSpin(paid = false) {
  const s = game.save;
  if (!paid && !canSpin()) return;
  if (paid && s.diamonds < 15) { audio.ui('error'); return; }
  if (paid) s.diamonds -= 15;
  else s.lastSpin = Date.now();
  // weighted pick
  const total = WHEEL.reduce((a, w) => a + w.weight, 0);
  let r = Math.random() * total, won = WHEEL[0];
  for (const w of WHEEL) { r -= w.weight; if (r <= 0) { won = w; break; } }
  let msg = '';
  if (won.kind === 'coins') { s.coins += won.amount; msg = `🪙 +${won.amount} coins`; }
  else if (won.kind === 'diamonds') { s.diamonds += won.amount; msg = `💎 +${won.amount} diamonds`; }
  else if (won.kind === 'xp') { s.xp += won.amount; msg = `⭐ +${won.amount} XP`; }
  else if (won.kind === 'skin') {
    const missing = SKINS_GUN.filter((k) => !s.gunSkins.includes(k.id));
    if (missing.length) { const k = pick(Math.random, missing); s.gunSkins.push(k.id); msg = `🔫 ${k.name} gun skin!`; }
    else { s.coins += 800; msg = '🪙 +800 coins (all skins owned)'; }
  } else if (won.kind === 'char') {
    const missing = CHARACTERS.filter((c) => !s.chars.includes(c.id));
    if (missing.length) { const c = pick(Math.random, missing); s.chars.push(c.id); msg = `🧑 ${c.name} unlocked!`; }
    else { s.diamonds += 20; msg = '💎 +20 diamonds (all characters owned)'; }
  }
  persist();
  audio.ui('win');
  const el = $('spinResult');
  if (el) el.innerHTML = `<div class="won">${msg}</div>`;
  refreshLobbyUI();
  openWheel();
  const el2 = $('spinResult');
  if (el2) el2.innerHTML = `<div class="won">${msg}</div>`;
}

function openMissions() {
  const s = game.save;
  const body = `<div class="achList">${ACHIEVEMENTS.map((a) => {
    const done = s.ach.includes(a.id);
    return `<div class="achRow ${done ? 'done' : ''}">
      <span class="aIcon">${done ? '🏅' : '🎯'}</span>
      <span class="aBody"><b>${a.name}</b><small>${a.desc}</small></span>
      <span class="aRew">+${a.reward}🪙</span></div>`;
  }).join('')}</div>
  <div class="statsBox">
    <div><b>${s.matches}</b><span>matches</span></div>
    <div><b>${s.wins}</b><span>booyahs</span></div>
    <div><b>${fmt(s.kills)}</b><span>kills</span></div>
    <div><b>${fmt(s.damage)}</b><span>damage</span></div>
    <div><b>${s.headshots}</b><span>headshots</span></div>
    <div><b>${fmtTime(s.survival)}</b><span>time survived</span></div>
  </div>`;
  openPanel('MISSIONS & STATS', body);
}

function openSettings() {
  const st = game.save.settings;
  const body = `
    <div class="setRow"><label>🔊 Sound effects</label><button class="toggle ${st.sfx ? 'on' : ''}" data-set="sfx">${st.sfx ? 'ON' : 'OFF'}</button></div>
    <div class="setRow"><label>🎵 Music</label><button class="toggle ${st.music ? 'on' : ''}" data-set="music">${st.music ? 'ON' : ''}${st.music ? '' : 'OFF'}</button></div>
    <div class="setRow"><label>🖥️ Graphics</label><div class="picks">${['auto', 'low', 'high'].map((q) => `<button class="pick ${st.quality === q ? 'on' : ''}" data-qual="${q}">${q}</button>`).join('')}</div></div>
    <div class="setRow"><label>🎯 Sensitivity</label><input id="sensRange" type="range" min="0.4" max="2.5" step="0.05" value="${st.sens}"><b id="sensVal">${st.sens.toFixed(2)}</b></div>
    <div class="setRow"><label>🔫 Auto-fire (mobile)</label><button class="toggle ${st.autoFire ? 'on' : ''}" data-set="autoFire">${st.autoFire ? 'ON' : 'OFF'}</button></div>
    <div class="setRow"><label>⬇️ Invert look</label><button class="toggle ${st.invertY ? 'on' : ''}" data-set="invertY">${st.invertY ? 'ON' : 'OFF'}</button></div>
    <div class="setRow"><label>🗑️ Reset progress</label><button id="btnReset" class="dangerBtn">RESET</button></div>
    <div class="helpBox">
      <h4>Desktop</h4>
      <p>WASD move · Mouse look · Left click fire · Right click aim · R reload · 1/2 weapons · H medkit · J first aid · G gloo wall · V grenade · B smoke · N flash · F pickup · Shift sprint · Ctrl/C crouch · Space jump · ESC menu</p>
      <h4>Mobile</h4>
      <p>Left stick moves · drag right side to look · fire / ADS / jump buttons · tap the item bar · tap loot rows to pick up</p>
    </div>`;
  openPanel('SETTINGS', body);
  const range = $('sensRange');
  if (range) range.oninput = () => {
    game.save.settings.sens = parseFloat(range.value);
    $('sensVal').textContent = game.save.settings.sens.toFixed(2);
    persist();
  };
}

function buy(kind, id, price, coins) {
  const s = game.save;
  const costCoins = parseInt(coins || '0', 10), costDia = parseInt(price || '0', 10);
  if (costCoins && s.coins < costCoins) { audio.ui('error'); game.hud && game.hud.toast('Not enough coins', 'bad'); return; }
  if (costDia && s.diamonds < costDia) { audio.ui('error'); return; }
  if (costCoins) s.coins -= costCoins;
  if (costDia) s.diamonds -= costDia;
  if (kind === 'char') s.chars.push(id);
  else if (kind === 'pet') s.pets.push(id);
  else if (kind === 'charSkin') s.charSkins.push(id);
  else if (kind === 'gunSkin') s.gunSkins.push(id);
  else if (kind === 'chuteSkin') s.chuteSkins.push(id);
  audio.ui('buy');
  persist();
  refreshLobbyUI();
  if (kind === 'char') openShop('chars');
  else if (kind === 'pet') openShop('pets');
  else if (kind === 'charSkin') openShop('skins');
  else if (kind === 'gunSkin') openShop('guns');
  else openShop('chutes');
}

function equip(kind, id) {
  const sel = game.save.sel;
  if (kind === 'char') sel.char = id;
  else if (kind === 'pet') sel.pet = id;
  else if (kind === 'charSkin') sel.skin = id;
  else if (kind === 'gunSkin') sel.gunSkin = id;
  else if (kind === 'chuteSkin') sel.chuteSkin = id;
  audio.ui('nav');
  persist();
  openLoadout();
  // refresh the lobby character in place
  const s = game.save.sel;
  if (game.lobbyAvatar) {
    game.lobby.scene.remove(game.lobbyAvatar.group);
    const av = new Avatar(lobbyEntity(), {
      ally: true,
      skinIndex: Math.max(0, SKINS_CHAR.findIndex((x) => x.id === s.skin)),
      gunSkin: Math.max(0, SKINS_GUN.findIndex((x) => x.id === s.gunSkin)),
      chuteSkin: Math.max(0, SKINS_CHUTE.findIndex((x) => x.id === s.chuteSkin)),
    });
    game.lobby.scene.add(av.group);
    game.lobbyAvatar = av;
  }
}

// panel click routing
document.addEventListener('click', (e) => {
  const t = e.target;
  const buyBtn = t.closest && t.closest('[data-buy]');
  if (buyBtn) { buy(buyBtn.dataset.buy, buyBtn.dataset.id, buyBtn.dataset.price, buyBtn.dataset.coins); return; }
  const tab = t.closest && t.closest('[data-tab]');
  if (tab) { openShop(tab.dataset.tab); return; }
  const eq = t.closest && t.closest('[data-eq]');
  if (eq) { equip(eq.dataset.eq, eq.dataset.id); return; }
  const diff = t.closest && t.closest('[data-diff]');
  if (diff) { game.save.settings.difficulty = diff.dataset.diff; persist(); openLoadout(); return; }
  const qual = t.closest && t.closest('[data-qual]');
  if (qual) { game.save.settings.quality = qual.dataset.qual; persist(); openSettings(); return; }
  const setT = t.closest && t.closest('[data-set]');
  if (setT) {
    const key = setT.dataset.set;
    const cur = !!game.save.settings[key];
    game.save.settings[key] = !cur;
    if (key === 'sfx') audio.setSfx(!cur);
    if (key === 'music') audio.setMusic(!cur);
    persist();
    openSettings();
    return;
  }
  if (t.id === 'btnDoSpin') { doSpin(false); return; }
  if (t.id === 'btnBuySpin') { doSpin(true); return; }
  if (t.id === 'btnReset') {
    if (confirm('Reset ALL progress?')) { localStorage.removeItem(SAVE_KEY); game.save = defaultSave(); persist(); refreshLobbyUI(); closePanel(); }
    return;
  }
  if (t.id === 'panelClose') { closePanel(); return; }
  if (t.id === 'btnPlayAgain') { $('results').classList.add('hidden'); startMatch(); return; }
  if (t.id === 'btnLobby2') { $('results').classList.add('hidden'); quitMatch(); return; }
  if (t.id === 'btnReturn') { $('deathScreen').classList.add('hidden'); quitMatch(); return; }
});

// ═══════════════════════════ MAIN LOOP ═════════════════════════════════════
function frame(t) {
  game._raf = requestAnimationFrame(frame);
  const dt = Math.min(0.05, Math.max(0.0005, (t - (game._last || t)) / 1000));
  game._last = t;

  if (game.state === 'match' && game.battle && !game.paused) {
    const input = collectInput();
    const events = game.battle.update(dt, input);
    handleEvents(events);
    if (game.state !== 'match') return;   // match ended inside handleEvents
    game.view.update(dt, events, input);
    game.hud.update(dt, events);
    // spectate: follow a living teammate when we're down
    if (!game.battle.player.alive && game.battle.alive > 0) {
      const mate = game.battle.entities.find((e) => e.alive && e.team === game.battle.player.team);
      game.view.focus = mate || null;
      $('spectateHint').classList.toggle('hidden', !mate);
      if (mate) $('spectateHint').textContent = '👁 SPECTATING ' + mate.name;
    }
    render(game.view.scene, game.view.camera);
  } else if (game.state === 'lobby' && game.lobby) {
    const L = game.lobby;
    L.t += dt;
    L.ring.rotation.z += dt * 0.4;
    L.cam.position.set(Math.sin(L.t * 0.28) * 5.6, 2.5 + Math.sin(L.t * 0.5) * 0.2, Math.cos(L.t * 0.28) * 5.6);
    L.cam.lookAt(0, 1.15, 0);
    if (game.lobbyAvatar) {
      const ent = game.lobbyAvatar.ent;
      ent.yaw += dt * 0.35;
      game.lobbyAvatar.update(dt, true, 0);
    }
    render(L.scene, L.cam);
  } else if (game.state === 'match' && game.paused) {
    render(game.view.scene, game.view.camera);
  }
}

// ═══════════════════════════ BOOT ══════════════════════════════════════════
function boot() {
  game.renderer = createRenderer();
  game.hud = new Hud(game);
  game.state = 'lobby';
  bindInput();
  $('btnPlay').addEventListener('click', () => { audio.unlock(); startMatch(); });
  $('btnShop').addEventListener('click', () => openShop('chars'));
  $('btnLoadout').addEventListener('click', openLoadout);
  $('btnWheel').addEventListener('click', openWheel);
  $('btnSpin').addEventListener('click', () => (canSpin() ? doSpin(false) : openWheel()));
  $('btnMissions').addEventListener('click', openMissions);
  $('btnSettings').addEventListener('click', openSettings);
  $('btnHelp').addEventListener('click', openSettings);
  $('btnResume').addEventListener('click', () => pause(false));
  $('btnQuit').addEventListener('click', quitMatch);
  $('btnShopDeath').addEventListener('click', () => openShop('chars'));
  $('btnDeathsReturn').addEventListener('click', quitMatch);
  $('loading').classList.add('hide');
  audio.setSfx(game.save.settings.sfx);
  audio.setMusic(game.save.settings.music);
  for (const el of document.querySelectorAll('[data-act]')) {
    el.addEventListener('click', () => audio.unlock());
  }
  showLobby();
  game._last = performance.now();
  requestAnimationFrame(frame);
  addEventListener('resize', onResize);
  onResize();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* offline mode unavailable */ });
  }
}

function onResize() {
  const w = innerWidth, h = innerHeight;
  if (game.renderer) {
    game.renderer.setSize(w, h);
    game.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, isLowEnd() ? 1.25 : 2));
  }
  if (game.bloom) game.bloom.setSize(w, h);
  if (game.view) game.view.resize(w, h);
  if (game.lobby) {
    game.lobby.cam.aspect = w / h;
    game.lobby.cam.updateProjectionMatrix();
  }
}

if (document.readyState === 'loading') addEventListener('DOMContentLoaded', boot);
else boot();
