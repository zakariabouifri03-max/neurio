/*
  BORROWED LIGHT — a self-contained, original first-person night story.
  Everything in this file is procedural: scene, low-fi materials, sound cues,
  interaction, phone, enemy behaviour, checkpoints and narrative progression.
*/
import * as THREE from 'three';

// ─────────────────────────────────────────────────────────────────────────────
// DOM / state
// ─────────────────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const ui = {
  menu: $('menu'), play: $('playBtn'), continue: $('continueBtn'), settings: $('settings'),
  credits: $('credits'), hud: $('hud'), chapter: $('chapter'), objective: $('objective'),
  prompt: $('prompt'), notification: $('notification'), subtitle: $('subtitle'), save: $('saveMark'),
  inventory: $('inventory'), phone: $('phone'), phoneApp: $('phoneApp'), phoneHome: $('phoneHome'),
  phoneBadge: $('phoneBadge'), messageCount: $('messageCount'), pause: $('pause'), ending: $('ending'),
  endingTitle: $('endingTitle'), endingText: $('endingText'), endingKicker: $('endingKicker'),
  grain: $('grain'), vignette: $('vignette'), flash: $('flash'), breath: $('breath'),
  hint: $('controlsHint'), quality: $('qualitySelect'), grainToggle: $('grainToggle'),
  motionToggle: $('motionToggle'), vignetteToggle: $('vignetteToggle'),
};

const SAVE_KEY = 'borrowed-light-checkpoint-v1';
let playing = false;
let paused = false;
let phoneOpen = false;
let stage = 0;
let startedOnce = false;
let currentObjective = '';
let hasEvidence = false;
let groceries = 0;
let hiding = false;
let hideUntil = 0;
let pendingTimers = [];
const inventory = new Set();
const keys = Object.create(null);
const interactables = [];
const doors = {};
const items = {};
const lights = [];
const wallColliders = [];
const propColliders = [];
let activeInteraction = null;
let lastPrompt = '';
let lastFootstep = 0;
let messageUnread = 1;
let flashlightOn = false;
let panic = 0;

const saved = (() => { try { return JSON.parse(localStorage.getItem(SAVE_KEY)); } catch { return null; } })();
if (saved?.stage > 0 && saved.stage < 13) ui.continue.hidden = false;

// ─────────────────────────────────────────────────────────────────────────────
// Renderer / camera / scene
// ─────────────────────────────────────────────────────────────────────────────
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.82;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x080b11);
scene.fog = new THREE.FogExp2(0x0b1017, 0.021);
const clock = new THREE.Clock();

const yaw = new THREE.Object3D();
const pitch = new THREE.Object3D();
const camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 0.05, 90);
camera.position.set(0, 1.64, 0);
yaw.add(pitch); pitch.add(camera); scene.add(yaw);
yaw.position.set(-4.9, 0, 15.2);

const flashlight = new THREE.SpotLight(0xe6e0cb, 0, 16, Math.PI / 7, 0.7, 1.4);
flashlight.position.set(0.12, -0.02, 0.05);
flashlight.target.position.set(0, -0.1, -7);
camera.add(flashlight); camera.add(flashlight.target);

const raycaster = new THREE.Raycaster();
raycaster.far = 3.1;
const center = new THREE.Vector2(0, 0);

const ambient = new THREE.HemisphereLight(0x5a6a88, 0x17110e, 0.43); scene.add(ambient);
const moon = new THREE.DirectionalLight(0x9daecb, 0.42); moon.position.set(-13, 18, 5); moon.castShadow = true;
moon.shadow.mapSize.set(1024, 1024); moon.shadow.camera.left = -24; moon.shadow.camera.right = 24;
moon.shadow.camera.top = 24; moon.shadow.camera.bottom = -24; scene.add(moon);

const world = new THREE.Group(); scene.add(world);
const actors = new THREE.Group(); scene.add(actors);

// ─────────────────────────────────────────────────────────────────────────────
// Audio: intentionally quiet generated physical cues, no external media files.
// ─────────────────────────────────────────────────────────────────────────────
let audioCtx = null;
let ambienceGain = null;
function ensureAudio() {
  if (audioCtx) { if (audioCtx.state === 'suspended') audioCtx.resume(); return; }
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const noiseBuffer = audioCtx.createBuffer(1, audioCtx.sampleRate * 2, audioCtx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length * .3);
  const wind = audioCtx.createBufferSource(); wind.buffer = noiseBuffer; wind.loop = true;
  const windFilter = audioCtx.createBiquadFilter(); windFilter.type = 'lowpass'; windFilter.frequency.value = 500;
  ambienceGain = audioCtx.createGain(); ambienceGain.gain.value = 0.028;
  wind.connect(windFilter).connect(ambienceGain).connect(audioCtx.destination); wind.start();
  const hum = audioCtx.createOscillator(); hum.type = 'sine'; hum.frequency.value = 53;
  const humGain = audioCtx.createGain(); humGain.gain.value = 0.012;
  hum.connect(humGain).connect(audioCtx.destination); hum.start();
}
function sound(type = 'click', volume = .08, pan = 0) {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  const gain = audioCtx.createGain();
  const panner = audioCtx.createStereoPanner ? audioCtx.createStereoPanner() : null;
  if (panner) panner.pan.value = THREE.MathUtils.clamp(pan, -1, 1);
  gain.connect(panner || audioCtx.destination); if (panner) panner.connect(audioCtx.destination);
  const end = (v, t = .12) => { gain.gain.setValueAtTime(v, now); gain.gain.exponentialRampToValueAtTime(.0001, now + t); };
  if (type === 'door') {
    const o = audioCtx.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(85, now); o.frequency.exponentialRampToValueAtTime(48, now + .48); o.connect(gain); end(volume, .5); o.start(now); o.stop(now + .52);
  } else if (type === 'step' || type === 'thud') {
    const b = audioCtx.createBuffer(1, Math.floor(audioCtx.sampleRate * .11), audioCtx.sampleRate); const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
    const s = audioCtx.createBufferSource(); s.buffer = b; const f = audioCtx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = type === 'step' ? 220 : 110;
    s.connect(f).connect(gain); end(volume, .16); s.start();
  } else if (type === 'ring') {
    [0, .22].forEach((delay) => { const o = audioCtx.createOscillator(); o.type = 'sine'; o.frequency.value = 820; const g = audioCtx.createGain(); o.connect(g).connect(panner || audioCtx.destination); g.gain.setValueAtTime(.0001, now + delay); g.gain.exponentialRampToValueAtTime(volume, now + delay + .02); g.gain.exponentialRampToValueAtTime(.0001, now + delay + .15); o.start(now + delay); o.stop(now + delay + .18); });
  } else if (type === 'sting') {
    const o = audioCtx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(112, now); o.frequency.exponentialRampToValueAtTime(35, now + .65); o.connect(gain); end(volume, .68); o.start(); o.stop(now + .7);
  } else if (type === 'static') {
    const b = audioCtx.createBuffer(1, Math.floor(audioCtx.sampleRate * .42), audioCtx.sampleRate); const d = b.getChannelData(0); for(let i=0;i<d.length;i++) d[i]=Math.random()*2-1;
    const s = audioCtx.createBufferSource(); s.buffer=b; const f=audioCtx.createBiquadFilter();f.type='bandpass';f.frequency.value=1100;s.connect(f).connect(gain);end(volume,.4);s.start();
  } else {
    const o = audioCtx.createOscillator(); o.type = 'square'; o.frequency.value = type === 'pickup' ? 660 : 280; o.connect(gain); end(volume, .1); o.start(); o.stop(now + .12);
  }
}
function spatialSound(kind, position, volume = .1) {
  const local = position.clone().sub(camera.getWorldPosition(new THREE.Vector3()));
  const distance = Math.max(1, local.length());
  local.applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()).invert());
  sound(kind, volume / Math.max(1, distance * .35), local.x / distance);
}

