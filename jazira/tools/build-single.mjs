// 🧱 بناء ملف HTML وحد (كلشي داخلو: JS + Three.js) — node tools/build-single.mjs
// النتيجة: jazira-standalone.html — كتحلها دوبل كليك وكتلعب (بلا سيرفر، بلا أنترنت)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');

const ENTRY = 'src/main.js';
const OUT = path.join(ROOT, 'jazira-standalone.html');

// ---------- 1) نتبعو الوحدات (imports) ----------
function resolveId(fromId, spec) {
  if (!spec.startsWith('.')) return spec;
  const dir = path.posix.dirname(fromId);
  let p = path.posix.normalize(path.posix.join(dir, spec));
  while (p.startsWith('../')) p = p.slice(3);          // vendor ديال الجذر
  return p;
}

const read = (id) => fs.readFileSync(path.join(ROOT, id), 'utf8');

const RE = {
  ns: /^import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+'([^']+)'\s*;?\s*$/,
  named: /^import\s*\{([^}]*)\}\s*from\s+'([^']+)'\s*;?\s*$/,
  side: /^import\s+'([^']+)'\s*;?\s*$/,
  exportDecl: /^export\s+(async\s+)?(function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/,
  exportList: /^export\s*\{([^}]*)\}\s*;?\s*$/,
  exportDefault: /^export\s+default\b/,
  dynamic: /await\s+import\(\s*'([^']+)'\s*\)/g,
};

const modules = new Map();   // id → { code, deps:Set }
const queue = [ENTRY];

while (queue.length) {
  const id = queue.shift();
  if (modules.has(id)) continue;
  const src = read(id);
  const deps = new Set();
  const lines = src.split('\n');
  const out = [];
  const exported = new Map();       // اسم محلي → اسم مصدَّر

  for (const line of lines) {
    let m;
    if ((m = line.match(RE.ns))) {
      const dep = resolveId(id, m[2]); deps.add(dep);
      out.push(`const ${m[1]} = __req(${JSON.stringify(dep)});`);
      continue;
    }
    if ((m = line.match(RE.named))) {
      const dep = resolveId(id, m[2]); deps.add(dep);
      const names = m[1].split(',').map((x) => x.trim()).filter(Boolean)
        .map((x) => (x.includes(' as ') ? x.split(' as ').map((y) => y.trim()).join(': ') : x));
      out.push(`const { ${names.join(', ')} } = __req(${JSON.stringify(dep)});`);
      continue;
    }
    if ((m = line.match(RE.side))) {
      const dep = resolveId(id, m[1]); deps.add(dep);
      out.push(`__req(${JSON.stringify(dep)});`);
      continue;
    }
    if ((m = line.match(RE.exportDecl))) {
      exported.set(m[3], m[3]);
      out.push(line.replace(/^export\s+/, ''));
      continue;
    }
    if ((m = line.match(RE.exportList))) {
      for (const raw of m[1].split(',').map((x) => x.trim()).filter(Boolean)) {
        const [local, exp] = raw.includes(' as ') ? raw.split(' as ').map((x) => x.trim()) : [raw, raw];
        exported.set(local, exp);
      }
      continue;   // ما كتولّدش كود
    }
    if (RE.exportDefault.test(line)) throw new Error(`export default ماشي مدعوم فـ${id}`);
    // dynamic imports
    if (line.includes('import(')) {
      let l = line;
      l = l.replace(RE.dynamic, (all, spec) => {
        const dep = resolveId(id, spec); deps.add(dep);
        return `await __load(${JSON.stringify(dep)})`;
      });
      out.push(l);
      continue;
    }
    out.push(line);
  }

  const body = out.join('\n');
  if (/^\s*(import|export)\s/m.test(body)) {
    const bad = body.split('\n').filter((l) => /^\s*(import|export)\s/.test(l)).slice(0, 3);
    throw new Error(`بقاو imports/exports فـ${id}:\n  ${bad.join('\n  ')}`);
  }
  modules.set(id, { code: body, deps, exported });
  for (const d of deps) if (!modules.has(d)) queue.push(d);
}

// ترتيب: الوحدات القاعدية قبل (ماشي ضروري حيت __def غير كيسجل، ولكن أحسن للقراءة)
const order = [];
const seen = new Set();
(function visit(id) {
  if (seen.has(id)) return;
  seen.add(id);
  const m = modules.get(id);
  for (const d of m.deps) visit(d);
  order.push(id);
})(ENTRY);

