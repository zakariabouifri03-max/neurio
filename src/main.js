// ── The Long Drive 3D — Bootstrap, Renderer, HUD & Mechanic UI ───────────────
import * as THREE from 'three';
import { BloomFX } from './post.js';
import { LongDriveGame } from './game.js';
import { loadSave, persistSave, clearSave } from './save.js';
import {
  CAR_ARCHETYPES,
  CAR_BY_ID,
  ENGINES,
  RADIATORS,
  ITEM_DEFS,
  RADIO_STATIONS,
  GRAPHICS_PRESETS,
  PAINT_COLORS,
  MOM_LETTER,
} from './data.js';
import { audio } from './audio.js';
import { clamp, fmt1, roadX } from './util.js';

const $ = (id) => document.getElementById(id);

addEventListener('error', (e) => {
  const el = $('errLog');
  if (el) {
    el.style.display = 'block';
    el.textContent =
      '⚠️ ' +
      (e.message || 'Error') +
      (e.filename ? `\n${e.filename.split('/').pop()}:${e.lineno}` : '');
  }
});

let toastTimer = null;
function showToast(html, warn = false) {
  const t = $('toast');
  t.innerHTML = html;
  t.classList.toggle('warn', warn);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3100);
}

// ── Format Time of Day (0..24) ───────────────────────────────────────────────
function formatClock(hr) {
  const h24 = Math.floor(hr) % 24;
  const mins = Math.floor((hr - Math.floor(hr)) * 60);
  const icon = h24 >= 6 && h24 < 18 ? '☀️' : h24 >= 18 && h24 < 20 ? '🌅' : '🌙';
  const hh = String(h24).padStart(2, '0');
  const mm = String(mins).padStart(2, '0');
  return `${icon} ${hh}:${mm}`;
}

// ── Persistent Graphics & Realism Settings Manager ───────────────────────────
const GFX_KEY = 'the_long_drive_gfx_v1';
const DEFAULT_SETTINGS = {
  preset: 'high',
  resolutionMode: 'preset',
  shadows: true,
  shadowMapSize: 1024,
  bloom: true,
  chromaticAberration: false,
  filmGrain: false,
  exposure: 1.05,
  drawDistance: 9,
  fov: 74,
  physicsRealism: 'simulation',
  showFps: true,
};

function loadGraphicsSettings() {
  try {
    const raw = localStorage.getItem(GFX_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveGraphicsSettings(s) {
  try {
    localStorage.setItem(GFX_KEY, JSON.stringify(s));
  } catch {
    // ignore storage errors
  }
}

// ── Bootstrap Game & Renderer ────────────────────────────────────────────────
let sim = null;
let paused = false;
let rendererRef = null;
let fxRef = null;
let userSettings = loadGraphicsSettings();
let currentFps = 60;

function boot() {
  const host = $('app');
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  host.appendChild(renderer.domElement);
  rendererRef = renderer;

  const fx = new BloomFX(renderer);
  fx.setSize(innerWidth, innerHeight);
  fxRef = fx;

  const saved = loadSave();
  sim = new LongDriveGame(host, saved, {
    toast: showToast,
    onHudUpdate: () => refreshHud(),
    openMomLetter: () => openLetterModal(),
    openInspectorModal: () => openInspectorModal(),
  });
  window.GAME = sim;

  // Apply initial graphics preset & settings
  sim.applyGraphicsSettings(userSettings, renderer, fx);
  updateMainMenuStats();

  wireControls(renderer.domElement);
  wireMainMenuAndSettings();
  refreshHud();

  // Auto-save every 8 seconds
  setInterval(() => {
    if (sim && !sim.inMainMenu) persistSave(sim.serializeSave());
  }, 8000);

  // Resize listener
  addEventListener('resize', () => {
    sim.camera.aspect = innerWidth / innerHeight;
    sim.camera.updateProjectionMatrix();
    sim.applyGraphicsSettings(userSettings, renderer, fx);
  });

  // Main render loop
  const clock = new THREE.Clock();
  let hudTick = 0;
  let fpsT = 0, fpsN = 0;

  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.08);
    fpsT += dt;
    fpsN++;
    if (fpsT >= 0.5) {
      currentFps = Math.round(fpsN / fpsT);
      const badge = $('fpsBadge');
      if (badge) {
        badge.style.display = userSettings.showFps ? 'inline-block' : 'none';
        const pName = (GRAPHICS_PRESETS[userSettings.preset]?.id || 'HIGH').toUpperCase();
        badge.textContent = `${currentFps} FPS • ${pName}`;
      }
      fpsT = 0;
      fpsN = 0;
    }

    if (!paused) {
      sim.update(dt);
      hudTick += dt;
      if (hudTick > 0.1) {
        hudTick = 0;
        refreshTelemetryAndCrosshair();
      }
    }
    fx.render(sim.scene, sim.camera);
  });

  // Hide loading overlay & display the 3D Main Menu
  setTimeout(() => {
    $('loading').classList.add('hide');
    setTimeout(() => $('loading')?.remove(), 650);
  }, 550);
}

// ── Professional 3D Interactive Main Menu ────────────────────────────────────
function updateMainMenuStats() {
  const odoEl = $('menuStatOdo');
  const bestEl = $('menuStatBest');
  const gfxEl = $('menuStatGfx');
  const startSub = $('menuStartSub');
  if (!odoEl || !sim) return;

  const hasTrip = sim.odometerKm > 0.05 || sim._loadedFromSave;
  odoEl.textContent = sim.odometerKm.toFixed(1) + ' KM';
  bestEl.textContent = Math.max(sim.bestKm, sim.odometerKm).toFixed(1) + ' KM';
  if (gfxEl) {
    const preset = GRAPHICS_PRESETS[userSettings.preset];
    gfxEl.textContent = (preset ? preset.label : userSettings.preset).toUpperCase();
  }
  if (startSub) {
    startSub.textContent = hasTrip
      ? `Continue your road trip — ${sim.odometerKm.toFixed(1)} KM already traveled`
      : 'Assemble your disassembled car at 0.0 KM & begin the journey';
  }
}

function showMainMenu() {
  if (!sim) return;
  if (document.pointerLockElement) document.exitPointerLock();
  sim.inMainMenu = true;
  $('mainMenu').classList.remove('hidden');
  updateMainMenuStats();
}

function enterGameFromMenu() {
  if (!sim) return;
  audio.unlock();
  sim.inMainMenu = false;
  $('mainMenu').classList.add('hidden');
  paused = false;
  refreshHud();
  const canvas = rendererRef?.domElement;
  if (canvas && !('ontouchstart' in window)) canvas.requestPointerLock?.();

  if (!sim._letterShown) {
    sim._letterShown = true;
    setTimeout(() => openLetterModal(), 350);
  }
}

// ── Graphics, 4K/HD Display, Shadows & Physics Settings Modal ────────────────
const PRESET_DESCRIPTIONS = {
  low: '720p HD Performance Mode — Shadows Off, No PostFX — Maximum FPS on any device',
  medium: '900p Balanced — 1024px Soft Shadows, Light Bloom, 1.2 KM Horizon',
  high: '1080p Full HD — 1024px Shadows, HDR Bloom & ACES Filmic Tonemapping, 1.4 KM Horizon',
  very_high: '1440p QHD — 2048px Crisp Shadows, Strong HDR Bloom, 1.8 KM Horizon',
  ultra: '4K UHD Supersampled — 4096px Ultra Shadows, Full PostFX, 2.1 KM Horizon',
  extreme: '4K Max Cinema — 4096px Shadows, Chromatic Lens & Film Grain, 2.6 KM Horizon',
};

let settingsOpenedFromMenu = false;

function openSettingsModal(fromMenu) {
  if (document.pointerLockElement) document.exitPointerLock();
  settingsOpenedFromMenu = !!fromMenu;
  if (fromMenu) paused = false;
  else paused = true;
  syncSettingsUI();
  $('settingsModal').classList.remove('hidden');
}

