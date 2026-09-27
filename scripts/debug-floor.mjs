/* Isolate which floor layer causes the bright wash — fresh browser per shot for reliability. */
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const shots = [
  ['all', () => {}],
  ['no_mirror', () => { __scene.getObjectByName('mirror-floor').visible = false; }],
  ['no_overlay', () => {
    __scene.getObjectByName('floor-overlay').visible = false;
    __scene.getObjectByName('mirror-floor').visible = true;
  }],
  ['no_lights', () => {
    __scene.traverse((o) => { if (o.isSpotLight || o.isHemisphereLight) o.visible = false; });
  }],
  ['no_env', () => { __scene.environment = null; }]
];

async function withShot(name, setup) {
  for (let attempt = 0; attempt < 2; attempt++) {
    let browser;
    try {
      browser = await puppeteer.launch({
        args: [...chromium.args, '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
        executablePath: await chromium.executablePath(),
        headless: 'shell',
        env: { ...process.env, LD_LIBRARY_PATH: '/tmp/al2023/lib' },
        defaultViewport: { width: 1100, height: 640, deviceScaleFactor: 1 }
      });
      const page = await browser.newPage();
      await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#loader.done', { timeout: 60000 });
      await new Promise((r) => setTimeout(r, 1500));
      await page.evaluate(setup);
      await new Promise((r) => setTimeout(r, 700));
      await page.screenshot({ path: `/tmp/dbg_${name}.png`, captureBeyondViewport: false });
      console.log('saved', name);
      await browser.close();
      return;
    } catch (e) {
      console.log(`attempt ${attempt + 1} failed for ${name}:`, String(e).slice(0, 120));
      try { await browser?.close(); } catch {}
    }
  }
}

for (const [name, setup] of shots) await withShot(name, setup);
console.log('DONE');
