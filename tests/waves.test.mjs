import test from 'node:test';
import assert from 'node:assert/strict';
import { WAVES, WAVE_GLSL, SEA_STATES, ISLANDS, waveAt, raftSurface, surfaceAt, coastDistance, safeWaterPosition } from '../src/raft/waves.js';
import { newGame, sanitizeSave } from '../src/raft/rules.js';

const near = (a, b, tolerance = 1e-6) => assert.ok(Math.abs(a - b) <= tolerance, `${a} differs from ${b}`);

test('the ocean is deterministic, time-dependent, finite, and bounded in every sea state', () => {
  for (const mode of Object.values(SEA_STATES)) {
    const bound = WAVES.reduce((sum, wave) => sum + wave.amplitude * 1.17 * mode.strength, 0);
    for (let i = 0; i < 50; i++) {
      const x = i * 2 - 30, z = i * .73 - 25, time = i * 3.2;
      const sample = waveAt(x, z, time, mode.strength);
      assert.deepEqual(sample, waveAt(x, z, time, mode.strength));
      assert.ok(Object.values(sample).every(Number.isFinite));
      assert.ok(Math.abs(sample.height) <= bound);
    }
  }
  assert.notEqual(waveAt(0, 0, 0).height, waveAt(0, 0, 2).height);
});

test('analytic ocean slopes agree with finite differences away from shore', () => {
  const x = 3.2, z = 5.7, time = 8.2, delta = .0001, sample = waveAt(x, z, time);
  near(sample.dx, (waveAt(x + delta, z, time).height - waveAt(x - delta, z, time).height) / (2 * delta));
  near(sample.dz, (waveAt(x, z + delta, time).height - waveAt(x, z - delta, time).height) / (2 * delta));
});

test('calm water scales down the same waves rather than generating unrelated buoyancy', () => {
  const calm = waveAt(0, 0, 6, SEA_STATES.calm.strength), rough = waveAt(0, 0, 6, SEA_STATES.rough.strength);
  near(rough.height / calm.height, SEA_STATES.rough.strength / SEA_STATES.calm.strength);
  near(rough.dx / calm.dx, SEA_STATES.rough.strength / SEA_STATES.calm.strength);
});

test('the water beneath the raft matches its floating plane and slopes', () => {
  const travel = { x: 2, z: 1 }, time = 7.5, strength = .85, raft = raftSurface(travel.x, travel.z, time, strength);
  for (const [x, z] of [[0, 0], [2, 2], [-2, -2], [0, 3]]) {
    const water = surfaceAt(x, z, time, travel, strength, raft);
    near(water.height, raft.height + raft.dx * x + raft.dz * z);
    near(water.dx, raft.dx); near(water.dz, raft.dz);
  }
});

test('buoyancy blends smoothly into the visible open-water wave field', () => {
  const travel = { x: 0, z: 0 }, time = 14, strength = .85, raft = raftSurface(0, 0, time, strength);
  const raw = waveAt(14, 7, time, strength), water = surfaceAt(14, 7, time, travel, strength, raft);
  near(raw.height, water.height); near(raw.dx, water.dx); near(raw.dz, water.dz);
  const a = surfaceAt(4.5 - .0001, 0, time, travel, strength, raft), b = surfaceAt(4.5 + .0001, 0, time, travel, strength, raft);
  assert.ok(Math.abs(a.height - b.height) < .001);
});

test('CPU wave parameters are generated into the GPU shader, not maintained separately', () => {
  for (const wave of WAVES) {
    assert.ok(WAVE_GLSL.includes(wave.amplitude.toFixed(7)));
    assert.ok(WAVE_GLSL.includes(wave.phase.toFixed(7)));
    assert.ok(WAVE_GLSL.includes(wave.speed.toFixed(7)));
  }
});

test('the irregular coastline is continuous, and old saves cannot spawn inside an island', () => {
  for (const island of ISLANDS) {
    assert.ok(coastDistance(island.x, island.z, island) < 0);
    assert.ok(coastDistance(island.x + island.radius * 2, island.z, island) > 0);
    const position = safeWaterPosition({ x: island.x, z: island.z });
    assert.ok(coastDistance(position.x, position.z, island) > 3);
    assert.ok(Number.isFinite(position.x) && Number.isFinite(position.z));
    const validShore = { x: island.x, z: island.z + island.radius + 5 };
    assert.ok(coastDistance(validShore.x, validShore.z, island) >= 4.6);
    assert.deepEqual(safeWaterPosition(validShore), validShore);
  }
  assert.deepEqual(safeWaterPosition({ x: 0, z: 0 }), { x: 0, z: 0 });
});

test('old saves get safe camera/ocean defaults; new preferences survive reload', () => {
  const old = newGame(); delete old.settings.view; delete old.settings.sea;
  assert.equal(sanitizeSave(old).settings.view, 'orbit');
  assert.equal(sanitizeSave(old).settings.sea, 'rolling');
  old.settings.view = 'deck'; old.settings.sea = 'rough';
  assert.equal(sanitizeSave(old).settings.view, 'deck');
  assert.equal(sanitizeSave(old).settings.sea, 'rough');
  old.settings.view = 'unknown'; old.settings.sea = 'constructor';
  assert.equal(sanitizeSave(old).settings.view, 'orbit');
  assert.equal(sanitizeSave(old).settings.sea, 'rolling');
});
