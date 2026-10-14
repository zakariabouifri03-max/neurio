// ── Giant Worlds — boot, HUD, star map, travel ──────────────────────────────
import * as THREE from 'three';
import { PLANETS, PLANET_COUNT, planetByIndex } from './planets.js';
import { buildWorld, EYE_HEIGHT, TERRAIN_SIZE } from './world.js';
import { Explorer } from './explorer.js';

const $ = (id) => document.getElementById(id);
const SAVE_KEY = 'giantWorlds.save.v1';

const state = {
  renderer: null, scene3d: null, camera: null, explorer: null,
  planetIndex: 1, quality: 'med', running: false,
  visited: new Set(), save: null,
  fpsT: 0, fpsN: 0, fps: 60, lowStreak: 0, autoDropped: false,
  busy: false,
};

// ── save ────────────────────────────────────────────────────────────────────
function loadSave() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}');
    state.visited = new Set(s.visited || []);
    state.planetIndex = s.current || 1;
    state.quality = s.quality || (matchMedia('(pointer: coarse)').matches ? 'low' : 'high');
  } catch { /* first run */ }
}
function persist() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      visited: [...state.visited], current: state.planetIndex, quality: state.quality,
    }));
  } catch { /* private mode */ }
}

// ── planet card artwork ─────────────────────────────────────────────────────
function planetSwatch(p, size = 64) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const cx = size / 2, cy = size / 2, r = size * 0.36;
  if (p.ringed) {
    g.strokeStyle = p.palette.leaf[0]; g.globalAlpha = 0.85; g.lineWidth = size * 0.045;
    g.beginPath(); g.ellipse(cx, cy, r * 1.65, r * 0.5, -0.42, 0, Math.PI * 2); g.stroke();
    g.globalAlpha = 1;
  }
  const grd = g.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
  grd.addColorStop(0, p.palette.leaf[1] || p.palette.leaf[0]);
  grd.addColorStop(0.6, p.palette.groundHigh);
  grd.addColorStop(1, p.palette.groundLow);
  g.fillStyle = grd;
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
  // atmosphere
  g.strokeStyle = p.night ? 'rgba(160,220,255,.55)' : 'rgba(255,255,255,.5)';
  g.lineWidth = size * 0.035;
  g.beginPath(); g.arc(cx, cy, r * 1.07, 0, Math.PI * 2); g.stroke();
  // night terminator
  if (p.night) {
    g.fillStyle = 'rgba(4,8,20,.5)';
    g.beginPath(); g.arc(cx + r * 0.55, cy, r * 1.02, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff8d0';
    for (let i = 0; i < 7; i++) {
      const a = i * 1.9 + p.index, rr = r * (0.2 + (i % 4) * 0.16);
      g.globalAlpha = 0.85;
      g.beginPath(); g.arc(cx - r * 0.3 + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.7, size * 0.018, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
  }
  return c;
}

// ── star map ────────────────────────────────────────────────────────────────
function buildStarMap() {
  const grid = $('mapGrid');
  grid.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (const p of PLANETS) {
    const card = document.createElement('button');
    card.className = 'pcard';
    card.dataset.idx = p.index;
    const art = planetSwatch(p, 64);
    art.className = 'part';
    const info = document.createElement('div');
    info.className = 'pinfo';
    info.innerHTML = `
      <div class="pname"><b>${String(p.index).padStart(3, '0')}</b> ${p.name}</div>
      <div class="pmeta">${p.biome} ${p.night ? '🌙' : '☀️'}${p.ringed ? ' 💫' : ''}</div>
      <div class="pmeta dim">⬇ ${p.gravity}g · 🌡 ${p.tempC}°C · ⛰ ${p.radiusKm.toLocaleString()} km</div>`;
    card.append(art, info);
    const badge = document.createElement('span');
    badge.className = 'pbadge';
    card.append(badge);
    card.addEventListener('click', () => { closeMap(); travelTo(p.index); });
    frag.append(card);
  }
  grid.append(frag);
  refreshMapBadges();
}

function refreshMapBadges() {
  for (const el of $('mapGrid').children) {
    const idx = +el.dataset.idx;
    const badge = el.querySelector('.pbadge');
    el.classList.toggle('here', idx === state.planetIndex);
    const seen = state.visited.has(idx);
    el.classList.toggle('seen', seen);
    badge.textContent = idx === state.planetIndex ? '◉ HERE' : seen ? '✓' : '';
  }
  $('mapCount').textContent = `${state.visited.size} / ${PLANET_COUNT} explored`;
}

function openMap() {
  refreshMapBadges();
  $('mapOverlay').classList.add('show');
  document.exitPointerLock?.();
  state.mapOpen = true;
}
function closeMap() { $('mapOverlay').classList.remove('show'); state.mapOpen = false; }

// ── travel ──────────────────────────────────────────────────────────────────
function travelTo(index) {
  if (state.busy) return;
  state.busy = true;
  const p = planetByIndex(index);
  $('warpName').textContent = `${String(p.index).padStart(3, '0')} · ${p.name}`;
  $('warpBiome').textContent = p.biome;
  $('warp').classList.add('on');
  document.exitPointerLock?.();
  setTimeout(() => {
    state.planetIndex = p.index;
    state.visited.add(p.index);
    persist();
    mountWorld(p);
    setTimeout(() => {
      $('warp').classList.remove('on');
      state.busy = false;
      toast(`Landed on ${p.name} — ${p.biome}`);
    }, 620);
  }, 900);
}

// ── world mounting ──────────────────────────────────────────────────────────
// capture/restore where you are standing, so a detail change never teleports you
function capturePose() {
  const e = state.explorer;
  if (!e) return null;
  return { pos: e.pos.clone(), yaw: e.yaw, pitch: e.pitch, flying: e.flying };
}
function restorePose(pose) {
  const e = state.explorer;
  if (!e || !pose) return;
  e.pos.copy(pose.pos);
  e.yaw = pose.yaw; e.pitch = pose.pitch;
  e.toggleFly(pose.flying);
  e.vel.set(0, 0, 0);
}

function mountWorld(planet, pose) {
  const t0 = performance.now();
  if (state.scene3d) {
    state.scene3d.dispose(state.renderer);
    state.explorer?.detach();
    state.scene3d = null; state.explorer = null;
  }
  const world = buildWorld(planet, state.quality);
  state.scene3d = world;
  state.camera.aspect = innerWidth / innerHeight;
  state.camera.updateProjectionMatrix();

  const ex = new Explorer(state.camera, world);
  ex.attach($('stage'));
  state.explorer = ex;
  if (pose) {
    // stay inside the new world's bounds and on top of its terrain
    const lim = TERRAIN_SIZE / 2 - 12;
    pose.pos.x = Math.max(-lim, Math.min(lim, pose.pos.x));
    pose.pos.z = Math.max(-lim, Math.min(lim, pose.pos.z));
    pose.pos.y = Math.max(pose.pos.y, world.terrain.heightAt(pose.pos.x, pose.pos.z) + EYE_HEIGHT);
    restorePose(pose);
  }

  const p = planet;
  $('hudPlanet').textContent = `${String(p.index).padStart(3, '0')} / ${PLANET_COUNT} · ${p.name}`;
  $('hudEpithet').textContent = p.epithet;
  $('hudBiome').textContent = `${p.biome} ${p.night ? '🌙' : '☀️'}`;
  $('hudGrav').textContent = `${p.gravity} g`;
  $('hudTemp').textContent = `${p.tempC} °C`;
  $('hudTallest').textContent = `${Math.round(world.tallest)} m`;
  $('hudGiants').textContent = world.stats.giants.toLocaleString();
  $('hudTris').textContent = (world.stats.tris / 1e6).toFixed(2) + 'M';
  $('bootMs').textContent = `${Math.round(performance.now() - t0)} ms`;
  refreshMapBadges();
}

// ── HUD ─────────────────────────────────────────────────────────────────────
const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
function updateHUD(dt) {
  const ex = state.explorer;
  if (!ex) return;
  const p = state.scene3d.planet;

  $('hudX').textContent = ex.pos.x.toFixed(0);
  $('hudZ').textContent = ex.pos.z.toFixed(0);
  $('hudAlt').textContent = ex.altitude.toFixed(1);
  $('hudSpeed').textContent = (ex.lastSpeed * 3.6).toFixed(1);
  $('hudFps').textContent = Math.round(state.fps);
  $('hudMode').textContent = ex.flying ? 'FLIGHT' : (ex.grounded ? 'WALK' : 'AIR');
  $('hudMode').className = 'chip ' + (ex.flying ? 'fly' : '');
  $('hudWater').style.display = p.waterLevel !== null ? '' : 'none';

  const hd = ex.headingDeg;
  $('compassTrack').style.backgroundPositionX = `${-(hd / 15) * 24}px`;   // 24 px per 15°
  $('compassCard').textContent = CARDINALS[Math.round(hd / 45) % 8] + ' ' + Math.round(hd) + '°';

  // scale read-out: you vs the nearest giant
  const n = ex.nearestPlant();
  if (n) {
    $('nearName').textContent = n.label;
    $('nearH').textContent = n.h.toFixed(1) + ' m';
    $('nearD').textContent = n.dist.toFixed(0) + ' m away';
    const ratio = Math.min(1, EYE_HEIGHT / n.h);
    $('scaleYou').style.height = Math.max(2, ratio * 100) + '%';
    $('scaleRatio').textContent = (n.h / EYE_HEIGHT).toFixed(0) + '× your height';
  }
  $('hudDist').textContent = `${(Math.hypot(ex.pos.x, ex.pos.z)).toFixed(0)} m from landing`;
}

let toastT = 0;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove('show'), 3200);
}

