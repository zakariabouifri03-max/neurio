// ── headless test for the BOOYAH FIRE simulation ────────────────────────────
// Runs whole matches in Node with a scripted "player" (no browser needed) and
// checks: no exceptions, no NaN, matches always finish, sane pacing/balance.
//
//   node tools/test-sim.mjs            # quick pass
//   node tools/test-sim.mjs --verbose  # per-match detail

import { Battle, makeIsland } from '../src/sim.js';
import { WEAPONS, BAG } from '../src/data.js';

const verbose = process.argv.includes('--verbose');
const sim = { fails: 0 };
const fail = (m) => { sim.fails++; console.log('  ✗ ' + m); };
const ok = (m) => { if (verbose) console.log('  ✓ ' + m); };

// ── a scripted player: loot, rotate, shoot back ─────────────────────────────
function scriptedInput(b, seq) {
  const p = b.player;
  const st = {
    yaw: p.yaw, pitch: p.pitch, moveX: 0, moveZ: 0, sprint: false, crouch: false,
    ads: false, fire: false, reload: false, switchSlot: null, useMed: false, useFA: false,
    throwGloo: false, throwNade: null, interact: false, punch: false,
  };
  if (p.parachuting) {
    const z = b.zone;
    const dx = z.tx - p.x, dz = z.tz - p.z;
    const d = Math.hypot(dx, dz) || 1;
    st.moveX = dx / d; st.moveZ = dz / d;
    st.pitch = -0.4;
    return st;
  }
  // heal when hurt
  if (p.hp < p.maxHp * 0.5 && (p.items.medkit > 0 || p.items.firstaid > 0) && b.time - p.lastDamageTime > 4) {
    if (p.items.medkit > 0 && p.hp < p.maxHp * 0.35) st.useMed = true;
    else if (p.items.firstaid > 0) st.useFA = true;
    return st;
  }
  const w = b._curWeapon(p);
  const enemy = b._findVisibleEnemy(p, 90);
  if (enemy) {
    // aim with a little lead + wobble
    const dx = enemy.x - p.x, dz = enemy.z - p.z;
    const d = Math.hypot(dx, dz) || 1;
    const wantYaw = Math.atan2(dx, dz);
    const wantPitch = Math.atan2((enemy.y + 1.1) - (p.y + 1.62), d);
    let dy = ((wantYaw - st.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    st.yaw = st.yaw + Math.max(-0.25, Math.min(0.25, dy));
    let dp = wantPitch - st.pitch;
    st.pitch = st.pitch + Math.max(-0.2, Math.min(0.2, dp));
    st.ads = d > 25;
    st.fire = Math.abs(dy) < 0.09;
    if (w && w.ammo <= 0) st.reload = true;
    if (d < 22) { st.moveX = -dx / d; st.moveZ = -dz / d; }              // back off
    else if (d > 45) { st.moveX = dx / d; st.moveZ = dz / d; st.sprint = true; }
    else { st.moveX = -dz / d * 0.8; st.moveZ = dx / d * 0.8; }
    return st;
  }
  // loot & rotate
  const drop = b._nearestDrop(p, 30);
  const z = b.zone;
  let tx = z.tx, tz = z.tz;
  if (drop && b.time < 300) { tx = drop.x; tz = drop.z; }
  const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz) || 1;
  st.moveX = dx / d; st.moveZ = dz / d;
  st.sprint = d > 25;
  st.yaw = Math.atan2(dx, dz);
  st.pitch = 0;
  const nearDrop = b._nearestDrop(p, 2.2);
  if (nearDrop) st.interact = true;
  if (w && w.ammo < WEAPONS[w.id].mag * 0.4) st.reload = true;
  if (p.weapons.length > 1 && !b._curWeapon(p)) st.switchSlot = 0;
  if (p.items.grenade > 0 && seq % 900 === 0) st.throwNade = 'grenade';
  if (p.items.gloo > 0 && p.hp < 60 && seq % 600 === 0) st.throwGloo = true;
  return st;
}

function checkFinite(b, tag) {
  for (const e of b.entities) {
    for (const k of ['x', 'y', 'z', 'hp', 'velX', 'velZ', 'yaw', 'pitch']) {
      if (!Number.isFinite(e[k])) return fail(`${tag}: entity ${e.name}.${k} = ${e[k]}`);
    }
    if (e.y < -12) fail(`${tag}: ${e.name} fell through the world (y=${e.y.toFixed(1)})`);
    if (e.hp > e.maxHp + 0.01) fail(`${tag}: ${e.name} overhealed (${e.hp.toFixed(1)} > ${e.maxHp})`);
  }
}

function runMatch({ seed, mode, themeId, maxSeconds = 900, dt = 1 / 30 }) {
  const t0 = Date.now();
  const b = new Battle({ seed, mode, themeId, playerName: 'TESTER', playerChar: 'kelly', playerPet: 'cat', difficulty: 0.55 });
  const islandMs = Date.now() - t0;
  let steps = 0, simMs = 0, knocks = 0, revives = 0, nades = 0, gloos = 0, drops = 0, shots = 0;
  const errs = [];
  try {
    while (!b.over && b.time < maxSeconds) {
      const t1 = Date.now();
      const evs = b.update(dt, scriptedInput(b, steps));
      simMs += Date.now() - t1;
      for (const ev of evs) {
        if (ev.type === 'knock') knocks++;
        if (ev.type === 'revive') revives++;
        if (ev.type === 'explode' && ev.kind === 'grenade') nades++;
        if (ev.type === 'gloo') gloos++;
        if (ev.type === 'shoot') shots++;
        if (ev.type === 'pickup') drops++;
      }
      steps++;
      if (steps % 600 === 0) checkFinite(b, `seed ${seed} t=${b.time.toFixed(0)}s`);
      // keep the scripted player's inventory from breaking (slots)
      if (b.player.weapons.length > 2) errs.push('more than 2 weapon slots');
      if (b.player.cur >= b.player.weapons.length) errs.push('cur slot out of range');
    }
  } catch (err) {
    errs.push('threw: ' + (err && err.stack ? err.stack.split('\n').slice(0, 3).join(' | ') : err));
  }
  const r = b.result;
  const line = `${mode.padEnd(5)} seed ${String(seed).padEnd(10)} ${b.over ? '' : 'DID NOT FINISH'} ${String(r ? r.place : '-').padStart(3)} place · ${String(r ? r.kills : 0).padStart(2)} kills · ${String(r ? r.damage : 0).padStart(5)} dmg · ${b.time.toFixed(0)}s · alive ${b.alive}/${b.totalPlayers} · bots ${b.entities.length - 1} · island ${islandMs}ms · sim ${(simMs / Math.max(1, steps)).toFixed(2)}ms/frame`;
  console.log(line);
  if (verbose) console.log(`      kills=${knocks} knocks · ${revives} revives · ${nades} nades · ${gloos} gloos · ${shots} shots · ${drops} pickups · theme ${b.theme.name} · drops left ${b.drops.filter((d) => !d.taken).length}/${b.drops.length}`);
  if (!b.over) fail(`seed ${seed}: match never finished (time ${b.time.toFixed(0)}s, ${b.alive} alive)`);
  if (r) {
    if (r.place < 1 || r.place > b.totalPlayers) fail(`seed ${seed}: place out of range (${r.place})`);
    if (r.damage < 0 || r.kills < 0) fail(`seed ${seed}: negative stats`);
    if (r.shots > 0 && r.hits > r.shots) fail(`seed ${seed}: hits > shots`);
  }
  // a BR match ends when YOUR squad is wiped or you win — either is fine.
  if (r && r.place === 1 && b.alive > 1) fail(`seed ${seed}: claimed BOOYAH with ${b.alive} alive`);
  if (r && r.place > b.totalPlayers) fail(`seed ${seed}: place beyond player count`);
  errs.forEach((e) => fail(`seed ${seed}: ${e}`));
  checkFinite(b, `seed ${seed} final`);
  return { b, r, steps, simMs, islandMs };
}

// ═══════════════════════════ island generation checks ══════════════════════
console.log('\n── island generation ──');
for (const themeId of ['bermuda', 'stardust', 'jungle', 'kalahari']) {
  const t0 = Date.now();
  const isl = makeIsland(1234 + themeId.length, themeId);
  const ms = Date.now() - t0;
  let min = Infinity, max = -Infinity, land = 0;
  for (let i = 0; i < isl.hmap.length; i++) {
    const h = isl.hmap[i];
    min = Math.min(min, h); max = Math.max(max, h);
    if (h > 1) land++;
  }
  const pct = ((land / isl.hmap.length) * 100).toFixed(1);
  console.log(`  ${themeId.padEnd(9)} ${ms}ms · props ${String(isl.props.length).padStart(4)} · sites ${String(isl.sites.length).padStart(3)} · towns ${isl.towns.length} · land ${pct}% · h ${min.toFixed(1)}..${max.toFixed(1)}`);
  if (isl.props.length < 150) fail(`${themeId}: too few props`);
  if (land / isl.hmap.length < 0.25) fail(`${themeId}: island too small (${pct}% land)`);
  if (!Number.isFinite(max) || max < 12) fail(`${themeId}: no hills (max ${max})`);
  // spawn points must be above water or shallow
  if (isl.height(0, 0) < 0) fail(`${themeId}: centre is ocean`);
}

// ═══════════════════════════ match runs ════════════════════════════════════
console.log('\n── full matches ──');
const seeds = [1, 7, 42, 1234, 99999];
let total = { steps: 0, simMs: 0 };
for (const s of seeds) {
  const res = runMatch({ seed: s, mode: 'solo' });
  total.steps += res.steps; total.simMs += res.simMs;
}
for (const m of ['duo', 'squad']) {
  const res = runMatch({ seed: 2024 + m.length, mode: m });
  total.steps += res.steps; total.simMs += res.simMs;
}

// ═══════════════════════════ vehicles & backpacks ═══════════════════════════
console.log('\n── vehicles & backpacks ──');
{
  let leastVehicles = 99, land = 0, boats = 0, seedsWithBoat = 0;
  for (let seed = 1; seed <= 25; seed++) {
    const b = new Battle({ seed, mode: 'solo' });
    const l = b.vehicles.filter((v) => !v.water).length;
    const w = b.vehicles.filter((v) => v.water).length;
    land += l; boats += w;
    if (w) seedsWithBoat++;
    leastVehicles = Math.min(leastVehicles, l + w);
  }
  if (leastVehicles < 3) fail(`only ${leastVehicles} vehicles on some islands`);
  else ok(`vehicles: avg ${(land / 25).toFixed(1)} land + ${(boats / 25).toFixed(1)} boats · boats present on ${seedsWithBoat}/25 islands`);

  // drive every land vehicle from its spawn: each one must reach a real speed.
  // A fresh battle per vehicle keeps the player alive and the island identical
  // (terrain is a pure function of the seed), and driving into a trunk or a crate
  // must not leave the car grinding away at walking pace
  let driven = 0, worst = 99, stuck = 0;
  const swept = 12;
  for (let seed = 1; seed <= swept; seed++) {
    const landCount = new Battle({ seed, mode: 'solo' }).vehicles.filter((v) => !v.water).length;
    for (let k = 0; k < landCount; k++) {
      const b = new Battle({ seed, mode: 'solo' });
      const p = b.player;
      const car = b.vehicles.filter((v) => !v.water)[k];
      if (!car) continue;
      p.parachuting = false; p.knocked = false; p.vehicle = null; p.interactHeld = false;
      p.x = car.x + 1.5; p.z = car.z; p.y = Math.max(b.island.height(p.x, p.z), 0.05);
      b.update(1 / 60, { interact: true, yaw: car.yaw });
      if (p.vehicle !== car) { fail(`could not enter a ${car.kind} (seed ${seed})`); continue; }
      let peak = 0;
      for (let i = 0; i < 150; i++) {
        b.update(1 / 60, { yaw: car.yaw, pitch: 0, fwd: 1 });
        peak = Math.max(peak, car.speed);
      }
      driven++;
      worst = Math.min(worst, peak);
      if (peak < 5) { stuck++; fail(`${car.kind} (seed ${seed}) never got going (peak ${peak.toFixed(1)} m/s)`); }
      b.update(1 / 60, { interact: true });
      if (p.vehicle) fail(`${car.kind}: could not exit`);
    }
  }
  ok(`drove ${driven} vehicles over ${swept} islands · slowest run still hit ${worst.toFixed(1)} m/s · stuck: ${stuck}`);

  // a wreck ejects and hurts its driver; the sim keeps ticking afterwards
  const b = new Battle({ seed: 11, mode: 'solo' });
  const victim = b.entities.find((e) => !e.isPlayer);
  victim.parachuting = false; victim.y = Math.max(b.island.height(victim.x, victim.z), 0.05);
  const car = b.vehicles.find((v) => !v.water);
  car.x = victim.x + 1; car.z = victim.z;
  car.y = Math.max(b.island.height(car.x, car.z), 0.05);
  b.enterVehicle(victim, car);
  const hpBefore = victim.hp;
  b._hurtVehicle(car, 1e6, null);
  for (let i = 0; i < 60; i++) b.update(1 / 60, {});
  if (victim.vehicle) fail('destroying a vehicle left its driver inside');
  else if (victim.hp >= hpBefore) fail('the explosion did not hurt the driver');
  else if (!Number.isFinite(victim.x) || !Number.isFinite(b.time)) fail('vehicle explosion produced non-finite state');
  else ok(`wreck ejected its driver and dealt ${(hpBefore - victim.hp).toFixed(0)} damage · sim still finite`);

  // bullets: the car eats most of the damage, and it can be destroyed
  const b2 = new Battle({ seed: 12, mode: 'solo' });
  const d = b2.entities.find((e) => !e.isPlayer);
  const car2 = b2.vehicles.find((v) => !v.water);
  car2.x = d.x + 1; car2.z = d.z;
  car2.y = Math.max(b2.island.height(car2.x, car2.z), 0.05);
  b2.enterVehicle(d, car2);
  const before = { hp: d.hp, vhp: car2.hp };
  for (let i = 0; i < 10; i++) b2._damage(d, 20, b2.player, 'body', 'gun');
  const occupantDamage = before.hp - d.hp, vehicleDamage = before.vhp - car2.hp;
  if (vehicleDamage <= 0) fail('bullets did not damage the vehicle');
  else if (occupantDamage >= 10 * 20) fail('the vehicle soaked no damage for its occupant');
  else ok(`armour: 200 raw damage → ${occupantDamage.toFixed(0)} to the occupant, ${vehicleDamage.toFixed(0)} to the car`);

  // backpacks raise carrying capacity
  const b3 = new Battle({ seed: 13, mode: 'solo' });
  const p3 = b3.player;
  const mag = WEAPONS[p3.weapons[0].id].mag;
  const capFor = (bag) => Math.round(mag * BAG[bag].reserve);
  if (!(capFor(3) > capFor(0))) fail('backpack tiers do not increase ammo capacity');
  else ok(`backpack capacity lv0→lv3: ${capFor(0)} → ${capFor(3)} reserve rounds`);
  const bagDrop = { uid: 999, kind: 'bag', level: 3, x: p3.x, z: p3.z, y: p3.y, taken: false, t: 0, tier: 2 };
  b3.drops.push(bagDrop);
  const got = b3.pickupDrop(p3, bagDrop);
  if (p3.bag !== 3) fail('could not pick up a level-3 backpack');
  else if (b3.pickupDrop(p3, { uid: 1000, kind: 'bag', level: 1, x: p3.x, z: p3.z, y: p3.y, taken: false, t: 0, tier: 1 })) fail('a worse backpack replaced the better one');
  else ok(`equipped ${got} (bag level ${p3.bag}) and refused to downgrade`);
}

// ═══════════════════════════ combat sanity (TTK) ════════════════════════════
console.log('\n── weapon TTK (shots to kill 100 HP + lvl2 vest, body shots) ──');
console.log('  ' + Object.entries(WEAPONS).map(([id, w]) => {
  const dmg = w.dmg * (w.pellets ? w.pellets * 0.55 : 1) * 0.65; // lvl2 vest
  const shots = Math.ceil(100 / dmg);
  const ttk = ((shots - 1) * 60 / w.rpm).toFixed(2);
  return `${w.name}:${shots}sh/${ttk}s`;
}).join('  '));
console.log(`\nframes simulated: ${total.steps} · avg ${(total.simMs / Math.max(1, total.steps)).toFixed(2)}ms per frame (30fps budget = 33ms)`);

if (sim.fails) {
  console.log(`\n❌ ${sim.fails} check(s) failed\n`);
  process.exit(1);
}
console.log('\n✅ all simulation checks passed\n');
