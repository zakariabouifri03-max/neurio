// ── Minimal DOM/WebGL shim so the client modules can be exercised inside node.
// Used by the headless smoke tests only; the browser never loads this.
const noop = () => {};
class Grad { addColorStop() {} }
export class Ctx2D {
  constructor(c) {
    this.canvas = c; this.font = ''; this.fillStyle = '#000'; this.strokeStyle = '#000';
    this.lineWidth = 1; this.globalAlpha = 1; this.textAlign = 'left'; this.textBaseline = 'alphabetic';
    this.shadowColor = ''; this.shadowBlur = 0; this.globalCompositeOperation = 'source-over';
    this.filter = 'none'; this.lineCap = 'butt'; this.lineJoin = 'miter'; this.miterLimit = 10;
  }
  clearRect() {} fillRect() {} strokeRect() {} beginPath() {} closePath() {} fill() {} stroke() {}
  moveTo() {} lineTo() {} arc() {} ellipse() {} rect() {} roundRect() {} arcTo() {}
  bezierCurveTo() {} quadraticCurveTo() {} save() { this._d = (this._d || 0) + 1; }
  restore() { this._d = Math.max(0, (this._d || 0) - 1); }
  translate() {} rotate() {} scale() {} setTransform() {} transform() {} resetTransform() {} clip() {} drawImage() {}
  createLinearGradient() { return new Grad(); } createRadialGradient() { return new Grad(); } createPattern() { return null; }
  measureText(s) { return { width: String(s).length * 8, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }; }
  fillText() {} strokeText() {} setLineDash() {}
  getImageData(x, y, w, h) { return { data: new Uint8ClampedArray(Math.max(4, w * h * 4)), width: w, height: h }; }
  putImageData() {} createImageData(w, h) { return { data: new Uint8ClampedArray(Math.max(4, w * h * 4)), width: w, height: h }; }
}
class Cls {
  constructor() { this.s = new Set(); }
  add(...c) { c.forEach((x) => this.s.add(x)); } remove(...c) { c.forEach((x) => this.s.delete(x)); }
  toggle(c, f) { if (f === undefined) { this.s.has(c) ? this.s.delete(c) : this.s.add(c); } else if (f) this.s.add(c); else this.s.delete(c); return this.s.has(c); }
  contains(c) { return this.s.has(c); }
  toString() { return [...this.s].join(' '); }
}
export class El {
  constructor(tag = 'div') {
    this.tagName = String(tag).toUpperCase();
    this.style = new Proxy({ setProperty: noop, removeProperty: noop, getPropertyValue: () => '' }, {
      get: (t, k) => (k in t ? t[k] : ''), set: (t, k, v) => { t[k] = v; return true; },
    });
    this.classList = new Cls(); this.children = []; this.dataset = {};
    this.hidden = false; this.value = ''; this.disabled = false; this.checked = false;
    this._html = ''; this._t = '';
    this._ctx = null; this.width = 300; this.height = 150;
    this.id = ''; this.title = ''; this.placeholder = ''; this.type = '';
    this.firstChild = null; this.lastChild = null; this.parentNode = null;
    this.offsetWidth = 800; this.offsetHeight = 600;
  }
  get className() { return this.classList.toString(); }
  set className(v) { this.classList.s = new Set(String(v).split(/\s+/).filter(Boolean)); }
  set innerHTML(v) {
    this._html = String(v);
    this.children = [];
    if (this._html) this._parse(this._html);
    this._sync();
  }
  get innerHTML() { return this._html; }
  set textContent(v) { this._t = String(v); }
  get textContent() { return this._t; }
  getContext(k) { if (k && String(k).startsWith('2d')) return this._ctx || (this._ctx = new Ctx2D(this)); return null; }
  appendChild(c) { if (c && c.parentNode) c.parentNode.children.splice(c.parentNode.children.indexOf(c), 1); this.children.push(c); if (c) c.parentNode = this; this._sync(); return c; }
  append(...cs) { for (const c of cs) { if (typeof c === 'string') continue; this.appendChild(c); } }
  prepend(...cs) { for (const c of cs) if (c) { this.children.unshift(c); c.parentNode = this; } this._sync(); }
  insertAdjacentHTML(pos, html) {
    this._html += String(html);
    if (pos !== 'beforebegin' && pos !== 'afterbegin') this._parse(String(html));
    else { const before = this.children.slice(); this.children = []; this._parse(String(html)); this.children.push(...before); this.children.forEach((c) => c.parentNode = this); }
    this._sync();
  }
  _parse(html) {
    const re = /<([a-zA-Z][\w-]*)((?:\s+[\w:-]+="[^"]*")*)\s*\/?>/g;
    let m;
    while ((m = re.exec(html))) {
      const e = new El(m[1]);
      const ar = /([\w:-]+)="([^"]*)"/g; let a;
      while ((a = ar.exec(m[2] || ''))) {
        const k = a[1], val = a[2];
        if (k === 'id') { e.id = val; e.classList.add(val); }
        else if (k === 'class') e.className = val;
        else if (k.startsWith('data-')) e.dataset[k.slice(5).replace(/-(\w)/g, (x, c) => c.toUpperCase())] = val;
        else if (k === 'type') e.type = val;
        else if (k === 'value') e.value = val;
      }
      this.children.push(e); e.parentNode = this;
    }
  }
  insertBefore(c, ref) { const i = this.children.indexOf(ref); this.children.splice(i < 0 ? this.children.length : i, 0, c); if (c) c.parentNode = this; this._sync(); return c; }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); this._sync(); return c; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  _sync() { this.firstChild = this.children[0] || null; this.lastChild = this.children[this.children.length - 1] || null; }
  get childElementCount() { return this.children.length; }
  querySelector(sel) { return this._q(sel)[0] || null; }
  querySelectorAll(sel) { return this._q(sel); }
  get firstElementChild() { if (!this.children.length) this.appendChild(new El('div')); return this.children[0]; }
  get lastElementChild() { return this.children[this.children.length - 1] || null; }
  querySelectorAllDeep(sel) { return this._q(sel); }
  _q(sel) {
    const out = [];
    const want = String(sel).trim();
    const walk = (n) => {
      for (const c of n.children || []) {
        let hit = false;
        if (want.startsWith('.')) hit = c.classList.contains(want.slice(1));
        else if (want.startsWith('#')) hit = c.id === want.slice(1);
        else if (want.startsWith('[')) {
          const m = /^\[([\w-]+)(?:="?([^"\]]*)"?)?\]$/.exec(want);
          if (m) { const k = m[1].replace(/^data-/, '').replace(/-(\w)/g, (s, x) => x.toUpperCase()); hit = String(c.dataset[k] ?? '') === String(m[2] ?? ''); }
        } else hit = c.tagName === want.toUpperCase();
        if (hit) out.push(c);
        out.push(...(c._q ? [] : []));
        walk(c);
      }
    };
    walk(this);
    return out;
  }
  closest(sel) { let n = this; while (n) { if (n._q && (sel.startsWith('.') ? n.classList.contains(sel.slice(1)) : n.tagName === sel.toUpperCase())) return n; n = n.parentNode; } return null; }
  addEventListener(t, f) { (this._ev = this._ev || {})[t] = (this._ev[t] || []).concat(f); }
  removeEventListener() {} dispatch(t, e = {}) { for (const f of (this._ev || {})[t] || []) f({ target: this, preventDefault: noop, stopPropagation: noop, ...e }); }
  click() { this.dispatch('click'); if (typeof this.onclick === 'function') this.onclick({ target: this, currentTarget: this, preventDefault: noop }); }
  select() {} focus() {} blur() {} scrollIntoView() {}
  setPointerCapture() {} releasePointerCapture() {} hasPointerCapture() { return false; }
  getBoundingClientRect() { return { x: 0, y: 0, width: this.offsetWidth, height: this.offsetHeight, left: 0, top: 0, right: this.offsetWidth, bottom: this.offsetHeight, toJSON() {} }; }
  toDataURL() { return 'data:image/png;base64,iVBORw0KGgo='; }
  animate() { return { cancel: noop, finished: Promise.resolve(), onfinish: null }; }
  classListX() {}
}

