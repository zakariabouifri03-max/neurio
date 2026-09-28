// ── headless test for the 3D view layer ─────────────────────────────────────
// three.js runs fine in Node for everything except GPU draw calls, so this
// builds the whole world + all avatars + effects and steps them, catching API
// misuse, NaNs and crashes without a browser.
import { Battle } from '../src/sim.js';
import { MatchView } from '../src/view.js';

let fails = 0;
const fail = (m) => { fails++; console.log('  ✗ ' + m); };

const modes = ['solo', 'squad'];
for (const mode of modes) {
  const b = new Battle({ seed: 777 + mode.length, mode, difficulty: 0.55 });
  let view;
  try {
    view = new MatchView(b, { lowQ: false, skinIndex: 2, gunSkin: 1, chuteSkin: 2 });
  } catch (e) { fail(`${mode}: MatchView construction threw: ${e.message}\n${e.stack.split('\n')[1]}`); continue; }
  let tris = 0, meshes = 0, sprites = 0, instanced = 0;
  view.scene.traverse((o) => {
    if (o.isMesh) { meshes++; const g = o.geometry; if (g && g.index) tris += g.index.count / 3; else if (g && g.attributes.position) tris += g.attributes.position.count / 3; }
    if (o.isInstancedMesh) instanced++;
    if (o.isSprite) sprites++;
  });
  const input = { yaw: b.player.yaw, pitch: 0, moveX: 0.3, moveZ: 0.9, sprint: true, crouch: false, ads: false, fire: true, reload: false, switchSlot: null, useMed: false, useFA: false, throwGloo: false, throwNade: null, interact: false, punch: false };
  let frames = 0, err = null;
  try {
    while (!b.over && b.time < 500 && frames < 15000) {
      input.yaw = b.player.yaw + 0.02;
      const evs = b.update(1 / 30, input);
      view.update(1 / 30, evs, input);
      if (frames % 900 === 0) {
        // sanity: every avatar tracks its entity, no NaN anywhere
        for (const e of b.entities) {
          const av = view.avatars.get(e.id);
          if (!av) { fail(`${mode}: missing avatar for ${e.name}`); continue; }
          if (!Number.isFinite(av.group.position.x) || !Number.isFinite(av.group.position.y)) fail(`${mode}: avatar ${e.name} NaN position`);
        }
        if (!Number.isFinite(view.camera.position.x) || !Number.isFinite(view.camera.position.y)) fail(`${mode}: camera NaN`);
      }
      frames++;
    }
  } catch (e) { err = e; }
  if (err) fail(`${mode}: view update threw at frame ${frames}: ${err.message}\n     ${(err.stack || '').split('\n')[1]}`);
  console.log(`  ${mode.padEnd(5)} ${frames} frames · meshes ${meshes} · tris ${(tris / 1000).toFixed(0)}k · sprites ${sprites} · instanced ${instanced} · loot ${b.drops.filter(d => !d.taken).length} · gloo meshes ${view.glooMeshes.size} · tracers ${view.tracers.length} · time ${b.time.toFixed(0)}s`);
  const camY = view.camera.position.y;
  const terrain = b.island.height(view.camera.position.x, view.camera.position.z);
  if (camY < terrain - 0.6) fail(`${mode}: camera ${camY.toFixed(1)} is under the terrain (${terrain.toFixed(1)})`);
  view.dispose();
}

// ADS / crouch / knocked paths
const b2 = new Battle({ seed: 31, mode: 'squad', difficulty: 0.5 });
const v2 = new MatchView(b2, { lowQ: true });
for (const flags of [{ ads: true }, { crouch: true }, { punch: true }, { ads: true, crouch: true }]) {
  for (let i = 0; i < 200; i++) {
    const inp = { yaw: 1, pitch: 0.2, moveX: 1, moveZ: 0, fire: true, ...flags };
    v2.update(1 / 30, b2.update(1 / 30, inp), inp);
  }
}
// knocked pose
b2.player.knocked = true;
for (let i = 0; i < 60; i++) { const inp = { yaw: 0, pitch: 0 }; v2.update(1 / 30, b2.update(1 / 30, inp), inp); }
// dead pose
b2.player.alive = false;
for (let i = 0; i < 60; i++) { const inp = { yaw: 0, pitch: 0 }; v2.update(1 / 30, b2.update(1 / 30, inp), inp); }
console.log('  pose paths (ads/crouch/punch/knocked/dead) ok');
v2.dispose();

