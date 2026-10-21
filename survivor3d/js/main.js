import * as THREE from 'three';
import { G, TIERS, tier, profile, loadProfile, saveProfile } from './state.js';
import { Rand, clamp, lerp, fmtTime } from './util.js';
import { buildWorld, heightAt, updateSun, animateWater, updateZoneMesh, ISLAND_R } from './world.js';
import { initFX, updateFX, updateDamageNumbers, initDamageNumbers, shakeOffset, resetFX } from './fx.js';
import { initBullets, updateBullets, updateGrenades, resetProjectiles, GUNS, throwGrenade, equipGunMesh } from './weapons.js';
import { makeEntity, moveEntity, tickEntity, thinkBot, tryShoot, useMed, botLoadout, aimDir, startReload, BOT_NAMES, BOT_LINES } from './entities.js';
import { initLootRenderer, disposeLootRenderer, scatterLoot, clearLoot, updateLoot, takeLoot } from './loot.js';
import { initInput, readWish, consumeLook, consumeFlags, IN, isTouch } from './input.js';
import { initAudio, resumeAudio, setEnabled, sfx, footstep, setWind } from './audio.js';
import { initHUD, updateHUD, showScreen, hideScreens, setPhase, setLoad, hideLoading, renderStats, renderQualityHint, showResult } from './hud.js';

// ══════════════════════════════════════════════════════════════
//  NAR SURVIVOR 3D — boot, match flow, camera, zone, results,
//  and the adaptive-quality loop that keeps weak phones smooth.
// ══════════════════════════════════════════════════════════════

const canvas = document.getElementById('gl');
let renderer, scene, camera;
let rafId = 0, lastT = 0, acc = 0;
let matchT = 0;
let camYaw = 0, camPitch = -0.05, camDistCur = 5.2;
const camPos = new THREE.Vector3(0, 12, 12);
const camLook = new THREE.Vector3();
const tmpV = new THREE.Vector3();
let fpsHist = [], tuneT = 0;
let paused = false;
let booting = true;

// ── boot ───────────────────────────────────────────────────────
loadProfile();
G.tier = clamp(profile.tier | 0, 0, 2);
G.sens = profile.sens || 1;
IN.sens = G.sens;

initAudio();
setEnabled(profile.sound !== false);
initHUD();
initDamageNumbers();
initInput({ togglePause, toggleSound });

renderer = new THREE.WebGLRenderer({
  canvas, antialias: TIERS[G.tier].antialias, powerPreference: 'high-performance',
  alpha: false, stencil: false, depth: true,
});
G.renderer = renderer;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

scene = new THREE.Scene();
G.scene = scene;
camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.35, 900);
G.camera = camera;
applyQuality();

setLoad(10, 'generating the island…');
requestAnimationFrame(() => {
  initFX(scene);
  initBullets(scene);
  initLootRenderer(scene);
  setLoad(28, 'carving terrain…');
  requestAnimationFrame(() => {
    buildMatch();
    setLoad(100, 'ready');
    setTimeout(() => {
      hideLoading();
      showScreen('menu');
      renderStats();
      renderQualityHint();
      G.phase = 'menu';
      booting = false;
      lastT = performance.now();
      rafId = requestAnimationFrame(loop);
    }, 90);
  });
});

// ── quality ────────────────────────────────────────────────────
function applyQuality() {
  const T = tier();
  G.renderScale = T.renderScale;
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, T.maxPixelRatio) * G.renderScale);
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.shadowMap.enabled = T.shadows;
  scene.fog = new THREE.Fog(0xa9c6dc, T.drawDist * 0.42, T.drawDist);
  camera.far = 900;
  camera.updateProjectionMatrix();
}
function setTier(t, rebuild) {
  t = clamp(t | 0, 0, 2);
  G.tier = t;
  profile.tier = t;
  saveProfile();
  syncTierButtons();
  applyQuality();
  renderQualityHint();
  if (rebuild) buildMatch();
}
function syncTierButtons() {
  document.querySelectorAll('#qOpt button, #qOpt2 button').forEach((b) => b.classList.toggle('on', (+b.dataset.q) === G.tier));
}
syncTierButtons();

