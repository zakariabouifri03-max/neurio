// ---------- Streamer Life Sim 2 — main ----------
import * as THREE from 'three';
import { buildWorld } from './world.js';
import { Player } from './player.js';
import { PC } from './pc.js';
import { MPClient, defaultWSUrl } from './net.js';
import { loadSave, storeSave, wipeSave } from './save.js';
import * as A from './audio.js';
import { fmt$, clamp, damp, el, isTouch, mulberry32 } from './util.js';
import { HOUSES, CARS, itemById, STREAM_CATS } from './data.js';

const $ = (id) => document.getElementById(id);
const save = loadSave();
const TOUCH = isTouch();

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, canvas: $('gl') });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.1, 600);
scene.add(camera);

scene.fog = new THREE.Fog(0x9fb4c4, 60, 240);
const hemi = new THREE.HemisphereLight(0xbdd0e0, 0x3a4a30, 0.9); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2d8, 2.2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -90; sun.shadow.camera.right = 90;
sun.shadow.camera.top = 90; sun.shadow.camera.bottom = -90;
sun.shadow.camera.far = 400;
sun.shadow.bias = -0.0006;
scene.add(sun); scene.add(sun.target);

// clouds
const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false });
const clouds = [];
{
  const rng = mulberry32(77);
  for (let i = 0; i < 16; i++) {
    const g = new THREE.Group();
    for (let j = 0; j < 4; j++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(8 + rng() * 10, 10, 8), cloudMat);
      m.scale.y = 0.35; m.position.set((rng() - 0.5) * 24, (rng() - 0.5) * 3, (rng() - 0.5) * 14);
      g.add(m);
    }
    g.position.set((rng() - 0.5) * 400, 70 + rng() * 30, (rng() - 0.5) * 400);
    scene.add(g); clouds.push(g);
  }
}

const W = buildWorld(scene);
const player = new Player(camera, W);

// ---------- game state ----------
const G = {
  state: 'menu',
  timeMin: save.timeMin,
  live: false, viewers: 0,
  bitrate: 3900, cat: 'Just Chatting', quality: '720p',
  virus: false,
  mp: null,
  interactTarget: null,
  chatOpen: false,
};

// ---------- stream score ----------
function equippedBest() {
  const best = {};
  for (const id of save.ownedItems) {
    const it = itemById(id); if (!it) continue;
    if (!best[it.cat] || it.score > best[it.cat].score) best[it.cat] = it;
  }
  return best;
}
function streamScore() {
  const b = equippedBest();
  let s = 0; for (const c in b) s += b[c].score;
  return s;
}

// ---------- PC hooks ----------
const pc = new PC($('pcui'), save, {
  getScore: streamScore,
  getBitrate: () => G.bitrate, setBitrate: (v) => G.bitrate = v,
  getCat: () => G.cat, setCat: (v) => G.cat = v,
  getQuality: () => G.quality, setQuality: (v) => G.quality = v,
  getMicKbps: () => 32 + (equippedBest().mic?.score || 0) * 8,
  hasVirus: () => G.virus,
  cleanVirus: () => { G.virus = false; pc.setVirus(false); toast('🧹 Virus removed!'); },
  toggleStream: () => {
    G.live = !G.live;
    if (G.live) G.everLive = true;
    pc.setLive(G.live);
    if (G.live) { A.sLive(); toast('🔴 You are LIVE!'); mpChat('📡 went live!'); hud(); }
    else { A.sBack(); toast('⬛ Stream ended. +' + fmt$(0)); }
  },
  getStats: () => ({ viewers: G.viewers, followers: save.followers }),
  onBuy: (id) => {
    const it = itemById(id);
    save.money -= it.price;
    save.ownedItems.push(id);
    applyRoomVisuals();
    toast('🛒 Bought ' + it.name + '!');
    mpChat('🛒 bought ' + it.name);
    hud();
  },
  toast, save: () => storeSave(save),
  onPC: (open) => {
    if (open === false && G.state === 'pc') { G.state = 'play'; if (!TOUCH) lockPointer(); }
  },
});

