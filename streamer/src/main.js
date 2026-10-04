// ── STREAMER LIFE 2 — bootstrap & world conductor ───────────────────────────
import * as THREE from 'three';
import { buildTextures } from './tex.js';
import { buildCity, HOUSE_SPOTS } from './city.js';
import { makeInterior } from './houses.js';
import { Player } from './player.js';
import { Pedestrian, buildHuman, buildCar } from './npc.js';
import { openPC, closePC, updatePCClock, StreamSession } from './pc.js';
import { MP } from './mp.js';
import { ui } from './ui.js';
import { audio } from './audio.js';
import { loadSave, persist, clearSave, loadSettings, persistSettings } from './save.js';
import { houseById, partById, carById, QUESTS, MILESTONES, SPONSORS, FOOD, FURNITURE } from './data.js';
import { angDiff, fmt, fmtMoney, isTouch } from './util.js';

const $ = (id) => document.getElementById(id);

addEventListener('error', (e) => {
  const el = $('errLog');
  if (el) { el.style.display = 'block'; el.textContent = '⚠️ ' + (e.message || 'Error') + (e.filename ? `:${e.lineno}` : ''); }
});

const game = {
  state: 'menu',
  paused: false,
  save: loadSave(),
  settings: loadSettings(),
  session: null,
  mp: null,
  streamKey: [...crypto.getRandomValues(new Uint8Array(6))].map((b) => b.toString(16).padStart(2, '0')).join('-'),
  city: null,
  interior: null,
  ownCars: [],
  partnerMesh: null,
  fanTimer: 45,
};
window.GAME = game;
const S = () => game.save;

// ── persistence helpers ──
game.persist = () => persist(game.save);
game.hasSave = () => { try { return !!localStorage.getItem('streamerlife2_save_v1'); } catch (e) { return false; } };

// ── stats ──
game.power = () => {
  let p = 0;
  for (const cat of Object.keys(game.save.parts)) {
    const it = partById(cat, game.save.parts[cat]);
    if (it) p += it.power;
  }
  return p;
};
game.vibe = () => {
  let v = 0;
  const rgb = partById('rgb', game.save.parts.rgb);
  if (rgb) v += rgb.vibe || 0;
  return v;
};
game.level = () => 1 + Math.floor(Math.sqrt(game.save.xp / 120));
game.incomeMult = () => (game.save.sponsor ? SPONSORS[game.save.sponsor].mult : 1) * (1 + game.level() * 0.02);
game.canStreamGame = (g) => game.power() >= g.minPower && game.save.followers >= g.minFol;
game.canStream = () => {
  if (!game.save.parts.mic) { audio.err(); game.toast('⚠️ You need a microphone! Buy one at the Tech Shack or Zamazor.', true); return false; }
  if (game.save.energy < 15) { audio.err(); game.toast('😴 Too tired to stream. Sleep or drink coffee!', true); return false; }
  if (game.save.hunger < 8) { audio.err(); game.toast('🍔 Too hungry to focus. Eat something!', true); return false; }
  return true;
};
game.addMoney = (n) => { game.save.money += n; if (n > 0) game.save.totalEarned += n; };
game.spend = (n) => { if (game.save.money < n) { audio.err(); game.toast('⚠️ Not enough money!', true); return false; } game.save.money -= n; return true; };
game.addFollowers = (n) => {
  const before = game.save.followers;
  game.save.followers += n;
  for (const m of MILESTONES) if (before < m.fol && game.save.followers >= m.fol) { game.toast(m.msg); audio.level(); game.mail('🎉 Milestone', m.msg); }
};
game.addXp = (n) => {
  const l0 = game.level();
  game.save.xp += n;
  if (game.level() > l0) { game.toast(`⭐ Level ${game.level()}! Income +2%`); audio.level(); }
};
game.mail = (title, body) => {
  game.save.mail.unshift({ day: game.save.day, title, body, read: false });
  game.save.mail = game.save.mail.slice(0, 12);
  game.toast(`📬 Mail: ${title}`);
};

