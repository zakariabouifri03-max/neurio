// ============================================================
// UIOverlay.js — Minimalistic Modern HUD, Reticle & Alerts
// ============================================================

import { gameState } from '../core/GameState.js';
import { soundEngine } from '../audio/SoundEngine.js';

export class UIOverlay {
  constructor() {
    this.domElement = null;
    this.promptEl = null;
    this.toastContainer = null;
    this.initDOM();
    this.bindEvents();
  }

  initDOM() {
    const wrap = document.createElement('div');
    wrap.id = 'hud-overlay';
    wrap.innerHTML = `
      <!-- Center Crosshair & Interaction Prompt -->
      <div class="reticle-container">
        <div class="reticle-dot"></div>
        <div id="interaction-prompt" class="interaction-prompt"></div>
      </div>

      <!-- Top Right Status Header -->
      <div class="top-status-header">
        <div class="hud-chip time-chip">
          <span id="hud-clock">08:30</span>
          <span id="hud-day">Day 1</span>
        </div>
        <div class="hud-chip weather-chip">
          <span id="hud-weather">☀️ Clear</span>
        </div>
        <div class="hud-chip stats-chip">
          <span>👥 <b id="hud-followers">12</b></span>
          <span>💳 <b id="hud-bank">$73.00</b></span>
          <span>💵 <b id="hud-cash">$15.00</b></span>
        </div>
        <button id="btn-phone-hud" class="hud-icon-btn" title="Open Smartphone (TAB)">📱</button>
      </div>

      <!-- Bottom Left Needs Gauges -->
      <div class="bottom-needs-container">
        <div class="need-row">
          <span class="need-icon">🍖</span>
          <div class="need-bar-bg"><div id="bar-hunger" class="need-bar-fill" style="width:75%"></div></div>
        </div>
        <div class="need-row">
          <span class="need-icon">💧</span>
          <div class="need-bar-bg"><div id="bar-thirst" class="need-bar-fill" style="width:80%"></div></div>
        </div>
        <div class="need-row">
          <span class="need-icon">⚡</span>
          <div class="need-bar-bg"><div id="bar-energy" class="need-bar-fill" style="width:85%"></div></div>
        </div>
        <div class="need-row">
          <span class="need-icon">🧼</span>
          <div class="need-bar-bg"><div id="bar-hygiene" class="need-bar-fill" style="width:80%"></div></div>
        </div>
        <div class="need-row">
          <span class="need-icon">😊</span>
          <div class="need-bar-bg"><div id="bar-mood" class="need-bar-fill mood" style="width:85%"></div></div>
        </div>
      </div>

      <!-- Bottom Center Holding Item Indicator -->
      <div id="hud-holding" class="hud-holding-badge" style="display:none;"></div>

      <!-- Bottom Right Toast Notifications -->
      <div id="toast-container" class="toast-container"></div>

      <!-- Debug Panel (Toggle with F1 or ~) -->
      <div id="debug-panel" class="debug-panel" style="display:none;">
        <div class="debug-head">
          <b>🛠️ DEVELOPER STUDIO DEBUG</b>
          <button id="btn-close-debug">✕</button>
        </div>
        <div class="debug-actions">
          <button id="dbg-cash">+$1,000 Bank</button>
          <button id="dbg-foll">+500 Followers</button>
          <button id="dbg-needs">Max Needs</button>
          <button id="dbg-time">+2 Hours</button>
          <button id="dbg-pkg">Spawn Package</button>
          <button id="dbg-rain">Toggle Rain</button>
          <button id="dbg-reset" class="danger">Reset Save</button>
        </div>
      </div>
    `;
    document.body.appendChild(wrap);
    this.domElement = wrap;
    this.promptEl = wrap.querySelector('#interaction-prompt');
    this.toastContainer = wrap.querySelector('#toast-container');
  }

