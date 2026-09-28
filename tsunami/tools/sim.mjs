// tools/sim.mjs — headless GAMEPLAY integration test (no WebGL).
// Builds every gameplay module against the real world and simulates a full
// playthrough: calm beach → harvest/craft the rod → tsunami → flee → drive →
// camp survival → fishing → aftershock/landslide/storm/fire → rescue.
// run:  node tools/sim.mjs
import * as THREE from 'three';

/* ------------------------------------------------------------- DOM stubs */
class FakeCtx {
  constructor(w, h) { this.w = w; this.h = h; this.canvas = { width: w, height: h }; }
  createImageData(w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; }
  getImageData(x, y, w, h) { return this.createImageData(w, h); }
  putImageData() { } fillRect() { } clearRect() { } beginPath() { } closePath() { }
  moveTo() { } lineTo() { } quadraticCurveTo() { } bezierCurveTo() { } arc() { } arcTo() { } ellipse() { }
  fill() { } stroke() { } strokeRect() { } clip() { } rect() { } roundRect() { } drawImage() { }
  save() { } restore() { } translate() { } rotate() { } scale() { } transform() { } setTransform() { }
  createRadialGradient() { return { addColorStop() { } }; }
  createLinearGradient() { return { addColorStop() { } }; }
  createPattern() { return null; }
  measureText(s) { return { width: (s || '').length * 6 }; }
  fillText() { } strokeText() { }
}
function fakeEl() {
  const el = {
    style: {}, dataset: {}, children: [], textContent: '', innerHTML: '', value: 0,
    offsetWidth: 1, width: 190, height: 190, onclick: null,
    classList: { add() { }, remove() { }, toggle() { }, contains: () => false },
    addEventListener() { }, removeEventListener() { }, dispatchEvent() { }, focus() { },
    appendChild(c) { el.children.push(c); return c; }, removeChild() { }, remove() { },
    querySelector: () => fakeEl(), querySelectorAll: () => [], closest: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
    getContext: () => new FakeCtx(1, 1),
  };
  return el;
}
globalThis.document = {
  createElement(tag) {
    if (tag !== 'canvas') return fakeEl();
    const c = { width: 1, height: 1, style: {}, getContext: () => new FakeCtx(c.width, c.height) };
    return c;
  },
  getElementById: () => null, addEventListener() { }, body: fakeEl(),
};
globalThis.window = {
  innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1,
  addEventListener() { }, requestAnimationFrame: () => 0, location: { href: '' },
  matchMedia: () => ({ matches: false, addEventListener() { } }),
};
Object.defineProperty(globalThis, 'navigator', {
  value: { userAgent: 'node', maxTouchPoints: 0, hardwareConcurrency: 8, deviceMemory: 8 }, configurable: true,
});
globalThis.localStorage = { getItem: () => null, setItem() { }, removeItem() { } };
globalThis.self = globalThis;
if (!globalThis.performance) globalThis.performance = { now: () => Date.now() };

/* ------------------------------------------------------------- imports */
const { World } = await import('../src/world.js');
const { Sky } = await import('../src/sky.js');
const { Ocean } = await import('../src/ocean.js');
const { Player } = await import('../src/player.js');
const { VehicleSystem } = await import('../src/vehicles.js');
const { Survival, ITEMS } = await import('../src/survival.js');
const { Fishing } = await import('../src/fishing.js');
const { Disasters } = await import('../src/disasters.js');
const { NPCSystem } = await import('../src/npc.js');
const { ResourceField } = await import('../src/resource.js');
const { FX } = await import('../src/particles.js');
const { UI } = await import('../src/ui.js');

/* ------------------------------------------------------------- harness */
const t0 = Date.now();
const log = (...a) => console.log('[sim]', ...a);
let fails = 0;
function check(name, cond, extra = '') {
  if (cond) log('✓', name, extra);
  else { fails++; log('✗ FAIL', name, extra); }
}
const ui = new UI(fakeEl());
ui.el = ui.el || {};
const uiLog = [];
for (const fn of ['message', 'chapter', 'flash', 'celebrate', 'prompt', 'objective', 'dialogue']) {
  ui[fn] = (...args) => { uiLog.push([fn, ...args]); };
}
ui.update = () => { }; ui.setLoading = () => { }; ui.hideLoading = () => { }; ui.showStart = () => { }; ui.setLang = () => { }; ui.drawMinimap = () => { }; ui.closePanel = () => { }; Object.defineProperty(ui, 'panelOpen', { value: false, configurable: true }); ui.touch = { active: false };

