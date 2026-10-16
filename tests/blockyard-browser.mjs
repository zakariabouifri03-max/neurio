// Requires the local game server. BROWSER_EXECUTABLE_PATH may select Chromium.
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
await mkdir('.arena', { recursive: true });
const args = ['--no-sandbox', '--no-zygote', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
if (process.env.BROWSER_SINGLE_PROCESS) args.push('--single-process');
const options = { executablePath: process.env.BROWSER_EXECUTABLE_PATH || undefined, args, headless: true };
const origin = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
const errors = [];
const attach = page => { page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); };
const wait = (page, fn, value) => page.waitForFunction(fn, value, { timeout: 45000 });
const ready = async page => {
  await wait(page, () => !!window.BLOCKY && document.querySelector('#game')?.dataset.ready === 'true' && getComputedStyle(document.querySelector('#loading')).visibility === 'hidden');
  await page.evaluate(() => BLOCKY.renderer.setPixelRatio(.7));
};
const glb = async download => {
  const name = download.suggestedFilename(); await download.saveAs(`.arena/${name}`); const data = await readFile(`.arena/${name}`);
  assert.equal(data.readUInt32LE(0), 0x46546c67); assert.equal(data.readUInt32LE(4), 2); assert.equal(data.readUInt32LE(8), data.length);
  const json = JSON.parse(data.subarray(20, 20 + data.readUInt32LE(12)).toString());
  assert.ok(json.meshes[0].primitives.length > 10); assert.ok(json.images?.length > 0); assert.match(json.asset.generator, /Blockyard/);
  return { name, size: data.length, primitives: json.meshes[0].primitives.length };
};
let browser = await chromium.launch(options);
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true });
  const page = await context.newPage(); attach(page); await page.goto(origin); await ready(page);
  assert.equal(await page.locator('#recovery').isVisible(), false);
  assert.equal(await page.locator('#stage-name').textContent(), 'Sunny Square');
  assert.equal(await page.evaluate(() => BLOCKY.world.coins.length), 24);
  console.log('✓ Playable 3D world, avatar, six checkpoints, and local assets load');

  await page.keyboard.down('w'); await wait(page, () => BLOCKY.player.z < 1.7); await page.keyboard.up('w');
  await wait(page, () => BLOCKY.state.collected.includes(0));
  assert.equal(await page.evaluate(() => BLOCKY.state.started), true);
  await page.keyboard.press('Space'); await wait(page, () => BLOCKY.player.jumps === 1 && BLOCKY.player.y > .1);
  await page.keyboard.press('Space'); await wait(page, () => BLOCKY.player.jumps === 2);
  await page.keyboard.press('Space'); assert.ok(await page.evaluate(() => BLOCKY.player.jumps) <= 2);
  await wait(page, () => BLOCKY.player.grounded && BLOCKY.player.jumps === 0);
  console.log('✓ WASD, coin pickup, buffered double jump, landing, and jump limit');

  const yaw = await page.evaluate(() => BLOCKY.targetYaw);
  await page.mouse.move(1000, 450); await page.mouse.down(); await page.mouse.move(1080, 485, { steps: 4 }); await page.mouse.up();
  assert.notEqual(await page.evaluate(() => BLOCKY.targetYaw), yaw);
  const zoom = await page.evaluate(() => BLOCKY.targetDistance); await page.mouse.wheel(0, 200);
  await wait(page, value => BLOCKY.targetDistance > value, zoom);
  await page.keyboard.press('Escape');
  const elapsed = await page.evaluate(() => BLOCKY.state.elapsed), simulation = await page.evaluate(() => BLOCKY.simTime);
  await page.waitForTimeout(350);
  assert.equal(await page.evaluate(() => BLOCKY.state.elapsed), elapsed); assert.equal(await page.evaluate(() => BLOCKY.simTime), simulation);
  await page.locator('[data-action="quality"]').click(); assert.equal(await page.evaluate(() => BLOCKY.renderer.shadowMap.enabled), false);
  await page.locator('[data-action="sound"]').click(); assert.equal(await page.evaluate(() => BLOCKY.state.sound), true);
  await page.locator('[data-action="camera"]').click(); assert.equal(await page.evaluate(() => BLOCKY.targetYaw), .32);
  await page.locator('.primary[data-action="close"]').click();
  console.log('✓ Orbit, zoom, pause, camera reset, sound, and graphics quality');

  await page.locator('.main-nav [data-panel="avatar"]').click(); await wait(page, () => !!BLOCKY.preview);
  await page.locator('[data-outfit="berry"]').click(); assert.equal(await page.evaluate(() => BLOCKY.state.outfit), 'berry');
  assert.equal(await page.evaluate(() => BLOCKY.preview.model.userData.rig.colors.shirt.color.getHexString()), 'ef94b3');
  await page.screenshot({ path: '.arena/blockyard-customization.png' });
  await page.locator('[data-outfit="citrus"]').click();
  let downloading = page.waitForEvent('download'); await page.locator('[data-action="export-avatar"]').click();
  console.log('✓ Original avatar exported:', await glb(await downloading));
  await page.locator('[data-outfit="electric"]').click(); await page.locator('#close-modal').click();
  await page.locator('.model-button').click();
  downloading = page.waitForEvent('download'); await page.locator('[data-action="export-world"]').click();
  console.log('✓ Complete obstacle-course model exported:', await glb(await downloading));
  await page.locator('#close-modal').click();
  console.log('✓ Real 3D character preview and four functional saved outfits');

  await page.evaluate(() => Object.assign(BLOCKY.player, { x: 1, z: -24, y: 1.7, vy: -3, vx: 0, vz: 0, grounded: false, support: null }));
  await wait(page, () => BLOCKY.state.checkpoint === 1);
  const deaths = await page.evaluate(() => BLOCKY.state.deaths);
  await page.evaluate(() => { BLOCKY.player.y = -25; BLOCKY.player.grounded = false; });
  await wait(page, value => BLOCKY.state.deaths > value && BLOCKY.player.support === 'island-1', deaths);
  const beforeLava = await page.evaluate(() => BLOCKY.state.deaths);
  await page.evaluate(() => { BLOCKY.invincible = 0; Object.assign(BLOCKY.player, { x: -9, z: -35.4, y: 2.1, vy: 0, vx: 0, vz: 0, grounded: true, support: 'lava-lane' }); });
  await wait(page, value => BLOCKY.state.deaths > value && BLOCKY.player.support === 'island-1', beforeLava);
  console.log('✓ Checkpoint activation, fall recovery, and lava respawn');

  await page.evaluate(() => {
    const model = BLOCKY.world.models.get('mover-1');
    Object.assign(BLOCKY.player, { x: model.position.x, z: model.position.z, y: model.position.y, vy: 0, vx: 0, vz: 0, grounded: true, support: 'mover-1' });
  });
  const startTime = await page.evaluate(() => BLOCKY.simTime);
  await wait(page, time => BLOCKY.simTime > time + .35, startTime);
  assert.ok(await page.evaluate(() => Math.abs(BLOCKY.player.x - BLOCKY.world.models.get('mover-1').position.x)) < .05);
  await page.evaluate(() => Object.assign(BLOCKY.player, { x: 8, z: -83.3, y: 4.56, vy: -3, vx: 0, vz: 0, grounded: false, support: null, coyote: 0 }));
  await wait(page, () => BLOCKY.player.y > 4.8 && BLOCKY.player.jumps === 1 && !BLOCKY.player.grounded);
  await page.keyboard.press('Space'); await wait(page, () => BLOCKY.player.jumps === 2);
  console.log('✓ Moving-platform carry and spring launch with an extra air jump');

  await page.evaluate(() => Object.assign(BLOCKY.player, { x: -8, z: -134, y: 9.7, vy: -3, vx: 0, vz: 0, grounded: false, support: null }));
  await wait(page, () => BLOCKY.player.grounded);
  assert.equal(await page.evaluate(() => BLOCKY.state.won), false);
  assert.equal(await page.evaluate(() => BLOCKY.state.checkpoint), 1);
  for (let index = 2; index <= 5; index++) {
    await page.evaluate(async index => {
      const { STAGES } = await import('./src/blockyard/rules.js'), s = STAGES[index];
      Object.assign(BLOCKY.player, { x: s.x, z: s.z + 1.3, y: s.y + .3, vy: -3, vx: 0, vz: 0, grounded: false, support: null });
    }, index);
    await wait(page, index => BLOCKY.state.checkpoint === index, index);
  }
  await page.evaluate(() => BLOCKY.resetCamera());
  await page.keyboard.down('w'); await wait(page, () => BLOCKY.state.won && BLOCKY.ui.modal === 'win'); await page.keyboard.up('w');
  assert.ok(await page.evaluate(() => BLOCKY.state.best) > 0);
  await page.screenshot({ path: '.arena/blockyard-finish.png' });
  console.log('✓ Checkpoints cannot be skipped; gold arch completes the run and saves a personal best');

  const collected = await page.evaluate(() => BLOCKY.state.collected.length);
  await page.reload(); await ready(page);
  assert.equal(await page.evaluate(() => BLOCKY.state.won), true);
  assert.equal(await page.evaluate(() => BLOCKY.state.outfit), 'electric');
  assert.equal(await page.evaluate(() => BLOCKY.state.collected.length), collected);
  await page.evaluate(() => navigator.serviceWorker.ready); await wait(page, () => !!navigator.serviceWorker.controller);
  await context.setOffline(true); await page.reload(); await ready(page);
  assert.equal(await page.evaluate(() => BLOCKY.state.checkpoint), 5); assert.equal(await page.locator('#recovery').isVisible(), false);
  await context.setOffline(false);
  console.log('✓ Save/reload retains progress and cosmetics; the complete game reloads offline');

  await page.keyboard.press('h'); await page.locator('.primary[data-action="close"]').click();
  await page.keyboard.press('Escape'); await page.locator('[data-action="restart-confirm"]').click();
  await page.locator('.secondary[data-action="close"]').click(); assert.equal(await page.evaluate(() => BLOCKY.state.checkpoint), 5);
  await page.keyboard.press('Escape'); await page.locator('[data-action="restart-confirm"]').click(); await page.locator('[data-action="restart"]').click();
  assert.deepEqual(await page.evaluate(() => [BLOCKY.state.checkpoint, BLOCKY.state.collected.length, BLOCKY.state.won, BLOCKY.state.outfit]), [0, 0, false, 'electric']);
  assert.ok(await page.evaluate(() => BLOCKY.state.best) > 0);
  console.log('✓ Help and confirmed restart; cancellation preserves progress and fresh runs retain personal best/outfit');

  await browser.close(); browser = await chromium.launch(options);
  const touch = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true }); attach(touch);
  await touch.goto(origin); await ready(touch);
  assert.equal(await touch.locator('#joystick').isVisible(), true); assert.equal(await touch.locator('#jump-button').isVisible(), true);
  assert.equal(await touch.locator('.control-strip>span:nth-child(3)').isVisible(), false);
  const rect = await touch.locator('#joystick').boundingBox();
  const position = await touch.evaluate(() => [BLOCKY.player.x, BLOCKY.player.z]);
  await touch.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2); await touch.mouse.down();
  await touch.mouse.move(rect.x + rect.width / 2 + 22, rect.y + rect.height / 2 - 9);
  await wait(touch, before => Math.hypot(BLOCKY.player.x - before[0], BLOCKY.player.z - before[1]) > .35, position); await touch.mouse.up();
  assert.equal(await touch.evaluate(() => BLOCKY.touch.length()), 0);
  await touch.locator('#jump-button').tap(); await wait(touch, () => BLOCKY.player.jumps === 1);
  await touch.locator('#jump-button').tap(); await wait(touch, () => BLOCKY.player.jumps === 2);
  await wait(touch, () => BLOCKY.player.grounded);
  await touch.locator('.avatar-shortcut').tap(); await wait(touch, () => !!BLOCKY.preview);
  await touch.locator('[data-outfit="ocean"]').tap(); assert.equal(await touch.evaluate(() => BLOCKY.state.outfit), 'ocean');
  await touch.locator('#close-modal').tap();
  await touch.screenshot({ path: '.arena/blockyard-mobile-test.png' });
  await touch.setViewportSize({ width: 844, height: 390 });
  await touch.locator('.pause-button').tap(); await touch.locator('.primary[data-action="close"]').tap();
  await touch.locator('#respawn-button').tap();
  assert.equal(await touch.evaluate(() => BLOCKY.player.support), 'island-0');
  assert.equal(await touch.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  console.log('✓ Touch joystick, double jump, customization, respawn, and portrait/landscape layouts');
  assert.deepEqual(errors, [], 'Browser JavaScript/WebGL errors');
  console.log('\nAll Blockyard browser checks passed without JavaScript or WebGL errors.');
} catch (error) {
  for (const context of browser.contexts()) for (const page of context.pages()) console.error('State at failure:', await page.evaluate(() => window.BLOCKY && ({ player: BLOCKY.player, state: BLOCKY.state, modal: BLOCKY.ui.modal, paused: BLOCKY.paused })).catch(() => null));
  throw error;
} finally { await browser.close(); }
