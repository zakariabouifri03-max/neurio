/* ============================================================
   Botola 25 — ui.js
   All the DOM screens: menus, squad, market, table, HUD, radar.
   ============================================================ */

import { CLUBS, clubById } from './data.js';
import { tableSorted, topScorers, myClub } from './career.js';
import { possessionPct } from './engine.js';

export const $ = (id) => document.getElementById(id);
export const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

const hex = (n) => '#' + n.toString(16).padStart(6, '0');

export function show(name) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('on'));
  const s = $('sc-' + name);
  if (s) s.classList.add('on');
  document.body.classList.toggle('playing', name === 'match');
}

let toastT = 0;
export function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('on'), 2100);
}

/* ------------------------------------------------------------------ */
export function renderMenu(c) {
  const box = $('menuBtns');
  box.innerHTML = '';
  const items = c
    ? [
        ['▶ كمّل الموسم', 'career', 'primary', `الجولة ${c.round + 1} من ${c.fixtures.length}`],
        ['👥 التشكيلة', 'squad', '', `${c.squads[c.clubId].length} لاعب`],
        ['💰 سوق الانتقالات', 'market', '', `${c.coins} 🪙 متاحة`],
        ['📊 الترتيب', 'table', '', `المركز ${posOf(c)}`],
        ['🎮 ماتش سريع', 'quick', 'ghost', ''],
        ['⚙️ الإعدادات', 'settings', 'ghost', ''],
      ]
    : [
        ['⚽ بدا موسم جديد', 'club', 'primary', 'ختار ناديك و دخل للبوطولا'],
        ['🎮 ماتش سريع', 'quick', 'ghost', ''],
        ['⚙️ الإعدادات', 'settings', 'ghost', ''],
      ];
  for (const [label, go, cls, sub] of items) {
    const b = el('button', 'btn ' + cls, label + (sub ? `<em>${sub}</em>` : ''));
    b.dataset.go = go;
    box.appendChild(b);
  }
  if (c) {
    const b = el('button', 'btn warn', '🗑️ مسيرة جديدة');
    b.dataset.go = 'restart';
    box.appendChild(b);
  }
  $('footClub').textContent = c ? myClub(c).name : 'ما كاينة حتى مسيرة';
  $('footCoins').textContent = c ? c.coins : 0;
  $('footGems').textContent = c ? c.gems : 0;
}

const posOf = (c) => {
  const t = tableSorted(c);
  return t.findIndex((r) => r.id === c.clubId) + 1 || '-';
};

/* ------------------------------------------------------------------ */
export function renderClubs(pick, onPick) {
  const g = $('clubGrid');
  g.innerHTML = '';
  CLUBS.forEach((club) => {
    const d = el('div', 'club' + (pick === club.id ? ' sel' : ''));
    d.innerHTML = `${badge(club, '')}<b>${club.name}</b><small>${club.city}</small><span class="rate">★ ${club.rate}</span>`;
    d.onclick = () => onPick(club.id);
    g.appendChild(d);
  });
}

export function badge(club, cls = 'sm') {
  const b = el('span', 'badge ' + cls, club.short);
  b.style.background = `linear-gradient(150deg, ${hex(club.c1)}, ${hex(club.c2)})`;
  b.style.color = isLight(club.c1) ? '#111' : '#fff';
  return b;
}
const isLight = (c) => {
  const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  return (r * 299 + g * 587 + b * 114) / 1000 > 150;
};

