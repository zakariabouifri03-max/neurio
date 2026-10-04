// ---------- in-game PC desktop: OPS, Zamazor shop, Virus Scanner, Wallpapers ----------
import { el, fmt$, stars } from './util.js';
import { CATS, ITEMS, itemById, STREAM_CATS } from './data.js';
import { sClick, sBack, sBuy, sErr, sNotify } from './audio.js';

const WALLS = [
  'linear-gradient(160deg,#0e3a5c,#1d6fa8 60%,#7ec8e3)',
  'linear-gradient(160deg,#3a0e4c,#7a1d8a 60%,#e37ed4)',
  'linear-gradient(160deg,#0e5c2a,#1da858 60%,#7ee3a4)',
  'linear-gradient(160deg,#5c3a0e,#a86a1d 60%,#e3c07e)',
];

export class PC {
  constructor(root, save, hooks) {
    this.root = root; this.save = save; this.hooks = hooks;
    this.wins = {}; this.zTop = 10;
    this.basket = [];
    this.live = false;
    this.virus = false;
    this.build();
  }

  build() {
    const r = this.root;
    r.innerHTML = '';
    r.style.display = 'none';
    this.desktop = el('div', 'pc-desktop'); r.appendChild(this.desktop);
    this.winLayer = el('div', 'pc-winlayer'); r.appendChild(this.winLayer);
    // desktop icons
    const icons = [['💻', 'Computer', 'ops'], ['🌐', 'Web', 'web'], ['🛡️', 'Virus Scanner', 'virus'], ['🖼️', 'Wallpapers', 'wall']];
    for (const [em, label, app] of icons) {
      const ic = el('div', 'pc-icon', `<div class="ic">${em}</div><div>${label}</div>`);
      ic.onpointerdown = () => { sClick(); this.open(app); };
      this.desktop.appendChild(ic);
    }
    // taskbar
    this.taskbar = el('div', 'pc-taskbar');
    this.taskbar.innerHTML = `<div class="tb-start">🖥️ Z-OS</div>`;
    this.tbApps = el('div', 'tb-apps'); this.taskbar.appendChild(this.tbApps);
    this.clock = el('div', 'tb-clock'); this.taskbar.appendChild(this.clock);
    this.powerBtn = el('div', 'tb-power', '⏻');
    this.powerBtn.title = 'Shut down';
    this.powerBtn.onpointerdown = () => { sBack(); this.close(); };
    this.taskbar.appendChild(this.powerBtn);
    r.appendChild(this.taskbar);
    this.setWallpaper(this.save.wallpaper || 0);
  }

  setWallpaper(i) {
    this.save.wallpaper = i;
    this.desktop.style.background = WALLS[i % WALLS.length];
  }

  show() { this.root.style.display = 'block'; }
  close() { this.root.style.display = 'none'; if (this.hooks.onPC) this.hooks.onPC(false); }

  setClock(mins) {
    const h = Math.floor(mins / 60) % 24, m = Math.floor(mins % 60);
    this.clock.textContent = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }

  setVirus(v) { this.virus = v; if (this.wins.virus) this.renderVirusBody(); }
  setLive(l) { this.live = l; if (this.wins.ops) this.renderOpsBody(); }