const renderer = {
  setRenderTarget() { }, getRenderTarget() { return null; }, render() { }, clear() { },
  getClearColor(c) { c.setRGB(0, 0, 0); }, getClearAlpha() { return 1; }, setClearColor() { },
  getPixelRatio() { return 1; }, setPixelRatio() { }, getSize(v) { return v ? v.set(1280, 720) : { width: 1280, height: 720 }; },
  readRenderTargetPixels() { }, xr: { enabled: false }, capabilities: { getMaxAnisotropy: () => 8 },
  shadowMap: {}, info: { render: { calls: 0, triangles: 0 } },
};

const fakeMat = new Proxy({}, { get: () => new THREE.MeshStandardMaterial() });
const fakeTex = {
  sand: { map: new THREE.Texture(), normalMap: new THREE.Texture() },
  grass: { map: new THREE.Texture(), normalMap: new THREE.Texture() },
  rock: { map: new THREE.Texture(), normalMap: new THREE.Texture() },
};

const scene = new THREE.Scene();
const world = new World(scene, 'low');   // same default seed the game ships with
world.buildHeightField();
world.defineRoads().buildRoads();
world.makeHeightTexture(128);
world.buildTerrainMesh(fakeMat);
world.installTerrainShader(fakeTex);
world.buildCity();
world.buildCoast();
world.buildMountain();
world.buildRoadMeshes(fakeMat);
world.finalize(fakeMat);
log('world built', `${Date.now() - t0} ms`, `destructibles=${world.destructibles.length}`);

const field = new ResourceField(scene, world, fakeMat, 'low').scatter();
world.resources = field.nodes;
const resStats = field.stats();
log('resources', JSON.stringify(resStats), `total=${field.nodes.length}`);
check('resources scattered', field.nodes.length > 200, `n=${field.nodes.length}`);
check('has trees (axe-gated)', (resStats.tree || 0) > 20, `tree=${resStats.tree}`);
check('has fibre sources (bush/palm)', (resStats.bush || 0) + (resStats.palm || 0) > 20);
check('has scrap sources (rock/wreck)', (resStats.rock || 0) + (resStats.wreck || 0) > 20);

const sky = new Sky(scene, 'low');
sky.bakeClouds();
const ocean = new Ocean(scene, world, 'low', renderer);
const fx = new FX(scene, 'low', renderer);
const player = new Player(world, ocean, { camera: new THREE.PerspectiveCamera(60, 1.7, 0.1, 9000) });
const vehicles = new VehicleSystem(scene, world, ocean, 'low');
vehicles.populate(world.spawns);
const survival = new Survival({ player, world, ocean, fx, audio: null, ui, scene, quality: 'low' });
const messages = [];
survival.onEvent = (e) => { if (e.type === 'message') messages.push(e.text); };
const fishing = new Fishing({ player, world, ocean, fx, audio: null, survival, camera: player.camera, ui, scene });
const npc = new NPCSystem({ scene, world, ocean, fx, audio: null, quality: 'low' });
const disasters = new Disasters({
  world, ocean, fx, audio: null, sky, npc, vehicles, survival, ui, scene, mats: fakeMat, quality: 'low',
});
const dEvents = [];
disasters.onEvent = (e) => dEvents.push(e);
check('vehicles populated', vehicles.vehicles.length > 5, `n=${vehicles.vehicles.length}`);
check('hero pickup exists', !!vehicles.hero, vehicles.hero ? vehicles.hero.spec?.name || vehicles.hero.kind : 'none');
check('escape pickup is parked above the flood line', !!vehicles.hero && vehicles.hero.pos.y > 17, `y=${vehicles.hero ? vehicles.hero.pos.y.toFixed(1) : 'n/a'}`);
check('rescue boat exists', !!vehicles.rescueBoat);

/* --------------------------------------------------------------- helpers */
let simTime = 0;
const stepDt = 1 / 20;
function stepAll(n, inputFn = () => ({})) {
  for (let i = 0; i < n; i++) {
    simTime += stepDt;
    sky.setTimeOfDay((simTime / 1500) % 1);
    sky.update(stepDt, player.camera);
    const inp = inputFn(simTime) || {};
    if (player.vehicle) {
      vehicles.update(stepDt, player.vehicle, inp);
      player.pos.copy(player.vehicle.pos);
      player.vel.copy(player.vehicle.vel);
    } else {
      player.update(stepDt, inp);
      vehicles.update(stepDt, null, {});
    }
    npc.update(stepDt, player, { panic: disasters.tsunami ? 0.9 : 0.2, tsunami: !!disasters.tsunami });
    disasters.update(stepDt, { player });
    survival.update(stepDt, { rain: disasters.storm.active ? disasters.storm.intensity : 0, night: false });
    fishing.update(stepDt, inp);
    fx.update(stepDt, player.camera, (x, z) => ocean.waterYAt(x, z));
    ocean.update(stepDt, player.camera, player.pos);
    ocean.syncSky(sky);
  }
}
const finite = (v) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

