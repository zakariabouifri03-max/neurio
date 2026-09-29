// ═════════════════════════════════════════════════════════════════════════════
// UI — every DOM surface of the game. Pure rendering + intent callbacks:
// it never computes scores, it only asks the authority to do things.
// ═════════════════════════════════════════════════════════════════════════════
import { $, el, fmt, signed, toast, burst, isTouch, copyText } from './util.js';
import {
  ROLES, ROLE_BY_ID, EMOTES, CHAT_GROUPS, TAGS, COSM, COSM_SLOTS, SETTINGS_META, TOGGLE_META,
  CFG, GOODS, ANNOUNCER, TIPS, GAME_TITLE,
} from '../../shared/content.js';
import { load, save, patch, setAvatar, setName, ownedIds, isOwned, priceOf, buy, addBank, recordGame, defaultProfile } from './save.js';

const PHASE_META = {
  lobby: { n: 'LOBBY', i: '🥂' },
  brief: { n: 'SECRETS OUT', i: '️' },
  talk: { n: 'DEALS OPEN', i: '🤝' },
  submit: { n: 'RECKONING', i: '⏳' },
  lock: { n: 'LOCKED', i: '🔒' },
  reveal: { n: 'THE REVEAL', i: '🎬' },
  results: { n: 'PAYOUT', i: '🪙' },
  final: { n: 'LAST ONE STANDING', i: '👑' },
};

export class UI {
  constructor(on = {}) {
    this.on = on;
    this.p = load();
    this.sel = new Map();        // per-round UI selections
    this.chatOpen = false;
    this.feedMax = 6;
    this.revealSeen = new Set();
    this.t = 0;
    this.buildTicker();
    this.buildMenuTips();
    this.bindMenu();
    this.bindTop();
    this.bindDock();
    this.bindChat();
    this.bindEmotes();
    this.bindLobby();
    this.bindFinal();
    this.bindMini();
  }

  // ── screens ────────────────────────────────────────────────────────────────
  screen(s) {
    this.screenName = s;
    $('#menu').hidden = s !== 'menu';
    $('#ui').hidden = s === 'menu';
    $('#lobby').hidden = s !== 'lobby';
    if (s !== 'game') { $('#finalCard').hidden = true; $('#theatre').hidden = true; }
    document.body.classList.toggle('in-game', s === 'game');
  }

  // ── menu ──────────────────────────────────────────────────────────────────
  buildMenuTips() {
    const box = $('#menuTips');
    const items = [...TIPS, ...ANNOUNCER.roundStart].map((t) => `<span>◆ ${t}</span>`).join('');
    box.innerHTML = items + items;
  }
  buildTicker() {
    const t = $('#tickerTrack');
    t.innerHTML = `<span class="nohit">🎭 <b>SWINDLE SQUAD</b></span><span class="nohit">every round re-deals the roles — nobody is the same liar twice</span><span class="nohit">accept a deal during the reckoning, void it before the buzzer</span>`;
  }
  bindMenu() {
    const quick = $('#mQuick'), create = $('#mCreate'), join = $('#mJoin');
    const go = (fn) => (e) => { e.currentTarget.blur(); fn(); };
    quick.onclick = go(() => this.on.quick());
    create.onclick = go(() => this.on.create());
    join.onclick = go(() => {
      const b = $('#joinBox');
      b.hidden = !b.hidden;
      if (!b.hidden) { $('#joinInput').focus(); $('#joinInput').select(); }
    });
    $('#joinGo').onclick = () => {
      const c = $('#joinInput').value.trim().toUpperCase();
      if (c.length < 4) { $('#joinHint').textContent = 'Codes are 5 letters, e.g. ' + (this.p.lastCode || 'QUACK'); return; }
      this.on.join(c);
    };
    $('#joinInput').onkeydown = (e) => { if (e.key === 'Enter') $('#joinGo').click(); };
    $('#mCustom').onclick = () => this.openCustomize();
    $('#mShop').onclick = () => this.openShop();
    $('#mStats').onclick = () => this.openStats();
    $('#mHelp').onclick = () => this.openHelp();
    $('#mOpts').onclick = () => this.openOptions();
  }
  refreshWallet() {
    const bank = fmt(this.p.bank || 0);
    const m = $('#menuChips'); if (m) m.textContent = bank;
    const e = $('#earnedNow'); if (e) e.textContent = bank;
    const n = $('#earnedNote');
    if (n) { const last = (this.p.history || [])[0]; n.textContent = last ? ' · ' + signed(last.chips) + ' last night' : ''; }
  }
  setStatus(kind, text) {
    const dot = $('#netDot'), lbl = $('#netLabel');
    dot.className = 'net dot' + (kind === 'online' || kind === 'local' ? ' on' : kind === 'connecting' || kind === 'reconnecting' ? ' mid' : '');
    lbl.textContent = text || (kind === 'online' ? 'connected to the house' : kind === 'local' ? 'solo table — you are the authority in this tab' : kind === 'connecting' ? 'knocking on the door…' : kind === 'reconnecting' ? 'signal dropped — retrying…' : 'offline — solo table available');
  }

  // ── in-game top bar / clock ────────────────────────────────────────────────
  bindTop() {
    $('#codeBadge').onclick = async () => {
      await copyText(this.code || '');
      toast('Room code ' + this.code + ' copied — send it to a friend', 'good');
    };
    $('#btnSound').onclick = () => this.on.toggleSound?.();
    $('#btnSettings').onclick = () => this.openOptions();
    $('#btnChatTop').onclick = () => this.toggleChat();
    $('#btnEmoteTop').onclick = () => this.toggleEmotes();
  }
  hud(state) {
    if (!state) return;
    this.code = state.code; this.state = state;
    $('#roomCode').textContent = state.code || '·····';
    const ph = PHASE_META[state.phase] || PHASE_META.lobby;
    $('#phaseIcon').textContent = ph.i; $('#phaseName').textContent = ph.n;
    $('#roundNum').textContent = String(Math.max(1, (state.round ?? 0) + 1));
    $('#roundTot').textContent = String(state.total || state.settings?.rounds || 6);
    const ms = Math.max(0, (state.phaseEnds || 0) - (state.now || 0));
    const total = Math.max(1, (state.phaseEnds || 1) - (state.phaseStart || 0));
    const secs = Math.ceil(ms / 1000);
    $('#clockNum').textContent = secs >= 60 ? Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0') : String(secs);
    const arc = $('#clockArc');
    const frac = Math.max(0, Math.min(1, ms / total));
    arc.style.strokeDashoffset = String(276.5 * (1 - frac));
    const clk = $('#clock');
    clk.classList.toggle('warn', secs <= 8 && secs > 0 && (state.phase === 'talk' || state.phase === 'submit'));
    clk.classList.toggle('done', state.phase === 'lock' || state.phase === 'reveal');
    $('#clockLabel').textContent = state.roundInfo ? state.roundInfo.title.toUpperCase() : 'THE TABLE';
    this.rail(state);
    this.objective(state);
    this.decision(state);
    this.actions(state);
    this.offers(state);
    this.accuseStrip(state);
  }

