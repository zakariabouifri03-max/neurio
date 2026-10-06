/* ============================================================
   tools/render-test.mjs
   Drives the Three.js layer in Node (no WebGL context needed —
   geometry, materials and transforms are pure JS). Runs real match
   frames through syncPlayer / syncBall / updateCamera and checks
   the scene graph is built and stays finite.
   ============================================================ */

/* ---- the browser globals Three.js and tex.js touch ---- */
const CTX = () => new Proxy({}, {
  get: (t, k) => (k === 'createRadialGradient' || k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {}),
  set: () => true,
});
globalThis.window = { devicePixelRatio: 1, innerWidth: 1280, innerHeight: 720, addEventListener() {} };
globalThis.self = globalThis.window;
globalThis.document = {
  createElement: (t) => (t === 'canvas'
    ? { width: 0, height: 0, getContext: CTX }
    : { style: {} }),
};

let fails = 0, checks = 0;
const test = (c, m, x = '') => { checks++; console.log(`  ${c ? '✅' : '❌'} ${m}${x ? ' — ' + x : ''}`); if (!c) fails++; };

const THREE = await import('../vendor/three.module.js');
const R = await import('../src/render.js');
const { CLUBS, makeSquad } = await import('../src/data.js');
const { createMatch, stepMatch } = await import('../src/engine.js');

console.log(`\n\x1b[1mrender.js + three.js r${THREE.REVISION}\x1b[0m`);

const scene = R.createScene();
const stadium = R.buildStadium(scene);
let stadiumMeshes = 0, stadiumGeos = new Set();
stadium.traverse((o) => { if (o.isMesh) { stadiumMeshes++; stadiumGeos.add(o.geometry.uuid); } });
test(stadiumMeshes > 30, 'stadium built', `${stadiumMeshes} meshes, ${stadiumGeos.size} shared geometries`);
test(scene.children.some((c) => c.isLight), 'lights present');
test(!!scene.fog, 'fog set');

const mats = R.createTeamMaterials(CLUBS[0]);
const rig = R.createPlayerMesh(mats, { skin: 0x8d5524, hair: 0x16110d, role: 'ST' }, null);
let rigMeshes = 0;
rig.grp.traverse((o) => { if (o.isMesh) rigMeshes++; });
test(rigMeshes === 10, 'player rig has every part', `${rigMeshes} meshes (torso, shorts, head, hair, 2 arms, 2 legs, shadow, ring)`);
test(!!rig.ring && rig.ring.visible === false, 'the control ring starts hidden');

const ball = R.createBallMesh();
test(ball.mesh.geometry.parameters.radius > 0.1, 'ball geometry sized', String(ball.mesh.geometry.parameters.radius));

const m = createMatch({
  home: CLUBS[0], away: CLUBS[2],
  squads: [makeSquad(1, 78), makeSquad(2, 84)],
  seed: 5, halfSeconds: 60, human: 0, aiLevel: 1,
});
const rigs = m.players.map((pl) => R.createPlayerMesh(mats, pl.data, null));
const cam = R.createCamera();

let frames = 0;
for (let i = 0; i < 1800 && !m.over; i++) {
  stepMatch(m, 1 / 60, {
    mx: Math.sin(i / 23), mz: Math.cos(i / 17), sprint: i % 3 === 0,
    pass: i % 89 === 0, shootHeld: i % 140 < 18, tackle: i % 57 === 0, switch: i % 199 === 0,
  });
  m.players.forEach((pl) => R.syncPlayer(rigs[pl.i], pl, pl.i === m.active, 1 / 60));
  R.syncBall(ball, m.ball);
  R.updateCamera(cam, m, 1 / 60, 1280, 720);
  frames++;
}
test(frames > 100, 'render-sync ran real match frames', `${frames} frames → ${m.minute.toFixed(0)}'`);

const badPos = m.players.filter((p) => !Number.isFinite(p.p.x) || !Number.isFinite(p.p.z)).length;
test(badPos === 0, 'no player position went non-finite');
test(Number.isFinite(cam.position.x) && Number.isFinite(cam.position.y) && Number.isFinite(cam.position.z),
  'camera position finite', cam.position.toArray().map((v) => v.toFixed(1)).join(', '));
test(Math.hypot(cam.position.x - m.ball.p.x, cam.position.z - m.ball.p.z) > 12,
  'camera stays behind the play', `${Math.hypot(cam.position.x - m.ball.p.x, cam.position.z - m.ball.p.z).toFixed(1)} m from the ball`);

/* limb animation actually moves */
const legX = rigs[9].legL.rotation.x;
R.syncPlayer(rigs[9], { ...m.players[9], anim: m.players[9].anim + 1.2, state: 'run', v: { x: 6, z: 0 }, p: m.players[9].p, diveT: 0, celebT: 0, kickT: 0 }, false, 1 / 60);
test(rigs[9].legL.rotation.x !== legX, 'running animation drives the limbs');

/* the active-player ring toggles */
R.syncPlayer(rigs[m.active], m.players[m.active], true, 1 / 60);
test(rigs[m.active].ring.visible === true, 'the ring shows on the controlled player');

/* screen-space joystick mapping flips with the attacking direction */
const a = R.joystickToWorld(0, 1, 1);
const b = R.joystickToWorld(0, 1, -1);
test(a.x > 0.99 && b.x < -0.99, 'joystick "up" follows the attacking direction',
  `dir+1 → x=${a.x.toFixed(2)}, dir-1 → x=${b.x.toFixed(2)}`);
const rt = R.joystickToWorld(1, 0, 1);
test(Math.abs(rt.z - 1) < 0.01, 'joystick "right" maps to +Z when attacking +X', `z=${rt.z.toFixed(2)}`);

console.log(fails === 0
  ? `\n✅ ${checks} CHECKS PASSED — the 3D layer runs`
  : `\n❌ ${fails}/${checks} CHECKS FAILED`);
process.exit(fails ? 1 : 0);