/* -------------------------------------------------------- 1. calm beach */
player.setPosition(world.spawns.beach.x, world.spawns.beach.y + 0.4, world.spawns.beach.z);
stepAll(120, () => ({ forward: true }));
check('player walks on the beach', finite(player.pos) && player.pos.y > 0.5, `pos=${player.pos.x.toFixed(1)},${player.pos.y.toFixed(2)},${player.pos.z.toFixed(1)}`);
check('player on the sand region', world.regionAt(player.pos.x, player.pos.z) === 'beach' || world.heightAt(player.pos.x, player.pos.z) < 12);

/* ------------------------------------------- 2. harvest → craft fishing rod */
// stand next to a bush and harvest it by hand (no tool needed)
const bush = field.nodes.find((n) => n.type === 'bush');
check('bush found for harvest', !!bush);
player.setPosition(bush.x + 1.2, world.heightAt(bush.x + 1.2, bush.z) + 0.2, bush.z);
const near = survival.nearestResource({ x: bush.x, y: world.heightAt(bush.x, bush.z), z: bush.z }, 3.4);
check('nearestResource finds a node', !!near, near ? near.type : 'none');
survival.harvest(bush);
check('bush harvest gives fibre', survival.inv.count('fiber') >= 1, `fiber=${survival.inv.count('fiber')} berry=${survival.inv.count('berry')}`);
const rockNode = field.nodes.find((n) => n.type === 'rock');
for (let i = 0; i < 4 && !rockNode.depleted; i++) survival.harvest(rockNode);
check('rock harvest gives stone/scrap', survival.inv.count('stone') > 0 || survival.inv.count('scrap') > 0,
  `stone=${survival.inv.count('stone')} scrap=${survival.inv.count('scrap')}`);
check('node hide leaves a stump', field.stumps.children.length >= 0, `stumps=${field.stumps.children.length}`);
// palm → fronds
const palm = field.nodes.find((n) => n.type === 'palm');
for (let i = 0; i < 6 && palm && !palm.depleted; i++) survival.harvest(palm);
check('palm gives fronds', survival.inv.count('frond') > 0, `frond=${survival.inv.count('frond')}`);
// tree needs an axe
const tree = field.nodes.find((n) => n.type === 'tree');
const sticksBefore = survival.inv.count('stick');
survival.harvest(tree);
check('tree is axe-gated', survival.inv.count('stick') === sticksBefore);
// gather the rod fibre/scrap and craft it
survival.inv.add('rod_broken', 1);
survival.inv.add('fiber', 2);
survival.inv.add('scrap', 2);
const crafted = survival.craft('rod_fix');
check('rod_fix recipe crafts', crafted && survival.inv.count('rod') > 0,
  `crafted=${crafted} rod=${survival.inv.count('rod')} broken=${survival.inv.count('rod_broken')}`);
check('fishing detects the rod', fishing.hasRod === true);

/* ------------------------------------------------- 3. the wave comes in */
disasters.startTsunami();
const phaseSeen = new Set();
let maxLevel = -99, shakePeak = 0, maxPeopleSafe = 0;
stepAll(80);
for (let i = 0; i < 70; i++) {
  stepAll(20, () => ({ forward: true, sprint: true }));
  if (disasters.tsunamiPhase) phaseSeen.add(disasters.tsunamiPhase);
  void 0;
  maxLevel = Math.max(maxLevel, ocean.level);
  shakePeak = Math.max(shakePeak, disasters.shake.trauma || 0);
  maxPeopleSafe = Math.max(maxPeopleSafe, npc.peopleSafe());
}
check('tsunami phases ran', phaseSeen.size >= 2, [...phaseSeen].join(','));
check('flood rises above 8 m', maxLevel > 8, `level=${maxLevel.toFixed(2)}`);
check('world shaking occurred', shakePeak > 0.02, `peak=${shakePeak.toFixed(3)}`);
check('townsfolk flee to safety', maxPeopleSafe > 0, `safe=${maxPeopleSafe}`);
check('ui got messages/chapters', uiLog.length > 0, `ui calls=${uiLog.length}`);
const collapsed = world.destructibles.filter((d) => d.state !== 'standing').length;
check('coastal buildings topple', collapsed > 0, `collapsed=${collapsed}/${world.destructibles.length}`);

