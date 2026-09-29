// Headless 3D smoke test: builds the whole room, every cosmetic permutation,
// the FX pool and the wall-screen painter inside node, with a tiny DOM shim.
// Catches geometry/material/API mistakes that a syntax check cannot see.
import { register } from 'node:module';
register(new URL('./three-resolver.mjs', import.meta.url).href, import.meta.url);
const noop = () => {};
class Grad { addColorStop() {} }
class Ctx2D {
  constructor(c) { this.canvas = c; this.font = ''; this.fillStyle = '#000'; this.strokeStyle = '#000'; this.lineWidth = 1; this.globalAlpha = 1; this.textAlign = 'left'; this.textBaseline = 'alphabetic'; this.shadowColor = ''; this.shadowBlur = 0; this.globalCompositeOperation = 'source-over'; }
  clearRect() {} fillRect() {} strokeRect() {} beginPath() {} closePath() {} fill() {} stroke() {}
  moveTo() {} lineTo() {} arc() {} ellipse() {} rect() {} roundRect() {} arcTo() {} bezierCurveTo() {} quadraticCurveTo() {}
  save() {} restore() {} translate() {} rotate() {} scale() {} setTransform() {} clip() {} drawImage() {}
  createLinearGradient() { return new Grad(); } createRadialGradient() { return new Grad(); } createPattern() { return null; }
  measureText(s) { return { width: String(s).length * 8 }; }
  fillText() {} strokeText() {}
  getImageData(x, y, w, h) { return { data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h }; }
  putImageData() {}
}
class Cls { add() {} remove() {} toggle() {} contains() { return false; } }
class El {
  constructor(tag) {
    this.tagName = (tag || 'div').toUpperCase();
    this.style = { setProperty: noop }; this.classList = new Cls(); this.children = [];
    this.dataset = {}; this.hidden = false; this.value = '';
    this.firstChild = null; this.lastChild = null; this.offsetWidth = 100;
    this._ctx = null;
  }
  get classListX() { return this.classList; }
  set className(v) { this._cn = v; } get className() { return this._cn || ''; }
  set innerHTML(v) { this._html = v; } get innerHTML() { return this._html || ''; }
  set textContent(v) { this._t = v; } get textContent() { return this._t || ''; }
  getContext() { return this._ctx || (this._ctx = new Ctx2D(this)); }
  appendChild(c) { this.children.push(c); return c; }
  append(...c) { this.children.push(...c); } prepend(...c) { this.children.unshift(...c); }
  insertAdjacentHTML() {} removeChild() {} remove() {} select() {} focus() { blur(); } blur() {}
  addEventListener() {} removeEventListener() {} setPointerCapture() {} releasePointerCapture() {}
  querySelector() { return new El('div'); } querySelectorAll() { return []; } closest() { return null; }
  getBoundingClientRect() { return { x: 0, y: 0, width: 800, height: 600, left: 0, top: 0, right: 800, bottom: 600 }; }
  toDataURL() { return 'data:image/png;base64,'; }
  width = 300; height = 150;
}
const body = new El('body');
globalThis.document = {
  createElement: (t) => new El(t),
  createElementNS: (ns, t) => new El(t),
  getElementById: () => new El('div'),
  querySelector: () => new El('div'),
  querySelectorAll: () => [],
  addEventListener: noop, removeEventListener: noop,
  body, documentElement: new El('html'),
  createTexture: noop,
  fonts: { ready: Promise.resolve() },
};
globalThis.window = {
  innerWidth: 1440, innerHeight: 900, devicePixelRatio: 1,
  addEventListener: noop, removeEventListener: noop, matchMedia: () => ({ matches: false, addEventListener: noop }),
  AudioContext: undefined, requestAnimationFrame: (f) => setTimeout(() => f(1), 16),
  navigator: { userAgent: 'node' }, document: globalThis.document,
};
globalThis.self = globalThis.window;
const nav = { userAgent: 'node', maxTouchPoints: 0, vibrate: noop, clipboard: { writeText: () => Promise.resolve() } };
try { Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true, writable: true }); } catch (e) { globalThis.navigator = nav; }
globalThis.requestAnimationFrame = (f) => setTimeout(() => f(performance.now()), 16);
globalThis.cancelAnimationFrame = clearTimeout;
globalThis.matchMedia = globalThis.window.matchMedia;
globalThis.addEventListener = noop;
globalThis.HTMLElement = El;
globalThis.HTMLCanvasElement = El;
globalThis.Image = class { constructor() { this.width = 1; this.height = 1; } addEventListener() {} };
globalThis.ImageData = class { constructor(w, h) { this.width = w; this.height = h; this.data = new Uint8ClampedArray(w * h * 4); } };

