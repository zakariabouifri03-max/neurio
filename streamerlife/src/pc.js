// ── NovaOS: windowed in-game desktop (Zamazor shop, OPS streaming, …) ──────
import { money, short, el, pick, ri, rnd, clamp } from './util.js';
import {
  GAMES, STREAM_TYPES, CHAT_LINES, DON_MSG, EMAILS, SPONSORS, HOUSES,
  COMPONENTS, CATS, compById, STREAM_QUALITY,
} from './data.js';

const stars = (n) => '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n);

export class PCDesktop {
  constructor(game) {
    this.game = game;
    this.open = false;
    this.root = document.getElementById('pcLayer');
    this.winHost = this.root.querySelector('.pcWindows');
    this.taskHost = this.root.querySelector('.pcTasks');
    this.wins = new Map();   // id → {el, btn}
    this.z = 10;
    this.cart = [];
    this.apps = {
      zamazor: ['🛒', 'Zamazor', () => this.appShop()],
      ops: ['🔴', 'OPS Live', () => this.appOps()],
      mypc: ['🖥️', 'My PC', () => this.appMyPC()],
      bank: ['🏦', 'Bank', () => this.appBank()],
      social: ['📱', 'Chirper', () => this.appSocial()],
      mail: ['✉️', 'Mail', () => this.appMail()],
      biz: ['💼', 'Business', () => this.appBiz()],
      games: ['🎮', 'GameLib', () => this.appGames()],
      video: ['🎞️', 'VideoLab', () => this.appVideo()],
      stats: ['📊', 'Analytics', () => this.appStats()],
      virus: ['🛡️', 'Virus Scan', () => this.appVirus()],
      wall: ['🖼️', 'Wallpapers', () => this.appWall()],
      settings: ['⚙️', 'Settings', () => this.appSettings()],
    };
    this.buildDesktop();
  }

  // ── shell ───────────────────────────────────────────────────────────────
  buildDesktop() {
    const d = this.root.querySelector('.pcDesktopIcons');
    d.innerHTML = '';
    for (const id in this.apps) {
      const [ic, name] = this.apps[id];
      const i = el('div', 'pcIcon', `<div class="pcIcoGlyph">${ic}</div><div class="pcIcoName">${name}</div>`);
      i.onclick = () => this.openApp(id);
      d.appendChild(i);
    }
    this.root.querySelector('#pcClose').onclick = () => this.game.closePC();
  }

  show() {
    this.open = true;
    this.root.classList.add('on');
    if (this.game.save.wallpaper) this.root.querySelector('.pcScreen').style.background = this.game.save.wallpaper;
    this.refreshBar();
    if (!this.wins.size) this.openApp('ops');
  }
  hide() { this.open = false; this.root.classList.remove('on'); }

  refreshBar() {
    const s = this.game.save;
    this.root.querySelector('#pcBarInfo').innerHTML =
      `💵 ${money(s.money)} · 👥 ${short(s.followers)} · ⭐ ${short(s.subs)} · Day ${s.day} · ${this.game.clockString()}`;
  }

  openApp(id) {
    this.refreshBar();
    const w = this.wins.get(id);
    if (w) { this.focus(id); return; }
    this.apps[id][2]();
    this.focus(id);
  }

  /** creates (or reuses) a window and returns its body element */
  win(id, title, cls = '') {
    let rec = this.wins.get(id);
    if (rec) { rec.el.querySelector('.pcWinBody').innerHTML = ''; this.focus(id); return rec.el.querySelector('.pcWinBody'); }
    const [ic] = this.apps[id];
    const w = el('div', 'pcWin ' + cls);
    const n = this.wins.size;
    w.style.left = (18 + n * 26) + 'px'; w.style.top = (14 + n * 22) + 'px';
    w.innerHTML = `<div class="pcWinBar"><span>${ic} ${title}</span>
      <span class="pcWinBtns"><button class="pcWinM">—</button><button class="pcWinX">✕</button></span></div>
      <div class="pcWinBody"></div>`;
    this.winHost.appendChild(w);
    const btn = el('button', 'pcTask', `${ic} ${title}`);
    btn.onclick = () => {
      if (w.style.display === 'none') { w.style.display = ''; this.focus(id); }
      else if (this.topId === id) w.style.display = 'none';
      else this.focus(id);
    };
    this.taskHost.appendChild(btn);
    this.wins.set(id, { el: w, btn });
    w.querySelector('.pcWinX').onclick = () => { w.remove(); btn.remove(); this.wins.delete(id); };
    w.querySelector('.pcWinM').onclick = () => { w.style.display = 'none'; };
    w.addEventListener('mousedown', () => this.focus(id));
    this.drag(w, w.querySelector('.pcWinBar'));
    return w.querySelector('.pcWinBody');
  }

