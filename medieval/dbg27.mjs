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
const sites = {};
for (const F of [A, B]) {
  const orig = F.startAttack.bind(F);
  F.startAttack = (d) => { const st = new Error().stack.split('\n')[2].trim(); sites[st] = (sites[st] || 0) + 1; return orig(d); };
}
const p = { reaction: 0.24, guardError: 0.16, feintResist: 0.5, aggression: 0.6, footwork: 0.5, bash: 0.5, combo: 2, patience: 0.4, step: 1 };
const ba = new Brain(A, p), bb = new Brain(B, p);
const world = { bounds: { x: 12, z: 12 }, colliders: [] };
const DT = 1 / 120;
let t = 0;
for (let i = 0; i < 1200; i++) {
  t += DT;
  ba.update(DT, B); bb.update(DT, A);
  bindPair(A, B); A.update(DT, world, t); B.update(DT, world, t);
  const ev = resolveExchange(A, B, DT);
  for (const e of ev) {
    if (e.type === 'hit') console.log(`  t${t.toFixed(2)} HIT ${e.attacker.name}=>${e.victim.name} ${e.region} ${e.applied.toFixed(1)} dmg ${e.strike}${e.gap ? ' GAP ' + e.gap : ''} prot ${e.res.protection?.toFixed(2)} | victim ${e.victim.blocking ? 'blocking ' + e.victim.guardDir : e.victim.state} dist ${e.attacker.chestDistance(e.victim).toFixed(2)}`);
    else if (e.type === 'clash' || e.type === 'parry' || e.type === 'guardBreak' || e.type === 'graze') console.log(`  t${t.toFixed(2)} ${e.type} ${e.attacker.name}=>${e.victim.name} ${(e.energy || 0).toFixed(0)}J`);
  }
}
console.log('startAttack call sites:');
for (const k in sites) console.log(`  ${sites[k]}× ${k}`);
console.log(`hp A ${A.bodyState.health.toFixed(0)} B ${B.bodyState.health.toFixed(0)}`);