// ---------- room visuals per upgrades ----------
function applyRoomVisuals() {
  const b = equippedBest();
  for (const hid in W.interiors) {
    const it = W.interiors[hid];
    const mon = b.mon?.score || 1;
    it.monitor.scale.setScalar(0.8 + mon * 0.06);
    it.screen.scale.setScalar(0.8 + mon * 0.06);
    it.screen.material.emissive.setHex(b.lamp?.id === 'lamp_rgb' ? 0xff44ff : 0x1a4a7a);
    const chairCol = b.chair?.id === 'chair_g' ? 0xa02020 : b.chair?.id === 'chair_2' ? 0x2a2a2a : 0x4a3a28;
    it.chair.children.forEach(c => c.material.color.setHex(chairCol));
    const deskCol = b.desk?.id === 'desk_g' ? 0x111111 : b.desk?.id === 'desk_2' ? 0x8a8a8a : 0x6a4a2e;
    it.desk.children.forEach(c => c.material.color.setHex(deskCol));
  }
}
applyRoomVisuals();

// ---------- UI helpers ----------
let toastT = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), 3200);
}
function hud() {
  $('hud-money').textContent = fmt$(save.money);
  $('hud-fol').textContent = '❤️ ' + Math.floor(save.followers);
  $('hud-live').style.display = G.live ? 'flex' : 'none';
  if (G.live) $('hud-viewers').textContent = Math.floor(G.viewers);
  const ever = G.everLive || save.followers > 0;
  $('hud-goal').textContent = !ever
    ? '🎯 Use your PC (E) → OPS → START STREAMING'
    : save.ownedHouses.length === 1
      ? '🎯 Save $1,500 → buy the Wooden Cabin (FOR SALE sign)'
      : '🎯 Upgrade gear on Zamazor → grow your stream!';
}
function mpChat(msg) { if (G.mp) G.mp.chatMsg(msg); }

// ---------- input ----------
const keys = {};
const input = { fwd: 0, strafe: 0, run: false, brake: 0 };
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  keys[e.code] = true;
  if (G.chatOpen) return;
  if (e.code === 'KeyE') doInteract();
  if (e.code === 'Enter' && G.state === 'play' && !TOUCH) openChat();
  if (e.code === 'Escape') {
    if (G.state === 'pc') { pc.close(); }
    else if (G.state === 'play') pauseGame();
    else if (G.state === 'pause') resumeGame();
  }
});
addEventListener('keyup', (e) => keys[e.code] = false);

function lockPointer() {
  try { renderer.domElement.requestPointerLock(); } catch {}
}
document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement === renderer.domElement && G.state === 'play') {
    player.look(e.movementX, e.movementY);
  }
});
renderer.domElement.addEventListener('click', () => {
  if (G.state === 'play' && !TOUCH && document.pointerLockElement !== renderer.domElement) lockPointer();
});

function readKeys() {
  if (G.chatOpen) { input.fwd = input.strafe = 0; input.run = false; return; }
  input.fwd = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0) + (touchIn.fwd || 0);
  input.strafe = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0) + (touchIn.strafe || 0);
  input.run = !!keys.ShiftLeft || !!keys.ShiftRight || touchIn.run;
  input.brake = touchIn.brake || 0;
  input.fwd = clamp(input.fwd, -1, 1);
  input.strafe = clamp(input.strafe, -1, 1);
}
const touchIn = { fwd: 0, strafe: 0, run: false, brake: 0 };

