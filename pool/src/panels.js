// ─────────────────────────────────────────────────────────────────────────────
//  panels.js — the content of every slide-in menu panel
//
//  Each builder gets a container and fills it with real, working controls.
//  Anything that genuinely needs the game server (accounts, ranked ladders,
//  real-money purchases, friend presence) says so instead of pretending.
// ─────────────────────────────────────────────────────────────────────────────
import { Profile, CUE_CATALOG, TITLES } from './profile.js';
import { LEVELS, levelName } from './ai.js';
import { $, el, toast, notify, modal, kv, ballChip, fmt, seg, setRow, toggle, range, openPanel, closePanel } from './ui.js';
import { CLOTH_COLORS, WOOD_FINISHES, QUALITY, QUALITY_ORDER, detectQuality } from './scene.js';

export const PANELS = {};

// ── helpers ─────────────────────────────────────────────────────────────────
const sec = (t) => { const n = el('div', 'sec', t); return n; };
const hint = (t) => el('div', 'hint', t);
const card = (cls, html) => { const n = el('div', 'card' + (cls ? ' ' + cls : ''), html); return n; };
const btn = (label, cls, fn) => { const b = el('button', 'btn ' + (cls || ''), label); b.addEventListener('click', fn); return b; };

/**
 * Coins, friends, loans, daily rewards and cue purchases are the server's
 * business when one is connected: ask it, then adopt the profile it returns.
 * Offline (or as a guest) the same actions run against the local profile.
 */
async function authority(app, request, local) {
  const net = app && app.net;
  if (!net || !net.online) return local();
  try {
    const r = await request();
    if (r && r.profile) { Profile.hydrate(r.profile); app.refreshMenu(); }
    return r;
  } catch (e) {
    toast(String((e && e.message) || e), 'warn', 3600);
    return null;
  }
}

function moneyRow(wallet) {
  const w = el('div', 'grid3');
  for (const [k, label, ico] of [['free', 'FREE', '🪙'], ['bought', 'BOUGHT', '💳'], ['bonus', 'BONUS', '🎁']]) {
    w.appendChild(card('', `<div class="thumb">${ico}</div><div class="ttl">${fmt(wallet[k])}</div><div class="sub">${label} coins</div>`));
  }
  return w;
}

