// ── IRONVOW — the boards, the armoury and the lists ──────────────────────────
// Every screen here is plain DOM: an iron-coloured board, a list of names, and
// the numbers a fighting man would actually be told (what it pays, who is
// waiting, what it cost him last time). The screens never touch the duel — they
// hand a spec to the game and get out of the way.
import { DRILLS, CHAMPIONS, WEAPONS, HARNESS, SHIELDS, MODES, ARENAS, rankFor } from './data.js';

const el = (t, c, h) => { const n = document.createElement(t); if (c) n.className = c; if (h != null) n.innerHTML = h; return n; };

export const KITS = {
  weapons: WEAPONS.map((w) => ({ id: w.id, label: `${w.name}`, sub: `${w.short} · ${w.hands === 2 ? 'two hands' : 'one hand'} · ${w.archetype}`, note: w.lore || '' })),
  harness: HARNESS.map((h) => ({ id: h.id, label: h.name, sub: `${h.layers?.length || 1} layers · protection ${Math.round((h.protection ?? 0) * 100)}%`, note: h.lore || '' })),
  shields: SHIELDS.map((s) => ({ id: s.id, label: s.name, sub: s.model ? `coverage ${Math.round((s.coverage || 0) * 100)}%` : 'a bare hand and a quicker guard', note: s.lore || '' })),
  arenas: ARENAS.map((a) => ({ id: a.id, label: a.name, sub: a.desc || '', note: a.lore || '' })),
};

export class Menu {
  constructor(root, opts = {}) {
    this.root = root;
    this.handlers = {};
    this.save = opts.save;
    this.kit = opts.kit;
    root.classList.add('menu');
    this.screen = 'title';
  }

  on(name, fn) { (this.handlers[name] ||= []).push(fn); return this; }
  emit(name, ...args) { for (const f of this.handlers[name] || []) f(...args); }

  clear() { this.root.innerHTML = ''; this.root.classList.remove('off'); this.root.classList.add('menu'); }

  hide() { this.root.innerHTML = ''; this.root.classList.add('off'); }

  // ── shared chrome ─────────────────────────────────────────────────────────
  _frame(title, sub) {
    const box = el('div', 'board');
    const head = el('div', 'board-head');
    head.append(el('h2', null, title));
    if (sub) head.append(el('p', 'sub', sub));
    box.append(head);
    this.root.append(box);
    return box;
  }

  _stat() {
    const s = this.save.data;
    const bar = el('div', 'statline');
    bar.innerHTML = `<span class="rank">${rankFor(s.renown)}</span>
      <span>renown <b>${s.renown}</b></span><span>coin <b>${s.coin}</b></span>
      <span>${s.record.wins}W–${s.record.losses}L</span>`;
    return bar;
  }

  _btn(label, cls, fn, note) {
    const b = el('button', 'btn ' + (cls || ''), `${label}${note ? `<i>${note}</i>` : ''}`);
    b.onclick = () => { this.emit('click'); fn(); };
    return b;
  }

  // ── title ─────────────────────────────────────────────────────────────────
  showTitle() {
    this.screen = 'title';
    this.clear();
    const box = this._frame('IRONVOW', 'a vow kept at the point of a sword');
    const crest = el('div', 'crest');
    crest.innerHTML = `<svg viewBox="0 0 120 120" aria-hidden="true">
      <path d="M60 8 L104 30 V64 C104 90 84 106 60 114 C36 106 16 90 16 64 V30 Z" fill="none" stroke="currentColor" stroke-width="4"/>
      <path d="M60 26 V94 M38 44 L60 62 L82 44 M38 76 L60 58 L82 76" fill="none" stroke="currentColor" stroke-width="3"/>
    </svg>`;
    box.append(crest);
    const next = this.save.nextDrill();
    const st = this.save.drillState(next.id);
    const actions = el('div', 'acts');
    actions.append(
      this._btn(`Fight — ${next.name}`, 'primary', () => this.emit('drill', next.id),
        st ? `cleared ${st.wins}× · pays a third now` : `${next.desc}`),
      this._btn('The Lists', '', () => this.showLadder(), `${DRILLS.length} contests`),
      this._btn('Quick Duel', '', () => this.showQuick(), 'pick your opponent'),
      this._btn('Armoury', '', () => this.showArmoury(), `${this.kit.weapon} · ${this.kit.harness} · ${this.kit.shield}`),
      this._btn('Settings', '', () => this.showSettings(), ''),
    );
    box.append(actions);
    box.append(this._stat());
    const foot = el('p', 'foot', 'WASD move · mouse look · left button winds a blow, release to let it go · right button raises the guard · hold to parry · Space shoves · E feints · Tab locks on');
    box.append(foot);
  }

