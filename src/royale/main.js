import * as THREE from 'three';
import { CARS, PAINTS, formatTime, clamp, damp } from './rules.js';
import { createCar } from './models.js';
import { createWorld, createEnvironment } from './world.js';
import { BattleRoyale } from './game.js';
import { RaceAudio } from './audio.js';
const $ = id => document.getElementById(id);
const icon = name => `<svg><use href="#i-${name}"/></svg>`;
const defaults = { car: 'kaze', paint: PAINTS[0].color, mode: 'royale', difficulty: 'casual', quality: 'balanced', camera: 'chase', sound: true, volume: .65 };
function load(key, fallback) { try { return { ...fallback, ...JSON.parse(localStorage.getItem(key) || '{}') }; } catch { return { ...fallback }; } }
const config = load('outrun-settings-v1', defaults);
for (const [key, values] of Object.entries({ car: CARS.map(c => c.id), paint: PAINTS.map(c => c.color), mode: ['royale', 'explore'], difficulty: ['casual', 'challenger'], quality: ['performance', 'balanced', 'high'], camera: ['chase', 'bonnet'] })) if (!values.includes(config[key])) config[key] = defaults[key];
config.sound = config.sound !== false; config.volume = clamp(Number.isFinite(Number(config.volume)) ? Number(config.volume) : .65, 0, 1);
const record = load('outrun-record-v1', { matches: 0, wins: 0, best: 0, eliminations: 0, maxSpeed: 0, distance: 0 });
for (const key of Object.keys(record)) if (!Number.isFinite(record[key]) || record[key] < 0) record[key] = 0;
function persist() { try { localStorage.setItem('outrun-settings-v1', JSON.stringify(config)); localStorage.setItem('outrun-record-v1', JSON.stringify(record)); } catch { /* Storage is optional, including in private browsing. */ } }
const audio = new RaceAudio(config.sound); audio.volume = config.volume;
let renderer, scene, camera, world, game, showcase;
let currentView = 'play', modalKind = '', lastFocus = null, toastTimer;
function toast(message) { clearTimeout(toastTimer); $('toast').textContent = message; $('toast').hidden = false; toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3300); }
function openModal(content, kind = 'info') {
  if ($('modal-backdrop').hidden) lastFocus = document.activeElement;
  modalKind = kind; $('modal-content').innerHTML = content; $('modal-backdrop').hidden = false; $('modal-close').hidden = kind === 'result';
  $('lobby').inert = true; $('hud').inert = true; $('modal').focus({ preventScroll: true });
}
function closeModal() {
  const kind = modalKind; modalKind = ''; $('modal-backdrop').hidden = true; $('lobby').inert = false; $('hud').inert = false;
  if (kind === 'pause') game.resume();
  if (lastFocus?.isConnected && !lastFocus.closest('[hidden]')) lastFocus.focus({ preventScroll: true });
}
function setView(view) {
  currentView = ['play', 'garage', 'guide'].includes(view) ? view : 'play';
  document.querySelectorAll('.lobby-view').forEach(element => { element.hidden = element.id !== currentView + '-view'; });
  document.querySelectorAll('[data-view]').forEach(button => { const selected = button.dataset.view === currentView; button.classList.toggle('active', selected); if (selected) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); });
  $('lobby').scrollTop = 0; history.replaceState(null, '', '#' + currentView); updateSelections();
}
function updateSelections() {
  const car = CARS.find(c => c.id === config.car), paint = PAINTS.find(p => p.color === config.paint);
  document.querySelectorAll('[data-car]').forEach(button => { const selected = button.dataset.car === config.car; button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected)); });
  document.querySelectorAll('[data-paint]').forEach(button => { const selected = button.dataset.paint === config.paint; button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected)); });
  document.querySelectorAll('[data-mode]').forEach(button => { const selected = button.dataset.mode === config.mode; button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected)); });
  $('car-description').textContent = car.description; $('car-label-name').textContent = car.name; $('car-label-spec').textContent = car.drivetrain + ' / ' + (car.id === 'raid' ? 'RALLY COUPE' : car.id === 'vela' ? 'GRAND TOURER' : 'STREET COUPE');
  $('car-stats').innerHTML = ['TOP SPEED', 'ACCELERATION', 'HANDLING', 'OFF-ROAD'].map((label, i) => `<div class="car-stat"><div><span>${label}</span><b>${(car.stats[i] / 10).toFixed(1)}</b></div><div class="stat-track"><i style="width:${car.stats[i]}%"></i></div></div>`).join('');
  $('paint-name').textContent = paint.name.toUpperCase();
  $('play-label').textContent = config.mode === 'royale' ? 'ENTER THE ARENA' : 'TAKE THE LONG WAY';
  $('match-drivers').textContent = config.mode === 'royale' ? '12 DRIVERS' : 'NO PRESSURE'; $('match-time').textContent = config.mode === 'royale' ? '4–6 MIN' : 'NO TIMER';
  document.querySelector('.match-meta>span:last-child').textContent = config.mode === 'royale' ? 'ONE WINNER' : 'JUST DRIVE';
  $('sound-btn').innerHTML = icon(config.sound ? 'volume' : 'muted'); $('sound-btn').setAttribute('aria-label', config.sound ? 'Mute audio' : 'Enable audio');
  if (showcase) {
    if (showcase.id !== config.car) { scene.remove(showcase.root); showcase.dispose(); showcase = createCar(config.car, config.paint, true); showcase.root.rotation.y = -.13; scene.add(showcase.root); world.sun.shadow.needsUpdate = true; }
    else showcase.setPaint(config.paint);
  }
}
function applyQuality() {
  if (!renderer) return;
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, config.quality === 'performance' ? 1 : config.quality === 'high' ? 2 : 1.5));
  renderer.shadowMap.enabled = config.quality !== 'performance';
  const size = config.quality === 'high' ? 2048 : 1024;
  if (world && world.sun.shadow.mapSize.x !== size) { world.sun.shadow.map?.dispose(); world.sun.shadow.map = null; world.sun.shadow.mapSize.set(size, size); }
  if (world) world.sun.shadow.needsUpdate = true;
  renderer.setSize(innerWidth, innerHeight);
}
function deploy() {
  if (!game || game.state !== 'lobby') return;
  if (!$('modal-backdrop').hidden) closeModal(); audio.unlock(); audio.click(); if (audio.master) audio.master.gain.value = .23 * config.volume;
  showcase.root.visible = false; game.start({ ...config });
}
function backToLobby() { modalKind = ''; closeModal(); game.lobby(); setView('play'); }
function settingsModal() {
  openModal(`<div class="eyebrow"><span class="live-dash"></span> FIND YOUR SWEET SPOT</div><h2 id="modal-title">DIAL IT<br><span>IN.</span></h2><div class="setting-row"><div><label for="difficulty">Rival difficulty</label><small>AI pace & time allowed outside the arena.</small></div><select id="difficulty"><option value="casual">Casual</option><option value="challenger">Challenger</option></select></div><div class="setting-row"><div><label for="quality">Graphics quality</label><small>Shadow detail & rendering resolution.</small></div><select id="quality"><option value="performance">Performance</option><option value="balanced">Balanced</option><option value="high">High</option></select></div><div class="setting-row"><div><label for="camera-setting">Starting camera</label><small>Switch anytime with C.</small></div><select id="camera-setting"><option value="chase">Chase camera</option><option value="bonnet">Bonnet camera</option></select></div><div class="setting-row"><div><label for="volume">Engine & effects</label><small>Less noise. Or a little more.</small></div><input type="range" id="volume" min="0" max="1" step="0.05" aria-label="Audio volume"></div><div class="setting-row"><div><label for="sound-setting">Audio enabled</label><small>Synthesized engine and race feedback.</small></div><input type="checkbox" id="sound-setting"></div><button id="settings-save" class="primary"><span>READY TO ROLL</span>${icon('check')}</button>`, 'settings');
  $('difficulty').value = config.difficulty; $('quality').value = config.quality; $('camera-setting').value = config.camera; $('volume').value = config.volume; $('sound-setting').checked = config.sound;
  $('settings-save').onclick = () => { config.difficulty = $('difficulty').value; config.quality = $('quality').value; config.camera = $('camera-setting').value; config.volume = Number($('volume').value); config.sound = $('sound-setting').checked; audio.enabled = config.sound; audio.volume = config.volume; if (audio.master) audio.master.gain.value = .23 * config.volume; applyQuality(); updateSelections(); persist(); closeModal(); audio.click(); };
}
function regionModal() {
  openModal(`<div class="eyebrow"><span class="live-dash"></span> THE HIGHLANDS ARE YOURS</div><h2 id="modal-title">WELCOME TO<br><span>AOKI.</span></h2><p>Cherry-lined roads, quiet villages, alpine backcountry. A fictional, Japan-inspired world with no prescribed route to the finish.</p><div class="briefing-grid"><div><span>STARTING GRID</span><strong>12 DRIVERS</strong></div><div><span>CAR LEVELS</span><strong>01—08</strong></div><div><span>RACE TYPE</span><strong>SOLO VS AI</strong></div></div><p>Start with your chosen car. Follow blue flares for upgrades. Press <kbd>E</kbd> near an AI rival to challenge them to a head-to-head sprint. First through the orange gate stays in the game.</p><p class="briefing-tip">The arena begins shrinking after 65 seconds. Keep moving inward. When the final sprint begins, the arena opens back up — first to the final gate wins.</p><button id="briefing-play" class="primary"><span>LET’S SEE IT</span>${icon('arrow')}</button>`, 'briefing');
  $('briefing-play').onclick = deploy;
}
function pauseModal() {
  openModal(`<div class="eyebrow"><span class="live-dash"></span> A MOMENT OFF THE THROTTLE</div><h2 id="modal-title">TAKE A<br><span>BREATHER.</span></h2><p>Your race is paused. The world can wait.</p><div class="briefing-grid"><div><span>DRIVERS LEFT</span><strong>${game.options.mode === 'royale' ? game.alive() : 'FREE DRIVE'}</strong></div><div><span>CAR LEVEL</span><strong>0${game.player.level}</strong></div><div><span>TIME ON ROAD</span><strong>${formatTime(game.elapsed)}</strong></div></div><button id="resume-btn" class="primary"><span>BACK ON THE THROTTLE</span>${icon('arrow')}</button><button id="restart-btn" class="secondary-button">RESTART THIS SESSION</button><button id="quit-btn" class="secondary-button">BACK TO THE GARAGE</button>`, 'pause');
  $('resume-btn').onclick = closeModal;
  $('restart-btn').onclick = () => { modalKind = ''; closeModal(); game.start({ ...config }); };
  $('quit-btn').onclick = backToLobby;
}
function ordinal(rank) { if (rank > 10 && rank < 14) return rank + 'TH'; return rank + ({ 1: 'ST', 2: 'ND', 3: 'RD' }[rank % 10] || 'TH'); }
function resultsModal(result) {
  record.matches++; record.wins += result.won ? 1 : 0; record.best = record.best ? Math.min(record.best, result.rank) : result.rank;
  record.eliminations += result.eliminations; record.maxSpeed = Math.max(record.maxSpeed, result.maxSpeed); record.distance += result.distance; persist();
  openModal(`<div class="eyebrow"><span class="live-dash"></span> AOKI HIGHLANDS / SESSION COMPLETE</div><h2 id="modal-title">${result.won ? 'LAST DRIVER.<br><span>FIRST PLACE.</span>' : 'ONE RACE.<br><span>NOT THE LAST.</span>'}</h2><div class="result-place">${ordinal(result.rank)}<span>/ 12</span></div><span class="result-badge">${result.won ? 'THE HIGHLANDS HAVE A NEW NAME.' : 'ANOTHER ROAD. ANOTHER CHANCE.'}</span><p>${result.reason}</p><div class="result-stats"><div><strong>${result.eliminations}</strong><small>ELIMINATIONS</small></div><div><strong>${Math.round(result.maxSpeed)}</strong><small>TOP SPEED / KM/H</small></div><div><strong>${formatTime(result.elapsed)}</strong><small>TIME ON ROAD</small></div></div><button id="play-again" class="primary"><span>ONE MORE RUN</span>${icon('arrow')}</button><button id="results-lobby" class="secondary-button">BACK TO THE GARAGE</button>`, 'result');
  $('play-again').onclick = () => { modalKind = ''; closeModal(); game.start({ ...config }); };
  $('results-lobby').onclick = backToLobby;
}
function recordModal() {
  openModal(`<div class="eyebrow"><span class="live-dash"></span> ROOKIE 01 / LOCAL DRIVER RECORD</div><h2 id="modal-title">MAKE A<br><span>NAME.</span></h2><p>A few good roads. A few great stories. Your record so far.</p><div class="record-grid"><div><span>ROYALE WINS</span><strong>${record.wins}</strong></div><div><span>BEST FINISH</span><strong>${record.best ? ordinal(record.best) : '—'}</strong></div><div><span>RIVALS ELIMINATED</span><strong>${record.eliminations}</strong></div><div><span>TOP SPEED / KM/H</span><strong>${Math.round(record.maxSpeed)}</strong></div></div><p class="record-note">Saved on this device. No sign-in. No waiting room.</p><button id="record-close" class="primary"><span>BACK TO THE START</span>${icon('arrow')}</button>`, 'record');
  $('record-close').onclick = closeModal;
}
if ('serviceWorker' in navigator && !new URLSearchParams(location.search).has('test')) navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then(registration => registration.update()).catch(() => {});

