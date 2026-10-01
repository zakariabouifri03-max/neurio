import './node_modules/three/three.module.js';
await import('/tmp/domstub.mjs');
const THREE = await import('three');
const { Fighter } = await import('./src/fighter.js');
const { weaponById, harnessById, WEAPONS } = await import('./src/data.js');
const { moveRange, movesetFor } = await import('./src/moves.js');
for (const w of WEAPONS) {
  const f = new Fighter({ name: w.id, weapon: w, harness: harnessById('gambeson'), position: new THREE.Vector3(), yaw: 0 });
  const r = Object.entries(f.ranges).map(([k, v]) => `${k}:${v.toFixed(2)}`).join(' ');
  console.log(`${w.id.padEnd(11)} ${r}  measure ${f.measure.toFixed(2)} close ${f.measureClose.toFixed(2)} tipLen ${f.tipLen.toFixed(2)} reach ${f.reach.toFixed(2)}`);
  if (w.id === 'longsword') {
    for (const [k, m] of Object.entries(f.moveSet)) console.log(`     ${k} ${m.name.padEnd(14)} ranges ${['windup','strike','follow'].map((p) => p[0] + moveRange({ ...m, rest: m.rest }, f.tipLen).toFixed(2)).join(' ')} kind ${m.kind} lunge ${m.lunge || 0}`);
  }
}