// ---------- touch controls ----------
if (TOUCH) {
  $('touch').style.display = 'block';
  // left joystick
  const stick = $('stick'), knob = $('stick-knob');
  let sid = null, sx = 0, sy = 0;
  stick.addEventListener('pointerdown', (e) => { sid = e.pointerId; sx = e.clientX; sy = e.clientY; stick.setPointerCapture(sid); });
  stick.addEventListener('pointermove', (e) => {
    if (e.pointerId !== sid) return;
    let dx = (e.clientX - sx) / 50, dy = (e.clientY - sy) / 50;
    const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; }
    knob.style.transform = `translate(${dx * 34}px, ${dy * 34}px)`;
    touchIn.strafe = dx; touchIn.fwd = -dy;
  });
  const endStick = (e) => { if (e.pointerId === sid) { sid = null; touchIn.fwd = touchIn.strafe = 0; knob.style.transform = 'translate(0,0)'; } };
  stick.addEventListener('pointerup', endStick); stick.addEventListener('pointercancel', endStick);
  // look zone
  const look = $('lookzone');
  let lid = null, lx = 0, ly = 0;
  look.addEventListener('pointerdown', (e) => { lid = e.pointerId; lx = e.clientX; ly = e.clientY; look.setPointerCapture(lid); });
  look.addEventListener('pointermove', (e) => {
    if (e.pointerId !== lid) return;
    player.look((e.clientX - lx) * 2.2, (e.clientY - ly) * 2.2);
    lx = e.clientX; ly = e.clientY;
  });
  const endLook = (e) => { if (e.pointerId === lid) lid = null; };
  look.addEventListener('pointerup', endLook); look.addEventListener('pointercancel', endLook);
  $('t-e').onpointerdown = () => doInteract();
  $('t-run').onpointerdown = (e) => { touchIn.run = !touchIn.run; e.target.classList.toggle('on', touchIn.run); };
  $('t-gas').onpointerdown = () => { touchIn.fwd = 1; }; $('t-gas').onpointerup = () => { touchIn.fwd = 0; };
  $('t-brake').onpointerdown = () => { touchIn.brake = 1; }; $('t-brake').onpointerup = () => { touchIn.brake = 0; };
  $('t-left').onpointerdown = () => { touchIn.strafe = -1; }; $('t-left').onpointerup = () => { touchIn.strafe = 0; };
  $('t-right').onpointerdown = () => { touchIn.strafe = 1; }; $('t-right').onpointerup = () => { touchIn.strafe = 0; };
  $('t-chat').onpointerdown = () => openChat();
} else {
  $('t-gas').style.display = $('t-brake').style.display = $('t-left').style.display = $('t-right').style.display = 'none';
}
function touchCarMode(on) {
  if (!TOUCH) return;
  $('t-gas').style.display = $('t-brake').style.display = $('t-left').style.display = $('t-right').style.display = on ? 'block' : 'none';
  $('stick').style.display = on ? 'none' : 'block';
}

// ---------- interact ----------
function nearestInteract(radius) {
  const p = player.mode === 'car' ? player.car.group.position : player.pos;
  let best = null, bd = radius ?? (player.mode === 'car' ? 4.2 : 2.6);
  for (const it of W.interact) {
    const d = p.distanceTo(it.pos);
    if (d < bd) {
      if (it.type === 'pc' && player.mode === 'car') continue;
      best = it; bd = d;
    }
  }
  return best;
}

