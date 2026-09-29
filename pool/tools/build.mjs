// ─────────────────────────────────────────────────────────────────────────────
//  tools/build.mjs — bundle the whole game into ONE standalone HTML file
//
//    node tools/build.mjs
//
//  Produces `neurio-pool.html` next to index.html: Three.js, the physics, the
//  rules, the AI, the hall, the audio and the UI all inlined, no import map, no
//  network needed. Open it from disk, host it anywhere, or drop it on a phone.
//
//  esbuild is looked up in this order:
//    1. $ESBUILD_BIN
//    2. ./node_modules/.bin/esbuild   (npm i -D esbuild)
//    3. npx -y esbuild
// ─────────────────────────────────────────────────────────────────────────────
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const OUT = join(ROOT, 'neurio-pool.html');

function esbuildBinary() {
  if (process.env.ESBUILD_BIN && existsSync(process.env.ESBUILD_BIN)) return [process.env.ESBUILD_BIN];
  const local = join(ROOT, 'node_modules', '.bin', 'esbuild');
  if (existsSync(local)) return [local];
  const repo = resolve(ROOT, '..', 'node_modules', '.bin', 'esbuild');
  if (existsSync(repo)) return [repo];
  return ['npx', '-y', 'esbuild'];
}

const tmp = mkdtempSync(join(tmpdir(), 'neurio-build-'));
const bundlePath = join(tmp, 'game.js');

const [bin, ...pre] = esbuildBinary();
const args = [
  ...pre,
  '--bundle', join(ROOT, 'src', 'main.js'),
  '--format=esm',
  '--target=es2020',
  '--minify',
  '--legal-comments=none',
  '--alias:three=' + resolve(ROOT, '..', 'vendor', 'three.module.js'),
  `--outfile=${bundlePath}`,
  '--log-level=warning',
];
console.log('[build] bundling with', bin);
execFileSync(bin, args, { stdio: 'inherit', cwd: ROOT });

let js = readFileSync(bundlePath, 'utf8');
// an inline <script> must never contain a literal closing tag
const before = (js.match(/<\/script/gi) || []).length;
js = js.replace(/<\/script/gi, '<\\/script');
if (before) console.log(`[build] escaped ${before} literal </script sequence(s) inside the bundle`);
rmSync(tmp, { recursive: true, force: true });

const css = readFileSync(join(ROOT, 'src', 'style.css'), 'utf8');
let html = readFileSync(join(ROOT, 'index.html'), 'utf8');

// Strip the pieces that only make sense for the multi-file version and inline
// the rest. NOTE: the replacements are functions — a minified bundle is full of
// `$&`/`$'` sequences that String.replace would otherwise expand into the
// matched text and silently corrupt the script.
const sub = (re, value) => {
  if (!re.test(html)) throw new Error('build template mismatch: ' + re);
  html = html.replace(re, () => value);
};
sub(/<link rel="manifest"[^>]*>\s*/i, '');
sub(/<link rel="apple-touch-icon"[^>]*>\s*/i, '');
sub(/<link rel="icon"[^>]*>\s*/i, '');
sub(/<link rel="stylesheet" href="src\/style\.css">\s*/i, `<style>\n${css}\n</style>\n`);
sub(/<script type="importmap">[\s\S]*?<\/script>\s*/i, '');
sub(/<script type="module" src="src\/main\.js"><\/script>\s*/i, `<script type="module">\n${js}\n</script>`);

writeFileSync(OUT, html);
const kb = (html.length / 1024).toFixed(0);
console.log(`[build] wrote ${OUT} — ${kb} KB, single file, no dependencies`);