// ── PLAY ────────────────────────────────────────────────────────────────────
PANELS.quickplay = (host, app) => {
  host.innerHTML = '';
  const s = Profile.settings;
  let mode = 'ai', game = '8ball', level = s.aiLevel || 3, stake = s.stake || 0;

  host.appendChild(sec('TABLE'));
  const tbl = el('div', 'grid2');
  const mkTable = (id, name, sub, tag) => card('', `<div class="thumb">🎱</div><div class="ttl">${name}</div><div class="sub">${sub}</div>${tag ? `<div class="tag ${tag.cls}">${tag.text}</div>` : ''}`);
  tbl.appendChild(mkTable('main', 'Championship 9-Foot', 'Tournament cloth · our table'));
  tbl.appendChild(mkTable('t2', 'Bar Box 7-Foot', 'Coming with the hall expansion'));
  host.appendChild(tbl);

  host.appendChild(sec('GAME'));
  const gameSeg = seg([{ id: '8ball', label: '8-BALL' }, { id: '9ball', label: '9-BALL' }], game, (v) => { game = v; refresh(); });
  host.appendChild(gameSeg);

  host.appendChild(sec('MODE'));
  const modes = el('div', 'grid2');
  const modeCards = [
    { id: 'practice', name: 'PRACTICE', sub: 'Free table · no rules, no coins', ico: '🎯', on: true },
    { id: 'ai', name: 'VS COMPUTER', sub: 'Five skill levels · real shot search', ico: '🤖', on: true },
    { id: 'local', name: 'LOCAL 2P', sub: 'Pass and play on this device', ico: '👥', on: true },
    { id: 'online', name: 'ONLINE 1V1', sub: 'Casual · Ranked · High stakes', ico: '🌐', on: !!(app.net && app.net.available), why: 'Needs the authoritative game server (pool/server). Start it with <code>node server/index.js</code> and reload — the client is never trusted with coins or results, so online play cannot run offline.' },
  ];
  const modeNodes = {};
  for (const m of modeCards) {
    const c = card(m.on ? '' : 'locked', `<div class="thumb">${m.ico}</div><div class="ttl">${m.name}</div><div class="sub">${m.sub}</div>`);
    if (!m.on) c.appendChild(el('div', 'tag', 'SERVER'));
    c.addEventListener('click', () => {
      if (!m.on || (m.id === 'online' && !(app.net && app.net.online))) {
        modal('Online play', `<p>${m.why}</p><p class="hint">Offline you can still play practice, pass-and-play, or five levels of computer opponent — all of it running the real physics and rules engines.</p>`, [{ label: 'GOT IT', value: true, cls: 'primary' }]);
        return;
      }
      mode = m.id;
      for (const k in modeNodes) modeNodes[k].classList.toggle('on', k === mode);
      refresh();
    });
    modeNodes[m.id] = c;
    modes.appendChild(c);
  }
  modeNodes[mode] && modeNodes[mode].classList.add('on');
  host.appendChild(modes);

  const lvlBox = el('div');
  host.appendChild(lvlBox);
  const stakeBox = el('div');
  host.appendChild(stakeBox);

  function refresh() {
    lvlBox.innerHTML = '';
    stakeBox.innerHTML = '';
    if (mode === 'ai') {
      lvlBox.appendChild(sec('OPPONENT'));
      const g = el('div', 'grid3');
      for (const L of LEVELS) {
        const c = card(level === L.id ? 'on' : '', `<div class="thumb">${['🐣', '🎱', '🏆', '⚡', '👑'][L.id - 1]}</div><div class="ttl">${L.name}</div><div class="sub">aim σ ${(L.aimErr * 1000).toFixed(0)} mrad</div>`);
        c.addEventListener('click', () => { level = L.id; Profile.set('aiLevel', level); refresh(); });
        g.appendChild(c);
      }
      lvlBox.appendChild(g);
      lvlBox.appendChild(hint('The computer reads the table, verifies every pot with the physics engine, plays safeties and misses like a human at that level. It is never given information you do not have.'));
    }
    if (mode !== 'practice') {
      stakeBox.appendChild(sec('STAKE'));
      const row = el('div', 'secRow');
      const val = el('b', '', `${stake} 🪙`);
      row.appendChild(val);
      stakeBox.appendChild(row);
      const sl = range(0, Math.max(500, Math.min(5000, Profile.total)), 50, stake, (v) => { stake = Math.round(v); val.textContent = `${stake} 🪙`; pot.textContent = `Winner takes ${stake * 2} 🪙`; });
      stakeBox.appendChild(sl);
      const pot = hint(`Winner takes ${stake * 2} 🪙 · you have ${fmt(Profile.total)}`);
      stakeBox.appendChild(pot);
      if (stake > Profile.total) stakeBox.appendChild(hint('⚠ Not enough coins for that stake.'));
    }
    go.disabled = false;
    go.textContent = mode === 'practice' ? 'START PRACTICE' : mode === 'online' ? (stake > 0 ? `FIND A MATCH FOR ${stake} 🪙` : 'FIND A MATCH') : stake > 0 ? `PLAY FOR ${stake} 🪙` : 'START MATCH';
    if (mode !== 'practice' && stake > Profile.total) {
      go.disabled = true;
      go.textContent = 'NOT ENOUGH COINS';
    }
    if (mode === 'online' && !(app.net && app.net.online)) {
      go.disabled = true;
      go.textContent = 'SERVER OFFLINE';
    }
  }

  const go = btn('START', 'primary big', () => {
    if (mode !== 'practice' && stake > Profile.total) {
      askCoins();
      return;
    }
    closePanel();
    app.startMatch({ mode, game, level, stake, table: 'main' });
  });
  refresh();
  host.appendChild(go);

  function askCoins() {
    const friends = Profile.me.friends;
    modal('Out of coins', `<p>You need ${fmt(stake)} coins but have ${fmt(Profile.total)}.</p>
      ${friends.length ? '<p class="hint">A friend can lend you coins — the loan is rate limited, logged and repayable with 10% interest. Online, the server validates it.</p>' : '<p class="hint">Add a friend first and they can lend you coins, or play a free practice table.</p>'}`,
    [
      { label: 'ASK A FRIEND', value: 'loan', cls: friends.length ? 'primary' : 'ghost' },
      { label: 'DAILY REWARD', value: 'daily' },
      { label: 'PRACTICE (FREE)', value: 'practice' },
      { label: 'CANCEL', value: null },
    ]).then((v) => {
      if (v === 'loan') { PANELS.friends(host.parentNode, app); }
      else if (v === 'daily') { PANELS.shop(host.parentNode, app); }
      else if (v === 'practice') { closePanel(); app.startMatch({ mode: 'practice', game, table: 'main' }); }
    });
  }
};