// floating E marker (helps you spot interactables from far away)
const eMarker = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#f4c818'; g.beginPath(); g.arc(64, 64, 56, 0, 7); g.fill();
  g.strokeStyle = '#111'; g.lineWidth = 10; g.stroke();
  g.fillStyle = '#111'; g.font = '900 78px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('E', 64, 70);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false }));
  s.scale.set(0.8, 0.8, 1); s.visible = false; s.renderOrder = 5;
  scene.add(s);
  return s;
})();
function interactLabel(it) {
  switch (it.type) {
    case 'door': {
      const h = HOUSES.find(h => h.id === it.house);
      return save.ownedHouses.includes(it.house) ? ` Enter ${h.name} [E]` : `🔒 ${h.name} — for sale! [E]`;
    }
    case 'sign': {
      const h = HOUSES.find(h => h.id === it.house);
      if (save.ownedHouses.includes(it.house)) return `🏠 ${h.name} — your house [E]`;
      return `🏠 Buy ${h.name} — ${fmt$(h.price)} [E]`;
    }
    case 'exit': return '🚪 Exit house [E]';
    case 'pc': return '💻 Use PC [E]';
    case 'car': {
      const c = CARS.find(c => c.id === it.car);
      return save.ownedCars.includes(c.id) ? `🚗 Drive ${c.name} [E]` : `🚗 Buy ${c.name} — ${fmt$(c.price)} [E]`;
    }
    default: return it.label ? `${it.label} [E]` : '[E]';
  }
}
function doInteract() {
  if (G.state !== 'play') return;
  if (player.mode === 'car') { player.exitCar(); touchCarMode(false); return; }
  const it = G.interactTarget || nearestInteract();
  if (!it) return;
  switch (it.type) {
    case 'door': {
      const h = HOUSES.find(h => h.id === it.house);
      if (!save.ownedHouses.includes(it.house)) { toast('🔒 Locked! Buy it first — ' + fmt$(h.price)); A.sErr(); return; }
      if (player.mode === 'car') { player.exitCar(); touchCarMode(false); }
      const int = W.interiors[it.house];
      player.pos.copy(int.enterPos); player.yaw = 0; player.pitch = 0;
      save.currentHouse = it.house;
      A.sDoor(); hud();
      break;
    }
    case 'sign': {
      const h = HOUSES.find(h => h.id === it.house);
      if (save.ownedHouses.includes(it.house)) { toast('🏠 This is your house!'); return; }
      if (save.money >= h.price) {
        save.money -= h.price; save.ownedHouses.push(it.house);
        if (W.houses[it.house]?.sign) W.houses[it.house].sign.visible = false;
        A.sBuy(); toast('🎉 You bought ' + h.name + '!'); mpChat('🏠 bought ' + h.name + '!');
        hud();
      } else { A.sErr(); toast('❌ Need ' + fmt$(h.price) + ' for ' + h.name); }
      break;
    }
    case 'exit': {
      const h = HOUSES.find(h => h.id === it.house);
      const d = W.interact.find(x => x.type === 'door' && x.house === it.house);
      const out = d.pos.clone(); out.y = 1.7;
      player.pos.copy(out); player.pos.z += 1.2; player.yaw = Math.PI; player.pitch = 0;
      A.sDoor();
      break;
    }
    case 'pc': {
      G.state = 'pc';
      document.exitPointerLock?.();
      pc.open('ops');
      A.sClick();
      break;
    }
    case 'car': {
      const c = CARS.find(c => c.id === it.car);
      if (!save.ownedCars.includes(c.id)) {
        if (save.money >= c.price) { save.money -= c.price; save.ownedCars.push(c.id); A.sBuy(); toast('🎉 You bought ' + c.name + '!'); hud(); }
        else { A.sErr(); toast('❌ Need ' + fmt$(c.price)); return; }
      }
      if (player.mode === 'walk') { player.enterCar(W.cars[it.car]); touchCarMode(true); }
      break;
    }
    default: toast(it.get ? it.get() : '...'); A.sClick();
  }
}

// ---------- chat ----------
function openChat() {
  if (G.state !== 'play') return;
  G.chatOpen = true;
  document.exitPointerLock?.();
  $('chat-input').style.display = 'block';
  $('chat-input').focus();
}
$('chat-input').addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter') {
    const v = $('chat-input').value.trim();
    if (v) { chatAdd(save.settings.name, v, true); mpChat(v); }
    $('chat-input').value = '';
    closeChat();
  }
  if (e.key === 'Escape') closeChat();
});
function closeChat() {
  G.chatOpen = false;
  $('chat-input').style.display = 'none';
  if (!TOUCH && G.state === 'play') lockPointer();
}
function chatAdd(name, msg, self = false) {
  const d = el('div', 'chat-msg', `<b style="color:${self ? '#8f8' : '#8cf'}">${name}:</b> ${msg}`);
  const box = $('chat-msgs');
  box.appendChild(d);
  while (box.children.length > 8) box.removeChild(box.firstChild);
}

// ---------- pause ----------
function pauseGame() {
  if (G.state !== 'play') return;
  G.state = 'pause';
  document.exitPointerLock?.();
  $('pause').style.display = 'flex';
}
function resumeGame() {
  $('pause').style.display = 'none';
  G.state = 'play';
  if (!TOUCH) lockPointer();
}
$('p-resume').onpointerdown = resumeGame;
$('p-settings').onpointerdown = () => { $('pause').style.display = 'none'; openSettings('pause'); };
$('p-save').onpointerdown = () => { storeSave(save); toast('💾 Saved!'); };
$('p-quit').onpointerdown = () => { quitToMenu(); };