// ─────────────────────────────────────────────────────────────────────────────
// Materials and geometry helpers
// ─────────────────────────────────────────────────────────────────────────────
const mat = {
  wall: new THREE.MeshStandardMaterial({ color: 0x6c655a, roughness: .94 }),
  wallDark: new THREE.MeshStandardMaterial({ color: 0x363832, roughness: .96 }),
  floor: new THREE.MeshStandardMaterial({ color: 0x3e3026, roughness: .9 }),
  tile: new THREE.MeshStandardMaterial({ color: 0x747168, roughness: .88 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x4c3424, roughness: .78 }),
  woodLight: new THREE.MeshStandardMaterial({ color: 0x75523a, roughness: .7 }),
  metal: new THREE.MeshStandardMaterial({ color: 0x4a4b48, roughness: .45, metalness: .55 }),
  cream: new THREE.MeshStandardMaterial({ color: 0xaaa18d, roughness: .92 }),
  fabric: new THREE.MeshStandardMaterial({ color: 0x4b5050, roughness: .97 }),
  paper: new THREE.MeshStandardMaterial({ color: 0xc4bda8, roughness: 1 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x171817, roughness: .8 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x708494, roughness: .1, metalness: .25, transparent: true, opacity: .3 }),
  brass: new THREE.MeshStandardMaterial({ color: 0xa67d43, roughness: .38, metalness: .65 }),
  green: new THREE.MeshStandardMaterial({ color: 0x5b6b55, roughness: .85 }),
};
function box(name, x, y, z, sx, sy, sz, material, parent = world, shadow = true) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), material);
  mesh.name = name; mesh.position.set(x, y, z); mesh.castShadow = shadow; mesh.receiveShadow = true; parent.add(mesh); return mesh;
}
function cylinder(name, x, y, z, r, h, material, parent = world) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.04, h, 10), material);
  mesh.name = name; mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
}
function addCollider(x1, x2, z1, z2) { wallColliders.push({ x1, x2, z1, z2 }); }
function addPropCollider(x1, x2, z1, z2) { propColliders.push({ x1, x2, z1, z2 }); }
function wall(x, z, sx, sz, material = mat.wall) {
  box('wall', x, 2.35, z, sx, 4.7, sz, material); addCollider(x - sx / 2, x + sx / 2, z - sz / 2, z + sz / 2);
}
function ceiling(x, z, sx, sz) { box('ceiling', x, 4.75, z, sx, .12, sz, mat.wallDark, world, false); }
function lamp(x, y, z, color = 0xffd6a1, intensity = 1.1, range = 8, on = true) {
  const fixture = cylinder('lamp', x, y + .17, z, .14, .24, mat.brass); fixture.rotation.x = Math.PI / 2;
  const light = new THREE.PointLight(color, on ? intensity : 0, range, 2); light.position.set(x, y, z); light.castShadow = true; light.shadow.mapSize.set(256, 256); scene.add(light);
  lights.push({ light, on, base: intensity, fixture }); return light;
}
function register(mesh, data) { mesh.userData.interaction = data; interactables.push(mesh); return mesh; }
function prop(x, y, z, sx, sy, sz, material, name = 'prop') { return box(name, x, y, z, sx, sy, sz, material); }

// A restrained first-person body: sleeves, hands and a small torch only; no third-person avatar.
const handRig = new THREE.Group();
function buildHands() {
  handRig.position.set(.34, -.51, -.72); handRig.rotation.set(-.18, -.35, -.05); camera.add(handRig);
  const sleeve = new THREE.Mesh(new THREE.BoxGeometry(.18, .47, .18), new THREE.MeshStandardMaterial({ color: 0x36434b, roughness: .96 }));
  sleeve.position.set(.08, -.02, .1); sleeve.rotation.z = -.32; handRig.add(sleeve);
  const hand = new THREE.Mesh(new THREE.SphereGeometry(.13, 9, 8), new THREE.MeshStandardMaterial({ color: 0xb38368, roughness: 1 })); hand.scale.set(.8, 1.12, .78); hand.position.set(-.01, -.29, -.02); handRig.add(hand);
  const torchBody = new THREE.Mesh(new THREE.CylinderGeometry(.07,.09,.44,9), mat.metal); torchBody.rotation.x = Math.PI/2; torchBody.position.set(-.01,-.42,-.2); handRig.add(torchBody);
  const torchRim = new THREE.Mesh(new THREE.CylinderGeometry(.105,.09,.07,9), mat.brass); torchRim.rotation.x=Math.PI/2;torchRim.position.set(-.01,-.42,-.43);handRig.add(torchRim);
}
function addTextLabel(text, x, y, z, rotY = 0) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const ctx = c.getContext('2d'); ctx.fillStyle = '#b4ab95'; ctx.font = 'bold 29px monospace'; ctx.textAlign = 'center'; ctx.fillText(text, 128, 72);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(1.35, .67), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: .76 }));
  plane.position.set(x, y, z); plane.rotation.y = rotY; world.add(plane); return plane;
}