  // ── score rail ─────────────────────────────────────────────────────────────
  rail(state) {
    const host = $('#scoreRail');
    const list = (state.players || []).filter((p) => p.seat >= 0 && !p.spectating);
    if (host.childElementCount !== list.length) {
      host.innerHTML = '';
      for (const p of list) {
        const c = el('div', 'pcard');
        c.dataset.pid = p.pid;
        c.innerHTML = `<span class="ava"></span><span><span class="nm"></span><span class="tags"></span></span><span class="ch"></span>`;
        host.appendChild(c);
      }
    }
    const tellKeys = state.public?.tells || {};
    const locked = new Set(state.public?.locked || []);
    const accused = state.public?.accuses || {};
    for (const p of list) {
      const c = host.querySelector(`.pcard[data-pid="${p.pid}"]`); if (!c) continue;
      c.classList.toggle('you', !!p.you);
      c.classList.toggle('dead', !p.connected);
      c.classList.toggle('act', locked.has(p.pid));
      c.classList.toggle('accused', Object.values(accused).includes(p.pid));
      c.querySelector('.ava').textContent = p.avatar && p.avatar.acc >= 0 ? ['🦆', '📿', '', '💼', '🦜', '👑', '⛓️'][p.avatar.acc % 7] : ['🙂', '😴', '', '', '😏', '🤨'][p.avatar.face % 6];
      c.querySelector('.nm').textContent = p.name + (p.isHost ? ' ★' : '') + (p.isBot ? ' ⌁' : '');
      const tags = [];
      if (tellKeys[p.pid]) tags.push(tellKeys[p.pid].join(' · '));
      if (p.isBot) tags.push('bot');
      if (!p.connected) tags.push('away');
      c.querySelector('.tags').textContent = tags.join('  |  ');
      const ch = c.querySelector('.ch');
      ch.innerHTML = `<span>${fmt(p.chips)}</span>`;
      const d = this.delta?.[p.pid];
      if (d && (performance.now() - d.at < 4200)) {
        ch.innerHTML += `<small style="color:${d.v > 0 ? 'var(--good)' : '#ff8fa8'}">${signed(d.v)}</small>`;
      }
      c.title = `${p.name} — scams ${p.stats?.scams | 0} · catches ${p.stats?.catches | 0}`;
    }
  }

  // ── objective card ─────────────────────────────────────────────────────────
  objective(state) {
    const me = state.me;
    const card = $('#objCard');
    if (!me) { card.hidden = true; return; }
    card.hidden = false;
    const role = ROLE_BY_ID[me.role] || ROLE_BY_ID.civilian;
    $('#ocRole').innerHTML = `<span class="ic">${role.icon}</span><b>${role.name.toUpperCase()}</b>`;
    $('#ocObjective').textContent = role.obj;
    const sec = state.secret || {};
    let html = '';
    if (sec.head) html += `<div><b>${esc(sec.head)}</b></div>`;
    if (sec.sub) html += `<div style="opacity:.8;margin-top:.15rem">${esc(sec.sub)}</div>`;
    for (const r of sec.rows || []) {
      html += `<div class="srow ${r.good ? 'good' : r.bad ? 'bad' : ''}"><span>${esc(r.k)}</span><b>${esc(r.v)}${r.note ? ' <i style="opacity:.7">' + esc(r.note) + '</i>' : ''}</b></div>`;
    }
    $('#ocSecret').innerHTML = html || '<i style="opacity:.6">nothing else for you tonight</i>';
    $('#ocAbility').textContent = role.ability ? role.ability.toUpperCase() : '';
    $('#ocLock').classList.toggle('on', !!me.locked);
    if (this.p.settings.autoReady) void 0;
  }

  // ── decision pad ───────────────────────────────────────────────────────────
  decision(state) {
    const pad = $('#decisionPad');
    const opts = state.options || [];
    const me = state.me;
    const showable = state.phase === 'brief' || state.phase === 'talk' || state.phase === 'submit';
    pad.hidden = !showable || !opts.length;
    if (pad.hidden) return;
    const sel = me?.commit || null;
    $('#dpTitle').textContent = state.phase === 'submit' ? 'THE RECKONING' : 'YOUR MOVE';
    $('#dpSub').textContent = me?.locked ? 'locked — you can still change it until the buzzer' : 'pick one, then lock it';
    const grid = $('#dpOptions');
    grid.classList.toggle('locked', !!me.locked);
    if (grid.dataset.sig !== opts.map((o) => o.id).join()) {
      grid.dataset.sig = opts.map((o) => o.id).join();
      grid.innerHTML = '';
      opts.forEach((o, i) => {
        const b = el('button', 'opt' + (o.style ? ' ' + o.style : ''));
        b.dataset.id = o.id;
        b.innerHTML = `<span class="oi">${o.icon || '•'}</span><span class="ol">${esc(o.label)}</span><span class="oh">${esc(o.hint || '')}</span>` +
          (o.style === 'danger' ? '<span class="obadge">RISKY</span>' : o.style === 'safe' ? '<span class="obadge" style="background:var(--good);color:#06231a">SAFE</span>' : '');
        b.onclick = () => { this.on.commit?.(o.id); audioClick(); };
        grid.appendChild(b);
      });
    }
    [...grid.children].forEach((b) => b.classList.toggle('sel', b.dataset.id === sel));
    const lock = $('#btnLock');
    lock.classList.toggle('primary', !me?.locked);
    lock.innerHTML = me?.locked ? '✅ <span>CHANGED MY MIND</span>' : '🔒 <span>LOCK MY CALL</span>';
    lock.onclick = () => { if (me?.locked) this.on.uncommit?.(); else if (sel) this.on.commitLock?.(); else toast('Pick something first — the clock is not a decoration'); };
    const push = $('#btnPush');
    push.hidden = !state.roundInfo?.push;
    push.classList.toggle('on', !!me?.push);
    push.onclick = () => this.on.push?.(!me?.push);
  }

  // ── live actions ───────────────────────────────────────────────────────────
  actions(state) {
    const dock = $('#actionDock');
    const list = state.actions || [];
    const live = state.phase === 'talk' || state.phase === 'submit' || state.phase === 'brief';
    dock.hidden = !live || !list.length;
    if (dock.hidden) return;
    const sig = list.map((a) => a.id + (a.targets || '')).join();
    if (dock.dataset.sig !== sig) {
      dock.dataset.sig = sig;
      dock.innerHTML = '';
      for (const a of list) {
        const b = el('button', 'act');
        b.dataset.id = a.id;
        b.innerHTML = `<span>${a.icon || '✦'}</span><span>${esc(a.label)}${a.hint ? '<small>' + esc(a.hint) + '</small>' : ''}</span>`;
        b.title = a.hint || a.label;
        b.onclick = () => this.pickTarget(a);
        dock.appendChild(b);
      }
    }
    const me = state.me || {};
    dock.querySelector('.act[data-id="flag"]')?.classList.toggle('on', me.flagTarget != null);
    dock.querySelector('.act[data-id="insure"]')?.classList.toggle('on', me.insuredSet != null);
  }

