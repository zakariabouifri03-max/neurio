// ═════════════════════════════════════════════════════════════════════════════
// SWINDLE SQUAD — client entry point.
//   · owns the renderer, the room, the characters and the camera
//   · owns nothing that matters: scores/roles/deals all come from the authority
// ═════════════════════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { Room3D, CameraRig, PRESETS, seatTransform, SEATS } from './room3d.js';
import { Character, Nameplate, EXPR } from './chars.js';
import { FX } from './fx.js';
import { Post } from './post.js';
import { UI } from './ui.js';
import { GameClient } from './net.js';
import { audio } from './audio.js';
import { load, save, patch, setAvatar, setName } from './save.js';
import { CFG, EMOTES, TAGS, ROLE_BY_ID, GAME_TITLE, PROTO } from '../../shared/content.js';
import { $, el, clamp, lerp, fmt, signed, toast, burst, isTouch, haptic } from './util.js';
import { mulberry32 } from '../../shared/util.js';

window.__audio = audio;
const prof = load();
document.getElementById('protoTag').textContent = 'proto ' + PROTO;

// ── renderer / scene ──────────────────────────────────────────────────────────
const canvas = $('#gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', stencil: false });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;   // the post pass tone-maps
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

let quality = prof.settings.quality || 'high';
const room3d = new Room3D(quality);
const scene = room3d.scene;
const camera = new THREE.PerspectiveCamera(34, 1, 0.4, 90);
const rig = new CameraRig(camera, room3d);
const fx = new FX(scene, quality);
const post = new Post(renderer, scene, camera);

const chars = new Map();      // pid -> {c, plate, net:{x,z,r}, lastNet}
let me = null;                // my pid
let state = null;             // last authoritative snapshot
let mode = 'menu';            // menu | lobby | game
let myPos = { x: 0, z: 4.6, r: Math.PI };
let myVel = { x: 0, z: 0 };
let seated = false;
const clock = new THREE.Clock();
const keys = new Set();
let customizing = false;
let thClosed = false;
let lastSent = 0, fpsAcc = 0, fpsN = 0, fpsShown = 0, lowSince = 0;
let revealSeen = 0, lastPhase = '', lastRound = -1, awardFxFor = new Set();
let interactHint = null;
const rng = mulberry32(1234);

// menu backdrop characters
const menuCrew = [];
function buildMenuCrew() {
  const faces = [0, 3, 6, 2];
  for (let i = 0; i < 4; i++) {
    const c = new Character({ skin: i, face: faces[i], hair: (i * 3) % 10, hat: [-1, 0, 2, 5][i], glasses: [-1, 2, 0, -1][i], shirt: 1 + i, pants: i % 3, shoes: i % 4, acc: [-1, 0, 1, -1][i], color: (i * 3) % 14, hairColor: (i * 5) % 14 });
    const a = (i / 4) * Math.PI * 2 + 0.6;
    c.root.position.set(Math.sin(a) * 3.3, 0, Math.cos(a) * 3.3);
    c.root.rotation.y = a + Math.PI;
    c.expr = { ...EXPR.laugh }; c.target = { ...EXPR.smug };
    scene.add(c.root); menuCrew.push(c);
  }
}
buildMenuCrew();

// ── sizing / quality ───────────────────────────────────────────────────────────
function applyQuality(q) {
  quality = q;
  const P = PRESETS[q] || PRESETS.high;
  renderer.setPixelRatio(Math.min(P.dpr, window.devicePixelRatio || 1) * (window.devicePixelRatio > 2 ? 0.9 : 1));
  renderer.shadowMap.enabled = !!P.shadow;
  room3d.setQuality(q);
  post.enabled = !!P.bloom;
  post.params.bloom = q === 'low' ? 0 : q === 'medium' ? 0.5 : 0.66;
  post.params.grain = q === 'ultra' ? 0.05 : q === 'low' ? 0 : 0.03;
  post.params.aberr = q === 'ultra' ? 1.6 : q === 'low' ? 0 : 1;
  fx.setQuality(q);
  scene.traverse((o) => { if (o.isMesh && o.material) o.material.needsUpdate = true; });
}
function resize() {
  const w = innerWidth, h = innerHeight;
  const P = PRESETS[quality] || PRESETS.high;
  renderer.setSize(w, h, false);
  const dpr = Math.min(P.dpr, window.devicePixelRatio || 1);
  renderer.setPixelRatio(dpr);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  post.setSize(Math.max(2, (w * dpr) | 0), Math.max(2, (h * dpr) | 0));
}
addEventListener('resize', resize);

// ── the client (net or local) ─────────────────────────────────────────────────
const client = new GameClient({
  onStatus: (k, d) => {
    ui.setStatus(k, d?.why === 'noroom' ? 'no room with that code' : d?.why === 'full' ? 'that table is full (8 seats)' : d?.why === 'version' ? 'game updated — reload the page' : undefined);
    if (k === 'error') toast('Could not reach the room — you can still play a solo table', 'bad');
  },
  onMsg: (m) => onMessage(m),
});

