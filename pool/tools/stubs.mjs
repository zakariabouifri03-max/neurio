// ─────────────────────────────────────────────────────────────────────────────
//  tools/stubs.mjs — a browser stand-in for the headless harnesses
//
//  Just enough DOM, a deep-stubbed renderer, a silent audio engine and a
//  virtual wall clock for the real game code (game.js, ui.js, profile.js) to run
//  in Node. Nothing here is used by the shipped game.
// ─────────────────────────────────────────────────────────────────────────────
// ── stub environment ────────────────────────────────────────────────────────
const listeners = [];
function fakeEl(id) {
  const node = {
    id, tagName: 'DIV', _html: '', textContent: '', value: '', disabled: false,
    dataset: {}, title: '', style: new Proxy({}, { get: (t, k) => t[k] ?? '', set: (t, k, v) => { t[k] = v; return true; } }),
    classList: {
      _s: new Set(),
      add(...c) { c.forEach((x) => this._s.add(x)); },
      remove(...c) { c.forEach((x) => this._s.delete(x)); },
      toggle(c, on) { if (on === undefined) on = !this._s.has(c); on ? this._s.add(c) : this._s.delete(c); return on; },
      contains(c) { return this._s.has(c); },
    },
    children: [],
    get firstChild() { return this.children[0] || null; },
    get lastChild() { return this.children[this.children.length - 1] || null; },
    appendChild(c) { this.children.push(c); return c; },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); },
    remove() {},
    querySelector() { return fakeEl('q'); },
    querySelectorAll() { return []; },
    addEventListener(ev, fn) { listeners.push([this, ev, fn]); },
    removeEventListener(ev, fn) { const i = listeners.findIndex(([n, e, f]) => n === this && e === ev && f === fn); if (i >= 0) listeners.splice(i, 1); },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100 }),
    setPointerCapture() {}, releasePointerCapture() {},
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = v; if (v === '') this.children.length = 0; },
  };
  return node;
}
const els = new Map();
const document_ = {
  getElementById: (id) => { if (!els.has(id)) els.set(id, fakeEl(id)); return els.get(id); },
  querySelector: () => fakeEl('sel'),
  querySelectorAll: () => [],
  createElement: (t) => { const n = fakeEl(t); n.tagName = t.toUpperCase(); return n; },
  addEventListener() {}, removeEventListener() {},
  body: fakeEl('body'),
  documentElement: fakeEl('html'),
  hidden: false,
  pointerLockElement: null,
  exitPointerLock() {},
  fullscreenElement: null,
};
const store = new Map();
globalThis.document = document_;
globalThis.window = {
  addEventListener() {}, removeEventListener() {},
  innerWidth: 1440, innerHeight: 900, devicePixelRatio: 1,
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  requestAnimationFrame: (fn) => setTimeout(() => fn(performance.now()), 0),
  localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
};
globalThis.localStorage = globalThis.window.localStorage;
Object.defineProperty(globalThis, 'navigator', {
  value: { hardwareConcurrency: 8, userAgent: 'node', maxTouchPoints: 0 },
  configurable: true, writable: true,
});
globalThis.matchMedia = globalThis.window.matchMedia;
globalThis.requestAnimationFrame = globalThis.window.requestAnimationFrame;
globalThis.HTMLCanvasElement = function () {};
// Keep the real one: the online harness needs genuine sockets.
const RealWebSocket = globalThis.WebSocket;
globalThis.WebSocket = function () { throw new Error('no sockets in the harness'); };

/**
 * A deep stub: any property read returns another stub, any call returns one
 * too, and writes are accepted. That mirrors a Three.js object graph closely
 * enough for the controller to run — `guides.aimLine.material.color.set(...)`
 * just works — without dragging a WebGL context into Node.
 */
function deepStub(tag = 'stub', depth = 0) {
  const cache = new Map();
  const fn = function () { return deepStub(tag + '()', depth + 1); };
  return new Proxy(fn, {
    get(t, k) {
      if (typeof k !== 'symbol' && Object.prototype.hasOwnProperty.call(t, k)) return t[k];
      if (k === Symbol.toPrimitive) return () => 0;
      if (k === 'length') return 0;
      if (k === 'then') return undefined;
      if (typeof k === 'symbol') return undefined;
      if (!cache.has(k)) cache.set(k, deepStub(`${tag}.${String(k)}`, depth + 1));
      return cache.get(k);
    },
    set(t, k, v) { t[k] = v; return true; },
    has() { return true; },
    apply() { return deepStub(tag + '()', depth + 1); },
    construct() { return deepStub(tag + ' new', depth + 1); },
  });
}
const tgt = (x, y, z, tx, ty, tz, fov) => ({ pos: { x, y, z }, tgt: { x: tx, y: ty, z: tz }, fov });

