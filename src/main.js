import * as THREE from 'three';
import { loadSave, persist, defaultSave, clearSave, hasSave } from './save.js';
import {
  APP_DEFS, GAMES, COUNTRIES, INTERNET_PLANS, PC_PARTS, PERIPHERALS, FURNITURE,
  STARTER_FURNITURE, EVENTS, pcComponentScore, getPart,
} from './creatorData.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const lerp = (a, b, t) => a + (b - a) * t;
const money = (v) => `$${Math.max(0, Math.floor(v)).toLocaleString('en-US')}`;
const preciseMoney = (v) => `$${Math.max(0, Number(v || 0)).toFixed(2)}`;
const num = (v) => Math.floor(v || 0).toLocaleString('en-US');
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const game = {
  save: loadSave(),
  mode: 'boot', // boot, menu, intro, world
  multiplayer: false,
  newGame: false,
  scene: null,
  camera: null,
  renderer: null,
  clock: new THREE.Clock(),
  world: null,
  player: null,
  partner: null,
  partnerTarget: null,
  interactables: [],
  packages: [],
  boat: null,
  nearest: null,
  keys: Object.create(null),
  introT: 0,
  menuT: 0,
  desktopOpen: false,
  activeApp: null,
  desktopWindowOpen: false,
  storeTab: 'games',
  externalStore: false,
  settingsTab: 'graphics',
  modal: null,
  timeAccumulator: 0,
  saveAccumulator: 0,
  location: 'SOUTH BEACH',
  stream: { active: false, gameId: 'sunny-shores', elapsed: 0, tick: 0, viewers: 0, views: 0, likes: 0, comments: 0, quality: 0, mode: 'AVATAR' },
  renderJob: null,
  ambientStarted: false,
  channel: null,
  networkTick: 0,
  wind: [],
};
window.CREATOR_LIFE = game;

const COLORS = {
  grass: 0x5b8968, grassDark: 0x315b52, sand: 0xe8c890, sandLight: 0xf3d7a6,
  ocean: 0x1c91a7, oceanDeep: 0x0b536f, road: 0x394b4c, roadEdge: 0x8b7660,
  wood: 0x8f5f3b, woodDark: 0x4c382d, wall: 0xd8c1a0, roof: 0x5b3d3d,
  teal: 0x76d9cd, coral: 0xee9278, white: 0xeaf5f2, dark: 0x10262b,
};

function material(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: opts.roughness ?? .82, metalness: opts.metalness ?? 0, transparent: !!opts.transparent, opacity: opts.opacity ?? 1, flatShading: !!opts.flatShading, emissive: opts.emissive ?? 0x000000, emissiveIntensity: opts.emissiveIntensity ?? 0 });
}
function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; return m;
}
function cyl(rt, rb, h, mat, x = 0, y = 0, z = 0, seg = 12) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; return m;
}
function sphere(r, mat, x = 0, y = 0, z = 0, seg = 12) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(6, Math.floor(seg / 2))), mat);
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; return m;
}
function labelSprite(text, color = '#dffaf5', scale = 1) {
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 128;
  const ctx = cv.getContext('2d'); ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = 'rgba(5,20,25,.82)'; ctx.fillRect(3, 14, 506, 100);
  ctx.strokeStyle = color; ctx.lineWidth = 4; ctx.strokeRect(3, 14, 506, 100);
  ctx.fillStyle = color; ctx.font = '600 31px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text.toUpperCase(), 256, 64);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true })); spr.scale.set(3.8 * scale, .95 * scale, 1); return spr;
}
function add(parent, child, x, y, z) { child.position.x += x || 0; child.position.y += y || 0; child.position.z += z || 0; parent.add(child); return child; }

function setModeScreen(id, visible) { $(id).classList.toggle('hidden', !visible); }
function toast(message, duration = 2900) {
  const el = $('toast'); if (!el) return;
  el.textContent = message; el.classList.add('show'); clearTimeout(game.toastTimer);
  game.toastTimer = setTimeout(() => el.classList.remove('show'), duration);
}
function notify(message, type = 'info') {
  const stack = $('notificationStack'); if (!stack) return;
  const el = document.createElement('div'); el.className = `notification ${type}`; el.textContent = message; stack.appendChild(el);
  setTimeout(() => el.remove(), 6500);
}

// Minimal synthesized UI and water ambience. No external sound files are needed.
let audioCtx = null;
function primeAudio() {
  if (audioCtx) { if (audioCtx.state === 'suspended') audioCtx.resume(); return; }
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const gain = audioCtx.createGain(); gain.gain.value = .018; gain.connect(audioCtx.destination);
    const osc = audioCtx.createOscillator(); osc.type = 'sine'; osc.frequency.value = 112; osc.connect(gain); osc.start(); game.audioGain = gain; game.audioOsc = osc;
  } catch (_) { /* audio is optional */ }
}
function beep(freq = 420, duration = .055) {
  if (!audioCtx || game.save.settings.volume <= 0) return;
  const osc = audioCtx.createOscillator(), gain = audioCtx.createGain(); osc.type = 'triangle'; osc.frequency.value = freq; gain.gain.setValueAtTime(.045, audioCtx.currentTime); gain.gain.exponentialRampToValueAtTime(.001, audioCtx.currentTime + duration); osc.connect(gain); gain.connect(audioCtx.destination); osc.start(); osc.stop(audioCtx.currentTime + duration);
}

function pcScore() { return pcComponentScore(game.save); }
function currentPlan() { return INTERNET_PLANS.find((p) => p.id === game.save.internetPlan) || INTERNET_PLANS[0]; }
function ownedPeripheral(kind) { return PERIPHERALS.filter((x) => x.kind === kind && game.save.ownedGear.includes(x.id)); }
function getGame(id) { return GAMES.find((x) => x.id === id) || GAMES[0]; }
function getApp(id) { return APP_DEFS.find((x) => x.id === id); }
function spend(amount) { if (game.save.cash < amount) { toast('Not enough money. Your first decisions matter.', 3200); beep(120); return false; } game.save.cash -= amount; return true; }
function saveGame(show = true) { persist(game.save); updateHUD(); if (show) toast('Game saved to local island storage.'); }