const ui = new UI({
  quick: () => startSolo(),
  create: () => startOnline('create'),
  join: (code) => startOnline('join', code),
  ready: (on) => client.send({ t: 'ready', on }),
  start: () => client.start(),
  commit: (id) => client.commit(id),
  commitLock: () => { const c = state?.me?.commit; if (c) { client.commit(c); audio.stamp(); ui.banner('LOCKED IN', 'the table cannot see what — only that you did'); } },
  uncommit: () => client.act('uncommit', {}),
  push: (on) => { client.push(on); audio.pop(on ? 1.3 : 0.8); },
  action: (id, p) => { client.act(id, p); audio.deal(); },
  accuse: (t) => { client.accuse(t); audio.lie(); toast(t ? 'You named ' + ui.nameOf(t) + ' in front of everyone' : 'Suspicion withdrawn', t ? 'bad' : ''); },
  offer: (o) => { client.offer(o); audio.deal(); },
  offerResp: (id, accept) => { client.offerResp(id, accept); accept ? audio.good() : audio.bad(); },
  offerVoid: (id, on) => { client.offerVoid(id, on); on ? audio.lie() : audio.pop(); toast(on ? 'Loophole armed. If a Detective flagged you, you are finished.' : 'You will honour it. How quaint.', on ? 'bad' : 'good'); },
  chat: (text, quick) => { client.chat(text, quick); audio.pop(0.8); },
  emote: (id) => { client.emote(id); },
  avatar: (a) => { client.setAvatar(a); rebuildMyChar(); },
  name: (n) => client.setName(n),
  toggleSound: () => { const on = !prof.settings.sfx; prof.settings.sfx = on; audio.setSfx(on); audio.setMusic(prof.settings.music && on); save(); ui.refreshWallet(); toast('Sound ' + (on ? 'on' : 'muted')); },
  musicToggle: (v) => audio.setMusic(v),
  sfxToggle: (v) => audio.setSfx(v),
  quality: (q) => { prof.settings.quality = q; save(); applyQuality(q); resize(); toast('Graphics: ' + q.toUpperCase()); },
  botAdd: () => client.botAdd(),
  botDel: () => client.botDel(),
  kick: (pid) => client.kick(pid),
  setting: (k, v) => client.settings({ [k]: v }),
  spectate: () => { client.spectate(!(state?.players?.find((p) => p.pid === me)?.spectating)); toast('Spectator mode: camera pulls back, chips are safe'); },
  rematch: () => { client.rematch(true); toast('REMATCH — the table resets, the grudges do not', 'good'); },
  toLobby: () => { client.abort(); },
  leave: () => leaveRoom(),
  skipReveal: () => client.skipReveal(),
  theatreBeat: () => {},
  download: () => saveOfflineCopy(),
  modalClosed: () => ui.on.customizeOpen?.(false),
  customizeOpen: (open) => { customizing = open; },
});

// ── session start ──────────────────────────────────────────────────────────────
async function startSolo() {
  audio.unlock(); audio.setMode('menu');
  try {
    await client.solo({ name: prof.name, avatar: prof.avatar, settings: prof.lastRoom, bots: 3 });
    enterSession('local');
    toast('Solo table: three bots, six rounds. Press READY then START.', 'good', 4200);
  } catch (e) { toast('Could not open a local table'); }
}
async function startOnline(action, code) {
  audio.unlock();
  try {
    await client[action === 'join' ? 'join' : 'create']({ name: prof.name, avatar: prof.avatar, code, private: true, settings: prof.lastRoom });
    enterSession('online');
  } catch (e) {
    toast('The house server is not reachable — starting a solo table instead', 'bad', 4200);
    await startSolo();
  }
}
function enterSession(kind) {
  ui.setLocal(kind === 'local');
  mode = 'lobby';
  ui.screen('lobby');
  for (const c of menuCrew) { scene.remove(c.root); }
  menuCrew.length = 0;
  post.params.sat = 1.06;
  audio.setMode('table');
}
function leaveRoom() {
  client.close();
  mode = 'menu';
  ui.screen('menu');
  ui.hideTheatre();
  $('#finalCard').hidden = true;
  for (const [, o] of chars) { scene.remove(o.c.root); o.plate && scene.remove(o.plate.spr); }
  chars.clear();
  buildMenuCrew();
  audio.setMode('menu');
}