  bindEvents() {
    gameState.on('interactionPrompt', (text) => {
      if (text) {
        this.promptEl.innerHTML = text;
        this.promptEl.style.display = 'block';
      } else {
        this.promptEl.style.display = 'none';
      }
    });

    gameState.on('notification', (notif) => {
      this.showToast(notif.title, notif.body);
    });

    gameState.on('timeTick', (t) => {
      const clockEl = this.domElement.querySelector('#hud-clock');
      const dayEl = this.domElement.querySelector('#hud-day');
      if (clockEl) clockEl.innerText = `${String(t.hour).padStart(2,'0')}:${String(t.minute).padStart(2,'0')}`;
      if (dayEl) dayEl.innerText = `Day ${t.day}`;
    });

    gameState.on('weatherChanged', (w) => {
      const wEl = this.domElement.querySelector('#hud-weather');
      if (wEl) wEl.innerText = (w === 'rain' ? '🌧️ Rain' : '☀️ Clear');
    });

    gameState.on('needsChanged', (needs) => {
      this.updateNeeds(needs);
    });

    gameState.on('bankChanged', (val) => {
      const el = this.domElement.querySelector('#hud-bank');
      if (el) el.innerText = `$${val.toFixed(2)}`;
    });

    gameState.on('cashChanged', (val) => {
      const el = this.domElement.querySelector('#hud-cash');
      if (el) el.innerText = `$${val.toFixed(2)}`;
    });

    gameState.on('holdingChanged', (holding) => {
      const badge = this.domElement.querySelector('#hud-holding');
      if (holding) {
        badge.style.display = 'block';
        if (holding.type === 'package') {
          badge.innerHTML = `📦 Carrying Package: <b>${holding.data.item.name}</b> (Press [E] to Open)`;
        } else if (holding.type === 'food') {
          badge.innerHTML = `🍴 Holding Food: <b>${holding.data.name}</b> (Press [E] to Eat)`;
        }
      } else {
        badge.style.display = 'none';
      }
    });

    const phoneBtn = this.domElement.querySelector('#btn-phone-hud');
    if (phoneBtn) {
      phoneBtn.addEventListener('click', () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Tab' }));
      });
    }

    // Toggle debug panel with F1 or ~
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F1' || e.code === 'Backquote') {
        e.preventDefault();
        const p = this.domElement.querySelector('#debug-panel');
        p.style.display = p.style.display === 'none' ? 'block' : 'none';
      }
    });

    this.bindDebugButtons();
  }

  bindDebugButtons() {
    const p = this.domElement.querySelector('#debug-panel');
    p.querySelector('#btn-close-debug').addEventListener('click', () => { p.style.display = 'none'; });

    p.querySelector('#dbg-cash').addEventListener('click', () => {
      gameState.addBank(1000, 'Developer Debug');
      soundEngine.playCashRegister();
    });

    p.querySelector('#dbg-foll').addEventListener('click', () => {
      gameState.get().career.followers += 500;
      soundEngine.playMilestoneFanfare();
      this.updateStats();
    });

    p.querySelector('#dbg-needs').addEventListener('click', () => {
      gameState.modifyNeeds({ hunger: 100, thirst: 100, energy: 100, hygiene: 100, stress: -100 });
      soundEngine.playNotification();
    });

    p.querySelector('#dbg-time').addEventListener('click', () => {
      const s = gameState.get();
      s.gameTime.hour = (s.gameTime.hour + 2) % 24;
      gameState.emit('timeTick', s.gameTime);
    });

    p.querySelector('#dbg-pkg').addEventListener('click', () => {
      const s = gameState.get();
      s.packages.push({
        id: 'dbg_' + Date.now(),
        sender: 'NOVAMARKET',
        item: { id: 'gpu_rtx4080', type: 'gpu', name: 'RTX Nova 4080 Extreme', score: 3800, maxRes: '4K 60fps' },
        location: 'doorstep'
      });
      gameState.addNotification('Debug Package Spawned', 'RTX Nova 4080 package spawned at doorstep!');
      soundEngine.playNotification();
    });

    p.querySelector('#dbg-rain').addEventListener('click', () => {
      const s = gameState.get();
      const next = s.gameTime.weather === 'rain' ? 'clear' : 'rain';
      s.gameTime.weather = next;
      gameState.emit('weatherChanged', next);
      if (next === 'rain') soundEngine.startRain(); else soundEngine.stopRain();
    });

    p.querySelector('#dbg-reset').addEventListener('click', () => {
      if (confirm('Reset save file and restart?')) {
        gameState.reset();
        window.location.reload();
      }
    });
  }

  updateNeeds(needs) {
    const bh = this.domElement.querySelector('#bar-hunger');
    const bt = this.domElement.querySelector('#bar-thirst');
    const be = this.domElement.querySelector('#bar-energy');
    const by = this.domElement.querySelector('#bar-hygiene');
    const bm = this.domElement.querySelector('#bar-mood');

    if (bh) bh.style.width = `${needs.hunger}%`;
    if (bt) bt.style.width = `${needs.thirst}%`;
    if (be) be.style.width = `${needs.energy}%`;
    if (by) by.style.width = `${needs.hygiene}%`;
    if (bm) bm.style.width = `${needs.mood}%`;
  }

  updateStats() {
    const s = gameState.get();
    const foll = this.domElement.querySelector('#hud-followers');
    const bank = this.domElement.querySelector('#hud-bank');
    const cash = this.domElement.querySelector('#hud-cash');
    if (foll) foll.innerText = s.career.followers.toLocaleString();
    if (bank) bank.innerText = `$${s.player.bank.toFixed(2)}`;
    if (cash) cash.innerText = `$${s.player.cash.toFixed(2)}`;
  }

  showToast(title, body) {
    const toast = document.createElement('div');
    toast.className = 'hud-toast';
    toast.innerHTML = `
      <b>${title}</b>
      <p>${body}</p>
    `;
    this.toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 400);
    }, 4000);
  }
}
