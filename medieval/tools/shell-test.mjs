// ── shell harness: the game around the fight ─────────────────────────────────
// logic-test.mjs proves the duel. This proves the thing you actually launch:
// the HUD, the boards, the armoury, the input layer, the head, the particles,
// the synthesised sound, and a whole bout played out through main.js with two
// brains in it — all under a stand-in DOM. Run: node tools/shell-test.mjs
import '../node_modules/three/three.module.js';
import { registry } from './domstub.mjs';

const THREE = await import('three');
const { Fighter } = await import('../src/fighter.js');
const { Brain } = await import('../src/ai.js');
const { bindPair, resolveExchange } = await import('../src/exchange.js');
const { threatPoint, incomingSide } = await import('../src/defense.js');
const { Hud } = await import('../src/hud.js');
const { Menu } = await import('../src/menu.js');
const { Input } = await import('../src/input.js');
const { View } = await import('../src/view.js');
const { Vfx } = await import('../src/vfx.js');
const { Audio } = await import('../src/audio.js');
const { Save, Bout, brainFor } = await import('../src/state.js');
const { weaponById, harnessById, shieldById, champById, CHAMPIONS, DRILLS } = await import('../src/data.js');
const { srand } = await import('../src/mathx.js');

let fails = 0, checks = 0;
const ok = (name, cond, extra = '') => {
  checks++;
  if (!cond) { fails++; console.log(`  ✗ ${name} ${extra}`); } else console.log(`  ✓ ${name} ${extra}`);
};
const section = (s) => console.log(`\n── ${s} ──`);
const finite = (v) => Number.isFinite(v);

srand(7);

// ════════════════════════════════════════════════════════════════════════════
section('the screen: HUD');
const hudRoot = document.getElementById('hud');
const player = new Fighter({
  name: 'You', side: 'player', weapon: weaponById('longsword'), harness: harnessById('bouilli'),
  shield: shieldById('kite'), position: new THREE.Vector3(0, 0, 1.3), yaw: Math.PI,
});
const foe = new Fighter({
  name: 'Orvin the Grey', side: 'enemy', weapon: weaponById('messer'), harness: harnessById('gambeson'),
  shield: shieldById('buckler'), position: new THREE.Vector3(0, 0, 0), yaw: 0,
});
foe.lead = 'free-sword';
const hud = new Hud(hudRoot);
hud.build(player, foe, { def: {} });
ok('hud builds its panels', hudRoot.children.length >= 8, `${hudRoot.children.length} nodes`);
hud.setRounds(3, 1, 1);
ok('round pips', hud.pips.length === 3 && hud.pips.filter((p) => p.classList.contains('won')).length === 1);
hud.announce('Pass 2', 'first blood takes it');
ok('a banner is shown', hud.banner.classList.contains('show'));
hud.say('you cut his foreArm — a real wound', 'good');
hud.say('steel on steel', 'clash');
ok('the fight has a log', hud.feed.children.length === 2);
hud.hurt('left', 0.7);
ok('a hit darkens the view', parseFloat(hud.vigHurt.style.opacity) > 0.5);
hud.flash('rgba(255,0,0,.4)');
foe.bodyState.apply('chest', { cut: 30, blunt: 0, pierce: 0 }, 45);
foe.bodyState.regions.foreArm.disabled = true;
foe.bodyState.bleed = 3;
let sawIncoming = 0;
for (let i = 0; i < 30; i++) {
  hud.update(1 / 60, {
    threat: new THREE.Vector3(0, 1.2, 0.4), incomingSide: i > 16 ? 'left' : null,
    incomingKind: 'cut', aimX: 0.1 * Math.sin(i), aimY: 0.1 * Math.cos(i), quality: i / 30,
  });
  if (hud.tell.classList.contains('active')) sawIncoming++;
}
ok('the tell lights up for an incoming blow', sawIncoming > 0, `${sawIncoming} frames`);
ok('the dice on his wounds read out', /broken/.test(hud.foeWounds.innerHTML) && /bleeding/.test(hud.foeWounds.innerHTML), hud.foeWounds.innerHTML.slice(0, 60));
ok('the wind bar follows the man', /%/.test(hud.windFill.style.width), hud.windFill.style.width);
hud.show(false);
ok('the hud can be hidden', hudRoot.classList.contains('off'));

