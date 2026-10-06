import { validateProject } from './project.js';

const safeInlineJSON = (value) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

const STANDALONE_RUNTIME = String.raw`
;(async function nexusStandalone() {
  'use strict';
  const THREE = globalThis.THREE;
  const data = JSON.parse(document.getElementById('nexus-project-data').textContent);
  const mount = document.getElementById('game');
  const scene = new THREE.ObjectLoader().parse(data.scene);
  scene.traverse((object) => { if (object.isMesh) { object.castShadow = true; object.receiveShadow = true; } });
  function removeEditorOnly(parent) {
    [...parent.children].forEach((child) => {
      if (child.userData && child.userData.editorOnly) { parent.remove(child); return; }
      removeEditorOnly(child);
    });
  }
  removeEditorOnly(scene);
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.6));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.domElement.id = 'game-canvas';
  mount.appendChild(renderer.domElement);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.08, 400);
  let player = null, sun = null, dayNight = null;
  const objects = [];
  scene.traverse((object) => {
    if (object.userData && object.userData.nexus) objects.push(object);
    if (object.isDirectionalLight && !sun) sun = object;
  });
  function component(object, type) {
    return object && object.userData && object.userData.nexus && object.userData.nexus.components && object.userData.nexus.components.find((item) => item.type === type);
  }
  player = objects.find((object) => component(object, 'CharacterController')) || null;
  dayNight = objects.find((object) => component(object, 'DayNight')) || null;
  const hud = document.getElementById('hud');
  const notice = document.getElementById('notice');
  const paused = document.getElementById('paused');
  const healthBar = document.getElementById('health-bar');
  const staminaBar = document.getElementById('stamina-bar');
  const healthText = document.getElementById('health-text');
  const woodText = document.getElementById('wood-count');
  const stoneText = document.getElementById('stone-count');
  const berryText = document.getElementById('berry-count');
  const timeText = document.getElementById('day-time');
  const perf = document.getElementById('perf');
  const keys = new Set();
  let pausedNow = false, yaw = player ? player.rotation.y + Math.PI : Math.PI;
  let verticalVelocity = 0, stamina = component(player, 'Stamina')?.currentStamina || 100;
  let health = component(player, 'Health')?.currentHealth || 100;
  let inventory = { wood: 0, stone: 0, berries: 0 };
  let attackPower = 18, attackCooldown = 0, gameMinutes = 8 * 60, elapsed = 0;
  let last = performance.now(), toastTimer = 0, frameCount = 0, fpsMark = last;
  const saveKey = 'nexus-game-save:' + String(data.projectName || 'game').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  function restoreProgress() {
    try {
      const saved = JSON.parse(localStorage.getItem(saveKey) || 'null');
      if (!saved) return;
      if (player && Array.isArray(saved.position)) player.position.fromArray(saved.position);
      if (Number.isFinite(saved.health)) health = saved.health;
      if (Number.isFinite(saved.stamina)) stamina = saved.stamina;
      if (saved.inventory) inventory = { ...inventory, ...saved.inventory };
      if (Number.isFinite(saved.gameMinutes)) gameMinutes = saved.gameMinutes;
      const hidden = new Set(saved.hiddenObjects || []);
      objects.forEach((object) => { if (hidden.has(object.uuid)) object.visible = false; });
      (saved.enemyHealth || []).forEach(([uuid, value]) => { const enemy = objects.find((object) => object.uuid === uuid); const hp = component(enemy, 'Health'); if (hp && Number.isFinite(value)) hp.currentHealth = value; });
      const hp = component(player, 'Health'); if (hp) hp.currentHealth = health;
      const sp = component(player, 'Stamina'); if (sp) sp.currentStamina = stamina;
      const inv = component(player, 'Inventory'); if (inv) Object.assign(inv, inventory);
    } catch (_) { /* Browser storage is optional, especially under file://. */ }
  }
  function persistProgress() {
    try {
      localStorage.setItem(saveKey, JSON.stringify({ position: player?.position.toArray(), health, stamina, inventory, gameMinutes, hiddenObjects: objects.filter((object) => !object.visible).map((object) => object.uuid), enemyHealth: objects.filter((object) => object.userData?.nexus?.kind === 'Enemy').map((object) => [object.uuid, component(object, 'Health')?.currentHealth]) }));
    } catch (_) { /* Storage can be blocked in private browsing or file mode. */ }
  }
  restoreProgress();
  setInterval(persistProgress, 10000);
  window.addEventListener('pagehide', persistProgress);
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  function showNotice(text) {
    notice.textContent = text; notice.classList.add('visible');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => notice.classList.remove('visible'), 1900);
  }
  function resize() {
    const width = Math.max(1, mount.clientWidth), height = Math.max(1, mount.clientHeight);
    renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(mount); resize();
  function allComponents(type) { return objects.filter((object) => component(object, type)); }
  function groundHeight() {
    const terrain = objects.find((object) => object.userData?.nexus?.kind === 'Terrain');
    if (terrain) return terrain.position.y + 0.24;
    const plane = objects.find((object) => component(object, 'Collider')?.shape === 'Plane' && object.rotation.x < -0.5);
    return plane?.position.y || 0;
  }
  function collision(x, z, self) {
    for (const object of objects) {
      const collider = component(object, 'Collider');
      if (object === self || !object.visible || !collider || collider.isTrigger || collider.shape === 'Plane' || component(object, 'Pickup')) continue;
      if (object.isLight || object.userData?.nexus?.kind === 'Light' || object.userData?.nexus?.kind === 'Camera' || object.userData?.nexus?.kind === 'Terrain') continue;
      const radius = Math.max(0.2, Number(collider.radius) || 0.55) * Math.max(object.scale.x, object.scale.z, 0.7);
      if (Math.hypot(x - object.position.x, z - object.position.z) < radius + 0.4) return true;
    }
    return false;
  }
  function cameraFollow(dt) {
    if (!player) { camera.position.set(15, 14, 20); camera.lookAt(0, 0, 0); return; }
    const follow = component(player, 'CameraFollow') || { distance: 7, height: 3.2, lookHeight: 1.1, smoothing: 8 };
    if (Number(follow.distance) < 1) player.traverse((child) => { if (child.isMesh) child.visible = false; });
    const behind = yaw + Math.PI;
    const desired = new THREE.Vector3(player.position.x + Math.sin(behind) * Number(follow.distance || 7), player.position.y + Number(follow.height || 3.2), player.position.z + Math.cos(behind) * Number(follow.distance || 7));
    camera.position.lerp(desired, 1 - Math.exp(-Number(follow.smoothing || 8) * Math.max(dt, 0.001)));
    camera.lookAt(player.position.x, player.position.y + Number(follow.lookHeight || 1.1), player.position.z);
  }
  function collect() {
    if (!player) return;
    const nearest = allComponents('Pickup').filter((object) => object.visible).map((object) => ({ object, distance: object.position.distanceTo(player.position) })).sort((a, b) => a.distance - b.distance)[0];
    if (!nearest || nearest.distance > (Number(component(nearest.object, 'Pickup').collectRadius) || 2.2) + 0.85) { showNotice('Move closer to a resource.'); return; }
    const item = component(nearest.object, 'Pickup'), key = item.resource === 'berry' ? 'berries' : item.resource, amount = Number(item.amount || 1);
    const stored = component(player, 'Inventory'), capacity = Number(stored?.capacity) || 30;
    if (Object.values(inventory).reduce((sum, value) => sum + Number(value || 0), 0) + amount > capacity) { showNotice('Inventory is full.'); return; }
    inventory[key] = (inventory[key] || 0) + amount; nearest.object.visible = false;
    if (stored) stored[key] = inventory[key];
    showNotice('Collected ' + item.resource + '  +' + item.amount);
  }
  function attack() {
    if (!player || attackCooldown > 0) return;
    attackCooldown = 0.6;
    const enemies = objects.filter((object) => object.visible && object.userData?.nexus?.kind === 'Enemy' && (component(object, 'Health')?.currentHealth ?? 1) > 0).sort((a, b) => a.position.distanceTo(player.position) - b.position.distanceTo(player.position));
    const enemy = enemies[0];
    if (!enemy || enemy.position.distanceTo(player.position) > 3.2) { showNotice('No enemy in reach.'); return; }
    const hp = component(enemy, 'Health'); hp.currentHealth = Math.max(0, Number(hp.currentHealth) - attackPower);
    if (hp.currentHealth <= 0) { enemy.visible = false; inventory.berries++; const stored = component(player, 'Inventory'); if (stored) stored.berries = inventory.berries; showNotice('Stalker defeated. Berry +1'); }
    else showNotice('Hit the stalker · ' + hp.currentHealth + ' HP');
  }
  function craft() {
    if (inventory.wood < 3 || inventory.stone < 2) { showNotice('Stone tool needs 3 wood + 2 stone.'); return; }
    inventory.wood -= 3; inventory.stone -= 2; attackPower = 34;
    const stored = component(player, 'Inventory'); if (stored) Object.assign(stored, inventory);
    showNotice('Stone tool crafted · stronger attacks');
  }
  function update(dt) {
    elapsed += dt;
    const cycle = component(dayNight, 'DayNight');
    if (cycle) {
      gameMinutes = (gameMinutes + dt * 1440 / Math.max(30, Number(cycle.cycleDuration) || 180)) % 1440;
      const phase = gameMinutes / 1440;
      const angle = phase * Math.PI * 2 - Math.PI / 2;
      if (sun) {
        sun.position.set(Math.cos(angle) * 25, Math.max(4, Math.sin(angle) * 28), Math.sin(angle) * 18);
        sun.intensity = 0.28 + Math.max(0, Math.sin(angle)) * 3.05;
        const blend = clamp((Math.sin(angle) + 0.16) / 0.45, 0, 1);
        scene.background?.copy?.(new THREE.Color('#182437')).lerp(new THREE.Color('#80b5c0'), blend);
        scene.fog?.color?.copy?.(scene.background);
      }
    }
    if (player) {
      const controller = component(player, 'CharacterController') || { moveSpeed: 6, sprintMultiplier: 1.7, gravity: 18, jumpHeight: 2.2 };
      const fx = Math.sin(yaw), fz = Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
      let mx = 0, mz = 0;
      if (keys.has('KeyW') || keys.has('ArrowUp')) { mx += fx; mz += fz; }
      if (keys.has('KeyS') || keys.has('ArrowDown')) { mx -= fx; mz -= fz; }
      if (keys.has('KeyD') || keys.has('ArrowRight')) { mx += rx; mz += rz; }
      if (keys.has('KeyA') || keys.has('ArrowLeft')) { mx -= rx; mz -= rz; }
      const mag = Math.hypot(mx, mz) || 1; mx /= mag; mz /= mag;
      const moving = Math.hypot(mx, mz) > 0.1, sprint = moving && (keys.has('ShiftLeft') || keys.has('ShiftRight')) && stamina > 0.2;
      const staminaComp = component(player, 'Stamina');
      stamina = sprint ? Math.max(0, stamina - (Number(staminaComp?.sprintCost) || 18) * dt) : Math.min(Number(staminaComp?.maxStamina) || 100, stamina + 12 * dt);
      const speed = Number(controller.moveSpeed || 6) * (sprint ? Number(controller.sprintMultiplier || 1.7) : 1);
      const oldX = player.position.x, oldZ = player.position.z;
      const nx = oldX + mx * speed * dt, nz = oldZ + mz * speed * dt;
      const terrain = objects.find((object) => object.userData?.nexus?.kind === 'Terrain');
      const radius = Math.max(5, (Number(component(terrain, 'Collider')?.radius) || 34) - 1.2);
      const radial = Math.hypot(nx, nz), factor = radial > radius ? radius / radial : 1;
      if (!collision(nx * factor, oldZ, player)) player.position.x = nx * factor;
      if (!collision(player.position.x, nz * factor, player)) player.position.z = nz * factor;
      if (moving) player.rotation.y = Math.atan2(mx, mz) + Math.PI;
      const floor = groundHeight(), grounded = player.position.y <= floor + 0.012 && verticalVelocity <= 0;
      if (grounded) {
        player.position.y = floor; verticalVelocity = Math.max(0, verticalVelocity);
        if (keys.has('Space')) { verticalVelocity = Math.sqrt(2 * (Number(controller.gravity) || 18) * (Number(controller.jumpHeight) || 2.2)); keys.delete('Space'); }
      } else {
        verticalVelocity -= (Number(controller.gravity) || 18) * dt;
        player.position.y = Math.max(floor, player.position.y + verticalVelocity * dt);
        if (player.position.y === floor) verticalVelocity = 0;
      }
    }
    if (player) {
      for (const enemy of objects.filter((object) => object.visible && object.userData?.nexus?.kind === 'Enemy')) {
        const ai = component(enemy, 'AIController'); if (!ai || ai.enabled === false) continue;
        const hp = component(enemy, 'Health'), behavior = ai.behavior || 'Chase';
        if (behavior === 'Dead' || hp && hp.currentHealth <= 0) { ai.state = 'Dead'; continue; }
        if (behavior === 'Idle') { ai.state = 'Idle'; continue; }
        const dx = player.position.x - enemy.position.x, dz = player.position.z - enemy.position.z;
        const dist = Math.hypot(dx, dz), detection = Number(ai.detectionRange || 20), attackRange = Number(ai.attackRange || 1.6);
        const move = (x, z) => {
          const length = Math.hypot(x, z) || 1; x /= length; z /= length;
          const nx = enemy.position.x + x * Number(ai.moveSpeed || 2.2) * dt, nz = enemy.position.z + z * Number(ai.moveSpeed || 2.2) * dt;
          if (!collision(nx, enemy.position.z, enemy)) enemy.position.x = nx;
          if (!collision(enemy.position.x, nz, enemy)) enemy.position.z = nz;
          enemy.rotation.y = Math.atan2(x, z) + Math.PI;
        };
        if (behavior === 'Patrol' && dist > detection) {
          ai.state = 'Patrol'; ai._origin ||= [enemy.position.x, enemy.position.z]; ai._angle = (ai._angle || 0) + dt * 0.45;
          move(ai._origin[0] + Math.cos(ai._angle) * 2.5 - enemy.position.x, ai._origin[1] + Math.sin(ai._angle) * 2.5 - enemy.position.z); continue;
        }
        if (behavior === 'Flee') { if (dist > detection) { ai.state = 'Idle'; continue; } ai.state = 'Flee'; move(-dx, -dz); continue; }
        if (dist > detection) { ai.state = behavior === 'Patrol' ? 'Patrol' : 'Idle'; continue; }
        if (behavior === 'Attack' && dist > attackRange) { ai.state = 'Attack'; continue; }
        if (dist > attackRange) { ai.state = behavior === 'Investigate' || behavior === 'Follow' ? behavior : 'Chase'; move(dx, dz); continue; }
        if (behavior === 'Follow' || behavior === 'Investigate') { ai.state = behavior; continue; }
        ai.state = 'Attack'; ai._timer = (ai._timer || 0) - dt;
        if (ai._timer <= 0) {
          ai._timer = 1.3; health = Math.max(0, health - Number(ai.damage || 8));
          const hpPlayer = component(player, 'Health'); if (hpPlayer) hpPlayer.currentHealth = health;
          showNotice(health ? 'The stalker hit you!' : 'You are down. Restart to retry.');
        }
      }
    }
    for (const item of allComponents('Pickup')) if (item.visible) item.rotation.y += dt * 0.65;
    if (attackCooldown > 0) attackCooldown -= dt;
    cameraFollow(dt);
    healthBar.style.width = clamp(health, 0, 100) + '%'; staminaBar.style.width = clamp(stamina, 0, 100) + '%';
    healthText.textContent = String(Math.round(health)); woodText.textContent = inventory.wood; stoneText.textContent = inventory.stone; berryText.textContent = inventory.berries;
    const hour = Math.floor(gameMinutes / 60) % 24, minute = Math.floor(gameMinutes) % 60;
    const day = dayNight ? Math.floor(elapsed / Math.max(30, Number(cycle?.cycleDuration) || 180)) + 1 : 1;
    timeText.textContent = 'DAY ' + String(day).padStart(2, '0') + ' · ' + String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
  }
  function togglePause() {
    pausedNow = !pausedNow; keys.clear(); paused.hidden = !pausedNow;
    if (pausedNow && document.pointerLockElement === renderer.domElement) document.exitPointerLock?.();
  }
  window.addEventListener('keydown', (event) => {
    if (event.code === 'Escape') { event.preventDefault(); togglePause(); return; }
    if (['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.code)) event.preventDefault();
    keys.add(event.code);
    if (event.repeat || pausedNow) return;
    if (event.code === 'KeyE') collect();
    if (event.code === 'KeyF') attack();
    if (event.code === 'KeyC') craft();
  });
  window.addEventListener('keyup', (event) => keys.delete(event.code));
  renderer.domElement.addEventListener('click', () => renderer.domElement.requestPointerLock?.());
  document.addEventListener('mousemove', (event) => { if (document.pointerLockElement === renderer.domElement && !pausedNow) yaw -= event.movementX * 0.0024; });
  document.getElementById('resume').addEventListener('click', togglePause);
  document.getElementById('restart').addEventListener('click', () => { try { localStorage.removeItem(saveKey); } catch (_) {} location.reload(); });
  if (data.mode === 'development') perf.hidden = false;
  hud.hidden = false;
  cameraFollow(1);
  renderer.setAnimationLoop((now) => {
    const dt = Math.min(0.06, Math.max(0, (now - last) / 1000)); last = now;
    if (!pausedNow) update(dt);
    renderer.render(scene, camera);
    frameCount++;
    if (now - fpsMark > 600) {
      if (data.mode === 'development') perf.textContent = Math.round(frameCount * 1000 / (now - fpsMark)) + ' FPS · ' + objects.length + ' objects';
      frameCount = 0; fpsMark = now;
    }
  });
  document.getElementById('game-name').textContent = data.projectName || 'NEXUS GAME';
})();
`;

