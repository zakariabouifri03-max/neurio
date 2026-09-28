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
G.ui.showEnding = (lines, cb) => { G.ui.__ending = { lines, cb }; };
G.audio.ensure();
G.newGame();
// pump BOTH story and world so flickers/doors/tv also tick (this catches
// runtime crashes that only happen when the world updates)
const pump = (s) => { for (let k = 0; k < s; k++) { G.story.update(0.1); G.world.update(0.1); } };
pump(90);
G.story.hook('bossNoteHome'); G.story.hook('coffee'); G.story.hook('catbowl'); G.story.hook('homeKeys'); G.story.hook('jacket');
G.story.homeTasksTick();
if (!G.story.flags.homeDone) { console.error('standalone: home chapter sim FAIL'); process.exit(1); }
// walk to the car and drive
G.world.triggers.find(t => t.id === 's_carhome').cb();
G.story.hook('carInteract');
pump(900); // run the world through the drive + arrival beats
if (G.story.chapter < 2) { console.error('standalone: did not reach diner chapter, at ' + G.story.chapter); process.exit(1); }
console.log('✔ standalone home chapter playable');
console.log('✔ standalone world pumps clean through drive + arrival (ch' + G.story.chapter + ')');

// ---- full journey: opening tasks -> customers -> freezer -> blackout -> chase -> ending
const hook = (...a) => G.story.hook(...a);
hook('bossNoteDiner'); hook('breaker', 'SIGN'); hook('crate'); hook('crate'); hook('crate'); hook('grill');
G.player.giveItem('cashkeys', {}); hook('registerOpen'); hook('trashcan'); hook('dumpster');
if (!G.story.flags.everythingDone) { console.error('standalone: shift tasks FAIL'); process.exit(1); }
pump(200); // 20 sim-seconds: customers card
if (G.story.chapter !== 3) { console.error('standalone: never reached customers, ch' + G.story.chapter); process.exit(1); }
pump(5400); // ~540 sim-seconds: tarek -> hedi -> stranger -> jukebox -> leaves
if (G.story.chapter !== 4) { console.error('standalone: never hit freezer chapter, ch' + G.story.chapter); process.exit(1); }
console.log('✔ standalone customers chapter played (npcs walk, jukebox scare fired =', !!G.story.flags.jukePlayed + ')');
G.world.triggers.find(t => t.id === 's_freezer_in').cb();
pump(300); // ~30 s: slam -> handle tries -> escape -> blackout
if (!G.story.flags.blackout) { console.error('standalone: blackout never fired'); process.exit(1); }
console.log('✔ standalone freezer trap + blackout, stalker mode =', G.stalker.mode);
G.player.giveItem('fuse', {}); hook('fuseSlot'); hook('breaker', 'MAIN');
pump(80); // ~8 s: restore + chapter 5 + chase begins
if (G.story.chapter !== 5 || !G.story._chaseOn) { console.error('standalone: chase never started, ch' + G.story.chapter); process.exit(1); }
const carX = G.world.props.playerCar.position.x;
G.player.pos.set(carX + 0.6, 0, -6.2);
G.story._carMash(); G.story._carMash(); G.story._carMash();
pump(200);
if (!G.ui.__ending) { console.error('standalone: ending never reached'); process.exit(1); }
console.log('✔ standalone full journey to the ending');
console.log('\nSTANDALONE (LASTCALL) BOOT + SIM: PASS');
process.exit(0);
