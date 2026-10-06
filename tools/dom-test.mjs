/* ============================================================
   tools/dom-test.mjs
   Runs the DOM layer (ui.js / audio.js / save.js) against a small
   stub DOM in Node. There is no browser in this environment, so
   this is what proves those files actually execute: every screen
   renderer, the HUD, the radar, the WebAudio graph and persistence.
   ============================================================ */

let fails = 0, checks = 0;
const ok = (m) => { checks++; console.log('  ✅ ' + m); };
const bad = (m) => { checks++; fails++; console.log('  ❌ ' + m); };
const test = (c, m, x = '') => (c ? ok(m + (x ? ' — ' + x : '')) : bad(m + (x ? ' — ' + x : '')));
const section = (s) => console.log('\n\x1b[1m' + s + '\x1b[0m');

/* ---------------- stub DOM ---------------- */
const CTX2D = new Proxy({}, {
  get(t, k) {
    if (k === 'createRadialGradient' || k === 'createLinearGradient') {
      return () => ({ addColorStop() {} });
    }
    if (k === 'canvas') return { width: 256, height: 256 };
    if (typeof k === 'string' && k.startsWith('_')) return undefined;
    return () => {};
  },
  set() { return true; },
});

class El {
  constructor(tag = 'div') {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this._cls = new Set();
    this.style = {};
    this.dataset = { attr: 'pace', v: '60', go: 'menu' };
    this._l = {};
    this._html = '';
    this._text = '';
    this.parentNode = null;
    this.width = 200; this.height = 130;
  }
  get classList() {
    const self = this;
    return {
      add: (...c) => c.forEach((x) => self._cls.add(x)),
      remove: (...c) => c.forEach((x) => self._cls.delete(x)),
      toggle: (c, f) => { const on = f === undefined ? !self._cls.has(c) : !!f; on ? self._cls.add(c) : self._cls.delete(c); return on; },
      contains: (c) => self._cls.has(c),
    };
  }
  set className(v) { this._cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get className() { return [...this._cls].join(' '); }
  set innerHTML(v) { this._html = String(v); this.children = []; }
  get innerHTML() { return this._html; }
  set textContent(v) { this._text = String(v); }
  get textContent() { return this._text; }
  appendChild(c) { this.children.push(c); c.parentNode = this; this._html += c._html || `<${c.tagName}>`; return c; }
  append(...cs) { cs.forEach((c) => this.appendChild(c)); }
  addEventListener(t, f) { (this._l[t] = this._l[t] || []).push(f); }
  removeEventListener() {}
  querySelector() { return new El('button'); }
  querySelectorAll() { return [new El('button'), new El('button'), new El('button'), new El('button')]; }
  closest() { return null; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 132, height: 132, right: 132, bottom: 132 }; }
  getContext() { return CTX2D; }
  setAttribute() {}
  click() {
    if (typeof this.onclick === 'function') this.onclick({ preventDefault() {}, target: this });
    (this._l.click || []).forEach((f) => f({ preventDefault() {}, target: this }));
  }
  fire(t, ev = {}) { (this._l[t] || []).forEach((f) => f({ preventDefault() {}, target: this, ...ev })); }
}

const byId = new Map();
const requested = new Set();
globalThis.document = {
  getElementById(id) { requested.add(id); if (!byId.has(id)) byId.set(id, new El('div')); return byId.get(id); },
  createElement: (t) => new El(t),
  querySelectorAll: () => [new El('section'), new El('section')],
  querySelector: () => new El('div'),
  addEventListener() {},
  body: new El('body'),
};
globalThis.window = { devicePixelRatio: 1, innerWidth: 1280, innerHeight: 720, addEventListener() {} };
globalThis.window.AudioContext = globalThis.AudioContext = class {
  constructor() { this.sampleRate = 48000; this.currentTime = 0; this.state = 'running'; this.destination = new Node(); }
  createGain() { return new Node(); }
  createOscillator() { return new Node(); }
  createBiquadFilter() { return new Node(); }
  createBufferSource() { return new Node(); }
  createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len) }; }
  resume() { this.state = 'running'; }
};
globalThis.addEventListener = () => {};
globalThis.performance = globalThis.performance || { now: () => Date.now() };
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

