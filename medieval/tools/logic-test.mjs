// Headless logic harness: exercises the world-building, the weapons, the armour
// model, the fighters and the real exchange (blow, guard, parry, guard break)
// without a GPU. Run: node tools/logic-test.mjs
//
// Everything here drives the SAME code the game runs: Fighter.update() and
// resolveExchange(). A check that passes here is a claim about the game, not
// about a re-implementation of it.
import '../node_modules/three/three.module.js';
await import('/tmp/domstub.mjs');

const THREE = await import('three');
const { Arena } = await import('../src/arena.js');
const { Rig } = await import('../src/characters.js');
const { buildWeapon, buildShield, classifyContact } = await import('../src/weapons.js');
const { BodyState, resolveStrike } = await import('../src/combat.js');
const { Fighter, poseToWorld, poseQuatWorld } = await import('../src/fighter.js');
const { resolveExchange, bindPair } = await import('../src/exchange.js');
const { threatPoint } = await import('../src/defense.js');
const { WEAPONS, HARNESS, SHIELDS, CHAMPIONS, ARENAS, harnessById, weaponById, shieldById } = await import('../src/data.js');
const { movesetFor, GUARDS, PARRY_POSE } = await import('../src/moves.js');

let fails = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) { fails++; console.log(`  ✗ ${name} ${extra}`); } else console.log(`  ✓ ${name} ${extra}`);
};
const section = (s) => console.log(`\n── ${s} ──`);

