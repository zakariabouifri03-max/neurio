import assert from 'node:assert/strict';
import { BLOCK, ID, ITEM_BY_ID, ITEMS, RECIPES } from '../src/blocks.js';
import { Inventory } from '../src/inventory.js';
import { encodeSignal, decodeSignal } from '../src/network.js';
import { VoxelWorld } from '../src/world.js';

class FakeCanvas {
  constructor() { this.width = 0; this.height = 0; this.context = { fillRect() {}, beginPath() {}, arc() {}, stroke() {}, moveTo() {}, lineTo() {} }; }
  getContext() { return this.context; }
}
globalThis.document = { createElement: (tag) => tag === 'canvas' ? new FakeCanvas() : {} };

assert.equal(ITEMS.length, ITEM_BY_ID.size, 'Item ids are unique.');
for (const item of ITEMS) {
  assert(ITEM_BY_ID.has(item.id), `Missing item ${item.key}`);
  if (item.placeable) assert(BLOCK[item.id], `Missing block behavior for ${item.key}`);
}
for (const recipe of RECIPES) {
  for (const id of [...Object.keys(recipe.input), ...Object.keys(recipe.output)]) assert(ITEM_BY_ID.has(Number(id)), `Recipe ${recipe.id} references missing item ${id}`);
}

const one = new VoxelWorld('forest-42', [], null, 1);
const two = new VoxelWorld('forest-42', [], null, 1);
const other = new VoxelWorld('desert-11', [], null, 1);
assert.deepEqual(one.surfaceAt(-21, 17), two.surfaceAt(-21, 17), 'Same seed gives identical terrain.');
assert(one.surfaceAt(-21, 17).height !== other.surfaceAt(-21, 17).height || one.biomeAt(-21, 17) !== other.biomeAt(-21, 17), 'Different seeds should normally vary.');
const y = one.surfaceAt(0, 0).height;
assert.notEqual(one.getBlock(0, y, 0), 0, 'Generated terrain has a solid surface.');
one.setBlock(0, y + 2, 0, ID.STONE);
one.setBlock(2, y + 2, 0, 0);
let tree = null;
for (let z = -8; z <= 8 && !tree; z++) for (let x = -8; x <= 8 && !tree; x++) {
  const spec = one._treeSpec(x, z);
  if (spec?.kind === 'tree') tree = { x, y: spec.base + 1, z };
}
assert(tree, 'Seeded world has a tree in the nearby search area.');
assert.equal(one.getBlock(tree.x, tree.y, tree.z), ID.LOG, 'Tree trunk is generated as a block.');
one.setBlock(tree.x, tree.y, tree.z, 0);
const saved = one.serializeEdits();
const restored = new VoxelWorld('forest-42', saved, null, 1);
assert.equal(restored.getBlock(0, y + 2, 0), ID.STONE, 'Placed blocks restore from edits.');
assert.equal(restored.getBlock(2, y + 2, 0), 0, 'Removed blocks restore from edits.');
assert.equal(restored.getBlock(tree.x, tree.y, tree.z), 0, 'Mined natural tree blocks stay removed after loading.');

const inventory = new Inventory({}, 'survival');
assert(inventory.getCount(ID.WOOD_PICK) > 0, 'Survival starts with a basic pick.');
assert(inventory.remove(ID.LOG, 1), 'Starter materials can be spent.');
assert(inventory.add(ID.DIAMOND, 1) === 0, 'Inventory accepts resources.');
assert(inventory.canPay({ [ID.LOG]: 4 }) === false, 'Recipe checks use current inventory.');
const creative = new Inventory({}, 'creative');
assert.equal(creative.getCount(ID.DIAMOND_PICK), 1, 'Creative mode provides the full tool set.');
assert(creative.canPay({ [ID.DIAMOND]: 999 }), 'Creative mode has unlimited materials.');

const signal = encodeSignal({ type: 'offer', sdp: 'v=0\r\na=test\r\n' });
assert.deepEqual(decodeSignal(signal), { type: 'offer', sdp: 'v=0\r\na=test\r\n' }, 'LAN signaling code round-trips.');
console.log(`OK: ${ITEMS.length} items, ${RECIPES.length} recipes, seeded voxel world, saves, inventory and LAN codes.`);
