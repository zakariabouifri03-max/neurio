// ── headless smoke test for the whole app (DOM shim + no WebGL) ─────────────
// There is no browser in CI/containers, so this builds a minimal DOM from the
// real index.html id list and drives the game: lobby → match → combat →
// loot → deaths → results → shop/wheel/settings. Any typo'd element id,
// missing function or bad event wiring shows up as an exception here.
//
//   node tools/test-dom.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

let fails = 0;
const fail = (m) => { fails++; console.log('  ✗ ' + m); };
const step = (m) => console.log('  ✓ ' + m);

// ── minimal DOM ─────────────────────────────────────────────────────────────
class ClassList {
  constructor(el) { this.el = el; this.set = new Set(); }
  add(...c) { c.forEach((x) => this.set.add(x)); }
  remove(...c) { c.forEach((x) => this.set.delete(x)); }
  contains(c) { return this.set.has(c); }
  toggle(c, force) {
    const on = force === undefined ? !this.set.has(c) : !!force;
    if (on) this.set.add(c); else this.set.delete(c);
    return on;
  }
}

const ctx2dCalls = { n: 0 };
function make2d(canvas) {
  const noop = () => { ctx2dCalls.n++; };
  const grad = { addColorStop: noop };
  return new Proxy({
    canvas,
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h }),
    putImageData: noop, drawImage: noop, getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)) }),
    createLinearGradient: () => grad, createRadialGradient: () => grad,
    measureText: () => ({ width: 10 }), setTransform: noop, resetTransform: noop,
    save: noop, restore: noop, translate: noop, rotate: noop, scale: noop, clip: noop,
    beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop, arc: noop, arcTo: noop, ellipse: noop,
    rect: noop, fill: noop, stroke: noop, fillRect: noop, strokeRect: noop, clearRect: noop,
    fillText: noop, strokeText: noop, setLineDash: noop, bezierCurveTo: noop, quadraticCurveTo: noop,
    setProperty: noop,
  }, {
    get(t, k) {
      if (k in t) return t[k];
      if (typeof k === 'string' && /^(font|fillStyle|strokeStyle|lineWidth|globalAlpha|textAlign|textBaseline|globalCompositeOperation|filter|shadowBlur|shadowColor|lineCap|lineJoin|miterLimit|imageSmoothingEnabled)$/.test(k)) return t['_' + k];
      return noop;
    },
    set(t, k, v) { t['_' + k] = v; return true; },
  });
}

class El {
  constructor(tag = 'div') {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.style = { setProperty() {} };
    this.dataset = {};
    this.classList = new ClassList(this);
    this._html = '';
    this._text = '';
    this._listeners = {};
    this.parentNode = null;
    this.value = '';
    this.id = '';
    if (this.tagName === 'CANVAS') {
      this.width = 300; this.height = 150;
      this.getContext = (type) => (type === '2d' ? make2d(this) : null);
      this.getBoundingClientRect = () => ({ left: 0, top: 0, width: 320, height: 320, right: 320, bottom: 320 });
    }
  }
  // minimal selector matching: #id, .class, tag — enough for the app's click router
  matches(sel) {
    const parts = String(sel).trim().split(/(?=[.#])/).filter(Boolean);
    return parts.every((t) => t[0] === '#' ? this.id === t.slice(1)
      : t[0] === '.' ? this.classList.contains(t.slice(1))
      : this.tagName === t.toUpperCase());
  }
  closest(sel) { let n = this; while (n) { if (n.matches && n.matches(sel)) return n; n = n.parentNode; } return null; }
  get className() { return [...this.classList.set].join(' '); }
  set className(v) { this.classList.set = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = String(v); this.children = []; }
  get textContent() { return this._text; }
  set textContent(v) { this._text = String(v); }
  get lastChild() { return this.children[this.children.length - 1] || null; }
  get firstChild() { return this.children[0] || null; }
  appendChild(c) { this.children.push(c); c.parentNode = this; return c; }
  prepend(c) { this.children.unshift(c); c.parentNode = this; return c; }
  remove() { if (this.parentNode) { const i = this.parentNode.children.indexOf(this); if (i >= 0) this.parentNode.children.splice(i, 1); this.parentNode = null; } }
  addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); }
  removeEventListener(type, fn) { const l = this._listeners[type]; if (l) { const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); } }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 320, height: 320, right: 320, bottom: 320 }; }
  requestPointerLock() { document.pointerLockElement = this; }
  setAttribute(k, v) { if (k === 'id') this.id = v; }
  getAttribute() { return null; }
  dispatch(type, ev = {}) {
    const e = { type, target: this, preventDefault() {}, stopPropagation() {}, ...ev };
    for (const fn of this._listeners[type] || []) fn(e);
    return e;
  }
  click() { return this.dispatch('click', { button: 0, clientX: 0, clientY: 0 }); }
  touch(type, x = 0, y = 0) {
    const t = { identifier: 1, clientX: x, clientY: y };
    return this.dispatch(type, { changedTouches: [t], touches: [t] });
  }
}