// ─────────────────────────────────────────────────────────────────────────────
// World: a small, lived-in Alder Row bungalow and garage.
// ─────────────────────────────────────────────────────────────────────────────
function buildWorld() {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.MeshStandardMaterial({ color: 0x151a18, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; world.add(ground);
  const drive = box('wet driveway', 5, .012, 14, 27, .03, 12, new THREE.MeshStandardMaterial({ color: 0x292b2b, roughness: .54 }), world, false);
  const path = box('front path', -5, .035, 13.8, 2.1, .035, 7, new THREE.MeshStandardMaterial({ color: 0x706e65, roughness: .9 }), world, false);

  // Floors and low ceiling rooms
  box('main floor', 0, -.08, 0, 20, .16, 20, mat.floor, world, false);
  box('garage floor', 15, -.08, 6.5, 10, .16, 7, mat.tile, world, false);
  ceiling(-5, 5, 10, 10); ceiling(5, 5, 10, 10); ceiling(-5, -5, 10, 10); ceiling(5, -5, 10, 10); ceiling(15, 6.5, 10, 7);

  // Exterior shell. Openings are intentionally framed as real doors.
  wall(-8.1, 10, 3.8, .28); wall(3.05, 10, 13.9, .28); // front / door at -5
  wall(0, -10, 20, .28); wall(-10, 0, .28, 20); wall(10, -4, .28, 12.1);
  wall(10, 1.8, .28, 1.5); wall(10, 9.0, .28, 2.0); // kitchen / garage interior door opening at z 5.5
  wall(15, 3, 10, .28); wall(20, 6.5, .28, 7); // rolling shutter supplies the garage's front wall

  // Interior separation: living / kitchen; sleeping wing.
  wall(0, 1.7, .25, 3.4); wall(0, 7.8, .25, 4.4); // kitchen opening at z around 4.7
  wall(-8.0, 0, 4.0, .24); wall(-1.8, 0, 3.6, .24); // bedroom door at -5
  wall(3.0, -5.4, .22, 9.2); // study corner divider, doorway near back
  wall(6.5, -1.2, 7, .22); // utility/study separation

  // doors
  doors.front = createDoor('front', -6.05, 10, 2.15, 'z', { locked: true, label: 'Front door', hinge: 1 });
  doors.bedroom = createDoor('bedroom', -6.05, 0, 2.0, 'z', { label: 'Bedroom door', hinge: -1 });
  doors.garage = createDoor('garage', 10, 5.55, 2.0, 'x', { locked: true, label: 'Garage utility door', hinge: -1 });
  doors.study = createDoor('study', 3, -9.45, 2.05, 'x', { locked: true, label: 'Study door', hinge: 1 });
  doors.closet = createDoor('closet', -8.4, -7.4, 1.7, 'z', { label: 'Wardrobe', hinge: 1, closet: true });

  // windows: windows are simple icy planes with sill detail and a view into darkness.
  makeWindow(-7.8, 2.6, 10.13, 0); makeWindow(4.2, 2.5, 10.13, 0); makeWindow(-9.86, 2.5, 5.5, Math.PI / 2);
  makeWindow(10.13, 2.45, 8.1, Math.PI);

  // lights (must look like household lights rather than horror color sources)
  lamp(-5.1, 4.32, 5.0, 0xffd3a0, 1.25, 8); lamp(5.1, 4.32, 5.5, 0xffd3a0, 1.1, 8);
  lamp(-5.0, 4.32, -5.0, 0xffd1a4, .85, 6); lamp(6.6, 4.32, -5.0, 0xffd2a0, .72, 6);
  lamp(15.0, 4.3, 6.5, 0xd6e1e6, .62, 9); lamp(-5.2, 2.2, 3.1, 0xffb768, .62, 4);

  buildLiving(); buildKitchen(); buildBedroom(); buildStudyAndUtility(); buildGarage(); buildOutside();
  buildRain();
}
function makeWindow(x, y, z, rotY) {
  const group = new THREE.Group(); group.position.set(x, y, z); group.rotation.y = rotY; world.add(group);
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.55), mat.glass); pane.position.z = .01; group.add(pane);
  group.add(new THREE.Mesh(new THREE.BoxGeometry(2.75, .08, .08), mat.wood));
  const cross = new THREE.Mesh(new THREE.BoxGeometry(.07, 1.6, .08), mat.wood); group.add(cross);
  const lower = new THREE.Mesh(new THREE.BoxGeometry(2.75, .08, .08), mat.wood); lower.position.y = -1.55 / 2; group.add(lower);
  const upper = new THREE.Mesh(new THREE.BoxGeometry(2.75, .08, .08), mat.wood); upper.position.y = 1.55 / 2; group.add(upper);
}
function createDoor(id, x, z, width, axis, options = {}) {
  const pivot = new THREE.Group(); pivot.position.set(x, 0, z); world.add(pivot);
  const leaf = new THREE.Mesh(new THREE.BoxGeometry(axis === 'z' ? width : .15, 4.05, axis === 'z' ? .15 : width), mat.wood);
  if (axis === 'z') leaf.position.x = (width / 2) * (options.hinge || 1); else leaf.position.z = (width / 2) * (options.hinge || 1);
  leaf.position.y = 2.02; leaf.castShadow = true; leaf.receiveShadow = true; pivot.add(leaf);
  const handle = new THREE.Mesh(new THREE.SphereGeometry(.07, 7, 7), mat.brass);
  if (axis === 'z') handle.position.set((width * .82) * (options.hinge || 1), 2.08, -.105); else handle.position.set(.105, 2.08, (width * .82) * (options.hinge || 1));
  pivot.add(handle);
  const door = { id, pivot, leaf, axis, closed: 0, target: 0, locked: !!options.locked, label: options.label || 'Door', closet: !!options.closet, hinge: options.hinge || 1 };
  register(leaf, { type: 'door', door }); register(handle, { type: 'door', door }); return door;
}
function buildLiving() {
  // Sofa, table, television, books and intentional domestic clutter.
  prop(-6.7, .55, 5.0, 3.4, .75, 1.05, mat.fabric, 'sofa'); addPropCollider(-8.45, -4.95, 4.35, 5.65);
  prop(-5.8, .36, 3.2, 1.4, .48, .8, mat.woodLight, 'coffee table'); addPropCollider(-6.55, -5.05, 2.65, 3.75);
  prop(-1.2, .78, 7.4, 1.75, 1.3, .5, mat.dark, 'television'); prop(-1.2, .2, 7.4, 2.0, .35, .7, mat.wood, 'tv stand');
  const tvScreen = box('TV static screen', -1.2, .88, 7.12, 1.46, .86, .025, new THREE.MeshBasicMaterial({ color: 0x314044 }), world, false);
  register(tvScreen, { type: 'tv' }); items.tvScreen = tvScreen;
  prop(-8.9, .62, 8.4, 1.3, 1.2, .5, mat.wood, 'bookcase');
  for (let i = 0; i < 9; i++) prop(-9.35 + (i % 3) * .2, .48 + Math.floor(i / 3) * .34, 8.08, .12, .28, .32, i % 2 ? mat.paper : mat.green, 'book');
  prop(-4.6, .35, 8.25, 1.4, .68, .55, mat.woodLight, 'entry table');
  const bowl = cylinder('key bowl', -4.6, .73, 8.25, .22, .06, mat.brass); register(bowl, { type: 'carKeys' }); items.keyBowl = bowl;
  prop(-2.3, .5, 4.4, .42, .95, .42, mat.cream, 'standing lamp');
  const photo = box('framed photograph', -8.85, 2.2, 9.84, 1.05, .74, .04, mat.paper); register(photo, { type: 'photo' }); items.photo = photo;
  addTextLabel('M + A', -8.82, 2.2, 9.79, 0);
  // Plant and unpacked bag by entrance
  cylinder('plant pot', -8.9, .25, 1.4, .27, .5, mat.wood); const leaves = new THREE.Mesh(new THREE.ConeGeometry(.52, 1.2, 5), mat.green); leaves.position.set(-8.9, 1.0, 1.4); world.add(leaves);
  prop(-3.4, .25, 8.5, 1.1, .5, .55, mat.fabric, 'grocery bag');
  for (let i = 0; i < 3; i++) {
    const can = cylinder('grocery', -3.75 + i * .32, .52, 8.44, .12, .32, i === 1 ? mat.paper : mat.green);
    register(can, { type: 'grocery', index: i }); items[`grocery${i}`] = can;
  }
}
function buildKitchen() {
  // Counter run, stove, fridge, a working drawer and several lived-in details.
  prop(7.75, .48, 8.3, 3.9, .9, 1.1, mat.cream, 'kitchen counter'); prop(9.15, .92, 8.3, .14, .08, .4, mat.metal, 'sink');
  prop(1.3, .48, 8.3, 2.05, .9, 1.1, mat.cream, 'counter');
  prop(1.2, 1.0, 8.25, .82, .06, .78, mat.dark, 'stove');
  const kettle = cylinder('kettle', 1.2, 1.16, 8.25, .19, .3, mat.metal); register(kettle, { type: 'kettle' }); items.kettle = kettle;
  prop(8.7, 1.1, 2.0, 1.65, 2.1, 1.2, mat.cream, 'old refrigerator');
  prop(4.1, .4, 5.2, 1.6, .73, 1.0, mat.woodLight, 'kitchen table'); addPropCollider(3.3,4.9,4.7,5.7);
  for (let i=0;i<4;i++) prop(3.1+(i%2)*2, .3, 4.25+Math.floor(i/2)*1.85, .45,.6,.45,mat.wood,'chair');
  // drawer (moves horizontally) and blue utility key inside
  const drawer = prop(6.4, .66, 7.7, .85, .35, .12, mat.woodLight, 'cereal drawer');
  register(drawer, { type: 'drawer', id: 'cereal' }); items.drawer = drawer;
  const cereal = prop(6.4,.97,7.85,.46,.42,.26,mat.paper,'cereal box');
  const utility = new THREE.Mesh(new THREE.TorusGeometry(.12,.035,6,10), new THREE.MeshStandardMaterial({color:0x466d9d,roughness:.4,metalness:.5})); utility.position.set(6.4,.9,7.45); utility.rotation.x=Math.PI/2; utility.visible=false; world.add(utility); register(utility,{type:'utilityKey'}); items.utilityKey=utility;
  for(let i=0;i<4;i++) cylinder('cup',4.7+i*.25,.83,5.1,.1,.17,i%2?mat.paper:mat.green);
  const note = box('Asha note', 2.65, .89, 5.22, .45, .02, .32, mat.paper); register(note,{type:'note'}); items.note=note;
  addTextLabel('ASH A', 8.6, 3.1, 1.38, Math.PI);
}
function buildBedroom() {
  prop(-5.7, .34, -5.0, 3.25, .55, 5.1, mat.cream, 'bed'); prop(-5.7, .68, -6.7, 3.15, .2, 1.65, mat.fabric, 'blanket');
  prop(-1.25, .53, -7.6, 1.4, 1.05, .65, mat.woodLight, 'dresser'); addPropCollider(-1.95,-.55,-7.95,-7.25);
  const recorder = box('voice recorder', -1.25, 1.13, -7.6, .43, .07, .24, mat.dark); register(recorder,{type:'recorder'}); items.recorder=recorder;
  prop(-8.8,.9,-7.4,1.1,1.8,.6,mat.wood,'wardrobe');
  const closetInside = box('closet shadow', -8.4, 1.4, -7.1, 1.5, 2.7, .12, new THREE.MeshBasicMaterial({color:0x070707}), world, false); register(closetInside,{type:'hide'}); items.closetInside=closetInside;
  prop(-8.6,.18,-1.3,1.2,.35,.5,mat.woodLight,'laundry basket');
  for(let i=0;i<5;i++) prop(-8.9+i*.18,.48,-1.3,.18,.18,.25,i%2?mat.fabric:mat.green,'clothes');
  const side = prop(-8.1,.42,-8.8,.7,.65,.5,mat.wood,'bedside table'); const drawer = prop(-8.1,.67,-9.06,.5,.26,.08,mat.woodLight,'bedside drawer'); register(drawer,{type:'drawer',id:'bedside'});
}
function buildStudyAndUtility() {
  // Study has been used as a temporary office, utility corridor carries the old circuit.
  prop(5.1,.48,-6.9,2.6,.9,1.0,mat.wood,'desk'); addPropCollider(3.8,6.4,-7.4,-6.4);
  prop(5.1,1.18,-6.8,1.4,.9,.2,mat.dark,'monitor');
  const file = box('maintenance file',4.35,1.0,-6.55,.62,.06,.42,mat.paper); register(file,{type:'file'}); items.file=file;
  prop(8.1,.7,-6.9,1.3,1.5,.45,mat.wood,'filing shelf');
  for(let i=0;i<7;i++) prop(7.7+(i%3)*.25,.35+Math.floor(i/3)*.35,-6.63,.17,.26,.28,i%2?mat.paper:mat.green,'folder');
  prop(7.8,.45,-2.8,2.3,.8,.8,mat.metal,'washing machine');
  const panel = box('circuit panel',5.7,1.7,-1.28,.75,1.1,.1,mat.metal); register(panel,{type:'breaker'}); items.breaker=panel;
  for(let i=0;i<4;i++) { const sw=box('switch',5.48+i*.15,1.75,-1.35,.07,.18,.04,mat.brass); }
  const radio = box('radio', 4.5, 1.05, -2.5, .48,.28,.26,mat.dark); register(radio,{type:'radio'});
  const cal = box('calendar', 5.8, 2.65, -9.84, 1.1,.78,.04,mat.paper); register(cal,{type:'calendar'}); addTextLabel('15  /  10',5.8,2.65,-9.79,Math.PI);
}
function buildGarage() {
  prop(15.2,.65,6.4,3.9,.9,1.9,mat.green,'Asha hatchback'); addPropCollider(13.25,17.15,5.45,7.35);
  cylinder('wheel',13.65,.35,5.48,.34,.18,mat.dark); cylinder('wheel',16.7,.35,5.48,.34,.18,mat.dark);
  prop(18.7,.4,4.3,1.7,.75,.75,mat.wood,'tool chest'); addPropCollider(17.85,19.55,3.9,4.7);
  for(let i=0;i<3;i++) prop(12.4+i*.8,.22,9.15,.6,.42,.5,mat.paper,'moving box');
  const switchBox = box('garage release',18.7,1.4,9.82,.42,.52,.09,mat.metal); register(switchBox,{type:'garageRelease'}); items.garageRelease=switchBox;
  // large segmented rolling shutter visual: swings/raises as one panel in the final route
  const shutter = new THREE.Group(); shutter.position.set(15,2.2,9.95); world.add(shutter);
  const slat = new THREE.Mesh(new THREE.BoxGeometry(9.6,4.2,.12),mat.metal); slat.castShadow=true; shutter.add(slat); doors.shutter={pivot:shutter,target:0,closed:0,locked:true,label:'Garage shutter'};
  for(let i=0;i<7;i++) { const stripe=box('shutter slat',15,.55+i*.55,9.86,9.5,.035,.04,mat.dark); stripe.userData.shutterStripe=true; }
  const shelves=prop(11.25,1.2,4.1,.45,2.4,2.1,mat.metal,'storage shelf');
  for(let i=0;i<5;i++) prop(11.1, .5+i*.42, 4.3, .55,.25,.5, i%2?mat.paper:mat.green,'garage clutter');
}
function buildOutside() {
  // Planter key, mailbox, shrubs, phone pole and a neighbouring silhouette of ordinary houses.
  cylinder('front planter', -8.3,.28,12.1,.42,.56,mat.wood); const shrub = new THREE.Mesh(new THREE.DodecahedronGeometry(.65,0),mat.green); shrub.position.set(-8.3,.95,12.1); world.add(shrub);
  const spare = new THREE.Mesh(new THREE.TorusGeometry(.12,.035,6,10),mat.brass); spare.position.set(-8.15,.36,12.48); spare.rotation.x=Math.PI/2; world.add(spare); register(spare,{type:'spareKey'}); items.spareKey=spare;
  prop(-9.0,.65,15.2,.2,1.3,.2,mat.wood,'mailbox post'); prop(-9,.98,15.2,.7,.43,.42,mat.green,'mailbox');
  cylinder('street lamp',-13,3.2,13,.12,6.4,mat.metal); const street=new THREE.PointLight(0xf5d7a7,.7,14,2);street.position.set(-13,6.1,13);scene.add(street);
  for(let i=0;i<9;i++){ const b=new THREE.Mesh(new THREE.DodecahedronGeometry(.7+Math.random()*.6,0),mat.green);b.position.set(-13+Math.random()*28,.6,9+Math.random()*12);world.add(b); }
  for(let i=0;i<4;i++){ const house=box('neighbour house',-20+i*13,2.5,-4-(i%2)*8,7,5,6,mat.wallDark,world,false); const roof=new THREE.Mesh(new THREE.ConeGeometry(5.7,2.1,4),mat.dark);roof.position.set(-20+i*13,6,-4-(i%2)*8);roof.rotation.y=Math.PI/4;world.add(roof);}
  addTextLabel('ALDER ROW',-12,2.05,15.9,0);
  buildNeighbour();
}