/* ------------------------------------------------------------------ */
export function renderCareer(c, onPlay) {
  $('carSeason').textContent = `الموسم ${c.season} • جولة ${Math.min(c.round + 1, c.fixtures.length)}/${c.fixtures.length}`;
  const fx = c.fixtures[c.round] ? c.fixtures[c.round].find((f) => f.home === c.clubId || f.away === c.clubId) : null;
  const nm = $('nextMatch');
  nm.innerHTML = '';
  if (!fx) {
    nm.appendChild(el('h3', '', 'الموسم سالا'));
  } else {
    const home = clubById(fx.home), away = clubById(fx.away);
    const vs = el('div', 'vs');
    const t1 = el('div', 'team'); t1.appendChild(badge(home, '')); t1.appendChild(el('b', '', home.name));
    t1.appendChild(el('small', '', `★ ${Math.round(avgOvr(c.squads[home.id]))}`));
    const x = el('div', 'vsx', 'VS');
    const t2 = el('div', 'team'); t2.appendChild(badge(away, '')); t2.appendChild(el('b', '', away.name));
    t2.appendChild(el('small', '', `★ ${Math.round(avgOvr(c.squads[away.id]))}`));
    vs.append(t1, x, t2);
    nm.appendChild(el('h3', '', fx.home === c.clubId ? '🏠 الماتش الجاي (ف دارك)' : '✈️ الماتش الجاي (برا)'));
    nm.appendChild(vs);
    const b = el('button', 'btn primary big', '⚽ العب الماتش');
    b.onclick = () => onPlay(fx, c.round);
    nm.appendChild(b);
  }

  const fr = $('carForm');
  fr.innerHTML = '';
  (c.form.length ? c.form : ['–']).forEach((f) => fr.appendChild(el('div', 'fr ' + f, f)));

  $('carStats').innerHTML =
    row('ماتشات', c.stats.played) + row('ربح', c.stats.wins) + row('تعادل', c.stats.draws) +
    row('خسارة', c.stats.losses) + row('له', c.stats.gf) + row('عليه', c.stats.ga) +
    row('كؤوس', c.trophies.length) + row('فلوس', c.coins + ' 🪙');

  $('carTable').innerHTML = tableHTML(c, 6);
  $('carScorers').innerHTML = scorersHTML(c);
}

const avgOvr = (sq) => sq.reduce((s, p) => s + p.rating, 0) / sq.length;
const row = (k, v) => `<span>${k}</span><b>${v}</b>`;

function tableHTML(c, limit) {
  const t = tableSorted(c).slice(0, limit || 99);
  let h = '<tr><th>#</th><th>النادي</th><th>ل</th><th>ر</th><th>ت</th><th>خ</th><th>+/-</th><th>ن</th></tr>';
  t.forEach((r, i) => {
    const club = clubById(r.id);
    h += `<tr class="${r.id === c.clubId ? 'me' : ''}">
      <td class="pos">${i + 1}</td>
      <td>${club.short} <small style="color:var(--dim)">${club.name}</small></td>
      <td>${r.p}</td><td>${r.w}</td><td>${r.d}</td><td>${r.l}</td>
      <td>${r.gf - r.ga > 0 ? '+' : ''}${r.gf - r.ga}</td><td class="pts">${r.pts}</td></tr>`;
  });
  return h;
}

function scorersHTML(c) {
  const s = topScorers(c);
  if (!s.length) return '<span>مازال ما كاين حتى هدف</span><b>—</b>';
  return s.map((p) => row(`${p.name} <small style="color:var(--dim)">(${p.club})</small>`, p.goals)).join('');
}

export function renderTable(c) {
  $('fullTable').innerHTML = tableHTML(c);
  $('tblScorers').innerHTML = scorersHTML(c);
}

/* ------------------------------------------------------------------ */
export function renderSquad(c, onTrain) {
  $('sqCoins').textContent = c.coins + ' 🪙';
  const list = $('squadList');
  list.innerHTML = '';
  const order = ['GK', 'CB', 'LB', 'RB', 'CM', 'LM', 'RM', 'ST'];
  const squad = c.squads[c.clubId].slice().sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role));
  squad.forEach((p) => {
    const d = el('div', 'pl');
    d.innerHTML = `
      <div class="no">${p.no}</div>
      <div>
        <div class="nm">${p.name}</div>
        <div class="sub">${p.role} • ${p.age} سنة • ${p.goals} هدف</div>
        <div class="stats">
          ${statBox(p, 'pace', 'سرعة')}
          ${statBox(p, 'shoot', 'تسديد')}
          ${statBox(p, 'pass', 'باس')}
          ${statBox(p, 'defend', 'دفاع')}
        </div>
      </div>
      <div class="ovr ${p.rating >= 80 ? 'hi' : ''}">${p.rating}</div>`;
    d.querySelectorAll('button[data-attr]').forEach((b) => {
      b.onclick = (e) => { e.stopPropagation(); onTrain(p.uid, b.dataset.attr); };
    });
    list.appendChild(d);
  });
}