function closeSettingsModal() {
  $('settingsModal').classList.add('hidden');
  if (!sim.inMainMenu) paused = false;
  saveGraphicsSettings(userSettings);
  updateMainMenuStats();
}

function syncSettingsUI() {
  // Preset button highlight
  document.querySelectorAll('#presetBtns .presetBtn').forEach((b) => {
    b.classList.toggle('active', b.dataset.preset === userSettings.preset);
  });
  const desc = $('presetDesc');
  if (desc) desc.textContent = PRESET_DESCRIPTIONS[userSettings.preset] || '';

  const selRes = $('selResolution');
  if (selRes) selRes.value = userSettings.resolutionMode || 'preset';
  const rngFov = $('rngFov');
  if (rngFov) {
    rngFov.value = userSettings.fov;
    $('lblFov').textContent = userSettings.fov + '°';
  }
  const rngDist = $('rngDrawDist');
  if (rngDist) {
    rngDist.value = userSettings.drawDistance;
    $('lblDrawDist').textContent = ((userSettings.drawDistance * 160) / 1000).toFixed(1) + ' KM';
  }
  const chkFps = $('chkShowFps');
  if (chkFps) chkFps.checked = !!userSettings.showFps;
  const chkShadows = $('chkShadows');
  if (chkShadows) chkShadows.checked = !!userSettings.shadows;
  const selShadow = $('selShadowSize');
  if (selShadow) selShadow.value = String(userSettings.shadowMapSize || 1024);
  const rngExp = $('rngExposure');
  if (rngExp) {
    rngExp.value = userSettings.exposure;
    $('lblExposure').textContent = Number(userSettings.exposure).toFixed(2);
  }
  const chkBloom = $('chkBloom');
  if (chkBloom) chkBloom.checked = !!userSettings.bloom;
  const chkChrom = $('chkChromatic');
  if (chkChrom) chkChrom.checked = !!userSettings.chromaticAberration;
  const chkGrain = $('chkGrain');
  if (chkGrain) chkGrain.checked = !!userSettings.filmGrain;
  const selPhys = $('selPhysics');
  if (selPhys) selPhys.value = userSettings.physicsRealism || 'simulation';
}

function applyGraphicsFromUI(liveToast = true) {
  userSettings.shadowMapSize = Number($('selShadowSize').value) || 1024;
  userSettings.shadows = $('chkShadows').checked;
  userSettings.bloom = $('chkBloom').checked;
  userSettings.chromaticAberration = $('chkChromatic').checked;
  userSettings.filmGrain = $('chkGrain').checked;
  userSettings.exposure = Number($('rngExposure').value);
  userSettings.resolutionMode = $('selResolution').value;
  userSettings.fov = Number($('rngFov').value);
  userSettings.drawDistance = Number($('rngDrawDist').value);
  userSettings.physicsRealism = $('selPhysics').value;
  userSettings.showFps = $('chkShowFps').checked;

  sim.applyGraphicsSettings(userSettings, rendererRef, fxRef);
  saveGraphicsSettings(userSettings);
  updateMainMenuStats();
  if (liveToast) {
    const preset = GRAPHICS_PRESETS[userSettings.preset];
    showToast(`⚙️ Graphics applied: <b>${preset ? preset.label : userSettings.preset}</b> • ${userSettings.shadowMapSize}px Shadows • ${userSettings.resolutionMode === '4k' ? '4K UHD' : userSettings.resolutionMode === 'preset' ? `${Math.round((GRAPHICS_PRESETS[userSettings.preset]?.resScale || 1) * 100)}% Render Scale` : userSettings.resolutionMode.toUpperCase()}`);
  }
}

// ── Vehicle & Ikarus Bus Fleet Showroom ──────────────────────────────────────
function openShowroomModal() {
  if (document.pointerLockElement) document.exitPointerLock();
  paused = true;
  renderShowroomBody();
  $('showroomModal').classList.remove('hidden');
}

function closeShowroomModal() {
  $('showroomModal').classList.add('hidden');
  if (!sim.inMainMenu) paused = false;
}

function renderShowroomBody() {
  const body = $('showroomBody');
  if (!body || !sim) return;
  body.innerHTML = `
    <div class="showroomGrid">
      ${CAR_ARCHETYPES.map((arch, idx) => {
        const eng = ENGINES[arch.defaultEngine];
        const rad = RADIATORS[arch.defaultRadiator];
        return `
        <div class="showCard">
          <div>
            <b>${arch.name}</b>
            <small>${arch.desc}</small>
            <small>⚖️ ${arch.massKg} kg • ⛽ ${arch.fuelCap}L • 📦 ${arch.trunkSlots} slots • 🛞 ${arch.wheelBase}m wheelbase</small>
            <small>⚙️ ${eng ? eng.name : '—'} (${eng ? eng.hp : '?'} HP) • 🌡️ ${rad ? rad.name : '—'} • Top ${eng ? eng.topSpeedKmh : '?'} km/h</small>
          </div>
          <button class="miniActBtn" data-spawn-arch="${idx}">🛠️ Spawn for Test Drive</button>
        </div>`;
      }).join('')}
    </div>
    <div style="margin-top:12px;font-size:12px;color:#94a3b8;">
      Spawned test vehicles appear right beside you on the highway shoulder — they may arrive broken down, so bring Repair Kits, Wheels &amp; Fuel!
    </div>`;

  body.querySelectorAll('[data-spawn-arch]').forEach((btn) => {
    btn.onclick = () => {
      const arch = CAR_ARCHETYPES[Number(btn.dataset.spawnArch)];
      if (!arch) return;
      const focusX = sim.mode === 'drive' && sim.activeCar ? sim.activeCar.x : sim.player.x;
      const focusZ = sim.mode === 'drive' && sim.activeCar ? sim.activeCar.z : sim.player.z;
      const paint = PAINT_COLORS[(arch.id.length * 3) % PAINT_COLORS.length];
      sim.spawnVehicle({
        archId: arch.id,
        x: focusX + (roadX(focusZ) - focusX) * 0.4 + 6.5,
        y: 0.08,
        z: focusZ + 7.5,
        heading: 0,
        paintHex: paint.hex,
        condition: 0.55 + Math.random() * 0.3,
        fuel: Math.round(Math.random() * 12 * 10) / 10,
        oil: Math.round(Math.random() * 2.2 * 10) / 10,
        water: Math.round(Math.random() * 4 * 10) / 10,
        engineId: Math.random() < 0.2 ? null : arch.defaultEngine,
        engineCondition: 0.4 + Math.random() * 0.5,
        radiatorId: Math.random() < 0.25 ? null : arch.defaultRadiator,
        radiatorCondition: 0.5 + Math.random() * 0.45,
        wheels: [0, 1, 2, 3].map(() => ({
          installed: Math.random() > 0.25,
          condition: 0.45 + Math.random() * 0.5,
        })),
        hoodOpen: true,
      });
      audio.wrench();
      showToast(`🛠️ Spawned <b>${arch.name}</b> nearby — check its wheels, engine, radiator &amp; fluids!`);
      closeShowroomModal();
    };
  });
}

