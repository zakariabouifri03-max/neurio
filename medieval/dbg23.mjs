import './node_modules/three/three.module.js';
await import('/tmp/domstub.mjs');
const THREE = await import('three');
const { Fighter } = await import('./src/fighter.js');
const { bindPair, resolveExchange } = await import('./src/exchange.js');
const { weaponById, harnessById } = await import('./src/data.js');
const { srand } = await import('./src/mathx.js');
srand(3);
const world = { bounds: { x: 12, z: 12 }, colliders: [] };
for (const [dir, dist] of [['D', 1.6], ['U', 1.6], ['R', 1.6]]) {
  const A = new Fighter({ name: 'A', side: 'enemy', weapon: weaponById('longsword'), harness: harnessById('gambeson'), position: new THREE.Vector3(0, 0, dist), yaw: Math.PI });
  const B = new Fighter({ name: 'B', side: 'enemy', weapon: weaponById('messer'), harness: harnessById('bouilli'), position: new THREE.Vector3(0, 0, 0), yaw: 0 });
  const DT = 1 / 120;
  let t = 0;
  A.startAttack(dir);
  let maxFwd = 0, maxGap = 9, minGap = 9, evs = [];
  for (let i = 0; i < 240; i++) {
    t += DT;
    if (A.state === 'windup' && A.stateT >= (A.move.dur.windup / A.swingScale) * 0.8) A.releaseAttack();
    bindPair(A, B); A.update(DT, world, t); B.update(DT, world, t);
    for (const e of resolveExchange(A, B, DT)) evs.push(e.type);
    const tip = A.weaponTip(new THREE.Vector3());
    const fwd = -tip.z + 1.6;  // hmm: A is at z=dist facing -Z
    const chest = new THREE.Vector3().setFromMatrixPosition(A.rig.bones.chest.matrixWorld);
    const fwdRel = (dist - tip.z);   // tip is at z<dist; forward = dist - z   // how far the tip is from A's own plane toward B
    maxFwd = Math.max(maxFwd, fwdRel);
    const gap = tip.distanceTo(new THREE.Vector3().setFromMatrixPosition(B.rig.bones.chest.matrixWorld));
    maxGap = Math.min(maxGap, gap);
  }
  console.log(`${dir} @${dist}: tip reached ${maxFwd.toFixed(2)} m forward of A's own centre (needs ${dist.toFixed(2)}), closest to B's chest ${maxGap.toFixed(2)} m, events [${evs.join(',')}]`);
}