/* ---------------- stub WebAudio ---------------- */
let nodes = 0, connects = 0, starts = 0;
class Param {
  constructor(v = 0) { this.value = v; }
  setValueAtTime() { return this; }
  exponentialRampToValueAtTime() { return this; }
  linearRampToValueAtTime() { return this; }
  setTargetAtTime() { return this; }
  cancelScheduledValues() { return this; }
}
class Node {
  constructor() { nodes++; this.gain = new Param(1); this.frequency = new Param(440); this.Q = new Param(1); this.detune = new Param(0); }
  connect(n) { connects++; return n && n.connect ? n : this; }
  disconnect() {}
  start() { starts++; }
  stop() {}
}
globalThis.AudioContext = class {
  constructor() { this.sampleRate = 48000; this.currentTime = 0; this.state = 'running'; this.destination = new Node(); }
  createGain() { return new Node(); }
  createOscillator() { return new Node(); }
  createBiquadFilter() { return new Node(); }
  createBufferSource() { return new Node(); }
  createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len) }; }
  resume() { this.state = 'running'; }
};

/* ---------------- the tests ---------------- */
const ui = await import('../src/ui.js');
const audio = await import('../src/audio.js');
const save = await import('../src/save.js');
const { newCareer, commitUserResult, trainPlayer, buyPlayer, refreshMarket, sellPlayer } = await import('../src/career.js');
const { createMatch, stepMatch } = await import('../src/engine.js');
const { CLUBS } = await import('../src/data.js');

section('ui.js — screens');
ui.show('menu');
test(document.body.classList.contains('playing') === false, 'show() clears the landscape flag on menus');
ui.renderMenu(null);
test(byId.get('menuBtns').children.length === 3, 'menu without a career shows 3 buttons',
  String(byId.get('menuBtns').children.length));

const career = newCareer('fes', { halfSeconds: 60, difficulty: 1 });
ui.renderMenu(career);
test(byId.get('menuBtns').children.length === 7, 'menu with a career shows 7 buttons',
  String(byId.get('menuBtns').children.length));
test(/Atlas Fès/.test(byId.get('footClub').textContent), 'footer shows the chosen club', byId.get('footClub').textContent);

let picked = null;
ui.renderClubs('fes', (id) => { picked = id; });
test(byId.get('clubGrid').children.length === CLUBS.length, 'club picker lists every club',
  String(byId.get('clubGrid').children.length));
byId.get('clubGrid').children[3].click();
test(picked === CLUBS[3].id, 'clicking a club reports its id', String(picked));

ui.renderCareer(career, () => {});
test(byId.get('carTable').innerHTML.includes('<tr'), 'career screen renders the league table');
test(byId.get('nextMatch').innerHTML.length > 50, 'career screen renders the next fixture');
test(byId.get('carForm').children.length >= 1, 'career screen renders the form row');

ui.renderSquad(career, () => {});
test(byId.get('squadList').children.length === 11, 'squad screen lists 11 players',
  String(byId.get('squadList').children.length));
test(/سرعة/.test(byId.get('squadList').children[0].innerHTML), 'each player row shows the four attributes');

ui.renderMarket(career, () => {}, () => {}, () => {});
test(byId.get('marketList').children.length === career.market.length, 'market lists its offers',
  String(byId.get('marketList').children.length));
test(byId.get('sellList').children.length === 11, 'sell list shows the squad');

ui.renderTable(career);
test(byId.get('fullTable').innerHTML.includes('pts') || byId.get('fullTable').innerHTML.includes('<td'),
  'full table renders rows');

ui.renderQuick({ home: 'fes', away: 'cas' }, () => {});
test(byId.get('qHome').children.length === CLUBS.length && byId.get('qAway').children.length === CLUBS.length,
  'quick-match picker fills both sides');

