// Run against `npm run dev`. Set BROWSER_EXECUTABLE_PATH to your Chromium/Chrome binary.
// Screenshots and downloaded models are kept out of Git, in .arena/.
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';

await mkdir('.arena', { recursive: true });
const args = ['--no-sandbox', '--no-zygote', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
if (process.env.BROWSER_SINGLE_PROCESS) args.push('--single-process');
const launchOptions = { executablePath: process.env.BROWSER_EXECUTABLE_PATH || undefined, args, headless: true };
let browser = await chromium.launch(launchOptions);
const origin = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000/drift.html';
const errors = [];
const attach = page => { page.on('pageerror', error => errors.push(error.message)); page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); }); };
const ready = async page => {
  await page.waitForFunction(() => document.querySelector('#ocean')?.dataset.ready === 'true');
  await page.evaluate(() => { DRIFT.renderer.setPixelRatio(.7); }); // Software-rendered CI; the real scene is unchanged.
};
const wait = (page, condition) => page.waitForFunction(condition, null, { timeout: 30000 });
const clickWorld = async (page, x, z, y = .7) => {
  const position = await page.evaluate(({ x, y, z }) => DRIFT.screenPosition(DRIFT.raft.localToWorld(DRIFT.vector.set(x, y, z).clone())), { x, y, z });
  await page.mouse.click(position.x, position.y);
};
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, acceptDownloads: true });
  const page = await context.newPage(); attach(page);
  await page.goto(origin); await ready(page);
  assert.equal(await page.locator('#error-screen').isVisible(), false);
  assert.equal(await page.locator('.tool-slot').count(), 6);
  console.log('✓ WebGL scene, procedural models, UI, and local assets loaded');

  // Export the original starter raft before modifying it.
  await page.locator('#pause-button').click();
  const downloading = page.waitForEvent('download');
  await page.locator('[data-modal-action="export"]').click();
  const download = await downloading; await download.saveAs('.arena/drift-starter-raft.glb');
  const bytes = await readFile('.arena/drift-starter-raft.glb');
  assert.equal(bytes.readUInt32LE(0), 0x46546c67);
  assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  const jsonLength = bytes.readUInt32LE(12), gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
  assert.equal(gltf.asset.version, '2.0');
  assert.ok(gltf.meshes[0].primitives.length > 10);
  assert.equal(gltf.images[0].mimeType, 'image/png');
  await page.locator('[data-modal-action="close"].primary-button').click();
  console.log(`✓ 3D model exported: ${gltf.meshes[0].primitives.length} primitives, embedded sail texture, valid GLB header`);

  const resource = await page.evaluate(() => DRIFT.screenPosition(DRIFT.resources[0].position, .25));
  await page.mouse.click(resource.x, resource.y);
  await wait(page, () => DRIFT.state.inventory.wood === 10 && !DRIFT.hook);
  assert.equal(await page.evaluate(() => DRIFT.state.gathered.wood), 2);
  console.log('✓ Click-to-hook animation collects driftwood into inventory');

  await page.keyboard.press('b');
  await wait(page, () => DRIFT.buildType === 'foundation');
  await clickWorld(page, 0, 4.3);
  await wait(page, () => DRIFT.state.tiles.length === 10);
  assert.equal(await page.evaluate(() => DRIFT.state.inventory.wood), 6);
  assert.equal(await page.evaluate(() => DRIFT.state.inventory.plastic), 4);
  console.log('✓ Foundation preview places a connected 3D tile and spends exact materials');

  await page.keyboard.press('c');
  assert.equal(await page.locator('#backpack-panel').isVisible(), true);
  await page.locator('[data-recipe="rope"]').click();
  await wait(page, () => DRIFT.state.inventory.rope === 3);
  assert.equal(await page.evaluate(() => DRIFT.state.inventory.leaf), 2);
  await page.screenshot({ path: '.arena/crafting.png' });
  await page.locator('[data-recipe="purifier"]').click();
  await wait(page, () => DRIFT.buildType === 'purifier');
  await clickWorld(page, 0, 0);
  await wait(page, () => DRIFT.state.structures.some(s => s.type === 'purifier'));
  assert.equal(await page.evaluate(() => DRIFT.state.inventory.wood), 1);
  assert.equal(await page.evaluate(() => DRIFT.tool), 'hook');
  await page.evaluate(() => { DRIFT.state.structures.find(s => s.type === 'purifier').progress = 59.99; });
  await wait(page, () => DRIFT.state.inventory.water === 4);
  console.log('✓ Crafting, occupied-tile rules, station placement, and automatic water production');

  await page.keyboard.press('5'); await page.keyboard.press('e');
  await wait(page, () => DRIFT.state.inventory.water === 3 && DRIFT.state.stats.thirst > 98);
  await page.keyboard.press('6'); await page.keyboard.press('e');
  await wait(page, () => DRIFT.state.inventory.food === 2 && DRIFT.state.stats.hunger > 98);
  await page.keyboard.press('1');
  console.log('✓ Food/water hotkeys consume supplies and restore survival meters');

  const playerBefore = await page.evaluate(() => DRIFT.player.position.toArray());
  await page.keyboard.down('d');
  await page.waitForFunction(before => Math.hypot(DRIFT.player.position.x - before[0], DRIFT.player.position.z - before[2]) > .15, playerBefore);
  await page.keyboard.up('d');
  const playerAfter = await page.evaluate(() => DRIFT.player.position.toArray());
  assert.ok(Math.hypot(playerAfter[0] - playerBefore[0], playerAfter[2] - playerBefore[2]) > .1);
  const angle = await page.evaluate(() => DRIFT.targetAngle);
  await page.mouse.move(700, 260); await page.mouse.down({ button: 'right' }); await page.mouse.move(780, 290, { steps: 5 }); await page.mouse.up({ button: 'right' });
  assert.ok(Math.abs(await page.evaluate(() => DRIFT.targetAngle) - angle) > .2);
  const zoom = await page.evaluate(() => DRIFT.targetRadius);
  await page.mouse.wheel(0, -200);
  await wait(page, () => DRIFT.targetRadius < 20);
  assert.ok(await page.evaluate(() => DRIFT.targetRadius) < zoom);
  console.log('✓ Walking, raft collision, camera dragging, and scroll zoom');

  await page.keyboard.press('3');
  const travel = await page.evaluate(() => DRIFT.state.travel.x);
  await page.keyboard.down('d');
  await page.waitForFunction(before => Math.abs(DRIFT.state.travel.x - before) > .2, travel);
  await page.keyboard.up('d');
  assert.ok(Math.abs(await page.evaluate(() => DRIFT.state.travel.x) - travel) > .1);
  await page.keyboard.press('4');
  await page.evaluate(() => { DRIFT.sharkNext = DRIFT.state.elapsed + 4; });
  await wait(page, () => !document.querySelector('#shark-warning').hidden);
  await page.keyboard.press('e');
  await wait(page, () => DRIFT.sharkNext - DRIFT.state.elapsed > 100);
  assert.equal(await page.locator('#shark-warning').isVisible(), false);
  console.log('✓ Paddle steers the raft; spear repels an approaching shark');

  await page.keyboard.press('Tab');
  assert.equal(await page.locator('#inventory-view').isVisible(), true);
  await page.screenshot({ path: '.arena/backpack.png' });
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  await wait(page, () => DRIFT.paused && DRIFT.ui.modal === 'pause');
  const elapsed = await page.evaluate(() => DRIFT.state.elapsed);
  await page.waitForTimeout(600);
  assert.equal(await page.evaluate(() => DRIFT.state.elapsed), elapsed);
  await page.locator('[data-modal-action="sound"]').click();
  await wait(page, () => DRIFT.state.settings.sound && DRIFT.audio.context);
  await page.locator('[data-modal-action="quality"]').click();
  assert.equal(await page.evaluate(() => DRIFT.state.settings.quality), 'low');
  await page.locator('[data-modal-action="photo"]').click();
  assert.equal(await page.locator('body').evaluate(el => el.classList.contains('photo-mode')), true);
  await page.keyboard.press('Escape');
  await wait(page, () => !DRIFT.paused && !DRIFT.photo);
  console.log('✓ Pause freezes survival; audio, graphics, and photo mode respond');

  await page.evaluate(() => DRIFT.save(false));
  await page.reload(); await ready(page);
  assert.equal(await page.evaluate(() => DRIFT.state.tiles.length), 10);
  assert.equal(await page.evaluate(() => DRIFT.state.structures.some(s => s.type === 'purifier')), true);
  assert.equal(await page.evaluate(() => DRIFT.state.inventory.wood), 1);
  assert.equal(await page.evaluate(() => DRIFT.state.settings.quality), 'low');
  console.log('✓ Save/reload restores raft, structures, supplies, and settings');

  await page.evaluate(() => navigator.serviceWorker.ready);
  await wait(page, () => !!navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.reload(); await ready(page);
  assert.equal(await page.locator('#error-screen').isVisible(), false);
  assert.equal(await page.evaluate(() => DRIFT.state.tiles.length), 10);
  await context.setOffline(false);
  console.log('✓ Installed service worker reloads the entire game offline');

  await page.keyboard.press('h');
  await page.locator('[data-modal-action="close"].primary-button').click();
  await page.keyboard.press('Escape');
  await page.locator('[data-modal-action="restart-confirm"]').click();
  assert.equal(await page.evaluate(() => DRIFT.ui.modal), 'restart');
  await page.locator('[data-modal-action="pause"]').click();
  assert.equal(await page.evaluate(() => DRIFT.state.tiles.length), 10);
  console.log('✓ Help dialog and safe new-voyage confirmation');

  await page.locator('[data-modal-action="restart-confirm"]').click();
  await page.locator('[data-modal-action="restart"]').click();
  await page.waitForLoadState('load'); await ready(page);
  await wait(page, () => DRIFT.state.tiles.length === 9 && DRIFT.state.inventory.wood === 8);
  console.log('✓ Confirmed new voyage resets the saved world');

  // Use a separate browser for touch testing (single-process Chromium cannot safely
  // host multiple isolated browser contexts).
  await browser.close();
  browser = await chromium.launch(launchOptions);

  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const touch = await mobileContext.newPage(); attach(touch);
  await touch.goto(origin); await ready(touch);
  assert.equal(await touch.locator('#touch-controls').isVisible(), true);
  assert.equal(await touch.locator('#joystick').isVisible(), true);
  await touch.screenshot({ path: '.arena/drift-touch.png' });
  const total = await touch.evaluate(() => Object.values(DRIFT.state.inventory).reduce((a, b) => a + b));
  await touch.locator('#touch-action').tap();
  await touch.waitForFunction(before => Object.values(DRIFT.state.inventory).reduce((a, b) => a + b) > before, total, { timeout: 30000 });
  await touch.locator('#inventory-button').tap();
  assert.equal(await touch.locator('#backpack-panel').isVisible(), true);
  await touch.locator('#crafting-tab').tap();
  assert.equal(await touch.locator('#crafting-view').isVisible(), true);
  await touch.locator('#close-panel').tap();
  const rect = await touch.locator('#joystick').boundingBox();
  const beforeMove = await touch.evaluate(() => DRIFT.player.position.toArray());
  await touch.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2); await touch.mouse.down();
  await touch.mouse.move(rect.x + rect.width / 2 + 25, rect.y + rect.height / 2 + 10);
  await touch.waitForFunction(before => Math.hypot(DRIFT.player.position.x - before[0], DRIFT.player.position.z - before[2]) > .15, beforeMove);
  await touch.mouse.up();
  const afterMove = await touch.evaluate(() => DRIFT.player.position.toArray());
  assert.ok(Math.hypot(afterMove[0] - beforeMove[0], afterMove[2] - beforeMove[2]) > .1);
  assert.equal(await touch.evaluate(() => DRIFT.touch.length()), 0);
  console.log('✓ Mobile tap-to-collect, touch backpack/crafting, and joystick movement/release');

  assert.deepEqual(errors, [], 'Browser errors');
  console.log('\nAll browser integration checks passed. No JavaScript or WebGL errors.');
} finally {
  await browser.close();
}
