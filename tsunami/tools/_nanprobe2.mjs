import * as THREE from 'three';
// 1) base plane, exactly as addPalm builds it
const g = new THREE.PlaneGeometry(3.4, 0.62, 4, 1);
const p = g.attributes.position;
console.log('base count', p.count);
for (let i = 0; i < p.count; i++) console.log(i, p.getX(i).toFixed(2), p.getY(i).toFixed(2), p.getZ(i).toFixed(2));
const pos = g.attributes.position;
for (let i = 0; i < pos.count; i++) {
  const fx = pos.getX(i), fy = pos.getY(i);
  const t = (fx + 1.7) / 3.4;
  pos.setZ(i, -Math.pow(t, 1.9) * 1.4);
  pos.setY(i, fy * (1 - t * 0.55));
}
console.log('--- after bend');
for (let i = 0; i < pos.count; i++) console.log(i, pos.getX(i).toFixed(2), pos.getY(i).toFixed(2), pos.getZ(i).toFixed(2));
g.computeVertexNormals();
console.log('--- normals', g.attributes.normal.array.slice(0, 6).join(','));
const { xf, colorGeo } = await import('../src/util.js');
const f = xf(colorGeo(g.clone(), new THREE.Color(0x336633)), { pos: [1, 2, 3], rot: [0, 1.5, -0.4], scale: [1, 1, 1] });
const a = f.attributes.position.array;
let bad = [];
for (let i = 0; i < a.length; i += 3) if (!Number.isFinite(a[i]) || !Number.isFinite(a[i + 1]) || !Number.isFinite(a[i + 2])) bad.push(i / 3);
console.log('after xf, NaN verts:', bad.join(',') || 'none');
