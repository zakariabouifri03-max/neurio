// tools/selftest.mjs — headless logic smoke-test (no WebGL): builds the whole world,
// checks the height field, roads, spawn points and the ocean/water model.
// run:  node tools/selftest.mjs
import * as THREE from 'three';
import { World, WORLD_SIZE } from '../src/world.js';
import { Ocean, buildWaveSet } from '../src/ocean.js';

// minimal canvas stub so texture bakers can run head-less (they only need the pixel APIs)
class FakeCtx {
  constructor(w, h) { this.w = w; this.h = h; this.canvas = { width: w, height: h }; }
  createImageData(w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; }
  getImageData(x, y, w, h) { return this.createImageData(w, h); }
  putImageData() { } fillRect() { } clearRect() { } beginPath() { } closePath() { }
  moveTo() { } lineTo() { } quadraticCurveTo() { } arc() { } ellipse() { } fill() { } stroke() { }
  drawImage() { } createRadialGradient() { return { addColorStop() { } }; }
  createLinearGradient() { return { addColorStop() { } }; }
}
globalThis.document = {
  createElement(tag) {
    if (tag !== 'canvas') return { style: {} };
    const c = { width: 1, height: 1, getContext: () => new FakeCtx(c.width, c.height) };
    return c;
  },
};

const t0 = Date.now();
const log = (...a) => console.log('[test]', ...a);
let fails = 0;
function check(name, cond, extra = '') {
  if (cond) log('✓', name, extra);
  else { fails++; log('✗ FAIL', name, extra); }
}

const fakeMat = new Proxy({}, { get: () => new THREE.MeshStandardMaterial() });

const scene = new THREE.Scene();
const world = new World(scene, 'low', 4242);

let t = Date.now();
world.buildHeightField();
log('heightfield', `${Date.now() - t} ms`, `N=${world.hn}`);

// heights must be finite and in a sane range
let bad = 0, min = 1e9, max = -1e9;
for (let i = 0; i < world.heights.length; i += 7) {
  const h = world.heights[i];
  if (!Number.isFinite(h)) bad++;
  if (h < min) min = h; if (h > max) max = h;
}
check('heights finite', bad === 0, `bad=${bad}`);
check('height range', min > -40 && max < 700, `min=${min.toFixed(1)} max=${max.toFixed(1)}`);

t = Date.now();
world.defineRoads().buildRoads();
log('roads', `${Date.now() - t} ms`, `count=${world.roads.length}`);

// road grade check (every road must stay drivable)
let worstGrade = 0, worstName = '';
world.roads.forEach((r, i) => {
  for (let k = 2; k < r.samples.length; k++) {
    const a = r.samples[k - 2], b = r.samples[k];
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    const g = Math.abs(b.y - a.y) / Math.max(d, 0.001);
    if (g > worstGrade) { worstGrade = g; worstName = 'road' + i; }
  }
});
check('road grade drivable', worstGrade < 0.24, `worst=${worstGrade.toFixed(3)} on ${worstName}`);

// the road surface must sit on the solid ground (not floating / buried)
let floatErr = 0;
for (const r of world.roads) {
  for (let i = 5; i < r.samples.length; i += 17) {
    const s = r.samples[i];
    const diff = Math.abs(world.heightAt(s.x, s.z) - s.y);
    if (diff > 1.2) floatErr++;
  }
}
check('road sticks to the ground', floatErr === 0, `bad=${floatErr}`);

t = Date.now();
const tex = world.makeHeightTexture(256);
log('height texture', `${Date.now() - t} ms`);
check('height texture', !!tex && tex.image.width === 256);

t = Date.now();
world.buildTerrainMesh({ terrain: fakeMat, sandStone: fakeMat, rock: fakeMat, grass: fakeMat, dirt: fakeMat, tile: fakeMat });
log('terrain mesh', `${Date.now() - t} ms`, `verts=${world.terrainMesh.geometry.attributes.position.count}`);

t = Date.now();
world.buildCity();
world.buildCoast();
world.buildMountain();
log('city+coast+mountain', `${Date.now() - t} ms`);
check('colliders created', world.colliders.length > 50, `n=${world.colliders.length}`);

t = Date.now();
world.buildRoadMeshes({
  asphalt: fakeMat, gravel: fakeMat, plaster: fakeMat, rock: fakeMat, sandStone: fakeMat,
  wood: fakeMat, metal: fakeMat, tile: fakeMat, concrete: fakeMat, glass: fakeMat, fabric: fakeMat,
  thatch: fakeMat, leaf: fakeMat, bark: fakeMat, foliage: fakeMat, rockPlain: fakeMat, emissive: fakeMat,
  cloth: fakeMat, net: fakeMat, dirt: fakeMat,
});
let chunkCount = world.chunks.size;
let tris = 0;
for (const [, m] of world.chunks) {
  for (const [, geos] of m.parts) for (const g of geos) tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
}
log('road meshes', `${Date.now() - t} ms`);
log('city chunks', chunkCount, 'pending geometries', tris.toFixed(0));
check('city has geometry', tris > 5000);

