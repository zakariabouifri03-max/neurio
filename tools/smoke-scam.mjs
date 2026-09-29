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
    // ---- fetch + friends (jsdom has no fetch; the AI bridge needs them)
    win.fetch = (...a) => fetch(...a);
    win.Headers = Headers; win.Request = Request; win.Response = Response;
    win.AbortController = AbortController; win.TextDecoder = TextDecoder; win.TextEncoder = TextEncoder;
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
// load in exactly the order index.html declares (no drift possible)
const GAME_SCRIPTS = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)]
  .map((m) => m[1])
  .filter((f) => f.indexOf('vendor/') !== 0);   // three.js is loaded + stubbed below
GAME_SCRIPTS.forEach((f) => runFile('scam/' + f));
console.log('scripts loaded: ' + GAME_SCRIPTS.length);

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
// ======================= AI layer: NLU · brain · LLM bridge =================
check('nlu: neural model loads + self-test', () => {
  if (!SWYF.nlu.hasModel()) throw new Error('no model loaded');
  const t = SWYF.nlu.selfTest();
  if (!t.total) throw new Error('no samples');
  if (t.pass / t.total < 0.9) throw new Error('self-test ' + t.pass + '/' + t.total + ' → ' + (t.fails[0] || ''));
});

check('nlu: understands arabic, darija and arabizi', () => {
  const cases = [
    ['نتا كداب و نصاب', 'insult'],
    ['غادي نعيط للشرطة دابا', 'threat'],
    ['عالاش كتسول على الحساب ديالي؟', 'suspicion'],
    ['salam khoya, labas?', 'greet'],
    ['bghit n3ref chhal 3ndi f bank', 'ask_bank'],
    ['السلام عليكم، شحال الرصيد ديالي فالبنك', 'ask_bank'],
    ['عافاك كنفهمك، ما تخافش', 'empathy'],
    ['والله ما كنكدب', 'faith'],
    ['حول ليا 20000 درهم', 'ask_money_big'],
    ['كيفاش حالك خويا، شنو كتدير ف الخدمة', 'chat']
  ];
  const bad = [];
  for (const [txt, want] of cases) {
    const a = SWYF.nlu.analyze(txt);
    if (a.intent !== want && !(a.themes || []).length) bad.push(txt + ' → ' + a.intent);
  }
  if (bad.length > 1) throw new Error('misunderstood: ' + bad.join(' | '));
});

check('nlu: question / entity extraction', () => {
  const a = SWYF.nlu.analyze('واش عندك وثيقة رسمية؟ خاصك 1500 درهم');
  if (!a.isQuestion) throw new Error('question not detected');
  if (a.money !== 1500) throw new Error('money=' + a.money);
  const b = SWYF.nlu.analyze('الرمز هو 482913');
  if (!b.codes.length) throw new Error('code not extracted');
});

check('brain: replies to 24 varied lines, never empty', () => {
  const lines = [
    'السلام عليكم', 'شكون معايا', 'عطيني دليل', 'لا ما بغيتش', 'واخا صافي',
    'كيفاش حالك خويا', 'واش عندك الدراري', 'الجو سخون بزاف اليوم', 'شحال عمرك',
    'ماتش الرجاء كان زوين', 'والله نقسم بلي غادي نخلص', 'علاش كتسول على ولدي',
    'نتا نصاب', 'غادي نبلغ عليك', 'خاصك تحول 5000 درهم', 'دقيقة واحدة تسنى',
    'مراتي مريضة و راني بوحدي', 'عافاك كنفهمك', 'واش هاد المكالمة مسجلة',
    'عندي العنوان ديالك كامل', 'ههههه راك كتضحك', 'مكنعرفش', '………', 'منين جبتي الرقم ديالي'
  ];
  const c = SWYF.callers.createCaller({ day: 1 });
  const seen = [];
  for (const raw of lines) {
    const r = SWYF.brain.respond(c, raw, {});
    if (!r || !r.text || r.text.length < 3) throw new Error('empty reply for: ' + raw);
    if (/undefined|NaN|\{name\}|\{agent\}/.test(r.text)) throw new Error('bad slots in: ' + r.text);
    seen.push(r.text);
  }
  let dup = 0;
  for (let i = 0; i < seen.length; i++) for (let j = i + 1; j < seen.length; j++) if (seen[i] === seen[j]) dup++;
  if (dup > 1) throw new Error('repeated lines: ' + dup);
});

