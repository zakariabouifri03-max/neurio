// Tiny zero-dependency test runner.
// Usage: node tests/run.mjs
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const here = dirname(new URL(import.meta.url).pathname);

let passed = 0, failed = 0;
const failures = [];

globalThis.__test = {
  test(name, fn) {
    try {
      fn();
      passed++;
      process.stdout.write('.');
    } catch (e) {
      failed++;
      failures.push({ name, error: e });
      process.stdout.write('F');
    }
  },
  section(name) {
    process.stdout.write('\n' + name + '  ');
  },
  summary() {
    process.stdout.write('\n\n');
    if (failures.length) {
      for (const f of failures) {
        console.error('FAIL:', f.name);
        console.error('  ' + (f.error && f.error.stack ? f.error.stack.split('\n').slice(0, 4).join('\n  ') : f.error));
      }
    }
    console.log(`${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  }
};

globalThis.eq = (actual, expected, msg = '') => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg} expected ${e} got ${a}`);
};
globalThis.ok = (cond, msg = '') => {
  if (!cond) throw new Error(msg || 'expected truthy');
};
globalThis.approx = (actual, expected, tol = 1e-6, msg = '') => {
  if (Math.abs(actual - expected) > tol) throw new Error(`${msg} expected ~${expected} got ${actual}`);
};

const files = readdirSync(here).filter(f => f.endsWith('.test.mjs')).sort();
for (const f of files) {
  const mod = await import(pathToFileURL(join(here, f)).href);
  if (typeof mod.default === 'function') await mod.default();
}
globalThis.__test.summary();
