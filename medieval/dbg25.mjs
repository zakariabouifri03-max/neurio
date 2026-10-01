// the guard matrix: which lines does each stance actually cover?
import './node_modules/three/three.module.js';
await import('/tmp/domstub.mjs');
const THREE = await import('three');
const { Fighter } = await import('./src/fighter.js');
const { bindPair, resolveExchange } = await import('./src/exchange.js');
const { weaponById, harnessById, shieldById } = await import('./src/data.js');
const { srand } = await import('./src/mathx.js');

function trial(aWeapon, dir, bGuard, dist, bShield = 'none') {
  srand(11 + dir.charCodeAt(0) + aWeapon.length);
  const world = { bounds: { x: 12, z: 12 }, colliders: [] };
  const A = new Fighter({ name: 'A', side: 'enemy', weapon: weaponById(aWeapon), harness: harnessById('gambeson'), position: new THREE.Vector3(0, 0, dist), yaw: Math.PI });
  const B = new Fighter({ name: 'B', side: 'enemy', weapon: weaponById('longsword'), harness: harnessById('hauberk'), shield: shieldById(bShield), position: new THREE.Vector3(0, 0, 0), yaw: 0 });
  const DT = 1 / 120;
  let t = 0;
  A.startAttack(dir);
  B.guardWeapon = A.wb;
  B.readError = 0;
  let outcome = 'none', dmg = 0;
  for (let i = 0; i < 300; i++) {
    t += DT;
    if (A.state === 'windup' && A.stateT >= (A.move.dur.windup / A.swingScale) * 0.85) A.releaseAttack();
    B.startBlock(bGuard);
    bindPair(A, B);
    A.update(DT, world, t); B.update(DT, world, t);
    for (const e of resolveExchange(A, B, DT)) {
      if (e.type === 'clash' || e.type === 'parry') outcome = e.type;
      else if (e.type === 'graze') outcome = between(outcome, 'graze');
      else if (e.type === 'hit') { outcome = 'HIT'; dmg = e.applied; }
    }
  }
  return { outcome, dmg };
}
function between(a, b) { return a === 'none' ? b : a; }
const DIRS = ['R', 'U', 'D', 'L'];
for (const w of ['longsword', 'arming', 'spear']) {
  const dist = w === 'spear' ? 2.1 : 1.5;
  console.log(`\n${w} @ ${dist} m — rows: attack dir, cols: defender's guard`);
  console.log('        ' + ['center', 'high', 'left', 'right', 'low'].map((g) => g.padStart(9)).join(''));
  for (const dir of DIRS) {
    const row = [];
    for (const g of ['center', 'high', 'left', 'right', 'low']) {
      const r = trial(w, dir, g, dist);
      row.push(`${r.outcome === 'HIT' ? 'HIT ' + r.dmg.toFixed(0) : r.outcome}`.padStart(9));
    }
    console.log(`${dir.padEnd(7)} ` + row.join(''));
  }
}