// debug / automation handle (same idea as window.GAME in the racing game)
window.GW = state;

// ── touch controls ──────────────────────────────────────────────────────────
function setupTouch() {
  const stick = $('stick'), knob = $('knob');
  let sid = null, cx = 0, cy = 0, lid = null, lx = 0, ly = 0;
  const R = 46;

  stick.addEventListener('pointerdown', (e) => {
    sid = e.pointerId; const r = stick.getBoundingClientRect();
    cx = r.left + r.width / 2; cy = r.top + r.height / 2;
    stick.setPointerCapture(sid);
    e.preventDefault();
  });
  stick.addEventListener('pointermove', (e) => {
    if (e.pointerId !== sid || !state.explorer) return;
    let dx = e.clientX - cx, dy = e.clientY - cy;
    const d = Math.hypot(dx, dy);
    if (d > R) { dx = dx / d * R; dy = dy / d * R; }
    knob.style.transform = `translate(${dx}px,${dy}px)`;
    state.explorer.setMove(dx / R, dy / R);
  });
  const endStick = (e) => {
    if (e.pointerId !== sid) return;
    sid = null; knob.style.transform = 'translate(0,0)';
    state.explorer?.setMove(0, 0);
  };
  stick.addEventListener('pointerup', endStick);
  stick.addEventListener('pointercancel', endStick);

  const look = $('lookArea');
  look.addEventListener('pointerdown', (e) => { lid = e.pointerId; lx = e.clientX; ly = e.clientY; });
  look.addEventListener('pointermove', (e) => {
    if (e.pointerId !== lid || !state.explorer) return;
    state.explorer.look((e.clientX - lx) * 1.6, (e.clientY - ly) * 1.6);
    lx = e.clientX; ly = e.clientY;
  });
  look.addEventListener('pointerup', () => { lid = null; });
  look.addEventListener('pointercancel', () => { lid = null; });

  const tap = (id, fn) => $(id)?.addEventListener('pointerdown', (e) => { e.preventDefault(); fn(); });
  tap('btnJump', () => state.explorer?.jump());
  tap('btnFly', () => {
    const f = state.explorer?.toggleFly();
    $('btnFly').classList.toggle('on', !!f);
    toast(f ? 'Flight suit on — SPACE rises, CTRL descends' : 'Back on the ground');
  });
  tap('btnMap', () => (state.mapOpen ? closeMap() : openMap()));
  tap('btnHelp', () => toggleHelp());
}

