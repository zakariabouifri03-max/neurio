// Runs every automated suite. Usage: node test/run.js [--quick]
// Suites drive the real renderer in headless Chromium (bundled via @sparticuz/chromium) with a Node-backed window.mf bridge.
const { spawnSync } = require('child_process'); const path = require('path');
const suites = [['core (model/anim/rig/render/history)', 'core-run.js'], ['AI planner + compiler', 'ai-run.js'], ['app end-to-end self-test', 'app-run.js', '--selftest']];
if (!process.argv.includes('--quick')) suites.push(['UI tour (every panel / menu / dialog)', 'ui-tour.js']);
let fail = 0;
for (const [name, file, ...args] of suites) {
  process.stdout.write(`\n▶ ${name}\n`);
  const r = spawnSync(process.execPath, [path.join(__dirname, file), ...args], { stdio: 'inherit', timeout: 600000 });
  if (r.status !== 0) { fail++; console.log(`✗ FAILED: ${name} (exit ${r.status})`); } else console.log(`✓ ok: ${name}`);
}
console.log(fail ? `\n${fail} suite(s) failed` : '\nAll suites passed'); process.exit(fail ? 1 : 0);
