// ui.js — DOM HUD, panels, i18n (EN / AR-Darija), minimap, touch controls
import { clamp, clamp01, lerp, TAU } from './util.js';
import { ITEMS, RECIPES } from './survival.js';

const T = {
  en: {
    loading: 'Building the coast…', play: 'PLAY', continue: 'CONTINUE', newGame: 'NEW GAME',
    objectives: 'OBJECTIVE', inventory: 'INVENTORY', crafting: 'CRAFTING', journal: 'JOURNAL',
    map: 'MAP', controls: 'CONTROLS', pause: 'PAUSED', resume: 'RESUME', restart: 'RESTART',
    quality: 'QUALITY', lang: 'ARABIC', sound: 'SOUND', muted: 'MUTED', use: 'USE', eat: 'EAT',
    craft: 'CRAFT', close: 'CLOSE (Esc)', interact: 'Interact', dead: 'You did not make it…',
    respawn: 'TRY AGAIN', 'play again': 'Play again', fishCaught: 'Fish caught', survived: 'Survived',
    water: 'Water', food: 'Food', warmth: 'Warmth', health: 'Health', stamina: 'Stamina', breath: 'Breath',
    zoom: 'Zoom', need: 'Need', have: 'Have', built: 'Built', recipes: 'Recipes', touchHint: 'Drag to move',
  },
  ar: {
    loading: 'كنبنيو الساحل…', play: 'ابدا اللعب', continue: 'كمل', newGame: 'لعبة جديدة',
    objectives: 'المهمة', inventory: 'الشنطة', crafting: 'الصناعة', journal: 'اليوميات',
    map: 'الخريطة', controls: 'التحكم', pause: 'وقفة', resume: 'كمل', restart: 'عاود',
    quality: 'الجودة', lang: 'ENGLISH', sound: 'الصوت', muted: 'مسكت', use: 'استعمل', eat: 'كول',
    craft: 'صنع', close: 'سد (Esc)', interact: 'تفاعل', dead: 'ماتصلحش…', respawn: 'عاود المحاولة',
    'play again': 'العب من جديد', fishCaught: 'الحوت اللي شديتي', survived: 'نجيتي',
    water: 'الما', food: 'الماكلة', warmth: 'الدفا', health: 'الصحة', stamina: 'القوة', breath: 'النفس',
    zoom: 'تكبير', need: 'خاصك', have: 'عندك', built: 'بنيتي', recipes: 'وصفات', touchHint: 'حرك الصبع',
  },
};

export class UI {
  constructor(root) {
    this.root = root;
    this.lang = 'en';
    this.visible = {};
    this.messages = [];
    this.subtitle = null;
    this.chapterCard = null;
    this.biteFlash = 0;
    this.celebrateFish = null;
    this.touch = { active: false, stick: { x: 0, y: 0, id: null, cx: 0, cy: 0 }, buttons: {} };
    this.onAction = () => {};
    this._build();
  }

  t(key) { return (T[this.lang] && T[this.lang][key]) || T.en[key] || key; }