// ─────────────────────────────────────────────────────────────────────────────
// 3D island world
// ─────────────────────────────────────────────────────────────────────────────
function buildWorld() {
  game.scene = new THREE.Scene();
  game.scene.background = new THREE.Color(0x82c9d7);
  game.scene.fog = new THREE.Fog(0x82c9d7, 48, 115);
  game.camera = new THREE.PerspectiveCamera(game.save.settings.fov || 62, innerWidth / innerHeight, .1, 220);
  game.camera.position.set(26, 15, 31);

  const hemi = new THREE.HemisphereLight(0xdaf5f3, 0x31534f, 1.8); game.scene.add(hemi); game.hemi = hemi;
  const sun = new THREE.DirectionalLight(0xffe8c0, 2.2); sun.position.set(-22, 42, 18); sun.castShadow = true; sun.shadow.mapSize.set(1536, 1536); sun.shadow.camera.left = -56; sun.shadow.camera.right = 56; sun.shadow.camera.top = 56; sun.shadow.camera.bottom = -56; sun.shadow.bias = -.0004; game.scene.add(sun); game.sun = sun;
  const fill = new THREE.DirectionalLight(0x6fd3db, .45); fill.position.set(28, 12, -20); game.scene.add(fill);

  const root = new THREE.Group(); root.name = 'Tidebound Island'; game.scene.add(root); game.world = root;
  // Ocean and island shelf
  const ocean = new THREE.Mesh(new THREE.PlaneGeometry(230, 230, 50, 50), new THREE.MeshStandardMaterial({ color: COLORS.ocean, roughness: .23, metalness: .08, transparent: true, opacity: .92 }));
  ocean.rotation.x = -Math.PI / 2; ocean.position.y = -.78; ocean.receiveShadow = true; root.add(ocean); game.ocean = ocean;
  const deep = new THREE.Mesh(new THREE.CylinderGeometry(53, 58, 3, 64), material(COLORS.oceanDeep, { roughness: .95 })); deep.position.y = -2.1; root.add(deep);
  const sandShelf = new THREE.Mesh(new THREE.CylinderGeometry(48, 50, 1.3, 64), material(COLORS.sand, { roughness: 1 })); sandShelf.position.y = -.55; root.add(sandShelf);
  const land = new THREE.Mesh(new THREE.CylinderGeometry(40.5, 45, 4, 64), material(COLORS.grass, { roughness: 1 })); land.position.y = .35; root.add(land);
  const innerGrass = new THREE.Mesh(new THREE.CylinderGeometry(36, 40, .36, 64), material(0x6d9b6e, { roughness: 1 })); innerGrass.position.y = 2.27; root.add(innerGrass);

  // Rings of subtle animated waves around the shore.
  game.waves = [];
  for (let i = 0; i < 11; i++) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(47.4 + i * .46, 47.49 + i * .46, 96), new THREE.MeshBasicMaterial({ color: i % 2 ? 0x72d2d2 : 0x9de2dc, transparent: true, opacity: .16 - i * .009, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = -.1 + i * .004; root.add(ring); game.waves.push(ring);
  }

  buildRoad([[2, 0, 12], [2, 0, 4], [-7, 0, -1], [-17, 0, 1], [-22, 0, 10]], 3.2);
  buildRoad([[2, 0, 4], [12, 0, -3], [21, 0, -10], [28, 0, -18]], 2.6);
  buildRoad([[-7, 0, -1], [-4, 0, -15], [-13, 0, -25], [-25, 0, -28]], 2.35);
  buildRoad([[12, 0, -3], [5, 0, 20], [13, 0, 30]], 2.2);

  buildHouse(root, new THREE.Vector3(3, 0, 5));
  buildVillage(root);
  buildDock(root);
  buildViewpoints(root);
  buildForest(root);
  buildDecor(root);
  buildAnimals(root);
  buildNPCs(root);
  buildWifi(root);
  buildWeather(root);

  game.player = buildCharacter('YOU', 0x1e6571, 0xe7bd91, 0x263440);
  game.player.position.set(3, 0, 15); root.add(game.player);
  game.player.userData.isPlayer = true;
  if (game.multiplayer) createPartner();
}

function buildRoad(points, width) {
  const matRoad = material(COLORS.road, { roughness: 1 });
  const edgeMat = material(COLORS.roadEdge, { roughness: 1 });
  for (let i = 0; i < points.length - 1; i++) {
    const a = new THREE.Vector3(...points[i]), b = new THREE.Vector3(...points[i + 1]); const dx = b.x - a.x, dz = b.z - a.z; const length = Math.hypot(dx, dz); const angle = Math.atan2(dx, dz);
    const edge = box(width + .35, .06, length + .2, edgeMat, (a.x + b.x) / 2, .12, (a.z + b.z) / 2); edge.rotation.y = angle; game.world.add(edge);
    const road = box(width, .07, length, matRoad, (a.x + b.x) / 2, .17, (a.z + b.z) / 2); road.rotation.y = angle; game.world.add(road);
    for (let d = -length / 2 + 1; d < length / 2; d += 2.4) { const dash = box(.06, .075, .85, material(0xb69a70), 0, .04, d); dash.rotation.y = angle; dash.position.applyMatrix4(new THREE.Matrix4().makeTranslation((a.x + b.x) / 2, 0, (a.z + b.z) / 2)); game.world.add(dash); }
  }
}

function buildHouse(root, pos) {
  const g = new THREE.Group(); g.position.copy(pos); g.name = 'Starter house'; root.add(g);
  const floor = box(7.6, .25, 5.8, material(COLORS.woodDark), 0, .2, 0); g.add(floor);
  const rug = box(4.7, .04, 3.6, material(0x9f7462), 0, .36, -.2); g.add(rug);
  const wall = material(COLORS.wall, { roughness: .96 }); const wallDark = material(0xb49779, { roughness: 1 });
  g.add(box(7.6, 3.8, .24, wall, 0, 2.25, 2.76)); g.add(box(.24, 3.8, 5.8, wallDark, -3.68, 2.25, 0)); g.add(box(.24, 3.8, 5.8, wallDark, 3.68, 2.25, 0));
  // Open front: two short wall ends leave a view into the starter room.
  g.add(box(1.5, 3.8, .24, wall, -2.92, 2.25, -2.76)); g.add(box(1.5, 3.8, .24, wall, 2.92, 2.25, -2.76));
  const roof = new THREE.Mesh(new THREE.ConeGeometry(5.25, 2.2, 4), material(COLORS.roof, { roughness: .88 })); roof.rotation.y = Math.PI / 4; roof.scale.z = .72; roof.position.y = 5.08; g.add(roof);
  const door = box(1.05, 2.25, .1, material(0x4b3440), 0, 1.45, -2.9); g.add(door); g.add(box(.12, .12, .13, material(COLORS.sand), .34, 1.45, -2.98));
  for (const x of [-2.1, 2.1]) { const win = box(1.1, .9, .08, material(0x68b6bd, { metalness: .15, roughness: .2 }), x, 2.55, -2.91); g.add(win); g.add(box(.05, 1, .1, wallDark, x, 2.55, -2.97)); g.add(box(1.1, .05, .1, wallDark, x, 2.55, -2.98)); }
  const porch = box(8.3, .16, 1.15, material(COLORS.wood), 0, .34, -3.33); g.add(porch);
  const houseLabel = labelSprite('STARTER HOUSE', '#f0c995', .7); houseLabel.position.set(0, 5.7, 0); g.add(houseLabel);
  // Furniture and PC physically sit inside the open room.
  const desk = box(2.2, .16, .78, material(0x69504a), -1.3, 1.42, -.85); desk.name = 'Cheap desk'; g.add(desk); g.add(box(.12, 1.1, .12, material(0x4d3b38), -2.15, .85, -.58)); g.add(box(.12, 1.1, .12, material(0x4d3b38), -.45, .85, -.58));
  const chair = new THREE.Group(); chair.position.set(-1.3, .45, -.05); g.add(chair); chair.add(box(.9, .12, .85, material(0x493f48), 0, .45, 0)); chair.add(box(.8, 1.2, .12, material(0x493f48), 0, 1.05, .28)); chair.add(cyl(.08, .08, .75, material(0x303c42), 0, .08, 0));
  buildPC(g, new THREE.Vector3(-1.25, 1.5, -.93));
  const bed = new THREE.Group(); bed.position.set(1.7, .38, 1.2); g.add(bed); bed.add(box(2.2, .38, 3.1, material(0x563e45), 0, 0, 0)); bed.add(box(2.05, .27, 2.65, material(0x909b97), 0, .3, 0)); bed.add(box(2.12, .75, .22, material(0x61434a), 0, .68, 1.36)); bed.add(box(.72, .18, .55, material(0xc0c6b9), -.47, .55, .9));
  const wifiLabel = labelSprite('WEAK WIFI', '#76d9cd', .45); wifiLabel.position.set(2.9, 1.75, .5); g.add(wifiLabel);
  addInteractive(root, pos.clone().add(new THREE.Vector3(1.7, 1.4, -.95)), 'OPEN COMPUTER', 'Sit at the desk · Tide OS', 'pc', 3.1);
  addInteractive(root, pos.clone().add(new THREE.Vector3(3, 0, -3.4)), 'STARTER HOUSE', 'Your first home', 'house', 3.2);
}

function buildPC(parent, pos) {
  const g = new THREE.Group(); g.position.copy(pos); g.name = 'Weak PC — open components'; parent.add(g);
  const caseMat = material(0x292c32, { roughness: .62, metalness: .25 }); const glass = material(0x244247, { transparent: true, opacity: .38, roughness: .1, metalness: .25 });
  g.add(box(.82, 1.18, 1.05, caseMat, 0, .58, 0)); g.add(box(.68, .83, .025, glass, 0, .65, -.54));
  const gpu = box(.55, .13, .22, material(0xb86c5b, { metalness: .35 }), 0, .54, -.57); g.add(gpu); gpu.name = 'GPU';
  const cpu = box(.24, .13, .24, material(COLORS.teal, { metalness: .18, emissive: COLORS.teal, emissiveIntensity: .08 }), -.16, .9, -.57); g.add(cpu); cpu.name = 'CPU';
  for (let i = 0; i < 2; i++) g.add(box(.06, .42, .17, material(0xd0a95e), .08 + i * .1, .79, -.57));
  const fan = cyl(.18, .18, .03, material(0x6daaa9, { transparent: true, opacity: .8, emissive: COLORS.teal, emissiveIntensity: .13 }), .23, .35, -.59, 16); fan.rotation.x = Math.PI / 2; g.add(fan); g.userData.fan = fan;
  const mon = new THREE.Group(); mon.position.set(.05, 1.38, -.1); parent.add(mon); mon.add(box(1.65, 1.03, .12, material(0x272e31), 0, 0, 0)); mon.add(box(1.42, .8, .03, material(0x224c52, { emissive: 0x0c4b52, emissiveIntensity: .18 }), 0, .02, -.08)); mon.add(cyl(.06, .07, .5, material(0x303a3e), 0, -.71, 0)); mon.add(box(.82, .08, .38, material(0x34383b), 0, -.94, 0));
  const keyboard = box(.88, .05, .35, material(0x727477), -.72, 1.48, -.7); parent.add(keyboard); const mouse = box(.18, .07, .24, material(0x44494b), .12, 1.48, -.68); parent.add(mouse);
  const mic = cyl(.06, .1, .45, material(0x29262c, { metalness: .4 }), .82, 1.7, -.7); parent.add(mic); parent.add(cyl(.2, .2, .03, material(0x40353a), .82, 1.49, -.7));
  game.pcModel = g;
}

function buildBuilding(name, pos, color, signColor = '#76d9cd') {
  const g = new THREE.Group(); g.position.set(...pos); game.world.add(g);
  g.add(box(5, 3.4, 4.2, material(color), 0, 1.8, 0));
  const roof = new THREE.Mesh(new THREE.ConeGeometry(3.55, 1.45, 4), material(0x4d3b3a)); roof.rotation.y = Math.PI / 4; roof.position.y = 4.2; g.add(roof);
  g.add(box(1.2, 1.7, .08, material(0x33474a), 0, 1.05, -2.15));
  g.add(box(1.35, .8, .08, material(0x8bcbd0, { roughness: .25, metalness: .1 }), -1.55, 2.25, -2.16)); g.add(box(1.35, .8, .08, material(0x8bcbd0, { roughness: .25, metalness: .1 }), 1.55, 2.25, -2.16));
  const sign = labelSprite(name, signColor, .64); sign.position.set(0, 4.9, -1.2); g.add(sign); return g;
}
function buildVillage(root) {
  buildBuilding('GENERAL STORE', [-17, .3, 2], 0x9a806a, '#f0c995'); addInteractive(root, new THREE.Vector3(-17, 0, -.8), 'OPEN GENERAL STORE', 'Games · gear · furniture · internet', 'store', 4);
  buildBuilding('COMMUNITY HALL', [-24, .3, 10], 0x718b83, '#76d9cd'); addInteractive(root, new THREE.Vector3(-24, 0, 7), 'TALK TO LOCALS', 'Meet island NPCs and creator events', 'npc', 4);
  buildBuilding('FERRY OFFICE', [20, .25, -14], 0x7d6966, '#ee9278'); addInteractive(root, new THREE.Vector3(20, 0, -11), 'CHECK DELIVERIES', 'Packages arrive at the beach', 'delivery', 4);
  const fountain = new THREE.Group(); fountain.position.set(-13, .3, 11); root.add(fountain); fountain.add(cyl(2.0, 2.1, .28, material(0x8d9b95), 0, 0, 0, 16)); fountain.add(cyl(1.25, 1.35, .18, material(0x65aab0), 0, .22, 0, 16)); fountain.add(cyl(.18, .18, 1.1, material(0x8d9b95), 0, .75, 0)); fountain.add(sphere(.26, material(0x75d0ce, { emissive: COLORS.teal, emissiveIntensity: .25 }), 0, 1.34, 0));
  const villageLabel = labelSprite('VILLAGE', '#eaf5f2', .55); villageLabel.position.set(-18, 5.5, 7); root.add(villageLabel);
}
function buildDock(root) {
  const dock = new THREE.Group(); dock.position.set(20, .05, -16); root.add(dock);
  for (let i = 0; i < 8; i++) { const plank = box(2.2, .18, .7, material(i % 2 ? 0x926744 : 0x7b563d), 0, 0, i * .72); dock.add(plank); }
  for (const x of [-.82, .82]) for (let i = 0; i < 5; i++) dock.add(cyl(.09, .12, 1.3, material(0x513a2e), x, -.45, i * 1.1));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.3, .07, 8, 40), new THREE.MeshBasicMaterial({ color: COLORS.teal, transparent: true, opacity: .5 })); ring.rotation.x = Math.PI / 2; ring.position.set(0, .16, 3.5); dock.add(ring); game.dockRing = ring;
  addInteractive(root, new THREE.Vector3(20, 0, -12), 'FERRY OFFICE', 'Boat deliveries and island schedules', 'delivery', 4);
}
function buildViewpoints(root) {
  const hill = new THREE.Group(); hill.position.set(-22, 0, -25); root.add(hill); hill.add(new THREE.Mesh(new THREE.ConeGeometry(9, 10, 8), material(0x557861, { roughness: 1 }))); const hillTop = new THREE.Mesh(new THREE.ConeGeometry(6.2, 7, 8), material(0x6e9470, { roughness: 1 })); hillTop.position.y = 4; hill.add(hillTop);
  const deck = box(4.3, .22, 2.4, material(0x8b6040), -1, 8.6, 0); hill.add(deck); for (let x = -2.8; x < 1; x += .9) hill.add(cyl(.06, .06, 1.1, material(0x49362d), x, 9.1, -1));
  const beacon = cyl(.12, .12, 2.0, material(0x3d4f4f), 1.9, 9.4, .1); hill.add(beacon); hill.add(sphere(.25, material(COLORS.coral, { emissive: COLORS.coral, emissiveIntensity: .8 }), 1.9, 10.45, .1));
  addInteractive(root, new THREE.Vector3(-23, 8.8, -25), 'CLIFF VIEWPOINT', 'A perfect place for a wide island shot', 'viewpoint', 4.2);
}
function buildTree(x, z, scale = 1, tint = 0x3f755e) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.scale.setScalar(scale); g.userData.sway = .4 + Math.random() * .7;
  g.add(cyl(.23, .35, 2.2, material(0x614a36, { roughness: 1 }), 0, 1.1, 0));
  const crownLow = new THREE.Mesh(new THREE.ConeGeometry(1.35, 2.8, 8), material(tint, { roughness: 1, flatShading: true })); crownLow.position.y = 3; g.add(crownLow);
  const crownHigh = new THREE.Mesh(new THREE.ConeGeometry(1.05, 2.0, 8), material(0x4c835f, { roughness: 1, flatShading: true })); crownHigh.position.y = 4.25; g.add(crownHigh);
  game.world.add(g); game.wind.push(g); return g;
}
function buildForest(root) {
  const spots = [[-4,-21,1.2], [1,-24,1], [7,-23,1.35], [12,-26,1.1], [17,-24,.86], [-4,-31,1.3], [4,-33,1.15], [14,-34,1.3], [27,-27,.9], [30,-19,1.15], [-31,-18,1.2], [-32,-8,1], [-27,22,1.25], [-17,27,1.15], [-4,30,1.2], [24,25,1.1], [30,17,1.2], [33,5,1.1]];
  spots.forEach((s, i) => buildTree(s[0], s[1], s[2], i % 3 === 0 ? 0x3e725f : 0x4b8060));
  for (let i = 0; i < 26; i++) { const a = i * 2.399, r = 17 + (i * 7 % 16); buildTree(Math.cos(a) * r, Math.sin(a) * r, .52 + (i % 4) * .1, 0x568462); }
}
function buildDecor(root) {
  const rockMat = material(0x687a72, { roughness: 1, flatShading: true });
  [[-9,-22,1.3],[25,-5,1.1],[-29,14,1.2],[-3,23,1], [28,12,.9], [10,-30,.8]].forEach(([x,z,s]) => { const r = sphere(1, rockMat, x, .7, z, 7); r.scale.set(s, .65 * s, .8 * s); root.add(r); });
  // Palm trees near the beach.
  [[-15, -35], [-7, -38], [18, -35], [28, -31], [-34, -2]].forEach(([x,z], i) => { const p = new THREE.Group(); p.position.set(x,0,z); root.add(p); p.add(cyl(.17,.26,3.5, material(0x775237),0,1.75,0)); for (let j=0;j<6;j++){ const leaf=box(2.6,.07,.22,material(0x39785a),0,3.55,0); leaf.rotation.y=j*Math.PI/3; leaf.rotation.z=.12; p.add(leaf); } });
  // A small hidden cove sits behind the northern trees.
  const cove = new THREE.Group(); cove.position.set(-31, 0, -24); root.add(cove); cove.add(sphere(2.5, material(0x566b61, { roughness: 1, flatShading: true }), -2, 1.5, 0, 7)); cove.add(sphere(2.8, material(0x4d6259, { roughness: 1, flatShading: true }), 2, 1.6, 0, 7)); const caveOpening = new THREE.Mesh(new THREE.CircleGeometry(1.2, 12), material(0x10282e, { roughness: 1 })); caveOpening.position.set(0, 1.2, -.75); cove.add(caveOpening); addInteractive(root, new THREE.Vector3(-31, 0, -23), 'HIDDEN COVE', 'A quiet location for a secret video', 'viewpoint', 3.5);
  // Beach pennants and lanterns lead toward the village.
  for (let i = 0; i < 7; i++) { const x = -3 - i * 2.4; const p = cyl(.035,.035,1.8,material(0x5f493a),x,.9,11-i*.4); root.add(p); const flag = new THREE.Mesh(new THREE.PlaneGeometry(.52,.3), new THREE.MeshBasicMaterial({color:i%2?COLORS.coral:COLORS.teal,side:THREE.DoubleSide})); flag.position.set(x+.24,1.55,11-i*.4); flag.rotation.y = Math.PI/2; root.add(flag); }
}
function buildAnimals(root) {
  const mats = [material(0xd9c2a4), material(0x4d5e5f), material(0xe1a46f)];
  [[-10,15],[14,17],[28,3]].forEach(([x,z],i) => { const g=new THREE.Group();g.position.set(x,0,z);g.userData.animalPhase=Math.random()*6; root.add(g);g.add(sphere(.35,mats[i%3],0,.45,0,10));g.add(sphere(.27,mats[i%3],0,.75,.25,10));g.add(sphere(.07,material(0x1a2326),-.1,.79,.48,8));g.add(cyl(.06,.08,.55,mats[i%3],-.23,.25,0));g.add(cyl(.06,.08,.55,mats[i%3],.23,.25,0)); });
}
function buildCharacter(name, shirtColor, skinColor, pantsColor) {
  const g = new THREE.Group(); g.name = name; g.userData.walk = 0; g.userData.baseY = 0;
  g.add(cyl(.33,.38,1.05,material(shirtColor),0,1.15,0,12)); g.add(sphere(.3,material(skinColor),0,1.9,0,12)); g.add(sphere(.31,material(0x27252a),0,2.1,-.02,12));
  const legMat = material(pantsColor); g.add(cyl(.12,.14,.75,legMat,-.15,.45,0,8)); g.add(cyl(.12,.14,.75,legMat,.15,.45,0,8));
  const armL = cyl(.09,.1,.7,material(skinColor),-.43,1.3,0,8); armL.rotation.z = -.55; g.add(armL); const armR = cyl(.09,.1,.7,material(skinColor),.43,1.3,0,8); armR.rotation.z = .55; g.add(armR);
  g.userData.parts = { body: g.children[0] }; return g;
}
function buildNPCs(root) {
  const people = [[-10,10,0x9d625d,0xd7ad87,0x34424b,'Mara'],[-17,13,0x5d8690,0xb98268,0x69534d,'Ilias'],[-6,7,0xc68f5f,0xdfbc98,0x3e584d,'Nia'],[-25,5,0x886e9c,0xc08f73,0x273f55,'Omar']];
  game.npcs = people.map(([x,z,s,sk,p,n],i)=>{ const g=buildCharacter(n,s,sk,p);g.position.set(x,0,z);g.userData.npcPhase=i*1.7;g.userData.origin=new THREE.Vector3(x,0,z);root.add(g);addInteractive(root,new THREE.Vector3(x,0,z),`TALK TO ${n.toUpperCase()}`,'Ask about the island and your channel','npc',2.7);return g; });
}
function buildWeather(root) {
  const count = 240; const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) { positions[i * 3] = (Math.random() - .5) * 82; positions[i * 3 + 1] = Math.random() * 24 + 2; positions[i * 3 + 2] = (Math.random() - .5) * 82; }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  game.rain = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xb6e8ea, size: .11, transparent: true, opacity: .65 })); game.rain.visible = game.save.weather === 'rain'; root.add(game.rain);
}
function updateRain(dt) {
  if (!game.rain) return; game.rain.visible = game.save.weather === 'rain'; if (!game.rain.visible) return;
  const attr = game.rain.geometry.attributes.position; for (let i = 0; i < attr.count; i++) { let y = attr.getY(i) - dt * 13; if (y < .2) { y = 25; attr.setX(i, (Math.random() - .5) * 82); attr.setZ(i, (Math.random() - .5) * 82); } attr.setY(i, y); } attr.needsUpdate = true;
}
function buildWifi(root) {
  const g = new THREE.Group(); g.position.set(5.7, .45, 5.2); root.add(g); g.add(cyl(.08,.1,.75,material(0x4a5a58),0,.35,0)); g.add(sphere(.12,material(COLORS.teal,{emissive:COLORS.teal,emissiveIntensity:.4}),0,.78,0));
  game.wifiRings = [];
  for (let i=0;i<3;i++){const ring=new THREE.Mesh(new THREE.TorusGeometry(.55+i*.5,.018,6,30,Math.PI*1.45),new THREE.MeshBasicMaterial({color:COLORS.teal,transparent:true,opacity:.35-i*.08}));ring.rotation.x=Math.PI/2;ring.rotation.z=-Math.PI/4;ring.position.y=1.0+i*.28;g.add(ring);game.wifiRings.push(ring);}
}
function addInteractive(parent, position, title, detail, type, range = 3) {
  const marker = { position: position.clone ? position.clone() : new THREE.Vector3(...position), title, detail, type, range, parent };
  game.interactables.push(marker); return marker;
}
function createPartner() {
  if (game.partner) return;
  game.partner = buildCharacter('CO-PLAYER', 0xb26e75, 0xd6ab8d, 0x304c59); game.partner.position.set(5,0,15); game.world.add(game.partner); game.partnerTarget = game.partner.position.clone();
  addInteractive(game.world, new THREE.Vector3(5,0,15), 'CO-PLAYER', 'Your online partner · camera operator', 'partner', 2.5);
}