  focus(id) {
    const rec = this.wins.get(id); if (!rec) return;
    this.topId = id;
    rec.el.style.zIndex = ++this.z;
    rec.el.style.display = '';
    for (const [k, r] of this.wins) r.btn.classList.toggle('on', k === id);
  }

  drag(win, handle) {
    let sx = 0, sy = 0, ox = 0, oy = 0, on = false;
    const down = (e) => {
      if (e.target.tagName === 'BUTTON') return;
      on = true; const p = e.touches ? e.touches[0] : e;
      sx = p.clientX; sy = p.clientY; ox = win.offsetLeft; oy = win.offsetTop;
      e.preventDefault();
    };
    const move = (e) => {
      if (!on) return; const p = e.touches ? e.touches[0] : e;
      win.style.left = Math.max(0, ox + p.clientX - sx) + 'px';
      win.style.top = Math.max(0, oy + p.clientY - sy) + 'px';
    };
    const up = () => { on = false; };
    handle.addEventListener('mousedown', down); handle.addEventListener('touchstart', down, { passive: false });
    addEventListener('mousemove', move); addEventListener('touchmove', move, { passive: false });
    addEventListener('mouseup', up); addEventListener('touchend', up);
  }

  // ── 🛒 ZAMAZOR (web shop with categories, stars and a basket) ───────────
  appShop() {
    const g = this.game, s = g.save;
    const b = this.win('zamazor', 'Zamazor — weeb://wxw.zamazor.com/market', 'wide');
    b.innerHTML = `
      <div class="zTop"><span class="zLogo">Z ZAMAZOR</span>
        <span class="zUrl">weeb://wxw.zamazor.com/market.spp</span>
        <span class="zCash">💵 ${money(s.money)}</span></div>
      <div class="zBody">
        <div class="zSide"></div>
        <div class="zGrid"></div>
        <div class="zCart"><h4>🧺 Shopping Basket</h4><div class="zCartList"></div>
          <div class="zTotal"></div><button class="btn zBuy">Complete Purchase</button></div>
      </div>`;
    const side = b.querySelector('.zSide'), grid = b.querySelector('.zGrid');
    let cat = CATS[0].id;

    const drawCart = () => {
      const list = b.querySelector('.zCartList');
      list.innerHTML = this.cart.length ? '' : '<span class="muted">empty</span>';
      this.cart.forEach((c, i) => {
        const row = el('div', 'zCartRow', `<span>${c.name}</span><b>${money(c.price)}</b>`);
        const x = el('button', 'zX', '✕'); x.onclick = () => { this.cart.splice(i, 1); drawCart(); };
        row.appendChild(x); list.appendChild(row);
      });
      const tot = this.cart.reduce((a, c) => a + c.price, 0);
      b.querySelector('.zTotal').innerHTML = `Total: <b>${money(tot)}</b>`;
      b.querySelector('.zBuy').disabled = !this.cart.length;
    };
    const drawGrid = () => {
      grid.innerHTML = '';
      for (const it of COMPONENTS.filter(c => c.cat === cat)) {
        const owned = s.parts.includes(it.id);
        const inCart = this.cart.includes(it);
        const card = el('div', 'zCard' + (owned ? ' owned' : ''));
        card.innerHTML = `<div class="zStars">${stars(it.stars)}</div>
          <div class="zName">${it.name}</div>
          <div class="zDesc">${it.desc}</div>
          <div class="zPrice">${money(it.price)}</div>`;
        const btn = el('button', 'btn small', owned ? '✔ Owned' : inCart ? 'In basket' : 'Add to basket!');
        btn.disabled = owned || inCart;
        btn.onclick = () => { this.cart.push(it); drawCart(); drawGrid(); };
        card.appendChild(btn); grid.appendChild(card);
      }
    };
    const drawSide = () => {
      side.innerHTML = '';
      for (const c of CATS) {
        const item = el('div', 'zCat' + (c.id === cat ? ' on' : ''), `${c.icon} ${c.name}`);
        item.onclick = () => { cat = c.id; drawSide(); drawGrid(); };
        side.appendChild(item);
      }
    };
    b.querySelector('.zBuy').onclick = () => {
      const tot = this.cart.reduce((a, c) => a + c.price, 0);
      if (!g.spend(tot)) return;
      for (const c of this.cart) { s.parts.push(c.id); g.autoInstall(c.id); }
      g.toast(`📦 Delivered: ${this.cart.length} item(s) — check My PC`);
      this.cart = []; g.sync(); this.appShop();
    };
    drawSide(); drawGrid(); drawCart();
  }

