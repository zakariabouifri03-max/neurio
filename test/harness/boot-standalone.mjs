// Boot-check the LASTCALL standalone build itself:
// extracts the inline module from the HTML and runs it in Node
// with the chassis /webgl shims. Drives the first chapter.
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '../..');
const THREE_STANDALONE = process.env.THREE_STANDALONE === '1';

// 1) find the game script inside the html
const html = fs.readFileSync(path.join(ROOT, 'LASTCALL-standalone.html'), 'utf8');
const m = html.match(/<script type="module">\n([\s\S]*?)\n<\/script>/);
if (!m) { console.error('standalone html: inline module not found'); process.exit(1); }
let js = m[1];

// 2) in Node, three.js WebGLRenderer is stubbed out
const shimMarker = 'class WebGLRenderer';
js = js.replace(/class WebGLRenderer \{[\s\S]*?\n  \}/, (block) => block.replace('constructor', 'constructor_DISABLED')); // keep the real class name but break nothing? no — replace import target instead.
const shimDir = path.join(ROOT, 'test/harness');
const shimPath = path.join(shimDir, 'three-shim.mjs');
if (!fs.existsSync(shimPath)) { console.error('three-shim.mjs missing'); process.exit(1); }

// rewrite: bundle contains no bare imports; three is inlined. We *must* patch
// the WebGLRenderer class definition in the bundled three module.
// Its constructor matches: constructor(parameters = {}) { const _canvas = parameters.canvas !== undefined ? parameters.canvas : ...
const glPat = /class WebGLRenderer \{\n\tconstructor\(parameters = \{\}\) \{/;
if (!glPat.test(js)) {
  // fallback: try looser pattern
  const loose = js.match(/class WebGLRenderer \{/);
  if (loose) console.error('WARNING: WebGLRenderer constructor pattern loose-matched at', loose.index);
}
// Replace whole class body: find 'var WebGLRenderer = class {' .. matching brace via depth scan
const start = js.indexOf('var WebGLRenderer = class {');
let i = start, depth = 0, end = -1;
for (; i < js.length; i++) {
  if (js[i] === '{') depth++;
  else if (js[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
}
const stub = `class WebGLRenderer {
    constructor({ canvas } = {}) {
      this.domElement = canvas || { addEventListener() {} };
      this.shadowMap = {};
      this.outputColorSpace = '';
      this._loop = null;
      this.capabilities = { getMaxAnisotropy: () => 4 };
      this.size = { x: 1280, y: 720 };
    }
    setPixelRatio() {}
    setSize(w, h) { this.size.x = w; this.size.y = h; }
    getSize(v) { return v ? v.set(this.size.x, this.size.y) : { set() {} }; }
    setAnimationLoop(cb) { this._loop = cb; }
    setRenderTarget() {}
    render() {}
    dispose() {}
    getContext() { return null; }
  }`;
js = js.slice(0, start) + stub + js.slice(end);

// 3) run it
await import('./dom-stub.mjs');
fs.writeFileSync(path.join(shimDir, '.last-standalone-extract.mjs'), js);
await import(url.pathToFileURL(path.join(shimDir, '.last-standalone-extract.mjs')).href);

const G = window.G;
if (!G || G.state !== 'menu') { console.error('standalone boot FAIL'); process.exit(1); }
console.log('✔ standalone boots to menu');

G.ui.chapterCard = (t, ti, cb) => { cb && cb(); };
G.ui.fade = () => {};
G.audio.ensure();
G.newGame();
const pump = (s) => { for (let k = 0; k < s; k++) G.story.update(0.1); };
pump(90);
G.story.hook('bossNoteHome'); G.story.hook('coffee'); G.story.hook('catbowl'); G.story.hook('homeKeys'); G.story.hook('jacket');
G.story.homeTasksTick();
if (!G.story.flags.homeDone) { console.error('standalone: home chapter sim FAIL'); process.exit(1); }
console.log('✔ standalone home chapter playable');
console.log('\nSTANDALONE (LASTCALL) BOOT + SIM: PASS');
process.exit(0);