/** watch the frame time and quietly drop the load when we choke */
function autoTune(dt) {
  if (!G.autoTune || G.phase === 'menu' || G.phase === 'boot') return;
  fpsHist.push(dt);
  if (fpsHist.length > 50) fpsHist.shift();
  tuneT -= dt;
  if (tuneT > 0 || fpsHist.length < 45) return;
  tuneT = 2.5;
  const avg = fpsHist.reduce((a, b) => a + b, 0) / fpsHist.length;
  G.fps = 1 / Math.max(avg, 1e-4);
  if (G.fps < 33 && G.renderScale > 0.44) {
    G.renderScale = Math.max(0.44, G.renderScale - 0.11);
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, tier().maxPixelRatio) * G.renderScale);
    renderer.setSize(innerWidth, innerHeight, false);
    G.ui.toast && G.ui.toast('⚙ auto-quality ↓');
  } else if (G.fps < 26 && renderer.shadowMap.enabled) {
    renderer.shadowMap.enabled = false;
    if (G.world && G.world.sun) G.world.sun.castShadow = false;
    G.ui.toast && G.ui.toast('⚙ shadows off');
  }
  renderQualityHint();
}

// ── match construction ─────────────────────────────────────────
function buildMatch() {
  if (G.world) {
    scene.remove(G.world.group);
    disposeTree(G.world.group);
    if (G.world.sky) scene.remove(G.world.sky);
    (G.world.clouds || []).forEach((c) => scene.remove(c));
  }
  for (const b of G.bots) if (b.char && b.char.root.parent) scene.remove(b.char.root);
  G.bots.length = 0;
  if (G.player && G.player.char && G.player.char.root.parent) scene.remove(G.player.char.root);
  G.player = null;
  clearLoot(scene);
  resetProjectiles();
  resetFX();

  const seed = (Math.random() * 1e9) | 0;
  G.seed = seed;
  const rnd = new Rand(seed);
  G.rand = rnd;

  const W = buildWorld(scene, seed);
  G.world = W;
  scene.fog = new THREE.Fog(0xa9c6dc, tier().drawDist * 0.42, tier().drawDist);
  scatterLoot(scene, W, rnd);

  // ── player ──
  const good = W.landPoints.filter((p) => p.h > 2.5);
  const ps = rnd.pick(good.length ? good : W.landPoints);
  G.player = makeEntity({
    isPlayer: true, name: 'NTA', x: ps.x, z: ps.z, y: 132,
    seed: (seed ^ 0x5f3a) | 0, gun: 'fists', dropping: true, chuteAt: 54, team: 0x3dd98a,
  });
  G.player.meds = 1;
  G.player.nars = 1;

  // ── bots ──
  const n = tier().maxBots;
  const names = BOT_NAMES.slice();
  for (let i = 0; i < n; i++) {
    const sp = rnd.pick(W.landPoints);
    const skill = clamp(rnd.range(0.22, 0.92), 0, 1);
    const b = makeEntity({
      name: names.splice(rnd.int(0, names.length - 1), 1)[0] || ('BOT' + i),
      x: sp.x + rnd.range(-7, 7), z: sp.z + rnd.range(-7, 7), y: 132 + rnd.range(-18, 18),
      seed: (seed + i * 7717) | 0, gun: 'fists', dropping: true,
      chuteAt: rnd.range(42, 68), team: [0xd94a3d, 0x3d8fd9, 0xd9a53d, 0x7a3dd9][i % 4],
    });
    b.brain.accuracy = clamp(skill * 0.52 + 0.10, 0.1, 0.60);
    b.brain.aggro = clamp(0.35 + skill * 0.8, 0.2, 1.2);
    b.brain.react = lerp(1.15, 0.35, skill);
    b.brain.dropTarget = { x: sp.x, z: sp.z };
    b.skill = skill;
    b._kit = true;
    b._armDelay = 5 + rnd.range(0, 15);   // bots 'loot' before they fight
    G.bots.push(b);
  }

  const zc = rnd.pick(good.length ? good : W.landPoints);
  G.zone = {
    x: zc.x * 0.3, z: zc.z * 0.3, r: ISLAND_R + 14,
    tx: zc.x * 0.3, tz: zc.z * 0.3, tr: ISLAND_R * 0.62,
    phase: 0, timer: 32, shrinking: false, dps: 1.2, shrinkT: 0, shrinkTotal: 1,
  };
  updateZoneMesh(W);

  G.aliveCount = n + 1;
  G.stats = { kills: 0, damage: 0, started: performance.now() };
  matchT = 0;
  camYaw = Math.atan2(-ps.x, -ps.z);
  camPitch = -0.12;
  camDistCur = 9;
  fpsHist.length = 0;
}

