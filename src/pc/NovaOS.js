// ============================================================
// NovaOS.js — Desktop Operating System, StreamForge & Apps
// ============================================================

import { gameState } from '../core/GameState.js';
import { streamEngine } from '../streaming/StreamEngine.js';
import { soundEngine } from '../audio/SoundEngine.js';
import { VelocityRushGame } from './GameHub.js';
import { hardwareSystem, HARDWARE_CATALOG } from '../hardware/HardwareSystem.js';

export class NovaOS {
  constructor(playerController) {
    this.playerController = playerController;
    this.isOpen = false;
    this.activeWindow = 'streamforge'; // streamforge, gamehub, shop, benchmark, bank
    this.domElement = null;
    this.velocityRush = null;
    this.initDOM();
    this.bindEvents();
  }

  initDOM() {
    const wrap = document.createElement('div');
    wrap.id = 'novaos-overlay';
    wrap.className = 'os-hidden';
    wrap.innerHTML = `
      <div class="os-desktop">
        <!-- Desktop Shortcuts -->
        <div class="os-desktop-icons">
          <div class="os-icon" data-app="streamforge">
            <div class="icon-img icon-sf">📹</div>
            <span>StreamForge</span>
          </div>
          <div class="os-icon" data-app="gamehub">
            <div class="icon-img icon-gh">🎮</div>
            <span>GameHub</span>
          </div>
          <div class="os-icon" data-app="shop">
            <div class="icon-img icon-shop">🛒</div>
            <span>NovaMarket</span>
          </div>
          <div class="os-icon" data-app="benchmark">
            <div class="icon-img icon-bench">⚡</div>
            <span>Benchmark</span>
          </div>
          <div class="os-icon" data-app="bank">
            <div class="icon-img icon-bank">🏛️</div>
            <span>MetroVault</span>
          </div>
        </div>

        <!-- Window Container -->
        <div id="os-window-container" class="os-window-container">
          <!-- Active App Window Injected Here -->
        </div>

        <!-- Taskbar -->
        <div class="os-taskbar">
          <div class="os-start-btn">⊞ NOVA OS</div>
          <div class="os-taskbar-apps">
            <button class="os-tab active" data-app="streamforge">StreamForge</button>
            <button class="os-tab" data-app="gamehub">GameHub</button>
            <button class="os-tab" data-app="shop">NovaMarket</button>
            <button class="os-tab" data-app="benchmark">Benchmark</button>
          </div>
          <div class="os-system-tray">
            <span id="os-clock">08:30</span>
            <button id="btn-stand-up" class="stand-up-btn">🚶 Stand Up</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(wrap);
    this.domElement = wrap;
  }

  bindEvents() {
    gameState.on('satAtDesk', () => this.open());
    gameState.on('stoodUp', () => this.close());

    this.domElement.querySelectorAll('.os-icon, .os-tab').forEach(el => {
      el.addEventListener('click', () => {
        soundEngine.playKeyboard();
        const app = el.getAttribute('data-app');
        if (app) this.openApp(app);
      });
    });

    const standUpBtn = this.domElement.querySelector('#btn-stand-up');
    if (standUpBtn) {
      standUpBtn.addEventListener('click', () => {
        this.playerController.standUp();
      });
    }

    // Keyboard shortcut ESC to stand up if in OS
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.isOpen) {
        this.playerController.standUp();
      }
    });

    // Stream alerts connection
    streamEngine.onChatCallback = () => this.updateStreamForgeChat();
    streamEngine.onAlertCallback = (alert) => this.showStreamAlertBanner(alert);
  }

  open() {
    this.isOpen = true;
    this.domElement.classList.remove('os-hidden');
    this.domElement.classList.add('os-visible');
    soundEngine.playClick(0.15, 600);
    this.updateClock();
    this.openApp(this.activeWindow);
  }

  close() {
    this.isOpen = false;
    this.domElement.classList.remove('os-visible');
    this.domElement.classList.add('os-hidden');
    if (this.velocityRush) {
      this.velocityRush.stop();
      this.velocityRush = null;
    }
  }

  updateClock() {
    const clock = this.domElement.querySelector('#os-clock');
    if (clock) {
      const s = gameState.get();
      clock.innerText = `${String(s.gameTime.hour).padStart(2,'0')}:${String(s.gameTime.minute).padStart(2,'0')}`;
    }
  }

  openApp(appName) {
    this.activeWindow = appName;
    this.domElement.querySelectorAll('.os-tab').forEach(t => {
      t.classList.toggle('active', t.getAttribute('data-app') === appName);
    });

    if (this.velocityRush && appName !== 'gamehub') {
      this.velocityRush.stop();
      this.velocityRush = null;
    }

    const container = this.domElement.querySelector('#os-window-container');
    switch (appName) {
      case 'streamforge': this.renderStreamForge(container); break;
      case 'gamehub': this.renderGameHub(container); break;
      case 'shop': this.renderShop(container); break;
      case 'benchmark': this.renderBenchmark(container); break;
      case 'bank': this.renderBank(container); break;
    }
  }

  renderStreamForge(container) {
    const s = gameState.get();
    const isLive = streamEngine.isLive;

    container.innerHTML = `
      <div class="os-window streamforge-win">
        <div class="win-titlebar">
          <span>📹 StreamForge Pro Studio v3.4</span>
          <div class="win-controls"><span>—</span><span>□</span><span>✕</span></div>
        </div>
        <div class="win-content sf-layout">
          <!-- Left: Preview & Controls -->
          <div class="sf-main">
            <div class="sf-preview-box">
              <div class="sf-preview-screen ${isLive ? 'live' : ''}">
                ${isLive ? `
                  <div class="live-stream-overlay">
                    <span class="live-tag">● LIVE ${this.formatDuration(streamEngine.streamDuration)}</span>
                    <span class="live-viewers">👁️ ${streamEngine.currentViewers} Viewers</span>
                    <span class="live-game">🎮 ${streamEngine.activeGame}</span>
                  </div>
                  <div class="stream-cam-pip">Webcam Active</div>
                ` : `
                  <div class="preview-standby">
                    <div class="standby-logo">STREAMFORGE</div>
                    <p>Stream is currently offline. Configure settings and click GO LIVE.</p>
                  </div>
                `}
              </div>
            </div>

            <!-- Configuration & Actions -->
            <div class="sf-controls-row">
              ${!isLive ? `
                <div class="sf-field">
                  <label>Title</label>
                  <input type="text" id="sf-title-input" value="${streamEngine.streamTitle}" maxlength="60">
                </div>
                <div class="sf-field">
                  <label>Game</label>
                  <select id="sf-game-select">
                    <option value="Velocity Rush">Velocity Rush (Arcade Racer)</option>
                    <option value="BattleGrid">BattleGrid (Tactical Arena)</option>
                    <option value="Neon District">Neon District (Cyberpunk RPG)</option>
                  </select>
                </div>
                <div class="sf-field">
                  <label>Resolution</label>
                  <select id="sf-res-select">
                    <option value="720p 30fps">720p 30fps (Standard)</option>
                    <option value="1080p 60fps" ${s.pc.benchmarkScore > 1200 ? '' : 'disabled'}>1080p 60fps ${s.pc.benchmarkScore > 1200 ? '✓' : '(Requires GPU Upgrade)'}</option>
                    <option value="4K 60fps" ${s.pc.benchmarkScore > 3000 ? '' : 'disabled'}>4K 60fps ${s.pc.benchmarkScore > 3000 ? '✓' : '(Requires Flagship GPU)'}</option>
                  </select>
                </div>
                <button id="btn-go-live" class="btn-live-start">🔴 GO LIVE</button>
              ` : `
                <div class="live-action-buttons">
                  <button id="btn-engage-chat" class="sf-btn">💬 Engage Chat</button>
                  <button id="btn-hydrate" class="sf-btn">💧 Hydrate</button>
                  <button id="btn-open-game" class="sf-btn highlight">🎮 Play ${streamEngine.activeGame}</button>
                  <button id="btn-end-stream" class="btn-live-stop">⏹ End Stream</button>
                </div>
              `}
            </div>

            <!-- Stream Health Panel -->
            <div class="sf-health-bar">
              <span><b>FPS:</b> ${streamEngine.streamHealth.fps}</span>
              <span><b>Bitrate:</b> 4500 kbps</span>
              <span><b>Health:</b> ${streamEngine.streamHealth.status}</span>
              <span><b>Followers Today:</b> +${streamEngine.streamFollowers}</span>
              <span><b>Tips:</b> $${streamEngine.streamDonations.toFixed(2)}</span>
            </div>
          </div>

          <!-- Right: Live Chat -->
          <div class="sf-chat-panel">
            <div class="chat-header">PULSECAST STREAM CHAT</div>
            <div class="chat-messages" id="sf-chat-box">
              ${streamEngine.chatMessages.map(m => `
                <div class="chat-row">
                  ${m.badge ? `<span class="badge ${m.badge.toLowerCase()}">${m.badge}</span>` : ''}
                  <b style="color: ${m.color}">${m.author}:</b>
                  <span>${m.text}</span>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      </div>
    `;

    // Event listeners
    const goLiveBtn = container.querySelector('#btn-go-live');
    if (goLiveBtn) {
      goLiveBtn.addEventListener('click', () => {
        const title = container.querySelector('#sf-title-input').value;
        const game = container.querySelector('#sf-game-select').value;
        streamEngine.startStream(title, 'Gaming', game);
        this.renderStreamForge(container);
      });
    }

    const endStreamBtn = container.querySelector('#btn-end-stream');
    if (endStreamBtn) {
      endStreamBtn.addEventListener('click', () => {
        const report = streamEngine.endStream();
        this.showPostStreamReport(report);
        this.renderStreamForge(container);
      });
    }

    container.querySelector('#btn-engage-chat')?.addEventListener('click', () => {
      streamEngine.actionEngageAudience();
    });

    container.querySelector('#btn-hydrate')?.addEventListener('click', () => {
      streamEngine.actionHydrate();
    });

    container.querySelector('#btn-open-game')?.addEventListener('click', () => {
      this.openApp('gamehub');
    });
  }

  updateStreamForgeChat() {
    const chatBox = this.domElement.querySelector('#sf-chat-box');
    if (!chatBox) return;
    const s = streamEngine;
    const last = s.chatMessages[s.chatMessages.length - 1];
    if (last) {
      const row = document.createElement('div');
      row.className = 'chat-row';
      row.innerHTML = `
        ${last.badge ? `<span class="badge ${last.badge.toLowerCase()}">${last.badge}</span>` : ''}
        <b style="color: ${last.color}">${last.author}:</b>
        <span>${last.text}</span>
      `;
      chatBox.appendChild(row);
      chatBox.scrollTop = chatBox.scrollHeight;
    }
  }

  showStreamAlertBanner(alert) {
    const banner = document.createElement('div');
    banner.className = `stream-alert-popup ${alert.type}`;
    banner.innerHTML = alert.text;
    document.body.appendChild(banner);
    setTimeout(() => {
      banner.classList.add('fade-out');
      setTimeout(() => banner.remove(), 600);
    }, 4500);
  }

  showPostStreamReport(report) {
    if (!report) return;
    const modal = document.createElement('div');
    modal.className = 'analytics-modal';
    modal.innerHTML = `
      <div class="analytics-card">
        <h2>📊 STREAM SUMMARY</h2>
        <div class="report-grade">Grade: <span class="grade-${report.scoreGrade}">${report.scoreGrade}</span></div>
        <div class="report-grid">
          <div class="metric"><b>Duration:</b> ${this.formatDuration(report.durationSeconds)}</div>
          <div class="metric"><b>Peak Viewers:</b> ${report.peakViewers}</div>
          <div class="metric"><b>Avg Viewers:</b> ${report.avgViewers}</div>
          <div class="metric"><b>New Followers:</b> +${report.newFollowers}</div>
          <div class="metric"><b>Donations:</b> +$${report.donationsTotal.toFixed(2)}</div>
          <div class="metric"><b>Ad Revenue:</b> +$${report.adRevenue.toFixed(2)}</div>
        </div>
        <div class="report-total">Total Earned: <b>+$${report.totalEarnings.toFixed(2)}</b> (Deposited to MetroVault)</div>
        <div class="report-tips">
          <b>AI Coach Insights:</b>
          ${report.coachTips.map(t => `<p>• ${t}</p>`).join('')}
        </div>
        <button id="btn-close-report" class="btn-primary">Continue</button>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('#btn-close-report').addEventListener('click', () => {
      soundEngine.playClick(0.1, 700);
      modal.remove();
    });
  }

  renderGameHub(container) {
    container.innerHTML = `
      <div class="os-window gamehub-win">
        <div class="win-titlebar">
          <span>🎮 GameHub — Velocity Rush</span>
          <div class="win-controls"><span>—</span><span>□</span><span>✕</span></div>
        </div>
        <div class="win-content gh-layout">
          <div class="game-canvas-wrap">
            <canvas id="velocity-rush-canvas" width="400" height="480"></canvas>
            <div class="game-instructions">
              Controls: <b>[A / D]</b> or <b>[Left / Right Arrows]</b> to steer. Dodge red cars, collect green ⚡ lightning!
            </div>
          </div>
        </div>
      </div>
    `;

    const canvas = container.querySelector('#velocity-rush-canvas');
    if (canvas) {
      this.velocityRush = new VelocityRushGame(canvas);
      this.velocityRush.start();
    }
  }

  renderShop(container) {
    const s = gameState.get();
    container.innerHTML = `
      <div class="os-window shop-win">
        <div class="win-titlebar">
          <span>🛒 NovaMarket Hardware Store</span>
          <div class="win-controls"><span>—</span><span>□</span><span>✕</span></div>
        </div>
        <div class="win-content shop-layout">
          <div class="shop-bar">
            <span>Checking Balance: <b>$${s.player.bank.toFixed(2)}</b></span>
            <span>Priority Delivery to Apartment Door</span>
          </div>
          <div class="shop-items-grid">
            ${HARDWARE_CATALOG.map(item => `
              <div class="desktop-item-card">
                <div class="card-title">${item.name}</div>
                <div class="card-desc">${item.desc}</div>
                <div class="card-foot">
                  <span class="price">$${item.price.toFixed(2)}</span>
                  <button class="btn-buy-hw" data-id="${item.id}">Buy & Ship</button>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;

    container.querySelectorAll('.btn-buy-hw').forEach(b => {
      b.addEventListener('click', () => {
        const id = b.getAttribute('data-id');
        const item = HARDWARE_CATALOG.find(x => x.id === id);
        if (item) {
          hardwareSystem.orderComponent(item);
          this.renderShop(container);
        }
      });
    });
  }

  renderBenchmark(container) {
    const s = gameState.get();
    const score = s.pc.benchmarkScore;

    container.innerHTML = `
      <div class="os-window bench-win">
        <div class="win-titlebar">
          <span>⚡ Benchmark 3D Studio</span>
          <div class="win-controls"><span>—</span><span>□</span><span>✕</span></div>
        </div>
        <div class="win-content bench-layout">
          <div class="bench-hero">
            <div class="bench-score-circle">
              <span class="score-num">${score.toLocaleString()}</span>
              <span class="score-lbl">OVERALL SCORE</span>
            </div>
            <div class="bench-stats">
              <p><b>GPU:</b> ${s.pc.hardware.gpu ? s.pc.hardware.gpu.name : 'Integrated'}</p>
              <p><b>CPU:</b> ${s.pc.hardware.cpu ? s.pc.hardware.cpu.name : 'Unknown'}</p>
              <p><b>RAM:</b> ${s.pc.hardware.ram ? s.pc.hardware.ram.name : '8GB'}</p>
              <p><b>Cooling:</b> ${s.pc.hardware.cooler ? s.pc.hardware.cooler.name : 'Stock'}</p>
            </div>
          </div>
          <button id="btn-run-stress" class="btn-primary">Run 3D Stress Test</button>
          <div id="stress-log" class="stress-log">System Idle. Press Run to benchmark.</div>
        </div>
      </div>
    `;

    const runBtn = container.querySelector('#btn-run-stress');
    const log = container.querySelector('#stress-log');
    if (runBtn && log) {
      runBtn.addEventListener('click', () => {
        soundEngine.startPCHum(0.8);
        log.innerHTML = 'Testing GPU rasterization & ray tracing... [■■■□□□□□]';
        setTimeout(() => {
          log.innerHTML = 'Testing multi-core CPU encoding... [■■■■■■□□]';
        }, 1000);
        setTimeout(() => {
          log.innerHTML = `Benchmark Complete! Official Score: <b>${score.toLocaleString()} PTS</b>!`;
          soundEngine.stopPCHum();
          soundEngine.playFollowAlert();
        }, 2200);
      });
    }
  }

  renderBank(container) {
    const s = gameState.get();
    container.innerHTML = `
      <div class="os-window bank-win">
        <div class="win-titlebar">
          <span>🏛️ MetroVault Online Banking</span>
          <div class="win-controls"><span>—</span><span>□</span><span>✕</span></div>
        </div>
        <div class="win-content bank-layout">
          <div class="bank-top">
            <div class="balance-badge">
              <span>Checking Account</span>
              <h2>$${s.player.bank.toFixed(2)}</h2>
            </div>
          </div>
          <div class="bank-ledger">
            <b>Transaction History</b>
            ${s.transactions.map(t => `
              <div class="ledger-row ${t.type}">
                <span>${t.time}</span>
                <span>${t.desc}</span>
                <b>${t.amount >= 0 ? '+' : ''}$${Math.abs(t.amount).toFixed(2)}</b>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;
  }

  formatDuration(secs) {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }
}
