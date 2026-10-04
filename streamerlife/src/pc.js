// ── the in-game PC: desktop OS with apps ────────────────────────────────────
import { money, short, el, pick, ri, rnd, clamp } from './util.js';
import { PCS, GEAR, GAMES, STREAM_TYPES, CHAT_LINES, DON_MSG, EMAILS, SPONSORS, FURNITURE, CLOTHES, CARS, HOUSES } from './data.js';

export class PCDesktop {
  constructor(game) {
    this.game = game;
    this.open = false;
    this.root = document.getElementById('pcLayer');
    this.winHost = this.root.querySelector('.pcWindows');
    this.icons = [
      ['stream', '🔴', 'StreamerHub'],
      ['shop', '🛒', 'NovaShop'],
      ['bank', '🏦', 'Bank'],
      ['social', '📱', 'Chirper'],
      ['mail', '✉️', 'Mail'],
      ['biz', '💼', 'Business'],
      ['games', '🎮', 'GameLib'],
      ['video', '🎞️', 'VideoLab'],
      ['stats', '📊', 'Analytics'],
      ['settings', '⚙️', 'Settings'],
    ];
    this.buildDesktop();
  }

  buildDesktop() {
    const d = this.root.querySelector('.pcDesktopIcons');
    d.innerHTML = '';
    for (const [id, ic, name] of this.icons) {
      const i = el('div', 'pcIcon', `<div class="pcIcoGlyph">${ic}</div><div class="pcIcoName">${name}</div>`);
      i.onclick = () => this.openApp(id);
      d.appendChild(i);
    }
    this.root.querySelector('#pcClose').onclick = () => this.game.closePC();
  }

  show() {
    this.open = true;
    this.root.classList.add('on');
    this.refreshBar();
    if (!this.winHost.children.length) this.openApp('stream');
  }
  hide() { this.open = false; this.root.classList.remove('on'); }

  refreshBar() {
    const s = this.game.save;
    this.root.querySelector('#pcBarInfo').innerHTML =
      `<b>${s.name}</b> · ${money(s.money)} · 👥 ${short(s.followers)} followers · ⭐ ${short(s.subs)} subs · Day ${s.day} · ${this.game.clockString()}`;
  }

  win(title, cls = '') {
    this.winHost.innerHTML = '';
    const w = el('div', 'pcWin ' + cls);
    w.innerHTML = `<div class="pcWinBar"><span>${title}</span><button class="pcWinX">✕</button></div><div class="pcWinBody"></div>`;
    w.querySelector('.pcWinX').onclick = () => w.remove();
    this.winHost.appendChild(w);
    return w.querySelector('.pcWinBody');
  }

  openApp(id) {
    this.refreshBar();
    ({
      stream: () => this.appStream(), shop: () => this.appShop(), bank: () => this.appBank(),
      social: () => this.appSocial(), mail: () => this.appMail(), biz: () => this.appBiz(),
      games: () => this.appGames(), video: () => this.appVideo(), stats: () => this.appStats(),
      settings: () => this.appSettings(),
    })[id]();
  }

  // ── StreamerHub ─────────────────────────────────────────────────────────
  appStream() {
    const g = this.game, s = g.save;
    const b = this.win('🔴 StreamerHub — go live');
    if (g.stream.live) { this.renderLive(b); return; }
    const owned = GAMES.filter(x => s.games.includes(x.id));
    b.innerHTML = `
      <p class="muted">Pick what you stream today. Better PC, gear, house and followers = more viewers.</p>
      <div class="row"><div class="col">
        <h4>Stream type</h4><div id="stTypes" class="chips"></div>
        <h4>Game</h4><div id="stGames" class="chips"></div>
        <h4>Title</h4><input id="stTitle" class="inp" value="${pick(['🔥 ROAD TO 1M', 'chill stream + chat', 'RANKED GRIND LETS GO', 'new setup reveal!!'])}">
      </div><div class="col">
        <div class="statBox">
          <div>PC power <b>${g.pcPower()}</b></div>
          <div>Gear quality <b>${g.gearQuality().toFixed(1)}</b></div>
          <div>House bonus <b>×${(HOUSES.find(h => h.id === s.house).viewerBonus || 1).toFixed(2)}</b></div>
          <div>Room decor <b>+${(g.decorBonus() * 100).toFixed(0)}%</b></div>
          <div>Followers <b>${short(s.followers)}</b></div>
          <div>Mood <b>${s.stats.mood | 0}%</b> · Energy <b>${s.stats.energy | 0}%</b></div>
          <hr><div>Estimated viewers <b id="stEst">—</b></div>
        </div>
        <button id="goLive" class="btn big red">🔴 GO LIVE</button>
      </div></div>`;
    const typeHost = b.querySelector('#stTypes'), gameHost = b.querySelector('#stGames');
    let type = STREAM_TYPES[0], gm = owned[0];
    const draw = () => {
      typeHost.innerHTML = ''; gameHost.innerHTML = '';
      for (const t of STREAM_TYPES) {
        const c = el('button', 'chip' + (t === type ? ' on' : ''), t.name);
        c.onclick = () => { type = t; draw(); }; typeHost.appendChild(c);
      }
      for (const x of owned) {
        const c = el('button', 'chip' + (x === gm ? ' on' : ''), `${x.name} <small>${x.cat}</small>`);
        c.onclick = () => { gm = x; draw(); }; gameHost.appendChild(c);
      }
      if (type.id !== 'gaming') gameHost.innerHTML = '<span class="muted">No game needed for this type.</span>';
      b.querySelector('#stEst').textContent = short(g.estimateViewers(type, gm));
    };
    draw();
    b.querySelector('#goLive').onclick = () => {
      if (s.stats.energy < 10) return g.toast('😴 Too tired. Sleep first!');
      if (s.stats.hunger < 8) return g.toast('🍔 Too hungry to stream!');
      g.startStream(type, gm, b.querySelector('#stTitle').value);
      this.renderLive(this.win('🔴 LIVE'));
    };
  }

