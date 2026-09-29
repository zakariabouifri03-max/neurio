// اختبار الواجهة بـDOM حقيقي (jsdom) — node tests/test-ui.mjs
// إلا ما كانش jsdom مثبّت، كيتخطى بلا مشاكل:  npm i -D jsdom  ولا  JSDOM_PATH=/chemin/jsdom
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));

async function loadJsdom() {
  const tries = [process.env.JSDOM_PATH, 'jsdom', '/tmp/pw/node_modules/jsdom/lib/api.js'].filter(Boolean);
  for (const p of tries) {
    try {
      const mod = await import(p);
      const JSDOM = mod.JSDOM || mod.default?.JSDOM;
      if (JSDOM) return JSDOM;
    } catch (e) { }
  }
  return null;
}

const JSDOM = await loadJsdom();
if (!JSDOM) {
  console.log('⚠️ jsdom ماشي مثبّت — تخطينا اختبار الواجهة.');
  console.log('   باش تشغّلو:  npm i jsdom  ولا  JSDOM_PATH=/.../lib/api.js node tests/test-ui.mjs');
  process.exit(0);
}

const html = fs.readFileSync(path.join(here, '../index.html'), 'utf8');
const dom = new JSDOM(html, { pretendToBeVisual: true, url: 'http://localhost:8080/?mode=2d' });
const { window } = dom;

// كانفاس مزيّف (jsdom بلا canvas)
function makeCtx() {
  const store = {};
  return new Proxy(store, {
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
window.HTMLCanvasElement.prototype.getContext = function (type) {
  if (type && String(type).includes('webgl')) return null;   // ما كايناش WebGL = كيوقع كيما فالتيليفون القديم
  return this._ctx || (this._ctx = makeCtx());
};

globalThis.window = window;
globalThis.document = window.document;
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
globalThis.requestAnimationFrame = () => 0;
globalThis.localStorage = window.localStorage;
globalThis.HTMLElement = window.HTMLElement;
globalThis.location = window.location;
globalThis.URL = window.URL;

let fails = 0, total = 0;
const ok = (c, m) => { total++; if (c) console.log('  ✅ ' + m); else { fails++; console.log('  ❌ ' + m); } };
const click = (sel) => document.querySelector(sel).dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const keyDown = (k) => window.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true }));
const keyUp = (k) => window.dispatchEvent(new window.KeyboardEvent('keyup', { key: k, bubbles: true }));
const key = (k) => { keyDown(k); keyUp(k); };   // كليك كامل
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('🖥️ اختبار الواجهة (jsdom)');

// نبدلو main.js باش نقدرو نحكمو على المسارات
const mainSrc = fs.readFileSync(path.join(here, '../src/main.js'), 'utf8');
ok(mainSrc.includes('hasWebGL'), 'main.js فيها كشف WebGL');
ok(mainSrc.includes("localStorage.getItem('jazira_mode')"), 'كتحفظ اختيار الوضع');

// نحاكيو نفس منطق اختيار الوضع
const pick = (query, webgl, saved) => {
  const q = new URLSearchParams(query).get('mode');
  if (q === '2d' || q === '3d') return q;
  if (saved === '2d' || saved === '3d') return saved;
  return webgl ? '3d' : '2d';
};
ok(pick('?mode=3d', false, null) === '3d', 'mode=3d فـURL كيتحترم (وإلا طاح كيرجع 2D)');
ok(pick('?mode=2d', true, null) === '2d', 'mode=2d كيتحترم حتى مع WebGL');
ok(pick('', false, null) === '2d', 'بلا WebGL → 2D أوتوماتيك');
ok(pick('', true, null) === '3d', 'مع WebGL → 3D أوتوماتيك');
ok(pick('', true, '2d') === '2d', 'الاختيار المحفوظ كيربح');

// نبنيو اللعبة كيفما main.js (وضع 2D)
const { Game } = await import('../src/game.js');
const { View2D } = await import('../src/view2d.js');
const { RECIPE_BY_ID } = await import('../src/data.js');
const canvas = document.getElementById('game');
const game = new Game(canvas, new View2D());
window.game = game;
game.idleWorld();
game.ui.open('menu');