// ─────────────────────────────────────────────────────────────────────────────
// Menu, intro and camera
// ─────────────────────────────────────────────────────────────────────────────
function showMainMenu() {
  game.mode = 'menu'; game.desktopOpen = false; game.modal = null;
  setModeScreen('boot', false); setModeScreen('intro', false); setModeScreen('hud', false); setModeScreen('mainMenu', true);
  $('desktopOverlay').classList.add('hidden'); $('storeOverlay').classList.add('hidden'); $('caseOverlay').classList.add('hidden'); $('settingsOverlay').classList.add('hidden'); $('multiOverlay').classList.add('hidden'); $('pauseOverlay').classList.add('hidden');
}
function startStory(multiplayer = false, fresh = false, skip = false) {
  primeAudio(); beep(430); game.multiplayer = multiplayer; game.newGame = fresh; game.stream = { active: false, gameId: 'sunny-shores', elapsed: 0, tick: 0, viewers: 0, views: 0, likes: 0, comments: 0, quality: 0, mode: 'AVATAR' }; game.renderJob = null;
  if (fresh) { game.save = defaultSave(); persist(game.save); }
  game.save.room = game.save.room || { code: '', role: '' };
  if (multiplayer) setupNetwork();
  buildOrResetWorld();
  if (skip) enterWorld(); else { game.mode = 'intro'; game.introT = 0; setModeScreen('mainMenu', false); setModeScreen('intro', true); setModeScreen('hud', false); }
}
function buildOrResetWorld() {
  if (game.world) game.scene.remove(game.world);
  game.interactables = []; game.packages = []; game.wind = []; game.partner = null; game.boat = null; game.pcModel = null;
  buildWorld();
}
function enterWorld() {
  game.mode = 'world'; game.introT = 0; setModeScreen('intro', false); setModeScreen('mainMenu', false); setModeScreen('hud', true); game.player.position.set(3,0,15); if (game.partner) game.partner.position.set(5,0,15); updateHUD(); updateObjective(); toast(game.multiplayer ? 'Online island loaded. Your partner is waiting by the house.' : 'Welcome home. Start by learning what this little room can do.', 4200); notify('FIRST MORNING · Explore the island and meet your PC.'); primeAudio();
}
function updateIntro(dt) {
  game.introT += dt; const t = game.introT; const duration = 12;
  const points = [new THREE.Vector3(37, 19, 34), new THREE.Vector3(-36, 14, 20), new THREE.Vector3(-20, 12, -26), new THREE.Vector3(16, 7, 21), new THREE.Vector3(8, 4, 15)];
  const p = clamp(t / duration, 0, .999) * (points.length - 1); const i = Math.floor(p); const f = p - i; game.camera.position.lerpVectors(points[i], points[i + 1], f); const look = new THREE.Vector3(0, 1, 0); if (t > 8) look.set(3, 1.5, 5); game.camera.lookAt(look);
  $('cineProgress').style.width = `${clamp(t / duration * 100, 0, 100)}%`;
  if (t < 3.1) setCine('TIDEBOUND ISLAND', 'A place to begin.', 'The tide is coming in. Your new life is waiting on the other side of the water.');
  else if (t < 6.1) setCine('THE ISLAND', 'Small enough to know.', 'A beach, a village, a forest and enough hidden corners to make a thousand stories.');
  else if (t < 9.2) setCine('THE HOUSE', 'Almost nothing. Almost everything.', 'A worn bed. A cheap desk. A weak computer. Your first studio is already here.');
  else setCine('DAY ONE', 'What will you make?', 'Step onto the sand and build a life that grows with every decision.');
  if (t > duration) enterWorld();
}
function setCine(kicker, title, body) { if ($('cineKicker').textContent !== kicker) { $('cineKicker').textContent = kicker; $('cineTitle').textContent = title; $('cineBody').textContent = body; } }
function skipIntro() { if (game.mode === 'intro') enterWorld(); }
function updateMenuCamera(dt) {
  game.menuT += dt * .1; const t = game.menuT; game.camera.position.set(Math.sin(t) * 49, 14 + Math.sin(t * 1.7) * 2, Math.cos(t) * 49); game.camera.lookAt(0, 1, 0);
}
function updateWorldCamera(dt) {
  if (!game.player) return; const p = game.player.position; const desired = new THREE.Vector3(p.x + 8.7, p.y + 5.2, p.z + 10.5); game.camera.position.lerp(desired, 1 - Math.pow(.0004, dt)); game.camera.lookAt(p.x, p.y + 1.15, p.z - .2);
}