// ---------- settings ----------
let settingsReturn = 'menu';
function openSettings(ret) {
  settingsReturn = ret;
  $('settings').style.display = 'flex';
  const s = save.settings;
  $('set-quality').value = s.quality;
  $('set-shadows').checked = s.shadows;
  $('set-vol').value = s.volume;
  $('set-sens').value = s.sensitivity;
  $('set-invert').checked = s.invertY;
  $('set-name').value = s.name;
}
function closeSettings() {
  $('settings').style.display = 'none';
  if (settingsReturn === 'pause') $('pause').style.display = 'flex';
}
$('set-close').onpointerdown = closeSettings;
$('set-apply').onpointerdown = () => { applySettings(); closeSettings(); };
function applySettings() {
  const s = save.settings;
  s.quality = $('set-quality').value;
  s.shadows = $('set-shadows').checked;
  s.volume = +$('set-vol').value;
  s.sensitivity = +$('set-sens').value;
  s.invertY = $('set-invert').checked;
  s.name = $('set-name').value.trim() || s.name;
  A.setVolume(s.volume);
  player.sens = s.sensitivity; player.invertY = s.invertY;
  applyQuality();
  storeSave(save);
}
function applyQuality() {
  const s = save.settings;
  const pr = s.quality === 'high' ? Math.min(devicePixelRatio, 2) : s.quality === 'medium' ? Math.min(devicePixelRatio, 1.25) : 0.75;
  renderer.setPixelRatio(pr);
  renderer.shadowMap.enabled = s.shadows;
  sun.castShadow = s.shadows;
  scene.fog.far = s.quality === 'low' ? 140 : s.quality === 'medium' ? 200 : 260;
  W.updateFog?.();
}
applySettings();
$('set-reset').onpointerdown = () => { if (confirm('Reset ALL progress?')) { wipeSave(); location.reload(); } };

// ---------- menu ----------
$('m-play').onpointerdown = () => { A.sClick(); startGame(); };
$('m-mp').onpointerdown = () => { A.sClick(); $('mp-name').value = save.settings.name; $('mp').style.display = 'flex'; };
$('m-settings').onpointerdown = () => { A.sClick(); openSettings('menu'); };
$('m-quit').onpointerdown = () => {
  A.sBack();
  $('menu').style.display = 'none';
  $('quit').style.display = 'flex';
};
$('mp-back').onpointerdown = () => { A.sBack(); $('mp').style.display = 'none'; };
$('mp-create').onpointerdown = () => { A.sClick(); startMP(genRoom()); };
$('mp-join').onpointerdown = () => { A.sClick(); const r = $('mp-code').value.trim().toUpperCase(); if (r.length >= 4) startMP(r); else toast('Enter a room code'); };
$('mp-server').value = defaultWSUrl();
function genRoom() { return Math.random().toString(36).slice(2, 7).toUpperCase(); }

function startMP(room) {
  save.settings.name = ($('mp-name').value.trim() || save.settings.name).slice(0, 14);
  const url = $('mp-server').value.trim() || defaultWSUrl();
  $('mp').style.display = 'none';
  toast('🌐 Connecting to room ' + room + '…');
  startGame();
  connectMP(url, room);
}
function connectMP(url, room) {
  G.mp = new MPClient(url, room, save.settings.name, {
    ready: (players) => {
      toast('✅ Connected! Room code: ' + room + ' — share it with a friend.');
      $('hud-room').style.display = 'block';
      $('hud-room').textContent = '🌐 ' + room;
      for (const id in players) if (id !== G.mp.me) spawnRemote(id, players[id]);
    },
    join: (m) => { spawnRemote(m.id, m); toast('👋 ' + m.name + ' joined!'); chatAdd(m.name, 'joined the town'); },
    leave: (id) => { removeRemote(id); toast('🚪 A player left'); },
    chat: (m) => chatAdd(m.name, m.msg),
    error: (msg) => toast('⚠️ ' + msg),
    close: () => { G.mp = null; },
  });
  G.mpRoom = room;
}