// ── Wire Main Menu Buttons & Graphics Settings Controls ──────────────────────
function wireMainMenuAndSettings() {
  // Main Menu navigation
  $('btnMenuStart').onclick = () => enterGameFromMenu();
  $('btnMenuSettings').onclick = () => openSettingsModal(true);
  $('btnMenuShowroom').onclick = () => openShowroomModal();
  $('btnMenuGuide').onclick = () => {
    paused = true;
    $('pauseModal').classList.remove('hidden');
  };
  $('btnMenuNew').onclick = () => {
    clearSave();
    location.reload();
  };

  // Settings modal controls
  $('btnCloseSettings').onclick = () => closeSettingsModal();
  $('btnApplySettings').onclick = () => {
    applyGraphicsFromUI(true);
    closeSettingsModal();
  };
  $('btnResetSettings').onclick = () => {
    userSettings = { ...DEFAULT_SETTINGS };
    syncSettingsUI();
    applyGraphicsFromUI(false);
    showToast('↺ Graphics reset to <b>High (1080p Full HD)</b> defaults');
  };

  document.querySelectorAll('#presetBtns .presetBtn').forEach((btn) => {
    btn.onclick = () => {
      const presetId = btn.dataset.preset;
      const preset = GRAPHICS_PRESETS[presetId];
      if (!preset) return;
      userSettings.preset = presetId;
      userSettings.resolutionMode = 'preset';
      userSettings.shadows = preset.shadows;
      userSettings.shadowMapSize = preset.shadowMapSize;
      userSettings.bloom = preset.bloom;
      userSettings.exposure = preset.exposure;
      userSettings.drawDistance = preset.drawChunksAhead;
      syncSettingsUI();
      applyGraphicsFromUI(false);
    };
  });

  $('rngFov').oninput = (e) => {
    $('lblFov').textContent = e.target.value + '°';
  };
  $('rngDrawDist').oninput = (e) => {
    $('lblDrawDist').textContent = ((Number(e.target.value) * 160) / 1000).toFixed(1) + ' KM';
  };
  $('rngExposure').oninput = (e) => {
    $('lblExposure').textContent = Number(e.target.value).toFixed(2);
  };

  // In-game settings button + pause-modal shortcut
  $('btnSettings').onclick = () => openSettingsModal(sim.inMainMenu);
  if ($('btnOpenSettingsFromPause')) {
    $('btnOpenSettingsFromPause').onclick = () => {
      $('pauseModal').classList.add('hidden');
      openSettingsModal(sim.inMainMenu);
    };
  }

  // Top bar home / main-menu button
  if ($('btnOpenMainMenu')) $('btnOpenMainMenu').onclick = () => showMainMenu();

  // Showroom modal
  $('btnCloseShowroom').onclick = () => closeShowroomModal();
}

// ── Live HUD, Driving Dashboard & Crosshair Tooltip ──────────────────────────
function refreshHud() {
  if (!sim) return;
  const p = sim.player;

  // Hotbar slots 1-5
  const hb = $('hotbar');
  hb.innerHTML = '';
  for (let i = 0; i < 5; i++) {
    const itm = p.hotbar[i];
    const div = document.createElement('div');
    div.className = 'hotSlot' + (p.activeSlot === i ? ' active' : '');
    let badge = 'Empty';
    if (itm) {
      if (itm.category === 'fluid') badge = `${fmt1(itm.amount)}/${itm.capacity}L`;
      else if (itm.category === 'weapon') badge = `${itm.ammo} Ammo`;
      else if (itm.category === 'part') badge = `${Math.round((itm.condition ?? 0.85) * 100)}%`;
      else badge = itm.name.split(' ')[0];
    }
    div.innerHTML = `
      <span class="slotKey">${i + 1}</span>
      <span class="slotIcon">${itm ? itm.icon : '·'}</span>
      <span class="slotBadge">${badge}</span>
    `;
    div.onclick = () => sim.selectSlot(i);
    hb.appendChild(div);
  }

  // Show/hide Driving Cockpit Dashboard
  const inCar = sim.mode === 'drive' && sim.activeCar;
  $('driveHud').classList.toggle('hidden', !inCar);
  $('crosshairWrap').classList.toggle('hidden', inCar);
  $('btnQuickCar').innerHTML = inCar ? '🚶 Step Out <kbd>E</kbd>' : '🚗 Drive Car';

  refreshTelemetryAndCrosshair();
}

