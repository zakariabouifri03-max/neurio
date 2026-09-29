// الواجهة: HUD، القوائم، الوصفات، أزرار اللمس — ui.js
import { ITEMS, RECIPES, STRUCTURES, STAGES, RECIPE_BY_ID } from './data.js';
import { clamp, clockText, nightAmount } from './util.js';
import { hourOf } from './entities.js';

const $ = (s, r = document) => r.querySelector(s);

export class UI {
  constructor(game) {
    this.g = game;
    this.openPanel = null;
    this.touch = false;
    this.joy = { x: 0, y: 0, active: false, id: null };
  }

  build() {
    const root = document.getElementById('ui');
    this.root = root;
    this.touch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
    root.innerHTML = `
    <div id="fxOverlay"></div>
    <div id="fadeOverlay"></div>
    <div id="hud">
      <div id="topbar">
        <div class="panel" id="clockPanel">
          <canvas id="skyDial" width="46" height="46"></canvas>
          <div id="clockText">
            <div id="dayLine">نهار 1</div>
            <div id="timeLine">07:30</div>
          </div>
        </div>
        <div id="topbtns">
          <button class="iconbtn" id="btnCraft" title="الوصفات (C)">🛠️</button>
          <button class="iconbtn" id="btnBag" title="الشنطة (I)">🎒</button>
          <button class="iconbtn" id="btnHelp" title="مساعدة (H)">❓</button>
          <button class="iconbtn" id="btnSound" title="الصوت (M)">🔊</button>
          <button class="iconbtn" id="btnMenu" title="القائمة (ESC)">☰</button>
        </div>
      </div>

      <div id="goalPanel" class="panel">
        <div id="stageName">المرحلة 1 — أول نهار</div>
        <div id="goalList"></div>
      </div>

      <div id="sidebars" class="panel">
        <div class="bar"><span class="bi">❤️</span><div class="track"><div class="fill hp" id="barHp"></div></div></div>
        <div class="bar"><span class="bi">🍗</span><div class="track"><div class="fill hunger" id="barHunger"></div></div></div>
        <div class="bar"><span class="bi">💧</span><div class="track"><div class="fill thirst" id="barThirst"></div></div></div>
        <div class="bar"><span class="bi">⚡</span><div class="track"><div class="fill stam" id="barStam"></div></div></div>
      </div>

      <canvas id="minimap" width="150" height="150" class="panel"></canvas>
      <div id="warnBox"></div>
      <div id="toasts"></div>
      <div id="prompt" class="hidden"><span id="promptIcon">✋</span><span id="promptText"></span></div>

      <div id="hotbar"></div>

      <div id="touchLayer" class="hidden">
        <div id="joy"><div id="joyKnob"></div></div>
        <button id="btnAction" class="tbtn big">⚡</button>
        <button id="btnRun" class="tbtn">👟</button>
      </div>
    </div>

    <div class="screen hidden" id="screenMenu">
      <div class="card">
        <h1>🏝️ جزيرة</h1>
        <p class="sub">نجاة · بناء · دجاج · وبحر</p>
        <p class="story">وقعت فجزيرة خاوية. قطع الشجر، حجّر، اربّي الدجاج، بني القارب… ودير البحر! 🌊</p>
        <div class="row">
          <button class="btn primary" id="btnNew">🌱 لعبة جديدة</button>
          <button class="btn" id="btnContinue">💾 كمّل</button>
          <button class="btn" id="btnHelp2">❓ كيفاش نلعب</button>
        </div>
        <div class="row small" id="modeRow">
          <span class="hint" style="margin:0;align-self:center">الكاميرا:</span>
          <button class="btn tab" id="btnMode3d" data-mode="3d">🧊 ثلاثي الأبعاد 3D</button>
          <button class="btn tab" id="btnMode2d" data-mode="2d">🗺️ من الفوق 2D</button>
        </div>
        <div class="hint">بلا ماوس: <b class="keyhint">WASD</b> باش تمشي، <b class="keyhint">SPACE</b> لكل حاجة — <span id="modeHint">3D: دير الدورة بالماوس (سحب) وبالعجلة تقرّب</span></div>
        <div class="hint" id="modeNote" style="opacity:.85"></div>
      </div>
    </div>

    <div class="screen hidden" id="screenHelp">
      <div class="card wide">
        <h2>❓ كيفاش نلعب</h2>
        <div class="helpGrid">
          <div>
            <h3>🕹️ الحركة</h3>
            <ul>
              <li><b>WASD / الأسهم</b> — المشي</li>
              <li><b>SHIFT</b> — الجري (كيستعمل الطاقة)</li>
              <li><b class="keyhint">SPACE</b> — ⚡ الحاجة الأساسية (قطع، جمع، هدرة، ركوب)</li>
              <li><b>C</b> — الوصفات 🛠️ · <b>I</b> — الشنطة 🎒 · <b>ESC</b> — القائمة</li>
              <li>فالتيليفون: عصا التحكم فالجنب + زر ⚡</li>
            </ul>
            <h3>🎥 الكاميرا (3D)</h3>
            <ul>
              <li><b>سحب بالماوس</b> ولا اللمس — دوّر الكاميرا</li>
              <li><b>عجلة الماوس</b> ولا القرصة بجوج صوابع — قرّب/بعّد</li>
              <li><b>Q</b> / <b>E</b> — دوران سريع · <b>Z</b> / <b>X</b> — الزوم</li>
              <li>اللاعب كيمشي بالنسبة للكاميرا (W = قدّام)</li>
            </ul>
          </div>
          <div>
            <h3>🎯 الهدف</h3>
            <ul>
              <li>7 مراحل: من النجاة… حتى القارب ⛵</li>
              <li>قطع 🌴 الشجر بيدك، وحجّر 🪨 (المعول ضروري)، وقطع العشب 🌾</li>
              <li>صنع 🪓 الفأس و ⛏️ المعول باش تولي أسرع</li>
              <li>بني 🔥 النار و 🏠 الكوخ قبل ما يجي الليل (البرد كيضرّك)</li>
              <li>ربّي الدجاج: دير بزر 🌱 فاليد، وقف حداه — كتقرب ليك بوحدها. عطيه 3 مرات ومن بعد دوّزو لقفص 🐔</li>
              <li>كول 🥥 وشرب 💧 — الجوع والعطش كيخسرو الصحة</li>
              <li>جمع 🪵🪨🌾 و 🔨 بني القارب وخرج من الجزيرة!</li>
            </ul>
          </div>
          <div>
            <h3>💡 نصايح</h3>
            <ul>
              <li>الشجر كيرجع يخرج من بعد شوية — دور على أماكن جديدة</li>
              <li>النخلة كتعطي جوز هند 🥥 (جوع + عطش)</li>
              <li>الخنزير 🐗 كيهجم بالليل — بالك! اضربو بالـ⚡ باش يهرب</li>
              <li>النار كتعطي ضوا وتطيّب الماكلة</li>
              <li>الحفظ تلقائي (كل 30 ثانية، وحتى ملي تسد الصفحة) 💾</li>
            </ul>
          </div>
        </div>
        <div class="row"><button class="btn primary" id="btnHelpClose">فهمت ✔</button></div>
      </div>
    </div>

    <div class="screen hidden" id="screenCraft">
      <div class="card wide">
        <div class="head">
          <h2>🛠️ الوصفات</h2>
          <div class="row small">
            <button class="btn tab active" data-tab="build">🏗️ بناء</button>
            <button class="btn tab" data-tab="tool">🪓 أدوات</button>
            <button class="btn tab" data-tab="item">📦 حوايج</button>
            <button class="btn tab" data-tab="eat">🍽️ ماكلة</button>
          </div>
          <button class="btn x" id="btnCraftClose">✕</button>
        </div>
        <div id="craftList" class="list"></div>
      </div>
    </div>

    <div class="screen hidden" id="screenBag">
      <div class="card">
        <div class="head"><h2>🎒 الشنطة</h2><button class="btn x" id="btnBagClose">✕</button></div>
        <div id="bagList" class="list"></div>
      </div>
    </div>

    <div class="screen hidden" id="screenPause">
      <div class="card">
        <h2>☰ القائمة</h2>
        <div class="row col">
          <button class="btn primary" id="btnResume">▶ كمّل اللعب</button>
          <button class="btn" id="btnHowto">❓ كيفاش نلعب</button>
          <button class="btn hidden" id="btnShadows">🌑 الظلال: شاعلة</button>
          <button class="btn" id="btnSaveNow">💾 سجّل دابا</button>
          <button class="btn danger" id="btnRestart">🌱 جزيرة جديدة</button>
        </div>
        <div class="hint">موقع اللعبة: جزيرة رقم ${'—'}</div>
      </div>
    </div>

    <div class="screen hidden" id="screenStage">
      <div class="card">
        <h2 id="stageDoneTitle">🎉 مرحلة كاملة!</h2>
        <p id="stageDoneBody"></p>
        <div id="nextGoals" class="goals"></div>
        <div class="row"><button class="btn primary" id="btnNextStage">يلا نكمل ▶</button></div>
      </div>
    </div>

    <div class="screen hidden" id="screenDead">
      <div class="card">
        <h2>💀 خسرتي الوعي…</h2>
        <p>الجزيرة قاسحة! ولكن مازال عندك فرصة.</p>
        <div class="row"><button class="btn primary" id="btnRespawn">🏕️ رجع للمخيم</button></div>
      </div>
    </div>

    <div class="screen hidden" id="screenWin">
      <div class="card">
        <h2>⛵🎉 نجيتي!</h2>
        <p class="story">طلعتي فالقارب ودرتي البحر — الجزيرة خلّاتك ورا ظهرك 🌊</p>
        <div id="winStats" class="goals"></div>
        <div class="row">
          <button class="btn primary" id="btnPlayAgain">🌱 جزيرة جديدة</button>
        </div>
      </div>
    </div>

    <div class="screen hidden" id="screenTut">
      <div class="card">
        <h2>🌴 أول خطوة</h2>
        <p>سير للشجرة 🌴 ولا الحجر الصغير 🪨 ولا العشب 🌾 وقرب ليهم… ومن بعد كليكي على <b class="keyhint">⚡ SPACE</b> باش تقطع وتجمع.</p>
        <p class="hint">قطع <b>10 خشب</b> · <b>6 حجر</b> · <b>8 ألياف</b> باش تكمّل المرحلة الأولى</p>
        <div class="row"><button class="btn primary" id="btnTutOk">يلا ↩</button></div>
      </div>
    </div>
    `;

    this.hud = $('#hud');
    this.els = {
      clock: $('#timeLine'), day: $('#dayLine'), dial: $('#skyDial'),
      barHp: $('#barHp'), barHunger: $('#barHunger'), barThirst: $('#barThirst'), barStam: $('#barStam'),
      stageName: $('#stageName'), goalList: $('#goalList'),
      prompt: $('#prompt'), promptText: $('#promptText'), promptIcon: $('#promptIcon'),
      toasts: $('#toasts'), hotbar: $('#hotbar'), warnBox: $('#warnBox'),
      minimap: $('#minimap'),
      fxOverlay: $('#fxOverlay'), fadeOverlay: $('#fadeOverlay'),
    };
    this.mmCtx = this.els.minimap.getContext('2d');
    this.mapCanvas = null;
    this.mmTimer = 0;
    this.dialCtx = this.els.dial.getContext('2d');

    this.wireEvents();
    if (this.touch) {
      $('#touchLayer').classList.remove('hidden');
      $('#prompt').classList.add('istouch');
      $('#btnAction').textContent = '⚡';
      this.setupTouch();
      this.root.querySelectorAll('.keyhint').forEach((e) => {
        e.textContent = e.textContent.includes('WASD') ? 'عصا التحكم' : 'الزر ⚡';
      });
    }
  }