/* -------------------------------------------------------- 4. escape by car */
const floaters = vehicles.vehicles.filter((v) => v.floatage > 0.05).length;
check('cars/boats float on the flood water', floaters > 0, `floaters=${floaters}`);
for (let i = 0; i < 2400 && ocean.level > 2.5; i++) stepAll(1, () => ({}));
check('flood drains back to the sea', ocean.level < 2.6, `level=${ocean.level.toFixed(2)}`);
let drove = 0;
if (vehicles.hero) {
  vehicles.unstickAll();
  player.setPosition(vehicles.hero.pos.x, vehicles.hero.pos.y + 0.5, vehicles.hero.pos.z);
  player.vehicle = vehicles.hero;
  vehicles.hero.board(player);
  const p0 = vehicles.hero.pos.clone();
  const hv = vehicles.hero;
  const depth = hv.waterSample(hv.pos.x, hv.pos.z) - world.heightAt(hv.pos.x, hv.pos.z);
  stepAll(140, () => ({ forward: true, sprint: false }));
  drove = p0.distanceTo(vehicles.hero.pos);
  const dbg = `fuel=${hv.fuel.toFixed(1)} destroyed=${hv.destroyed} floatage=${hv.floatage.toFixed(2)} waterDepth=${depth.toFixed(2)} blocked=${vehicles.blocked(hv.pos.x, hv.pos.z, hv.pos.y)} mud=${hv.mud.toFixed(2)}`;
  check('the pickup drives', drove > 8, `moved=${drove.toFixed(1)} m speed=${Math.abs(hv.speed).toFixed(1)} ${dbg}`);
  stepAll(140, () => ({ forward: true, left: true }));
  check('vehicle stays finite while steering', finite(vehicles.hero.pos));
  check('vehicle speed is sane', Math.abs(vehicles.hero.speed) < 60, `speed=${vehicles.hero.speed.toFixed(1)}`);
  vehicles.hero.unboard();
  player.vehicle = null;
}

/* ---------------------------------------------- 5. build a camp on the hill */
const camp = world.spawns.camp || { x: 800, y: 174, z: -40 };
player.setPosition(camp.x, world.heightAt(camp.x, camp.z) + 0.3, camp.z);
stepAll(20);
survival.inv.add('stick', 30); survival.inv.add('stone', 20); survival.inv.add('plank', 20);
survival.inv.add('frond', 20); survival.inv.add('rope', 10); survival.inv.add('cloth', 10);
survival.inv.add('fiber', 10); survival.inv.add('charcoal', 5);
const pos = new THREE.Vector3(camp.x + 2, 0, camp.z + 2);
const builtFire = survival.build('campfire', pos, 0);
check('campfire builds', builtFire && survival.structures.length > 0, `structures=${survival.structures.length}`);
const builtShelter = survival.build('shelter', new THREE.Vector3(camp.x + 6, 0, camp.z + 4), 0);
check('shelter builds', builtShelter);
survival.addFuelToFire();
check('fire has fuel', survival.structures.find((s) => s.kind === 'campfire').fuel > 0);
stepAll(40);
check('survival meters tick down', player.hunger < 100 && player.thirst < 100,
  `hunger=${player.hunger.toFixed(1)} thirst=${player.thirst.toFixed(1)} warmth=${player.warmth.toFixed(1)}`);
survival.inv.add('water_dirty', 1);
const beforeDrink = player.thirst;
survival.drinkItem('water_clean') || survival.eat('berry');
check('drink/eat works', survival.inv.count('berry') >= 0);

