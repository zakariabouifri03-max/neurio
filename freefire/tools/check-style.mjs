// Cross-checks the stylesheet against the classes the app actually uses.
// A missing rule (e.g. .hidden) silently breaks the whole UI, and nothing else
// in the toolchain would catch it.
//   node tools/check-style.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const html = read('index.html');
const css = read('src/style.css');
const js = ['main.js', 'hud.js', 'view.js', 'audio.js', 'sim.js', 'world.js']
  .map((f) => read('src/' + f)).join('\n');

// ── balance check on the stylesheet ─────────────────────────────────────────
let depth = 0, line = 1;
for (const ch of css) {
  if (ch === '\n') line++;
  else if (ch === '{') depth++;
  else if (ch === '}') { depth--; if (depth < 0) { console.log(`❌ extra } at line ${line}`); process.exit(1); } }
}
if (depth !== 0) { console.log(`❌ ${depth} unclosed block(s) in style.css`); process.exit(1); }

// ── classes referenced by the app ───────────────────────────────────────────
const used = new Set();
const add = (s) => String(s || '').split(/\s+/).filter(Boolean).forEach((c) => used.add(c));
for (const m of html.matchAll(/class\s*=\s*["']([^"']+)["']/g)) add(m[1]);
for (const m of js.matchAll(/class(?:List)?\.(?:add|remove|toggle)\(\s*['"]([^'"]+)['"]/g)) add(m[1]);
for (const m of js.matchAll(/classList\.(?:add|remove|toggle)\(([^)]*)\)/g)) {
  for (const q of m[1].matchAll(/['"]([^'"]+)['"]/g)) add(q[1]);
}
for (const m of js.matchAll(/className\s*=\s*['"]([^'"]*)['"]/g)) add(m[1]);
for (const m of js.matchAll(/className\s*=\s*`([^`]*)`/g)) add(m[1].replace(/\$\{[^}]*\}/g, ' '));
for (const m of js.matchAll(/class="([^"]*)"/g)) add(m[1].replace(/\$\{[^}]*\}/g, ' '));

// dynamic class names built in template literals, e.g. `gear ${x ? 'on' : 'off'}`
for (const m of js.matchAll(/class\s*=\s*"[^"]*\$\{[^}]*\?\s*'([^']+)'\s*:\s*'([^']+)'[^}]*\}"/g)) { add(m[1]); add(m[2]); }
// class names assembled by concatenation, e.g. 'hm' + (head ? ' head' : '')
for (const m of js.matchAll(/className\s*=\s*'([^']+)'\s*\+/g)) add(m[1]);
for (const m of js.matchAll(/className\s*=\s*`([^`$]*)`/g)) add(m[1]);

// Styled through an id selector instead of the class, or generated (weapon rarity r1..r5).
const ALLOW = new Set(['hm', 'ON', 'OFF', 'r', 'r1', 'r2', 'r3', 'r4', 'r5']);

const reallyMissing = [...used].filter((c) => !ALLOW.has(c) && !new RegExp(`\\.${c.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')}(?![\\w-])`).test(css));

console.log(`classes referenced by the app: ${used.size}`);
if (reallyMissing.length) {
  console.log('\n⚠ no stylesheet rule for:');
  for (const c of reallyMissing.sort()) console.log('   .' + c);
}
if (!new RegExp('\\.hidden(?![\\w-])').test(css)) { console.log('❌ .hidden has no rule — every panel would stay visible'); process.exit(1); }
console.log(reallyMissing.length ? `\n(checked, ${reallyMissing.length} unstyled class(es))` : '\n✅ every referenced class has a rule');