// ── stub renderer + audio ───────────────────────────────────────────────────
const calls = { syncBalls: 0, setCue: 0, guides: 0, simPaths: 0, audio: 0, pockets: 0, strikes: 0 };
const sceneStub = {
  width: 1440, height: 900, fps: 60, quality: 'high',
  Q: { dpr: 1, shadows: true, shadowSize: 1024, bloom: true, hallDetail: 2, lamps: 3 },
  groups: { people: fakeEl('people'), props: fakeEl('props') },
  camera: { position: { x: 0, y: 1, z: 2 }, getWorldPosition(v) { return v; }, getWorldDirection(v) { return v; } },
  canvas: fakeEl('gl'),
  buildCue(def) { calls.buildCue = (calls.buildCue || 0) + 1; return { visible: true }; },
  setCue(o) { calls.setCue++; },
  syncBalls(b) { calls.syncBalls++; if (!b) throw new Error('syncBalls got nothing'); },
  setHeadString() {}, setShowHall() {},
  pickCloth() { return null; },
  resize() {}, render() {}, tickQuality() {},
  worldToScreen: () => ({ x: 10, y: 10, behind: false }),
  cam: {
    mode: 'aim', orbit: { yaw: 0, pitch: 0.2, dist: 2 }, shake: 0,
    setMode(m) { this.mode = m; }, setGoal() {}, cycle() { return this.mode; }, kick() {},
    aimTarget: (cue, dx, dz, pull = 0) => tgt(cue.x - dx * 0.7, 1.0, cue.z - dz * 0.7, cue.x + dx, 0.8, cue.z + dz, 44),
    topTarget: () => tgt(0, 3.05, 0.001, 0, 0, 0, 40),
    closeTarget: (cue, dx, dz) => tgt(cue.x - dx * 0.2, 0.9, cue.z - dz * 0.2, cue.x + dx, 0.8, cue.z + dz, 52),
    actionTarget: () => tgt(0, 1.4, 1.6, 0, 0.8, 0, 50),
    freeTarget: () => tgt(0, 1.4, 2.2, 0, 0.8, 0, 46),
    hallTarget: (x, y, z) => tgt(x, y + 1.6, z + 2, x, y + 0.9, z, 62),
    update() {},
  },
  // the real Guides object is a Three.js scene graph — the deep stub stands in
  guides: Object.assign(deepStub('guides'), {
    level: 2, data: null,
    setLevel(l) { this.level = l; },
    setData(d) { this.data = d; calls.guides++; },
    clear() {}, clearSimPaths() {},
    setSimPaths() { calls.simPaths++; },
    update() {},
  }),
};
const audioStub = new Proxy({
  ready: true, enabled: true, spatial: true, ctx: { currentTime: 0, state: 'running' },
  pocket() { calls.pockets++; }, strike() { calls.strikes++; },
}, {
  get(t, k) {
    if (k in t) return t[k];
    return (...a) => { calls.audio++; };
  },
  set(t, k, v) { t[k] = v; return true; },
});

/**
 * The match controller reads the wall clock (AI "thinking" time, the aim-settle
 * probe debounce, match duration). A headless loop burns thousands of frames a
 * second, so we hand it a virtual clock that advances exactly with the frames —
 * otherwise the AI would appear to think forever.
 */
const vclock = { t: 1000 };
// Only `now` is replaced: undici (fetch/WebSocket) needs the rest of the real
// Performance API for resource timing, so the object itself must stay intact.
try {
  Object.defineProperty(globalThis.performance, 'now', { value: () => vclock.t, configurable: true, writable: true });
} catch (e) {
  Object.defineProperty(globalThis, 'performance', { value: { now: () => vclock.t, timeOrigin: 0 }, configurable: true, writable: true });
}
const yieldToEventLoop = () => new Promise((r) => setTimeout(r, 0));


export { fakeEl, els, document_, store, deepStub, tgt, calls, sceneStub, audioStub, vclock, yieldToEventLoop, listeners, RealWebSocket };
export function resetCounters() { for (const k of Object.keys(calls)) calls[k] = 0; }
export function resetDom() { els.clear(); listeners.length = 0; vclock.t = 1000; }
