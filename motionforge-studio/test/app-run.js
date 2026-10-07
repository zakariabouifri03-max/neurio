// Headless smoke test of the REAL app UI (index.html + js/app.js) with a Node-backed bridge. Runs the in-app self-test and takes screenshots.
const path = require('path'), fs = require('fs'), os = require('os');
const { launch } = require('./launch'); const { makeBridge, attach } = require('./mock-mf');
(async () => {
  const out = path.join(__dirname, '..', '.test-out'); fs.mkdirSync(out, { recursive: true });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-app-'));
  let report = null; const bridge = makeBridge(root, { selftest: process.argv.includes('--selftest'), onSelftest: (r) => { report = r; } });
  const browser = await launch(); const page = await browser.newPage(); await page.setViewport({ width: 1600, height: 900 });
  const errors = []; page.on('console', (m) => { const t = m.type(); if (t === 'error' || t === 'warning') errors.push(`[${t}] ${m.text()}`); }); page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  await attach(page, bridge);
  await page.goto('file://' + path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  const t0 = Date.now();
  if (process.argv.includes('--selftest')) { while (!report && Date.now() - t0 < 120000) await new Promise((r) => setTimeout(r, 500)); }
  else await new Promise((r) => setTimeout(r, 3000));
  await page.screenshot({ path: path.join(out, 'app.png') });
  if (report) { for (const s of report.steps) console.log((s.ok ? 'PASS ' : 'FAIL ') + s.name + (s.detail ? ' — ' + s.detail.split('\n')[0] : '')); console.log(report.ok ? 'SELFTEST OK' : 'SELFTEST FAILED'); }
  console.log('console errors/warnings:', errors.length); for (const e of errors.slice(0, 25)) console.log('  ' + e);
  await browser.close(); fs.rmSync(root, { recursive: true, force: true });
  process.exit(report ? (report.ok ? 0 : 1) : (errors.some((e) => e.startsWith('[pageerror]')) ? 1 : 0));
})().catch((e) => { console.error(e); process.exit(2); });