function disposeTree(root) {
  root.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      ms.forEach((m) => m.dispose && m.dispose());
    }
  });
}

/** bots "find" their kit the moment they touch the ground */
function giveBotKit(b) {
  if (!b._kit) return;
  b._kit = false;
  botLoadout(b, new Rand((G.seed ^ (b.name.length * 977) + (b.pos.x | 0)) | 0), b.skill || 0.5);
}

// ── start / end ────────────────────────────────────────────────
function startMatch() {
  buildMatch();
  hideScreens();
  setPhase('drop');
  G.phase = 'drop';
  G.ui.touch = isTouch();
  resumeAudio();
  sfx('plane', 1);
  setWind(0.04);
  G.ui.banner && G.ui.banner('✈️ HBOT! قلّب على السلاح');
}

function endMatch(won) {
  if (G.phase === 'over') return;
  G.phase = 'over';
  const place = won ? 1 : G.aliveCount + 1;
  const survived = matchT;
  const coins = Math.round((won ? 120 : 18) + G.stats.kills * 35 + (G.player ? G.player.coins : 0) + Math.max(0, 13 - place) * 8);
  profile.matches++;
  profile.totalKills += G.stats.kills;
  profile.bestKills = Math.max(profile.bestKills, G.stats.kills);
  profile.bestPlace = Math.min(profile.bestPlace, place);
  if (won) profile.wins++;
  profile.coins += coins;
  saveProfile();
  renderStats();
  sfx(won ? 'win' : 'lose', 1);
  setWind(0.012);
  setTimeout(() => {
    showResult({
      badge: won ? '🏆 BOOYAH — RBA7TI!' : '💀 TSWA7T',
      title: '#' + place,
      sub: won ? 'Koulchi tswa7 w nta baqi wa9ef. 3achha!'
        : (place <= 3 ? '9ribti bzaf! 3awd mra khra.' : 'L-merra l-jaya: dkhoul l-zone bkri w jib سلاح.'),
      kills: G.stats.kills, damage: G.stats.damage, time: survived, coins,
    });
  }, won ? 800 : 1500);
}

// ── loop ───────────────────────────────────────────────────────
const FIXED = 1 / 60;
function loop(t) {
  rafId = requestAnimationFrame(loop);
  let dt = (t - lastT) / 1000;
  lastT = t;
  if (dt > 0.25) dt = 0.25;
  G.dt = dt;
  if (paused || booting) { render(dt); return; }
  acc += dt;
  let steps = 0;
  while (acc >= FIXED && steps < 4) { step(FIXED); acc -= FIXED; steps++; }
  if (steps >= 4) acc = 0;
  render(dt);
  autoTune(dt);
}