// ── FRIENDS ─────────────────────────────────────────────────────────────────
PANELS.friends = (host, app) => {
  host.innerHTML = '';
  const me = Profile.me;
  host.appendChild(sec('YOUR FRIENDS'));
  if (!me.friends.length) {
    host.appendChild(card('', `<div class="ttl">Nobody yet</div><div class="sub">Add a friend by name. Offline they are stored on this device; connected, the server keeps the list, presence and challenges.</div>`));
  }
  const list = el('div');
  host.appendChild(list);
  const draw = () => {
    list.innerHTML = '';
    for (const f of me.friends) {
      const row = el('div', 'rowItem', `<div class="ava">${f.avatar || '🎱'}</div><div class="riTxt"><b>${f.name}</b><i>${f.online ? 'online' : (f.note || 'offline')}</i></div>`);
      row.appendChild(el('div', f.online ? 'dotOn' : 'dotOff'));
      const btns = el('div', 'riBtns');
      btns.appendChild(btn('CHALLENGE', 'primary', () => {
        closePanel();
        app.startMatch({ mode: 'ai', game: '8ball', level: 3, stake: 0, opponent: f.name, breaker: 0 });
        toast(`Challenge accepted by ${f.name} (offline: played by the Club-level CPU)`);
      }));
      btns.appendChild(btn('GIFT 50', 'gold', () => {
        authority(app,
          () => app.net.giftCoins(f.name, 50),
          () => {
            if (!Profile.spend(50, `gift to ${f.name}`)) { toast('Not enough coins', 'warn'); return null; }
            f.gifted = (f.gifted || 0) + 50;
            return { ok: true };
          }).then((r) => { if (r) toast(`Sent 50 🪙 to ${f.name}`, 'good'); draw(); app.refreshMenu(); });
      }));
      btns.appendChild(btn('REMOVE', 'red', () => {
        authority(app, () => app.net.removeFriend(f.name), () => (Profile.removeFriend(f.name), { ok: true }))
          .then(() => { draw(); app.refreshMenu(); });
      }));
      row.appendChild(btns);
      list.appendChild(row);
    }
  };
  draw();

  host.appendChild(sec('ADD A FRIEND'));
  const row = el('div', 'secRow');
  const fld = el('input', 'fld');
  fld.placeholder = 'Username'; fld.maxLength = 16;
  fld.style.flex = '1';
  row.appendChild(fld);
  const add = btn('ADD', 'primary', () => {
    const name = fld.value;
    authority(app, () => app.net.addFriend(name), () => Profile.addFriend(name)).then((r) => {
      if (!r) return;
      if (r.ok === false) { toast(r.why, 'warn'); return; }
      fld.value = '';
      draw(); app.refreshMenu();
      toast('Friend added', 'good');
    });
  });
  row.appendChild(add);
  host.appendChild(row);

  host.appendChild(sec('ASK A FRIEND FOR COINS'));
  host.appendChild(hint('Only available at 0 coins. Limited to three loans a day, 20 minutes between them, and each one is logged and repayable at +10%.'));
  const lr = el('div', 'secRow');
  const who = el('select', 'fld');
  for (const f of me.friends) who.appendChild(el('option', '', f.name));
  if (!me.friends.length) { const o = el('option', '', '— add a friend first —'); o.disabled = true; who.appendChild(o); }
  const amt = el('input', 'fld'); amt.type = 'number'; amt.min = '50'; amt.max = '250'; amt.value = '150'; amt.style.width = '96px';
  const ask = btn('ASK', 'gold', () => {
    const amount = parseInt(amt.value || '150', 10);
    authority(app, () => app.net.askLoan(who.value, amount), () => Profile.askFriendLoan(who.value, amount)).then((r) => {
      if (!r) return;
      if (r.ok === false) { toast(r.why, 'warn'); return; }
      notify(`${r.from} sent you ${r.amount} 🪙`, `Repay ${r.repay} when you can. Logged in your loan history${app.net && app.net.online ? ' — the server validated it' : ''}.`, '🤝');
      app.refreshMenu();
      drawLoans();
    });
  });
  lr.appendChild(who); lr.appendChild(amt); lr.appendChild(ask);
  host.appendChild(lr);

  host.appendChild(sec('LOAN HISTORY'));
  const loans = el('div');
  host.appendChild(loans);
  function drawLoans() {
    loans.innerHTML = '';
    const taken = me.loans.taken;
    if (!taken.length) { loans.appendChild(hint('No loans yet.')); return; }
    taken.forEach((l, i) => {
      const row = el('div', 'rowItem', `<div class="ava">🤝</div><div class="riTxt"><b>${l.from} → you</b><i>${l.amount} 🪙 · ${new Date(l.t).toLocaleString()} ${l.repaid ? '· repaid' : `· repay ${Math.round(l.amount * 1.1)}`}</i></div>`);
      if (!l.repaid) {
        const b = btn('REPAY', 'primary', () => {
          authority(app, () => app.net.repayLoan(l.id || i), () => Profile.repayLoan(i)).then((r) => {
            if (!r) return;
            if (r.ok === false) { toast(r.why, 'warn'); return; }
            toast(`Repaid ${r.amount} 🪙 to ${l.from}`, 'good');
            drawLoans(); app.refreshMenu();
          });
        });
        const bs = el('div', 'riBtns'); bs.appendChild(b); row.appendChild(bs);
      }
      loans.appendChild(row);
    });
  }
  drawLoans();
};

