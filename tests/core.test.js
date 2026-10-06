import test from 'node:test';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { parseOBJ, parseGLB } from '../src/asset-import.js';
import { planPrompt } from '../src/agent.js';
import { createProject, validateProject } from '../src/project.js';
import { createGraph, createDefaultGraphs } from '../src/graph.js';
import { buildPortableGame } from '../src/exporter.js';
import { StudioEngine, componentOf } from '../src/engine.js';

function makeTriangleGLB() {
  const binary = new ArrayBuffer(42);
  new Float32Array(binary, 0, 9).set([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  new Uint16Array(binary, 36, 3).set([0, 1, 2]);
  const document = {
    asset: { version: '2.0' },
    buffers: [{ byteLength: 42 }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 6 }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
    ],
    meshes: [{ name: 'Triangle', primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    nodes: [{ mesh: 0, name: 'Triangle Node' }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  };
  let json = Buffer.from(JSON.stringify(document));
  while (json.length % 4) json = Buffer.concat([json, Buffer.from(' ')]);
  const bin = Buffer.from(binary);
  const total = 12 + 8 + json.length + 8 + bin.length;
  const output = Buffer.alloc(total);
  output.writeUInt32LE(0x46546c67, 0);
  output.writeUInt32LE(2, 4);
  output.writeUInt32LE(total, 8);
  output.writeUInt32LE(json.length, 12);
  output.writeUInt32LE(0x4e4f534a, 16);
  json.copy(output, 20);
  const binHeader = 20 + json.length;
  output.writeUInt32LE(bin.length, binHeader);
  output.writeUInt32LE(0x004e4942, binHeader + 4);
  bin.copy(output, binHeader + 8);
  return output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength);
}

test('OBJ importer builds triangular BufferGeometry and preserves object names', () => {
  const obj = parseOBJ(['o Pine', 'v 0 0 0', 'v 1 0 0', 'v 0 1 0', 'f 1 2 3'].join('\n'), 'Pine.obj');
  assert.equal(obj.name, 'Pine');
  assert.equal(obj.children.length, 1);
  const geometry = obj.children[0].geometry;
  assert.equal(geometry.getAttribute('position').count, 3);
  assert.ok(geometry.getAttribute('normal'));
});

test('GLB v2 importer reads binary buffers, indices and scene nodes', async () => {
  const root = await parseGLB(makeTriangleGLB(), new Map(), 'Triangle.glb');
  assert.equal(root.name, 'Triangle');
  const mesh = root.getObjectByProperty('isMesh', true);
  assert.ok(mesh);
  assert.equal(mesh.geometry.getAttribute('position').count, 3);
  assert.equal(mesh.geometry.index.count, 3);
});

test('GLB importer rejects invalid files with an actionable error', async () => {
  await assert.rejects(() => parseGLB(new ArrayBuffer(12), new Map(), 'broken.glb'), /not a valid GLB/);
});

test('local planner makes structured player tools and never fabricates night spawning', () => {
  const fakeEngine = {
    scene: { userData: {} },
    listObjects: () => [],
    getSceneSummary: () => [],
    findPlayer: () => null,
    findByKind: () => [],
    findDirectionalLight: () => null,
  };
  const playerPlan = planPrompt('Create a third-person player with health and stamina', { engine: fakeEngine, getSelected: () => null });
  assert.equal(playerPlan.steps[0].tool, 'create_game_object');
  assert.equal(playerPlan.steps[0].args.type, 'Player');
  assert.ok(playerPlan.steps.some((item) => item.args.type === 'Player'));
  const unsupportedPlan = planPrompt('Make zombies spawn at night', { engine: fakeEngine, getSelected: () => null });
  assert.equal(unsupportedPlan.unsupported, true);
  assert.equal(unsupportedPlan.steps.length, 0);
  assert.match(unsupportedPlan.notes.join(' '), /spawn scheduler/);
});

test('project template data and deterministic event graphs are valid', () => {
  const project = createProject({ name: 'Test Island', template: 'Island Survival' });
  assert.equal(project.name, 'Test Island');
  assert.equal(project.template, 'Island Survival');
  assert.equal(project.schemaVersion, 1);
  const graphs = createDefaultGraphs();
  assert.equal(graphs.length, 1);
  assert.equal(graphs[0].event, 'proximity');
  assert.equal(graphs[0].action, 'message');
  assert.equal(createGraph({ name: 'Door' }).name, 'Door');
});

test('project validation reports invalid transforms and accepts a lit scene', () => {
  const valid = {
    name: 'Test', sceneName: 'Main',
  };
  const light = { name: 'Sun', isLight: true, position: new THREE.Vector3(), scale: new THREE.Vector3(1, 1, 1), userData: { nexus: { kind: 'Light', components: [] } }, traverse(callback) { callback(this); } };
  const player = { name: 'Player', position: new THREE.Vector3(), scale: new THREE.Vector3(1, 1, 1), userData: { nexus: { kind: 'Player', components: [{ type: 'CharacterController' }] } }, traverse(callback) { callback(this); } };
  const engine = { listObjects: () => [light, player] };
  assert.deepEqual(validateProject(valid, engine), []);
  light.position.x = Number.NaN;
  assert.equal(validateProject(valid, engine)[0].severity, 'error');
});

test('portable builder inlines the renderer and safely embeds a project scene', async () => {
  const vendor = await readFile(new URL('../vendor/three.module.js', import.meta.url), 'utf8');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(vendor, { status: 200, headers: { 'content-type': 'text/javascript' } });
  try {
    const light = { name: 'Sun', isLight: true, position: new THREE.Vector3(), scale: new THREE.Vector3(1, 1, 1), userData: { nexus: { kind: 'Light', components: [] } }, traverse(callback) { callback(this); } };
    const scene = new THREE.Scene(); scene.name = 'Main';
    const built = await buildPortableGame(createProject({ name: 'Offline Test' }), { listObjects: () => [light], serializeScene: () => scene.toJSON() });
    assert.equal(built.filename, 'Offline-Test.html');
    assert.match(built.html, /globalThis\.THREE = \{/);
    assert.match(built.html, /nexus-game-save:/);
    const payload = built.html.match(/<script type="application\/json" id="nexus-project-data">([\s\S]*?)<\/script>/);
    assert.ok(payload);
    assert.equal(JSON.parse(payload[1]).scene.object.type, 'Scene');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Island Survival sample creates a playable player, pickups, chase enemy and jump movement', () => {
  const oldWindow = globalThis.window;
  globalThis.window = { devicePixelRatio: 1 };
  const engine = Object.create(StudioEngine.prototype);
  Object.assign(engine, {
    scene: new THREE.Scene(), renderer: { setPixelRatio() {}, shadowMap: { enabled: true } }, callbacks: {},
    camera: new THREE.PerspectiveCamera(), gameCamera: new THREE.PerspectiveCamera(), orbitTarget: new THREE.Vector3(),
    mode: 'edit', paused: false, activeView: 'scene', previousView: 'scene', tool: 'select', showGrid: true,
    selected: null, grid: null, selectionHelper: null, player: null, graphs: [], graphStates: new Map(),
    keys: new Set(), gameYaw: Math.PI, gameVelocityY: 0, stamina: 100, health: 100,
    inventory: { wood: 0, stone: 0, berries: 0 }, attackPower: 18, gameTime: 8 * 60, realPlayTime: 0,
    attackCooldown: 0, quality: 'Performance',
  });
  try {
    engine.createSampleScene();
    const player = engine.findPlayer();
    assert.ok(player);
    assert.equal(engine.findByKind('Enemy').length, 1);
    assert.equal(engine.listObjects().filter((object) => componentOf(object, 'Pickup')).length, 10);
    engine.player = player;
    engine.keys = new Set(['KeyW']);
    const startingZ = player.position.z;
    engine.updatePlayer(player, 0.25);
    assert.ok(player.position.z < startingZ, 'W moves the player forward on the ground');
    engine.keys = new Set(['Space']);
    player.position.y = engine.findGroundHeight(player.position.x, player.position.z);
    engine.gameVelocityY = 0;
    engine.updatePlayer(player, 0.016);
    engine.updatePlayer(player, 0.016);
    assert.ok(player.position.y > engine.findGroundHeight(player.position.x, player.position.z), 'jump produces upward motion');
    const wood = engine.listObjects().find((object) => componentOf(object, 'Pickup')?.resource === 'wood');
    player.position.copy(wood.position); engine.tryGather();
    assert.equal(engine.inventory.wood, 1, 'E-style pickup logic updates inventory and hides the resource');
    const enemy = engine.findByKind('Enemy')[0]; enemy.position.set(0, 0.24, -6); player.position.set(0, 0.24, 0);
    const enemyZ = enemy.position.z; engine.updateEnemies(player, 0.2);
    assert.ok(enemy.position.z > enemyZ, 'chase AI moves toward the player');
    engine.inventory = { wood: 3, stone: 2, berries: 0 };
    engine.tryCraft();
    assert.equal(engine.attackPower, 34);
    assert.equal(engine.inventory.wood, 0);
  } finally {
    engine.clearScene();
    if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
  }
});

test('hierarchy reparenting rejects cycles and preserves the child world position', () => {
  const engine = Object.create(StudioEngine.prototype);
  engine.callbacks = {};
  const scene = new THREE.Scene();
  const originalParent = new THREE.Group(); originalParent.position.set(10, 0, 0);
  const targetParent = new THREE.Group(); targetParent.position.set(-4, 2, 3);
  const child = new THREE.Group(); child.position.set(2, 1, -3);
  const grandchild = new THREE.Group(); grandchild.position.set(0, 2, 0);
  scene.add(originalParent, targetParent); originalParent.add(child); child.add(grandchild);
  scene.updateMatrixWorld(true);
  const before = child.getWorldPosition(new THREE.Vector3());
  assert.equal(engine.setParent(child, targetParent), true);
  scene.updateMatrixWorld(true);
  assert.ok(child.getWorldPosition(new THREE.Vector3()).distanceTo(before) < 1e-6);
  assert.equal(engine.setParent(targetParent, grandchild), false, 'a descendant cannot become an ancestor');
});
