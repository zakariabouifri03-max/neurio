// Real-browser integration tests for RABONA (including WebGL)
import { chromium } from '@playwright/test';
import bundled, { inflate } from '@sparticuz/chromium';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
await inflate('node_modules/@sparticuz/chromium/bin/al2023.tar.br');
const browser = await chromium.launch({
  executablePath: process.env.BROWSER_EXECUTABLE || await bundled.executablePath(),
  args: bundled.args,
  headless: true,
  env: { ...process.env, LD_LIBRARY_PATH: [join(tmpdir(), 'al2023', 'lib'), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') }
});
const base = process.env.TEST_URL || 'http://127.0.0.1:8000';
const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(60000);
await page.addInitScript(() => {
  if (!localStorage.getItem('rabona-settings-v1')) localStorage.setItem('rabona-settings-v1', JSON.stringify({ quality:'performance', sound:false }));
});
const errors = [];
page.on('pageerror', e=>errors.push(e.message));
page.on('console', m=>{ if(m.type()==='error') errors.push(m.text()); });
const screenshots = process.env.SCREENSHOTS==='1';
await mkdir('.cache/screenshots', { recursive:true });
const shot = async name => { if(screenshots) await page.screenshot({ path: `.cache/screenshots/${name}.png`, timeout:90000 }); };

const runtime = () => page.evaluate(async()=>{
  const { game, renderer } = await import('/src/rabona/main.js');
  return { state: game.state, score: `${game.scoreBlue}-${game.scoreRed}`, time: game.time, calls: renderer.info.render.calls, ball: [game.ball.x, game.ball.y, game.ball.z], players: game.players.length };
});

try {
  await page.goto(`${base}/?test=1`, { waitUntil:'networkidle' });
  await page.waitForFunction(()=>document.getElementById('loading').hidden);
  assert.equal(await page.locator('#graphics-error').isVisible(), false);
  assert.equal((await runtime()).state, 'lobby');
  assert.equal(await page.locator('#scene canvas').count(), 1);
  console.log('PASS: real 3D lobby', await runtime());
  await shot('lobby');

  await page.locator('[data-view="garage"]').click();
  assert.equal(await page.locator('.team-cards').isVisible(), true);
  await shot('garage');
  await page.locator('#garage-save').click();

  await page.locator('[data-view="guide"]').click();
  assert.equal(await page.locator('.controls-grid').isVisible(), true);
  await page.locator('#guide-ready').click();

  await page.locator('#settings-btn').click();
  await page.locator('#volume').fill('0');
  await page.locator('#settings-save').click();
  const saved = await page.evaluate(()=>JSON.parse(localStorage.getItem('rabona-settings-v1')));
  assert.equal(saved.volume, 0);
  console.log('PASS: garage, guide, settings persistence');

  // start match
  await page.locator('#play-btn').click();
  await page.waitForFunction(async()=>{
    const { game } = await import('/src/rabona/main.js');
    return game.state==='playing';
  });
  assert.equal((await runtime()).state, 'playing');
  console.log('PASS: kickoff');

  // test movement via keyboard
  await page.keyboard.down('w');
  await page.waitForFunction(async()=>{
    const { game } = await import('/src/rabona/main.js');
    return Math.hypot(game.activePlayer.vx, game.activePlayer.vz) > 1;
  }, { timeout:10000 });
  await page.keyboard.up('w');

  // test kick
  const kickWorks = await page.evaluate(async()=>{
    const { game } = await import('/src/rabona/main.js');
    // place ball near player
    game.ball.x = game.activePlayer.x + Math.sin(game.activePlayer.angle)*1.0;
    game.ball.z = game.activePlayer.z + Math.cos(game.activePlayer.angle)*1.0;
    game.ball.y = 0.43;
    game.ball.vx=0; game.ball.vy=0; game.ball.vz=0;
    game.tryKick(false);
    return game.ball.vx!==0 || game.ball.vz!==0 || game.ball.vy>0;
  });
  assert.equal(kickWorks, true);
  console.log('PASS: movement and kick');

  // test rabona
  await page.evaluate(async()=>{
    const { game } = await import('/src/rabona/main.js');
    game.kickCooldown=0;
    game.activePlayer.state='idle';
    game.activePlayer.stateTimer=0;
    game.ball.x = game.activePlayer.x + Math.sin(game.activePlayer.angle)*1.0;
    game.ball.z = game.activePlayer.z + Math.cos(game.activePlayer.angle)*1.0;
    game.ball.y = 0.43;
    game.ball.vx=0; game.ball.vy=0; game.ball.vz=0;
  });
  const rabonaWorks = await page.evaluate(async()=>{
    const { game } = await import('/src/rabona/main.js');
    game.tryKick(true);
    return game.activePlayer.state==='rabona';
  });
  assert.equal(rabonaWorks, true);
  console.log('PASS: rabona kick animation');

  // reset for slide
  await page.evaluate(async()=>{
    const { game } = await import('/src/rabona/main.js');
    game.activePlayer.state='idle';
    game.activePlayer.stateTimer=0;
  });
  // test slide
  await page.keyboard.press('Space');
  const slideWorks = await page.evaluate(async()=>{
    const { game } = await import('/src/rabona/main.js');
    return game.activePlayer.state==='slide';
  });
  assert.equal(slideWorks, true);
  console.log('PASS: slide tackle');

  // let some time pass and check ball physics and AI
  await page.evaluate(async()=>{
    const { game } = await import('/src/rabona/main.js');
    for(let i=0;i<60;i++) game.update(0.05);
  });
  const afterSim = await runtime();
  assert.ok(afterSim.time > 2);
  console.log('PASS: simulation advances', afterSim);

  // test goal detection by placing ball in goal
  const goalTest = await page.evaluate(async()=>{
    const { game } = await import('/src/rabona/main.js');
    game.ball.x = 35.2;
    game.ball.y = 0.5;
    game.ball.z = 0;
    game.ball.vx=0; game.ball.vy=0; game.ball.vz=0;
    game.update(0.05);
    return { state: game.state, scoreBlue: game.scoreBlue, scoreRed: game.scoreRed };
  });
  // should have triggered goal
  assert.ok(goalTest.scoreBlue===1 || goalTest.scoreRed===1 || goalTest.state==='goal');
  console.log('PASS: goal detection', goalTest);

  // wait for goal reset
  await page.evaluate(async()=>{
    const { game } = await import('/src/rabona/main.js');
    for(let i=0;i<60;i++) game.update(0.05);
  });

  // pause/resume
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(async()=>(await import('/src/rabona/main.js')).game.state), 'paused');
  await page.locator('#resume-btn').click();
  assert.equal(await page.evaluate(async()=>(await import('/src/rabona/main.js')).game.state), 'playing');

  // touch controls
  const touchWorks = await page.evaluate(async()=>{
    const { game } = await import('/src/rabona/main.js');
    const btn = document.getElementById('touch-left');
    const cap = btn.setPointerCapture; btn.setPointerCapture=()=>{};
    btn.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:9}));
    const down = game.touch.left;
    btn.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:9}));
    btn.setPointerCapture=cap;
    return down;
  });
  assert.equal(touchWorks, true);

  await page.keyboard.press('Escape');
  await page.locator('#quit-btn').click();
  assert.equal((await runtime()).state, 'lobby');
  console.log('PASS: pause, touch, exit to lobby');

  // finish test by forcing time end
  await page.locator('#play-btn').click();
  await page.evaluate(async()=>{
    const { game } = await import('/src/rabona/main.js');
    game.update(0.1);
    game.time = 89.5;
    game.update(0.6);
  });
  const finished = await page.evaluate(async()=>(await import('/src/rabona/main.js')).game.state);
  assert.equal(finished, 'finished');
  console.log('PASS: match finish');

  await page.locator('#play-again').click();
  assert.equal(await page.evaluate(async()=>(await import('/src/rabona/main.js')).game.state), 'playing');
  await page.keyboard.press('Escape');
  await page.locator('#quit-btn').click();

  // mobile layout
  await page.setViewportSize({ width:390, height:844 });
  await shot('mobile-lobby');
  const bounds = await page.locator('#play-btn').boundingBox();
  assert.ok(bounds.x>=0 && bounds.x+bounds.width<=390);
  assert.equal(await page.evaluate(()=>document.body.scrollWidth>innerWidth), false);

  await page.reload({ waitUntil:'networkidle' });
  await page.waitForFunction(()=>document.getElementById('loading').hidden);
  const restored = await page.evaluate(async()=>{
    const { config } = await import('/src/rabona/main.js');
    return { volume: config.volume };
  });
  assert.equal(restored.volume, 0);
  assert.deepEqual(errors, []);
  console.log('PASS: mobile layout, reload persistence, zero errors');

} finally {
  await browser.close();
}