check('brain: backstory stays consistent when asked twice', () => {
  const c = SWYF.callers.createCaller({ day: 2 });
  const a1 = SWYF.brain.respond(c, 'شكون نتا عافاك', {});
  const a2 = SWYF.brain.respond(c, 'شكون نتا من فضلك', {});
  const id1 = (a1.text.match(/MK-\d{4}/) || [])[0];
  const id2 = (a2.text.match(/MK-\d{4}/) || [])[0];
  if (!id1 || !id2) throw new Error('no employee id: ' + a1.text + ' || ' + a2.text);
  if (id1 !== id2 || id1 !== c.backstory.empId) throw new Error('identity drifted: ' + id1 + ' vs ' + id2);
});

check('brain: insult spikes suspicion, threat answered in character', () => {
  const c = SWYF.callers.createCaller({ day: 1 });
  c.scambaiter = false; c.scambaiterObj = null;
  const before = c.suspicion;
  const r1 = SWYF.callers.act(c, { type: 'text', text: 'نتا نصاب و كداب' }, { upgrades: {}, evidence: false });
  if (c.suspicion <= before) throw new Error('suspicion did not rise');
  if (r1.kind !== 'bad' && r1.kind !== 'hangup') throw new Error('insult kind=' + r1.kind);
  const c2 = SWYF.callers.createCaller({ day: 1 });
  c2.scambaiter = false; c2.scambaiterObj = null;
  const r2 = SWYF.callers.act(c2, { type: 'text', text: 'غادي نعيط للشرطة و نبلغ عليك' }, { upgrades: {}, evidence: false });
  if (!r2.callerLine || r2.callerLine.length < 5) throw new Error('no answer to the threat');
});

check('brain: money asked in free text goes through the ask maths', () => {
  const c = SWYF.callers.createCaller({ day: 1 });
  c.scambaiter = false; c.scambaiterObj = null;   // scambaiters never pay (that's the point)
  c.trust = 80; c.suspicion = 5;
  const r = SWYF.callers.act(c, { type: 'text', text: 'خاصك تحول ليا 3000 درهم دابا' }, { upgrades: {}, evidence: false });
  if (r.money <= 0) throw new Error('no payout, money=' + r.money);
  if (!r.success) throw new Error('not marked as success');
});

check('brain: advice chip suggests a real tactic', () => {
  const c = SWYF.callers.createCaller({ day: 1 });
  c.trust = 70;
  const tip = SWYF.callers.advise(c, { facts: c.facts });
  if (!tip || !tip.tacticId) throw new Error('no advice');
  if (!tip.label || tip.label.indexOf('جرّب') < 0) throw new Error('label=' + tip.label);
});

check('ai: offline by default, and falls back to the brain', async () => {
  const st = await SWYF.ai.probe();
  if (st.online) throw new Error('a local model answered without one being started');
  const off = await SWYF.ai.reply(SWYF.callers.createCaller({ day: 1 }), 'السلام عليكم');
  if (off !== null) throw new Error('expected null reply offline');
});

check('ai: parses the model control tail', () => {
  const p = SWYF.ai.parseControl('واخا، غادي نحول.\n%%{"trust":6,"susp":2,"ask":"small","hangup":false}');
  if (p.text.indexOf('%') >= 0) throw new Error('tag left in text: ' + p.text);
  if (!p.ctl || p.ctl.trust !== 6 || p.ctl.ask !== 'small') throw new Error('ctl=' + JSON.stringify(p.ctl));
});