// ─────────────────────────────────────────────────────────────────────────────
// Movement, living world, deliveries and simulation time
// ─────────────────────────────────────────────────────────────────────────────
function modalBlocksMovement() { return game.desktopOpen || !game.modal || game.modal === 'pause' ? game.desktopOpen || game.modal === 'pause' : true; }
function updateMovement(dt) {
  if (game.mode !== 'world' || modalBlocksMovement()) return;
  const x = (game.keys.KeyD || game.keys.ArrowRight ? 1 : 0) - (game.keys.KeyA || game.keys.ArrowLeft ? 1 : 0);
  const z = (game.keys.KeyS || game.keys.ArrowDown ? 1 : 0) - (game.keys.KeyW || game.keys.ArrowUp ? 1 : 0);
  const v = new THREE.Vector3(x, 0, z); if (v.lengthSq() === 0) { animateCharacter(game.player, dt, false); return; }
  v.normalize(); const speed = game.keys.ShiftLeft || game.keys.ShiftRight ? 6.5 : 3.7; game.player.position.addScaledVector(v, dt * speed); game.player.position.x = clamp(game.player.position.x, -39, 39); game.player.position.z = clamp(game.player.position.z, -39, 37);
  game.player.rotation.y = Math.atan2(v.x, v.z); animateCharacter(game.player, dt, true); updateNetwork(dt);
}
function animateCharacter(character, dt, walking) { if (!character) return; character.userData.walk += dt * (walking ? 10 : 2); const swing = walking ? Math.sin(character.userData.walk) * .08 : 0; if (character.children[3]) character.children[3].rotation.x = swing; if (character.children[4]) character.children[4].rotation.x = -swing; character.position.y = Math.abs(Math.sin(character.userData.walk)) * (walking ? .035 : .01); }
function updateNPCs(dt) { (game.npcs || []).forEach((npc) => { const phase = (game.save.dayTime * .25 + npc.userData.npcPhase); npc.position.x = npc.userData.origin.x + Math.sin(phase) * 1.2; npc.position.z = npc.userData.origin.z + Math.cos(phase * .7) * .8; npc.rotation.y = phase; animateCharacter(npc, dt, true); }); if (game.partner && game.partnerTarget) { game.partner.position.lerp(game.partnerTarget, .08); animateCharacter(game.partner, dt, game.partner.position.distanceTo(game.partnerTarget) > .06); } }
function updateLivingWorld(dt) {
  const t = game.save.dayTime % 24; game.save.dayTime += dt * .042; if (game.save.dayTime >= 24) { game.save.dayTime -= 24; game.save.day++; game.save.weather = Math.random() < .22 ? 'rain' : 'clear'; notify(`DAY ${String(game.save.day).padStart(2,'0')} · A new island morning · ${game.save.weather.toUpperCase()}.`); }
  const angle = ((t - 6) / 24) * Math.PI * 2; const daylight = clamp(Math.sin(angle) * .52 + .54, .12, 1); game.sun.position.set(Math.cos(angle) * 35, 17 + daylight * 32, Math.sin(angle) * 35); game.sun.intensity = .45 + daylight * 1.9; game.hemi.intensity = .55 + daylight * 1.4; game.scene.background.setHSL(.53, .44, .29 + daylight * .27); game.scene.fog.color.copy(game.scene.background); game.scene.fog.near = 42 + daylight * 13; game.scene.fog.far = 95 + daylight * 35;
  if (game.ocean) { game.ocean.rotation.z += dt * .001; game.ocean.position.y = -.78 + Math.sin(performance.now() * .0005) * .025; } (game.waves || []).forEach((w, i) => { w.scale.setScalar(1 + Math.sin(performance.now() * .00035 + i) * .018); w.material.opacity = (.16 - i * .009) * (.65 + daylight * .35); }); (game.wind || []).forEach((tree, i) => { tree.rotation.z = Math.sin(performance.now() * .0007 * tree.userData.sway + i) * .018; }); (game.wifiRings || []).forEach((r,i)=> { r.material.opacity = .2 + Math.abs(Math.sin(performance.now()*.001+i))*.2; }); if (game.dockRing) game.dockRing.rotation.z += dt * .3;
  updateRain(dt); updateNPCs(dt); updateMovement(dt); updateOrders(dt); updateStream(dt); updateRenderJob(); updateHUD(); game.save.stats.playTime += dt; game.saveAccumulator += dt; if (game.saveAccumulator > 28) { persist(game.save); game.saveAccumulator = 0; }
}
function updateLocation() { const p = game.player.position; if (p.z > 10) game.location = 'SOUTH BEACH'; else if (p.x < -11 && p.z > -2) game.location = 'TIDEBOUND VILLAGE'; else if (p.x > 14 && p.z < -8) game.location = 'FERRY DOCKS'; else if (p.z < -17) game.location = 'PINE FOREST'; else if (p.x < -18) game.location = 'CLIFF VIEWPOINT'; else game.location = 'ISLAND ROAD'; $('locationName').textContent = game.location; }
function updateOrders(dt) {
  const now = game.save.dayTime + game.save.day * 24; game.save.orders.forEach((order) => {
    if (order.status === 'scheduled' && now >= order.dueAt) { order.status = 'arrived'; order.arrivedAt = now; spawnPackage(order); notify(`DELIVERY ARRIVED · ${order.name}`, 'delivery'); toast(`${order.name} is waiting on the beach.`); }
  });
  if (game.boat && game.boat.userData.target) { game.boat.position.lerp(game.boat.userData.target, .003); game.boat.rotation.y = Math.atan2(game.boat.userData.target.x - game.boat.position.x, game.boat.userData.target.z - game.boat.position.z); }
}
function spawnPackage(order) {
  if (game.packages.some((p) => p.order.id === order.id)) return;
  const g = new THREE.Group(); g.position.set(-1.5 + game.packages.length * 1.05, .65, 16.8); g.name = `Delivery — ${order.name}`; g.add(box(.95, .9, .95, material(0xb88655), 0, 0, 0)); g.add(box(.98, .08, .08, material(0xecd09a), 0, .34, 0)); g.add(box(.08, .08, .98, material(0xecd09a), 0, .34, 0)); const tag = labelSprite(order.name, '#f0c995', .3); tag.position.set(0, .85, 0); g.add(tag); game.world.add(g); const pack = { order, group: g, carried: false }; game.packages.push(pack); game.interactables.push({ position: g.position.clone(), title: 'PICK UP PACKAGE', detail: order.name, type: 'package', range: 2.8, package: pack });
  if (!game.boat) { const boat = buildBoat(); boat.position.set(35,.1,-14); game.world.add(boat); boat.userData.target = new THREE.Vector3(5,.1,12); game.boat = boat; }
}
function buildBoat() { const b=new THREE.Group();b.add(box(3,.55,1.4,material(0x684b3d),0,.35,0));b.add(box(1.2,.55,.7,material(0xe1d2b3),0,.85,.1));b.add(cyl(.08,.08,2.5,material(0x493a34),0,1.8,0));const sail=new THREE.Mesh(new THREE.PlaneGeometry(1.45,1.2),new THREE.MeshBasicMaterial({color:0xf0d5ad,side:THREE.DoubleSide}));sail.position.set(0,1.8,.05);sail.rotation.y=Math.PI/2;b.add(sail);return b; }
function pickupPackage(pack) { if (pack.carried) { if (game.player.position.distanceTo(new THREE.Vector3(3,0,5)) < 5) { placePackage(pack); } else toast('Carry it home to the starter house.'); return; } pack.carried = true; pack.group.visible = false; game.carrying = pack; pack.order.status = 'carrying'; toast(`Carrying ${pack.order.name}. Walk to your house.`); updatePrompt(); }
function placePackage(pack) { pack.order.status = 'placed'; game.save.stats.deliveries++; game.save.orders = game.save.orders.filter((o) => o.id !== pack.order.id); game.carrying = null; const idx = game.packages.indexOf(pack); if (idx >= 0) game.packages.splice(idx,1); if (pack.group.parent) pack.group.parent.remove(pack.group); game.interactables = game.interactables.filter((x) => x.package !== pack);
  if (pack.order.kind === 'gear') { game.save.ownedGear.push(pack.order.itemId); game.save.placedGear.push(pack.order.itemId); const delivered = PERIPHERALS.find((x) => x.id === pack.order.itemId); if (delivered?.kind === 'monitor') game.save.pc.monitor = delivered.name; if (delivered?.kind === 'keyboard') game.save.pc.keyboard = delivered.name; if (delivered?.kind === 'mouse') game.save.pc.mouse = delivered.name; if (delivered?.kind === 'mic') game.save.pc.microphone = delivered.name; if (delivered?.kind === 'router') game.save.router = delivered.id; } else if (pack.order.kind === 'furniture') { game.save.furniture.push(pack.order.itemId); game.save.placedFurniture.push(pack.order.itemId); createPlacedFurniture(pack.order.itemId); } else if (pack.order.kind === 'component') { game.save.pc.components[pack.order.slot] = pack.order.itemId; } else if (pack.order.kind === 'internet') { game.save.internetPlan = pack.order.itemId; }
  persist(game.save); updateHUD(); toast(`${pack.order.name} placed in your home.`); notify(`HOME UPDATED · ${pack.order.name}`); updateObjective();
}
function createPlacedFurniture(id) { const item = [...FURNITURE, ...STARTER_FURNITURE].find((x) => x.id === id); if (!item || !game.world) return; const g = new THREE.Group(); g.position.set(3 + Math.random()*1.2, .45, 5 + Math.random()*.9); g.add(box(1.25,.75,.65,material(item.category === 'light' ? 0x8f7563 : 0x667b76),0,.4,0)); const itemLabel = labelSprite(item.name.slice(0,16),'#eaf5f2',.22); itemLabel.position.y=1.05; g.add(itemLabel); game.world.add(g); }

// ─────────────────────────────────────────────────────────────────────────────
// HUD and objectives
// ─────────────────────────────────────────────────────────────────────────────
function updateHUD() {
  if (!game.save) return; const hour = Math.floor(game.save.dayTime % 24), minute = Math.floor((game.save.dayTime % 1) * 60); const time = `${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`;
  if ($('hudDay')) $('hudDay').textContent = String(game.save.day).padStart(2,'0'); if ($('hudTime')) $('hudTime').textContent = time; if ($('desktopClock')) $('desktopClock').textContent = time; if ($('taskbarClock')) $('taskbarClock').textContent = time;
  if ($('hudCash')) $('hudCash').textContent = money(game.save.cash); if ($('hudSubs')) $('hudSubs').textContent = num(game.save.subscribers); const plan=currentPlan(); if ($('wifiName')) $('wifiName').textContent=plan.name.toUpperCase(); if ($('wifiStats')) $('wifiStats').textContent=`${plan.speed} Mbps · ${plan.ping} ms`; if ($('desktopWifi')) $('desktopWifi').textContent=`${plan.speed} Mbps`;
  const weather = game.save.weather === 'clear' ? 'CALM' : game.save.weather.toUpperCase(); if ($('weatherLabel')) $('weatherLabel').textContent=weather; if ($('weatherGlyph')) $('weatherGlyph').textContent=game.save.weather === 'clear' ? 'CLEAR' : 'RAIN'; updateLocation(); updatePrompt(); updateStreamHUD();
}
function updateObjective() {
  let title='Make yourself at home', body='Walk to the little house and meet your weak PC.', meter=12;
  if (game.save.installedApps.length < 5) { title='Learn the desktop'; body='Sit at the cheap desk and open Tide OS. The App Store is waiting.'; meter=25; }
  else if (!game.save.stats.streams) { title='Go live for the first time'; body='Install Stream Desk, choose Sunny Shores, and start your first stream.'; meter=42; }
  else if (pcScore() < 40) { title='Build a better connection'; body='Use your first payout for an internet or PC upgrade.'; meter=58; }
  else if (!game.save.cameras.length) { title='Tell an island story'; body='Visit the General Store and order a camera. It arrives by boat.'; meter=73; }
  else { title='Grow the studio'; body='Record outside, edit a video and use Pulse Analytics to follow your audience.'; meter=88; }
  if ($('objectiveTitle')) $('objectiveTitle').textContent=title; if ($('objectiveBody')) $('objectiveBody').textContent=body; if ($('objectiveMeter')) $('objectiveMeter').style.width=`${meter}%`;
}
function updatePrompt() {
  if (game.mode !== 'world' || game.desktopOpen || game.modal) { $('interactPrompt').classList.add('hidden'); return; }
  let nearest=null, dist=Infinity; const p=game.player?.position; if (!p) return;
  for (const i of game.interactables) { if (i.type==='package' && !i.package?.group?.visible && !i.package?.carried) continue; const d=p.distanceTo(i.position); if (d < i.range && d < dist) { nearest=i; dist=d; } }
  if (game.carrying) { const homeDistance=p.distanceTo(new THREE.Vector3(3,0,5)); if (homeDistance < 5) nearest={title:'PLACE PACKAGE',detail:game.carrying.order.name,type:'package',package:game.carrying,range:5}; }
  game.nearest=nearest; const el=$('interactPrompt'); if (nearest) { el.classList.remove('hidden'); $('interactTitle').textContent=nearest.title; $('interactDetail').textContent=nearest.detail; } else el.classList.add('hidden');
}
function interact() { if (game.mode !== 'world' || game.desktopOpen) return; const i=game.nearest; if (!i) { toast('Nothing close enough to interact with.'); return; } beep(520); if (i.type==='pc') openDesktop(); else if (i.type==='store') openExternalStore('games'); else if (i.type==='delivery') openDesktop('calendar'); else if (i.type==='package') pickupPackage(i.package); else if (i.type==='viewpoint') { toast('Wide shot unlocked. This viewpoint is ideal for an island vlog.'); game.save.messages.push({from:'Island Guide',text:'The cliff viewpoint gives you the widest island composition.',time:'Now',unread:true}); } else if (i.type==='npc') talkTo(i); else if (i.type==='partner') openDesktop('messenger'); }
function talkTo(i) { const lines = ['The ferry comes twice a day. Keep an eye on your calendar.','Your first viewers will remember how you started.','The forest is quiet after sunset. Bring a camera when you can.','The shopkeeper can order almost anything, but deliveries take time.']; const message=pick(lines); toast(message,4000); game.save.messages.push({from:i.title.replace('TALK TO ','')||'Island local',text:message,time:`Day ${game.save.day}`,unread:true}); }

