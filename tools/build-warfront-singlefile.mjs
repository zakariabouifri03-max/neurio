// Builds warfront.html into ONE self-contained file (works from file:// / any host).
//   node tools/build-warfront-singlefile.mjs
import { readFileSync, writeFileSync } from 'node:fs';
// esbuild is a dev-only dependency; find it wherever it lives
async function loadEsbuild() {
  for (const spec of ['esbuild', '/tmp/esb/node_modules/esbuild/lib/main.js', './node_modules/esbuild/lib/main.js']) {
    try { const m = await import(spec); return m.build ? m : (m.default || m); } catch (e) { }
  }
  console.error('esbuild not found — run:  npm i -D esbuild');
  process.exit(1);
}
const { build } = await loadEsbuild();

const root = new URL('..', import.meta.url).pathname;

const res = await build({
  entryPoints: [root + 'src/fps/main.js'],
  bundle: true,
  format: 'iife',
  minify: true,
  legalComments: 'none',
  logLevel: 'silent',
  alias: {
    'three': root + 'vendor/three.module.js',
    'three/addons/utils/BufferGeometryUtils.js': root + 'vendor/utils/BufferGeometryUtils.js',
  },
  define: { 'window.__SINGLEFILE__': 'true' },
  write: false,
});
const js = res.outputFiles[0].text;
const css = readFileSync(root + 'src/fps/fps.css', 'utf8');

let html = readFileSync(root + 'warfront.html', 'utf8');
html = html.replace('<link rel="stylesheet" href="src/fps/fps.css">', () => `<style>\n${css}\n</style>`);
html = html.replace(/<script type="importmap">[\s\S]*?<\/script>\n?/, '');
html = html.replace('<script type="module" src="src/fps/main.js"></script>', () => `<script>\n${js}\n</script>`);

writeFileSync(root + 'warfront-singlefile.html', html);
console.log('warfront-singlefile.html written:', (html.length / 1024 / 1024).toFixed(2), 'MB');
