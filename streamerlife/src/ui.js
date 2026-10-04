// ── menus, HUD, in-world shops, settings ───────────────────────────────────
import { money, short, el, $, pick } from './util.js';
import { HOUSES, CARS, FOOD, CLOTHES, FURNITURE, COMPONENTS, CATS, compById } from './data.js';

export class UI {
  constructor(game) {
    this.game = game;
    this.menu = $('menu');
    this.hud = $('hud');
    this.panel = $('panel');
    this.toastHost = $('toasts');
    this.bindMenu();
  }

  // ── main menu ───────────────────────────────────────────────────────────
  bindMenu() {
    const g = this.game;
    $('btnPlay').onclick = () => g.startGame('solo');
    $('btnMulti').onclick = () => this.openMultiplayer();
    $('btnSettings').onclick = () => this.openSettings();
    $('btnQuit').onclick = () => this.quit();
    $('btnContinue').onclick = () => g.startGame('solo', true);
    if (!localStorage.getItem('slm2_save')) $('btnContinue').style.display = 'none';
  }
  howTo() {
    this.openPanel('🎮 How to play — kifach tl3ab', `
      <div class="helpGrid">
        <div><b>W A S D</b><span>tmchi / move</span></div>
        <div><b>Mouse</b><span>tchouf / look (click once to lock)</span></div>
        <div><b>Shift</b><span>tjri / run</span></div>
        <div><b>E</b><span>interact — wla klick 3la lbar l5dra</span></div>
        <div><b>F</b><span>tdkhol / tkhroj tomobil</span></div>
        <div><b>V</b><span>camera dyal tomobil</span></div>
        <div><b>G</b><span>auto-walk l hadaf (wla klick 3la lbar dyal fo9)</span></div>
        <div><b>← →</b><span>dowwer lkamira bla mouse</span></div>
        <div><b>R</b><span>unstuck ila t3alaqti</span></div>
        <div><b>Tab</b><span>kharita · <b>Esc</b> pause</span></div>
      </div>
      <p class="muted"><b>Ma3reftich tmchi?</b> ghir dghat <b>G</b> (wla klick 3la lkhatt dyal lhadaf f lfo9) ou
      lpersonnage ghadi ymchi wahdo l dar ou ydkhol. Lmouse: ila ma-tqefelch, ghir <b>chedd ou jerr</b> b lmouse.</p>
      <p class="muted">Lawwel 7aja: mchi l <b>🚪 bab dyal dar #1</b> (l3alama khadra), dghat <b>E</b>, mn be3d
      mchi l <b>🖥️ PC</b> ou 7el <b>OPS</b> → START STREAMING.</p>
      <button class="btn big" id="helpOk">LET'S GO 🚀</button>`, () => {
      $('helpOk').onclick = () => { this.closePanel(); this.game.grabMouse(); };
    });
  }

  showMenu() { this.menu.classList.add('on'); this.hud.classList.remove('on'); }
  hideMenu() { this.menu.classList.remove('on'); this.hud.classList.add('on'); }

  quit() {
    this.game.saveNow();
    this.closePanel();
    if (window.electronAPI?.quit) return window.electronAPI.quit();
    window.close();
    this.openPanel('👋 Bye', `<p>Progress saved. You can close the tab/app now — or keep playing.</p>
      <button class="btn big" id="bk">◀ Back to menu</button>`, () => { $('bk').onclick = () => { this.closePanel(); this.showMenu(); }; });
  }

  // ── generic panel ──────────────────────────────────────────────────────
  openPanel(title, html, after) {
    this.panel.innerHTML = `<div class="panelBox"><div class="panelBar"><span>${title}</span><button id="pClose">✕</button></div>
      <div class="panelBody">${html}</div></div>`;
    this.panel.classList.add('on');
    $('pClose').onclick = () => this.closePanel();
    this.game.releaseMouse();
    after && after();
  }
  closePanel() { this.panel.classList.remove('on'); this.panel.innerHTML = ''; }

