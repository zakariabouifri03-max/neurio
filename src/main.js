// ============================================================
// main.js — boot, shared game context (G), input, state machine
// (menu / play / pause / dead / ending) and the main loop.
// ============================================================
import * as THREE from 'three';
import { el, clamp } from './utils.js';
import { buildTextures } from './textures.js';
import { AudioEngine } from './audio.js';
import { Effects } from './effects.js';
import { World } from './world.js';
import { applyWorldMixins } from './world2.js';
import { Player } from './player.js';
import { Interact } from './interact.js';
import { Phone } from './phone.js';
import { UI } from './ui.js';
import { Story, CHAPTERS } from './story.js';
import { Stalker, ValeWatcher } from './ai.js';
import { PaleArm } from './npc.js';
import { loadSettings, saveSettings, loadSave, hasSave, loadUnlocked } from './save.js';

// ---------------- error overlay (dev aid) ----------------
window.addEventListener('error', (e) => {
  const err = el('err');
  err.classList.remove('hidden');
  err.textContent += `⚠ ${e.message}\n  @ ${(e.filename || '').split('/').pop()}:${e.lineno}\n`;
});
window.addEventListener('unhandledrejection', (e) => {
  const err = el('err');
  err.classList.remove('hidden');
  err.textContent += `⚠ promise: ${e.reason && e.reason.message || e.reason}\n`;
});

// ---------------- input ----------------
class Input {
  constructor(G, canvas) {
    this.G = G;
    this.held = new Set();
    this.pressedSet = new Set();
    this.dx = 0; this.dy = 0;
    this.locked = false;
    this.fallbackLook = false;

    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (k === 'tab') e.preventDefault();
      if (!e.repeat) this.pressedSet.add(this._norm(k, e.code));
      this.held.add(this._norm(k, e.code));
      this._hotkeys(k, e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.held.delete(this._norm(e.key.toLowerCase(), e.code));
    });
    window.addEventListener('mousedown', (e) => {
      if (G.state === 'play' && !this.locked && !G.player.hidden) this._requestLock();
      this._mouseDown = true;
    });
    window.addEventListener('mouseup', () => this._mouseDown = false);
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      el('lock-hint').classList.toggle('hidden', this.locked || G.state !== 'play' || G.phone.up);
    });
    window.addEventListener('mousemove', (e) => {
      if (this.locked) { this.dx += e.movementX; this.dy += e.movementY; }
      else if (this._mouseDown && this.fallbackLook && G.state === 'play') { this.dx += e.movementX; this.dy += e.movementY; }
    });
    canvas.addEventListener('click', () => {
      if (G.state === 'play' && !this.locked && !G.phone.up) this._requestLock();
    });
  }
  _norm(k, code) {
    if (code === 'ShiftLeft' || code === 'ShiftRight') return 'shift';
    if (code === 'ControlLeft' || code === 'ControlRight') return 'control';
    return k;
  }
  _requestLock() {
    const canvas = this.G.canvas;
    try {
      const p = canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => { try { canvas.requestPointerLock(); } catch { this.fallbackLook = true; } });
    } catch { try { canvas.requestPointerLock(); } catch { this.fallbackLook = true; } }
    el('lock-hint').classList.add('hidden');
  }
  _hotkeys(k, code) {
    const G = this.G;
    if (G.state === 'play') {
      if (code === 'Escape') { if (!G.phone.up) G.pauseGame(); return; }
      if (k === 'e') G.interact.onUse();
      if (k === 'g') G.player.throwHeld();
      if (k === 'f') G.player.toggleFlash();
      if (k === 't' || k === 'tab') G.phone.toggle();
      if (k === '1') G.ui.pickChoice(1);
      if (k === '2') G.ui.pickChoice(2);
    } else if (G.state === 'pause') {
      if (code === 'Escape') G.resumeGame();
    }
  }
  key(k) { return this.held.has(k); }
  pressed(k) { return this.pressedSet.has(k); }
  consumeLook() { const r = [this.dx, this.dy]; this.dx = 0; this.dy = 0; return r; }
  endFrame() { this.pressedSet.clear(); }
}

