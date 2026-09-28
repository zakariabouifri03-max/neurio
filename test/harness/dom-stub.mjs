// Minimal DOM + AudioContext stubs so the REAL game modules run in Node.
// Canvas 2D contexts and WebAudio nodes are fully-absorbing proxies.

function anyProxy(base = {}) {
  const store = { ...base };
  return new Proxy(store, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'measureText') return () => ({ width: 10 });
      if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern')
        return () => ({ addColorStop() {} });
      if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 });
      if (k === 'getChannelData') return () => new Float32Array(4096);
      if (k === Symbol.toPrimitive) return () => 0;
      const f = new Proxy(function () {}, {
        get(_, k2) {
          if (k2 === Symbol.toPrimitive) return () => 0;
          return anyProxy();
        },
        set() { return true; },
        apply() { return undefined; },
      });
      return f;
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}

function mkClassList() {
  const set = new Set();
  return {
    add: (...c) => c.forEach(x => set.add(x)),
    remove: (...c) => c.forEach(x => set.delete(x)),
    toggle: (c, force) => { const on = force === undefined ? !set.has(c) : !!force; on ? set.add(c) : set.delete(c); return on; },
    contains: (c) => set.has(c),
  };
}

function mkEl(tag = 'div') {
  return {
    tagName: tag.toUpperCase(),
    classList: mkClassList(),
    style: {},
    dataset: {},
    children: [],
    childNodes: [],
    textContent: '',
    innerHTML: '',
    value: '',
    checked: false,
    width: 256, height: 256,
    appendChild(c) { this.children.push(c); return c; },
    append(...cs) { this.children.push(...cs); },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); },
    remove() {},
    setAttribute() {}, removeAttribute() {}, getAttribute() { return null; },
    addEventListener() {}, removeEventListener() {},
    querySelector() { return mkEl(); }, querySelectorAll() { return []; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100 }; },
    requestPointerLock() { return { catch() {} }; },
    exitPointerLock() {},
    getContext() { return _ctx2d; },
    toDataURL() { return 'data:,'; },
    focus() {}, blur() {}, click() {},
  };
}
const _ctx2d = anyProxy();

const elements = new Map();
const document = {
  documentElement: mkEl('html'),
  body: mkEl('body'),
  head: mkEl('head'),
  getElementById(id) { if (!elements.has(id)) elements.set(id, mkEl('div')); return elements.get(id); },
  createElement(tag) { return mkEl(tag); },
  createElementNS(ns, tag) { return mkEl(tag); },
  querySelector() { return mkEl(); },
  querySelectorAll() { return []; },
  addEventListener() {},
  removeEventListener() {},
  pointerLockElement: null,
  exitPointerLock() {},
  hidden: false,
};

class FakeParam {
  constructor() { this.value = 0; }
  setValueAtTime() {} linearRampToValueAtTime() {} exponentialRampToValueAtTime() {}
  setTargetAtTime() {} cancelScheduledValues() {}
}
class FakeNode {
  constructor(kind) {
    this.kind = kind;
    this.gain = new FakeParam(); this.frequency = new FakeParam(); this.Q = new FakeParam();
    this.detune = new FakeParam(); this.pan = new FakeParam(); this.playbackRate = new FakeParam();
    this.positionX = new FakeParam(); this.positionY = new FakeParam(); this.positionZ = new FakeParam();
    this.type = 'sine'; this.buffer = null; this.loop = false;
    return new Proxy(this, {
      get(t, k) {
        if (k in t) return t[k];
        const p = new FakeParam(); t[k] = p; return p;
      },
    });
  }
  connect() { return this; }
  disconnect() {} start() {} stop() {} cancelScheduledValues() {}
}
class FakeAudioContext {
  constructor() { this.currentTime = 0; this.sampleRate = 44100; this.destination = new FakeNode('dest'); this.state = 'running'; }
  resume() { return Promise.resolve(); }
  createGain() { return new FakeNode('gain'); }
  createOscillator() { return new FakeNode('osc'); }
  createBufferSource() { return new FakeNode('src'); }
  createBiquadFilter() { return new FakeNode('filter'); }
  createDynamicsCompressor() { return new FakeNode('comp'); }
  createPanner() { return new FakeNode('panner'); }
  createStereoPanner() { return new FakeNode('stereopanner'); }
  createConvolver() { return new FakeNode('conv'); }
  createChannelMerger() { return new FakeNode('merger'); }
  createChannelSplitter() { return new FakeNode('splitter'); }
  createBuffer(ch, len, rate) { return { length: len, sampleRate: rate, getChannelData: () => new Float32Array(len) }; }
  decodeAudioData() { return Promise.resolve({ length: 1000, sampleRate: 44100, getChannelData: () => new Float32Array(1000) }); }
}

const storage = new Map();
const localStorage = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k),
  clear: () => storage.clear(),
};

const window = {
  innerWidth: 1600, innerHeight: 900, devicePixelRatio: 1,
  addEventListener() {}, removeEventListener() {},
  AudioContext: FakeAudioContext,
  webkitAudioContext: FakeAudioContext,
  localStorage,
  document,
  navigator: { userAgent: 'node' },
  requestAnimationFrame: (cb) => setTimeout(() => cb(performance.now()), 16),
  setTimeout, setInterval, clearTimeout, clearInterval,
  performance,
  URL: globalThis.URL,
};

globalThis.window = window;
globalThis.innerWidth = 1600; globalThis.innerHeight = 900;
globalThis.addEventListener = window.addEventListener;
globalThis.removeEventListener = () => {};
globalThis.document = document;
globalThis.localStorage = localStorage;
globalThis.AudioContext = FakeAudioContext;
try { globalThis.navigator = window.navigator; } catch {}
globalThis.requestAnimationFrame = window.requestAnimationFrame;
if (!globalThis.performance) globalThis.performance = { now: () => Date.now() };
