/* Headless screenshot helper (dev-only, not part of the app). Retries on renderer crashes. */
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const url = process.argv[2] || 'http://localhost:5173/';
const out = process.argv[3] || 'shot.png';
const actions = process.argv[4] || ''; // comma list: lights, ignite, view, waitN

async function attempt() {
  const browser = await puppeteer.launch({
    args: [...chromium.args, '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    executablePath: await chromium.executablePath(),
    headless: 'shell',
    env: { ...process.env, LD_LIBRARY_PATH: '/tmp/al2023/lib' },
    defaultViewport: { width: 1600, height: 900, deviceScaleFactor: 1 }
  });
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    try {
      await page.waitForSelector('#loader.done', { timeout: 60000 });
      console.log('loader done');
    } catch {
      console.log('loader NOT done — capturing anyway');
    }
    await new Promise((r) => setTimeout(r, 2500));

    for (const a of actions.split(',').map((s) => s.trim()).filter(Boolean)) {
      if (a === 'lights') await page.click('#btn-lights');
      else if (a === 'ignite') await page.click('#btn-ignite');
      else if (a === 'view') await page.click('#btn-view');
      else if (a.startsWith('wait')) await new Promise((r) => setTimeout(r, parseInt(a.slice(4)) || 1000));
    }
    await new Promise((r) => setTimeout(r, 2500));

    await page.screenshot({ path: out, captureBeyondViewport: false });
    console.log('saved', out);
  } finally {
    await browser.close().catch(() => {});
  }
}

for (let i = 1; i <= 3; i++) {
  try {
    await attempt();
    process.exit(0);
  } catch (e) {
    console.log(`attempt ${i} failed:`, String(e).slice(0, 140));
  }
}
console.log('ALL ATTEMPTS FAILED');
process.exit(1);