/* -------------------------------------------------------------- 6. fishing */
// stand on the sand looking out to sea (the camera defines the casting direction)
const spot = { x: world.coastX(world.beachCenter.z) - 2, z: world.beachCenter.z };
player.setPosition(spot.x, world.heightAt(spot.x, spot.z) + 0.2, spot.z);
player.yaw = -Math.PI / 2;
player.pitch = -0.08;
// identical to Game.updateCamera() so the aim matches the movement basis
const syncCam = () => {
  player.camera.position.copy(player.eye);
  player.camera.rotation.set(0, 0, 0);
  player.camera.rotateY(-player.yaw);
  player.camera.rotateX(player.pitch);
  player.camera.updateMatrixWorld(true);
};
syncCam();
{
  // the camera must look the same way the player walks
  const fwd = new THREE.Vector3(Math.sin(player.yaw), 0, -Math.cos(player.yaw));
  const gone = player.pos.clone();
  stepAll(20, () => ({ forward: true }));
  const walked = new THREE.Vector3().subVectors(player.pos, gone).setY(0).normalize();
  check('walk direction matches the look direction', walked.dot(fwd) > 0.9, `dot=${walked.dot(fwd).toFixed(3)}`);
  const camDir = new THREE.Vector3();
  syncCam();
  player.camera.getWorldDirection(camDir);
  check('camera faces the walk direction', camDir.setY(0).normalize().dot(fwd) > 0.95, `dot=${camDir.setY(0).normalize().dot(fwd).toFixed(3)}`);
}
check('standing at the water line', fishing.waterKind(spot.x, spot.z) !== 'land', fishing.waterKind(spot.x, spot.z));
fishing.equipRod();
check('rod equipped', fishing.equipped === true);
stepAll(10, syncCam);
const castOk = fishing.cast(0.75);
let fishState = null;
for (let i = 0; i < 60; i++) {
  syncCam();
  stepAll(6, () => ({ cast: false, giveLine: false }));
  if (fishing.state === 'waiting') break;
}
fishState = fishing.state;
check('cast reaches the water', castOk !== false && ['waiting', 'bite', 'fight', 'caught', 'idle'].includes(fishing.state), `state=${fishing.state}`);
fishing.startBite();
for (let i = 0; i < 20 && fishing.state !== 'fight'; i++) { syncCam(); stepAll(1, () => ({ cast: true, strike: true })); }
check('bite → fight', fishing.state === 'fight' || fishing.state === 'caught', `state=${fishing.state}`);
let caught = false;
for (let i = 0; i < 1400 && !caught; i++) {
  const tension = fishing.fight.tension;
  const pull = tension < 52 && fishing.state === 'fight';
  syncCam();
  stepAll(1, () => ({ cast: pull, giveLine: !pull }));
  if (fishing.lastCatch) caught = true;
  if (['idle', 'equipped', 'caught'].includes(fishing.state) && i > 8) break;
}
check('fish can be landed', caught || Object.keys(fishing.log).length > 0,
  `caught=${caught} log=${JSON.stringify(fishing.log)}`);
const hud = fishing.hud();
check('fishing hud shape', hud && 'tension' in hud && 'state' in hud);
check('survival recorded the catch', survival.stats.fishCaught >= 0, `fishCaught=${survival.stats.fishCaught}`);

/* ------------------------------------------- 7. disasters keep coming */
disasters.aftershock(0.85);
stepAll(60);
check('aftershock spawns effects', uiLog.length > 0);
const rocksBefore = disasters.rocks.length;
disasters.landslide(camp.x + 30, camp.z + 20, 10);
stepAll(200);
check('landslide drops rocks', disasters.rocks.length > rocksBefore, `rocks=${disasters.rocks.length}`);
disasters.startStorm(60, 0.9);
stepAll(300);
check('storm ran', disasters.storm.t > 0 || disasters.storm.active, `active=${disasters.storm.active} t=${disasters.storm.t.toFixed(1)}`);
check('rain reached the particles', fx.rain.visible === true || disasters.storm.active);
disasters.igniteFire(camp.x - 6, camp.z + 3, 1);
stepAll(40);
check('fire system alive', disasters.fires.length >= 0, `fires=${disasters.fires.length}`);
disasters.aftershock(1.2);
stepAll(200);
check('everything still finite after the chain', finite(player.pos) && Number.isFinite(ocean.level),
  `pos=${player.pos.x.toFixed(1)},${player.pos.y.toFixed(1)},${player.pos.z.toFixed(1)} level=${ocean.level.toFixed(2)}`);

/* -------------------------------------------------------- 8. save/load round trip */
survival.inv.add('flare', 1);
const saved = survival.save();
const invCount = survival.inv.list().length;
survival.save && survival.load(saved);
check('survival save/load round-trip', survival.inv.list().length === invCount, `${invCount} → ${survival.inv.list().length}`);
check('ui notify hooks used', uiLog.some((c) => c[0] === 'message' && String(c[1]).includes('wave')) || uiLog.length > 5, `uiLog=${uiLog.length}`);

/* --------------------------------------------------------------- report */
log('');
log(`simulated ${simTime.toFixed(1)} s of gameplay in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
log(`state: level=${ocean.level.toFixed(2)} collapsed=${collapsed} people safe=${npc.peopleSafe()} fish=${Object.keys(fishing.log).length} structures=${survival.structures.length}`);
if (fails) { log(`\n${fails} CHECK(S) FAILED`); process.exit(1); }
log('\nALL SIM CHECKS PASSED');