// The only innocent person seen tonight: a neighbour completing a normal late dog walk.
// Their small loop makes the street feel inhabited without becoming a dialogue checkpoint.
const neighbour = { root:null, direction:1 };
function buildNeighbour() {
  const g = new THREE.Group(); g.position.set(-12,0,16.5); actors.add(g);
  const coat = new THREE.MeshStandardMaterial({ color:0x7a6654,roughness:1 });
  const skin = new THREE.MeshStandardMaterial({ color:0x8e6b58,roughness:1 });
  box('neighbour coat',0,1.45,0,.46,1.2,.32,coat,g);
  const head=new THREE.Mesh(new THREE.SphereGeometry(.19,8,7),skin);head.position.y=2.22;g.add(head);
  const hood=new THREE.Mesh(new THREE.ConeGeometry(.28,.3,8),coat);hood.position.y=2.39;g.add(hood);
  for(const x of[-.13,.13]) box('neighbour leg',x,.47,0,.15,.8,.18,mat.dark,g);
  const umbrella=new THREE.Mesh(new THREE.ConeGeometry(.65,.2,12),mat.dark);umbrella.position.set(.12,2.72,0);umbrella.rotation.x=Math.PI;g.add(umbrella);
  const pole=box('umbrella pole',.12,2.2,0,.035,1.1,.035,mat.metal,g); neighbour.root=g;
}
function updateNeighbour(dt) {
  if(!neighbour.root || playing && stage>7) { if(neighbour.root) neighbour.root.visible=false; return; }
  neighbour.root.position.x += neighbour.direction*dt*.62;
  neighbour.root.rotation.y = neighbour.direction>0?Math.PI/2:-Math.PI/2;
  if(neighbour.root.position.x>8)neighbour.direction=-1; if(neighbour.root.position.x<-13)neighbour.direction=1;
}
function buildRain() {
  const n = 560; const pos = new Float32Array(n*3); for(let i=0;i<n;i++){pos[i*3]=(Math.random()-.5)*44;pos[i*3+1]=Math.random()*16;pos[i*3+2]=(Math.random()-.5)*44;}
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(pos,3));const rain=new THREE.Points(geo,new THREE.PointsMaterial({color:0xa5b6c6,size:.035,transparent:true,opacity:.45,depthWrite:false}));rain.userData.rain=true;scene.add(rain);
}