  pickTarget(a) {
    audioClick();
    if (a.targets === 'one' || a.targets === 'others') {
      this.openPicker({
        title: a.label, sub: a.hint || 'Who?',
        items: this.targetPids().map((pid) => ({ id: pid, label: this.nameOf(pid), icon: this.avatarEmoji(pid), sub: fmt(this.chipsOf(pid)) + ' 🪙' })),
        onPick: (pid) => this.on.action?.(a.id, { target: pid }),
      });
      return;
    }
    if (a.targets === 'cases') {
      const cases = this.state?.public?.cases || [];
      this.openPicker({
        title: a.label, sub: a.hint || 'Pick up to two', multi: 2,
        items: cases.map((c) => ({ id: c.id, label: 'Case ' + c.label, icon: '🧳' })),
        onPick: (ids) => this.on.action?.(a.id, { cases: ids }),
      });
      return;
    }
    if (a.targets === 'lots') {
      const lots = this.state?.public?.lots || [];
      this.openPicker({
        title: a.label, sub: a.hint || 'Which lot?',
        items: lots.map((l) => ({ id: l.id, label: l.name, icon: '🔨' })),
        onPick: (ids) => this.on.action?.(a.id, { lots: ids }),
      });
      return;
    }
    if (a.id === 'ask') {
      const loans = this.state?.public?.loans || [150, 320, 560, 820];
      this.openPicker({
        title: 'How much do you want?', sub: 'Borrow big, owe big.',
        items: loans.map((v, i) => ({ id: i, label: fmt(v) + ' chips', icon: '💳' })),
        onPick: (ids) => this.on.action?.('ask', { amount: ids[0] }),
      });
      return;
    }
    this.on.action?.(a.id, {});
  }

  targetPids() {
    const me = this.state?.me;
    return (this.state?.players || []).filter((p) => p.seat >= 0 && !p.spectating && p.pid !== me?.pid && p.connected !== false).map((p) => p.pid);
  }
  nameOf(pid) { return this.state?.players?.find((p) => p.pid === pid)?.name || '?'; }
  chipsOf(pid) { return this.state?.players?.find((p) => p.pid === pid)?.chips || 0; }
  avatarEmoji(pid) {
    const a = this.state?.players?.find((p) => p.pid === pid)?.avatar;
    return a ? (a.acc >= 0 ? '🦆' : ['🙂', '😴', '', '🤿', '😏', '🤨'][a.face % 6]) : '🙂';
  }

  // ── deals ──────────────────────────────────────────────────────────────────
  offers(state) {
    const tray = $('#dealTray');
    const list = (state.offers || []).slice(-6);
    const me = state.me?.pid;
    const showable = state.phase === 'talk' || state.phase === 'submit';
    tray.hidden = !showable || !list.length;
    if (tray.hidden) { tray.innerHTML = ''; return; }
    const sig = list.map((o) => o.id + o.status + (o.mine?.voidIntent ? 'v' : '') + o.give + o.want).join();
    if (tray.dataset.sig === sig) return;
    tray.dataset.sig = sig;
    tray.innerHTML = '';
    for (const o of list) {
      const mine = o.from === me || o.to === me;
      const card = el('div', 'deal' + (o.status === 'void' ? ' void' : '') + (o.to === me ? ' mine' : ''));
      card.innerHTML =
        `<div class="dl-top"><span>${esc(o.fromName || '?')}</span><span>→</span><span>${esc(o.toName || '?')}</span></div>
         <div class="dl-body">
           <div class="dl-side"><span>OFFERS</span><b>${esc(o.give)}</b></div>
           <div class="dl-mid">⇄</div>
           <div class="dl-side"><span>WANTS</span><b>${esc(o.want)}</b></div>
         </div>
         ${o.note ? `<div class="dl-note">“${esc(o.note)}”</div>` : ''}
         ${o.status === 'accepted' ? '<span class="stamp">ACCEPTED</span>' : o.status === 'rejected' ? '<span class="stamp" style="border-color:#3a5;color:#274">DECLINED</span>' : o.status === 'void' ? '<span class="stamp">DEAD</span>' : ''}`;
      if (o.to === me && o.status === 'open') {
        const btns = el('div', 'dl-btns');
        const yes = el('button', 'btn primary', 'TAKE IT');
        const no = el('button', 'btn', 'NO');
        yes.onclick = () => this.on.offerResp?.(o.id, true);
        no.onclick = () => this.on.offerResp?.(o.id, false);
        btns.append(yes, no); card.append(btns);
      }
      if (o.from === me && o.status === 'accepted' && state.phase === 'submit') {
        const btns = el('div', 'dl-btns');
        const v = el('button', 'btn ' + (o.mine?.voidIntent ? 'danger' : 'ghost'), o.mine?.voidIntent ? '⚠ LOophole ARMED' : '🤝 HONOUR IT');
        v.onclick = () => this.on.offerVoid?.(o.id, !o.mine?.voidIntent);
        btns.append(v); card.append(btns);
      }
      tray.append(card);
    }
  }

  accuseStrip(state) {
    const strip = $('#accuseStrip');
    const can = !!state.roundInfo?.accuse && (state.phase === 'submit' || state.phase === 'talk');
    strip.hidden = !can;
    if (!can) return;
    const cur = state.me?.accuse ?? null;
    const sig = (state.players || []).map((p) => p.pid).join() + cur;
    if (strip.dataset.sig === sig) return;
    strip.dataset.sig = sig;
    strip.innerHTML = '<span class="lbl">POINT AT SOMEONE</span>';
    for (const p of this.targetPids().map((pid) => state.players.find((x) => x.pid === pid))) {
      if (!p) continue;
      const b = el('button', 'acc' + (cur === p.pid ? ' on' : ''));
      b.innerHTML = `${this.avatarEmoji(p.pid)}<span>${esc(p.name.slice(0, 5))}</span>`;
      b.title = 'Name ' + p.name + ' in front of the table';
      if ((state.public?.accuses || {})[p.pid]) b.classList.add('pointed');
      b.onclick = () => { this.on.accuse?.(cur === p.pid ? null : p.pid); audioClick(); };
      strip.append(b);
    }
    const hint = el('span', 'hint');
    hint.textContent = cur ? 'you named ' + this.nameOf(cur) : 'no name = no claim';
    strip.append(hint);
  }

  // ── feed ────────────────────────────────────────────────────────────────────
  feed(text, tone = '') {
    const box = $('#feed');
    const f = el('div', 'fe ' + tone, text);
    box.prepend(f);
    while (box.childElementCount > this.feedMax) box.lastChild.remove();
    setTimeout(() => { f.style.transition = 'opacity .6s'; f.style.opacity = '0'; setTimeout(() => f.remove(), 700); }, 9000);
  }
  chatLine(name, text, sys) {
    this.feed(`<b>${esc(name)}</b> ${sys ? '' : 'says:'} ${esc(text)}`, sys ? 'story' : '');
  }