// ════════════════════════════════════════════════════════════════════════════
section('the boards');
const menuRoot = document.getElementById('menu');
const save = new Save();
save.reset();
const menu = new Menu(menuRoot, { save, kit: save.data.kit });
menu.on('drill', () => {});
menu.on('settings', () => {});
const screens = [
  ['title', () => menu.showTitle()],
  ['ladder', () => menu.showLadder()],
  ['quick', () => menu.showQuick()],
  ['armoury', () => menu.showArmoury()],
  ['settings', () => menu.showSettings()],
  ['pause', () => menu.showPause()],
  ['results', () => menu.showResults({ won: true, roundsWon: 2, roundsLost: 0, blowsLanded: 9, blowsTaken: 5, parries: 3, guardBreaks: 1, time: 41.2, reward: { coin: 90, renown: 60, rankUp: 'Sworn Blade' }, nextDrill: 'd2' })],
  ['briefing', () => menu.showBriefing(DRILLS[0])],
];
for (const [name, fn] of screens) {
  let err = null;
  try { fn(); } catch (e) { err = e; }
  const nodes = menuRoot.querySelectorAll('*').length;
  ok(`the ${name} screen draws`, !err && nodes > 4, err ? err.message : `${nodes} nodes`);
}
// clicking a chip must not throw: the armoury is the most button-heavy board
const armoury = menuRoot.querySelectorAll('.chip');
let clicked = 0;
for (const c of armoury.slice(0, 6)) { try { c._fire('click'); clicked++; } catch (e) { ok('a chip can be clicked', false, e.message); } }
ok('the armoury answers its buttons', clicked === Math.min(6, armoury.length), `${clicked} clicked`);
menu.hide();
ok('the menu can be dismissed', menuRoot.classList.contains('off'));

// ════════════════════════════════════════════════════════════════════════════
section('the hands: input & view');
const canvas = document.createElement('canvas');
const input = new Input(canvas);
input.locked = true;
canvas._fire('mousedown', { button: 0, repeat: false });
dispatchEvent({ type: 'mousemove', movementX: 40, movementY: -12 });
let look = input.lookDelta();
ok('a mouse move becomes a look', look.yaw !== 0 && look.pitch !== 0, `yaw ${look.yaw.toFixed(3)} pitch ${look.pitch.toFixed(3)}`);
ok('the left button arms a blow', input.mouse.left && input.mouse.leftDown);
dispatchEvent({ type: 'keydown', code: 'KeyW', preventDefault() {} });
const axis = input.moveAxis();
ok('W walks forward', axis.z === 1 && axis.x === 0);
dispatchEvent({ type: 'keydown', code: 'KeyI', preventDefault() {} });
ok('an unbound key keeps its own code', input.pressed('KeyI'));
dispatchEvent({ type: 'keyup', code: 'KeyW', preventDefault() {} });
input.endFrame();
ok('presses are consumed each frame', !input.pressed('KeyI') && !input.mouse.leftDown);

const cam = new THREE.PerspectiveCamera(74, 16 / 9, 0.02, 160);
const view = new View(cam);
player.speed = 1.2;
let camOk = true;
for (let i = 0; i < 120; i++) {
  const f = new Fighter({
    name: 'x', weapon: weaponById('arming'), harness: harnessById('gambeson'),
    position: new THREE.Vector3(0, 0, 0), yaw: 0,
  });
  f.rig.root.updateWorldMatrix(true, true);
  view.addLook(0.01, 0.02);
  view.update(1 / 60, f);
  if (!finite(cam.position.x) || !finite(cam.rotation.y)) camOk = false;
}
ok('the head stays on its neck for two seconds', camOk, `cam y ${cam.position.y.toFixed(2)} pitch ${view.pitch.toFixed(2)}`);
ok('the pitch cannot roll past vertical', Math.abs(view.pitch) <= view.maxPitch + 1e-6, view.pitch.toFixed(3));
view.impact(1, 'left');
view.jolt(0.6);
const before = view.kick.pitch;
view.update(1 / 60, player);
ok('an impact kicks the view and decays', finite(before) && Math.abs(view.kick.pitch) <= Math.abs(before) + 1e-6);

// ════════════════════════════════════════════════════════════════════════════
section('the air: effects');
const scene = new THREE.Scene();
const vfx = new Vfx(scene);
const at = new THREE.Vector3(0, 1.2, 0.5);
const nrm = new THREE.Vector3(0, 0.2, -1).normalize();
vfx.clash(at, nrm, 0.9);
vfx.wound(at, nrm, at, 0.8, true);
let sparksAtBirth = 0;
for (let i = 0; i < vfx.sparks.n; i++) if (vfx.sparks.life[i] > 0) sparksAtBirth++;
vfx.step(new THREE.Vector3(0, 0, 0), null, 1);
vfx.burst(at, nrm, 1);
vfx.fall(at);
vfx.stain(at, 0.4);
vfx.updateTrail(player, 1 / 60);
for (let i = 0; i < 60; i++) { vfx.updateTrail(player, 1 / 60); vfx.update(1 / 60); }
let nan = false;
for (let i = 0; i < vfx.sparks.n; i++) {
  if (!finite(vfx.sparks.pos[i * 3]) || !finite(vfx.sparks.pos[i * 3 + 1])) nan = true;
}
ok('a clash throws sparks', sparksAtBirth > 10, `${sparksAtBirth} sparks`);
ok('nothing in the air has gone to NaN', !nan);
ok('a strike leaves blood on the floor', vfx.decals.length >= 1, `${vfx.decals.length} stains`);
vfx.sparks.points.geometry.dispose();