function step(dt) {
  if (G.phase === 'menu' || G.phase === 'boot') {
    matchT += dt * 0.25;
    camYaw += dt * 0.045;
    if (G.player) updateCamera(dt, true);
    if (G.world) { animateWater(G.world, matchT); updateZoneMesh(G.world); }
    return;
  }
  matchT += dt;
  G.time = matchT;
  const P = G.player;
  if (!P) return;

  stepZone(dt);
  updateZoneMesh(G.world);

  // ── player ──
  const flags = consumeFlags();
  const look = consumeLook();
  const sensK = 0.0032 * (G.sens || 1) * (P.aiming ? 0.55 : 1);
  camYaw -= look.x * sensK;
  camPitch = clamp(camPitch - look.y * sensK * 0.85, -0.8, 0.72);
  if (camYaw > Math.PI) camYaw -= 6.283185; else if (camYaw < -Math.PI) camYaw += 6.283185;

  if (P.alive) {
    if (flags.reload) startReload(P);
    if (flags.med) { if (useMed(P)) sfx('heal', 1); }
    if (flags.nar && P.nars > 0 && !P.dropping) {
      P.nars--;
      throwGrenade(P, new THREE.Vector3(P.pos.x, P.pos.y + 1.4, P.pos.z), aimDir(P), 15.5);
      sfx('reload', 1);
    }
    if (flags.pick && G.ui._nearLoot) takeLoot(G.ui._nearLoot);
  }
  readWish(camYaw);
  P.aiming = IN.aiming && !P.dropping;
  P.crouch = flags.crouch;
  P.sprint = IN.sprint && !P.aiming;
  P.yaw = camYaw;
  P.pitch = camPitch;

  if (IN.firing && P.alive && !P.dropping) {
    const g = P.gun;
    if (g.auto || !P._semiLock) {
      if (tryShoot(P, dt)) P._semiLock = !g.auto;
    }
  }
  if (!IN.firing) P._semiLock = false;

  moveEntity(P, dt, { x: IN.move.x, z: IN.move.z, jump: flags.jump });
  tickEntity(P, dt);
  if (P.alive && !P.dropping && !P._landed) {
    // fair start: the bots find kits seconds after landing, so do you
    P._landed = true;
    P.reserve.pistol = (P.reserve.pistol || 0) + 48;
    if (P.gunId === 'fists') P.setGun('pistol', true);
    G.ui.toast && G.ui.toast('🔫 l9iti pistol — dir E bach tbeddel');
  }
  if (P.alive && !P.dropping) footstep(P.speed || 0, dt, P.crouch);

  // ── bots ──
  const targets = [P, ...G.bots].filter((e) => e.alive);
  for (const b of G.bots) {
    if (b.gone) continue;
    if (b.dropping) {
      const tg = b.brain.dropTarget || { x: 0, z: 0 };
      const dx = tg.x - b.pos.x, dz = tg.z - b.pos.z, dd = Math.hypot(dx, dz);
      moveEntity(b, dt, dd > 5 ? { x: dx / dd, z: dz / dd } : { x: 0, z: 0 });
      if (!b.dropping) b.brain.state = 'loot';
    } else if (b.alive) {
      // bots "find" their kit a few seconds after landing, like a real loot phase
      if (b._landAt === undefined) b._landAt = G.time;
      if (b._kit && G.time - b._landAt > (b._armDelay || 6)) giveBotKit(b);
      moveEntity(b, dt, thinkBot(b, dt) || { x: 0, z: 0 });
    } else moveEntity(b, dt, { x: 0, z: 0 });
    tickEntity(b, dt);
  }

  updateBullets(dt, targets);
  updateGrenades(dt, targets);

  const near = { nearest: null, nearestD: 2.2 };
  updateLoot(dt, P.pos, near);
  G.ui._nearLoot = near.nearest;

  animateWater(G.world, matchT);
  updateSun(G.world, P.pos.x, P.pos.z);
  updateFX(dt);
  updateDamageNumbers(dt);

  if (!P.alive && G.phase !== 'over') endMatch(false);
  else if (P.alive && !P.dropping && G.aliveCount <= 1 && G.phase !== 'over') endMatch(true);
  if (G.phase === 'drop' && !P.dropping) { G.phase = 'play'; setPhase('play'); }
}

