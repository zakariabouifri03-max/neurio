import test from 'node:test';
import assert from 'node:assert/strict';
import { newSave, sanitizeSave, loadSave, writeSave, SAVE_KEY, OUTFITS, STAGES, COINS, PLAYER, PLATFORM_DATA, SPINNER, createPlayer, spawnPoint, stepPlayer, platformAt, advanceCheckpoint, collectCoin, finishRun, touchesHazard, formatTime } from '../src/blockyard/rules.js';

const floor = { id: 'floor', x: 0, z: 0, y: 0, w: 100, d: 100, thickness: 1 };
const body = (overrides = {}) => ({ ...createPlayer(), x: 0, z: 0, support: 'floor', ...overrides });
const near = (a, b, e = 1e-5) => assert.ok(Math.abs(a - b) < e, `${a} != ${b}`);

test('Blockyard voyages have independent state and a safe spawn on each checkpoint', () => {
  const a = newSave(), b = newSave(); a.collected.push(2); assert.deepEqual(b.collected, []);
  for (let i = 0; i < STAGES.length; i++) {
    const spawn = spawnPoint(i), stage = STAGES[i];
    assert.equal(spawn.y, stage.y);
    assert.ok(Math.abs(spawn.x - stage.x) < stage.w / 2);
    assert.ok(Math.abs(spawn.z - stage.z) < stage.d / 2);
  }
});

test('collecting coins is unique and rejects unknown IDs', () => {
  const state = newSave(); assert.equal(COINS.length, 24);
  assert.equal(collectCoin(state, 0), true); assert.equal(collectCoin(state, 0), false);
  for (const id of [-1, 999, 1.5, '2', NaN]) assert.equal(collectCoin(state, id), false);
  assert.deepEqual(state.collected, [0]);
});

test('checkpoints must be completed in order and cannot be claimed twice', () => {
  const state = newSave(); assert.equal(advanceCheckpoint(state, 3), false);
  assert.equal(advanceCheckpoint(state, 1), true); assert.equal(advanceCheckpoint(state, 1), false);
  assert.equal(advanceCheckpoint(state, 0), false);
  for (let i = 2; i < STAGES.length; i++) assert.equal(advanceCheckpoint(state, i), true);
  assert.equal(advanceCheckpoint(state, STAGES.length), false);
});

test('finishing requires all checkpoints and a started run; best times only improve', () => {
  const state = newSave(); state.started = true; state.elapsed = 84;
  assert.equal(finishRun(state), false);
  state.checkpoint = 5; assert.equal(finishRun(state), true); assert.equal(state.best, 84);
  assert.equal(finishRun(state), false);
  state.won = false; state.elapsed = 93; finishRun(state); assert.equal(state.best, 84);
  state.won = false; state.elapsed = 75; finishRun(state); assert.equal(state.best, 75);
});

test('movement is frame-stepped, grounded, and diagonal input is normalized', () => {
  const player = body();
  for (let i = 0; i < 120; i++) stepPlayer(player, { x: 1, z: 1 }, [floor], 1 / 60);
  near(player.y, 0); assert.equal(player.grounded, true);
  assert.ok(Math.hypot(player.vx, player.vz) <= PLAYER.speed + .0001);
  near(player.x, player.z);
});

test('normal and sprint movement have different bounded speeds', () => {
  const a = body(), b = body();
  for (let i = 0; i < 60; i++) { stepPlayer(a, { x: 1 }, [floor], 1 / 60); stepPlayer(b, { x: 1, sprint: true }, [floor], 1 / 60); }
  assert.ok(b.x > a.x); assert.ok(b.vx <= PLAYER.sprint);
});