// ── SHOP ────────────────────────────────────────────────────────────────────
PANELS.shop = (host, app) => {
  host.innerHTML = '';
  host.appendChild(sec('YOUR WALLET'));
  host.appendChild(moneyRow(Profile.me.wallet));
  host.appendChild(hint('FREE coins are earned by playing. BOUGHT coins come from real-money purchases and are never mixed with earned ones. BONUS coins come from packs, events and friend loans. Spending always takes bonus first, then free, then bought.'));

  host.appendChild(sec('DAILY REWARD'));
  const d = Profile.dailyAvailable();
  const dr = card('', `<div class="thumb">🎁</div><div class="ttl">Day ${((Profile.me.daily.streak) % 7) + 1} of 7</div><div class="sub">${d ? 'Ready to claim' : 'Come back tomorrow'} · streak ${Profile.me.daily.streak}</div>`);
  dr.appendChild(btn(d ? 'CLAIM' : 'CLAIMED', d ? 'primary' : 'ghost', () => {
    authority(app, () => app.net.claimDaily(), () => Profile.claimDaily() || { ok: false, why: 'Already claimed today' }).then((r) => {
      if (!r) return;
      if (r.ok === false) { toast(r.why || 'Already claimed today', 'warn'); return; }
      notify(`+${r.coins} coins`, `Daily reward day ${r.day} — streak ${r.streak}`, '🎁');
      app.audio && app.audio.click('coin');
      app.refreshMenu();
      PANELS.shop(host, app);
    });
  }));
  dr.querySelector('.btn').disabled = !d;
  host.appendChild(dr);
  const days = el('div', 'grid3');
  [100, 150, 250, 400, 600, 900, 1500].forEach((c, i) => {
    const on = i < Profile.me.daily.streak % 7;
    days.appendChild(card(on ? 'on' : '', `<div class="ttl">Day ${i + 1}</div><div class="sub">${c} 🪙</div>`));
  });
  host.appendChild(days);

  host.appendChild(sec('COIN PACKS'));
  host.appendChild(hint('Real-money purchases go through the platform store — Google Play Billing on Android, the desktop store elsewhere — and are credited by the server after the purchase token is validated. Nothing is charged or credited in this offline build.'));
  const packs = [
    { id: 'p1', coins: 2500, bonus: 0, price: '1.99', cur: 'USD' },
    { id: 'p2', coins: 7000, bonus: 1000, price: '4.99', cur: 'USD' },
    { id: 'p3', coins: 20000, bonus: 5000, price: '12.99', cur: 'USD' },
    { id: 'p4', coins: 55000, bonus: 20000, price: '29.99', cur: 'USD' },
  ];
  const g = el('div', 'grid2');
  for (const p of packs) {
    const c = card('', `<div class="thumb">🪙</div><div class="ttl">${fmt(p.coins)} coins</div><div class="sub">${p.bonus ? `+ ${fmt(p.bonus)} bonus` : 'no bonus'}</div><div class="price">${p.cur} ${p.price.toFixed(2)}</div>`);
    c.appendChild(btn('BUY', 'gold', () => {
      modal('Purchase not available offline', `<p>${fmt(p.coins)} coins for ${p.cur} ${p.price.toFixed(2)}.</p>
        <p class="hint">Purchases need the game server plus the platform billing client. The server validates the purchase token, credits <b>bought</b> coins (kept separate from earned coins) and writes the receipt to your ledger. Basic play never requires a purchase.</p>`,
      [{ label: 'OK', value: true, cls: 'primary' }]);
    }));
    g.appendChild(c);
  }
  host.appendChild(g);

  host.appendChild(sec('RECENT LEDGER'));
  const led = el('div');
  for (const l of Profile.me.ledger.slice(0, 12)) {
    led.appendChild(el('div', 'kv', `<span>${new Date(l.t).toLocaleString()} · ${l.kind} · ${l.reason}</span><b style="color:${l.amount > 0 ? '#5ef08a' : '#ff8b93'}">${l.amount > 0 ? '+' : ''}${l.amount}</b>`));
  }
  if (!Profile.me.ledger.length) led.appendChild(hint('No movements yet.'));
  host.appendChild(led);
};