// ── quests ──
game.questCheck = () => {
  for (const q of QUESTS) {
    if (game.save.questsDone.includes(q.id)) continue;
    if (q.check(game.save)) {
      game.save.questsDone.push(q.id);
      game.addMoney(q.reward);
      game.mail(`✔ Quest complete: ${q.title}`, `${q.goal} — reward ${fmtMoney(q.reward)}.`);
      game.toast(`✅ <b>${q.title}</b> complete! +${fmtMoney(q.reward)}`);
      audio.level();
      if (q.sponsor && !game.save.sponsor) {
        game.save.sponsor = q.sponsor;
        game.save.sponsorName = SPONSORS[q.sponsor].name;
        game.mail(`🤝 Sponsor offer: ${SPONSORS[q.sponsor].name}`, `${SPONSORS[q.sponsor].emoji} ${SPONSORS[q.sponsor].text} Signed automatically. Income x${SPONSORS[q.sponsor].mult} forever.`);
      }
      if (q.id === 'q9' && !game.save.wonGame) { game.save.wonGame = true; setTimeout(() => game._showWin(), 600); }
    }
  }
  game.persist();
};

// ── renderer / scene ──
let renderer, camera, player, scene, sun, hemi, cityRef;
function boot() {
  buildTextures();
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  $('app').appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xb8c8d4, 50, 240);
  camera = new THREE.PerspectiveCamera(game.settings.fov, innerWidth / innerHeight, 0.1, 500);
  camera.rotation.order = 'YXZ';

  hemi = new THREE.HemisphereLight(0xcfe5f5, 0x3f4a38, 0.9);
  scene.add(hemi);
  sun = new THREE.DirectionalLight(0xffe8c0, 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -70; sun.shadow.camera.right = 70;
  sun.shadow.camera.top = 70; sun.shadow.camera.bottom = -70;
  sun.shadow.camera.far = 220;
  sun.shadow.bias = -0.0006;
  scene.add(sun); scene.add(sun.target);

  cityRef = buildCity();
  scene.add(cityRef.group);
  game.city = cityRef;

  player = new Player(camera);
  player.onStep = () => audio.step();

  wireInput();
  ui(game);
  game.applySettings();

  $('mainMenu').classList.add('on');
  if (game.hasSave()) $('btnPlay').innerHTML = '▶ CONTINUE';

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.08);
    tick(dt);
  });

  addEventListener('resize', () => {
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  });

  setTimeout(() => { $('loading').classList.add('hide'); setTimeout(() => $('loading').remove(), 700); }, 700);
}

// ── sky / time ──
function applySky(hour) {
  const h = hour % 24;
  const night = cityRef.getNight();
  const dayF = 1 - night;
  // sun position
  const ang = ((h - 6) / 12) * Math.PI;
  sun.position.set(Math.cos(ang) * 80, Math.sin(ang) * 70 + 6, 30);
  sun.intensity = 2.2 * dayF + 0.06;
  hemi.intensity = 0.25 + 0.75 * dayF;
  const skyDay = new THREE.Color(0xb8c8d4), skyNight = new THREE.Color(0x0a1020), skyDusk = new THREE.Color(0xd8926a);
  const duskF = Math.max(0, 1 - Math.abs(h - 18.8) / 1.6) + Math.max(0, 1 - Math.abs(h - 6.6) / 1.2);
  const col = skyNight.clone().lerp(skyDay, dayF).lerp(skyDusk, Math.min(1, duskF) * 0.55 * dayF + 0.15 * Math.min(1, duskF));
  scene.background = col;
  scene.fog.color.copy(col);
  if (player.car) {
    player.car.mesh.userData.headMat.emissiveIntensity = night * 2.4;
  }
}