// ─────────────────────────────────────────────────────────────────────────────
// Enemy / NPC: Rowan Orr, former maintenance contractor. Behaviour stays human.
// ─────────────────────────────────────────────────────────────────────────────
const enemy = { root:null, state:'hidden', speed:0, target:new THREE.Vector3(), visibleUntil:0, searchPhase:0, spotted:false };
function buildEnemy() {
  const g = new THREE.Group(); g.visible=false; g.position.set(4,0,8); actors.add(g);
  const jacket=new THREE.MeshStandardMaterial({color:0x333b39,roughness:.93}); const jeans=new THREE.MeshStandardMaterial({color:0x273039,roughness:.9}); const skin=new THREE.MeshStandardMaterial({color:0x9c745d,roughness:1});
  const torso=box('Rowan work jacket',0,1.65,0,.75,1.1,.38,jacket,g); const head=new THREE.Mesh(new THREE.SphereGeometry(.27,9,8),skin);head.position.y=2.5;head.castShadow=true;g.add(head);
  const cap=new THREE.Mesh(new THREE.CylinderGeometry(.3,.3,.12,10),mat.dark);cap.position.y=2.72;g.add(cap);
  for(const x of[-.22,.22]){const leg=box('leg',x,.65,0,.24,1.15,.25,jeans,g);const shoe=box('shoe',x,.08,-.08,.3,.15,.5,mat.dark,g);}
  for(const x of[-.5,.5]) {const arm=box('arm',x,1.7,0,.18,.95,.22,jacket,g);arm.rotation.z=x*.13;}
  enemy.root=g;
}
function showGlimpse() {
  enemy.root.visible=true; enemy.root.position.set(4.2,0,10.8); enemy.root.rotation.y=Math.PI; enemy.state='glimpse'; enemy.visibleUntil=performance.now()+1500; spatialSound('step',enemy.root.position,.1);
}
function startSearch() {
  enemy.root.visible=true; enemy.root.position.set(4.3,0,7.8); enemy.root.rotation.y=-2.3; enemy.state='search'; enemy.searchPhase=0; enemy.speed=1.15;
  sound('door',.13);
}
function startChase() {
  if (enemy.state === 'chase') return;
  enemy.root.visible=true; if(enemy.root.position.length()>50) enemy.root.position.set(3,0,4);
  enemy.state='chase'; enemy.speed=2.35; panic=1; ui.breath.classList.add('panic'); sound('sting',.16);
  notify('A floorboard bends behind you.', 2800);
}
function updateEnemy(dt) {
  if (!enemy.root) return;
  if (enemy.state === 'hidden') return;
  if (enemy.state === 'glimpse') { if(performance.now()>enemy.visibleUntil){enemy.root.visible=false;enemy.state='hidden';} return; }
  if (enemy.state==='search') {
    const route=[new THREE.Vector3(-2,0,2),new THREE.Vector3(-5,0,-2),new THREE.Vector3(-7,0,-5),new THREE.Vector3(-5,0,-1),new THREE.Vector3(1,0,2)];
    if(hiding){ enemy.target.set(-5,0,-4); } else enemy.target.copy(route[Math.min(enemy.searchPhase,route.length-1)]);
    moveActor(enemy.root,enemy.target,enemy.speed,dt);
    if(enemy.root.position.distanceTo(enemy.target)<.4){ if(hiding){enemy.state='retreat';enemy.target.set(3,0,3);}else enemy.searchPhase++; }
    if(!hiding && enemy.root.position.distanceTo(yaw.position)<1.3) caught('He stops just beyond the bedroom doorway.');
  } else if(enemy.state==='retreat') {
    moveActor(enemy.root,enemy.target,1.5,dt); if(enemy.root.position.distanceTo(enemy.target)<.5){ enemy.root.visible=false; enemy.state='hidden'; }
  } else if(enemy.state==='chase') {
    enemy.target.set(yaw.position.x,0,yaw.position.z); moveActor(enemy.root,enemy.target,enemy.speed + (flashlightOn?.25:0),dt);
    if(enemy.root.position.distanceTo(yaw.position)<.92 && !hiding) caught('A hand catches the back of your coat.');
  }
}
function moveActor(actor,target,speed,dt){const dir=target.clone().sub(actor.position);dir.y=0;if(dir.length()<.03)return;dir.normalize();actor.position.addScaledVector(dir,speed*dt);actor.rotation.y=Math.atan2(dir.x,dir.z);if(Math.random()<.025)spatialSound('step',actor.position,.06);}
function caught(line){
  if(!playing || hiding) return;
  flashScreen(); sound('sting',.23); subtitle(line,2300); panic=1;
  // A recoverable stumble rather than a conventional fail state.
  yaw.position.set(-4.8,0,-3.0); yaw.rotation.y=0; enemy.root.position.set(2.5,0,5); enemy.speed=1.7;
}