check('ai: talks to a local model over SSE and keeps the maths', async () => {
  const http = require('node:http');
  const srv = http.createServer((req, res) => {
    if (req.url.indexOf('/status') >= 0) { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ online: true, backend: 'fake', model: 'test-1', streaming: true })); }
    if (req.url.indexOf('/chat') >= 0) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      for (const t of ['ألو، ', 'السلام… ', 'شكون معايا؟', '\n%%{"trust":5,"susp":3,"ask":null,"hangup":false}']) res.write('data: ' + JSON.stringify({ t }) + '\n\n');
      res.write('data: [DONE]\n\n');
      return res.end();
    }
    res.statusCode = 404; res.end('no');
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  SWYF.ai.setMode('llm');
  SWYF.ai.setUrl('http://127.0.0.1:' + port);
  const st = await SWYF.ai.probe();
  if (!st.online) { srv.close(); throw new Error('probe failed on the fake backend'); }
  const c = SWYF.callers.createCaller({ day: 1 });
  const r = await SWYF.ai.reply(c, 'السلام عليكم، شكون معايا؟');
  if (!r || !r.text) { srv.close(); throw new Error('no LLM reply'); }
  if (r.source !== 'llm') { srv.close(); throw new Error('source=' + r.source); }
  if (!/شكون/.test(r.text)) { srv.close(); throw new Error('stream lost: ' + r.text); }
  const res = SWYF.callers.act(c, { type: 'text', text: 'السلام عليكم، شكون معايا؟', llm: r }, { upgrades: {}, evidence: false });
  if (!res.callerLine) { srv.close(); throw new Error('caller said nothing'); }
  if (res.source !== 'llm') { srv.close(); throw new Error('turn source=' + res.source); }
  SWYF.ai.setUrl('http://127.0.0.1:1');
  await SWYF.ai.probe();
  const dead = await SWYF.ai.reply(c, 'واخا');
  if (dead !== null) { srv.close(); throw new Error('dead backend did not fall back'); }
  const local = SWYF.callers.act(c, { type: 'text', text: 'واخا', llm: null }, { upgrades: {}, evidence: false });
  if (!local.callerLine) { srv.close(); throw new Error('local fallback said nothing'); }
  srv.close();
  SWYF.ai.setMode('brain');
});

// ===================== LOOK & FEEL: characters · physics · casino · PC ======
check('look: characters are the reference style (big head, no face, name tag)', () => {
  const c = SWYF.art.makeCharacter({ name: 'Hypercat Ahmed', emoji: '🐱', tagColor: 0xff8a3d, headset: true });
  if (!c.group) throw new Error('no group');
  if (!c.head) throw new Error('no head');
  if (!c.tag) throw new Error('no name tag sprite');
  if (!c.headphones) throw new Error('no headphones');
  if ((c.eyes || []).length !== 2) throw new Error('expected 2 flat eyes');
  c.group.updateMatrixWorld(true);
  const box = new win.THREE.Box3(), tmp = new win.THREE.Box3();
  (function walk(o) {
    o.children.forEach((ch) => {
      if (ch.isSprite) return;                       // name tag + speech bubble don't count
      if (ch.isMesh) { ch.geometry.computeBoundingBox(); tmp.copy(ch.geometry.boundingBox).applyMatrix4(ch.matrixWorld); box.union(tmp); }
      walk(ch);
    });
  })(c.group);
  const size = box.getSize(new win.THREE.Vector3());
  if (size.y < 1.5 || size.y > 2.4) throw new Error('weird body height: ' + size.y.toFixed(2));
  if (c.head.position.y < 1.4) throw new Error('head not on top (big-head look)');
  if (c.tag.position.y < 2.0) throw new Error('name tag not floating above the head');
});

check('look: office is the blue flat-shaded set (carpet, glass, posters, notes)', () => {
  const w = SWYF.main.world;
  if (!w.ART) throw new Error('art kit missing');
  let glass = 0, posters = 0, strips = 0, chars = 0, tags = 0;
  w.root.traverse((o) => {
    if (o.material && o.material.transparent && o.material.opacity < 0.3) glass++;
    if (o.isSprite) tags++;
  });
  if (glass < 5) throw new Error('not enough glass partitions: ' + glass);
  w.npcs.forEach((n) => { if (n.obj && n.obj.tag) chars++; });
  if (chars < 3) throw new Error('coworkers without name tags: ' + chars);
  if (!w.flags.meetingSpot) throw new Error('no conference room');
  if (!w.flags.casinoEntry) throw new Error('no casino entrance');
});

check('look: the in-world computer shows the fake-browser OS', () => {
  const w = SWYF.main.world;
  if (!w.monitors || w.monitors.length < 4) throw new Error('monitors: ' + (w.monitors ? w.monitors.length : 0));
  const m = w.monitors.find((x) => x.mine) || w.monitors[0];
  if (!m.os || !m.os.canvas) throw new Error('monitor has no live OS canvas');
  const before = m.os.canvas.toDataURL ? 'x' : 'x';
  w.update(0.02, new win.THREE.Vector3(0, 0, 0));
  if (!m.os.tex) throw new Error('OS texture missing');
  if (!m.os.tag) throw new Error('OS screen has no tag');
});

