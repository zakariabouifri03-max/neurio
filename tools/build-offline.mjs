// ═════════════════════════════════════════════════════════════════════════════
// build-offline.mjs — turns the whole game into ONE self-contained HTML file.
//
//   node tools/build-offline.mjs   →   swindle/offline.html
//
// Zero dependencies: it walks the real ES module graph (swindle/js/main.js →
// shared/* → vendor/three.module.js), rewrites every import/export into a tiny
// inline registry, and pastes the result plus the stylesheet into the same
// index.html shell. The output runs from a double-click (file://), from a
// subfolder, from a USB stick or a plane — no server, no internet, no build step.
// Bots keep the table busy; the profile still saves to localStorage when the
// browser allows it.
// ═════════════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const ENTRY = 'swindle/js/main.js';
const OUT = 'swindle/offline.html';
const VENDOR = 'vendor/three.module.js';

/** same mapping the browser uses, from <script type="importmap"> in index.html */
function resolveSpec(spec, from) {
  if (spec === 'three') return VENDOR;
  if (spec.startsWith('three/addons/')) return 'vendor/' + spec.slice('three/addons/'.length);
  if (spec[0] === '.') return path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
  throw new Error(`${from}: the bundler only knows "three", "three/addons/*" and relative paths — got "${spec}"`);
}

/** rewrite one module: imports → __req(), exports → the module's export bag */
function parseModule(id) {
  const deps = [];
  const names = [];              // [exportedName, localName]
  let src = read(id);

  // export { a, b as c };  (possibly wrapped over several lines)
  src = src.replace(/^([ \t]*)export[ \t]*\{([\s\S]*?)\}[ \t]*;?[ \t]*(?:\/\/[^\n]*)?$/gm, (_m, ws, inner) => {
    for (const part of inner.split(',')) {
      const t = part.trim();
      if (!t) continue;
      const [local, exported] = t.split(/\s+as\s+/).map((x) => x.trim());
      names.push([exported || local, local]);
    }
    return ws;
  });

  // export const|let|var|function|async function|class NAME
  src = src.replace(/^([ \t]*)export[ \t]+(async function|function|const|let|var|class)[ \t]+([\w$]+)/gm,
    (_m, ws, kw, name) => { names.push([name, name]); return ws + kw + ' ' + name; });

  if (/^[ \t]*export[ \t]+default/m.test(src)) throw new Error(`${id}: "export default" is not supported by the bundler`);
  if (/^[ \t]*export[ \t]*\*/m.test(src)) throw new Error(`${id}: "export *" is not supported by the bundler`);
  if (/\bimport\.meta\b/.test(src)) throw new Error(`${id}: "import.meta" cannot be inlined`);

  // import { a, b as c } from 'x' | import * as N from 'x' | import D from 'x'
  src = src.replace(/^([ \t]*)import[ \t]+(?:\*[ \t]+as[ \t]+([\w$]+)|\{([\s\S]*?)\}|([\w$]+))[ \t]+from[ \t]*['"]([^'"]+)['"][ \t]*;?[ \t]*(?:\/\/[^\n]*)?$/gm,
    (_m, ws, ns, braces, def, spec) => {
      const dep = resolveSpec(spec, id);
      deps.push(dep);
      if (ns) return `${ws}const ${ns} = __req(${JSON.stringify(dep)});`;
      if (braces != null) {
        const parts = braces.split(',').map((s) => s.trim()).filter(Boolean).map((t) => {
          const [local, alias] = t.split(/\s+as\s+/).map((x) => x.trim());
          return !alias || alias === local ? local : `${local}: ${alias}`;
        });
        return `${ws}const { ${parts.join(', ')} } = __req(${JSON.stringify(dep)});`;
      }
      throw new Error(`${id}: default import ("${def}") from ${spec} is not supported`);
    });

  if (/^[ \t]*import[ \t]+[^(]/m.test(src)) throw new Error(`${id}: an import statement survived the rewrite — fix the parser`);
  return { id, body: src, deps, names };
}

// ── walk the graph ────────────────────────────────────────────────────────────
const mods = new Map();
const done = new Set();
const stack = [];
(function visit(id) {
  if (done.has(id)) return;
  if (stack.includes(id)) throw new Error('import cycle: ' + [...stack.slice(stack.indexOf(id)), id].join(' → '));
  stack.push(id);
  const m = parseModule(id);
  mods.set(id, m);
  for (const d of m.deps) visit(d);
  stack.pop();
  done.add(id);
})(ENTRY);

// every name some module imports must be exported by its source
for (const m of mods.values()) {
  for (const line of m.body.split('\n')) {
    const mm = /^\s*const \{([^}]*)\} = __req\("([^"]+)"\)/.exec(line);
    if (!mm) continue;
    const target = mods.get(mm[2]);
    if (!target) throw new Error(`${m.id}: imports from unbundled ${mm[2]}`);
    const have = new Set(target.names.map(([e]) => e));
    for (const spec of mm[1].split(',')) {
      const name = spec.trim().split(':')[0].trim();   // already rewritten to "local: alias"
      if (!name) continue;
      if (!have.has(name)) throw new Error(`${m.id}: "${name}" is not exported by ${mm[2]} — the bundler could not see it`);
    }
  }
}