function statBox(p, attr, label) {
  const cost = 60 + Math.round((p[attr] - 55) * 9);
  const max = p[attr] >= 96;
  return `<div class="stat"><i>${label}</i><b>${p[attr]}</b>
    <button data-attr="${attr}" ${max ? 'disabled' : ''}>${max ? 'MAX' : '+ ' + cost + '🪙'}</button></div>`;
}

/* ------------------------------------------------------------------ */
export function renderMarket(c, onBuy, onRefresh, onSell) {
  $('mkCoins').textContent = c.coins + ' 🪙';
  const list = $('marketList');
  list.innerHTML = '';
  c.market.forEach((p, i) => {
    const d = el('div', 'pl');
    d.innerHTML = `
      <div class="no">${p.role}</div>
      <div><div class="nm">${p.name}</div>
      <div class="sub">${p.age} سنة • من ${p.from} • PAC ${p.pace} / SHO ${p.shoot} / PAS ${p.pass} / DEF ${p.defend}</div></div>
      <button class="buy" ${c.coins < p.price ? 'disabled' : ''}>${p.price} 🪙</button>`;
    d.querySelector('.buy').onclick = () => onBuy(i);
    list.appendChild(d);
  });
  const sell = $('sellList');
  sell.innerHTML = '';
  c.squads[c.clubId].forEach((p) => {
    const price = Math.round((Math.pow(p.rating / 55, 4.0) * 70 + 40) / 5) * 5;
    const d = el('div', 'pl');
    d.innerHTML = `<div class="no">${p.no}</div>
      <div><div class="nm">${p.name}</div><div class="sub">${p.role} • OVR ${p.rating}</div></div>
      <button class="buy">بيع ${price} 🪙</button>`;
    d.querySelector('.buy').onclick = () => onSell(p.uid);
    sell.appendChild(d);
  });
  $('mkRefresh').onclick = onRefresh;
}

/* ------------------------------------------------------------------ */
/*  Quick match picker                                                 */
/* ------------------------------------------------------------------ */
export function renderQuick(state, onPick) {
  for (const [key, boxId] of [['home', 'qHome'], ['away', 'qAway']]) {
    const g = $(boxId);
    g.innerHTML = '';
    CLUBS.forEach((club) => {
      const d = el('div', 'club' + (state[key] === club.id ? ' sel' : ''));
      d.innerHTML = `${badge(club, '')}<b>${club.short}</b><small>★ ${club.rate}</small>`;
      d.onclick = () => onPick(key, club.id);
      g.appendChild(d);
    });
  }
}

/* ------------------------------------------------------------------ */
/*  Result screen                                                      */
/* ------------------------------------------------------------------ */
export function renderResult(r) {
  const { m, home, away, res, career } = r;
  const me = m.human;
  const my = m.teams[me], op = m.teams[1 - me];
  const won = res && res.won, drew = res && res.drew;
  $('resHead').innerHTML = `${home.short} — ${away.short} &nbsp;•&nbsp; ${career ? 'البطولة' : 'ماتش سريع'}`;
  $('resScore').innerHTML = `${m.teams[0].score} <span class="w">-</span> ${m.teams[1].score}`;

  const poss = possessionPct(m);
  $('resStats').innerHTML =
    row('الاستحواذ', `${me === 0 ? poss : 100 - poss}%`) +
    row('التسديدات', m.shots[me]) +
    row('ف المرمى', m.onTarget[me]) +
    row('تسديدات الخصم', m.shots[1 - me]) +
    row('باسات', m.passCount[me]) +
    row('تصديات الحارس', m.saved || 0);

  const ev = $('resEvents');
  ev.innerHTML = '';
  (m.events.length ? m.events : [{ text: 'ماتش هادي' }]).forEach((e) => ev.appendChild(el('div', '', e.text)));

  const rw = $('resReward');
  if (res) {
    rw.innerHTML = `<h3>${won ? '🏆 ربحتي!' : drew ? '🤝 تعادل' : '😔 خسارة'}</h3>
      <div class="kv">${row('مكافأة', '+' + res.reward + ' 🪙')}${res.gemReward ? row('جواهر', '+' + res.gemReward + ' 💎') : ''}
      ${res.seasonEnd ? row('نهاية الموسم', `المركز ${res.seasonEnd.pos} • +${res.seasonEnd.prize} 🪙`) : ''}
      ${row('الرصيد', c_coins(career))}</div>`;
  } else {
    rw.innerHTML = `<h3>ماتش سريع</h3><div class="kv">${row('النتيجة', `${my.score} - ${op.score}`)}</div>`;
  }
}
const c_coins = (c) => (c ? c.coins + ' 🪙' : '—');