// ── zone schedule ──────────────────────────────────────────────
const ZONE_PLAN = [
  { wait: 32, shrink: 26, mul: 0.62, dps: 1.2 },
  { wait: 25, shrink: 22, mul: 0.66, dps: 2.2 },
  { wait: 21, shrink: 20, mul: 0.66, dps: 3.6 },
  { wait: 18, shrink: 18, mul: 0.6, dps: 5.5 },
  { wait: 15, shrink: 16, mul: 0.58, dps: 8 },
  { wait: 13, shrink: 14, mul: 0.5, dps: 12 },
  { wait: 12, shrink: 999, mul: 0.14, dps: 18 },
];
function stepZone(dt) {
  const z = G.zone;
  if (z.shrinking) {
    z.shrinkT -= dt;
    const k = clamp(dt / Math.max(0.001, z.shrinkTotal), 0, 1);
    z.r = lerp(z.r, z.tr, k); z.x = lerp(z.x, z.tx, k); z.z = lerp(z.z, z.tz, k);
    if (z.shrinkT <= 0) {
      z.r = z.tr; z.x = z.tx; z.z = z.tz; z.shrinking = false;
      z.timer = (ZONE_PLAN[Math.min(z.phase, ZONE_PLAN.length - 1)] || { wait: 12 }).wait;
    }
    return;
  }
  z.timer -= dt;
  if (z.timer > 0) return;
  const plan = ZONE_PLAN[Math.min(z.phase, ZONE_PLAN.length - 1)];
  const nr = Math.max(6, z.r * plan.mul);
  const maxOff = Math.max(0, z.r - nr) * 0.8;
  const a = G.rand.range(0, 6.283), d = G.rand.range(0, maxOff);
  z.tx = clamp(z.x + Math.cos(a) * d, -ISLAND_R * 0.7, ISLAND_R * 0.7);
  z.tz = clamp(z.z + Math.sin(a) * d, -ISLAND_R * 0.7, ISLAND_R * 0.7);
  z.tr = nr; z.dps = plan.dps;
  z.shrinking = true; z.shrinkT = plan.shrink; z.shrinkTotal = plan.shrink;
  z.phase++;
  sfx('zone', 1);
  G.ui.banner && G.ui.banner(plan.mul < 0.2 ? '⚠ L-ZONE KATMOUT!' : '⚠ ZONE JDIDA!');
}

// ── camera ─────────────────────────────────────────────────────
function updateCamera(dt, menu) {
  const P = G.player;
  if (!P || !G.world) return;
  const want = (P.aiming ? (P.gunId === 'sniper' ? 1.6 : 2.6) : 5.2) + (G.zoomBias || 0) * 0.4;
  camDistCur = lerp(camDistCur, clamp(want, 1.2, 12), clamp(dt * 7, 0, 1));

  const head = P.pos.y + (P.crouch ? 1.15 : 1.62);
  const cp = Math.cos(camPitch), sp = Math.sin(camPitch);
  const dirX = -Math.sin(camYaw) * cp, dirY = sp, dirZ = -Math.cos(camYaw) * cp;
  const shoulder = P.aiming ? 0.3 : 0.64;
  const rx = Math.cos(camYaw), rz = -Math.sin(camYaw);
  const ox = P.pos.x + rx * shoulder, oy = head + (P.aiming ? 0.02 : 0.16), oz = P.pos.z + rz * shoulder;

  // pull the camera in when geometry is behind us
  let dist = camDistCur;
  for (let s = camDistCur; s > 0.9; s -= 0.42) {
    const tx = ox - dirX * s, ty = oy - dirY * s, tz = oz - dirZ * s;
    if (ty < G.world.groundAt(tx, tz) + 0.6 || G.world.col.segmentBlocked(ox, oz, tx, tz, ty)) {
      dist = Math.max(0.9, s + 0.42); break;
    }
    dist = s;
  }

  const sh = menu ? [0, 0] : shakeOffset();
  const tx = ox - dirX * dist, tz = oz - dirZ * dist;
  const ty = Math.max(oy - dirY * dist, G.world.groundAt(tx, tz) + 0.75);
  camPos.lerp(tmpV.set(tx + sh[0], ty + sh[1], tz + sh[0] * 0.5), clamp(dt * (menu ? 2.5 : 26), 0, 1));
  camera.position.copy(camPos);
  camLook.lerp(tmpV.set(ox + dirX * 7, oy + dirY * 7 - 0.12, oz + dirZ * 7), clamp(dt * (menu ? 3 : 20), 0, 1));
  camera.lookAt(camLook);
  camera.rotation.z += sh[0] * 0.05;
  const fov = P.aiming ? (P.gunId === 'sniper' ? 26 : 44) : 62;
  if (Math.abs(camera.fov - fov) > 0.05) {
    camera.fov = lerp(camera.fov, fov, clamp(dt * 8, 0, 1));
    camera.updateProjectionMatrix();
  }
}

