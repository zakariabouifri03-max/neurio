// Builds streamer/streamer-life-2.html — the whole Streamer Life 2 game in ONE file
import { readFileSync, writeFileSync } from 'node:fs';
import { build } from '/tmp/gb/node_modules/esbuild/lib/main.js';

const root = new URL('..', import.meta.url).pathname;
const minify = !process.argv.includes('--dev');

const res = await build({
  entryPoints: [root + 'streamer/src/main.js'],
  bundle: true,
  format: 'iife',
  minify,
  legalComments: 'none',
  logLevel: 'warning',
  alias: {
    'three': root + 'vendor/three.module.js',
    'three/addons/utils/BufferGeometryUtils.js': root + 'vendor/utils/BufferGeometryUtils.js',
  },
  write: false,
});
const js = res.outputFiles[0].text;
const css = readFileSync(root + 'streamer/src/style.css', 'utf8');
const iconB64 = readFileSync(root + 'streamer/icons/icon-192.png').toString('base64');

let html = readFileSync(root + 'streamer/index.html', 'utf8');
html = html.replace('<link rel="stylesheet" href="src/style.css">', () => `<style>\n${css}\n</style>`);
html = html.replaceAll('icons/icon-192.png', () => `data:image/png;base64,${iconB64}`);
html = html.replace(/<link rel="manifest"[^>]*>\n?/, '');
html = html.replace(/<script type="importmap">[\s\S]*?<\/script>/, '');
html = html.replace('<script type="module" src="src/main.js"></script>', () => `<script>\n${js}\n</script>`);

writeFileSync(root + 'streamer/streamer-life-2.html', html);
console.log('streamer-life-2.html written:', (html.length / 1024 / 1024).toFixed(2), 'MB');