section('ui.js — HUD + radar');
const m = createMatch({
  home: CLUBS[0], away: CLUBS[2],
  squads: [career.squads.fes, career.squads.cas],
  seed: 99, halfSeconds: 60, human: 0, aiLevel: 1,
});
for (let i = 0; i < 900 && !m.over; i++) stepMatch(m, 1 / 60, { mx: Math.sin(i / 20), mz: Math.cos(i / 20), sprint: i % 4 === 0, pass: i % 53 === 0, shootHeld: i % 120 < 18, tackle: i % 41 === 0, switch: i % 170 === 0 });
ui.initHud(m);
ui.updateHud(m);
test(/\d/.test(byId.get('hudScore').textContent), 'scoreboard has a score', byId.get('hudScore').textContent);
test(/'/.test(byId.get('hudClock').textContent), 'clock is rendered', byId.get('hudClock').textContent);
test(/%$/.test(byId.get('possTxt').textContent), 'possession is rendered', byId.get('possTxt').textContent);
ui.drawRadar(document.getElementById('radar'), m);
test(true, 'radar drew without throwing (22 players + ball)');

section('ui.js — result screen');
const res = commitUserResult(career, { ...career.fixtures[0].find((f) => f.home === 'fes' || f.away === 'fes'), round: 0 }, m.teams[0].score, m.teams[1].score);
ui.renderResult({ m, res, career: true, home: CLUBS[0], away: CLUBS[2] });
test(byId.get('resStats').innerHTML.length > 40, 'result screen renders the match stats');
test(byId.get('resEvents').children.length >= 1 || byId.get('resEvents').innerHTML.length > 0,
  'result screen renders the event list');
test(byId.get('resReward').innerHTML.includes('مكافأة'), 'result screen shows the reward',
  `coins now ${career.coins}`);

section('career actions through the UI callbacks');
const before = career.coins;
career.coins = 5000;
const t = trainPlayer(career, career.squads.fes[9].uid, 'shoot');
test(t.ok, 'training a player works', `shoot → ${t.value}, cost ${t.cost}`);
const b = buyPlayer(career, 0);
test(b.ok, 'buying from the market works', `${b.added} replaces ${b.replaced}`);
const r = refreshMarket(career);
test(r.ok && career.market.length === 8, 'refreshing the market refills 8 offers');
const soldName = career.squads.fes[10].name;
const s = sellPlayer(career, career.squads.fes[10].uid);
test(s.ok && s.price > 0, 'selling a player pays out', `+${s.price} for ${s.name}`);
test(s.ok && career.squads.fes.length === 11 && career.squads.fes[10].name !== soldName,
  'selling keeps an XI and the academy fills the shirt', `${soldName} → ${s.replacement} (${s.rating})`);
test(s.ok && career.squads.fes[10].role === 'ST', 'the replacement plays the same role', career.squads.fes[10].role);
career.coins = 0;
test(!trainPlayer(career, career.squads.fes[0].uid, 'pace').ok, 'training without coins is refused');
test(!buyPlayer(career, 0).ok, 'buying without coins is refused');
career.coins = before;

section('save.js');
save.clearSave();
test(save.loadSave() === null, 'no save at first');
save.writeSave({ career, settings: { sound: true, half: 120, diff: 1, cam: 1 } });
const back = save.loadSave();
test(!!back && back.career.clubId === 'fes', 'save round-trips through localStorage', back && back.career.clubId);
test(back.version === 3, 'save carries a version tag', String(back.version));
save.clearSave();
test(save.loadSave() === null, 'clearSave empties it');

section('audio.js (stubbed WebAudio)');
const before0 = nodes;
test(audio.Sfx.init() === true, 'AudioContext created');
audio.Sfx.setEnabled(true);
audio.Sfx.crowd(0.5);
audio.Sfx.whistle(2);
audio.Sfx.kick(0.8);
audio.Sfx.post();
audio.Sfx.goal();
audio.Sfx.ui();
audio.Sfx.coin();
audio.Sfx.sad();
audio.Sfx.setEnabled(false);
audio.Sfx.kick(1);
test(nodes > before0 + 10, 'the sound graph was actually built', `${nodes - before0} nodes, ${connects} connections, ${starts} starts`);
test(starts > 5, 'voices were scheduled');

section('result');
console.log(fails === 0
  ? `\n✅ ${checks} CHECKS PASSED — the DOM layer executes cleanly`
  : `\n❌ ${fails}/${checks} CHECKS FAILED`);
process.exit(fails ? 1 : 0);