function render(dt) {
  updateCamera(dt, G.phase === 'menu' || G.phase === 'boot');
  if (G.world && G.world.sky) G.world.sky.position.copy(camera.position);
  renderer.render(scene, camera);
  if (G.phase !== 'menu' && G.phase !== 'boot') updateHUD(dt);
}

// ── HUD callbacks other modules call into ──────────────────────
G.ui.onPlayerDeath = () => {
  sfx('hurt', 1);
  G.ui.vig && G.ui.vig(true);
  setTimeout(() => G.ui.vig && G.ui.vig(false), 1800);
};
G.ui.onBotKilled = (e, headshot) => {
  sfx('kill', 1);
  G.ui.banner && G.ui.banner(headshot ? `🎯 HEADSHOT! ${e.name}` : `☠ ${e.name}`);
};
G.ui.onWin = () => endMatch(true);
G.ui.equipGun = (ent, id) => equipGunMesh(ent, id);
G.ui.chatter = (name, txt) => {
  const feed = document.getElementById('killfeed');
  if (!feed) return;
  const d = document.createElement('div');
  d.className = 'kf';
  d.style.borderLeftColor = '#7fd3ff';
  d.innerHTML = `<span style="color:#9fd8ff">${name}:</span> ${txt}`;
  feed.appendChild(d);
  setTimeout(() => d.remove(), 4200);
  while (feed.children.length > 5) feed.firstChild.remove();
};

// ── UI wiring ──────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
function togglePause() {
  if (G.phase === 'menu' || G.phase === 'over' || G.phase === 'boot') return;
  paused = !paused;
  if (paused) { showScreen('pause'); renderQualityHint(); } else hideScreens();
  sfx('ui', 0.8);
}
function toggleSound() {
  profile.sound = profile.sound === false;
  setEnabled(profile.sound !== false);
  saveProfile();
  sfx('ui', 1);
  G.ui.toast && G.ui.toast(profile.sound === false ? '🔇 Sound OFF' : '🔊 Sound ON');
}

$('btnPlay').addEventListener('click', () => { sfx('ui', 1); startMatch(); });
$('btnHow').addEventListener('click', () => { sfx('ui', 1); showScreen('how'); });
$('btnHowBack').addEventListener('click', () => { sfx('ui', 1); showScreen('menu'); });
$('btnResume').addEventListener('click', () => togglePause());
$('btnPause').addEventListener('click', () => togglePause());
$('btnQuit').addEventListener('click', () => { paused = false; G.phase = 'menu'; showScreen('menu'); setPhase('none'); renderStats(); sfx('ui', 1); });
$('btnAgain').addEventListener('click', () => { sfx('ui', 1); startMatch(); });
$('btnMenu').addEventListener('click', () => { G.phase = 'menu'; showScreen('menu'); setPhase('none'); renderStats(); sfx('ui', 1); });

document.querySelectorAll('#qOpt button, #qOpt2 button').forEach((b) => {
  b.addEventListener('click', () => {
    sfx('ui', 1);
    fpsHist.length = 0;
    const rebuilding = G.phase === 'menu' || G.phase === 'boot';
    setTier(+b.dataset.q, rebuilding);
  });
});
document.querySelectorAll('#sOpt button').forEach((b) => {
  b.addEventListener('click', () => {
    sfx('ui', 1);
    G.sens = +b.dataset.s; IN.sens = G.sens;
    profile.sens = G.sens; saveProfile();
    document.querySelectorAll('#sOpt button').forEach((o) => o.classList.toggle('on', o === b));
  });
});
document.querySelectorAll('#sOpt button').forEach((o) => o.classList.toggle('on', +o.dataset.s === G.sens));

addEventListener('resize', () => {
  if (!renderer) return;
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, tier().maxPixelRatio) * G.renderScale);
  renderer.setSize(innerWidth, innerHeight, false);
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && !paused && (G.phase === 'play' || G.phase === 'drop')) togglePause();
});
addEventListener('pointerdown', () => resumeAudio(), { once: true });
addEventListener('pagehide', () => { if (rafId) cancelAnimationFrame(rafId); });

window.__nar = { G, tier: () => TIERS[G.tier], setTier, heightAt, fmtTime };