// ─────────────────────────────────────────────────────────────────────────────
// Desktop OS and app windows
// ─────────────────────────────────────────────────────────────────────────────
function openDesktop(appId = null) { primeAudio(); game.desktopOpen=true; game.modal='desktop'; $('desktopOverlay').classList.remove('hidden'); renderDesktop(); if (appId) openApp(appId); else { $('desktopWindow').classList.add('hidden'); game.desktopWindowOpen=false; } }
function closeDesktop() { game.desktopOpen=false; game.modal=null; $('desktopOverlay').classList.add('hidden'); $('desktopWindow').classList.add('hidden'); game.activeApp=null; updatePrompt(); }
function renderDesktop() {
  const icons=$('desktopIcons'); icons.innerHTML=''; const apps=game.save.installedApps.map(getApp).filter(Boolean); apps.forEach((app)=>{const b=document.createElement('button');b.className='desktop-icon';b.dataset.app=app.id;b.innerHTML=`<span class="app-tile">${esc(app.short)}</span><span>${esc(app.name)}</span>`;icons.appendChild(b);});
  const task=$('taskbarApps'); task.innerHTML=''; apps.slice(0,8).forEach((app)=>{const b=document.createElement('button');b.className='task-app';b.dataset.app=app.id;b.textContent=app.name.toUpperCase();task.appendChild(b);});
}
function openApp(id) { if (!game.save.installedApps.includes(id)) { toast('That application is not installed. Open Game Store to download it.'); return; } game.activeApp=id; $('desktopWindow').classList.remove('hidden'); game.desktopWindowOpen=true; const app=getApp(id); $('windowTitle').textContent=app?.name||'Application'; $('windowSubtitle').textContent='Tide OS · Creator Edition'; $('windowAppDot').style.background=id==='stream'?'var(--coral)':'var(--teal)'; $('windowBody').innerHTML=renderApp(id); updateDesktopAppState(); beep(360); }
function updateDesktopAppState() { if (game.activeApp==='stream') { const el=$('streamViewers'); if(el) el.textContent=num(game.stream.viewers); const pv=$('streamAppStatus'); if(pv) pv.textContent=game.stream.active?'LIVE SESSION IN PROGRESS':'READY TO BROADCAST'; } if(game.activeApp==='task') renderTask(); }
function closeWindow() { $('desktopWindow').classList.add('hidden'); game.desktopWindowOpen=false; game.activeApp=null; }
function renderApp(id) {
  if (id==='browser') return `<div class="app-hero"><p class="eyebrow">ISLAND WIDE WEB</p><h3>Find your next tool.</h3><p>Browse the Tidebound network. The creator apps you need are in the Game Store catalog, not installed automatically.</p></div><div class="notice-box"><strong>Discovery note.</strong> A real creator setup grows one download at a time. Open <span class="mini-link" data-app="games">Game Store →</span> to install Stream Desk, Cutroom Editor and more.</div><div class="section-title"><h3>ISLAND FEED</h3><span>LIVE</span></div><div class="app-grid"><div class="data-row"><span>FERRY SERVICE</span><span class="muted-text">Arrivals on the beach after purchase</span></div><div class="data-row"><span>COMMUNITY BOARD</span><span class="muted-text">4 local events this week</span></div></div>`;
  if (id==='files') return renderFiles();
  if (id==='settings') return renderBasicSettings();
  if (id==='games') return renderStoreWindow('games');
  if (id==='stream') return renderStreamApp();
  if (id==='editor') return renderEditorApp();
  if (id==='analytics') return renderAnalyticsApp();
  if (id==='donations') return renderDonationsApp();
  if (id==='studio') return renderStudioApp();
  if (id==='bank') return renderBankApp();
  if (id==='messenger') return renderMessengerApp();
  if (id==='cloud') return renderCloudApp();
  if (id==='music') return renderMusicApp();
  if (id==='camera') return renderCameraApp();
  if (id==='task') return renderTask();
  if (id==='calendar') return renderCalendarApp();
  return `<div class="app-hero"><h3>${esc(getApp(id)?.name||'Application')}</h3><p>Application ready.</p></div>`;
}
function renderFiles() { const clips=game.save.clips||[], renders=game.save.renderedVideos||[]; return `<div class="app-hero"><p class="eyebrow">FILE MANAGER / HOME</p><h3>Projects that belong to you.</h3><p>Local storage is slow on your starter PC. Keep your recordings organized before the drive fills up.</p></div><div class="metric-grid"><div class="metric"><small>RAW CLIPS</small><strong>${clips.length}</strong><span>camera footage</span></div><div class="metric"><small>RENDERED</small><strong>${renders.length}</strong><span>ready to upload</span></div><div class="metric"><small>DISK USED</small><strong>${Math.min(94,14+clips.length*7)}%</strong><span>${game.save.pc.components.storage==='storage-hdd'?'160 GB HDD':'SSD storage'}</span></div></div><div class="section-title"><h3>RECENT FILES</h3><span>${clips.length+renders.length} ITEMS</span></div>${clips.concat(renders).map((x)=>`<div class="data-row"><span>${esc(x.name||'untitled clip')}</span><span class="muted-text">${esc(x.type||'recording')} · ${esc(x.quality||'raw')} quality</span></div>`).join('')||'<div class="notice-box">No footage yet. Buy a camera and use Camera Manager to record a walk around the island.</div>'}`; }
function renderBasicSettings() { return `<div class="app-hero"><p class="eyebrow">SYSTEM SETTINGS</p><h3>Weak PC diagnostics.</h3><p>Open the side panel to see the actual installed components inside your case.</p></div><div class="metric-grid"><div class="metric"><small>CPU SCORE</small><strong>${getPart('cpu',game.save.pc.components.cpu).score}</strong><span>${esc(getPart('cpu',game.save.pc.components.cpu).name)}</span></div><div class="metric"><small>GPU SCORE</small><strong>${getPart('gpu',game.save.pc.components.gpu).score}</strong><span>${esc(getPart('gpu',game.save.pc.components.gpu).name)}</span></div><div class="metric"><small>PC PERFORMANCE</small><strong>${pcScore()}</strong><span>${pcScore()<35?'ENTRY LEVEL':pcScore()<65?'MID RANGE':'CREATOR READY'}</span></div></div><div class="app-grid"><button class="button button-primary" data-action="case">OPEN CASE / UPGRADES <i>→</i></button><button class="button button-secondary" data-action="physical-store">SHOP HARDWARE <i>↗</i></button></div><div class="section-title"><h3>INSTALLED PERIPHERALS</h3><span>PHYSICAL DESK</span></div><div class="app-grid"><div class="data-row"><span>MONITOR</span><span class="muted-text">${esc(game.save.pc.monitor)}</span></div><div class="data-row"><span>MICROPHONE</span><span class="muted-text">${esc(game.save.pc.microphone)}</span></div><div class="data-row"><span>WEBCAM</span><span class="muted-text">${ownedPeripheral('webcam')[0]?.name||'none · avatar stream'}</span></div></div>`; }
function renderStoreWindow(tab='games') { game.storeTab=tab; return `<div id="storeWindowInner"><div class="tab-row inline-tabs">${storeTabs().map((t)=>`<button class="tab-button ${t.id===tab?'active':''}" data-store-tab="${t.id}">${t.label}</button>`).join('')}</div><div class="window-store-body">${renderStoreBody(tab)}</div></div>`; }
function storeTabs() { return [{id:'games',label:'GAMES / 25'},{id:'apps',label:'APPS'},{id:'gear',label:'CREATOR GEAR'},{id:'furniture',label:'FURNITURE / 1,000'},{id:'internet',label:'INTERNET'},{id:'orders',label:'ORDERS'}]; }
function renderStoreBody(tab) {
  if (tab==='apps') return `<div class="store-summary"><div><h3>Download your workflow.</h3><p>Only four basic apps came with the PC.</p></div><div class="store-balance"><small>AVAILABLE</small>${money(game.save.cash)}</div></div><div class="product-grid">${APP_DEFS.filter((a)=>a.cost>0).map((a)=>productCard(a,'app')).join('')}</div>`;
  if (tab==='games') return `<div class="store-callout"><strong>Game library.</strong> The first game is free so you can start streaming immediately. Graphics requirements are simulated against your installed PC.<span class="mini-link">${game.save.ownedGames.length}/25 owned</span></div><div class="product-grid">${GAMES.map((x)=>productCard(x,'game')).join('')}</div>`;
  if (tab==='gear') return `<div class="store-summary"><div><h3>Creator equipment.</h3><p>Webcams change your stream from avatar to face camera. Outdoor cameras unlock island stories.</p></div><div class="store-balance"><small>AVAILABLE</small>${money(game.save.cash)}</div></div><div class="product-grid">${PERIPHERALS.map((x)=>productCard(x,'gear')).join('')}</div>`;
  if (tab==='furniture') return `<div class="store-callout"><strong>Home & studio catalog / 1,000 items.</strong> Product models, prices and specifications are shown before ordering. Deliveries arrive at the beach after in-game time passes.</div><div class="product-grid">${FURNITURE.slice(0,30).map((x)=>productCard(x,'furniture')).join('')}</div>`;
  if (tab==='internet') return `<div class="store-callout"><strong>Connection is a monthly choice.</strong> Download speed, upload speed, latency and stability directly affect streams, uploads and online play. Upgrade both plan and router over time.</div><div class="product-grid">${INTERNET_PLANS.map((x)=>productCard(x,'internet')).join('')}</div>`;
  return renderOrders();
}
function productCard(item, kind) {
  const id=item.id, pending=game.save.orders.some((o)=>o.itemId===id&&o.status!=='placed'), owned=kind==='app'?game.save.installedApps.includes(id):kind==='game'?game.save.ownedGames.includes(id):kind==='gear'?game.save.ownedGear.includes(id):kind==='furniture'?game.save.furniture.includes(id):false;
  const shape=kind==='game'?'game':kind==='furniture'?'furniture':kind==='gear'?(item.kind||'gear'):'gear'; let action='ORDER', attr='data-buy'; let price=item.price ?? item.cost ?? 0;
  if(kind==='app'){action=owned?'INSTALLED':'DOWNLOAD';attr=owned?'':'data-download';price=item.cost;} else if(kind==='game'){action=owned?'OWNED':'BUY GAME';attr=owned?'':`data-buy="${esc(id)}"`;}
  else if(kind==='internet'){const current=game.save.internetPlan===id;action=current?'CURRENT':`UPGRADE · ${money(price)}`;attr=current?'':`data-buy="${esc(id)}"`;}
  else if((kind==='gear'||kind==='furniture')&&owned){action='OWNED';attr='';}
  else if(pending){action='IN TRANSIT';attr='';}
  return `<article class="product-card"><div class="product-visual"><span class="product-shape ${shape}"></span></div><div class="product-body"><span class="product-type">${esc(kind==='furniture'?item.category:kind)}</span><h4>${esc(item.name)}</h4><p>${esc(item.desc||'A Tidebound product for your creator life.')}</p><div class="product-spec">${esc(item.spec||`${item.graphics||0} graphics requirement · ${item.popularity||0} popularity`)}</div><div class="product-footer"><span class="price ${price===0?'free':''}">${price===0?'FREE':money(price)}</span><button class="product-action" ${attr} data-kind="${kind}" data-id="${esc(id)}" ${owned||pending||kind==='internet'&&game.save.internetPlan===id?'disabled':''}>${action}</button></div></div></article>`;
}
function renderOrders() { const orders=game.save.orders||[]; return `<div class="store-summary"><div><h3>Delivery manifest.</h3><p>Purchased objects travel by boat. Collect and carry each package home.</p></div><div class="store-balance"><small>IN TRANSIT</small>${orders.length}</div></div>${orders.length?orders.map((o)=>`<div class="data-row"><span>${esc(o.name)}</span><span>${o.status==='arrived'?'ARRIVED AT BEACH':o.status==='carrying'?'CARRYING HOME':'BOAT ETA'} · ${esc(o.kind)}</span></div>`).join(''):'<div class="notice-box">No deliveries scheduled. Your beach is clear.</div>'}`; }
function openExternalStore(tab='games') { game.externalStore=true; game.modal='store'; $('storeOverlay').classList.remove('hidden'); game.storeTab=tab; $('storeTabs').innerHTML=storeTabs().map((t)=>`<button class="tab-button ${t.id===tab?'active':''}" data-store-tab="${t.id}">${t.label}</button>`).join(''); $('storeContent').innerHTML=renderStoreBody(tab); }
function closeExternalStore() { game.externalStore=false; game.modal=null; $('storeOverlay').classList.add('hidden'); updatePrompt(); }