  wireEvents() {
    const g = this.g;
    const on = (sel, fn) => { const e = $(sel); if (e) e.addEventListener('click', (ev) => { ev.preventDefault(); g.audio.resume(); g.audio.ui(); fn(); }); };
    on('#btnCraft', () => this.open('crafting'));
    on('#btnBag', () => this.open('inventory'));
    on('#btnHelp', () => this.open('help'));
    on('#btnMenu', () => this.open('paused'));
    on('#btnSound', () => { this.g.audio.muted = !this.g.audio.muted; $('#btnSound').textContent = this.g.audio.muted ? '🔇' : '🔊'; });
    on('#btnNew', () => { g.resetSave(); this.hideAll(); g.newGame(); });
    on('#btnContinue', () => { this.hideAll(); g.loadSave(); });
    on('#btnHelp2', () => this.open('help'));
    on('#btnHelpClose', () => this.back());
    on('#btnCraftClose', () => this.back());
    on('#btnBagClose', () => this.back());
    on('#btnResume', () => this.back());
    on('#btnHowto', () => this.open('help'));
    on('#btnSaveNow', () => { g.saveNow(); g.toast('💾 تسجّلت اللعبة', 'good'); });
    on('#btnRestart', () => { g.resetSave(); g.newGame(); this.hideAll(); });
    on('#btnNextStage', () => { this.hideAll(); this.g.state = 'playing'; });
    on('#btnRespawn', () => { this.hideAll(); g.respawn(); });
    on('#btnPlayAgain', () => { this.hideAll(); g.resetSave(); g.newGame(); });
    on('#btnTutOk', () => this.back());
    on('#btnMode3d', () => this.setMode('3d'));
    on('#btnMode2d', () => this.setMode('2d'));
    on('#btnShadows', () => {
      const on = !this.g.view.shadows;
      this.g.view.setQuality(on);
      try { localStorage.setItem('jazira_shadows', on ? '1' : '0'); } catch (e) { }
      $('#btnShadows').textContent = on ? '🌑 الظلال: شاعلة' : '🌑 الظلال: مطافية';
      this.g.toast(on ? '🌑 الظلال شاعلة' : '⚡ الظلال مطافية (أخف)', '');
    });
    document.querySelectorAll('.screen .tab').forEach((t) => {
      t.addEventListener('click', () => {
        document.querySelectorAll('.screen .tab').forEach((x) => x.classList.remove('active'));
        t.classList.add('active');
        this.craftTab = t.dataset.tab;
        this.renderCraft();
      });
    });
  }

