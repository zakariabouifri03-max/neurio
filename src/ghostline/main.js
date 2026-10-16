import * as THREE from 'three';
import { buildCity, createAtmosphere } from './city.js';
import { buildOperative, PALETTES } from './operative.js';
import { Mission, RELAYS, SAFEHOUSE, HACK_RANGE, SAVE_KEY, SETTINGS_KEY, clamp, distance, slideMove, intersects, readStorage, writeStorage, formatTime } from './rules.js';
import { drawMap } from './map.js';
import { ModelViewer, exportOperative } from './model-viewer.js';
import { Soundscape } from './sound.js';

const $ = id => document.getElementById(id);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let storage;
try { storage = window.localStorage; } catch { /* Private or embedded browsers may disallow storage. */ }
const savedSettings = readStorage(storage, SETTINGS_KEY);
const settings = {
  quality: ['auto', 'high', 'low'].includes(savedSettings?.quality) ? savedSettings.quality : 'auto',
  rain: savedSettings?.rain !== false,
  sound: savedSettings?.sound === true,
  sensitivity: typeof savedSettings?.sensitivity === 'number' && Number.isFinite(savedSettings.sensitivity) ? clamp(savedSettings.sensitivity, .4, 2) : 1,
  palette: PALETTES[savedSettings?.palette] ? savedSettings.palette : 'carbon',
};
const sound = new Soundscape();
let toastTimer;
function toast(title, message = '', warning = false) {
  $('toast-title').textContent = title; $('toast-message').textContent = message;
  $('toast').classList.toggle('warning', warning); $('toast').classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('show'), 4000);
}
function persistSettings() { writeStorage(storage, SETTINGS_KEY, settings); }

