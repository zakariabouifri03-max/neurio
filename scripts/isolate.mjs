/* Decisive isolation battery: fresh browser per shot. */
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const shots = [
  ['A_env_off', () => { __scene.environment = null; }],
  ['B_env_off_lightsoff', () => {
    __scene.environment = null;
    __scene.traverse((o) => { if (o.isSpotLight || o.isHemisphereLight) o.visible = false; });
  }],
  ['C_car_hidden', () => { __scene.getObjectByName('car').visible = false; }],
  ['D_bloom_off', () => { __bloom.enabled = false; }],
  ['E_mirror_off', () => { __scene.getObjectByName('mirror-floor').visible = false; }],
  ['F_overlay_off', () => { __scene.getObjectByName('floor-overlay').visible = false; }]
];

async function withShot(name, setup) {
  for (let attempt = 0; attempt < 3; attempt++) {
    let browser;
    try {
      browser = await puppeteer.launch({
        args: [...chromium.args, '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
        executablePath: await chromium.executablePath(),
        headless: 'shell',
        env: { ...process.env, LD_LIBRARY_PATH: '/tmp/al2023/lib' },
        defaultViewport: { width: 1000, height: 580, deviceScaleFactor: 1 }
      });
      const page = await browser.newPage();
      await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#loader.done', { timeout: 60000 });
      await new Promise((r) => setTimeout(r, 1500));
      await page.evaluate(setup);
      await new Promise((r) => setTimeout(r, 900));
      await page.screenshot({ path: `/tmp/iso_${name}.png`, captureBeyondViewport: false });
      console.log('saved', name);
      await browser.close();
      return;
    } catch (e) {
      console.log(`attempt ${attempt + 1} failed for ${name}:`, String(e).slice(0, 100));
      try { await browser?.close(); } catch {}
    }
  }
}

for (const [name, setup] of shots) await withShot(name, setup);
console.log('DONE');