  setMode(mode) {
    const url = new URL(location.href);
    url.searchParams.set('mode', mode);
    try { localStorage.setItem('jazira_mode', mode); } catch (e) { }
    location.href = url.toString();
  }

  syncModeButtons() {
    const mode = this.g.view ? this.g.view.type : '3d';
    const b3 = $('#btnMode3d'), b2 = $('#btnMode2d');
    if (b3) b3.classList.toggle('active', mode === '3d');
    if (b2) b2.classList.toggle('active', mode === '2d');
    const hint = $('#modeHint');
    if (hint) hint.textContent = mode === '3d'
      ? '3D: دوّر الكاميرا بالماوس (سحب)، وبالعجلة قرّب/بعّد'
      : '2D: كتشوف الجزيرة من الفوق';
    const sh = $('#btnShadows');
    if (sh) {
      sh.classList.toggle('hidden', mode !== '3d');
      sh.textContent = this.g.view && this.g.view.shadows ? '🌑 الظلال: شاعلة' : '🌑 الظلال: مطافية';
    }
  }

  setupTouch() {
    const g = this.g;
    const joy = $('#joy'), knob = $('#joyKnob');
    const R = 52;
    const center = () => {
      const r = joy.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    };
    const setJoy = (dx, dy) => {
      const d = Math.hypot(dx, dy) || 1;
      const cl = Math.min(1, d / R);
      const nx = (dx / d) * cl, ny = (dy / d) * cl;
      g.input.x = nx; g.input.y = ny;
      knob.style.transform = `translate(${nx * R}px, ${ny * R}px)`;
    };
    const reset = () => { g.input.x = 0; g.input.y = 0; knob.style.transform = 'translate(0,0)'; this.joy.active = false; this.joy.id = null; };
    joy.addEventListener('pointerdown', (e) => {
      this.joy.active = true; this.joy.id = e.pointerId;
      joy.setPointerCapture(e.pointerId);
      const c = center();
      setJoy(e.clientX - c.x, e.clientY - c.y);
      g.audio.resume();
    });
    joy.addEventListener('pointermove', (e) => {
      if (!this.joy.active || e.pointerId !== this.joy.id) return;
      const c = center();
      setJoy(e.clientX - c.x, e.clientY - c.y);
    });
    joy.addEventListener('pointerup', reset);
    joy.addEventListener('pointercancel', reset);

    const runBtn = $('#btnRun');
    const pr = (e) => { e.preventDefault(); g.input.run = !g.input.run; runBtn.classList.toggle('on', g.input.run); };
    runBtn.addEventListener('pointerdown', pr);

    const act = $('#btnAction');
    let hold = null;
    act.addEventListener('pointerdown', (e) => {
      e.preventDefault(); g.audio.resume();
      g.doAction();
      hold = setInterval(() => g.doAction(), 380);
    });
    const stop = () => { if (hold) { clearInterval(hold); hold = null; } };
    act.addEventListener('pointerup', stop);
    act.addEventListener('pointercancel', stop);
    act.addEventListener('pointerleave', stop);
  }

