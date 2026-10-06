/* ============================================================
   tools/check.mjs — runs the whole suite.
     1  engine simulation (head-less matches)
     2  3D layer driven in Node
     3  HTML ↔ JS consistency
     4  DOM layer against a stub DOM
     5  single-file build (+ syntax check)
     6  APK build, then an independent verification of it
   ============================================================ */

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const run = (script, args = []) =>
  spawnSync(process.execPath, [join(root, 'tools', script), ...args], { stdio: 'inherit', cwd: root });

const stages = [
  ['engine', 'sim-test.mjs', ['5', '2026']],
  ['3d layer', 'render-test.mjs', []],
  ['html ↔ js', 'check-ui.mjs', []],
  ['dom layer', 'dom-test.mjs', []],
  ['single-file build', 'build-singlefile.mjs', []],
];

const results = [];
for (const [name, script, args] of stages) {
  console.log(`\n\x1b[7m  ${name.toUpperCase()}  \x1b[0m`);
  results.push([name, run(script, args).status === 0]);
}

/* the APK only makes sense when openssl is around to sign it */
const haveOpenssl = spawnSync('openssl', ['version']).status === 0;
if (haveOpenssl) {
  console.log('\n\x1b[7m  APK BUILD  \x1b[0m');
  results.push(['apk build', run('build-apk.mjs').status === 0]);
  console.log('\n\x1b[7m  APK VERIFY  \x1b[0m');
  results.push(['apk verify', run('verify-apk.mjs').status === 0]);
} else {
  console.log('\n⚠️  openssl not found — skipping the APK stages');
  if (existsSync(join(root, 'Botola25.apk'))) {
    console.log('\n\x1b[7m  APK VERIFY (existing artefact)  \x1b[0m');
    results.push(['apk verify', run('verify-apk.mjs').status === 0]);
  }
}

console.log('\n\x1b[1m══════════ summary ══════════\x1b[0m');
for (const [name, ok] of results) console.log(`  ${ok ? '✅' : '❌'} ${name}`);
const failed = results.filter(([, ok]) => !ok).length;
console.log(failed === 0
  ? `\n\x1b[32m✅ ALL ${results.length} STAGES PASSED\x1b[0m`
  : `\n\x1b[31m❌ ${failed}/${results.length} STAGES FAILED\x1b[0m`);
process.exit(failed ? 1 : 0);