// ════════════════════════════════════════════════════════════════════════════
section('the sound of it');
const audio = new Audio();
audio.start();
ok('the audio graph is built on a gesture', audio.ready, `${registry.nodes.length} nodes`);
const n0 = registry.nodes.length;
audio.clash(0.8);
audio.parry(0.7);
audio.guardBreak();
audio.cut(0.6, 'cut');
audio.cut(0.4, 'thrust');
audio.cut(0.5, 'blunt');
audio.clang(0.5);
audio.exhale(0.8);
audio.grunt(true);
audio.hurt(true);
audio.death();
audio.step(1.4, 'stone', 1);
audio.rattle(0.5);
audio.shieldHit(0.7);
audio.ui('confirm');
audio.bell();
audio.draw();
audio.setAmbient('hall');
audio.setAmbient('oubliette');
ok('every sound in the game makes a node', registry.nodes.length > n0 + 20, `${registry.nodes.length - n0} nodes for ${18} calls`);
audio.setEnabled(false);
audio.setVolume(0.5);

// ════════════════════════════════════════════════════════════════════════════
section('two brains, one hall');
{
  const A = new Fighter({
    name: 'Hale', side: 'player', weapon: weaponById('arming'), harness: harnessById('gambeson'),
    position: new THREE.Vector3(0, 0, 1.5), yaw: Math.PI,
  });
  const B = new Fighter({
    name: 'Orvin', side: 'enemy', weapon: weaponById('messer'), harness: harnessById('bouilli'),
    shield: shieldById('buckler'), position: new THREE.Vector3(0, 0, 0), yaw: 0,
  });
  const ba = new Brain(A, brainFor(CHAMPIONS[0], 1));
  const bb = new Brain(B, brainFor(CHAMPIONS[1], 1));
  const world = { bounds: { x: 12, z: 12 }, colliders: [] };
  const DT = 1 / 120;
  let t = 0, hits = 0, clashes = 0, ticks = 0;
  const events = [];
  while (t < 90 && A.alive && B.alive) {
    t += DT; ticks++;
    ba.update(DT, B); bb.update(DT, A);
    bindPair(A, B);
    A.update(DT, world, t); B.update(DT, world, t);
    resolveExchange(A, B, DT, events);
    for (const e of events) {
      if (e.type === 'hit') hits++;
      if (e.type === 'clash' || e.type === 'parry') clashes++;
    }
    events.length = 0;
    if (process.env.DBG && ticks % 120 === 0) {
      console.log(`   t${t.toFixed(1)} A(${A.pos.x.toFixed(1)},${A.pos.z.toFixed(1)}) yaw${A.yaw.toFixed(2)} i(${A.intent.x.toFixed(2)},${A.intent.z.toFixed(2)}) ${A.state} | B(${B.pos.x.toFixed(1)},${B.pos.z.toFixed(1)}) yaw${B.yaw.toFixed(2)} i(${B.intent.x.toFixed(2)},${B.intent.z.toFixed(2)}) ${B.state} dist${A.chestDistance(B).toFixed(2)} reach ${A.reach.toFixed(2)}`);
    }
  }
  ok('an AI duel reaches a conclusion', !A.alive || !B.alive || t >= 89, `${t.toFixed(1)} s, ${ticks} ticks, ${hits} hits, ${clashes} stops`);
  ok('the men actually fought', hits + clashes > 2, `${hits} hits, ${clashes} stops`);
  ok('nobody left the world or went to NaN', [A, B].every((f) => finite(f.pos.x) && finite(f.pos.z) && finite(f.stamina) && finite(f.wb.pos.x)));
  // not a truce: either a man is dealt with, or the two of them fought a full
  // pass and one of them is carrying the cost of it. Two untouched men walking
  // away would be a bug in the AI, which is what this check is really for.
  const hurtA = A.bodyState.health / A.bodyState.maxHealth, hurtB = B.bodyState.health / B.bodyState.maxHealth;
  const decided = !A.alive || !B.alive || A.yielded || B.yielded;
  ok('the duel was fought, not a truce', decided || (hits + clashes > 8 && Math.min(hurtA, hurtB) < 0.92),
    decided ? `${A.alive && !A.yielded ? A.name : B.name} is still standing` : `${hits} blows, ${clashes} stops, health ${(hurtA * 100).toFixed(0)}% / ${(hurtB * 100).toFixed(0)}%`);
  const dist = Math.hypot(A.pos.x - B.pos.x, A.pos.z - B.pos.z);
  ok('they did not stand inside one another', dist > 0.3, dist.toFixed(2) + ' m apart');
}