  // ---------- النوافذ ----------
  open(name) {
    const g = this.g;
    if (name === 'crafting') { this.renderCraft(); g.state = g.state === 'playing' ? 'crafting' : g.state; }
    if (name === 'inventory') this.renderBag();
    const map = {
      crafting: '#screenCraft', inventory: '#screenBag', help: '#screenHelp',
      paused: '#screenPause', menu: '#screenMenu', stage: '#screenStage',
      dead: '#screenDead', won: '#screenWin', tut: '#screenTut',
    };
    const el = $(map[name]);
    if (!el) return;
    document.querySelectorAll('.screen').forEach((s) => s.classList.add('hidden'));
    el.classList.remove('hidden');
    this.openPanel = name;
    if (name === 'won' || name === 'dead' || name === 'stage') this.g.state = name === 'won' ? 'won' : name;
    else if (name !== 'help' && name !== 'menu') this.g.state = name;
    this.syncHud();
  }
  show(name) { this.open(name); }
  back() {
    const g = this.g;
    if (this.openPanel === 'help') {
      document.querySelectorAll('.screen').forEach((s) => s.classList.add('hidden'));
      if (g.state === 'help') g.state = g.world ? 'playing' : 'menu';
      if (!g.world) { this.open('menu'); return; }
      this.openPanel = null;
      return;
    }
    this.hideAll();
    if (g.world) { g.state = 'playing'; }
  }
  toggle(name) {
    if (!this.g.world) return;
    if (this.openPanel === name || (this.openPanel === null && (name === 'paused' || name === 'help') && this.g.state === 'paused')) { this.back(); return; }
    const cur = this.openPanel;
    this.open(name);
  }
  hideAll() {
    document.querySelectorAll('.screen').forEach((s) => s.classList.add('hidden'));
    this.openPanel = null;
  }
  showTutorial() { this.open('tut'); }