test('jump, double jump, and no third midair jump', () => {
  const p = body();
  assert.ok(stepPlayer(p, { jump: true }, [floor], 1 / 60).includes('jump'));
  const first = p.y; assert.ok(first > 0); assert.equal(p.jumps, 1);
  for (let i = 0; i < 8; i++) stepPlayer(p, {}, [floor], 1 / 60);
  assert.ok(stepPlayer(p, { jump: true }, [floor], 1 / 60).includes('double-jump'));
  assert.equal(p.jumps, 2); const vy = p.vy;
  assert.equal(stepPlayer(p, { jump: true }, [floor], 1 / 60).includes('double-jump'), false);
  assert.ok(p.vy < vy);
  for (let i = 0; i < 140; i++) stepPlayer(p, {}, [floor], 1 / 60);
  assert.equal(p.grounded, true); assert.equal(p.jumps, 0); near(p.y, 0);
});

test('coyote time allows a jump just after walking off an edge', () => {
  const p = body({ x: 1.4 }), small = { ...floor, w: 2, d: 2 };
  stepPlayer(p, {}, [small], 1 / 60); assert.equal(p.grounded, false);
  assert.ok(stepPlayer(p, { jump: true }, [small], 1 / 60).includes('jump'));
  assert.equal(p.jumps, 1); assert.ok(p.vy > 0);
});

test('landing is swept vertically so fast falls do not tunnel through platforms', () => {
  const p = body({ y: 8, vy: -200, grounded: false, support: null });
  stepPlayer(p, {}, [floor], .05); assert.equal(p.grounded, true); near(p.y, 0);
});

test('hitting a block underside prevents jumping through it', () => {
  const p = body({ y: -.9, vy: 10, grounded: false, support: null, jumps: 1 });
  const above = { ...floor, y: 3, w: 4, d: 4, thickness: 1 };
  assert.ok(stepPlayer(p, {}, [above], .05).includes('head-bump'));
  assert.equal(p.vy, 0); near(p.y + PLAYER.height, 2);
});

test('solid block sides stop a walking avatar', () => {
  const p = body({ x: -3 }), wall = { id: 'wall', x: 0, z: 0, w: 2, d: 4, y: 3, thickness: 3 };
  for (let i = 0; i < 60; i++) stepPlayer(p, { x: 1 }, [floor, wall], 1 / 60);
  assert.ok(p.x <= -1 - PLAYER.radius + .001); assert.equal(p.y, 0);
});

test('moving platforms carry a stationary grounded player without losing support', () => {
  const source = PLATFORM_DATA.find(p => p.id === 'mover-1'), initial = platformAt(source, 0);
  const p = body({ x: initial.x, z: initial.z, y: initial.y, support: source.id });
  for (let i = 1; i <= 90; i++) {
    const now = platformAt(source, i / 60), old = platformAt(source, (i - 1) / 60);
    stepPlayer(p, {}, [{ ...now, dx: now.x - old.x }], 1 / 60);
    near(p.x, now.x); assert.equal(p.support, source.id);
  }
});

test('the yellow spring launches the avatar and leaves one air jump', () => {
  const spring = PLATFORM_DATA.find(p => p.bounce), p = body({ x: spring.x, z: spring.z, y: spring.y + .03, vy: -2, grounded: false });
  const events = stepPlayer(p, {}, [spring], .03);
  assert.ok(events.includes('bounce')); assert.ok(p.vy > PLAYER.jump); assert.equal(p.grounded, false); assert.equal(p.jumps, 1);
  assert.ok(stepPlayer(p, { jump: true }, [spring], 1 / 60).includes('double-jump'));
});

test('lava and rotating bars are dangerous only while overlapping the avatar', () => {
  assert.equal(touchesHazard(body({ x: -9, z: -35.4, y: 2.1 }), 0), true);
  assert.equal(touchesHazard(body({ x: -9, z: -35.4, y: 3.1 }), 0), false);
  assert.equal(touchesHazard(body({ x: -7, z: SPINNER.z, y: 8 }), 0), true);
  assert.equal(touchesHazard(body({ x: -7, z: SPINNER.z, y: 8 }), Math.PI / (2 * SPINNER.speed)), false);
  assert.equal(touchesHazard(body({ x: -3, z: SPINNER.z + 4, y: 8 }), Math.PI / (2 * SPINNER.speed)), true);
  assert.equal(touchesHazard(body({ x: -3, z: SPINNER.z + 4, y: 10 }), Math.PI / (2 * SPINNER.speed)), false);
});