  // ── 🖥️ MY PC (installed components) ────────────────────────────────────
  appMyPC() {
    const g = this.game, s = g.save;
    const b = this.win('mypc', 'My PC — components', 'wide');
    const draw = () => {
      b.innerHTML = `<div class="pcSpecsTop">
          <div>PC power <b>${g.pcPower()}</b></div>
          <div>Stream quality <b>${g.gearQuality().toFixed(1)}</b></div>
          <div>Max resolution <b>${g.maxQuality().name}</b></div>
        </div><div class="specGrid"></div>`;
      const grid = b.querySelector('.specGrid');
      for (const c of CATS) {
        const installed = compById(s.rig[c.id]);
        const owned = s.parts.map(compById).filter(p => p && p.cat === c.id && p.id !== s.rig[c.id]);
        const row = el('div', 'specRow');
        row.innerHTML = `<div class="specCat">${c.icon} ${c.name}</div>
          <div class="specVal ${installed ? '' : 'none'}">${installed ? installed.name + ' ' + stars(installed.stars) : 'NO COMPONENT FOUND'}</div>`;
        const sel = el('div', 'specBtns');
        for (const p of owned) {
          const bt = el('button', 'btn small', 'Install ' + p.name);
          bt.onclick = () => { s.rig[c.id] = p.id; g.sync(); g.toast('🔧 Installed ' + p.name); draw(); };
          sel.appendChild(bt);
        }
        row.appendChild(sel); grid.appendChild(row);
      }
    };
    draw();
  }