// ════════════════════════════════════════════════════════════════════════════
section('a whole bout through main.js');
globalThis.__ironvowNoAutoBoot = true;
const { Game } = await import('../src/main.js');
{
  const container = document.getElementById('app');
  const g = new Game(container);
  // the pieces boot() would make, minus the GPU
  g.scene = new THREE.Scene();
  g.camera = new THREE.PerspectiveCamera(74, 16 / 9, 0.02, 160);
  g.save = save;
  g.kit = save.data.kit = { weapon: 'longsword', harness: 'bouilli', shield: 'none' };
  g.input = new Input(document.createElement('canvas'));
  g.view = new View(g.camera);
  g.vfx = new Vfx(g.scene);
  g.audio = new Audio();
  g.audio.start();
  g.hud = new Hud(document.getElementById('hud'));
  g.menu = new Menu(document.getElementById('menu'), { save, kit: g.kit });
  g._wireMenu();
  g.renderer = { render() {}, domElement: document.createElement('canvas'), setSize() {}, setPixelRatio() {}, shadowMap: {} };
  let menuErr = null;
  try {
    g.loadArena('hall');
    g.beginBout({ mode: 'duel', arena: 'hall', opponents: ['hale'], rounds: 2, drill: DRILLS[0] });
  } catch (e) { menuErr = e; }
  ok('a bout can be set up', !menuErr, menuErr ? menuErr.stack.split('\n').slice(0, 3).join(' | ') : `${g.arena.def.name}, ${g.foe.name} waiting`);
  ok('the player carries what the armoury said', g.player.weaponDef.id === 'longsword' && g.player.harness.id === 'bouilli');
  ok('the player is a first-person rig', g.player.rig.firstPerson === true && g.player.rig.headG.visible === false);

  // a stand-in for the mouse: the player is driven by the same brain code
  const pBrain = new Brain(g.player, brainFor(CHAMPIONS[1], 0.9));
  const DT = 1 / 120;
  let t = 0, steps = 0, events = 0, deaths = 0;
  const oldEvent = g.onEvent.bind(g);
  g.onEvent = (e) => { events++; if (e.type === 'death') deaths++; oldEvent(e); };
  let err = null;
  try {
    while (t < 420 && g.mode === 'fight' && steps < 420 / DT) {
      t += DT; steps++;
      pBrain.update(DT, g.foe);
      g.step(DT);
    }
  } catch (e) { err = e; }
  ok('the game loop runs a whole bout without throwing', !err, err ? err.stack.split('\n').slice(0, 3).join(' | ') : `${steps} fixed steps, ${events} events`);
  ok('the fight produced events the shell had to handle', events > 3, `${events} events (${deaths} of them deaths)`);
  ok('the bout ended and the game returned to the boards', g.mode === 'menu', `mode=${g.mode} after ${t.toFixed(1)} s, passes ${g.bout.won}-${g.bout.lost}`);
  ok('a finished drill is paid and recorded', save.data.record.bouts >= 1 && (save.data.coin > 0 || save.data.cleared.d1), JSON.stringify({ coin: save.data.coin, renown: save.data.renown, cleared: Object.keys(save.data.cleared) }));
  ok('the results board is what the player sees', g.menu.screen === 'results', g.menu.screen);
  ok('the winner kept their feet', !g.player.alive || g.player.bodyState.health > 0 || g.bout.lost > 0);
  // and a second bout from the same game object, to prove nothing was left broken
  g.menu.hide();
  g.loadArena('courtyard');
  let err2 = null;
  try { g.beginBout({ mode: 'gauntlet', arena: 'courtyard', opponents: ['hale', 'orvin'], rounds: 1 }); } catch (e) { err2 = e; }
  ok('a second bout can follow the first', !err2, err2 ? err2.message : `${g.bout.mode}, ${g.foe.name} first out`);
  let err3 = null;
  try { for (let i = 0; i < 120; i++) { pBrain.update(DT, g.foe); g.step(DT); } } catch (e) { err3 = e; }
  ok('and it runs too', !err3, err3 ? err3.message : '2 s of the gauntlet');
  g.toHall();
  ok('the hall can be returned to', g.mode === 'menu' && g.player === null);
}

console.log(`\n${fails ? `${fails} CHECK(S) FAILED` : 'ALL SHELL CHECKS PASSED'}  (${checks - fails}/${checks})`);
process.exit(fails ? 1 : 0);
