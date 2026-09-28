// اختبار الملف الوحد (jazira-standalone.html) — node tests/test-single.mjs
// كيبني الملف من الأول وكيحلّو فـDOM حقيقي (jsdom) باش نتأكدو بلي كيخدم بلا سيرفر
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');

let total = 0, fails = 0;
const ok = (c, m) => { total++; console.log((c ? '  ✅ ' : '  ❌ ') + m); if (!c) fails++; };

console.log('📄 اختبار الملف الوحد (HTML وحد بلا سيرفر)');

// 1) نبنيه دابا
execFileSync(process.execPath, [path.join(ROOT, 'tools/build-single.mjs')], { stdio: 'pipe' });
const file = path.join(ROOT, 'jazira-standalone.html');
const html = fs.readFileSync(file, 'utf8');
const kb = Buffer.byteLength(html, 'utf8') / 1024;

ok(fs.existsSync(file), `الملف تبنى (${kb.toFixed(0)} ك.ب)`);
ok(kb > 800 && kb < 4000, 'الحجم منطقي (فيه Three.js داخلو)');
ok(!/<script[^>]*src=/.test(html), 'ما كايناش سكريبت من برا (ماشي محتاج سيرفر)');
ok(/cdn|unpkg|jsdelivr/i.test(html) === false, 'ما كايناش CDN');
const inline = html.slice(html.lastIndexOf('<script>'), html.lastIndexOf('</script>'));
ok(inline.length > 500000, 'السكريبت داخلي وكبير');
ok(!/^\s*(import|export)\s/m.test(inline), 'ما بقاوش imports/exports فالسكريبت');
ok(inline.includes('WebGLRenderer'), 'Three.js داخل للسكريبت');

// 2) نحلّوه فـDOM حقيقي
let JSDOM = null;
for (const p of [process.env.JSDOM_PATH, 'jsdom', '/tmp/pwb/node_modules/jsdom/lib/api.js'].filter(Boolean)) {
  try { const m = await import(p); JSDOM = m.JSDOM || m.default?.JSDOM; if (JSDOM) break; } catch (e) { }
}
if (!JSDOM) {
  console.log('⚠️ jsdom ماشي مثبّت — تخطينا التشغيل الحقيقي (الملف تبنى وهاد شي مزيان).');
  console.log(fails === 0 ? `\n🎉 ${total} اختبار خدام!` : `\n⚠️ ${fails}/${total} طايحين`);
  process.exit(fails ? 1 : 0);
}

function makeCtx(canvas) {
  const store = {};
  return new Proxy(store, {
    get(t, p) {
      if (p in t) return t[p];
      if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => ({ addColorStop() { } });
      if (p === 'createImageData') return (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
      if (p === 'getImageData') return (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w) * Math.max(1, h) * 4) });
      if (p === 'measureText') return () => ({ width: 12 });
      if (p === 'canvas') return canvas;
      return () => { };
    },
    set(t, p, v) { t[p] = v; return true; },
  });
}

const errors = [];
const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'http://localhost:8080/?play=1',
  beforeParse(w) {
    w.HTMLCanvasElement.prototype.getContext = function (type) {
      if (type && String(type).includes('webgl')) return null;   // بحال متصفح بلا WebGL
      return this._ctx || (this._ctx = makeCtx(this));
    };
  },
});
dom.window.addEventListener('error', (e) => errors.push(String(e.message || e.error)));
dom.virtualConsole?.on?.('jsdomError', (e) => errors.push(String(e.message)));

await new Promise((r) => setTimeout(r, 600));

const w = dom.window;
ok(errors.length === 0, `بلا أخطاء JS فالصفحة${errors.length ? ': ' + errors[0].slice(0, 120) : ''}`);
ok(!!w.game, 'اللعبة قلعت من الملف الوحد');
ok(w.game.view.type === '2d', 'بلا WebGL → كترجع 2D (الرجوع التلقائي خدام)');
ok(w.game.state === 'playing', `?play=1 كيدخل ديريكت للعب (${w.game && w.game.state})`);
ok(!!w.document.getElementById('ui') && w.document.getElementById('ui').innerHTML.length > 500, 'الواجهة تبنات');
ok(!!w.document.getElementById('minimap'), 'الخريطة كاينة');
ok(w.document.querySelectorAll('#ui .screen:not(.hidden)').length === 0, 'ما كايناش شاشة مفتوحة');

