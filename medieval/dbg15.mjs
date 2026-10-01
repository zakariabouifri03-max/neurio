import './node_modules/three/three.module.js';
await import('/tmp/domstub.mjs');
const { buildShield } = await import('./src/weapons.js');
const { SHIELDS } = await import('./src/data.js');
for (const s of SHIELDS) {
  const m = buildShield(s, 'ashcombe', [90, 70, 50]);
  let verts = 0; m.traverse((o) => { if (o.isMesh) verts += o.geometry.attributes.position?.count || 0; });
  console.log(`${s.id} verts=${verts} segs=${(m.userData.segs || []).length} model=${s.model}`);
}
