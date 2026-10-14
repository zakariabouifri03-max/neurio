// ── End-to-end check for the Giant Worlds page ──────────────────────────────
// Runs the real page in headless Chrome (SwiftShader WebGL), drives the
// explorer, travels between planets and builds all 100 worlds once.
//
//   node tools/verify-worlds.mjs [url]
//
// Exits non-zero if anything fails.

import fs from 'node:fs';
import puppeteer from 'puppeteer';

const URL = process.argv[2] || 'http://127.0.0.1:8000/worlds/index.html';
const SHOTS = process.env.SHOTS || '/tmp/gw';
// CHROME=/path/to/chrome if your browser lives somewhere unusual
const EXEC = process.env.CHROME || ['/tmp/chromium', '/usr/bin/chromium', '/usr/bin/google-chrome']
  .find((p) => fs.existsSync(p));
const errors = [];
const logs = [];
const warnings = [];
let pass = 0, fail = 0;

const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

const browser = await puppeteer.launch({
  headless: true,
  executablePath: EXEC,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-gl=angle',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
const WARN_ONLY = /ERR_CONNECTION_CLOSED|fonts\.googleapis|net::ERR_/;   // sandbox has no external CDN
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => {
  const t = m.text();
  logs.push(`${m.type()}: ${t}`);
  if (m.type() === 'error' && !WARN_ONLY.test(t)) errors.push('console: ' + t);
  if (m.type() === 'error' && WARN_ONLY.test(t)) warnings.push(t);
});

console.log(`\n→ ${URL}`);
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 90000 });
await page.waitForFunction('window.GW && window.GW.scene3d', { timeout: 120000, polling: 250 });
await new Promise((r) => setTimeout(r, 2500));

// ── 1. the world that loads at start ───────────────────────────────────────
const start = await page.evaluate(() => {
  const g = window.GW, w = g.scene3d, e = g.explorer;
  return {
    planets: g.PLANETS.length,
    index: w.planet.index, name: w.planet.name, biome: w.planet.biome,
    giants: w.stats.giants, tris: w.stats.tris, tallest: w.tallest,
    colliders: w.colliders.length,
    pos: { x: e.pos.x, y: e.pos.y, z: e.pos.z },
    ground: w.terrain.heightAt(e.pos.x, e.pos.z),
    nearest: e.nearestPlant(),
    fps: g.fps,
    mapCards: document.getElementById('mapGrid').children.length,
    hud: document.getElementById('hudPlanet').textContent,
    bootGone: document.getElementById('boot').classList.contains('gone'),
  };
});
console.log('\n[1] starting world');
ok('100 planets in the catalogue', start.planets === 100, `${start.planets}`);
ok('star map lists 100 worlds', start.mapCards === 100, `${start.mapCards} cards`);
ok('landed immediately (no menu)', start.bootGone === true, start.hud);
ok('forest is populated', start.giants > 40, `${start.giants} giants, ${start.colliders} colliders`);
ok('plants are life-size giants', start.tallest > 20, `tallest ${start.tallest.toFixed(1)} m`);
ok('explorer stands on the ground', Math.abs(start.pos.y - 1.7 - start.ground) < 0.35,
  `feet at ${(start.pos.y - 1.7).toFixed(2)} m, terrain ${start.ground.toFixed(2)} m`);
ok('nearest giant is reported', !!start.nearest && start.nearest.h > 5,
  start.nearest ? `${start.nearest.label} ${start.nearest.h.toFixed(1)} m @ ${start.nearest.dist.toFixed(0)} m` : 'none');
ok('frame loop is running', start.fps > 1, `${start.fps.toFixed(0)} fps (software GL)`);