/* ------------------------------------------------------------------ */
/*  In-match HUD                                                       */
/* ------------------------------------------------------------------ */
export function initHud(m) {
  const h = m.teams[0].club, a = m.teams[1].club;
  paint($('hudHomeC'), h.c1, h.c2);
  paint($('hudAwayC'), a.c1, a.c2);
  $('ticker').classList.remove('on');
  $('bigMsg').classList.remove('on');
  $('pauseMenu').classList.remove('on');
}
const paint = (node, c1, c2) => {
  node.style.background = `linear-gradient(150deg, ${hex(c1)}, ${hex(c2)})`;
};

let lastEvent = -1;
export function updateHud(m) {
  $('hudScore').textContent = `${m.teams[0].score} - ${m.teams[1].score}`;
  $('hudClock').textContent = `${Math.min(90, Math.floor(m.minute))}'`;
  $('hudHalf').textContent = m.half === 1 ? 'MI-TEMPS 1' : 'MI-TEMPS 2';
  const p = m.human >= 0 ? (m.human === 0 ? possessionPct(m) : 100 - possessionPct(m)) : possessionPct(m);
  $('possFill').style.width = p + '%';
  $('possTxt').textContent = p + '%';

  if (m.msgT > 0) {
    $('bigMsg').textContent = m.msg;
    $('bigMsg').classList.add('on');
  } else $('bigMsg').classList.remove('on');

  const pw = $('power');
  if (m.input.shootHold > 0.02) { pw.classList.add('on'); $('powerFill').style.width = (m.input.shootHold * 100) + '%'; }
  else pw.classList.remove('on');

  if (m.events.length && m.events.length - 1 !== lastEvent) {
    lastEvent = m.events.length - 1;
    const t = $('ticker');
    t.textContent = m.events[lastEvent].text;
    t.classList.add('on');
    clearTimeout(t._h);
    t._h = setTimeout(() => t.classList.remove('on'), 3200);
  }
}

/* ---------------- radar / mini-map ---------------- */
export function drawRadar(canvas, m) {
  const g = canvas.getContext('2d');
  const W = canvas.width, Hh = canvas.height;
  const sx = W / 116, sz = Hh / 78;
  g.clearRect(0, 0, W, Hh);
  g.fillStyle = 'rgba(10,40,22,.72)';
  g.fillRect(0, 0, W, Hh);
  g.strokeStyle = 'rgba(150,255,190,.35)';
  g.lineWidth = 1;
  const ox = (x) => (x + 58) * sx, oz = (z) => (z + 39) * sz;
  g.strokeRect(ox(-52.5), oz(-34), 105 * sx, 68 * sz);
  g.beginPath(); g.moveTo(ox(0), oz(-34)); g.lineTo(ox(0), oz(34)); g.stroke();
  g.beginPath(); g.arc(ox(0), oz(0), 9.15 * sx, 0, Math.PI * 2); g.stroke();

  for (const pl of m.players) {
    const t = m.teams[pl.team];
    const me = pl.team === m.human;
    g.fillStyle = pl.i === m.active ? '#ffffff' : hex(pl.role === 'GK' ? t.club.gk : t.club.c1);
    const r = pl.i === m.active ? 3.1 : 2.3;
    g.beginPath(); g.arc(ox(pl.p.x), oz(pl.p.z), r, 0, Math.PI * 2); g.fill();
    if (pl.i === m.active) {
      g.strokeStyle = '#2fe08a'; g.lineWidth = 1.4;
      g.beginPath(); g.arc(ox(pl.p.x), oz(pl.p.z), 5, 0, Math.PI * 2); g.stroke();
    }
    void me;
  }
  g.fillStyle = '#fff';
  g.beginPath(); g.arc(ox(m.ball.p.x), oz(m.ball.p.z), 2.6, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(255,255,255,.6)';
  g.beginPath(); g.arc(ox(m.ball.p.x), oz(m.ball.p.z), 4.4, 0, Math.PI * 2); g.stroke();
}
