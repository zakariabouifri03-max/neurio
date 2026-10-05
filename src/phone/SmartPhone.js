// ============================================================
// SmartPhone.js — Smartphone UI, Apps, Social & Notifications
// ============================================================

import { gameState } from '../core/GameState.js';
import { soundEngine } from '../audio/SoundEngine.js';
import { hardwareSystem, HARDWARE_CATALOG } from '../hardware/HardwareSystem.js';

export class SmartPhone {
  constructor() {
    this.isOpen = false;
    this.currentApp = 'home'; // home, pulse, messages, bank, shop, gigs, weather, settings
    this.domElement = null;
    this.initDOM();
    this.bindEvents();
  }

  initDOM() {
    const wrap = document.createElement('div');
    wrap.id = 'smartphone-wrap';
    wrap.className = 'phone-hidden';
    wrap.innerHTML = `
      <div class="phone-frame">
        <div class="phone-notch">
          <div class="notch-speaker"></div>
          <div class="notch-camera"></div>
        </div>
        <div class="phone-statusbar">
          <span id="phone-clock">08:30</span>
          <div class="phone-status-icons">
            <span>5G</span>
            <span>📶</span>
            <span>🔋 96%</span>
          </div>
        </div>

        <div id="phone-screen" class="phone-screen">
          <!-- Dynamic App View injected here -->
        </div>

        <div class="phone-nav-bar">
          <button id="phone-home-btn" class="phone-pill-btn"></button>
        </div>
      </div>
    `;
    document.body.appendChild(wrap);
    this.domElement = wrap;
    this.renderHome();
  }