// ── emit ─────────────────────────────────────────────────────────────────────
const parts = [];
parts.push(`// Generated by tools/build-offline.mjs — do not edit. Bundle of ${mods.size} modules.`);
parts.push('const __mods = new Map(), __cache = new Map();');
parts.push('const __def = (id, fn) => __mods.set(id, fn);');
parts.push('const __req = (id) => { let e = __cache.get(id); if (e) return e; const fn = __mods.get(id); if (!fn) throw new Error("unbundled module: " + id); e = {}; __cache.set(id, e); try { fn(e); } catch (err) { __cache.delete(id); throw err; } return e; };');
for (const m of mods.values()) {
  const bag = m.names.length
    ? 'Object.assign(__ex, { ' + m.names.map(([e, l]) => (m.id === VENDOR && e === 'WebGLRenderer'
        // headless-test seam: tools/check-offline.mjs swaps the GL renderer out
        ? `${JSON.stringify(e)}: globalThis.__swindleRendererStub || ${l}`
        : `${JSON.stringify(e)}: ${l}`)).join(', ') + ' });'
    : '';
  // a literal "</script>" anywhere in the payload would close the tag early
  const body = m.body.replace(/<\/script/gi, '<\\/script');
  parts.push(`__def(${JSON.stringify(m.id)}, (__ex) => {\n${body}\n${bag}\n});`);
}
parts.push(`__req(${JSON.stringify(ENTRY)});`);
const bundle = parts.join('\n');

// ── the shell: same markup, self-contained ───────────────────────────────────
let html = read('swindle/index.html');
const css = read('swindle/style.css');

html = html.replace(/[ \t]*<script type="importmap">[\s\S]*?<\/script>\n/, '');
html = html.replace(/[ \t]*<link rel="manifest"[^>]*>\n/, '');
html = html.replace(/[ \t]*<link rel="apple-touch-icon"[^>]*>\n/, '');
html = html.replace(/[ \t]*<link rel="icon" href="icons\/[^"]*"[^>]*>\n/, '');
html = html.replace('<link rel="stylesheet" href="style.css">', () => '<style>\n' + css + '\n</style>');
// fonts are the only thing that still needs a network: attach them lazily, online only
html = html.replace(/[ \t]*<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com">\n/, '');
html = html.replace(/[ \t]*<link rel="preconnect" href="https:\/\/fonts\.gstatic\.com" crossorigin>\n/, '');
html = html.replace(/[ \t]*<link href="https:\/\/fonts\.googleapis\.com[^>]*>\n/, () => `<script>
if (navigator.onLine !== false) {
  var __f = document.createElement('link');
  __f.rel = 'stylesheet';
  __f.href = 'https://fonts.googleapis.com/css2?family=Bungee&family=Outfit:wght@300;400;600;800&display=swap';
  document.head.appendChild(__f);
}
</script>`);
// NOTE: every replacement that injects file contents must be a *function* — the
// string form of String.replace re-interprets $`, $' and $& in the replacement.
html = html.replace(/[ \t]*<script type="module" src="js\/main\.js"><\/script>\n/,
  () => '<script>window.__swindleOffline = true;</script>\n<script type="module">\n' + bundle + '\n</script>');
// a service worker is pointless (and unregistered) for a file you double-clicked
html = html.replace(/[ \t]*<script>\nif \('serviceWorker'[\s\S]*?<\/script>\n/, '');
// the "save offline copy" button is pointless in a file you already have
html = html.replace('<button class="btn tiny" id="mOffline" hidden>', '<button class="btn tiny" id="mOffline" hidden data-offline-file="1">');
html = html.replace('<title>', '<title>📴 ' );
html = html.replace('</title>', ' (offline copy)</title>');

fs.writeFileSync(path.join(ROOT, OUT), html);

const bytes = Buffer.byteLength(html);
const threeBytes = Buffer.byteLength(read(VENDOR));
console.log(`✓ ${OUT} — ${(bytes / 1024 / 1024).toFixed(2)} MB  (${mods.size} modules inlined: three ${(threeBytes / 1024 / 1024).toFixed(2)} MB, game ${((bytes - threeBytes) / 1024).toFixed(0)} KB)`);
console.log('  open it straight from disk, or serve the folder — no server needed for solo play.');