  showStageComplete() {
    const g = this.g;
    const done = STAGES[g.stageIdx - 1];
    const next = g.stage;
    $('#stageDoneTitle').textContent = `🎉 المرحلة ${done.n} كاملة: ${done.name}`;
    $('#stageDoneBody').innerHTML = `زدتي خطوة كبيرة! دابا: <b>${next.name}</b> — ${next.sub}<br><span class="hint">${next.tip}</span>`;
    const box = $('#nextGoals');
    box.innerHTML = next.goals.map((gl) => `<div class="goal"><span>${gl.icon}</span><span>${gl.label}</span><span class="gv">0/${gl.need}</span></div>`).join('');
    g.state = 'stage';
    this.open('stage');
  }

  // ---------- الخريطة ----------
  buildMinimap(world) {
    const c = document.createElement('canvas');
    c.width = world.w; c.height = world.h;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(world.w, world.h);
    const COL = {
      0: [18, 84, 120], 1: [86, 190, 202], 2: [232, 214, 168], 3: [124, 187, 91],
      4: [92, 152, 75], 5: [158, 160, 166], 6: [104, 186, 206],
    };
    for (let ty = 0; ty < world.h; ty++)
      for (let tx = 0; tx < world.w; tx++) {
        const t = world.tileAt(tx, ty);
        const c3 = COL[t] || [124, 187, 91];
        const i = (ty * world.w + tx) * 4;
        img.data[i] = c3[0]; img.data[i + 1] = c3[1]; img.data[i + 2] = c3[2]; img.data[i + 3] = 255;
      }
    ctx.putImageData(img, 0, 0);
    this.mapCanvas = c;
  }