// ── 2. walking, jumping, flying ────────────────────────────────────────────
console.log('\n[2] movement  (physics driven at a fixed 60 Hz so it is not at the mercy of software-GL frame rate)');
const mv = await page.evaluate(() => {
  const g = window.GW, w = g.scene3d, e = g.explorer;
  g.mapOpen = true;                       // pause the render loop so only we step physics
  const step = (n, dt = 1 / 60) => { for (let i = 0; i < n; i++) e.update(dt); };

  // stand in an open clearing, on the ground, facing open ground
  let best = null;
  for (let i = 0; i < 900; i++) {
    const x = (i % 30) * 20 - 290, z = Math.floor(i / 30) * 20 - 290;
    let d = 1e9;
    for (const c of w.colliders) d = Math.min(d, Math.hypot(c.x - x, c.z - z) - c.r);
    if (w.terrain.slopeAt(x, z) < 0.22 && (!best || d > best.d)) best = { x, z, d };
  }
  const stand = () => {
    e.toggleFly(false);
    e.pos.set(best.x, w.terrain.heightAt(best.x, best.z) + 1.7, best.z);
    e.yaw = 0; e.pitch = 0; e.vel.set(0, 0, 0); e.grounded = true;
    step(2);
  };
  const out = { open: best.d };

  // walk 1.6 s
  stand();
  const p0 = e.pos.clone();
  e.keys.add('w'); step(96); e.keys.delete('w');
  out.walked = Math.hypot(e.pos.x - p0.x, e.pos.z - p0.z);
  out.walkSpeed = e.lastSpeed * 3.6;
  out.onGroundWhileWalking = Math.abs(e.pos.y - 1.7 - w.terrain.heightAt(e.pos.x, e.pos.z)) < 0.3;

  // sprint 1.6 s
  stand();
  const p1 = e.pos.clone();
  e.keys.add('w'); e.keys.add('shift'); step(96); e.keys.delete('w'); e.keys.delete('shift');
  out.sprinted = Math.hypot(e.pos.x - p1.x, e.pos.z - p1.z);

  // jump: 3 simulated seconds
  stand();
  const y0 = e.pos.y;
  e.jump();
  let peak = y0;
  for (let i = 0; i < 180; i++) { e.update(1 / 60); peak = Math.max(peak, e.pos.y); }
  out.jumpRise = peak - y0;
  out.landedAgain = e.grounded;
  out.gravity = e.gravity;

  // flight: 3 simulated seconds of "space"
  stand();
  const fy0 = e.pos.y;
  e.toggleFly(true); e.keys.add(' ');
  for (let i = 0; i < 180; i++) e.update(1 / 60);
  e.keys.delete(' ');
  out.climb = e.pos.y - fy0;
  out.altitude = e.pos.y - w.terrain.heightAt(e.pos.x, e.pos.z);
  out.tallest = w.tallest;
  e.toggleFly(false);

  // stand 25 m from a trunk, aim at it, sprint into it for 6 simulated seconds
  e.toggleFly(false);
  const c = w.colliders[Math.floor(w.colliders.length / 2)];
  const ang = 0.7;
  const sx = c.x + Math.cos(ang) * 25, sz = c.z + Math.sin(ang) * 25;
  e.pos.set(sx, w.terrain.heightAt(sx, sz) + 1.7, sz);
  e.vel.set(0, 0, 0); e.grounded = true;
  e.yaw = Math.atan2(-(c.x - e.pos.x), -(c.z - e.pos.z));
  step(2);
  e.keys.add('w'); e.keys.add('shift');
  for (let i = 0; i < 360; i++) e.update(1 / 60);
  e.keys.delete('w'); e.keys.delete('shift');
  out.stopGap = Math.hypot(e.pos.x - c.x, e.pos.z - c.z) - c.r;
  out.trunkR = c.r;
  out.travelled = Math.hypot(e.pos.x - sx, e.pos.z - sz);
  g.mapOpen = false;
  return out;
});
ok('WASD walks you forward at a real walking pace', mv.walked > 1.8 && mv.walked < 4,
  `${mv.walked.toFixed(2)} m in 1.6 s = ${mv.walkSpeed.toFixed(1)} km/h`);
ok('you stay on the terrain while walking', mv.onGroundWhileWalking === true);
ok('sprint is faster than walking', mv.sprinted > mv.walked * 1.8,
  `${mv.sprinted.toFixed(2)} m vs ${mv.walked.toFixed(2)} m`);
ok('jump lifts you against planet gravity', mv.jumpRise > 0.5 && mv.landedAgain,
  `+${mv.jumpRise.toFixed(2)} m at ${mv.gravity.toFixed(1)} m/s², landed again`);