// ---------- 2) نركّبو السكريبت ----------
const parts = [];
parts.push('/* 🏝️ جزيرة — ملف وحد (bundled): كل الوحدات + Three.js داخلو */');
parts.push('(function () {');
parts.push('"use strict";');
parts.push('const __mod = {}, __cache = {};');
parts.push('function __def(id, fn) { __mod[id] = fn; }');
parts.push('function __req(id) {');
parts.push('  if (__cache[id]) return __cache[id];');
parts.push('  const ex = __cache[id] = {};');
parts.push('  const fn = __mod[id];');
parts.push('  if (!fn) throw new Error("module not found: " + id);');
parts.push('  fn(ex, __req, __load);');
parts.push('  return ex;');
parts.push('}');
parts.push('function __load(id) { return Promise.resolve(__req(id)); }');

for (const id of order) {
  const m = modules.get(id);
  const exps = [...m.exported.entries()];
  const assign = exps.length
    ? 'Object.assign(__exports, { ' + exps.map(([l, e]) => (l === e ? l : `${e}: ${l}`)).join(', ') + ' });'
    : '';
  parts.push(`\n// ===== ${id} =====`);
  parts.push(`__def(${JSON.stringify(id)}, function (__exports, __req, __load) {`);
  parts.push(m.code);
  if (assign) parts.push(assign);
  parts.push('});');
}
parts.push(`\n__req(${JSON.stringify(ENTRY)});   // يلا نبداو`);
parts.push('})();');

let bundle = parts.join('\n');
if (bundle.includes('</script')) bundle = bundle.replace(/<\/script/g, '<\\/script');

const html0 = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
if (!html0.includes('src/main.js')) throw new Error('ما لقيتش src/main.js فـindex.html');

// ---------- 3) الـCSS والصور: كلشي داخل الملف (باش يخدم من file:// بلا سيرفر) ----------
function dataUri(file) {
  const ext = path.extname(file).toLowerCase();
  const mime = { '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp' }[ext] || 'application/octet-stream';
  const buf = fs.readFileSync(path.join(ROOT, file));
  if (mime.startsWith('text/')) return `data:${mime};charset=utf-8,` + encodeURIComponent(buf.toString('utf8'));
  return `data:${mime};base64,` + buf.toString('base64');
}

let html = html0;
// CSS: كنحولوه لـ<style> (مع أي url() داخلو)
html = html.replace(/<link[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>\s*/i, (all, href) => {
  let css = fs.readFileSync(path.join(ROOT, href), 'utf8');
  css = css.replace(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g, (m, u) => {
    if (/^(data:|https?:|#)/.test(u)) return m;
    const f = path.posix.normalize(path.posix.join(path.posix.dirname(href), u));
    return `url(${dataUri(f)})`;
  });
  return `<style>\n${css}\n</style>\n`;
});
// الأيقونات
html = html.replace(/<link([^>]*rel=["']apple-touch-icon["'][^>]*)href=["']([^"']+)["']([^>]*)>\s*/i,
  (all, a, href, b) => `<link${a}href="${dataUri(href)}"${b}>\n`);
// المانيفست ما كيديرش خدمة من ملف وحد
html = html.replace(/<link[^>]*rel=["']manifest["'][^>]*>\s*/i, '');
// السكريبت
html = html.replace(/<script[^>]*src="src\/main\.js"[^>]*><\/script>\s*/i, '')
  // ⚠️ دالة عوض نص: '$, $' وغيرهم عندهم معنى خاص فـreplace
  .replace('</body>', () => `<script>window.__JAZIRA_STANDALONE = true;</script>\n<script>\n${bundle}\n</script>\n</body>`);

// ---------- 4) تحقّق: ما خاص يكون حتى شي حاجة من برا ----------
const leftovers = [...html.matchAll(/(?:src|href)\s*=\s*["'](?!#|data:)([^"']+)["']/g)].map((m) => m[1]);
if (leftovers.length) throw new Error('بقاو علامات خارجية: ' + leftovers.join(', '));
if (!/<style>/.test(html)) throw new Error('الـCSS ما دخلش');

const kb = (s) => (Buffer.byteLength(s, 'utf8') / 1024).toFixed(0) + ' ك.ب';
fs.writeFileSync(OUT, html);
console.log(`✅ ${path.relative(ROOT, OUT)} — ${kb(html)} · ${order.length} وحدة`);
console.log('   الوحدات:', order.join(', '));