// ── tick ──
let hudT = 0, saveT = 0, menuAng = 0;
function tick(dt) {
  if (game.state === 'menu') {
    menuAng += dt * 0.05;
    camera.position.set(Math.cos(menuAng) * 60, 18, Math.sin(menuAng) * 60);
    camera.lookAt(0, 2, 0);
    cityRef.update(dt, 12, performance.now() / 1000);
    renderer.render(scene, camera);
    return;
  }
  if (game.paused) { renderer.render(scene, camera); return; }

  // time
  const s = S();
  s.hour += dt * (24 / 360);            // 1 day = 6 real minutes
  if (s.hour >= 24) { s.hour -= 24; /* midnight: nothing, sleep handles days */ }
  s.hunger = Math.max(0, s.hunger - dt * 0.16);
  if (s.hunger <= 0) s.energy = Math.max(0, s.energy - dt * 0.5);
  applySky(s.hour);
  cityRef.update(dt, s.hour, performance.now() / 1000);

  // stream session
  if (game.session && !game.session.done) game.session.update(dt);

  // player
  if (game.drivingLocked) { player.keys.f = player.keys.b = player.keys.l = player.keys.r = false; }
  const colliders = game.interior ? game.interiorColliders : cityRef.colliders;
  const res = player.update(dt, colliders, { handbrake: game.handbrake });

  // partner avatar
  if (game.mp?.partner && game.mp.partner.x !== undefined) {
    if (!game.partnerMesh) {
      game.partnerMesh = buildHuman(game.mp.partner.seed || 1, game.mp.partner.name || 'friend');
      scene.add(game.partnerMesh);
    }
    const p = game.mp.partner;
    const m = game.partnerMesh;
    m.position.x += (p.x - m.position.x) * Math.min(1, dt * 8);
    m.position.z += (p.z - m.position.z) * Math.min(1, dt * 8);
    m.rotation.y += angDiff(m.rotation.y, p.yaw ?? 0) * Math.min(1, dt * 8);
    m.userData.walk(performance.now() / 120, p.act === 'walk');
  }
  if (game.mp?.connected) game.mp.sendPos(player.pos.x, player.pos.z, player.yaw, res.speed > 0.5 ? 'walk' : 'idle');

  // interact scan
  scanInteract();

  // fan events
  game.fanTimer -= dt;
  if (game.fanTimer <= 0) {
    game.fanTimer = 50 + Math.random() * 80;
    if (s.followers >= 200 && !player.car && game.state === 'play' && !game.interior) {
      const gain = Math.max(5, Math.round(Math.sqrt(s.followers) * (0.6 + Math.random() * 0.8)));
      game._modal('🤩 A fan recognized you!', `"OMG you're ${s.name}!! Can we take a photo?!"`, [
        ['📸 take photo', () => { game.addFollowers(gain); s.photos++; game.persist(); game.refreshHUD(); game.questCheck(); game.toast(`📸 +${fmt(gain)} followers!`); audio.fan(); game._closeModal(); }, 'gold'],
        ['not today', () => game._closeModal(), 'dim'],
      ]);
    }
  }

  updatePCClock(s.hour);
  hudT += dt;
  if (hudT > 0.4) { hudT = 0; game.refreshHUD(); }
  saveT += dt;
  if (saveT > 15) { saveT = 0; game.persist(); }

  renderer.render(scene, camera);
}

// ── interact ──
let currentTarget = null;
function activeInteractables() {
  const list = game.interior ? [...game.interior.interact] : [...cityRef.interactables];
  if (!game.interior) {
    for (const c of game.ownCars) list.push({ id: 'car:' + c.id, icon: '🚗', label: 'Drive ' + c.name, x: c.mesh.position.x, z: c.mesh.position.z, r: 3 });
  }
  return list;
}
function scanInteract() {
  if (game.drivingLocked && !player.car) { game._setPrompt(null); currentTarget = null; return; }
  if (player.car) { game._setPrompt(isTouch() ? '<b>[Q]</b> exit · <b>[E]</b> brake' : '<b>[Q]</b> exit · <b>[E]</b> handbrake'); currentTarget = null; return; }
  const list = activeInteractables();
  let best = null, bd = 1e9;
  for (const it of list) {
    const d = Math.hypot(it.x - player.pos.x, it.z - player.pos.z);
    if (d < it.r && d < bd) { bd = d; best = it; }
  }
  currentTarget = best;
  if (best) game._setPrompt(`${best.icon} <b>[${isTouch() ? 'TAP' : 'E'}]</b> ${best.label}`);
  else game._setPrompt(null);
}