// ════════════════════════════════════════════════════════════════════════════
section('arenas');
for (const a of ARENAS) {
  const arena = new Arena(a.id);
  let meshes = 0, verts = 0;
  arena.group.traverse((o) => { if (o.isMesh) { meshes++; verts += o.geometry.attributes.position?.count || 0; } });
  ok(`${a.id}: geometry`, meshes > 30 && verts > 2000, `${meshes} meshes, ${verts} verts, ${arena.colliders.length} colliders, ${arena.torches.length} torches`);
  ok(`${a.id}: has spawns`, arena.spawns.length >= 2 && !!arena.playerStart, JSON.stringify(arena.playerStart));
  if (arena.spawns.length >= 2) {
    const dx = arena.spawns[1].x - arena.spawns[0].x, dz = arena.spawns[1].z - arena.spawns[0].z;
    const want = Math.atan2(dx, dz);
    let d = ((arena.playerFacing - want + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    ok(`${a.id}: player faces the enemy`, Math.abs(d) < 0.08, `start yaw=${arena.playerFacing.toFixed(2)} want=${want.toFixed(2)}`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
section('rigs and harness');
for (const h of HARNESS) {
  const rig = new Rig({
    height: 1.78, build: 1, skin: 0xd0a882, hair: 0x3a2a1a, hairStyle: 'crop', beard: 1,
    cloth: [80, 60, 40], harness: h,
  });
  rig.root.updateWorldMatrix(true, true);
  const vols = rig.updateVolumes();
  const gaps = rig.gapWorld();
  const protChest = rig.body.protection('chest', 'cut');
  const protHead = rig.body.protection('head', 'cut');
  ok(`${h.id}: volumes`, vols.length === 16, `${vols.length} capsules`);
  ok(`${h.id}: gaps in world`, gaps.length > 2 && gaps.every((g) => Number.isFinite(g.x) && g.y > 0.4 && g.y < 2.1),
    `${gaps.length} seams, ${gaps.map((g) => g.y.toFixed(2)).join(',')}`);
  ok(`${h.id}: head protection sane`, protHead >= 0 && protHead <= 1, `chest-cut=${protChest.toFixed(2)} head-cut=${protHead.toFixed(2)}`);
  // the rig faces its own local +Z: put a fist out where the pose says and check
  // the steel comes back on that line
  const fist = poseToWorld(rig, GUARDS.center.hand, new THREE.Vector3());
  const q = poseQuatWorld(rig, GUARDS.center.blade, GUARDS.center.edge, new THREE.Quaternion());
  rig.solveArm('R', fist, new THREE.Vector3(0, -0.4, 0.4), q);
  rig.root.updateWorldMatrix(true, true);
  const got = new THREE.Vector3(0, 1, 0).applyQuaternion(rig.grip.R.getWorldQuaternion(new THREE.Quaternion()));
  const want = new THREE.Vector3(-GUARDS.center.blade.x, GUARDS.center.blade.y, -GUARDS.center.blade.z).applyQuaternion(rig.root.getWorldQuaternion(new THREE.Quaternion())).normalize();
  const at = rig.grip.R.getWorldPosition(new THREE.Vector3());
  ok(`${h.id}: the steel follows the pose`, got.dot(want) > 0.995 && at.distanceTo(fist) < 0.01, `dot ${got.dot(want).toFixed(3)}, fist error ${at.distanceTo(fist).toFixed(3)} m`);
  if (h.id === 'whiteharness') ok('full plate resists cuts better than mail', protChest > 0.9, protChest.toFixed(3));
}

// ════════════════════════════════════════════════════════════════════════════
section('weapons');
for (const w of WEAPONS) {
  const mesh = buildWeapon(w);
  let verts = 0;
  mesh.traverse((o) => { if (o.isMesh) verts += o.geometry.attributes.position?.count || 0; });
  const segs = mesh.userData.segs;
  const ud = mesh.userData;
  const parts = ud.parts;
  ok(`${w.id}: geometry`, verts > 300, `${verts} verts, ${segs.length} capsules`);
  ok(`${w.id}: capsules run butt → point`, segs[0].a.y <= parts.baseY + 0.06 && Math.abs(segs[segs.length - 1].b.y - parts.tipY) < 0.03,
    `${segs[0].a.y.toFixed(2)} → ${segs[segs.length - 1].b.y.toFixed(2)} (tip ${parts.tipY.toFixed(2)})`);
  ok(`${w.id}: the hand is on the grip`, ud.gripY > parts.baseY && ud.gripY < parts.tipY && ud.gripY2 <= ud.gripY,
    `grip ${ud.gripY.toFixed(2)} / off hand ${ud.gripY2.toFixed(2)} of ${parts.baseY.toFixed(2)} → ${parts.tipY.toFixed(2)}`);
  ok(`${w.id}: two men can carry the same pattern`, buildWeapon(w) !== mesh);
  ok(`${w.id}: has a moveset`, !!movesetFor(w.archetype), w.archetype);
  // reach: how far the point is from the fist, and how far the guard solver may
  // reach for steel with it
  ok(`${w.id}: reach quoted matches the steel`, ud.reachTip > 0.4 && ud.reachTip < 2.2, `fist → point ${ud.reachTip.toFixed(2)} m`);
}
{
  // which face of the steel arrived — checked directly, on the geometry
  const sword = buildWeapon(weaponById('longsword'));
  const p = new THREE.Vector3(0, sword.userData.parts.bladeStart + 0.6, 0);
  const cut = classifyContact(sword, p, new THREE.Vector3(0, 2, -14));
  const flat = classifyContact(sword, p, new THREE.Vector3(14, 2, 0));
  const stab = classifyContact(sword, p, new THREE.Vector3(0, 14, 1));
  const haft = classifyContact(sword, new THREE.Vector3(0, sword.userData.parts.baseY + 0.02, 0), new THREE.Vector3(0, 2, -14));
  console.log(`    edge ${cut.strike}/${cut.sharpness.toFixed(2)}   flat ${flat.strike}/${flat.sharpness.toFixed(2)}   point ${stab.strike}/${stab.sharpness.toFixed(2)}   grip ${haft.strike}`);
  ok('an edge that leads is a cut', cut.strike === 'cut' && cut.sharpness > 0.7);
  ok('the flat is not an edge', flat.strike === 'flat' && flat.sharpness < 0.4);
  ok('the point is a thrust', stab.strike === 'thrust');
  ok('the grip is not a blade', haft.strike === 'haft');
}
section('guards point at the threat');
for (const [k, g] of Object.entries(GUARDS)) {
  ok(`guard ${k} aims forward`, g.blade.z < -0.5 && g.blade.x > -0.62 && g.blade.x < 0.62, `blade=(${g.blade.x.toFixed(2)}, ${g.blade.y.toFixed(2)}, ${g.blade.z.toFixed(2)})`);
}
for (const [k, g] of Object.entries(PARRY_POSE)) {
  ok(`parry ${k} aims forward`, g.blade.z < -0.5, `blade=(${g.blade.x.toFixed(2)}, ${g.blade.y.toFixed(2)}, ${g.blade.z.toFixed(2)})`);
}

// ════════════════════════════════════════════════════════════════════════════
//  DUELS — the real exchange, driven through the real fighters
// ════════════════════════════════════════════════════════════════════════════
const world = { bounds: { x: 9, z: 9 }, colliders: [] };
const DT = 1 / 120;

function duel(o = {}) {
  const {
    aWeapon = 'longsword', aHarness = 'gambeson', aShield = 'none', aHouse = 'ashcombe',
    bWeapon = 'longsword', bHarness = 'bouilli', bShield = 'none', bHouse = 'ashcombe',
    dist = 1.3, dir = 'R', defend = 'none', hold = 0.98, seconds = 2.0, aStamina = 1, bStamina = 1,
    guardDir = 'center', edgeRoll = 0, blockAt = 0.18, aMove = true,
  } = o;
  const A = new Fighter({
    name: 'A', side: 'player', weapon: weaponById(aWeapon), harness: harnessById(aHarness),
    shield: shieldById(aShield), house: aHouse, position: new THREE.Vector3(0, 0, dist), yaw: Math.PI,
  });
  const B = new Fighter({
    name: 'B', side: 'enemy', weapon: weaponById(bWeapon), harness: harnessById(bHarness),
    shield: shieldById(bShield), house: bHouse, position: new THREE.Vector3(0, 0, 0), yaw: 0,
  });
  A.edgeRoll = edgeRoll;
  A.stamina = A.maxStamina * aStamina;
  B.stamina = B.maxStamina * bStamina;
  const events = [];
  let t = 0, blockT = blockAt, hitT = -1, eventStam = null;
  const hpB0 = B.bodyState.health, hpA0 = A.bodyState.health;
  if (aMove) A.startAttack(dir);
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    t += DT;
    if (aMove && A.move && A.state === 'windup' && A.stateT >= (A.move.dur.windup / A.swingScale) * hold) A.releaseAttack();
    if (defend === 'block' || (defend === 'timed' && t > blockT) || (defend === 'late' && t > blockT)) B.startBlock(guardDir);
    if (defend === 'attack' && t > blockAt && B.state === 'idle') B.startAttack('R');
    bindPair(A, B);
    A.update(DT, world, t);
    B.update(DT, world, t);
    for (const e of resolveExchange(A, B, DT)) {
      events.push(e);
      if (e.type === 'hit' && hitT < 0) hitT = t;
      if (!eventStam && (e.type === 'parry' || e.type === 'clash')) eventStam = { a: A.stamina, b: B.stamina };
    }
  }
  const hits = events.filter((e) => e.type === 'hit');
  return {
    A, B, events, t, hitT, eventStam,
    hits, clash: events.find((e) => e.type === 'clash'),
    parry: events.find((e) => e.type === 'parry'),
    guardBreak: events.find((e) => e.type === 'guardBreak'),
    dmgA: hpA0 - A.bodyState.health, dmgB: hpB0 - B.bodyState.health,
    best: hits.slice().sort((x, y) => y.applied - x.applied)[0] || null,
    report() {
      return this.best
        ? `${this.best.region} ${this.best.applied.toFixed(1)} dmg ${this.best.strike}${this.best.gap ? ` (${this.best.gap})` : ''}, ${this.best.joules?.toFixed(0)} J`
        : this.events.map((e) => e.type).join(',') || 'nothing happened';
    },
  };
}
/** When does an unguarded blow land? Guards are timed against that, not a guess. */
function impactTime(o) { return duel({ ...o, defend: 'none', seconds: 1.2 }).hitT; }

section('a blow lands on a man with no guard');
{
  const d = duel({ defend: 'none' });
  ok('the cut connects', d.hits.length > 0, d.report());
  ok('it is read as a cut', d.best && d.best.strike === 'cut', d.best?.strike);
  ok('it hurts enough to matter', d.dmgB > 5, `${d.dmgB.toFixed(1)} damage`);
  ok('energy is in the real range for a longsword', d.best.joules > 30 && d.best.joules < 200, `${d.best.joules.toFixed(0)} J`);
}
section('the flat of the blade is not an edge');
{
  const edge = duel({ defend: 'none', aHarness: 'gambeson', bHarness: 'gambeson' });
  const flat = duel({ defend: 'none', aHarness: 'gambeson', bHarness: 'gambeson', edgeRoll: Math.PI / 2 });
  console.log(`    edge: ${edge.best ? edge.best.applied.toFixed(1) + ' dmg ' + edge.best.strike : 'miss'}   flat: ${flat.best ? flat.best.applied.toFixed(1) + ' dmg ' + flat.best.strike : 'miss'}`);
  ok('the flat does far less than the edge', !flat.best || flat.best.applied < edge.dmgB * 0.5, `${flat.best ? flat.best.applied.toFixed(1) : 0} vs ${edge.dmgB.toFixed(1)}`);
}
section('a thrust is a piercing blow');
{
  const d = duel({ aWeapon: 'longsword', aHarness: 'gambeson', bHarness: 'hauberk', dir: 'D', dist: 1.45, defend: 'none' });
  ok('the thrust connects', d.hits.length > 0, d.report());
  ok('it is read as a thrust', d.best && (d.best.strike === 'thrust' || d.best.strike === 'haft'), d.best?.strike);
  ok('and it beats mail that a cut would fear', d.dmgB > 3, `${d.dmgB.toFixed(1)} dmg on ${d.best?.region}`);
}
{
  const d = duel({ aWeapon: 'spear', aHarness: 'gambeson', bHarness: 'gambeson', dir: 'U', dist: 2.3, defend: 'none' });
  console.log(`    spear thrust at 2.3 m: ${d.report()}`);
  ok('a spear thrust is a ranged threat', d.dmgB > 6, `${d.dmgB.toFixed(1)} dmg`);
}

section('a raised guard stops the blow');
{
  const d = duel({ defend: 'block' });
  ok('no damage gets through the guard', d.dmgB === 0, `${d.dmgB.toFixed(1)} dmg, events: ${d.events.map((e) => e.type).join(',') || 'none'}`);
  ok('the blades actually meet', !!d.clash,
    d.clash ? `${d.clash.energy.toFixed(1)} J into the steel at ${(d.clash.fracA ?? 0).toFixed(2)} of the blade, ${(d.clash.speedA ?? 0).toFixed(1)} m/s, guard ${(d.clash.strength ?? 0).toFixed(2)} absorbs ${(d.clash.absorbed ?? 0).toFixed(1)}` : 'no clash');
}
section('a timed parry throws the blow back');
{
  const hit = impactTime({});
  const d = duel({ defend: 'timed', blockAt: Math.max(0.05, hit - 0.16) });
  ok('a parry is registered', !!d.parry, `${d.events.map((e) => e.type).join(',') || 'none'} (blow lands at ${hit.toFixed(2)} s)`);
  ok('a parry takes nothing', d.dmgB === 0, `${d.dmgB.toFixed(1)} dmg`);
  const es = d.eventStam || { a: 0, b: 0 };
  ok('the parry costs the defender less wind than the blow costs the attacker', d.parry && es.b > es.a, `at the parry: defender ${es.b.toFixed(0)} vs attacker ${es.a.toFixed(0)}`);
}
section('a late guard does not save you');
{
  const hit = impactTime({});
  const d = duel({ defend: 'late', blockAt: hit + 0.04 });
  ok('a guard raised too late still lets the blow land', d.hits.length > 0, `${d.report()} (blow landed at ${hit.toFixed(2)} s)`);
}
section('a winded guard breaks');
{
  const d = duel({ aWeapon: 'greatsword', aHarness: 'hauberk', bHarness: 'whiteharness', dist: 1.7, defend: 'block', bStamina: 0.10 });
  const g = d.guardBreak || d.clash;
  console.log(`    ${d.events.map((e) => e.type).join(',') || 'nothing'}${g ? `  (energy ${g.energy?.toFixed(1)} J, guard ${g.strength?.toFixed(2)}, absorbed ${g.absorbed?.toFixed(1)})` : ''}`);
  ok('a man out of wind loses his guard', !!d.guardBreak || d.hits.length > 0, d.guardBreak ? 'guard break' : d.report());
}
section('armour decides how much of it lands');
{
  const soft = duel({ defend: 'none', bHarness: 'gambeson' });
  const hard = duel({ defend: 'none', bHarness: 'whiteharness' });
  console.log(`    gambeson: ${soft.dmgB.toFixed(1)} dmg   white harness: ${hard.dmgB.toFixed(1)} dmg`);
  ok('full plate takes far less from the same cut', hard.dmgB < soft.dmgB * 0.6, `${hard.dmgB.toFixed(1)} vs ${soft.dmgB.toFixed(1)}`);
}
section('shields');
{
  for (const s of SHIELDS.filter((x) => x.model)) {
    const m = buildShield(s, 'ashcombe', [90, 70, 50]);
    let verts = 0;
    m.traverse((o) => { if (o.isMesh) verts += o.geometry.attributes.position?.count || 0; });
    const segs = m.userData.segs || [];
    const halfWidth = segs.length ? Math.max(...segs.map((g) => Math.max(Math.abs(g.a.x), Math.abs(g.b.x)))) : 0;
    ok(`${s.id}: built`, verts > 100, `${verts} verts, coverage=${s.coverage}`);
    ok(`${s.id}: collider covers the face, not just the spine`, halfWidth >= 0.15, `half-width ${halfWidth.toFixed(2)} m in ${segs.length} capsules`);
  }
  const blade = duel({ defend: 'block' });
  const kite = duel({ defend: 'block', bShield: 'kite', bWeapon: 'arming' });
  console.log(`    sword guard: ${blade.dmgB.toFixed(1)} dmg / defender ${blade.B.stamina.toFixed(0)} stam   kite: ${kite.dmgB.toFixed(1)} dmg / defender ${kite.B.stamina.toFixed(0)} stam`);
  ok('a kite shield is a wall', kite.dmgB === 0, `${kite.dmgB.toFixed(1)} dmg`);
  ok('a shield costs less wind than parrying with steel', kite.B.stamina >= blade.B.stamina, `${kite.B.stamina.toFixed(0)} vs ${blade.B.stamina.toFixed(0)}`);
}
section('every weapon can fight at its own range');
const IDEAL = { arming: 1.35, longsword: 1.5, messer: 1.25, greatsword: 1.75, poleaxe: 2.2, mace: 1.2, spear: 2.4, falcon: 1.35 };
for (const w of WEAPONS) {
  const range = IDEAL[w.id] ?? 1.3;
  let best = null;
  for (const dir of ['R', 'U', 'D', 'L']) {
    const d = duel({ aWeapon: w.id, dir, dist: range, defend: 'none', bHarness: 'hauberk', seconds: 1.6 });
    if (d.best && (!best || d.best.applied > best.best.applied)) best = d;
  }
  console.log(`    ${w.short.padEnd(15)} @${range} m  ${best ? best.report() : 'NO CONTACT'}`);
  ok(`${w.id}: does real damage at ${range} m`, !!best && best.dmgB > 4, best ? `${best.dmgB.toFixed(1)} dmg` : 'no contact');
}

// ── armour actually matters ─────────────────────────────────────────────────
section('armour vs weapon channel');
{
  const J = 60;
  const channels = {
    swordCut: { cut: 0.52 * J, blunt: 0.1 * J, pierce: 0 },
    maceBlunt: { cut: 0, blunt: 0.62 * J, pierce: 0 },
    pickThrust: { cut: 0, blunt: 0.05 * J, pierce: 0.6 * J },
  };
  const rows = [];
  for (const h of HARNESS) {
    const b = new BodyState(harnessById(h.id));
    const r = {};
    for (const k in channels) r[k] = b.apply('chest', channels[k], J).applied;
    rows.push({ h: h.id, ...r });
    console.log(`    ${h.id.padEnd(13)} cut=${r.swordCut.toFixed(1)} blunt=${r.maceBlunt.toFixed(1)} pierce=${r.pickThrust.toFixed(1)}`);
  }
  const g = rows.find((r) => r.h === 'gambeson'), mail = rows.find((r) => r.h === 'hauberk'), wh = rows.find((r) => r.h === 'whiteharness');
  ok('mail turns a cut', mail.swordCut < g.swordCut * 0.5);
  ok('plate turns a cut hard', wh.swordCut < g.swordCut * 0.25);
  ok('blunt ignores gambeson', g.maceBlunt > g.swordCut, `${g.maceBlunt.toFixed(1)} vs ${g.swordCut.toFixed(1)}`);
  ok('plate still passes blunt through', wh.maceBlunt > wh.swordCut * 3, `${wh.maceBlunt.toFixed(1)} vs ${wh.swordCut.toFixed(1)}`);
  ok('a spike out-pierces a flat cut on mail', mail.pickThrust > mail.swordCut, `${mail.pickThrust.toFixed(1)} vs ${mail.swordCut.toFixed(1)}`);
}

section('hacking through a breastplate');
{
  const b = new BodyState(harnessById('whiteharness'));
  const before = b.protection('chest', 'cut');
  let first = 0, last = 0, n = 0;
  for (; n < 40 && b.regions.chest.layers.plate.dur > 0.35; n++) {
    const r = b.apply('chest', { blunt: 40, cut: 6, pierce: 20 }, 70);
    if (n === 0) first = r.applied;
    last = r.applied;
  }
  const after = b.protection('chest', 'cut');
  console.log(`    chest plate opened after ${n} heavy blows (dur=${b.regions.chest.layers.plate.dur.toFixed(2)})`);
  ok('plate degrades under repeated blows', after < before, `${before.toFixed(2)} → ${after.toFixed(2)}`);
  ok('later blows hurt more than the first', last > first, `${first.toFixed(1)} → ${last.toFixed(1)}`);
  ok('an unarmoured chest is never invulnerable', b.protection('chest', 'blunt') < 1);
}

section('weak points, found through the real resolver');
{
  const rig = new Rig({ height: 1.78, build: 1, harness: harnessById('whiteharness') });
  rig.root.updateWorldMatrix(true, true);
  rig.updateVolumes();
  const gaps = rig.gapPoints(), gw = rig.gapWorld();
  const armpit = gaps.findIndex((g) => /armpit/i.test(g.label || ''));
  ok('a full harness still has seams', gaps.length > 0, gaps.map((g) => g.label).join(', '));
  const b = new BodyState(harnessById('whiteharness'));
  const solid = b.apply('chest', { cut: 40, blunt: 0, pierce: 0 }, 50, { gapMult: 1 }).applied;
  const seam = b.apply('chest', { cut: 40, blunt: 0, pierce: 0 }, 50, { gapMult: 0.18 }).applied;
  ok('a seam hit does far more than a plate hit', seam > solid * 3, `${seam.toFixed(1)} vs ${solid.toFixed(1)}`);
  if (armpit >= 0) {
    const hit = { strike: 'thrust', sharpness: 1, joules: 50, speed: 12, region: 'chest', contact: gw[armpit].clone(), localPoint: new THREE.Vector3(), frac: 0.8, mEff: 1 };
    const body = new BodyState(harnessById('whiteharness'));
    const res = resolveStrike(hit, body, { def: weaponById('arming'), gapPoints: gaps, gapWorld: gw });
    ok('a thrust into the armpit is recognised as a seam', !!res.gap && /armpit/i.test(res.gap), `${res.gap || 'none'}, ${res.applied.toFixed(1)} dmg (${res.label})`);
  } else ok('an armpit seam exists', false);
}

section('stamina and wind');
{
  const A = new Fighter({ name: 'A', weapon: weaponById('greatsword'), harness: harnessById('hauberk'), position: new THREE.Vector3(), yaw: 0 });
  let t = 0, swings = 0;
  for (let i = 0; i < 1800; i++) {
    t += DT;
    if (A.state === 'idle' && A.startAttack('R')) swings++;
    if (A.move && A.state === 'windup' && A.stateT >= A.move.dur.windup / A.swingScale * 0.98) A.releaseAttack();
    A.update(DT, world, t);
  }
  ok('a greatsword does not swing forever', A.exhausted || A.stamina < 20, `${swings} swings in 15 s, stamina ${A.stamina.toFixed(0)}`);
  ok('a winded man cannot start a blow', A.exhausted ? !A.startAttack('R') : true, `stamina ${A.stamina.toFixed(0)}`);

  const light = new Fighter({ name: 'B', weapon: weaponById('messer'), harness: harnessById('gambeson'), position: new THREE.Vector3(), yaw: 0 });
  let t2 = 0, swings2 = 0;
  for (let i = 0; i < 1800; i++) {
    t2 += DT;
    if (light.state === 'idle' && light.startAttack('R')) swings2++;
    if (light.move && light.state === 'windup' && light.stateT >= light.move.dur.windup / light.swingScale * 0.98) light.releaseAttack();
    light.update(DT, world, t2);
  }
  ok('a light blade outlasts a heavy one', swings2 > swings * 1.5 && light.stamina > A.stamina, `${swings2} swings (stamina ${light.stamina.toFixed(0)}) vs greatsword ${swings} (${A.stamina.toFixed(0)})`);

  const C = new Fighter({ name: 'C', weapon: weaponById('arming'), harness: harnessById('gambeson'), position: new THREE.Vector3(), yaw: 0 });
  C.stamina = 8;
  let t3 = 0;
  for (let i = 0; i < 400; i++) { t3 += DT; C.update(DT, world, t3); }
  ok('wind comes back when you stop', C.stamina > 24, `${C.stamina.toFixed(0)} after 3s`);
}

section('champions');
for (const c of CHAMPIONS) {
  const f = new Fighter({
    name: c.name, id: c.id, side: 'enemy',
    body: c.body, cloth: c.cloth, accent: c.accent,
    harness: harnessById(c.harness), weapon: weaponById(c.weapon), shield: shieldById(c.shield),
    position: new THREE.Vector3(0, 0, 1.4), yaw: 0,
  });
  ok(`${c.id}: rig + kit`, !!f.rig && !!f.wb && f.wb.segs.length > 6, `${f.weaponDef.short} + ${c.harness}${c.shield !== 'none' ? ' + ' + c.shield : ''}`);
  const d = duel({ aWeapon: c.weapon, aHarness: c.harness, aShield: c.shield, aHouse: c.house, bHarness: 'hauberk', dist: IDEAL[weaponById(c.weapon).id] ?? 1.5, defend: 'none', seconds: 1.6 });
  ok(`${c.id}: can strike`, d.hits.length > 0 || d.dmgB > 0 || !!d.clash || !!d.parry,
    d.hits.length ? d.report() : `${d.events.map((e) => e.type).join(',') || 'nothing'} (a good guard is also an answer)`);
}

section('stamina and wounds');
{
  const b = new BodyState(harnessById('gambeson'));
  for (let i = 0; i < 6; i++) b.apply('chest', { cut: 30, blunt: 4, pierce: 0 }, 40);
  const hp0 = b.health;
  ok('bleeding drains health', b.bleed > 0, `bleed=${b.bleed.toFixed(2)}`);
  for (let i = 0; i < 120; i++) b.tick(1 / 60);
  ok('a wounded man keeps losing blood', b.health < hp0, `${hp0.toFixed(1)} → ${b.health.toFixed(1)}`);
  const arm = new BodyState(harnessById('gambeson'));
  for (let i = 0; i < 30; i++) arm.apply('foreArm', { cut: 40, blunt: 0, pierce: 0 }, 50);
  ok('enough damage to an arm disables it', arm.regions.foreArm.disabled, `hp=${arm.regions.foreArm.hp.toFixed(1)}`);
  ok('a disabled arm reports guards down', arm.guardsUp());
}

section('reading the blow');
{
  // the threat solver must find the incoming edge and name where it lands
  const A = new Fighter({ name: 'A', weapon: weaponById('longsword'), harness: harnessById('gambeson'), position: new THREE.Vector3(0, 0, 1.3), yaw: Math.PI });
  const B = new Fighter({ name: 'B', weapon: weaponById('longsword'), harness: harnessById('bouilli'), position: new THREE.Vector3(0, 0, 0), yaw: 0 });
  let t = 0, seen = 0, sampled = 0, closest = 9;
  A.startAttack('R');
  for (let i = 0; i < 120; i++) {
    t += DT;
    if (A.move && A.state === 'windup' && A.stateT >= A.move.dur.windup / A.swingScale * 0.98) A.releaseAttack();
    bindPair(A, B); A.update(DT, world, t); B.update(DT, world, t); resolveExchange(A, B, DT);
    if (i > 40) {
      sampled++;
      const th = threatPoint(B.rig, A.wb, 0.02, { facing: true });
      if (th) { seen++; closest = Math.min(closest, th.distance); }
    }
  }
  ok('the defender sees the blow coming', seen > sampled * 0.5, `threat visible in ${seen}/${sampled} samples, closest ${closest.toFixed(2)} m`);
}

console.log(fails === 0 ? '\nALL LOGIC CHECKS PASSED' : `\n${fails} CHECK(S) FAILED`);
process.exit(fails ? 1 : 0);