t = Date.now();
world.finalize({
  asphalt: fakeMat, gravel: fakeMat, plaster: fakeMat, rock: fakeMat, sandStone: fakeMat,
  wood: fakeMat, metal: fakeMat, tile: fakeMat, concrete: fakeMat, glass: fakeMat, fabric: fakeMat,
  thatch: fakeMat, leaf: fakeMat, bark: fakeMat, foliage: fakeMat, rockPlain: fakeMat, emissive: fakeMat,
  cloth: fakeMat, net: fakeMat, dirt: fakeMat, terrain: fakeMat,
});
log('finalize', `${Date.now() - t} ms`, `scene children=${scene.children.length}`);

// ---- spawn point sanity
const sp = world.spawns;
check('beach spawn exists', !!sp.beach);
check('beach spawn dry', sp.beach && world.heightAt(sp.beach.x, sp.beach.z) > 0.4, sp.beach ? `h=${world.heightAt(sp.beach.x, sp.beach.z).toFixed(2)}` : '');
check('beach spawn near the water', sp.beach && world.heightAt(sp.beach.x, sp.beach.z) < 9, sp.beach ? `h=${world.heightAt(sp.beach.x, sp.beach.z).toFixed(2)}` : '');
check('camp spawn', !!sp.camp, sp.camp ? `h=${world.heightAt(sp.camp.x, sp.camp.z).toFixed(1)}` : '');
check('camp is a bench (flat)', !!sp.camp && world.slopeAt(sp.camp.x + 8, sp.camp.z) < 0.12, sp.camp ? `slope=${world.slopeAt(sp.camp.x + 8, sp.camp.z).toFixed(3)}` : '');
check('summit spawn', !!sp.summit, sp.summit ? `h=${world.heightAt(sp.summit.x, sp.summit.z).toFixed(1)}` : '');
check('summit high', !!sp.summit && world.heightAt(sp.summit.x, sp.summit.z) > 250, sp.summit ? `h=${world.heightAt(sp.summit.x, sp.summit.z).toFixed(1)}` : '');
check('harbor spawn', !!sp.harbor, sp.harbor ? `h=${world.heightAt(sp.harbor.x, sp.harbor.z).toFixed(1)}` : '');
check('lake exists', !!world.lake, world.lake ? `y=${world.lake.y.toFixed(1)}` : '');
check('region sea', world.regionAt(world.coastX(0) - 300, 0) === 'sea', world.regionAt(world.coastX(0) - 300, 0));
check('region city', world.regionAt(420, -60) === 'city', world.regionAt(420, -60));
check('region mountain', world.regionAt(930, -70) === 'mountain', world.regionAt(930, -70));
check('onRoad near highway', !!world.onRoad(196, -150));

// ---- ocean model
const ocean = new Ocean(scene, {
  heightTex: tex, size: WORLD_SIZE, texSize: 256, minHeight: -20,
  heightAt: (x, z) => world.heightAt(x, z),
}, 'low', null);
check('ocean waves', ocean.waves.length === 8 && ocean.waves.every((w) => Number.isFinite(w.amp) && w.amp > 0));
const wy = ocean.waterYAt(0, 0);
check('calm water at level 0', Math.abs(wy) < 1.2, `y=${wy.toFixed(3)}`);
ocean.setLevel(15);
ocean.setWaveAmp(1);
for (let i = 0; i < 260; i++) ocean.update(1 / 20, { position: new THREE.Vector3(0, 5, 0) }, new THREE.Vector3(0, 0, 0));
check('flood level rises over ~13s', ocean.level > 12, `level=${ocean.level.toFixed(2)}`);
const depthCity = ocean.depthAt(420, -60);
check('city floods', depthCity > 0.2, `depth=${depthCity.toFixed(2)}`);
const f = ocean.spawnFront({ x: -400, z: -150, dirX: 1, dirZ: 0, height: 22, speed: 60, lead: 34, trail: 220 });
check('front spawns', ocean.fronts.length === 1);
let crest = 0;
for (let i = 0; i < 60; i++) {
  ocean.update(1 / 30, { position: new THREE.Vector3(-500, 5, -150) }, new THREE.Vector3(-500, 0, -150));
  crest = Math.max(crest, ocean.waterYAt(f.x, f.z));
}
check('crest height sane', crest > 12 && crest < 60, `crest=${crest.toFixed(1)}`);
check('front travels', f.x > -400 + 50, `x=${f.x.toFixed(0)}`);
ocean.setLevel(0);
for (let i = 0; i < 700; i++) ocean.update(1 / 30, { position: new THREE.Vector3(0, 5, 0) }, new THREE.Vector3(0, 0, 0));
check('flood drains over ~23s', ocean.level < 2.0, `level=${ocean.level.toFixed(2)}`);

// ---- wave spectrum sanity
const spec = buildWaveSet(7, 1, [1, 0], 0.8);
check('wave spectrum', spec.length === 8 && spec.every((w) => w.amp > 0 && w.k > 0 && Number.isFinite(w.steep)));

log(`total ${Date.now() - t0} ms`);
log(fails === 0 ? 'ALL CHECKS PASSED' : `${fails} CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
