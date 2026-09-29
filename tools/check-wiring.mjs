// Static wiring check: every element id/selector the client touches must exist in
// index.html or be created by a JS template string; every class used must be styled.
//   node tools/check-wiring.mjs
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const html = read('swindle/index.html');
const css = read('swindle/style.css');
const jsDir = path.join(ROOT, 'swindle/js');
const jsFiles = fs.readdirSync(jsDir).filter((f) => f.endsWith('.js')).map((f) => ['swindle/js/' + f, read('swindle/js/' + f)]);
const allJs = jsFiles.map(([, s]) => s).join('\n');
const js = read('swindle/js/ui.js') + '\n' + read('swindle/js/main.js') + '\n' + read('swindle/js/util.js');

// ids that exist in the markup, or that some JS template creates
const htmlIds = new Set([...html.matchAll(/\bid="([\w-]+)"/g)].map((m) => m[1]));
const madeIds = new Set([...allJs.matchAll(/\bid="([\w-]+)"/g)].map((m) => m[1]));
for (const m of allJs.matchAll(/e\.id = ([\w.'+]+)/g)) { /* dynamic ids like m-'+i' — approximate */ }
const dynIds = [...allJs.matchAll(/\.id = '([\w-]+)'/g)].map((m) => m[1]);
const known = new Set([...htmlIds, ...madeIds, ...dynIds]);
// dynamic ids built by concatenation: m-<something>, cs-, opQ… collect prefixes
const prefixIds = [...allJs.matchAll(/\.id = [`']([\w-]+)[`']?[+]*/g)].map((m) => m[1]);

const wanted = new Set();
for (const m of js.matchAll(/\$\(\s*[`'"]#([\w-]+)[`'"]/g)) wanted.add(m[1]);
for (const m of js.matchAll(/getElementById\(\s*[`'"]([\w-]+)[`'"]/g)) wanted.add(m[1]);
for (const m of js.matchAll(/querySelector\(\s*[`'"]#([\w-]+)[`'"]/g)) wanted.add(m[1]);
for (const m of js.matchAll(/#\{|\$\{`/g)) void 0;
// ids built from template expressions e.g. `#m-${i}`
for (const m of js.matchAll(/[`'"]#([\w-]+)-\$\{/g)) known.add(m[1] + '-0');

const missingIds = [...wanted].filter((id) => !known.has(id));
console.log(`ids referenced: ${wanted.size} · missing: ${missingIds.length}` + (missingIds.length ? '\n   → ' + missingIds.join(', ') : ''));

// ── classes ──────────────────────────────────────────────────────────────────
const cssClasses = new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]));
const usedClasses = new Set();
const addCls = (s) => { for (const c of String(s).split(/[\s,]+/)) if (/^[a-zA-Z][\w-]*$/.test(c)) usedClasses.add(c); };
for (const m of html.matchAll(/\bclass="([^"{}$]*)"/g)) addCls(m[1]);
for (const m of js.matchAll(/class="([^"{}]*)"/g)) addCls(m[1]);
for (const m of js.matchAll(/el\(\s*'[a-z]+'\s*,\s*'([^']*)'/g)) addCls(m[1]);
for (const m of js.matchAll(/classList\.(?:add|remove|toggle)\(\s*'([^']+)'/g)) addCls(m[1]);
for (const m of js.matchAll(/class="([^"]*)\$\{/g)) addCls(m[1]);
for (const m of js.matchAll(/'([a-z][\w-]*)'\s*\?\s*'on'/g)) addCls(m[1]);
const styled = [...usedClasses].filter((c) => cssClasses.has(c));
const unstyled = [...usedClasses].filter((c) => !cssClasses.has(c) && c.length > 1);
console.log(`classes used: ${usedClasses.size} · styled: ${styled.length} · unstyled: ${unstyled.length}` + (unstyled.length ? '\n   → ' + unstyled.join(', ') : ''));
const deadCss = [...cssClasses].filter((c) => !usedClasses.has(c) && !/^(is-|has-)/.test(c));
console.log(`css classes never referenced: ${deadCss.length}` + (deadCss.length ? '\n   → ' + deadCss.slice(0, 40).join(', ') : ''));

// ── three module surface used by the client must exist in the vendored build ───
const three = read('vendor/three.module.js');
const usedThree = new Set();
for (const m of allJs.matchAll(/THREE\.([A-Z][A-Za-z0-9]*)/g)) usedThree.add(m[1]);
for (const m of allJs.matchAll(/import \{([^}]*)\} from 'three'/g)) for (const n of m[1].split(',')) usedThree.add(n.trim());
const absent = [...usedThree].filter((n) => n && !new RegExp(`(class|const|function|let) +${n}\\b`).test(three) && !new RegExp(`^\\s*${n},?$`, 'm').test(three) && !three.includes(`${n}:`) && !three.includes(` ${n} as `));
console.log(`three symbols used: ${usedThree.size} · unresolved in vendor build: ${absent.length}` + (absent.length ? '\n   → ' + absent.join(', ') : ''));

// ── import/export cross-check between client modules ──────────────────────────
const bad = [];
for (const [file, src] of jsFiles) {
  for (const m of src.matchAll(/import\s+\{([^}]+)\}\s+from\s+'(\.[^']+)'/g)) {
    const target = path.resolve(path.dirname(path.join(ROOT, file)), m[2]);
    let tsrc; try { tsrc = fs.readFileSync(target.endsWith('.js') ? target : target + '.js', 'utf8'); } catch { bad.push(`${file}: cannot resolve ${m[2]}`); continue; }
    const exportsOf = new Set([...tsrc.matchAll(/export (?:async )?(?:class|function|const|let|var) ([\w$]+)/g)].map((x) => x[1]));
    for (const raw of m[1].split(',')) {
      const name = raw.trim().split(/\s+as\s+/)[0].trim();
      const star = [...tsrc.matchAll(/export \{([^}]*)\}/g)].map((x) => x[1]).join(',');
      if (name && !exportsOf.has(name) && !star.includes(name)) bad.push(`${file}: imports ${name} not exported by ${m[2]}`);
    }
  }
}
console.log(`cross-module imports: ${bad.length ? 'PROBLEMS\n   → ' + bad.join('\n   → ') : 'all resolve ✓'}`);

// ── audio + ui method coverage called from main.js ────────────────────────────
const audioSrc = read('swindle/js/audio.js');
const uiSrc = read('swindle/js/ui.js');
const miss = [];
const hasFn = (src, n) => new RegExp(n + '\\s*[(:=]').test(src) || src.includes(n + ':') || src.includes(n + '(');
for (const m of read('swindle/js/main.js').matchAll(/\baudio\.([a-zA-Z0-9_]+)\b/g)) { if (m[1] === 'js') continue; if (!hasFn(audioSrc, m[1])) miss.push('audio.' + m[1]); }
for (const m of (read('swindle/js/main.js') + '\n' + read('swindle/js/ui.js')).matchAll(/\bui\.([a-zA-Z0-9_]+)\s*\(/g)) if (!hasFn(uiSrc, m[1])) miss.push('ui.' + m[1] + '()');
for (const m of read('swindle/js/main.js').matchAll(/\broom\.([a-zA-Z0-9_]+)\s*\(/g)) if (!hasFn(read('swindle/js/room3d.js'), m[1])) miss.push('room.' + m[1] + '()');
console.log(`missing methods called: ${miss.length ? '\n   → ' + [...new Set(miss)].join('\n   → ') : 'none ✓'}`);

// ── stylesheet + markup hygiene ────────────────────────────────────────────────
const cssVars = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
const cssUsed = new Set([...css.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]));
const jsVars = new Set([...allJs.matchAll(/setProperty\('--([\w-]+)'/g)].map((m) => '--' + m[1]));
const undefVars = [...cssUsed].filter((v) => !cssVars.has(v) && !jsVars.has(v));
let depth = 0, under = 0;
for (const ch of css) { if (ch === '{') depth++; else if (ch === '}') { depth--; if (depth < 0) under++; } }
const extUrl = [...css.matchAll(/url\((['\"]?)(?:https?:)?\/\/[^)]*\)/g)].map((m) => m[0]);
const kf = new Set([...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]));
const animRef = new Set([...css.matchAll(/animation(?:-name)?:\s*([^;}\n]+)/g)].flatMap((m) => m[1].split(',').map((s2) => s2.trim().split(/\s+/)[0])));
const noKf = [...animRef].filter((a) => /^[a-zA-Z][\w-]*$/.test(a) && !kf.has(a) && a !== 'none');
const ids = [...html.matchAll(/\bid="([\w-]+)"/g)].map((m) => m[1]);
const dupes = [...new Set(ids.filter((x, i) => ids.indexOf(x) !== i))];
const VOID = ['br', 'img', 'input', 'meta', 'link', 'hr', 'source', 'path', 'use'];
const opens = [...html.matchAll(/<([a-z][a-z0-9]*)\b[^>]*?(\/?)>/g)].filter((m) => m[2] !== '/' && !VOID.includes(m[1]));
const closes = [...html.matchAll(/<\/([a-z][a-z0-9]*)>/g)].map((m) => m[1]);
const tally = {};
for (const m of opens) tally[m[1]] = (tally[m[1]] || 0) + 1;
for (const c of closes) tally[c] = (tally[c] || 0) - 1;
const unbal = Object.entries(tally).filter(([, n]) => n !== 0);
console.log(`css vars: ${cssUsed.size} used / ${cssVars.size} defined · undefined: ${undefVars.length ? undefVars.join(', ') : 'none ✓'}`);
console.log(`css braces ${depth === 0 && under === 0 ? 'balanced ✓' : 'UNBALANCED (' + depth + '/' + under + ')'} · external urls: ${extUrl.length || 'none ✓'} · keyframes missing: ${noKf.length ? noKf.join(', ') : 'none ✓'}`);
console.log(`markup: ${ids.length} ids · duplicates: ${dupes.length ? dupes.join(', ') : 'none ✓'} · tag balance: ${unbal.length ? JSON.stringify(Object.fromEntries(unbal)) : 'ok ✓'}`);

const problems = missingIds.length + unstyled.length + absent.length + bad.length + new Set(miss).size
  + undefVars.length + noKf.length + dupes.length + unbal.length + extUrl.length + (depth === 0 && under === 0 ? 0 : 1);
console.log('\n' + (problems ? problems + ' WIRING ISSUE(S) — review above' : 'WIRING OK'));