function doInteract() {
  if (player.car) { game.handbrake = !game.handbrake; setTimeout(() => (game.handbrake = false), 400); return; }
  if (!currentTarget || game.paused) return;
  const it = currentTarget;
  const s = S();
  audio.click();
  if (it.id === 'pc') { sitAtPC(); openPC(game); }
  else if (it.id === 'bed') {
    game._modal('🛏️ Sleep?', 'Sleep until 08:00. Restores energy, delivers packages' + (s.home === 'room' ? ', pays $40 rent' : '') + '.', [
      ['😴 sleep', () => { game._closeModal(); doSleep(); }, 'gold'],
      ['not yet', () => game._closeModal(), 'dim'],
    ]);
  } else if (it.id === 'fridge') { openFridge(); }
  else if (it.id === 'exit') { exitHouse(); }
  else if (it.id.startsWith('house:')) {
    const hid = it.id.split(':')[1];
    if (s.ownedHouses.includes(hid)) enterHouse(hid);
    else game.toast('🔒 For sale — visit <b>Cedar Realty</b> on Main St.');
  } else if (it.id.startsWith('car:')) {
    const car = game.ownCars.find((c) => c.id === it.id.slice(4));
    if (car) { player.enterCar(car); game.drivingLocked = false; }
  } else {
    game._openShop(it.id);
  }
}

function sitAtPC() {
  const d = game.interior.deskSit;
  player.teleport(d.x, d.z, 0);
  game.drivingLocked = true;
}
game.lockPlayerForStream = () => { game.drivingLocked = true; };
game.endStreamLock = () => { game.drivingLocked = false; game.session = null; };
game.leavePC = () => { closePC(); if (!game.session) game.drivingLocked = false; };
game.partnerNear = (dist) => (game.mp ? game.mp.partnerNear(player.pos.x, player.pos.z, dist) : 0);

// ── houses ──
game.currentSlots = () => (game.interior ? game.interior.slots : []);
function enterHouse(hid) {
  game.fade(() => {
    if (game.interior) scene.remove(game.interior.group);
    game.interior = makeInterior(hid);
    game.interior.refreshSetup(S().parts);
    game.interior.refreshFurniture(S().placed[hid] || {});
    scene.add(game.interior.group);
    const [w, d] = houseById(hid).size;
    game.interiorColliders = [
      { x: 0 + game.interior.ox, z: 0, hx: w / 2 + 0.5, hz: 0.3 }, // walls as thin boxes approx:
    ];
    game.interiorColliders = [
      { x: game.interior.ox, z: -d / 2, hx: w / 2, hz: 0.2 },
      { x: game.interior.ox, z: d / 2, hx: w / 2, hz: 0.2 },
      { x: game.interior.ox - w / 2, z: 0, hx: 0.2, hz: d / 2 },
      { x: game.interior.ox + w / 2, z: 0, hx: 0.2, hz: d / 2 },
      { x: game.interior.ox - w / 2 + 1.1, z: -d / 2 + 1.3, hx: 0.8, hz: 1.2 },  // bed
      { x: game.interior.ox + w / 2 - 0.5, z: d / 2 - 1.4, hx: 0.5, hz: 0.5 },   // fridge
      { x: game.interior.ox + w / 2 - 1.6, z: -d / 2 + 0.7, hx: 1.1, hz: 0.6 },  // desk
    ];
    player.teleport(game.interior.ox + w / 4, d / 2 - 1.2, Math.PI);
    audio.door();
  });
}
function exitHouse() {
  const hid = S().home;
  const doorIt = cityRef.interactables.find((i) => i.id === 'house:' + hid);
  const spot = HOUSE_SPOTS[hid];
  game.fade(() => {
    if (game.interior) { scene.remove(game.interior.group); game.interior = null; }
    const px = doorIt ? doorIt.x : spot.x, pz = doorIt ? doorIt.z : spot.z + 4;
    player.teleport(px, pz, spot.rot + Math.PI);
    audio.door();
  });
}
game.fade = (fn) => {
  const f = $('fade');
  f.classList.add('on');
  setTimeout(() => { fn(); setTimeout(() => f.classList.remove('on'), 250); }, 260);
};

// ── sleep & deliveries ──
function doSleep() {
  const s = S();
  audio.sleep();
  game.fade(() => {
    s.day++;
    s.hour = 8;
    s.energy = 100;
    s.hunger = Math.max(0, s.hunger - 10);
    if (s.home === 'room') {
      if (s.money >= 40) { s.money -= 40; game.toast('🏠 Rent paid: $40'); }
      else { s.money = 0; game.toast('⚠️ Could not pay rent! The landlord is upset.', true); }
    }
    // deliveries
    const due = s.deliveries.filter((d) => d.day <= s.day);
    if (due.length) {
      s.deliveries = s.deliveries.filter((d) => d.day > s.day);
      for (const d of due) {
        if (d.kind === 'part') { s.parts[d.cat] = Math.max(s.parts[d.cat], d.t); }
        else s.furniture.push(d.id);
      }
      if (game.interior) { game.interior.refreshSetup(s.parts); }
      game.mail('📦 Package delivered', 'Your Zamazor order arrived: ' + due.map((d) => (d.kind === 'part' ? partById(d.cat, d.t)?.name : d.id)).join(', ') + '. Check your setup / decorate with B.');
      game.questCheck();
    }
    audio.wake();
    game.persist();
    game.refreshHUD();
  });
}