// ── CUES ────────────────────────────────────────────────────────────────────
PANELS.cues = (host, app) => {
  host.innerHTML = '';
  host.appendChild(sec('YOUR COLLECTION'));
  host.appendChild(hint('Cues are cosmetic. Every cue uses the same tip friction, mass and deflection model — a 28,000-coin cue cannot pot a ball a house cue cannot. That is deliberate: no pay-to-win.'));
  const g = el('div', 'grid2');
  for (const c of CUE_CATALOG) {
    const owned = Profile.ownsCue(c.id);
    const equipped = Profile.me.equipped === c.id;
    const n = card(`${equipped ? 'on' : ''} ${owned ? '' : 'locked'}`,
      `<div class="thumb" style="background:linear-gradient(135deg,${c.shaft},${c.butt})"><span style="filter:drop-shadow(0 2px 4px rgba(0,0,0,.6))">🎱</span></div>
       <div class="ttl">${c.name}</div><div class="sub">${c.desc}</div>
       <div class="tag ${c.rarity}">${c.rarity.toUpperCase()}</div>
       ${owned ? '' : `<div class="price">🪙 ${fmt(c.price)}</div>`}`);
    n.appendChild(btn(equipped ? 'EQUIPPED' : owned ? 'EQUIP' : `BUY · ${fmt(c.price)}`, equipped ? 'ghost' : owned ? 'primary' : 'gold', () => {
      if (equipped) return;
      if (owned) { Profile.equipCue(c.id); toast(`Equipped ${c.name}`, 'good'); app.audio && app.audio.click('confirm'); }
      else {
        if (app.net && app.net.online) {
          app.net.buyCue(c.id).then((r) => {
            if (r && r.profile) Profile.hydrate(r.profile);
            notify('Cue acquired', `${c.name} added to your collection by the server.`, '🎱');
            app.audio && app.audio.click('coin');
            app.refreshMenu(); PANELS.cues(host, app); app.applyCue && app.applyCue();
          }).catch((e) => { toast(String(e.message || e), 'warn'); app.audio && app.audio.click('error'); });
          return;
        }
        const r = Profile.buyCue(c.id);
        if (!r.ok) { toast(r.why, 'warn'); app.audio && app.audio.click('error'); return; }
        Profile.equipCue(c.id);
        notify('Cue acquired', `${c.name} added to your collection and equipped.`, '🎱');
        app.audio && app.audio.click('coin');
      }
      app.refreshMenu();
      PANELS.cues(host, app);
      app.applyCue && app.applyCue();
    }));
    g.appendChild(n);
  }
  host.appendChild(g);
};