  setLang(lang) {
    this.lang = lang;
    this.root.classList.toggle('rtl', lang === 'ar');
    this.root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = this.t(el.dataset.i18n); });
  }

  _build() {
    this.root.innerHTML = `
<div id="loading" class="screen">
  <div class="loadWrap">
    <div class="logo">🌊<span>TSUNAMI</span></div>
    <div class="loadTitle" data-i18n="loading">Building the coast…</div>
    <div class="loadBar"><i></i></div>
    <div class="loadPct">0%</div>
    <div class="loadTip">Three.js · procedural world · no assets</div>
    <button id="startBtn" class="btn big hidden" data-act="start" data-i18n="play">PLAY</button>
    <div class="loadNote">W A S D move · SHIFT run · Space jump · E interact · LMB attack/cast · <b>I</b> bag · <b>C</b> craft · <b>M</b> map</div>
  </div>
</div>

<div id="hud" class="hidden">
  <div id="cinema" class="hidden"><div class="bar top"></div><div class="bar bottom"></div>
    <button id="skipBtn" data-act="skip">SKIP ⏭</button></div>

  <div class="stats">
    <div class="stat"><label data-i18n="health">Health</label><div class="bar"><i id="bHealth"></i></div></div>
    <div class="stat"><label data-i18n="stamina">Stamina</label><div class="bar"><i id="bStamina"></i></div></div>
    <div class="stat"><label data-i18n="food">Food</label><div class="bar"><i id="bFood"></i></div></div>
    <div class="stat"><label data-i18n="water">Water</label><div class="bar"><i id="bWater"></i></div></div>
    <div class="stat"><label data-i18n="warmth">Warmth</label><div class="bar"><i id="bWarmth"></i></div></div>
    <div class="stat hidden" id="breathRow"><label data-i18n="breath">Breath</label><div class="bar"><i id="bBreath"></i></div></div>
  </div>

  <div class="topbar">
    <div id="objective"><b data-i18n="objectives">OBJECTIVE</b><span id="objText">—</span></div>
    <div id="clock">07:20</div>
  </div>

  <div class="mapWrap"><canvas id="minimap" width="190" height="190"></canvas>
    <div class="mapLegend"><span class="dot you"></span> you <span class="dot obj"></span> goal</div></div>

  <div id="prompt" class="hidden"><kbd>E</kbd><span id="promptText"></span></div>
  <div id="crosshair"></div>
  <div id="messages"></div>
  <div id="subtitle" class="hidden"><b id="subName"></b><span id="subText"></span></div>
  <div id="chapter" class="hidden"><div class="cTitle">—</div><div class="cSub">—</div></div>
  <div id="toast" class="hidden"></div>

  <div id="fishPanel" class="hidden">
    <div class="fTitle">🎣 <span id="fishName">—</span></div>
    <div class="tension"><div class="zone" id="tZone"></div><i id="tNeedle"></i></div>
    <div class="dist"><i id="fDist"></i></div>
    <div class="fHint" id="fishHint">Hold LMB to reel · release to give line</div>
  </div>

  <div id="biteFlash" class="hidden">!</div>

  <div id="damage"></div>
  <div id="underwater"></div>

  <div id="touch" class="hidden">
    <div id="stick"><i></i></div>
    <div class="tbtns">
      <button data-act="jump">⤒</button>
      <button data-act="sprint">»</button>
      <button data-act="use">E</button>
      <button data-act="attack">⚔</button>
      <button data-act="fish">🎣</button>
      <button data-act="crouch">▼</button>
    </div>
  </div>
</div>

<div id="panel" class="hidden">
  <div class="panelInner">
    <div class="panelTabs">
      <button data-tab="inv" data-i18n="inventory">INVENTORY</button>
      <button data-tab="craft" data-i18n="crafting">CRAFTING</button>
      <button data-tab="log" data-i18n="journal">JOURNAL</button>
      <button data-tab="help" data-i18n="controls">CONTROLS</button>
    </div>
    <div id="panelBody"></div>
    <div class="panelFoot"><span data-i18n="close">CLOSE (Esc)</span></div>
  </div>
</div>

<div id="pause" class="screen hidden">
  <div class="menuBox">
    <h1>TSUNAMI</h1>
    <p class="tagline">survive the wave — عيش بعد الموجة</p>
    <button class="btn" data-act="resume" data-i18n="resume">RESUME</button>
    <button class="btn" data-act="restart" data-i18n="restart">RESTART</button>
    <div class="row">
      <button class="btn small" data-act="lang" data-i18n="lang">ARABIC</button>
      <button class="btn small" data-act="sound">🔊 <span data-i18n="sound">SOUND</span></button>
      <button class="btn small" data-act="quality">Q: <span id="qLabel">HIGH</span></button>
    </div>
    <div class="controlsList">
      <div><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move · <kbd>Shift</kbd> run · <kbd>Space</kbd> jump · <kbd>C</kbd> crouch</div>
      <div><kbd>E</kbd> interact / harvest · <kbd>LMB</kbd> attack · <kbd>RMB</kbd> aim/hook · <kbd>Q</kbd> throw spear/flare</div>
      <div><kbd>F</kbd> enter/exit vehicle · <kbd>I</kbd> bag · <kbd>C</kbd> craft · <kbd>M</kbd> map · <kbd>V</kbd> 1st/3rd person</div>
      <div><kbd>1..9</kbd> quick use · <kbd>G</kbd> place structure · <kbd>T</kbd> torch · <kbd>H</kbd> help</div>
    </div>
  </div>
</div>

<div id="dead" class="screen hidden">
  <div class="menuBox">
    <h1 class="red" data-i18n="dead">You did not make it…</h1>
    <p id="deadReason"></p>
    <button class="btn" data-act="restart" data-i18n="respawn">TRY AGAIN</button>
  </div>
</div>

<div id="end" class="screen hidden">
  <div class="menuBox">
    <h1>🛟 RESCUED</h1>
    <p class="tagline">You survived the wave and made it off the mountain.</p>
    <div id="endStats"></div>
    <button class="btn" data-act="restart" data-i18n="play again">Play again</button>
  </div>
</div>
`;
    // cache elements
    const q = (s) => this.root.querySelector(s);
    this.el = {
      loading: q('#loading'), loadBar: q('.loadBar i'), loadPct: q('.loadPct'), startBtn: q('#startBtn'),
      hud: q('#hud'), bHealth: q('#bHealth'), bStamina: q('#bStamina'), bFood: q('#bFood'), bWater: q('#bWater'),
      bWarmth: q('#bWarmth'), bBreath: q('#bBreath'), breathRow: q('#breathRow'),
      objText: q('#objText'), clock: q('#clock'), prompt: q('#prompt'), promptText: q('#promptText'),
      messages: q('#messages'), subtitle: q('#subtitle'), subName: q('#subName'), subText: q('#subText'),
      chapter: q('#chapter'), toast: q('#toast'), fishPanel: q('#fishPanel'), fishName: q('#fishName'),
      tZone: q('#tZone'), tNeedle: q('#tNeedle'), fDist: q('#fDist'), fishHint: q('#fishHint'),
      biteFlash: q('#biteFlash'), damage: q('#damage'), underwater: q('#underwater'), panel: q('#panel'),
      panelBody: q('#panelBody'), pause: q('#pause'), dead: q('#dead'), deadReason: q('#deadReason'),
      end: q('#end'), endStats: q('#endStats'), minimap: q('#minimap'), cinema: q('#cinema'),
      skipBtn: q('#skipBtn'), touch: q('#touch'), qLabel: q('#qLabel'), stick: q('#stick'),
    };
    // wire buttons
    this.root.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const act = b.dataset.act || (b.dataset.tab ? 'tab:' + b.dataset.tab : null);
      if (act) this.onAction(act);
    });
    this._touchSetup();
    this._mapBase = null;
  }

  /* ---------------------------------------------------------------- loading */
  setLoading(p, text) {
    this.el.loadBar.style.width = `${Math.round(clamp01(p) * 100)}%`;
    this.el.loadPct.textContent = `${Math.round(clamp01(p) * 100)}%`;
    if (text) this.el.loading.querySelector('.loadTitle').textContent = text;
  }
  showStart() { this.el.startBtn.classList.remove('hidden'); }
  hideLoading() { this.el.loading.classList.add('hidden'); this.el.hud.classList.remove('hidden'); }

  /* ------------------------------------------------------------------ hud */
  message(text, dur = 4) {
    const d = document.createElement('div');
    d.className = 'msg';
    d.textContent = text;
    this.el.messages.appendChild(d);
    setTimeout(() => { d.classList.add('out'); setTimeout(() => d.remove(), 600); }, dur * 1000);
    while (this.el.messages.children.length > 6) this.el.messages.firstChild.remove();
  }
  chapter(title, sub = '', dur = 5) {
    this.el.chapter.querySelector('.cTitle').textContent = title;
    this.el.chapter.querySelector('.cSub').textContent = sub;
    this.el.chapter.classList.remove('hidden');
    this.el.chapter.classList.remove('show');
    void this.el.chapter.offsetWidth;
    this.el.chapter.classList.add('show');
    clearTimeout(this._chTimer);
    this._chTimer = setTimeout(() => this.el.chapter.classList.add('hidden'), dur * 1000);
  }
  objective(text) { if (text) this.el.objText.textContent = text; }
  prompt(text) {
    if (!text) { this.el.prompt.classList.add('hidden'); return; }
    this.el.promptText.textContent = text;
    this.el.prompt.classList.remove('hidden');
  }
  dialogue(name, text) {
    this.el.subName.textContent = name;
    this.el.subText.textContent = text;
    this.el.subtitle.classList.remove('hidden');
    clearTimeout(this._subT);
    this._subT = setTimeout(() => this.el.subtitle.classList.add('hidden'), 2200 + text.length * 60);
  }
  flash(kind) {
    if (kind === 'bite') {
      this.el.biteFlash.classList.remove('hidden');
      this.el.biteFlash.classList.add('bang');
      setTimeout(() => { this.el.biteFlash.classList.add('hidden'); this.el.biteFlash.classList.remove('bang'); }, 700);
    } else if (kind === 'quake') {
      this.el.damage.classList.add('quake');
      setTimeout(() => this.el.damage.classList.remove('quake'), 900);
    } else if (kind === 'bad') {
      this.el.damage.classList.add('flash');
      setTimeout(() => this.el.damage.classList.remove('flash'), 260);
    }
  }
  celebrate(fish) {
    const el = document.createElement('div');
    el.className = 'catchCard';
    el.innerHTML = `<div class="ico">${fish.icon}</div><div><b>${fish.name}</b><span>${fish.weight} kg · +${fish.value} pts</span></div>`;
    this.el.hud.appendChild(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 500); }, 2600);
  }
  showCinema(on) { this.el.cinema.classList.toggle('hidden', !on); }
  showDead(reason) {
    this.el.deadReason.textContent = reason || '';
    this.el.dead.classList.remove('hidden');
  }
  showEnd(stats) {
    this.el.endStats.innerHTML = Object.entries(stats).map(([k, v]) => `<div class="endRow"><span>${k}</span><b>${v}</b></div>`).join('');
    this.el.end.classList.remove('hidden');
  }

  /* ------------------------------------------------------------- per-frame */
  update(dt, s) {
    const p = s.player;
    const set = (el, v, invert = false) => {
      const val = clamp01(v / 100);
      el.style.width = `${(val * 100).toFixed(1)}%`;
      el.style.background = invert
        ? (val > 0.5 ? '#6ee7a8' : val > 0.25 ? '#f6c453' : '#ef6461')
        : (val > 0.55 ? 'linear-gradient(90deg,#7dd3fc,#38bdf8)' : val > 0.25 ? 'linear-gradient(90deg,#fbbf24,#f97316)' : 'linear-gradient(90deg,#ef4444,#b91c1c)');
    };
    set(this.el.bHealth, p.health);
    set(this.el.bStamina, p.stamina);
    set(this.el.bFood, p.hunger);
    set(this.el.bWater, p.thirst);
    set(this.el.bWarmth, p.warmth);
    this.el.breathRow.classList.toggle('hidden', !(p.underwater || p.breath < 99));
    set(this.el.bBreath, p.breath);
    // clock from the sky time of day
    if (s.clock) this.el.clock.textContent = s.clock;
    // damage overlay
    const dmg = clamp01(1 - p.health / 45) * (p.health < 45 ? 1 : 0);
    this.el.damage.style.opacity = (dmg * 0.7 + (p.bleeding || 0) * 0.25).toFixed(2);
    this.el.underwater.style.opacity = p.underwater ? '1' : '0';
    // fishing panel
    const f = s.fishing;
    if (f && ['waiting', 'bite', 'fight', 'charging', 'flying'].includes(f.state)) {
      this.el.fishPanel.classList.remove('hidden');
      if (f.state === 'fight' && f.fish) {
        this.el.fishName.textContent = f.fish.name;
        const zoneMin = 34 + f.fish.fight * 12, zoneMax = 78;
        const zn = this.el.tZone.style;
        zn.left = `${zoneMin}%`; zn.width = `${zoneMax - zoneMin}%`;
        this.el.tNeedle.style.left = `${clamp01(f.tension / 100) * 100}%`;
        this.el.fDist.style.width = `${clamp01(1 - f.distance / Math.max(1, f.maxDistance)) * 100}%`;
        this.el.fishHint.textContent = f.lowPull ? 'Careful! It is running — give line (RMB)' : 'Hold LMB to reel · RMB to give line';
      } else {
        this.el.fishName.textContent = f.state === 'bite' ? 'BITE! Press LMB!' : f.state === 'waiting' ? 'waiting for a bite…' : f.state === 'charging' ? `power ${Math.round(f.power * 100)}%` : 'casting…';
        this.el.tNeedle.style.left = `${f.power * 100}%`;
        this.el.tZone.style.width = '0%';
        this.el.fDist.style.width = '0%';
        this.el.fishHint.textContent = f.state === 'waiting' ? 'LMB to reel in early' : '';
      }
    } else this.el.fishPanel.classList.add('hidden');
    // minimap
    this.drawMinimap(s);
  }

  /* --------------------------------------------------------------- minimap */
  drawMinimap(s) {
    const c = this.el.minimap;
    const x = c.getContext('2d');
    const world = s.world, p = s.player;
    const S = c.width;
    if (!this._mapBase) {
      const off = document.createElement('canvas');
      off.width = off.height = 160;
      const ox = off.getContext('2d');
      const img = ox.createImageData(160, 160);
      for (let j = 0; j < 160; j++) for (let i = 0; i < 160; i++) {
        const wx = -world.half + (i / 159) * world.size;
        const wz = -world.half + (j / 159) * world.size;
        const h = world.heightAt(wx, wz);
        const o = (j * 160 + i) * 4;
        let r, g, b;
        if (h < 0) { const t = clamp01(-h / 18); r = 30 - t * 20; g = 70 - t * 40; b = 130 - t * 60; }
        else if (h < 4) { r = 214; g = 194; b = 150; }
        else if (h < 40) { r = 96 + h; g = 120 + h * 0.4; b = 70; }
        else if (h < 160) { r = 120 + h * 0.3; g = 118 + h * 0.2; b = 96; }
        else if (h < 300) { r = 150; g = 140; b = 128; }
        else { r = 230; g = 235; b = 240; }
        img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
      }
      const tmp = document.createElement('canvas');
      tmp.width = tmp.height = 160;
      tmp.getContext('2d').putImageData(img, 0, 0);
      ox.drawImage(tmp, 0, 0);
      this._mapBase = off;
    }
    const range = 320;
    x.clearRect(0, 0, S, S);
    x.save();
    x.beginPath(); x.arc(S / 2, S / 2, S / 2 - 3, 0, TAU); x.clip();
    const scale = S / (range * 2);
    const toPx = (wx, wz) => [S / 2 + (wx - p.pos.x) * scale, S / 2 - (wz - p.pos.z) * scale];
    x.fillStyle = '#0b1220';
    x.fillRect(0, 0, S, S);
    const b = this._mapBase;
    const [px0, py0] = toPx(-world.half, world.half);
    x.imageSmoothingEnabled = true;
    x.globalAlpha = 0.95;
    x.drawImage(b, px0, py0, world.size * scale, world.size * scale);
    x.globalAlpha = 1;
    // roads
    x.strokeStyle = 'rgba(240,230,200,0.5)';
    x.lineWidth = 1.6;
    for (const road of world.roads) {
      x.beginPath();
      road.samples.forEach((sp, i) => {
        const [sx, sy] = toPx(sp.x, sp.z);
        if (i === 0) x.moveTo(sx, sy); else x.lineTo(sx, sy);
      });
      x.stroke();
    }
    // water overlay when flooded
    if (s.flood > 0.4) {
      x.fillStyle = `rgba(40,110,150,${clamp01(s.flood / 18) * 0.4})`;
      x.beginPath();
      const floodPx = s.flood * scale;
      x.moveTo(0, 0);
      // simple: fill from the left (sea side is -x → screen left is -x)
      const coastPx = toPx(world.coastX(p.pos.z), 0)[0];
      x.rect(0, 0, Math.max(0, coastPx + floodPx), S);
      x.fill();
    }
    // markers
    for (const v of s.vehicles || []) {
      const [vx, vy] = toPx(v.pos.x, v.pos.z);
      if (vx < 0 || vx > S || vy < 0 || vy > S) continue;
      x.fillStyle = v.kind === 'boat' ? '#7dd3fc' : (v === s.heroVehicle ? '#facc15' : '#cbd5e1');
      x.fillRect(vx - 2, vy - 2, 4, 4);
    }
    if (s.goal) {
      const [gx, gy] = toPx(s.goal.x, s.goal.z);
      x.fillStyle = '#fbbf24';
      x.beginPath(); x.arc(clamp(gx, 6, S - 6), clamp(gy, 6, S - 6), 5, 0, TAU); x.fill();
      x.strokeStyle = '#111'; x.lineWidth = 1; x.stroke();
    }
    // player arrow
    x.save();
    x.translate(S / 2, S / 2);
    x.rotate(-p.yaw + Math.PI);
    x.fillStyle = '#38bdf8';
    x.beginPath(); x.moveTo(0, -7); x.lineTo(5, 6); x.lineTo(0, 3); x.lineTo(-5, 6); x.closePath(); x.fill();
    x.restore();
    x.restore();
    x.strokeStyle = 'rgba(255,255,255,0.25)';
    x.beginPath(); x.arc(S / 2, S / 2, S / 2 - 3, 0, TAU); x.stroke();
  }

  /* ---------------------------------------------------------------- panels */
  openPanel(tab, ctx) {
    this.panelTab = tab || this.panelTab || 'inv';
    this.el.panel.classList.remove('hidden');
    this.renderPanel(ctx);
  }
  closePanel() { this.el.panel.classList.add('hidden'); }
  get panelOpen() { return !this.el.panel.classList.contains('hidden'); }

  renderPanel(ctx = {}) {
    const body = this.el.panelBody;
    const inv = ctx.inv;
    if (this.panelTab === 'inv') {
      const list = inv ? inv.list() : [];
      body.innerHTML = `<div class="grid">${list.map((s) => {
        const it = ITEMS[s.id];
        const usable = ['food', 'drink', 'med'].includes(it.kind);
        return `<div class="slot" data-item="${s.id}" title="${it.desc || ''}">
          <div class="ico">${it.icon}</div><div class="nm">${it.name}</div><div class="qt">×${s.qty}</div>
          ${usable ? `<button class="mini" data-act="use:${s.id}" data-i18n="use">USE</button>` : ''}
          ${it.kind === 'tool' && s.id === 'rod' ? `<button class="mini" data-act="equiprod">🎣</button>` : ''}
          ${it.kind === 'quest' && s.id === 'flare' ? `<button class="mini" data-act="flare">🔥</button>` : ''}
        </div>`;
      }).join('')}</div>`;
      if (!list.length) body.innerHTML = '<p class="dim">Your bag is empty. Harvest sticks, stone, fibre and berries.</p>';
    } else if (this.panelTab === 'craft') {
      body.innerHTML = `<div class="recipes">${RECIPES.map((r) => {
        const can = inv ? inv.has(r.cost) : false;
        const cost = Object.entries(r.cost).map(([k, v]) => {
          const has = inv ? inv.count(k) : 0;
          return `<span class="cost ${has >= v ? 'ok' : 'no'}">${ITEMS[k] ? ITEMS[k].icon : k} ${has}/${v}</span>`;
        }).join('');
        return `<div class="recipe ${can ? '' : 'no'}">
          <div class="rHead">${ITEMS[r.out[0]].icon} <b>${r.label}</b>${r.station ? ' <em>(fire)</em>' : ''}</div>
          <div class="rCost">${cost}</div>
          <button class="mini" data-act="craft:${r.id}" ${can ? '' : 'disabled'}>${this.t('craft')}</button>
        </div>`;
      }).join('')}</div>`;
    } else if (this.panelTab === 'log') {
      const f = ctx.fishing;
      const log = f ? f.log : {};
      const rows = Object.entries(log).map(([k, v]) => `<div class="endRow"><span>${k}</span><b>${v.count} · best ${v.best} kg</b></div>`).join('') || '<p class="dim">Nothing caught yet. Repair a rod and fish off the pier.</p>';
      const st = ctx.stats || {};
      body.innerHTML = `<h3>${this.t('fishCaught')}</h3>${rows}
        <h3>${this.t('survived')}</h3>
        <div class="endRow"><span>Day</span><b>${st.days || 1}</b></div>
        <div class="endRow"><span>Wood chopped</span><b>${st.treesChopped || 0}</b></div>
        <div class="endRow"><span>Structures built</span><b>${st.structuresBuilt || 0}</b></div>
        <div class="endRow"><span>Animals hunted</span><b>${st.animalsHunted || 0}</b></div>
        <div class="endRow"><span>Townsfolk saved</span><b>${st.peopleSaved || 0}</b></div>`;
    } else {
      body.innerHTML = `<div class="helpGrid">
        <div><kbd>W A S D</kbd> move · <kbd>Shift</kbd> sprint · <kbd>Space</kbd> jump · <kbd>C</kbd> crouch</div>
        <div><kbd>E</kbd> interact / harvest / cook · <kbd>G</kbd> build menu</div>
        <div><kbd>LMB</kbd> attack · throw spear when aiming · cast the rod</div>
        <div><kbd>RMB</kbd> give line (fishing) · aim</div>
        <div><kbd>F</kbd> enter / leave a vehicle · <kbd>Q</kbd> horn/flare</div>
        <div><kbd>1</kbd>..<kbd>6</kbd> quick slots · <kbd>T</kbd> torch · <kbd>N</kbd> night</div>
        <div><kbd>I</kbd> bag · <kbd>C</kbd> crafting · <kbd>J</kbd> journal · <kbd>M</kbd> map</div>
        <div>Touch: left stick moves, right buttons act.</div>
      </div>`;
    }
    const btns = body.querySelectorAll('button[data-act]');
    btns.forEach((b) => b.addEventListener('click', () => this.onAction(b.dataset.act)));
  }

  /* --------------------------------------------------------- touch controls */
  _touchSetup() {
    const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
    if (!isTouch) return;
    this.touch.active = true;
    this.el.touch.classList.remove('hidden');
    const stick = this.el.stick;
    const knob = stick.querySelector('i');
    const start = (e) => {
      const t = e.changedTouches[0];
      const r = stick.getBoundingClientRect();
      this.touch.stick.id = t.identifier;
      this.touch.stick.cx = r.left + r.width / 2;
      this.touch.stick.cy = r.top + r.height / 2;
    };
    const move = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== this.touch.stick.id) continue;
        const dx = t.clientX - this.touch.stick.cx;
        const dy = t.clientY - this.touch.stick.cy;
        const r = stick.getBoundingClientRect().width / 2;
        const l = Math.min(1, Math.hypot(dx, dy) / (r * 0.85));
        const ang = Math.atan2(dy, dx);
        this.touch.stick.x = Math.cos(ang) * l;
        this.touch.stick.y = Math.sin(ang) * l;
        knob.style.transform = `translate(${Math.cos(ang) * l * r * 0.6}px, ${Math.sin(ang) * l * r * 0.6}px)`;
      }
    };
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== this.touch.stick.id) continue;
        this.touch.stick.id = null;
        this.touch.stick.x = 0; this.touch.stick.y = 0;
        knob.style.transform = 'translate(0,0)';
      }
    };
    stick.addEventListener('touchstart', start, { passive: true });
    stick.addEventListener('touchmove', move, { passive: true });
    stick.addEventListener('touchend', end, { passive: true });
    stick.addEventListener('touchcancel', end, { passive: true });
    this.el.touch.querySelectorAll('.tbtns button').forEach((b) => {
      const act = b.dataset.act;
      const on = (e) => { e.preventDefault(); this.touch.buttons[act] = true; this.onAction('touch:' + act); };
      const off = (e) => { e.preventDefault(); this.touch.buttons[act] = false; };
      b.addEventListener('touchstart', on, { passive: false });
      b.addEventListener('touchend', off, { passive: false });
      b.addEventListener('touchcancel', off, { passive: false });
    });
  }
  get touchInput() {
    const s = this.touch.stick;
    return {
      forward: s.y < -0.25 || !!this.touch.buttons.jump,
      back: s.y > 0.3,
      left: s.x < -0.25,
      right: s.x > 0.25,
      sprint: !!this.touch.buttons.sprint,
      jump: !!this.touch.buttons.jump,
      crouch: !!this.touch.buttons.crouch,
      use: !!this.touch.buttons.use,
      attack: !!this.touch.buttons.attack,
      lookX: s.x * 1.4,
    };
  }
  consumeTouchButton(name) { if (this.touch.buttons[name]) { this.touch.buttons[name] = false; return true; } return false; }
}