// ── run the checks ─────────────────────────────────────────────────────────────
let errs = 0;
const step = (label, fn) => { try { fn(); console.log('  ✓ ' + label); } catch (e) { errs++; console.log('  ✗ ' + label + ' → ' + (e?.stack || e).split('\n').slice(0, 3).join(' | ')); } };

const THREE = await import('three');
const { Room3D, CameraRig, PRESETS, seatTransform, SEATS } = await import('../swindle/js/room3d.js');
const { Character, Nameplate, EXPRESSIONS } = await import('../swindle/js/chars.js');
const { FX } = await import('../swindle/js/fx.js');
const tex = await import('../swindle/js/tex.js');
const { COSM } = await import('../shared/content.js');

console.log('\nROOM');
let room;
step('build room (high)', () => { room = new Room3D('high'); });
let meshes = 0, tris = 0;
room.scene.traverse((o) => { if (o.isMesh) { meshes++; tris += (o.geometry?.index?.count || o.geometry?.attributes?.position?.count || 0) / 3; } });
console.log(`    meshes=${meshes} tris=${(tris / 1000).toFixed(1)}k children=${room.scene.children.length}`);
for (const q of ['low', 'medium', 'high', 'ultra']) {
  step('setQuality ' + q, () => room.setQuality(q));
}
step('update 240 frames with all board states', () => {
  const boards = ['cases', 'cards', 'tiles', 'vault', 'parcel', 'hammer', 'button', 'fall', 'none'];
  for (let i = 0; i < 240; i++) room.update(1 / 60, { board: boards[i % boards.length], pot: 300 + i, dial: i * 0.1, press: (i % 20) / 20, highlightCase: 'C', boardSpin: 0.2 });
});
step('screen painter for every phase', () => {
  const phases = ['lobby', 'brief', 'talk', 'submit', 'reveal', 'results', 'final'];
  for (const p of phases) room.drawScreen((g, W, H, t) => { g.fillStyle = '#111'; g.fillRect(0, 0, W, H); g.font = '800 40px x'; g.textAlign = 'center'; g.fillText(p, W / 2, H / 2); });
});
step('collision keeps bodies inside', () => {
  for (const [x, z] of [[0, 0], [99, 99], [-99, 0], [7, 3], [-11, 5]]) {
    const c = room.collide(x, z);
    if (!Number.isFinite(c.x) || !Number.isFinite(c.z)) throw new Error('NaN collide');
    if (Math.abs(c.x) > 10.5 || Math.abs(c.z) > 9) throw new Error('escaped the room at ' + x + ',' + z);
    if (Math.hypot(c.x, c.z) < 2.6) throw new Error('walked into the table');
  }
});
step('seats are reachable', () => {
  for (let i = 0; i < SEATS; i++) {
    const s = seatTransform(i);
    const c = room.collide(s.pos.x * 1.05, s.pos.z * 1.05);
    if (Math.hypot(c.x - s.pos.x, c.z - s.pos.z) > 1.2) throw new Error('seat ' + i + ' unreachable');
  }
});
step('camera rig framing + focus + shake decay', () => {
  const cam = new THREE.PerspectiveCamera(34, 1.6, .4, 90);
  const rig = new CameraRig(cam, room);
  const pts = [...Array(8)].map((_, i) => seatTransform(i).pos);
  for (let i = 0; i < 120; i++) { rig.frame(pts, { tight: i > 60 }); rig.kick(0.4); rig.update(1 / 60, 'high'); }
  if (!Number.isFinite(cam.position.x + cam.position.y + cam.position.z)) throw new Error('NaN camera');
  rig.focus(new THREE.Vector3(2, 0, 2), 1.3); for (let i = 0; i < 60; i++) rig.update(1 / 60, 'low');
  if (Math.abs(cam.position.x) > 90) throw new Error('camera flung away');
});