// ---------- remote players ----------
const remotes = new Map();
function spawnRemote(id, info) {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0xd8a878 });
  const shirt = new THREE.MeshStandardMaterial({ color: (parseInt(id, 36) % 0xffffff) | 0x404040 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.28), shirt); torso.position.y = 1.15; g.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 10), skin); head.position.y = 1.68; g.add(head);
  const legG = new THREE.BoxGeometry(0.16, 0.8, 0.16); legG.translate(0, -0.4, 0);
  const legL = new THREE.Mesh(legG, new THREE.MeshStandardMaterial({ color: 0x2a2a3a })); legL.position.set(-0.14, 0.8, 0); g.add(legL);
  const legR = legL.clone(); legR.position.x = 0.14; g.add(legR);
  const carBox = new THREE.Mesh(new THREE.BoxGeometry(2, 1.3, 4.4), shirt); carBox.position.y = 0.8; carBox.visible = false; g.add(carBox);
  // name tag
  const cnv = document.createElement('canvas'); cnv.width = 256; cnv.height = 64;
  const cx = cnv.getContext('2d');
  cx.font = 'bold 34px Arial'; cx.textAlign = 'center'; cx.textBaseline = 'middle';
  cx.strokeStyle = 'rgba(0,0,0,.8)'; cx.lineWidth = 6; cx.strokeText(info.name || 'Player', 128, 32);
  cx.fillStyle = '#fff'; cx.fillText(info.name || 'Player', 128, 32);
  const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cnv), transparent: true }));
  tag.scale.set(2.2, 0.55, 1); tag.position.y = 2.2; g.add(tag);
  scene.add(g);
  remotes.set(id, { g, legL, legR, carBox, torso, head, tx: 0, tz: 0, tyaw: 0, mode: 'walk', t: 0 });
}
function removeRemote(id) {
  const r = remotes.get(id);
  if (r) { scene.remove(r.g); remotes.delete(id); }
}
function updateRemotes(dt) {
  for (const [id, r] of remotes) {
    const st = G.mp?.players.get(id);
    if (!st) continue;
    r.tx = st.x; r.tz = st.z; r.tyaw = st.yaw; r.mode = st.mode;
    r.g.position.x = damp(r.g.position.x, r.tx, 10, dt);
    r.g.position.z = damp(r.g.position.z, r.tz, 10, dt);
    r.g.rotation.y = r.tyaw;
    const inCar = r.mode === 'car';
    r.carBox.visible = inCar;
    r.torso.visible = r.head.visible = r.legL.visible = r.legR.visible = !inCar;
    if (!inCar) {
      r.t += dt * 6;
      const sw = Math.sin(r.t) * 0.5;
      r.legL.rotation.x = sw; r.legR.rotation.x = -sw;
    }
  }
}

// ---------- game start / quit ----------
function startGame() {
  $('menu').style.display = 'none';
  $('quit').style.display = 'none';
  $('hud').style.display = 'block';
  G.state = 'play';
  // spawn at current house exterior
  const h = HOUSES.find(h => h.id === save.currentHouse) || HOUSES[0];
  const d = W.interact.find(x => x.type === 'door' && x.house === h.id);
  if (d) { player.pos.set(d.pos.x, 1.7, d.pos.z + 2); }
  player.yaw = Math.PI;
  hud();
  if (!TOUCH) lockPointer();
  toast('🎮 Welcome to your streamer life! Use your PC to go live.');
}
function quitToMenu() {
  storeSave(save);
  if (G.mp) { G.mp.close(); G.mp = null; }
  remotes.forEach((r) => scene.remove(r.g)); remotes.clear();
  $('hud-room').style.display = 'none';
  if (player.mode === 'car') { player.exitCar(); touchCarMode(false); }
  G.state = 'menu'; G.live = false; pc.setLive(false);
  $('pause').style.display = 'none';
  $('hud').style.display = 'none';
  $('menu').style.display = 'flex';
}

// ---------- day / night ----------
function updateSky(dt) {
  G.timeMin = (G.timeMin + dt * 1.0) % 1440;   // 1s = 1min
  save.timeMin = G.timeMin;
  const h = G.timeMin / 60;
  // daylight factor: 6..8 sunrise, 18..20 sunset
  const day = clamp(Math.min((h - 6) / 2, (20 - h) / 2, 1), 0, 1);
  const overcast = 0.75; // cloudy town vibe
  const skyDay = new THREE.Color(0x9fb4c4), skyNight = new THREE.Color(0x0a1020);
  const col = skyNight.clone().lerp(skyDay, day * overcast + 0.15 * day);
  scene.background = col;
  scene.fog.color.copy(col);
  sun.intensity = 0.15 + day * 2.1;
  hemi.intensity = 0.25 + day * 0.75;
  const ang = ((h - 6) / 14) * Math.PI;
  sun.position.set(Math.cos(ang) * 120, Math.sin(ang) * 120 + 10, 60);
  sun.target.position.set(0, 0, 0);
  // night lights
  const night = 1 - day;
  for (const m of W.windowMats) m.emissiveIntensity = night * 1.2;
  for (const m of W.lampMats) m.emissiveIntensity = night * 2.2;
  $('hud-clock').textContent = '🕐 ' + String(Math.floor(h)).padStart(2, '0') + ':' + String(Math.floor(G.timeMin % 60)).padStart(2, '0');
  pc.setClock(G.timeMin);
}