  // ── reveal theatre ────────────────────────────────────────────────────────
  // The authority paces the reveal: it releases one beat at a time (see engine
  // `beatCursor`), so the DOM side only ever reflects what has been unbolted.
  thStart(v) {
    const box = $('#theatre'), row = $('#thRow');
    box.hidden = false; row.innerHTML = '';
    this.thCards = {};
    const players = (v.players || []).filter((p) => p.seat >= 0 && !p.spectating);
    for (const p of players) {
      const c = el('div', 'thcard', `data-pid="${p.pid}"`);
      c.dataset.pid = p.pid;
      c.innerHTML = `<div class="tname">${esc(p.name)}</div><div class="trole">role hidden</div>
        <div class="tdesc">undecided</div><div class="tdelta"></div><div class="tchip">${fmt(p.chips)} 🪙</div>`;
      row.append(c);
      this.thCards[p.pid] = c;
    }
    const rv = v.reveal || {};
    for (const p of players) {
      const c = this.thCards[p.pid]; if (!c) continue;
      const role = ROLE_BY_ID[rv.roles?.[p.pid]];
      if (role) c.querySelector('.trole').textContent = role.icon + ' ' + role.name.toUpperCase();
      else c.querySelector('.trole').textContent = 'reading the room…';
      c.querySelector('.tdesc').textContent = 'thinking…';
    }
    this.thBeatCount = 0;
    $('#thCaption').innerHTML = `<div class="thc-line big">EVERYTHING COMES OUT<small>${esc(rv.intro || 'the table remembers')}</small></div>`;
  }
  thBeat(b, v) {
    const cap = $('#thCaption');
    const cls = b.tone === 'good' ? 'good' : b.tone === 'bad' ? 'bad' : b.tone === 'trick' ? 'trick' : '';
    const rv = v?.reveal || {};
    cap.innerHTML = `<div class="thc-line ${cls}">${esc(b.text || '…')}<small>${esc(b.kind)} · ${(rv.cursor || 0)}/${rv.total || 0}</small></div>`;
    for (const pid of Object.keys(this.thCards || {})) this.thCards[pid].classList.toggle('hot', b.focus === pid);
    if (b.pid && this.thCards?.[b.pid]) {
      const d = this.thCards[b.pid].querySelector('.tdesc');
      if (d) d.textContent = String(b.text || '').replace(/^[^:]*:\s*/, '').slice(0, 56);
    }
    this.thBeatCount++;
  }
  thEnd(v) {
    const rv = (v && v.reveal) || {};
    for (const a of rv.awards || []) {
      const c = this.thCards?.[a.pid]; if (!c) continue;
      const t = TAGS[a.tag] || { n: a.tag, i: '', c: '#fff' };
      const d = c.querySelector('.tdelta');
      d.textContent = signed(a.delta);
      d.className = 'tdelta ' + (a.delta >= 0 ? 'p' : 'n');
      const chip = c.querySelector('.tchip');
      chip.textContent = t.i + ' ' + t.n;
      chip.style.color = t.c;
      const why = c.querySelector('.tdesc');
      if (why && a.why) why.innerHTML += `<br><i style="opacity:.7">${esc(a.why)}</i>`;
      c.classList.add('hot');
    }
    $('#thCaption').innerHTML = `<div class="thc-line big">CHIPS COUNTED<small>round ${((v?.round ?? 0) + 1)} of ${v?.total ?? '?'} — the table remembers all of it</small></div>`;
    clearTimeout(this._thHide);
    this._thHide = setTimeout(() => { $('#theatre').hidden = true; }, 2600);
  }
  resetTheatre() { clearTimeout(this._thHide); $('#theatre').hidden = true; this.thCards = {}; }
  hideTheatre() { $('#theatre').hidden = true; }
  banner(text, sub = '', color = '#fff') {
    const b = $('#bigBanner');
    $('#bbText').textContent = text;
    $('#bbText').style.color = color;
    $('#bbSub').textContent = sub;
    b.hidden = false;
    b.firstElementChild.style.animation = 'none';
    void b.offsetWidth;
    b.firstElementChild.style.animation = '';
    clearTimeout(this._bbT);
    this._bbT = setTimeout(() => { b.hidden = true; }, 2100);
  }

  // ── results / final ─────────────────────────────────────────────────────────
  showFinal(data, prof) {
    const card = $('#finalCard');
    card.hidden = false;
    const board = data.board || [];
    const w = board[0];
    $('#fcWinner').textContent = w ? `${w.name.toUpperCase()} TAKES THE TABLE` : 'NOBODY WINS';
    $('#fcQuote').textContent = data.quote || '';
    const box = $('#fcBoard'); box.innerHTML = '';
    board.forEach((b, i) => {
      const row = el('div', 'fcb' + (i === 0 ? ' first' : ''));
      row.innerHTML = `<span class="pl">${['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th'][i] || i + 1}</span>
        <span class="nm">${esc(b.name)}${b.pid === data.me ? ' (you)' : ''}</span>
        <span class="sc">${fmt(b.chips)} 🪙</span>
        <span class="ear">+${fmt(b.earned || 0)} to wallet</span>`;
      box.append(row);
    });
    const me = board.find((b) => b.pid === data.me);
    $('#fcEarned').innerHTML = me
      ? `You banked <b>+${fmt(me.earned || 0)}</b> 🪙 for cosmetics · scams pulled <b>${me.stats?.scams | 0}</b> · catches <b>${me.stats?.catches | 0}</b>`
      : 'You were watching. No chips, no shame.';
    if (me && data.record) recordGame({ place: board.indexOf(me) + 1, chips: me.chips, earned: me.earned || 0, players: board.length, scams: me.stats?.scams, catches: me.stats?.catches, wrong: me.stats?.wrong, voided: me.stats?.voids });
    burst($('#finalCard .fc-box'), { count: 44, chars: ['🪙', '💵', '👑', '✨'] });
    $('#fcRematch').onclick = () => { this.on.rematch?.(); card.hidden = true; };
    $('#fcLobby').onclick = () => { this.on.toLobby?.(); card.hidden = true; };
    $('#fcQuit').onclick = () => { this.on.leave?.(); card.hidden = true; };
  }

  // ── chat sheet ─────────────────────────────────────────────────────────────
  bindChat() {
    this.chatGroup = CHAT_GROUPS[0].id;
    const tabs = $('#csTabs');
    tabs.innerHTML = '';
    for (const g of CHAT_GROUPS) {
      const b = el('button', g.id === this.chatGroup ? 'on' : '');
      b.textContent = `${g.icon || '💬'} ${g.label}`;
      b.onclick = () => { this.chatGroup = g.id; [...tabs.children].forEach((x) => x.classList.remove('on')); b.classList.add('on'); this.renderChatLines(); };
      tabs.append(b);
    }
    this.renderChatLines();
    $('#csSend').onclick = () => {
      const v = $('#csInput').value.trim();
      if (!v) return;
      this.on.chat?.(v, false);
      $('#csInput').value = '';
      this.toggleChat(false);
    };
    $('#csInput').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#csSend').click(); } if (e.key === 'Escape') this.toggleChat(false); };
  }
  renderChatLines() {
    const box = $('#csLines');
    const g = CHAT_GROUPS.find((x) => x.id === this.chatGroup) || CHAT_GROUPS[0];
    box.innerHTML = '';
    for (const line of g.lines) {
      const b = el('button'); b.textContent = line;
      b.onclick = () => { this.on.chat?.(line, true); this.toggleChat(false); };
      box.append(b);
    }
  }
  toggleChat(force) {
    const s = $('#chatSheet');
    const show = force === undefined ? s.hidden : force;
    s.hidden = !show;
    this.chatOpen = show;
    if (show) setTimeout(() => $('#csInput').focus(), 40);
    audioClick();
  }

