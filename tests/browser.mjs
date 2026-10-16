import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { expect } from '@playwright/test';
import { launchBrowser } from './browser-helper.mjs';

const baseURL = process.env.BASE_URL || 'http://127.0.0.1:3000/ghostline.html';
const browser = await launchBrowser();
const errors = [];
const prepare = async (context, low = true) => {
  await context.addInitScript(({ low }) => { if (!localStorage.getItem('ghostline-settings-v1')) localStorage.setItem('ghostline-settings-v1', JSON.stringify({ quality: low ? 'low' : 'auto' })); }, { low });
  const page = await context.newPage();
  page.setDefaultTimeout(25000);
  page.on('pageerror', e => errors.push(e.stack));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(baseURL);
  await page.waitForFunction(() => window.GHOSTLINE?.ready, null, { timeout: 60000 });
  await page.locator('#boot-screen').waitFor({ state: 'detached' });
  return page;
};
const getPosition = page => page.evaluate(() => ({ x: GHOSTLINE.player.x, z: GHOSTLINE.player.z }));
const moveTo = (page, x, z) => page.evaluate(({ x, z }) => { Object.assign(GHOSTLINE.player, { x, z, y: 0, speed: 0, verticalSpeed: 0 }); }, { x, z });

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await prepare(context);
  assert.ok(await page.evaluate(() => GHOSTLINE.renderer.info.render.triangles > 10000));
  await expect(page.getByRole('heading', { name: 'The city is your backdoor.' })).toBeVisible();
  await page.screenshot({ path: '.cache/ghostline-desktop.png' });
  console.log('✓ 3D world boots without errors; initial desktop screenshot saved.');

  await page.getByRole('button', { name: 'ENTER THE CITY', exact: true }).click();
  const start = await getPosition(page);
  await page.keyboard.down('w');
  await page.waitForFunction(start => Math.hypot(GHOSTLINE.player.x - start.x, GHOSTLINE.player.z - start.z) > 1, start);
  await page.keyboard.up('w');
  const moved = await getPosition(page);
  assert.ok(Math.hypot(moved.x - start.x, moved.z - start.z) > .4, 'W moves the operative');
  await page.keyboard.press('Escape');
  await expect(page.locator('#pause-dialog')).toBeVisible();
  const paused = await getPosition(page); await page.keyboard.down('w'); await page.waitForTimeout(400); await page.keyboard.up('w');
  assert.deepEqual(await getPosition(page), paused, 'Pause stops movement');
  await page.getByRole('button', { name: 'RESUME OPERATION' }).click();
  await page.keyboard.press('q'); assert.equal(await page.evaluate(() => GHOSTLINE.scan), true);
  await page.keyboard.press('q'); assert.equal(await page.evaluate(() => GHOSTLINE.scan), false);
  await page.keyboard.press('b'); assert.ok(await page.evaluate(() => GHOSTLINE.blackout > 0));
  await page.keyboard.press('b'); await expect(page.locator('#toast-title')).toHaveText('BLACKOUT RECHARGING');
  console.log('✓ Movement, pause/resume, network scan, blackout, and cooldown guards.');

  await page.keyboard.press('m'); await expect(page.locator('#map-dialog')).toBeVisible();
  await page.locator('[data-waypoint="relay-02"]').click();
  assert.equal(await page.evaluate(() => GHOSTLINE.waypoint.id), 'relay-02');
  await page.locator('#clear-waypoint').click(); assert.equal(await page.evaluate(() => GHOSTLINE.waypoint), null);
  const map = await page.locator('#district-map').boundingBox();
  await page.mouse.click(map.x + map.width / 2, map.y + map.height / 2);
  assert.ok(await page.evaluate(() => Math.abs(GHOSTLINE.waypoint.x) < 1 && Math.abs(GHOSTLINE.waypoint.z) < 1));
  await page.locator('#clear-waypoint').click();
  await page.screenshot({ path: '.cache/ghostline-map.png' });
  await page.keyboard.press('Escape');
  console.log('✓ Tactical map, relay selection, and click-to-place / clear waypoint.');

  await moveTo(page, 7, 10); await page.keyboard.press('e');
  await page.waitForFunction(() => !!GHOSTLINE.mission.hack);
  await moveTo(page, 3, 34); await page.waitForFunction(() => !GHOSTLINE.mission.hack);
  assert.equal(await page.evaluate(() => GHOSTLINE.mission.breached.size), 0);
  await moveTo(page, 7, 10); await page.keyboard.press('e');
  await page.waitForFunction(() => GHOSTLINE.mission.breached.has('relay-01'), null, { timeout: 35000 });
  assert.equal(await page.evaluate(() => GHOSTLINE.mission.xp), 150);
  await moveTo(page, -8, 18); await page.keyboard.press('e');
  await page.waitForFunction(() => GHOSTLINE.world.cameras[0].disabled > 0, null, { timeout: 30000 });
  for (const [id, x, z] of [['relay-02', -6, -29], ['relay-03', 55, -55]]) {
    await moveTo(page, x, z); await page.keyboard.press('e');
    await page.waitForFunction(id => GHOSTLINE.mission.breached.has(id), id, { timeout: 35000 });
  }
  assert.equal(await page.evaluate(() => GHOSTLINE.mission.extracting), true);
  assert.equal(await page.evaluate(() => GHOSTLINE.mission.completed), false);
  await moveTo(page, 3, 34);
  await page.waitForFunction(() => GHOSTLINE.mission.completed);
  await expect(page.locator('#complete-dialog')).toBeVisible();
  assert.equal(await page.evaluate(() => GHOSTLINE.mission.xp), 750);
  await page.getByRole('button', { name: 'KEEP EXPLORING' }).click();
  console.log('✓ Out-of-range cancellation, camera looping, all three breaches, extraction, XP, free roam.');

  await page.locator('.nav-tab[data-open="operative"]').click();
  await expect(page.locator('#model-stage canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Sandstone jacket' }).click();
  assert.equal(await page.evaluate(() => GHOSTLINE.settings.palette), 'sand');
  await page.getByRole('button', { name: 'Carbon jacket' }).click();
  await page.screenshot({ path: '.cache/ghostline-operative.png' });
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#export-model').click();
  const download = await downloadPromise;
  await fs.mkdir('models', { recursive: true });
  await download.saveAs('models/echo-operative-carbon.glb');
  const binary = await fs.readFile('models/echo-operative-carbon.glb');
  assert.equal(binary.readUInt32LE(0), 0x46546c67); assert.equal(binary.readUInt32LE(4), 2); assert.equal(binary.readUInt32LE(8), binary.length);
  const jsonLength = binary.readUInt32LE(12), gltf = JSON.parse(binary.toString('utf8', 20, 20 + jsonLength));
  assert.ok(gltf.meshes.length > 20); assert.ok(gltf.nodes.some(n => n.name === 'ECHO_07'));
  await page.keyboard.press('Escape');
  console.log(`✓ Live model viewer, palette changes, and valid GLB export (${Math.round(binary.length / 1024)} KB).`);

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('#rain-setting').uncheck(); assert.equal(await page.evaluate(() => GHOSTLINE.world.rain.visible), false);
  await page.locator('#sound-setting').check(); await expect(page.locator('#sound-toggle')).toHaveAttribute('aria-label', 'Mute sound');
  await page.locator('#sound-setting').uncheck();
  await page.locator('#quality-setting').selectOption('high'); assert.equal(await page.evaluate(() => GHOSTLINE.renderer.shadowMap.enabled), true);
  await page.locator('#quality-setting').selectOption('low');
  await page.keyboard.press('Escape');
  await page.reload(); await page.waitForFunction(() => window.GHOSTLINE?.ready, null, { timeout: 60000 });
  assert.equal(await page.evaluate(() => GHOSTLINE.mission.completed), true);
  assert.equal(await page.evaluate(() => GHOSTLINE.mission.breached.size), 3);
  assert.equal(await page.evaluate(() => GHOSTLINE.settings.rain), false);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.reload(); await page.waitForFunction(() => window.GHOSTLINE?.ready, null, { timeout: 60000 });
  assert.equal(await page.evaluate(() => GHOSTLINE.mission.completed), true);
  await context.setOffline(false);
  console.log('✓ Settings, checkpoint restoration, and service-worker offline reload.');
  await context.close();

  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const mobile = await prepare(mobileContext);
  await expect(mobile.locator('.touch-controls')).toBeVisible();
  await mobile.screenshot({ path: '.cache/ghostline-mobile.png' });
  await mobile.locator('#deploy-button').tap();
  const before = await getPosition(mobile), forward = await mobile.locator('[data-move="forward"]').boundingBox();
  await mobile.mouse.move(forward.x + forward.width / 2, forward.y + forward.height / 2); await mobile.mouse.down();
  await mobile.waitForFunction(before => Math.hypot(GHOSTLINE.player.x - before.x, GHOSTLINE.player.z - before.z) > .7, before);
  await mobile.mouse.up();
  const after = await getPosition(mobile); assert.ok(Math.hypot(after.x - before.x, after.z - before.z) > .3);
  await mobile.locator('#scan-button').tap(); assert.equal(await mobile.evaluate(() => GHOSTLINE.scan), true);
  await mobile.locator('.minimap-heading').tap(); await expect(mobile.locator('#map-dialog')).toBeVisible();
  await mobile.locator('#map-dialog .close-dialog').tap();
  await mobile.screenshot({ path: '.cache/ghostline-mobile-playing.png' });
  assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await mobile.setViewportSize({ width: 844, height: 390 });
  await mobile.screenshot({ path: '.cache/ghostline-mobile-landscape.png' });
  assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  console.log('✓ Mobile layout, directional controls, scan, map, and landscape resize.');
  await mobileContext.close();

  assert.deepEqual(errors, [], `Browser errors: ${errors.join('\n')}`);
  console.log('\nAll browser checks passed.');
} finally { await browser.close(); }
