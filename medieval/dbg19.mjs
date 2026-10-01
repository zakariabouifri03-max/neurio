// balance sweep: what a duel looks like across the skill dial
import './node_modules/three/three.module.js';
await import('/tmp/domstub.mjs');
const THREE = await import('three');
const { Fighter } = await import('./src/fighter.js');
const { Brain } = await import('./src/ai.js');
const { bindPair, resolveExchange } = await import('./src/exchange.js');
const { weaponById, harnessById, shieldById, CHAMPIONS } = await import('./src/data.js');
const { srand } = await import('./src/mathx.js');

function duel(reaction, hold, guardError, feintResist, seed, verbose) {
  srand(seed);
  const A = new Fighter({ name: 'A', side: 'enemy', weapon: weaponById('longsword'), harness: harnessById('bouilli'), position: new THREE.Vector3(0, 0, 1.6), yaw: Math.PI });
  const B = new Fighter({ name: 'B', side: 'enemy', weapon: weaponById('messer'), harness: harnessById('bouilli'), shield: shieldById('buckler'), position: new THREE.Vector3(0, 0, 0), yaw: 0 });
  const p = { reaction, guardError, feintResist, aggression: 0.6, footwork: 0.5, bash: 0.5, combo: 2, patience: 0.4, step: 1 };
  const ba = new Brain(A, p), bb = new Brain(B, p);
  const world = { bounds: { x: 12, z: 12 }, colliders: [] };
  const DT = 1 / 120;
  let t = 0, hits = 0, stops = 0, grazes = 0, dmgA = 0, dmgB = 0;
  const ev = [];
  while (t < 60 && A.alive && B.alive) {
    t += DT;
    ba.update(DT, B); bb.update(DT, A);
    bindPair(A, B);
    A.update(DT, world, t); B.update(DT, world, t);
    resolveExchange(A, B, DT, ev);
    for (const e of ev) {
      if (e.type === 'hit') { hits++; if (e.victim === A) dmgA += e.applied; else dmgB += e.applied; }
      if (e.type === 'clash' || e.type === 'parry') stops++;
      if (e.type === 'graze') grazes++;
    }
    ev.length = 0;
  }
  if (verbose) console.log(`   hits ${hits} (A took ${dmgA.toFixed(0)}, B took ${dmgB.toFixed(0)}) stops ${stops} grazes ${grazes} survival ${A.alive && B.alive ? 'both' : (A.alive ? 'A' : B.alive ? 'B' : 'neither')}`);
  return { t, hits, stops, grazes, dead: !A.alive || !B.alive };
}
console.log('skill dial (both men equal, longsword vs messer+buckler):');
for (const [name, r, h, ge, fr] of [
  ['novice   ', 0.30, 0.98, 0.20, 0.35],
  ['trained  ', 0.24, 0.92, 0.16, 0.50],
  ['veteran  ', 0.19, 0.84, 0.12, 0.65],
  ['elite    ', 0.15, 0.76, 0.08, 0.78],
  ['legend   ', 0.11, 0.70, 0.05, 0.88],
]) {
  const rows = [];
  for (let s = 1; s <= Number(process.argv[2] || 12); s++) rows.push(duel(r, h, ge, fr, s * 977));
  const times = rows.map((x) => x.t).sort((a, b) => a - b);
  const hits = rows.reduce((a, x) => a + x.hits, 0) / rows.length;
  const stops = rows.reduce((a, x) => a + x.stops, 0) / rows.length;
  const grazes = rows.reduce((a, x) => a + x.grazes, 0) / rows.length;
  console.log(`  ${name} deaths ${rows.filter((x) => x.dead).length}/${rows.length}  ends ${times.map((x) => x.toFixed(0)).join('/')}s  hits ${hits.toFixed(1)}  stops ${stops.toFixed(1)}  grazes ${grazes.toFixed(1)}`);
}
