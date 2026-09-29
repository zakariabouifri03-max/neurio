/* ============================================================================
 * tools/smoke-scam.mjs — headless smoke test for the Scam Baqi game.
 *
 * Boots scam/index.html in jsdom (all 12 scripts), stubs WebGL + WebAudio +
 * speechSynthesis, then plays: menu → shift → incoming call → dialogue →
 * remote access → hazard event → money → end of day review.
 *
 * Usage:  node tools/smoke-scam.mjs            (needs jsdom in /tmp/smoke)
 * ==========================================================================*/
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { JSDOM, VirtualConsole } = require('/tmp/smoke/node_modules/jsdom');

const root = new URL('..', import.meta.url).pathname;
const html = readFileSync(root + 'scam/index.html', 'utf8');

const problems = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => problems.push('jsdomError: ' + (e && e.message)));
vc.on('error', (...a) => problems.push('console.error: ' + a.map(String).join(' ')));

// scripts are loaded by hand (jsdom does not fetch file:// scripts)
const htmlNoScripts = html
  .replace(/<script src="[^"]+"><\/script>/g, '')
  .replace(/<script>[\s\S]*?<\/script>/g, '');

const dom = new JSDOM(htmlNoScripts, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'http://localhost/',
  virtualConsole: vc,
  beforeParse(win) {
    // ---- canvas 2d stub (jsdom has no canvas package)
    const ctx = new Proxy({}, {
      get(t, k) {
        if (k === 'canvas') return { width: 1024, height: 512 };
        if (k === 'createLinearGradient' || k === 'createRadialGradient')
          return () => ({ addColorStop() {} });
        if (k === 'measureText') return () => ({ width: 10 });
        if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
        return typeof t[k] === 'undefined' ? () => {} : t[k];
      },
      set() { return true; }
    });
    win.HTMLCanvasElement.prototype.getContext = function () { return ctx; };
    // ---- audio
    win.AudioContext = function () {
      return {
        state: 'running', currentTime: 0, sampleRate: 44100, destination: {},
        resume() {}, createGain: () => ({ gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {} }, connect() {} }),
        createOscillator: () => ({ type: '', frequency: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, start() {}, stop() {} }),
        createBuffer: (c, l) => ({ getChannelData: () => new Float32Array(l) }),
        createBufferSource: () => ({ buffer: null, loop: false, connect() {}, start() {}, stop() {} }),
        createBiquadFilter: () => ({ type: '', frequency: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, Q: { value: 0 }, connect() {} })
      };
    };
    win.speechSynthesis = { getVoices: () => [], speak() {}, cancel() {}, onvoiceschanged: null };
    win.SpeechSynthesisUtterance = function (t) { this.text = t; };
    // ---- WebGL: pretend the renderer works, do nothing
    win.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now ? performance.now() : Date.now()), 16);
    win.cancelAnimationFrame = (id) => clearTimeout(id);
  }
});

const win = dom.window;
await new Promise((r) => win.addEventListener('load', r, { once: true }));

// ---- load three.js as a classic global, then stub the GL renderer
const bootProblems = [];
function runFile(p) {
  try { win.eval(readFileSync(root + p, 'utf8')); }
  catch (e) { bootProblems.push(p + ': ' + e.message); throw e; }
}
runFile('scam/vendor/three.global.js');
const T = win.THREE;
T.WebGLRenderer = function () {
  return {
    domElement: win.document.getElementById('scene'),
    shadowMap: { enabled: false, type: 0 },
    setPixelRatio() {}, setSize() {}, render() {}, getPixelRatio() { return 1; },
    outputColorSpace: null, toneMapping: 0, toneMappingExposure: 1
  };
};
// ---- load the game modules in the same order as index.html
['src/util.js', 'src/audio.js', 'src/data.js', 'src/callers.js', 'src/ui.js',
 'src/desktop.js', 'src/calls.js', 'src/world.js', 'src/player.js', 'src/day.js', 'src/main.js']
  .forEach((f) => runFile('scam/' + f));

