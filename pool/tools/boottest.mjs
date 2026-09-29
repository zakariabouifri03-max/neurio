// Runs the REAL boot sequence and the REAL "enter the hall" click in Node.
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve as resolvePath, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url));
const STUB = pathToFileURL(resolvePath(HERE, 'sceneStub.mjs')).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/(^|\/)scene\.js$/.test(specifier) && context.parentURL && /pool\/src\//.test(context.parentURL)) {
      return { url: STUB, shortCircuit: true };
    }
    if (specifier === 'three') {
      return { url: pathToFileURL(resolvePath(HERE, '..', '..', 'vendor', 'three.module.js')).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const { els, listeners, vclock, yieldToEventLoop } = await import('./stubs.mjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await import('../src/main.js');
// boot runs on rAF (setTimeout in the stubs); give it room
for (let i = 0; i < 40; i++) { await sleep(10); vclock.t += 16; }

const $ = (id) => els.get(id);
const errText = () => (els.has('errLog') ? els.get('errLog').textContent : '');
console.log('boot: authBox hidden?', $('authBox') ? $('authBox').classList.contains('hidden') : 'missing');
console.log('boot: loadTip =', $('loadTip') && $('loadTip').textContent);
if (errText()) console.log('boot errors:', errText());

const fire = (id, ev = 'click') => {
  const node = $(id);
  const ls = listeners.filter(([n, e]) => n === node && e === ev);
  if (!ls.length) { console.log(`!! no ${ev} listener on #${id}`); return false; }
  for (const [, , fn] of ls) fn({ target: node, button: 0, clientX: 0, clientY: 0, preventDefault() {}, code: '', key: '' });
  return true;
};

console.log('clicking #guestBtn …');
fire('guestBtn');
await sleep(30);
for (let i = 0; i < 30; i++) { await sleep(5); vclock.t += 16; }
const App = (await import('../src/main.js')).default;
const frame = async (n) => { for (let i = 0; i < n; i++) { await sleep(2); vclock.t += 16; } };

console.log('after guest click:');
console.log('  #boot has .show ?', $('boot') && $('boot').classList.contains('show'));
console.log('  #menu has .show ?', $('menu') && $('menu').classList.contains('show'));
console.log('  #hallHud hidden ?', $('hallHud') && $('hallHud').classList.contains('hidden'));
console.log('  hall active ?', !!(App.hall && App.hall.active));
console.log('  errLog:', errText() || '(clean)');

// the whole journey: hall → practice table → shoot → back to the hall
await frame(30);
App.startMatch({ mode: 'practice', game: '8ball', table: 'main' });
await frame(60);
console.log('in match: phase =', App.match.phase, '· matchHud hidden?', $('matchHud').classList.contains('hidden'));
for (let k = 0; k < 3; k++) {
  if (App.match.phase === 'aim') { App.match.rotateAim(0.3); App.match.setPower(0.6, true); App.match.shoot(); }
  await frame(240);
}
console.log('after shots: phase =', App.match.phase, '· shots =', App.match.stats.shots);
App.backToHall();
await frame(60);
console.log('back in hall: hall active ?', !!(App.hall && App.hall.active), '· matchHud hidden?', $('matchHud').classList.contains('hidden'));
console.log('FINAL errLog:', errText() || '(clean)');
process.exit(errText() ? 1 : 0);