// ---------------- game ----------------
class Game {
  constructor() {
    this.canvas = el('scene');
    this.settings = loadSettings();
    this.state = 'boot';
    this.time = 0;
    this.T = buildTextures();

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, innerWidth / innerHeight, 0.05, 220);
    this.scene.add(this.camera);
    this.menuCam = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 300);

    this.audio = new AudioEngine(this.settings);
    this.effects = new Effects(this.renderer, this.scene, this.camera, this.settings);
    this.effects.setSize(innerWidth, innerHeight);

    applyWorldMixins(World);
    this.world = new World(this);

    this.ui = new UI(this);
    this.phone = new Phone(this);
    this.player = new Player(this);
    this.interact = new Interact(this);
    this.story = new Story(this);
    this.stalker = new Stalker(this);
    this.vale = new ValeWatcher(this);
    this.ai = this.stalker;           // hearNoise target
    this.valeArm = new PaleArm(this.scene);

    this.input = new Input(this, this.canvas);
    this.ui.bindMenus();
    this.ui.setHudVisible(false);
    this._menuInit();

    addEventListener('resize', () => {
      this.effects.setSize(innerWidth, innerHeight);
      for (const c of [this.camera, this.menuCam]) { c.aspect = innerWidth / innerHeight; c.updateProjectionMatrix(); }
    });

    this.clock = new THREE.Clock();
    this.renderer.setAnimationLoop(() => this._loop());
    // hide initial fader
    setTimeout(() => this.ui.fade(false, 1800), 250);
  }

  // ---------------- state transitions ----------------
  _menuInit() {
    this.state = 'menu';
    this.ui.show('menu');
    this.ui.setHudVisible(false);
    el('btn-continue').classList.toggle('hidden', !hasSave());
    el('btn-chapters').classList.toggle('hidden', loadUnlocked().length === 0 && !hasSave());
  }

  newGame() {
    saveSettings(this.settings);
    this._beginPlay();
    this.story.newGame();
  }
  continueGame() {
    const s = loadSave();
    this._beginPlay();
    this.story.fromCheckpoint(s ? s.checkpoint : 'shift');
  }
  startChapter(id) {
    this._beginPlay();
    this.story.fromCheckpoint(id);
  }
  _beginPlay() {
    this.state = 'play';
    this.ui.hideAllScreens();
    this.ui.setHudVisible(true);
    this.ui.fade(true, 0);
    setTimeout(() => this.ui.fade(false, 1600), 60);
    this.input._requestLock();
  }
  pauseGame() {
    if (this.state !== 'play') return;
    this.state = 'pause';
    this.phone.close();
    this.ui.show('pause');
    if (document.pointerLockElement) document.exitPointerLock();
  }
  resumeGame() {
    if (this.state !== 'pause') return;
    this.state = 'play';
    this.ui.hideAllScreens();
    if (!this.phone.up) this.input._requestLock();
  }
  quitToMenu() {
    // stop night sounds + scripts
    this.audio.chaseMusic(false);
    this.audio.heartbeat(0);
    this.stalker.despawn();
    this.vale.setWatching(false);
    this.valeArm.hide();
    this.story.clearTimers();
    this.story._chaseOn = false;
    this.ui.letterbox(false);
    this.phone.close();
    this.ui.clearSubtitles();
    this.player.frozen = false;
    this.player.hidden = null;
    this.effects.vignetteBoost(0.85);
    this._menuInit();
    this.ui.fade(false, 600);
  }
  retryCheckpoint() {
    const cp = this.story.checkpointId || 'shift';
    this._beginPlay();
    this.story.fromCheckpoint(cp);
  }
  refreshChapters() {
    const cont = el('chapter-list');
    cont.innerHTML = '';
    const unlocked = loadUnlocked();
    const done = unlocked.includes('credits');
    for (const c of CHAPTERS) {
      const d = document.createElement('div');
      const open = unlocked.includes(c.id) || c.id === 'shift';
      d.className = 'ch-item' + (open ? '' : ' locked');
      d.innerHTML = `<span><span class="ch-time">${c.time}</span>${c.title}</span><span>${open ? '▶' : '·'}</span>`;
      if (open) d.onclick = () => { this.audio.latch('ui'); this.startChapter(c.id); };
      cont.appendChild(d);
    }
    if (done) {
      const n = document.createElement('div');
      n.className = 'help-tip'; n.style.marginTop = '10px';
      n.textContent = '✓ shift completed — thank you for surviving';
      cont.appendChild(n);
    }
  }

  // ---------------- loop ----------------
  _loop() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.time += dt;
    const [ldx, ldy] = this.input.consumeLook();

    if (this.state === 'play') {
      if (!this.phone.up) this.player.applyLook(ldx, ldy);
      this.player.update(dt, this.input);
      this.stalker.update(dt);
      this.vale.update(dt);
      this.story.update(dt);
      this.interact.update();
      this.phone.update(dt);
      this.world.update(dt);
      this.audio.update();
      this.ui.update(dt);
      this.audio.updateListener(
        this.camera.getWorldPosition(new THREE.Vector3()),
        new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion)
      );
    } else if (this.state === 'menu') {
      // slow cinematic drift around the dark motel
      const t = this.time * 0.045;
      this.menuCam.position.set(Math.cos(t) * 30 + 4, 5.2 + Math.sin(t * 0.7) * 1.2, Math.sin(t) * 30 - 8);
      this.menuCam.lookAt(2, 2.2, -1);
      this.world.update(dt * 0.5);
    } else if (this.state === 'pause') {
      this.ui.update(dt * 0.2);
    }

    this.effects.render(dt, this.time, this.state === 'menu' ? this.menuCam : this.camera);
    this.input.endFrame();
  }
}

// boot
const G = new Game();
window.G = G; // console debugging