// ── authoritative messages ─────────────────────────────────────────────────────
function onMessage(m) {
  switch (m.t) {
    case 'welcome': {
      me = m.pid;
      prof.lastCode = m.code; save();
      patch({ lastCode: m.code });
      toast(m.local ? 'Local table ready' : 'Seat taken — code ' + m.code, 'good');
      break;
    }
    case 'state': onState(m); break;
    case 'chat': {
      ui.chatLine(m.name, m.text, m.pid === 'sys');
      showBubble(m.pid, m.text);
      break;
    }
    case 'emote': {
      const o = chars.get(m.pid);
      const e = EMOTES.find((x) => x.id === m.id);
      if (o) { o.c.playEmote(m.anim, m.dur); if (e) showBubble(m.pid, e.n); }
      audio.emote();
      if (m.pid === me) haptic(10);
      break;
    }
    case 'join': {
      const c = chars.get(m.pid);
      if (!c) toast(m.name + ' walked in', 'good');
      break;
    }
    case 'left': toast(m.name + ' left the table', 'bad'); break;
    case 'kicked': if (m.pid === me) leaveRoom(); break;
    case 'phase': {
      if (m.phase === 'reveal') { audio.setMode('reveal'); audio.riser(1.1); }
      if (m.phase === 'submit') { audio.setMode('tension'); audio.alarm(); }
      if (m.phase === 'talk') { audio.setMode('table'); }
      if (m.phase === 'brief') { audio.setMode('hush'); audio.whoosh(); revealSeen = 0; awardFxFor.clear(); ui.resetTheatre?.(); }
      if (m.phase === 'lock') { audio.gavel(); rig.kick(0.5); }
      break;
    }
    case 'round': onRoundStart(m); break;
    case 'announce': ui.feed(m.text, 'story'); ui.tickerSay?.(m.text); break;
    case 'awards': onAwards(m); break;
    case 'reveal':
      state = state || {};
      state.reveal = { beats: [], cursor: 0 };
      ui.thStart?.(state);
      revealSeen = 0;
      break;
    case 'results': {
      audio.setMode('table');
      if (m.board) ui.feed(leadName(m.board) + ' leads after this round', 'good');
      break;
    }
    case 'final': {
      audio.setMode('menu'); audio.finalHorn(); fx.confetti(4200); rig.kick(1);
      ui.banner('THE FINAL SCORE', leadName({ board: m.board }) + ' takes ' + fmt(m.board?.[0]?.chips || 0) + ' chips', '#ffd23f');
      ui.showFinal({ ...m, me }, prof);
      break;
    }
    case 'rematch': { mode = 'lobby'; ui.screen('lobby'); toast('REMATCH: the deck is reshuffled', 'good'); break; }
    case 'toast': toast(m.text, 'bad'); break;
    case 'settings': { prof.lastRoom = { ...(prof.lastRoom || {}), ...(m.settings || {}) }; save(); break; }
    case 'host': toast(m.name + ' is now hosting', 'bad'); break;
    case 'peek': toast('🗝 ' + m.hint, 'good', 4200); ui.feed('<b>You peeked:</b> ' + esc2(m.hint), 'story'); break;
    case 'offer': { audio.deal(); const o = m.offer; if (o && o.to === me) { toast(o.fromName + ' is sliding something across the table', 'bad'); haptic(20); } break; }
    case 'err': {
      if (m.why === 'version') toast('The game updated underneath you — refresh', 'bad');
      else if (m.why === 'noroom') { $('#joinHint').textContent = 'No room ' + ($('#joinInput').value || '').toUpperCase() + ' — check the letters'; toast('No room with that code', 'bad'); }
      else if (m.why === 'full') toast('That table is full', 'bad');
      break;
    }
    case 'pong': break;
    default: break;
  }
}
const esc2 = (s) => String(s ?? '').replace(/[<>&]/g, '');
const leadName = (board) => (board && board[0] && (board[0].name || state?.players?.find((p) => p.pid === board[0].pid)?.name)) || 'somebody';

function onRoundStart(m) {
  audio.setMode('hush');
  ui.hideTheatre();
  ui.banner(m.icon + ' ' + m.title.toUpperCase(), m.blurb, '#f3ead6');
  revealSeen = 0; awardFxFor.clear();
  fx.clear();
  const i = m.index ?? 0;
  rig.focus(null); rig.wantDist = 15.5; rig.wantPol = 0.72;
  room3d.setBoard(boardFor(m.id), { pot: 0 });
  seated = false;
}
function boardFor(roundId) {
  const map = {
    cases: 'cases', mg_suitcase: 'cases', counterfeit: 'cards', ledger: 'cards', contracts: 'cards', mg_cards: 'cards',
    parcel: 'parcel', mg_button: 'tiles', mg_vault: 'vault', auction: 'hammer', mg_vanish: 'button', mg_fall: 'fall', backstab: 'pot', vouch: 'pot',
  };
  return map[roundId] || 'pot';
}

function onState(v) {
  state = v;
  if (v.phase === 'lobby') { if (mode !== 'lobby') { mode = 'lobby'; ui.screen('lobby'); } }
  else if (mode !== 'game') { mode = 'game'; ui.screen('game'); }
  else ui.screen(mode === 'lobby' ? 'lobby' : 'game');
  syncChars(v);
  ui.hud(v);
  if (mode === 'lobby') ui.renderLobby(v, v.host === me);
  paintScreen(v);
  // reveal pacing
  if (v.phase === 'reveal' && v.reveal) pumpReveal(v);
  if (v.phase === 'brief') ui.objective(v);
  lastPhase = v.phase;
}

// ── reveal: play the server's beats with punch ────────────────────────────────
function pumpReveal(v) {
  const beats = v.reveal?.beats || [];
  while (revealSeen < beats.length) {
    const b = beats[revealSeen++];
    ui.thBeat?.(b, v);
    const target = b.focus ? chars.get(b.focus) : null;
    if (target) { rig.focus(target.c.root.position.clone().setY(1.1), 1.25); target.c.lookTarget = null; }
    else rig.focus(null, 1);
    const tone = b.tone;
    if (tone === 'good') { audio.good(); if (b.pid === me) { fx.chips(target?.c.root.position || new THREE.Vector3(0, 1.2, 0), { count: 14 }); } }
    if (tone === 'bad') { audio.bad(); if (b.pid === me) { rig.kick(0.7); haptic(40); } }
    if (tone === 'trick') { audio.lie(); fx.smoke(target?.c.root.position || new THREE.Vector3(0, 1.2, 0), { count: 10 }); }
    if (target) target.c.setExpr(tone === 'good' ? 'cheer' : tone === 'bad' ? 'worry' : 'sly');
    post.kick(0.24);
    fx.ring(target ? new THREE.Vector3(target.c.root.position.x, 0.03, target.c.root.position.z) : new THREE.Vector3(), { color: tone === 'good' ? '#39e6a0' : tone === 'bad' ? '#ff3d7f' : '#b06cff', r: 1.6, life: 0.7 });
    break;   // one beat per state frame; the authority sets the pace
  }
  if (v.reveal?.done && !thClosed) { thClosed = true; ui.thEnd?.(v); }
}

