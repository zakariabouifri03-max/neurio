// Does skill actually win fights? A man of one skill against a man of another,
// matched kit, matched hall. The number that matters is not how often somebody
// dies — it is who is left standing.
import './node_modules/three/three.module.js';
await import('/tmp/domstub.mjs');
const THREE = await import('three');
const { Fighter } = await import('./src/fighter.js');
const { Brain } = await import('./src/ai.js');
const { bindPair, resolveExchange } = await import('./src/exchange.js');
const { weaponById, harnessById, shieldById } = await import('./src/data.js');
const { srand } = await import('./src/mathx.js');
const world = { bounds: { x: 14, z: 14 }, colliders: [] };
const DT = 1 / 120;
const SKILLS = [
  { name: 'novice', p: { reaction: 0.55, guardError: 0.42, feintResist: 0.12, aggression: 0.5, footwork: 0.3, bash: 0.2, combo: 1, patience: 0.6, step: 0.8 } },
  { name: 'trained', p: { reaction: 0.38, guardError: 0.28, feintResist: 0.32, aggression: 0.6, footwork: 0.45, bash: 0.35, combo: 2, patience: 0.45, step: 1 } },
  { name: 'veteran', p: { reaction: 0.26, guardError: 0.18, feintResist: 0.55, aggression: 0.65, footwork: 0.6, bash: 0.5, combo: 2, patience: 0.35, step: 1.15 } },
  { name: 'elite', p: { reaction: 0.18, guardError: 0.12, feintResist: 0.72, aggression: 0.7, footwork: 0.75, bash: 0.65, combo: 3, patience: 0.24, step: 1.3 } },
  { name: 'legend', p: { reaction: 0.12, guardError: 0.07, feintResist: 0.88, aggression: 0.75, footwork: 0.9, bash: 0.8, combo: 3, patience: 0.16, step: 1.45 } },
];
const kit = (i) => ({
  weapon: weaponById(i === 0 ? 'longsword' : 'longsword'),
  harness: harnessById('whiteharness'), shield: shieldById('none'),
});
function duel(sa, sb, seed) {
  srand(seed);
  const a = new Fighter({ name: 'A', side: 'enemy', ...kit(0), position: new THREE.Vector3(0.5, 0, 1.6), yaw: Math.PI });
  const b = new Fighter({ name: 'B', side: 'enemy', ...kit(1), position: new THREE.Vector3(-0.5, 0, 0), yaw: 0 });
  const ba = new Brain(a, sa.p), bb = new Brain(b, sb.p);
  let t = 0, hits = [0, 0], stops = 0;
  for (let i = 0; i < 120 * 62; i++) {
    t += DT;
    ba.update(DT, b); bb.update(DT, a);
    bindPair(a, b);
    a.update(DT, world, t); b.update(DT, world, t);
    for (const e of resolveExchange(a, b, DT)) {
      if (e.type === 'hit') hits[e.attacker === a ? 0 : 1]++;
      else if (e.type === 'clash' || e.type === 'parry' || e.type === 'guardBreak') stops++;
    }
    if (!a.alive || !b.alive || (a.yielded || b.yielded)) break;
  }
  // the same rule the marshal uses: blows landed, then order
  const score = (f, hits) => hits * 2 + (f.alive && !f.yielded ? 1 : 0) + f.bodyState.health / f.bodyState.maxHealth * 0.6;
  return { t, hits, stops, win: score(a, hits[0]) - score(b, hits[1]) };
}
const seeds = Number(process.argv[2] || 9);
const rows = [];
for (let i = 0; i < SKILLS.length; i++) {
  const cells = [];
  for (let j = i; j < SKILLS.length; j++) {
    if (i === j) { const r = []; for (let s = 1; s <= 3; s++) r.push(duel(SKILLS[i], SKILLS[j], 500 + i * 77 + s * 13)); cells.push({ a: SKILLS[i].name, b: SKILLS[j].name, wins: r.filter((x) => x.win > 0).length / 3, t: r.reduce((q, x) => q + x.t, 0) / 3, hits: r.reduce((q, x) => q + x.hits[0] + x.hits[1], 0) / 3, stops: r.reduce((q, x) => q + x.stops, 0) / 3 }); continue; }
    const outs = [];
    for (let s = 1; s <= seeds; s++) outs.push(duel(SKILLS[i], SKILLS[j], 400 + i * 911 + j * 131 + s * 17));
    cells.push({ a: SKILLS[i].name, b: SKILLS[j].name, wins: outs.filter((x) => x.win > 0).length / outs.length, t: outs.reduce((q, x) => q + x.t, 0) / outs.length, hits: outs.reduce((q, x) => q + x.hits[0] + x.hits[1], 0) / outs.length, stops: outs.reduce((q, x) => q + x.stops, 0) / outs.length });
  }
  rows.push(cells);
}
console.log(`head to head (win rate for the LOWER-skill man, ${seeds} seeds):`);
for (let i = 0; i < SKILLS.length; i++) {
  const cells = rows[i];
  console.log('  ' + SKILLS[i].name.padEnd(8) + cells.slice(1).map((c) => `vs ${c.b.padEnd(8)} ${(c.wins * 100).toFixed(0).padStart(3)}%  end ${c.t.toFixed(0)}s  blows ${c.hits.toFixed(1)}  stops ${c.stops.toFixed(1)}`).join(' | '));
}
console.log('  mirror match (same skill, both men):');
for (const c of rows.map((r) => r[0])) console.log(`    ${c.a.padEnd(8)} end ${c.t.toFixed(0)}s  blows ${c.hits.toFixed(1)}  stops ${c.stops.toFixed(1)}`);
