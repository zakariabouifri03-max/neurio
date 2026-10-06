// Smoke: load the shipped background.js and page.js in a VM with chrome/DOM
// stubs and verify they register without throwing at the top level.
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { test, section } = globalThis.__test;

function listener() { return { addListener() {}, removeListener() {} }; }

function makeChrome() {
  return {
    runtime: {
      lastError: undefined,
      onInstalled: listener(), onStartup: listener(), onMessage: listener(),
      sendMessage(m, cb) { if (cb) cb({}); },
      getURL: x => 'chrome-extension://x/' + x,
      openOptionsPage() {}
    },
    tabs: { onUpdated: listener(), onRemoved: listener(), onActivated: listener(), query(q, cb) { cb([]); }, sendMessage() {} },
    storage: { local: { get(q, cb) { cb({}); }, set(o, cb) { if (cb) cb(); } }, onChanged: listener() },
    commands: { onCommand: listener() },
    action: { setBadgeText() {}, setBadgeBackgroundColor() {}, setTitle() {} },
    scripting: { executeScript() { return Promise.resolve(); } },
    permissions: { contains(p, cb) { cb(false); }, request(p, cb) { cb(false); } },
    declarativeNetRequest: { updateDynamicRules(o, cb) { if (cb) cb(); } }
  };
}

function runFile(name, sandbox) {
  const src = readFileSync(join(root, name), 'utf8');
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: name }); // throws on top-level error
}

export default async function run() {
  section('smoke: background.js / page.js boot');

  test('background.js registers without throwing', () => {
    const sandbox = {
      chrome: makeChrome(),
      console,
      setTimeout, clearTimeout, setInterval, clearInterval,
      fetch: () => Promise.resolve({ json: () => Promise.resolve([]) }),
      Map, Date, JSON, URL
    };
    runFile('background.js', sandbox);
  });

  test('page.js registers without throwing', () => {
    const sandbox = {
      chrome: makeChrome(),
      console,
      setTimeout, clearTimeout, setInterval, clearInterval,
      window: { addEventListener() {}, postMessage() {}, __ytSmoothPageLoaded: false },
      document: { getElementById: () => null, querySelector: () => null },
      Date, JSON
    };
    runFile('page.js', sandbox);
    ok(sandbox.window.__ytSmoothPageLoaded === true, 'guard flag set');
  });
}