export async function buildPortableGame(project, engine, mode = 'release') {
  const problems = validateProject(project, engine);
  const errors = problems.filter((problem) => problem.severity === 'error');
  if (errors.length) throw new Error(errors.map((problem) => problem.message).join(' '));
  const response = await fetch(new URL('../vendor/three.module.js', import.meta.url));
  if (!response.ok) throw new Error(`Could not load the bundled Three.js runtime (${response.status}).`);
  let threeSource = await response.text();
  const exportStart = threeSource.lastIndexOf('\nexport {');
  if (exportStart < 0) throw new Error('Bundled renderer has no export block; cannot create the standalone runtime.');
  const exportBlock = threeSource.slice(exportStart).trim();
  const symbols = exportBlock.replace(/^export\s*\{\s*/, '').replace(/\s*\};?\s*$/, '');
  if (symbols === exportBlock) throw new Error('Could not transform the renderer export block.');
  threeSource = threeSource.slice(0, exportStart) + `\nglobalThis.THREE = { ${symbols} };\n`;
  const scene = engine.serializeScene();
  const embedded = safeInlineJSON({ projectName: project.name, scene, mode: mode === 'development' ? 'development' : 'release' });
  const runtime = STANDALONE_RUNTIME.replace(/<\/script/gi, '<\\/script');
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#101712"><title>${escapeHTML(project.name)} — NEXUS Game</title>
<style>
*{box-sizing:border-box}html,body,#game{width:100%;height:100%;margin:0;overflow:hidden;background:#112027;color:#ecf4e9;font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif}#game{position:fixed;inset:0}#game-canvas{display:block;width:100%;height:100%;outline:0;touch-action:none}.hud{position:fixed;z-index:2;inset:0;display:flex;flex-direction:column;justify-content:space-between;pointer-events:none;padding:18px 20px;background:linear-gradient(180deg,#07111782,transparent 28%,transparent 64%,#07111782)}.hud-top,.hud-bottom{display:flex;align-items:flex-start;justify-content:space-between;gap:18px}.brand{padding:8px 10px;border:1px solid #ffffff42;border-radius:5px;background:#0c1418a3;color:#eaf5e7;font-size:11px;font-weight:800;letter-spacing:1px}.brand i{color:#b5f36d;font-style:normal}.clock{padding:8px 10px;border:1px solid #ffffff35;border-radius:5px;background:#10171a99;font:10px ui-monospace,monospace}.status{align-self:flex-end;width:250px;padding:11px;border:1px solid #ffffff38;border-radius:6px;background:#0b1216d9;box-shadow:0 5px 20px #0005}.meter-label{display:flex;justify-content:space-between;margin:0 0 4px;color:#aab7b6;font:9px ui-monospace,monospace}.meter{height:6px;margin-bottom:9px;border-radius:8px;background:#344142;overflow:hidden}.meter i{display:block;width:100%;height:100%;border-radius:inherit;background:#99d96a}.meter.stamina i{background:#68c1c7}.inventory{display:flex;justify-content:space-between;padding-top:7px;border-top:1px solid #ffffff25;color:#aab8b2;font:9px ui-monospace,monospace}.inventory b{color:white}.controls{max-width:450px;align-self:flex-end;padding:7px 9px;border:1px solid #ffffff30;border-radius:4px;background:#0b1217a8;color:#c3ceca;font-size:9px;line-height:2;text-align:right}.controls b{padding:2px 4px;border:1px solid #ffffff42;border-radius:3px;background:#172225;color:#e5eee9;font:8px ui-monospace,monospace}.notice{position:fixed;z-index:4;left:50%;top:23%;transform:translateX(-50%);opacity:0;transition:opacity .18s;padding:9px 12px;border:1px solid #ffffff4c;border-radius:5px;background:#111a16e8;color:#eff9e9;font-size:11px;font-weight:700;pointer-events:none}.notice.visible{opacity:1}.pause{position:fixed;z-index:5;inset:0;display:grid;place-items:center;background:#060a0bd9}.pause[hidden],.hud[hidden],#perf[hidden]{display:none}.pause-card{display:flex;flex-direction:column;align-items:center;gap:9px;min-width:230px;padding:20px;border:1px solid #ffffff30;border-radius:8px;background:#171d1d}.pause-card h1{margin:0;color:#e8f2e5;font-size:16px;letter-spacing:2px}.pause-card p{margin:0;color:#9ba89c;font-size:10px}.pause-card button{min-width:120px;padding:8px;border:1px solid #73984d;border-radius:4px;background:#a8df68;color:#1a250f;font-weight:800;cursor:pointer}.pause-card button.secondary{border-color:#414a44;background:#252c29;color:#e5ede4}.footer{position:fixed;bottom:9px;left:12px;z-index:2;color:#ffffff91;font:8px ui-monospace,monospace;pointer-events:none}#perf{position:fixed;right:12px;top:60px;z-index:3;padding:5px 7px;border-radius:3px;background:#0a1118a6;color:#d7e1e7;font:9px ui-monospace,monospace;pointer-events:none}
</style></head><body><div id="game"></div>
<div class="hud" id="hud" hidden><div class="hud-top"><div class="brand"><i>✳</i> <span id="game-name">NEXUS GAME</span></div><div class="clock" id="day-time">DAY 01 · 08:00</div></div><div class="hud-bottom"><div class="status"><div class="meter-label"><span>HEALTH</span><b id="health-text">100</b></div><div class="meter"><i id="health-bar"></i></div><div class="meter-label"><span>STAMINA</span></div><div class="meter stamina"><i id="stamina-bar"></i></div><div class="inventory"><span>WOOD <b id="wood-count">0</b></span><span>STONE <b id="stone-count">0</b></span><span>BERRIES <b id="berry-count">0</b></span></div></div><div class="controls"><b>W A S D</b> move &nbsp; <b>SPACE</b> jump &nbsp; <b>SHIFT</b> sprint<br><b>E</b> gather &nbsp; <b>F</b> attack &nbsp; <b>C</b> craft stone tool &nbsp; <b>ESC</b> pause</div></div></div>
<div class="notice" id="notice"></div><div class="pause" id="paused" hidden><div class="pause-card"><h1>PAUSED</h1><p>Game simulation is paused.</p><button id="resume">Resume</button><button class="secondary" id="restart">Restart Game</button></div></div><div class="footer">BUILT WITH NEXUS GAME STUDIO · SINGLE-FILE BROWSER BUILD</div><div id="perf" hidden></div>
<script type="application/json" id="nexus-project-data">${embedded}</script>
<script type="module">${threeSource}\n${runtime}</script>
</body></html>`;
  return { html, filename: `${safeFilename(project.name)}.html`, warnings: problems.filter((problem) => problem.severity === 'warning') };
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function safeFilename(name) {
  return String(name || 'NEXUS-Game').replace(/[\\/:*?"<>|]/g, '').trim().replace(/\s+/g, '-') || 'NEXUS-Game';
}