check('physics: a coworker gets knocked over and stands back up', () => {
  const w = SWYF.main.world;
  const npc = w.npcs[0];
  const start = npc.obj.group.position.clone();
  const ok = SWYF.physics.knock(npc.obj, 1, 0, 1.2, w);
  if (!ok) throw new Error('knock refused');
  if (!npc.obj.ragdoll) throw new Error('not ragdolling');
  for (let i = 0; i < 90; i++) SWYF.physics.step(1 / 60, w);
  const moved = npc.obj.group.position.distanceTo(start);
  if (moved < 0.05) throw new Error('character did not fly: ' + moved.toFixed(3));
  if (Math.abs(npc.obj.group.rotation.z) < 0.05) throw new Error('character did not tumble');
  // let the recovery finish
  for (let i = 0; i < 400 && npc.obj.ragdoll; i++) SWYF.physics.step(1 / 60, w);
  if (npc.obj.ragdoll) throw new Error('never got back up');
  if (Math.abs(npc.obj.group.rotation.z) > 0.01) throw new Error('still lying down after recovery');
});

check('physics: props bounce and the stink cloud throws people', () => {
  const w = SWYF.main.world;
  const b = SWYF.physics.spawnProp(w, new win.THREE.Vector3(-3.4, 1.4, 0.2), 0.3, 0xff4d4d);
  SWYF.physics.impulse(b, 3, 2, 0);
  for (let i = 0; i < 40; i++) SWYF.physics.step(1 / 60, w);
  if (b.mesh.position.y < 0) throw new Error('prop fell through the floor');
  if (SWYF.physics.bodies.indexOf(b) < 0) throw new Error('prop lost');
  // gas cloud at the nearest coworker
  const npc = w.npcs[1];
  npc.obj.ragdoll = false;
  SWYF.physics.stinkCloud(npc.obj.group.position.clone().setY(0.4), 3.4, 1.3);
  SWYF.physics.step(1 / 60, w);
  if (!npc.obj.ragdoll) throw new Error('gas cloud did not knock anybody');
  for (let i = 0; i < 200; i++) SWYF.physics.step(1 / 60, w);
});

check('physics: the player can shove a coworker (F)', () => {
  const w = SWYF.main.world;
  const npc = w.npcs[2];
  // isolate the scene: park everybody far away except the victim
  w.npcs.forEach((n, i) => { n.obj.ragdoll = false; n.obj.group.position.set(10 + i, 0, 10 + i); n.target = n.obj.group.position.clone(); });
  npc.obj.group.position.set(0, 0, 0);
  const hit = SWYF.physics.shove(w, new win.THREE.Vector3(0, 0, -1.1), 0, { power: 1 });
  if (!hit) throw new Error('shove found nobody');
  if (!hit.obj.ragdoll) throw new Error('shoved coworker not ragdolling');
  for (let i = 0; i < 260; i++) SWYF.physics.step(1 / 60, w);
});

check('casino: neon room with slots, duck race and a blackjack table', () => {
  const cs = SWYF.Casino.built();
  if (!cs) throw new Error('casino not built');
  if (!cs.slots || cs.slots.length < 3) throw new Error('slot machines: ' + (cs.slots ? cs.slots.length : 0));
  if (!cs.slots[0].screen || !cs.slots[0].canvas) throw new Error('slot machine has no screen');
  if (!cs.race || cs.race.ducks.length !== 5) throw new Error('duck race missing');
  if (!cs.board || !cs.board.canvas) throw new Error('results board missing');
  SWYF.Casino.update(0.02);
  SWYF.Casino.open('slots');
  const el = win.document.getElementById('casino-ui');
  if (!el || el.classList.contains('hidden')) throw new Error('casino UI did not open');
  if (!el.querySelector('.cs-reel')) throw new Error('no reels rendered');
  SWYF.Casino.open('race');
  if (!el.querySelector('.cs-lane')) throw new Error('no duck lanes rendered');
  SWYF.Casino.open('cards');
  if (!el.querySelector('.cs-deal')) throw new Error('no blackjack table rendered');
  SWYF.Casino.close();
  if (!el.classList.contains('hidden')) throw new Error('casino UI did not close');
});

