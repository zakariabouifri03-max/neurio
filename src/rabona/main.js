import * as THREE from 'three';
import { createWorld, createEnvironment } from './world.js';
import { createWobblyPlayer, createBall } from './models.js';
import { RabonaGame } from './game.js';
import { RabonaAudio } from './audio.js';

const $ = id => document.getElementById(id);
const defaults = { difficulty:'normal', quality:'ultra', sound:true, volume:0.65, camera:'follow' };

function load(key, fallback) {
  try { return { ...fallback, ...JSON.parse(localStorage.getItem(key)||'{}') }; } catch { return { ...fallback }; }
}
const config = load('rabona-settings-v1', defaults);
config.sound = config.sound!==false;
config.volume = Number.isFinite(Number(config.volume)) ? Math.max(0,Math.min(1,Number(config.volume))) : 0.65;

const record = load('rabona-record-v1', { matches:0, wins:0, goals:0, best:0 });
for(const k of Object.keys(record)) if(!Number.isFinite(record[k])||record[k]<0) record[k]=0;

function persist() {
  try {
    localStorage.setItem('rabona-settings-v1', JSON.stringify(config));
    localStorage.setItem('rabona-record-v1', JSON.stringify(record));
  } catch {}
}

const audio = new RabonaAudio(config.sound);
audio.volume = config.volume;

let renderer, scene, camera, world, game;
let showcase = null;
let currentView = 'play';
let modalKind = '';
let lastFocus = null;
let toastTimer;

function toast(msg) {
  clearTimeout(toastTimer);
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  toastTimer = setTimeout(()=>{ el.hidden=true; }, 3200);
}

function openModal(html, kind='info') {
  if ($('modal-backdrop').hidden) lastFocus = document.activeElement;
  modalKind = kind;
  $('modal-content').innerHTML = html;
  $('modal-backdrop').hidden = false;
  $('modal-close').hidden = kind==='result';
  $('lobby').inert = true;
  $('hud').inert = true;
  $('modal').focus({preventScroll:true});
}
function closeModal() {
  const kind = modalKind;
  modalKind = '';
  $('modal-backdrop').hidden = true;
  $('lobby').inert = false;
  $('hud').inert = false;
  if (kind==='pause') game.resume();
  if (lastFocus?.isConnected && !lastFocus.closest('[hidden]')) lastFocus.focus({preventScroll:true});
}

function setView(view) {
  currentView = ['play','garage','guide'].includes(view) ? view : 'play';
  document.querySelectorAll('.lobby-view').forEach(el=>{ el.hidden = el.id !== currentView+'-view'; });
  document.querySelectorAll('[data-view]').forEach(btn=>{
    const sel = btn.dataset.view===currentView;
    btn.classList.toggle('active', sel);
    if(sel) btn.setAttribute('aria-current','page'); else btn.removeAttribute('aria-current');
  });
  $('lobby').scrollTop=0;
  history.replaceState(null,'','#'+currentView);
}

function settingsModal() {
  openModal(`
    <div class="eyebrow"><span class="live-dash"></span> FIND YOUR SWEET SPOT</div>
    <h2 id="modal-title">DIAL IT<br><span>IN.</span></h2>
    <div class="setting-row"><div><label>Difficulty</label><small>AI speed & awareness.</small></div>
      <select id="difficulty"><option value="easy">Easy</option><option value="normal">Normal</option><option value="hard">Hard</option></select>
    </div>
    <div class="setting-row"><div><label>Graphics quality</label><small>Shadows & resolution. Ultra = 4K shadows + PBR.</small></div>
      <select id="quality"><option value="performance">Performance</option><option value="balanced">Balanced</option><option value="high">High</option><option value="ultra">Ultra — Realistic</option></select>
    </div>
    <div class="setting-row"><div><label>Camera</label><small>Follow or wide broadcast.</small></div>
      <select id="camera-setting"><option value="follow">Follow player</option><option value="ball">Ball cam</option></select>
    </div>
    <div class="setting-row"><div><label>Volume</label><small>Less noise or more.</small></div>
      <input type="range" id="volume" min="0" max="1" step="0.05">
    </div>
    <div class="setting-row"><div><label>Audio</label><small>Kicks, goals, whistles.</small></div>
      <input type="checkbox" id="sound-setting">
    </div>
    <button id="settings-save" class="primary"><span>SAVE & PLAY</span> ✓</button>
  `,'settings');
  $('difficulty').value = config.difficulty;
  $('quality').value = config.quality;
  $('camera-setting').value = config.camera;
  $('volume').value = config.volume;
  $('sound-setting').checked = config.sound;
  $('settings-save').onclick = ()=>{
    config.difficulty = $('difficulty').value;
    config.quality = $('quality').value;
    config.camera = $('camera-setting').value;
    config.volume = Number($('volume').value);
    config.sound = $('sound-setting').checked;
    audio.enabled = config.sound;
    audio.volume = config.volume;
    if(audio.master) audio.master.gain.value = 0.22*config.volume;
    applyQuality();
    persist();
    closeModal();
    audio.click();
  };
}