  // ── 🔴 OPS (stream software) ───────────────────────────────────────────
  appOps() {
    const g = this.game, s = g.save;
    const b = this.win('ops', 'OPS — Open Producer Studio');
    if (g.stream.live) return this.renderLive(b);
    const owned = GAMES.filter(x => s.games.includes(x.id));
    const maxQ = g.maxQuality();
    b.innerHTML = `
      <div class="opsGrid">
        <div class="opsCol">
          <div class="opsField"><label>🔑 Stream key</label><input class="inp" value="${s.streamKey}" readonly></div>
          <div class="opsField"><label>🏷️ Category</label><select id="opsType"></select></div>
          <div class="opsField"><label>🎮 Game</label><select id="opsGame"></select></div>
          <div class="opsField"><label>📝 Title</label><input class="inp" id="opsTitle" value="${pick(['🔥 ROAD TO 1M', 'chill stream + chat', 'RANKED GRIND', 'new setup reveal!'])}"></div>
        </div>
        <div class="opsCol">
          <div class="opsField"><label>📺 Quality</label><select id="opsQ"></select></div>
          <div class="opsField"><label>📡 Bitrate</label><input class="inp" id="opsBit" type="number" value="${s.bitrate}"> <small class="muted">max ${g.maxBitrate()} kbps</small></div>
          <div class="opsField"><label>🖼️ FPS <b id="opsFpsV">${s.fps}</b></label><input type="range" id="opsFps" min="15" max="120" step="15" value="${s.fps}"></div>
          <div class="opsStats">
            <div>PC power <b>${g.pcPower()}</b></div>
            <div>Gear quality <b>${g.gearQuality().toFixed(1)}</b></div>
            <div>House bonus <b>×${(HOUSES.find(h => h.id === s.house).viewerBonus || 1).toFixed(2)}</b></div>
            <div>Estimated viewers <b id="opsEst">—</b></div>
          </div>
          <button id="goLive" class="btn big red">🔴 START STREAMING</button>
        </div>
      </div>`;
    const tSel = b.querySelector('#opsType'), gSel = b.querySelector('#opsGame'), qSel = b.querySelector('#opsQ');
    STREAM_TYPES.forEach(t => tSel.appendChild(el('option', '', t.name)).value = t.id);
    owned.forEach(x => gSel.appendChild(el('option', '', `${x.name} (${x.cat})`)).value = x.id);
    STREAM_QUALITY.forEach(q => {
      const o = el('option', '', q.name + (q.need > g.pcPower() ? ' — PC too weak' : ''));
      o.value = q.id; o.disabled = q.need > g.pcPower(); qSel.appendChild(o);
    });
    qSel.value = maxQ.id;
    const est = () => {
      const t = STREAM_TYPES.find(x => x.id === tSel.value), gm = GAMES.find(x => x.id === gSel.value);
      b.querySelector('#opsEst').textContent = short(g.estimateViewers(t, gm, qSel.value));
    };
    tSel.onchange = gSel.onchange = qSel.onchange = est;
    b.querySelector('#opsFps').oninput = (e) => { s.fps = +e.target.value; b.querySelector('#opsFpsV').textContent = s.fps; };
    est();
    b.querySelector('#goLive').onclick = () => {
      if (s.stats.energy < 10) return g.toast('😴 Too tired. Sleep first!');
      if (s.stats.hunger < 8) return g.toast('🍔 Too hungry to stream!');
      s.bitrate = clamp(+b.querySelector('#opsBit').value || 2500, 500, g.maxBitrate());
      s.quality = qSel.value;
      g.startStream(STREAM_TYPES.find(x => x.id === tSel.value), GAMES.find(x => x.id === gSel.value),
        b.querySelector('#opsTitle').value);
      this.renderLive(this.win('ops', 'OPS — 🔴 LIVE'));
    };
  }

  renderLive(b) {
    const g = this.game, s = g.save;
    b.innerHTML = `
      <div class="liveTop"><span class="liveDot"></span> LIVE · <span id="lvTitle"></span>
        <span class="muted"> · ${s.quality} · ${s.bitrate} kbps · ${s.fps} FPS</span></div>
      <div class="row">
        <div class="col">
          <div class="liveStats">
            <div><span>👀 Viewers</span><b id="lvV">0</b></div>
            <div><span>👥 New followers</span><b id="lvF">0</b></div>
            <div><span>💸 Earned</span><b id="lvM">$0</b></div>
            <div><span>⏱️ Uptime</span><b id="lvT">0:00</b></div>
            <div><span>📈 Hype</span><b id="lvH">100%</b></div>
          </div>
          <div class="liveBtns">
            <button class="btn" id="lvHype">🎉 Do something funny (+hype)</button>
            <button class="btn" id="lvRead">💬 Read chat (+followers)</button>
            <button class="btn" id="lvRaid">📢 Shoutout (+viewers)</button>
            <button class="btn red" id="lvEnd">⏹️ END STREAM</button>
          </div>
        </div>
        <div class="col chatCol"><div class="chatBox" id="lvChat"></div></div>
      </div>`;
    b.querySelector('#lvTitle').textContent = g.stream.title;
    b.querySelector('#lvHype').onclick = () => g.streamAction('hype');
    b.querySelector('#lvRead').onclick = () => g.streamAction('read');
    b.querySelector('#lvRaid').onclick = () => g.streamAction('raid');
    b.querySelector('#lvEnd').onclick = () => { g.endStream(); this.appOps(); };
    g.stream.ui = {
      v: b.querySelector('#lvV'), f: b.querySelector('#lvF'), m: b.querySelector('#lvM'),
      t: b.querySelector('#lvT'), h: b.querySelector('#lvH'), chat: b.querySelector('#lvChat'),
    };
  }