function toggleHelp(force) {
  const h = $('helpModal');
  const show = force === undefined ? !h.classList.contains('show') : force;
  h.classList.toggle('show', show);
  if (show) document.exitPointerLock?.();
}

// ── boot ────────────────────────────────────────────────────────────────────
function setQuality(q, quiet) {
  if (state.quality === q) return;
  state.quality = q;
  persist();
  if (!quiet) toast(`Detail: ${q.toUpperCase()}`);
  mountWorld(planetByIndex(state.planetIndex), capturePose());
}

function boot() {
  loadSave();
  if (matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window) document.body.classList.add('touch');
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.6));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  $('stage').prepend(renderer.domElement);
  state.renderer = renderer;
  state.camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.08, 6000);

  addEventListener('resize', () => {
    state.camera.aspect = innerWidth / innerHeight;
    state.camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  // click the world to grab the mouse
  $('stage').addEventListener('click', () => {
    if (!state.mapOpen && !$('helpModal').classList.contains('show')) state.explorer?.requestLock();
  });

  // keys that belong to the shell, not the explorer
  addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'm') { state.mapOpen ? closeMap() : openMap(); }
    if (k === 'h' || k === '?') toggleHelp();
    if (k === 'escape') { closeMap(); toggleHelp(false); }
    if (k === 'r') { state.explorer?.pos.set(state.scene3d.spawn.x, state.scene3d.spawn.y + EYE_HEIGHT, state.scene3d.spawn.z); toast('Back to the landing site'); }
    if (k === '1') setQuality('low');
    if (k === '2') setQuality('med');
    if (k === '3') setQuality('high');
  });

  $('btnMapTop').addEventListener('click', () => openMap());
  $('mapClose').addEventListener('click', () => closeMap());
  $('btnHelpClose').addEventListener('click', () => toggleHelp(false));
  $('btnRandom').addEventListener('click', () => {
    closeMap();
    travelTo(1 + Math.floor(Math.random() * PLANET_COUNT));
  });
  $('btnNext').addEventListener('click', () => {
    closeMap();
    travelTo(state.planetIndex >= PLANET_COUNT ? 1 : state.planetIndex + 1);
  });

  setupTouch();
  buildStarMap();

  state.visited.add(state.planetIndex);
  mountWorld(planetByIndex(state.planetIndex));
  persist();
  Object.assign(state, { travelTo, setQuality, openMap, closeMap, planetByIndex, PLANETS });

  // build every one of the 100 worlds once (used by tools/verify-worlds.mjs)
  state.probeAll = () => PLANETS.map((p) => {
    const w = buildWorld(p, 'low');
    const row = { i: p.index, name: p.name, biome: p.biome, giants: w.stats.giants, tris: w.stats.tris, tallest: +w.tallest.toFixed(1) };
    w.dispose(state.renderer);
    return row;
  });

  $('boot').classList.add('gone');
  setTimeout(() => { $('boot').style.display = 'none'; }, 700);
  toast('Click the world to look around · WASD to walk · M for the star map');

  let last = performance.now();
  const loop = (now) => {
    requestAnimationFrame(loop);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!state.scene3d || document.hidden) return;

    if (!state.mapOpen) state.explorer.update(dt);
    if (state.scene3d.spores) state.scene3d.spores.rotation.y += dt * 0.012;

    renderer.render(state.scene3d.scene, state.camera);

    // fps + auto detail
    state.fpsN++; state.fpsT += dt;
    if (state.fpsT >= 0.5) {
      state.fps = state.fpsN / state.fpsT;
      state.fpsT = 0; state.fpsN = 0;
      // One automatic detail drop if the machine is really struggling:
      // 6 s sustained under 22 fps, at most once per session, and it keeps you
      // standing exactly where you were.
      if (state.fps < 22) state.lowStreak++; else state.lowStreak = 0;
      if (state.lowStreak >= 12 && !state.autoDropped && !state.busy && !state.mapOpen && state.quality !== 'low') {
        state.lowStreak = 0;
        state.autoDropped = true;
        setQuality(state.quality === 'high' ? 'med' : 'low');
        toast('Lowered detail to keep it smooth');
      }
    }
    updateHUD(dt);
  };
  requestAnimationFrame(loop);
}

addEventListener('error', (e) => {
  $('errLog').style.display = 'block';
  $('errLog').textContent = '⚠️ ' + (e.message || 'Error');
});

boot();