  openSettings() {
    const s = this.game.settings;
    this.openPanel('⚙️ Settings', `
      <label>Mouse sensitivity <input type="range" id="sSens" min="20" max="300" value="${s.sens * 100}"></label>
      <label>Field of view <input type="range" id="sFov" min="60" max="110" value="${s.fov}"></label>
      <label>Graphics quality
        <select id="sQual"><option value="low">Low</option><option value="med">Medium</option><option value="high">High</option></select></label>
      <label>Shadows <input type="checkbox" id="sShadow" ${s.shadows ? 'checked' : ''}></label>
      <label>Music <input type="range" id="sMus" min="0" max="100" value="${s.music * 100}"></label>
      <label>SFX <input type="range" id="sSfx" min="0" max="100" value="${s.sfx * 100}"></label>
      <label>Invert Y <input type="checkbox" id="sInv" ${s.invertY ? 'checked' : ''}></label>
      <label>Easy mode (slower needs, bigger interaction zones) <input type="checkbox" id="sEasy" ${s.easy ? 'checked' : ''}></label>
      <label>Show minimap <input type="checkbox" id="sMap" ${s.minimap ? 'checked' : ''}></label>
      <label>Show guide markers <input type="checkbox" id="sMark" ${s.markers ? 'checked' : ''}></label>
      <label>Show touch controls <input type="checkbox" id="sTouch" ${s.touch ? 'checked' : ''}></label>
      <p class="muted">Controls: WASD move · Shift run · Mouse look · <b>E</b> interact (or click the green bar) ·
      F enter/exit car · V car camera · Tab map · <b>R</b> unstuck · Esc pause · Enter chat (multiplayer)</p>
      <button class="btn" id="sApply">Apply</button>`, () => {
      $('sQual').value = s.quality;
      $('sApply').onclick = () => {
        s.sens = +$('sSens').value / 100; s.fov = +$('sFov').value; s.quality = $('sQual').value;
        s.shadows = $('sShadow').checked; s.music = +$('sMus').value / 100; s.sfx = +$('sSfx').value / 100;
        s.invertY = $('sInv').checked; s.touch = $('sTouch').checked;
        s.easy = $('sEasy').checked; s.minimap = $('sMap').checked; s.markers = $('sMark').checked;
        this.game.applySettings(); this.closePanel(); this.toast('⚙️ Settings applied');
      };
    });
  }

  openMultiplayer() {
    const saved = localStorage.getItem('slm2_server') || (location.protocol.startsWith('http') ? location.origin.replace(/^http/, 'ws') : 'ws://localhost:8787');
    this.openPanel('🌐 Multiplayer — play online with friends', `
      <p>Both players run around the <b>same city</b>, see each other, and chat live.</p>
      <label>Your name <input class="inp" id="mName" value="${this.game.save.name}"></label>
      <label>Server address <input class="inp" id="mSrv" value="${saved}"></label>
      <label>Room code <input class="inp" id="mRoom" value="${localStorage.getItem('slm2_room') || 'medina'}"></label>
      <button class="btn big" id="mJoin">🌍 JOIN ONLINE</button>
      <p class="muted">Host a server: <code>node server/mp-server.mjs</code> (port 8787), then share your address
      (for example <code>ws://YOUR-IP:8787</code>) with your friend.</p>`, () => {
      $('mJoin').onclick = () => {
        const srv = $('mSrv').value.trim(), room = $('mRoom').value.trim() || 'medina';
        this.game.save.name = $('mName').value.slice(0, 16) || 'Streamer';
        localStorage.setItem('slm2_server', srv); localStorage.setItem('slm2_room', room);
        this.closePanel();
        this.game.startGame('multi', true, { srv, room });
      };
    });
  }