console.log('\n[الواجهة]');
ok(document.getElementById('ui').innerHTML.length > 500, 'الـUI تبنى');
ok(document.querySelectorAll('#ui .screen').length === 9, `9 شاشات (${document.querySelectorAll('#ui .screen').length})`);
ok(document.querySelectorAll('#ui .iconbtn').length === 5, '5 أزرار فوق');
ok(!!document.getElementById('minimap'), 'الخريطة كاينة');
ok(!!document.getElementById('fxOverlay') && !!document.getElementById('fadeOverlay'), 'طبقات التظليل كاينين');
ok(!document.getElementById('screenMenu').classList.contains('hidden'), 'قائمة البداية ظاهرة');
ok(!!document.getElementById('btnMode3d') && !!document.getElementById('btnMode2d'), 'أزرار تبديل 2D/3D كاينين');
game.ui.syncModeButtons();
ok(document.getElementById('btnMode2d').classList.contains('active'), 'زر 2D مضوّي');

console.log('\n[بداية اللعبة]');
click('#btnNew');
ok(!!game.world, 'زر "لعبة جديدة" خدام');
ok(game.state === 'tut', 'شاشة التعليم كتفتح أول مرة');
click('#btnTutOk');
ok(game.state === 'playing', 'من بعد التعليم كنلعبو');

console.log('\n[الهدف والماكلة]');
ok(document.getElementById('stageName').textContent.includes('المرحلة 1'), `اسم المرحلة: ${document.getElementById('stageName').textContent}`);
ok(document.querySelectorAll('#goalList .goal').length === 3, '3 أهداف ظاهرين');
ok(document.getElementById('timeLine').textContent.length === 5, `الساعة: ${document.getElementById('timeLine').textContent}`);
for (let i = 0; i < 240; i++) game.update(1 / 60);
ok(parseFloat(document.getElementById('barHp').style.width) > 0, `شريط الصحة: ${document.getElementById('barHp').style.width}`);