function guideModalContent() {
  return `
    <div class="eyebrow"><span class="live-dash"></span> HOW TO RABONA</div>
    <h2 id="modal-title">WOBBLY.<br><span>FOOTBALL.</span></h2>
    <div class="guide-steps">
      <div><span>01</span><p><strong>MOVE & DRIBBLE.</strong> WASD to run. Ball sticks when you're close. Sprint with Shift to burst past defenders.</p></div>
      <div><span>02</span><p><strong>KICK & RABONA.</strong> E to shoot, Q for a fancy Rabona that curls around the keeper. Aim by facing the goal.</p></div>
      <div><span>03</span><p><strong>TACKLE & SLIDE.</strong> Space to slide tackle. Time it right to steal the ball and send rivals wobbling.</p></div>
    </div>
    <div class="controls-grid">
      <div><kbd>W A S D</kbd><span>Move</span></div>
      <div><kbd>SHIFT</kbd><span>Sprint</span></div>
      <div><kbd>E</kbd><span>Kick</span></div>
      <div><kbd>Q</kbd><span>Rabona</span></div>
      <div><kbd>SPACE</kbd><span>Slide</span></div>
      <div><kbd>R</kbd><span>Switch player</span></div>
      <div><kbd>C</kbd><span>Camera</span></div>
      <div><kbd>ESC</kbd><span>Pause</span></div>
    </div>
  `;
}

function pauseModal() {
  openModal(`
    <div class="eyebrow"><span class="live-dash"></span> HALF-TIME BREATHER</div>
    <h2 id="modal-title">TAKE A<br><span>BREAK.</span></h2>
    <p>Match paused. Score ${game.scoreBlue} - ${game.scoreRed}.</p>
    <div class="briefing-grid"><div><span>TIME LEFT</span><strong>${Math.max(0, Math.floor(90 - game.time))}s</strong></div><div><span>SCORE</span><strong>${game.scoreBlue}-${game.scoreRed}</strong></div><div><span>POSSESSION</span><strong>${game.possessor?game.possessor.team.toUpperCase():'LOOSE'}</strong></div></div>
    <button id="resume-btn" class="primary"><span>BACK TO PITCH</span> →</button>
    <button id="restart-btn" class="secondary-button">RESTART MATCH</button>
    <button id="quit-btn" class="secondary-button">BACK TO LOBBY</button>
  `,'pause');
  $('resume-btn').onclick = closeModal;
  $('restart-btn').onclick = ()=>{ modalKind=''; closeModal(); game.start({...config}); };
  $('quit-btn').onclick = ()=>{ modalKind=''; closeModal(); game.lobby(); setView('play'); };
}

function resultsModal(result) {
  record.matches++;
  record.goals += result.scoreBlue;
  if (result.won) record.wins++;
  record.best = Math.max(record.best, result.scoreBlue);
  persist();
  const title = result.won ? 'YOU WIN.<br><span>CHAMPION.</span>' : result.draw ? 'DRAW.<br><span>REMATCH?</span>' : 'DEFEAT.<br><span>NEXT TIME.</span>';
  const msg = result.won ? `You beat RED ${result.scoreBlue}-${result.scoreRed}. The crowd chants your name!` : result.draw ? `A hard-fought ${result.scoreBlue}-${result.scoreRed} draw. The wobbly gods demand a winner.` : `RED takes it ${result.scoreRed}-${result.scoreBlue}. Practice your Rabona and come back stronger.`;
  openModal(`
    <div class="eyebrow"><span class="live-dash"></span> FULL TIME</div>
    <h2 id="modal-title">${title}</h2>
    <div class="result-place">${result.scoreBlue}<span> - ${result.scoreRed}</span></div>
    <p>${msg}</p>
    <div class="result-stats"><div><strong>${result.scoreBlue}</strong><small>GOALS SCORED</small></div><div><strong>${record.wins}</strong><small>CAREER WINS</small></div><div><strong>${record.best}</strong><small>BEST SCORE</small></div></div>
    <button id="play-again" class="primary"><span>PLAY AGAIN</span> →</button>
    <button id="results-lobby" class="secondary-button">BACK TO LOBBY</button>
  `,'result');
  $('play-again').onclick = ()=>{ modalKind=''; closeModal(); game.start({...config}); };
  $('results-lobby').onclick = ()=>{ modalKind=''; closeModal(); game.lobby(); setView('play'); };
}

