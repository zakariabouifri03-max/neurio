// tools/boot.mjs — headless boot + playthrough of the REAL src/main.js.
// A stubbed WebGLRenderer (see tools/three-stub) lets the whole game shell run in Node:
// boot sequence, cinematic, missions, input, HUD updates, post pipeline calls and the frame loop.
// run:  node --import ./tools/three-stub/register.mjs tools/boot.mjs
import fs from 'node:fs';

/* ------------------------------------------------------------ clock + DOM */
let clock = 0;
globalThis.performance = { now: () => clock };
const nextTick = (cb) => setTimeout(cb, 0);
globalThis.requestAnimationFrame = nextTick;
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

class FakeCtx {
  constructor(w, h) { this.w = w; this.h = h; this.canvas = { width: w, height: h }; }
  createImageData(w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; }
  getImageData(x, y, w, h) { return this.createImageData(w, h); }
  putImageData() { } fillRect() { } clearRect() { } beginPath() { } closePath() { }
  moveTo() { } lineTo() { } quadraticCurveTo() { } bezierCurveTo() { } arc() { } arcTo() { } ellipse() { }
  fill() { } stroke() { } strokeRect() { } clip() { } rect() { } roundRect() { } drawImage() { }
  save() { } restore() { } translate() { } rotate() { } scale() { } transform() { } setTransform() { }
  createRadialGradient() { return { addColorStop() { } }; }
  createLinearGradient() { return { addColorStop() { } }; }
  createPattern() { return null; }
  measureText(s) { return { width: (s || '').length * 6 }; }
  fillText() { } strokeText() { }
}
function fakeEl(tag = 'div') {
  const el = {
    tagName: tag, style: {}, dataset: {}, children: [], textContent: '', innerHTML: '', value: 0,
    offsetWidth: 1, offsetHeight: 1, width: 190, height: 190, onclick: null, disabled: false,
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      toggle(c, on) { if (on === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); } else if (on) this._s.add(c); else this._s.delete(c); },
      contains(c) { return this._s.has(c); },
    },
    addEventListener() { }, removeEventListener() { }, dispatchEvent() { }, focus() { }, blur() { },
    appendChild(c) { c._parent = el; el.children.push(c); return c; },
    removeChild(c) { el.children = el.children.filter((x) => x !== c); },
    remove() { const p = el._parent || game.ui && game.ui.el.messages; if (p) p.children = p.children.filter((x) => x !== el); },
    setAttribute() { }, getAttribute() { return null; },
    querySelector: () => fakeEl(), querySelectorAll: () => [], closest: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100 }),
    getContext: () => new FakeCtx(1, 1), requestPointerLock() { }, get firstChild() { return el.children[0] || null; },
  };
  return el;
}
const nodes = new Map();
globalThis.document = {
  pointerLockElement: null,
  createElement(tag) {
    if (tag === 'canvas') { const c = fakeEl('canvas'); c.getContext = () => new FakeCtx(c.width, c.height); return c; }
    return fakeEl(tag);
  },
  getElementById(id) { if (!nodes.has(id)) nodes.set(id, fakeEl()); return nodes.get(id); },
  addEventListener() { }, querySelector: () => fakeEl(), querySelectorAll: () => [], body: fakeEl('body'),
  exitPointerLock() { },
};
globalThis.window = {
  innerWidth: 1600, innerHeight: 900, devicePixelRatio: 1,
  addEventListener() { }, removeEventListener() { }, requestAnimationFrame: nextTick, cancelAnimationFrame,
  matchMedia: () => ({ matches: false, addEventListener() { } }),
  location: { href: '', reload() { } },
  AudioContext: undefined, webkitAudioContext: undefined,
};
Object.defineProperty(globalThis, 'navigator', {
  value: { userAgent: 'node-headless', maxTouchPoints: 0, hardwareConcurrency: 8, deviceMemory: 8, platform: 'linux' },
  configurable: true,
});
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, v),
  removeItem: (k) => store.delete(k),
};
globalThis.self = globalThis;
globalThis.location = globalThis.window.location;

/* ------------------------------------------------------------- harness */
const log = (...a) => console.log('[boot]', ...a);
let fails = 0;
function check(name, cond, extra = '') {
  if (cond) log('✓', name, extra);
  else { fails++; log('✗ FAIL', name, extra); }
}
const uiLog = [];
const realConsoleError = console.error;
console.error = (...a) => { uiLog.push(['error', a.map(String).join(' ')]); realConsoleError('[game]', ...a); };
const uncaught = [];
process.on('uncaughtException', (e) => {
  uncaught.push(e);
  console.error('[boot] UNCAUGHT:', e && e.stack ? e.stack : e);
});
process.on('unhandledRejection', (e) => {
  uncaught.push(e);
  console.error('[boot] UNHANDLED REJECTION:', e && e.stack ? e.stack : e);
});

