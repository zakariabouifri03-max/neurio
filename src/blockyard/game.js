import * as THREE from 'three';
import { newSave, loadSave, writeSave, createPlayer, stepPlayer, advanceCheckpoint, collectCoin, finishRun, touchesHazard, STAGES, OUTFITS, clamp } from './rules.js';
import { createWorld } from './world.js';
import { avatar, animateAvatar, setOutfit, label, mat } from './models.js';
import { exportRaft } from '../raft/export.js';
import { UI } from './ui.js';

const $ = id => document.getElementById(id);
const STEP = 1 / 60;
class Sounds {
  constructor() { this.enabled = false; this.context = null; }
  async enable(value) {
    this.enabled = value;
    if (value) { this.context ||= new (window.AudioContext || window.webkitAudioContext)(); await this.context.resume(); }
  }
  play(type) {
    if (!this.enabled || !this.context || this.context.state !== 'running') return;
    const context = this.context, now = context.currentTime;
    const notes = { coin: [800, 1100], jump: [280, 440], 'double-jump': [440, 660], checkpoint: [520, 660, 800], bounce: [240, 700], win: [520, 660, 780, 1040], respawn: [230, 180], click: [500] }[type] || [350];
    notes.forEach((frequency, i) => {
      const oscillator = context.createOscillator(), gain = context.createGain(), start = now + i * .075;
      oscillator.type = type.includes('jump') || type === 'bounce' ? 'triangle' : 'sine'; oscillator.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(0, start); gain.gain.linearRampToValueAtTime(.055, start + .012); gain.gain.exponentialRampToValueAtTime(.001, start + .18);
      oscillator.connect(gain); gain.connect(context.destination); oscillator.start(start); oscillator.stop(start + .2);
    });
  }
}