const SWYF = win.SWYF;
const ok = [], fail = [];
function check(name, fn) {
  try { fn(); ok.push(name); } catch (e) { fail.push(name + ' → ' + e.message); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

check('boot: game object exists', () => {
  if (!SWYF || !SWYF.main) throw new Error('SWYF.main missing');
});
check('world built (3D office)', () => {
  const w = SWYF.main.world;
  if (!w) throw new Error('no world');
  if (w.colliders.length < 10) throw new Error('colliders: ' + w.colliders.length);
  if (!w.interactables.find((i) => i.id === 'desk')) throw new Error('no desk interactable');
  if (!w.npcs.length) throw new Error('no coworkers');
});
check('restart boot with renderer stub', () => {
  // boot already ran before the stub; re-run the pieces we can
  if (!SWYF.Desktop.apps.length) throw new Error('no apps');
});

// --- start a run
check('start shift', () => {
  SWYF.Day.startDay(1);
  if (SWYF.Day.S.phase !== 'brief') throw new Error('phase=' + SWYF.Day.S.phase);
  win.document.getElementById('btn-brief-go').click();
  if (SWYF.Day.S.phase !== 'shift') throw new Error('phase after brief=' + SWYF.Day.S.phase);
});

check('quota + targets planned', () => {
  const st = SWYF.Day.state();
  if (st.quota !== 1500) throw new Error('quota=' + st.quota);
  if (SWYF.Desktop.getTargets().length !== 4) throw new Error('targets=' + SWYF.Desktop.getTargets().length);
});

// --- incoming call: answer and talk
let caller = null;
check('ring + answer a call', () => {
  SWYF.Day.startRing();
  caller = SWYF.Day.S.ring.caller;
  if (!caller) throw new Error('no ringing caller');
  win.document.getElementById('ring-answer').click();
  if (SWYF.Day.S.ring) throw new Error('ring not cleared');
});

await sleep(900);
check('call UI is mounted', () => {
  if (!SWYF.Calls.active()) throw new Error('no active call');
  if (!win.document.querySelector('.call-log')) throw new Error('no transcript');
});

// --- dialogue: tactics + free text
check('tactic clicks work', () => {
  const chips = win.document.querySelectorAll('.chip:not(.lev)');
  if (!chips.length) throw new Error('no tactic chips');
  chips[0].click();
});

check('free-text Arabic is understood', () => {
  const hits = SWYF.callers.lexHits('السلام عليكم، معاك من البنك، خاصك تتحقق من الحساب ديالك عافاك');
  if (!hits.polite || !hits.bank) throw new Error('lexicon missed: ' + JSON.stringify(hits));
  const hits2 = SWYF.callers.lexHits('مبروك فزت ف السحب، عندك جائزة كبيرة، بقا غير الرسوم');
  if (!hits2.prize || !hits2.greed) throw new Error('prize lexicon missed');
});

await sleep(700);
check('free text through act()', () => {
  const res = SWYF.callers.act(SWYF.Calls.active(), { type: 'text', text: 'عافاك سيدي، راك غادي تربح 100000 درهم، غير صيفط الرمز السري' }, {});
  if (!res.callerLine) throw new Error('no reply composed');
  if (res.suspicion < 0) throw new Error('bad suspicion');
});

// --- remote access leverage
check('remote access gives leverage', () => {
  const cat = SWYF.Calls.active();
  const fact = cat.facts.find((f) => !f.trap);
  SWYF.Calls.giveLeverage(fact);
  cat.leverageUsed.push(fact.id);
  const res = SWYF.callers.act(cat, { type: 'leverage', fact: fact }, {});
  if (!res.callerLine) throw new Error('leverage reply missing');
});

// --- desktop apps render
check('desktop apps open without throwing', () => {
  ['anyviewer', 'disscord', 'scamazon', 'notes', 'paint', 'recorder', 'camera', 'files', 'settings'].forEach((id) => {
    SWYF.Desktop.open(id);
  });
  if (!win.document.querySelectorAll('.win').length) throw new Error('no windows');
});

check('shop: buy upgrade spends cash', () => {
  SWYF.Day.S.cash = 5000;
  const before = SWYF.Day.S.cash;
  const okBuy = SWYF.Day.buy('headset');
  if (!okBuy) throw new Error('buy refused');
  if (SWYF.Day.S.cash >= before) throw new Error('cash not spent');
  if (SWYF.Day.buy('headset')) throw new Error('double purchase allowed');
});

// --- hazards
check('virus event fires + cleans', () => {
  SWYF.Day.runEvent('virus');
  if (!SWYF.Day.S.virusT) throw new Error('virus not set');
  win.document.getElementById('virus').querySelector('.virus-fix').click();
  if (SWYF.Day.S.virusT) throw new Error('virus not cleaned');
});

check('every hazard event runs', () => {
  ['boss_rage', 'coworker', 'power', 'raid', 'inspector', 'strike', 'virus'].forEach((id) => {
    SWYF.Day.runEvent(id);
  });
  // clear any modal left open
  const a = win.document.getElementById('alert');
  a.classList.add('hidden');
});

check('power outage + shelter work', () => {
  SWYF.Day.runEvent('power');
  SWYF.Day.tryInteractPower();
  SWYF.Day.inShelter();
});

// --- money + finish the call
check('money is credited', () => {
  const before = SWYF.Day.S.earnedToday;
  SWYF.Day.takeMoney(900, SWYF.Calls.active());
  if (SWYF.Day.S.earnedToday !== before + 900) throw new Error('money not added');
});

check('call ends cleanly', () => {
  const c = SWYF.Calls.active();
  c.money = 900;
  SWYF.Calls.endNow();
  if (SWYF.Calls.active()) throw new Error('caller still active');
  if (SWYF.Day.S.handled < 1) throw new Error('handled not counted');
});

// --- shift ticks + end of day
check('shift loop ticks (time + clock)', () => {
  const t0 = SWYF.Day.time();
  for (let i = 0; i < 60; i++) SWYF.Day.update(0.1);
  if (SWYF.Day.time() <= t0) throw new Error('clock not advancing');
  if (SWYF.Day.state().upgrades.headset !== 1) throw new Error('upgrade lost');
});

check('end of day review (pass)', () => {
  SWYF.Day.S.earnedToday = 4000;
  SWYF.Day.S.shiftT = SWYF.Day.S.shiftLen + 1;
  SWYF.Day.update(0.1);
  if (SWYF.Day.S.phase !== 'review') throw new Error('phase=' + SWYF.Day.S.phase);
  if (!win.document.querySelector('#review .rev-line')) throw new Error('review text missing');
  win.document.getElementById('btn-review-go').click();
  if (SWYF.Day.S.phase !== 'shop') throw new Error('phase after review=' + SWYF.Day.S.phase);
  win.document.getElementById('btn-shop-go').click();
  if (SWYF.Day.S.day !== 2) throw new Error('day not advanced');
});

check('firing path works (miss quota)', () => {
  SWYF.Day.S.earnedToday = 10;
  SWYF.Day.S.shiftT = SWYF.Day.S.shiftLen + 1;
  SWYF.Day.S.phase = 'shift';
  SWYF.Day.update(0.1);
  win.document.getElementById('btn-review-go').click();
  if (SWYF.Day.S.phase !== 'gameover') throw new Error('phase=' + SWYF.Day.S.phase);
});

check('save + load round-trip', () => {
  SWYF.Day.save();
  const hadDay = SWYF.Day.S.day;
  SWYF.Day.load();
  if (SWYF.Day.S.day !== hadDay) throw new Error('day mismatch');
});

check('desktop lessons collected', () => {
  if (!SWYF.Desktop.lessons().length) throw new Error('no lessons recorded');
});

check('player controller + collision', () => {
  const p = SWYF.main.player;
  p.setMode('walk');
  p.update(0.016);
  if (!isFinite(p.pos.x)) throw new Error('player position NaN');
  const near = p.findNearest();
  if (near && !near.label) throw new Error('interactable without label');
});

check('world updates + hazards visuals', () => {
  SWYF.main.world.update(0.016, SWYF.main.player.pos);
  SWYF.main.world.setPower(false);
  SWYF.main.world.setPower(true);
  SWYF.main.world.setFire(true);
  SWYF.main.world.setFire(false);
  SWYF.main.world.setShift(0.5);
  SWYF.main.world.setQuota('2000 درهم');
  SWYF.main.world.setFired(false);
  SWYF.main.world.virusCube();
});

// ─────────────────────────────────────────────────────────────────────────────
// phase 2: the SINGLE-FILE build (scam-baqi-offline.html) must boot as well
// ─────────────────────────────────────────────────────────────────────────────
let single = 'skipped';
try {
  let singleHtml = readFileSync(root + 'scam-baqi-offline.html', 'utf8');
  // stub the GL renderer right after the inlined three.js
  singleHtml = singleHtml.replace('</script>',
    '</script><script>window.THREE.WebGLRenderer=function(){return{domElement:document.getElementById("scene"),' +
    'shadowMap:{enabled:false,type:0},setPixelRatio:function(){},setSize:function(){},render:function(){},' +
    'getPixelRatio:function(){return 1},outputColorSpace:null,toneMapping:0,toneMappingExposure:1};};</script>');
  const probs2 = [];
  const vc2 = new VirtualConsole();
  vc2.on('jsdomError', (e) => probs2.push('jsdomError: ' + (e && e.message)));
  vc2.on('error', (...a) => probs2.push('console.error: ' + a.map(String).join(' ')));
  const dom2 = new JSDOM(singleHtml, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole: vc2,
    beforeParse(win) {
      const ctx = new Proxy({}, {
        get(t, k) {
          if (k === 'canvas') return { width: 1024, height: 512 };
          if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
          if (k === 'measureText') return () => ({ width: 10 });
          return () => {};
        }, set() { return true; }
      });
      win.HTMLCanvasElement.prototype.getContext = function () { return ctx; };
      win.AudioContext = function () {
        return {
          state: 'running', currentTime: 0, sampleRate: 44100, destination: {},
          resume() {},
          createGain: () => ({ gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {} }, connect() {} }),
          createOscillator: () => ({ type: '', frequency: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, start() {}, stop() {} }),
          createBuffer: (c, l) => ({ getChannelData: () => new Float32Array(l) }),
          createBufferSource: () => ({ buffer: null, loop: false, connect() {}, start() {}, stop() {} }),
          createBiquadFilter: () => ({ type: '', frequency: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, Q: { value: 0 }, connect() {} })
        };
      };
      win.speechSynthesis = { getVoices: () => [], speak() {}, cancel() {} };
      win.SpeechSynthesisUtterance = function (t) { this.text = t; };
      win.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);
      win.cancelAnimationFrame = (id) => clearTimeout(id);
    }
  });
  const w2 = dom2.window;
  await new Promise((r) => w2.addEventListener('load', r, { once: true }));
  await sleep(200);
  if (!w2.SWYF || !w2.SWYF.main) throw new Error('SWYF.main missing in single-file build');
  if (!w2.SWYF.main.world || w2.SWYF.main.world.colliders.length < 10) throw new Error('world not built');
  w2.SWYF.Day.startDay(1);
  w2.document.getElementById('btn-brief-go').click();
  if (w2.SWYF.Day.S.phase !== 'shift') throw new Error('shift did not start');
  w2.SWYF.Day.runEvent('virus');
  w2.document.getElementById('virus').querySelector('.virus-fix').click();
  if (probs2.length) throw new Error('runtime: ' + probs2[0]);
  single = 'ok (boots, starts a shift, hazards run)';
} catch (e) {
  single = 'FAILED: ' + e.message;
  fail.push('single-file build → ' + e.message);
}

console.log('\n================ SCAM BAQI SMOKE TEST ================');
console.log('single-file build: ' + single);
console.log('✔ passed: ' + ok.length);
ok.forEach((n) => console.log('   ✔ ' + n));
if (fail.length) {
  console.log('✘ failed: ' + fail.length);
  fail.forEach((n) => console.log('   ✘ ' + n));
}
if (bootProblems.length) { bootProblems.forEach((p) => problems.push('boot: ' + p)); }
if (problems.length) {
  console.log('⚠ runtime problems: ' + problems.length);
  problems.slice(0, 25).forEach((p) => console.log('   ⚠ ' + p));
}
const bad = fail.length + problems.length;
console.log(bad ? '\nRESULT: ' + bad + ' problem(s)' : '\nRESULT: all good ✅');
process.exit(bad ? 1 : 0);