await import('../src/main.js');
const game = globalThis.TsunamiGame || globalThis.window.TsunamiGame;
check('game module booted', !!game);

const waitFor = async (fn, ms = 40000) => {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) return false;
    await new Promise((r) => setTimeout(r, 4));
  }
  return true;
};
const booted = await waitFor(() => game.state === 'title' && !!game.player);
check('boot completed (world + systems built)', booted, `state=${game.state}`);
if (!booted) { log('boot failed:', globalThis.document.getElementById('err').textContent || '(no message)'); process.exit(1); }

// run one frame with a controlled clock
const stepFrame = (ms = 16.667) => { clock += ms; game.tick(); };
// the real page ships these screens with the `hidden` class already on them
const resetScreens = () => {
  for (const k of ['panel', 'pause', 'dead', 'end', 'chapter', 'subtitle', 'prompt', 'fishPanel', 'biteFlash', 'toast', 'cinema']) {
    const el = game.ui.el[k];
    if (el && k !== 'panel') el.classList.add('hidden');
  }
  game.ui.el.panel.classList.add('hidden');
};

const _h = game.vehicles.hero;
const heroSpawnY = _h ? _h.pos.y : 0;
check('escape pickup spawns above the flood line', heroSpawnY > 17, `y=${heroSpawnY.toFixed(1)}`);

/* ------------------------------------------------- 1. title & first frames */
resetScreens();
stepFrame(); stepFrame();
check('title screen renders', game.renderer.renderCount > 0, `renders=${game.renderer.renderCount}`);
check('renderer size was set', game.renderer._size.width === 1600 && game.renderer._size.height === 900);
check('world has real geometry', game.scene.children.length > 20, `scene children=${game.scene.children.length}`);
check('post pipeline configured', !!game.post && (game.post.enabled === (game.quality !== 'low')), `enabled=${game.post.enabled}`);

/* ------------------------------------------------- 2. start → cinematic */
game.onUiAction('start');
check('cinematic started', game.state === 'cinematic', `state=${game.state}`);
const chapterCalls = [];
const origChapter = game.ui.chapter.bind(game.ui);
game.ui.chapter = (t, s, d) => { chapterCalls.push([t, s]); return origChapter(t, s, d); };
const messageCalls = [];
const origMessage = game.ui.message.bind(game.ui);
game.ui.message = (t, d) => { messageCalls.push(t); return origMessage(t, d); };
let cineGroundHits = 0, cineSamples = 0;
for (let i = 0; i < 60 * 34; i++) {                  // ~34 s of cinema
  stepFrame();
  if (i % 30 === 0 && game.state === 'cinematic') {
    const c = game.camera.position;
    const g = game.world.heightAt(c.x, c.z);
    cineSamples++;
    if (c.y < g + 1.0) cineGroundHits++;
  }
}
check('cinematic camera never clips the ground', cineGroundHits === 0, `clipped=${cineGroundHits}/${cineSamples}`);
check('cinematic finished and play began', game.state === 'play', `state=${game.state}`);
check('first mission is live', game.mission === 0, `mission=${game.mission}`);
check('mission objective shown', String(game.ui.el.objText.textContent).length > 4, `obj="${game.ui.el.objText.textContent}"`);

/* ------------------------------------------------- 3. walking & camera */
const p0 = game.player.pos.clone();
game.keys['w'] = true;
for (let i = 0; i < 90; i++) stepFrame();
game.keys['w'] = false;
const walked = p0.distanceTo(game.player.pos);
check('player walks with WASD', walked > 1.5, `moved=${walked.toFixed(2)} m`);
check('camera tracks the player', game.camera.position.distanceTo(game.player.eye) < 9,
  `cam=${game.camera.position.toArray().map((v) => +v.toFixed(1)).join(',')}`);
check('game camera is finite', Number.isFinite(game.camera.position.y));

/* ------------------------------------------- 4. harvest, craft, HUD, panels */
game.survival.harvest; // no-op reference
const bush = game.world.resources.find((r) => r.type === 'bush');
game.player.setPosition(bush.x + 1.2, game.world.heightAt(bush.x + 1.2, bush.z) + 0.2, bush.z);
game.ui.prompt('test');
const promptInfo = game.nearestInteractable();
check('interaction prompt resolves', !!promptInfo, promptInfo ? promptInfo.type : 'none');
game.interact();
check('harvest gives items', game.survival.inv.count('berry') + game.survival.inv.count('fiber') > 0,
  `berry=${game.survival.inv.count('berry')} fiber=${game.survival.inv.count('fiber')}`);
