// ============================================================
// ep2/main.js — LAST CALL boot. Same robust plumbing as ep1
// (menu / play / pause / dead / ending state machine) rebuilt
// on the route-9 world: flat → drive → diner → freezer → dawn.
// Bilingual العربية/English + ten quality presets up to 4K.
// ============================================================
import * as THREE from 'three';
import { el, clamp } from '../src/utils.js';
import { buildTextures } from '../src/textures.js';
import { AudioEngine } from '../src/audio.js';
import { Effects, QUALITY_LABELS } from '../src/effects.js';
import { WorldE2 } from './world.js';
import { Player } from '../src/player.js';
import { Interact } from '../src/interact.js';
import { Phone } from '../src/phone.js';
import { UI } from '../src/ui.js';
import { Story, CHAPTERS, epLocked, epHasSave, epSaveCheckpoint } from './story.js';
import { Stalker, ValeWatcher } from '../src/ai.js';
import { PaleArm, Human } from '../src/npc.js';
import { loadSettings, saveSettings } from '../src/save.js';
import * as I18N from './i18n.js';

// ---------------- error overlay ----------------
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

// ---------------- input (identical contract to ep1) ----------------
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
    // episode 2 is Arabic-first; remember the player's own choice
    I18N.setLang(localStorage.getItem('lastcall_lang') || 'ar');
    this.state = 'boot';
    this.time = 0;
    this.T = buildTextures();

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, innerWidth / innerHeight, 0.05, 240);
    this.scene.add(this.camera);
    this.menuCam = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 300);

    this.audio = new AudioEngine(this.settings);
    this.effects = new Effects(this.renderer, this.scene, this.camera, this.settings);
    this.effects.setSize(innerWidth, innerHeight);

    this.world = new WorldE2(this);

    this.i18n = I18N;
    this.ui = new UI(this);
    this.phone = new Phone(this);
    this.player = new Player(this);
    this.effects.bindGame(this);
    this.interact = new Interact(this);
    this.story = new Story(this);
    this.stalker = new Stalker(this);
    this.vale = new ValeWatcher(this);
    this.ai = this.stalker;
    this.valeArm = new PaleArm(this.scene);
    this.npcLib = { Human };

    this.input = new Input(this, this.canvas);
    this.ui.bindMenus();
    this._wireEp2UI();
    I18N.applyDOM(this.settings);
    this.ui.setHudVisible(false);
    this._menuInit();

    addEventListener('resize', () => {
      this.effects.setSize(innerWidth, innerHeight);
      for (const c of [this.camera, this.menuCam]) { c.aspect = innerWidth / innerHeight; c.updateProjectionMatrix(); }
    });

    this.clock = new THREE.Clock();
    this.renderer.setAnimationLoop(() => this._loop());
    setTimeout(() => this.ui.fade(false, 1800), 250);
  }

  // menu background: a slow circle around the diner on Route 9
  _menuCam(t) {
    const a = t * 0.05;
    this.menuCam.position.set(-207 + Math.cos(a) * 20, 4.6 + Math.sin(a * 0.6) * 1.4, -10 + Math.sin(a) * 20);
    this.menuCam.lookAt(-207.5, 2.4, -2);
  }

  _wireEp2UI() {
    const s = this.settings;
    // language
    const langSel = el('sel-lang');
    if (langSel) {
      langSel.value = I18N.getLang();
      langSel.onchange = () => {
        I18N.setLang(langSel.value);
        s.lang = langSel.value;
        try { localStorage.setItem('lastcall_lang', langSel.value); } catch {}
        I18N.applyDOM(s);
        saveSettings(s);
        this.audio.latch('ui');
      };
    }
    // quality presets (ten, up to 4K)
    const qSel = el('sel-quality');
    if (qSel) {
      qSel.innerHTML = '';
      const arabic = ['منخفض جداً', 'منخفض', 'متوسط', 'عالي', 'عالي جداً', 'ألترا', 'إكستريم', 'ماكس', 'سوبر ماكس', '4K'];
      for (let i = 0; i < QUALITY_LABELS.length; i++) {
        const o = document.createElement('option');
        o.value = String(i);
        o.textContent = I18N.getLang() === 'ar' ? `${arabic[i]}` : QUALITY_LABELS[i];
        if (I18N.getLang() === 'ar') o.textContent += ` · ${QUALITY_LABELS[i]}`;
        qSel.appendChild(o);
      }
      qSel.value = String(clamp(s.quality ?? 3, 0, 9));
      qSel.onchange = () => {
        const q = clamp(parseInt(qSel.value, 10) || 3, 0, 9);
        s.quality = q;
        this.effects.setQuality(q);
        saveSettings(s);
        this.audio.latch('ui');
      };
    }
  }

  // ---------------- state transitions ----------------
  _menuInit() {
    this.state = 'menu';
    this.ui.show('menu');
    this.ui.setHudVisible(false);
    el('btn-continue').classList.toggle('hidden', !epHasSave());
    el('btn-chapters').classList.toggle('hidden', epLocked().length === 0 && !epHasSave());
  }

  newGame() {
    saveSettings(this.settings);
    this._beginPlay();
    this.story.newGame();
  }
  continueGame() {
    this._beginPlay();
    this.story.fromCheckpoint(epSaveCheckpoint());
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
    this.audio.chaseMusic(false);
    this.audio.heartbeat(0);
    this.audio.engineSet(false);
    this.audio.stopLoop('rain_home', 0.4); this.audio.stopLoop('rain_drive', 0.4);
    this.stalker.despawn();
    this.vale.setWatching(false);
    this.valeArm.hide();
    this.story.clearTimers();
    this.story._chaseOn = false;
    this.story._driveOn = false;
    this.world.props.driveRig.visible = false;
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
    const cp = this.story.checkpointId || 'home';
    this._beginPlay();
    this.story.fromCheckpoint(cp);
  }
  refreshChapters() {
    const cont = el('chapter-list');
    cont.innerHTML = '';
    const unlocked = epLocked();
    const done = unlocked.includes('credits');
    for (const c of CHAPTERS) {
      const d = document.createElement('div');
      const open = unlocked.includes(c.id) || c.id === 'home';
      d.className = 'ch-item' + (open ? '' : ' locked');
      d.innerHTML = `<span><span class="ch-time">${c.time}</span>${I18N.S(c.en, c.ar)}</span><span>${open ? '▶' : '·'}</span>`;
      if (open) d.onclick = () => { this.audio.latch('ui'); this.startChapter(c.id); };
      cont.appendChild(d);
    }
    if (done) {
      const n = document.createElement('div');
      n.className = 'help-tip'; n.style.marginTop = '10px';
      n.textContent = I18N.S('✓ shift closed — thank you for surviving Route 9', '✓ خسّلتي الوردية — شكراً على بقائك للرّوطة ٩');
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
      this._menuCam(this.time);
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
window.G = G;