// ─────────────────────────────────────────────────────────────────────────────
// Interaction and story
// ─────────────────────────────────────────────────────────────────────────────
function objective(text, chapter = '') {
  currentObjective=text; ui.objective.textContent=text; ui.objective.classList.add('show');
  if(chapter){ui.chapter.textContent=chapter.toUpperCase();ui.chapter.classList.add('show');setTimeout(()=>ui.chapter.classList.remove('show'),4300);}
}
function notify(text, ms=3200){ui.notification.textContent=text;ui.notification.classList.add('show');clearTimeout(notify.timer);notify.timer=setTimeout(()=>ui.notification.classList.remove('show'),ms);}
function subtitle(text,ms=3600){ui.subtitle.textContent=text;ui.subtitle.classList.add('show');clearTimeout(subtitle.timer);subtitle.timer=setTimeout(()=>ui.subtitle.classList.remove('show'),ms);}
function flashScreen(){ui.flash.style.opacity='.34';setTimeout(()=>ui.flash.style.opacity='0',100);}
function addItem(name,label){inventory.add(name);renderInventory();sound('pickup',.08);}
function renderInventory(){ui.inventory.innerHTML=''; const labels={houseKey:'BRASS HOUSE KEY',utilityKey:'BLUE UTILITY KEY',carKeys:'HATCHBACK KEYS',evidence:'MAINTENANCE RECORDING'}; inventory.forEach(x=>{const el=document.createElement('div');el.textContent=labels[x]||x;ui.inventory.append(el);});}
function markStage(value){stage=value;saveCheckpoint();}
function saveCheckpoint(){ if(stage<1||stage>12)return; try{localStorage.setItem(SAVE_KEY,JSON.stringify({stage, inventory:[...inventory],groceries,hasEvidence}));ui.save.classList.add('show');setTimeout(()=>ui.save.classList.remove('show'),1600);}catch{} }
function schedule(fn,ms){const id=setTimeout(fn,ms);pendingTimers.push(id);return id;}
function clearTimers(){pendingTimers.forEach(clearTimeout);pendingTimers=[];}
function openDoor(door){door.target=door.target===0?door.hinge*1.36:0;sound('door',.11);}
function handleInteraction(data) {
  if(!data||!playing||paused||phoneOpen)return;
  const type=data.type;
  if(type==='door'){
    const d=data.door;
    if(d.id==='front'&&d.locked){if(inventory.has('houseKey')){d.locked=false;notify('The lock gives with a dull click.');openDoor(d);if(stage===1){markStage(2);objective('Put Asha’s groceries away in the kitchen.','Act I — A simple favour');}}else{notify('Locked. Asha said there was a spare beneath the planter.');sound('click',.05);}return;}
    if(d.id==='garage'&&d.locked){if(inventory.has('utilityKey')){d.locked=false;openDoor(d);if(stage<=5){markStage(6);objective('Reset the circuit breaker in the utility room.');}}else notify('The blue utility key should fit this lock.');return;}
    if(d.id==='study'&&d.locked){if(stage>=7){d.locked=false;openDoor(d);}else notify('The study is locked.');return;}
    if(d.closet){openDoor(d);return;}
    openDoor(d); return;
  }
  if(type==='spareKey'){
    if(stage!==0){notify('Only wet potting soil remains.');return;}
    items.spareKey.visible=false;addItem('houseKey');markStage(1);objective('Unlock the front door.','Prologue — Alder Row');subtitle('Asha: “You’re a lifesaver. I left the spare beneath the planter.”');return;
  }
  if(type==='grocery'){
    if(stage!==2){notify('It can wait.');return;}
    const item=items[`grocery${data.index}`];if(!item?.visible)return;item.visible=false;groceries++;sound('pickup',.05);
    if(groceries>=3){markStage(3);objective('Put the kettle on for tea.');subtitle('Rain starts ticking against the kitchen glass.',2700);}
    else notify(`${3-groceries} grocery item${3-groceries===1?'':'s'} left.`);return;
  }
  if(type==='kettle'){
    if(stage!==3){notify('The kettle is cold.');return;}
    markStage(4); objective('Find the blue utility key in the cereal drawer.','Act II — A small interruption');
    subtitle('Asha: “The rain may trip the old circuit. Blue key is in the cereal drawer.”',4200);addMessage('Asha','The rain may knock the circuit out. Blue utility key is in the cereal drawer — then the utility room by the garage.');
    schedule(()=>{flickerRoom('kitchen');sound('thud',.09);notify('Something clicks once inside the wall.');},3500);
    schedule(()=>{items.tvScreen.material.color.setHex(0x9ca7a0);sound('static',.05);notify('The television wakes on a channel of snow.');},6700);
    schedule(()=>{doors.front.target=0;sound('door',.08);notify('The front latch settles by itself.');},10500); return;
  }
  if(type==='drawer'){
    if(data.id==='cereal'){
      items.drawer.position.x=5.72; if(stage===4){items.utilityKey.visible=true;notify('A blue key rests beneath the cereal box.');}
    }else notify('Old receipts, batteries, nothing useful.'); sound('door',.04);return;
  }
  if(type==='utilityKey'){
    if(stage!==4)return;items.utilityKey.visible=false;addItem('utilityKey');markStage(5);objective('Use the blue key on the garage utility door.');return;
  }
  if(type==='breaker'){
    if(stage!==6){notify('The panel is dead behind its cover.');return;}
    markStage(7); objective('The study door is open. Find Asha’s maintenance file.','Act III — Someone knows this house');
    doors.study.locked=false; lights.forEach(l=>{l.on=true;l.light.intensity=l.base;});sound('click',.13);subtitle('The power returns. Somewhere upstairs, a floorboard answers it.',3600);showGlimpse();
    addMessage('Unknown','You should not use the lights in that room.');schedule(()=>{items.photo.material.color.setHex(0x93866f);notify('The family photograph looks as if someone stood beside it.');},4200);return;
  }
  if(type==='file'){
    if(stage!==7){notify('Invoices and appliance manuals.');return;}
    items.file.visible=false;hasEvidence=true;addItem('evidence');markStage(8);objective('Listen to the voice recorder on the bedroom dresser.');
    subtitle('Work order, 1997: “Orr terminated. Keys unreturned. Do not grant access.”',4500);addMessage('Asha','I just found the old file at the clinic. If you see Rowan, do not argue with him. Call me.');return;
  }
  if(type==='recorder'){
    if(stage!==8){notify('The tape is labeled “October 1997.”');return;}
    markStage(9); objective('Hide in the bedroom wardrobe.','Act IV — The house is not empty');
    sound('static',.12);subtitle('RECORDER: “He said he could still hear the pipes. He said the building owed him.”',5200);
    schedule(()=>{addMessage('Unknown','You moved the blue key.');startSearch();flickerRoom('all');},3100);return;
  }
  if(type==='hide'){
    if(stage!==9){notify('The wardrobe smells of cedar and old coats.');return;}
    if(doors.closet.target===0){notify('Open the wardrobe first.');return;}
    hiding=true;hideUntil=performance.now()+7000;yaw.position.set(-8.25,0,-7.0);objective('Stay quiet.');ui.prompt.classList.remove('show');sound('door',.08);subtitle('A slow step crosses the carpet. Then another.',3500);return;
  }
  if(type==='carKeys'){
    if(stage!==10){notify('Asha’s keys sit in the bowl.');return;}
    addItem('carKeys');markStage(11);objective('Reach the garage release.');items.keyBowl.visible=false;subtitle('A latch moves in the kitchen. He is coming back.',3200);schedule(startChase,600);return;
  }
  if(type==='garageRelease'){
    if(stage!==11){notify('The rolling door has no power.');return;}
    markStage(12);objective('Run into the rain.');doors.shutter.target=1;sound('door',.19);subtitle('The shutter rattles upward, inch by inch.',2800);return;
  }
  if(type==='tv'){sound('static',.07);notify('Only static. The channel is not tuned.');return;}
  if(type==='photo'){if(stage>=7)notify('In the corner: a man in a work jacket, reflected in the hall mirror.');else notify('Asha and Mara at the Alder Row summer fair.');return;}
  if(type==='note'){notify('Asha’s note: “Tea bags. Milk in the fridge. Back door sticks in damp weather.”');return;}
  if(type==='calendar'){notify('October 15 is circled twice. “Orr inspection — cancelled.”');return;}
  if(type==='radio'){sound('static',.07);notify('The radio hisses, then falls quiet.');return;}
}
function flickerRoom(which){ const list=which==='kitchen'?lights.slice(1,2):lights; let count=0; const id=setInterval(()=>{list.forEach(l=>l.light.intensity=(count%2?0:l.base));count++;if(count>7){clearInterval(id);list.forEach(l=>l.light.intensity=l.base);}},100);}