  pushChatLine(html, cls) {
    const ui = this.game.stream.ui;
    if (!ui?.chat || !document.body.contains(ui.chat)) return;
    ui.chat.appendChild(el('div', 'chatMsg ' + (cls || ''), html));
    while (ui.chat.children.length > 60) ui.chat.firstChild.remove();
    ui.chat.scrollTop = ui.chat.scrollHeight;
  }

  // ── 🛡️ virus scanner (money sink + random malware events) ──────────────
  appVirus() {
    const g = this.game, s = g.save;
    const b = this.win('virus', 'Virus Scanner');
    const draw = () => {
      b.innerHTML = `<h3>Viruses & Malware</h3>
        <p class="muted">Don't worry, we will help you with your PC problems.</p>
        <div class="statBox"><div>Infections <b>${s.viruses}</b></div>
          <div>Premium <b>${s.antivirus ? 'ACTIVE 👑' : 'not active'}</b></div>
          <div>Performance loss <b>-${Math.min(60, s.viruses * 12)}%</b></div></div>
        <button class="btn big" id="scan">START SCANNING</button>
        ${s.antivirus ? '' : '<button class="btn" id="prem">💲50 BUY PREMIUM (auto-clean forever)</button>'}`;
      b.querySelector('#scan').onclick = () => {
        g.advanceTime(.5);
        if (!s.viruses) return g.toast('🛡️ Scan complete — PC is clean');
        s.viruses = 0; g.sync(); g.toast('🧹 Removed all infections — PC fast again'); draw();
      };
      if (!s.antivirus) b.querySelector('#prem').onclick = () => {
        if (!g.spend(50)) return; s.antivirus = true; s.viruses = 0; g.sync(); g.toast('👑 Premium activated'); draw();
      };
    };
    draw();
  }

  appWall() {
    const g = this.game;
    const b = this.win('wall', 'Wallpapers');
    const list = [['Night City', 'linear-gradient(160deg,#0b1a3a,#12294d 50%,#0a1226)'],
    ['Lake Sunset', 'linear-gradient(160deg,#2b1055,#7597de 60%,#f6a06a)'],
    ['Forest Fog', 'linear-gradient(160deg,#0c1f17,#20493a 60%,#0a1410)'],
    ['Purple Rig', 'linear-gradient(160deg,#1a0b2e,#5b21b6 60%,#0f0720)'],
    ['Pure Black', '#05070c']];
    b.innerHTML = '<div class="grid"></div>';
    for (const [name, css] of list) {
      const c = el('div', 'card');
      c.innerHTML = `<div style="height:60px;border-radius:8px;background:${css}"></div><div class="cName">${name}</div>`;
      const bt = el('button', 'btn small', 'Apply');
      bt.onclick = () => {
        this.root.querySelector('.pcScreen').style.background = css;
        g.save.wallpaper = css; g.sync(); g.toast('🖼️ Wallpaper changed');
      };
      c.appendChild(bt); b.querySelector('.grid').appendChild(c);
    }
  }

  // ── other apps ──────────────────────────────────────────────────────────
  appGames() {
    const g = this.game, s = g.save;
    const b = this.win('games', 'GameLib');
    const render = () => {
      b.innerHTML = '<div class="grid"></div>';
      const l = b.querySelector('.grid');
      for (const x of GAMES) {
        const owned = s.games.includes(x.id);
        const c = el('div', 'card' + (owned ? ' owned' : ''));
        c.innerHTML = `<div class="cIco">🎮</div><div class="cName">${x.name}</div>
          <div class="muted">${x.cat} · hype ×${x.hype}</div><div class="cPrice">${x.buy ? money(x.buy) : 'FREE'}</div>`;
        const btn = el('button', 'btn small', owned ? 'IN LIBRARY' : 'BUY');
        btn.disabled = owned;
        if (!owned) btn.onclick = () => { if (g.spend(x.buy)) { s.games.push(x.id); g.toast('🎮 ' + x.name + ' installed'); render(); } };
        c.appendChild(btn); l.appendChild(c);
      }
    };
    render();
  }

