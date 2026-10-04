// Headless smoke test: exercises world-building + sim code without WebGL/DOM.
const proxy2d = new Proxy(function () {}, {
  get(t, p) {
    if (p === Symbol.toPrimitive) return () => 0;
    if (!(p in t)) t[p] = new Proxy(function () {}, this);
    return t[p];
  },
  set() { return true; },
  apply() { return proxy2d; },
});
const stubCanvas = () => ({ width: 0, height: 0, style: {}, getContext: () => proxy2d });
globalThis.document = {
  createElement: (tag) => (tag === 'canvas' ? stubCanvas() : { style: {}, classList: { add() {}, remove() {}, toggle() {} }, children: [], appendChild() {}, setAttribute() {} }),
  getElementById: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} }, innerHTML: '', textContent: '', appendChild() {}, addEventListener() {} }),
  querySelectorAll: () => [],
  addEventListener() {},
};
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.matchMedia = () => ({ matches: false });
globalThis.innerWidth = 1280; globalThis.innerHeight = 720;
globalThis.devicePixelRatio = 1;
globalThis.localStorage = { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = v; }, removeItem(k) { delete this._m[k]; } };
globalThis.performance = globalThis.performance || { now: () => Date.now() };

const THREE = await import('../vendor/three.module.js');
console.log('three ok', THREE.REVISION);

const { buildTextures } = await import('../streamer/src/tex.js');
buildTextures();
console.log('textures ok');

const { buildCity } = await import('../streamer/src/city.js');
const city = buildCity();
console.log('city ok — colliders:', city.colliders.length, 'interactables:', city.interactables.length);
city.update(0.1, 12, 0);
city.update(0.1, 22, 1);
console.log('city update ok (day+night)');

const { makeInterior } = await import('../streamer/src/houses.js');
for (const hid of ['room', 'studio', 'flat', 'villa', 'mansion']) {
  const it = makeInterior(hid);
  it.refreshSetup({ mic: 3, webcam: 2, cpu: 4, gpu: 5, ram: 3, monitor: 3, keyboard: 2, chair: 3, rgb: 3 });
  it.refreshFurniture({ 0: 'sofa', 1: 'plant', 2: 'tv', 3: 'neon' });
  console.log('interior ok:', hid, 'slots:', it.slots.length);
}

const { buildCar, buildHuman, Pedestrian, buildCockpit } = await import('../streamer/src/npc.js');
const car = buildCar(0xff0000, 1);
car.position.set(0, 0, 0);
const human = buildHuman(3, 'Tester');
const ped = new Pedestrian(2, [10, 10, 20, 20]);
ped.update(0.1);
const cockpit = buildCockpit();
console.log('npc/cars ok');

const { Player } = await import('../streamer/src/player.js');
const cam = new THREE.PerspectiveCamera(75, 1, 0.1, 100);
const pl = new Player(cam);
pl.teleport(-2, 12, 0);
for (let i = 0; i < 50; i++) { pl.keys.f = true; pl.update(0.05, city.colliders); }
console.log('walk ok →', pl.pos.x.toFixed(1), pl.pos.z.toFixed(1));
pl.enterCar({ mesh: car, stats: { speed: 30, accel: 12, turn: 2.4 }, id: 't' });
for (let i = 0; i < 60; i++) { pl.keys.f = true; pl.update(0.05, city.colliders); }
console.log('drive ok →', pl.car.mesh.position.x.toFixed(1), pl.car.mesh.position.z.toFixed(1), 'speed', Math.abs(pl.carSpeed).toFixed(1));
pl.exitCar();
console.log('exit ok →', pl.pos.x.toFixed(1), pl.pos.z.toFixed(1));

const data = await import('../streamer/src/data.js');
console.log('data ok — parts:', Object.keys(data.PARTS).length, 'games:', data.GAMES.length, 'houses:', data.HOUSES.length, 'quests:', data.QUESTS.length);
for (const q of data.QUESTS) q.check(data ? { parts: { gpu: 2, mic: 1 }, streams: 1, followers: 1e6, ownedHouses: ['room', 'mansion'] } : null);
console.log('quest checks ok');

console.log('SMOKE PASS ✔');
