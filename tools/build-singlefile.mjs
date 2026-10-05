// Bundle the fully offline game into one HTML file for the Android WebView wrapper.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const result = await build({
  entryPoints: [resolve(root, 'src/main.js')],
  bundle: true,
  format: 'iife',
  target: ['es2020'],
  minify: true,
  legalComments: 'none',
  logLevel: 'info',
  alias: { three: resolve(root, 'vendor/three.module.js') },
  write: false,
});
const js = result.outputFiles[0].text;
const css = readFileSync(resolve(root, 'src/style.css'), 'utf8');
const icon = readFileSync(resolve(root, 'icons/icon-192.png')).toString('base64');
let html = readFileSync(resolve(root, 'index.html'), 'utf8');
html = html.replace('<link rel="stylesheet" href="src/style.css">', `<style>\n${css}\n</style>`);
html = html.replaceAll('icons/icon-192.png', `data:image/png;base64,${icon}`);
html = html.replace(/<link rel="manifest"[^>]*>\s*/i, '');
html = html.replace(/<script type="importmap">[\s\S]*?<\/script>/i, '');
html = html.replace('<script type="module" src="src/main.js"></script>', `<script>\n${js}\n</script>`);
const out = resolve(root, 'neurio-blocks.html');
writeFileSync(out, html);
console.log(`Wrote ${out} (${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MiB, one offline file).`);
