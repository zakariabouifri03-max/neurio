import test from 'node:test';
import assert from 'node:assert/strict';
import { Mission, RELAYS, SAFEHOUSE, HACK_RANGE, HACK_DURATION, clamp, seededRandom, distance, intersects, slideMove, readStorage, writeStorage, formatTime } from '../src/ghostline/rules.js';

const runHack = (m, relay) => { assert.equal(m.beginHack(relay.id, relay), true); let event; for (let i = 0; i < 80 && m.hack; i++) event = m.tick(.05, relay); return event; };
test('mission requires explicit deployment before a breach', () => { const m = new Mission(); assert.equal(m.beginHack(RELAYS[0].id, RELAYS[0]), false); assert.equal(m.tick(.1, SAFEHOUSE), null); assert.equal(m.elapsed, 0); });
test('range is enforced for beginning and maintaining a breach', () => {
  const m = new Mission(); m.start(); const r = RELAYS[0];
  assert.equal(m.beginHack(r.id, { x: r.x + HACK_RANGE + .01, z: r.z }), false);
  assert.equal(m.beginHack(r.id, { x: r.x + HACK_RANGE, z: r.z }), true);
  m.tick(.1, r); assert.ok(m.hack.progress > 0);
  assert.equal(m.tick(.1, { x: r.x + HACK_RANGE + 2, z: r.z }).type, 'cancelled'); assert.equal(m.hack, null); assert.equal(m.xp, 0);
});
test('a hack is timed, idempotent, and awards 150 XP', () => {
  const m = new Mission(); m.start(); m.beginHack(RELAYS[0].id, RELAYS[0]);
  m.tick(.1, RELAYS[0]); assert.ok(m.hack.progress < 1); assert.equal(m.breached.size, 0);
  assert.equal(m.beginHack(RELAYS[1].id, RELAYS[1]), false);
  let event; for (let i = 0; i < HACK_DURATION * 20 + 1; i++) { const e = m.tick(.05, RELAYS[0]); if (e) event = e; }
  assert.equal(event.type, 'breached'); assert.equal(m.breached.size, 1); assert.equal(m.xp, 150);
  assert.equal(m.beginHack(RELAYS[0].id, RELAYS[0]), false); assert.equal(m.xp, 150);
});
test('relays may be breached in any order, with a separate extraction stage', () => {
  const m = new Mission(); m.start();
  for (const r of [RELAYS[2], RELAYS[0], RELAYS[1]]) runHack(m, r);
  assert.equal(m.extracting, true); assert.equal(m.completed, false); assert.equal(m.xp, 450);
  assert.equal(m.tick(.1, RELAYS[2]), null); assert.equal(m.tick(.1, SAFEHOUSE).type, 'complete');
  assert.equal(m.xp, 750); assert.equal(m.completed, true); assert.equal(m.extracting, false);
  assert.equal(m.tick(.1, SAFEHOUSE), null); assert.equal(m.xp, 750);
});
test('completed mission time stops but free roam stays active', () => {
  const m = new Mission({ breached: RELAYS.map(r => r.id), completed: true, elapsed: 48 }); m.start(); m.tick(.1, SAFEHOUSE);
  assert.equal(m.active, true); assert.equal(m.elapsed, 48); assert.equal(m.completed, true);
});
test('pause is implemented by not ticking the mission', () => {
  const m = new Mission(); m.start(); m.beginHack(RELAYS[0].id, RELAYS[0]); m.tick(.1, RELAYS[0]);
  const value = m.hack.progress; m.active = false; m.tick(.1, RELAYS[0]); assert.equal(m.hack.progress, value);
});
test('large or invalid frame deltas cannot instantly finish a hack', () => {
  const m = new Mission(); m.start(); m.beginHack(RELAYS[0].id, RELAYS[0]);
  m.tick(NaN, RELAYS[0]); m.tick(-1, RELAYS[0]); m.tick(Infinity, RELAYS[0]); assert.equal(m.hack.progress, 0);
  m.tick(500, RELAYS[0]); assert.ok(m.hack.progress < .05); assert.ok(m.elapsed <= .1);
});
test('unknown relay IDs are refused', () => { const m = new Mission(); m.start(); assert.equal(m.beginHack('relay-999', SAFEHOUSE), false); assert.equal(m.hack, null); });
test('checkpoint round trips without restoring an in-flight hack', () => {
  const m = new Mission(); m.start(); runHack(m, RELAYS[0]); m.beginHack(RELAYS[1].id, RELAYS[1]);
  const restored = new Mission(JSON.parse(JSON.stringify(m.snapshot())));
  assert.equal(restored.breached.has(RELAYS[0].id), true); assert.equal(restored.active, false); assert.equal(restored.hack, null); assert.equal(restored.xp, 150);
});
test('untrusted saves are sanitized', () => {
  for (const input of [null, [], 42, 'bad', { breached: 'bad', elapsed: '22' }]) { const m = new Mission(input); assert.equal(m.breached.size, 0); assert.equal(m.elapsed, 0); }
  const m = new Mission({ breached: [RELAYS[0].id, RELAYS[0].id, 'nope'], completed: true, elapsed: Infinity });
  assert.equal(m.breached.size, 1); assert.equal(m.completed, false); assert.equal(m.elapsed, 0);
  assert.equal(new Mission({ elapsed: -7 }).elapsed, 0);
});
test('storage failures and malformed JSON are nonfatal', () => {
  const denied = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); } };
  assert.deepEqual(readStorage(denied, 'test'), {}); assert.equal(writeStorage(denied, 'test', {}), false);
  assert.deepEqual(readStorage({ getItem() { return '{broken'; } }, 'test'), {});
  assert.deepEqual(readStorage(undefined, 'test'), {});
});
test('storage serializes data', () => { let value; const s = { setItem(k, v) { value = v; }, getItem() { return value; } }; assert.equal(writeStorage(s, 'x', { n: 3 }), true); assert.deepEqual(readStorage(s, 'x'), { n: 3 }); });
test('circle-box intersection handles edges and corners', () => {
  const r = { minX: 0, maxX: 5, minZ: 0, maxZ: 5 };
  assert.equal(intersects(2, 2, .32, r), true); assert.equal(intersects(-1, 2, .32, r), false); assert.equal(intersects(-.2, 2, .32, r), true);
  assert.equal(intersects(-.3, -.3, .32, r), false); assert.equal(intersects(-.2, -.2, .32, r), true);
});
test('movement slides along walls without entering buildings', () => {
  const blocks = [{ minX: 1, maxX: 10, minZ: -10, maxZ: 10 }];
  assert.deepEqual(slideMove({ x: .65, z: 0 }, .2, .3, blocks), { x: .65, z: .3 });
  assert.deepEqual(slideMove({ x: 0, z: 0 }, .2, .3, blocks), { x: .2, z: .3 });
});
test('district boundaries constrain movement', () => { assert.deepEqual(slideMove({ x: 119.9, z: -119.9 }, 1, -1, []), { x: 120, z: -120 }); });
test('seeded world generation is deterministic', () => { const a = seededRandom(123), b = seededRandom(123); for (let i = 0; i < 50; i++) { const n = a(); assert.equal(n, b()); assert.ok(n >= 0 && n < 1); } });
test('distance, clamp, and timer formatting', () => { assert.equal(distance({ x: 0, z: 0 }, { x: 3, z: 4 }), 5); assert.equal(clamp(8, 1, 5), 5); assert.equal(formatTime(67.9), '01:07'); assert.equal(formatTime(0), '00:00'); });