// ── awards: chips fly, deltas pop, the rail updates ───────────────────────────
function onAwards(m) {
  ui.delta = {};
  for (const a of m.awards) {
    ui.delta[a.pid] = { v: a.delta, at: performance.now() };
    const t = TAGS[a.tag] || { n: a.tag, i: '' };
    const who = state?.players.find((p) => p.pid === a.pid);
    ui.feed(`<b>${esc2(who?.name)}</b> ${signed(a.delta)} · ${t.i} ${t.n} — ${esc2(a.why)}`, a.delta >= 0 ? 'good' : 'bad');
    const o = chars.get(a.pid);
    if (o && !awardFxFor.has(a.pid)) {
      awardFxFor.add(a.pid);
      const p = o.c.root.position.clone().setY(1.5);
      if (a.delta > 180) { fx.chips(p, { count: 20, up: 5 }); fx.beam(new THREE.Vector3(o.c.root.position.x, 0, o.c.root.position.z), { color: '#ffd23f', life: 1.2, r: 0.75 }); }
      else if (a.delta > 0) { fx.chips(p, { count: 9 }); fx.spark(p, { color: '#39e6a0', count: 14 }); }
      else { fx.smoke(p, { count: 12, color: '#7a2a3a' }); fx.spark(p, { color: '#ff3d7f', count: 12, speed: 2 }); }
      fx.float(p, signed(a.delta), { color: a.delta >= 0 ? '#8ff0c6' : '#ff9db8', size: a.delta > 250 ? 1.5 : 1, life: 1.9 });
      o.c.playEmote(a.delta > 0 ? 'count' : 'cry', 1500);
      o.c.setExpr(a.delta > 200 ? 'laugh' : a.delta > 0 ? 'smug' : a.delta < -150 ? 'cry' : 'worry');
    }
    if (a.pid === me) {
      if (a.delta > 200) { audio.bigWin(); ui.banner('BIG WIN', '+' + fmt(a.delta) + ' chips', '#ffd23f'); burst($('#ui'), { count: 26 }); haptic(30); }
      else if (a.tag === 'SCAM_SUCCESS') { audio.good(); ui.banner('SCAM SUCCESS', esc2(a.why), '#ff3d7f'); haptic(16); }
      else if (a.tag === 'GOOD_CALL') { audio.good(); ui.banner('GOOD CALL', esc2(a.why), '#39e6a0'); }
      else if (a.tag === 'WRONG_ACCUSE') { audio.fail(); ui.banner('WRONG ACCUSATION', '−' + fmt(-a.delta) + ' chips', '#ff7a45'); haptic(40); }
      else if (a.delta < 0) { audio.fail(); }
    }
  }
  ui.rail(state || {});
}

// ── characters sync ─────────────────────────────────────────────────────────────
function rebuildMyChar() {
  const o = chars.get(me);
  if (o) { scene.remove(o.c.root); chars.delete(me); }
  syncChars(state || { players: [{ pid: me, name: prof.name, avatar: prof.avatar, chips: CFG.startChips, seat: 0 }] });
}
function syncChars(v) {
  const list = (v.players || []);
  const alive = new Set();
  for (const p of list) {
    if (p.seat < 0 && p.spectating) { const o = chars.get(p.pid); if (o) o.plate && (o.plate.spr.visible = false); continue; }
    alive.add(p.pid);
    let o = chars.get(p.pid);
    if (!o) {
      const c = new Character(p.avatar || prof.avatar);
      const plate = prof.settings.names ? new Nameplate(c) : null;
      c.root.position.set(p.pos?.x ?? 0, 0, p.pos?.z ?? 0);
      scene.add(c.root);
      if (plate) scene.add(plate.spr);
      o = { c, plate, net: { x: p.pos?.x ?? 0, z: p.pos?.z ?? 0, r: p.rotY ?? 0 }, wasMoving: 0 };
      chars.set(p.pid, o);
    }
    o.avatar = p.avatar;
    // nameplate info
    if (o.plate) {
      const isMe = p.pid === me;
      const locked = (v.public?.locked || []).includes(p.pid);
      const accused = Object.values(v.public?.accuses || {}).includes(p.pid);
      const role = v.reveal?.roles?.[p.pid] || v.me?.role && isMe && v.phase === 'reveal' ? v.me.role : null;
      const R = role ? ROLE_BY_ID[role] : null;
      o.plate.set({
        name: p.name + (p.isHost ? ' ★' : ''), mine: isMe, you: isMe,
        right: fmt(p.chips),
        tag: v.phase === 'reveal' && R ? R.icon + ' ' + R.name : locked && v.phase === 'submit' ? 'LOCKED' : accused ? 'ACCUSED' : (!p.connected ? 'AWAY' : ''),
        tagBg: accused ? 'rgba(255,61,127,.92)' : locked ? 'rgba(57,230,160,.9)' : 'rgba(11,22,32,.8)',
        host: p.isHost,
        bubble: o.bubble && performance.now() - o.bubbleAt < 4200 ? o.bubble : '',
      });
    }
    // network position
    if (p.pos) { o.net.x = p.pos.x; o.net.z = p.pos.z; o.net.r = p.rotY ?? o.net.r; }
  }
  for (const [pid, o] of chars) if (!alive.has(pid)) { scene.remove(o.c.root); o.plate && scene.remove(o.plate.spr); chars.delete(pid); }
  // menu crew never in game
  for (const c of menuCrew) { c.root.visible = mode === 'menu'; }
}