  // ── emote wheel ─────────────────────────────────────────────────────────────
  bindEmotes() {
    const w = $('#emoteWheel');
    const ring = el('div', 'ew');
    const R = 40;
    EMOTES.forEach((e, i) => {
      const a = (i / EMOTES.length) * Math.PI * 2 - Math.PI / 2;
      const b = el('b', '', `${['😅', '👌', '', '💵', '😲', '👏', '☝️', '🤷', '', '🕺', '🫱', '🥲'][i] || '🙂'}<i>${e.n}</i>`);
      b.style.left = (50 + Math.cos(a) * R) + '%';
      b.style.top = (50 + Math.sin(a) * R) + '%';
      b.onclick = () => { this.on.emote?.(e.id); this.toggleEmotes(false); };
      ring.append(b);
    });
    ring.append(el('div', 'ewc', 'PICK A FACE<br>THE TABLE WILL READ IT'));
    const back = el('div', '', '');
    back.style.cssText = 'position:absolute;inset:0;background:rgba(3,8,12,.6)';
    back.onclick = () => this.toggleEmotes(false);
    w.append(back, ring);
  }
  toggleEmotes(force) {
    const w = $('#emoteWheel');
    const show = force === undefined ? w.hidden : force;
    w.hidden = !show;
    audioClick();
  }

  // ── make-a-deal sheet ────────────────────────────────────────────────────────
  bindDock() {
    $('#miniDock').onclick = () => { const m = $('#miniMenu'); m.hidden = !m.hidden; };
  }
  bindMini() {
    $('#miniMenu').onclick = (e) => {
      const a = e.target?.dataset?.a;
      if (!a) return;
      $('#miniMenu').hidden = true;
      if (a === 'chat') this.toggleChat(true);
      if (a === 'emote') this.toggleEmotes(true);
      if (a === 'offer') this.openOfferSheet();
      if (a === 'spectate') this.on.spectate?.();
      if (a === 'stats') this.openStats();
      if (a === 'settings') this.openOptions();
    };
  }
  openOfferSheet() {
    const st = this.state;
    if (!st?.roundInfo?.offers) { toast('No trading in this round — read the brief'); return; }
    if (st.phase !== 'talk') { toast('Deals close when the reckoning starts'); return; }
    const sheet = $('#offerSheet');
    const box = $('#osBox');
    const inv = st.inv || [];
    const targets = this.targetPids();
    box.innerHTML = `<h3>SLIDE A DEAL ACROSS</h3>
      <div class="os-row"><div class="os-side"><span>YOU GIVE</span>
        <select id="osGiveItem"><option value="">— chips only —</option>${inv.map((i) => `<option value="${i.uid}">${esc(GOOD_BY_NAME(i.gid))}${i.fake ? ' (🚨 you know)' : ''}</option>`).join('')}</select>
        <input id="osGiveChips" type="number" min="0" max="900" step="10" value="60"></div>
        <div class="os-mid">⇄</div>
      <div class="os-side"><span>YOU WANT</span>
        <select id="osWantWho">${targets.map((t) => `<option value="${t}">${esc(this.nameOf(t))}</option>`).join('')}</select>
        <select id="osWantItem"><option value="">— chips only —</option></select>
        <input id="osWantChips" type="number" min="0" max="900" step="10" value="120"></div></div>
      <div class="os-side"><span>WHISPER (optional)</span><input id="osNote" maxlength="40" placeholder="no pressure, huge value"></div>
      <div class="note" style="margin-top:.5rem;background:rgba(0,0,0,.06);border-color:#a4332f;color:#5a1d18">
        You can <b>void</b> an accepted deal at the last second. Detectives can flag you for it. Everyone can see the receipt.</div>
      <div class="os-foot"><button class="btn" id="osCancel">CANCEL</button><button class="btn primary" id="osSend">SEND IT</button></div>`;
    sheet.hidden = false;
    const whoSel = box.querySelector('#osWantWho'), wantSel = box.querySelector('#osWantItem');
    const fill = () => {
      const pid = whoSel.value;
      const their = (this.state.hands && this.state.hands[pid]) || [];
      wantSel.innerHTML = '<option value="">— chips only —</option>' + their.map((i) => `<option value="${i.uid}">${esc(GOOD_BY_NAME(i.gid))}</option>`).join('');
    };
    whoSel.onchange = fill; fill();
    box.querySelector('#osCancel').onclick = () => { sheet.hidden = true; };
    box.querySelector('#osSend').onclick = () => {
      this.on.offer?.({
        to: whoSel.value,
        giveItem: box.querySelector('#osGiveItem').value || undefined,
        wantItem: wantSel.value || undefined,
        giveChips: +box.querySelector('#osGiveChips').value || 0,
        wantChips: +box.querySelector('#osWantChips').value || 0,
        note: box.querySelector('#osNote').value,
      });
      sheet.hidden = true;
      toast('Deal sent. Smile at them.', 'good');
    };
  }


  // ── generic picker (targets / cases) ────────────────────────────────────────
  openPicker({ title, sub, items, onPick, multi = 1 }) {
    const { box, sheet } = this.pickerBox();
    box.innerHTML = `<h3>${esc(title)}</h3>${sub ? `<div class="hint" style="color:#5a4a2a;margin-bottom:.4rem">${esc(sub)}</div>` : ''}<div id="pkGrid" class="grid" style="grid-template-columns:repeat(auto-fill,minmax(6rem,1fr))"></div>
      <div class="os-foot"><button class="btn" id="pkCancel">CANCEL</button>${multi > 1 ? '<button class="btn primary" id="pkGo">DO IT</button>' : ''}</div>`;
    const grid = box.querySelector('#pkGrid');
    const chosen = new Set();
    for (const it of items) {
      const b = el('button', 'item');
      b.innerHTML = `<span class="em">${it.icon || '❔'}</span><span class="il">${esc(it.label)}</span>${it.sub ? `<span class="ip">${esc(it.sub)}</span>` : ''}`;
      b.onclick = () => {
        if (multi === 1) { sheet.hidden = true; onPick([it.id]); return; }
        if (chosen.has(it.id)) { chosen.delete(it.id); b.classList.remove('on'); }
        else { chosen.add(it.id); b.classList.add('on'); if (chosen.size > multi) { const f = [...chosen].shift(); chosen.delete(f); grid.children[[...grid.children].findIndex((c) => c === b)]?.classList.remove('on'); } }
      };
      grid.append(b);
    }
    box.querySelector('#pkCancel').onclick = () => { sheet.hidden = true; };
    box.querySelector('#pkGo') && (box.querySelector('#pkGo').onclick = () => { sheet.hidden = true; onPick([...chosen]); });
  }
  pickerBox() {
    const sheet = $('#offerSheet');
    sheet.hidden = false;
    return { sheet, box: $('#osBox') };
  }

