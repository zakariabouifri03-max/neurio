import './node_modules/three/three.module.js';
await import('/tmp/domstub.mjs');
const THREE = await import('three');
const { Fighter } = await import('./src/fighter.js');
const { bindPair, resolveExchange } = await import('./src/exchange.js');
const { weaponById, harnessById } = await import('./src/data.js');
const { segSeg, makeSegOut, srand } = await import('./src/mathx.js');
const { threatPoint } = await import('./src/defense.js');
srand(11);
const DIR = process.argv[2] || 'R';
const A = new Fighter({ name: 'A', side: 'enemy', weapon: weaponById(process.argv[3] || 'longsword'), harness: harnessById('bouilli'), position: new THREE.Vector3(0, 0, Number(process.argv[4] || 1.5)), yaw: Math.PI });
const B = new Fighter({ name: 'B', side: 'enemy', weapon: weaponById('longsword'), harness: harnessById('bouilli'), position: new THREE.Vector3(0, 0, 0), yaw: 0 });
const world = { bounds: { x: 12, z: 12 }, colliders: [] };
const DT = 1 / 120;
const seg = makeSegOut();
const F = (v) => `${v.x.toFixed(2)},${v.y.toFixed(2)},${v.z.toFixed(2)}`;
let t = 0, started = false, best = 1e9, bestT = 0, bestPair = '';
for (let i = 0; i < 900; i++) {
  t += DT;
  if (!started && t > 0.4) { started = true; A.startAttack(DIR); }
  if (started && A.state === 'windup' && A.stateT > (A.move?.dur.windup || 0.3) * 0.8) A.releaseAttack();
  if (B.alive && !B.blocking) B.startBlock('center');
  bindPair(A, B);
  A.update(DT, world, t); B.update(DT, world, t);
  const ev = resolveExchange(A, B, DT);
  // min gap blade-to-blade, with the pair
  let m = 1e9, mp = '';
  for (let ii = 0; ii < A.wb.world.length; ii++) for (let jj = 0; jj < B.wb.world.length; jj++) {
    const s1 = A.wb.world[ii], s2 = B.wb.world[jj];
    segSeg(s1.a, s1.b, s2.a, s2.b, seg);
    const d = Math.sqrt(seg.d2) - s1.r - s2.r;
    if (d < m) { m = d; mp = `A${ii}[${F(s1.a)}→${F(s1.b)}] B${jj}[${F(s2.a)}→${F(s2.b)}]`; }
  }
  if (m < best) { best = m; bestT = t; bestPair = mp; }
  if (A.state !== 'idle') {
    const tp = threatPoint(B.rig, A.wb, 0.1, { facing: true, maxRange: 2.0, predict: 4 });
    console.log(`${t.toFixed(3)} A:${A.state.padEnd(7)} gap ${m.toFixed(3)} q ${(B.guardOut?.quality || 0).toFixed(2)} cr ${(B.guardOut?.cross || 0).toFixed(2)} | bite ${mp} | threat ${tp ? F(tp) : '-'} ${ev.map((e) => e.type + (e.energy ? ` E${e.energy.toFixed(0)}/${(e.absorbed || 0).toFixed(0)} s${(e.strength || 0).toFixed(2)}` : '')).join(',')}`);
  }
  if (t > 3) break;
}
console.log(`closest ${best.toFixed(3)} at t=${bestT.toFixed(2)}  ${bestPair}`);
console.log('hp', A.bodyState.health.toFixed(0), B.bodyState.health.toFixed(0));
