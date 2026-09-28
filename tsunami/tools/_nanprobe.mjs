// temp probe — where do the NaN leaf vertices come from?
import * as THREE from 'three';
import { Mesher, addPalm, addPine, addBush, addCactus } from '../src/city.js';
import { mulberry32 } from '../src/util.js';

globalThis.document = {
  createElement() {
    const ctx = new Proxy({}, { get: () => () => ({ addColorStop() { } }) });
    return { width: 8, height: 8, getContext: () => ctx };
  },
};

const m = new Mesher();
const rng = mulberry32(7);
for (let i = 0; i < 6; i++) addPalm({ m, colliders: [] }, rng, { x: i * 5, y: 1, z: 0, scale: 1 });
for (let i = 0; i < 4; i++) addPine({ m, colliders: [] }, rng, { x: i * 5, y: 1, z: 20, scale: 1, kind: i % 2 ? 'pine' : 'broadleaf' });
addBush({ m, colliders: [] }, rng, { x: 0, y: 1, z: 40 });
addCactus({ m, colliders: [] }, rng, { x: 0, y: 1, z: 50 });

for (const [key, geos] of m.parts) {
  let naX = 0, naY = 0, naZ = 0, tot = 0, firstIdx = -1, firstVal = null;
  let sgx = 0, sgy = 0, sgz = 0, sCount = 0;
  for (const g of geos) {
    const a = g.attributes.position.array;
    for (let i = 0; i < a.length; i += 3) {
      tot++;
      if (!Number.isFinite(a[i])) naX++;
      if (!Number.isFinite(a[i + 1])) naY++;
      if (!Number.isFinite(a[i + 2])) naZ++;
      if (firstIdx < 0 && (!Number.isFinite(a[i]) || !Number.isFinite(a[i + 1]) || !Number.isFinite(a[i + 2]))) {
        firstIdx = i / 3; firstVal = [a[i], a[i + 1], a[i + 2]];
      }
      // any geometry that is uniformly NaN in one component?
      if (!Number.isFinite(a[i + 1])) { sgx += 1; sCount++; }
    }
  }
  console.log(key, 'geos=' + geos.length, 'verts=' + tot, `nan x=${naX} y=${naY} z=${naZ}`, 'first@' + firstIdx, firstVal && firstVal.map((v) => String(v)).join(','));
  // per-geometry detail for the first few
  geos.slice(0, 4).forEach((g, gi) => {
    const a = g.attributes.position.array;
    let n = 0;
    for (let i = 0; i < a.length; i += 3) if (!Number.isFinite(a[i]) || !Number.isFinite(a[i + 1]) || !Number.isFinite(a[i + 2])) n++;
    console.log('   geo', gi, 'verts=' + g.attributes.position.count, 'nanVerts=' + n, 'scaleHint=' + (g.userData.scaleHint || ''));
  });
}
