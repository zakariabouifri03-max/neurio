/* ============================================================
   tools/check-ui.mjs — static consistency check between src/*.js
   and index.html. Catches the classic "undefined element" crash
   before it ever reaches a phone.
   ============================================================ */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const html = readFileSync(join(root, 'index.html'), 'utf8');
const css = readFileSync(join(root, 'src/style.css'), 'utf8');
const jsFiles = readdirSync(join(root, 'src')).filter((f) => f.endsWith('.js'));

const htmlIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
const htmlClasses = new Set([...html.matchAll(/\sclass="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/)));

let fails = 0;
const bad = (msg) => { console.log('  ❌ ' + msg); fails++; };
const ok = (msg) => console.log('  ✅ ' + msg);

// 1. every $('x') / getElementById('x') must exist in the HTML
const refs = new Map();
for (const f of jsFiles) {
  const src = readFileSync(join(root, 'src', f), 'utf8');
  for (const m of src.matchAll(/\$\(\s*'([^']+)'\s*\)/g)) {
    if (!refs.has(m[1])) refs.set(m[1], f);
  }
  for (const m of src.matchAll(/getElementById\(\s*'([^']+)'\s*\)/g)) {
    if (!refs.has(m[1])) refs.set(m[1], f);
  }
}
const missing = [...refs.keys()].filter((id) => !htmlIds.has(id));
console.log(`\n[1] element ids referenced from JS: ${refs.size}`);
if (missing.length) missing.forEach((id) => bad(`#${id} used in ${refs.get(id)} but missing in index.html`));
else ok('all referenced ids exist in index.html');

// 2. ids defined in HTML but never used (dead markup, informative only)
const unused = [...htmlIds].filter((id) => !refs.has(id));
console.log(`\n[2] ids in HTML never referenced: ${unused.length ? unused.join(', ') : 'none'}`);

// 3. every data-go / go('x') target must resolve to #sc-<x>
const goTargets = new Set();
for (const f of jsFiles) {
  const src = readFileSync(join(root, 'src', f), 'utf8');
  for (const m of src.matchAll(/go\(\s*'([a-z]+)'\s*\)/g)) goTargets.add(m[1]);
}
for (const m of html.matchAll(/data-go="([^"]+)"/g)) goTargets.add(m[1]);
console.log(`\n[3] navigation targets: ${[...goTargets].join(', ')}`);
for (const t of goTargets) {
  if (!htmlIds.has('sc-' + t)) bad(`screen 'sc-${t}' missing for navigation target '${t}'`);
}
if ([...goTargets].every((t) => htmlIds.has('sc-' + t))) ok('every navigation target has a screen');

// 4. screens in HTML that nothing can reach
const screens = [...htmlIds].filter((i) => i.startsWith('sc-')).map((i) => i.slice(3));
// menus are built in JS with `dataset.go = <literal>`, so a screen is
// reachable when its name appears as a quoted literal in the menu builder
const uiSrc = readFileSync(join(root, 'src', 'ui.js'), 'utf8');
const orphan = screens.filter((s) => !goTargets.has(s) && !new RegExp(`'${s}'`).test(uiSrc));
console.log(`\n[4] screens: ${screens.join(', ')}`);
if (orphan.length) bad(`unreachable screen(s): ${orphan.join(', ')}`);
else ok('all screens reachable (statically or via the JS-built menu)');

// 5. classes used in JS must be styled or at least defined
const jsClasses = new Set();
for (const f of jsFiles) {
  const src = readFileSync(join(root, 'src', f), 'utf8');
  const junk = (c) => !c || /[${}:,=?'"`<>]/.test(c);
  for (const m of src.matchAll(/class(?:Name)?\s*=\s*'([^']+)'/g)) m[1].split(/\s+/).forEach((c) => !junk(c) && jsClasses.add(c));
  for (const m of src.matchAll(/el\(\s*'[a-z]+'\s*,\s*'([^']+)'/g)) m[1].split(/\s+/).forEach((c) => !junk(c) && jsClasses.add(c));
  for (const m of src.matchAll(/class="([^"]+)"/g)) m[1].split(/\s+/).forEach((c) => !junk(c) && jsClasses.add(c));
}
const unstyled = [...jsClasses].filter((c) => !css.includes('.' + c) && !htmlClasses.has(c));
console.log(`\n[5] classes created in JS: ${jsClasses.size}`);
if (unstyled.length) console.log('  ⚠️  no CSS rule for: ' + unstyled.join(', '));
else ok('every JS-created class has CSS');

// 6. CSS ids referenced must exist
// skip hex colours (#fff, #ffcc4d…) which are not id selectors
const cssIds = new Set([...css.matchAll(/#([a-zA-Z][\w-]*)/g)].map((m) => m[1])
  .filter((i) => !/^[0-9a-fA-F]{3,8}$/.test(i)));
const ghostIds = [...cssIds].filter((i) => !htmlIds.has(i));
console.log(`\n[6] css id selectors: ${cssIds.size}`);
if (ghostIds.length) bad(`CSS targets missing element(s): ${ghostIds.join(', ')}`);
else ok('every CSS #id exists');

// 7. assets referenced from index.html must exist on disk
console.log('\n[7] assets referenced from index.html');
for (const m of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
  const u = m[1];
  if (/^(https?:|data:|#)/.test(u)) continue;
  try {
    readFileSync(join(root, u));
  } catch { bad(`missing asset: ${u}`); }
}
ok('asset paths resolved');

console.log(fails === 0 ? '\n✅ UI CONSISTENCY OK' : `\n❌ ${fails} PROBLEM(S)`);
process.exit(fails ? 1 : 0);
