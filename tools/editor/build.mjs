// Montaj Pro — build: bundle + inline into a single portable HTML file
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const editor = path.join(root, 'editor');
const dist = path.join(editor, 'dist');
const tools = path.join(root, '.tools');

async function loadEsbuild() {
  const candidates = [
    process.env.ESBUILD_PATH,
    path.join(tools, 'node_modules/esbuild/lib/main.js'),
    path.join(editor, 'node_modules/esbuild/lib/main.js'),
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(c)) return (await import(pathToFileURL(c).href)).default || (await import(pathToFileURL(c).href));
  }
  return await import('esbuild');
}

const FONT_FACES = [
  { family: 'Cairo', weights: [400, 600, 700, 800], subsets: ['arabic', 'latin'] },
  { family: 'Tajawal', weights: [400, 700], subsets: ['arabic', 'latin'] },
  { family: 'Bebas Neue', weights: [400], subsets: ['latin'] },
];
const slug = (f) => f.toLowerCase().replace(/\s+/g, '-');
const RANGE = {
  arabic: 'U+0600-06FF,U+0750-077F,U+0870-088E,U+0891,U+0898-08E1,U+08E3-08FF,U+FB50-FDFF,U+FE70-FEFF,U+200C-200E,U+2010-2011,U+204F',
  latin: 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+2074,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215',
};

function fontRules(inline) {
  let css = '';
  for (const f of FONT_FACES) {
    for (const w of f.weights) {
      for (const sub of f.subsets) {
        const file = `${slug(f.family)}-${sub}-${w}-normal.woff2`;
        const fp = path.join(editor, 'fonts', file);
        if (!fs.existsSync(fp)) continue;
        const src = inline
          ? `data:font/woff2;base64,${fs.readFileSync(fp).toString('base64')}`
          : `fonts/${file}`;
        css += `@font-face{font-family:"${f.family}";font-style:normal;font-weight:${w};font-display:block;src:url("${src}") format("woff2");unicode-range:${RANGE[sub]}}\n`;
      }
    }
  }
  return css;
}

async function main() {
  const esbuild = await loadEsbuild();
  fs.mkdirSync(dist, { recursive: true });

  // 1. bundle (IIFE so it also works from file:// in the Android WebView)
  const res = await esbuild.build({
    entryPoints: [path.join(editor, 'src/main.js')],
    bundle: true,
    format: 'iife',
    // es2015, not es2020: a phone with an older Android System WebView must at
    // least be able to PARSE the bundle (optional chaining / nullish coalescing
    // are dropped, async is lowered) — a syntax error means a black screen.
    target: ['es2015'],
    outfile: path.join(editor, 'bundle.js'),
    legalComments: 'none',
    logLevel: 'info',
    minify: process.argv.includes('--minify'),
    charset: 'utf8',
  });
  console.log('bundle ok');

  // 2. css for the multi-file (PWA) version
  fs.writeFileSync(path.join(editor, 'fonts.css'), fontRules(false));

  // 3. single-file build
  const html = fs.readFileSync(path.join(editor, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(editor, 'ui.css'), 'utf8');
  const js = fs.readFileSync(path.join(editor, 'bundle.js'), 'utf8');
  const manifest = fs.existsSync(path.join(editor, 'manifest.webmanifest'))
    ? fs.readFileSync(path.join(editor, 'manifest.webmanifest'), 'utf8') : null;
  const sw = fs.existsSync(path.join(editor, 'sw.js')) ? fs.readFileSync(path.join(editor, 'sw.js'), 'utf8') : null;
  // keep the inlined icons small: the 512px PNG is ~350 KB of base64 and browsers
  // only need 16-48px for a tab icon (180px for the iOS home-screen icon)
  const dataUri = (rel) => {
    const fp = path.join(editor, rel);
    return fs.existsSync(fp) ? 'data:image/png;base64,' + fs.readFileSync(fp).toString('base64') : '';
  };
  const icon = dataUri('icons/favicon.png') || dataUri('icons/icon-192.png');
  const iconApple = dataUri('icons/icon-180.png') || dataUri('icons/icon-192.png');

  let single = html
    .replace('<link rel="stylesheet" href="ui.css">', `<style>\n${css}\n${fontRules(true)}\n</style>`)
    .replace('<!--FONTS-->', '')
    .replace('<script src="bundle.js"></script>', `<script>\n${js}\n</script>`)
    .replace('<link rel="manifest" href="manifest.webmanifest">', manifest ? `<script type="application/json" id="pwa-manifest">${manifest}</script>` : '')
    .replace('<link rel="icon" href="icons/icon-192.png">', icon ? `<link rel="icon" href="${icon}">` : '')
    .replace('<link rel="apple-touch-icon" href="icons/icon-192.png">', iconApple ? `<link rel="apple-touch-icon" href="${iconApple}">` : '');
  fs.writeFileSync(path.join(dist, 'montaj-pro.html'), single);
  console.log('single-file:', (single.length / 1024).toFixed(0) + ' KB', '->', path.relative(root, path.join(dist, 'montaj-pro.html')));
}
main().catch((e) => { console.error(e); process.exit(1); });