  // ── the ladder ────────────────────────────────────────────────────────────
  showLadder() {
    this.screen = 'ladder';
    this.clear();
    const box = this._frame('The Lists', 'ten contests, from a farm boy with a sword to something in white plate');
    const list = el('div', 'list');
    for (const d of DRILLS) {
      const unlocked = this.save.isUnlocked(d.id);
      const st = this.save.drillState(d.id);
      const row = el('div', 'row' + (unlocked ? '' : ' locked'));
      row.append(el('div', 'row-name', `${d.name}${st ? ` <i>cleared ${st.wins}×</i>` : ''}`));
      row.append(el('div', 'row-sub', `${MODES[d.mode]?.label || d.mode} · ${d.opponents.map((o) => CHAMPIONS.find((c) => c.id === o)?.name || o).join(' + ')} · ${d.arena} · ${d.rounds} pass${d.rounds > 1 ? 'es' : ''}`));
      row.append(el('div', 'row-note', unlocked ? d.desc : 'not yet open — win the one before it'));
      row.append(el('div', 'row-pay', `${d.reward.coin} coin · ${d.reward.renown} renown`));
      if (unlocked) row.onclick = () => { this.emit('click'); this.emit('drill', d.id); };
      list.append(row);
    }
    box.append(list);
    box.append(el('div', 'acts').appendChild(this._btn('Back', '', () => this.showTitle())).parentElement);
    box.append(this._stat());
  }

  // ── quick duel setup ──────────────────────────────────────────────────────
  showQuick(pick = {}) {
    this.screen = 'quick';
    const state = { champ: pick.champ || CHAMPIONS[0].id, arena: pick.arena || 'hall', ...pick };
    this.clear();
    const box = this._frame('Quick Duel', 'choose the ground and the man standing on it');
    const grid = el('div', 'grid');
    const mkPicker = (label, items, key, current) => {
      const wrap = el('div', 'picker');
      wrap.append(el('h3', null, label));
      for (const it of items) {
        const b = el('button', 'chip' + (it.id === current ? ' on' : ''), `${it.label}`);
        b.onclick = () => { state[key] = it.id; this.emit('click'); this.showQuick(state); };
        wrap.append(b);
      }
      return wrap;
    };
    grid.append(mkPicker('opponent', CHAMPIONS.map((c) => ({ id: c.id, label: `${c.name} — ${c.title}` })), 'champ', state.champ));
    grid.append(mkPicker('ground', KITS.arenas, 'arena', state.arena));
    box.append(grid);
    const c = CHAMPIONS.find((x) => x.id === state.champ);
    const info = el('div', 'detail');
    info.innerHTML = `<b>${c.name}</b>, ${c.title} — ${c.harness} harness, ${c.weapon}${c.shield !== 'none' ? ', ' + c.shield : ''}.
      <i>${c.lore || ''}</i> Bounty ${c.bounty} coin.`;
    box.append(info);
    box.append(el('div', 'acts').appendChild(this._btn('Fight', 'primary', () => this.emit('quick', { opponent: c.id, arena: state.arena }))).parentElement);
    box.append(el('div', 'acts').appendChild(this._btn('Back', '', () => this.showTitle())).parentElement);
  }

