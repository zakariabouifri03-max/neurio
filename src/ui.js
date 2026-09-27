// ============================================================
// ui.js — menus, HUD, objectives, subtitles, dialogue choices,
// notifications, death & ending screens.
// ============================================================
import { el, clamp } from './utils.js';
import { saveSettings } from './save.js';

export class UI {
  constructor(G) {
    this.G = G;
    this.subQueue = [];
    this.subT = 0;
    this.subActive = false;
    this.choiceActive = null;
    this.notifyT = 0;
    this._objDone = false;
  }

  bindMenus() {
    const G = this.G;
    el('btn-new').onclick = () => { G.audio.ensure(); G.audio.latch('ui'); G.newGame(); };
    el('btn-continue').onclick = () => { G.audio.ensure(); G.audio.latch('ui'); G.continueGame(); };
    el('btn-chapters').onclick = () => { G.audio.ensure(); G.refreshChapters(); this.show('chapters'); };
    el('btn-settings').onclick = () => { this._settingsFrom = 'menu'; this.show('settings'); };
    el('btn-help').onclick = () => { this._helpFrom = 'menu'; this.show('help'); };
    el('btn-credits').onclick = () => { this._creditsFrom = 'menu'; this.show('credits'); };
    el('btn-resume').onclick = () => G.resumeGame();
    el('btn-p-settings').onclick = () => { this._settingsFrom = 'pause'; this.show('settings'); };
    el('btn-restart').onclick = () => { this.show(null); G.retryCheckpoint(); };
    el('btn-quit').onclick = () => G.quitToMenu();
    el('btn-retry').onclick = () => { this.show(null); G.retryCheckpoint(); };
    el('btn-dead-menu').onclick = () => G.quitToMenu();
    el('btn-set-back').onclick = () => {
      saveSettings(G.settings);
      if (this._settingsFrom === 'pause') this.show('pause'); else this.show('menu');
    };
    el('btn-help-back').onclick = () => { this._helpFrom === 'pause' ? this.show('pause') : this.show('menu'); };
    el('btn-ch-back').onclick = () => this.show('menu');
    el('btn-cr-back').onclick = () => this.show('menu');
    this._bindSettings();
  }

  _bindSettings() {
    const G = this.G, s = G.settings;
    const wire = (id, key, mul, disp, apply) => {
      const input = el(id), val = el(id + '-v');
      input.value = s[key] * mul;
      val.textContent = disp(Math.round(input.value));
      input.oninput = () => {
        s[key] = input.value / mul;
        val.textContent = disp(Math.round(input.value));
        apply && apply();
      };
    };
    wire('set-vol', 'vol', 100, v => v, () => G.audio.setVolume(s.vol));
    wire('set-sens', 'sens', 100, v => v);
    wire('set-fov', 'fov', 1, v => v, () => G.effects.applySettings());
    wire('set-bright', 'bright', 100, v => v, () => G.effects.applySettings());
    const inv = el('set-inv');
    const syncInv = () => inv.textContent = s.invertY ? 'ON' : 'OFF';
    syncInv();
    inv.onclick = () => { s.invertY = !s.invertY; syncInv(); G.audio.latch('ui'); };
    const grain = el('set-grain');
    const GRAINS = ['OFF', 'SUBTLE', 'STRONG'];
    const syncGrain = () => grain.textContent = GRAINS[s.grain];
    syncGrain();
    grain.onclick = () => { s.grain = (s.grain + 1) % 3; syncGrain(); G.effects.applySettings(); G.audio.latch('ui'); };
    const subs = el('set-subs');
    const syncSubs = () => subs.textContent = s.subs ? 'ON' : 'OFF';
    syncSubs();
    subs.onclick = () => { s.subs = !s.subs; syncSubs(); G.audio.latch('ui'); };
  }

  show(id) { // one screen at a time
    for (const sid of ['menu', 'pause', 'settings', 'help', 'chapters', 'credits', 'dead', 'ending'])
      el(sid).classList.toggle('hidden', sid !== id);
    document.body.classList.toggle('in-menu', !!id);
  }

  hideAllScreens() { this.show(null); }

  setHudVisible(v) { el('hud').classList.toggle('hidden', !v); }

  // ---------------- HUD ----------------
  setPrompt(text) {
    if (!text) { el('prompt').classList.add('hidden'); el('crosshair').classList.remove('on'); return; }
    el('prompt-text').textContent = text;
    el('prompt').classList.remove('hidden');
    el('crosshair').classList.add('on');
  }