  // ── in-world shops ─────────────────────────────────────────────────────
  shop(kind) {
    const g = this.game, s = g.save;
    const grid = (items, buy, ownedOf) => {
      let h = '<div class="grid">';
      items.forEach((it, i) => {
        const owned = ownedOf ? ownedOf(it) : false;
        const sub = it.cat ? `${CATS.find(c => c.id === it.cat).name} · ${'★'.repeat(it.stars)}` : it.hunger ? `+${it.hunger} hunger` : it.speed ? `speed ${it.speed}` : it.style ? `style +${it.style}`
          : it.viewers ? `+${(it.viewers * 100) | 0}% viewers` : it.power ? `power ${it.power}` : it.qual ? `quality ${it.qual}` : it.desc || '';
        h += `<div class="card ${owned ? 'owned' : ''}"><div class="cIco">${it.icon}</div><div class="cName">${it.name}</div>
          <div class="muted">${sub}</div><div class="cPrice">${money(it.price)}</div>
          <button class="btn small" data-i="${i}" ${owned ? 'disabled' : ''}>${owned ? 'OWNED' : 'BUY'}</button></div>`;
      });
      return h + '</div>';
    };
    const wire = (host, items, fn) => host.querySelectorAll('button[data-i]').forEach(b =>
      b.onclick = () => { fn(items[+b.dataset.i]); });

    if (kind === 'shop_food') {
      this.openPanel('🛒 Supermarket', grid(FOOD), () => {
        wire(this.panel, FOOD, (it) => {
          if (!g.spend(it.price)) return;
          s.fridge = (s.fridge || 0) + 1;
          g.addStat('hunger', it.hunger); g.addStat('mood', it.mood || 0); g.addStat('energy', it.energy || 0);
          g.toast(`${it.icon} ${it.name} — yummy!`); g.sync();
        });
      });
    } else if (kind === 'shop_tech') {
      const items = COMPONENTS.slice().sort((a, b) => a.price - b.price);
      const body = `<p class="muted">Walk-in prices — or order from home on <b>Zamazor</b> (your PC).</p>` +
        grid(items.map(it => ({ ...it, icon: CATS.find(c => c.id === it.cat).icon })), null, it => s.parts.includes(it.id));
      this.openPanel('💻 Tech Store', body, () =>
        wire(this.panel, items, it => { if (g.buy('part', it)) this.shop('shop_tech'); }));
    } else if (kind === 'shop_car') {
      this.openPanel('🚗 Car Dealer', grid(CARS, null, it => s.cars.includes(it.id)), () =>
        wire(this.panel, CARS, it => { if (g.buy('car', it)) this.shop('shop_car'); }));
    } else if (kind === 'shop_furn') {
      this.openPanel('🛋️ Furniture Store', grid(FURNITURE, null, it => s.furniture.includes(it.id)), () =>
        wire(this.panel, FURNITURE, it => { if (g.buy('furn', it)) this.shop('shop_furn'); }));
    } else if (kind === 'shop_clothes') {
      this.openPanel('👕 Clothes Shop', grid(CLOTHES, null, it => s.clothes.includes(it.id)), () =>
        wire(this.panel, CLOTHES, it => { if (g.buy('clothes', it)) this.shop('shop_clothes'); }));
    } else if (kind === 'bank') {
      this.openPanel('🏦 Bank', `<div class="statBox big"><div>Cash <b>${money(s.money)}</b></div>
        <div>Savings <b>${money(s.bank)}</b></div><div>Debt <b>${money(s.loan)}</b></div></div>
        <p class="muted">Full banking (deposit, withdraw, loans) is on your PC → 🏦 Bank app.</p>`);
    } else if (kind === 'gym') {
      this.openPanel('🏋️ Gym', `<p>Train for 2 hours: energy −25, mood +20, max energy up.</p>
        <div class="statBox"><div>Fitness level <b>${(s.fitness || 0).toFixed(1)}</b></div></div>
        <button class="btn big" id="tr">💪 Train ($50)</button>`, () => {
        $('tr').onclick = () => {
          if (!g.spend(50)) return;
          s.fitness = (s.fitness || 0) + .5; g.addStat('energy', -25); g.addStat('mood', 20); g.addStat('hygiene', -20);
          g.advanceTime(2); g.sync(); g.toast('💪 Good workout!'); this.shop('gym');
        };
      });
    } else if (kind === 'estate') {
      const list = HOUSES.map(h => {
        const owned = s.houses.includes(h.id);
        return `<div class="card ${owned ? 'owned' : ''}"><div class="cIco">${h.icon}</div><div class="cName">${h.name}</div>
          <div class="muted">${h.desc}</div><div class="cPrice">${money(h.price)}</div>
          <button class="btn small" data-h="${h.id}" ${owned ? 'disabled' : ''}>${owned ? (s.house === h.id ? 'LIVING HERE' : 'OWNED') : 'BUY'}</button>
          ${owned && s.house !== h.id ? `<button class="btn small" data-move="${h.id}">MOVE IN</button>` : ''}</div>`;
      }).join('');
      this.openPanel('🏠 Real Estate Agency', `<div class="grid">${list}</div>`, () => {
        this.panel.querySelectorAll('[data-h]').forEach(b => b.onclick = () => {
          const h = HOUSES.find(x => x.id === +b.dataset.h);
          if (!g.spend(h.price)) return;
          s.houses.push(h.id); s.house = h.id; g.sync(); g.toast('🏠 You bought ' + h.name + '!');
          this.shop('estate');
        });
        this.panel.querySelectorAll('[data-move]').forEach(b => b.onclick = () => {
          s.house = +b.dataset.move; g.sync(); g.toast('📦 Moved in!'); this.shop('estate');
        });
      });
    }
  }

