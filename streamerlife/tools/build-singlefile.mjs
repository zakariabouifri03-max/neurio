// Bundles the whole game into ONE html file (works from file:// and inside the APK)
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let build;
try { ({ build } = await import('esbuild')); }
catch { ({ build } = await import('/tmp/gb/node_modules/esbuild/lib/main.js')); }

const root = new URL('..', import.meta.url).pathname;

const res = await build({
  entryPoints: [root + 'src/main.js'],
  bundle: true, format: 'iife', minify: true, legalComments: 'none', logLevel: 'info',
  alias: { 'three': root + 'vendor/three.module.js' },
  write: false,
});
const js = res.outputFiles[0].text;
const css = readFileSync(root + 'src/style.css', 'utf8');
const icon = readFileSync(root + 'icons/icon-192.png').toString('base64');

let html = readFileSync(root + 'index.html', 'utf8');
html = html.replace('<link rel="stylesheet" href="src/style.css">', () => `<style>\n${css}\n</style>`);
html = html.replaceAll('icons/icon-192.png', () => `data:image/png;base64,${icon}`);
html = html.replace(/<link rel="manifest"[^>]*>\n?/, '');
html = html.replace(/<script type="importmap">[\s\S]*?<\/script>/, '');
html = html.replace('<script type="module" src="src/main.js"></script>', () => `<script>\n${js}\n</script>`);

writeFileSync(root + 'streamer-life.html', html);
console.log('streamer-life.html →', (html.length / 1024 / 1024).toFixed(2), 'MB');
