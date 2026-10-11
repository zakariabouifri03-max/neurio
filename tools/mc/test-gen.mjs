// Headless harness: runs the Minecraft world generator under Node with a
// minimal canvas stub, so the pure-logic parts can be validated without a GPU.
import { performance } from 'node:perf_hooks';

class ImageData {
  constructor(w, h) { this.width = w; this.height = h; this.data = new Uint8ClampedArray(w * h * 4); }
}
class Ctx2D {
  constructor(c) { this.canvas = c; this._img = new ImageData(c.width, c.height); }
  clearRect() { this._img.data.fill(0); }
  createImageData(w, h) { return w === undefined ? new ImageData(this.canvas.width, this.canvas.height) : new ImageData(w, h); }
  getImageData(x, y, w, h) {
    const out = new ImageData(w, h);
    const src = this._img.data;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const s = ((y + j) * this.canvas.width + (x + i)) * 4, d = (j * w + i) * 4;
      out.data[d] = src[s]; out.data[d + 1] = src[s + 1]; out.data[d + 2] = src[s + 2]; out.data[d + 3] = src[s + 3];
    }
    return out;
  }
  putImageData(d, x, y) {
    for (let j = 0; j < d.height; j++) for (let i = 0; i < d.width; i++) {
      const t = ((y + j) * this.canvas.width + (x + i)) * 4, s = (j * d.width + i) * 4;
      if (t < 0 || t + 3 >= this._img.data.length) continue;
      this._img.data[t] = d.data[s]; this._img.data[t + 1] = d.data[s + 1]; this._img.data[t + 2] = d.data[s + 2]; this._img.data[t + 3] = d.data[s + 3];
    }
  }
  drawImage() {}
}
class Canvas {
  constructor() { this.width = 300; this.height = 150; }
  getContext() { return (this._ctx ||= new Ctx2D(this)); }
  toDataURL() { return 'data:,'; }
}
globalThis.document = { createElement: (t) => (t === 'canvas' ? new Canvas() : { style: {} }) };
globalThis.window = globalThis;
globalThis.self = globalThis;

const t0 = performance.now();
const { generateTerrain, SEA, SIZE } = await import('/home/user/neurio/src/minecraft/terrain.js');
const { populate } = await import('/home/user/neurio/src/minecraft/structures.js');
const { B, PALETTE } = await import('/home/user/neurio/src/minecraft/textures.js');
const { buildAtlas } = await import('/home/user/neurio/src/minecraft/textures.js');

const seed = Number(process.argv[2] || 20261011);
const T = generateTerrain(seed);
const t1 = performance.now();
const E = {
  torches: [], lights: [], campfires: [], beacons: [], spawn: {},
};
const deco = populate(T, E);
const t2 = performance.now();

// ── atlas ──────────────────────────────────────────────────────────────────
const atlas = buildAtlas(seed);
const t3 = performance.now();

// ── mesher ─────────────────────────────────────────────────────────────────
const THREE = await import('three');
const dummyMats = {};
for (const k of ['opaque', 'cutout', 'transparent', 'emissive']) dummyMats[k] = new THREE.MeshBasicMaterial();
T.world.setMaterials(dummyMats);
const group = T.world.buildAll();
const t4 = performance.now();

// ── report ─────────────────────────────────────────────────────────────────
const hist = {};
for (const id of T.world.blocks.values()) { const n = PALETTE[id].name; hist[n] = (hist[n] || 0) + 1; }
const top = Object.entries(hist).sort((a, b) => b[1] - a[1]).slice(0, 16);
let tris = 0, verts = 0, idxTotal = 0;
for (const m of group.children) {
  const ic = m.geometry.index ? m.geometry.index.count : 0;
  idxTotal += ic;
  verts += m.geometry.attributes.position.count;
  if (ic % 3 !== 0 || ic / 3 !== m.geometry.attributes.position.count / 4 * 2) {
    console.log('  odd mesh', m.name, 'idx', ic, 'pos', m.geometry.attributes.position.count, m.geometry.index.array.constructor.name);
  }
}
tris = idxTotal / 3;

console.log('seed                ', seed);
console.log('terrain ms          ', (t1 - t0).toFixed(0));
console.log('structures ms       ', (t2 - t1).toFixed(0), JSON.stringify(deco));
console.log('atlas ms            ', (t3 - t2).toFixed(0));
console.log('mesh ms             ', (t4 - t3).toFixed(0));
console.log('blocks              ', T.world.stats.blocks);
console.log('faces / tris / verts', T.world.stats.faces, tris, verts);
console.log('chunks (meshes)     ', T.world.stats.chunks, group.children.length);
console.log('entities            ', JSON.stringify({ torches: E.torches.length, lights: E.lights.length, campfires: E.campfires.length, beacons: E.beacons.length }));
console.log('spawns              ', JSON.stringify(E.spawn));
console.log('layout house        ', JSON.stringify(E.layout.house));
console.log('layout tower        ', JSON.stringify(E.layout.tower && { x0: E.layout.tower.x0, y: E.layout.tower.y, dy: E.layout.tower.dy }));
console.log('layout farm         ', JSON.stringify(E.layout.farm));
console.log('layout mine         ', JSON.stringify(E.layout.mine));
console.log('dock                ', JSON.stringify(E.dock && { deckY: E.dock.deckY, landing: E.dock.landing, end: E.dock.end }));
console.log('top blocks          ', top.map(([n, c]) => `${n}:${c}`).join('  '));
// sanity: height profile
let minH = 1e9, maxH = -1e9, water = 0;
for (let x = -SIZE; x <= SIZE; x += 4) for (let z = -SIZE; z <= SIZE; z += 4) {
  const h = T.height(x, z); if (h === undefined) continue;
  if (h < minH) minH = h; if (h > maxH) maxH = h;
}
console.log('height range        ', minH, '→', maxH, ' SEA =', SEA, ' SIZE =', SIZE);
// sanity checks
const fails = [];
if (T.world.stats.blocks < 50000) fails.push('too few blocks');
if (!E.layout.house) fails.push('no house');
if (!E.layout.tower) fails.push('no tower');
if (!E.spawn.dock) fails.push('no dock');
if (group.children.length < 4) fails.push('too few chunk meshes');
if (tris < 10000) fails.push('too few triangles');
console.log(fails.length ? '❌ ' + fails.join(', ') : '✅ all sanity checks passed');
process.exit(fails.length ? 1 : 0);
