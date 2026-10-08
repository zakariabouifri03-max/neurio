// Builds SolaraBay.html — whole voxel open world in ONE file (works from file://)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { build } from '/tmp/esbuild/node_modules/esbuild/lib/main.js';

const root = new URL('..', import.meta.url).pathname;

const res = await build({
  entryPoints: [root + 'solara-bay/src/main.js'],
  bundle: true,
  format: 'iife',
  minify: true,
  legalComments: 'none',
  logLevel: 'silent',
  alias: {
    'three': root + 'vendor/three.module.js',
  },
  write: false,
});

let js = res.outputFiles[0].text;

// Read HTML
let html = readFileSync(root + 'solara-bay/index.html', 'utf8');
const iconB64 = readFileSync(root + 'icons/icon-192.png').toString('base64');

// Remove importmap, manifest, google fonts preconnect? Keep fonts as CDN (works offline? we keep)
html = html.replace(/<script type="importmap">[\s\S]*?<\/script>/, '');
html = html.replace(/<link rel="manifest"[^>]*>\n?/, '');
// Inline icon
html = html.replaceAll('../icons/icon-192.png', `data:image/png;base64,${iconB64}`);
html = html.replaceAll('icons/icon-192.png', `data:image/png;base64,${iconB64}`);

// Replace module script with bundle (remove src/main.js, inline)
html = html.replace('<script type="module" src="src/main.js"></script>', `<script>\n${js}\n</script>`);

// Also html inside solara-bay references ../vendor, we removed need

writeFileSync(root + 'SolaraBay.html', html);
console.log('SolaraBay.html written:', (html.length/1024/1024).toFixed(2), 'MB');

// Also copy to exe-named html for user convenience
writeFileSync(root + 'SolaraBay-PC.html', html);

// Create ZIP via node? We'll do via bash zip later
