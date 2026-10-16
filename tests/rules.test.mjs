import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, sanitizeSave, loadGame, saveGame, canAfford, spend, give, collectResource, foundationSpots, canPlace, craft, consume, tick, objective, MAX_TILES, SAVE_KEY } from '../src/raft/rules.js';

const stocked = () => { const state = newGame(); for (const key of Object.keys(state.inventory)) state.inventory[key] = 999; return state; };

test('new voyages have independent state, a connected raft, and starter supplies', () => {
  const a = newGame(), b = newGame();
  assert.equal(a.tiles.length, 9);
  assert.equal(a.structures.length, 2);
  assert.equal(a.inventory.wood, 8);
  a.inventory.wood = 0;
  a.tiles.push({ x: 2, z: 0 });
  assert.equal(b.inventory.wood, 8);
  assert.equal(b.tiles.length, 9);
});

test('collecting individual resources and cargo updates inventory and objective counters', () => {
  const state = newGame();
  assert.deepEqual(collectResource(state, 'wood'), { wood: 2 });
  assert.equal(state.inventory.wood, 10);
  assert.equal(state.gathered.wood, 2);
  assert.deepEqual(collectResource(state, 'leaf'), { leaf: 2 });
  assert.deepEqual(collectResource(state, 'plastic'), { plastic: 2 });
  assert.deepEqual(collectResource(state, 'barrel'), { wood: 3, plastic: 2, leaf: 1, scrap: 2, food: 1 });
  assert.equal(state.gathered.barrels, 1);
  assert.equal(state.gathered.wood, 5);
  collectResource(state, 'crate');
  assert.equal(state.gathered.barrels, 2);
  assert.equal(state.inventory.water, 4);
});

test('spending is atomic when a recipe is unaffordable', () => {
  const state = newGame(), before = structuredClone(state.inventory);
  assert.equal(canAfford(state, { wood: 8, plastic: 7 }), false);
  assert.equal(spend(state, { wood: 8, plastic: 7 }), false);
  assert.deepEqual(state.inventory, before);
  assert.equal(spend(state, { wood: 8, plastic: 6 }), true);
  assert.equal(state.inventory.wood, 0);
  assert.equal(state.inventory.plastic, 0);
});

test('foundation candidates are unique, cardinally connected, and outside the deck', () => {
  const state = newGame(), spots = foundationSpots(state);
  assert.equal(spots.length, 12);
  assert.equal(new Set(spots.map(t => `${t.x},${t.z}`)).size, 12);
  assert.equal(canPlace(state, 'foundation', 2, 1), true);
  assert.equal(canPlace(state, 'foundation', 2, 2), false);
  assert.equal(canPlace(state, 'foundation', 0, 0), false);
  assert.equal(canPlace(state, 'foundation', 2.1, 0), false);
});

test('building a foundation deducts the exact materials and grows the playable raft', () => {
  const state = newGame();
  assert.equal(craft(state, 'foundation', 0, 2).ok, true);
  assert.equal(state.tiles.length, 10);
  assert.equal(state.inventory.wood, 4);
  assert.equal(state.inventory.plastic, 4);
  assert.equal(state.built, 1);
  assert.equal(state.crafted.foundation, 1);
  const before = structuredClone(state);
  assert.equal(craft(state, 'foundation', 0, 2).ok, false);
  assert.deepEqual(state, before);
  assert.equal(canPlace(state, 'foundation', 0, 3), true);
});

test('building cannot exceed the raft limit', () => {
  const state = stocked();
  while (state.tiles.length < MAX_TILES) { const candidate = foundationSpots(state)[0]; assert.equal(craft(state, 'foundation', candidate.x, candidate.z).ok, true); }
  const candidate = foundationSpots(state)[0];
  assert.equal(craft(state, 'foundation', candidate.x, candidate.z).ok, false);
  assert.equal(state.tiles.length, MAX_TILES);
});

test('deck structures require an empty foundation, not ocean or another structure', () => {
  const state = stocked();
  assert.equal(canPlace(state, 'purifier', 0, 0), true);
  assert.equal(canPlace(state, 'purifier', -1, -1), false);
  assert.equal(canPlace(state, 'purifier', 10, 10), false);
  assert.equal(craft(state, 'purifier', 0, 0).ok, true);
  assert.equal(state.structures.at(-1).type, 'purifier');
  assert.equal(state.structures.at(-1).progress, 0);
  assert.equal(canPlace(state, 'garden', 0, 0), false);
  assert.equal(craft(state, 'nonsense', 0, 1).ok, false);
  assert.equal(craft(state, 'constructor', 0, 1).ok, false);
});

test('rope crafts immediately, with no placement step', () => {
  const state = newGame();
  assert.equal(craft(state, 'rope').ok, true);
  assert.equal(state.inventory.leaf, 2);
  assert.equal(state.inventory.rope, 3);
  assert.equal(state.crafted.rope, 1);
  assert.equal(state.structures.length, 2);
});

test('water and food restore needs, do not waste supplies at full, and respect empty inventory', () => {
  const state = newGame();
  assert.equal(consume(state, 'water').ok, true);
  assert.equal(state.stats.thirst, 100);
  assert.equal(state.inventory.water, 2);
  assert.equal(consume(state, 'water').ok, false);
  assert.equal(state.inventory.water, 2);
  state.stats.hunger = 25;
  assert.equal(consume(state, 'food').ok, true);
  assert.equal(state.stats.hunger, 53);
  state.inventory.food = 0;
  assert.equal(consume(state, 'food').ok, false);
  assert.equal(consume(state, 'wood').ok, false);
});