function openFridge() {
  const s = S();
  if (!s.food.length) {
    game._modal('🧊 Fridge', 'Empty… buy food at <b>Homestead Foods</b>.', [['ok', () => game._closeModal(), 'dim']]);
    return;
  }
  const counts = {};
  s.food.forEach((id) => (counts[id] = (counts[id] || 0) + 1));
  game._modal('🧊 Fridge — eat', `<div class="shopGrid">${Object.entries(counts).map(([id, n]) => {
    const f = FOOD.find((x) => x.id === id);
    return `<div class="shopItem"><span class="si">${f.emoji}</span><b>${f.name} x${n}</b><i>+${f.hunger}🍔 +${f.energy}⚡</i><button data-eat="${id}">eat</button></div>`;
  }).join('')}</div>`, [['close', () => game._closeModal(), 'dim']]);
  document.querySelectorAll('[data-eat]').forEach((b) => (b.onclick = () => {
    const id = b.dataset.eat;
    const f = FOOD.find((x) => x.id === id);
    s.food.splice(s.food.indexOf(id), 1);
    s.hunger = Math.min(100, s.hunger + f.hunger);
    s.energy = Math.min(100, s.energy + f.energy);
    audio.buy();
    game.persist(); game.refreshHUD();
    game._closeModal(); openFridge();
  }));
}

// ── economy actions from shops ──
game.buyFood = (id) => {
  const f = FOOD.find((x) => x.id === id);
  if (!game.spend(f.price)) return;
  S().food.push(id);
  game.persist(); game.refreshHUD();
  game.toast(`${f.emoji} ${f.name} → fridge`);
  audio.buy();
};
game.workShift = () => {
  const s = S();
  if (s.lastJobDay >= s.day) { game.toast('💼 Already worked today.', true); return; }
  if (s.hour < 7 || s.hour > 20) { game.toast('🕘 Shifts are 07:00–20:00.', true); return; }
  s.lastJobDay = s.day;
  s.hour = Math.min(23, s.hour + 2);
  s.energy = Math.max(0, s.energy - 15);
  game.addMoney(60);
  game.persist(); game.refreshHUD();
  game.toast('💼 Shift done! +$60 (2h passed)');
  audio.cash();
  game._closeModal();
};
game.buyPartInstant = (cat, t) => {
  const it = partById(cat, t);
  if (!game.spend(Math.ceil(it.price * 1.08))) return;
  S().parts[cat] = Math.max(S().parts[cat], t);
  if (game.interior) game.interior.refreshSetup(S().parts);
  game.persist(); game.refreshHUD(); game.questCheck();
  game.toast(`⚙️ ${it.name} installed!`);
  audio.buy();
};
game.buyFurniture = (id) => {
  const { FURNITURE } = game._catalog;
  const f = FURNITURE.find((x) => x.id === id);
  if (!game.spend(f.price)) return;
  S().furniture.push(id);
  game.persist(); game.refreshHUD();
  game.toast(`${f.emoji} ${f.name} bought — decorate with <b>B</b>`);
  audio.buy();
};
game.buyHouse = (id) => {
  const h = houseById(id);
  if (!game.spend(h.price)) return;
  S().ownedHouses.push(id);
  game.mail('🏠 Deed signed!', `You now own the ${h.name}. Move in anytime via Cedar Realty.`);
  game.persist(); game.refreshHUD(); game.questCheck();
  game.toast(`🏠 ${h.emoji} ${h.name} is YOURS!`);
  audio.cash();
};
game.moveHouse = (id) => {
  S().home = id;
  game.persist(); game.refreshHUD(); game.questCheck();
  spawnCars();
  game._closeModal();
  game.toast(`📦 Moved into ${houseById(id).name}!`);
  if (game.interior) enterHouse(id);
};
game.buyCar = (id) => {
  const c = carById(id);
  if (!game.spend(c.price)) return;
  S().cars.push(id);
  game.persist(); game.refreshHUD();
  spawnCars();
  game.toast(`🚗 ${c.name} delivered outside your home!`);
  audio.cash();
};
game.place = (slot, itemId) => {
  const s = S();
  const i = s.furniture.indexOf(itemId);
  if (i < 0) return;
  s.furniture.splice(i, 1);
  if (!s.placed[s.home]) s.placed[s.home] = {};
  s.placed[s.home][slot] = itemId;
  if (game.interior) game.interior.refreshFurniture(s.placed[s.home]);
  game.persist();
  audio.buy();
};
game.unplace = (slot) => {
  const s = S();
  const map = s.placed[s.home] || {};
  const itemId = map[slot];
  if (!itemId) return;
  delete map[slot];
  s.furniture.push(itemId);
  if (game.interior) game.interior.refreshFurniture(map);
  game.persist();
  audio.click();
};