  // ── lobby panel ─────────────────────────────────────────────────────────────
  bindLobby() {
    $('#lbReady').onclick = () => { this.p.ready = !this.p.ready; this.on.ready?.(this.p.ready); save(); };
    $('#lbStart').onclick = () => this.on.start?.();
    $('#lbInvite').onclick = async () => {
      const link = location.origin + location.pathname + '#join=' + (this.code || '');
      await copyText(link);
      this.openInvite(link);
    };
    $('#lbLeave').onclick = () => this.on.leave?.();
    $('#lbCustom').onclick = () => this.openCustomize();
    $('#lbEmote').onclick = () => this.toggleEmotes(true);
    $('#lbBots').onclick = () => this.on.botToggle?.();
    $('#lbChat').onclick = () => this.toggleChat(true);
  }
  renderLobby(state, isHost) {
    if (!state) return;
    $('#lbCode').textContent = state.code || '·····';
    this.code = state.code;
    const list = state.players || [];
    $('#lbCount').textContent = `${list.filter((p) => p.seat >= 0).length}/${CFG.maxPlayers}`;
    const box = $('#lbPlayers');
    box.innerHTML = '';
    for (const p of list) {
      const r = el('div', 'lrow' + (p.isHost ? ' host' : '') + (p.ready ? ' ready' : '') + (p.connected === false ? ' off' : ''));
      r.innerHTML = `<span class="li">${p.avatar?.acc >= 0 ? '🦆' : ['🙂', '😴', '😐', '🤿', '', '🤨'][p.avatar?.face % 6] || '🙂'}</span>
        <span><span class="ln">${esc(p.name)}${p.you ? ' <i style="opacity:.5">(you)</i>' : ''}</span>
        <span class="lsub">${p.isHost ? 'HOST · ' : ''}${p.ready ? 'ready' : 'not ready'}${p.spectating ? ' · watching' : ''}${p.isBot ? ' · bot' : ''}${p.connected === false ? ' · away' : ''}</span></span>
        <span class="rk">${p.seat >= 0 ? 'SEAT ' + (p.seat + 1) : 'SOFA'}</span>
        <span>${isHost && !p.you ? `<button data-kick="${p.pid}">kick</button>` : ''}</span>`;
      box.append(r);
    }
    box.onclick = (e) => { const k = e.target?.dataset?.kick; if (k) this.on.kick?.(k); };
    const rb = $('#lbReady');
    rb.classList.toggle('on', this.p.ready);
    rb.innerHTML = this.p.ready ? 'READY ✓ <i>tap to step back</i>' : 'READY';
    const readyCount = list.filter((p) => p.ready || p.isBot).length;
    $('#lbStart').hidden = !isHost;
    $('#lbStart').innerHTML = `START THE NIGHT <i>${readyCount}/${list.length} ready · ${state.settings?.rounds || 6} rounds</i>`;
    $('#lbHostNote').textContent = isHost ? '(yours to bend)' : '(host controls these)';
    this.renderSettings(state, isHost);
    const hostBox = $('#lbHost');
    hostBox.innerHTML = '';
    if (isHost) {
      const add = el('button', 'btn tiny', '＋ ADD BOT'); add.onclick = () => this.on.botAdd?.();
      const del = el('button', 'btn tiny', '－ REMOVE BOT'); del.onclick = () => this.on.botDel?.();
      const abort = el('button', 'btn tiny danger', '⏮ BACK TO LOBBY'); abort.onclick = () => this.on.abort?.();
      hostBox.append(add, del, abort);
    }
    $('#lbHint').textContent = isTouch() ? 'Drag the left side to walk · tap the table to sit' : 'WASD to walk · E to sit · Q emote · T talk';
  }
  renderSettings(state, editable) {
    const box = $('#lbSettings');
    const sig = JSON.stringify(state.settings);
    if (box.dataset.sig === sig && editable) { /* keep focus */ }
    box.dataset.sig = sig;
    box.innerHTML = '';
    const s = state.settings || {};
    for (const meta of SETTINGS_META) {
      const row = el('div', 'set');
      const lab = el('label', 'sl', meta.label);
      const wrap = el('div', '', '');
      const inp = el('input'); inp.type = 'range'; inp.min = meta.min; inp.max = meta.max; inp.step = meta.step; inp.value = s[meta.k] ?? meta.min; inp.disabled = !editable;
      const val = el('span', 'val', (s[meta.k] ?? 0) + (meta.unit || ''));
      inp.oninput = () => { val.textContent = inp.value + (meta.unit || ''); };
      inp.onchange = () => editable && this.on.setting?.(meta.k, +inp.value);
      wrap.append(inp, ' ', val);
      row.append(lab, wrap); box.append(row);
    }
    for (const meta of TOGGLE_META) {
      const row = el('div', 'set');
      const lab = el('label', 'sl', meta.label + (meta.help ? `<span class="sh">${meta.help}</span>` : ''));
      const seg = el('div', 'seg');
      const labels = meta.labels || ['OFF', 'ON'];
      const max = meta.max ?? 1;
      for (let v = meta.min ?? 0; v <= max; v++) {
        const b = el('button', (s[meta.k] ?? 0) === v ? 'on' : '', labels[v - (meta.min ?? 0)] ?? String(v));
        b.onclick = () => editable && this.on.setting?.(meta.k, v);
        seg.append(b);
      }
      row.append(lab, seg); box.append(row);
    }
  }
  openInvite(link) {
    this.modal({
      title: 'INVITE YOUR ACCOMPLICES',
      body: `<p style="font-size:.86rem;line-height:1.45">Send the code or the link. Anyone with it walks straight into your lobby — the door stays locked to everyone else.</p>
      <div class="grid" style="grid-template-columns:1fr">
        <div class="note" style="font-family:var(--disp);font-size:1.4rem;letter-spacing:.3em;text-align:center">${esc(this.code || '·····')}</div>
        <input class="note" readonly value="${esc(link)}" style="width:100%;border:2px solid var(--line);background:#0b1620;color:var(--cream);padding:.4rem;border-radius:10px" onclick="this.select()">
      </div>
      <div class="rowtitle">IF THE SERVER ISN'T REACHABLE</div>
      <div class="note">This tab can only host bots by itself. Online play needs the authority server running (npm start in the repo). Bots do lie convincingly, though.</div>`,
      foot: [{ label: 'COPY LINK', cls: 'primary', act: async () => { await copyText(link); toast('Link copied — go ruin a friendship', 'good'); } }, { label: 'CLOSE', act: () => this.closeModal() }],
    });
  }