ok('flight suit climbs above the giants', mv.climb > 25 && mv.altitude > mv.tallest * 0.4,
  `+${mv.climb.toFixed(0)} m in 3 s, altitude ${mv.altitude.toFixed(0)} m (tallest plant ${mv.tallest.toFixed(0)} m)`);
ok('trunk collision stops you (no walking through trees)', mv.stopGap > 0 && mv.stopGap < 1.2,
  `sprinted ${mv.travelled.toFixed(1)} m, stopped ${mv.stopGap.toFixed(2)} m off a ${mv.trunkR.toFixed(1)} m-radius trunk`);

// ── 3. travel to another planet ────────────────────────────────────────────
console.log('\n[3] travel');
await page.screenshot({ path: `${SHOTS}-start.jpg`, type: 'jpeg', quality: 88 });
await page.evaluate(() => window.GW.travelTo(42));
await page.waitForFunction('window.GW.scene3d.planet.index === 42 && !window.GW.busy', { timeout: 60000 });
await new Promise((r) => setTimeout(r, 1500));
const landed = await page.evaluate(() => {
  const g = window.GW, w = g.scene3d;
  return {
    index: w.planet.index, name: w.planet.name, biome: w.planet.biome, night: w.planet.night,
    giants: w.stats.giants, tallest: w.tallest, gravity: w.planet.gravity,
    visited: g.visited.size,
    hud: document.getElementById('hudPlanet').textContent,
    hereCard: !!document.querySelector('.pcard.here'),
  };
});
ok('travelled to world 42', landed.index === 42, `${landed.hud} — ${landed.biome}`);
ok('new world has its own forest', landed.giants > 40, `${landed.giants} giants, tallest ${landed.tallest.toFixed(0)} m`);
ok('HUD follows the traveller', landed.hud.startsWith('042'), landed.hud);
ok('star map marks where you are', landed.hereCard === true);
ok('explored counter grows', landed.visited >= 2, `${landed.visited} / 100`);
await page.screenshot({ path: `${SHOTS}-p42.jpg`, type: 'jpeg', quality: 88 });

// ── 4. every one of the 100 planets builds ─────────────────────────────────
console.log('\n[4] all 100 worlds');
const all = await page.evaluate(() => window.GW.probeAll());
const bad = all.filter((r) => !r.giants || r.giants < 20 || !isFinite(r.tallest) || r.tallest < 5);
const biomes = new Set(all.map((r) => r.biome));
ok('all 100 built', all.length === 100, `${all.length} worlds`);
ok('every world has giants', bad.length === 0, bad.length ? JSON.stringify(bad.slice(0, 3)) : 'min giants ' + Math.min(...all.map((r) => r.giants)));
ok('real-scale heights everywhere', Math.min(...all.map((r) => r.tallest)) > 8,
  `tallest range ${Math.min(...all.map((r) => r.tallest)).toFixed(0)}–${Math.max(...all.map((r) => r.tallest)).toFixed(0)} m`);
ok('varied biomes', biomes.size >= 8, `${biomes.size} biomes: ${[...biomes].join(', ')}`);
console.log('     sample:', all.slice(0, 4).map((r) => `${r.i} ${r.name}(${r.giants}g/${r.tallest}m)`).join('  '));

// ── 5. clean-up check ──────────────────────────────────────────────────────
console.log('\n[5] health');
const mem = await page.evaluate(() => {
  const r = window.GW.renderer;
  return { geo: r.info.memory.geometries, tex: r.info.memory.textures, calls: r.info.render.calls };
});
ok('no runaway GPU memory after 100 builds', mem.geo < 4000, `${mem.geo} geometries, ${mem.tex} textures live`);
ok('scene still renders', mem.calls > 0, `${mem.calls} draw calls`);
ok('no runtime errors', errors.length === 0, errors.slice(0, 3).join(' | ') || 'console clean');
if (warnings.length) console.log(`     (ignored: ${warnings.length} blocked external-CDN requests — fonts.googleapis.com is not reachable in this sandbox)`);

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed`);
if (errors.length) { console.log('\nerrors:\n' + errors.slice(0, 10).join('\n')); }
await browser.close();
process.exit(fail === 0 ? 0 : 1);
