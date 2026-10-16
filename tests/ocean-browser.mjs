// Living-ocean integration checks. Run with the local server already running.
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';

await mkdir('.arena', { recursive: true });
const args = ['--no-sandbox', '--no-zygote', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
if (process.env.BROWSER_SINGLE_PROCESS) args.push('--single-process');
const options = { executablePath: process.env.BROWSER_EXECUTABLE_PATH || undefined, args, headless: true };
const origin = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000/drift.html';
const errors = [];
const attach = page => {
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
};
const wait = (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: 60000 });
const ready = page => wait(page, () => document.querySelector('#ocean')?.dataset.ready === 'true');
let browser = await chromium.launch(options);
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true });
  attach(page); await page.goto(origin); await ready(page);
  await page.evaluate(() => document.fonts.ready);
  await wait(page, () => DRIFT.world.ocean.uniforms.uReflectionReady.value === 1);
  await wait(page, () => getComputedStyle(document.getElementById('loading')).visibility === 'hidden');
  await page.screenshot({ path: '.arena/living-ocean-final.png' });
  await page.evaluate(() => DRIFT.renderer.setPixelRatio(.45));
  assert.equal(await page.locator('#error-screen').isVisible(), false);
  assert.equal(await page.evaluate(() => Object.values(DRIFT.world.surface).every(Number.isFinite)), true);
  console.log('✓ Displaced water, shared buoyancy, scene reflections, and tropical scenery render');

  await page.locator('#view-button').click();
  await wait(page, () => DRIFT.cameraMode === 'deck' && !DRIFT.player.visible && DRIFT.viewRig.visible);
  assert.equal(await page.evaluate(() => DRIFT.camera.fov), 68);
  assert.equal(await page.locator('#view-button').getAttribute('aria-pressed'), 'true');
  const oldPitch = await page.evaluate(() => DRIFT.targetDeckPitch);
  await page.mouse.move(630, 390); await page.mouse.down();
  await page.mouse.move(530, 430, { steps: 4 }); await page.mouse.up();
  assert.ok(await page.evaluate(() => DRIFT.targetDeckPitch) > oldPitch);
  const radius = await page.evaluate(() => DRIFT.targetRadius);
  await page.mouse.wheel(0, -300);
  assert.equal(await page.evaluate(() => DRIFT.targetRadius), radius);
  const before = await page.evaluate(() => DRIFT.player.position.toArray());
  await page.keyboard.down('d');
  await wait(page, value => Math.hypot(DRIFT.player.position.x - value[0], DRIFT.player.position.z - value[2]) > .15, before);
  await page.keyboard.up('d');
  const supplies = await page.evaluate(() => Object.values(DRIFT.state.inventory).reduce((a, b) => a + b, 0));
  await page.keyboard.press('e');
  await wait(page, value => !DRIFT.hook && Object.values(DRIFT.state.inventory).reduce((a, b) => a + b, 0) > value, supplies);
  console.log('✓ First-person camera, drag-to-look, on-deck walking, and hook collection');

  await page.keyboard.press('b');
  await wait(page, () => DRIFT.cameraMode === 'orbit' && DRIFT.buildType === 'foundation');
  await page.locator('#pause-button').click();
  await page.locator('[data-modal-action="view"]').click();
  assert.deepEqual(await page.evaluate(() => [DRIFT.cameraMode, DRIFT.buildType, DRIFT.tool]), ['deck', null, 'hook']);
  for (const sea of ['rough', 'calm', 'rolling']) {
    await page.locator('[data-modal-action="sea"]').click();
    assert.equal(await page.evaluate(() => DRIFT.state.settings.sea), sea);
  }
  await page.locator('[data-modal-action="sea"]').click();
  await wait(page, () => DRIFT.world.ocean.uniforms.uStrength.value === 1.45);
  console.log('✓ Building returns to overview; paused view changes safely cancel previews; three sea states');

  const downloading = page.waitForEvent('download', { timeout: 60000 });
  await page.locator('[data-modal-action="export-island"]').click();
  const download = await downloading;
  assert.equal(download.suggestedFilename(), 'palmwood-cove.glb');
  await download.saveAs('.arena/palmwood-cove.glb');
  const bytes = await readFile('.arena/palmwood-cove.glb');
  assert.equal(bytes.readUInt32LE(0), 0x46546c67);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  assert.ok(gltf.meshes[0].primitives.some(p => p.attributes.COLOR_0 !== undefined));
  assert.ok(gltf.images.length >= 3);
  assert.equal(gltf.nodes[0].name, 'Palmwood Cove — tropical island and shelter');
  console.log(`✓ Tropical island GLB export: ${bytes.length} bytes, vertex colors and ${gltf.images.length} embedded textures`);
  await page.locator('[data-modal-action="close"].primary-button').click();

  await page.keyboard.press('g');
  assert.equal(await page.evaluate(() => !!DRIFT.course && DRIFT.tool === 'paddle'), true);
  await page.keyboard.down('a'); await wait(page, () => !DRIFT.course); await page.keyboard.up('a');
  await page.keyboard.press('g'); await wait(page, () => !!DRIFT.course);
  await page.keyboard.press('g'); await wait(page, () => !DRIFT.course);
  const wood = await page.evaluate(() => DRIFT.state.inventory.wood);
  await page.locator('#island-course').click();
  // Software WebGL runs much slower than a GPU; wait for arrival, not wall-clock travel.
  await page.waitForFunction(() => !DRIFT.course && DRIFT.state.discovered.includes(-20), null, { timeout: 180000 });
  assert.equal(await page.evaluate(() => DRIFT.tool), 'hook');
  assert.equal(await page.evaluate(() => DRIFT.state.inventory.wood), wood + 8);
  assert.equal(await page.evaluate(() => DRIFT.state.discovered.filter(id => id === -20).length), 1);
  const distance = await page.evaluate(() => Math.hypot(DRIFT.state.travel.x + 20, DRIFT.state.travel.z + 32));
  assert.ok(distance > 21 && distance < 22.5);
  await page.locator('#island-course').click();
  assert.equal(await page.evaluate(() => DRIFT.course), null);
  assert.equal(await page.evaluate(() => DRIFT.state.inventory.wood), wood + 8);
  console.log('✓ Set course, keyboard/manual cancellation, safe arrival, and one-time island rewards');

  // An unobstructed deck viewpoint for visual review; it remains within the raft.
  await page.evaluate(() => {
    DRIFT.player.position.set(1.35, .58, -.75);
    DRIFT.targetAngle = DRIFT.cameraAngle = .64;
    DRIFT.targetDeckPitch = DRIFT.deckPitch = -.05;
    DRIFT.renderer.setPixelRatio(1);
  });
  await wait(page, () => DRIFT.camera.position.x > 1);
  await page.screenshot({ path: '.arena/palmwood-deck-final.png' });
  await page.evaluate(() => { DRIFT.save(false); DRIFT.renderer.setPixelRatio(.45); });
  await page.reload(); await ready(page);
  assert.equal(await page.evaluate(() => DRIFT.cameraMode), 'deck');
  assert.equal(await page.evaluate(() => DRIFT.state.settings.sea), 'rough');
  assert.equal(await page.evaluate(() => DRIFT.state.discovered.includes(-20)), true);
  await page.evaluate(() => DRIFT.renderer.setPixelRatio(.45));
  await page.keyboard.press('p');
  await wait(page, () => DRIFT.photo && !DRIFT.viewRig.visible);
  await page.keyboard.press('Escape'); await wait(page, () => !DRIFT.photo && DRIFT.viewRig.visible);
  await page.keyboard.press('v'); await wait(page, () => DRIFT.cameraMode === 'orbit' && DRIFT.player.visible);
  console.log('✓ Ocean/deck preferences persist, photo mode hides the held tool, and overview restores the avatar');

  await browser.close(); browser = await chromium.launch(options);
  const touch = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  attach(touch); await touch.goto(origin); await ready(touch);
  const overlap = await touch.evaluate(() => {
    const ids = ['view-button', 'inventory-button', 'touch-action', 'joystick', 'hotbar'];
    const boxes = ids.map(id => document.getElementById(id).getBoundingClientRect());
    return boxes.some((a, i) => boxes.some((b, j) => j > i && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top));
  });
  assert.equal(overlap, false, 'Touch controls must not overlap');
  await touch.locator('#view-button').tap();
  await wait(touch, () => DRIFT.cameraMode === 'deck' && DRIFT.viewRig.visible);
  const hand = await touch.evaluate(() => DRIFT.screenPosition(DRIFT.viewRig.getWorldPosition(DRIFT.vector)));
  assert.ok(hand.x > 195 && hand.x < 380, 'Held tool stays in view on portrait screens');
  const toastCoversControls = await touch.evaluate(() => {
    const a = document.getElementById('toasts').getBoundingClientRect(), b = document.getElementById('view-button').getBoundingClientRect();
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  });
  assert.equal(toastCoversControls, false);
  await touch.screenshot({ path: '.arena/living-ocean-touch-deck.png' });
  await touch.setViewportSize({ width: 844, height: 390 });
  await touch.locator('#pause-button').tap();
  assert.equal(await touch.locator('[data-modal-action="sea"]').isVisible(), true);
  await touch.locator('[data-modal-action="close"].primary-button').tap();
  await touch.locator('#view-button').tap();
  await wait(touch, () => DRIFT.cameraMode === 'orbit');
  console.log('✓ Touch deck switching, non-overlapping portrait controls, and landscape settings');
  assert.deepEqual(errors, [], 'JavaScript or WebGL errors');
  console.log('\nAll living-ocean browser checks passed without JavaScript or WebGL errors.');
} catch (error) {
  for (const context of browser.contexts()) for (const page of context.pages()) {
    console.error('State at failure:', await page.evaluate(() => window.DRIFT && ({ position: DRIFT.state.travel, course: DRIFT.course?.name, keys: [...DRIFT.keys], paused: DRIFT.paused, hidden: document.hidden, frames: DRIFT.frameCount, time: DRIFT.state.elapsed, discoveries: DRIFT.state.discovered, tool: DRIFT.tool })).catch(() => null));
  }
  throw error;
} finally { await browser.close(); }
