// Can a charged blow open a guard? A blows, B holds. Three charge levels.
import './node_modules/three/three.module.js';
await import('/tmp/domstub.mjs');
const THREE = await import('three');
const { Fighter } = await import('./src/fighter.js');
const { bindPair, resolveExchange } = await import('./src/exchange.js');
const { weaponById, harnessById } = await import('./src/data.js');
const { srand } = await import('./src/mathx.js');
const world = { bounds: { x: 12, z: 12 }, colliders: [] };
const DT = 1 / 120;
for (const wid of ['longsword', 'greatsword', 'poleaxe']) {
  const line = [];
  for (const hold of [0.55, 0.75, 0.92, 1.0]) {
    srand(31);
    const A = new Fighter({ name: 'A', side: 'enemy', weapon: weaponById(wid), harness: harnessById('bouilli'), position: new THREE.Vector3(0, 0, 1.35), yaw: Math.PI });
    const B = new Fighter({ name: 'B', side: 'enemy', weapon: weaponById('longsword'), harness: harnessById('halfplate'), position: new THREE.Vector3(0, 0, 0), yaw: 0 });
    let t = 0, started = false, out = 'none', detail = '';
    for (let i = 0; i < 600; i++) {
      t += DT;
      if (!started && t > 0.3) { started = true; A.startAttack('U'); }
      if (A.state === 'windup' && A.stateT > (A.move?.dur.windup || 0.3) * hold) A.releaseAttack();
      if (B.alive && !B.blocking) B.startBlock('center');
      bindPair(A, B);
      A.update(DT, world, t); B.update(DT, world, t);
      for (const e of resolveExchange(A, B, DT)) {
        if (e.type === 'touch' || e.type === 'graze') continue;
        out = e.type;
        detail = `E${(e.energy || 0).toFixed(0)} absorbed ${(e.absorbed || 0).toFixed(0)} vs guard ${(e.strength || 0).toFixed(2)} blk=${B.blocking} st=${B.stamina.toFixed(0)}/${B.maxStamina.toFixed(0)} exh=${B.exhausted}` + (e.region ? ` → ${e.region} ${(e.applied || 0).toFixed(1)}` : '');
        i = 600;
      }
    }
    line.push(`hold ${hold}: ${out}${detail ? ' ' + detail : ''}`);
  }
  console.log(wid.padEnd(11) + line.join('\n            '));
}