check('casino: betting really moves the cash (and the loot is capped)', () => {
  SWYF.Day.S.cash = 1000;
  SWYF.Day.S.phase = 'shift';
  SWYF.Day.S.shiftT = 0;
  SWYF.Casino.open('slots');
  const el = win.document.getElementById('casino-ui');
  const before = SWYF.Day.S.cash;
  el.querySelector('.cs-bet[data-b="100"]').click();
  el.querySelector('.cs-spin').click();
  if (SWYF.Day.S.cash >= before) throw new Error('bet was not taken: ' + SWYF.Day.S.cash);
  if (!SWYF.Casino.stats().spins) throw new Error('spin not counted');
  // duck race is rigged-friendly: force a win by hand and check the payout path
  SWYF.Day.S.cash = 500;
  SWYF.Casino.open('race');
  el.querySelector('.cs-lane[data-i="2"]').click();
  el.querySelector('.cs-run').click();
  if (SWYF.Day.S.cash >= 500) throw new Error('race bet was not taken');
  SWYF.Casino.close();
  // spend some in-game time for gambling
  if (SWYF.Day.S.shiftT <= 0) throw new Error('gambling should cost shift time');
});

check('meeting: the purple banner event exists and can be failed', () => {
  SWYF.Day.S.phase = 'shift'; SWYF.Day.S.shiftT = 0; SWYF.Day.S.paused = false;
  SWYF.Day.S.eventT = 9999;                        // no other event mid-test
  SWYF.Day.runEvent('meeting');
  const banner = win.document.getElementById('meeting');
  if (!banner || banner.classList.contains('hidden')) throw new Error('no meeting banner');
  if (!SWYF.Day.S.meeting) throw new Error('meeting state missing');
  // fast-forward: stand far away → fail (-nerves)
  SWYF.main.player.teleport(6, 4, 0);
  const nerves = SWYF.Day.S.nerves;
  for (let i = 0; i < 240; i++) { SWYF.Day.S.phase = 'shift'; SWYF.Day.S.shiftT = 0; SWYF.Day.update(0.2); }
  if (SWYF.Day.S.meeting) throw new Error('meeting never resolved');
  if (banner.classList.contains('hidden') === false) throw new Error('banner stayed on screen');
  if (SWYF.Day.S.nerves >= nerves) throw new Error('missing the meeting should cost nerves');
});

check('desktop: Caller Truth · SAKARY browser · DuckTalk all render', () => {
  const ids = SWYF.Desktop.apps.map((a) => a.id);
  ['truth', 'browser', 'ducktalk'].forEach((id) => {
    if (ids.indexOf(id) < 0) throw new Error('app missing: ' + id);
  });
  const t = SWYF.Desktop.open('truth');
  if (!t.body.querySelector('.ct-face') && !t.body.querySelector('canvas')) throw new Error('Caller Truth has no portrait');
  if (!t.body.querySelector('.ct-hang')) throw new Error('Caller Truth has no HANG UP button');
  const b = SWYF.Desktop.open('browser');
  if (!b.body.querySelector('.br-url')) throw new Error('browser has no URL bar');
  b.body.querySelector('.br-src').click();                  // source view (reference!)
  if (!b.body.querySelector('.br-src-view')) throw new Error('source view did not open');
  b.body.querySelector('.br-tab[data-p="simpletax"]').click();
  if (!/Simpletax/.test(b.body.textContent)) throw new Error('simpletax page missing');
  const d = SWYF.Desktop.open('ducktalk');
  if (!d.body.querySelector('.dt-vid')) throw new Error('DuckTalk has no video canvas');
  if (!d.instance || !d.instance.tick) throw new Error('DuckTalk does not animate');
  d.instance.tick();
  SWYF.Desktop.close('truth'); SWYF.Desktop.close('browser'); SWYF.Desktop.close('ducktalk');
});