  // ---------- window manager ----------
  makeWin(app, title, icon, w, h) {
    if (this.wins[app]) { this.focus(this.wins[app]); return this.wins[app]; }
    const win = el('div', 'pcwin');
    win.style.width = w + 'px'; win.style.height = h + 'px';
    win.style.left = (40 + Object.keys(this.wins).length * 46) + 'px';
    win.style.top = (30 + Object.keys(this.wins).length * 34) + 'px';
    const tb = el('div', 'pcwin-tb', `<span class="wi">${icon}</span> <span>${title}</span>`);
    const btns = el('div', 'pcwin-btns', `<button class="wb min">–</button><button class="wb close">✕</button>`);
    tb.appendChild(btns);
    win.appendChild(tb);
    const body = el('div', 'pcwin-body'); win.appendChild(body);
    this.winLayer.appendChild(win);
    const rec = { app, win, body, tb, minimized: false };
    this.wins[app] = rec;
    // drag
    let drag = null;
    tb.onpointerdown = (e) => {
      if (e.target.closest('.wb')) return;
      this.focus(rec);
      drag = { x: e.clientX - win.offsetLeft, y: e.clientY - win.offsetTop };
      tb.setPointerCapture(e.pointerId);
    };
    tb.onpointermove = (e) => {
      if (!drag) return;
      win.style.left = Math.max(-100, e.clientX - drag.x) + 'px';
      win.style.top = Math.max(0, Math.min(innerHeight - 80, e.clientY - drag.y)) + 'px';
    };
    tb.onpointerup = () => drag = null;
    btns.querySelector('.close').onpointerdown = () => { sBack(); win.remove(); delete this.wins[app]; this.syncTaskbar(); };
    btns.querySelector('.min').onpointerdown = () => { sClick(); win.style.display = 'none'; rec.minimized = true; this.syncTaskbar(); };
    win.onpointerdown = () => this.focus(rec);
    this.syncTaskbar();
    this.focus(rec);
    return rec;
  }
  focus(rec) { rec.win.style.zIndex = ++this.zTop; }

  syncTaskbar() {
    this.tbApps.innerHTML = '';
    const names = { ops: 'OPS', web: 'Web', virus: 'Virus Scanner', wall: 'Wallpapers' };
    const icons = { ops: '📡', web: '🌐', virus: '🛡️', wall: '🖼️' };
    for (const app in this.wins) {
      const b = el('button', 'tb-app', `${icons[app]} ${names[app]}`);
      b.onpointerdown = () => {
        sClick();
        const rec = this.wins[app];
        if (rec.minimized) { rec.win.style.display = 'flex'; rec.minimized = false; this.focus(rec); }
        else this.focus(rec);
      };
      this.tbApps.appendChild(b);
    }
  }

  open(app) {
    this.show();
    if (app === 'ops') this.openOps();
    if (app === 'web') this.openWeb();
    if (app === 'virus') this.openVirus();
    if (app === 'wall') this.openWall();
  }
  openWin(app) { this.open(app); }

  // ---------- OPS streaming app ----------
  equippedScore() { return this.hooks.getScore(); }

  openOps() {
    const rec = this.makeWin('ops', 'OPS — Open Streaming Platform', '📡', 430, 470);
    this.renderOpsBody(rec);
  }

  renderOpsBody(rec = this.wins.ops) {
    if (!rec) return;
    const s = this.save;
    const score = this.equippedScore();
    const maxQ = score >= 30 ? ['480p', '720p', '1080p', '4K'] : score >= 14 ? ['480p', '720p', '1080p'] : score >= 6 ? ['480p', '720p'] : ['480p'];
    const b = rec.body;
    b.innerHTML = `
      <div class="ops">
        <div class="ops-row"><span>🔑 Stream Key:</span><b>${(s.settings.name + '-key-8675309').slice(0, 18)}</b></div>
        <div class="ops-row"><span>👤 Nickname:</span><b>${s.settings.name}</b></div>
        <div class="ops-row"><span>📶 Bitrate:</span>
          <input type="range" min="500" max="8000" step="100" value="${this.hooks.getBitrate()}" id="ops-br">
          <b id="ops-brv">${this.hooks.getBitrate()} kbps</b></div>
        <div class="ops-row"><span>🎭 Category:</span>
          <select id="ops-cat">${STREAM_CATS.map(c => `<option ${this.hooks.getCat() === c[0] ? 'selected' : ''}>${c[0]}</option>`).join('')}</select></div>
        <div class="ops-row"><span>🎛️ Quality:</span>
          <select id="ops-q">${maxQ.map(q => `<option ${this.hooks.getQuality() === q ? 'selected' : ''}>${q}</option>`).join('')}</select></div>
        <div class="ops-row"><span>🔊 Sound Quality:</span><b>${this.hooks.getMicKbps()} kbps</b></div>
        <div class="ops-live ${this.live ? 'on' : ''}">
          <div class="ops-live-dot">${this.live ? '● LIVE' : '○ OFFLINE'}</div>
          <div>👁️ <b id="ops-viewers">0</b> viewers</div>
          <div>❤️ <b id="ops-fol">${Math.floor(s.followers)}</b> followers</div>
        </div>
        <button class="ops-go ${this.live ? 'stop' : ''}" id="ops-go">${this.live ? '■ STOP STREAMING' : '▶ START STREAMING'}</button>
        <div class="ops-note">Better PC + mic + router = more viewers & money.</div>
      </div>`;
    b.querySelector('#ops-br').oninput = (e) => { this.hooks.setBitrate(+e.target.value); b.querySelector('#ops-brv').textContent = e.target.value + ' kbps'; };
    b.querySelector('#ops-cat').onchange = (e) => { sClick(); this.hooks.setCat(e.target.value); };
    b.querySelector('#ops-q').onchange = (e) => { sClick(); this.hooks.setQuality(e.target.value); };
    b.querySelector('#ops-go').onpointerdown = () => {
      if (this.hooks.hasVirus() && !this.live) { sErr(); this.hooks.toast('⚠️ Your PC has a virus! Clean it before going live.'); return; }
      this.hooks.toggleStream();
    };
    this.updateOpsStats();
  }

