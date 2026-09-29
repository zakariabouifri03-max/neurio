// محاكاة مبسّطة ديال المتصفح باش نجربو اللعبة فـNode — tests/stub.mjs
import path from 'path';
import { fileURLToPath } from 'url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src') + '/';

const elCache = new Map();

export function makeCtx() {
  const s = {};
  return new Proxy(s, {
    get(t, p) {
      if (p in t) return t[p];
      if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => ({ addColorStop() { } });
      if (p === 'getImageData') return (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) });
      if (p === 'createImageData') return (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
      if (p === 'measureText') return () => ({ width: 10 });
      if (p === 'canvas') return { width: 1300, height: 1300 };
      return () => { };
    },
    set(t, p, v) { t[p] = v; return true; },
  });
}

export function makeEl(tag = 'div') {
  const e = {
    tagName: tag, width: 512, height: 512, style: {}, dataset: {}, children: [], firstChild: null, parent: null,
    classList: { add() { }, remove() { }, toggle() { }, contains: () => false },
    addEventListener() { }, removeEventListener() { }, remove() { e._detach(); }, setPointerCapture() { },
    querySelector: () => makeEl(), querySelectorAll: () => [],
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
    getContext: () => makeCtx(), focus() { }, blur() { },
  };
  e.appendChild = (c) => { c.parent = e; e.children.push(c); e.firstChild = e.children[0]; return c; };
  e._detach = () => {
    if (!e.parent) return;
    const i = e.parent.children.indexOf(e);
    if (i >= 0) e.parent.children.splice(i, 1);
    e.parent.firstChild = e.parent.children[0] || null;
  };
  Object.defineProperty(e, 'innerHTML', { get: () => e._html || '', set: (v) => { e._html = v; } });
  Object.defineProperty(e, 'textContent', { get: () => e._txt || '', set: (v) => { e._txt = v; } });
  return e;
}

export function installStubs() {
  globalThis.document = {
    createElement: (t) => makeEl(t),
    getElementById: (id) => { if (!elCache.has(id)) elCache.set(id, makeEl()); return elCache.get(id); },
    querySelector: (s) => { if (!elCache.has(s)) elCache.set(s, makeEl()); return elCache.get(s); },
    querySelectorAll: () => [],
    addEventListener() { }, removeEventListener() { }, body: makeEl(), readyState: 'complete',
  };
  globalThis.window = {
    innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1,
    addEventListener() { }, removeEventListener() { }, AudioContext: undefined,
  };
  globalThis.requestAnimationFrame = () => 0;
  globalThis.localStorage = {
    _s: {},
    getItem(k) { return this._s[k] ?? null; },
    setItem(k, v) { this._s[k] = String(v); },
    removeItem(k) { delete this._s[k]; },
  };
  try { globalThis.navigator = { maxTouchPoints: 0, userAgent: 'node' }; } catch (e) {
    Object.defineProperty(globalThis, 'navigator', { value: { maxTouchPoints: 0, userAgent: 'node' }, configurable: true });
  }
}

export function suite(title) {
  let fails = 0, total = 0;
  console.log(title);
  return {
    ok(cond, msg) {
      total++;
      if (cond) console.log('  ✅ ' + msg);
      else { fails++; console.log('  ❌ ' + msg); }
    },
    section(name) { console.log('\n' + name); },
    done() {
      console.log(fails === 0 ? `\n🎉 ${total} اختبار كاملين خدامين!` : `\n⚠️ ${fails}/${total} اختبارات طايحين`);
      process.exit(fails ? 1 : 0);
    },
    get fails() { return fails; },
  };
}