  drawMinimap() {
    const g = this.g;
    const mm = this.mmCtx;
    if (!mm || !g.world || !this.mapCanvas) return;
    const S = 150;
    mm.clearRect(0, 0, S, S);
    mm.globalAlpha = 0.92;
    mm.drawImage(this.mapCanvas, 0, 0, S, S);
    mm.globalAlpha = 1;
    const sx = S / g.world.w, sy = S / g.world.h;
    const dot = (x, y, r, color, ring) => {
      mm.fillStyle = color;
      mm.beginPath(); mm.arc(x * sx, y * sy, r, 0, Math.PI * 2); mm.fill();
      if (ring) { mm.strokeStyle = ring; mm.lineWidth = 1.4; mm.stroke(); }
    };
    // المخيم
    const camp = g.world.camp;
    if (camp) dot(camp.x / 32, camp.y / 32, 3.4, '#ffd75e', 'rgba(0,0,0,.6)');
    // الدار
    for (const k of ['hut', 'coop', 'bench']) {
      const o = g.world.struct(k);
      if (o) dot(o.x / 32, o.y / 32, 2.4, k === 'hut' ? '#ff9f45' : k === 'coop' ? '#ffd0e0' : '#c9a06a', 'rgba(0,0,0,.5)');
    }
    // القارب
    const boat = g.world.struct('boat');
    if (boat) dot(boat.x / 32, boat.y / 32, 3, (boat.progress ?? 0) >= 1 ? '#7ee08a' : '#8fd8ff', 'rgba(0,0,0,.6)');
    // اللاعب (سهم)
    const px = g.player.x / 32, py = g.player.y / 32;
    mm.save();
    mm.translate(px * sx, py * sy);
    mm.rotate(g.player.dir);
    mm.fillStyle = '#ffffff';
    mm.strokeStyle = 'rgba(0,0,0,.75)';
    mm.lineWidth = 1.2;
    mm.beginPath();
    mm.moveTo(5.4, 0); mm.lineTo(-3.4, -3.6); mm.lineTo(-3.4, 3.6);
    mm.closePath(); mm.fill(); mm.stroke();
    mm.restore();
    // لينا (شعاع الرؤية)
    mm.strokeStyle = 'rgba(255,255,255,.35)';
    mm.lineWidth = 1;
    mm.strokeRect(0.5, 0.5, S - 1, S - 1);
  }

