// probe: a cut against a raised guard — how far apart do the blades actually pass?
import './node_modules/three/three.module.js';
await import('/tmp/domstub.mjs');
const THREE = await import('three');
const { Fighter } = await import('./src/fighter.js');
const { resolveExchange, bindPair } = await import('./src/exchange.js');
const { weaponById, harnessById, shieldById } = await import('./src/data.js');
const { segSeg, makeSegOut } = await import('./src/mathx.js');
const SEG = makeSegOut();
const world = { bounds: { x: 9, z: 9 }, colliders: [] };

const args = process.argv.slice(2);
const aW = args[0] || 'longsword', dir = args[1] || 'D', dist = parseFloat(args[2] || '1.45');
const blockDir = args[3] || 'center';
const A = new Fighter({ name: 'A', weapon: weaponById(aW), harness: harnessById('gambeson'), shield: shieldById('none'), position: new THREE.Vector3(0, 0, dist), yaw: Math.PI });
const B = new Fighter({ name: 'B', weapon: weaponById('longsword'), harness: harnessById('hauberk'), shield: shieldById('none'), position: new THREE.Vector3(0, 0, 0), yaw: 0 });
const dt = 1 / 120;
let t = 0;
A.startAttack(dir); B.startBlock(blockDir);
const minDist = (W1, W2) => {
  let best = Infinity;
  for (const s1 of W1.world) for (const s2 of W2.world) {
    segSeg(s1.a, s1.b, s2.a, s2.b, SEG);
    best = Math.min(best, Math.sqrt(SEG.d2) - s1.r - s2.r);
  }
  return best;
};
for (let i = 0; i < 200; i++) {
  t += dt;
  if (A.state === 'windup' && A.stateT >= (A.move.dur.windup / A.swingScale) * 0.98) A.releaseAttack();
  bindPair(A, B); A.update(dt, world, t); B.update(dt, world, t);
  const ev = resolveExchange(A, B, dt);
  const near = minDist(A.wb, B.wb);
  const tip = A.weaponTip(new THREE.Vector3()), bt = B.weaponTip(new THREE.Vector3());
  if (ev.length || near < 0.12 || i % 40 === 0)
    console.log(`t${t.toFixed(3)} A:${A.state} gap=${near.toFixed(3)} gq=${(B.guardOut.quality||0).toFixed(2)} threat=${B.guardOut.noThreat?'none':(B.guardOut.distance||0).toFixed(2)} Bfist=${B.arm.R.pos.toArray().map(v=>v.toFixed(2)).join(',')} Atip=${tip.toArray().map(v=>v.toFixed(2)).join(',')} Btip=${bt.toArray().map(v=>v.toFixed(2)).join(',')} ${ev.map(e=>e.type).join(',')}`);
}