game.ui.openPanel('inv', game.panelCtx());
check('inventory panel opens', game.ui.panelOpen === true);
game.ui.openPanel('craft', game.panelCtx());
game.ui.closePanel();
check('panels close', game.ui.panelOpen === false);
// repair the fishing rod (mission 2)
game.survival.inv.add('rod_broken', 1);
game.survival.inv.add('fiber', 4);
game.survival.inv.add('scrap', 4);
const crafted = game.survival.craft('rod_fix');
check('rod crafted through the UI action', crafted && game.survival.inv.count('rod') > 0);
for (let i = 0; i < 30; i++) stepFrame();

check('mission advanced after crafting the rod', game.mission >= 1, `mission=${game.mission}`);

/* ------------------------------------------------- 5. the tsunami sequence */
check('tsunami armed', !!game.disasters.tsunami, `phase=${game.disasters.tsunamiPhase}`);
let sawFlood = false, sawCollapse = false, maxLevel = -99, playerY0 = game.player.pos.y;
for (let i = 0; i < 60 * 150; i++) {
  stepFrame();
  if (game.disasters.tsunamiPhase === 'flood') sawFlood = true;
  maxLevel = Math.max(maxLevel, game.ocean.level);
  if (game.world.destructibles.some((d) => d.state !== 'standing')) sawCollapse = true;
  if (i === 60 * 20) { game.keys['w'] = true; game.keys['shift'] = true; }   // run inland
}
game.keys['w'] = false; game.keys['shift'] = false;
check('tsunami reached the flood stage', sawFlood, `phase=${game.disasters.tsunamiPhase} level=${maxLevel.toFixed(1)}`);
check('coastal buildings collapsed', sawCollapse);
check('HUD messages were produced', messageCalls.length > 0, `messages=${messageCalls.length}`);
check('chapter cards were shown', chapterCalls.length > 0, chapterCalls.map((c) => c[0]).join(' | '));
check('player still simulated', Number.isFinite(game.player.pos.x) && game.player.pos.y > -60,
  `y=${game.player.pos.y.toFixed(1)} alive=${game.player.alive}`);
check('no uncaught exceptions', uncaught.length === 0, uncaught.map((e) => e.message).join('; '));

/* ------------------------------------------------- 6. vehicle escape path */
const hero = game.vehicles.hero;
check('escape pickup survived the flood', !!hero && !hero.destroyed, hero ? `y=${hero.pos.y.toFixed(1)}` : 'missing');
if (hero) {
  game.player.setPosition(hero.pos.x, hero.pos.y + 0.5, hero.pos.z);
  game.enterVehicle(hero);
  check('boarding a vehicle works', !!game.player.vehicle, `vehicle=${game.player.vehicle?.kind}`);
  const hp0 = hero.pos.clone();
  game.keys['w'] = true;
  for (let i = 0; i < 200; i++) stepFrame();
  const drove = hp0.distanceTo(hero.pos);
  check('the escape pickup drives on the road', drove > 20 && Math.abs(hero.speed) > 5,
    `moved=${drove.toFixed(1)} m speed=${Math.abs(hero.speed).toFixed(1)} y=${hero.pos.y.toFixed(1)}`);
  game.exitVehicle();
  check('exiting a vehicle works', !game.player.vehicle);
}

/* ---------------------------------------------------- 7. pause / save / hud */
game.pause();
check('pause works', game.state === 'paused');
check('pause menu is visible', game.ui.el.pause.classList.contains('hidden') === false);
game.resume();
check('resume works', game.state === 'play');
check('save was written', !!store.get('tsunami.save'));
for (let i = 0; i < 120; i++) stepFrame();
check('frame loop keeps running', game.renderer.renderCount > 60, `renders=${game.renderer.renderCount}`);
check('fps counter is sane', game.fps > 0 && game.fps < 10000, `fps=${game.fps.toFixed(0)}`);
check('no leftover console errors', uiLog.filter((e) => e[0] === 'error').length === 0,
  uiLog.filter((e) => e[0] === 'error').map((e) => e[1]).slice(0, 3).join(' | '));

/* ---------------------------------------------------------- memory sanity */
const geomCount = () => {
  let n = 0; game.scene.traverse(() => n++); return n;
};
log('scene objects:', geomCount(), 'draw-ish meshes:', game.scene.children.length);
log('final state:', game.state, 'mission', game.mission, 'level', game.ocean.level.toFixed(2),
  'health', game.player.health.toFixed(0), 'collapsed', game.world.destructibles.filter((d) => d.state !== 'standing').length);

if (fails) { log(`\n${fails} BOOT CHECK(S) FAILED`); process.exit(1); }
log('\nALL BOOT CHECKS PASSED');
process.exit(0);