// 3) نخليوه يلعب شوية
const t0 = w.game.time;
const p0 = { x: w.game.player.x, y: w.game.player.y };
w.game.input.x = 1; w.game.input.y = 0;
await new Promise((r) => setTimeout(r, 800));
w.game.input.x = 0; w.game.input.y = 0;
ok(w.game.time > t0, `الوقت كيدور (${t0.toFixed(1)} → ${w.game.time.toFixed(1)} ثانية)`);
const moved = Math.hypot(w.game.player.x - p0.x, w.game.player.y - p0.y);
ok(moved > 5, `اللاعب مشا بالمدخلات (${moved.toFixed(0)} بكسل)`);
ok(w.game.player.health > 0, `الصحة مزيانة (${w.game.player.health.toFixed(0)})`);
ok(w.game.inv && typeof w.game.inv.wood === 'number', 'الجرد خدام');
let renderOk = true;
try { w.game.render(); } catch (e) { renderOk = false; console.log('   ', e.message); }
ok(renderOk, 'الرسم 2D كيدوز من الملف الوحد');

// 4) مسار 3D داخل الملف الوحد: WebGL مزيّف → View3D كيتبنى، three.js كيتشغّل، ومن بعد كيرجع لـ2D
console.log('\n[3D داخل الملف الوحد]');
const { VirtualConsole } = await import(process.env.JSDOM_PATH || 'jsdom');
const warns = [];
const vc = new VirtualConsole();
vc.on('warn', (m) => warns.push(String(m)));
vc.on('error', (m) => warns.push('ERR ' + String(m)));
const dom3 = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  virtualConsole: vc,
  url: 'http://localhost:8080/?mode=3d',
  beforeParse(w2) {
    w2.HTMLCanvasElement.prototype.getContext = function (type) {
      if (type && String(type).includes('webgl')) {
        // WebGL مزيّف: كيدوز الكشف ولكن WebGLRenderer كيطيح → الرجوع لـ2D
        return { getShaderPrecisionFormat: () => ({ precision: 1, rangeMin: 1, rangeMax: 1 }), getParameter: () => 0, getExtension: () => null, getContextAttributes: () => ({}) };
      }
      return this._ctx || (this._ctx = makeCtx(this));
    };
  },
});
await new Promise((r) => setTimeout(r, 700));
const w3 = dom3.window;
const fellBack = warns.some((m) => m.includes('3D ما خدمش') || m.includes('المصيّر 3D طاح'));
ok(!!w3.game, 'اللعبة قلعت مع طلب 3D');
ok(w3.game.view && w3.game.view.type === '2d', 'الرجوع لـ2D خدام داخل الملف الوحد');
ok(fellBack, `three.js تشغّل داخل الملف وطاح بلطف (${warns.filter((m) => m.includes('3D')).length} رسالة)`);
ok(w3.game.state === 'menu', 'القائمة بانت (بلا ?play=1)');

// 5) بحال ملي كتحلو دوبل كليك (file://) — بلا سيرفر وبلا service worker
console.log('\n[file:// — دوبل كليك]');
const errs5 = [];
const dom5 = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'file:///home/user/جزيرة/jazira-standalone.html?play=1',
  beforeParse(w5) {
    w5.HTMLCanvasElement.prototype.getContext = function (type) {
      if (type && String(type).includes('webgl')) return null;
      return this._ctx || (this._ctx = makeCtx(this));
    };
  },
});
dom5.window.addEventListener('error', (e) => errs5.push(String(e.message || e.error)));
await new Promise((r) => setTimeout(r, 600));
const w5 = dom5.window;
ok(errs5.length === 0, `بلا أخطاء من file://${errs5.length ? ': ' + errs5[0].slice(0, 100) : ''}`);
ok(!!w5.game && w5.game.state === 'playing', 'اللعبة خدامة من file:// ديريكت');
ok(!!w5.game.world && w5.game.world.objs.length > 800, `الجزيرة تولدات (${w5.game.world ? w5.game.world.objs.length : 0} غرض)`);

console.log(fails === 0 ? `\n🎉 ${total} اختبار فالملف الوحد خدامين!` : `\n⚠️ ${fails}/${total} طايحين`);
process.exit(fails ? 1 : 0);
