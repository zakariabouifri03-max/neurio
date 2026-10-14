// ── Posed screenshots of the Giant Worlds page ─────────────────────────────
// Poses the explorer deliberately (ground level / canopy level) so the images
// show the forest instead of whatever the last test left behind.
//
//   LD_LIBRARY_PATH=/tmp/stublibs node tools/shots.mjs [outDir]

import fs from 'node:fs';
import puppeteer from 'puppeteer';

const OUT = process.argv[2] || '/tmp/gwshots';
fs.mkdirSync(OUT, { recursive: true });
const EXEC = process.env.CHROME || ['/tmp/chromium', '/usr/bin/chromium', '/usr/bin/google-chrome']
  .find((p) => fs.existsSync(p));

const PLAN = [
  { planet: 20, mode: 'canopy', file: 'p20-canopy' },   // Emerald Canopy (day)
  { planet: 20, mode: 'ground', file: 'p20-ground' },
  { planet: 1, mode: 'ground', file: 'p01-ground' },    // Crimson Spore Forest (night)
  { planet: 17, mode: 'ground', file: 'p17-ground' },   // Biolume Night Garden
  { planet: 42, mode: 'ground', file: 'p42-ground' },   // Azure Lagoon (water)
  { planet: 9, mode: 'canopy', file: 'p09-canopy' },    // Blossom Drift
];

const browser = await puppeteer.launch({
  headless: true, executablePath: EXEC,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-gl=angle',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto('http://127.0.0.1:8000/worlds/index.html', { waitUntil: 'networkidle2', timeout: 90000 });
await page.waitForFunction('window.GW && window.GW.scene3d', { timeout: 120000 });

for (const shot of PLAN) {
  await page.evaluate((idx) => window.GW.travelTo(idx), shot.planet);
  await page.waitForFunction((idx) => window.GW.scene3d.planet.index === idx && !window.GW.busy, {}, shot.planet, { timeout: 60000 });
  await page.evaluate((mode) => {
    const g = window.GW, w = g.scene3d, e = g.explorer;
    g.mapOpen = true;                                  // freeze physics while we pose
    e.toggleFly(true);
    e.vel.set(0, 0, 0);
    if (mode === 'canopy') {
      e.pos.set(w.spawn.x + 26, w.spawn.y + w.tallest * 0.62, w.spawn.z + 26);
      e.yaw = Math.PI * 0.78; e.pitch = -0.16;
    } else {
      e.pos.set(w.spawn.x, w.spawn.y + 1.7, w.spawn.z);
      e.yaw = Math.PI * 0.25; e.pitch = 0.12;           // look slightly up at the giants
    }
    return true;
  }, shot.mode);
  await new Promise((r) => setTimeout(r, 900));
  const path = `${OUT}/${shot.file}.jpg`;
  await page.screenshot({ path, type: 'jpeg', quality: 88 });
  console.log('shot', path);
}
await browser.close();
