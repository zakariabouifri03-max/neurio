// Headless smoke test: load a page in the workspace and report page errors + a result object.
import puppeteer from 'puppeteer';

const url = process.argv[2] || 'http://localhost:8123/medieval/test/smoke.html';
const shot = process.argv[3] || '/tmp/shot.png';
const waitMs = Number(process.argv[4] || 20000);

const browser = await puppeteer.launch({
  headless: 'shell',
  args: [
    '--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1280,760',
  ],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => logs.push(`[reqfail] ${r.url()} ${r.failure()?.errorText}`));

await page.goto(url, { waitUntil: 'load', timeout: 60000 }).catch((e) => logs.push('[goto] ' + e.message));
try {
  await page.waitForFunction('window.__ready === true || window.__fail === true', { timeout: waitMs });
} catch (e) {
  logs.push('[timeout] page never signalled ready');
}
const result = await page.evaluate(() => window.__result || window.__fail || null);
await page.screenshot({ path: shot });
await browser.close();
console.log(JSON.stringify({ result, logs }, null, 1));