// App windows
function renderStreamApp() { const g=getGame(game.stream.gameId); const cams=ownedPeripheral('webcam'); const face=cams.sort((a,b)=>b.quality-a.quality)[0]; const isLive=game.stream.active; return `<div class="app-hero"><p class="eyebrow">STREAM DESK / BROADCAST</p><h3>${isLive?'Your channel is live.':'Ready when you are.'}</h3><p id="streamAppStatus">${isLive?'LIVE SESSION IN PROGRESS':'Select a game, check the connection, then start your first stream.'}</p></div><div class="stream-preview ${face?'face-preview':'avatar-preview'}"><div class="preview-grid"></div><div class="preview-person"><span class="preview-head"></span><span class="preview-body"></span></div><div class="preview-caption">${face?`FACE CAMERA · ${esc(face.name)} · ${face.quality}% QUALITY`:'AVATAR REPRESENTATION · BUY A WEBCAM TO SHOW YOUR FACE'}</div></div><div class="metric-grid"><div class="metric"><small>LIVE VIEWERS</small><strong id="streamViewers">${num(game.stream.viewers)}</strong><span>${isLive?'current audience':'waiting room'}</span></div><div class="metric"><small>PC LOAD</small><strong>${Math.min(100, pcScore()+8)}%</strong><span>${pcScore()<35?'low FPS risk':'stable encoding'}</span></div><div class="metric"><small>CAMERA MODE</small><strong>${face?'FACE':'AVATAR'}</strong><span>${face?esc(face.name):'buy a webcam'}</span></div><div class="metric"><small>NETWORK</small><strong>${currentPlan().ping}ms</strong><span>${currentPlan().stability}% stability</span></div></div>${isLive?`<div class="notice-box"><strong>ON AIR.</strong> ${esc(g.name)} · ${game.stream.mode} representation · viewers are reacting to your stream.<br><button class="tiny-button danger" data-stream="stop">END STREAM AND SAVE ANALYTICS</button></div>`:`<div class="form-row"><label>GAME TO STREAM</label><select class="select-control" id="streamGameSelect">${game.save.ownedGames.map((id)=>{const x=getGame(id);return `<option value="${x.id}" ${x.id===g.id?'selected':''}>${esc(x.name)} · req ${x.graphics}</option>`}).join('')}</select></div><div class="form-row"><label>FACE REPRESENTATION</label><span class="muted-text">${face?`FACE CAMERA · ${face.quality}% quality`:'EMOJI / AVATAR · no webcam owned'}</span></div><div class="form-row"><label>STREAM HEALTH</label><span class="muted-text">${pcScore()<35?'LOW FPS · recording risk':currentPlan().stability<75?'QUALITY DROPS POSSIBLE':'GOOD · stable broadcast'}</span></div><button class="button button-primary" data-stream="start">START LIVESTREAM <i>●</i></button>`}`; }
function renderEditorApp() { const clips=game.save.clips||[], renders=game.save.renderedVideos||[]; return `<div class="app-hero"><p class="eyebrow">CUTROOM EDITOR / ${pcScore()<40?'PROXY MODE':'FULL RESOLUTION'}</p><h3>Shape the rough footage.</h3><p>Rendering speed is tied to your CPU, GPU and RAM. Weak hardware makes the island wait.</p></div><div class="metric-grid"><div class="metric"><small>RAW CLIPS</small><strong>${clips.length}</strong><span>on local drive</span></div><div class="metric"><small>RENDER SPEED</small><strong>${Math.max(8,pcScore()*1.1).toFixed(0)}</strong><span>frames / minute</span></div><div class="metric"><small>PROJECTS</small><strong>${renders.length}</strong><span>ready to publish</span></div></div><div class="section-title"><h3>TIMELINE TOOLS</h3><span>CUT · TITLE · AUDIO · THUMBNAIL · TRANSITION</span></div><div class="app-grid"><div class="notice-box"><strong>Workflow.</strong> Choose clips in Camera Manager, combine them here, add a title and render a thumbnail-ready upload.</div><button class="button button-primary" data-editor="render" ${clips.length?'':'disabled'}>RENDER NEW VIDEO <i>→</i></button></div><div class="section-title"><h3>RENDER QUEUE</h3><span>${game.renderJob?'PROCESSING':'IDLE'}</span></div>${renders.map((v)=>`<div class="data-row"><span>${esc(v.name)}</span><span>${esc(v.quality)} quality · <button class="tiny-button" data-editor="upload" data-video="${esc(v.id)}">UPLOAD</button></span></div>`).join('')||'<div class="notice-box">No rendered videos yet. Record a clip outside first.</div>'}`; }
function renderAnalyticsApp() { const latest=game.save.history?.[game.save.history.length-1]; const countries=latest?.countries||COUNTRIES.map((c)=>({...c,views:0,rpm100:c.baseRpm,revenue:0})); const totalRev=latest?.revenue||0; return `<div class="app-hero"><p class="eyebrow">PULSE ANALYTICS / SIMULATION VALUES</p><h3>Your audience is becoming real.</h3><p>RPM and estimated revenue are game values dynamically shaped by country, category, advertiser demand and content quality — not real payment rates.</p></div><div class="metric-grid"><div class="metric"><small>SUBSCRIBERS</small><strong>${num(game.save.subscribers)}</strong><span>+${num(latest?.subs||0)} latest</span></div><div class="metric"><small>TOTAL VIEWS</small><strong>${num(game.save.totalViews)}</strong><span>across your channel</span></div><div class="metric"><small>WATCH TIME</small><strong>${num(game.save.watchMinutes)}m</strong><span>community attention</span></div><div class="metric"><small>EST. REVENUE</small><strong>${preciseMoney(totalRev)}</strong><span>latest content</span></div></div><div class="section-title"><h3>LAST CONTENT / COUNTRY RPM</h3><span>${latest?esc(latest.name):'NO CONTENT YET'}</span></div>${latest?countries.map((c)=>`<div class="country-row"><span>${esc(c.name)}</span><div class="bar-line"><span style="width:${clamp((c.views/(latest.views||1))*100*2.4,3,100)}%"></span></div><span>RPM ${preciseMoney(c.rpm100)} / 100 · ${preciseMoney(c.rpm100*10)} / 1,000 · ${preciseMoney(c.revenue)}</span></div>`).join(''):'<div class="notice-box">Start a stream or upload a video to see audience countries, watch time, RPM and dynamic estimates.</div>'}<div class="notice-box" style="margin-top:15px"><strong>Returning viewers ${Math.round((game.save.engagement||.04)*100)}%.</strong> Comments react to stream events and some community members will return to your next broadcast.</div>`; }
function renderDonationsApp() { return `<div class="app-hero"><p class="eyebrow">TIP JAR / COMMUNITY SUPPORT</p><h3>Small signals become a community.</h3><p>Donations are simulated creator income and arrive when your content creates a strong connection.</p></div><div class="metric-grid"><div class="metric"><small>TOTAL DONATIONS</small><strong>${money(game.save.donations)}</strong><span>all time</span></div><div class="metric"><small>THIS MONTH</small><strong>${money(game.save.donations*.65)}</strong><span>simulated</span></div><div class="metric"><small>TOP SUPPORTER</small><strong>${game.save.donations? 'MARA':'—'}</strong><span>community member</span></div></div><div class="notice-box"><strong>Tip Jar ready.</strong> Keep streaming and responding to comments. Viewers can become recurring community members.</div>`; }
function renderStudioApp() { return `<div class="app-hero"><p class="eyebrow">CREATOR STUDIO / CHANNEL</p><h3>Make the work visible.</h3><p>Your channel grows from consistent stories, not a single lucky upload.</p></div><div class="metric-grid"><div class="metric"><small>SUBSCRIBERS</small><strong>${num(game.save.subscribers)}</strong><span>followers ${num(game.save.followers)}</span></div><div class="metric"><small>VIDEOS</small><strong>${num(game.save.stats.videos)}</strong><span>published stories</span></div><div class="metric"><small>STREAMS</small><strong>${num(game.save.stats.streams)}</strong><span>live sessions</span></div><div class="metric"><small>ENGAGEMENT</small><strong>${Math.round(game.save.engagement*100)}%</strong><span>community response</span></div></div><div class="section-title"><h3>CHANNEL HEALTH</h3><span>GROWTH LOOP</span></div><div class="bar-line"><span style="width:${clamp(game.save.subscribers/10,3,100)}%"></span></div><p class="muted-text" style="margin-top:12px">Next milestone: ${Math.max(10, Math.ceil((game.save.subscribers+1)/10)*10)} subscribers. Returning viewers currently shape your engagement score.</p>`; }
function renderBankApp() { const plan=currentPlan(); return `<div class="app-hero"><p class="eyebrow">HARBOR BANK / PERSONAL</p><h3>${money(game.save.cash)} available.</h3><p>Keep a buffer for internet bills, or invest in a better PC, camera or room.</p></div><div class="metric-grid"><div class="metric"><small>CREATOR PAYOUTS</small><strong>${money(game.save.stats.moneyEarned)}</strong><span>streams + videos</span></div><div class="metric"><small>DONATIONS</small><strong>${money(game.save.donations)}</strong><span>community support</span></div><div class="metric"><small>MONTHLY INTERNET</small><strong>${money(plan.monthly)}</strong><span>${esc(plan.name)}</span></div></div><div class="section-title"><h3>RECENT TRANSACTIONS</h3><span>SIMULATED</span></div><div class="data-row"><span>STARTING BALANCE</span><span>${money(120)}</span></div><div class="data-row"><span>RECURRING BILL</span><span>${money(plan.monthly)} / month</span></div>`; }
function renderMessengerApp() { const messages=game.save.messages||[]; messages.forEach((m)=>m.unread=false); return `<div class="app-hero"><p class="eyebrow">MESSENGER / ISLAND NETWORK</p><h3>People are paying attention.</h3><p>Messages arrive from NPCs, your co-player and viewers who remember what happened on stream.</p></div>${messages.slice(-8).reverse().map((m)=>`<div class="data-row"><span><strong>${esc(m.from)}</strong><br><small class="muted-text">${esc(m.time)}</small></span><span class="muted-text" style="max-width:60%;text-align:right">${esc(m.text)}</span></div>`).join('')}`; }
function renderCloudApp() { return `<div class="app-hero"><p class="eyebrow">CLOUD LOCKER / REMOTE STORAGE</p><h3>A safer place for your footage.</h3><p>Cloud space protects projects when the old HDD fills up, but the larger tiers cost monthly.</p></div><div class="metric-grid"><div class="metric"><small>USED</small><strong>${Math.min(88,14+(game.save.clips.length*7))}%</strong><span>starter cloud</span></div><div class="metric"><small>SYNC STATUS</small><strong>READY</strong><span>last sync today</span></div></div><div class="notice-box"><strong>Upgrade in Game Store.</strong> A better SSD improves local editing; Cloud Locker is best for keeping finished recordings safe.</div>`; }
function renderMusicApp() { return `<div class="app-hero"><p class="eyebrow">SOUND LIBRARY / LICENSED IN-GAME MUSIC</p><h3>Give the island a rhythm.</h3><p>Purchase licensed in-game tracks for your videos. Music changes audience mood and content quality.</p></div><div class="app-grid">${['harbor-morning','forest-after-rain','neon-tide'].map((id,i)=>`<div class="data-row"><span>${id.replaceAll('-',' ').toUpperCase()}</span><button class="tiny-button" data-music="${id}">${game.save.music.includes(id)?'OWNED':i?'$12 BUY':'OWNED'}</button></div>`).join('')}</div>`; }
function renderCameraApp() { const cams=PERIPHERALS.filter((x)=>x.kind==='camera'&&game.save.ownedGear.includes(x.id)); return `<div class="app-hero"><p class="eyebrow">CAMERA MANAGER / FIELD KIT</p><h3>Capture what the PC cannot.</h3><p>Outdoor cameras have resolution, frame rate, lens, zoom, autofocus, stabilization, low-light, microphone, battery, storage and weight tradeoffs.</p></div><div class="section-title"><h3>CONNECTED CAMERAS</h3><span>${cams.length} DEVICES</span></div>${cams.map((c)=>`<div class="data-row"><span><strong>${esc(c.name)}</strong><br><small class="muted-text">${esc(c.spec)}<br>${esc(c.details||'lens / autofocus / stabilization / battery stats')}</small></span><span><em class="muted-text">quality ${c.quality}%</em><button class="tiny-button" data-camera="record">RECORD CLIP</button></span></div>`).join('')||'<div class="notice-box"><strong>No outdoor camera connected.</strong> Visit the General Store. You can order one and collect it at the beach after the delivery boat arrives.</div>'}${game.multiplayer?'<div class="notice-box" style="margin-top:12px"><strong>CO-PLAYER CAMERA OPERATOR.</strong> Your partner can stand behind the camera while you appear in the shot. Record each other for friend videos.</div>':''}`; }
function renderTask() { const cpu=clamp(pcScore()+ (game.stream.active?18:0),2,100), gpu=clamp(getPart('gpu',game.save.pc.components.gpu).score+(game.stream.active?12:0),2,100), ram=clamp(22+(game.save.clips.length*4)+(game.stream.active?22:0),4,100), net=clamp(100-currentPlan().ping*.55,8,100); return `<div class="app-hero"><p class="eyebrow">TASK MONITOR / LIVE TELEMETRY</p><h3>What is the weak PC doing?</h3><p>Performance is simulated from the components installed inside the case, current app load and internet quality.</p></div><div class="section-title"><h3>PERFORMANCE</h3><span>${game.stream.active?'STREAMING':'IDLE'}</span></div>${[['CPU',cpu],['GPU',gpu],['RAM',ram],['INTERNET',net]].map(([n,v])=>`<div class="form-row"><label>${n} USAGE</label><span style="width:55%"><span class="bar-line"><span style="width:${v}%"></span></span></span><strong>${Math.round(v)}%</strong></div>`).join('')}<div class="metric-grid" style="margin-top:17px"><div class="metric"><small>EST. FPS</small><strong>${Math.max(18,Math.round(pcScore()*.72))}</strong><span>${pcScore()<35?'low settings':'stable'}</span></div><div class="metric"><small>PING</small><strong>${currentPlan().ping}</strong><span>milliseconds</span></div></div>`; }
function renderCalendarApp() { const orders=game.save.orders||[]; return `<div class="app-hero"><p class="eyebrow">CALENDAR / TIDEBOUND</p><h3>Plan around the tide.</h3><p>Deliveries, village events and streams all take place in island time.</p></div><div class="section-title"><h3>UPCOMING DELIVERY</h3><span>${orders.length} ORDERS</span></div>${orders.map((o)=>`<div class="data-row"><span>${esc(o.name)}</span><span>${o.status.toUpperCase()} · ${o.status==='scheduled'?'boat in a little while':'beach pickup'}</span></div>`).join('')||'<div class="notice-box">No deliveries on the calendar.</div>'}<div class="section-title"><h3>ISLAND EVENTS</h3><span>THIS WEEK</span></div>${EVENTS.map((e)=>`<div class="data-row"><span>DAY ${e.day} · ${String(e.hour).padStart(2,'0')}:00</span><span>${esc(e.name)} · <span class="muted-text">${esc(e.desc)}</span></span></div>`).join('')}`; }

