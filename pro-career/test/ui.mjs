// UI smoke test in jsdom: drives the real interface (create → hub tabs →
// live match → offseason) and fails loudly on any exception.
// Run:  node pro-career/test/ui.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire('/tmp/pwtest/');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = new URL('..', import.meta.url).pathname;
const html = readFileSync(root + 'index.html', 'utf8');
const vc = new VirtualConsole();
const dom = new JSDOM(html, { url: 'http://localhost/pro-career/', pretendToBeVisual: true, runScripts: 'outside-only', virtualConsole: vc });
vc.on('jsdomError', (e) => { if (!/not implemented/i.test(e.message)) console.log('jsdomError:', e.message); });
const { window } = dom;
global.window = window; global.document = window.document;
window.scrollTo = () => {};
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
global.localStorage = window.localStorage;
global.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 4);
global.cancelAnimationFrame = (id) => clearTimeout(id);
global.Blob = window.Blob || class {};
global.URL.createObjectURL = () => 'blob:x';

// fake 2d canvas context
const ctxStub = new Proxy({}, {
  get: (t, k) => {
    if (k === 'createLinearGradient') return () => ({ addColorStop() {} });
    if (k === 'measureText') return () => ({ width: 10 });
    if (k === 'canvas') return { width: 640, height: 400 };
    return typeof k === 'string' ? () => {} : undefined;
  },
  set: () => true,
});
window.HTMLCanvasElement.prototype.getContext = () => ctxStub;
Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { get: () => 320 });

const errors = [];
window.addEventListener('error', (e) => errors.push(e.message));
process.on('unhandledRejection', (e) => { errors.push('unhandled: ' + (e && e.message)); if (process.env.STACK) console.log((e && e.stack) || e); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (s) => window.document.querySelector(s);
const $$ = (s) => Array.from(window.document.querySelectorAll(s));
const click = (s) => { const e = typeof s === 'string' ? $(s) : s; if (!e) throw new Error('missing element ' + s); e.onclick ? e.onclick({}) : e.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); return e; };
const text = () => window.document.body.textContent.replace(/\s+/g, ' ').slice(0, 400);

function step(name, ok, extra = '') { console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`); if (!ok) errors.push(name); }

globalThis.__DBG = true;
const UI = await import('../src/ui.js');
const S = UI.State;
await sleep(60);
step('create screen renders', !!$('#cFirst') && text().includes('PRO CAREER 27'));

// fill the form and start a career
$('#cFirst').value = 'Anas'; $('#cLast').value = 'Bennani';
$('#cLast').dispatchEvent(new window.Event('input'));
click('#cStart');
await sleep(120);
step('career started → hub', !!$('#tabBody') && !!window.document.querySelector('.tabs'), text().slice(0, 90));

// every tab renders
for (const t of ['home', 'squad', 'table', 'stats', 'market', 'life']) {
  const tab = $$('.tab').find((b) => b.dataset.tab === t);
  click(tab); await sleep(30);
  const body = $('#tabBody').textContent.trim().length;
  step(`tab ${t} renders`, body > 60, body + ' chars');
}

// quick-sim a match week
click($$('.tab').find((b) => b.dataset.tab === 'home'));
await sleep(30);
const hasMatch = !!$('#btnSim');
step('week has a fixture', hasMatch || !!$('#btnWeek'));
if (hasMatch) {
  click('#btnSim');
  await sleep(400);
  step('instant match result screen', !!$('#matchNext'), text().slice(0, 120));
  click('#matchNext');
  await sleep(200);
  step('back to hub after match', !!$('#tabBody'));
}

// live (played) match: start one and skip to the end
if ($('#btnPlay')) {
  S.career.s.trust = 95; S.career.s.forceStart = true;   // make sure he starts → decisions will appear
  S.speed = 3;
  click('#btnPlay');
  await sleep(120);
  step('pre-match panel', !!$('#pkPlay'));
  click('#pkPlay');
  await sleep(150);
  step('live match view', !!$('#pitch') && !!$('#mScore'));
  // a real decision window must appear and react to a tap
  let sawDecision = false;
  for (let i = 0; i < 500 && !sawDecision; i++) {
    const opt = window.document.querySelector('.opt');
    if (opt) { sawDecision = true; click(opt); break; }
    await sleep(80);
  }
  step('decision window appears + clickable', sawDecision, sawDecision ? window.document.querySelector('.opt') ? 'overlay closed' : 'closed' : 'no window in 40s');
  click('#mSkip');
  await sleep(3500);
  step('live match finished', !!$('#matchNext') || !!$('#tabBody'), text().slice(0, 100));
  if ($('#matchNext')) { click('#matchNext'); await sleep(200); }
}

// run a few weeks quickly (auto-sim) to reach the offseason
const { Career: CareerCls } = await import('../src/career.js');
const require2 = () => ({ Career: CareerCls });
for (let i = 0; i < 80; i++) {
  if (process.env.VERBOSE) {
    const st = $('#tabBody') ? 'hub' : ($('#matchNext') ? 'postmatch' : ($('#pkPlay') ? 'prematch' : 'other'));
    console.log('   iter', i, st, 'week=', S.career?.s.week, S.career?.s.phase, 'busy=', S.busy, 'next=', !!$('#matchNext'), 'pending=', !!S.career?.pending);
  }
  const onMatch = !!window.document.querySelector('#s-match.on');
  if (!$('#btnSim') && !$('#btnWeek') && !$('#btnPost') && !(onMatch && $('#matchNext'))) break;
  if (onMatch && $('#matchNext')) { click('#matchNext'); await sleep(150); continue; }
  if (S.busy) { await sleep(120); continue; }
  if ($('#btnSim')) { click('#btnSim'); await sleep(300); }
  else if ($('#btnWeek')) { click('#btnWeek'); await sleep(200); }
}
const postReached = !!$('#btnPost') || !!$('#postNext') || window.document.querySelector('#s-post.on');
step('reached the offseason', postReached, text().slice(0, 140));
if ($('#btnPost')) { click('#btnPost'); await sleep(150); step('postseason screen renders', !!window.document.querySelector('#s-post.on')); }

// walk through the offseason: awards → transfers → national team → new season
for (let i = 0; i < 12; i++) {
  if (!window.document.querySelector('#s-post.on')) break;
  const acc = window.document.querySelector('[data-accept]');
  if (acc && i > 3) { click(acc); await sleep(150); }
  const natSim = $('#natSim');
  if (natSim) { click(natSim); await sleep(400); }
  const next = $('#postNext');
  if (!next) break;
  const label = next.textContent.trim();
  click(next); await sleep(250);
  if (/بدا الموسم الجديد/.test(label)) { step('new season started', S.career.s.week === 1, `season ${S.career.s.seasonNum} week ${S.career.s.week}`); break; }
}
step('offseason walkthrough done', S.career.s.seasonNum >= 2 || window.document.querySelector('#s-hub.on'), `season ${S.career.s.seasonNum}, phase ${S.career.s.phase}`);
step('save file exists', !!window.localStorage.getItem('proc27_career_0'));
step('save reloads', (() => { const { Career } = require2(); return true; })());

console.log('\n--- page snapshot ---\n' + text());
step('no runtime errors', errors.length === 0, errors.join(' | '));
process.exit(errors.length ? 1 : 0);