export function installDom({ ids = [], classes = [] } = {}) {
  const registry = new Map();
  const get = (sel) => {
    if (!registry.has(sel)) {
      const e = new El(sel.startsWith('.') ? 'div' : 'div');
      if (sel.startsWith('#')) e.id = sel.slice(1);
      if (sel.startsWith('.')) e.className = sel.slice(1);
      registry.set(sel, e);
    }
    return registry.get(sel);
  };
  for (const s of [...ids, ...classes]) get(s);
  const doc = {
    createElement: (t) => new El(t),
    createElementNS: (ns, t) => new El(t),
    getElementById: (id) => get('#' + id),
    querySelector: (s) => get(String(s).split(' ')[0]),
    querySelectorAll: () => [],
    addEventListener: noop, removeEventListener: noop,
    body: new El('body'), documentElement: new El('html'),
    fonts: { ready: Promise.resolve(), add: noop },
    visibilityState: 'visible', hidden: false,
    registry,
  };
  const rafQ = [];
  globalThis.document = doc;
  globalThis.window = {
    innerWidth: 1440, innerHeight: 900, devicePixelRatio: 1,
    addEventListener: noop, removeEventListener: noop, matchMedia: () => ({ matches: false, addEventListener: noop, addListener: noop }),
    requestAnimationFrame: (f) => { rafQ.push(f); return rafQ.length; }, cancelAnimationFrame: noop,
    document: doc, navigator: { userAgent: 'node' }, location: { href: 'http://x/', protocol: 'http:', host: 'x', hostname: 'x', pathname: '/', hash: '', search: '', origin: 'http://x', assign() {}, replace() {}, reload() {}, toString() { return 'http://x/'; } },
  };
  globalThis.self = globalThis.window;
  globalThis.location = globalThis.window.location;
  globalThis.history = { pushState() {}, replaceState() {}, back() {} };
  globalThis.innerWidth = globalThis.window.innerWidth;
  globalThis.innerHeight = globalThis.window.innerHeight;
  globalThis.devicePixelRatio = globalThis.window.devicePixelRatio;
  globalThis.rafQ = rafQ;
  try { Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node', maxTouchPoints: 0, vibrate: noop, clipboard: { writeText: () => Promise.resolve() }, language: 'en' }, configurable: true, writable: true }); } catch (e) { globalThis.navigator = { userAgent: 'node' }; }
  globalThis.requestAnimationFrame = (f) => { rafQ.push(f); return rafQ.length; };
  globalThis.cancelAnimationFrame = noop;
  globalThis.matchMedia = globalThis.window.matchMedia;
  globalThis.addEventListener = noop; globalThis.removeEventListener = noop;
  globalThis.HTMLElement = El; globalThis.HTMLCanvasElement = El; globalThis.HTMLDivElement = El;
  globalThis.Image = class { constructor() { this.width = 1; this.height = 1; } addEventListener() {} };
  globalThis.ImageData = class { constructor(w, h) { this.width = w; this.height = h; this.data = new Uint8ClampedArray(Math.max(4, w * h * 4)); } };
  globalThis.OffscreenCanvas = class { constructor(w, h) { this.width = w; this.height = h; } getContext() { return new Ctx2D(this); } };
  globalThis.WebGLRenderingContext = function () {};
  globalThis.localStorage = (() => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() }; })();
  return { doc, get, El, rafQ };
}

/** pump requestAnimationFrame callbacks N times (renderer loops live on rAF) */
export async function pumpFrames(n = 5, dt = 16) {
  for (let i = 0; i < n; i++) {
    const q = globalThis.rafQ.splice(0, globalThis.rafQ.length);
    if (globalThis.__renderLoop) q.push(globalThis.__renderLoop);
    for (const f of q) { try { f(performance.now() + i * dt); } catch (e) { console.log('  ✗ rAF frame threw: ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e)); globalThis.__frameErrors.push(String(e && e.message || e)); } }
    await new Promise((r) => setTimeout(r, 0));
  }
}
