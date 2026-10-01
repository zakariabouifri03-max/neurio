import './node_modules/three/three.module.js';
await import('/tmp/domstub.mjs');
const THREE = await import('three');
const { Fighter } = await import('./src/fighter.js');
const { Brain } = await import('./src/ai.js');
const { bindPair, resolveExchange } = await import('./src/exchange.js');
const { segSeg, makeSegOut, srand } = await import('./src/mathx.js');
const { weaponById, harnessById, shieldById } = await import('./src/data.js');
const SEG = makeSegOut();
srand(977);
const A = new Fighter({ name: 'A', side: 'enemy', weapon: weaponById('longsword'), harness: harnessById('bouilli'), position: new THREE.Vector3(0, 0, 1.6), yaw: Math.PI });
const B = new Fighter({ name: 'B', side: 'enemy', weapon: weaponById('messer'), harness: harnessById('bouilli'), shield: shieldById('buckler'), position: new THREE.Vector3(0, 0, 0), yaw: 0 });
const p = { reaction: 0.24, guardError: 0.16, feintResist: 0.5, aggression: 0.6, footwork: 0.5, bash: 0.5, combo: 2, patience: 0.4, step: 1 };
const ba = new Brain(A, p), bb = new Brain(B, p);
const world = { bounds: { x: 12, z: 12 }, colliders: [] };
const DT = 1 / 120;
const gapW = (W1, W2) => { let b = Infinity; for (const s1 of W1.world) for (const s2 of W2.world) { segSeg(s1.a, s1.b, s2.a, s2.b, SEG); b = Math.min(b, Math.sqrt(SEG.d2) - s1.r - s2.r); } return b; };
let t = 0, ev = [];
const near = { A: 9 };
for (let i = 0; i < 1440; i++) {
  t += DT;
  ba.update(DT, B); bb.update(DT, A);
  bindPair(A, B);
  A.update(DT, world, t); B.update(DT, world, t);
  resolveExchange(A, B, DT, ev);
  if (ev.length) console.log(`t${t.toFixed(2)} ${ev.map((e) => e.type).join(',')}`);
  ev.length = 0;
  if (A.state === 'strike' || A.state === 'follow') {
    const g = gapW(A.wb, B.wb);
    near.A = Math.min(near.A, g);
  }
  if (i % 240 === 0) console.log(`  t${t.toFixed(1)} dist ${A.chestDistance(B).toFixed(2)} A ${A.state} st${A.stamina.toFixed(0)} (${A.pos.x.toFixed(1)},${A.pos.z.toFixed(1)}) B ${B.state} (${B.pos.x.toFixed(1)},${B.pos.z.toFixed(1)}) idealA ${(A.measure*0.82).toFixed(2)} gapSteel ${gapW(A.wb, B.wb).toFixed(2)}`);
}
console.log('closest A steel to B steel during A strikes:', near.A.toFixed(3));
