// Builds bash-baqi-racing.html — the whole game in ONE file (works from file://)
// Usage: npm install && npm run build:html
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { build } = require('esbuild');

const root = new URL('..', import.meta.url).pathname;

const res = await build({
  entryPoints: [root + 'src/main.js'],
  bundle: true,
  format: 'iife',
  minify: true,
  legalComments: 'none',
  logLevel: 'silent',
  alias: {
    'three': root + 'vendor/three.module.js',
    'three/addons/utils/BufferGeometryUtils.js': root + 'vendor/utils/BufferGeometryUtils.js',
  },
  write: false,
});
const js = res.outputFiles[0].text;
const css = readFileSync(root + 'src/style.css', 'utf8');
const iconB64 = readFileSync(root + 'icons/icon-192.png').toString('base64');

let html = readFileSync(root + 'index.html', 'utf8');

// inline CSS
html = html.replace('<link rel="stylesheet" href="src/style.css">', () => `<style>\n${css}\n</style>`);
// inline icon as data URI
html = html.replaceAll('icons/icon-192.png', () => `data:image/png;base64,${iconB64}`);
// drop manifest (needs http anyway) and importmap
html = html.replace(/<link rel="manifest"[^>]*>\n?/, '');
html = html.replace(/<script type="importmap">[\s\S]*?<\/script>/, '');
// replace module script with the bundle
html = html.replace('<script type="module" src="src/main.js"></script>',
  () => `<script>\n${js}\n</script>`);

writeFileSync(root + 'bash-baqi-racing.html', html);
console.log('bash-baqi-racing.html written:', (html.length / 1024 / 1024).toFixed(2), 'MB');