function refreshTelemetryAndCrosshair() {
  if (!sim) return;
  const p = sim.player;

  // While the 3D Main Menu is open, hide the gameplay crosshair & tooltip
  if (sim.inMainMenu) {
    $('crosshairWrap').classList.add('hidden');
    const chkEl = $('buildChecklist');
    if (chkEl) chkEl.classList.add('hidden');
    return;
  }
  $('crosshairWrap').classList.remove('hidden');

  // Odometer & Clock
  $('hudOdo').textContent = sim.odometerKm.toFixed(1).padStart(6, '0') + ' KM';
  $('hudTime').textContent = formatClock(sim.timeOfDay);

  // Next Roadside Landmark Scanner (Palaces, Houses, Kasbahs, Bus Terminals, Gas Stations)
  const focusZ = sim.mode === 'drive' && sim.activeCar ? sim.activeCar.z : p.z;
  let nearestPoi = null;
  let bestDist = 99999;
  for (const [, ch] of sim.world.chunks.entries()) {
    if (ch.poiInfo) {
      const dist = Math.abs(ch.poiInfo.z - focusZ);
      if (dist < bestDist) {
        bestDist = dist;
        nearestPoi = ch.poiInfo;
      }
    }
  }
  if (Math.abs(focusZ) < 45) {
    $('hudPoi').textContent = '📍 Home Compound (0.0 KM)';
  } else if (nearestPoi) {
    const distStr = bestDist >= 1000 ? `${(bestDist / 1000).toFixed(2)} KM` : `${Math.round(bestDist)}m`;
    $('hudPoi').textContent = `📍 ${nearestPoi.name} (${distStr})`;
  } else {
    $('hudPoi').textContent = '📍 Endless Open Desert Highway';
  }

  // Player Vitals
  $('barHp').style.width = `${clamp(p.health, 0, 100)}%`;
  $('txtHp').textContent = Math.round(p.health);
  $('barThirst').style.width = `${clamp(p.thirst, 0, 100)}%`;
  $('txtThirst').textContent = Math.round(p.thirst);
  $('barHunger').style.width = `${clamp(p.hunger, 0, 100)}%`;
  $('txtHunger').textContent = Math.round(p.hunger);

  // Live Vehicle Build / Repair Checklist Widget
  const targetCar = sim.activeCar || sim.vehicles[0];
  const chkEl = $('buildChecklist');
  if (targetCar && chkEl) {
    const wheelCount = targetCar.wheels.filter((w) => w.installed).length;
    const engOk = !!targetCar.engineId && (targetCar.engineCondition ?? 0.8) >= 0.25;
    const radOk = !!targetCar.radiatorId;
    const wheelsOk = wheelCount === 4;
    const gasOk = targetCar.fuel > 0.5;
    const oilOk = targetCar.oil > 0.2;
    const waterOk = targetCar.water > 0.5;
    const allReady = engOk && radOk && wheelsOk && gasOk && oilOk && waterOk;

    // Show checklist if car needs assembly/repairs, or while at the starter garage (z < 30)
    const showChk = !allReady || (sim.mode === 'walk' && Math.hypot(targetCar.x - p.x, targetCar.z - p.z) < 14 && sim.odometerKm < 0.2);
    chkEl.classList.toggle('hidden', !showChk);

    if (showChk) {
      $('chkCarTitle').textContent = `🔧 ${targetCar.name}`;
      const badge = $('chkStatusBadge');
      badge.textContent = allReady ? 'READY TO DRIVE!' : 'NEEDS ASSEMBLY';
      badge.className = 'chkBadge ' + (allReady ? 'ok' : 'warn');

      const engText = !targetCar.engineId
        ? '❌ Missing'
        : (targetCar.engineCondition ?? 0.8) < 0.25
        ? '⚠️ Broken (Use Wrench)'
        : `✅ ${ENGINES[targetCar.engineId]?.hp || ''} HP`;

      $('chkItems').innerHTML = `
        <div class="chkRow ${engOk ? 'ready' : 'missing'}"><span>⚙️ Engine</span><b>${engText}</b></div>
        <div class="chkRow ${radOk ? 'ready' : 'missing'}"><span>🌡️ Radiator</span><b>${radOk ? '✅ Installed' : '❌ Missing'}</b></div>
        <div class="chkRow ${wheelsOk ? 'ready' : 'missing'}"><span>🛞 Wheels</span><b>${wheelsOk ? '✅ 4/4 Mounted' : `❌ ${wheelCount}/4 Mounted`}</b></div>
        <div class="chkRow ${gasOk ? 'ready' : 'missing'}"><span>⛽ Gasoline</span><b>${gasOk ? `✅ ${fmt1(targetCar.fuel)} L` : '❌ Empty (0.0 L)'}</b></div>
        <div class="chkRow ${oilOk ? 'ready' : 'missing'}"><span>🛢️ Motor Oil</span><b>${oilOk ? `✅ ${fmt1(targetCar.oil)} L` : '❌ Empty (0.0 L)'}</b></div>
        <div class="chkRow ${waterOk ? 'ready' : 'missing'}"><span>💧 Coolant Water</span><b>${waterOk ? `✅ ${fmt1(targetCar.water)} L` : '❌ Empty (0.0 L)'}</b></div>
      `;
    }
  }

  // Driving Dashboard update
  if (sim.mode === 'drive' && sim.activeCar) {
    const car = sim.activeCar;
    const arch = CAR_BY_ID[car.archId] || CAR_BY_ID.sedan;
    const eng = ENGINES[car.engineId];
    const rad = RADIATORS[car.radiatorId];

    const kmh = Math.round(Math.abs(car.speed) * 3.6);
    $('hudKmh').textContent = kmh;

    const bGear = $('badgeGear');
    if (bGear) {
      bGear.textContent = `⚙️ GEAR ${car.currentGear || 'N'}`;
      bGear.className = 'badge ' + (car.currentGear === 'R' ? 'warn' : 'on');
    }

    const bIgn = $('badgeIgn');
    bIgn.textContent = car.engineRunning ? '🔑 IGN ON' : '🔑 IGN OFF';
    bIgn.className = 'badge ' + (car.engineRunning ? 'on' : 'warn');

    const bBrk = $('badgeBrk');
    bBrk.textContent = car.handbrake ? '🅿️ BRAKE ON' : '🅿️ FREE';
    bBrk.className = 'badge ' + (car.handbrake ? 'warn' : '');

    const bLgt = $('badgeLights');
    bLgt.textContent = car.headlights === 2 ? '💡 HIGH' : car.headlights === 1 ? '💡 LOW' : '💡 OFF';
    bLgt.className = 'badge ' + (car.headlights > 0 ? 'on' : '');

    // Fluids bars
    const gasCap = arch.fuelCap;
    const oilCap = eng ? eng.oilCap : 3.5;
    const waterCap = rad ? rad.waterCap : 8.0;

    $('fBarGas').style.width = `${clamp((car.fuel / gasCap) * 100, 0, 100)}%`;
    $('fTxtGas').textContent = `${fmt1(car.fuel)}/${gasCap}L`;

    $('fBarOil').style.width = `${clamp((car.oil / oilCap) * 100, 0, 100)}%`;
    $('fTxtOil').textContent = `${fmt1(car.oil)}/${oilCap}L`;

    $('fBarWater').style.width = `${clamp((car.water / waterCap) * 100, 0, 100)}%`;
    $('fTxtWater').textContent = `${fmt1(car.water)}/${waterCap}L`;

    $('fBarTemp').style.width = `${clamp(((car.tempC - 30) / 95) * 100, 5, 100)}%`;
    $('fTxtTemp').textContent = `${Math.round(car.tempC)}°C${car.tempC > 105 ? ' ⚠️' : ''}`;

    const st = RADIO_STATIONS[audio.stationIdx];
    $('hudRadioFreq').textContent = audio.radioOn ? st.freq : 'OFF';
    $('hudRadioName').textContent = audio.radioOn ? st.name : 'RADIO MUTED [R]';
    return;
  }

  // On-Foot Center Crosshair & Inspection Tooltip
  const hit = sim.hoveredInteract;
  const chEl = $('crosshair');
  const box = $('inspectBox');
  if (!hit) {
    chEl.classList.remove('active');
    box.classList.add('hidden');
    return;
  }

  chEl.classList.add('active');
  box.classList.remove('hidden');

  const held = sim.getHeldItem();
  let title = '';
  let meta = '';
  let actions = '';

  switch (hit.type) {
    case 'world_item': {
      const itm = hit.worldItem.item;
      const def = ITEM_DEFS[itm.defId];
      title = `${itm.icon} ${itm.name}`;
      if (itm.category === 'fluid') {
        meta = `Contents: ${fmt1(itm.amount)} / ${itm.capacity} L (${itm.fluidType.toUpperCase()})`;
      } else if (itm.category === 'part') {
        meta = `Condition: ${Math.round((itm.condition ?? 0.85) * 100)}% • ${def?.desc || ''}`;
      } else {
        meta = def?.desc || '';
      }
      actions = `<span><kbd>E</kbd> Pick Up</span>`;
      if (itm.category === 'food' || itm.fluidType === 'water') {
        actions += `<span><kbd>F</kbd> Consume</span>`;
      }
      break;
    }
    case 'mom_letter':
      title = '✉️ Letter from Mom';
      meta = 'Pinned to the kitchen table';
      actions = `<span><kbd>E</kbd> Read Letter</span>`;
      break;
    case 'bed':
      title = '🛏️ Desert Cot';
      meta = 'Rest 6 hours & restore Health/Stamina to 100%';
      actions = `<span><kbd>E</kbd> Sleep 6 Hours</span>`;
      break;
    case 'water_pump':
      title = '💧 Desert Well Spigot';
      meta = 'Clean underground water source (Infinite)';
      actions =
        held && held.fluidType === 'water'
          ? `<span><kbd>E</kbd> Fill ${held.name}</span>`
          : `<span><kbd>E</kbd> Drink Water (+100% Thirst)</span>`;
      break;
    case 'fuel_pump':
      title = '⛽ Vintage Gasoline Pump';
      meta = `Station Reserve: ${fmt1(hit.fuelLeft)} L Gasoline remaining`;
      actions = `<span><kbd>E</kbd> / <kbd>F</kbd> Pump Fuel into Can or Nearby Car</span>`;
      break;
    case 'car_door':
      title = `🚪 ${hit.car.name} (${hit.side === 'L' ? 'Driver' : 'Passenger'} Door)`;
      meta = `Body Condition: ${Math.round((hit.car.condition ?? 0.65) * 100)}%`;
      actions = `<span><kbd>E</kbd> Open/Close Door</span> <span><kbd>F</kbd> Enter Driver's Seat</span>`;
      if (held?.defId === 'wire_brush') actions += ` <span><kbd>Click</kbd> Scrub Rust</span>`;
      if (held?.defId === 'spray_paint') actions += ` <span><kbd>Click</kbd> Spray Paint</span>`;
      break;
    case 'car_seat':
      title = `💺 Driver's Seat — ${hit.car.name}`;
      meta = `Fuel: ${fmt1(hit.car.fuel)}L • Oil: ${fmt1(hit.car.oil)}L • Water: ${fmt1(hit.car.water)}L`;
      actions = `<span><kbd>E</kbd> Sit &amp; Drive</span>`;
      break;
    case 'car_radio':
      title = `📻 Dashboard FM Radio`;
      meta = `Current: ${RADIO_STATIONS[audio.stationIdx].freq} — ${RADIO_STATIONS[audio.stationIdx].name}`;
      actions = `<span><kbd>E</kbd> Next Station</span> <span><kbd>F</kbd> Power On/Off</span>`;
      break;
    case 'car_hood':
      title = `🔧 Front Hood (Engine Bay)`;
      meta = hit.car.hoodOpen ? 'Hood is OPEN — inspect Engine & Radiator inside' : 'Open hood to check Oil, Water, Engine & Radiator';
      actions = `<span><kbd>E</kbd> ${hit.car.hoodOpen ? 'Close' : 'Open'} Hood</span>`;
      break;
    case 'car_trunk':
      title = `📦 Rear Trunk Lid`;
      meta = `Stowed Cargo: ${hit.car.trunk.length} / ${CAR_BY_ID[hit.car.archId].trunkSlots} items`;
      actions = `<span><kbd>E</kbd> ${hit.car.trunkOpen ? 'Close' : 'Open'} Trunk</span>`;
      break;
    case 'car_trunk_bay':
      title = `📦 Trunk Cargo Bay (${hit.car.trunk.length}/${CAR_BY_ID[hit.car.archId].trunkSlots})`;
      meta = held ? `Holding: ${held.icon} ${held.name}` : 'Open [Tab] or hold an item to stow here';
      actions = held
        ? `<span><kbd>E</kbd> / <kbd>F</kbd> Stow ${held.name} in Trunk</span>`
        : `<span><kbd>E</kbd> Open Trunk Manager</span>`;
      break;
    case 'trunk_item':
      title = `${hit.item.icon} ${hit.item.name} (In Trunk)`;
      meta = 'Mounted securely in trunk cargo bay';
      actions = `<span><kbd>E</kbd> Take Item</span>`;
      break;
    case 'car_fuel_cap': {
      const arch = CAR_BY_ID[hit.car.archId];
      title = `⛽ Fuel Filler Neck — ${hit.car.name}`;
      meta = `Gasoline: ${fmt1(hit.car.fuel)} / ${arch.fuelCap} L`;
      if (held && held.fluidType === 'gas') {
        actions = `<span><kbd>E</kbd> / <kbd>F</kbd> / <kbd>Click</kbd> Pour Gasoline (${fmt1(held.amount)}L in can)</span>`;
      } else if (held && held.defId === 'siphon_hose') {
        actions = `<span><kbd>E</kbd> / <kbd>F</kbd> Siphon Fuel into Jerrycan</span>`;
      } else {
        actions = `<span>Hold Gasoline Jerrycan to Refuel</span>`;
      }
      break;
    }
    case 'car_engine': {
      const eng = ENGINES[hit.car.engineId];
      title = eng ? `⚙️ ${eng.name} (${eng.hp} HP)` : '⚙️ Empty Engine Mount';
      meta = eng
        ? `Motor Oil: ${fmt1(hit.car.oil)} / ${eng.oilCap} L • Condition: ${Math.round(hit.car.engineCondition * 100)}%`
        : 'Hold an Engine Block and press [F] to install';
      if (held && held.fluidType === 'oil') {
        actions = `<span><kbd>E</kbd> / <kbd>F</kbd> Pour Motor Oil (${fmt1(held.amount)}L left)</span>`;
      } else if (held && held.partSlot === 'engine') {
        actions = `<span><kbd>E</kbd> / <kbd>F</kbd> Swap in ${held.name}</span>`;
      } else {
        actions = `<span><kbd>F</kbd> Detach Engine • Hold Oil Can to Fill Oil</span>`;
      }
      break;
    }
    case 'car_radiator': {
      const rad = RADIATORS[hit.car.radiatorId];
      title = rad ? `🌡️ ${rad.name}` : '🌡️ Empty Radiator Mount';
      meta = rad
        ? `Coolant Water: ${fmt1(hit.car.water)} / ${rad.waterCap} L • Temp: ${Math.round(hit.car.tempC)}°C`
        : 'Hold a Radiator and press [F] to install';
      if (held && held.fluidType === 'water') {
        actions = `<span><kbd>E</kbd> / <kbd>F</kbd> Pour Water into Radiator (${fmt1(held.amount)}L left)</span>`;
      } else if (held && held.partSlot === 'radiator') {
        actions = `<span><kbd>E</kbd> / <kbd>F</kbd> Swap in ${held.name}</span>`;
      } else {
        actions = `<span><kbd>F</kbd> Detach Radiator • Hold Water Jug/Canteen to Fill</span>`;
      }
      break;
    }
    case 'car_wheel': {
      const wSlot = hit.car.wheels[hit.wheelIndex];
      title = `🛞 ${hit.label} Wheel Hub`;
      meta = wSlot.installed
        ? `Tire Installed — Condition: ${Math.round(wSlot.condition * 100)}%`
        : '⚠️ Missing Wheel!';
      if (held && held.partSlot === 'wheel') {
        actions = `<span><kbd>E</kbd> / <kbd>F</kbd> Mount Replacement Wheel</span>`;
      } else {
        actions = wSlot.installed ? `<span><kbd>F</kbd> Detach Wheel</span>` : `<span>Hold a Wheel &amp; press <kbd>F</kbd></span>`;
      }
      break;
    }
    case 'hare':
      title = '🐇 Rabid Mutant Desert Hare';
      meta = `HP: ${hit.hare.hp} — Hostile wasteland pest!`;
      actions = `<span>Shoot with Revolver or Run Over with Car</span>`;
      break;
  }

  $('inspectTitle').innerHTML = title;
  $('inspectMeta').innerHTML = meta;
  $('inspectActions').innerHTML = actions;
}