test('a grill improves food, and survival stations produce on their own timers', () => {
  const state = stocked();
  craft(state, 'grill', -1, 0); craft(state, 'purifier', 0, 0); craft(state, 'garden', 1, 0);
  state.inventory.food = 0; state.inventory.water = 0;
  let produced = [];
  for (let i = 0; i < 59; i++) produced.push(...tick(state, 1));
  assert.equal(state.inventory.water, 0);
  produced.push(...tick(state, 1));
  assert.equal(state.inventory.water, 1);
  assert.equal(state.inventory.food, 0);
  for (let i = 0; i < 20; i++) produced.push(...tick(state, 1));
  assert.equal(state.inventory.food, 1);
  assert.deepEqual(produced.map(event => event.item), ['water', 'food']);
  state.stats.hunger = 20; consume(state, 'food');
  assert.equal(state.stats.hunger, 62);
});

test('survival drains needs, damages only at empty, heals when healthy, and stops on death', () => {
  const state = newGame();
  tick(state, 1);
  assert.equal(state.elapsed, 1);
  assert.ok(state.stats.thirst < 86 && state.stats.hunger < 78);
  assert.equal(state.stats.health, 100);
  state.stats.thirst = 0; tick(state, 1);
  assert.equal(state.stats.health, 98.4);
  state.stats.thirst = 90; state.stats.hunger = 90; tick(state, 1);
  assert.ok(state.stats.health > 98.4);
  state.stats.health = 0; const elapsed = state.elapsed;
  assert.deepEqual(tick(state, 1), []);
  assert.equal(state.elapsed, elapsed);
});

test('large or negative deltas cannot skip production or fast-forward survival', () => {
  const state = newGame();
  tick(state, NaN); assert.equal(state.elapsed, 0);
  tick(state, -50); assert.equal(state.elapsed, 0);
  tick(state, 500); assert.equal(state.elapsed, 1);
});

test('all four chapters advance only after their actual requirements', () => {
  const state = stocked();
  assert.equal(objective(state).chapter, '01');
  for (let i = 0; i < 3; i++) collectResource(state, 'wood');
  assert.equal(objective(state).chapter, '01');
  craft(state, 'foundation', 0, 2); assert.equal(objective(state).chapter, '02');
  collectResource(state, 'barrel'); collectResource(state, 'crate');
  craft(state, 'purifier', 0, 0); assert.equal(objective(state).chapter, '03');
  while (state.tiles.length < 15) { const candidate = foundationSpots(state)[0]; craft(state, 'foundation', candidate.x, candidate.z); }
  craft(state, 'garden', 1, 0); assert.equal(objective(state).chapter, '04');
});

test('inventory additions are bounded and ignore unknown or negative supplies', () => {
  const state = newGame();
  give(state, { wood: 10000, plastic: -9, food: NaN, invented: 200, constructor: 100 });
  assert.equal(state.inventory.wood, 999);
  assert.equal(state.inventory.plastic, 6);
  assert.equal(state.inventory.food, 3);
  assert.equal(state.inventory.invented, undefined);
  assert.equal(Object.hasOwn(state.inventory, 'constructor'), false);
});

test('a real voyage round-trips through storage, including island rewards and producer progress', () => {
  const state = newGame();
  craft(state, 'foundation', 0, 2); state.elapsed = 122; state.discovered = [-20]; state.travel = { x: -18, z: -41 };
  let data;
  const storage = { setItem(key, value) { assert.equal(key, SAVE_KEY); data = value; }, getItem() { return data; } };
  assert.equal(saveGame(storage, state), true);
  const loaded = loadGame(storage);
  assert.deepEqual(loaded.tiles.map(t => `${t.x},${t.z}`).sort(), state.tiles.map(t => `${t.x},${t.z}`).sort());
  assert.deepEqual(loaded.inventory, state.inventory);
  assert.deepEqual(loaded.travel, state.travel);
  assert.deepEqual(loaded.discovered, [-20]);
  assert.equal(loaded.elapsed, 122);
  assert.equal(loaded.built, 1);
});

test('corrupt and inaccessible saves fail safely, without breaking the game', () => {
  assert.deepEqual(loadGame({ getItem() { return '{invalid'; } }), newGame());
  assert.deepEqual(loadGame({ getItem() { throw Error('SecurityError'); } }), newGame());
  assert.equal(saveGame({ setItem() { throw Error('QuotaExceededError'); } }, newGame()), false);
  assert.deepEqual(sanitizeSave(null), newGame());
  assert.deepEqual(sanitizeSave({ version: 92 }), newGame());
});

test('save validation clamps hostile values and rejects disconnected tiles and overlapping structures', () => {
  const state = newGame();
  state.inventory.wood = -10; state.inventory.food = Infinity; state.inventory.rope = 1.9;
  state.stats.health = 200; state.stats.thirst = -100;
  state.tiles.push({ x: 90, z: 90 }, { x: NaN, z: 2 }, { x: 0, z: 0 });
  state.structures.push({ type: 'invented', x: 0, z: 0 }, { type: 'purifier', x: 1, z: -1 }, { type: 'garden', x: 80, z: 80 });
  state.discovered = [-20, -20, 100, '61'];
  const result = sanitizeSave(state);
  assert.equal(result.inventory.wood, 0); assert.equal(result.inventory.food, 3); assert.equal(result.inventory.rope, 1);
  assert.equal(result.stats.health, 100); assert.equal(result.stats.thirst, 0);
  assert.equal(result.tiles.length, 9); assert.equal(result.structures.length, 2);
  assert.deepEqual(result.discovered, [-20]);
});
