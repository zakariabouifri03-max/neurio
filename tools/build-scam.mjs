/* ============================================================================
 * tools/build-scam.mjs — builds scam-baqi-offline.html
 *
 * يجمّع اللعبة كاملة ف ملف واحد HTML (بلا أي طلب خارجي) — كتحلّو بالدوبل كليك
 * و كتلعب من file:// بلا سيرفر و بلا إنترنت.
 * Zero dependencies: it just concatenates the same files index.html loads.
 * ==========================================================================*/
import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
const scam = root + 'scam/';

const read = (p) => readFileSync(scam + p, 'utf8');

const JS_ORDER = [
  'vendor/three.global.js',
  'src/util.js',
  'src/audio.js',
  'src/data.js',
  'src/callers.js',
  'src/ui.js',
  'src/desktop.js',
  'src/calls.js',
  'src/world.js',
  'src/player.js',
  'src/day.js',
  'src/main.js'
];

let html = read('index.html');
const css = read('style.css');
const iconB64 = readFileSync(scam + 'icons/icon-192.png').toString('base64');

// inline stylesheet
html = html.replace('<link rel="stylesheet" href="style.css">', () => '<style>\n' + css + '\n</style>');
// inline icons
html = html.replaceAll('icons/icon-192.png', () => 'data:image/png;base64,' + iconB64);
// drop PWA bits (they need http(s))
html = html.replace(/<link rel="manifest"[^>]*>\n?/, '');
html = html.replace(/<!-- pwa:start -->[\s\S]*?<!-- pwa:end -->\n?/, '');
// inline every script, in order
for (const f of JS_ORDER) {
  const code = read(f);
  html = html.replace('<script src="' + f + '"></script>', () => '<script>\n' + code + '\n</script>');
}
// the game registers the service worker from main? (it does not — only index.html would)

const leftovers = html.match(/<script src="[^"]+"><\/script>/g);
if (leftovers) {
  console.error('Ungrouped scripts left:', leftovers);
  process.exit(1);
}

const out = root + 'scam-baqi-offline.html';
writeFileSync(out, html);
console.log('scam-baqi-offline.html written:', (html.length / 1024 / 1024).toFixed(2), 'MB');