// ── Mechanic, Fluids & Trunk Inspector Modal [Tab] ───────────────────────────
function openInspectorModal() {
  if (!sim) return;
  if (document.pointerLockElement) document.exitPointerLock();
  paused = true;
  $('inspectorModal').classList.remove('hidden');
  renderInspectorBody();
}

function closeInspectorModal() {
  $('inspectorModal').classList.add('hidden');
  paused = false;
  refreshHud();
}

function renderInspectorBody() {
  const car = sim.activeCar || sim.vehicles[0];
  const p = sim.player;
  if (!car) return;

  const arch = CAR_BY_ID[car.archId] || CAR_BY_ID.sedan;
  const eng = ENGINES[car.engineId];
  const rad = RADIATORS[car.radiatorId];
  const wheelCount = car.wheels.filter((w) => w.installed).length;

  // Find nearby world items within 14m of the car/player so you can also assemble from workbench/ground!
  const nearbyWorldItems = sim.worldItems.filter(
    (wi) => Math.hypot(wi.x - car.x, wi.z - car.z) < 14 || Math.hypot(wi.x - p.x, wi.z - p.z) < 14
  );

  // Pool of accessible items: Hotbar + Car Trunk + Nearby Workbench/Ground
  const allItems = [
    ...p.hotbar.filter(Boolean),
    ...car.trunk,
    ...nearbyWorldItems.map((wi) => wi.item),
  ];

  const gasCan = allItems.find((i) => i.fluidType === 'gas' && i.amount > 0.05);
  const oilCan = allItems.find((i) => i.fluidType === 'oil' && i.amount > 0.05);
  const waterCan = allItems.find((i) => i.fluidType === 'water' && i.amount > 0.05);
  const repairKit = allItems.find((i) => i.defId === 'repair_kit' && (i.uses ?? 1) > 0);
  const brush = allItems.find((i) => i.defId === 'wire_brush');
  const paint = allItems.find((i) => i.defId === 'spray_paint');

  const availEngine = allItems.find((i) => i.partSlot === 'engine');
  const availRadiator = allItems.find((i) => i.partSlot === 'radiator');
  const availWheel = allItems.find((i) => i.partSlot === 'wheel');

  // Helper to consume/remove a part item from wherever it came from (hotbar, trunk, or nearby world)
  const consumePartSource = (partItem) => {
    const hIdx = p.hotbar.indexOf(partItem);
    if (hIdx >= 0) {
      p.hotbar[hIdx] = null;
      sim.rebuildHandViewmodel();
      return;
    }
    const tIdx = car.trunk.indexOf(partItem);
    if (tIdx >= 0) {
      car.trunk.splice(tIdx, 1);
      return;
    }
    const wObj = sim.worldItems.find((wi) => wi.item === partItem);
    if (wObj) {
      sim.removeWorldItem(wObj);
    }
  };

  // Nearby other vehicles (e.g. when you find a Bus or Muscle Car and want to switch or salvage parts from your old car!)
  const otherCars = sim.vehicles.filter(
    (v) => v !== car && (Math.hypot(v.x - p.x, v.z - p.z) < 35 || Math.hypot(v.x - car.x, v.z - car.z) < 35)
  );

  const body = $('inspectorBody');
  body.innerHTML = `
    ${
      otherCars.length > 0
        ? `<div style="background:rgba(245,158,11,0.12);border:1px solid rgba(251,191,36,0.45);border-radius:8px;padding:8px 12px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
            <span>🚙 <b>Other Vehicle Nearby:</b> ${otherCars.map((c) => c.name).join(', ')}</span>
            <div style="display:flex;gap:6px;">
              ${otherCars
                .map(
                  (oc, idx) =>
                    `<button class="miniActBtn" data-switch-car="${idx}">🔍 Inspect ${oc.name}</button>
                     <button class="miniActBtn" data-salvage-from="${idx}">🔄 Move Parts &amp; Fluids from ${oc.name} → Here</button>`
                )
                .join('')}
            </div>
          </div>`
        : ''
    }
    <div class="mechGrid">
      <div class="mechBox">
        <h3>🚗 ${car.name} — Assembly, Repairs &amp; Fluids</h3>
        <div class="statLine">
          <span>⚙️ Engine Bay</span>
          <div>
            <b>${
              eng
                ? `${eng.name} (${eng.hp} HP • ${Math.round((car.engineCondition ?? 0.8) * 100)}%)`
                : '❌ MISSING ENGINE'
            }</b>
            ${
              availEngine
                ? `<button class="miniActBtn" data-act="install_eng">⚙️ Install ${availEngine.name}</button>`
                : ''
            }
          </div>
        </div>
        <div class="statLine">
          <span>🌡️ Radiator Mount</span>
          <div>
            <b>${rad ? `${rad.name} (${Math.round((car.radiatorCondition ?? 0.8) * 100)}%)` : '❌ MISSING RADIATOR'}</b>
            ${
              availRadiator
                ? `<button class="miniActBtn" data-act="install_rad">🌡️ Install ${availRadiator.name}</button>`
                : ''
            }
          </div>
        </div>
        <div class="statLine">
          <span>🛞 Wheels &amp; Tires</span>
          <div>
            <b>${wheelCount} / 4 Mounted</b>
            ${
              wheelCount < 4 && availWheel
                ? `<button class="miniActBtn" data-act="mount_wheel">🛞 Mount Wheel (+1)</button>`
                : ''
            }
          </div>
        </div>
        <div class="statLine">
          <span>⛽ Gasoline Tank</span>
          <div>
            <b>${fmt1(car.fuel)} / ${arch.fuelCap} L</b>
            ${gasCan ? `<button class="miniActBtn" data-act="fill_gas">+ Pour Gas (${fmt1(gasCan.amount)}L)</button>` : ''}
          </div>
        </div>
        <div class="statLine">
          <span>🛢️ Engine Motor Oil</span>
          <div>
            <b>${fmt1(car.oil)} / ${eng ? eng.oilCap : 3.5} L</b>
            ${oilCan ? `<button class="miniActBtn" data-act="fill_oil">+ Pour Oil (${fmt1(oilCan.amount)}L)</button>` : ''}
          </div>
        </div>
        <div class="statLine">
          <span>💧 Radiator Coolant</span>
          <div>
            <b>${fmt1(car.water)} / ${rad ? rad.waterCap : 8.0} L (${Math.round(car.tempC)}°C)</b>
            ${waterCan ? `<button class="miniActBtn" data-act="fill_water">+ Pour Water (${fmt1(waterCan.amount)}L)</button>` : ''}
          </div>
        </div>
        <div class="statLine">
          <span>🔧 Body &amp; Mechanical Condition</span>
          <div>
            <b>${Math.round(car.condition * 100)}%</b>
            ${repairKit ? `<button class="miniActBtn" data-act="repair_kit">🔧 Repair with Wrench Kit</button>` : ''}
            ${brush ? `<button class="miniActBtn" data-act="polish">🪥 Scrub Rust</button>` : ''}
            ${paint ? `<button class="miniActBtn" data-act="paint">🎨 Respray</button>` : ''}
          </div>
        </div>
      </div>

      <div class="mechBox">
        <h3>🎒 Belt Hotbar (5 Slots) ↔ 📦 Car Trunk (${car.trunk.length}/${arch.trunkSlots})</h3>
        <div style="font-size:11px;color:#94a3b8;margin-bottom:6px;">
          Click <b>Stow → Trunk</b> to pack supplies in your car/bus, or <b>Use</b> to eat/drink:
        </div>
        <div class="itemList">
          ${p.hotbar
            .map((itm, idx) =>
              itm
                ? `<div class="itemRow">
                    <span><b>[${idx + 1}]</b> ${itm.icon} ${itm.name} ${
                      itm.category === 'fluid' ? `(${fmt1(itm.amount)}L)` : ''
                    }</span>
                    <div style="display:flex;gap:5px;">
                      ${
                        itm.category === 'food' || itm.fluidType === 'water'
                          ? `<button class="miniActBtn" data-use-hotbar="${idx}">Consume</button>`
                          : ''
                      }
                      <button class="miniActBtn" data-to-trunk="${idx}">Stow → Trunk</button>
                    </div>
                  </div>`
                : `<div class="itemRow" style="opacity:0.45;"><span>[${idx + 1}] Empty Belt Slot</span></div>`
            )
            .join('')}
        </div>

        <h3 style="margin-top:14px;">📦 Stowed in Trunk (${car.trunk.length}/${arch.trunkSlots})</h3>
        <div class="itemList">
          ${
            car.trunk.length === 0
              ? `<div style="color:#64748b;font-size:12px;">Trunk is empty. Stow extra jerrycans, oil, water, repair kits &amp; food here!</div>`
              : car.trunk
                  .map(
                    (itm, tIdx) => `
                  <div class="itemRow">
                    <span>${itm.icon} ${itm.name} ${
                      itm.category === 'fluid' ? `(${fmt1(itm.amount)}L)` : ''
                    }</span>
                    <button class="miniActBtn" data-from-trunk="${tIdx}">← Take to Belt</button>
                  </div>`
                  )
                  .join('')
          }
        </div>
      </div>
    </div>
  `;

  // Switch active inspected vehicle
  body.querySelectorAll('[data-switch-car]').forEach((btn) => {
    btn.onclick = () => {
      const oc = otherCars[Number(btn.dataset.switchCar)];
      if (oc) {
        sim.activeCar = oc;
        audio.click();
        renderInspectorBody();
        refreshHud();
      }
    };
  });

  // Salvage parts & fluids from old car into current car/bus!
  body.querySelectorAll('[data-salvage-from]').forEach((btn) => {
    btn.onclick = () => {
      const donor = otherCars[Number(btn.dataset.salvageFrom)];
      if (!donor) return;
      if (!car.engineId && donor.engineId) {
        car.engineId = donor.engineId;
        car.engineCondition = donor.engineCondition;
        donor.engineId = null;
      }
      if (!car.radiatorId && donor.radiatorId) {
        car.radiatorId = donor.radiatorId;
        car.radiatorCondition = donor.radiatorCondition;
        donor.radiatorId = null;
      }
      for (let i = 0; i < 4; i++) {
        if (!car.wheels[i].installed) {
          const dWheel = donor.wheels.find((w) => w.installed);
          if (dWheel) {
            dWheel.installed = false;
            car.wheels[i].installed = true;
            car.wheels[i].condition = dWheel.condition;
          }
        }
      }
      const gasTransfer = Math.min(arch.fuelCap - car.fuel, donor.fuel);
      car.fuel = Math.round((car.fuel + gasTransfer) * 10) / 10;
      donor.fuel = Math.round((donor.fuel - gasTransfer) * 10) / 10;

      const curEng = ENGINES[car.engineId];
      const oilTransfer = Math.min((curEng ? curEng.oilCap : 4.0) - car.oil, donor.oil);
      car.oil = Math.round((car.oil + oilTransfer) * 10) / 10;
      donor.oil = Math.round((donor.oil - oilTransfer) * 10) / 10;

      const curRad = RADIATORS[car.radiatorId];
      const waterTransfer = Math.min((curRad ? curRad.waterCap : 8.0) - car.water, donor.water);
      car.water = Math.round((car.water + waterTransfer) * 10) / 10;
      donor.water = Math.round((donor.water - waterTransfer) * 10) / 10;

      while (donor.trunk.length > 0 && car.trunk.length < arch.trunkSlots) {
        car.trunk.push(donor.trunk.shift());
      }

      donor.mesh.syncParts();
      car.mesh.syncParts();
      audio.wrench();
      showToast(`🔄 Transferred parts, fluids & cargo from ${donor.name} into ${car.name}!`);
      renderInspectorBody();
      refreshHud();
    };
  });

  // Wire quick-service & assembly buttons
  body.querySelectorAll('[data-act]').forEach((btn) => {
    btn.onclick = () => {
      const act = btn.dataset.act;
      if (act === 'install_eng' && availEngine) {
        car.engineId = availEngine.engineId || 'eng_i4_1200';
        car.engineCondition = availEngine.condition ?? 0.85;
        consumePartSource(availEngine);
        car.mesh.syncParts();
        audio.wrench();
        showToast(`⚙️ Installed <b>${ENGINES[car.engineId].name}</b>!`);
      } else if (act === 'install_rad' && availRadiator) {
        car.radiatorId = availRadiator.radiatorId || 'rad_std';
        car.radiatorCondition = availRadiator.condition ?? 0.85;
        consumePartSource(availRadiator);
        car.mesh.syncParts();
        audio.wrench();
        showToast(`🌡️ Installed <b>${RADIATORS[car.radiatorId].name}</b>!`);
      } else if (act === 'mount_wheel' && availWheel) {
        const emptySlot = car.wheels.find((w) => !w.installed);
        if (emptySlot) {
          emptySlot.installed = true;
          emptySlot.condition = availWheel.condition ?? 0.85;
          consumePartSource(availWheel);
          car.mesh.syncParts();
          audio.wrench();
          showToast(`🛞 Mounted Wheel (${car.wheels.filter((w) => w.installed).length}/4)!`);
        }
      } else if (act === 'repair_kit' && repairKit) {
        car.engineCondition = clamp((car.engineCondition ?? 0.2) + 0.55, 0, 1);
        car.radiatorCondition = clamp((car.radiatorCondition ?? 0.2) + 0.55, 0, 1);
        car.condition = clamp((car.condition ?? 0.3) + 0.35, 0, 1);
        car.wheels.forEach((w) => {
          if (w.installed) w.condition = clamp((w.condition ?? 0.5) + 0.45, 0, 1);
        });
        repairKit.uses = Math.max(0, (repairKit.uses ?? 5) - 1);
        if (repairKit.uses <= 0) consumePartSource(repairKit);
        car.mesh.syncParts();
        audio.wrench();
        showToast(`🔧 Repaired ${car.name} engine & body!`);
      } else if (act === 'fill_gas' && gasCan) {
        const take = Math.min(arch.fuelCap - car.fuel, gasCan.amount);
        car.fuel = Math.round((car.fuel + take) * 10) / 10;
        gasCan.amount = Math.round((gasCan.amount - take) * 10) / 10;
        audio.glug();
      } else if (act === 'fill_oil' && oilCan) {
        const maxOil = eng ? eng.oilCap : 3.5;
        const take = Math.min(maxOil - car.oil, oilCan.amount);
        car.oil = Math.round((car.oil + take) * 10) / 10;
        oilCan.amount = Math.round((oilCan.amount - take) * 10) / 10;
        audio.glug();
      } else if (act === 'fill_water' && waterCan) {
        const maxWat = rad ? rad.waterCap : 8.0;
        const take = Math.min(maxWat - car.water, waterCan.amount);
        car.water = Math.round((car.water + take) * 10) / 10;
        waterCan.amount = Math.round((waterCan.amount - take) * 10) / 10;
        car.tempC = Math.max(36, car.tempC - take * 6);
        audio.glug();
      } else if (act === 'polish') {
        car.condition = 1.0;
        car.engineCondition = 1.0;
        car.radiatorCondition = 1.0;
        car.mesh.syncParts();
        audio.scrub();
      } else if (act === 'paint' && paint) {
        car.paintHex = paint.paintHex;
        car.mesh.syncParts();
        audio.spray();
      }
      renderInspectorBody();
      refreshHud();
    };
  });

  body.querySelectorAll('[data-use-hotbar]').forEach((btn) => {
    btn.onclick = () => {
      const idx = Number(btn.dataset.useHotbar);
      const itm = p.hotbar[idx];
      if (itm) sim.consumeItem(itm, idx);
      renderInspectorBody();
      refreshHud();
    };
  });

  body.querySelectorAll('[data-to-trunk]').forEach((btn) => {
    btn.onclick = () => {
      const idx = Number(btn.dataset.toTrunk);
      const itm = p.hotbar[idx];
      if (!itm) return;
      if (car.trunk.length >= arch.trunkSlots) {
        showToast('📦 Trunk is full!', true);
        return;
      }
      car.trunk.push(itm);
      p.hotbar[idx] = null;
      car.mesh.syncParts();
      sim.rebuildHandViewmodel();
      audio.pickup();
      renderInspectorBody();
      refreshHud();
    };
  });

  body.querySelectorAll('[data-from-trunk]').forEach((btn) => {
    btn.onclick = () => {
      const tIdx = Number(btn.dataset.fromTrunk);
      const emptyIdx = p.hotbar.findIndex((s) => s === null);
      if (emptyIdx === -1) {
        showToast('🎒 Belt hotbar is full!', true);
        return;
      }
      const [itm] = car.trunk.splice(tIdx, 1);
      p.hotbar[emptyIdx] = itm;
      car.mesh.syncParts();
      sim.rebuildHandViewmodel();
      audio.pickup();
      renderInspectorBody();
      refreshHud();
    };
  });
}