// ---------- streaming economy ----------
function updateStream(dt) {
  if (!G.live) { G.viewers = damp(G.viewers, 0, 2, dt); return; }
  const score = streamScore();
  const catM = (STREAM_CATS.find(c => c[0] === G.cat) || [0, 1])[1];
  const qM = { '480p': 0.8, '720p': 1, '1080p': 1.25, '4K': 1.6 }[G.quality] || 1;
  const brM = clamp(G.bitrate / 6000, 0.7, 1.2);
  let target = (score * 3 + 6) * catM * qM * brM * (1 + save.followers / 300);
  if (G.virus) target *= 0.35;
  target *= 0.9 + 0.2 * Math.sin(G.timeMin * 0.7);
  G.viewers = damp(G.viewers, target, 0.25, dt);
  save.money += G.viewers * 0.06 * dt;
  save.followers += G.viewers * 0.02 * dt;
  if (!G.virus && Math.random() < dt * 0.004) {
    G.virus = true; pc.setVirus(true);
    A.sNotify(); toast('⚠️ Virus detected! Your stream is lagging. Run Virus Scanner!');
  }
  pc.updateOpsStats();
  hud();
}

// ---------- main loop ----------
let last = performance.now(), mpAcc = 0, saveAcc = 0, menuT = 0;
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (G.state === 'menu' || G.state === 'quit') {
    menuT += dt * 0.06;
    camera.position.set(Math.cos(menuT) * 55, 16 + Math.sin(menuT * 0.7) * 4, Math.sin(menuT) * 55);
    camera.lookAt(0, 2, 0);
    camera.rotation.z = 0;
    updateSky(dt * 0); // keep static time in menu? keep moving slowly:
    W.update(dt, now / 1000);
  } else {
    W.update(dt, now / 1000);
    updateSky(dt);
    updateStream(dt);
    if (G.state === 'play') {
      readKeys();
      player.update(dt, input);
      // speedometer
      if (player.mode === 'car') {
        $('speedo').style.display = 'block';
        $('speedo').textContent = Math.floor(Math.abs(player.car.speed) * 3.6) + ' km/h';
      } else $('speedo').style.display = 'none';
      // interact prompt + floating E marker
      const it = nearestInteract();
      G.interactTarget = it;
      const mk = nearestInteract(11);
      if (mk) {
        eMarker.visible = true;
        eMarker.position.set(mk.pos.x, 2.3 + Math.sin(now / 300) * 0.12, mk.pos.z);
      } else eMarker.visible = false;
      if (player.mode === 'car') {
        $('prompt').textContent = '🚪 Exit car [E]';
        $('prompt').style.display = 'block';
        if (TOUCH) $('t-e').style.display = 'block';
      } else if (it) {
        $('prompt').textContent = interactLabel(it);
        $('prompt').style.display = 'block';
        if (TOUCH) $('t-e').style.display = 'block';
      } else {
        $('prompt').style.display = 'none';
        if (TOUCH) $('t-e').style.display = 'none';
      }
      // multiplayer sync
      if (G.mp) {
        mpAcc += dt;
        if (mpAcc > 0.1) {
          mpAcc = 0;
          const p = player.mode === 'car' ? player.car.group.position : player.pos;
          G.mp.state({ x: +p.x.toFixed(2), z: +p.z.toFixed(2), yaw: +(player.mode === 'car' ? player.car.yaw : player.yaw).toFixed(2), mode: player.mode });
        }
      }
    } else {
      $('prompt').style.display = 'none';
    }
    if (G.mp) updateRemotes(dt);
    saveAcc += dt;
    if (saveAcc > 5) { saveAcc = 0; storeSave(save); }
  }
  renderer.render(scene, camera);
}
requestAnimationFrame(loop);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
renderer.setSize(innerWidth, innerHeight);

// initial menu sky
scene.background = new THREE.Color(0x9fb4c4);
updateSky(0);
hud();

// PWA offline install
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