// expose catalog bits needed by ui without extra imports there
game._catalog = { FURNITURE };

// ── cars spawning ──
function spawnCars() {
  for (const c of game.ownCars) scene.remove(c.mesh);
  game.ownCars = [];
  const spot = HOUSE_SPOTS[S().home];
  S().cars.forEach((id, i) => {
    const c = carById(id);
    const mesh = buildCar(c.color, c.speed > 30 ? 1 : 0);
    const ang = spot.rot + Math.PI / 2;
    mesh.position.set(spot.x + Math.sin(ang) * (4 + i * 3), 0, spot.z + Math.cos(ang) * (4 + i * 3));
    mesh.rotation.y = ang;
    scene.add(mesh);
    game.ownCars.push({ id, name: c.name, mesh, stats: c });
  });
}

// ── MP orchestration ──
game.mpHost = async () => {
  game.mp = new MP();
  return await game.mp.host();
};
game.mpAccept = async (code) => { await game.mp.hostAccept(code); };
game.mpJoin = async (code) => {
  game.mp = new MP();
  return await game.mp.join(code);
};
game.mpSendChat = (msg) => game.mp?.sendChat(msg);
game.startMP = () => {
  $('mpMenu').classList.remove('on');
  $('mainMenu').classList.remove('on');
  if (!game.interior && game.state === 'menu') {
    if (game.hasSave()) beginPlay(false);
    else beginPlay(true);
  }
  const mp = game.mp;
  mp.onConnect = () => {
    game.toast(' Friend connected!');
    mp.hello(S().name, (S().day * 7 + S().followers) % 97 || 5);
    $('chatToggle').classList.add('on');
  };
  mp.onChat = (msg) => game._chatLog(mp.partner?.name || 'friend', msg);
  mp.onEvent = (ev) => {
    if (ev.t === 'hello') game.toast(`👋 <b>${ev.name}</b> joined your town!`);
    else if (ev.t === 'stream') game.toast(ev.on ? '🔴 Your friend just went LIVE!' : '⚫ Your friend ended their stream.');
    else if (ev.t === 'buy') game.toast(`🛍️ Your friend bought ${ev.what}!`);
  };
  mp.onClose = () => { game.toast('🔌 Friend disconnected.', true); };
};

// ── game start / states ──
function beginPlay(fresh) {
  if (fresh) {
    clearSave();
    game.save = loadSave();
    game.save.mail.unshift({ day: 1, title: '👋 Welcome to Cedar Creek', body: 'Mom said "no streamers in the house", so now you have a room above the noodle shop. Buy a mic, go live, become a legend. The PC is on your desk. — the universe' });
  }
  game.state = 'play';
  $('mainMenu').classList.remove('on');
  $('hud').classList.add('on');
  spawnCars();
  enterHouse(S().home);
  game.refreshHUD();
  game.questCheck();
}
game.newGame = () => beginPlay(true);
game.continueGame = () => beginPlay(false);
game.quitToMenu = () => {
  game.state = 'menu';
  game.paused = false;
  $('pauseMenu').classList.remove('on');
  $('hud').classList.remove('on');
  closePC();
  if (game.interior) { scene.remove(game.interior.group); game.interior = null; }
  if (player.car) player.exitCar();
  $('mainMenu').classList.add('on');
  $('btnPlay').innerHTML = '▶ CONTINUE';
};
game.togglePause = (on) => {
  game.paused = on;
  $('pauseMenu').classList.toggle('on', on);
  if (on && document.pointerLockElement) document.exitPointerLock();
};