function showBubble(pid, text) {
  const o = chars.get(pid);
  if (!o) return;
  o.bubble = text; o.bubbleAt = performance.now();
  if (o.plate) o.plate.dirty = true;
  const c = o.c;
  if (c) {
    c.setExpr(/lie|swear|honest|trust|never|promise/i.test(text) ? 'sly' : /!!|\bwhat\b|\bno\b/i.test(text) ? 'shock' : 'smug');
    c.playEmote('hand', 900);
  }
  setTimeout(() => { if (o.bubble === text) { o.bubble = ''; o.plate && (o.plate.dirty = true); } }, 4200);
}

// ── input ──────────────────────────────────────────────────────────────────────
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') { if (e.key === 'Escape') e.target.blur(); return; }
  const k = e.key.toLowerCase();
  if (e.key === 'Escape') { if (!$('#modal').hidden) ui.closeModal(); else ui.openOptions(); return; }
  if (k === 't' || e.key === 'Enter') { ui.toggleChat(); return; }
  if (k === 'q') { ui.toggleEmotes(); return; }
  if (k === 'e') { trySit(); return; }
  if (k === 'f') { useProp(); return; }
  if (k === 'x') { client.push(!(state?.me?.push)); return; }
  if (k === ' ') { e.preventDefault(); const c = state?.me?.commit; if (c) { client.commit(c); audio.stamp(); } return; }
  if (/^[1-9]$/.test(k)) {
    const o = state?.options?.[+k - 1];
    if (o) { client.commit(o.id); audio.pop(1.1); toast('Chosen: ' + o.label); }
    return;
  }
  keys.add(k);
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());