  updateOpsStats() {
    if (!this.wins.ops) return;
    const b = this.wins.ops.body;
    const st = this.hooks.getStats();
    const v = b.querySelector('#ops-viewers'), f = b.querySelector('#ops-fol');
    if (v) v.textContent = Math.floor(st.viewers);
    if (f) f.textContent = Math.floor(st.followers);
  }

  // ---------- Zamazor web shop ----------
  openWeb() {
    const rec = this.makeWin('web', 'Web — Zamazor', '🌐', 760, 520);
    this.cat = this.cat || 'mon';
    this.renderWeb(rec);
  }

  renderWeb(rec = this.wins.web) {
    if (!rec) return;
    const b = rec.body;
    b.innerHTML = `
      <div class="web">
        <div class="web-bar"><span class="web-url">🌐 weeb://www.zamazor.com/market.spp</span><span class="web-money">${fmt$(this.save.money)}</span></div>
        <div class="web-main">
          <div class="web-cats">${CATS.map(c => `<button data-c="${c[0]}" class="${c[0] === this.cat ? 'on' : ''}">${c[1]} ${c[2]}</button>`).join('')}</div>
          <div class="web-grid" id="web-grid"></div>
          <div class="web-basket">
            <div class="wbk-t">🛒 Basket ($<span id="bk-total">0</span>)</div>
            <div class="wbk-items" id="bk-items"></div>
            <button class="wbk-buy" id="bk-buy">Complete Purchase</button>
          </div>
        </div>
      </div>`;
    b.querySelectorAll('.web-cats button').forEach(btn => btn.onpointerdown = () => { sClick(); this.cat = btn.dataset.c; this.renderWeb(); });
    const grid = b.querySelector('#web-grid');
    const cols = ['#2aa', '#c33', '#83c', '#c6c', '#c83', '#3a6'];
    ITEMS.filter(i => i.cat === this.cat).forEach((it, ix) => {
      const owned = this.save.ownedItems.includes(it.id);
      const card = el('div', 'witem', `
        <div class="wimg" style="background:${cols[ix % 6]}">${{ cpu: '🧠', gpu: '🎮', ram: '💾', hdd: '💽', cooler: '❄️', mon: '🖥️', mic: '🎙️', kb: '⌨️', mouse: '🖱️', chair: '🪑', desk: '🪵', router: '📶', lamp: '💡' }[it.cat]}</div>
        <div class="wstars">${stars(it.stars)}</div>
        <div class="wname">${it.name}</div>
        <div class="wdesc">${it.desc}</div>
        <div class="wprice">${fmt$(it.price)}</div>
        <button class="wadd" ${owned ? 'disabled' : ''}>${owned ? '✓ OWNED' : 'Add to basket!'}</button>`);
      if (!owned) card.querySelector('.wadd').onpointerdown = () => {
        sClick();
        if (!this.basket.includes(it.id)) this.basket.push(it.id);
        this.renderBasket();
      };
      grid.appendChild(card);
    });
    this.renderBasket();
  }

