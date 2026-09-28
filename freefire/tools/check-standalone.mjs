// ── guards the single-file build (BOOYAH-FIRE.html) ─────────────────────────
// The point of that file is that it works from a USB stick: opened as file://,
// with no server, no network and no sibling files. These checks fail the moment
// it grows a reference to anything else — or goes stale against src/.
//
//   node tools/check-standalone.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'parse5';
import { inlineGameHtml, assertSelfContained } from './build-apk.mjs';
import { BANNER } from './build-standalone.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const FILE = path.join(root, 'BOOYAH-FIRE.html');

let fails = 0;
const fail = (m) => { fails++; console.log('  ✗ ' + m); };
const step = (m) => console.log('  ✓ ' + m);
const check = (ok, m) => (ok ? step(m) : fail(m));

console.log('\nstandalone build (BOOYAH-FIRE.html)');

if (!fs.existsSync(FILE)) {
  fail('BOOYAH-FIRE.html is missing — run `npm run build:html`');
  process.exit(1);
}
const html = fs.readFileSync(FILE, 'utf8');
const kb = (html.length / 1024).toFixed(0);

// ── it is self-contained ────────────────────────────────────────────────────
check(html.length > 1_500_000, `whole game in one file (${kb} kB)`);
const refs = [...html.matchAll(/(?:src|href)\s*=\s*"([^"]*)"/g)].map((m) => m[1]);
const external = refs.filter((r) => !r.startsWith('data:') && !r.startsWith('#'));
check(external.length === 0, `no reference to another file (${refs.length} inline ref, ${refs.length - external.length} local)`);
check(!html.includes('importmap'), 'no import map (file:// cannot load one)');
check(!/<script[^>]+src=/.test(html), 'no external <script src>');
check(!/<link[^>]+stylesheet/.test(html), 'no external stylesheet');
check(!html.includes('manifest.webmanifest'), 'no manifest link (it would 404 on file://)');
check(/location\.protocol\.startsWith\(["']http["']\)/.test(html), 'the service worker is still skipped off http(s) (it is never registered from file://)');

// ── and still the real app ──────────────────────────────────────────────────
const doc = parse(html);
const collect = (node, out = []) => {
  out.push(node);
  for (const child of node.childNodes || []) collect(child, out);
  if (node.content) collect(node.content, out);
  return out;
};
const nodes = collect(doc);
const scripts = nodes.filter((n) => n.tagName === 'script');
check(scripts.length === 1 && scripts[0].childNodes.length === 1,
  `exactly one inline <script> carrying the game (${(scripts[0].childNodes[0].value.length / 1024).toFixed(0)} kB)`);
const ids = new Set(nodes.filter((n) => n.attrs?.some((a) => a.name === 'id')).map((n) => n.attrs.find((a) => a.name === 'id').value));
for (const id of ['app', 'loading', 'errLog']) check(ids.has(id), `markup kept: #${id}`);
check(nodes.length > 400, `${nodes.length} parsed nodes (index.html has ~439)`);
try {
  // a classic script, not a module: `new Function` rejects import/export syntax,
  // which is exactly what would break when the file is opened over file://
  new Function(scripts[0].childNodes[0].value);
  step('the inline script compiles as a classic script (no module syntax)');
} catch (e) {
  fail(`the inline script is not a runnable classic script: ${e.message}`);
}
check(html.includes('BOOYAH FIRE') && html.includes('BOOYAH<br>FIRE'), 'branding intact');
check(html.includes('BOOYAH FIRE — single-file build'), 'carries the "open me by double-clicking" banner');

// ── its markup is the same app as index.html ────────────────────────────────
{
  const indexNodes = collect(parse(fs.readFileSync(path.join(root, 'index.html'), 'utf8')));
  const idsOf = (list) => list.filter((n) => n.attrs?.some((a) => a.name === 'id'))
    .map((n) => n.attrs.find((a) => a.name === 'id').value).sort();
  const a = idsOf(indexNodes), b = idsOf(nodes);
  check(a.length === b.length && a.every((id, i) => id === b[i]),
    `same ${b.length} element ids as index.html${a.length === b.length ? '' : ` (${a.length} there, ${b.length} here)`}`);
  // the head differs on purpose (stylesheet → <style>, links dropped), so compare
  // the body: everything the game actually renders has to be identical
  const bodyTags = (list) => {
    const body = list.find((n) => n.tagName === 'body');
    return collect(body).filter((n) => n.tagName).map((n) => n.tagName).join(',');
  };
  const there = bodyTags(indexNodes), hereTags = bodyTags(nodes);
  check(there === hereTags && there.length > 100,
    `identical <body> element tree (${hereTags.split(',').length} elements)`);
  if (there !== hereTags) {
    console.log('    index.html :', there.slice(0, 200));
    console.log('    standalone :', hereTags.slice(0, 200));
  }
}

// ── it matches what src/ builds today ───────────────────────────────────────
const fresh = inlineGameHtml({ banner: BANNER });
const freshExternal = assertSelfContained(fresh);
check(fresh === html, `up to date with src/ (${freshExternal} inline refs, rebuilt just now)`);
if (fresh !== html) {
  const at = [...html].findIndex((c, i) => c !== fresh[i]);
  fail(`committed file differs from a fresh build at byte ${at} — run \`npm run build:html\``);
}

console.log(fails ? `\n${fails} check(s) failed\n` : '\nstandalone file is good to hand out\n');
process.exit(fails ? 1 : 0);