async function boot() {
  // Textures use the same local fonts as the interface, never an external font API.
  await Promise.all([document.fonts.load('500 24px Space'), document.fonts.load('400 12px Plex')]);
  $('boot-message').textContent = 'BUILDING SOUTH BANK / LOADING OPERATIVE...';
  await new Promise(resolve => requestAnimationFrame(resolve));
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  $('viewport').appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const atmosphere = createAtmosphere(scene);
  const world = buildCity(scene);
  const operative = buildOperative(settings.palette); scene.add(operative.root);
  const camera = new THREE.PerspectiveCamera(57, innerWidth / innerHeight, .1, 620);
  const saved = readStorage(storage, SAVE_KEY);
  let mission = new Mission(saved);
  const player = { x: SAFEHOUSE.x, y: 0, z: SAFEHOUSE.z, angle: -.2, speed: 0, verticalSpeed: 0 };
  if (Number.isFinite(saved?.position?.x) && Number.isFinite(saved?.position?.z)) {
    const x = clamp(saved.position.x, -120, 120), z = clamp(saved.position.z, -120, 120);
    if (!world.colliders.some(r => intersects(x, z, .35, r))) { player.x = x; player.z = z; }
  }
  let yaw = Number.isFinite(saved?.yaw) ? saved.yaw : -.20, pitch = .29, worldTime = 0, trace = 0, scan = false, blackout = 0, blackoutCooldown = 0, cameraHack = null, waypoint = null, viewer = null;
  let hudTimer = 0, saveTimer = 0, adaptiveTime = 0, adaptiveFrames = 0, adaptiveReduced = false, lastTraceWarn = -20;
  let pointer = null, lookDragging = false, contextLost = false, needsRender = true;
  const velocity = new THREE.Vector2(), keys = new Set(), touch = new Set(), cameraFocus = new THREE.Vector3(), cameraDesired = new THREE.Vector3();
  const pulses = [];
  let currentDevice = null;
  const allDevices = [...world.relayNodes, ...world.cameras];
  const markers = [];
  const selectedDialogs = () => [...document.querySelectorAll('dialog[open]')];
  const paused = () => contextLost || document.hidden || selectedDialogs().length > 0;

  function save() { writeStorage(storage, SAVE_KEY, { ...mission.snapshot(), position: { x: player.x, z: player.z }, yaw }); }
  function applyQuality() {
    const low = settings.quality === 'low' || (settings.quality === 'auto' && adaptiveReduced);
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, low ? .85 : settings.quality === 'high' ? 1.75 : 1.35));
    world.pedestrians.forEach((person, i) => { person.root.visible = !low || i % 2 === 0; });
    renderer.shadowMap.enabled = !low;
    renderer.setSize(innerWidth, innerHeight);
    atmosphere.key.castShadow = !low;
    needsRender = true;
  }
  applyQuality();
  world.rain.visible = settings.rain;
  $('weather-label').textContent = settings.rain ? 'LIGHT RAIN' : 'OVERCAST';
  $('quality-setting').value = settings.quality; $('rain-setting').checked = settings.rain; $('sensitivity-setting').value = settings.sensitivity;
  $('sound-setting').checked = settings.sound;

  function clearInput() { keys.clear(); touch.clear(); velocity.set(0, 0); pointer = null; lookDragging = false; document.querySelectorAll('.held').forEach(el => el.classList.remove('held')); }
  function closeDialogs() {
    selectedDialogs().forEach(d => d.close());
    document.querySelectorAll('.nav-tab').forEach(b => b.classList.toggle('active', b.id === 'nav-play'));
    clearInput();
  }
  function openDialog(name) {
    const dialog = $(`${name}-dialog`);
    if (!dialog) return;
    const wasOpen = dialog.open; closeDialogs(); if (wasOpen) return;
    dialog.showModal(); clearInput(); sound.play('click');
    if (name === 'map') updateMapRelays();
    if (name === 'operative') {
      if (!viewer) viewer = new ModelViewer($('model-stage'), settings.palette, reducedMotion);
      viewer.resize();
    }
    if (['operative', 'intel'].includes(name)) document.querySelectorAll('.nav-tab').forEach(b => b.classList.toggle('active', b.dataset.open === name));
  }
  function syncSoundButton() {
    $('sound-toggle').setAttribute('aria-label', settings.sound ? 'Mute sound' : 'Enable sound');
    $('sound-toggle').querySelector('use').setAttribute('href', settings.sound ? '#i-sound' : '#i-muted');
    $('sound-setting').checked = settings.sound;
  }
  async function setSound(on) {
    settings.sound = on; await sound.setEnabled(on); settings.sound = sound.enabled; syncSoundButton(); persistSettings(); if (on) sound.play('click');
  }
  syncSoundButton();
  // Only a gesture can unlock the browser's audio context, even for saved preferences.
  const unlockAudio = () => { if (settings.sound) sound.setEnabled(true).catch(() => {}); };
  addEventListener('pointerdown', unlockAudio, { once: true }); addEventListener('keydown', unlockAudio, { once: true });

  function refreshMission() {
    const next = RELAYS.find(r => !mission.breached.has(r.id));
    $('objective-list').innerHTML = RELAYS.map((r, i) => {
      const done = mission.breached.has(r.id);
      return `<div class="objective-row ${done ? 'complete' : next?.id === r.id ? 'current' : ''}"><span class="check">${done ? '<svg><use href="#i-check"/></svg>' : ''}</span><span>${r.short} relay</span><span id="relay-distance-${i}">${done ? 'DONE' : `${Math.round(distance(player, r))} m`}</span></div>`;
    }).join('');
    $('relay-count').textContent = `${mission.breached.size} / 3`;
    document.querySelectorAll('.progress-segments i').forEach((s, i) => s.classList.toggle('filled', i < mission.breached.size));
    $('xp-value').textContent = `${String(mission.xp).padStart(4, '0')} XP`;
    $('objective-description').textContent = mission.completed ? 'Surveillance is down. South Bank is yours. Keep exploring, or start a new operation.' : mission.extracting ? 'The grid is blind. Return to the green safehouse beacon to finish the operation.' : 'Breach the relays. Break the surveillance. Give the city back its shadows.';
    $('district-status').textContent = mission.completed ? 'NETWORK LIBERATED' : mission.extracting ? 'EXTRACTION READY' : 'RESTRICTED NETWORK';
    $('deploy-button').firstChild.textContent = mission.completed ? 'EXPLORE THE CITY ' : mission.breached.size > 0 ? 'RESUME OPERATION ' : 'ENTER THE CITY ';
    $('session-state').textContent = !mission.active ? 'AWAITING OPERATIVE' : scan ? 'NETSCAN ACTIVE' : mission.completed ? 'FREE ROAM / OFF THE GRID' : mission.extracting ? 'RETURN TO SAFEHOUSE' : 'OPERATIVE CONNECTED';
    world.setBreached(mission.breached); world.extraction.visible = mission.extracting;
    updateMapRelays();
  }
  function deploy() {
    if (mission.active) return;
    closeDialogs(); mission.start(); document.body.classList.add('playing'); refreshMission(); sound.play('success');
    toast(mission.completed ? 'WELCOME BACK, ECHO.' : 'SECURE CONNECTION ESTABLISHED', mission.completed ? 'The city is yours to explore.' : 'Follow the relay signals. Press Q to reveal the network.');
    save();
  }
  function restart() {
    mission = new Mission(); mission.start(); trace = 0; scan = false; blackout = 0; blackoutCooldown = 0; waypoint = null; cameraHack = null;
    player.x = SAFEHOUSE.x; player.z = SAFEHOUSE.z; player.y = 0; player.verticalSpeed = 0; yaw = -.2; pitch = .29; player.angle = -.2;
    world.cameras.forEach(c => { c.disabled = 0; });
    document.body.classList.add('playing'); document.body.classList.remove('scanning', 'blackout'); world.setScan(false); $('scan-button').classList.remove('is-active');
    closeDialogs(); clearInput(); updateCamera(1, true); refreshMission(); save(); sound.play('scan'); toast('NEW CONNECTION. CLEAN SLATE.', 'Three relays. One city. Go make yourself invisible.');
  }
  function pulse(color = '#c7e78b') {
    const mesh = new THREE.Mesh(new THREE.RingGeometry(.97, 1, 64), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .65, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    mesh.rotation.x = -Math.PI / 2; mesh.position.set(player.x, .22, player.z); scene.add(mesh); pulses.push({ mesh, age: 0 });
    if (pulses.length > 6) { const old = pulses.shift(); scene.remove(old.mesh); old.mesh.geometry.dispose(); old.mesh.material.dispose(); }
  }
  function toggleScan() {
    if (paused()) return;
    if (!mission.active) deploy();
    scan = !scan; world.setScan(scan); document.body.classList.toggle('scanning', scan); $('scan-button').classList.toggle('is-active', scan); $('scan-button').setAttribute('aria-pressed', String(scan));
    refreshMission();
    if (scan) { sound.play('scan'); pulse(); toast('NETSCAN / NETWORK EXPOSED', 'Relays, security cameras, and patrol routes are visible.'); }
    else { sound.play('click'); toast('NETSCAN OFF', 'Back to the street.'); }
  }
  function activateBlackout() {
    if (paused()) return;
    if (!mission.active) deploy();
    if (blackoutCooldown > 0) { toast('BLACKOUT RECHARGING', `Your rig will be ready in ${Math.ceil(blackoutCooldown)} seconds.`, true); return; }
    blackout = 8; blackoutCooldown = 25; trace = Math.max(0, trace - 30);
    sound.play('blackout'); pulse('#a6d7d4'); document.body.classList.add('blackout');
    toast('DISTRICT BLACKOUT / 8 SECONDS', 'Street lights are down. Patrol detection is offline.');
  }
  function nearestDevice() {
    if (mission.hack) return world.relayNodes.find(r => r.id === mission.hack.id);
    if (cameraHack) return world.cameras.find(r => r.id === cameraHack.id);
    const available = world.relayNodes.filter(r => !mission.breached.has(r.id));
    let closest = available.sort((a, b) => distance(player, a) - distance(player, b))[0];
    if (closest && distance(player, closest) <= HACK_RANGE) return closest;
    closest = world.cameras.filter(c => c.disabled <= 0).sort((a, b) => distance(player, a) - distance(player, b))[0];
    return closest && distance(player, closest) <= HACK_RANGE ? closest : null;
  }
  function hack() {
    if (paused()) return;
    if (!mission.active) deploy();
    const target = nearestDevice();
    if (mission.hack || cameraHack) return;
    if (!target || distance(player, target) > HACK_RANGE) { toast('NO DEVICE IN RANGE', 'Get within 13 m of a city relay or security camera.', true); return; }
    if (target.type === 'relay') {
      if (mission.beginHack(target.id, player)) { sound.play('hack'); toast(`BREACHING ${target.code}`, 'Keep the connection stable. Stay close to the relay.'); }
    } else { cameraHack = { id: target.id, progress: 0 }; sound.play('hack'); }
  }
  function jump() {
    if (paused() || !mission.active) return;
    if (player.y <= world.groundHeight(player.x, player.z) + .04) player.verticalSpeed = 5.3;
  }

  // Dialogs and controls are native buttons, including the mobile-only controls.
  document.querySelectorAll('[data-open]').forEach(button => button.addEventListener('click', () => openDialog(button.dataset.open)));
  document.querySelectorAll('.close-dialog').forEach(button => button.addEventListener('click', () => { sound.play('click'); closeDialogs(); }));
  document.querySelectorAll('dialog').forEach(d => {
    d.addEventListener('cancel', e => { e.preventDefault(); closeDialogs(); });
    d.addEventListener('click', e => { if (e.target === d) { const r = d.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) closeDialogs(); } });
  });
  $('deploy-button').onclick = deploy;
  $('nav-play').onclick = () => { closeDialogs(); if (!mission.active) deploy(); };
  $('scan-button').onclick = toggleScan; $('blackout-button').onclick = activateBlackout; $('hack-button').onclick = hack;
  $('pause-intel').onclick = () => openDialog('intel'); $('replay-button').onclick = restart;
  $('sound-toggle').onclick = () => setSound(!settings.sound).catch(() => toast('AUDIO UNAVAILABLE', 'Your browser could not start its audio device.', true));
  $('sound-setting').onchange = e => setSound(e.target.checked).catch(() => toast('AUDIO UNAVAILABLE', 'Your browser could not start its audio device.', true));
  $('rain-setting').onchange = e => { settings.rain = e.target.checked; world.rain.visible = settings.rain; $('weather-label').textContent = settings.rain ? 'LIGHT RAIN' : 'OVERCAST'; persistSettings(); };
  $('quality-setting').onchange = e => { settings.quality = e.target.value; adaptiveReduced = false; adaptiveTime = 0; adaptiveFrames = 0; applyQuality(); persistSettings(); };
  $('sensitivity-setting').oninput = e => { settings.sensitivity = Number(e.target.value); persistSettings(); };
  let resetConfirm = false, resetTimeout;
  $('reset-button').onclick = () => {
    if (resetConfirm) { restart(); resetConfirm = false; $('reset-button').textContent = 'RESTART OPERATION'; clearTimeout(resetTimeout); }
    else { resetConfirm = true; $('reset-button').textContent = 'CLICK AGAIN TO CONFIRM RESTART'; resetTimeout = setTimeout(() => { resetConfirm = false; $('reset-button').textContent = 'RESTART OPERATION'; }, 5000); }
  };
  $('fullscreen-toggle').onclick = async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen(); else throw new Error('Not supported'); }
    catch { toast('FULLSCREEN IS UNAVAILABLE', 'You can still play in this browser window.', true); }
  };
  addEventListener('fullscreenchange', () => $('fullscreen-toggle').setAttribute('aria-label', document.fullscreenElement ? 'Exit fullscreen' : 'Enter fullscreen'));
  document.querySelectorAll('[data-palette]').forEach(button => button.onclick = () => {
    settings.palette = button.dataset.palette; operative.setPalette(settings.palette); viewer?.setPalette(settings.palette); refreshPalette(); persistSettings(); sound.play('click');
  });
  function refreshPalette() { document.querySelectorAll('[data-palette]').forEach(b => { const yes = b.dataset.palette === settings.palette; b.classList.toggle('selected', yes); b.setAttribute('aria-pressed', String(yes)); }); $('palette-name').textContent = PALETTES[settings.palette].label; }
  refreshPalette();
  $('export-model').onclick = async () => {
    const b = $('export-model'); b.disabled = true; $('export-status').textContent = 'Packaging your operative...';
    try {
      const buffer = await exportOperative(settings.palette), url = URL.createObjectURL(new Blob([buffer], { type: 'model/gltf-binary' }));
      const a = document.createElement('a'); a.href = url; a.download = `echo-operative-${settings.palette}.glb`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
      $('export-status').textContent = 'Model exported. Your ghost is ready.'; sound.play('success');
    } catch (error) { console.error('Model export failed:', error); $('export-status').textContent = 'Export failed. Please try again.'; }
    finally { b.disabled = false; }
  };

  function updateMapRelays() {
    $('map-relays').innerHTML = RELAYS.map(r => `<button class="map-relay ${waypoint?.id === r.id ? 'selected' : ''}" data-waypoint="${r.id}"><svg><use href="${mission.breached.has(r.id) ? '#i-check' : '#i-relay'}"/></svg><span><b>${r.short} relay</b><small>${mission.breached.has(r.id) ? 'ACCESS GRANTED' : 'UNSECURED / SET WAYPOINT'}</small></span><span>${Math.round(distance(player, r))} m</span></button>`).join('');
    $('map-relays').querySelectorAll('button').forEach(b => b.onclick = () => { waypoint = { ...RELAYS.find(r => r.id === b.dataset.waypoint) }; updateMapRelays(); sound.play('click'); });
  }
  $('clear-waypoint').onclick = () => { waypoint = null; updateMapRelays(); sound.play('click'); };
  $('district-map').onclick = e => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width * 280 - 140, z = (e.clientY - rect.top) / rect.height * 280 - 140;
    if (Math.abs(x) > 120 || Math.abs(z) > 120 || world.colliders.some(r => intersects(x, z, .35, r))) {
      sound.play('alert'); $('map-dialog').querySelector('.map-instruction').firstChild.textContent = 'CHOOSE A WALKABLE STREET OR PAVEMENT '; return;
    }
    waypoint = { x, z }; updateMapRelays(); sound.play('click'); $('map-dialog').querySelector('.map-instruction').firstChild.textContent = 'WAYPOINT SET / FOLLOW THE SIGNAL ';
  };

  addEventListener('keydown', e => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName) && e.code !== 'Escape') return;
    if (e.code === 'Escape') { e.preventDefault(); if (selectedDialogs().length) closeDialogs(); else if (mission.active) openDialog('pause'); return; }
    if (e.code === 'KeyM') { e.preventDefault(); if (!e.repeat) openDialog('map'); return; }
    if (paused()) return;
    const movement = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight'];
    if ([...movement, 'Space'].includes(e.code)) { e.preventDefault(); if (!mission.active && !e.repeat) deploy(); }
    keys.add(e.code);
    if (e.repeat) return;
    if (e.code === 'KeyQ') toggleScan();
    if (e.code === 'KeyB') activateBlackout();
    if (e.code === 'KeyE') hack();
    if (e.code === 'Space') jump();
  });
  addEventListener('keyup', e => keys.delete(e.code));
  addEventListener('blur', clearInput);
  document.addEventListener('visibilitychange', () => { clearInput(); if (document.hidden && mission.active) { save(); if (!selectedDialogs().length) openDialog('pause'); } });
  addEventListener('pagehide', save);
  const canvasEl = renderer.domElement;
  canvasEl.addEventListener('contextmenu', e => e.preventDefault());
  canvasEl.addEventListener('pointerdown', e => { if (paused()) return; pointer = { id: e.pointerId, x: e.clientX, y: e.clientY }; lookDragging = true; canvasEl.setPointerCapture(e.pointerId); });
  canvasEl.addEventListener('pointermove', e => {
    if (!lookDragging || !pointer || pointer.id !== e.pointerId || paused()) return;
    yaw -= (e.clientX - pointer.x) * .0048 * settings.sensitivity;
    pitch = clamp(pitch + (e.clientY - pointer.y) * .003 * settings.sensitivity, .03, .92);
    pointer.x = e.clientX; pointer.y = e.clientY;
  });
  const stopLook = () => { pointer = null; lookDragging = false; };
  canvasEl.addEventListener('pointerup', stopLook); canvasEl.addEventListener('pointercancel', stopLook); canvasEl.addEventListener('lostpointercapture', stopLook);
  document.querySelectorAll('[data-move]').forEach(button => {
    button.addEventListener('pointerdown', e => { e.preventDefault(); if (paused()) return; if (!mission.active) deploy(); button.setPointerCapture(e.pointerId); touch.add(button.dataset.move); button.classList.add('held'); });
    const release = () => { touch.delete(button.dataset.move); button.classList.remove('held'); };
    button.addEventListener('pointerup', release); button.addEventListener('pointercancel', release); button.addEventListener('lostpointercapture', release);
  });
  $('touch-jump').onclick = jump;
  renderer.domElement.addEventListener('webglcontextlost', e => { e.preventDefault(); contextLost = true; clearInput(); toast('GRAPHICS CONNECTION LOST', 'Waiting for your browser to restore the 3D world.', true); });
  renderer.domElement.addEventListener('webglcontextrestored', () => { save(); location.reload(); });
  addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); needsRender = true; viewer?.resize(); });

  function updatePlayer(dt) {
    const f = (keys.has('KeyW') || keys.has('ArrowUp') || touch.has('forward') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') || touch.has('back') ? 1 : 0);
    const r = (keys.has('KeyD') || keys.has('ArrowRight') || touch.has('right') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') || touch.has('left') ? 1 : 0);
    const sprinting = keys.has('ShiftLeft') || keys.has('ShiftRight') || touch.has('sprint');
    const v = new THREE.Vector2(-Math.sin(yaw) * f + Math.cos(yaw) * r, -Math.cos(yaw) * f - Math.sin(yaw) * r);
    if (v.lengthSq() > 0) v.normalize().multiplyScalar(sprinting ? 7.3 : 3.9);
    velocity.lerp(v, 1 - Math.exp(-dt * 11));
    const carObstacles = world.cars.filter(c => distance(player, c.root.position) < 5).map(c => ({ minX: c.root.position.x - 1.03, maxX: c.root.position.x + 1.03, minZ: c.root.position.z - 2.22, maxZ: c.root.position.z + 2.22 }));
    const next = slideMove(player, velocity.x * dt, velocity.y * dt, carObstacles.length ? [...world.colliders, ...carObstacles] : world.colliders);
    player.speed = Math.hypot(next.x - player.x, next.z - player.z) / Math.max(dt, .001);
    player.x = next.x; player.z = next.z;
    if (v.lengthSq() > .01) {
      const targetAngle = Math.atan2(-v.x, -v.y); let delta = targetAngle - player.angle;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta)); player.angle += delta * (1 - Math.exp(-dt * 13));
    }
    const floor = world.groundHeight(player.x, player.z);
    player.verticalSpeed -= dt * 13; player.y += player.verticalSpeed * dt;
    if (player.y < floor) { player.y = floor; player.verticalSpeed = 0; }
  }
  function updateCamera(dt, instant = false) {
    cameraFocus.set(player.x - Math.sin(yaw) * 2.1, player.y + 1.95, player.z - Math.cos(yaw) * 2.1);
    const dist = innerWidth < 601 ? 8.9 : 7.7;
    const dx = Math.sin(yaw) * Math.cos(pitch) * dist, dz = Math.cos(yaw) * Math.cos(pitch) * dist;
    let factor = 1;
    // Segment/AABB test keeps the chase camera on this side of nearby walls.
    for (const box of world.colliders) {
      let lo = 0, hi = 1, hit = true;
      for (const [o, d, min, max] of [[player.x, dx, box.minX - .2, box.maxX + .2], [player.z, dz, box.minZ - .2, box.maxZ + .2]]) {
        if (Math.abs(d) < 1e-6) { if (o < min || o > max) hit = false; }
        else { const a = (min - o) / d, b = (max - o) / d; lo = Math.max(lo, Math.min(a, b)); hi = Math.min(hi, Math.max(a, b)); }
      }
      if (hit && lo <= hi && lo > .04 && lo < factor) factor = Math.max(.18, lo - .045);
    }
    cameraDesired.set(player.x + dx * factor, player.y + 1.4 + Math.sin(pitch) * dist * factor, player.z + dz * factor);
    if (instant) camera.position.copy(cameraDesired); else camera.position.lerp(cameraDesired, 1 - Math.exp(-dt * 12));
    camera.lookAt(cameraFocus); camera.updateMatrixWorld();
  }

  function createMarker(device, kind = device.type) {
    const el = document.createElement('div'); el.className = `world-marker ${kind}`;
    const icon = kind === 'relay' ? 'i-relay' : kind === 'camera' ? 'i-camera' : 'i-pin';
    el.innerHTML = `<span class="marker-diamond"><svg><use href="#${icon}"/></svg></span><span class="marker-label"><span>${device.code || device.name}</span><b></b></span>`;
    $('world-markers').appendChild(el); markers.push({ device, el, kind });
  }
  allDevices.forEach(d => createMarker(d));
  createMarker({ ...SAFEHOUSE, code: 'SAFEHOUSE', anchor: new THREE.Vector3(SAFEHOUSE.x, 1.7, SAFEHOUSE.z) }, 'extraction');
  const waypointDevice = { x: 0, z: 0, code: 'WAYPOINT', anchor: new THREE.Vector3() }; createMarker(waypointDevice, 'waypoint');
  const project = new THREE.Vector3();
  function updateMarkers() {
    const top = $('hud').offsetTop, height = innerHeight - top - 39;
    for (const { device, el, kind } of markers) {
      let show = true;
      if (kind === 'extraction') show = mission.extracting;
      if (kind === 'waypoint') { show = !!waypoint; if (waypoint) { device.x = waypoint.x; device.z = waypoint.z; device.anchor.set(waypoint.x, 1.2, waypoint.z); } }
      const dist = distance(player, device);
      if (kind === 'relay' && mission.breached.has(device.id)) show = scan;
      if (kind === 'camera') show = (scan || dist < 28) && device.disabled <= 0;
      if (dist > (scan ? 175 : 110)) show = false;
      project.copy(device.anchor).project(camera);
      const x = (project.x * .5 + .5) * innerWidth, y = (-project.y * .5 + .5) * innerHeight - top;
      if (project.z > 1 || project.z < -1 || x < 25 || x > innerWidth - 25 || y < 50 || y > height - 55) show = false;
      if (innerWidth < 601 && mission.active && y < 190) show = false;
      // Keep projected device labels out of the opening briefing's text column.
      if (!mission.active && x < (innerWidth < 601 ? 310 : 410) && y < 350) show = false;
      el.hidden = !show;
      if (!show) continue;
      el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,-100%)`;
      el.classList.toggle('far', dist > 58 && !scan); el.classList.toggle('completed', mission.breached.has(device.id));
      el.querySelector('b').textContent = `${Math.round(dist)} m`;
    }
  }
  function updateHud() {
    for (const [i, r] of RELAYS.entries()) if (!mission.breached.has(r.id)) $(`relay-distance-${i}`).textContent = `${Math.round(distance(player, r))} m`;
    $('trace-value').textContent = `${Math.round(trace)}%`; $('trace-bar').style.width = `${trace}%`;
    $('trace-value').style.color = trace > 60 ? '#e5a280' : '';
    const activeHack = mission.hack || cameraHack;
    currentDevice = mission.active ? nearestDevice() : null;
    const inRange = currentDevice && distance(player, currentDevice) <= HACK_RANGE + .2;
    $('interaction-prompt').hidden = !inRange;
    if (inRange) {
      $('target-type').textContent = currentDevice.type === 'relay' ? 'NEXUS / CITY INFRASTRUCTURE' : 'NEXUS / SURVEILLANCE';
      $('target-name').textContent = currentDevice.name;
      $('target-state').textContent = activeHack ? `BYPASSING ENCRYPTION / ${Math.floor(activeHack.progress * 100)}%` : currentDevice.type === 'relay' ? 'UNSECURED CONNECTION' : 'LOOP FEED / 20 SECONDS';
      $('hack-label').textContent = activeHack ? 'LINKING' : 'HACK'; $('hack-progress').style.width = `${(activeHack?.progress || 0) * 100}%`;
      $('interaction-prompt').querySelector('.target-icon use').setAttribute('href', currentDevice.type === 'relay' ? '#i-relay' : '#i-camera');
    }
    $('blackout-label').textContent = blackout > 0 ? `ACTIVE ${Math.ceil(blackout)}s` : blackoutCooldown > 0 ? `WAIT ${Math.ceil(blackoutCooldown)}s` : 'BLACKOUT';
    $('blackout-button').classList.toggle('is-active', blackout > 0); $('blackout-button').setAttribute('aria-label', blackoutCooldown > 0 ? `Blackout recharging, ${Math.ceil(blackoutCooldown)} seconds remaining` : 'Activate district blackout');
    const degrees = (THREE.MathUtils.radToDeg(-yaw) % 360 + 360) % 360;
    $('heading').textContent = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(degrees / 45) % 8];
    const minutes = (21 * 60 + 47 + Math.floor(worldTime / 35)) % 1440;
    $('city-clock').textContent = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    drawMap($('minimap'), world, player, mission, yaw, { waypoint, scan, time: worldTime });
    if ($('map-dialog').open) drawMap($('district-map'), world, player, mission, yaw, { large: true, waypoint, scan, time: worldTime });
  }
  function updateMission(dt) {
    const event = mission.tick(dt, player);
    if (event?.type === 'breached') {
      sound.play('success'); pulse(); trace = Math.max(0, trace - 15); refreshMission(); save();
      if (waypoint?.id === event.relay.id) waypoint = null;
      toast(event.extracting ? 'SURVEILLANCE GRID COMPROMISED' : `${event.relay.code} / ACCESS GRANTED`, event.extracting ? 'All three relays are yours. Return to the safehouse.' : '+150 XP. Connection secured. Find the next relay.');
    }
    if (event?.type === 'cancelled') toast('CONNECTION LOST', 'Stay within range until the breach is complete.', true);
    if (event?.type === 'complete') { refreshMission(); save(); $('result-time').textContent = formatTime(mission.elapsed); sound.play('complete'); openDialog('complete'); }
    if (cameraHack) {
      const cam = world.cameras.find(c => c.id === cameraHack.id);
      if (distance(player, cam) > HACK_RANGE + 1) { cameraHack = null; toast('CAMERA LINK LOST', 'Move closer to restore the connection.', true); }
      else {
        cameraHack.progress = Math.min(1, cameraHack.progress + dt / 1.8);
        if (cameraHack.progress >= 1) { cam.disabled = 20; cameraHack = null; trace = Math.max(0, trace - 20); sound.play('success'); pulse('#9ddbcc'); toast(`${cam.code} / FEED LOOPED`, '20 seconds of cover. Your trace has been reduced.'); }
      }
    }
    let danger = 0;
    if (blackout <= 0) {
      for (const d of world.drones) { const range = distance(player, d); if (range < 11) danger += (1 - range / 12) * (player.speed > 5 ? 31 : 21); }
      for (const cam of world.cameras) if (cam.disabled <= 0 && distance(player, cam) < 7.5) danger += 8;
    }
    trace = clamp(trace + dt * (danger > 0 ? danger : -8), 0, 100);
    if (trace > 60 && worldTime - lastTraceWarn > 15) { lastTraceWarn = worldTime; sound.play('alert'); toast('YOUR SIGNAL IS BEING TRACED', 'Move away from patrols or press B to trigger a blackout.', true); }
    if (trace >= 100) {
      player.x = SAFEHOUSE.x; player.z = SAFEHOUSE.z; player.y = 0; player.verticalSpeed = 0; trace = 0; mission.cancelHack(); cameraHack = null; velocity.set(0, 0); updateCamera(1, true); sound.play('alert'); save();
      toast('SIGNAL COMPROMISED / REROUTED', 'Back at the safehouse. Your breached relays are still secure.', true);
    }
    if (waypoint && distance(player, waypoint) < 2.8) { waypoint = null; toast('WAYPOINT REACHED', 'Keep your eyes on the network.'); }
  }

  refreshMission(); updateCamera(1, true); updateHud();
  // A small, explicit debug surface also lets the integration tests inspect real state.
  window.GHOSTLINE = {
    ready: true, player, world, camera, renderer, settings,
    get mission() { return mission; }, get scan() { return scan; }, get blackout() { return blackout; }, get trace() { return trace; }, get waypoint() { return waypoint; },
    exportModel: () => exportOperative(settings.palette),
  };
  let previous = performance.now();
  renderer.setAnimationLoop(now => {
    const rawDt = Math.min((now - previous) / 1000, .5); previous = now;
    const dt = Math.min(Math.max(rawDt, .001), .055), isPaused = paused();
    if (!isPaused) {
      worldTime += dt;
      if (mission.active) updatePlayer(dt);
      blackout = Math.max(0, blackout - dt); blackoutCooldown = Math.max(0, blackoutCooldown - dt);
      if (blackout <= 0) document.body.classList.remove('blackout');
      for (const c of world.cameras) { c.disabled = Math.max(0, c.disabled - dt); c.led.emissiveIntensity = c.disabled > 0 ? .12 : 1; }
      if (mission.active) updateMission(dt);
      for (let i = pulses.length - 1; i >= 0; i--) {
        const p = pulses[i]; p.age += dt; p.mesh.scale.setScalar(1 + p.age * 24); p.mesh.material.opacity = Math.max(0, .6 * (1 - p.age / 1.6));
        if (p.age >= 1.6) { scene.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose(); pulses.splice(i, 1); }
      }
      updateCamera(dt);
      saveTimer += dt; if (mission.active && saveTimer > 5) { save(); saveTimer = 0; }
    }
    world.update(dt, worldTime, player, blackout > 0, isPaused);
    operative.root.position.set(player.x, player.y, player.z); operative.root.rotation.y = player.angle;
    operative.animate(worldTime, isPaused ? 0 : player.speed, !!mission.hack || !!cameraHack, player.y > world.groundHeight(player.x, player.z) + .07);
    // Keep the last city frame behind modal panels; the model viewer has its own renderer.
    if (!contextLost && (!isPaused || needsRender)) { renderer.render(scene, camera); needsRender = false; }
    updateMarkers();
    hudTimer += dt; if (hudTimer > .1) { updateHud(); hudTimer = 0; }
    if ($('operative-dialog').open && viewer) viewer.update(dt, now / 1000);
    if (!isPaused) { adaptiveTime += rawDt; adaptiveFrames++; }
    if (adaptiveTime > 4 && settings.quality === 'auto' && !adaptiveReduced) {
      if (adaptiveFrames / adaptiveTime < 27) { adaptiveReduced = true; applyQuality(); }
      adaptiveTime = 0; adaptiveFrames = 0;
    }
  });
  requestAnimationFrame(() => { $('boot-screen').classList.add('loaded'); setTimeout(() => $('boot-screen').remove(), 700); });
  // Network-first, versioned offline support. New code does not get trapped in an old cache.
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

boot().catch(error => {
  console.error('GHOSTLINE could not start:', error);
  const bootScreen = $('boot-screen'); bootScreen?.classList.remove('loaded');
  $('boot-message').textContent = 'THE 3D WORLD COULD NOT START. Enable WebGL / hardware acceleration, then reload. A current Chrome, Edge, Firefox, or Safari browser is recommended.';
  const retry = document.createElement('button'); retry.className = 'primary-button'; retry.textContent = 'RETRY CONNECTION'; retry.onclick = () => location.reload(); bootScreen?.appendChild(retry);
});