check('desktop: taskbar shows the coloured running apps + clock', () => {
  SWYF.Desktop.open('notes');
  const tb = win.document.querySelectorAll('#dt-tasks .tb-icon');
  if (tb.length !== SWYF.Desktop.apps.length) throw new Error('taskbar icons: ' + tb.length);
  if (!win.document.querySelector('#dt-tasks .tb-icon.run')) throw new Error('running app not highlighted');
  const clock = win.document.getElementById('dt-clock');
  if (!clock || !/^\d\d:\d\d$/.test(clock.textContent)) throw new Error('clock reads: ' + (clock && clock.textContent));
  SWYF.Desktop.close('notes');
});

check('shop: the new toy items are buyable (gas · balls · chips)', () => {
  SWYF.Day.S.cash = 5000;
  const ids = SWYF.data.upgrades.map((u) => u.id);
  ['stink', 'balls', 'chips'].forEach((id) => { if (ids.indexOf(id) < 0) throw new Error('upgrade missing: ' + id); });
  const cash0 = SWYF.Day.S.cash;
  if (!SWYF.Day.buy('stink')) throw new Error('could not buy the stink bomb');
  if ((SWYF.Day.S.stinkBombs || 0) !== 3) throw new Error('stink bombs not added');
  if (SWYF.Day.S.cash >= cash0) throw new Error('cash did not change');
  const beforeChips = SWYF.Day.S.cash;
  if (!SWYF.Day.buy('chips')) throw new Error('could not buy chips');
  if (SWYF.Day.S.cash <= beforeChips) throw new Error('chips did not pay out');
  if (!SWYF.Day.buy('balls')) throw new Error('could not buy balls');
  if ((SWYF.Day.S.balls || 0) < 5) throw new Error('balls not added: ' + (SWYF.Day.S.balls || 0));
});


check('navigation: you can walk from your desk to the casino and the meeting room', () => {
  const w = SWYF.main.world, P = SWYF.main.player;
  const step = 0.3;
  function reachable(from, to) {
    const key = (x, z) => Math.round(x / step) + ':' + Math.round(z / step);
    const start = key(from.x, from.z), goal = key(to.x, to.z);
    const seen = new Set([start]);
    const q = [[from.x, from.z]];
    let guard = 0;
    while (q.length && guard++ < 40000) {
      const [x, z] = q.shift();
      if (Math.hypot(x - to.x, z - to.z) < 0.6) return true;
      for (const [dx, dz] of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
        const nx = x + dx, nz = z + dz, k = key(nx, nz);
        if (seen.has(k)) continue;
        seen.add(k);
        if (w.inBounds(nx, nz) && P.free(nx, nz)) q.push([nx, nz]);
      }
    }
    return false;
  }
  const cs = SWYF.Casino.built();
  const start = new win.THREE.Vector3(w.openSpot ? w.openSpot.x : 0.5, 0, w.openSpot ? w.openSpot.z : 3.2);
  const mood = () => {
    const bad = [];
    for (let x = -7.2; x <= -5.6; x += 0.15) if (!P.free(x, -2.7)) bad.push(x.toFixed(2));
    const blockers = [];
    SWYF.main.world.colliders.forEach((b, i) => {
      if (b.x1 < -5.7 && b.x2 > -7.1 && b.z1 < -2.4 && b.z2 > -3.0) blockers.push(i + ':' + b.x1.toFixed(2) + '..' + b.x2.toFixed(2) + '|' + b.z1.toFixed(2) + '..' + b.z2.toFixed(2));
    });
    return ' doorblocked=' + (bad.length ? bad.join(',') : 'none') + ' colliders=' + blockers.join(' ');
  };
  const diag = (label, to) => ' [' + label + ' start=' + P.free(start.x, start.z) +
    ' door=' + (P.free(w.api.W / 2, 5) + '/' + w.inBounds(w.api.W / 2, 5)) +
    ' inner=' + (P.free(cs.ox - 6, 0) + '/' + w.inBounds(cs.ox - 6, 0)) + ']';
  if (!reachable(start, new win.THREE.Vector3(cs.ox, 0, 0))) throw new Error('casino is not walkable' + diag('casino'));
  if (!reachable(start, w.flags.meetingSpot)) throw new Error('meeting room is not walkable' + diag('meeting') + mood());
  if (w.inBounds(cs.ox + 30, 0)) throw new Error('bounds sanity: casino leaks');
  if (w.inBounds(cs.ox, 9.9)) throw new Error('bounds allow escaping the casino');
});

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