function applyQuality() {
  if (!renderer) return;
  const ratio = devicePixelRatio || 1;
  const isUltra = config.quality==='ultra';
  const isHigh = config.quality==='high' || isUltra;
  const isPerf = config.quality==='performance';
  renderer.setPixelRatio(Math.min(ratio, isUltra? Math.min(2.5, ratio*1.2) : isHigh?2: isPerf?1:1.5));
  renderer.shadowMap.enabled = !isPerf;
  renderer.shadowMap.type = isUltra ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
  const size = isUltra ? 4096 : isHigh ? 2048 : 1024;
  if (world && world.sun.shadow.mapSize.x!==size) {
    world.sun.shadow.map?.dispose();
    world.sun.shadow.map=null;
    world.sun.shadow.mapSize.set(size,size);
    world.sun.shadow.radius = isUltra ? 4 : 2;
    world.sun.shadow.blurSamples = isUltra ? 16 : 8;
  }
  if (world) world.sun.shadow.needsUpdate=true;
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMappingExposure = isUltra ? 1.18 : 1.05;
}

if ('serviceWorker' in navigator && !new URLSearchParams(location.search).has('test')) {
  navigator.serviceWorker.register('./sw.js').catch(()=>{});
}

async function boot() {
  await document.fonts.ready;
  try {
    renderer = new THREE.WebGLRenderer({ antialias:true, powerPreference:'high-performance' });
  } catch (e) {
    $('loading').hidden=true;
    $('graphics-error').hidden=false;
    console.error(e);
    return;
  }
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.18;
  renderer.physicallyCorrectLights = true;
  renderer.domElement.setAttribute('aria-label','Rabona wobbly football. WASD to move, E to kick, Q for rabona, Space to slide.');
  $('scene').appendChild(renderer.domElement);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(58, innerWidth/innerHeight, 0.1, 300);
  camera.position.set(0, 12, 18);

  const env = createEnvironment(renderer, scene);
  world = createWorld(scene);

  // showcase player for lobby
  showcase = createWobblyPlayer('blue', false, 0);
  showcase.root.position.set(0,0,0);
  showcase.root.rotation.y = -0.3;
  showcase.root.visible = true;
  scene.add(showcase.root);
  const showcaseBall = createBall();
  showcaseBall.root.position.set(0.8, 0.6, 0.2);
  scene.add(showcaseBall.root);

  game = new RabonaGame({
    scene, camera, world, audio,
    onPause: pauseModal,
    onFinish: resultsModal,
  });

  applyQuality();

  // UI bindings
  document.querySelectorAll('[data-view]').forEach(btn=>{ btn.onclick=()=>{ setView(btn.dataset.view); audio.click(); }; });
  document.querySelector('.brand')?.addEventListener('click', e=>{ e.preventDefault(); setView('play'); });

  const bind = (id, fn) => { const el=$(id); if(el) el.onclick=fn; };
  bind('play-btn', ()=>{
    if($('modal-backdrop').hidden===false) closeModal();
    audio.unlock();
    if(audio.master) audio.master.gain.value=0.22*config.volume;
    audio.click();
    showcase.root.visible=false;
    showcaseBall.root.visible=false;
    game.start({...config});
  });
  bind('practice-btn', ()=>{
    audio.unlock();
    showcase.root.visible=false;
    showcaseBall.root.visible=false;
    game.start({...config, mode:'practice'});
  });
  bind('garage-save', ()=>{ setView('play'); toast('Squad ready. Time to wobble!'); audio.click(); });
  bind('guide-ready', ()=>{ setView('play'); audio.click(); });
  bind('settings-btn', settingsModal);
  const guideBtn = $('guide-btn');
  if (guideBtn) guideBtn.onclick = ()=>{ openModal(guideModalContent(), 'guide'); };
  bind('sound-btn', ()=>{
    config.sound=!config.sound;
    audio.enabled=config.sound;
    audio.unlock();
    if(audio.master) audio.master.gain.value=0.22*config.volume;
    persist();
    $('sound-btn').innerHTML = config.sound ? '<svg><use href="#i-volume"/></svg>' : '<svg><use href="#i-muted"/></svg>';
    toast(config.sound?'Sound on. Hear that Rabona swish!':'Sound off. Pure focus.');
  });
  bind('pause-btn', ()=>game.pause());
  bind('modal-close', closeModal);
  $('modal-backdrop').addEventListener('click', e=>{ if(e.target===$('modal-backdrop') && modalKind!=='result') closeModal(); });

  window.addEventListener('keydown', e=>{
    if(!$('modal-backdrop').hidden){
      if(e.code==='Escape' && modalKind!=='result'){ e.preventDefault(); e.stopImmediatePropagation(); closeModal(); }
      return;
    }
    if(e.code==='Enter' && game.state==='lobby' && currentView==='play' && !['BUTTON','A','INPUT','SELECT'].includes(document.activeElement.tagName)){
      e.preventDefault();
      $('play-btn').click();
    }
  }, true);

  let orbit=0, targetOrbit=0, orbitY=0.6, targetY=0.6, dragging=false, lastX=0, lastY=0;
  function menuCamera(time, dt) {
    orbit = THREE.MathUtils.lerp(orbit, targetOrbit, 1-Math.exp(-dt*6));
    orbitY = THREE.MathUtils.lerp(orbitY, targetY, 1-Math.exp(-dt*6));
    const angle = -0.6 + orbit + Math.sin(time*0.12)*0.15;
    const radius = innerWidth<650?11:9;
    camera.fov = innerWidth<650?62:52;
    camera.aspect = innerWidth/innerHeight;
    camera.position.set(Math.sin(angle)*radius, 2.2+orbitY, Math.cos(angle)*radius);
    camera.lookAt(0,0.9,0);
    camera.updateProjectionMatrix();
  }

  renderer.domElement.addEventListener('pointerdown', e=>{
    if(game.state!=='lobby') return;
    dragging=true; lastX=e.clientX; lastY=e.clientY;
    renderer.domElement.setPointerCapture(e.pointerId);
  });
  renderer.domElement.addEventListener('pointermove', e=>{
    if(!dragging || game.state!=='lobby') return;
    targetOrbit += (e.clientX-lastX)*0.005;
    targetY = Math.max(0.2, Math.min(2.5, targetY + (e.clientY-lastY)*0.007));
    lastX=e.clientX; lastY=e.clientY;
  });
  window.addEventListener('pointerup', ()=>{ dragging=false; });
  window.addEventListener('resize', ()=>{
    camera.aspect=innerWidth/innerHeight;
    renderer.setSize(innerWidth, innerHeight);
    if(game.state!=='lobby'){ camera.clearViewOffset(); camera.updateProjectionMatrix(); }
  });

  setView(location.hash.slice(1));

  let last=performance.now(), time=0;
  let showcaseTime=0;
  function frame(now) {
    const dt = Math.min(0.05, Math.max(0,(now-last)/1000));
    last=now; time+=dt;
    if(game.state==='lobby'){
      menuCamera(time, dt);
      // animate showcase
      showcaseTime+=dt;
      const fakePlayer = { x:0, z:0, angle: Math.sin(showcaseTime*0.3)*0.3, state: showcaseTime%6<3?'run':'rabona', stateTimer: 1, runCycle: showcaseTime*3, wobbleX: Math.sin(showcaseTime*2)*0.05, wobbleZ: Math.cos(showcaseTime*1.7)*0.05 };
      if(showcase) showcase.update(fakePlayer, dt, showcaseTime);
      // ball bob
      showcaseBall.root.position.y = 0.6 + Math.abs(Math.sin(showcaseTime*2.2))*0.6;
      showcaseBall.root.rotation.y += dt*1.2;
      showcaseBall.root.rotation.x += dt*0.8;
    } else {
      game.update(dt);
    }
    world.animate(time);
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  menuCamera(0,1);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
  $('loading').style.opacity=0;
  setTimeout(()=>{ $('loading').hidden=true; }, 400);
}

boot().catch(e=>{ console.error(e); $('loading').hidden=true; $('graphics-error').hidden=false; });

export { game, world, camera, renderer, scene, config };
