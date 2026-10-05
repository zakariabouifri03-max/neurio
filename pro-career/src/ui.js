// ── Pro Career 27 — UI layer ────────────────────────────────────────────────
import { Career, LIFESTYLE, UPKEEP } from './career.js';
import { MOMENT_TYPES, createRunner } from './match.js';
import { overall } from './worldgen.js';
import { ATTR_AR, POS_NAME_AR, fmtMoney, fmtNum, clamp } from './rng.js';
import { LEAGUES, NATIONS, FORMATIONS } from './data.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const el = (html) => { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstElementChild; };

export const State = { career: null, tab: 'home', speed: 1, pitchCtx: null, raf: 0, busy: false };

// ── tiny helpers ─────────────────────────────────────────────────────────────
function toast(msg, kind = '') {
  const t = el(`<div class="toast ${kind}">${msg}</div>`);
  $('#toasts').appendChild(t);
  setTimeout(() => { t.style.transition = 'opacity .4s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 420); }, 3200);
}
function modal(html, opts = {}) {
  const m = $('#modal');
  m.innerHTML = `<div class="box">${html}</div>`;
  m.classList.add('on');
  if (opts.buttons) {
    const row = el('<div class="btn-row"></div>');
    opts.buttons.forEach((b) => {
      const btn = el(`<button class="btn ${b.cls || ''}">${b.label}</button>`);
      btn.onclick = () => { m.classList.remove('on'); b.action && b.action(); };
      row.appendChild(btn);
    });
    $('.box', m).appendChild(row);
  }
  return m;
}
function closeModal() { $('#modal').classList.remove('on'); }
const posGroup = (p) => (p === 'GK' ? 'GK' : p[0] === 'D' ? 'DF' : p[0] === 'M' ? 'MF' : 'FW');
function ovrClass(v) { return v >= 82 ? 'gold' : v >= 74 ? 'acc' : v >= 66 ? '' : 'small'; }
function stars(n) { return '★'.repeat(n) + '☆'.repeat(5 - n); }
function clubBadge(club, size = 30) {
  const [c1, c2] = club.colors || ['#333', '#fff'];
  return `<span class="badge" style="background:linear-gradient(140deg,${c1},${c2});width:${size}px;height:${size}px">${(club.short || 'FC').slice(0, 3)}</span>`;
}

// ── boot ─────────────────────────────────────────────────────────────────────
function boot() {
  $('#screens').innerHTML = '';
  ['create', 'hub', 'match', 'post'].forEach((k) => $('#screens').appendChild(el(`<section class="screen" id="s-${k}"></section>`)));
  renderCreate();
  $('#s-create').classList.add('on');
}
function go(screen) {
  $$('.screen').forEach((s) => s.classList.remove('on'));
  $(`#s-${screen}`).classList.add('on');
  window.scrollTo({ top: 0 });
}

// ═══════════════════════════ CREATE SCREEN ══════════════════════════════════
const Create = { first: '', last: '', nation: 'MAR', pos: 'ST', difficulty: 'normal', skill: null };

function renderCreate() {
  const s = $('#s-create');
  s.innerHTML = `
  <div class="hero">
    <div class="logo">⚽</div>
    <h1>PRO CAREER 27</h1>
    <p>مسيرة لاعب كاملة: من أكاديمية صغيرة حتى الكرة الذهبية وكأس العالم.<br>كل شيء مولّد من الصفر — عوالم، أندية، لاعبين، انتقالات وبطولات.</p>
  </div>
  <div class="card">
    <h3>👤 اللاعب ديالك</h3>
    <div class="field"><label>الاسم الشخصي</label><input id="cFirst" placeholder="Anas" value="${Create.first}"></div>
    <div class="field"><label>اللقب</label><input id="cLast" placeholder="Bennani" value="${Create.last}"></div>
    <div class="field"><label>المنتخب</label><select id="cNation">${NATIONS.map((n) => `<option value="${n[1]}" ${Create.nation === n[1] ? 'selected' : ''}>${n[2]} ${n[0]}</option>`).join('')}</select></div>
    <div class="field"><label>المركز</label><div class="pickgrid" id="cPos">
      ${['ST', 'RW', 'LW', 'AM', 'CM', 'DM', 'CB', 'RB', 'LB', 'GK'].map((p) => `<button class="pick ${Create.pos === p ? 'on' : ''}" data-p="${p}">${POS_NAME_AR[p]}<div class="tiny">${p}</div></button>`).join('')}
    </div></div>
    <div class="field"><label>الدوري اللي كتختار فيه البداية</label><select id="cLeague">
      ${LEAGUES.map((l) => `<option value="${l.country}">${l.flag} ${l.name} (${l.country})</option>`).join('')}
    </select></div>
    <div class="field"><label>الصعوبة</label><div class="pickgrid" id="cDiff">
      ${[['easy', 'سهل', '❇️'], ['normal', 'عادي', '⚖️'], ['hard', 'صعب', '🔥'], ['legend', 'أسطوري', '💀']].map(([k, t, i]) => `<button class="pick ${Create.difficulty === k ? 'on' : ''}" data-d="${k}">${i} ${t}</button>`).join('')}
    </div></div>
    <div class="btn-row">
      <button class="btn blue" id="cSkill">🎮 اختبار المهارات</button>
    </div>
    <div id="cSkillOut" class="small center" style="margin-top:6px">${Create.skill ? skillSummary() : 'اختبار المهارات كيحدد البداية والإمكانيات (اختياري)'}</div>
    <div class="btn-row"><button class="btn primary" id="cStart">🚀 بدا المسيرة</button></div>
  </div>
  <div class="card">
    <h3>💾 مسيرات محفوظة</h3>
    <div class="list" id="saveList"></div>
  </div>`;

  $$('#cPos .pick').forEach((b) => b.onclick = () => { Create.pos = b.dataset.p; $$('#cPos .pick').forEach((x) => x.classList.toggle('on', x === b)); });
  $$('#cDiff .pick').forEach((b) => b.onclick = () => { Create.difficulty = b.dataset.d; $$('#cDiff .pick').forEach((x) => x.classList.toggle('on', x === b)); });
  $('#cSkill').onclick = () => runSkillTest();
  $('#cStart').onclick = () => {
    Create.first = ($('#cFirst').value || 'Anas').trim();
    Create.last = ($('#cLast').value || 'Bennani').trim();
    Create.nation = $('#cNation').value;
    const country = $('#cLeague').value;
    startCareer({ first: Create.first, last: Create.last, nation: Create.nation, pos: Create.pos, country, difficulty: Create.difficulty, level: Create.skill?.level, potential: Create.skill?.potential });
  };
  renderSaveList();
}

function skillSummary() {
  const s = Create.skill;
  return `🎯 التسديد ${s.shoot} · ⚡ السرعة ${s.pace} · 🧠 الذكاء ${s.brain} → المستوى ${s.level} (إمكانيات ${s.potential})`;
}
function renderSaveList() {
  const box = $('#saveList');
  const saves = Career.listSaves();
  box.innerHTML = saves.length ? '' : '<div class="small">ما كاينش مسيرة محفوظة.</div>';
  saves.forEach((sv) => {
    const club = sv.club;
    const row = el(`<div class="item"><span class="badge" style="background:#1f3b57">S${sv.slot + 1}</span>
      <div style="flex:1"><div class="nm">${sv.name}</div><div class="sub">${sv.club} · الموسم ${sv.season} (${sv.year}) · ${sv.age} سنة</div></div>
      <button class="btn sm primary">تحميل</button></div>`);
    $('button', row).onclick = () => {
      const c = Career.load(sv.slot);
      if (!c) return toast('ما قدرناش نحمّلو', 'bad');
      loadCareer(c);
    };
    box.appendChild(row);
  });
}

// ── skill test mini-games ────────────────────────────────────────────────────
function runSkillTest() {
  const res = { shoot: 0, pace: 0, brain: 0 };
  const box = modal(`<h3>🎮 اختبار المهارات</h3><div class="small" id="skStep">التسديد: دوز المؤشر فالمنطقة الخضراء وكليكي</div>
    <div class="skill" id="skStage" style="margin:10px 0"></div>
    <div class="btn-row"><button class="btn primary" id="skBtn">كليكي</button></div>`,
    { buttons: [{ label: 'إلغاء', cls: 'ghost', action: () => {} }] });

  const stage = $('#skStage', box);
  let phase = 'shoot', tries = 0, hits = [], movX = 0, dir = 1, tgt = 0, running = true, t0 = 0, waiting = false, dots = 0, dotHits = [];

  function setupShoot() {
    phase = 'shoot'; tries = 0; hits = [];
    stage.innerHTML = `<div class="target" id="skT"></div><div class="mover" id="skM" style="left:0"></div><div class="msg" id="skMsg">3 تسديدات — كليكي فالمنطقة</div>`;
    loop();
  }
  function setupPace() {
    phase = 'pace'; hits = []; tries = 0;
    stage.innerHTML = `<div class="skillBig" id="skBig" style="padding-top:40px">استنى…</div><div class="msg" id="skMsg">كليكي بسرعة ملي تولّي خضراء</div>`;
    setTimeout(() => { waiting = true; $('#skBig').textContent = 'دابا!'; $('#skBig').style.color = '#25d07a'; t0 = performance.now(); waiting = false; }, 900 + Math.random() * 1600);
  }
  function setupBrain() {
    phase = 'brain'; dots = 0; dotHits = [];
    stage.innerHTML = `<div class="msg" id="skMsg">كليكي على 6 نقط بسرعة</div>`;
    spawnDot();
  }
  function spawnDot() {
    if (dots >= 6) return finish();
    dots++;
    const d = el('<div class="dot"></div>');
    d.style.left = (10 + Math.random() * 76) + '%';
    d.style.top = (10 + Math.random() * 66) + '%';
    d.onclick = () => { dotHits.push(1); d.remove(); spawnDot(); };
    stage.appendChild(d);
    clearTimeout(stage._t);
    stage._t = setTimeout(() => { if (dots <= 6) { dotHits.push(0); d.remove(); spawnDot(); } }, 1400);
  }
  function loop() {
    if (!running) return;
    const w = stage.clientWidth || 300;
    movX += dir * (4 + (tries * 1.2));
    if (movX > w - 4) { movX = w - 4; dir = -1; }
    if (movX < 0) { movX = 0; dir = 1; }
    const m = $('#skM'); if (m) m.style.left = movX + 'px';
    State.raf = requestAnimationFrame(loop);
  }
  function hit() {
    if (phase === 'shoot') {
      const w = stage.clientWidth || 300;
      const t = $('#skT'); const tw = w * 0.2, tx = t ? parseFloat(t.style.left || '0') : 0;
      const d = Math.abs(movX - (tx + tw / 2));
      hits.push(Math.max(0, 100 - (d / (w * 0.5)) * 130));
      tries++;
      if (tries >= 3) { res.shoot = Math.round(hits.reduce((a, b) => a + b, 0) / 3); cancelAnimationFrame(State.raf); running = false; setTimeout(setupPace, 500); }
      else { t.style.left = Math.round(Math.random() * (w - tw)) + 'px'; $('#skMsg').textContent = `تسديدة ${tries}/3`; }
    } else if (phase === 'pace') {
      if (waiting) return;
      const ms = Math.round(performance.now() - t0);
      hits.push(clamp(100 - (ms - 220) / 5.5, 0, 100));
      tries++;
      if (tries >= 3) { res.pace = Math.round(hits.reduce((a, b) => a + b, 0) / 3); running = false; setTimeout(setupBrain, 500); }
      else setupPace();
    } else if (phase === 'brain') { /* handled by dot clicks */ }
  }
  $('#skBtn', box).onclick = hit;
  stage.onclick = (e) => { if (phase === 'brain' && e.target === stage) hit(); };
  document.onkeydown = (e) => { if (e.key === ' ') hit(); };

  function finish() {
    res.brain = Math.round((dotHits.reduce((a, b) => a + b, 0) / 6) * 100);
    const level = Math.round(clamp(46 + res.shoot * 0.09 + res.pace * 0.09 + res.brain * 0.08, 48, 72));
    const potential = Math.round(clamp(level + 16 + (res.shoot + res.pace + res.brain) / 26, 66, 94));
    Create.skill = { ...res, level, potential };
    closeModal();
    $('#cSkillOut').innerHTML = skillSummary();
    document.onkeydown = null;
    toast('✅ اختبار المهارات كمل', 'good');
  }

  const w0 = stage.clientWidth || 300;
  const tEl = () => { const t = $('#skT'); const tw = w0 * 0.2; t.style.width = tw + 'px'; t.style.left = Math.round(Math.random() * (w0 - tw)) + 'px'; };
  tEl();
  loop();
}

// ═══════════════════════════ HUB ════════════════════════════════════════════
function startCareer(opts) {
  const c = Career.new({ ...opts, seed: (Date.now() ^ 0x5f3759df) >>> 0 });
  loadCareer(c);
  modal(`<h3>🎉 مرحبا ${c.s.player.full}!</h3>
    <div class="small">وقّعتي أول عقد احترافي مع <b>${c.myClub.name}</b> فـ <b>${c.myLeague.name}</b>.</div>
    <div class="kv"><span>المدرب</span><b>${c.myClub.manager.name}</b></div>
    <div class="kv"><span>الأجر الأسبوعي</span><b>${fmtMoney(c.s.contract.wage)}</b></div>
    <div class="kv"><span>مدة العقد</span><b>${c.s.contract.seasons} مواسم</b></div>
    <div class="kv"><span>التشكيلة</span><b>${c.myClub.formation}</b></div>`);
}
function loadCareer(c) {
  State.career = c;
  go('hub');
  renderHub();
  toast(`⚽ ${c.myClub.name} · ${c.myLeague.name}`, 'good');
}

const TABS = [
  ['home', '🏠', 'الرئيسية'], ['squad', '👥', 'الفريق'], ['table', '📊', 'الترتيب'],
  ['stats', '📈', 'إحصائيات'], ['market', '💰', 'السوق'], ['life', '🏝️', 'الحياة'],
];

function renderHub() {
  const c = State.career;
  if (!c) return;
  const p = c.s.player, club = c.myClub;
  const sess = c.s.seasonNum, week = Math.min(c.s.week, 30);
  const phaseTxt = c.s.phase === 'season' ? `الموسم ${sess} • ${c.s.year} • الأسبوع ${week}/30` :
    c.s.phase === 'postseason' ? `ما بعد الموسم ${sess} • ${({ awards: 'حفل الجوائز', transfers: 'سوق الانتقالات', nations: 'المنتخب', newseason: 'موسم جديد' })[c.s.postStep] || ''}` : '';

  $('#s-hub').innerHTML = `
  <div class="topbar">
    <div class="me">
      <span class="ava" style="background:linear-gradient(140deg,#2ee08a,#0f9c5b)">${(p.first[0] || 'P') + (p.last[0] || '')}</span>
      <div class="who" style="flex:1">
        <b>${p.full} <span class="tiny">${p.age} سنة · ${POS_NAME_AR[p.pos]}</span></b>
        <span>${clubBadge(club, 14)} ${club.name} · ${c.myLeague.name}</span>
      </div>
      <div class="center"><div class="ovr ${ovrClass(overall(p))}" style="font-size:24px">${overall(p)}</div><div class="tiny">OVR</div></div>
    </div>
    <div class="chips">
      <span class="chip">📅 <b>${phaseTxt}</b></span>
      <span class="chip ok">💰 <b>${fmtMoney(c.s.money)}</b></span>
      <span class="chip ${c.s.trust > 65 ? 'ok' : c.s.trust > 35 ? 'warn' : 'bad'}">🤝 ثقة المدرب <b>${Math.round(c.s.trust)}</b></span>
      <span class="chip ${p.morale > 65 ? 'ok' : p.morale > 35 ? 'warn' : 'bad'}">😊 معنويات <b>${Math.round(p.morale)}</b></span>
      <span class="chip ${p.fitness > 70 ? 'ok' : 'warn'}">💪 جاهزية <b>${Math.round(p.fitness)}</b></span>
      ${p.injuryWeeks ? `<span class="chip bad">🚑 إصابة <b>${p.injuryWeeks} أسبوع</b></span>` : ''}
    </div>
  </div>
  <div id="tabBody"></div>
  <nav class="tabs">${TABS.map(([k, i, t]) => `<button class="tab ${State.tab === k ? 'on' : ''}" data-tab="${k}"><i>${i}</i>${t}</button>`).join('')}</nav>`;

  $$('.tab').forEach((b) => b.onclick = () => { State.tab = b.dataset.tab; renderHub(); });
  const body = $('#tabBody');
  ({
    home: renderHome, squad: renderSquad, table: renderTable,
    stats: renderStats, market: renderMarket, life: renderLife,
  })[State.tab](body);
}

// ── HOME ─────────────────────────────────────────────────────────────────────
function renderHome(b) {
  const c = State.career, p = c.s.player;
  const fixtures = c.weekFixture();
  const st = c.s.seasonStats;
  const avg = c.avgRating();
  b.innerHTML = `
  <div class="card">
    <h3>📅 الماتش الجاي</h3>
    ${fixtures && fixtures.length ? fixtures.map((fx) => {
      const opp = c.world.clubById[fx.opponentId];
      return `<div class="item" style="margin-bottom:6px">${clubBadge(opp)}
        <div style="flex:1"><div class="nm">${fx.home ? 'ضد' : 'خارج الديار ضد'} ${opp.name}</div>
        <div class="sub">${fx.label} · ${fx.home ? '🏟️ الديار' : '🚌 برّا'} · قوة الخصم ${opp.strength}</div></div></div>`;
    }).join('') : `<div class="small">${c.s.phase === 'season' ? 'ما كاينش ماتش هاد الأسبوع' : 'الموسم كمل — دوز للفترة الصيفية'}</div>`}
    ${fixtures && fixtures.length ? `<div class="btn-row"><button class="btn primary" id="btnPlay">▶️ لعب الماتش</button>
      <button class="btn blue" id="btnSim">⏩ نتيجة فورية</button></div>` : ''}
    ${c.s.phase === 'season' && (!fixtures || !fixtures.length) ? '<div class="btn-row"><button class="btn primary" id="btnWeek">⏭️ دوز الأسبوع</button></div>' : ''}
    ${c.s.phase === 'postseason' ? '<div class="btn-row"><button class="btn gold" id="btnPost">🔓 الفترة الصيفية</button></div>' : ''}
  </div>

  <div class="card">
    <h3>🎯 أهداف الإدارة <span class="tiny">(${c.s.objectives.filter((o) => o.done).length}/${c.s.objectives.length})</span></h3>
    <div class="stack">${c.s.objectives.map((o) => `<div class="item"><span style="font-size:18px">${o.done ? '✅' : '⏳'}</span>
      <div style="flex:1"><div class="nm">${o.text}</div><div class="sub">مكافأة ${fmtMoney(o.reward)}</div></div></div>`).join('')}</div>
  </div>

  <div class="card">
    <h3>🏃 برنامج التدريب</h3>
    <div class="row wrap" id="trainBox">
      ${['pac', 'sho', 'pas', 'dri', 'def', 'phy', ...(p.pos === 'GK' ? ['gk'] : '')].map((k) => `<button class="pick ${c.s.training.focus.includes(k) ? 'on' : ''}" data-k="${k}">${ATTR_AR[k]}</button>`).join('')}
    </div>
    <div class="small" style="margin-top:6px">اختار جوج صفات باش تركز عليهم هاد الأسبوع (${c.s.training.focus.includes('gk') ? '' : ''}التدريب كيطورهم بشوية).</div>
    <div class="row" style="margin-top:8px"><span class="small">شدة التدريب</span>
      ${[1, 2, 3].map((i) => `<button class="pick ${c.s.training.intensity === i ? 'on' : ''}" data-i="${i}">${i === 1 ? 'خفيفة' : i === 2 ? 'عادية' : 'قوية'}</button>`).join('')}
    </div>
  </div>

  <div class="card news">
    <h3>📰 الأخبار</h3>
    ${c.s.news.slice(0, 8).map((n) => `<div class="n ${n.k}"><span class="k">${n.k === 'good' ? '🟢' : n.k === 'bad' ? '🔴' : 'ℹ️'}</span><span>${n.t}</span></div>`).join('') || '<div class="small">ما كاينش أخبار.</div>'}
  </div>`;

  const play = $('#btnPlay'), sim = $('#btnSim'), wk = $('#btnWeek'), post = $('#btnPost');
  if (play) play.onclick = () => runWeek(false);
  if (sim) sim.onclick = () => runWeek(true);
  if (wk) wk.onclick = () => { c.simWorldWeek(); const news = c.advanceWeek(); showNews(news); renderHub(); };
  if (post) post.onclick = () => { go('post'); renderPost(); };
  $$('#trainBox .pick').forEach((btn) => btn.onclick = () => {
    const k = btn.dataset.k;
    if (c.s.training.focus.includes(k)) c.s.training.focus = c.s.training.focus.filter((x) => x !== k);
    else { c.s.training.focus.push(k); if (c.s.training.focus.length > 2) c.s.training.focus.shift(); }
    renderHub();
  });
  $$('[data-i]').forEach((btn) => btn.onclick = () => { c.s.training.intensity = +btn.dataset.i; renderHub(); });
}

function showNews(news) {
  (news || []).slice(0, 4).forEach((n) => toast(n.t, n.k === 'bad' ? 'bad' : n.k === 'good' ? 'good' : ''));
}

// ── SQUAD ────────────────────────────────────────────────────────────────────
function renderSquad(b) {
  const c = State.career, p = c.s.player;
  const squad = c.squad();
  const xi = squad.slice(0, 11);
  const myRank = squad.findIndex((x) => x.id === 'me') + 1;
  b.innerHTML = `
  <div class="card">
    <h3>👥 تشكيلة ${c.myClub.name}</h3>
    <div class="row" style="gap:6px;margin-bottom:6px">
      <span class="chip">التشكيلة: <b>${c.myClub.formation}</b></span>
      <span class="chip">مدرب: <b>${c.myClub.manager.name}</b></span>
      <span class="chip ${myRank <= 11 ? 'ok' : 'warn'}">ترتيبك: <b>#${myRank}</b></span>
    </div>
    <div class="small" style="margin-bottom:8px">${myRank <= 11 ? '✅ راك فالتشكيلة الأساسية' : '⚠️ راك فالاحتياط — خاصك تقنع المدرب فالتدريب والماتشات'}</div>
    <div class="list">
      ${squad.slice(0, 24).map((pl, i) => `<div class="item" style="${pl.id === 'me' ? 'border-color:#25d07a;background:#10251b' : ''}">
        <span class="pos ${posGroup(pl.pos)}">${pl.pos}</span>
        <div style="flex:1"><div class="nm">${pl.full} ${pl.id === 'me' ? '<span class="tiny acc">(أنت)</span>' : ''} ${i < 11 ? '🧤' : ''}</div>
        <div class="sub">${pl.age} سنة · ${pl.nation}${pl.injuryWeeks ? ' · 🚑 مصاب' : ''}</div></div>
        <span class="ovr ${ovrClass(overall(pl))}">${overall(pl)}</span></div>`).join('')}
    </div>
  </div>`;
}

// ── TABLE ────────────────────────────────────────────────────────────────────
function renderTable(b) {
  const c = State.career;
  const rows = c.tableSorted();
  const cup = c.s.cup, cont = c.s.cont;
  b.innerHTML = `
  <div class="card">
    <h3>📊 ${c.myLeague.name} <span class="tiny">${c.s.year}</span></h3>
    <table><thead><tr><th>#</th><th style="text-align:right">الفريق</th><th>ل</th><th>ف</th><th>ت</th><th>خ</th><th>له</th><th>عليه</th><th>+/-</th><th>نقاط</th></tr></thead>
    <tbody>${rows.map((r, i) => {
      const club = c.world.clubById[r.clubId];
      return `<tr class="${r.clubId === c.myClub.id ? 'me' : ''} ${i < 3 ? 'zone' : ''}">
        <td>${i + 1}</td><td class="nm">${club.short}</td><td>${r.p}</td><td>${r.w}</td><td>${r.d}</td><td>${r.l}</td>
        <td>${r.gf}</td><td>${r.ga}</td><td>${r.gf - r.ga > 0 ? '+' : ''}${r.gf - r.ga}</td><td><b>${r.pts}</b></td></tr>`;
    }).join('')}</tbody></table>
  </div>
  <div class="card">
    <h3>👟 هدافو الدوري</h3>
    ${c.topScorersList(10).length ? `<table><thead><tr><th style="text-align:right">اللاعب</th><th>فريق</th><th>⚽</th><th>🅰️</th></tr></thead><tbody>
      ${c.topScorersList(10).map((s) => `<tr class="${s.id === 'me' ? 'me' : ''}"><td class="nm">${s.name}</td><td>${c.world.clubById[s.clubId]?.short || '—'}</td><td><b>${s.goals}</b></td><td>${s.assists}</td></tr>`).join('')}
    </tbody></table>` : '<div class="small">البطولة مازال ما بدات.</div>'}
  </div>
  <div class="card">
    <h3>🏆 الكؤوس</h3>
    <div class="kv"><span>${c.schedule.cup.name}</span><b>${cup ? (cup.alive ? `لسا فالبطولة — دور ${(cup.round ?? -1) + 2}/4` : 'خرجتي') : '—'}</b></div>
    ${cont ? `<div class="kv"><span>${c.schedule.cont.name}</span><b>${cont.alive ? `لسا فالبطولة — دور ${(cont.round ?? -1) + 2}/5` : 'خرجتي'}</b></div>` : '<div class="kv"><span>المسابقة القارية</span><b>ما تأهلتيش</b></div>'}
    ${c.s.natTournament ? `<div class="kv"><span>${c.s.natTournament.name}</span><b>${c.s.natTournament.done ? (c.s.natTournament.alive ? '🏆 بطل!' : 'مقصي') : `دور ${c.s.natTournament.round + 1}`}</b></div>` : ''}
  </div>`;
}

// ── STATS ────────────────────────────────────────────────────────────────────
function renderStats(b) {
  const c = State.career, p = c.s.player, st = c.s.seasonStats, cs = c.s.careerStats;
  const attrs = p.attrs ? Object.entries(p.attrs) : [['gk', p.gk]];
  b.innerHTML = `
  <div class="card">
    <h3>📈 الصفات</h3>
    <div class="small" style="margin-bottom:8px">المستوى الحالي <b class="acc">${overall(p)}</b> — الإمكانيات <b class="gold">${Math.round(p.pot)}</b>
      ${overall(p) < p.pot ? `(باقي ${Math.round(p.pot - overall(p))} نقطة للتطور)` : '(وصلتي للإمكانيات)'}</div>
    <div class="stack">${attrs.map(([k, v]) => `<div>
      <div class="row"><span class="small" style="width:70px">${ATTR_AR[k] || k}</span>
      <div class="bar" style="flex:1"><div style="width:${clamp(v, 0, 100)}%"></div></div><b style="width:26px;text-align:left">${Math.round(v)}</b></div></div>`).join('')}</div>
  </div>
  <div class="card">
    <h3>📋 الموسم الحالي</h3>
    <div class="kv"><span>المشاركات</span><b>${st.apps}</b></div>
    <div class="kv"><span>الدقائق</span><b>${fmtNum(st.minutes)}</b></div>
    <div class="kv"><span>الأهداف</span><b>${st.goals}</b></div>
    <div class="kv"><span>التمريرات الحاسمة</span><b>${st.assists}</b></div>
    <div class="kv"><span>معدل التقييم</span><b>${st.ratings.length ? c.avgRating().toFixed(2) : '—'}</b></div>
    <div class="kv"><span>رجل المباراة</span><b>${st.motm}</b></div>
    <div class="kv"><span>بطاقات صفراء / حمراء</span><b>${st.yellow} / ${st.red}</b></div>
    ${p.pos === 'GK' ? `<div class="kv"><span>شباك نظيفة / تصديات</span><b>${st.cleanSheets} / ${st.saves}</b></div>` : ''}
  </div>
  <div class="card">
    <h3>🏛️ المسيرة كاملة</h3>
    <div class="kv"><span>مواسم</span><b>${c.s.history.length + (c.s.seasonNum > 1 ? 1 : 0)}</b></div>
    <div class="kv"><span>مشاركات</span><b>${cs.apps + st.apps}</b></div>
    <div class="kv"><span>أهداف</span><b>${cs.goals + st.goals}</b></div>
    <div class="kv"><span>تمريرات حاسمة</span><b>${cs.assists + st.assists}</b></div>
    <div class="kv"><span>مشاركات مع المنتخب</span><b>${c.s.capStats.apps} (${c.s.capStats.goals} هدف)</b></div>
    <div class="kv"><span>القيمة السوقية</span><b>${fmtMoney(c.playerValueOf())}</b></div>
    <div class="kv"><span>الأجر الأسبوعي</span><b>${fmtMoney(c.s.contract.wage)}</b></div>
  </div>
  <div class="card">
    <h3>🏆 الألقاب والجوائز</h3>
    ${c.s.trophies.length ? c.s.trophies.map((t) => `<div class="kv"><span>${t.t}</span><b>م${t.season}</b></div>`).join('') : '<div class="small">مازال ما ربحتيش شي لقب.</div>'}
    ${c.s.awards.length ? c.s.awards.map((a) => `<div class="kv"><span>${a.name}</span><b>م${a.season}</b></div>`).join('') : ''}
  </div>
  <div class="card">
    <h3>📅 سجل المواسم</h3>
    ${c.s.history.length ? `<table><thead><tr><th>م</th><th style="text-align:right">الفريق</th><th>م</th><th>⚽</th><th>🅰️</th><th>تقييم</th><th>OVR</th></tr></thead><tbody>
      ${c.s.history.map((h) => `<tr><td>${h.season}</td><td class="nm">${c.world.clubById[h.clubId]?.short || '—'}</td><td>${h.apps}</td><td>${h.goals}</td><td>${h.assists}</td><td>${h.avg}</td><td>${h.overall}→${h.afterOverall}</td></tr>`).join('')}
    </tbody></table>` : '<div class="small">أول موسم ديالك مازال فالطريق.</div>'}
  </div>`;
}

// ── MARKET ───────────────────────────────────────────────────────────────────
function renderMarket(b, host = null) {
  const c = State.career;
  const container = host || $('#tabBody');
  const offers = c.s.offers || [];
  const inWindow = c.s.phase === 'postseason' && c.s.postStep === 'transfers';
  b.innerHTML = `
  <div class="card">
    <h3>💰 وضعك التعاقدي</h3>
    <div class="kv"><span>الفريق</span><b>${c.myClub.name} (${c.myLeague.name})</b></div>
    <div class="kv"><span>الأجر الأسبوعي</span><b>${fmtMoney(c.s.contract.wage)}</b></div>
    <div class="kv"><span>باقي من العقد</span><b>${c.s.contract.seasons} موسم</b></div>
    <div class="kv"><span>قيمتك السوقية</span><b>${fmtMoney(c.playerValueOf())}</b></div>
    <div class="kv"><span>ثقة المدرب</span><b>${Math.round(c.s.trust)}/100</b></div>
    <div class="row" style="margin-top:8px">
      <button class="btn sm blue" id="mRenew">✍️ طلب تجديد العقد</button>
      <button class="btn sm ghost" id="mTalk">🗣️ هضر مع المدرب</button>
    </div>
  </div>
  <div class="card">
    <h3>📨 العروض <span class="tiny">${inWindow ? '(السوق مفتوح)' : '(كتصلك العروض فالصيف)'}</span></h3>
    ${offers.length ? offers.map((o) => {
      const club = c.world.clubById[o.clubId];
      return `<div class="offer ${o.wage > c.s.contract.wage * 1.6 ? 'best' : ''}">
        <div class="row">${clubBadge(club)}<div style="flex:1"><div class="nm">${club.name}</div>
        <div class="sub">${c.world.leagues.find((l) => l.id === club.leagueId)?.name || ''} · قوة ${club.strength} · دور متوقع: ${({ star: 'نجم الفريق', first: 'أساسي', rotation: 'دوران', squad: 'احتياط' })[o.role]}</div></div></div>
        <div class="kv"><span>مقابل الانتقال</span><b>${fmtMoney(o.fee)}</b></div>
        <div class="kv"><span>الأجر الأسبوعي</span><b>${fmtMoney(o.wage)}</b></div>
        <div class="kv"><span>المدة</span><b>${o.seasons} مواسم</b></div>
        <div class="kv"><span>منحة التوقيع</span><b>${fmtMoney(o.signOn)}</b></div>
        <div class="btn-row"><button class="btn primary" data-accept="${o.id}">✅ قبل</button>
        <button class="btn ghost" data-reject="${o.id}">❌ رفض</button></div></div>`;
    }).join('') : `<div class="small">ما كاينش عروض دابا. ${c.s.phase === 'season' ? 'قدّم أداء مزيان والصيف غادي يجيب العروض.' : ''}</div>`}
  </div>`;

  $$('[data-accept]', b).forEach((btn) => btn.onclick = () => {
    const r = c.acceptOffer(btn.dataset.accept);
    if (r) { toast(`✍️ انتقال لـ ${r.club.name}!`, 'good'); if (host) renderPost(); else renderHub(); }
  });
  $('#mRenew') && ($('#mRenew').onclick = onRenew);
  $('#mTalk') && ($('#mTalk').onclick = onTalk);
  $$('[data-reject]', b).forEach((btn) => btn.onclick = () => { c.s.offers = c.s.offers.filter((o) => o.id !== btn.dataset.reject); renderMarket(container, container); });
  function onRenew() {
    const wage = Math.round(c.s.contract.wage * (1.15 + c.s.trust / 300));
    const ok = c.s.money >= 0;
    c.s.contract.wage = wage; c.s.contract.seasons += 3;
    c.s.trust = clamp(c.s.trust + 4, 5, 100);
    modal(`<h3>✍️ تجديد العقد</h3><div class="small">الإدارة قبلت — الأجر الجديد <b>${fmtMoney(wage)}</b> أسبوعياً لمدة 3 مواسم إضافية.</div>`);
    renderHub();
  }
  function onTalk() {
    const r = clamp(6 + Math.random() * 10, 0, 20);
    if (c.s.trust < 45 && Math.random() < 0.4) { c.s.trust = clamp(c.s.trust + 3, 5, 100); toast('🗣️ المدرب: "خاصك تصبر وتربح بلاصتك."', ''); }
    else { c.s.trust = clamp(c.s.trust + r * 0.4, 5, 100); c.s.player.morale = clamp(c.s.player.morale + 5, 20, 100); toast('🗣️ المدرب عطاك ثقة: "راك فخططي." +ثقة', 'good'); }
    renderHub();
  }
  if (!$('#mRenew')) return;
}

// ── LIFE ─────────────────────────────────────────────────────────────────────
function renderLife(b) {
  const c = State.career;
  b.innerHTML = `
  <div class="card">
    <h3>💵 الفلوس</h3>
    <div class="kv"><span>الرصيد</span><b class="gold">${fmtMoney(c.s.money)}</b></div>
    <div class="kv"><span>الأجر الأسبوعي</span><b>${fmtMoney(c.s.contract.wage)}</b></div>
    <div class="kv"><span>مصاريف أسبوعية (ضرائب + عيشة)</span><b class="red">-${fmtMoney(c.s.contract.wage * 0.42 + Object.entries(c.s.lifestyle).reduce((a, [k, v]) => a + UPKEEP[k] * v, 0))}</b></div>
    <div class="kv"><span>عقود الرعاية</span><b>${c.s.sponsorsWeekly ? fmtMoney(c.s.sponsorsWeekly) + '/أسبوع' : '—'}</b></div>
  </div>
  <div class="card">
    <h3>🏝️ الاستثمارات والمكافآت</h3>
    <div class="small" style="margin-bottom:8px">كل شراء كيعطيك فائدة صغيرة دائمة (وأيضاً مصاريف أسبوعية).</div>
    <div class="stack">${Object.entries(LIFESTYLE).map(([k, L]) => {
      const lvl = c.s.lifestyle[k];
      return `<div class="item"><span style="font-size:20px">${L.icon}</span>
        <div style="flex:1"><div class="nm">${L.ar} <span class="tiny">${stars(lvl)}</span></div><div class="sub">${L.effect} · مصاريف ${fmtMoney(UPKEEP[k] * (lvl + 1))}/أسبوع</div></div>
        <button class="btn sm ${c.s.money >= L.cost && lvl < L.max ? 'gold' : ''}" data-buy="${k}" ${lvl >= L.max ? 'disabled' : ''}>${lvl >= L.max ? 'مكمّل' : fmtMoney(L.cost)}</button></div>`;
    }).join('')}</div>
  </div>
  <div class="card">
    <h3>⚙️ الإعدادات</h3>
    <div class="row wrap">
      <button class="btn sm" id="lgSpeed">سرعة الماتش: ${State.speed}×</button>
      <button class="btn sm" id="lgSave">💾 سجّل</button>
      <button class="btn sm" id="lgExport">📤 نسخة احتياطية</button>
      <button class="btn sm ghost" id="lgQuit">🚪 مسيرة جديدة</button>
      ${c.s.player.age >= 34 ? '<button class="btn sm red" id="lgRetire">🎬 اعتزل اللعب</button>' : ''}
    </div>
  </div>`;
  $$('[data-buy]').forEach((btn) => btn.onclick = () => {
    if (c.buy(btn.dataset.buy)) { toast('✅ تم الشراء', 'good'); renderHub(); }
    else toast('💸 ما عندكش فلوس كافيين', 'bad');
  });
  $('#lgSpeed').onclick = () => { State.speed = State.speed === 1 ? 2 : State.speed === 2 ? 3 : 1; renderLife($('#tabBody')); };
  $('#lgSave').onclick = () => { c.save(0); toast('💾 تسجلت المسيرة', 'good'); };
  $('#lgExport').onclick = () => {
    const blob = new Blob([JSON.stringify(c.s)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `procareer27_${c.s.player.last}.json`; a.click();
    toast('📤 تحميل النسخة الاحتياطية', 'good');
  };
  $('#lgQuit').onclick = () => { State.career = null; go('create'); renderCreate(); };
  const ret = $('#lgRetire');
  if (ret) ret.onclick = () => { c.retire(); showRetirement(); };
}

function showRetirement() {
  const c = State.career, cs = c.s.careerStats, p = c.s.player;
  modal(`<h3>🎬 نهاية المسيرة</h3>
    <div class="center" style="font-size:40px">🏟️</div>
    <div class="kv"><span>اللاعب</span><b>${p.full}</b></div>
    <div class="kv"><span>السنوات</span><b>${c.s.history.length} مواسم</b></div>
    <div class="kv"><span>مشاركات</span><b>${cs.apps}</b></div>
    <div class="kv"><span>أهداف / تمريرات</span><b>${cs.goals} / ${cs.assists}</b></div>
    <div class="kv"><span>تقييم المسيرة</span><b>${cs.avg}</b></div>
    <div class="kv"><span>ألقاب</span><b>${c.s.trophies.length}</b></div>
    <div class="kv"><span>جوائز</span><b>${c.s.awards.length}</b></div>
    <div class="small" style="margin-top:8px">مشوار رائع — دابا تقدر تبدا مسيرة جديدة.</div>`,
    { buttons: [{ label: 'مسيرة جديدة', cls: 'primary', action: () => { State.career = null; go('create'); renderCreate(); } }] });
}

// ═══════════════════════════ MATCH ══════════════════════════════════════════
async function runWeek(instant) {
  const c = State.career;
  if (State.busy) return;            // guards against double-taps on mobile
  State.busy = true;
  try { await runWeekInner(c, instant); } finally { State.busy = false; }
}

async function runWeekInner(c, instant) {
  go('match');
  const fixtures = c.weekFixture() || [];
  for (const fx of fixtures) {
    const plan = c.startMatch(fx);
    if (!plan) break;
    if (instant) {
      const out = c.finishMatch({});
      showMatchResult(out, plan, true);
      await waitTap();
    } else {
      const choice = await preMatchPanel(plan);
      if (choice === 'sim') {
        const out = c.finishMatch({});
        showMatchResult(out, plan, true);
        await waitTap();
      } else {
        await playLive(plan);
      }
    }
  }
  c.simWorldWeek();
  const news = c.advanceWeek();
  go('hub'); renderHub();
  showNews(news);
  if (c.s.phase === 'postseason') { go('post'); renderPost(); }
}

function preMatchPanel(plan) {
  return new Promise((resolve) => {
    const c = State.career;
    const opp = c.world.clubById[plan.oppClubId];
    const mine = c.world.clubById[plan.myClubId];
    const idx = plan.line.xi.findIndex((p) => p.id === 'me');
    const starting = idx >= 0;
    const role = starting ? plan.line.roles[idx] : (c.s.player.pos + ' (بديل)');
    $('#s-match').innerHTML = `
      <div class="card center">
        <div class="small">${plan.competition}</div>
        <div class="row" style="justify-content:center;gap:16px;margin:10px 0">
          <div class="center">${clubBadge(mine, 46)}<div class="nm" style="margin-top:6px">${mine.name}</div><div class="tiny">${plan.home ? '🏟️ الديار' : 'برّا'}</div></div>
          <div class="sc" style="font-size:20px;color:var(--dim)">VS</div>
          <div class="center">${clubBadge(opp, 46)}<div class="nm" style="margin-top:6px">${opp.name}</div><div class="tiny">قوة ${opp.strength}</div></div>
        </div>
        <div class="kv"><span>مركزك فالماتش</span><b>${POS_NAME_AR[role] || role}</b></div>
        <div class="kv"><span>الحالة</span><b class="${starting ? 'acc' : 'gold'}">${starting ? 'أساسي 💪' : 'على البنش 🪑'}</b></div>
        <div class="kv"><span>ثقة المدرب</span><b>${Math.round(plan.trust)}/100</b></div>
        <div class="kv"><span>جاهزيتك</span><b>${Math.round(c.s.player.fitness)}%</b></div>
        <div class="kv"><span>التشكيلة</span><b>${c.myClub.formation} · ضد ${c.world.clubById[plan.oppClubId].formation}</b></div>
        <div class="btn-row"><button class="btn primary" id="pkPlay">▶️ العب الماتش</button>
        <button class="btn blue" id="pkSim">⏩ نتيجة فورية</button></div>
      </div>`;
    $('#pkPlay').onclick = () => resolve('play');
    $('#pkSim').onclick = () => resolve('sim');
  });
}

function waitTap() {
  return new Promise((resolve) => {
    const btn = $('#matchNext');
    if (!btn) return resolve();
    btn.onclick = () => { btn.remove(); resolve(); };
  });
}

async function playLive(plan) {
  const c = State.career;
  const runner = createRunner(c.world, plan, (Date.now() ^ plan.seed) >>> 0);
  const view = { minute: 1, frac: 0, push: 0, msg: [], flash: null, running: true };
  const mine = c.world.clubById[plan.myClubId], opp = c.world.clubById[plan.oppClubId];

  $('#s-match').innerHTML = `
    <div class="scorebar">
      <div class="team">${clubBadge(mine, 26)}<b>${mine.short}</b></div>
      <div class="center"><div class="sc" id="mScore">0 - 0</div><div class="clock" id="mClock">1'</div></div>
      <div class="team">${clubBadge(opp, 26)}<b>${opp.short}</b></div>
    </div>
    <div id="pitchWrap"><canvas id="pitch" width="640" height="400"></canvas>
      <div class="comment" id="mComment"></div>
      <div id="mDecision"></div>
    </div>
    <div class="livestats">
      <div class="s"><b id="lsRate">-</b><span>تقييم</span></div>
      <div class="s"><b id="lsGoals">0</b><span>⚽</span></div>
      <div class="s"><b id="lsShots">0</b><span>تسديدات</span></div>
      <div class="s"><b id="lsPass">0</b><span>تمريرات</span></div>
    </div>
    <div class="card tight">
      <div class="row"><span class="small" id="mSpeed">السرعة ${State.speed}×</span><span class="spacer"></span>
        <button class="btn sm" id="mSpeedBtn">⏩</button><button class="btn sm" id="mSkip">⏭️ للآخر</button></div>
    </div>`;

  const ctx = $('#pitch').getContext('2d');
  let skip = false;
  $('#mSpeedBtn').onclick = () => { State.speed = State.speed === 1 ? 2 : State.speed === 2 ? 3 : 1; $('#mSpeed').textContent = `السرعة ${State.speed}×`; };
  $('#mSkip').onclick = () => { skip = true; };

  const setScore = () => {
    const s = runner.state();
    $('#mScore').textContent = `${plan.home ? s.gh : s.ga} - ${plan.home ? s.ga : s.gh}`;
    if (s.stats) {
      $('#lsRate').textContent = s.stats.rating ? s.stats.rating.toFixed(1) : '—';
      $('#lsGoals').textContent = s.stats.goals;
      $('#lsShots').textContent = s.stats.shots;
      $('#lsPass').textContent = `${s.stats.passesOk}/${s.stats.passes}`;
    }
  };
  setScore();

  let commentLines = [];
  const pushComment = (e) => {
    commentLines = [e.text, ...commentLines].slice(0, 3);
    $('#mComment').innerHTML = commentLines.map((l, i) => `<div class="l ${i === 0 ? 'new' : ''}">${i === 0 ? '' : `${''}`}${l}</div>`).join('');
  };

  for (let t = 1; t <= 90; t++) {
    if (!view.running) break;
    view.minute = t;
    $('#mClock').textContent = `${t}'`;

    // decision window?
    const mo = runner.needsDecision(t);
    let decisions = {};
    if (mo && !skip) {
      const key = await askDecision(mo, plan);
      decisions[mo.id] = key;
    }
    const events = runner.tick(t, decisions);
    events.forEach((e) => {
      pushComment(e);
      if (e.kind === 'goal' || e.kind === 'goalOpp') flashGoal(e, plan);
    });
    setScore();
    await animateMinute(t, plan, view, runner, ctx, skip ? 8 : Math.round(760 / State.speed));
  }

  if (skip) {
    for (let t = 1; t <= 90; t++) runner.tick(t, {});
  }
  const res = runner.result();
  c.submitMatch(res);
  showMatchResult({ res, plan }, plan, false);
}

function flashGoal(e, plan) {
  const wrap = $('#pitchWrap');
  const f = el(`<div class="flash">${e.kind === 'goal' ? '⚽ GOAL!' : '😖 ' + (e.side === 'opp' ? 'GOAL' : '')}</div>`);
  f.style.color = e.kind === 'goal' ? '#8ef0bb' : '#ff9ea1';
  wrap.appendChild(f);
  setTimeout(() => f.remove(), 950);
}

function animationFrame(fn) {
  return new Promise((resolve) => {
    const start = performance.now();
    const step = (now) => {
      const k = clamp((now - start) / Math.max(1, fn.dur), 0, 1);
      fn.frame(k);
      if (k < 1) requestAnimationFrame(step); else resolve();
    };
    requestAnimationFrame(step);
  });
}

async function animateMinute(t, plan, view, runner, ctx, dur) {
  const rec = plan.minutes[t - 1] || { side: 'mine', kind: 'nothing' };
  view.side = rec.side;
  const done = rec.kind !== 'nothing' || !!(rec.momentId && runner && false);
  const target = rec.side === 'mine' ? 1 : -1;
  await animationFrame({
    dur, frame: (k) => {
      view.frac = k;
      view.push = (view.side === 'mine' ? 1 : -1) * Math.sin(k * Math.PI) * (rec.kind === 'goal' ? 0.5 : 0.3);
      view.ballX = 0.5 + (view.side === 'mine' ? 1 : -1) * Math.sin(k * Math.PI) * (rec.kind === 'goal' ? 0.44 : 0.3);
      view.ballY = 0.5 + Math.sin(k * Math.PI * 2 + t) * 0.18;
      view.flash = rec.kind === 'goal' ? k : rec.kind === 'goalOpp' ? k : 0;
      drawPitch(ctx, plan, view, runner);
    },
  });
}

// ── canvas pitch ─────────────────────────────────────────────────────────────
function drawPitch(ctx, plan, view, runner) {
  const W = 640, H = 400, pad = 14;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#14532d'); g.addColorStop(1, '#0b3a25');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // stripes
  for (let i = 0; i < 10; i++) {
    ctx.fillStyle = i % 2 ? 'rgba(255,255,255,.028)' : 'rgba(0,0,0,.03)';
    ctx.fillRect(pad + i * ((W - pad * 2) / 10), pad, (W - pad * 2) / 10, H - pad * 2);
  }
  ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 2;
  ctx.strokeRect(pad, pad, W - pad * 2, H - pad * 2);
  ctx.beginPath(); ctx.moveTo(W / 2, pad); ctx.lineTo(W / 2, H - pad); ctx.stroke();
  ctx.beginPath(); ctx.arc(W / 2, H / 2, 52, 0, Math.PI * 2); ctx.stroke();
  // boxes
  [[pad, 1], [W - pad, -1]].forEach(([x, dir]) => {
    ctx.strokeRect(dir > 0 ? x : x - 86, H / 2 - 92, 86, 184);
    ctx.strokeRect(dir > 0 ? x : x - 34, H / 2 - 46, 34, 92);
  });

  const px = (x) => pad + x * (W - pad * 2);
  const py = (y) => pad + y * (H - pad * 2);
  const push = view.push || 0;

  const drawTeam = (line, formation, isMine, color) => {
    const slots = (FORMATIONS[formation] || FORMATIONS['4-3-3']).slots;
    line.xi.forEach((p, i) => {
      const sl = slots[i] || { x: 0.5, y: 0.5 };
      let x = isMine ? sl.x : 1 - sl.x;
      x = clamp(x + push * (isMine ? 0.5 : 0.5), 0.02, 0.98);
      const y = clamp(sl.y + Math.sin(view.ballY * 6 + i) * 0.04 + (py(view.ballY) - py(sl.y)) / 900, 0.03, 0.97);
      const cx = px(x), cy = py(y);
      const me = p.id === 'me';
      ctx.beginPath(); ctx.arc(cx, cy, me ? 11 : 9, 0, Math.PI * 2);
      ctx.fillStyle = me ? '#ffd85a' : color;
      ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.stroke();
      ctx.fillStyle = me ? '#241b00' : 'rgba(255,255,255,.9)';
      ctx.font = 'bold 10px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(me ? '★' : (p.pos || '?').slice(0, 2), cx, cy + 0.5);
      if (me) {
        ctx.beginPath(); ctx.arc(cx, cy, 16, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,216,90,.85)'; ctx.lineWidth = 2; ctx.stroke();
      }
    });
  };
  drawTeam(plan.line, plan.line.formation, true, plan.home ? '#e8f4ff' : '#cfe8ff');
  drawTeam(plan.oppLine, plan.oppLine.formation, false, plan.home ? '#ff8a9a' : '#ff9db0');

  // ball
  const bx = px(clamp(view.ballX ?? 0.5, 0.03, 0.97)), by = py(clamp(view.ballY ?? 0.5, 0.05, 0.95));
  ctx.beginPath(); ctx.arc(bx + 2, by + 3, 6, 0, Math.PI * 2); ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fill();
  ctx.beginPath(); ctx.arc(bx, by, 6, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();

  if (view.flash > 0.02) {
    ctx.fillStyle = `rgba(255,255,255,${0.18 * (1 - view.flash)})`;
    ctx.fillRect(0, 0, W, H);
  }
}

// ── decision overlay ─────────────────────────────────────────────────────────
function askDecision(mo, plan) {
  return new Promise((resolve) => {
    const T = MOMENT_TYPES[mo.type];
    const hints = {
      shot: `المسافة ${mo.ctx.range}م · ${mo.ctx.angle === 'central' ? 'فالنص' : mo.ctx.angle === 'left' ? 'من اليسار' : 'من اليمين'}${mo.ctx.keeperRushed ? ' · الحارس طالع!' : ''}${mo.ctx.defenders ? ` · ${mo.ctx.defenders} مدافعين` : ''}`,
      pass: `${mo.ctx.runners} زملاء كيجريو · ضغط ${mo.ctx.pressing} · ${mo.ctx.third === 'final' ? 'الثلث الأخير' : mo.ctx.third === 'middle' ? 'وسط الملعب' : 'قرب منطقةنا'}`,
      duel: `${mo.ctx.threat === 'deadly' ? '⚠️ خطر حقيقي!' : 'هجمة عادية'} · ${mo.ctx.support ? 'عندك تغطية' : 'راك بوحدك'}`,
      gk: `${mo.ctx.targetRecord === 'goal' ? 'تسديدة قوية' : 'تسديدة على المرمى'} · ${mo.ctx.shotPower > 0.8 ? 'قوية بزاف' : 'متوسطة'}`,
      penalty: 'اختار الزاوية — الحارس كيخمن!',
      freekick: `المسافة ${mo.ctx.distance}م · حيط ${mo.ctx.wall} لاعبين`,
    };
    const box = $('#mDecision');
    const dur = 5000;
    box.innerHTML = `<div class="decision"><div class="q">${T.icon} ${T.ar}</div>
      <div class="tiny center">${hints[mo.type] || ''}</div>
      <div class="opts">${T.options.map((o, i) => `<button class="opt" data-k="${o.key}">${o.icon} ${o.ar}<span class="k">${i + 1}</span></button>`).join('')}</div>
      <div class="timer"><div id="mTimer"></div></div></div>`;
    const t0 = performance.now();
    let done = false;
    const finish = (key) => {
      if (done) return; done = true;
      clearInterval(iv);
      document.onkeydown = null;
      box.innerHTML = '';
      resolve(key);
    };
    $$('.opt', box).forEach((btn) => btn.onclick = () => finish(btn.dataset.k));
    document.onkeydown = (e) => {
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= T.options.length) finish(T.options[n - 1].key);
    };
    const iv = setInterval(() => {
      const k = 1 - (performance.now() - t0) / dur;
      const bar = $('#mTimer');
      if (bar) bar.style.width = `${clamp(k, 0, 1) * 100}%`;
      if (k <= 0) finish(T.options[Math.floor(Math.random() * T.options.length)].key);
    }, 60);
  });
}

// ── post match ───────────────────────────────────────────────────────────────
function showMatchResult(out, plan, instant) {
  const c = State.career;
  const res = out.res || out;
  const opp = c.world.clubById[plan.oppClubId];
  const st = res.stats;
  const motm = c.world.byId[res.motm];
  const r = st ? st.rating : 0;
  const rows = res.events.slice(-10).reverse();
  $('#s-match').innerHTML = `
    <div class="card">
      <div class="center small">${plan.competition} · نتيجة نهائية</div>
      <div class="row" style="justify-content:center;gap:14px;margin:8px 0">
        <div class="center">${clubBadge(c.myClub, 34)}<div class="tiny">${c.myClub.short}</div></div>
        <div class="sc">${res.gh} - ${res.ga}</div>
        <div class="center">${clubBadge(opp, 34)}<div class="tiny">${opp.short}</div></div>
      </div>
      ${st ? `<div class="rating"><div class="center"><div class="big ${r >= 8 ? 'gold' : r >= 7 ? 'acc' : ''}">${r.toFixed ? r.toFixed(1) : r}</div><div class="tiny">تقييمك</div></div>
        <div style="flex:1">
          <div class="stars">${stars(clamp(Math.round(r - 3), 1, 5))}</div>
          <div class="small">${st.minutes} دقيقة · ${st.goals} ⚽ · ${st.assists} 🅰️ · ${st.shots} تسديدات · ${st.passesOk}/${st.passes} تمريرات</div>
          <div class="small">${motm ? `🏅 رجل المباراة: <b>${motm.full}</b>${res.motm === 'me' ? ' (أنت!)' : ''}` : ''}</div>
        </div></div>` : '<div class="warnbox">🪑 ما لعبتيش هاد الماتش — المدرب خلاك فالاحتياط.</div>'}
    </div>
    ${st ? `<div class="livestats">
      <div class="s"><b>${st.keyPasses}</b><span>مفاتيح</span></div>
      <div class="s"><b>${st.tackles}</b><span>تدخلات</span></div>
      <div class="s"><b>${st.decisions ? Math.round((st.goodDecisions / st.decisions) * 100) : 0}%</b><span>قرارات صحيحة</span></div>
      <div class="s"><b>${st.distanceKm}</b><span>كم جرا</span></div>
    </div>` : ''}
    <div class="card">
      <h3>📋 أحداث الماتش</h3>
      <div class="news">${rows.map((e) => `<div class="n"><span class="k">${e.min}'</span><span>${e.text}</span></div>`).join('') || '<div class="small">ماتش هادي بلا أحداث كبيرة.</div>'}</div>
    </div>
    <div class="btn-row"><button class="btn primary" id="matchNext">متابعة ➡️</button></div>`;
  // table snippet
  const pos = c.myPosition();
  toast(`📊 ${c.myClub.short}: المركز ${pos} فـ ${c.myLeague.short}`, pos <= 4 ? 'good' : '');
}

// ═══════════════════════════ POSTSEASON ═════════════════════════════════════
function renderPost() {
  const c = State.career;
  const step = c.s.postStep || 'awards';
  const last = c.s.history[c.s.history.length - 1] || {};
  const body = $('#s-post');

  if (step === 'awards') {
    body.innerHTML = `
      <div class="gala">
        <div class="trophy">🏆</div>
        <h2>حفل نهاية الموسم ${last.season} (${last.year})</h2>
        <div class="small">${c.world.clubById[last.clubId]?.name || ''} · المركز ${last.leaguePos} · ${last.apps} ماتش</div>
        <div class="row" style="justify-content:center;gap:14px;margin:12px 0">
          <div class="center"><div style="font-size:26px;font-weight:900" class="acc">${last.goals}</div><div class="tiny">أهداف</div></div>
          <div class="center"><div style="font-size:26px;font-weight:900" class="acc">${last.assists}</div><div class="tiny">صناعة</div></div>
          <div class="center"><div style="font-size:26px;font-weight:900">${last.avg}</div><div class="tiny">معدل التقييم</div></div>
          <div class="center"><div style="font-size:26px;font-weight:900 gold">${last.overall}→${last.afterOverall}</div><div class="tiny">التطور</div></div>
        </div>
        ${(last.trophies || []).length ? `<div class="goodbox">${last.trophies.join('<br>')}</div>` : ''}
        ${(last.awards || []).length ? `<div class="card"><h3>🎖️ الجوائز</h3>${last.awards.map((a) => `<div class="kv"><span>${a}</span><b>🏅</b></div>`).join('')}</div>` : '<div class="small" style="margin-top:8px">ما ربحتيش جوائز هاد الموسم — العام الجاي!</div>'}
      </div>
      <div class="btn-row"><button class="btn primary" id="postNext">التالي: سوق الانتقالات ➡️</button></div>`;
  } else if (step === 'transfers') {
    body.innerHTML = `
      <div class="card">
        <h3>💰 سوق الانتقالات — الصيف</h3>
        <div class="small">قيمتك السوقية: <b class="gold">${fmtMoney(c.playerValueOf())}</b> · أجرك الحالي ${fmtMoney(c.s.contract.wage)}/أسبوع · باقي ${c.s.contract.seasons} موسم</div>
        ${c.s.contract.seasons <= 0 ? '<div class="warnbox" style="margin-top:8px">⚠️ العقد ديالك كمل! خاصك تجدد ولا تمشي لفريق آخر.</div>' : ''}
      </div>
      <div id="postOffers"></div>`;
    renderMarket($('#postOffers'));
    $('.card h3', body).textContent = '💰 سوق الانتقالات — الصيف';
    const next = el('<div class="btn-row"><button class="btn primary" id="postNext">التالي: المنتخب ➡️</button></div>');
    body.appendChild(next);
    next.querySelector('#postNext').onclick = () => { c.advanceOffseason(); renderPost(); };
    // stop the market screen from hijacking the buttons
    $$('[data-accept]', body).forEach((btn) => btn.onclick = () => {
      const r = c.acceptOffer(btn.dataset.accept);
      if (r) { toast(`✍️ انتقال لـ ${r.club.name}!`, 'good'); renderPost(); }
    });
    return;
  } else if (step === 'nations') {
    const T = c.s.natTournament;
    body.innerHTML = `
      <div class="card">
        <h3>${T ? T.name : '🇲🇦 المنتخب الوطني'}</h3>
        ${T ? `<div class="small">${T.isWC ? 'كأس العالم' : 'كأس القارة'} · دور ${T.round + 1}/${T.isWC ? 5 : 4}${T.done ? ' — كمل' : ''}</div>
        <div class="kv"><span>منتخبك</span><b>${c.nation ? c.nation.flag + ' ' + c.nation.name : c.s.player.nation}</b></div>
        <div class="kv"><span>مشاركات دولية</span><b>${c.s.capStats.apps} (${c.s.capStats.goals} ⚽)</b></div>
        ${T.champion ? `<div class="goodbox" style="margin-top:8px">🏆 البطل: ${c.world.clubById[T.champion]?.name || T.champion}${T.champion === 'n_' + c.s.player.nation ? ' — أنت بطل العالم!' : ''}</div>` : ''}`
        : '<div class="small">المدرب الوطني ما عيتلكش هاد المرة — قدّم أداء أحسن فالموسم الجاي.</div>'}
      </div>
      <div id="natAction"></div>`;
    const box = $('#natAction');
    const fx = T ? c.nationFixture() : null;
    if (fx) {
      const opp = c.world.clubById[fx.opponentId];
      box.innerHTML = `<div class="card">
        <div class="row" style="justify-content:center;gap:12px">
          <div class="center"><div style="font-size:34px">${c.nation?.flag || '🇲🇦'}</div><div class="tiny">${c.nation?.name || ''}</div></div>
          <div class="sc" style="font-size:18px;color:var(--dim)">VS</div>
          <div class="center"><div style="font-size:34px">${NATIONS.find((n) => 'n_' + n[1] === fx.opponentId)?.[2] || '🌍'}</div><div class="tiny">${c.world.clubById[fx.opponentId]?.name}</div></div>
        </div>
        <div class="btn-row"><button class="btn primary" id="natPlay">▶️ العب مع المنتخب</button>
        <button class="btn blue" id="natSim">⏩ سيملاسيون</button></div></div>`;
      $('#natSim').onclick = () => {
        const out = c.finishNationMatch({});
        showNationResult(out);
      };
      $('#natPlay').onclick = async () => {
        const plan = c.startNationMatch();
        if (!plan) return;
        await playNationLive(plan);
      };
    } else {
      box.innerHTML = '<div class="btn-row"><button class="btn primary" id="postNext">التالي ➡️</button></div>';
      $('#postNext').onclick = () => {
        if (c.s.natTournament && !c.s.natTournament.done && c.s.natTournament.alive) { toast('🏆 البطولة مازال ما كملات', ''); }
        c.advanceOffseason(); renderPost();
      };
    }
    return;
  } else {
    body.innerHTML = `
      <div class="card center">
        <div style="font-size:40px">📅</div>
        <h2>موسم ${c.s.seasonNum} (${c.s.year})</h2>
        <div class="small">${c.myClub.name} · ${c.myLeague.name}</div>
        <div class="kv"><span>ثقة المدرب</span><b>${Math.round(c.s.trust)}</b></div>
        <div class="kv"><span>الأجر</span><b>${fmtMoney(c.s.contract.wage)}</b></div>
        <div class="kv"><span>معنويات</span><b>${Math.round(c.s.player.morale)}</b></div>
        ${c.s.player.age >= 38 ? '<div class="warnbox" style="margin-top:8px">🎬 قربتي للاعتزال — تقدر تعتزل من تاب الحياة.</div>' : ''}
      </div>
      <div class="btn-row"><button class="btn primary" id="postNext">🚀 بدا الموسم الجديد</button></div>`;
    $('#postNext').onclick = () => { c.advanceOffseason(); go('hub'); renderHub(); toast(`📅 موسم ${c.s.seasonNum} بدا!`, 'good'); };
    return;
  }
  $('#postNext').onclick = () => { c.advanceOffseason(); renderPost(); };
}

function showNationResult(out) {
  const c = State.career;
  const T = c.s.natTournament;
  const res = out.res, plan = out.plan;
  toast(`${T.name}: ${res.gh}-${res.ga} ${res.stats ? `· تقييمك ${res.stats.rating}` : ''}`, res.gh > res.ga ? 'good' : 'bad');
  renderPost();
}

async function playNationLive(plan) {
  const c = State.career;
  const runner = createRunner(c.world, plan, (Date.now() ^ plan.seed) >>> 0);
  go('match');
  const view = { minute: 1, frac: 0, push: 0, ballX: 0.5, ballY: 0.5, flash: 0 };
  const mine = c.world.clubById[plan.myClubId], opp = c.world.clubById[plan.oppClubId];
  $('#s-match').innerHTML = `
    <div class="scorebar">
      <div class="team"><div style="font-size:26px">${c.nation?.flag || '🇲🇦'}</div><b>${mine.short}</b></div>
      <div class="center"><div class="sc" id="mScore">0 - 0</div><div class="clock" id="mClock">1'</div></div>
      <div class="team"><div style="font-size:26px">${NATIONS.find((n) => 'n_' + n[1] === plan.oppClubId.slice(2))?.[2] || '🌍'}</div><b>${opp.short}</b></div>
    </div>
    <div id="pitchWrap"><canvas id="pitch" width="640" height="400"></canvas>
      <div class="comment" id="mComment"></div><div id="mDecision"></div></div>
    <div class="livestats"><div class="s"><b id="lsRate">-</b><span>تقييم</span></div>
      <div class="s"><b id="lsGoals">0</b><span>⚽</span></div>
      <div class="s"><b id="lsShots">0</b><span>تسديدات</span></div>
      <div class="s"><b id="lsPass">0</b><span>تمريرات</span></div></div>`;
  const ctx = $('#pitch').getContext('2d');
  let lines = [];
  for (let t = 1; t <= 90; t++) {
    $('#mClock').textContent = `${t}'`;
    const mo = runner.needsDecision(t);
    let decisions = {};
    if (mo) decisions[mo.id] = await askDecision(mo, plan);
    const evs = runner.tick(t, decisions);
    evs.forEach((e) => { lines = [e.text, ...lines].slice(0, 3); $('#mComment').innerHTML = lines.map((l, i) => `<div class="l ${i === 0 ? 'new' : ''}">${l}</div>`).join(''); if (e.kind === 'goal' || e.kind === 'goalOpp') flashGoal(e, plan); });
    const s = runner.state();
    $('#mScore').textContent = `${plan.home ? s.gh : s.ga} - ${plan.home ? s.ga : s.gh}`;
    if (s.stats) { $('#lsRate').textContent = s.stats.rating ? s.stats.rating.toFixed(1) : '—'; $('#lsGoals').textContent = s.stats.goals; $('#lsShots').textContent = s.stats.shots; $('#lsPass').textContent = `${s.stats.passesOk}/${s.stats.passes}`; }
    await animateMinute(t, plan, view, runner, ctx, Math.round(700 / State.speed));
  }
  const res = runner.result();
  c.submitNationMatch(res);
  toast(`${plan.competition}: ${res.gh}-${res.ga}`, res.gh > res.ga ? 'good' : 'bad');
  go('post'); renderPost();
}

// ── start ────────────────────────────────────────────────────────────────────
export function main() {
  boot();
  const last = Career.listSaves()[0];
  if (last) toast(`💾 عندك مسيرة محفوظة (${last.name}) — تقدر تحملها`, 'good');
  // offline play (PWA)
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
  // keyboard shortcuts on desktop
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && $('#cStart') && !$('#modal.on')) $('#cStart').click();
  });
}
main();