  // ── armoury ───────────────────────────────────────────────────────────────
  showArmoury() {
    this.screen = 'armoury';
    this.clear();
    const box = this._frame('Armoury', 'what you carry decides how you have to fight');
    const mk = (label, kind, current, notePicker) => {
      const b = el('div', 'picker stack');
      b.append(el('h3', null, label));
      for (const it of KITS[kind]) {
        const chip = el('button', 'chip wide' + (it.id === current ? ' on' : ''), `<b>${it.label}</b><i>${it.sub}</i>`);
        chip.onclick = () => { this.kit[kind === 'weapons' ? 'weapon' : kind === 'harness' ? 'harness' : 'shield'] = it.id; this.save.data.kit = { ...this.kit }; this.save.flush(); this.emit('click'); this.showArmoury(); };
        b.append(chip);
      }
      const n = KITS[kind].find((i) => i.id === current);
      if (n?.note) b.append(el('p', 'note', n.note));
      return b;
    };
    const cols = el('div', 'grid');
    cols.append(mk('weapon', 'weapons', this.kit.weapon));
    cols.append(mk('harness', 'harness', this.kit.harness));
    cols.append(mk('shield', 'shields', this.kit.shield));
    box.append(cols);
    box.append(el('div', 'acts').appendChild(this._btn('Back', '', () => this.showTitle())).parentElement);
  }

  // ── settings ──────────────────────────────────────────────────────────────
  showSettings() {
    this.screen = 'settings';
    this.clear();
    const s = this.save.data.settings;
    const box = this._frame('Settings', '');
    const row = (label, input) => { const r = el('label', 'srow'); r.append(el('span', null, label), input); return r; };
    const sens = el('input'); sens.type = 'range'; sens.min = '0.3'; sens.max = '2.5'; sens.step = '0.05'; sens.value = s.sensitivity;
    sens.oninput = () => { s.sensitivity = +sens.value; this.save.flush(); this.emit('settings'); };
    const vol = el('input'); vol.type = 'range'; vol.min = '0'; vol.max = '1'; vol.step = '0.05'; vol.value = s.volume;
    vol.oninput = () => { s.volume = +vol.value; this.save.flush(); this.emit('settings'); };
    const inv = el('input'); inv.type = 'checkbox'; inv.checked = !!s.invertY;
    inv.onchange = () => { s.invertY = inv.checked; this.save.flush(); this.emit('settings'); };
    const snd = el('input'); snd.type = 'checkbox'; snd.checked = s.sound !== false;
    snd.onchange = () => { s.sound = snd.checked; this.save.flush(); this.emit('settings'); };
    const tell = el('input'); tell.type = 'checkbox'; tell.checked = s.showTell !== false;
    tell.onchange = () => { s.showTell = tell.checked; this.save.flush(); this.emit('settings'); };
    const diff = el('input'); diff.type = 'range'; diff.min = '0.6'; diff.max = '1.6'; diff.step = '0.1'; diff.value = s.difficulty;
    diff.oninput = () => { s.difficulty = +diff.value; this.save.flush(); this.emit('settings'); };
    box.append(row('look sensitivity', sens), row('volume', vol), row('invert vertical look', inv),
      row('sound', snd), row('show where the blow is coming from', tell), row('opponents fight at', diff));
    box.append(el('div', 'acts').appendChild(this._btn('Forget everything', 'danger', () => { this.save.reset(); this.emit('settings'); this.showSettings(); })).parentElement);
    box.append(el('div', 'acts').appendChild(this._btn('Back', '', () => this.showTitle())).parentElement);
    box.append(this._stat());
  }