console.log('\nCHARACTERS');
let charCount = 0, charTris = 0;
step('every cosmetic permutation builds', () => {
  for (const skin of COSM.skin) for (const face of COSM.face) for (const hair of COSM.hair) {
    const c = new Character({ skin: skin.id, face: face.id, hair: hair.id, hat: -1, glasses: -1, shirt: 0, pants: 0, shoes: 0, acc: -1, color: 0, hairColor: 0 });
    charCount++; charTris += countTris(c.root);
    if (!Number.isFinite(c.root.position.x)) throw new Error('NaN root');
  }
  for (const hat of COSM.hat) for (const glasses of COSM.glasses) for (const acc of COSM.acc) for (const shirt of COSM.shirt) {
    const c = new Character({ skin: 2, face: 3, hair: 4, hat: hat.id, glasses: glasses.id, shirt: shirt.id, pants: 3, shoes: 4, acc: acc.id, color: 5, hairColor: 9 });
    charCount++;
  }
});
step('expressions + emotes + 300 frames', () => {
  const c = new Character({ skin: 1, face: 2, hair: 3, hat: 1, glasses: 2, shirt: 5, pants: 1, shoes: 2, acc: 4, color: 2, hairColor: 3 });
  room.scene.add(c.root);
  for (let i = 0; i < 300; i++) {
    if (i % 30 === 0) c.setExpr(EXPRESSIONS[(i / 30) % EXPRESSIONS.length]);
    if (i % 47 === 0) c.playEmote(['sweat', 'guns', 'shake', 'count', 'gasp', 'clap', 'point', 'shrug', 'bow', 'wiggle', 'hand', 'cry'][i % 12], 900);
    c.speed = (i % 3) * 0.6; c.sitOn = i > 200;
    c.update(1 / 60, i / 60);
    if (!Number.isFinite(c.head.rotation.x + c.root.position.y)) throw new Error('NaN in char at ' + i);
  }
  void charTris;
});
step('nameplate canvas draw', () => {
  const c = new Character({});
  const p = new Nameplate(c);
  p.set({ name: 'Slick Pickle', mine: true, right: '1,200', tag: '🎭 TRICKSTER', bubble: 'signed, sealed, no regrets', host: true });
  for (let i = 0; i < 5; i++) p.draw();
});

console.log('\nFX');
step('particle pools + rings/beams/floaters/confetti', () => {
  const fx = new FX(room.scene, 'ultra');
  const v = new THREE.Vector3(0, 1.2, 0);
  for (let i = 0; i < 60; i++) {
    fx.spark(v, { count: 30 }); fx.chips(v, { count: 22 }); fx.smoke(v, { count: 14 });
    if (i % 7 === 0) { fx.ring(v); fx.beam(v); fx.float(v, '+1,200', { color: '#fff' }); }
    fx.update(1 / 60, new THREE.Vector3(0, 3, 9));
  }
  fx.confetti(900);
  for (let i = 0; i < 90; i++) fx.update(1 / 60, null);
  fx.clear();
});

console.log('\nTEXTURES');
step('all procedural canvases build', () => {
  for (const f of ['carpetTex', 'wallTex', 'woodTex', 'plasterTex', 'neonSignTex', 'clockTex', 'terrazzoTex']) tex[f]();
  for (const k of ['refunds', 'markets', 'witness', 'notice']) tex.posterTex(k);
  for (let i = 0; i < 6; i++) tex.lockerTex(i);
  const sc = new tex.ScreenCanvas(640, 360);
  sc.ctx.fillStyle = '#000'; sc.ctx.fillRect(0, 0, 640, 360); sc.push();
});

function countTris(root) { let t = 0; root.traverse((o) => { if (o.isMesh) t += (o.geometry?.attributes?.position?.count || 0) / 3; }); return t; }

console.log('\n' + (errs ? errs + ' PROBLEM(S)' : '3D SMOKE OK') + ` · characters built: ${charCount} · room meshes: ${meshes}`);
process.exit(errs ? 1 : 0);