  renderLive(b) {
    const g = this.game;
    b.innerHTML = `
      <div class="liveTop"><span class="liveDot"></span> LIVE · <span id="lvTitle"></span></div>
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
    b.querySelector('#lvEnd').onclick = () => { g.endStream(); this.appStream(); };
    g.stream.ui = {
      v: b.querySelector('#lvV'), f: b.querySelector('#lvF'), m: b.querySelector('#lvM'),
      t: b.querySelector('#lvT'), h: b.querySelector('#lvH'), chat: b.querySelector('#lvChat'),
    };
  }

  // ── NovaShop ────────────────────────────────────────────────────────────
  appShop() {
    const g = this.game, s = g.save;
    const b = this.win('🛒 NovaShop — online store');
    const tabs = [['pc', '🖥️ PCs'], ['gear', '🎙️ Gear'], ['furn', '🛋️ Decor'], ['clothes', '👕 Clothes'], ['car', '🚗 Cars']];
    b.innerHTML = `<div class="chips" id="shTabs"></div><div id="shList" class="grid"></div>`;
    const list = b.querySelector('#shList'), th = b.querySelector('#shTabs');
    let tab = 'pc';
    const render = () => {
      th.innerHTML = '';
      tabs.forEach(([id, n]) => { const c = el('button', 'chip' + (tab === id ? ' on' : ''), n); c.onclick = () => { tab = id; render(); }; th.appendChild(c); });
      list.innerHTML = '';
      const items = { pc: PCS, gear: GEAR, furn: FURNITURE, clothes: CLOTHES, car: CARS }[tab];
      for (const it of items) {
        const ownedList = { pc: [s.pc], gear: s.gear, furn: s.furniture, clothes: s.clothes, car: s.cars }[tab];
        const owned = ownedList.includes(it.id);
        const card = el('div', 'card' + (owned ? ' owned' : ''));
        const extra = it.power ? `power ${it.power}` : it.qual ? `quality ${it.qual}` : it.speed ? `speed ${it.speed}` :
          it.viewers ? `+${(it.viewers * 100) | 0}% viewers` : it.style ? `style ${it.style}` : '';
        card.innerHTML = `<div class="cIco">${it.icon}</div><div class="cName">${it.name}</div>
          <div class="muted">${extra}</div><div class="cPrice">${money(it.price)}</div>`;
        const btn = el('button', 'btn small', owned ? (tab === 'pc' ? 'INSTALLED' : 'OWNED') : 'BUY');
        if (!owned) btn.onclick = () => { if (g.buy(tab, it)) render(); };
        else btn.disabled = true;
        card.appendChild(btn);
        list.appendChild(card);
      }
    };
    render();
  }

  appGames() {
    const g = this.game, s = g.save;
    const b = this.win('🎮 GameLib — your library');
    b.innerHTML = '<div class="grid" id="glList"></div>';
    const l = b.querySelector('#glList');
    const render = () => {
      l.innerHTML = '';
      for (const x of GAMES) {
        const owned = s.games.includes(x.id);
        const c = el('div', 'card' + (owned ? ' owned' : ''));
        c.innerHTML = `<div class="cIco">🎮</div><div class="cName">${x.name}</div>
          <div class="muted">${x.cat} · hype ×${x.hype}</div><div class="cPrice">${x.buy ? money(x.buy) : 'FREE'}</div>`;
        const btn = el('button', 'btn small', owned ? 'IN LIBRARY' : 'BUY');
        if (!owned) btn.onclick = () => { if (g.spend(x.buy)) { s.games.push(x.id); g.toast('🎮 ' + x.name + ' installed'); render(); } };
        else btn.disabled = true;
        c.appendChild(btn); l.appendChild(c);
      }
    };
    render();
  }

  appBank() {
    const g = this.game, s = g.save;
    const b = this.win('🏦 Bank');
    const r = () => {
      b.innerHTML = `<div class="statBox big">
        <div>Cash <b>${money(s.money)}</b></div>
        <div>Savings <b>${money(s.bank)}</b> <small class="muted">(+2% / day)</small></div>
        <div>Loan debt <b>${money(s.loan)}</b> <small class="muted">(+5% / day)</small></div></div>
        <div class="row">
          <div class="col"><h4>Deposit</h4><input id="dep" class="inp" type="number" value="1000"><button class="btn" id="bDep">Deposit</button></div>
          <div class="col"><h4>Withdraw</h4><input id="wit" class="inp" type="number" value="1000"><button class="btn" id="bWit">Withdraw</button></div>
          <div class="col"><h4>Loan (max ${money(g.loanMax())})</h4><input id="lo" class="inp" type="number" value="5000"><button class="btn" id="bLo">Take loan</button>
          <button class="btn" id="bPay">Repay all</button></div>
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
    const b = this.win('📱 Chirper');
    b.innerHTML = `<div class="row"><div class="col">
      <h4>Post something</h4><input id="pTxt" class="inp" placeholder="live in 10 min 🔥">
      <button class="btn" id="pSend">Post (+followers, −mood)</button>
      <p class="muted">Posting grows followers based on how many you already have.</p></div>
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
    const g = this.game, s = g.save;
    const b = this.win('✉️ Mail');
    b.innerHTML = '<div class="mailList"></div>';
    const l = b.querySelector('.mailList');
    const all = [...EMAILS, ...s.mail];
    for (const m of all.slice().reverse())
      l.appendChild(el('div', 'mailItem', `<b>${m.from}</b> — ${m.subj}<div class="muted">${m.body}</div>`));
  }

  appBiz() {
    const g = this.game, s = g.save;
    const b = this.win('💼 Business — sponsors & deals');
    const r = () => {
      b.innerHTML = '<div class="grid"></div>';
      const grid = b.querySelector('.grid');
      for (const sp of SPONSORS) {
        const have = s.sponsors.includes(sp.id);
        const can = s.followers >= sp.need;
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
    const b = this.win('🎞️ VideoLab — edit & upload');
    b.innerHTML = `<p class="muted">Turn your stream clips into videos. Videos pay passive money every day.</p>
      <div class="statBox"><div>Clips available <b id="vClips">${s.clips}</b></div>
      <div>Uploaded videos <b id="vVids">${s.videos}</b></div>
      <div>Passive income <b id="vInc">${money(g.passiveIncome())}</b> / day</div></div>
      <button class="btn big" id="vMake">🎬 Edit a video (1 clip, −20 energy, 2h)</button>`;
    b.querySelector('#vMake').onclick = () => {
      if (s.clips < 1) return g.toast('🎞️ No clips — stream more first!');
      if (s.stats.energy < 20) return g.toast('😴 Too tired');
      s.clips--; s.videos++; g.addStat('energy', -20); g.advanceTime(2);
      const f = Math.round(20 + s.followers * .01);
      s.followers += f; g.sync();
      g.toast('🎬 Video uploaded! +' + short(f) + ' followers');
      this.appVideo();
    };
  }

  appStats() {
    const g = this.game, s = g.save;
    const b = this.win('📊 Analytics');
    b.innerHTML = `<div class="statBox big">
      <div>Career level <b>${g.level()}</b></div>
      <div>Total earned <b>${money(s.totalEarned)}</b></div>
      <div>Streams done <b>${s.streams}</b></div>
      <div>Best viewers <b>${short(s.bestViewers)}</b></div>
      <div>Followers <b>${short(s.followers)}</b></div>
      <div>Subs <b>${short(s.subs)}</b> <small class="muted">(${money(s.subs * 2.5)}/day)</small></div>
      <div>Houses owned <b>${s.houses.length}</b></div>
      <div>Cars owned <b>${s.cars.length}</b></div>
      <div>Days played <b>${s.day}</b></div>
      <div>Hours streamed <b>${(s.hoursStreamed || 0).toFixed(1)}</b></div></div>`;
  }

  appSettings() {
    const g = this.game;
    const b = this.win('⚙️ Settings');
    b.innerHTML = `<h4>Streamer name</h4><input class="inp" id="setName" value="${g.save.name}">
      <button class="btn" id="setSave">Save name</button>
      <h4>Game settings</h4><button class="btn" id="openOpt">Open game settings</button>
      <button class="btn red" id="wipe">🗑️ Delete save</button>`;
    b.querySelector('#setSave').onclick = () => { g.save.name = b.querySelector('#setName').value.slice(0, 16) || 'Streamer'; g.sync(); g.toast('✅ Saved'); };
    b.querySelector('#openOpt').onclick = () => { g.closePC(); g.ui.openSettings(); };
    b.querySelector('#wipe').onclick = () => { if (confirm('Delete save?')) { localStorage.removeItem('slm2_save'); location.reload(); } };
  }
}