// ── PROFILE ─────────────────────────────────────────────────────────────────
PANELS.profile = (host, app) => {
  host.innerHTML = '';
  const me = Profile.me;
  const lv = Profile.levelFromXp(me.xp);
  host.appendChild(sec('PLAYER'));
  const top = el('div', 'rowItem', `<div class="ava" style="font-size:1.6rem">${me.avatar}</div><div class="riTxt"><b>${me.name}</b><i>Level ${lv.level} · ${Profile.title}${me.guest ? ' · local profile' : ' · server account'}</i></div>`);
  host.appendChild(top);
  const barWrap = el('div');
  barWrap.innerHTML = `<div class="bar"><div style="width:${(lv.into / lv.need * 100).toFixed(1)}%"></div></div><div class="hint">${fmt(lv.into)} / ${fmt(lv.need)} XP to level ${lv.level + 1}</div>`;
  host.appendChild(barWrap);

  const edit = el('div', 'secRow');
  const nm = el('input', 'fld'); nm.value = me.name; nm.maxLength = 16; nm.style.flex = '1';
  edit.appendChild(nm);
  edit.appendChild(btn('RENAME', 'primary', () => { Profile.rename(nm.value); app.refreshMenu(); toast('Name updated', 'good'); }));
  host.appendChild(edit);

  host.appendChild(sec('AVATAR'));
  const avs = el('div', 'grid3');
  for (const a of ['🎱', '🐺', '🦊', '🐻', '🦅', '🐉', '👑', '🎩', '🕶️', '🔥', '⚡', '🌙']) {
    const c = card(me.avatar === a ? 'on' : '', `<div class="thumb" style="font-size:2rem">${a}</div>`);
    c.addEventListener('click', () => { Profile.setAvatar(a); app.refreshMenu(); PANELS.profile(host, app); });
    avs.appendChild(c);
  }
  host.appendChild(avs);

  host.appendChild(sec('WALLET'));
  host.appendChild(moneyRow(me.wallet));

  host.appendChild(sec('STATISTICS'));
  const st = el('div');
  const s = me.stats;
  const winRate = s.played ? Math.round(s.won / s.played * 100) : 0;
  for (const [k, v] of [
    ['Matches played', s.played], ['Won', s.won], ['Lost', s.lost], ['Win rate', winRate + '%'],
    ['Best winning run', s.bestRun], ['Current run', s.run],
    ['Balls potted', s.potted], ['Shots taken', s.shots],
    ['Pot success', s.shots ? Math.round(s.potted / s.shots * 100) + '%' : '—'],
    ['Fouls', s.fouls], ['8-ball wins', s.eightWins],
  ]) st.appendChild(el('div', 'kv', `<span>${k}</span><b>${v}</b>`));
  host.appendChild(st);

  host.appendChild(sec('MATCH HISTORY'));
  const h = el('div');
  if (!me.history.length) h.appendChild(hint('No matches yet — go and break something.'));
  for (const m of me.history.slice(0, 15)) {
    h.appendChild(el('div', 'rowItem', `<div class="ava">${m.outcome === 'win' ? '🏆' : '💀'}</div><div class="riTxt"><b>${m.mode} vs ${m.opponent}</b><i>${new Date(m.t).toLocaleString()} · ${m.shots} shots · ${m.potted} potted${m.coins ? ` · ${m.coins > 0 ? '+' : '−'}${Math.abs(m.coins)} 🪙` : ''}${m.xp ? ` · +${m.xp} XP` : ''}</i></div>`));
  }
  host.appendChild(h);

  host.appendChild(sec('PROGRESSION'));
  const tg = el('div');
  TITLES.forEach((t, i) => {
    const lvl = i * 4 + 1;
    tg.appendChild(el('div', 'kv', `<span>${t}</span><b>${me.level >= lvl ? '✓ unlocked' : `level ${lvl}`}</b>`));
  });
  host.appendChild(tg);
};

// ── INBOX ───────────────────────────────────────────────────────────────────
PANELS.inbox = (host, app) => {
  host.innerHTML = '';
  host.appendChild(sec('MESSAGES'));
  const me = Profile.me;
  if (!me.inbox.length) {
    host.appendChild(card('', `<div class="ttl">Nothing here</div><div class="sub">Challenges, gifts, loan requests and system notices land here. Online, the server pushes them in real time; offline this list stays empty rather than inventing messages.</div>`));
  }
  for (const m of me.inbox) {
    host.appendChild(el('div', 'rowItem', `<div class="ava">${m.icon || '✉️'}</div><div class="riTxt"><b>${m.title}</b><i>${m.body}</i></div>`));
  }
  host.appendChild(sec('SYSTEM'));
  host.appendChild(el('div', 'rowItem', `<div class="ava">${app.net && app.net.online ? '🟢' : '⚪'}</div><div class="riTxt"><b>Server</b><i>${app.net && app.net.online ? `connected as ${Profile.me.name} — coins, friends, loans and match results are authoritative there` : 'not connected — this profile lives in localStorage on this device'}</i></div>`));
};

