// Builds streamer/bundle.js (classic script, ES2017 — no import maps, no modules needed)
// and streamer-life.html — the whole Streamer Life Sim 2 game in ONE file (works from file://)
import { readFileSync, writeFileSync } from 'node:fs';
import { build } from '/tmp/gb/node_modules/esbuild/lib/main.js';

const root = new URL('..', import.meta.url).pathname;

const res = await build({
  entryPoints: [root + 'streamer/src/main.js'],
  bundle: true,
  format: 'iife',
  minify: true,
  target: ['es2017'],
  legalComments: 'none',
  logLevel: 'warning',
  write: false,
});
const js = res.outputFiles[0].text;
writeFileSync(root + 'streamer/bundle.js', js);

const css = readFileSync(root + 'streamer/style.css', 'utf8');
const iconB64 = readFileSync(root + 'streamer/icons/icon-192.png').toString('base64');

let html = readFileSync(root + 'streamer/index.html', 'utf8');

html = html.replace('<link rel="stylesheet" href="style.css">', () => `<style>\n${css}\n</style>`);
html = html.replaceAll('icons/icon-192.png', () => `data:image/png;base64,${iconB64}`);
html = html.replace(/<link rel="manifest"[^>]*>\n?/, '');
html = html.replace('<script src="bundle.js"></script>', () => `<script>\n${js}\n</script>`);

writeFileSync(root + 'streamer-life.html', html);
console.log('bundle.js + streamer-life.html written:', (html.length / 1024 / 1024).toFixed(2), 'MB');
