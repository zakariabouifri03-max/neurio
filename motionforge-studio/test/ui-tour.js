// Click through every panel, dock tab, menu and dialog in the real UI; report console errors; save screenshots.
const path = require('path'), fs = require('fs'), os = require('os');
const { launch } = require('./launch'); const { makeBridge, attach } = require('./mock-mf');
(async () => {
  const out = path.join(__dirname, '..', '.test-out', 'tour'); fs.mkdirSync(out, { recursive: true });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-tour-')); const bridge = makeBridge(root, {});
  const browser = await launch(); const page = await browser.newPage(); await page.setViewport({ width: 1600, height: 900 });
  const errors = []; page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) errors.push(`[${m.type()}] ${m.text()}`); }); page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  await attach(page, bridge); await page.goto('file://' + path.join(__dirname, '..', 'src', 'renderer', 'index.html')); await new Promise((r) => setTimeout(r, 2500));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); const shot = (n) => page.screenshot({ path: path.join(out, n + '.png') });
  const closeModal = async () => { await page.keyboard.press('Escape'); await sleep(250); };
  await closeModal(); // welcome
  // give the scene some animation so panels have content
  await page.evaluate(async () => { const m = await import('./js/ai/assistant.js'); const r = await m.makePlan('Make the character walk to the center, wave, then sit on a chair'); m.applyPlan(r.plan, { start: 0 }); window.__MF.S.frame = 40; window.__MF.bus.emit('frame'); });
  await sleep(500);
  const tabs = await page.$$eval('#right-tabs .tab', (els) => els.map((e) => e.textContent.trim()));
  for (let i = 0; i < tabs.length; i++) { await page.evaluate((i) => document.querySelectorAll('#right-tabs .tab')[i].click(), i); await sleep(400); await shot('right-' + tabs[i]); console.log('right tab', tabs[i], 'ok'); }
  const dock = await page.$$eval('#dock-tabs .tab', (els) => els.map((e) => e.textContent.trim()));
  for (let i = 0; i < dock.length; i++) { await page.evaluate((i) => document.querySelectorAll('#dock-tabs .tab')[i].click(), i); await sleep(500); await shot('dock-' + i); }
  await page.evaluate(() => document.querySelectorAll('#dock-tabs .tab')[0].click()); await sleep(300);
  const menus = await page.$$eval('#menubar .menu-top', (els) => els.length);
  for (let i = 0; i < menus; i++) { await page.evaluate((i) => { const t = document.querySelectorAll('#menubar .menu-top')[i]; t.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); }, i); await sleep(250); await shot('menu-' + i); await page.mouse.click(700, 300); await sleep(150); }
  const tools = await page.$$eval('#toolbar .tool', (els) => els.map((e) => e.dataset.tool));
  for (const t of tools) { await page.evaluate((t) => document.querySelector(`#toolbar .tool[data-tool="${t}"]`).click(), t); await sleep(150); if (['brush', 'shape', 'fill', 'transform'].includes(t)) await shot('opt-' + t); }
  for (const c of ['file.new', 'settings.open', 'settings.shortcuts', 'export.video', 'palette.open', 'help.about', 'ai.settings', 'view.onionSettings', 'file.projectSettings']) { await page.evaluate((c) => window.__MF.runCommand(c), c); await sleep(600); await shot('dlg-' + c); await closeModal(); await closeModal(); }
  await page.evaluate(() => document.body.classList.contains('mode-pro')); await page.evaluate(() => document.querySelector('#mode-switch button[data-mode="beginner"]').click()); await sleep(500); await shot('beginner');
  await page.evaluate(() => document.querySelector('#mode-switch button[data-mode="pro"]').click()); await sleep(300);
  console.log('console errors/warnings:', errors.length); errors.slice(0, 30).forEach((e) => console.log('  ' + e));
  await browser.close(); fs.rmSync(root, { recursive: true, force: true }); process.exit(errors.some((e) => e.startsWith('[pageerror]')) ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