  appBank() {
    const g = this.game, s = g.save;
    const b = this.win('bank', 'Bank');
    const r = () => {
      b.innerHTML = `<div class="statBox big">
        <div>Cash <b>${money(s.money)}</b></div>
        <div>Savings <b>${money(s.bank)}</b> <small class="muted">(+2% / day)</small></div>
        <div>Loan debt <b>${money(s.loan)}</b> <small class="muted">(+5% / day)</small></div></div>
        <div class="row">
          <div class="col"><h4>Deposit</h4><input id="dep" class="inp" type="number" value="1000"><button class="btn" id="bDep">Deposit</button></div>
          <div class="col"><h4>Withdraw</h4><input id="wit" class="inp" type="number" value="1000"><button class="btn" id="bWit">Withdraw</button></div>
          <div class="col"><h4>Loan (max ${money(g.loanMax())})</h4><input id="lo" class="inp" type="number" value="5000">
            <button class="btn" id="bLo">Take loan</button><button class="btn" id="bPay">Repay all</button></div>
        </div>`;
      const v = id => Math.max(0, Math.floor(+b.querySelector(id).value || 0));
      b.querySelector('#bDep').onclick = () => { const a = Math.min(v('#dep'), s.money); s.money -= a; s.bank += a; g.sync(); r(); };
      b.querySelector('#bWit').onclick = () => { const a = Math.min(v('#wit'), s.bank); s.bank -= a; s.money += a; g.sync(); r(); };
      b.querySelector('#bLo').onclick = () => {
        const a = Math.min(v('#lo'), g.loanMax() - s.loan);
        if (a <= 0) return g.toast('❌ Loan limit reached');
        s.loan += a; s.money += a; g.sync(); r(); g.toast('🏦 Loan approved ' + money(a));
      };
      b.querySelector('#bPay').onclick = () => { const a = Math.min(s.loan, s.money); s.money -= a; s.loan -= a; g.sync(); r(); };
    };
    r();
  }

  appSocial() {
    const g = this.game, s = g.save;
    const b = this.win('social', 'Chirper');
    b.innerHTML = `<div class="row"><div class="col">
      <h4>Post something</h4><input id="pTxt" class="inp" placeholder="live in 10 min 🔥">
      <button class="btn" id="pSend">Post (+followers, −mood)</button></div>
      <div class="col"><h4>Feed</h4><div class="feed" id="feed"></div></div></div>`;
    const feed = b.querySelector('#feed');
    const draw = () => {
      feed.innerHTML = '';
      for (const p of s.posts.slice(-12).reverse())
        feed.appendChild(el('div', 'post', `<b>@${s.name}</b> <span class="muted">· day ${p.d}</span><br>${p.t}<br><small class="muted">❤️ ${short(p.l)} · +${short(p.f)} followers</small>`));
    };
    draw();
    b.querySelector('#pSend').onclick = () => {
      const t = b.querySelector('#pTxt').value.trim() || pick(['new stream soon 🔥', 'gg', 'love you chat ❤️']);
      const f = Math.round(5 + s.followers * rnd(.012, .003) * (1 + g.gearQuality() / 20));
      s.followers += f; s.posts.push({ t, d: s.day, l: f * ri(3, 9), f });
      g.addStat('mood', -3); g.sync(); draw(); b.querySelector('#pTxt').value = '';
      g.toast('📱 Posted! +' + short(f) + ' followers');
    };
  }

  appMail() {
    const s = this.game.save;
    const b = this.win('mail', 'Mail');
    b.innerHTML = '<div class="mailList"></div>';
    const l = b.querySelector('.mailList');
    for (const m of [...EMAILS, ...s.mail].reverse())
      l.appendChild(el('div', 'mailItem', `<b>${m.from}</b> — ${m.subj}<div class="muted">${m.body}</div>`));
  }