// ── Mom's Letter Modal ───────────────────────────────────────────────────────
function openLetterModal() {
  if (document.pointerLockElement) document.exitPointerLock();
  paused = true;
  $('letterBody').textContent = MOM_LETTER.body;
  $('letterModal').classList.remove('hidden');
}

function closeLetterModal() {
  $('letterModal').classList.add('hidden');
  paused = false;
}

// ── Keyboard, Mouse (Pointer Lock + Drag Fallback) & Touch Wiring ────────────
function wireControls(canvas) {
  const unlockAudio = () => audio.unlock();
  addEventListener('pointerdown', unlockAudio, { once: true });
  addEventListener('keydown', unlockAudio, { once: true });

  // Pointer lock + drag-look fallback so mouse look always works
  let draggingLook = false;
  let lastMouseX = 0, lastMouseY = 0;

  canvas.addEventListener('mousedown', (e) => {
    if (paused) return;
    if (e.button === 0) {
      sim.mouseDown = true;
      if (document.pointerLockElement === canvas) {
        sim.useHeldToolPrimary();
      } else {
        draggingLook = true;
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
        canvas.requestPointerLock?.().catch?.(() => {});
      }
    } else if (e.button === 2) {
      sim.zoomBinoculars = true;
    }
  });

  addEventListener('mouseup', (e) => {
    if (e.button === 0) {
      sim.mouseDown = false;
      draggingLook = false;
    } else if (e.button === 2) {
      sim.zoomBinoculars = false;
    }
  });

  addEventListener('contextmenu', (e) => e.preventDefault());

  addEventListener('mousemove', (e) => {
    if (paused || !sim) return;
    const sens = 0.0024;
    if (document.pointerLockElement === canvas) {
      sim.lookDelta.x += e.movementX * sens;
      sim.lookDelta.y += e.movementY * sens;
    } else if (draggingLook) {
      const dx = e.clientX - lastMouseX;
      const dy = e.clientY - lastMouseY;
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;
      sim.lookDelta.x += dx * sens * 1.4;
      sim.lookDelta.y += dy * sens * 1.4;
    }
  });

  addEventListener('wheel', (e) => {
    if (paused || !sim) return;
    const dir = Math.sign(e.deltaY);
    if (dir !== 0) {
      sim.selectSlot((sim.player.activeSlot + dir + 5) % 5);
    }
  });

  // Keyboard bindings
  addEventListener('keydown', (e) => {
    if (!sim) return;
    sim.keys[e.code] = true;

    if (e.code === 'Tab') {
      e.preventDefault();
      if ($('inspectorModal').classList.contains('hidden')) openInspectorModal();
      else closeInspectorModal();
      return;
    }

    if (e.code === 'Escape') {
      if (!$('inspectorModal').classList.contains('hidden')) {
        closeInspectorModal();
        return;
      }
      if (!$('letterModal').classList.contains('hidden')) {
        closeLetterModal();
        return;
      }
      paused = !paused;
      $('pauseModal').classList.toggle('hidden', !paused);
      return;
    }

    if (paused) return;

    if (e.code >= 'Digit1' && e.code <= 'Digit5') {
      sim.selectSlot(Number(e.code.slice(-1)) - 1);
    } else if (e.code === 'KeyE') {
      sim.handleInteractKey('E');
    } else if (e.code === 'KeyF') {
      sim.handleInteractKey('F');
    } else if (e.code === 'KeyG') {
      sim.dropHeldItem(1.6);
    } else if (e.code === 'KeyQ') {
      sim.dropHeldItem(7.5);
    } else if (e.code === 'KeyC') {
      sim.player.crouching = !sim.player.crouching;
    } else if (e.code === 'Space' && sim.mode === 'walk' && sim.player.onGround) {
      sim.player.vy = 5.8;
      sim.player.onGround = false;
    } else if (e.code === 'KeyV' && sim.mode === 'drive') {
      sim.thirdPerson = !sim.thirdPerson;
      showToast(sim.thirdPerson ? '🎥 3rd-Person Chase Camera' : '🎥 1st-Person Cockpit Camera');
    } else if (e.code === 'KeyI' && sim.mode === 'drive') {
      sim.toggleIgnition();
    } else if (e.code === 'KeyL') {
      sim.cycleHeadlights();
    } else if (e.code === 'KeyR' && sim.mode === 'drive') {
      const on = audio.toggleRadio();
      showToast(on ? '📻 Car Radio ON' : '📻 Car Radio OFF');
      refreshHud();
    } else if (e.code === 'KeyN' && sim.mode === 'drive') {
      const st = audio.nextStation();
      showToast(`📻 Tuned to <b>${st.freq} — ${st.name}</b>`);
      refreshHud();
    } else if (e.code === 'KeyH' && sim.mode === 'drive') {
      audio.horn();
    } else if (e.code === 'KeyU') {
      sim.flipCarUpright();
    } else if (e.code === 'KeyT') {
      sim.timeOfDay = (sim.timeOfDay + 3) % 24;
      showToast(`⏩ Advanced time +3 hours (${formatClock(sim.timeOfDay)})`);
      refreshHud();
    }
  });

  addEventListener('keyup', (e) => {
    if (sim) sim.keys[e.code] = false;
  });

  // Top Bar & Modal UI Buttons
  $('btnQuickCar').onclick = () => {
    audio.unlock();
    if (sim.mode === 'drive') {
      sim.exitCar();
    } else {
      const targetCar = sim.activeCar || sim.vehicles[0];
      if (targetCar) sim.enterCar(targetCar);
    }
  };
  $('btnInspector').onclick = () => openInspectorModal();
  if ($('btnOpenMechFromChk')) $('btnOpenMechFromChk').onclick = () => openInspectorModal();
  $('btnCloseInspector').onclick = () => closeInspectorModal();
  $('btnLetter').onclick = () => openLetterModal();
  $('btnCloseLetter').onclick = () => closeLetterModal();
  $('btnStartFromLetter').onclick = () => closeLetterModal();

  $('btnWaitTime').onclick = () => {
    sim.timeOfDay = (sim.timeOfDay + 3) % 24;
    showToast(`⏩ Advanced time +3 hours (${formatClock(sim.timeOfDay)})`);
    refreshHud();
  };
  $('btnUnstuck').onclick = () => sim.flipCarUpright();

  $('btnSfx').onclick = () => {
    audio.unlock();
    audio.setSfx(!audio.sfxOn);
    $('btnSfx').textContent = audio.sfxOn ? '🔊' : '🔇';
  };

  $('btnPause').onclick = () => {
    paused = !paused;
    $('pauseModal').classList.toggle('hidden', !paused);
  };
  $('btnClosePause').onclick = () => {
    paused = false;
    $('pauseModal').classList.add('hidden');
  };
  $('btnResumeGame').onclick = () => {
    paused = false;
    $('pauseModal').classList.add('hidden');
  };
  $('btnNewTrip').onclick = () => {
    clearSave();
    location.reload();
  };

  // Resume from Main Menu when clicking "Enter the Desert Highway"
  if ($('btnOpenMainMenu')) $('btnOpenMainMenu').onclick = () => showMainMenu();

  // Cockpit Dashboard Quick Buttons
  $('btnExitCar').onclick = () => sim.exitCar();
  $('btnCamToggle').onclick = () => {
    sim.thirdPerson = !sim.thirdPerson;
    showToast(sim.thirdPerson ? '🎥 3rd-Person Chase Camera' : '🎥 1st-Person Cockpit Camera');
  };
  $('btnIgnToggle').onclick = () => sim.toggleIgnition();
  $('btnLightsToggle').onclick = () => sim.cycleHeadlights();
  $('btnRadioNext').onclick = () => {
    const st = audio.nextStation();
    showToast(`📻 Tuned to <b>${st.freq} — ${st.name}</b>`);
    refreshHud();
  };
  $('btnHorn').onclick = () => audio.horn();

  // Touch Controls (Mobile / Tablet)
  const bindHold = (id, code) => {
    const el = $(id);
    if (!el) return;
    const on = (ev) => {
      ev.preventDefault();
      sim.keys[code] = true;
    };
    const off = () => {
      sim.keys[code] = false;
    };
    el.addEventListener('pointerdown', on);
    el.addEventListener('pointerup', off);
    el.addEventListener('pointercancel', off);
    el.addEventListener('pointerleave', off);
  };
  bindHold('tUp', 'KeyW');
  bindHold('tDown', 'KeyS');
  bindHold('tLeft', 'KeyA');
  bindHold('tRight', 'KeyD');
  bindHold('tJumpBrk', 'Space');

  $('tInteract').onclick = () => sim.handleInteractKey('E');
  $('tUse').onclick = () => sim.useHeldToolPrimary();

  // Touch drag on canvas to look around
  let touchId = null;
  let tx0 = 0, ty0 = 0;
  canvas.addEventListener('touchstart', (e) => {
    if (touchId !== null) return;
    const t = e.changedTouches[0];
    touchId = t.identifier;
    tx0 = t.clientX;
    ty0 = t.clientY;
  }, { passive: true });

  canvas.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === touchId) {
        const dx = t.clientX - tx0;
        const dy = t.clientY - ty0;
        tx0 = t.clientX;
        ty0 = t.clientY;
        sim.lookDelta.x += dx * 0.0045;
        sim.lookDelta.y += dy * 0.0045;
      }
    }
  }, { passive: true });

  canvas.addEventListener('touchend', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === touchId) touchId = null;
    }
  }, { passive: true });
}

boot();

// Never leave the player stuck on the loading screen — surface any boot failure visibly
window.addEventListener('error', (e) => {
  const load = document.getElementById('loading');
  const tip = document.querySelector('#loading .loadTip');
  if (load && tip && !load.classList.contains('hide')) {
    tip.textContent = '❌ Load error: ' + (e.message || 'unknown') + ' — press Ctrl+Shift+R to hard-refresh';
    tip.style.color = '#fca5a5';
  }
});