// ─────────────────────────────────────────────────────────────────────────────
// App actions: streaming, footage, analytics and purchases
// ─────────────────────────────────────────────────────────────────────────────
function startStream() { if (game.stream.active) return; const sel=$('streamGameSelect'); if (sel) game.stream.gameId=sel.value; const g=getGame(game.stream.gameId); const face=ownedPeripheral('webcam').sort((a,b)=>b.quality-a.quality)[0]; game.stream={active:true,gameId:g.id,elapsed:0,tick:0,viewers:Math.max(2,Math.round(g.viewers*(.45+pcScore()/100)*(.65+currentPlan().stability/180))),views:0,likes:0,comments:0,quality:Math.min(100,pcScore()*.6+currentPlan().stability*.4),mode:face?'FACE CAMERA':'AVATAR'}; notify(`LIVE NOW · ${g.name}`,'live'); toast(`Stream started with ${game.stream.mode.toLowerCase()}.`); updateStreamHUD(); openApp('stream'); }
function updateStream(dt) { if (!game.stream.active) return; game.stream.elapsed+=dt; game.stream.tick+=dt; if(game.stream.tick>=1){game.stream.tick=0;const g=getGame(game.stream.gameId);const condition=clamp(game.stream.quality/100,.1,1); const variation=.82+Math.random()*.36; game.stream.viewers=Math.max(1,Math.round(game.stream.viewers*(.98+condition*.02)*variation)); game.stream.views+=game.stream.viewers*(.06+.08*condition); game.stream.likes+=Math.max(0,game.stream.viewers*.016); game.stream.comments+=Math.random()<.24?1:0; if(Math.random()<.012*condition){const tip=1+Math.floor(Math.random()*8);game.save.donations+=tip;game.streamDonations=(game.streamDonations||0)+tip;notify(`TIP JAR · +${money(tip)} from a viewer`,'live');} if(game.desktopOpen&&game.activeApp==='stream') updateDesktopAppState(); updateStreamHUD(); } }
function stopStream() { if (!game.stream.active) return; const g=getGame(game.stream.gameId); const data=makeAnalytics(Math.max(12,Math.round(game.stream.views)), 'live', g.trend, game.stream.quality); const earned=Math.max(8,Math.round(data.revenue + data.views * .14 + (game.streamDonations||0))); game.save.cash+=earned; game.save.stats.moneyEarned+=earned; game.save.totalViews+=data.views; game.save.totalLikes+=data.likes; game.save.totalComments+=data.comments; game.save.subscribers+=data.subs; game.save.followers+=Math.round(data.subs*2.2); game.save.watchMinutes+=Math.round(data.views*(.7+game.stream.quality/180)); game.save.engagement=clamp(game.save.engagement*.82+data.engagement*.18,.02,.98); game.save.stats.streams++; game.save.history.push({...data,name:`${g.name} livestream`,type:'stream'}); game.save.history=game.save.history.slice(-20); game.stream={active:false,gameId:g.id,elapsed:0,tick:0,viewers:0,views:0,likes:0,comments:0,quality:0,mode:'AVATAR'}; game.streamDonations=0; persist(game.save); updateObjective(); updateHUD(); notify(`STREAM ENDED · ${data.views.toLocaleString()} views · +${money(earned)}`,'live'); toast(`Analytics ready. You earned ${money(earned)}.`); if(game.desktopOpen&&game.activeApp==='stream') openApp('analytics'); }
function updateStreamHUD() { const el=$('streamHud'); if(!el)return; el.classList.toggle('hidden',!game.stream.active); if(game.stream.active)$('streamHudInfo').textContent=`${game.stream.mode} · ${num(game.stream.viewers)} viewers · ${Math.floor(game.stream.elapsed)}s`; }
function recordClip() { const cams=PERIPHERALS.filter((x)=>x.kind==='camera'&&game.save.ownedGear.includes(x.id)); if(!cams.length){toast('You need an outdoor camera. Order one from the General Store.');return;} const cam=cams.sort((a,b)=>b.quality-a.quality)[0]; const scenes=['beach walk','forest trail','village market','house transformation','cliff viewpoint','friend challenge']; const clip={id:`clip-${Date.now()}`,name:`${pick(scenes)} / ${new Date().getHours()}h`,type:game.multiplayer?'friend vlog':'island vlog',quality:cam.quality>=80?'cinematic':cam.quality>=50?'clear':'soft',camera:cam.name}; game.save.clips.push(clip); persist(game.save); toast(`Clip recorded: ${clip.name}.`); notify('FOOTAGE CAPTURED · Open Cutroom Editor when ready.'); if(game.desktopOpen&&game.activeApp==='camera') openApp('camera'); updateObjective(); }
function renderVideo() { if(game.renderJob||!game.save.clips.length){if(!game.save.clips.length)toast('Record at least one clip first.');return;} const duration=Math.max(2,Math.round(9-(pcScore()/18))); game.renderJob={until:Date.now()+duration*1000,started:Date.now()}; toast(`Rendering started. Weak PC estimate: ${duration}s.`); if(game.activeApp==='editor')openApp('editor'); }
function updateRenderJob() { if(!game.renderJob||Date.now()<game.renderJob.until)return; const clip=game.save.clips[game.save.clips.length-1]; const video={id:`video-${Date.now()}`,name:`Island story ${game.save.stats.videos+1}`,type:'video',quality:clip.quality,clipCount:game.save.clips.length}; game.save.renderedVideos.push(video); game.renderJob=null; persist(game.save); notify('RENDER COMPLETE · Thumbnail ready to upload.','live'); toast('Video render finished.'); if(game.desktopOpen&&game.activeApp==='editor')openApp('editor'); }
function uploadVideo(id) { const video=game.save.renderedVideos.find((x)=>x.id===id)||game.save.renderedVideos[0]; if(!video)return; const data=makeAnalytics(Math.max(18,Math.round(80+(pcScore()*2)+game.save.subscribers*.4)), 'video', video.quality==='cinematic'?88:video.quality==='clear'?62:35); const earned=Math.max(12,Math.round(data.revenue + data.views * .14)); game.save.cash+=earned; game.save.stats.moneyEarned+=earned; game.save.totalViews+=data.views; game.save.totalLikes+=data.likes; game.save.totalComments+=data.comments; game.save.subscribers+=data.subs; game.save.followers+=Math.round(data.subs*2.2); game.save.watchMinutes+=Math.round(data.views*(.9+pcScore()/170)); game.save.engagement=clamp(game.save.engagement*.8+data.engagement*.2,.02,.98); game.save.stats.videos++; game.save.history.push({...data,name:video.name,type:'video'}); game.save.history=game.save.history.slice(-20); game.save.renderedVideos=game.save.renderedVideos.filter((x)=>x.id!==video.id); persist(game.save); updateObjective(); updateHUD(); notify(`VIDEO PUBLISHED · ${data.views} views in the first day`,'live'); toast(`Upload complete. Estimated game revenue ${money(earned)}.`); if(game.desktopOpen&&game.activeApp==='editor')openApp('analytics'); }
function makeAnalytics(views, category, trend = 70, quality=50) { const demand=category==='live'?1.0:1.08; let remaining=views, countries=COUNTRIES.map((c)=>{const v=Math.max(1,Math.round(views*(c.weight/100)*(0.74+Math.random()*.46)));remaining-=v;const rpm100=c.baseRpm*demand*(.7+trend/180)*(0.65+quality/250);return {...c,views:v,rpm100,revenue:(v/100)*rpm100};}); countries[0].views+=remaining; const revenue=countries.reduce((a,c)=>a+c.revenue,0); const likes=Math.round(views*(.045+quality/2600)); const comments=Math.max(1,Math.round(views*(.008+game.save.engagement*.04))); const subs=Math.max(1,Math.round(views*(.008+quality/5200)*(1+game.save.engagement))); return {views,likes,comments,subs,engagement:clamp(.08+quality/300+game.save.engagement*.38,.03,.9),revenue,countries}; }

function buyOrAction(kind,id) {
  if(kind==='app'){downloadApp(id);return;} if(kind==='game'){buyGame(id);return;} if(kind==='gear'){buyGear(id);return;} if(kind==='furniture'){buyFurniture(id);return;} if(kind==='internet'){buyInternet(id);return;}
}
function downloadApp(id) { const app=getApp(id); if(!app||game.save.installedApps.includes(id))return; if(!spend(app.cost))return;game.save.installedApps.push(id);persist(game.save);renderDesktop();toast(`${app.name} installed. Find it on your Tide OS desktop.`);notify(`APP INSTALLED · ${app.name}`);updateObjective(); if(game.externalStore){openExternalStore('apps');} else if(game.activeApp==='games')openApp('games'); }
function buyGame(id) { const g=getGame(id); if(game.save.ownedGames.includes(id))return; if(g.graphics>pcScore()+38){toast(`Your current PC cannot run ${g.name} reliably. Upgrade your GPU or CPU first.`);return;} if(!spend(g.price))return;game.save.ownedGames.push(id);persist(game.save);toast(`${g.name} added to your digital library.`);notify(`GAME PURCHASED · ${g.name}`); if(game.activeApp==='games')openApp('games'); }
function scheduleDelivery(name,kind,itemId,extra={}) { const now=game.save.day*24+game.save.dayTime; const order={id:`order-${Date.now()}-${Math.random().toString(16).slice(2)}`,name,kind,itemId,status:'scheduled',dueAt:now+.24+Math.random()*.16,...extra};game.save.orders.push(order);persist(game.save);notify(`DELIVERY SCHEDULED · ${name}`);toast(`${name} ordered. A delivery boat is on the calendar.`);updateObjective(); }
function buyGear(id) { const item=PERIPHERALS.find((x)=>x.id===id); if(!item||game.save.ownedGear.includes(id))return; if(!spend(item.price))return; scheduleDelivery(item.name,'gear',id,{spec:item.spec}); if(game.externalStore)openExternalStore('gear'); else if(game.activeApp==='games')openApp('games'); }
function buyFurniture(id) { const item=FURNITURE.find((x)=>x.id===id); if(!item||game.save.furniture.includes(id)||game.save.orders.some((o)=>o.itemId===id))return; if(!spend(item.price))return;scheduleDelivery(item.name,'furniture',id); if(game.externalStore)openExternalStore('furniture'); else if(game.activeApp==='games')openApp('games'); }
function buyInternet(id) { const plan=INTERNET_PLANS.find((x)=>x.id===id); if(!plan||plan.id===game.save.internetPlan)return; if(plan.price && !spend(plan.price))return; scheduleDelivery(plan.name,'internet',id,{spec:`${plan.speed} Mbps · ${plan.upload} Mbps up`}); if(game.externalStore)openExternalStore('internet'); else if(game.activeApp==='games')openApp('games'); }

// hardware lab
function openCase() { game.modal='case'; $('caseOverlay').classList.remove('hidden'); renderCase(); }
function closeCase() { $('caseOverlay').classList.add('hidden'); if(game.modal==='case')game.modal=null; updatePrompt(); }
function renderCase() { const slots=Object.keys(PC_PARTS); $('caseContent').innerHTML=`<div class="case-visual"><div class="case-model"><div class="case-window"><span class="case-chip cpu">CPU</span><span class="case-chip gpu">GPU</span><span class="case-chip ram">RAM</span><span class="case-chip ssd">SSD</span><span class="case-chip fan">FAN</span></div><span class="case-power">PSU</span></div><div class="case-visual-label"><span>COMPONENTS VISIBLE</span><span>POWER OFF / SIDE OPEN</span></div></div><div><p class="hardware-note">Your current parts are shown below. Each order arrives as a physical package at the beach, then installs into the open case when you carry it home.</p><div class="component-list">${slots.map((slot)=>{const current=getPart(slot,game.save.pc.components[slot]);const list=PC_PARTS[slot];const idx=list.findIndex((x)=>x.id===current.id);const next=list[idx+1];return `<div class="component-row"><span class="component-slot">${slot}</span><div><strong>${esc(current.name)}</strong><small>${esc(current.spec)} · ${current.score} performance</small></div><span class="component-score">${current.score}</span>${next?`<button class="tiny-button" data-upgrade-slot="${slot}">${money(next.price-current.price)} / ORDER NEXT</button>`:'<span class="muted-text">MAX</span>'}</div>`;}).join('')}</div><div class="section-title"><h3>DESK PERIPHERALS</h3><span>EXTERNAL</span></div><div class="app-grid"><div class="data-row"><span>MONITOR</span><span class="muted-text">${esc(game.save.pc.monitor)}</span></div><div class="data-row"><span>KEYBOARD / MOUSE</span><span class="muted-text">${esc(game.save.pc.keyboard)} / ${esc(game.save.pc.mouse)}</span></div><div class="data-row"><span>MICROPHONE</span><span class="muted-text">${esc(game.save.pc.microphone)}</span></div></div></div>`; }
function orderNextPart(slot) { const list=PC_PARTS[slot], current=getPart(slot,game.save.pc.components[slot]), idx=list.findIndex((x)=>x.id===current.id), next=list[idx+1]; if(!next)return; const price=Math.max(0,next.price-current.price);if(!spend(price))return;scheduleDelivery(next.name,'component',next.id,{slot});closeCase(); }