class Blockyard {
  constructor() {
    try { this.storage = localStorage; } catch { this.storage = { getItem() { return null; }, setItem() { throw new Error('Storage unavailable'); } }; }
    this.state = loadSave(this.storage); this.player = createPlayer(this.state.checkpoint);
    this.simTime = 0; this.visualTime = 0; this.accumulator = 0; this.saveTimer = 0; this.uiTimer = 0; this.invincible = .6;
    this.keys = new Set(); this.touch = new THREE.Vector2(); this.jumpQueued = false; this.paused = false; this.particles = [];
    this.yaw = this.targetYaw = .32; this.pitch = this.targetPitch = .52; this.distance = this.targetDistance = innerWidth < 600 ? 26 : 21.5;
    this.cameraTarget = new THREE.Vector3(this.player.x, this.player.y + 1.35, this.player.z - 1.5);
    this.cameraGoal = new THREE.Vector3(); this.desiredCamera = new THREE.Vector3(); this.vector = new THREE.Vector3();
    this.pointers = new Map(); this.reducedMotion = matchMedia('(prefers-reduced-motion:reduce)').matches;
    this.audio = new Sounds(); this.audio.enabled = this.state.sound;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, this.state.quality === 'high' ? 1.7 : 1)); this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = this.state.quality !== 'low'; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.tabIndex = 0; this.renderer.domElement.setAttribute('aria-label', '3D blocky obstacle course. WASD to move, Space to jump twice, drag to look.'); $('game').append(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, .1, 650);
    this.world = createWorld(); this.scene = this.world.scene;
    this.character = avatar(this.state.outfit); this.character.position.set(this.player.x, this.player.y, this.player.z); this.character.rotation.y = this.player.heading; this.scene.add(this.character);
    const name = label('YOU', { width: 1.0, height: .35, fg: '#6e865d', bg: '#ffffffdb', size: 168 }); name.position.y = 3.35; this.character.add(name);
    this.particleGeometry = new THREE.BoxGeometry(.10, .10, .10);
    this.particleMaterials = ['#f2ce70', '#b1d877', '#89c3dc', '#d2ace4', '#f4a589'].map(color => mat(color));
    this.ui = new UI(this); this.bind(); this.updateCamera(1); this.resize();
    this.clock = new THREE.Clock(); this.renderer.setAnimationLoop(() => this.frame());
    requestAnimationFrame(() => requestAnimationFrame(() => { $('loading').classList.add('loaded'); $('game').dataset.ready = 'true'; }));
    if (this.state.checkpoint || this.state.started) this.ui.toast(`Welcome back to ${STAGES[this.state.checkpoint].name}.`, 'flag');
  }
  bind() {
    const canvas = this.renderer.domElement;
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('keydown', e => this.keyDown(e));
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.clearInput());
    window.addEventListener('pagehide', () => this.save());
    document.addEventListener('visibilitychange', () => { if (document.hidden) { this.save(); this.clearInput(); if (!this.ui.modal) this.ui.open('pause'); } });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); this.setPaused(true); this.renderer.setAnimationLoop(null); $('error-message').textContent = 'The graphics connection was interrupted. Reload to return to your saved checkpoint.'; $('recovery').hidden = false; });
    canvas.addEventListener('pointerdown', e => {
      if (this.ui.modal) return;
      canvas.focus({ preventScroll: true }); canvas.setPointerCapture(e.pointerId); this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 2) this.pinchDistance = this.pointerDistance();
      canvas.style.cursor = 'grabbing';
    });
    canvas.addEventListener('pointermove', e => {
      if (!this.pointers.has(e.pointerId) || this.ui.modal) return;
      const old = this.pointers.get(e.pointerId); this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size >= 2) { const distance = this.pointerDistance(); this.targetDistance = clamp(this.targetDistance * this.pinchDistance / distance, innerWidth < 600 ? 17 : 10, 35); this.pinchDistance = distance; }
      else { this.targetYaw -= (e.clientX - old.x) * .006; this.targetPitch = clamp(this.targetPitch + (e.clientY - old.y) * .004, .18, 1.12); }
    });
    const release = e => { this.pointers.delete(e.pointerId); if (!this.pointers.size) canvas.style.cursor = 'grab'; };
    canvas.addEventListener('pointerup', release); canvas.addEventListener('pointercancel', release); canvas.addEventListener('lostpointercapture', release);
    canvas.addEventListener('wheel', e => { e.preventDefault(); if (!this.ui.modal) this.targetDistance = clamp(this.targetDistance + e.deltaY * .012, innerWidth < 600 ? 17 : 10, 35); }, { passive: false });
    const joystick = $('joystick'); let id = null;
    const move = e => {
      if (id !== e.pointerId) return;
      const rect = joystick.getBoundingClientRect(), reach = rect.width * .31;
      this.touch.set((e.clientX - rect.left - rect.width / 2) / reach, (e.clientY - rect.top - rect.height / 2) / reach);
      if (this.touch.length() > 1) this.touch.normalize();
      $('joystick-knob').style.transform = `translate(${this.touch.x * reach}px,${this.touch.y * reach}px)`;
    };
    joystick.addEventListener('pointerdown', e => { if (this.paused) return; e.preventDefault(); id = e.pointerId; joystick.setPointerCapture(id); move(e); });
    joystick.addEventListener('pointermove', move);
    const end = e => { if (e.pointerId === id) { id = null; this.touch.set(0, 0); $('joystick-knob').style.transform = ''; } };
    joystick.addEventListener('pointerup', end); joystick.addEventListener('pointercancel', end); joystick.addEventListener('lostpointercapture', end);
    $('jump-button').addEventListener('pointerdown', e => { e.preventDefault(); if (!this.paused) { this.jumpQueued = true; this.unlockAudio(); } });
    $('respawn-button').onclick = () => { if (!this.paused) this.respawn(false); };
  }
  pointerDistance() { const [a, b] = [...this.pointers.values()]; return a && b ? Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) : 1; }
  clearInput() { this.keys.clear(); this.touch.set(0, 0); this.pointers.clear(); this.jumpQueued = false; $('joystick-knob').style.transform = ''; }
  keyDown(e) {
    if (e.target.matches('input,textarea,select,[contenteditable]')) return;
    if (e.code === 'Escape') { e.preventDefault(); this.ui.modal ? this.ui.close() : this.ui.open('pause'); return; }
    if (this.ui.modal) return;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    if (/^(Key[WASD]|Arrow(Up|Down|Left|Right)|Shift(Left|Right))$/.test(e.code)) this.keys.add(e.code);
    if (e.repeat) return;
    if (e.code === 'Space') this.jumpQueued = true;
    if (e.code === 'KeyR') this.respawn(false);
    if (e.code === 'KeyH') this.ui.open('help');
    if (['Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) this.unlockAudio();
  }
  unlockAudio() { if (this.state.sound && !this.audio.context) this.audio.enable(true).catch(() => { this.state.sound = false; this.audio.enabled = false; this.ui.update(); }); }
  input() {
    const key = code => this.keys.has(code) ? 1 : 0;
    const horizontal = key('KeyD') + key('ArrowRight') - key('KeyA') - key('ArrowLeft') + this.touch.x;
    const forward = key('KeyW') + key('ArrowUp') - key('KeyS') - key('ArrowDown') - this.touch.y;
    const result = { x: Math.cos(this.yaw) * horizontal - Math.sin(this.yaw) * forward, z: -Math.sin(this.yaw) * horizontal - Math.cos(this.yaw) * forward, sprint: !!(key('ShiftLeft') || key('ShiftRight')), jump: this.jumpQueued };
    this.jumpQueued = false; return result;
  }
  step(dt) {
    const oldTime = this.simTime; this.simTime += dt; this.invincible = Math.max(0, this.invincible - dt);
    const input = this.input();
    if (Math.hypot(input.x, input.z) > .05 || input.jump) this.state.started = true;
    if (this.state.started && !this.state.won) this.state.elapsed += dt;
    const platforms = this.world.colliders(this.simTime, oldTime);
    const events = stepPlayer(this.player, input, platforms, dt);
    for (const event of events) {
      if (['jump', 'double-jump', 'bounce'].includes(event)) { this.audio.play(event); this.burst(this.player.x, this.player.y + .2, this.player.z, event === 'bounce' ? 12 : 5, event === 'double-jump' ? 2.5 : 1.0); }
    }
    if (this.player.y < -19 || (this.invincible <= 0 && touchesHazard(this.player, this.simTime))) { this.respawn(true); return; }
    if (this.player.grounded) {
      const surface = platforms.find(p => p.id === this.player.support);
      if (surface?.stage > this.state.checkpoint + 1 && this.simTime > (this.skipHintUntil || 0)) {
        this.skipHintUntil = this.simTime + 8; this.ui.toast(`Find ${STAGES[this.state.checkpoint + 1].name} first. R returns to your checkpoint.`, 'map');
      }
      if (surface?.stage != null && advanceCheckpoint(this.state, surface.stage)) {
        this.audio.play('checkpoint'); this.ui.toast(`Checkpoint ${surface.stage + 1}! ${STAGES[surface.stage].name}.`, 'flag');
        this.burst(this.player.x, this.player.y + 1.3, this.player.z, 30, 4.5); this.save(); this.ui.update();
      }
    }
    if (this.state.started) for (const coin of this.world.coins) {
      if (this.state.collected.includes(coin.id)) continue;
      const platform = coin.platform ? platforms.find(p => p.id === coin.platform) : null;
      const x = platform?.x ?? coin.x;
      if (Math.hypot(this.player.x - x, this.player.y + 1.25 - coin.y, this.player.z - coin.z) < 1.15 && collectCoin(this.state, coin.id)) {
        coin.model.visible = false; this.audio.play('coin'); this.burst(x, coin.y, coin.z, 7, 1.8); this.ui.update(); this.save();
        if (this.state.collected.length === this.world.coins.length) this.ui.toast('A pocketful of sunshine. Every sky coin collected!', 'coin');
      }
    }
    const final = STAGES.at(-1);
    if (this.player.grounded && this.player.support === 'island-5' && Math.abs(this.player.x - final.x) < 2.6 && this.player.z < final.z - 2.0 && finishRun(this.state)) {
      this.audio.play('win'); this.burst(this.player.x, this.player.y + 3, this.player.z, 65, 6); this.save(); this.ui.update(); this.ui.open('win');
    }
    this.saveTimer += dt; if (this.saveTimer > 4) { this.saveTimer = 0; this.save(); }
  }
  burst(x, y, z, count, force) {
    if (this.reducedMotion) return;
    for (let i = 0; i < count; i++) {
      const object = new THREE.Mesh(this.particleGeometry, this.particleMaterials[i % this.particleMaterials.length]); object.position.set(x, y, z); object.scale.setScalar(.6 + Math.random() * .9); this.scene.add(object);
      this.particles.push({ object, vx: (Math.random() - .5) * force, vy: 1.8 + Math.random() * force, vz: (Math.random() - .5) * force, life: .55 + Math.random() * .7 });
    }
  }
  respawn(failed = true) {
    if (this.state.started && !this.state.won) this.state.deaths++;
    Object.assign(this.player, createPlayer(this.state.checkpoint)); this.invincible = .9; this.clearInput();
    this.cameraTarget.set(this.player.x, this.player.y + 1.35, this.player.z - 1.5); this.character.position.set(this.player.x, this.player.y, this.player.z);
    this.audio.play('respawn'); this.ui.toast(failed ? 'A little tumble. A fresh start. You’ve got this!' : `Back to ${STAGES[this.state.checkpoint].name}.`, 'reset');
    this.save(); this.ui.update();
  }
  restart() {
    const { outfit, sound, quality, best } = this.state;
    this.state = { ...newSave(), outfit, sound, quality, best }; this.simTime = 0; this.accumulator = 0; this.invincible = 1;
    Object.assign(this.player, createPlayer()); this.resetCamera(); this.clearInput(); this.save(); this.ui.update(true);
    this.world.update(this.simTime, this.visualTime, this.state, this.player); this.ui.toast('A whole new sky. Let’s make it a good one.', 'spark');
  }
  updateCamera(dt) {
    const blend = 1 - Math.exp(-9 * dt);
    this.yaw += (this.targetYaw - this.yaw) * blend; this.pitch += (this.targetPitch - this.pitch) * blend; this.distance += (this.targetDistance - this.distance) * blend;
    this.cameraGoal.set(this.player.x, this.player.y + 1.35, this.player.z - 1.5);
    this.cameraTarget.lerp(this.cameraGoal, 1 - Math.exp(-8 * dt));
    const horizontal = Math.cos(this.pitch) * this.distance;
    this.camera.position.set(this.cameraTarget.x + Math.sin(this.yaw) * horizontal, this.cameraTarget.y + Math.sin(this.pitch) * this.distance, this.cameraTarget.z + Math.cos(this.yaw) * horizontal);
    this.camera.lookAt(this.cameraTarget); this.camera.updateMatrixWorld();
  }
  resetCamera() {
    this.targetYaw = this.yaw = .32; this.targetPitch = this.pitch = .52; this.targetDistance = this.distance = innerWidth < 600 ? 26 : 21.5;
    this.cameraTarget.set(this.player.x, this.player.y + 1.35, this.player.z - 1.5); this.updateCamera(1);
  }
  renderAvatarPreview() {
    if (this.ui.modal !== 'avatar') return;
    const container = $('avatar-preview'); if (!container) return;
    if (!this.preview) {
      try {
        const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true }); renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5)); renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.08;
        const scene = new THREE.Scene(); scene.add(new THREE.HemisphereLight('#ffffff', '#adc090', 2.6));
        const sun = new THREE.DirectionalLight('#fff3d8', 3); sun.position.set(-3, 5, 6); scene.add(sun);
        const model = avatar(this.state.outfit); scene.add(model);
        const floor = new THREE.Mesh(new THREE.CylinderGeometry(1.65, 1.65, .12, 48), mat('#e3edcd')); floor.position.y = -.08; scene.add(floor);
        const camera = new THREE.PerspectiveCamera(34, 1, .1, 30); camera.position.set(3.7, 3.0, 6.6); camera.lookAt(0, 1.45, 0);
        this.preview = { renderer, scene, model, camera, width: 0, height: 0 };
        renderer.domElement.setAttribute('aria-label', 'Your original blocky character in 3D');
      } catch { container.textContent = 'Your outfit is ready in the game. You can still download the 3D model.'; return; }
    }
    const p = this.preview; if (p.renderer.domElement.parentNode !== container) container.append(p.renderer.domElement);
    const rect = container.getBoundingClientRect(), w = Math.round(rect.width), h = Math.round(rect.height);
    if (!w || !h) return;
    if (w !== p.width || h !== p.height) { p.width = w; p.height = h; p.renderer.setSize(w, h); p.camera.aspect = w / h; p.camera.updateProjectionMatrix(); }
    p.model.rotation.y = .24 + Math.sin(this.visualTime * .43) * .32;
    animateAvatar(p.model, this.visualTime, 0, false); p.renderer.render(p.scene, p.camera);
  }
  frame() {
    const delta = Math.min(this.clock.getDelta(), .10); this.visualTime += delta;
    if (!this.paused && !document.hidden) {
      this.accumulator += delta;
      while (this.accumulator >= STEP && !this.paused) { this.step(STEP); this.accumulator -= STEP; }
    } else this.accumulator = 0;
    this.world.update(this.simTime, this.visualTime, this.state, this.player);
    const speed = this.paused ? 0 : Math.hypot(this.player.vx, this.player.vz);
    this.character.position.set(this.player.x, this.player.y + (this.player.grounded ? Math.sin(this.visualTime * 26) * .025 * Math.min(1, speed / 7) : 0), this.player.z);
    const angle = this.player.heading - this.character.rotation.y;
    this.character.rotation.y += Math.atan2(Math.sin(angle), Math.cos(angle)) * (1 - Math.exp(-15 * delta));
    animateAvatar(this.character, this.visualTime, speed, !this.player.grounded, this.player.vy);
    this.updateCamera(delta);
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]; p.life -= delta; p.vy -= 7 * delta; p.object.position.x += p.vx * delta; p.object.position.y += p.vy * delta; p.object.position.z += p.vz * delta;
      p.object.rotation.x += delta * 3; p.object.rotation.z += delta * 2;
      if (p.life < .2) p.object.scale.setScalar(Math.max(.01, p.life * 4));
      if (p.life <= 0) { p.object.removeFromParent(); this.particles.splice(i, 1); }
    }
    this.uiTimer += delta; if (this.uiTimer > .13) { this.uiTimer = 0; this.ui.update(); }
    this.renderer.render(this.scene, this.camera); this.renderAvatarPreview();
  }
  setPaused(value) { this.paused = value; this.clearInput(); this.accumulator = 0; if (value) this.save(); }
  resize() { this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); this.renderer.setSize(innerWidth, innerHeight); }
  changeOutfit(outfit) {
    if (!Object.hasOwn(OUTFITS, outfit)) return;
    this.state.outfit = outfit; setOutfit(this.character, outfit); if (this.preview) setOutfit(this.preview.model, outfit); this.audio.play('click'); this.save(); this.ui.update();
  }
  async toggleSound() {
    this.state.sound = !this.state.sound;
    try { await this.audio.enable(this.state.sound); this.audio.play('click'); }
    catch { this.state.sound = false; this.audio.enabled = false; this.ui.toast('Sound isn’t available in this browser.', 'help'); }
    this.save(); this.ui.update();
  }
  toggleQuality() {
    this.state.quality = this.state.quality === 'high' ? 'low' : 'high'; this.renderer.shadowMap.enabled = this.state.quality === 'high';
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, this.state.quality === 'high' ? 1.7 : 1)); this.save();
  }
  save() { const ok = writeSave(this.storage, this.state); $('save-status').textContent = ok ? 'Your progress is saved right here.' : 'Playing without a save · storage unavailable'; return ok; }
  screenPosition(position) { this.vector.set(position.x, position.y, position.z).project(this.camera); return { x: (this.vector.x + 1) * innerWidth / 2, y: (-this.vector.y + 1) * innerHeight / 2, z: this.vector.z }; }
  async exportModel(kind = 'avatar') {
    const isWorld = kind === 'world', model = isWorld ? this.world.root : avatar(this.state.outfit);
    return exportRaft(model, { filename: isWorld ? 'blockyard-cloud-hop.glb' : 'blockyard-avatar.glb', title: isWorld ? 'Blockyard — Cloud Hop world' : `Blockyard adventurer — ${OUTFITS[this.state.outfit].name}`, generator: 'Blockyard — original procedural parkour playground' });
  }
}

async function start() {
  try {
    await document.fonts.ready;
    window.BLOCKY = new Blockyard();
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !document.documentElement.dataset.standalone) navigator.serviceWorker.register('./sw.js').catch(() => {});
  } catch (error) {
    console.error('Blockyard could not start:', error); $('loading').classList.add('loaded'); $('recovery').hidden = false;
  }
}
start();