  bindEvents() {
    // Toggle phone on TAB key or Esc
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab') {
        e.preventDefault();
        this.toggle();
      } else if (e.code === 'Escape' && this.isOpen) {
        this.close();
      }
    });

    const homeBtn = this.domElement.querySelector('#phone-home-btn');
    if (homeBtn) {
      homeBtn.addEventListener('click', () => {
        soundEngine.playClick(0.1, 700);
        this.renderHome();
      });
    }

    gameState.on('notification', () => {
      this.updateBadge();
    });
  }

  toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  open() {
    this.isOpen = true;
    this.domElement.classList.remove('phone-hidden');
    this.domElement.classList.add('phone-visible');
    soundEngine.playNotification();
    this.updateClock();
    this.renderCurrentApp();
  }

  close() {
    this.isOpen = false;
    this.domElement.classList.remove('phone-visible');
    this.domElement.classList.add('phone-hidden');
    soundEngine.playClick(0.08, 450);
  }

  updateClock() {
    const clockEl = this.domElement.querySelector('#phone-clock');
    if (clockEl) {
      const s = gameState.get();
      const h = String(s.gameTime.hour).padStart(2, '0');
      const m = String(s.gameTime.minute).padStart(2, '0');
      clockEl.innerText = `${h}:${m}`;
    }
  }

  renderCurrentApp() {
    switch (this.currentApp) {
      case 'home': this.renderHome(); break;
      case 'pulse': this.renderPulse(); break;
      case 'messages': this.renderMessages(); break;
      case 'bank': this.renderBank(); break;
      case 'shop': this.renderShop(); break;
      case 'gigs': this.renderGigs(); break;
      case 'weather': this.renderWeather(); break;
      case 'settings': this.renderSettings(); break;
      default: this.renderHome();
    }
  }

  renderHome() {
    this.currentApp = 'home';
    const screen = this.domElement.querySelector('#phone-screen');
    const s = gameState.get();

    screen.innerHTML = `
      <div class="phone-home">
        <div class="home-widget">
          <div class="widget-time">${String(s.gameTime.hour).padStart(2, '0')}:${String(s.gameTime.minute).padStart(2, '0')}</div>
          <div class="widget-date">Day ${s.gameTime.day} • Metro City</div>
          <div class="widget-stats">
            <span>👥 ${s.career.followers.toLocaleString()} Followers</span>
            <span>💳 $${s.player.bank.toFixed(2)}</span>
          </div>
        </div>

        <div class="app-grid">
          <button class="app-icon" data-app="pulse">
            <div class="icon-box pulse-bg">💬</div>
            <span>Pulse</span>
          </button>
          <button class="app-icon" data-app="messages">
            <div class="icon-box msg-bg">✉️</div>
            <span>Messages</span>
          </button>
          <button class="app-icon" data-app="bank">
            <div class="icon-box bank-bg">🏛️</div>
            <span>MetroVault</span>
          </button>
          <button class="app-icon" data-app="shop">
            <div class="icon-box shop-bg">🛒</div>
            <span>NovaMarket</span>
          </button>
          <button class="app-icon" data-app="gigs">
            <div class="icon-box gigs-bg">💼</div>
            <span>GigWork</span>
          </button>
          <button class="app-icon" data-app="weather">
            <div class="icon-box weather-bg">☀️</div>
            <span>Weather</span>
          </button>
          <button class="app-icon" data-app="settings">
            <div class="icon-box settings-bg">⚙️</div>
            <span>Settings</span>
          </button>
        </div>

        <div class="home-notif-drawer">
          <div class="drawer-header">Recent Alerts</div>
          ${s.notifications.slice(0, 3).map(n => `
            <div class="mini-notif">
              <b>${n.title}</b>
              <p>${n.body}</p>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    screen.querySelectorAll('.app-icon').forEach(btn => {
      btn.addEventListener('click', () => {
        soundEngine.playClick(0.1, 800);
        this.currentApp = btn.getAttribute('data-app');
        this.renderCurrentApp();
      });
    });
  }

  renderPulse() {
    const screen = this.domElement.querySelector('#phone-screen');
    const s = gameState.get();

    screen.innerHTML = `
      <div class="phone-app-view">
        <div class="app-header">
          <button class="back-btn">‹</button>
          <h2>PULSE</h2>
          <button id="pulse-post-btn" class="action-btn">Post</button>
        </div>
        <div class="pulse-compose" id="pulse-compose-box" style="display:none;">
          <input type="text" id="pulse-input" placeholder="What's happening?" maxlength="120">
          <button id="pulse-send-btn">Share</button>
        </div>
        <div class="pulse-feed">
          ${s.pulseFeed.map(post => `
            <div class="pulse-card">
              <div class="card-author"><b>${post.author}</b> <span>${post.handle} • ${post.time}</span></div>
              <div class="card-text">${post.text}</div>
              <div class="card-actions">
                <span>❤️ ${post.likes}</span>
                <span>🔄 48</span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    screen.querySelector('.back-btn').addEventListener('click', () => this.renderHome());

    const composeBox = screen.querySelector('#pulse-compose-box');
    screen.querySelector('#pulse-post-btn').addEventListener('click', () => {
      composeBox.style.display = composeBox.style.display === 'none' ? 'flex' : 'none';
    });

    screen.querySelector('#pulse-send-btn')?.addEventListener('click', () => {
      const input = screen.querySelector('#pulse-input');
      if (input && input.value.trim().length > 0) {
        const text = input.value.trim();
        // Viral chance calculation
        const likes = 40 + Math.floor(Math.random() * (s.career.followers + 50));
        const newFollowers = Math.floor(likes * 0.15);
        s.pulseFeed.unshift({
          id: Date.now(),
          author: s.career.channelName,
          handle: '@' + s.career.channelName,
          text,
          likes,
          time: 'Just now'
        });
        s.career.followers += newFollowers;
        soundEngine.playNotification();
        gameState.addNotification('Pulse Post Shared!', `Your post got ${likes} likes and gained ${newFollowers} new followers!`);
        this.renderPulse();
      }
    });
  }

  renderMessages() {
    const screen = this.domElement.querySelector('#phone-screen');
    screen.innerHTML = `
      <div class="phone-app-view">
        <div class="app-header">
          <button class="back-btn">‹</button>
          <h2>Messages</h2>
        </div>
        <div class="msg-list">
          <div class="msg-thread">
            <div class="avatar">👩</div>
            <div class="thread-info">
              <b>Mom</b>
              <p>Proud of you sweetie! Remember to eat healthy meals.</p>
            </div>
          </div>
          <div class="msg-thread">
            <div class="avatar">🔧</div>
            <div class="thread-info">
              <b>Dave (PC Tech)</b>
              <p>Hey! Upgrading your GPU will drastically improve your stream bitrate and FPS.</p>
            </div>
          </div>
          <div class="msg-thread">
            <div class="avatar">💼</div>
            <div class="thread-info">
              <b>NovaMarket Logistics</b>
              <p>Your packages are delivered directly to your apartment doorstep.</p>
            </div>
          </div>
        </div>
      </div>
    `;
    screen.querySelector('.back-btn').addEventListener('click', () => this.renderHome());
  }

  renderBank() {
    const screen = this.domElement.querySelector('#phone-screen');
    const s = gameState.get();
    screen.innerHTML = `
      <div class="phone-app-view">
        <div class="app-header">
          <button class="back-btn">‹</button>
          <h2>METROVAULT</h2>
        </div>
        <div class="bank-card">
          <div class="card-label">CURRENT CHECKING BALANCE</div>
          <div class="card-balance">$${s.player.bank.toFixed(2)}</div>
          <div class="card-meta">Physical Cash on Hand: $${s.player.cash.toFixed(2)}</div>
        </div>
        <div class="bank-section-title">RECENT TRANSACTIONS</div>
        <div class="transaction-list">
          ${s.transactions.map(t => `
            <div class="tx-row">
              <div class="tx-desc">
                <b>${t.desc}</b>
                <span>${t.time}</span>
              </div>
              <div class="tx-amount ${t.type}">
                ${t.amount >= 0 ? '+' : ''}$${Math.abs(t.amount).toFixed(2)}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
    screen.querySelector('.back-btn').addEventListener('click', () => this.renderHome());
  }

  renderShop() {
    const screen = this.domElement.querySelector('#phone-screen');
    const s = gameState.get();

    screen.innerHTML = `
      <div class="phone-app-view">
        <div class="app-header">
          <button class="back-btn">‹</button>
          <h2>NovaMarket</h2>
        </div>
        <div class="shop-balance-bar">Bank: $${s.player.bank.toFixed(2)}</div>
        <div class="shop-list">
          ${HARDWARE_CATALOG.map(item => `
            <div class="shop-item-card">
              <div class="item-title"><b>${item.name}</b></div>
              <div class="item-desc">${item.desc}</div>
              <div class="item-foot">
                <span class="price">$${item.price.toFixed(2)}</span>
                <button class="buy-btn" data-id="${item.id}">Order</button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    screen.querySelector('.back-btn').addEventListener('click', () => this.renderHome());

    screen.querySelectorAll('.buy-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        const item = HARDWARE_CATALOG.find(x => x.id === id);
        if (item) {
          hardwareSystem.orderComponent(item);
          this.renderShop();
        }
      });
    });
  }

  renderGigs() {
    const screen = this.domElement.querySelector('#phone-screen');
    screen.innerHTML = `
      <div class="phone-app-view">
        <div class="app-header">
          <button class="back-btn">‹</button>
          <h2>GigWork</h2>
        </div>
        <div class="gig-list">
          <div class="gig-card">
            <b>📦 Warehouse Parcel Sorting</b>
            <p>Sort parcels by postal code. Takes 2 in-game hours.</p>
            <div class="gig-foot">
              <span class="pay">+$50.00</span>
              <button class="work-btn" data-type="warehouse">Work Shift</button>
            </div>
          </div>
          <div class="gig-card">
            <b>☕ Pulse Cafe Barista</b>
            <p>Brew espresso and serve customers. Takes 2 in-game hours.</p>
            <div class="gig-foot">
              <span class="pay">+$45.00</span>
              <button class="work-btn" data-type="cafe">Work Shift</button>
            </div>
          </div>
          <div class="gig-card">
            <b>💻 PC Tech Support Gig</b>
            <p>Diagnose and clean virus infections. Takes 3 in-game hours.</p>
            <div class="gig-foot">
              <span class="pay">+$75.00</span>
              <button class="work-btn" data-type="pc">Work Shift</button>
            </div>
          </div>
        </div>
      </div>
    `;

    screen.querySelector('.back-btn').addEventListener('click', () => this.renderHome());

    screen.querySelectorAll('.work-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const type = btn.getAttribute('data-type');
        let pay = 50;
        let jobName = 'Warehouse';
        if (type === 'cafe') { pay = 45; jobName = 'Cafe Barista'; }
        if (type === 'pc') { pay = 75; jobName = 'PC Tech'; }

        soundEngine.playCashRegister();
        gameState.addCash(pay, `${jobName} Gig Shift`);
        gameState.modifyNeeds({ energy: -20, hunger: -15, thirst: -15 });

        // Advance 2 hours
        const s = gameState.get();
        s.gameTime.hour = (s.gameTime.hour + 2) % 24;

        gameState.addNotification('Shift Completed!', `Completed ${jobName} shift. Earned $${pay}.00 cash!`);
        this.renderGigs();
      });
    });
  }

  renderWeather() {
    const screen = this.domElement.querySelector('#phone-screen');
    const s = gameState.get();
    screen.innerHTML = `
      <div class="phone-app-view">
        <div class="app-header">
          <button class="back-btn">‹</button>
          <h2>Weather</h2>
        </div>
        <div class="weather-display">
          <div class="w-icon">${s.gameTime.weather === 'rain' ? '🌧️' : '☀️'}</div>
          <div class="w-temp">22°C</div>
          <div class="w-condition">${s.gameTime.weather.toUpperCase()}</div>
          <div class="w-loc">Metro City, Downtown</div>
        </div>
      </div>
    `;
    screen.querySelector('.back-btn').addEventListener('click', () => this.renderHome());
  }

  renderSettings() {
    const screen = this.domElement.querySelector('#phone-screen');
    screen.innerHTML = `
      <div class="phone-app-view">
        <div class="app-header">
          <button class="back-btn">‹</button>
          <h2>Settings</h2>
        </div>
        <div class="settings-list">
          <button id="btn-save-game" class="setting-btn">💾 Save Game</button>
          <button id="btn-reset-game" class="setting-btn danger">⚠️ Reset Save Data</button>
          <div class="debug-section">
            <b>Developer Cheats</b>
            <button id="cheat-money" class="cheat-btn">+$500 Bank</button>
            <button id="cheat-followers" class="cheat-btn">+250 Followers</button>
            <button id="cheat-needs" class="cheat-btn">Max All Needs</button>
          </div>
        </div>
      </div>
    `;

    screen.querySelector('.back-btn').addEventListener('click', () => this.renderHome());

    screen.querySelector('#btn-save-game')?.addEventListener('click', () => {
      gameState.save();
      soundEngine.playNotification();
      gameState.addNotification('Game Saved', 'Progress saved successfully.');
    });

    screen.querySelector('#btn-reset-game')?.addEventListener('click', () => {
      if (confirm('Are you sure you want to reset your save file?')) {
        gameState.reset();
        window.location.reload();
      }
    });

    screen.querySelector('#cheat-money')?.addEventListener('click', () => {
      gameState.addBank(500, 'Dev Cheat');
      soundEngine.playCashRegister();
    });

    screen.querySelector('#cheat-followers')?.addEventListener('click', () => {
      gameState.get().career.followers += 250;
      soundEngine.playMilestoneFanfare();
      gameState.emit('followersChanged', gameState.get().career.followers);
    });

    screen.querySelector('#cheat-needs')?.addEventListener('click', () => {
      gameState.modifyNeeds({ hunger: 100, thirst: 100, energy: 100, hygiene: 100, stress: -100 });
      soundEngine.playNotification();
    });
  }

  updateBadge() {}
}