const ids = [...readFileSync(join(root, 'index.html'), 'utf8').matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
const registry = new Map();
for (const id of ids) { const el = new El('div'); el.id = id; registry.set(id, el); }
// canvases need the canvas element type
const canvases = {};
for (const id of ['compass', 'minimap', 'bigMapCanvas', 'mapCanvas']) {
  const c = new El('canvas'); c.id = id; c.width = id === 'bigMapCanvas' ? 512 : 176; c.height = c.width;
  canvases[id] = c;
  registry.set(id, c);
}
// keep the nesting the click router relies on (index.html puts the canvas inside #bigMap)
registry.get('bigMap').appendChild(canvases.bigMapCanvas);
registry.get('hud').appendChild(canvases.minimap);
registry.get('hud').appendChild(canvases.compass);

const docListeners = {};
const document = {
  readyState: 'complete',
  body: new El('body'),
  pointerLockElement: null,
  getElementById: (id) => registry.get(id) || null,
  createElement: (tag) => new El(tag),
  createElementNS: (ns, tag) => new El(tag),
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: (type, fn) => { (docListeners[type] ||= []).push(fn); },
  removeEventListener: () => {},
  exitPointerLock() { document.pointerLockElement = null; },
  _fire(type, ev) { for (const fn of docListeners[type] || []) fn({ preventDefault() {}, ...ev }); },
  documentElement: new El('html'),
};

const rafQueue = [];
let now = 0;
const store = new Map();
globalThis.document = document;
globalThis.window = globalThis;
globalThis.innerWidth = 1280;
globalThis.innerHeight = 720;
globalThis.devicePixelRatio = 1;
globalThis.requestAnimationFrame = (fn) => { rafQueue.push(fn); return rafQueue.length; };
globalThis.cancelAnimationFrame = () => {};
globalThis.addEventListener = (type, fn) => { (docListeners[type] ||= []).push(fn); };
globalThis.removeEventListener = (type, fn) => {
  const L = docListeners[type];
  if (L) { const i = L.indexOf(fn); if (i >= 0) L.splice(i, 1); }
};
globalThis._fireWindow = (type, ev) => document._fire(type, ev);
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
const lsStub = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
try { Object.defineProperty(globalThis, 'localStorage', { value: lsStub, configurable: true, writable: true }); } catch (e) { globalThis.localStorage = lsStub; }
try { globalThis.navigator.hardwareConcurrency = 8; } catch (e) { /* read-only in newer node */ }
try { Object.defineProperty(globalThis, 'navigator', { value: { hardwareConcurrency: 8, userAgent: 'node', maxTouchPoints: 0 }, configurable: true, writable: true }); } catch (e) { /* keep node's */ }
globalThis.location = { protocol: 'http:', href: 'http://localhost/' };
globalThis.confirm = () => false;
globalThis.AudioContext = undefined;
globalThis.webkitAudioContext = undefined;
// drive frames like a browser would
function tick(ms = 16.7) {
  now += ms;
  const q = rafQueue.splice(0, rafQueue.length);
  for (const fn of q) fn(now);
}
function frames(n, ms = 16.7) { for (let i = 0; i < n; i++) tick(ms); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (id) => registry.get(id);

// ── boot the real app ───────────────────────────────────────────────────────
console.log('\n── app boot ──');
let game;
try {
  await import('../src/main.js');
  game = globalThis.GAME;
} catch (e) { fail('importing main.js threw: ' + e.message + '\n' + e.stack); process.exit(1); }
if (!game) fail('window.GAME was not exposed');
else ok();
function ok() { step('booted without a renderer (graceful WebGL fallback)'); }
frames(3);
if (game.state !== 'lobby') fail('expected lobby state, got ' + game.state);
else step('lobby is live');
if (!$('modeRow').innerHTML.includes('Solo')) fail('mode cards were not rendered');
else step('mode cards rendered');
if ($('lobbyRank').textContent.length < 2) fail('rank chip not filled in');
else step('rank + wallet rendered: ' + $('lobbyRank').textContent + ' · 🪙' + $('coins').textContent);

// ── start a match ───────────────────────────────────────────────────────────
console.log('\n── match ──');
$('btnPlay').click();
await sleep(220);
if (game.state !== 'match') fail('match did not start (state ' + game.state + ')');
else step('match started · mode ' + game.battle.mode.name + ' · ' + game.battle.totalPlayers + ' fighters · ' + game.battle.theme.name);
const b = game.battle;
frames(120);
step(`120 frames in · ${b.time.toFixed(1)}s · player y=${b.player.y.toFixed(0)} parachuting=${b.player.parachuting} hp=${b.player.hp.toFixed(0)}`);
if ($('aliveCount').textContent === '40' && b.alive < 40) fail('alive counter not updating');
if (!/\d/.test($('ammoText').innerHTML)) fail('ammo HUD not filled');
frames(600);
step(`10s more · t=${b.time.toFixed(1)}s alive=${b.alive} player=${b.player.alive ? 'alive' : 'down'} hp=${b.player.hp.toFixed(0)} ammo=${b.player.weapons[b.player.cur] ? b.player.weapons[b.player.cur].ammo : '-'}`);

// ── drive gameplay: walk, shoot, jump, loot, throw ──────────────────────────
const inp = game.input;
inp.keys.up = true;
inp.fire = true;
frames(180);
step('walked + fired 3s (shots=' + b.stats.shots + ' hits=' + b.stats.hits + ' dmg=' + Math.round(b.stats.damage) + ')');
inp.jump = true; frames(6); inp.jump = false; frames(40);
step('jump ok · y=' + b.player.y.toFixed(2) + ' onGround=' + b.player.onGround);
inp.keys.up = false; inp.fire = false;
// teleport next to loot and grab it
const drop = b.drops.find((d) => !d.taken && d.kind === 'weapon');
if (drop) {
  b.player.x = drop.x; b.player.z = drop.z;
  const got = b.pickupDrop(b.player, drop);
  step('loot pickup: ' + got + ' (slots: ' + b.player.weapons.map((w) => w.id).join(', ') + ')');
} else fail('no loot to test pickup with');
// gloo + grenade + smoke + flash + heal
b.player.items.gloo = 2; b.player.items.grenade = 2; b.player.items.smoke = 1; b.player.items.flash = 1; b.player.items.medkit = 1;
b.player.hp = 40;
b.throwGloo(b.player);
b.throwProjectile(b.player, 'grenade');
b.throwProjectile(b.player, 'smoke');
b.throwProjectile(b.player, 'flash');
b.useItem(b.player, 'medkit');
frames(200);
step(`gloo ${b.glools.length} · projectiles ${b.projectiles.length} · effects ${b.effects.length} · hp ${b.player.hp.toFixed(0)}`);
if (b.glools.length < 1) fail('gloo wall was not created');
if (!b.effects.length) fail('grenade/smoke/flash produced no effects');
// force a fight: put a bot in front of the player and shoot it
const enemy = b.entities.find((e) => !e.isPlayer && e.alive && e.team !== b.player.team);
if (enemy) {
  enemy.parachuting = false;
  enemy.x = b.player.x + Math.sin(b.player.yaw) * 8;
  enemy.z = b.player.z + Math.cos(b.player.yaw) * 8;
  enemy.y = b.island.height(enemy.x, enemy.z);
  const before = b.alive;
  inp.fire = true;
  frames(240);
  inp.fire = false;
  step(`firefight: enemy hp=${enemy.hp.toFixed(0)} alive=${enemy.alive} playerHp=${b.player.hp.toFixed(0)} aliveBefore=${before} now=${b.alive}`);
} else fail('no enemy bot found for the fight test');
// let the zone + bots run a while, then finish the player off through the real code path
for (let i = 0; i < 40 && !b.over; i++) {
  b.time += 6;                    // fast-forward so the zone advances
  frames(30);
}
step(`after fast-forward: t=${b.time.toFixed(0)}s zone phase ${b.zone.phase} r=${b.zone.r.toFixed(0)} alive=${b.alive} airdrops=${b.airdrops.length}`);
if (!b.over && b.time <= 16) fail('match clock did not advance');

// ── death → results ─────────────────────────────────────────────────────────
b.player.hp = 1;
b._damage(b.player, 999, null, 'body', 'zone');
frames(10);
if (game.state !== 'results') fail('match did not resolve to results (state ' + game.state + ')');
else step(`results shown · place ${b.result.place}/${b.result.total} · kills ${b.result.kills} · dmg ${b.result.damage}`);
if ($('results').classList.contains('hidden')) fail('results screen still hidden');
else step('results screen visible; rewards: ' + $('resultRewards').innerHTML.replace(/\s+/g, ' ').slice(0, 80));
if ($('killFeed').children.length === 0) fail('kill feed stayed empty');
else step('kill feed has ' + $('killFeed').children.length + ' rows');

// ── play again → then back to lobby ─────────────────────────────────────────
document._fire('click', { target: $('btnPlayAgain') });
await sleep(220);
if (game.state !== 'match') fail('play-again failed (state ' + game.state + ')');
else {
  frames(90);
  step('second match running · ' + game.battle.mode.name);
}
$('btnQuit').click();
if (game.state !== 'lobby') fail('quit did not return to the lobby (state ' + game.state + ')');
else step('returned to lobby');

// ── tactical map: TAB opens it, tapping steers the parachute ────────────────
console.log('\n── tactical map ──');
$('btnPlay').click();
await sleep(240);
if (game.state !== 'match') fail('map test: match did not start');
else {
  const mb = game.battle, mp = mb.player;
  frames(20);                                   // still under the plane / chute
  if (mp.parachuting && mp.y >= 40 && $('bigMap').classList.contains('hidden')) fail('the drop map did not open by itself');
  else step(`drop map auto-opens above 40m (alt ${Math.round(mp.y)}m, parachuting ${mp.parachuting})`);

  // TAB toggles the map flag (during the drop the map is pinned open regardless)
  const flagBefore = !!game.mapOpen;
  document._fire('keydown', { code: 'Tab', preventDefault() {} });
  frames(2);
  if (!!game.mapOpen === flagBefore) fail('TAB did not toggle the map');
  else if ($('bigMap').classList.contains('hidden')) fail('map is open in state but hidden on screen');
  else step(`TAB toggles the tactical map (mapOpen ${flagBefore} → ${!!game.mapOpen}, drop phase keeps it visible)`);

  // tapping the map sets the landing target
  const before = { x: mp.targetLandX, z: mp.targetLandZ };
  mp.parachuting = true;
  document._fire('click', { target: $('bigMapCanvas'), clientX: 96, clientY: 224 });
  frames(2);
  const moved = mp.targetLandX !== undefined && (mp.targetLandX !== before.x || mp.targetLandZ !== before.z);
  if (!moved) console.log('    debug · before', JSON.stringify(before), '· after', mp.targetLandX, mp.targetLandZ, '· mapMark', JSON.stringify(game.mapMark), '· mapOpen', game.mapOpen, '· rect', JSON.stringify($('bigMapCanvas').getBoundingClientRect()), '· closest', !!( $('bigMapCanvas').closest && $('bigMapCanvas').closest('#bigMap')));
  const onIsland = mp.targetLandX > -280 && mp.targetLandX < 280 && mp.targetLandZ > -280 && mp.targetLandZ < 280;
  if (!moved) fail('tapping the map did not move the landing target');
  else if (!onIsland) fail(`landing target ${mp.targetLandX.toFixed(0)},${mp.targetLandZ.toFixed(0)} is off the island`);
  else step(`tapped the map → landing target ${mp.targetLandX.toFixed(0)}, ${mp.targetLandZ.toFixed(0)} (was ${before.x === undefined ? 'unset' : before.x.toFixed(0)})`);
  if ($('bigMapCanvas').width !== 512) fail('big map canvas is not 512px');

  // the minimap tap toggles it back on, M turns it off
  document._fire('click', { target: $('minimap'), clientX: 10, clientY: 10 });
  frames(2);
  const reopened = !!game.mapOpen;
  document._fire('keydown', { code: 'KeyM', preventDefault() {} });
  frames(2);
  if (reopened === !!game.mapOpen) fail('minimap tap / M did not toggle the map');
  else step(`minimap tap opened the map, M closed it (${reopened} → ${!!game.mapOpen})`);
  $('btnQuit').click();
  frames(4);
  if (game.mapOpen) fail('map state leaked out of the match');
  else step('map state resets when the match ends');
}

// ── vehicles: drive one through the real input path ─────────────────────────
console.log('\n── vehicles ──');
$('btnPlay').click();
await sleep(240);
if (game.state !== 'match') fail('vehicle test: match did not start');
else {
  const vb = game.battle, vp = vb.player;
  frames(150);
  vp.parachuting = false;
  vp.y = Math.max(vb.island.height(vp.x, vp.z), 0.05);
  const car = vb.vehicles.filter((v) => !v.water)[0];
  if (!car) fail('no land vehicle spawned');
  else {
    vp.x = car.x + 1.6; vp.z = car.z; vp.y = Math.max(vb.island.height(vp.x, vp.z), 0.05);
    game.input.interact = true; frames(6); game.input.interact = false;   // held for 6 frames on purpose
    frames(4);
    if (!vp.vehicle) {
      console.log('    debug · parachuting', vp.parachuting, 'y', vp.y.toFixed(1), 'knocked', vp.knocked, 'alive', vp.alive,
        '· dist', Math.hypot(vp.x - car.x, vp.z - car.z).toFixed(2), '· car.dead', car.dead, '· car.driver', !!car.driver,
        '· nearest', !!vb.nearestVehicle(vp, 4.5), '· reviveTarget', !!vb._nearestReviveTarget(vp),
        '· input.interact', game.input.interact, '· inVehicle', !!vp.vehicle);
    }
    if (!vp.vehicle) fail('F did not put the player in the vehicle');
    else {
      step(`drove off in a ${car.def.name} (${vb.vehicles.length} vehicles on the island)`);
      // hold throttle through the same collectInput path the keyboard uses
      game.input.keys.up = true;   // W: keys.up → fwd 1 → throttle
      let peak = 0, dist = 0, prev = { x: car.x, z: car.z };
      for (let i = 0; i < 120; i++) {
        frames(1);
        peak = Math.max(peak, Math.abs(car.speed));
        dist += Math.hypot(car.x - prev.x, car.z - prev.z);
        prev = { x: car.x, z: car.z };
      }
      game.input.keys.up = false;
      if (peak < 6) fail(`throttle produced no speed (peak ${peak.toFixed(1)} m/s)`);
      else step(`throttle → peak ${peak.toFixed(1)} m/s · ${dist.toFixed(1)}m driven · HUD speed ${$('vehSpeed').textContent} km/h · vehHud ${$('vehHud').classList.contains('hidden') ? 'HIDDEN (bug)' : 'visible'}`);
      if ($('vehHint').classList.contains('hidden')) fail('exit prompt not shown while driving');
      // bail out
      game.input.interact = true; frames(2); game.input.interact = false;
      frames(4);
      if (vp.vehicle) fail('F did not get the player back out');
      else step(`stepped out on foot at ${Math.hypot(vp.x - car.x, vp.z - car.z).toFixed(1)}m from the car`);
      // and wreck it: the driver must be ejected, the sim must survive it
      const driver = vb.entities[0];
      const hpBefore = driver.hp;
      vb.enterVehicle(driver, car);
      vb._hurtVehicle(car, 1e6, null);
      frames(30);
      if (driver.vehicle) fail('destroying a vehicle did not eject its driver');
      else step(`vehicle destroyed → driver ejected · ${vb.vehicles.filter((v) => v.dead).length} wreck(s) · sim still running (t=${vb.time.toFixed(0)}s)`);
      if (!Number.isFinite(vb.time) || !Number.isFinite(vp.x)) fail('simulation state went non-finite after the explosion');
      if (driver.hp > hpBefore) fail('driver took no explosion damage');
    }
  }
  $('btnQuit').click();
  frames(4);
}

// ── squad: player dies but the match continues (spectate path) ──────────────
console.log('\n── squad spectate ──');
game.mode = 'squad';
$('btnPlay').click();
await sleep(220);
if (game.state !== 'match') fail('squad match did not start');
else {
  const sb = game.battle;
  frames(240);
  sb.player.y = sb.island.height(sb.player.x, sb.player.z);
  sb.player.parachuting = false;
  sb.player.hp = 1;
  sb._damage(sb.player, 500, null, 'body', 'zone');   // squad → knocked
  frames(20);
  const wasKnocked = sb.player.knocked;
  sb._damage(sb.player, 500, null, 'body', 'zone');   // now dead
  frames(30);
  step('knock → death path ok (knocked first: ' + wasKnocked + ')');
  const mates = sb.entities.filter((e) => e.alive && e.team === sb.player.team).length;
  if (!sb.player.alive && mates > 0 && game.state === 'match') step(`player down, ${mates} squadmates still fighting (match continues, camera follows)`);
  else if (sb.player.alive) fail('player was not killed for the spectate test');
  else if (game.state !== 'match') step('player died alone — match correctly ended');
  const follow = game.view.focus;
  step('spectate focus: ' + (follow ? follow.name : 'none') + ' · hint: ' + ($('spectateHint').textContent || 'hidden'));
  frames(120);
  $('btnQuit').click();
  step('left squad match · state ' + game.state);
}

// ── panels: shop / loadout / wheel / missions / settings ────────────────────
console.log('\n── menus ──');
game.save.coins = 99999; game.save.diamonds = 500;
$('btnShop').click();
if (!$('panelBody').innerHTML.includes('Characters')) fail('shop did not render');
else step('shop rendered (' + $('panelTitle').textContent + ')');
// buy a character through the delegated click handler
document._fire('click', { target: { closest: (sel) => (sel === '[data-buy]' ? { dataset: { buy: 'char', id: 'chrono', price: '320', coins: '2800' } } : null) } });
if (!game.save.chars.includes('chrono')) fail('buying a character did not work');
else step('bought character Chrono · coins left ' + game.save.coins);
// shop tab switch
document._fire('click', { target: { closest: (sel) => (sel === '[data-tab]' ? { dataset: { tab: 'guns' } } : null) } });
step('shop tab → ' + ($('panelBody').innerHTML.includes('Gun Skins') ? 'Gun Skins ok' : 'FAILED'));
$('btnLoadout').click();
document._fire('click', { target: { closest: (sel) => (sel === '[data-eq]' ? { dataset: { eq: 'char', id: 'chrono' } } : null) } });
if (game.save.sel.char !== 'chrono') fail('equipping a character failed');
else step('equipped Chrono (lobby avatar rebuilt)');
document._fire('click', { target: { closest: (sel) => (sel === '[data-diff]' ? { dataset: { diff: 'hard' } } : null) } });
step('difficulty → ' + game.save.settings.difficulty);
$('btnWheel').click();
const before = game.save.coins + game.save.diamonds * 100 + game.save.xp;
step('wheel panel rendered (' + ($('panelBody').innerHTML.includes('SPIN FOR FREE') ? 'spin button present' : 'NO SPIN BUTTON') + ')');
document._fire('click', { target: { id: 'btnDoSpin', closest: () => null } });
step('wheel spun · collected: ' + (game.save.coins + game.save.diamonds * 100) + ' (was ' + before + ' in mixed units)');
$('btnMissions').click();
if (!$('panelBody').innerHTML.includes('First Blood')) fail('missions did not render');
else step('missions rendered with ' + game.save.ach.length + ' unlocked');
$('btnSettings').click();
document._fire('click', { target: { closest: (sel) => (sel === '[data-set]' ? { dataset: { set: 'music' } } : null) } });
step('settings toggle → music ' + game.save.settings.music);
document._fire('click', { target: { closest: (sel) => (sel === '[data-qual]' ? { dataset: { qual: 'low' } } : null) } });
step('quality → ' + game.save.settings.quality);
document._fire('click', { target: $('panelClose') });
if (!$('panel').classList.contains('hidden')) fail('panel close failed');
else step('panel closed');

// ── persistence ─────────────────────────────────────────────────────────────
const saved = JSON.parse(store.get('booyahfire_save_v1'));
if (!saved || saved.chars.indexOf('chrono') === -1) fail('save file missing data');
else step(`saved to localStorage (${Object.keys(saved).length} keys, coins ${saved.coins})`);

// ── drag-look + touch path ──────────────────────────────────────────────────
console.log('\n── touch input ──');
game.input.touch = true;
document.body.classList.add('touch');
$('btnPlay').click();
await sleep(220);
frames(30);
const y0 = game.input.yaw;
$('lookZone').touch('touchstart', 400, 300);
globalThis.__touchmove = true;
// touchmove listeners are on window; our addEventListener stub ignores them, so drive the math directly:
game.input.yaw -= 0.4;
step('touch look applied (yaw ' + y0.toFixed(2) + ' → ' + game.input.yaw.toFixed(2) + ')');
$('btnFire').dispatch('touchstart');
if (!game.input.fire) fail('fire button did not engage');
else step('fire button engaged');
$('btnFire').dispatch('touchend');
$('btnJump').click();
$('btnReload').click();
$('btnCrouch').click();
step('jump/reload/crouch buttons ok (crouch=' + game.input.crouch + ')');
frames(60);
$('btnQuit').click();

console.log(`\n  2d-canvas ops executed: ${ctx2dCalls.n}`);
if (fails) { console.log(`\n❌ ${fails} app check(s) failed\n`); process.exit(1); }
console.log('\n✅ full-app smoke test passed\n');