// ─────────────────────────────────────────────────────────────────────────────
// Settings and multiplayer
// ─────────────────────────────────────────────────────────────────────────────
function openSettings() { game.modal='settings'; $('settingsOverlay').classList.remove('hidden'); renderSettings(game.settingsTab); }
function renderSettings(tab='graphics') { game.settingsTab=tab; const content=$('settingsContent'); const s=game.save.settings; if(tab==='graphics')content.innerHTML=`<h3>Visual quality</h3><div class="setting-group"><p>QUALITY PRESET</p>${['LOW','MEDIUM','HIGH','ULTRA','EXTREME / 4K'].map((q)=>`<button class="button ${s.quality===q?'button-primary':'button-quiet'}" style="margin:0 5px 5px 0" data-quality="${q}">${q}</button>`).join('')}</div><div class="form-grid"><div class="form-row"><label>RESOLUTION</label><select class="select-control" data-setting="resolution"><option value="native">NATIVE</option><option value="4k">4K</option></select></div><div class="form-row"><label>DISPLAY</label><select class="select-control" data-setting="display"><option>FULLSCREEN</option><option>WINDOWED MODE</option></select></div><div class="form-row"><label>FOV</label><input class="range-control" data-setting="fov" type="range" min="50" max="90" value="${s.fov}"><strong>${s.fov}°</strong></div><div class="form-row"><label>FPS LIMIT</label><select class="select-control" data-setting="fps"><option>30</option><option selected>60</option><option>120</option><option>UNLIMITED</option></select></div></div><div class="setting-group"><p>RENDER FEATURES</p><div class="form-grid"><div class="form-row"><label>SHADOW QUALITY</label><span class="toggle ${s.shadows?'on':''}" data-toggle="shadows"></span></div><div class="form-row"><label>REFLECTION QUALITY</label><span class="toggle ${s.reflections?'on':''}" data-toggle="reflections"></span></div><div class="form-row"><label>AMBIENT OCCLUSION</label><span class="toggle on"></span></div><div class="form-row"><label>MOTION BLUR</label><span class="toggle ${s.motionBlur?'on':''}" data-toggle="motionBlur"></span></div><div class="form-row"><label>DEPTH OF FIELD</label><span class="toggle ${s.depthOfField?'on':''}" data-toggle="depthOfField"></span></div><div class="form-row"><label>VEGETATION QUALITY</label><span class="muted-text">HIGH</span></div></div></div>`;
  else if(tab==='audio')content.innerHTML=`<h3>Audio mix</h3><div class="form-row"><label>MASTER VOLUME</label><input class="range-control" data-setting="volume" type="range" min="0" max="100" value="${s.volume}"><strong>${s.volume}%</strong></div><div class="form-row"><label>AMBIENT OCEAN / WIND</label><input class="range-control" data-setting="ambience" type="range" min="0" max="100" value="${s.ambience}"><strong>${s.ambience}%</strong></div><div class="notice-box">Ambient water, wind, village life and UI sounds are synthesized locally for this offline-friendly prototype.</div>`;
  else if(tab==='controls')content.innerHTML=`<h3>Controls</h3><div class="app-grid">${[['WASD / ARROWS','Move'],['SHIFT','Run'],['E','Interact / pick up / sit'],['ESC','Pause / close'],['F2','Save game'],['M','Messenger / desktop']].map((x)=>`<div class="data-row"><span>${x[0]}</span><span class="muted-text">${x[1]}</span></div>`).join('')}</div><div class="notice-box" style="margin-top:15px">In 2-player rooms the second creator can operate the camera and appear in friend vlogs. Open Camera Manager after buying a camera.</div>`;
  else if(tab==='network')content.innerHTML=`<h3>Network settings</h3><div class="form-row"><label>ONLINE MODE</label><select class="select-control" data-setting="networkMode"><option value="online">ONLINE</option><option value="offline">OFFLINE / SINGLE PLAYER</option></select></div><div class="notice-box"><strong>Room status.</strong> ${game.multiplayer?'Shared island active · '+(game.save.room?.code||'LOCAL ROOM'):'Single player island · no connection required.'}</div><button class="button button-secondary" data-menu="multi" style="margin-top:15px">MULTIPLAYER ROOM <i>↗</i></button>`;
  else content.innerHTML=`<h3>Language</h3><div class="form-row"><label>TEXT LANGUAGE</label><select class="select-control" data-setting="language"><option>English</option><option>Français</option><option>العربية</option><option>Español</option></select></div><div class="notice-box">Creator Life currently ships with English simulation text. Additional language packs are planned.</div>`;
  document.querySelectorAll('[data-settings-tab]').forEach((b)=>b.classList.toggle('active',b.dataset.settingsTab===tab));
}
function openMultiplayer() { game.modal='multi'; $('multiOverlay').classList.remove('hidden'); }
function hostRoom() { const code=Math.random().toString(36).slice(2,8).toUpperCase(); game.save.room={code,role:'host'}; persist(game.save); $('hostCode').textContent=code; $('hostCode').classList.remove('hidden'); toast(`Room ${code} is ready. Starting shared island…`); setTimeout(()=>{ $('multiOverlay').classList.add('hidden'); startStory(true,false,false); },700); }
function joinRoom() { const code=($('roomCodeInput').value||'').trim().toUpperCase(); if(code.length<4){toast('Enter the room code from your friend.');return;}game.save.room={code,role:'guest'};persist(game.save);$('multiOverlay').classList.add('hidden');startStory(true,false,false); }
function setupNetwork() { try { if(game.channel)game.channel.close();game.channel=new BroadcastChannel(`creator-life-${game.save.room.code||'local'}`);game.channel.onmessage=(e)=>{if(e.data?.type==='position'&&game.partnerTarget){game.partnerTarget.set(e.data.x,0,e.data.z);}}; }catch(_){game.channel=null;} }
function updateNetwork(dt) { if(!game.multiplayer||!game.channel)return; game.networkTick+=dt;if(game.networkTick>.12){game.networkTick=0;game.channel.postMessage({type:'position',x:game.player.position.x,z:game.player.position.z});} }

// ─────────────────────────────────────────────────────────────────────────────
// Global interaction wiring
// ─────────────────────────────────────────────────────────────────────────────
function handleClick(event) {
  const menu=event.target.closest('[data-menu]'); if(menu){beep(420);const action=menu.dataset.menu;if(action==='single')startStory(false,false,false);else if(action==='multi')openMultiplayer();else if(action==='new')startStory(false,true,false);else if(action==='continue'||action==='load')startStory(false,false,true);else if(action==='settings')openSettings();return;}
  const action=event.target.closest('[data-action]'); if(action){beep(410);const a=action.dataset.action;if(a==='desktop')openDesktop();else if(a==='save')saveGame();else if(a==='pause')togglePause();else if(a==='resume')closePause();else if(a==='menu'){closePause();showMainMenu();}else if(a==='exit'){toast('The island autosaves locally. You can close this tab now.');}else if(a==='close-desktop')closeDesktop();else if(a==='close-modal'){closeAllModals();}else if(a==='case')openCase();else if(a==='physical-store'){closeWindow();openExternalStore('gear');}else if(a==='multi')openMultiplayer();return;}
  const app=event.target.closest('[data-app]'); if(app){openApp(app.dataset.app);return;}
  const tab=event.target.closest('[data-store-tab]'); if(tab){game.storeTab=tab.dataset.storeTab;if(game.externalStore)openExternalStore(game.storeTab);else if(game.activeApp==='games')openApp('games');return;}
  const buy=event.target.closest('[data-buy]'); if(buy){buyOrAction(buy.dataset.kind,buy.dataset.id);return;}
  const download=event.target.closest('[data-download]'); if(download){downloadApp(download.dataset.id);return;}
  const upgrade=event.target.closest('[data-upgrade-slot]'); if(upgrade){orderNextPart(upgrade.dataset.upgradeSlot);return;}
  const stream=event.target.closest('[data-stream]'); if(stream){stream.dataset.stream==='start'?startStream():stopStream();return;}
  const editor=event.target.closest('[data-editor]'); if(editor){editor.dataset.editor==='render'?renderVideo():uploadVideo(editor.dataset.video);return;}
  const cam=event.target.closest('[data-camera]'); if(cam){recordClip();return;}
  const music=event.target.closest('[data-music]'); if(music){if(!game.save.music.includes(music.dataset.music)){if(spend(12)){game.save.music.push(music.dataset.music);persist(game.save);toast('Licensed track added to Sound Library.');}}else toast('This track is already in your library.');if(game.activeApp==='music')openApp('music');return;}
  const multi=event.target.closest('[data-multi]'); if(multi){multi.dataset.multi==='host'?hostRoom():joinRoom();return;}
  const qual=event.target.closest('[data-quality]'); if(qual){game.save.settings.quality=qual.dataset.quality;persist(game.save);renderSettings('graphics');toast(`Graphics preset set to ${qual.dataset.quality}.`);return;}
  const st=event.target.closest('[data-settings-tab]'); if(st){renderSettings(st.dataset.settingsTab);return;}
  const toggle=event.target.closest('[data-toggle]'); if(toggle){const k=toggle.dataset.toggle;game.save.settings[k]=!game.save.settings[k];persist(game.save);renderSettings(game.settingsTab);return;}
}
function handleChange(event) { const el=event.target; if(el.dataset.setting){const k=el.dataset.setting; if(k==='fov')game.save.settings.fov=Number(el.value);else if(k==='volume'||k==='ambience')game.save.settings[k]=Number(el.value);else if(k==='networkMode'||k==='language'||k==='resolution')game.save.settings[k]=el.value;else if(k==='display')game.save.settings.fullscreen=el.value==='FULLSCREEN';persist(game.save);if(k==='fov'&&game.camera){game.camera.fov=game.save.settings.fov;game.camera.updateProjectionMatrix();}if(game.modal==='settings')renderSettings(game.settingsTab);} if(el.id==='streamGameSelect'&&game.activeApp==='stream')game.stream.gameId=el.value; }
function closeAllModals() { closeExternalStore(); closeCase(); $('settingsOverlay').classList.add('hidden');$('multiOverlay').classList.add('hidden');if(game.modal==='settings'||game.modal==='multi')game.modal=null;updatePrompt(); }
function togglePause() { if(game.mode!=='world'||game.desktopOpen)return;game.modal='pause';$('pauseOverlay').classList.remove('hidden'); }
function closePause() { game.modal=null;$('pauseOverlay').classList.add('hidden'); }

// Keyboard
addEventListener('keydown',(e)=>{game.keys[e.code]=true;if(e.code==='KeyE'&&!e.repeat)interact();if(e.code==='Escape'){if(game.mode==='intro'){skipIntro();return;}if(game.desktopOpen){closeDesktop();return;}if(game.modal==='pause'){closePause();return;}if(game.externalStore||game.modal==='case'||game.modal==='settings'||game.modal==='multi'){closeAllModals();return;}if(game.mode==='world')togglePause();}if(e.code==='F2')saveGame();if(e.code==='Space'&&game.mode==='intro')skipIntro();if(e.code==='KeyM'&&!e.repeat&&game.mode==='world')openDesktop('messenger');});
addEventListener('keyup',(e)=>{game.keys[e.code]=false;});
addEventListener('click',()=>primeAudio(),{once:false});
document.addEventListener('click',handleClick); document.addEventListener('change',handleChange);
$('skipIntro').addEventListener('click',skipIntro);
$('desktopOverlay').addEventListener('dblclick',(e)=>{const icon=e.target.closest('[data-app]');if(icon)openApp(icon.dataset.app);});
$('desktopOverlay').addEventListener('click',(e)=>{const wc=e.target.closest('[data-window]');if(wc){wc.dataset.window==='close'?closeWindow():$('desktopWindow').classList.add('hidden');}});

function updateDesktopIfNeeded() { if(game.desktopOpen&&game.activeApp){ if(game.activeApp==='task')renderTask(); if(game.activeApp==='calendar')openApp('calendar'); } }

// Renderer loop and boot.
function init() {
  game.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }); game.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.8)); game.renderer.setSize(innerWidth,innerHeight); game.renderer.shadowMap.enabled=game.save.settings.shadows; game.renderer.shadowMap.type=THREE.PCFSoftShadowMap; game.renderer.toneMapping=THREE.ACESFilmicToneMapping; game.renderer.toneMappingExposure=1.1; $('app').appendChild(game.renderer.domElement);
  buildWorld();
  addEventListener('resize',()=>{game.renderer.setSize(innerWidth,innerHeight);game.camera.aspect=innerWidth/innerHeight;game.camera.updateProjectionMatrix();});
  setTimeout(()=>{ $('boot').classList.add('done'); setTimeout(()=>showMainMenu(),650); },850);
  game.renderer.setAnimationLoop(()=>{const dt=Math.min(game.clock.getDelta(),.08);if(game.mode==='menu')updateMenuCamera(dt);else if(game.mode==='intro')updateIntro(dt);else if(game.mode==='world'){updateLivingWorld(dt);updateWorldCamera(dt);}game.renderer.render(game.scene,game.camera);});
}

init();
