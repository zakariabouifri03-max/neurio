// ── a DOM small enough to fit in a test, big enough to run the game's shell ──
// The duel itself needs no browser; the HUD, the menus, the input layer and the
// WebAudio calls all do. This is the smallest object model that lets every one
// of those run under Node, so a typo in the interface is caught here instead of
// in a browser tab nobody can open.
function ctx2d(w = 1, h = 1) {
  const grad = { addColorStop() {} };
  const target = {
    canvas: { width: w, height: h },
    getImageData: (x, y, ww, hh) => ({ data: new Uint8ClampedArray(ww * hh * 4), width: ww, height: hh }),
    createImageData: (ww, hh) => ({ data: new Uint8ClampedArray(ww * hh * 4), width: ww, height: hh }),
    createRadialGradient: () => grad,
    createLinearGradient: () => grad,
    createPattern: () => ({}),
    measureText: () => ({ width: 10 }),
    putImageData() {},
  };
  return new Proxy(target, {
    get(t, k) { if (k in t) return t[k]; return () => {}; },
    set(t, k, v) { t[k] = v; return true; },
  });
}

class ClassList {
  constructor(el) { this.el = el; this.set = new Set(); }
  add(...c) { c.forEach((x) => x && this.set.add(x)); this._sync(); }
  remove(...c) { c.forEach((x) => this.set.delete(x)); this._sync(); }
  toggle(c, on) { if (on === undefined) { this.set.has(c) ? this.set.delete(c) : this.set.add(c); } else if (on) this.set.add(c); else this.set.delete(c); this._sync(); return this.set.has(c); }
  contains(c) { return this.set.has(c); }
  _sync() { this.el._className = [...this.set].join(' '); }
}

export class El {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.style = { setProperty(k, v) { this[k] = v; }, getPropertyValue(k) { return this[k] ?? ''; } };
    this.dataset = {};
    this.classList = new ClassList(this);
    this._className = '';
    this._text = '';
    this._html = '';
    this.listeners = {};
    this.attrs = {};
    this.parent = null;
    this.value = '';
    this.checked = false;
    this.type = '';
    if (tag === 'canvas') { this.width = 1; this.height = 1; this.getContext = () => ctx2d(this.width, this.height); }
  }
  get className() { return this._className; }
  set className(v) { this._className = v || ''; this.classList.set = new Set(String(v || '').split(/\s+/).filter(Boolean)); }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = String(v); this.children = []; }
  get textContent() { return this._text; }
  set textContent(v) { this._text = String(v); }
  append(...n) { for (const x of n) { if (x == null) continue; x.parent = this; this.children.push(x); } }
  appendChild(n) { this.append(n); return n; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; }
  setAttribute(k, v) { this.attrs[k] = v; }
  getAttribute(k) { return this.attrs[k] ?? null; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }
  removeEventListener(t, fn) { this.listeners[t] = (this.listeners[t] || []).filter((f) => f !== fn); }
  _fire(type, ev = {}) { for (const f of this.listeners[type] || []) f({ preventDefault() {}, stopPropagation() {}, ...ev }); }
  dispatchEvent(ev) { this._fire(ev?.type || 'event', ev); return true; }
  /** Only the selectors the game actually uses: '.class', 'tag', '#id'. */
  querySelectorAll(sel) {
    const out = [];
    const test = (n) => sel === '*' ? true
      : sel.startsWith('.') ? n.classList.contains(sel.slice(1))
      : sel.startsWith('#') ? n.attrs.id === sel.slice(1)
      : sel.includes('.') ? n.tagName === sel.split('.')[0].toUpperCase() && n.classList.contains(sel.split('.')[1])
      : n.tagName === sel.toUpperCase();
    const walk = (n) => { for (const c of n.children) { if (test(c)) out.push(c); walk(c); } };
    walk(this);
    return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  getBoundingClientRect() { return { x: 0, y: 0, width: 1280, height: 720, left: 0, top: 0, right: 1280, bottom: 720 }; }
  focus() {}
  blur() {}
  requestPointerLock() { registry.pointerLockElement = this; document.dispatchEvent({ type: 'pointerlockchange' }); }
}

class AudioParam {
  constructor(v = 0) { this.value = v; }
  setValueAtTime(v) { this.value = v; return this; }
  linearRampToValueAtTime(v) { this.value = v; return this; }
  exponentialRampToValueAtTime(v) { this.value = v; return this; }
  setTargetAtTime(v) { this.value = v; return this; }
}
class Node {
  constructor(kind) { this.kind = kind; this.gain = new AudioParam(1); this.frequency = new AudioParam(440); this.Q = new AudioParam(1); this.playbackRate = new AudioParam(1); this.connections = []; registry.nodes.push(this); }
  connect(n) { this.connections.push(n); return n; }
  disconnect() { this.connections.length = 0; }
  start() { this.started = true; }
  stop() { this.stopped = true; }
}
class FakeAudioContext {
  constructor() { this.sampleRate = 44100; this.currentTime = 0; this.state = 'running'; this.destination = new Node('destination'); }
  resume() { this.state = 'running'; }
  createGain() { return new Node('gain'); }
  createOscillator() { return new Node('osc'); }
  createBiquadFilter() { return new Node('filter'); }
  createBufferSource() { return new Node('source'); }
  createConvolver() { return new Node('convolver'); }
  createBuffer(ch, len) { return { length: len, numberOfChannels: ch, sampleRate: this.sampleRate, getChannelData: () => new Float32Array(len) }; }
}

const registry = { nodes: [], els: new Map(), pointerLockElement: null };

export const document = {
  createElement: (tag) => new El(tag),
  createElementNS: (ns, tag) => new El(tag),
  createTextNode: (t) => { const e = new El('#text'); e.textContent = t; return e; },
  getElementById(id) {
    if (!registry.els.has(id)) { const e = new El('div'); e.attrs.id = id; registry.els.set(id, e); }
    return registry.els.get(id);
  },
  querySelector: () => null,
  addEventListener(t, fn) { (this.listeners ||= {})[t] = (this.listeners[t] || []).concat(fn); },
  removeEventListener() {},
  dispatchEvent(ev) { for (const f of (this.listeners?.[ev.type] || [])) f(ev); return true; },
  body: new El('body'),
  documentElement: new El('html'),
  listeners: {},
  pointerLockElement: null,
  exitPointerLock() { registry.pointerLockElement = null; document.dispatchEvent({ type: 'pointerlockchange' }); },
  hidden: false,
};

const listeners = {};
globalThis.document = document;
globalThis.window = globalThis;
globalThis.self = globalThis;
globalThis.Event = class Event { constructor(type) { this.type = type; } };
try { Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node', serviceWorker: undefined }, configurable: true }); } catch (e) { /* already defined */ }
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.addEventListener = (t, fn) => { (listeners[t] ||= []).push(fn); };
globalThis.removeEventListener = () => {};
globalThis.dispatchEvent = (ev) => { for (const f of (listeners[ev.type] || [])) f(ev); };
globalThis.AudioContext = FakeAudioContext;
globalThis.innerWidth = 1280;
globalThis.innerHeight = 720;
globalThis.devicePixelRatio = 1;
globalThis.performance = globalThis.performance || { now: () => Date.now() };
if (!globalThis.localStorage) {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
}
export { registry, FakeAudioContext };
