import * as THREE from 'three';
import { createCar } from './models.js';
import { CARS, PAINTS, RIVAL_NAMES, DRIVER_COUNT, MAX_LEVEL, terrainHeight, levelStats, zoneAt, exposureAfter, formatTime, clamp, damp, angleDelta, seeded, stepVehicle, findCollision } from './rules.js';
const $ = id => document.getElementById(id);
const text = (element, value) => { if (element.textContent !== String(value)) element.textContent = value; };
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export class BattleRoyale {
  constructor({ scene, camera, world, audio, onPause, onFinish, onLobby }) {
    Object.assign(this, { scene, camera, world, audio, onPause, onFinish, onLobby });
    this.state = 'lobby'; this.keys = new Set(); this.touch = { gas: false, brake: false, left: false, right: false, boost: false };
    this.vehicles = []; this.bots = []; this.random = seeded(310); this.cameraMode = 'chase'; this.targetVector = new THREE.Vector3(); this.markerVector = new THREE.Vector3();
    this.ui = Object.fromEntries(['drivers-left', 'drivers-label', 'phase-label', 'phase-time', 'zone-status', 'zone-progress', 'hud-level', 'hud-car-name', 'elimination-count', 'objective-kicker', 'objective-title', 'objective-detail', 'countdown', 'countdown-kicker', 'countdown-value', 'countdown-sub', 'radio', 'radio-text', 'interaction', 'interact-title', 'interact-detail', 'speed-value', 'gear-value', 'speed-arc', 'boost-bar', 'surface-label', 'zone-warning', 'exposure-bar', 'exposure-label', 'target-marker', 'target-distance', 'target-label', 'race-banner', 'race-banner-kicker', 'race-banner-title', 'race-banner-detail', 'challenge-progress', 'player-distance', 'rival-distance', 'rival-name', 'player-progress', 'rival-progress', 'damage-flash', 'boost-shade'].map(id => [id, $(id)]));
    this.map = $('minimap').getContext('2d'); this.setupParticles(); this.bindInput();
  }
  setupParticles() {
    this.particles = Array.from({ length: 80 }, () => ({ x: 0, y: -100, z: 0, life: 0, vx: 0, vz: 0 }));
    this.particlePositions = new Float32Array(240); this.particlePositions.fill(-1000);
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(this.particlePositions, 3));
    const c = document.createElement('canvas'); c.width = c.height = 32; const ctx = c.getContext('2d'), gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16); gradient.addColorStop(0, '#fff8'); gradient.addColorStop(1, '#fff0'); ctx.fillStyle = gradient; ctx.fillRect(0, 0, 32, 32);
    this.dust = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xc7c6a2, map: new THREE.CanvasTexture(c), size: 2.9, transparent: true, opacity: .40, depthWrite: false })); this.dust.frustumCulled = false; this.dust.visible = false; this.scene.add(this.dust); this.particleIndex = 0; this.dustTimer = 0;
  }
  clearInput() { this.keys.clear(); Object.keys(this.touch).forEach(k => { this.touch[k] = false; }); this.interactPressed = false; }
  bindInput() {
    window.addEventListener('keydown', event => {
      if (event.code === 'Escape' && this.state === 'playing') { event.preventDefault(); this.pause(); return; }
      if (this.state !== 'playing' || /INPUT|SELECT|TEXTAREA/.test(event.target.tagName)) return;
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ShiftRight', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyE', 'KeyR', 'KeyC', 'KeyM'].includes(event.code)) event.preventDefault();
      this.keys.add(event.code); if (event.repeat) return;
      if (event.code === 'KeyE') this.interactPressed = true;
      if (event.code === 'KeyR') this.resetPlayer();
      if (event.code === 'KeyC') { this.cameraMode = this.cameraMode === 'chase' ? 'bonnet' : 'chase'; this.say(this.cameraMode === 'chase' ? 'Chase camera. See the bigger picture.' : 'Bonnet camera. Eyes on the road.', 3); }
      if (event.code === 'KeyM') this.toggleMap();
    });
    window.addEventListener('keyup', event => this.keys.delete(event.code));
    window.addEventListener('blur', () => { if (this.state === 'playing') this.pause(); else this.clearInput(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.state === 'playing') this.pause(); });
    const bindHold = (id, key) => { const button = $(id); button.addEventListener('pointerdown', event => { event.preventDefault(); button.setPointerCapture(event.pointerId); this.touch[key] = true; }); const stop = () => { this.touch[key] = false; }; button.addEventListener('pointerup', stop); button.addEventListener('pointercancel', stop); };
    bindHold('touch-left', 'left'); bindHold('touch-right', 'right'); bindHold('touch-gas', 'gas'); bindHold('touch-brake', 'brake'); bindHold('touch-boost', 'boost');
    $('touch-interact').addEventListener('pointerdown', event => { event.preventDefault(); this.interactPressed = true; });
    $('map-btn').onclick = () => this.toggleMap();
  }
  toggleMap() { $('minimap-panel').classList.toggle('expanded'); $('map-btn').setAttribute('aria-label', $('minimap-panel').classList.contains('expanded') ? 'Collapse arena map' : 'Expand arena map'); }
  makeVehicle(id, color, x, z, angle, name, level = 1, player = false) {
    const model = createCar(id, color, player); this.scene.add(model.root);
    const vehicle = { id, color, x, z, angle, name, level, model, player, speed: 0, vx: 0, vz: 0, steer: 0, boost: 100, exposure: 0, active: true, distance: 0, hit: 0, onRoad: true, goal: null, duel: null, rethink: 0, stuck: 0, recover: 0, skill: .68 + this.random() * .12 };
    this.syncVehicle(vehicle, .05); return vehicle;
  }
  start(options = {}) {
    this.options = { car: 'kaze', paint: PAINTS[0].color, mode: 'royale', difficulty: 'casual', ...options };
    this.vehicles.forEach(v => { this.scene.remove(v.model.root); v.model.dispose(); }); this.vehicles = []; this.bots = [];
    this.random = seeded(310); this.world.reset(); this.world.setLobby(false);
    this.player = this.makeVehicle(this.options.car, this.options.paint, 0, -82, 0, 'YOU', 1, true); this.vehicles.push(this.player);
    const starts = [[-55, -40], [66, -120], [85, 40], [-85, 50], [130, 180], [-150, -180], [260, 30], [-250, 70], [50, -280], [-170, 270], [330, -230]];
    starts.forEach(([x, z], i) => { const carId = CARS[i % 3].id, color = PAINTS[(i + 1) % PAINTS.length].color; const bot = this.makeVehicle(carId, color, x, z, this.random() * Math.PI * 2, RIVAL_NAMES[i], 1 + (i % 3 === 0 ? 1 : 0)); this.bots.push(bot); this.vehicles.push(bot); });
    this.elapsed = 0; this.countdown = 3; this.countdownLast = 4; this.duels = []; this.duel = null; this.final = false; this.finalGoal = null; this.finalTime = 0; this.finalCountdown = 0;
    this.zone = zoneAt(0); this.currentPhase = 0; this.exposure = 0; this.maxSpeed = 0; this.eliminations = 0; this.highestLevel = 1; this.upgrades = 0;
    this.mapTimer = 0; this.shadowTimer = 0; this.autoDuelTimer = 18; this.radioTimer = 0; this.bannerTimer = 0; this.warningTimer = 0; this.resetCooldown = 0;
    this.playerTarget = null; this.cameraMode = this.options.camera || 'chase'; this.playerOnRoad = true; this.clearInput();
    this.camera.clearViewOffset(); this.camera.fov = 63; this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix();
    this.state = 'playing'; this.dust.visible = true; this.particles.forEach(p => { p.life = 0; p.y = -100; });
    $('lobby').hidden = true; $('hud').hidden = false; document.body.classList.add('driving'); $('minimap-panel').classList.remove('expanded');
    $('hud-mode').textContent = this.options.mode === 'royale' ? 'BATTLE ROYALE' : 'FREE DRIVE';
    this.ui['race-banner'].hidden = true; this.ui['interaction'].hidden = true; this.ui['zone-warning'].hidden = true; this.ui['challenge-progress'].hidden = true;
    this.ui['countdown-kicker'].textContent = this.options.mode === 'royale' ? '12 DRIVERS. ONE WINNER.' : 'THE WHOLE WORLD IS YOURS.';
    this.ui['countdown-sub'].textContent = 'YOUR ROAD STARTS HERE.';
    if (this.options.mode === 'explore') { this.world.zone.visible = this.world.zoneRing.visible = false; }
    this.audio.unlock(); this.say('Welcome to the highlands. A level 3 car drop is just ahead on your right. Follow the blue flare.', 10);
    this.updateCamera(1); this.updateHUD(); this.drawMap();
  }
  pause() { if (this.state !== 'playing') return; this.state = 'paused'; this.clearInput(); this.audio.stop(); this.onPause(); }
  resume() { if (this.state !== 'paused') return; this.state = 'playing'; this.clearInput(); this.audio.unlock(); }
  lobby() {
    this.state = 'lobby'; this.clearInput(); this.audio.stop();
    this.vehicles.forEach(v => { v.model.root.visible = false; }); this.world.reset(); this.world.setLobby(true); this.dust.visible = false;
    $('hud').hidden = true; $('lobby').hidden = false; document.body.classList.remove('driving'); this.onLobby();
  }
  alive() { return this.vehicles.filter(v => v.active).length; }
  finish(won, reason = '') {
    if (this.state !== 'playing') return;
    this.state = 'finished'; this.audio.stop(); this.clearInput(); this.ui.interaction.hidden = true; this.ui['target-marker'].hidden = true;
    const finalRank = this.finalGoal ? this.vehicles.filter(v => v.active).sort((a, b) => distance(a, this.finalGoal) - distance(b, this.finalGoal)).findIndex(v => v.player) + 1 : this.alive();
    const rank = won ? 1 : Math.max(2, finalRank);
    if (won) this.audio.win();
    this.onFinish({ won, reason, rank, elapsed: this.elapsed, eliminations: this.eliminations, level: this.player.level, maxSpeed: this.maxSpeed, distance: this.player.distance, upgrades: this.upgrades });
  }
  say(message, duration = 6) { text(this.ui['radio-text'], message); this.radioTimer = duration; this.ui.radio.style.opacity = 1; }
  banner(kicker, title, detail, duration = 3.5) { text(this.ui['race-banner-kicker'], kicker); text(this.ui['race-banner-title'], title); text(this.ui['race-banner-detail'], detail); this.bannerTimer = duration; this.ui['race-banner'].hidden = false; }
  resetPlayer() {
    if (this.state !== 'playing' || this.resetCooldown > 0) return;
    const p = this.player, road = this.world.nearestRoad(p.x, p.z); p.x = road.x; p.z = road.z; p.angle = road.angle; p.speed = p.vx = p.vz = 0; p.boost = Math.max(0, p.boost - 10); p.hit = 0; this.resetCooldown = 3;
    this.updateCamera(1); this.say('Back on the tarmac. Ten boost points spent. Make them count.', 4);
  }
  validGoal(x, z, limit = 600) {
    const length = Math.hypot(x, z); if (length > limit) { x *= limit / length; z *= limit / length; }
    for (let i = 0; i < 12; i++) { const hit = findCollision(x, z, 13, this.world.obstacles); if (!hit) break; x += hit.nx * (hit.obstacle.radius + 15 - hit.distance); z += hit.nz * (hit.obstacle.radius + 15 - hit.distance); }
    return { x, z };
  }
  makeGoal(a, b) {
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
    let angle = Math.atan2(-mx, -mz) + (this.random() - .5) * 1.3;
    const range = Math.min(380, Math.max(210, this.zone.radius * .7));
    let goal = this.validGoal(mx + Math.sin(angle) * range, mz + Math.cos(angle) * range, Math.max(100, this.zone.radius * .85));
    if (distance(goal, a) < 110) goal = this.validGoal(-mx + 75, -mz - 90, this.zone.radius * .88);
    return goal;
  }
  startDuel(a, b) {
    if (!a.active || !b.active || a.duel || b.duel || this.final || this.options.mode !== 'royale') return;
    const goal = this.makeGoal(a, b), duel = { a, b, goal, time: 0, resolved: false, initialA: distance(a, goal), initialB: distance(b, goal) };
    a.duel = b.duel = duel; this.duels.push(duel);
    if (a.player || b.player) {
      this.duel = duel; this.world.setFinish(goal.x, goal.z); this.audio.beep(true);
      this.banner('HEAD-TO-HEAD / ' + (a.player ? b.name : a.name), 'FIRST THERE. STAYS HERE.', 'FOLLOW THE ORANGE FINISH MARKER', 3);
      this.say('Challenge accepted. First to the orange gate wins. There are no checkpoints — take your own line.', 7);
    }
  }
  eliminate(vehicle, reason = '') {
    if (!vehicle.active) return;
    if (vehicle.player) { this.finish(false, reason); return; }
    vehicle.active = false; vehicle.model.root.visible = false;
  }
  resolveDuel(duel, winner, loser) {
    if (duel.resolved) return; duel.resolved = true; duel.a.duel = duel.b.duel = null;
    const involved = duel.a.player || duel.b.player;
    if (loser.player) { this.finish(false, `${winner.name} reached the finish first. Find a higher-level car, use your boost, and try a different line.`); return; }
    this.eliminate(loser); this.upgradeVehicle(winner, Math.max(winner.level + 1, loser.level)); winner.goal = null;
    if (involved) {
      this.duel = null; this.eliminations++; this.highestLevel = Math.max(this.highestLevel, winner.level); this.world.finish.visible = false; this.ui['challenge-progress'].hidden = true;
      this.audio.upgrade(); this.banner('HEAD-TO-HEAD WON', 'LEAVE THEM BEHIND.', `${loser.name} ELIMINATED / YOU ARE NOW LEVEL ${winner.level}`);
      this.say(`${loser.name} is out. Your car is now level ${winner.level}. Keep an eye on the arena.`, 7);
    } else this.say(`${winner.name} eliminated ${loser.name}. ${this.alive()} drivers remain.`, 4);
  }
  startFinal() {
    if (this.final || this.state !== 'playing') return;
    this.final = true; this.finalTime = 0; this.finalCountdown = 6; this.countdownLast = 7;
    this.duels.forEach(d => { d.resolved = true; d.a.duel = d.b.duel = null; }); this.duel = null;
    const angle = Math.atan2(-this.player.x, -this.player.z) + .35;
    this.finalGoal = this.validGoal(Math.sin(angle) * 515, Math.cos(angle) * 515, 570);
    this.world.setFinish(this.finalGoal.x, this.finalGoal.z); this.world.zone.visible = this.world.zoneRing.visible = false;
    this.vehicles.forEach(v => { v.speed = v.vx = v.vz = 0; v.boost = 100; v.exposure = 0; v.goal = null; });
    this.ui['zone-warning'].hidden = true; this.ui['interaction'].hidden = true; this.ui['challenge-progress'].hidden = true;
    text(this.ui['countdown-kicker'], 'FINAL SPRINT / ' + this.alive() + ' DRIVERS'); text(this.ui['countdown-sub'], 'ONE FINISH LINE. ONE WINNER.');
    this.bannerTimer = 0; this.ui['race-banner'].hidden = true;
    this.say('This is it. No more challenges. The arena is open — first to the final gate wins the whole thing.', 10);
  }
  chooseBotGoal(bot) {
    const inside = this.options.mode === 'explore' ? 620 : this.zone.radius * .77;
    if (this.options.mode === 'royale' && Math.hypot(bot.x, bot.z) > inside) return this.validGoal(bot.x * .45, bot.z * .45, inside * .7);
    if (this.options.mode !== 'explore') {
      let best = null, score = Infinity;
      for (const drop of this.world.drops) {
        if (drop.taken || drop.level <= bot.level || Math.hypot(drop.x, drop.z) > inside || (drop.id === 0 && this.elapsed < 35)) continue;
        const d = distance(bot, drop) / (1 + (drop.level - bot.level) * .15);
        if (d < score) { best = drop; score = d; }
      }
      if (best) return { x: best.x, z: best.z, drop: best };
    }
    for (let i = 0; i < 30; i++) { const p = this.world.roadSamples[Math.floor(this.random() * this.world.roadSamples.length)]; if (Math.hypot(p.x, p.z) < inside) return { x: p.x, z: p.z }; }
    return { x: 0, z: 0 };
  }
  updateBot(bot, dt) {
    if (!bot.active) return;
    bot.rethink -= dt;
    if (!bot.goal || bot.rethink <= 0 || distance(bot, bot.goal) < 13 || bot.goal.drop?.taken) { bot.goal = this.chooseBotGoal(bot); bot.rethink = 4 + this.random() * 2; }
    const goal = this.final ? this.finalGoal : bot.duel ? bot.duel.goal : bot.goal;
    let dx = goal.x - bot.x, dz = goal.z - bot.z, len = Math.max(1, Math.hypot(dx, dz));
    dx /= len; dz /= len;
    const lookahead = 12 + Math.abs(bot.speed) * .7;
    let avoidance = 0;
    for (const obstacle of this.world.obstacles) {
      const ox = obstacle.x - bot.x, oz = obstacle.z - bot.z, ahead = ox * dx + oz * dz, lateral = ox * dz - oz * dx;
      if (ahead > -2 && ahead < lookahead + obstacle.radius && Math.abs(lateral) < obstacle.radius + 3.5) {
        const side = lateral > 0 ? -1 : 1;
        avoidance += side * (1.5 + obstacle.radius / 25) * (1 - Math.max(0, ahead - obstacle.radius) / (lookahead + 1));
      }
    }
    const desired = Math.atan2(dx + dz * clamp(avoidance, -2.3, 2.3), dz - dx * clamp(avoidance, -2.3, 2.3));
    const delta = angleDelta(bot.angle, desired);
    const steer = clamp(-delta * 1.8, -1, 1);
    const difficulty = this.options.difficulty === 'challenger' ? .13 : 0;
    const stats = levelStats(bot.id, bot.level); stats.speed *= bot.skill + difficulty; stats.acceleration *= .9;
    const cornerSpeed = Math.max(12, stats.speed * (1 - Math.abs(delta) * .3));
    const input = { gas: bot.speed < cornerSpeed, brake: bot.speed > cornerSpeed + 5, steer, drift: false, boost: (this.final || bot.duel) && Math.abs(delta) < .16 && len > 80 && bot.boost > 15 };
    if (Math.abs(bot.speed) < 2 && !this.finalCountdown) bot.stuck += dt; else bot.stuck = Math.max(0, bot.stuck - dt);
    if (bot.stuck > 2.5) { bot.recover = 1.2; bot.stuck = 0; }
    if (bot.recover > 0) { bot.recover -= dt; input.gas = false; input.brake = true; input.steer = -steer; }
    bot.onRoad = this.world.onRoad(bot.x, bot.z);
    stepVehicle(bot, input, dt, bot.onRoad, stats, this.world.obstacles);
    if (!this.final && this.options.mode === 'royale') {
      bot.exposure = exposureAfter(bot.exposure, Math.hypot(bot.x, bot.z) > this.zone.radius, dt, this.options.difficulty);
      if (bot.exposure >= 100) { this.eliminate(bot); this.say(`${bot.name} was caught outside the arena. ${this.alive()} drivers remain.`, 4); return; }
      if (!bot.duel) for (const drop of this.world.drops) if (!drop.taken && drop.level > bot.level && !(drop.id === 0 && this.elapsed < 35) && distance(bot, drop) < 7) { this.upgradeVehicle(bot, drop.level); drop.taken = true; drop.root.visible = false; bot.goal = null; break; }
    }
    this.syncVehicle(bot, dt);
  }
  update(dt) {
    if (this.state !== 'playing') return;
    if (this.countdown > 0 || this.finalCountdown > 0) {
      const final = this.finalCountdown > 0, remaining = final ? this.finalCountdown : this.countdown;
      const number = Math.ceil(remaining); if (number !== this.countdownLast) { this.audio.beep(); this.countdownLast = number; }
      this.ui.countdown.hidden = false; text(this.ui['countdown-value'], number);
      if (final) this.finalCountdown -= dt; else this.countdown -= dt;
      if ((final ? this.finalCountdown : this.countdown) <= 0) { this.audio.beep(true); this.ui.countdown.hidden = true; this.banner('THE ROAD IS YOURS', final ? 'MAKE IT COUNT.' : 'GO MAKE SOME DISTANCE.', final ? 'FIRST TO THE ORANGE GATE WINS' : 'CAR DROPS ARE MARKED BY BLUE FLARES', 2.1); }
      this.updateCamera(dt); this.updateHUD(); this.updateMarker(); return;
    }
    this.elapsed += dt; this.resetCooldown = Math.max(0, this.resetCooldown - dt);
    this.zone = zoneAt(this.elapsed); this.world.setZone(this.zone.radius);
    if (this.zone.index !== this.currentPhase && !this.final && this.options.mode === 'royale') {
      this.currentPhase = this.zone.index; this.audio.warning(); this.banner('THE WORLD IS GETTING SMALLER', 'ARENA CLOSING.', 'STAY INSIDE THE ORANGE CIRCLE', 3);
      this.say('The arena is closing. Get inside the circle on your map.', 6);
    }
    const k = this.keys, p = this.player;
    const input = { gas: k.has('KeyW') || k.has('ArrowUp') || this.touch.gas, brake: k.has('KeyS') || k.has('ArrowDown') || this.touch.brake, steer: Number(k.has('KeyD') || k.has('ArrowRight') || this.touch.right) - Number(k.has('KeyA') || k.has('ArrowLeft') || this.touch.left), drift: k.has('Space'), boost: k.has('ShiftLeft') || k.has('ShiftRight') || this.touch.boost };
    this.lastInput = input; p.onRoad = this.world.onRoad(p.x, p.z); this.playerOnRoad = p.onRoad;
    const hit = stepVehicle(p, input, dt, p.onRoad, levelStats(p.id, p.level), this.world.obstacles);
    if (hit && this.hitAudioCooldown <= 0) { this.audio.bump(); this.hitAudioCooldown = .6; }
    this.hitAudioCooldown = Math.max(0, (this.hitAudioCooldown || 0) - dt);
    this.maxSpeed = Math.max(this.maxSpeed, Math.abs(p.speed) * 3.6); p.hit = Math.max(0, p.hit - dt);
    this.syncVehicle(p, dt);
    for (const bot of this.bots) this.updateBot(bot, dt);
    // Cars can trade paint, but impact alone is never an elimination.
    for (const bot of this.bots) if (bot.active) {
      const d = distance(p, bot);
      if (d < 2.1 && d > .001) { const nx = (p.x - bot.x) / d, nz = (p.z - bot.z) / d; p.x += nx * (2.1 - d) * .55; p.z += nz * (2.1 - d) * .55; bot.x -= nx * (2.1 - d) * .55; bot.z -= nz * (2.1 - d) * .55; p.speed *= .97; p.hit = .13; }
    }
    if (!this.final && this.options.mode === 'royale') {
      p.exposure = exposureAfter(p.exposure, Math.hypot(p.x, p.z) > this.zone.radius, dt, this.options.difficulty);
      this.warningTimer -= dt;
      if (p.exposure > 0 && this.warningTimer <= 0) { this.audio.warning(); this.warningTimer = 3; }
      if (p.exposure >= 100) { this.finish(false, 'The arena closed around you. Watch the orange circle on the map and head inward before the next phase.'); return; }
      for (const duel of this.duels) {
        if (duel.resolved) continue; duel.time += dt;
        if (!duel.a.active) { this.resolveDuel(duel, duel.b, duel.a); continue; }
        if (!duel.b.active) { this.resolveDuel(duel, duel.a, duel.b); continue; }
        const aDist = distance(duel.a, duel.goal), bDist = distance(duel.b, duel.goal);
        if (aDist < 12 || bDist < 12 || duel.time > 55) this.resolveDuel(duel, aDist <= bDist ? duel.a : duel.b, aDist <= bDist ? duel.b : duel.a);
        if (this.state !== 'playing') return;
      }
      this.autoDuelTimer -= dt;
      if (this.autoDuelTimer <= 0 && this.alive() > 4) {
        const available = this.bots.filter(b => b.active && !b.duel);
        if (available.length >= 2) { const a = available[Math.floor(this.random() * available.length)]; const b = available.filter(v => v !== a).sort((u, v) => distance(a, u) - distance(a, v))[0]; this.startDuel(a, b); }
        this.autoDuelTimer = 14 + this.random() * 7;
      }
      if (this.alive() <= 1) { this.finish(true, 'Every other driver was eliminated. The highlands are yours.'); return; }
      if (!this.duel && (this.elapsed >= 205 || (this.elapsed > 75 && this.alive() <= 4))) this.startFinal();
    }
    if (this.final && this.finalCountdown <= 0) {
      this.finalTime += dt;
      const contenders = this.vehicles.filter(v => v.active).sort((a, b) => distance(a, this.finalGoal) - distance(b, this.finalGoal));
      const winner = contenders[0];
      if (distance(winner, this.finalGoal) < 13 || this.finalTime > 110) { this.finish(winner.player, winner.player ? 'You won the final sprint. Twelve drivers entered. Only one owns the road.' : `${winner.name} took the final sprint. Save your boost for the straight, and cut across country when the road takes the long way.`); return; }
    }
    this.updateInteraction(); this.updateParticles(dt); this.updateCamera(dt); this.updateMarker();
    this.radioTimer -= dt; if (this.radioTimer <= 0) this.ui.radio.style.opacity = 0;
    this.bannerTimer -= dt; if (this.bannerTimer <= 0) this.ui['race-banner'].hidden = true;
    this.audio.update(p.speed, input.gas, p.boosting, true); this.updateHUD();
    this.mapTimer -= dt; if (this.mapTimer <= 0) { this.drawMap(); this.mapTimer = .12; }
    this.shadowTimer -= dt; if (this.shadowTimer <= 0) { this.world.followShadow(p.x, p.z); this.shadowTimer = .12; }
  }
  syncVehicle(vehicle, dt) {
    const { model, x, z, angle } = vehicle, y = terrainHeight(x, z);
    model.root.position.set(x, y + .06, z); model.root.rotation.y = angle;
    const fx = Math.sin(angle), fz = Math.cos(angle);
    const front = terrainHeight(x + fx * 1.6, z + fz * 1.6), rear = terrainHeight(x - fx * 1.6, z - fz * 1.6);
    const left = terrainHeight(x + fz, z - fx), right = terrainHeight(x - fz, z + fx);
    model.root.rotation.x = -Math.atan2(front - rear, 3.2); model.root.rotation.z = Math.atan2(left - right, 2);
    const roll = -vehicle.steer * Math.min(Math.abs(vehicle.speed) / 300, .04);
    model.update(vehicle.distance, vehicle.steer, 0, roll);
  }
  updateCamera(dt) {
    if (!this.player) return;
    const p = this.player, fx = Math.sin(p.angle), fz = Math.cos(p.angle), y = terrainHeight(p.x, p.z), speed = Math.abs(p.speed);
    const chase = this.cameraMode === 'chase';
    let x, cy, z;
    if (chase) { const behind = 8.7 + speed * .033; x = p.x - fx * behind; z = p.z - fz * behind; cy = Math.max(y + 3.3 + speed * .006, terrainHeight(x, z) + 1.6); this.targetVector.set(p.x + fx * (4 + speed * .045), y + 1.05, p.z + fz * (4 + speed * .045)); }
    else { x = p.x + fx * 1.15; z = p.z + fz * 1.15; cy = y + 1.23; this.targetVector.set(p.x + fx * 60, y + 1.5, p.z + fz * 60); }
    const lerp = dt >= .5 ? 1 : 1 - Math.exp(-dt * (chase ? 7 : 18));
    this.camera.position.lerp(new THREE.Vector3(x, cy, z), lerp);
    this.camera.lookAt(this.targetVector);
    const fov = p.boosting ? 75 : 63 + Math.min(7, speed / 12);
    this.camera.fov = damp(this.camera.fov, fov, 5, dt); this.camera.updateProjectionMatrix();
  }
  updateParticles(dt) {
    const p = this.player; this.dustTimer -= dt;
    if (Math.abs(p.speed) > 8 && (!p.onRoad || this.lastInput?.drift) && this.dustTimer <= 0) {
      for (const s of [-1, 1]) { const particle = this.particles[this.particleIndex++ % this.particles.length]; particle.x = p.x - Math.sin(p.angle) * 1.8 + Math.cos(p.angle) * s; particle.z = p.z - Math.cos(p.angle) * 1.8 - Math.sin(p.angle) * s; particle.y = terrainHeight(particle.x, particle.z) + .5; particle.life = 1.4; particle.vx = (Math.random() - .5) * 1.4; particle.vz = (Math.random() - .5) * 1.4; }
      this.dustTimer = .05;
    }
    this.particles.forEach((particle, i) => { particle.life -= dt; if (particle.life > 0) { particle.x += particle.vx * dt; particle.z += particle.vz * dt; particle.y += dt * .7; } this.particlePositions[i * 3] = particle.x; this.particlePositions[i * 3 + 1] = particle.life > 0 ? particle.y : -1000; this.particlePositions[i * 3 + 2] = particle.z; });
    this.dust.geometry.attributes.position.needsUpdate = true;
  }
  upgradeVehicle(vehicle, level) {
    vehicle.level = Math.min(MAX_LEVEL, level);
    const id = level >= 6 ? 'vela' : level >= 4 ? 'raid' : vehicle.id;
    if (id !== vehicle.id) {
      this.scene.remove(vehicle.model.root); vehicle.model.dispose();
      vehicle.id = id; vehicle.model = createCar(id, vehicle.color, vehicle.player); this.scene.add(vehicle.model.root); this.syncVehicle(vehicle, .05);
    }
    vehicle.boost = 100;
  }
  claimDrop(drop) {
    if (drop.taken || drop.level <= this.player.level) return false;
    drop.taken = true; drop.root.visible = false; this.upgradeVehicle(this.player, drop.level); this.upgrades++; this.highestLevel = Math.max(this.highestLevel, drop.level);
    this.audio.upgrade(); this.banner('CAR DROP CLAIMED', 'A LITTLE MORE UNFAIR.', `LEVEL ${String(drop.level).padStart(2, '0')} / SPEED, ACCELERATION & HANDLING UPGRADED`);
    this.say(`Level ${drop.level}. Better acceleration. More top end. Now find someone to leave behind.`, 6); return true;
  }
  updateInteraction() {
    this.ui.interaction.hidden = true; this.playerTarget = null;
    if (this.duel || this.final) { this.interactPressed = false; return; }
    const p = this.player;
    const drop = this.world.drops.filter(d => !d.taken && distance(d, p) < 13).sort((a, b) => distance(a, p) - distance(b, p))[0];
    if (drop) {
      this.playerTarget = { type: 'drop', target: drop };
      this.ui.interaction.hidden = false;
      text(this.ui['interact-title'], drop.level > p.level ? 'CLAIM CAR DROP' : 'YOU HAVE THE BETTER RIDE');
      text(this.ui['interact-detail'], drop.level > p.level ? `LEVEL ${String(drop.level).padStart(2, '0')} / PRESS E TO UPGRADE` : `LEVEL ${drop.level} DROP / YOU ARE LEVEL ${p.level}`);
      if (this.interactPressed) this.claimDrop(drop);
    } else if (this.options.mode === 'royale') {
      const rival = this.bots.filter(b => b.active && !b.duel && distance(b, p) < 58).sort((a, b) => distance(a, p) - distance(b, p))[0];
      if (rival) { this.playerTarget = { type: 'rival', target: rival }; this.ui.interaction.hidden = false; text(this.ui['interact-title'], 'CHALLENGE ' + rival.name); text(this.ui['interact-detail'], `YOU: LVL ${p.level} / ${rival.name}: LVL ${rival.level}`); if (this.interactPressed) this.startDuel(p, rival); }
    }
    this.interactPressed = false;
  }
  updateMarker() {
    const p = this.player;
    let target = this.final ? this.finalGoal : this.duel ? this.duel.goal : null, label = this.final ? 'FINAL FINISH' : 'HEAD-TO-HEAD FINISH', type = 'finish';
    if (!target) { target = this.world.drops.filter(d => !d.taken && d.level > p.level).sort((a, b) => distance(p, a) - distance(p, b))[0]; type = 'drop'; label = target ? 'LVL ' + target.level + ' CAR DROP' : ''; }
    if (!target || this.countdown > 0) { this.ui['target-marker'].hidden = true; return; }
    const marker = this.ui['target-marker']; marker.hidden = false; marker.classList.toggle('drop', type === 'drop');
    this.markerVector.set(target.x, terrainHeight(target.x, target.z) + (type === 'drop' ? 8 : 14), target.z);
    const dir = this.markerVector.clone().sub(this.camera.position), cameraDirection = new THREE.Vector3(); this.camera.getWorldDirection(cameraDirection);
    const behind = dir.dot(cameraDirection) < 0;
    this.markerVector.project(this.camera);
    let x = (this.markerVector.x * .5 + .5) * innerWidth, y = (-this.markerVector.y * .5 + .5) * innerHeight;
    if (behind) { x = innerWidth - x; y = innerHeight * .5; }
    const isOffscreen = behind || x < 45 || x > innerWidth - 45 || y < 190 || y > innerHeight - 230;
    x = clamp(x, 50, innerWidth - 50); y = clamp(y, innerWidth < 650 ? 310 : 205, innerHeight - (innerWidth < 650 ? 295 : 220));
    marker.classList.toggle('offscreen', isOffscreen); marker.style.left = x + 'px'; marker.style.top = y + 'px';
    text(this.ui['target-distance'], Math.round(distance(p, target)) + ' M'); text(this.ui['target-label'], label);
  }
  updateHUD() {
    const p = this.player; if (!p) return;
    const free = this.options.mode === 'explore';
    text(this.ui['drivers-left'], free ? '∞' : this.alive()); this.ui['drivers-label'].innerHTML = free ? 'FREE<br>DRIVE' : 'DRIVERS<br>REMAINING';
    text(this.ui['phase-label'], free ? 'TAKE THE LONG WAY HOME' : this.final ? 'FINAL SPRINT' : this.zone.index === 0 ? 'ARENA SHRINKS IN' : 'NEXT PHASE IN');
    text(this.ui['phase-time'], free ? formatTime(this.elapsed) : this.final ? 'GO ALL IN' : formatTime(this.zone.remaining));
    this.ui['zone-status'].classList.toggle('closing', !free && (this.zone.index > 0 || this.final));
    this.ui['zone-progress'].style.width = free || this.final ? '100%' : clamp(this.zone.remaining / (this.zone.end - this.zone.start) * 100, 0, 100) + '%';
    text(this.ui['hud-level'], String(p.level).padStart(2, '0')); text(this.ui['hud-car-name'], CARS.find(c => c.id === p.id).name); text(this.ui['elimination-count'], this.eliminations);
    if (this.final) { text(this.ui['objective-kicker'], 'ONE LAST RACE'); text(this.ui['objective-title'], 'WIN THE FINAL SPRINT'); text(this.ui['objective-detail'], 'First through the orange finish gate wins.'); }
    else if (this.duel) { text(this.ui['objective-kicker'], 'WINNER STAYS / LOSER GOES'); text(this.ui['objective-title'], 'RACE TO THE FINISH'); text(this.ui['objective-detail'], 'No checkpoints. Take the fastest line.'); }
    else if (p.level > 1 && !free) { text(this.ui['objective-kicker'], 'YOUR NEXT MOVE'); text(this.ui['objective-title'], 'FIND YOUR NEXT RIVAL'); text(this.ui['objective-detail'], 'Get within 58 m of a rival. Press E to challenge.'); }
    else { text(this.ui['objective-kicker'], free ? 'NO CLOCK. NO PRESSURE.' : 'YOUR FIRST MOVE'); text(this.ui['objective-title'], free ? 'GO SOMEWHERE NEW' : 'FIND A FASTER RIDE'); text(this.ui['objective-detail'], free ? 'Explore the highlands. Blue flares still upgrade your car.' : 'Follow the blue flares. Press E near a car drop.'); }
    const speed = Math.abs(p.speed) * 3.6; text(this.ui['speed-value'], Math.round(speed).toString().padStart(3, '0')); text(this.ui['gear-value'], p.speed < -1 ? 'R' : p.speed < 1 ? 'N' : Math.min(6, Math.floor(p.speed / 13) + 1));
    this.ui['speed-arc'].style.strokeDashoffset = 402 * (1 - clamp(speed / 320, 0, 1)); this.ui['boost-bar'].style.width = p.boost + '%';
    text(this.ui['surface-label'], p.boosting ? 'NITRO / MAKE SOME DISTANCE' : this.lastInput?.drift ? 'DRIFT / HOLD YOUR LINE' : p.onRoad ? 'TARMAC / FULL GRIP' : 'OFF-ROAD / FIND YOUR LINE');
    this.ui['damage-flash'].style.opacity = Math.max(p.hit * 2, p.exposure / 220); this.ui['boost-shade'].style.opacity = p.boosting ? 1 : 0;
    this.ui['zone-warning'].hidden = free || this.final || p.exposure <= 0; this.ui['exposure-bar'].style.width = p.exposure + '%'; text(this.ui['exposure-label'], 'ARENA EXPOSURE / ' + Math.ceil(p.exposure) + '%');
    this.ui['challenge-progress'].hidden = !this.duel;
    if (this.duel) {
      const rival = this.duel.a.player ? this.duel.b : this.duel.a, playerDistance = distance(p, this.duel.goal), rivalDistance = distance(rival, this.duel.goal);
      text(this.ui['rival-name'], rival.name); text(this.ui['player-distance'], Math.round(playerDistance) + ' M'); text(this.ui['rival-distance'], Math.round(rivalDistance) + ' M');
      const startP = this.duel.a.player ? this.duel.initialA : this.duel.initialB, startR = this.duel.a.player ? this.duel.initialB : this.duel.initialA;
      this.ui['player-progress'].style.width = clamp(1 - playerDistance / startP, 0, 1) * 100 + '%'; this.ui['rival-progress'].style.width = clamp(1 - rivalDistance / startR, 0, 1) * 100 + '%';
    }
  }
  drawMap(context = this.map, miniature = false) {
    const W = miniature ? 180 : 400, H = miniature ? 140 : 400, scale = miniature ? .12 : .267, cx = W / 2, cz = H / 2;
    const px = x => cx - x * scale, pz = z => cz - z * scale;
    context.clearRect(0, 0, W, H); context.save();
    context.strokeStyle = '#a8c1a518'; context.lineWidth = 1;
    for (let x = 0; x < W; x += miniature ? 20 : 40) { context.beginPath(); context.moveTo(x, 0); context.lineTo(x, H); context.stroke(); }
    for (let z = 0; z < H; z += miniature ? 20 : 40) { context.beginPath(); context.moveTo(0, z); context.lineTo(W, z); context.stroke(); }
    context.fillStyle = '#91b39c18'; context.beginPath(); context.arc(cx, cz, 640 * scale, 0, Math.PI * 2); context.fill();
    context.fillStyle = '#93c4c244'; context.beginPath(); context.ellipse(px(-407), pz(82), 90 * scale, 69 * scale, 0, 0, Math.PI * 2); context.fill();
    context.strokeStyle = miniature ? '#bfd1b083' : '#cad4b56b'; context.lineWidth = miniature ? 1.2 : 2.4;
    this.world.roadPaths.forEach(path => { context.beginPath(); path.forEach((p, i) => { if (i === 0) context.moveTo(px(p.x), pz(p.z)); else context.lineTo(px(p.x), pz(p.z)); }); context.stroke(); });
    if (miniature) { context.fillStyle = '#ffb38b'; context.beginPath(); context.arc(px(0), pz(-82), 3, 0, Math.PI * 2); context.fill(); context.strokeStyle = '#ffb38b59'; context.beginPath(); context.arc(px(0), pz(-82), 8, 0, Math.PI * 2); context.stroke(); context.restore(); return; }
    if (!this.final && this.options.mode === 'royale') {
      context.strokeStyle = '#ffc09d'; context.lineWidth = 2; context.beginPath(); context.arc(cx, cz, this.zone.radius * scale, 0, Math.PI * 2); context.stroke();
      context.setLineDash([5, 5]); context.strokeStyle = '#ffc09d80'; context.beginPath(); context.arc(cx, cz, this.zone.to * scale, 0, Math.PI * 2); context.stroke(); context.setLineDash([]);
    }
    this.world.drops.forEach(drop => { if (drop.taken) return; context.fillStyle = drop.level > this.player.level ? '#b8e6df' : '#84a49a66'; context.fillRect(px(drop.x) - 2.5, pz(drop.z) - 2.5, 5, 5); });
    this.bots.forEach(bot => { if (!bot.active) return; context.fillStyle = this.duel && (this.duel.a === bot || this.duel.b === bot) ? '#ffb88b' : '#e2e5b5'; context.beginPath(); context.arc(px(bot.x), pz(bot.z), 2.5, 0, Math.PI * 2); context.fill(); });
    const goal = this.final ? this.finalGoal : this.duel?.goal;
    if (goal) { context.strokeStyle = '#ffd3aa'; context.lineWidth = 1.3; context.setLineDash([4, 4]); context.beginPath(); context.moveTo(px(this.player.x), pz(this.player.z)); context.lineTo(px(goal.x), pz(goal.z)); context.stroke(); context.setLineDash([]); context.fillStyle = '#ffa27a'; context.fillRect(px(goal.x) - 5, pz(goal.z) - 5, 10, 10); }
    context.save(); context.translate(px(this.player.x), pz(this.player.z)); context.rotate(-this.player.angle); context.fillStyle = '#ffb38b'; context.beginPath(); context.moveTo(0, -7); context.lineTo(5, 5); context.lineTo(0, 3); context.lineTo(-5, 5); context.closePath(); context.fill(); context.restore();
    context.font = '9px monospace'; context.fillStyle = '#b4c9a358'; context.textAlign = 'center'; context.fillText('AOKI VILLAGE', px(255), pz(-150)); context.fillText('MIRROR LAKE', px(-400), pz(172)); context.restore();
  }
}