  renderBasket() {
    const b = this.wins.web && this.wins.web.body;
    if (!b) return;
    const items = b.querySelector('#bk-items');
    items.innerHTML = this.basket.map(id => {
      const it = itemById(id);
      return `<div class="wbk-it">${it.name} <b>${fmt$(it.price)}</b> <button data-id="${id}" class="wbk-x">✕</button></div>`;
    }).join('') || '<div class="wbk-empty">Basket is empty</div>';
    items.querySelectorAll('.wbk-x').forEach(x => x.onpointerdown = () => { sBack(); this.basket = this.basket.filter(i => i !== x.dataset.id); this.renderBasket(); });
    b.querySelector('#bk-total').textContent = this.basket.reduce((a, id) => a + itemById(id).price, 0);
    b.querySelector('#bk-buy').onpointerdown = () => {
      if (!this.basket.length) { sErr(); return; }
      const total = this.basket.reduce((a, id) => a + itemById(id).price, 0);
      if (total > this.save.money) { sErr(); this.hooks.toast('❌ Not enough money! Go stream more.'); return; }
      for (const id of this.basket) this.hooks.onBuy(id);
      this.basket = [];
      sBuy();
      this.renderWeb();
    };
  }

  // ---------- Virus scanner ----------
  openVirus() {
    const rec = this.makeWin('virus', 'Virus Scanner', '🛡️', 380, 430);
    this.renderVirusBody(rec);
  }

  renderVirusBody(rec = this.wins.virus) {
    if (!rec) return;
    const b = rec.body;
    b.innerHTML = `
      <div class="vir">
        <div class="vir-t">Viruses & Malware</div>
        <div class="vir-sub">Don't worry, we will help you with your problems!</div>
        <div class="vir-circle" id="vir-c">${this.virus ? '⚠️' : '✅'}</div>
        <div id="vir-status">${this.virus ? '<b style="color:#c22">1 threat found: c.debug.router.backup</b>' : 'Your PC is clean.'}</div>
        <button class="vir-btn" id="vir-scan">START SCANNING</button>
        <button class="vir-btn clean ${this.virus ? '' : 'hide'}" id="vir-clean">🧹 REMOVE THREAT</button>
        <button class="vir-prem">$50 BUY PREMIUM</button>
      </div>`;
    b.querySelector('#vir-scan').onpointerdown = () => {
      sClick();
      const c = b.querySelector('#vir-c');
      let p = 0;
      const iv = setInterval(() => {
        p += 4 + Math.random() * 6;
        c.textContent = '%' + Math.min(100, Math.floor(p));
        if (p >= 100) {
          clearInterval(iv);
          sNotify();
          this.renderVirusBody();
        }
      }, 90);
      c.textContent = '%0';
    };
    b.querySelector('#vir-clean').onpointerdown = () => { sBuy(); this.hooks.cleanVirus(); this.renderVirusBody(); };
    b.querySelector('.vir-prem').onpointerdown = () => { sErr(); this.hooks.toast('Premium is a scam. Just clean the virus.'); };
  }

  // ---------- Wallpapers ----------
  openWall() {
    const rec = this.makeWin('wall', 'Wallpapers', '🖼️', 420, 300);
    const b = rec.body;
    b.innerHTML = `<div class="walls">${WALLS.map((w, i) => `<div class="wall ${i === this.save.wallpaper ? 'on' : ''}" data-i="${i}" style="background:${w}"></div>`).join('')}</div>`;
    b.querySelectorAll('.wall').forEach(wd => wd.onpointerdown = () => { sClick(); this.setWallpaper(+wd.dataset.i); this.hooks.save(); this.openWall(); });
  }
}