// ─────────────────────────────────────────────────────────────────────────────
// Phone content and controls
// ─────────────────────────────────────────────────────────────────────────────
const messages={
  Asha:[{me:false,text:'Made it to the clinic. Thank you again for staying at Alder Row.'},{me:false,text:'Tea bags are over the stove. I’ll be back before breakfast.'}]
};
function addMessage(from,text){messages[from]??=[];messages[from].push({me:false,text});messageUnread++;ui.phoneBadge.classList.add('show');ui.messageCount.textContent=messageUnread;ui.messageCount.style.display='block';sound('ring',.07);notify(`NEW MESSAGE · ${from}`);}
function togglePhone(force){if(!playing)return;const next=force??!phoneOpen;phoneOpen=next;ui.phone.classList.toggle('open',next);ui.phone.setAttribute('aria-hidden',String(!next));if(next){document.exitPointerLock?.();renderPhoneHome();}else if(!paused)canvas.requestPointerLock?.();}
function renderPhoneHome(){ui.phoneHome.hidden=false;ui.phoneApp.hidden=true;ui.phoneApp.innerHTML='';}
function backPhone(){renderPhoneHome();}
function phoneApp(name){ui.phoneHome.hidden=true;ui.phoneApp.hidden=false;const back='<button class="app-back" id="appBack">‹ HOME</button>';
  if(name==='messages'){
    messageUnread=0;ui.phoneBadge.classList.remove('show');ui.messageCount.style.display='none';
    let html=back+'<div class="app-title">Messages</div>';Object.keys(messages).forEach(k=>{const last=messages[k][messages[k].length-1];html+=`<div class="thread" data-thread="${k}"><b>${k}</b><span>${last?last.text.slice(0,48):'No messages'}</span></div>`;});ui.phoneApp.innerHTML=html;
    ui.phoneApp.querySelectorAll('.thread').forEach(el=>el.onclick=()=>renderThread(el.dataset.thread));
  } else if(name==='notes') ui.phoneApp.innerHTML=back+'<div class="app-title">Notes</div><div class="note">Asha: Milk in fridge. Feed Puck tomorrow morning.</div><div class="note">Utility: blue key in cereal drawer. Panel by garage.</div><div class="note">Call list: clinic 555–0147</div>';
  else if(name==='photos') ui.phoneApp.innerHTML=back+'<div class="app-title">Photos</div><div class="photo-card">ALDER ROW — LAST AUGUST</div><div class="photo-card">MARA’S HATCHBACK / REAR PLATE</div><div class="photo-card">Asha’s kitchen table</div>';
  else if(name==='contacts') ui.phoneApp.innerHTML=back+'<div class="app-title">Contacts</div><div class="contact"><i class="avatar">A</i><span>Asha Morrow<br><small>mobile</small></span></div><div class="contact"><i class="avatar">C</i><span>Clinic reception<br><small>work</small></span></div><div class="contact"><i class="avatar">M</i><span>Mara<br><small>me</small></span></div>';
  else if(name==='torch'){ui.phoneApp.innerHTML=back+'<div class="app-title">Light</div><p class="torch-state">'+(flashlightOn?'ON — battery 72%':'OFF — battery 72%')+'</p><button id="torchButton" class="torch-button">TURN '+(flashlightOn?'OFF':'ON')+'</button>';ui.phoneApp.querySelector('#torchButton').onclick=()=>{flashlightOn=!flashlightOn;flashlight.intensity=flashlightOn?3.1:0;sound('click',.04);phoneApp('torch');};}
  ui.phoneApp.querySelector('#appBack').onclick=backPhone;
}
function renderThread(who){const messagesFor=messages[who]||[];ui.phoneApp.innerHTML='<button class="app-back" id="appBack">‹ MESSAGES</button><div class="app-title">'+who+'</div>'+messagesFor.map(m=>'<div class="bubble '+(m.me?'me':'')+'">'+m.text+'</div>').join('');ui.phoneApp.querySelector('#appBack').onclick=()=>phoneApp('messages');}
document.querySelectorAll('.app').forEach(b=>b.addEventListener('click',()=>phoneApp(b.dataset.app)));$('phoneClose').onclick=()=>togglePhone(false);$('phoneButton').onclick=()=>togglePhone();

// ─────────────────────────────────────────────────────────────────────────────
// Controls, collision and look
// ─────────────────────────────────────────────────────────────────────────────
const player = { velocity:new THREE.Vector3(), bob:0, crouched:false, speed:0 };
function isBlocked(x,z){
  // House and garage are bounded, with a deliberately usable open front/garage portals.
  for(const c of wallColliders.concat(propColliders)){if(x>c.x1-.23&&x<c.x2+.23&&z>c.z1-.23&&z<c.z2+.23)return true;}
  // The shutter is a moving physical barrier; the rest of a door stops the player only while closed.
  if (doors.shutter && doors.shutter.target < .5 && x > 10.1 && x < 19.9 && Math.abs(z - 9.95) < .32) return true;
  for(const id in doors){const d=doors[id];if(!d?.pivot||Math.abs(d.target)>0.2)continue;const p=d.pivot.position;if(d.axis==='z'){if(Math.abs(z-p.z)<.28&&Math.abs(x-p.x)<1.18)return true;}else{if(Math.abs(x-p.x)<.28&&Math.abs(z-p.z)<1.18)return true;}}
  return false;
}
function updatePlayer(dt){
  if(!playing||paused||phoneOpen||hiding)return;
  const forward=(keys.KeyW?1:0)-(keys.KeyS?1:0); const side=(keys.KeyD?1:0)-(keys.KeyA?1:0);
  const crouch=keys.KeyC||keys.ControlLeft;player.crouched=!!crouch;
  const running=keys.ShiftLeft&&!crouch&&forward>0; const moveSpeed=running?4.25:(crouch?1.25:2.65);
  let length=Math.hypot(forward,side); if(!length){player.speed=THREE.MathUtils.lerp(player.speed,0,dt*10);pitch.position.y=Math.sin(clock.elapsedTime*1.1)*.006;handRig.position.y=THREE.MathUtils.lerp(handRig.position.y,-.51,dt*6);return;}
  const dir=new THREE.Vector3(side/length,0,-forward/length).applyAxisAngle(new THREE.Vector3(0,1,0),yaw.rotation.y);
  const nextX=yaw.position.x+dir.x*moveSpeed*dt,nextZ=yaw.position.z+dir.z*moveSpeed*dt;
  if(!isBlocked(nextX,yaw.position.z))yaw.position.x=nextX;if(!isBlocked(yaw.position.x,nextZ))yaw.position.z=nextZ;
  player.speed=moveSpeed;player.bob+=dt*moveSpeed*(running?12:8);pitch.position.y=(player.crouched?-.36:0)+Math.sin(player.bob)*.022+(running?Math.sin(player.bob*.5)*.012:0);handRig.position.y=-.51+Math.sin(player.bob)*.012;handRig.rotation.z=-.05+Math.sin(player.bob*.5)*.025;
  if(performance.now()-lastFootstep>(running?290:440)){lastFootstep=performance.now();sound('step',running?.045:.028);}
  if(stage===12&&yaw.position.x>10.8&&yaw.position.z>10.35)finishGame();
}
function updatePrompt(){
  if(!playing||paused||phoneOpen||hiding){ui.prompt.classList.remove('show');return;}
  raycaster.setFromCamera(center,camera);const hits=raycaster.intersectObjects(interactables,true);let found=null;
  for(const hit of hits){let o=hit.object;while(o&&!o.userData.interaction)o=o.parent;if(o?.userData.interaction){found=o.userData.interaction;break;}}
  activeInteraction=found;if(!found){ui.prompt.classList.remove('show');return;}
  let label='INTERACT';if(found.type==='door'){const d=found.door;label=d.locked?'UNLOCK':'OPEN';if(Math.abs(d.target)>.2)label='CLOSE';}else if(found.type==='hide')label='HIDE';else if(found.type==='spareKey'||found.type==='utilityKey')label='PICK UP';else if(found.type==='file'||found.type==='photo'||found.type==='note'||found.type==='calendar')label='READ';else if(found.type==='garageRelease'||found.type==='breaker'||found.type==='kettle')label='USE';
  const text=`<b>[E]</b> ${label}`;if(text!==lastPrompt){ui.prompt.innerHTML=text;lastPrompt=text;}ui.prompt.classList.add('show');
}
function updateDoors(dt){Object.values(doors).forEach(d=>{if(!d?.pivot)return;if(d.id==='shutter'){d.closed=THREE.MathUtils.lerp(d.closed,d.target,dt*1.3);d.pivot.position.y=2.2+d.closed*4.25;return;}d.closed=THREE.MathUtils.lerp(d.closed,d.target,dt*8);d.pivot.rotation.y=d.closed;});}

// pointer lock is kept custom to make camera movement human and restrained.
canvas.addEventListener('click',()=>{if(playing&&!paused&&!phoneOpen)canvas.requestPointerLock();});
document.addEventListener('pointerlockchange',()=>{if(playing&&!phoneOpen&&!document.pointerLockElement&&!paused){setTimeout(()=>{if(!phoneOpen&&!paused)showPause();},80);}});
document.addEventListener('mousemove',(e)=>{if(document.pointerLockElement!==canvas||paused||phoneOpen)return;yaw.rotation.y-=e.movementX*.0021;pitch.rotation.x=THREE.MathUtils.clamp(pitch.rotation.x-e.movementY*.0018,-1.35,1.35);});
addEventListener('keydown',(e)=>{
  keys[e.code]=true;
  if(e.code==='KeyE'){e.preventDefault();handleInteraction(activeInteraction);}
  if(e.code==='KeyQ'){e.preventDefault();togglePhone();}
  if(e.code==='Escape'&&playing&&!phoneOpen){showPause();}
});
addEventListener('keyup',(e)=>keys[e.code]=false);