  // ---------- HUD ----------
  syncHud() {
    const g = this.g;
    if (!g.world) return;
    const p = g.player;
    const set = (el, v) => { if (el) el.style.width = clamp(v, 0, 100) + '%'; };
    set(this.els.barHp, p.health);
    set(this.els.barHunger, p.hunger);
    set(this.els.barThirst, p.thirst);
    set(this.els.barStam, p.stamina);
    const hour = hourOf(g.world.time);
    this.els.clock.textContent = clockText(g.world.time);
    this.els.day.textContent = `نهار ${g.day}`;
    // قرص الشمس
    const dc = this.dialCtx;
    if (dc) {
      dc.clearRect(0, 0, 46, 46);
      const cg = dc.createLinearGradient(0, 0, 0, 46);
      const n = nightAmount(hour);
      cg.addColorStop(0, n > 0.5 ? '#101a3a' : '#5fb2e8');
      cg.addColorStop(1, n > 0.5 ? '#26375f' : '#e8d1a0');
      dc.fillStyle = cg; dc.beginPath(); dc.arc(23, 23, 22, 0, Math.PI * 2); dc.fill();
      const a = ((hour - 6) / 24) * Math.PI * 2;
      dc.font = '13px sans-serif'; dc.textAlign = 'center'; dc.textBaseline = 'middle';
      dc.fillText(n > 0.5 ? '🌙' : '☀️', 23 + Math.cos(a) * 14, 23 + Math.sin(a) * 14);
    }
    // المرحلة والأهداف
    const s = g.stage;
    if (s) {
      this.els.stageName.textContent = `المرحلة ${s.n} — ${s.name}`;
      if (this._goalStage !== s.n || this._goalTick !== Math.floor(g.time * 2)) {
        this._goalStage = s.n; this._goalTick = Math.floor(g.time * 2);
        this.els.goalList.innerHTML = s.goals.map((gl) => {
          const v = g.goalValue(gl);
          const done = v >= gl.need;
          return `<div class="goal ${done ? 'done' : ''}"><span>${gl.icon}</span><span>${gl.label}</span><span class="gv">${Math.min(v, gl.need)}/${gl.need} ${done ? '✔' : ''}</span></div>`;
        }).join('');
      }
    }
    // الخريطة
    this.mmTimer -= 1 / 60;
    if (this.mmTimer <= 0) { this.mmTimer = 0.25; this.drawMinimap(); }

    // التحذيرات
    const warns = [];
    if (p.hunger < 22) warns.push('🍗 جوعان');
    if (p.thirst < 22) warns.push('💧 عطشان');
    if (p.cold) warns.push('🥶 برد — سير للنار 🔥');
    if (warns.length) this.els.warnBox.innerHTML = warns.map((w) => `<div class="warn">${w}</div>`).join('');
    else if (this.els.warnBox.innerHTML) this.els.warnBox.innerHTML = '';
    // طبقات الشاشة
    if (this.els.fadeOverlay) this.els.fadeOverlay.style.opacity = clamp(g.fade, 0, 1);
    if (this.els.fxOverlay) {
      const hp = g.player.health;
      const pulse = 0.5 + 0.5 * Math.sin(g.time * 4);
      const red = hp < 35 ? (0.30 + 0.24 * pulse) * (1 - hp / 35) : 0;
      const hurt = (g.player.hurtFlash || 0) * 0.35;
      this.els.fxOverlay.style.opacity = Math.min(0.85, Math.max(red, hurt));
    }

    // المطالبة
    const pr = g.prompt;
    if (pr && g.state === 'playing') {
      this.els.prompt.classList.remove('hidden');
      this.els.promptIcon.textContent = pr.icon || '⚡';
      this.els.promptText.textContent = pr.label;
    } else this.els.prompt.classList.add('hidden');
  }

  syncAll() {
    this.syncInv(); this.syncHud(); this.syncModeButtons();
    if (this.openPanel === 'crafting') this.renderCraft();
    if (this.openPanel === 'inventory') this.renderBag();
  }

  syncInv() {
    const g = this.g;
    if (!g.inv) return;
    const hb = this.els.hotbar;
    const order = ['wood', 'stone', 'fiber', 'seed', 'coconut', 'egg', 'meat', 'cooked', 'omelette', 'resin', 'rope', 'sail'];
    hb.innerHTML = order.map((k) => {
      const n = g.inv[k] || 0;
      if (!n) return '';
      return `<button class="slot" data-k="${k}" title="${ITEMS[k].name}">${ITEMS[k].icon}<span class="n">${n}</span></button>`;
    }).join('') + (g.inv.axe ? `<button class="slot tool" data-k="axe" title="فأس">🪓</button>` : '') + (g.inv.pick ? `<button class="slot tool" data-k="pick" title="معول">⛏️</button>` : '');
    hb.querySelectorAll('.slot').forEach((s) => s.addEventListener('click', () => {
      this.g.audio.ui();
      this.g.useItem(s.dataset.k);
    }));
  }