// ── TOURNAMENTS ─────────────────────────────────────────────────────────────
PANELS.tourney = (host, app) => {
  host.innerHTML = '';
  host.appendChild(sec('BRACKETS'));
  host.appendChild(hint('Tournaments are server-run: entry fees are held in escrow, pairings and results are validated by the authority, and prizes are paid from the escrow pot. Offline you can see the schedule but cannot enter.'));
  const list = [
    { name: 'Nightly 8-Ball Open', fee: 250, size: 16, start: '21:00 local', prize: '3,600 🪙' },
    { name: 'Weekend Cup', fee: 1000, size: 32, start: 'Sat 18:00', prize: '28,000 🪙' },
    { name: '9-Ball Blitz', fee: 100, size: 8, start: 'every 2 hours', prize: '720 🪙' },
    { name: 'VIP Invitational', fee: 5000, size: 8, start: 'by invitation', prize: '36,000 🪙' },
  ];
  for (const t of list) {
    const row = el('div', 'rowItem', `<div class="ava">🏆</div><div class="riTxt"><b>${t.name}</b><i>${t.size} players · entry ${fmt(t.fee)} 🪙 · prize ${t.prize} · ${t.start}</i></div>`);
    const bs = el('div', 'riBtns');
    bs.appendChild(btn('ENTER', 'ghost', () => modal('Server required', `<p><b>${t.name}</b> needs the game server: entries, escrow, pairings and results are all validated there so nobody can fake a bracket.</p><p class="hint">Offline you can still play a stake match against the computer from PLAY.</p>`, [{ label: 'OK', value: true, cls: 'primary' }])));
    bs.querySelector('.btn').disabled = true;
    row.appendChild(bs);
    host.appendChild(row);
  }
};