test('save data round-trips, but malformed saves cannot invent items or outfits', () => {
  const state = newSave(); Object.assign(state, { outfit: 'berry', checkpoint: 3, elapsed: 73, collected: [0, 2, 7], sound: true, quality: 'low' });
  let data = null; const storage = { getItem: key => key === SAVE_KEY ? data : null, setItem: (_, value) => { data = value; } };
  assert.equal(writeSave(storage, state), true); assert.deepEqual(loadSave(storage), state);
  const corrupt = sanitizeSave({ ...state, outfit: '__proto__', checkpoint: 99, elapsed: Infinity, collected: [0, 0, -5, 30, '2', 1.3], won: false });
  assert.equal(corrupt.outfit, 'citrus'); assert.equal(corrupt.checkpoint, 5); assert.equal(corrupt.elapsed, 0); assert.deepEqual(corrupt.collected, [0]);
  assert.deepEqual(loadSave({ getItem() { throw new Error('No storage'); } }), newSave());
  assert.equal(writeSave({ setItem() { throw new Error('Full'); } }, state), false);
  assert.deepEqual(loadSave({ getItem: () => '{invalid' }), newSave());
});

test('all outfit options are cosmetic and formatted time is stable', () => {
  assert.equal(Object.keys(OUTFITS).length, 4);
  assert.equal(formatTime(0), '00:00'); assert.equal(formatTime(75.9), '01:15');
  for (const outfit of Object.values(OUTFITS)) for (const key of ['shirt', 'cap', 'pants', 'bag']) assert.match(outfit[key], /^#[0-9a-f]{6}$/i);
});

test('the entire intended course has a continuous, hazard-free route through normal controls', () => {
  const route = ['step-1', 'step-2', 'step-3', 'island-1', 'step-4', 'lava-lane', 'island-2', 'mover-1', 'mover-2', 'step-5', 'island-3', 'spring', 'high-step', 'island-4', 'spinner', 'step-6', 'island-5'];
  const player = createPlayer(), state = newSave(); let time = 0;
  for (const id of route) {
    let reached = false;
    for (let frame = 0; frame < 1100; frame++) {
      const surfaces = PLATFORM_DATA.map(p => { const now = platformAt(p, time + 1 / 60), old = platformAt(p, time); return { ...now, dx: now.x - old.x }; });
      const next = surfaces.find(s => s.id === id), current = surfaces.find(s => s.id === player.support);
      const targetZ = id === 'lava-lane' ? next.z - 4.2 : id === 'spinner' ? next.z - 3.6 : next.z;
      const dx = next.x - player.x, dz = targetZ - player.z, distance = Math.hypot(dx, dz);
      const x = distance > .01 ? dx / distance : 0, z = distance > .01 ? dz / distance : 0;
      let jump = false;
      if (player.grounded && current) {
        const tx = Math.abs(x) > .001 ? (current.x + Math.sign(x) * current.w / 2 - player.x) / x : Infinity;
        const tz = Math.abs(z) > .001 ? (current.z + Math.sign(z) * current.d / 2 - player.z) / z : Infinity;
        jump = Math.min(tx, tz) < 1.3;
      } else if (player.jumps === 1 && player.vy < 2) jump = true;
      const speed = Math.min(1, distance / 1.1);
      stepPlayer(player, { x: x * speed, z: z * speed, sprint: true, jump }, surfaces, 1 / 60); time += 1 / 60;
      assert.equal(touchesHazard(player, time), false, `Unsafe route at ${id}`);
      assert.ok(player.y > -18, `Unreachable platform: ${id}`);
      if (player.grounded) { const stage = surfaces.find(s => s.id === player.support)?.stage; if (stage != null) advanceCheckpoint(state, stage); }
      if ((player.grounded && player.support === id) || (id === 'spring' && player.jumps === 1 && player.vy > 15)) { reached = true; break; }
    }
    assert.equal(reached, true, `Route failed to reach ${id}`);
  }
  assert.equal(state.checkpoint, 5);
});