  // ── HUD ────────────────────────────────────────────────────────────────
  updateHUD() {
    const g = this.game, s = g.save, st = s.stats;
    $('hMoney').textContent = money(s.money);
    $('hFoll').textContent = short(s.followers);
    $('hSubs').textContent = short(s.subs);
    $('hClock').textContent = `Day ${s.day} · ${g.clockString()}`;
    const bars = { bEnergy: st.energy, bHunger: st.hunger, bHygiene: st.hygiene, bMood: st.mood };
    for (const k in bars) {
      const b = $(k); if (!b) continue;
      b.style.width = Math.max(0, Math.min(100, bars[k])) + '%';
      b.style.background = bars[k] < 20 ? '#ef4444' : bars[k] < 45 ? '#f59e0b' : '#22c55e';
    }
    $('hLive').style.display = g.stream.live ? 'flex' : 'none';
    if (g.stream.live) $('hLiveV').textContent = short(g.stream.viewers);
  }

  carHud(kmh) {
    const h = $('carHud');
    if (kmh == null) { h.style.display = 'none'; return; }
    h.style.display = 'block';
    h.innerHTML = `<div class="spd"><b>${Math.round(kmh)}</b> km/h</div>
      <div class="keys"><span><b>W/S</b> gas · brake</span><span><b>A/D</b> steer</span>
      <span><b>V</b> camera</span><span><b>F</b> exit</span></div>`;
  }

  prompt(text, far) {
    const p = $('prompt');
    if (!text) { p.style.display = 'none'; return; }
    p.style.display = 'block';
    p.className = far ? 'far' : '';
    p.innerHTML = far ? `<i>${text}</i>` : `<b>E</b> ${text}`;
    p.onclick = far ? null : () => this.game.tryInteract();
  }

  // ── minimap ────────────────────────────────────────────────────────────
  initMinimap(pois) {
    this.mm = $('minimap');
    this.mmCtx = this.mm.getContext('2d');
    this.pois = pois;
  }
  drawMinimap(player, insideHouse) {
    if (!this.mmCtx) return;
    const c = this.mmCtx, S = this.mm.width, R = 170;          // world radius shown
    c.clearRect(0, 0, S, S);
    c.fillStyle = '#0b1020'; c.fillRect(0, 0, S, S);
    const toPx = (x, z) => [S / 2 + (x - player.pos.x) / R * (S / 2), S / 2 + (z - player.pos.z) / R * (S / 2)];
    if (insideHouse) {
      c.fillStyle = '#8b94a7'; c.font = '12px sans-serif'; c.textAlign = 'center';
      c.fillText('inside the house', S / 2, S / 2);
      return;
    }
    // roads
    c.strokeStyle = '#2a3346'; c.lineWidth = 7;
    for (const r of [-120, -60, 0, 60, 120]) {
      let [x1, y1] = toPx(-200, r), [x2, y2] = toPx(200, r);
      c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
      [x1, y1] = toPx(r, -200); [x2, y2] = toPx(r, 200);
      c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
    }
    // points of interest
    c.font = '11px sans-serif'; c.textAlign = 'center';
    for (const p of this.pois) {
      const [x, y] = toPx(p.x, p.z);
      if (x < -20 || y < -20 || x > S + 20 || y > S + 20) continue;
      c.fillText(p.icon, x, y + 4);
    }
    // player arrow
    c.save(); c.translate(S / 2, S / 2); c.rotate(-player.yaw + Math.PI);
    c.fillStyle = '#22d3ee'; c.beginPath(); c.moveTo(0, -8); c.lineTo(6, 7); c.lineTo(0, 4); c.lineTo(-6, 7);
    c.closePath(); c.fill(); c.restore();
    c.strokeStyle = '#ffffff22'; c.strokeRect(.5, .5, S - 1, S - 1);
  }

  toast(msg) {
    const t = el('div', 'toast', msg);
    this.toastHost.appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 400); }, 2600);
  }

  pause(on) {
    $('pause').classList.toggle('on', on);
    if (on) {
      $('pResume').onclick = () => this.game.setPaused(false);
      $('pSettings').onclick = () => this.openSettings();
      const hb = $('pHelp'); if (hb) hb.onclick = () => this.howTo();
      $('pSave').onclick = () => { this.game.saveNow(); this.toast('💾 Saved'); };
      $('pMenu').onclick = () => { this.game.saveNow(); location.reload(); };
    }
  }
}
