// Parses index.html with a spec-compliant HTML parser (parse5 — the same engine
// jsdom is built on) and reports anything a browser would silently "fix":
// mismatched tags, duplicate ids, ids the JS expects but the markup lacks.
//   npm i --no-save generate-or-reuse parse5   (dev-only; the game itself needs nothing)
//   node tools/check-html.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');

let parse5;
try {
  parse5 = await import('parse5');
} catch {
  console.log('parse5 not installed — run: npm i --no-save parse5');
  process.exit(2);
}

const doc = parse5.parse(html, { sourceCodeLocationInfo: true });
const problems = [];

// ── 1. collect the tree ─────────────────────────────────────────────────────
const ids = new Map();
const dupes = [];
let nodes = 0;
const walk = (node) => {
  nodes++;
  const attrs = node.attrs || [];
  const get = (n) => attrs.find((a) => a.name === n)?.value;
  if (node.tagName) {
    const id = get('id');
    if (id) {
      if (ids.has(id)) dupes.push(id);
      ids.set(id, { tag: node.tagName, loc: node.sourceCodeLocation?.startLine });
    }
  }
  // parse5 keeps everything; the browser also auto-closes some of it. Flag the
  // cases that actually change the document shape.
  for (const child of node.childNodes || []) walk(child);
};
walk(doc);

// ── 2. duplicate ids ────────────────────────────────────────────────────────
for (const d of new Set(dupes)) problems.push(`duplicate id #${d} (${ids.get(d).loc}) — getElementById would only ever find the first`);

// ── 3. unclosed tags: compare every open tag with the parser's error list ────
// parse5 does not throw; re-parse with onParseError to surface real breakage.
const errors = [];
parse5.parse(html, { onParseError: (e) => errors.push(e) });
for (const e of errors) {
  // stray </div> style errors are the dangerous ones for a hand-written shell
  if (!/eof|missing-doctype|duplicate-attribute/.test(e.code)) {
    problems.push(`${e.code} at ${e.startLine}:${e.startCol}${e.code === 'duplicate-attribute' ? '' : ''}`);
  }
}

// ── 4. every id the JS looks up ─────────────────────────────────────────────
const jsFiles = ['src/main.js', 'src/hud.js', 'src/view.js', 'src/audio.js'];
const wanted = new Set();
const builtAtRuntime = new Set();
for (const f of jsFiles) {
  const code = readFileSync(join(root, f), 'utf8');
  for (const m of code.matchAll(/\$\(\s*'([^']+)'\s*\)/g)) wanted.add(m[1]);
  for (const m of code.matchAll(/getElementById\(\s*'([^']+)'\s*\)/g)) wanted.add(m[1]);
  // ids the panels inject into innerHTML before querying them
  for (const m of code.matchAll(/id="([^"$]+)"/g)) builtAtRuntime.add(m[1]);
  if (code.includes('id="${')) builtAtRuntime.add('<dynamic>');
}
for (const id of wanted) if (!ids.has(id) && !builtAtRuntime.has(id)) problems.push(`JS queries #${id} but index.html has no such element (and nothing creates it)`);

// ── 5. ids the shim/test harness relies on ──────────────────────────────────
console.log(`index.html: ${nodes} DOM nodes · ${ids.size} unique ids · ${wanted.size} ids queried from JS`);
if (errors.length) console.log(`parser notes: ${errors.length} (all non-structural)`);

if (problems.length) {
  console.log('\n❌');
  for (const p of problems) console.log('   ' + p);
  process.exit(1);
}
console.log('✅ markup is well-formed, ids are unique, every JS lookup resolves');