  // ── modal plumbing ──────────────────────────────────────────────────────────
  modal({ title, body, foot, tabs }) {
    const m = $('#modal');
    m.hidden = false;
    $('#mdTitle').textContent = title;
    $('#mdBody').innerHTML = body;
    const tb = $('#mdTabs'); tb.innerHTML = '';
    if (tabs) {
      for (const t of tabs) {
        const b = el('button', t.on ? 'on' : '', t.label);
        b.onclick = () => t.act?.(b);
        tb.append(b);
      }
    }
    const f = $('#mdFoot'); f.innerHTML = '';
    for (const btn of foot || []) {
      const b = el('button', 'btn ' + (btn.cls || ''), btn.label);
      b.onclick = () => btn.act?.();
      f.append(b);
    }
    $('#mdClose').onclick = () => this.closeModal();
    m.onclick = (e) => { if (e.target === m) this.closeModal(); };
    return $('#mdBody');
  }
  closeModal() { $('#modal').hidden = true; this.on.modalClosed?.(); }

  // ── character customisation ──────────────────────────────────────────────────
  openCustomize() {
    const av = { ...this.p.avatar };
    const body = this.modal({
      title: 'YOUR FACE FOR THE EVENING',
      body: '<div id="czSlots"></div>',
      foot: [{ label: 'DONE', cls: 'primary', act: () => { this.closeModal(); } }],
    });
    const slots = body.querySelector('#czSlots');
    const NAMES = { skin: 'Skin', face: 'Face', hair: 'Hair', hat: 'Hat', glasses: 'Glasses', shirt: 'Shirt', pants: 'Trousers', shoes: 'Shoes', acc: 'Extras' };
    const EMOS = {
      skin: ['🫱'], face: ['🙂', '😴', '😐', '👀', '', '🤨', '😼', '🦉', '', ''],
      hair: ['🧑🦲', '💇', '🫧', '⚡', '☁️', '🐎', '✂️', '🎚', '🌾', '🪩', '🐻'],
      hat: ['🚫', '🎩', '🧢', '', '🎩', '👨‍🍳', '', '️', '', '😇'],
      glasses: ['🚫', '👓', '🕶', '🧐', '', '🥽'],
      shirt: ['👕', '👔', '', '🦺', '🧥', '', '👕', '🧥', ''],
      pants: ['👖', '🩳', '👖', '', '🎒', '👖'], shoes: ['👟', '', '👞', '🥾', '🪽', '🥾'],
      acc: ['🚫', '🦆', '📿', '⌚', '💼', '🦜', '👑', '⛓️'],
    };
    const draw = () => {
      slots.innerHTML = '';
      for (const slot of COSM_SLOTS) {
        const list = COSM[slot];
        slots.insertAdjacentHTML('beforeend', `<div class="rowtitle">${NAMES[slot] || slot}</div><div class="grid" data-slot="${slot}"></div>`);
        const grid = slots.querySelector(`[data-slot="${slot}"]`);
        list.forEach((c) => {
          const owned = isOwned(slot, c.id) || !c.cost;
          const price = priceOf(slot, c.id);
          const b = el('button', 'item' + (av[slot] === c.id ? ' on' : '') + (owned ? '' : ' locked'));
          const emo = slot === 'skin' ? `<span class="em" style="display:block;width:1.9rem;height:1.9rem;border-radius:50%;margin:0 auto;background:${c.c};border:2px solid rgba(255,255,255,.2)"></span>`
            : slot === 'color' ? `<span class="em" style="display:block;width:1.9rem;height:1.9rem;border-radius:10px;margin:0 auto;background:${c.c}"></span>`
              : `<span class="em">${(EMOS[slot]?.[(c.id + 1) % (EMOS[slot]?.length || 1)]) || '❔'}</span>`;
          b.innerHTML = emo + `<span class="il">${esc(c.n)}</span>` + (price && !owned ? `<span class="price">${fmt(price)} 🪙</span>` : '');
          b.onclick = () => {
            if (!owned) {
              const res = buy(slot, c.id);
              if (!res.ok) { toast(`Need ${fmt(res.need)} more 🪙 — win rounds at the table`, 'bad'); return; }
              addBank(0);
              toast(`Unlocked ${c.n}!`, 'good');
            }
            av[slot] = c.id;
            this.p.avatar = setAvatar(av);
            this.on.avatar?.(this.p.avatar);
            draw();
          };
          grid.append(b);
        });
      }
      // colour sliders
      slots.insertAdjacentHTML('beforeend', `<div class="rowtitle">Outfit colour</div><div class="grid" data-slot="color"></div><div class="rowtitle">Hair colour</div><div class="grid" data-slot="hairColor"></div>`);
      for (const key of ['color', 'hairColor']) {
        const grid = slots.querySelector(`[data-slot="${key}"]`);
        COSM.color.forEach((c, i) => {
          const b = el('button', 'sw' + (av[key] === i ? ' on' : ''));
          b.style.background = c.c; b.title = c.n;
          b.onclick = () => { av[key] = i; this.p.avatar = setAvatar(av); this.on.avatar?.(this.p.avatar); draw(); };
          grid.append(b);
        });
      }
      slots.insertAdjacentHTML('afterbegin', `<div class="rowtitle">Display name</div><div style="display:flex;gap:.4rem"><input id="czName" maxlength="14" value="${esc(this.p.name)}" style="flex:1;background:#0b1620;border:2px solid var(--line);border-radius:10px;color:var(--cream);padding:.45rem .6rem;font-weight:800"><button class="btn tiny" id="czRoll">🎲</button></div>`);
      const ni = slots.querySelector('#czName');
      ni.oninput = () => { this.p.name = setName(ni.value.slice(0, 14)); this.on.name?.(this.p.name); };
      slots.querySelector('#czRoll').onclick = () => {
        const fresh = defaultProfile();
        const roll = { ...fresh.avatar };
        Object.assign(av, roll);
        this.p.avatar = setAvatar(av);
        this.on.avatar?.(this.p.avatar);
        draw();
      };
    };
    draw();
    this.on.customizeOpen?.(true);
  }