// touch: left half = move, right half = nothing (UI handles taps)
const touch = { on: false, x: 0, y: 0, ox: 0, oy: 0 };
canvas.addEventListener('pointerdown', (e) => {
  if (!isTouch() || mode === 'menu') return;
  if (e.clientX > innerWidth * 0.55) return;
  touch.on = true; touch.x = touch.ox = e.clientX; touch.y = touch.oy = e.clientY;
  canvas.setPointerCapture?.(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => { if (touch.on) { touch.x = e.clientX; touch.y = e.clientY; } });
canvas.addEventListener('pointerup', () => { touch.on = false; });
canvas.addEventListener('dblclick', () => { if (mode === 'game') trySit(); });

function moveInput(dt) {
  let ix = 0, iz = 0;
  if (keys.has('a') || keys.has('arrowleft')) ix -= 1;
  if (keys.has('d') || keys.has('arrowright')) ix += 1;
  if (keys.has('w') || keys.has('arrowup')) iz -= 1;
  if (keys.has('s') || keys.has('arrowdown')) iz += 1;
  if (touch.on) {
    const dx = touch.x - touch.ox, dy = touch.y - touch.oy;
    const l = Math.hypot(dx, dy);
    if (l > 12) { ix = dx / l; iz = dy / l; }
  }
  return { ix, iz };
}

function trySit() {
  if (mode !== 'lobby' && mode !== 'game') return;
  const o = chars.get(me); if (!o) return;
  if (seated) { seated = false; client.sit(false); audio.sit(); return; }
  let best = -1, bd = 2.2;
  for (let i = 0; i < SEATS; i++) {
    const s = seatTransform(i);
    const d = Math.hypot(o.c.root.position.x - s.pos.x, o.c.root.position.z - s.pos.z);
    if (d < bd) { bd = d; best = i; }
  }
  if (best >= 0) { seated = true; client.sit(true, best); audio.sit(); }
  else toast('Walk closer to a chair');
}

const ray = new THREE.Raycaster();
let propNear = null;
function useProp() {
  if (!propNear) return;
  if (propNear === 'juke') { const on = !prof.settings.music; prof.settings.music = on; save(); audio.setMusic(on); toast(on ? 'The jukebox hums' : 'Silence, at last'); }
  if (propNear === 'tip') { client.emote((Math.random() * EMOTES.length) | 0); fx.chips(new THREE.Vector3(8, 1.4, 3), { count: 6 }); audio.coin(); toast('You drop a coin in the tip jar. The jar says nothing.'); }
}

// ── the wall screen: what everyone in the room can read ─────────────────────────
let screenT = 0;
function paintScreen(v) {
  if (!v) return;
  if (performance.now() - screenT < 90) return;
  screenT = performance.now();
  room3d.drawScreen((g, W, H) => drawScreen(g, W, H, v));
}
function drawScreen(g, W, H, v) {
  const t = performance.now() * 0.001;
  const ph = v.phase;
  // backdrop
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#0a1620'); bg.addColorStop(1, '#061019');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(232,182,74,.10)'; g.lineWidth = 1;
  for (let x = 0; x < W; x += 34) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
  for (let y = 0; y < H; y += 34) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }

  const title = (txt, y, size = 60, color = '#f3ead6') => {
    g.font = `800 ${size}px Bungee, Impact, system-ui, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = color; g.fillText(txt, W / 2, y);
  };
  const label = (txt, x, y, size = 22, color = 'rgba(232,182,74,.9)', align = 'left') => {
    g.font = `700 ${size}px Outfit, system-ui, sans-serif`;
    g.textAlign = align; g.fillStyle = color; g.fillText(txt, x, y);
  };
  const players = (v.players || []).filter((p) => p.seat >= 0 && !p.spectating);

  if (mode === 'menu' || ph === 'lobby') {
    title('SWINDLE SQUAD', H * 0.28, 78, '#ffd76a');
    label('THE GILDED ALIBI · MEMBERS ONLY', W / 2, H * 0.42, 24, 'rgba(240,230,210,.6)', 'center');
    const code = v.code || '·····';
    g.fillStyle = 'rgba(232,182,74,.12)'; g.fillRect(W / 2 - 190, H * 0.53, 380, 92);
    g.strokeStyle = 'rgba(232,182,74,.7)'; g.lineWidth = 3; g.strokeRect(W / 2 - 190, H * 0.53, 380, 92);
    title(code, H * 0.53 + 46, 62, '#fff3d0');
    label(players.length + ' / 8 SEATS OCCUPIED', W / 2, H * 0.8, 22, 'rgba(255,255,255,.6)', 'center');
    players.slice(0, 8).forEach((p, i) => {
      const x = 70 + (i % 4) * 265, y = H * 0.86 + Math.floor(i / 4) * 30;
      label(p.name.toUpperCase(), x, y, 19, p.ready ? '#8ff0c6' : 'rgba(240,230,210,.7)');
    });
  } else {
    const info = v.roundInfo || {};
    const secs = Math.max(0, Math.ceil(((v.phaseEnds || 0) - (v.now || 0)) / 1000));
    label(`ROUND ${(v.round ?? 0) + 1} / ${v.total}`, 40, 44, 22);
    label(info.title?.toUpperCase() || '', 40, 82, 34, '#ffd76a');
    label(({ brief: 'SECRETS OUT', talk: 'DEALS OPEN', submit: 'RECKONING', lock: 'LOCKED', reveal: 'THE REVEAL', results: 'PAYOUT', final: 'FINAL' })[ph] || '', W - 40, 44, 22, 'rgba(255,255,255,.55)', 'right');
    title(String(secs), W - 96, 96, 56, secs <= 8 ? '#ff6f9b' : '#f3ead6');

    if (ph === 'brief') {
      title('READ YOUR CARDS', H * 0.44, 54, '#f3ead6');
      label('nobody else can see what you just saw', W / 2, H * 0.55, 24, 'rgba(255,255,255,.55)', 'center');
    } else if (ph === 'talk' || ph === 'submit') {
      // who is locked, pot, deals
      const locked = new Set(v.public?.locked || []);
      players.forEach((p, i) => {
        const x = 54 + (i % 4) * 268, y = H * 0.34 + Math.floor(i / 4) * 92;
        g.fillStyle = locked.has(p.pid) ? 'rgba(57,230,160,.14)' : 'rgba(255,255,255,.05)';
        g.fillRect(x - 18, y - 26, 246, 72);
        g.strokeStyle = locked.has(p.pid) ? 'rgba(57,230,160,.6)' : 'rgba(255,255,255,.12)'; g.lineWidth = 2;
        g.strokeRect(x - 18, y - 26, 246, 72);
        label(p.name.toUpperCase(), x, y, 21, '#f3ead6');
        label(fmt(p.chips) + ' 🪙', x, y + 26, 18, '#ffd76a');
        label(locked.has(p.pid) ? 'LOCKED' : 'DECIDING…', x + 210, y, 16, locked.has(p.pid) ? '#8ff0c6' : 'rgba(255,255,255,.45)', 'right');
      });
      if (v.offers?.length) {
        const o = v.offers[v.offers.length - 1];
        label(`LIVE DEAL · ${o.fromName} ⇄ ${o.toName} · ${o.give} for ${o.want}`, W / 2, H - 46, 20, 'rgba(255,255,255,.62)', 'center');
      }
      const potty = v.public?.currentPot ?? v.public?.pot;
      if (potty) title(fmt(potty), W / 2, H * 0.78, 64, '#ffd76a');
    } else if (ph === 'reveal') {
      const beats = v.reveal?.beats || [];
      title('THE REVEAL', H * 0.16, 48, '#ff8fb3');
      const last = beats[beats.length - 1];
      if (last) {
        const txt = wrap(g, last.text, W - 140, 44);
        txt.forEach((ln, i) => title(ln, H * 0.42 + i * 54, 42, last.tone === 'good' ? '#8ff0c6' : last.tone === 'bad' ? '#ff9db8' : '#f3ead6'));
      }
      players.forEach((p, i) => {
        const x = 40 + (i % 4) * 268, y = H * 0.68 + Math.floor(i / 4) * 66;
        const role = v.reveal?.roles?.[p.pid];
        const R = role ? ROLE_BY_ID[role] : null;
        label((R ? R.icon + ' ' + R.name.toUpperCase() + ' — ' : '') + p.name.toUpperCase(), x, y, 19, 'rgba(240,230,210,.8)');
      });
    } else if (ph === 'results' || ph === 'final') {
      const board = (v.board || players.slice().sort((a, b) => b.chips - a.chips));
      title(ph === 'final' ? 'FINAL SCORE' : 'ROUND PAYOUT', H * 0.16, 50, '#ffd76a');
      board.slice(0, 8).forEach((p, i) => {
        const y = H * 0.3 + i * 46;
        label(`${i + 1}.  ${(p.name || '').toUpperCase()}`, 70, y, 24, i === 0 ? '#ffd76a' : 'rgba(240,230,210,.82)');
        label(fmt(p.chips) + ' 🪙', W - 70, y, 24, '#f3ead6', 'right');
        g.fillStyle = 'rgba(255,255,255,.05)'; g.fillRect(50, y - 20, W - 100, 34);
      });
    }
  }
  // scanlines + flicker
  g.fillStyle = 'rgba(255,255,255,.03)';
  for (let y = (t * 30) % 4; y < H; y += 4) g.fillRect(0, y, W, 1);
  room3d.screenPulse(ph === 'reveal' ? 6 : 1.5);
}
function wrap(g, text, maxW, size) {
  g.font = `800 ${size}px Bungee, Impact, system-ui, sans-serif`;
  const words = String(text).split(' ');
  const lines = []; let cur = '';
  for (const w of words) {
    if (g.measureText(cur + ' ' + w).width > maxW && cur) { lines.push(cur); cur = w; }
    else cur = cur ? cur + ' ' + w : w;
    if (lines.length > 2) break;
  }
  if (cur && lines.length < 3) lines.push(cur);
  return lines;
}

// ── main loop ────────────────────────────────────────────────────────────────────
applyQuality(quality); resize();
ui.refreshWallet();

// ── network reality: the game never needs the house for a solo table ──────────
const fromDisk = location.protocol === 'file:';
const netOnline = () => !fromDisk && navigator.onLine !== false;
function reflectNet() {
  const on = !netOnline();
  ui.setOffline(on);
  if (!on && mode === 'menu') ui.setStatus('online', 'connected to the house');
}
let canStore = true;
try { localStorage.setItem('__swindle_probe', '1'); localStorage.removeItem('__swindle_probe'); } catch (e) { canStore = false; }
if (fromDisk && !canStore) setTimeout(() => toast('This browser will not save progress from a local file — the game still plays fine', 'bad', 5600), 1400);

function saveOfflineCopy() {
  const a = document.createElement('a');
  a.href = 'offline.html'; a.download = 'swindle-squad-offline.html';
  document.body.appendChild(a); a.click(); a.remove();
  toast('Saving swindle-squad-offline.html — double-click it later, no wifi needed', 'good', 4200);
}
addEventListener('online', () => { reflectNet(); if (mode === 'menu') toast('Back online — rooms are open again', 'good'); });
addEventListener('offline', () => { reflectNet(); toast('Offline. The solo table keeps going — chips and all.', 'bad'); });
$('#mOffline') && (fromDisk ? ($('#mOffline').hidden = true) : (check('offline.html')));
async function check(u) {
  try { const r = await fetch(u, { method: 'HEAD' }); $('#mOffline').hidden = !r.ok; } catch (e) { $('#mOffline').hidden = true; }
}
if (fromDisk) $('#offPill').hidden = false;
reflectNet();
ui.screen('menu');
if (location.hash.startsWith('#join=')) {
  const code = location.hash.slice(6).toUpperCase().slice(0, 5);
  $('#joinBox').hidden = false; $('#joinInput').value = code;
  setTimeout(() => $('#joinGo').click(), 900);
}

let acc = 0, _lastPaint = 0;
renderer.setAnimationLoop(() => {
  const dt = Math.min(0.05, clock.getDelta());
  acc += dt;
  // ── movement (local prediction, authority validation on the server)
  const o = chars.get(me);
  if (mode === 'game' || mode === 'lobby') {
    const { ix, iz } = moveInput(dt);
    const speed = 4.2;
    if (ix || iz) {
      const l = Math.hypot(ix, iz);
      const cosA = Math.cos(rig.az), sinA = Math.sin(rig.az);
      const wx = (ix * cosA - iz * sinA) / l, wz = (ix * sinA + iz * cosA) / l;
      myVel.x = lerp(myVel.x, wx * speed, Math.min(1, dt * 12));
      myVel.z = lerp(myVel.z, wz * speed, Math.min(1, dt * 12));
    } else { myVel.x *= Math.pow(0.001, dt); myVel.z *= Math.pow(0.001, dt); }
    if (o) {
      let nx = o.c.root.position.x + myVel.x * dt, nz = o.c.root.position.z + myVel.z * dt;
      const c = room3d.collide(nx, nz);
      o.c.root.position.x = c.x; o.c.root.position.z = c.z;
      const sp = Math.hypot(myVel.x, myVel.z);
      o.c.speed = clamp(sp / 3.4, 0, 1.4);
      if (sp > 0.25) {
        const want = Math.atan2(myVel.x, myVel.z);
        o.c.root.rotation.y = angLerp(o.c.root.rotation.y, want, Math.min(1, dt * 12));
      }
      o.c.sitOn = seated;
      // send intent at ~14 Hz
      const now = performance.now();
      if (now - lastSent > 70) {
        lastSent = now;
        client.move(o.c.root.position.x, o.c.root.position.z, o.c.root.rotation.y);
      }
      // proximity prop hint
      let near = null, bd = 1.8;
      for (const p of room3d.pickables) {
        const d = Math.hypot(p.position.x - o.c.root.position.x, p.position.z - o.c.root.position.z);
        if (d < bd) { bd = d; near = p.userData.pick; }
      }
      if (near !== propNear) {
        propNear = near;
        if (near) ui.feed(near === 'juke' ? 'the jukebox — press F' : 'the tip jar — press F', 'story');
      }
    }
  }
  // ── remote characters: interpolate toward the authority's numbers
  for (const [pid, c] of chars) {
    if (pid === me) continue;
    const dx = c.net.x - c.c.root.position.x, dz = c.net.z - c.c.root.position.z;
    const k = Math.min(1, dt * 11);
    c.c.root.position.x += dx * k; c.c.root.position.z += dz * k;
    const moving = Math.hypot(dx, dz);
    c.c.speed = clamp(moving * 6, 0, 1.3);
    if (moving > 0.02) c.c.root.rotation.y = angLerp(c.c.root.rotation.y, Math.atan2(dx, dz), Math.min(1, dt * 8));
    c.wasMoving = moving;
  }
  // ── expression direction: read the room state
  for (const [pid, c] of chars) {
    const locked = (state?.public?.locked || []).includes(pid);
    const accused = Object.values(state?.public?.accuses || {}).includes(pid);
    const tells = state?.public?.tells?.[pid] || [];
    if (state?.phase === 'reveal') continue;              // theatre drives it
    if (accused) c.c.setExpr('shock');
    else if (locked) c.c.setExpr('deadpan');
    else if (tells.length) c.c.setExpr('sly');
    else if (state?.phase === 'submit') c.c.setExpr('worry');
    else if (state?.phase === 'talk') c.c.setExpr(pid === me ? 'smug' : 'neutral');
    else c.c.setExpr('cheer');
    c.c.sweat.visible = /busy|fidget/.test(tells.join(',')) || c.c.emoteAnim === 'sweat';
  }
  // ── camera framing
  updateCamera(dt);
  // ── animate
  for (const c of menuCrew) c.update(dt, acc);
  for (const [, c] of chars) { c.c.update(dt, acc); c.plate && (c.plate.spr.position.set(c.c.root.position.x, 1.86, c.c.root.position.z), c.plate.draw()); }
  if (acc - (_lastPaint || 0) > 0.12) { _lastPaint = acc; paintScreen(state || { phase: 'lobby', players: [], code: '' }); }
  room3d.update(dt, { board: boardFor(state?.roundInfo?.id || ''), pot: state?.public?.pot ?? state?.public?.currentPot ?? (state?.roundInfo ? 180 : 0), highlightCase: null, dial: acc * 0.6, press: 0 });
  fx.update(dt, camera.position);
  post.render(acc);
  // fps meter + adaptive quality
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 0.5) {
    fpsShown = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0;
    const f = $('#fps'); if (f) { f.hidden = !prof.settings.fps; f.textContent = fpsShown + ' fps · ' + quality; }
    if (fpsShown < 44 && quality !== 'low') { lowSince += 0.5; if (lowSince > 3) { lowSince = 0; stepDown(); } } else lowSince = 0;
  }
});
function stepDown() {
  const order = ['ultra', 'high', 'medium', 'low'];
  const i = order.indexOf(quality);
  if (i > 0) { const q = order[i - 1]; prof.settings.quality = q; save(); applyQuality(q); resize(); toast('Graphics dropped to ' + q.toUpperCase() + ' to hold the frame rate'); }
}

function updateCamera(dt) {
  if (mode === 'menu') {
    rig.fast = false;
    rig.wantAz = Math.sin(acc * 0.06) * 0.55 + Math.PI;
    rig.wantPol = 0.5 + Math.sin(acc * 0.04) * 0.05;
    rig.want.set(0, 1.5, 0.5);
    rig.wantDist = 14.5 + Math.sin(acc * 0.05) * 1.2;
    rig.update(dt, quality);
    return;
  }
  const ph = state?.phase;
  if (ph === 'reveal' || ph === 'lock' || ph === 'results') { rig.fast = true; rig.update(dt, quality); return; }
  const pts = [];
  for (const [, c] of chars) pts.push(c.c.root.position.clone().setY(1.1));
  if (ph === 'brief') { rig.wantPol = 0.86; rig.fast = false; }
  else if (ph === 'submit') { rig.wantPol = 0.62; rig.fast = true; }
  else { rig.wantPol = 0.6; rig.fast = false; }
  const focusPid = state?.public?.focus;
  if (focusPid && chars.get(focusPid)) rig.focus(chars.get(focusPid).c.root.position.clone(), 1.15);
  else {
    rig.frame(pts.length ? pts : [new THREE.Vector3()], { tight: ph === 'submit' });
    // bias gently toward me so I always feel centered
    const o = chars.get(me);
    if (o) { rig.want.x = lerp(rig.want.x, o.c.root.position.x * 0.45, 0.6); rig.want.z = lerp(rig.want.z, o.c.root.position.z * 0.45, 0.6); }
  }
  rig.update(dt, quality);
}
function angLerp(a, b, k) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}


// first-run nudge
if (!prof.tutorial) setTimeout(() => ui.openHelp(), 700);
addEventListener('pointerdown', () => audio.unlock(), { once: true });
addEventListener('keydown', () => audio.unlock(), { once: true });

// ── dev/debug surface (used by the automated smoke test; harmless in play) ────
window.__swindle = {
  client, get state() { return state; }, get mode() { return mode; }, ui,
  applyQuality, get fps() { return fpsShown; },
  shots: () => ({ chars: chars.size, scene: scene.children.length }),
  jumpTo: (phase) => {
    const r = client.room; if (!r) return 'local-only';
    if (phase === 'reveal') { r.phaseEnds = r._now(); }
    else if (phase === 'submit') { r.state = 'talk'; r.phaseEnds = r._now(); }
    return r.state;
  },
};