// ─────────────────────────────────────────────────────────────────────────────
// Menu/settings/save lifecycle
// ─────────────────────────────────────────────────────────────────────────────
function applyQuality(){const q=ui.quality.value;const values={low:[1,false,45],medium:[1.2,true,65],high:[1.6,true,90],ultra:[2,true,110]}[q];renderer.setPixelRatio(Math.min(devicePixelRatio,values[0]));renderer.shadowMap.enabled=values[1];camera.far=values[2];camera.updateProjectionMatrix();localStorage.setItem('borrowed-light-settings',JSON.stringify({q,grain:ui.grainToggle.checked,motion:ui.motionToggle.checked,vignette:ui.vignetteToggle.checked}));}
function loadSettings(){try{const s=JSON.parse(localStorage.getItem('borrowed-light-settings'));if(!s)return;ui.quality.value=s.q||'high';ui.grainToggle.checked=s.grain!==false;ui.motionToggle.checked=s.motion!==false;ui.vignetteToggle.checked=s.vignette!==false;}catch{}applyQuality();}
function showModal(el){el.classList.add('show');el.setAttribute('aria-hidden','false');}function closeModal(el){el.classList.remove('show');el.setAttribute('aria-hidden','true');}
$('settingsBtn').onclick=()=>showModal(ui.settings);$('creditsBtn').onclick=()=>showModal(ui.credits);$('pauseSettingsBtn').onclick=()=>showModal(ui.settings);
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>closeModal($(b.dataset.close)));
ui.quality.onchange=applyQuality;ui.grainToggle.onchange=()=>{ui.grain.style.display=ui.grainToggle.checked?'block':'none';applyQuality();};ui.motionToggle.onchange=applyQuality;ui.vignetteToggle.onchange=()=>{ui.vignette.style.display=ui.vignetteToggle.checked?'block':'none';applyQuality();};
function startGame(resume=false){
  ensureAudio();playing=true;paused=false;ui.menu.classList.add('hidden');ui.hud.classList.add('visible');canvas.requestPointerLock?.();
  yaw.position.set(-4.8,0,15.2);yaw.rotation.set(0,0,0);pitch.rotation.set(-.03,0,0);startedOnce=true;
  if(resume&&saved){hydrateSave(saved);}else{stage=0;objective('Find Asha’s spare key beneath the planter.','Prologue — Alder Row');subtitle('Friday, 11:43 PM. You promised one quiet night.',4000);}
  setTimeout(()=>ui.hint.classList.add('fade'),9500);
}
function hydrateSave(data){
  stage=data.stage;data.inventory?.forEach(x=>inventory.add(x));groceries=data.groceries||0;hasEvidence=!!data.hasEvidence;
  if(stage>=1){items.spareKey.visible=false;}if(stage>=2){doors.front.locked=false;doors.front.target=1.36;}if(stage>=3){for(let i=0;i<3;i++)items[`grocery${i}`].visible=false;}if(stage>=5){items.utilityKey.visible=false;items.drawer.position.x=5.72;}if(stage>=6){doors.garage.locked=false;}if(stage>=7){doors.study.locked=false;items.breaker.visible=true;}if(stage>=8){items.file.visible=false;}if(stage>=10){enemy.state='hidden';enemy.root.visible=false;}if(stage>=11){items.keyBowl.visible=false;}
  const text={1:'Unlock the front door.',2:'Put Asha’s groceries away in the kitchen.',3:'Put the kettle on for tea.',4:'Find the blue utility key in the cereal drawer.',5:'Use the blue key on the garage utility door.',6:'Reset the circuit breaker in the utility room.',7:'The study door is open. Find Asha’s maintenance file.',8:'Listen to the voice recorder on the bedroom dresser.',9:'Hide in the bedroom wardrobe.',10:'Get your car keys from the entry bowl.',11:'Reach the garage release.',12:'Run into the rain.'}[stage]||'Find Asha’s spare key beneath the planter.';objective(text,'Checkpoint restored');renderInventory();notify('Checkpoint restored.');
}
function showPause(){if(!playing||phoneOpen||ui.ending.classList.contains('show'))return;paused=true;ui.pause.classList.add('show');ui.pause.setAttribute('aria-hidden','false');document.exitPointerLock?.();}
function hidePause(){paused=false;ui.pause.classList.remove('show');ui.pause.setAttribute('aria-hidden','true');canvas.requestPointerLock?.();}
$('resumeBtn').onclick=hidePause;$('restartBtn').onclick=()=>{localStorage.removeItem(SAVE_KEY);location.reload();};ui.play.onclick=()=>startGame(false);ui.continue.onclick=()=>startGame(true);$('endingRestart').onclick=()=>location.reload();
function finishGame(){
  if(!playing)return;playing=false;document.exitPointerLock?.();localStorage.removeItem(SAVE_KEY);ui.hud.classList.remove('visible');ui.ending.classList.add('show');ui.ending.setAttribute('aria-hidden','false');
  const thorough=hasEvidence&&inventory.has('evidence');ui.endingKicker.textContent=thorough?'STATEMENT RECORDED · 6:17 AM':'THE NIGHT ENDS · 6:17 AM';ui.endingTitle.textContent=thorough?'MORNING CALLS':'THE ROAD OUT';ui.endingText.textContent=thorough?'The recording and maintenance file give the police a name, a pattern, and a reason to believe you. Rowan Orr is arrested two towns over, still carrying keys to Alder Row. Asha sells the house in spring.':'The patrol car finds you beneath the streetlamp before dawn. Later, officers recover enough from the house to reopen the old complaint. You keep one light on for months afterward.';
}

// ─────────────────────────────────────────────────────────────────────────────
// Ambient randomisation and update loop
// ─────────────────────────────────────────────────────────────────────────────
function ambientEvent(){
  if(!playing||stage<3||stage>9||hiding)return;
  const possibilities=[()=>spatialSound('step',new THREE.Vector3(-7,0,3),.045),()=>{const l=lights[Math.floor(Math.random()*lights.length)];l.light.intensity=0;schedule(()=>l.light.intensity=l.base,160);},()=>spatialSound('thud',new THREE.Vector3(5,0,-5),.045),()=>sound('static',.025)];
  possibilities[Math.floor(Math.random()*possibilities.length)]();
}
setInterval(ambientEvent,11500);
function updateRain(dt){scene.traverse(o=>{if(o.userData.rain){const a=o.geometry.attributes.position;for(let i=0;i<a.count;i++){let y=a.getY(i)-dt*7;if(y<0)y=14;a.setY(i,y);}a.needsUpdate=true;}});}
function updateHiding(){if(!hiding)return;if(performance.now()<hideUntil)return;hiding=false;markStage(10);objective('Get your car keys from the entry bowl.');subtitle('The wardrobe door eases shut. The house is quiet again.',3400);yaw.position.set(-7.2,0,-5.2);doors.closet.target=0;if(enemy.state==='search')enemy.state='retreat';}
function animate(){requestAnimationFrame(animate);const dt=Math.min(.05,clock.getDelta());
  if(!playing){ // a little camera drift gives the title scene presence
    if(!startedOnce){yaw.position.set(-4.9,0,15.2);yaw.rotation.y=.09*Math.sin(clock.elapsedTime*.18);pitch.rotation.x=-.05;}
  }else{
    updatePlayer(dt);updateDoors(dt);updateEnemy(dt);updatePrompt();updateHiding();updateRain(dt);panic=THREE.MathUtils.lerp(panic,0,dt*.55);if(ui.motionToggle.checked){pitch.rotation.z=Math.sin(clock.elapsedTime*7)*panic*.008;}
  }
  updateNeighbour(dt);
  renderer.render(scene,camera);
}
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);applyQuality();});

buildHands();buildWorld();buildEnemy();loadSettings();animate();