async function boot() {
  await document.fonts.ready;
  try { renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }); }
  catch (error) { $('loading').hidden = true; $('graphics-error').hidden = false; console.error('WebGL initialization failed:', error); return; }
  renderer.setSize(innerWidth, innerHeight); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.04;
  renderer.domElement.setAttribute('aria-label', '3D open-world driving game. WASD to drive, Shift to boost, E to interact.'); $('scene').appendChild(renderer.domElement);
  renderer.domElement.addEventListener('webglcontextlost', event => { event.preventDefault(); if (game?.state === 'playing') game.pause(); toast('Graphics connection lost. Reload the page to reconnect.'); });
  scene = new THREE.Scene(); camera = new THREE.PerspectiveCamera(39, innerWidth / innerHeight, .08, 2400); scene.add(camera);
  createEnvironment(renderer, scene); world = createWorld(scene); world.setLobby(true);
  showcase = createCar(config.car, config.paint, true); showcase.root.rotation.y = -.13; scene.add(showcase.root);
  game = new BattleRoyale({ scene, camera, world, audio, onPause: pauseModal, onFinish: resultsModal, onLobby: () => { showcase.root.visible = true; } });
  applyQuality();
  $('paint-options').innerHTML = PAINTS.map(paint => `<button class="paint-chip" data-paint="${paint.color}" style="background:${paint.color}" aria-label="${paint.name}" title="${paint.name}" aria-pressed="false"></button>`).join('');
  document.querySelectorAll('[data-view]').forEach(button => { button.onclick = () => { setView(button.dataset.view); audio.click(); }; });
  document.querySelector('.brand').onclick = event => { event.preventDefault(); setView('play'); };
  document.querySelectorAll('[data-car]').forEach(button => { button.onclick = () => { config.car = button.dataset.car; updateSelections(); persist(); audio.click(); }; });
  document.querySelectorAll('[data-paint]').forEach(button => { button.onclick = () => { config.paint = button.dataset.paint; updateSelections(); persist(); audio.click(); }; });
  document.querySelectorAll('[data-mode]').forEach(button => { button.onclick = () => { config.mode = button.dataset.mode; updateSelections(); persist(); audio.click(); }; });
  $('garage-save').onclick = () => { persist(); setView('play'); toast('Your ride is ready. The rest is up to you.'); audio.click(); };
  $('edit-car-btn').onclick = () => setView('garage'); $('guide-ready').onclick = () => setView('play'); $('play-btn').onclick = deploy;
  $('region-btn').onclick = regionModal; $('settings-btn').onclick = settingsModal; $('profile-btn').onclick = recordModal; $('pause-btn').onclick = () => game.pause();
  $('sound-btn').onclick = () => { config.sound = !config.sound; audio.enabled = config.sound; audio.unlock(); if (audio.master) audio.master.gain.value = .23 * config.volume; updateSelections(); persist(); audio.click(); toast(config.sound ? 'Audio on. Let the engine do the talking.' : 'Audio muted. Enjoy the view.'); };
  $('fullscreen-btn').onclick = async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen(); else toast('Fullscreen is not supported in this browser.'); } catch { toast('Fullscreen is unavailable in this preview. Open the game in a new tab.'); } };
  $('modal-close').onclick = closeModal;
  $('modal-backdrop').addEventListener('click', event => { if (event.target === $('modal-backdrop') && modalKind !== 'result') closeModal(); });
  window.addEventListener('keydown', event => {
    if (!$('modal-backdrop').hidden) {
      if (event.code === 'Escape' && modalKind !== 'result') { event.preventDefault(); event.stopImmediatePropagation(); closeModal(); }
      if (event.code === 'Tab') {
        const focusable = [...$('modal').querySelectorAll('button:not([hidden]),input,select,a[href]')].filter(element => !element.disabled), first = focusable[0], last = focusable.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === $('modal'))) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === $('modal'))) { event.preventDefault(); first?.focus(); }
      }
      return;
    }
    if (event.code === 'Enter' && game.state === 'lobby' && currentView === 'play' && !['BUTTON', 'A', 'INPUT', 'SELECT'].includes(document.activeElement.tagName)) { event.preventDefault(); deploy(); }
  }, true);
  let orbit = 0, targetOrbit = 0, orbitY = 0, targetY = 0, dragging = false, lastX = 0, lastY = 0;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function menuCamera(time, dt) {
    orbit = damp(orbit, targetOrbit, 8, dt); orbitY = damp(orbitY, targetY, 8, dt);
    const narrow = innerWidth < 650, angle = -.70 + orbit + (reducedMotion ? 0 : Math.sin(time * .10) * .012), radius = narrow ? 11.2 : 9.65;
    camera.fov = narrow ? 47 : 39; camera.aspect = innerWidth / innerHeight;
    camera.position.set(Math.sin(angle) * radius, 2.65 + orbitY, Math.cos(angle) * radius);
    camera.lookAt(0, .85, 0);
    camera.setViewOffset(innerWidth, innerHeight, -innerWidth * (narrow ? .34 : innerWidth < 1000 ? .22 : .19), innerHeight * (narrow ? .09 : -.015), innerWidth, innerHeight);
    camera.updateProjectionMatrix();
  }
  renderer.domElement.addEventListener('pointerdown', event => { if (game.state !== 'lobby') return; dragging = true; lastX = event.clientX; lastY = event.clientY; renderer.domElement.setPointerCapture(event.pointerId); });
  renderer.domElement.addEventListener('pointermove', event => { if (!dragging || game.state !== 'lobby') return; targetOrbit += (event.clientX - lastX) * .005; targetY = clamp(targetY + (event.clientY - lastY) * .007, -.65, 2); lastX = event.clientX; lastY = event.clientY; });
  window.addEventListener('pointerup', () => { dragging = false; });
  window.addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; renderer.setSize(innerWidth, innerHeight); if (game.state !== 'lobby') { camera.clearViewOffset(); camera.updateProjectionMatrix(); } });
  setView(location.hash.slice(1)); game.drawMap($('region-map').getContext('2d'), true);
  let last = performance.now(), time = 0;
  function frame(now) {
    const dt = Math.min(.05, Math.max(0, (now - last) / 1000)); last = now; time += dt;
    if (game.state === 'lobby') menuCamera(time, dt); else game.update(dt);
    if (game.state !== 'paused' && game.state !== 'finished') world.animate(time);
    renderer.render(scene, camera); requestAnimationFrame(frame);
  }
  menuCamera(0, 1); renderer.render(scene, camera); requestAnimationFrame(frame);
  $('loading').style.opacity = 0; setTimeout(() => { $('loading').hidden = true; }, 450);
}
boot().catch(error => { console.error(error); $('loading').hidden = true; $('graphics-error').hidden = false; });
export { game, world, camera, renderer, scene, config, showcase };
