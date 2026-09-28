// Verifies every browser-facing asset reference resolves on disk.
//   node tools/check-assets.mjs
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const missing = [];
const seen = new Set();
let checked = 0;

// importmap from index.html so bare specifiers resolve like the browser does
const htmlSrc = readFileSync(join(root, 'index.html'), 'utf8');
const mapJson = htmlSrc.slice(htmlSrc.indexOf('type="importmap"'));
const IMPORTMAP = JSON.parse(mapJson.slice(mapJson.indexOf('{'), mapJson.indexOf('</script>')).trim());

// relative-looking refs without "./" (href="src/main.js") resolve against the file's own dir
function check(ref, fromFile, opts = {}) {
  if (!ref || /^(https?:|data:|#|mailto:|\/\/)/.test(ref)) return;
  if (!ref.startsWith('.') && opts.relative === 'html') ref = './' + ref.replace(/^\//, '');
  if (opts.bareSpecifier && !ref.startsWith('.')) {
    // bare specifier → importmap (exact match, then longest prefix)
    let target = IMPORTMAP.imports[ref];
    if (!target) {
      const keys = Object.keys(IMPORTMAP.imports).filter((k) => k.endsWith('/') && ref.startsWith(k)).sort((a, b) => b.length - a.length);
      if (keys.length) target = IMPORTMAP.imports[keys[0]] + ref.slice(keys[0].length);
    }
    if (!target) { missing.push(`${relative(root, fromFile)} → bare specifier "${ref}" not in the importmap`); return; }
    check(target, html, { relative: 'html' });   // importmap targets are document-relative
    return;
  }
  const clean = ref.split('#')[0].split('?')[0];
  if (!clean || clean === './') return;
  const abs = resolve(dirname(fromFile), clean);
  const key = abs + '|' + ref;
  if (seen.has(key)) return;
  seen.add(key);
  checked++;
  if (!existsSync(abs)) missing.push(`${relative(root, fromFile)} → ${ref}`);
}

// index.html: href/src attributes + the importmap + inline module imports
const html = join(root, 'index.html');
const src = readFileSync(html, 'utf8');
for (const m of src.matchAll(/(?:href|src)\s*=\s*["']([^"']+)["']/g)) check(m[1], html);
for (const m of src.matchAll(/"(\.\/[^"]+\.js)"/g)) check(m[1], html);

// every module under src/ and its relative imports
const files = [
  'src/main.js', 'src/sim.js', 'src/view.js', 'src/world.js', 'src/hud.js', 'src/post.js',
  'src/audio.js', 'src/data.js', 'src/tex.js', 'src/util.js',
];
for (const f of files) {
  const file = join(root, f);
  if (!existsSync(file)) { missing.push(`missing module ${f}`); continue; }
  const code = readFileSync(file, 'utf8');
  for (const m of code.matchAll(/from\s+['"]([^'"]+)['"]/g)) check(m[1], file, { bareSpecifier: true });
  for (const m of code.matchAll(/import\s*\(\s*['"]([^'"]+)['"]/g)) check(m[1], file, { bareSpecifier: true });
}

// the service-worker precache list
const swFile = join(root, 'sw.js');
const sw = readFileSync(swFile, 'utf8');
const list = sw.slice(sw.indexOf('const ASSETS'), sw.indexOf('];', sw.indexOf('const ASSETS')));
for (const m of list.matchAll(/'([^']+)'/g)) check(m[1], swFile, { relative: 'html' });

// css url(...) references
const css = readFileSync(join(root, 'src/style.css'), 'utf8');
for (const m of css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) check(m[1], join(root, 'src/style.css'));

const vendorFiles = ['vendor/three.module.js', 'vendor/utils/BufferGeometryUtils.js'];
for (const v of vendorFiles) if (!existsSync(join(root, v))) missing.push('missing vendored ' + v);

console.log(`checked ${checked} asset references across html/js/css/sw`);
if (missing.length) {
  console.log('\n❌ unresolved:');
  for (const m of missing) console.log('   ' + m);
  process.exit(1);
}
console.log('✅ every referenced asset exists');