  // ── shop (cosmetics quick view), stats, help, options ────────────────────────
  openShop() {
    const p = this.p;
    let html = `<div class="note">Every item is one tap in <b>LOOK</b>. Chips come from the final board: placement, scams pulled, catches made.</div>
      <div class="rowtitle">Wallet</div><div style="font-family:var(--disp);font-size:1.6rem;color:var(--gold)">${fmt(p.bank)} 🪙</div>
      <div class="rowtitle">Locked gems worth chasing</div><div class="grid">`;
    const all = [];
    for (const slot of COSM_SLOTS) for (const c of COSM[slot] || []) { if (c.cost && !isOwned(slot, c.id)) all.push({ slot, ...c }); }
    all.sort((a, b) => b.cost - a.cost).slice(0, 18).forEach((c) => {
      html += `<div class="item"><span class="em">✨</span><span class="il">${esc(c.n)}</span><span class="ip">${fmt(c.cost)} 🪙 · tier ${c.tier || 1}</span></div>`;
    });
    html += '</div>';
    this.modal({ title: 'CHIP SHOP', body: html, foot: [{ label: 'OPEN LOOK', cls: 'primary', act: () => this.openCustomize() }, { label: 'CLOSE', act: () => this.closeModal() }] });
  }
  openStats() {
    const s = this.p.stats;
    const winRate = s.games ? Math.round((s.wins / s.games) * 100) : 0;
    let html = `<div class="rowtitle">Lifetime</div><table class="stats">
      ${row('Tables played', s.games)}${row('Winner', s.wins + '  (' + winRate + '%)')}
      ${row('Scams pulled off', s.scams)}${row('Correct calls', s.catches)}${row('Wrong accusations', s.wrong)}
      ${row('Deals voided', s.voided)}${row('Best single night', fmt(s.bestRound) + ' 🪙')}
      ${row('Wallet', fmt(this.p.bank) + ' 🪙')}</table>
      <div class="rowtitle">Recent</div>`;
    if (!this.p.history.length) html += '<div class="note">No games logged yet. Press PLAY NOW.</div>';
    for (const h of this.p.history.slice(0, 10)) {
      html += `<div class="fcb"><span class="pl">${h.place === 1 ? '👑' : h.place + 'th'}</span><span class="nm">${h.players} seats · ${new Date(h.when).toLocaleDateString()}</span><span class="sc">${fmt(h.chips)} 🪙</span><span class="ear">+${fmt(h.earned || 0)}</span></div>`;
    }
    html += `<div class="rowtitle">What your numbers mean</div><div class="note">Scams pulled = tricks that landed. Catches = accusations that were correct. Both pay; wrong calls cost. The table remembers.</div>`;
    this.modal({ title: 'YOUR RECORD', body: html, foot: [{ label: 'CLOSE', act: () => this.closeModal() }] });
  }
  openHelp() {
    const body = `
      <div class="rowtitle">The idea</div>
      <p style="font-size:.86rem;line-height:1.5;margin:.2rem 0 .6rem">Two to eight people, one backroom, six rounds of <b>dubious deals</b>. Every round secretly re-deals roles, hands out private information, lets you talk, trade, lie and point fingers — then <b>reveals everything</b> on the wall screen. Chips are the score. Whoever ends with the most wins the night, and everything you earn unlocks cosmetics.</p>
      <div class="rowtitle">Round flow</div>
      <div class="note">1 Secrets dealt → 2 <b>Deal time</b> (talk, trade, use your ability) → 3 <b>Reckoning</b> (lock your call, name a suspect, arm a loophole) → 4 The reveal, beat by beat → 5 Payout → next round.</div>
      <div class="rowtitle">Roles (they rotate, always)</div>
      <div class="grid">${ROLES.map((r) => `<div class="item"><span class="em">${r.icon}</span><span class="il">${r.name}</span><span class="ip">${esc(r.ability)}</span></div>`).join('')}</div>
      <div class="rowtitle">Controls</div>
      ${[['W A S D / arrows', 'walk around the room'], ['E', 'sit down / stand up'], ['Q', 'emote wheel'], ['T or Enter', 'table talk'], ['1–9', 'pick a decision'], ['Space', 'lock my call'], ['X', 'toggle Push It (risk)'], ['Esc', 'settings / close'], ['F', 'use a nearby prop']]
        .map(([k, v]) => `<div class="helprow"><kbd>${k}</kbd><span>${v}</span></div>`).join('')}
      <div class="rowtitle">Scoring cheat-sheet</div>
      <div class="grid">${Object.values(TAGS).slice(0, 8).map((t) => `<div class="item"><span class="em">${t.i}</span><span class="il" style="color:${t.c}">${t.n}</span></div>`).join('')}</div>
      <div class="rowtitle">Anti-cheat, in plain words</div>
      <div class="note">The authority server owns every number. Your client sends <i>intent</i> (“I accept this deal”, “I accuse Marlo”) and receives a redacted view — nobody else's secret ever arrives on their machine, so there is nothing to peek at.</div>`;
    this.modal({ title: 'HOW TO SWINDLE', body, foot: [{ label: 'GOT IT', cls: 'primary', act: () => { this.p.tutorial = true; save(); this.closeModal(); } }] });
  }
  openOptions() {
    const p = this.p;
    const body = this.modal({
      title: 'SETTINGS',
      body: `<div class="rowtitle">Graphics</div><div class="seg" id="opQ"></div>
        <div class="rowtitle">Sound</div><div id="opS"></div>
        <div class="rowtitle">Feel</div><div id="opF"></div>
        <div class="note">Low-end drops bloom, shadows and particles. Ultra turns the dust and particle budget up. Nothing changes gameplay — the server decides that.</div>`,
      foot: [{ label: 'CLOSE', cls: 'primary', act: () => this.closeModal() }],
    });
    const q = body.querySelector('#opQ');
    ['low', 'medium', 'high', 'ultra'].forEach((k) => {
      const b = el('button', p.settings.quality === k ? 'on' : '', k.toUpperCase());
      b.onclick = () => { p.settings.quality = k; save(); [...q.children].forEach((x) => x.classList.remove('on')); b.classList.add('on'); this.on.quality?.(k); };
      q.append(b);
    });
    const sw = (host, key, label, cb) => {
      const row = el('div', 'set');
      const seg = el('div', 'seg');
      const b = el('button', p.settings[key] ? 'on' : '', p.settings[key] ? 'ON' : 'OFF');
      b.onclick = () => { p.settings[key] = !p.settings[key]; save(); b.textContent = p.settings[key] ? 'ON' : 'OFF'; b.classList.toggle('on', p.settings[key]); cb?.(p.settings[key]); };
      seg.append(b);
      row.append(el('label', 'sl', label), seg);
      host.append(row);
    };
    sw(body.querySelector('#opS'), 'music', 'Music', (v) => this.on.musicToggle?.(v));
    sw(body.querySelector('#opS'), 'sfx', 'Sound effects', (v) => this.on.sfxToggle?.(v));
    sw(body.querySelector('#opF'), 'shake', 'Camera shake');
    sw(body.querySelector('#opF'), 'names', 'Nameplates in 3D');
    sw(body.querySelector('#opF'), 'reduceFlash', 'Reduce flashing');
    sw(body.querySelector('#opF'), 'fps', 'FPS meter');
    sw(body.querySelector('#opF'), 'autoReady', 'Auto-ready when a friend joins');
  }
  bindFinal() {
    $('#thSkip').onclick = () => { this.on.skipReveal?.(); this.hideTheatre(); };
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────
const row = (k, v) => `<tr><td>${k}</td><td>${v}</td></tr>`;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GOOD_BY_NAME = (gid) => (GOODS.find((g) => g.id === gid)?.n) || 'mystery parcel';
function audioClick() { try { window.__audio?.click(); } catch (e) { /* no audio yet */ } }