  // ── pause ─────────────────────────────────────────────────────────────────
  showPause(context = 'duel') {
    this.screen = 'pause';
    this.clear();
    const box = this._frame('Held', 'the hall waits');
    const acts = el('div', 'acts');
    acts.append(
      this._btn('Back to it', 'primary', () => this.emit('resume')),
      this._btn('Settings', '', () => this.showSettingsPaused()),
      this._btn('Abandon the bout', 'danger', () => this.emit('abandon')),
    );
    box.append(acts);
    box.append(el('p', 'foot', 'Esc or P returns to the fight.'));
  }

  showSettingsPaused() {
    const back = this.btnResumeBack = true;
    this.showSettings();
    const box = this.root.querySelector('.board');
    const acts = el('div', 'acts');
    acts.append(this._btn('Back to the fight', 'primary', () => this.showPause()));
    box.append(acts);
  }

  // ── results ───────────────────────────────────────────────────────────────
  showResults(info) {
    this.screen = 'results';
    this.clear();
    const won = info.won;
    const box = this._frame(won ? 'The pass is yours' : 'Beaten', info.title || '');
    const lines = el('div', 'result-lines');
    lines.innerHTML = `
      <div><span>passes</span><b>${info.roundsWon ?? 0} — ${info.roundsLost ?? 0}</b></div>
      <div><span>blows landed</span><b>${info.blowsLanded ?? 0}</b></div>
      <div><span>blows taken</span><b>${info.blowsTaken ?? 0}</b></div>
      <div><span>parries</span><b>${info.parries ?? 0}</b></div>
      <div><span>guards broken</span><b>${info.guardBreaks ?? 0}</b></div>
      <div><span>time in the ring</span><b>${(info.time || 0).toFixed(1)} s</b></div>
      ${info.reward ? `<div class="pay"><span>paid</span><b>${info.reward.coin} coin · ${info.reward.renown} renown</b></div>` : ''}
      ${info.reward?.rankUp ? `<div class="rankup"><span>rank</span><b>${info.reward.rankUp}</b></div>` : ''}
      ${info.reward?.unlocked ? `<div class="unlock"><span>opened</span><b>${DRILLS.find((d) => d.id === info.reward.unlocked)?.name || 'the next contest'}</b></div>` : ''}`;
    box.append(lines);
    const acts = el('div', 'acts');
    if (info.nextDrill) acts.append(this._btn('Next contest', 'primary', () => this.emit('drill', info.nextDrill)));
    acts.append(
      this._btn('Again', '', () => this.emit('again')),
      this._btn('Quick duel', '', () => this.showQuick()),
      this._btn('The Lists', '', () => this.showLadder()),
      this._btn('Hall', '', () => this.showTitle()),
    );
    box.append(acts);
    box.append(this._stat());
    if (info.epitaph) box.append(el('p', 'epitaph', info.epitaph));
  }

  showBriefing(drill) {
    this.screen = 'briefing';
    this.clear();
    const c = CHAMPIONS.find((x) => x.id === drill.opponents[0]);
    const box = this._frame(drill.name, drill.desc);
    const d = el('div', 'briefing');
    d.innerHTML = `<div><span>ground</span><b>${ARENAS.find((a) => a.id === drill.arena)?.name || drill.arena}</b></div>
      <div><span>format</span><b>${MODES[drill.mode]?.label || drill.mode}${drill.rounds > 1 ? `, ${drill.rounds} passes` : ''}</b></div>
      <div><span>facing</span><b>${drill.opponents.map((o) => CHAMPIONS.find((x) => x.id === o)?.name || o).join(', ')}</b></div>
      <div><span>pays</span><b>${drill.reward.coin} coin · ${drill.reward.renown} renown</b></div>`;
    box.append(d);
    if (c?.lines?.taunt) box.append(el('p', 'quote', `“${c.lines.taunt[0]}” — ${c.name}`));
    const acts = el('div', 'acts');
    acts.append(this._btn('Step out', 'primary', () => this.emit('begin', drill.id)), this._btn('Not yet', '', () => this.showTitle()));
    box.append(acts);
    box.append(el('p', 'foot', 'Your guard is worth the wind behind it: a parry is the half-second after you raise it.'));
  }
}