game.refreshHUD = () => game._updateHUD && game._updateHUD();
game.toast = (h, w) => game._toast && game._toast(h, w);

// ── input ──
function wireInput() {
  const setK = (code, v) => {
    if (code === 'KeyW' || code === 'ArrowUp') player.keys.f = v;
    else if (code === 'KeyS' || code === 'ArrowDown') player.keys.b = v;
    else if (code === 'KeyA' || code === 'ArrowLeft') player.keys.l = v;
    else if (code === 'KeyD' || code === 'ArrowRight') player.keys.r = v;
    else if (code === 'ShiftLeft' || code === 'ShiftRight') player.keys.run = v;
  };
  game.setKey = (k, v) => { player.keys[k] = v; };
  addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    audio.unlock();
    if (e.code === 'Escape') { if (game.state === 'play') game.togglePause(!game.paused); return; }
    if (game.state !== 'play') return;
    setK(e.code, true);
    if (e.code === 'KeyE') doInteract();
    if (e.code === 'KeyQ' && player.car) { player.exitCar(); game._setPrompt(null); }
    if (e.code === 'KeyB' && game.interior && !player.car) game._openDecorate();
    if (e.code === 'KeyT' && game.mp?.connected) { e.preventDefault(); $('chatRow').classList.add('on'); $('chatInput').focus(); }
  });
  addEventListener('keyup', (e) => setK(e.code, false));

  // mouse look (pointer lock on desktop)
  const canvas = renderer.domElement;
  canvas.addEventListener('click', () => {
    audio.unlock();
    if (!isTouch() && game.state === 'play' && !game.paused) canvas.requestPointerLock?.();
  });
  addEventListener('mousemove', (e) => {
    if (document.pointerLockElement === canvas && !game.drivingLocked) player.addLook(e.movementX, e.movementY, game.settings.sens);
  });

  // touch look: drag on right half
  let lookId = null, lx = 0, ly = 0;
  addEventListener('touchstart', (e) => {
    audio.unlock();
    for (const t of e.changedTouches) {
      if (t.clientX > innerWidth * 0.45 && lookId === null && !e.target.closest('#touch,#hud,.on')) {
        lookId = t.identifier; lx = t.clientX; ly = t.clientY;
      }
    }
  }, { passive: true });
  addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) if (t.identifier === lookId) {
      if (!game.drivingLocked) player.addLook((t.clientX - lx) * 1.6, (t.clientY - ly) * 1.6, game.settings.sens);
      lx = t.clientX; ly = t.clientY;
    }
  }, { passive: true });
  addEventListener('touchend', (e) => { for (const t of e.changedTouches) if (t.identifier === lookId) lookId = null; });

  game.touchMove = (x, y) => {
    player.keys.r = x > 0.25; player.keys.l = x < -0.25;
    player.keys.f = y > 0.25; player.keys.b = y < -0.25;
  };

  // touch / extra buttons
  if ($('btnE')) $('btnE').onclick = () => { audio.unlock(); doInteract(); };
  if ($('btnBrake')) {
    $('btnBrake').onpointerdown = () => (game.handbrake = true);
    $('btnBrake').onpointerup = () => (game.handbrake = false);
    $('btnBrake').onpointerleave = () => (game.handbrake = false);
  }
  if ($('btnDecorate')) $('btnDecorate').onclick = () => { if (game.interior) game._openDecorate(); };
}

// ── settings ──
game.applySettings = () => {
  const s = game.settings;
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, s.quality === 'low' ? 1 : 2));
  renderer.shadowMap.enabled = s.quality !== 'low';
  camera.fov = s.fov;
  camera.updateProjectionMatrix();
  audio.setVolumes({ master: s.master, music: s.music, sfx: s.sfx });
  persistSettings(s);
};

// Android back button (WebView shell)
window.__back = () => {
  if (game.state === 'play' && !game.paused) game.togglePause(true);
};

boot();