console.log('\n[لوحة الوصفات]');
click('#btnCraft');
ok(game.state === 'crafting', 'C = وصفات');
ok(document.querySelectorAll('#craftList .recipe').length >= 2, `${document.querySelectorAll('#craftList .recipe').length} وصفات`);
ok(!!document.querySelector('#craftList button[data-r="axe"]'), 'زر الفأس كاين');
game.inv.wood = 30; game.inv.stone = 30;
game.ui.syncAll();
document.querySelector('#craftList button[data-r="axe"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
ok(game.inv.axe === 1, 'الفأس تصنع بالكليك');
ok(document.querySelectorAll('#hotbar .slot').length >= 3, `شريط العناصر: ${document.querySelectorAll('#hotbar .slot').length} خانة`);
click('#btnCraftClose');
ok(game.state === 'playing', 'الوصفات تسدّت');
click('#screenCraft .tab[data-tab="item"]');
click('#btnCraft');
ok(!!document.querySelector('#craftList .recipe'), 'تبويب "حوايج" خدام');
click('#btnCraftClose');

console.log('\n[الشنطة والمساعدة والقائمة]');
click('#btnBag');
ok(!document.getElementById('screenBag').classList.contains('hidden'), 'الشنطة تفتحت');
ok(document.querySelectorAll('#bagList .recipe').length >= 2, 'المواد ظاهرة');
click('#btnBagClose');
click('#btnHelp');
ok(!document.getElementById('screenHelp').classList.contains('hidden'), 'شاشة المساعدة');
click('#btnHelpClose');
click('#btnMenu');
ok(!document.getElementById('screenPause').classList.contains('hidden'), 'قائمة الإيقاف');
ok(!!document.querySelector('#screenHelp .keyhint'), 'المساعدة فيها أزرار الكيبورد');
click('#btnResume');
ok(game.state === 'playing', 'رجعنا للعب');

console.log('\n[لوحة المفاتيح واللمس]');
keyDown('d');
ok(game.input.x === 1, 'D = يمين');
keyUp('d');
keyDown('w');
ok(game.input.y === -1, 'W = فوق');
keyUp('w');
keyDown('shift'); keyDown('d');
ok(game.input.run === true, 'SHIFT = جري');
keyUp('shift'); keyUp('d');
key('escape');
ok(game.state === 'paused', 'ESC = إيقاف');
key('escape');
ok(game.state === 'playing', 'ESC عاود رجع');
key('c'); ok(game.state === 'crafting', 'C = وصفات');
key('c'); ok(game.state === 'playing', 'C تسدّ');
key('i'); ok(game.state === 'inventory', 'I = شنطة');
key('i');
key('m'); ok(game.audio.muted === true, 'M = الصوت');
key('m');

console.log('\n[الأدوات والطعام]');
game.addItem('coconut', 2);
game.player.thirst = 40;
game.useItem('coconut');
ok(game.player.thirst > 40 && game.player.thirst <= 100, `جوز الهند عطى عطش: ${game.player.thirst.toFixed(0)}`);
game.addItem('meat', 4); game.addItem('wood', 10);
game.stageIdx = 2;
click('#btnCraft');
game.craft(RECIPE_BY_ID.campfire);
ok(!!game.world.struct('campfire'), 'نار المخيم تبنات');
click('#btnCraftClose');            // نسدو الوصفات باش نلعبو
const fire = game.world.struct('campfire');
game.player.x = fire.x; game.player.y = fire.y + 18;
const prompt = game.nearestInteraction();
ok(!!prompt && String(prompt.label).includes('طيّب'), `المطالبة: ${prompt ? prompt.label : 'لا شي'}`);
game.hitCd = 0;
game.doAction();
ok(game.stats.meals >= 1, `الطياب خدام (${game.stats.meals} ماكلة)`);

console.log('\n[الرسم 2D]');
try {
  for (let i = 0; i < 5; i++) { game.update(1 / 60); game.render(); }
  ok(true, 'render() كيدوز بلا مشاكل');
} catch (e) { ok(false, 'render() طاح: ' + e.message); }

console.log('\n[الرجوع لـ2D ملي يطيح 3D]');
const { View3D } = await import('../src/view3d.js');
const v3 = new View3D({ shadows: false, autoAttach: false });
const c2 = document.createElement('canvas');
document.body.appendChild(c2);                    // كيفما فالحقيقة: كانفاس داخلة للصفحة
const g2 = new Game(c2, v3);
g2.idleWorld();
ok(g2.view.type === '3d', 'المصيّر 3D مركّب');
v3.ready = false;   // كيما إلا فشل بناء المشهد
let threw = false;
try { g2.render(); } catch (e) { threw = true; }
ok(!threw, 'render بلا مشهد ما كيطيحش');
await g2.fallbackTo2D(new Error('test'));
ok(g2.view.type === '2d', 'الرجوع لـ2D كيخدم');
ok(!!g2.ctx, 'الكانفاس 2D تعاود ربطو');
g2.newGame(5);
g2.ui.back();
try { for (let i = 0; i < 3; i++) { g2.update(1 / 60); g2.render(); } ok(true, 'اللعبة كتكمل من بعد الرجوع'); }
catch (e) { ok(false, 'اللعب من بعد الرجوع طاح: ' + e.message); }

console.log('\n[الإقلاع الحقيقي — main.js]');
// كنقلعو اللعبة بحال ما كتقلع فالمتصفح، فحالات مختلفة
async function bootReal(url, { saved = null, fakeWebgl = false, save = null } = {}) {
  const d = new JSDOM(html, { pretendToBeVisual: true, url });
  const w = d.window;
  w.HTMLCanvasElement.prototype.getContext = function (type) {
    if (type && String(type).includes('webgl')) {
      if (!fakeWebgl) return null;                    // متصفح بلا WebGL
      return { getShaderPrecisionFormat: () => ({ precision: 1, rangeMin: 1, rangeMax: 1 }), getParameter: () => 0, getExtension: () => null };  // WebGL مزيّف كيطيح
    }
    return this._ctx || (this._ctx = makeCtx());
  };
  globalThis.window = w;
  globalThis.document = w.document;
  Object.defineProperty(globalThis, 'navigator', { value: w.navigator, configurable: true });
  globalThis.localStorage = w.localStorage;
  globalThis.location = w.location;
  globalThis.requestAnimationFrame = () => 0;
  if (saved) w.localStorage.setItem('jazira_mode', saved);
  if (save) w.localStorage.setItem('jazira_save_v1', save);
  await import('../src/main.js?boot=' + Math.random());
  await wait(400);
  return w;
}

const wA = await bootReal('http://localhost:8080/?mode=3d');
ok(!!wA.game, 'اللعبة قلعت (mode=3d بلا WebGL)');
ok(wA.game.view.type === '2d', 'بلا WebGL كترجع 2D بوحدها (بلا طيحان)');
ok(!wA.document.getElementById('loading'), 'شاشة التحميل تحيدت');
ok(!wA.document.getElementById('screenMenu').classList.contains('hidden'), 'قائمة البداية بانت');

const wB = await bootReal('http://localhost:8080/?mode=2d');
ok(wB.game.view.type === '2d', 'mode=2d كتقلع 2D');

const wC = await bootReal('http://localhost:8080/', { saved: '2d' });
ok(wC.game.view.type === '2d', 'الاختيار المحفوظ (2d) كيتحترم');

const wD = await bootReal('http://localhost:8080/', { fakeWebgl: true, saved: '3d' });
ok(wD.game.view.type === '2d', 'WebGL مزيّف/خايب → كترجع 2D بلا كراش');

const wE = await bootReal('http://localhost:8080/');
ok(wE.game.view.type === '2d', 'بلا WebGL اصلا → 2D أوتوماتيك');

console.log('\n[?play=1 — اللعب ديريكت]');
const wF = await bootReal('http://localhost:8080/?play=1');
ok(wF.game.state === 'playing', `الدخول ديريكت للعب (state=${wF.game.state})`);
ok(wF.document.querySelectorAll('#ui .screen:not(.hidden)').length === 0, 'ما كايناش شاشة مفتوحة');
ok(!!wF.game.world && !!wF.game.player, 'العالم واللاعب واجدين');
ok(wF.document.body.classList.contains('autoplay'), 'الوضع الأوتوماتيك معلّم فالـbody');
ok(!!wF.document.getElementById('hud') && !!wF.document.getElementById('barHp'), 'HUD كاين (الصحة والمرحلة)');
const day0 = wF.game.world.time;
wF.game.update(0.5);
ok(wF.game.world.time > day0, 'الوقت كيدور (اللعبة خدامة ماشي مصوّرة)');

const wG = await bootReal('http://localhost:8080/?auto=1&seed=20240928');
ok(wG.game.state === 'playing', '?auto=1 تالخداكة');
ok(wG.game.seed === 20240928, `البذرة من الرابط (${wG.game.seed})`);
const wH = await bootReal('http://localhost:8080/?play=0');
ok(wH.game.state === 'menu', '?play=0 كيبقى على القائمة');

// ?play=1 مع حفظ موجود → كيكمّل من الحفظ ماشي جزيرة جديدة
const saveJson = JSON.stringify(wF.game.toJSON());
const wI = await bootReal('http://localhost:8080/?play=1', { save: saveJson });
ok(wI.game.state === 'playing', '?play=1 مع حفظ → كيكمّل مباشرة');
ok(wI.game.seed === wF.game.seed, `نفس الجزيرة المحفوظة (${wI.game.seed})`);

console.log(fails === 0 ? `\n🎉 ${total} اختبار فالواجهة كاملين خدامين!` : `\n⚠️ ${fails}/${total} اختبارات طايحين`);
process.exit(fails ? 1 : 0);