  renderCraft() {
    const g = this.g;
    // التبويب الافتراضي: الأدوات فالبداية، من بعد البناء
    if (!this.craftTab) this.craftTab = g.inv && g.inv.axe ? 'build' : 'tool';
    const tab = this.craftTab;
    const tabs = document.querySelectorAll('#screenCraft .tab');
    tabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
    const list = $('#craftList');
    if (!list) return;
    const catMap = { build: 'build', tool: 'tool', item: 'item', eat: 'eat' };
    const rows = RECIPES.filter((r) => (catMap[tab] === 'eat' ? r.cat === 'item' && ITEMS[Object.keys(r.out)[0]].food : r.cat === catMap[tab]));
    let html = '';
    if (!rows.length && tab === 'eat') html = '<p class="hint">الماكلة كتطيب فوق النار 🔥 — قرب للنار وضغط ⚡</p>';
    for (const r of rows) {
      const unlocked = g.isUnlocked(r);
      const once = r.once && g.crafted[r.id];
      const already = r.cat === 'build' && g.world && g.world.struct(r.build);
      const can = g.canCraft(r);
      const costs = Object.entries(r.cost).map(([k, n]) => {
        const have = g.inv[k] || 0;
        return `<span class="cost ${have >= n ? 'ok' : 'no'}">${ITEMS[k].icon} ${have}/${n}</span>`;
      }).join('');
      const out = r.cat === 'item' ? `<span class="out">← ${Object.entries(r.out).map(([k, n]) => `${ITEMS[k].icon}${n}`).join('')}</span>` : '';
      let sub = r.desc || '';
      if (!unlocked) sub = `🔒 كيتفتح فالمرحلة ${r.stage}`;
      else if (already) sub = '✅ مبنية';
      else if (once && g.crafted[r.id]) sub = '✅ مصنوعة';
      else if (r.needFire && !(g.world && g.world.struct('campfire'))) sub = '🔥 خاصك نار المخيم';
      else if (r.needBench && !(g.world && g.world.struct('bench'))) sub = '🛠️ خاصك طابلة الخدمة';
      const disabled = !can || already || (once && g.crafted[r.id]);
      html += `<div class="recipe ${disabled ? 'off' : ''}">
        <div class="ricon">${r.icon}</div>
        <div class="rmid">
          <div class="rname">${r.name} ${r.cat === 'tool' ? '<span class="tag">أداة</span>' : ''}${r.cat === 'build' ? '<span class="tag build">بناء</span>' : ''}</div>
          <div class="rsub">${sub}</div>
          <div class="rcost">${costs} ${out}</div>
        </div>
        <button class="btn ${can && !already && !(once && g.crafted[r.id]) ? 'primary' : ''}" data-r="${r.id}" ${disabled ? 'disabled' : ''}>${r.cat === 'build' ? 'بني' : r.cat === 'tool' ? 'صنع' : 'طيّب'}</button>
      </div>`;
    }
    list.innerHTML = html;
    list.querySelectorAll('button[data-r]').forEach((b) => b.addEventListener('click', () => {
      const r = RECIPE_BY_ID[b.dataset.r];
      g.audio.ui();
      if (g.craft(r)) { this.renderCraft(); this.syncInv(); }
    }));
  }

  renderBag() {
    const g = this.g;
    const list = $('#bagList');
    if (!list || !g.inv) return;
    const keys = Object.keys(ITEMS).filter((k) => (g.inv[k] || 0) > 0);
    if (!keys.length) { list.innerHTML = '<p class="hint">الشنطة خاوية… سير قطع الشجر 🌴</p>'; return; }
    list.innerHTML = keys.map((k) => {
      const it = ITEMS[k];
      const usable = it.food || k === 'axe' || k === 'pick';
      return `<div class="recipe">
        <div class="ricon">${it.icon}</div>
        <div class="rmid"><div class="rname">${it.name} ×${g.inv[k]}</div><div class="rsub">${it.desc || ''}</div></div>
        ${usable ? `<button class="btn primary" data-u="${k}">${it.food ? 'كول' : 'خود'}</button>` : `<span class="hint">—</span>`}
      </div>`;
    }).join('');
    list.querySelectorAll('button[data-u]').forEach((b) => b.addEventListener('click', () => {
      g.audio.ui();
      g.useItem(b.dataset.u);
      this.renderBag();
    }));
  }

  // ---------- توست ----------
  toast(msg, tone = '', ms = 2400) {
    if (!this.els.toasts) return;
    const d = document.createElement('div');
    d.className = 'toast ' + tone;
    d.innerHTML = msg;
    this.els.toasts.appendChild(d);
    setTimeout(() => { d.classList.add('out'); setTimeout(() => d.remove(), 400); }, ms);
    while (this.els.toasts.children.length > 5) this.els.toasts.firstChild.remove();
  }

  drawOverlayFx() { /* ولّى بالـDOM: #fxOverlay */ }
}