// ── vehicles: mesh per vehicle, wheels, cabin camera, destruction ───────────
{
  const b3 = new Battle({ seed: 88, mode: 'solo' });
  const v3 = new MatchView(b3, { lowQ: true });
  if (b3.vehicles.length < 6) fail(`only ${b3.vehicles.length} vehicles spawned`);
  const p3 = b3.player;
  // pick the land vehicle with the clearest run-up so the test measures the car, not a crate
  const clearance = (v) => {
    let n = 0;
    for (const idx of b3.island.propsNear(v.x, v.z)) {
      const pr = b3.island.props[idx];
      if (pr.type === 'tree' || pr.type === 'rock') continue;
      if (Math.hypot(pr.x - v.x, pr.z - v.z) < 12) n++;
    }
    return n;
  };
  const car = b3.vehicles.filter((x) => !x.water).sort((a, c) => clearance(a) - clearance(c))[0];
  p3.parachuting = false;
  p3.x = car.x + 1.6; p3.z = car.z; p3.y = Math.max(b3.island.height(p3.x, p3.z), 0.05);
  let inp = { yaw: car.yaw, pitch: 0, moveX: 0, moveZ: 0, interact: true };
  v3.update(1 / 60, b3.update(1 / 60, inp), inp);
  if (!p3.vehicle) fail('could not enter a vehicle');
  const wheels = (v3.vehicleMeshes.get(car) || { userData: {} }).userData.wheels || [];
  const camBefore = v3.camera.position.clone();
  let maxSpeed = 0, travelled = 0, prev = { x: car.x, z: car.z };
  for (let i = 0; i < 120; i++) {
    inp = { yaw: car.yaw, pitch: 0, moveX: 0, moveZ: 0, fwd: 1 };   // raw stick: full throttle
    v3.update(1 / 60, b3.update(1 / 60, inp), inp);
    maxSpeed = Math.max(maxSpeed, Math.abs(car.speed));
    travelled += Math.hypot(car.x - prev.x, car.z - prev.z);
    prev = { x: car.x, z: car.z };
  }
  const drove = maxSpeed > 8 && travelled > 8;              // it accelerates and covers ground
  const camMoved = v3.camera.position.distanceTo(camBefore) > 3;
  const camBack = v3.camera.position.distanceTo(new (v3.camera.position.constructor)(car.x, car.y, car.z)) < 16;
  if (!drove) fail(`vehicle did not drive (peak ${maxSpeed.toFixed(1)} m/s, ${travelled.toFixed(1)} m)`);
  if (!camMoved || !camBack) fail('camera did not follow the vehicle');
  console.log(`  ✓ drove a ${car.kind} · peak ${maxSpeed.toFixed(1)} m/s · ${travelled.toFixed(1)}m covered · ${wheels.length} wheels · vehicle meshes ${v3.vehicleMeshes.size} · camera follows from ${v3.camera.position.distanceTo(new (v3.camera.position.constructor)(car.x, car.y, car.z)).toFixed(1)}m`);
  // blow it up
  b3._hurtVehicle(car, 9999, null);
  for (let i = 0; i < 200; i++) { inp = { yaw: 0, pitch: 0 }; v3.update(1 / 60, b3.update(1 / 60, inp), inp); }
  let vehTris = 0, vehMeshes = 0;
  for (const g of v3.vehicleMeshes.values()) g.traverse((o) => { if (o.isMesh) { vehMeshes++; const g2 = o.geometry; vehTris += (g2.index ? g2.index.count : g2.attributes.position.count) / 3; } });
  console.log(`  ✓ vehicle destroyed · driver ejected (${!p3.vehicle}) · wreck cleaned up (${b3.vehicles.filter((x) => x.dead).length} wreck(s) in world, ${vehMeshes} vehicle meshes / ${vehTris | 0} tris)`);
  v3.dispose();
}

if (fails) { console.log(`\n❌ ${fails} view check(s) failed\n`); process.exit(1); }
console.log('\n✅ view layer checks passed\n');