  appBiz() {
    const g = this.game, s = g.save;
    const b = this.win('biz', 'Business — sponsors');
    const r = () => {
      b.innerHTML = '<div class="grid"></div>';
      const grid = b.querySelector('.grid');
      for (const sp of SPONSORS) {
        const have = s.sponsors.includes(sp.id), can = s.followers >= sp.need;
        const c = el('div', 'card' + (have ? ' owned' : ''));
        c.innerHTML = `<div class="cIco">${sp.icon}</div><div class="cName">${sp.name}</div>
          <div class="muted">needs ${short(sp.need)} followers</div><div class="cPrice">${money(sp.pay)} / stream</div>`;
        const btn = el('button', 'btn small', have ? 'SIGNED' : can ? 'SIGN DEAL' : 'LOCKED');
        btn.disabled = have || !can;
        if (!have && can) btn.onclick = () => { s.sponsors.push(sp.id); g.toast('💼 Signed with ' + sp.name); g.sync(); r(); };
        c.appendChild(btn); grid.appendChild(c);
      }
    };
    r();
  }

  appVideo() {
    const g = this.game, s = g.save;
    const b = this.win('video', 'VideoLab');
    const draw = () => {
      b.innerHTML = `<p class="muted">Turn stream clips into videos — videos pay you every day.</p>
        <div class="statBox"><div>Clips available <b>${s.clips}</b></div>
        <div>Uploaded videos <b>${s.videos}</b></div>
        <div>Passive income <b>${money(g.passiveIncome())}</b> / day</div></div>
        <button class="btn big" id="vMake">🎬 Edit a video (1 clip, −20 energy, 2h)</button>`;
      b.querySelector('#vMake').onclick = () => {
        if (s.clips < 1) return g.toast('🎞️ No clips — stream more first!');
        if (s.stats.energy < 20) return g.toast('😴 Too tired');
        s.clips--; s.videos++; g.addStat('energy', -20); g.advanceTime(2);
        const f = Math.round(20 + s.followers * .01);
        s.followers += f; g.sync();
        g.toast('🎬 Video uploaded! +' + short(f) + ' followers'); draw();
      };
    };
    draw();
  }

  appStats() {
    const g = this.game, s = g.save;
    const b = this.win('stats', 'Analytics');
    b.innerHTML = `<div class="statBox big">
      <div>Career level <b>${g.level()}</b></div>
      <div>Total earned <b>${money(s.totalEarned)}</b></div>
      <div>Streams done <b>${s.streams}</b></div>
      <div>Best viewers <b>${short(s.bestViewers)}</b></div>
      <div>Followers <b>${short(s.followers)}</b></div>
      <div>Subs <b>${short(s.subs)}</b></div>
      <div>Houses owned <b>${s.houses.length}</b></div>
      <div>Cars owned <b>${s.cars.length}</b></div>
      <div>Days played <b>${s.day}</b></div>
      <div>Hours streamed <b>${(s.hoursStreamed || 0).toFixed(1)}</b></div></div>`;
  }

  appSettings() {
    const g = this.game;
    const b = this.win('settings', 'Settings');
    b.innerHTML = `<h4>Streamer name</h4><input class="inp" id="setName" value="${g.save.name}">
      <button class="btn" id="setSave">Save name</button>
      <h4>Game settings</h4><button class="btn" id="openOpt">Open game settings</button>
      <button class="btn red" id="wipe">🗑️ Delete save</button>`;
    b.querySelector('#setSave').onclick = () => { g.save.name = b.querySelector('#setName').value.slice(0, 16) || 'Streamer'; g.sync(); g.toast('✅ Saved'); };
    b.querySelector('#openOpt').onclick = () => { g.closePC(); g.ui.openSettings(); };
    b.querySelector('#wipe').onclick = () => { if (confirm('Delete save?')) { localStorage.removeItem('slm2_save'); location.reload(); } };
  }
}