// ── SETTINGS ────────────────────────────────────────────────────────────────
PANELS.settings = (host, app) => {
  host.innerHTML = '';
  const s = Profile.settings;
  const rebuild = () => { app.refreshMenu(); };

  host.appendChild(sec('GRAPHICS'));
  const qg = el('div', 'grid3');
  for (const q of ['low', 'medium', 'high', 'ultra', 'auto']) {
    const c = card(s.quality === q ? 'on' : '', `<div class="ttl">${q.toUpperCase()}</div><div class="sub">${q === 'auto' ? 'detect + adapt' : QUALITY[q] ? `${QUALITY[q].dpr}× dpr${QUALITY[q].shadows ? ' · shadows' : ''}${QUALITY[q].bloom ? ' · bloom' : ''}` : ''}</div>`);
    c.addEventListener('click', () => {
      Profile.set('quality', q);
      app.applyQuality(q);
      PANELS.settings(host, app);
    });
    qg.appendChild(c);
  }
  host.appendChild(qg);
  host.appendChild(hint(`Current tier: <b>${app.scene.quality.toUpperCase()}</b> · ${app.scene.Q.dpr}× pixel ratio · ${app.scene.Q.shadows ? `shadows ${app.scene.Q.shadowSize}px` : 'no shadows'} · ${app.scene.Q.bloom ? 'bloom on' : 'bloom off'} · measured ${app.scene.fps.toFixed(0)} fps. Auto mode steps the tier down if the frame rate drops below 34.`));

  const rs = el('div', 'secRow');
  rs.appendChild(setRow('Render scale', range(0.6, 2, 0.05, s.resolution, (v) => { Profile.set('resolution', v); app.applyResolution(v); }), `${(s.resolution * 100).toFixed(0)}% of native`));
  host.appendChild(rs);
  host.appendChild(setRow('Bloom', toggle(s.bloom, (v) => { Profile.set('bloom', v); app.applyBloom(v); }), 'Glow on lamps and chrome'));
  host.appendChild(setRow('Shadows', toggle(s.shadows, (v) => { Profile.set('shadows', v); app.applyQuality(s.quality, true); }), 'Soft shadows from the table lamps'));
  host.appendChild(setRow('Frame cap', seg([{ id: 0, label: 'UNCAPPED' }, { id: 30, label: '30' }, { id: 60, label: '60' }, { id: 120, label: '120' }], s.frameCap || 0, (v) => { Profile.set('frameCap', v); app.applyFrameCap(v); }), 'Browser VSync is always on; this caps the frame rate for battery/heat'));
  host.appendChild(setRow('Show FPS', toggle(s.showFps, (v) => { Profile.set('showFps', v); rebuild(); }), ''));
  host.appendChild(setRow('Fullscreen', toggle(!!document.fullscreenElement, (v) => app.setFullscreen(v)), 'PC and Android'));

  host.appendChild(sec('TABLE LOOK'));
  const cg = el('div', 'grid2');
  for (const k in CLOTH_COLORS) {
    const c = card(s.clothColor === k ? 'on' : '', `<div class="thumb" style="background:${CLOTH_COLORS[k].base}"></div><div class="ttl">${CLOTH_COLORS[k].name}</div>`);
    c.addEventListener('click', () => { Profile.set('clothColor', k); app.applyTableLook(); PANELS.settings(host, app); });
    cg.appendChild(c);
  }
  host.appendChild(cg);
  const wg = el('div', 'grid3');
  for (const k in WOOD_FINISHES) {
    const c = card(s.tableFinish === k ? 'on' : '', `<div class="thumb" style="background:${WOOD_FINISHES[k].base}"></div><div class="ttl">${WOOD_FINISHES[k].name}</div>`);
    c.addEventListener('click', () => { Profile.set('tableFinish', k); app.applyTableLook(); PANELS.settings(host, app); });
    wg.appendChild(c);
  }
  host.appendChild(wg);

  host.appendChild(sec('GAMEPLAY'));
  host.appendChild(setRow('Aiming guides', seg([{ id: 0, label: 'OFF' }, { id: 1, label: 'BASIC' }, { id: 2, label: 'STD' }, { id: 3, label: 'PRO' }], s.guides, (v) => { Profile.set('guides', v); if (app.match) app.match.scene.guides.setLevel(v); }),
    'OFF · BASIC (aim + ghost) · STANDARD (+ object line, cue tangent, pocket) · PRO ASSIST (+ the real simulated cue and object paths, from a probe run of the physics engine)'));
  host.appendChild(setRow('Rail preview', toggle(s.guideRail, (v) => Profile.set('guideRail', v)), 'Show cushion rebounds'));
  host.appendChild(setRow('Aim sensitivity', range(0.3, 2.4, 0.05, s.sensitivity, (v) => Profile.set('sensitivity', v)), `${(s.sensitivity * 100).toFixed(0)}%`));
  host.appendChild(setRow('Left handed', toggle(s.leftHanded, (v) => Profile.set('leftHanded', v)), 'Flip the aim drag direction'));
  host.appendChild(setRow('Shot clock', toggle(s.shotClock, (v) => Profile.set('shotClock', v)), '30 s per shot, foul on expiry'));
  host.appendChild(setRow('Fast forward', toggle(s.fastForward, (v) => Profile.set('fastForward', v)), 'Speed up a shot that is rolling out'));
  host.appendChild(setRow('Auto camera', toggle(s.autoCam !== false, (v) => { Profile.set('autoCam', v); if (app.match) app.match.autoCam = v; }), 'Follow the action during a shot'));

  host.appendChild(sec('AUDIO'));
  host.appendChild(setRow('Sound', toggle(s.sound, (v) => { Profile.set('sound', v); app.audio.setEnabled(v); }), ''));
  host.appendChild(setRow('Master volume', range(0, 1, 0.02, s.volume, (v) => { Profile.set('volume', v); app.audio.setVolume(v); }), `${Math.round(s.volume * 100)}%`));
  host.appendChild(setRow('Effects', range(0, 1, 0.02, s.sfxVolume, (v) => { Profile.set('sfxVolume', v); app.audio.setSfxVolume(v); }), `${Math.round(s.sfxVolume * 100)}%`));
  host.appendChild(setRow('Music', toggle(s.music, (v) => { Profile.set('music', v); app.audio.setMusic(v); }), 'Procedural lounge bed'));
  host.appendChild(setRow('Spatial audio', toggle(s.spatialAudio, (v) => { Profile.set('spatialAudio', v); app.audio.spatial = v; }), 'HRTF panning — balls sound like they are where they are'));

  host.appendChild(sec('ACCOUNT'));
  host.appendChild(el('div', 'rowItem', `<div class="ava">${app.net && app.net.online ? '🟢' : '⚪'}</div><div class="riTxt"><b>${app.net && app.net.online ? 'Connected' : 'Offline profile'}</b><i>${app.net && app.net.online ? 'Server-authoritative coins, friends and results' : 'Everything is stored in this browser. Connect the game server to make it authoritative.'}</i></div>`));
  const danger = el('div', 'secRow');
  danger.appendChild(btn('ERASE LOCAL PROFILE', 'red', () => {
    modal('Erase everything?', '<p>This deletes the local profile: coins, cues, stats and settings on this device.</p>', [
      { label: 'ERASE', value: true, cls: 'red' }, { label: 'CANCEL', value: null },
    ]).then((v) => { if (v) { Profile.wipe(); app.refreshMenu(); toast('Local profile erased', 'warn'); PANELS.settings(host, app); } });
  }));
  host.appendChild(danger);
};

export function openPanelByName(name, app) {
  const titles = {
    quickplay: 'PLAY', friends: 'FRIENDS', shop: 'SHOP', cues: 'CUES',
    profile: 'PROFILE', inbox: 'INBOX', tourney: 'TOURNAMENTS', settings: 'SETTINGS',
  };
  const fn = PANELS[name];
  if (!fn) { toast('Panel not available'); return; }
  openPanel(titles[name] || name, (body) => fn(body, app));
}

export default PANELS;
