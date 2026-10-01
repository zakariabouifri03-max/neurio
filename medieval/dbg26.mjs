import './node_modules/three/three.module.js';
await import('/tmp/domstub.mjs');
const THREE = await import('three');
const { Fighter } = await import('./src/fighter.js');
const { Brain } = await import('./src/ai.js');
const { bindPair, resolveExchange } = await import('./src/exchange.js');
const { weaponById, harnessById, shieldById } = await import('./src/data.js');
const { srand } = await import('./src/mathx.js');
srand(977);
const A = new Fighter({ name: 'A', side: 'enemy', weapon: weaponById('longsword'), harness: harnessById('bouilli'), position: new THREE.Vector3(0, 0, 1.6), yaw: Math.PI });
const B = new Fighter({ name: 'B', side: 'enemy', weapon: weaponById('messer'), harness: harnessById('bouilli'), shield: shieldById('buckler'), position: new THREE.Vector3(0, 0, 0), yaw: 0 });
const p = { reaction: 0.11, guardError: 0.05, feintResist: 0.88, aggression: 0.6, footwork: 0.5, bash: 0.5, combo: 2, patience: 0.4, step: 1 };
const ba = new Brain(A, p), bb = new Brain(B, p);
const world = { bounds: { x: 12, z: 12 }, colliders: [] };
const DT = 1 / 120;
let t = 0, ev = [];
let lastA = 'idle';
for (let i = 0; i < 1440; i++) {
  t += DT;
  ba.update(DT, B); bb.update(DT, A);
  bindPair(A, B);
  A.update(DT, world, t); B.update(DT, world, t);
  if (A.state === 'windup' && lastA !== 'windup') console.log(`t${t.toFixed(2)} A winds ${A.move.dir} at dist ${A.chestDistance(B).toFixed(2)} | B ${B.state} guard ${B.guardDir}`);
  if (A.state === 'strike' && lastA === 'windup') console.log(`t${t.toFixed(2)} A releases (held ${(A.stateT).toFixed(2)}) | B ${B.state} guard ${B.guardDir} gq ${(B.guardOut.quality || 0).toFixed(2)}`);
  lastA = A.state;
  resolveExchange(A, B, DT, ev);
  for (const e of ev) {
    if (e.type === 'hit' || e.type === 'clash' || e.type === 'parry' || e.type === 'guardBreak') {
      console.log(`   t${t.toFixed(2)} ${e.type.toUpperCase()} ${e.region || ''} ${(e.applied || e.energy || 0).toFixed(1)}${e.cross !== undefined ? ' cross ' + e.cross.toFixed(2) : ''} | defender was ${e.victim === B ? 'B' : 'A'} ${(e.victim === B ? B : A).blocking ? 'blocking ' + (e.victim === B ? B : A).guardDir : 'open'} dmg ${dmgTxt(e)}`);
    }
  }
  ev.length = 0;
  if (!A.alive || !B.alive) { console.log(`t${t.toFixed(2)} END hp A ${A.bodyState.health.toFixed(0)} B ${B.bodyState.health.toFixed(0)}`); break; }
}
function dmgTxt(e) { return e.res ? `${e.res.region} ${e.res.applied.toFixed(1)} dmg ${e.res.strike} ${e.res.gap || ''}` : ''; }