  setObjective(text, done = false) {
    const o = el('objective');
    if (!text) { o.classList.add('hidden'); return; }
    el('objective-text').textContent = text;
    o.classList.remove('hidden', 'done');
    if (done) o.classList.add('done');
    o.style.animation = 'none'; void o.offsetWidth; o.style.animation = '';
    clearTimeout(this._objTimer);
    this._objTimer = setTimeout(() => { if (!this._objSticky) o.classList.add('hidden'); }, 6500);
  }
  objectiveDone(label) {
    const o = el('objective');
    el('objective-text').textContent = label;
    o.classList.remove('hidden'); o.classList.add('done');
    this.G.audio.latch('ui');
    setTimeout(() => o.classList.add('hidden'), 3000);
  }

  notify(name, text) {
    el('notify-name').textContent = name;
    el('notify-text').textContent = text.length > 46 ? text.slice(0, 46) + '…' : text;
    const n = el('notify');
    n.classList.remove('hidden', 'out');
    clearTimeout(this._nt1); clearTimeout(this._nt2);
    this._nt1 = setTimeout(() => n.classList.add('out'), 3300);
    this._nt2 = setTimeout(() => n.classList.add('hidden'), 3700);
  }

  subtitle(speaker, text, { thought = false, dur = null } = {}) {
    if (!this.G.settings.subs) return;
    this.subQueue.push({ speaker, text, thought, dur: dur ?? (2.1 + text.length * 0.05) });
  }
  clearSubtitles() { this.subQueue.length = 0; el('subtitle').classList.add('hidden'); this.subActive = false; }

  choices(title, opts, cb) { // opts: [{text, reply?}]
    el('choice-title').textContent = title || '…';
    el('choice-1').innerHTML = `<span class="ck">1</span>${opts[0].text}`;
    el('choice-2').innerHTML = `<span class="ck">2</span>${opts[1].text}`;
    el('choice').classList.remove('hidden');
    this.choiceActive = { opts, cb };
  }
  pickChoice(i) {
    if (!this.choiceActive) return false;
    const { opts, cb } = this.choiceActive;
    el('choice').classList.add('hidden');
    this.choiceActive = null;
    cb(opts[i - 1], i - 1);
    return true;
  }

  showStamina(show, v, exhausted) {
    el('stamina').classList.toggle('show', show);
    el('stamina-fill').style.width = `${v * 100}%`;
    el('stamina-fill').style.background = exhausted ? 'rgba(220,90,80,.8)' : 'rgba(255,220,170,.75)';
  }
  setVigHint(t) {
    const e = el('vig-hint');
    if (!t) e.classList.add('hidden'); else { e.textContent = t; e.classList.remove('hidden'); }
  }

  chapterCard(time, title, cb) {
    el('cc-time').textContent = time;
    el('cc-title').textContent = title;
    const c = el('chapter-card');
    c.classList.remove('hidden');
    c.style.opacity = 1;
    setTimeout(() => { c.style.opacity = 0; setTimeout(() => { c.classList.add('hidden'); c.style.opacity = 1; cb && cb(); }, 900); }, 2200);
  }

  letterbox(on) { document.body.classList.toggle('cine', on); }

  fade(toBlack, dur = 1000) {
    const f = el('fader');
    f.style.transitionDuration = dur + 'ms';
    f.style.opacity = toBlack ? 1 : 0;
  }

  showDead(sub) {
    el('dead-sub').textContent = sub || 'the lot is quiet again.';
    this.show('dead');
  }

  showEnding(lines, cb) { // typewriter epilogue
    this.show('ending');
    const t = el('ending-text');
    t.textContent = '';
    const full = lines.join('\n\n');
    let i = 0;
    const tick = () => {
      i += 1;
      t.textContent = full.slice(0, i);
      if (i < full.length) this._endTimer = setTimeout(tick, full[i] === '.' ? 130 : 26);
      else { this._endTimer = setTimeout(() => cb && cb(), 4200); }
    };
    tick();
  }
  skipEnding() {
    clearTimeout(this._endTimer);
  }

  update(dt) {
    // subtitle queue
    if (this.subActive) {
      this.subT -= dt;
      if (this.subT <= 0) {
        this.subActive = false;
        el('subtitle').classList.add('hidden');
      }
    }
    if (!this.subActive && this.subQueue.length) {
      const s = this.subQueue.shift();
      const e = el('subtitle');
      e.classList.toggle('thought', !!s.thought);
      e.innerHTML = (s.speaker ? `<span class="spk" style="color:${s.thought ? '#8fa3bb' : '#ffb45e'}">${s.thought ? '(thinking)' : s.speaker}</span>` : '') + s.text;
      e.classList.remove('hidden');
      this.subActive = true;
      this.subT = s.dur;
    }
  }
}
