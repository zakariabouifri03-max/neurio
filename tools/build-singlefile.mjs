// Optional portable export. The normal game needs no build step.
// `npm run bundle` -> dist/blockyard.html. Add --drift or --racing for the preserved games.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const legacy = process.argv.includes('--racing');
const drift = process.argv.includes('--drift');
const entry = legacy ? 'src/main.js' : drift ? 'src/raft/game.js' : 'src/blockyard/game.js';
const cssPath = legacy ? 'src/style.css' : drift ? 'src/raft/style.css' : 'src/blockyard/style.css';
const htmlPath = legacy ? 'racing.html' : drift ? 'drift.html' : 'blockyard.html';
const outputPath = legacy ? 'dist/bash-baqi-racing.html' : drift ? 'dist/drift.html' : 'dist/blockyard.html';
const result = await build({
  entryPoints: [resolve(root, entry)], bundle: true, format: 'iife', minify: true,
  legalComments: 'eof', logLevel: 'silent', write: false,
  alias: {
    three: resolve(root, 'vendor/three.module.js'),
    'three/addons/utils/BufferGeometryUtils.js': resolve(root, 'vendor/utils/BufferGeometryUtils.js'),
  },
});
const mime = { '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png' };
const dataUrl = path => `data:${mime[extname(path)] || 'application/octet-stream'};base64,${readFileSync(path).toString('base64')}`;
const css = readFileSync(resolve(root, cssPath), 'utf8').replace(/url\((?:"([^"]*)"|'([^']*)'|([^)]*))\)/g, (match, doubleQuoted, singleQuoted, unquoted) => {
  const asset = (doubleQuoted ?? singleQuoted ?? unquoted).trim();
  if (asset.startsWith('data:') || asset.startsWith('http') || asset.startsWith('#')) return match;
  return `url('${dataUrl(resolve(root, dirname(cssPath), asset))}')`;
});
let html = readFileSync(resolve(root, htmlPath), 'utf8');
html = html.replace('<html lang="en">', '<html lang="en" data-standalone="true">');
html = html.replace(/class="brand" href="(?:\.\/|drift\.html|blockyard\.html)"/, 'class="brand" href="#"');
if (!drift) html = html.replace(/<a[^>]*href="drift\.html"[^>]*>[\s\S]*?<\/a>/g, '');
html = html.replace(/<link rel="manifest"[^>]*>\s*/g, '');
html = html.replace(/<link rel="(?:preload|preconnect)"[^>]*>\s*/g, '');
html = html.replace(/<link[^>]*fonts\.googleapis\.com[^>]*>\s*/g, '');
html = html.replace(/<script type="importmap">[\s\S]*?<\/script>/, '');
html = html.replace(/<script>\s*if \('serviceWorker'[\s\S]*?<\/script>/, '');
html = html.replace(`<link rel="stylesheet" href="${cssPath}">`, () => `<style>\n${css}\n</style>`);
html = html.replace(/href="(icons\/[^\"]+)"/g, (match, icon) => `href="${dataUrl(resolve(root, icon))}"`);
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
html = html.replace(`<script type="module" src="${entry}"></script>`, () => `<script>\n${js}\n</script>`);
const licenses = ['vendor/LICENSE-three.txt', ...(legacy ? [] : ['assets/fonts/OFL-DM-Sans.txt', 'assets/fonts/OFL-Outfit.txt'])]
  .map(path => `${path}\n\n${readFileSync(resolve(root, path), 'utf8')}`).join('\n\n');
html = html.replace('</body>', () => `<script type="text/plain" id="third-party-licenses">\n${licenses}\n</script>\n</body>`);
mkdirSync(resolve(root, 'dist'), { recursive: true });
writeFileSync(resolve(root, outputPath), html);
console.log(`${outputPath} written: ${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MB. Open it directly in a browser.`);
