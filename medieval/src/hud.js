// ── IRONVOW — the interface, kept out of the way ─────────────────────────────
// A duel is read from the steel, so the HUD says only what a fighter could
// actually know: how his own wind is holding, which way the blow is coming,
// how badly the man opposite is hurt, and where his guard has gone slack.
// Nothing floats over the enemy's body; no numbers count damage as it lands.
import { clamp01, clamp } from './mathx.js';

const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};

export class Hud {
  constructor(root) {
    this.root = root;
    root.classList.add('hud');
    root.innerHTML = '';
    this.built = false;
    this.ticker = [];
    this.wounds = [];
    this._msgT = 0;
  }

  build(player, foe, arena) {
    const r = this.root;
    r.innerHTML = '';
    // ── the man opposite ──
    this.foeBar = el('div', 'foe-bar');
    this.foeName = el('div', 'foe-name');
    this.foeHealth = el('div', 'bar foe-health');
    this.foeHealthFill = el('i');
    this.foeHealth.append(this.foeHealthFill);
    this.foeArmour = el('div', 'foe-armour');
    this.foeWounds = el('div', 'foe-wounds');
    this.foeBar.append(this.foeName, this.foeHealth, this.foeArmour, this.foeWounds);
    r.append(this.foeBar);

    // ── round pips ──
    this.rounds = el('div', 'rounds');
    r.append(this.rounds);

    // ── the tell: which way the steel will come ──
    this.tell = el('div', 'tell');
    this.tell.append(el('div', 'tell-arc'));
    this.tellLabel = el('div', 'tell-label', '&nbsp;');
    this.tell.append(this.tellLabel);
    r.append(this.tell);

    // ── reticle ──
    this.reticle = el('div', 'reticle');
    this.reticle.append(el('i', 'rt-1'), el('i', 'rt-2'), el('i', 'rt-3'), el('i', 'rt-4'));
    this.guardDot = el('div', 'guard-dot');
    this.reticle.append(this.guardDot);
    r.append(this.reticle);

    // ── the dial: strike direction and the wind behind it ──
    this.dial = el('div', 'dial');
    for (const [k, l] of [['U', 'over'], ['L', 'left'], ['R', 'right'], ['D', 'thrust']]) {
      const s = el('div', 'dial-arm dial-' + k, `<span>${l}</span>`);
      this.dial.append(s);
      s.dataset.dir = k;
    }
    this.chargeRing = el('div', 'charge-ring');
    this.dial.append(this.chargeRing);
    r.append(this.dial);

    // ── your own wind and guard ──
    this.selfPanel = el('div', 'self-panel');
    this.selfWeapon = el('div', 'self-weapon');
    this.windBar = el('div', 'bar wind');
    this.windFill = el('i');
    this.windBar.append(this.windFill);
    this.guardBar = el('div', 'bar guard');
    this.guardFill = el('i');
    this.guardBar.append(this.guardFill);
    this.windLabel = el('div', 'bar-label', 'wind');
    this.guardLabel = el('div', 'bar-label', 'guard');
    this.selfPanel.append(this.selfWeapon, this.windLabel, this.windBar, this.guardLabel, this.guardBar);
    r.append(this.selfPanel);

    // ── a place for the fight to talk ──
    this.feed = el('div', 'feed');
    r.append(this.feed);
    this.banner = el('div', 'banner');
    this.measureHint = el('div', 'measure', '');
    r.append(this.measureHint);
    r.append(this.banner);

    // vignettes
    this.vigHurt = el('div', 'vig vig-hurt');
    this.vigWind = el('div', 'vig vig-wind');
    this.vigFlash = el('div', 'vig vig-flash');
    r.append(this.vigHurt, this.vigWind, this.vigFlash);

    this.player = player; this.foe = foe; this.arena = arena;
    this.built = true;
    this.pips = [];
    this.setRounds(3, 0, 0);
    return this;
  }

  setRounds(best, won, lost) {
    this.bestOf = best;
    this.rounds.innerHTML = '';
    this.pips = [];
    for (let i = 0; i < best; i++) {
      const p = el('i');
      this.rounds.append(p);
      this.pips.push(p);
    }
    this.markRounds(won, lost);
  }

  markRounds(won, lost) {
    this.pips.forEach((p, i) => {
      p.className = i < won ? 'won' : i < won + lost ? 'lost' : '';
    });
  }

  /** Too far to reach him with anything you have: say so, quietly. */
  measure(dist, measure) {
    if (!this.built || !measure) return;
    const out = dist > measure * 0.99;
    const far = dist > measure * 1.25;
    this.measureHint.dataset.state = out ? (far ? 'far' : 'out') : 'in';
    if (out) this.measureHint.textContent = far ? 'out of measure — close the ground' : 'at the edge of your measure';
    else this.measureHint.textContent = '';
  }

  /** A line in the fight's log: parry, clash, "the guard breaks". */
  say(text, kind = 'note') {
    if (!this.built) return;
    const line = el('div', `feed-line k-${kind}`, text);
    this.feed.append(line);
    this.ticker.push({ n: line, t: 0 });
    if (this.ticker.length > 5) {
      const old = this.ticker.shift();
      old.n.remove();
    }
  }

  /** A big, short statement: the start of a bout, a death, a victory. */
  announce(text, sub = '', ms = 1400) {
    if (!this.built) return;
    this.banner.innerHTML = `<b>${text}</b>${sub ? `<span>${sub}</span>` : ''}`;
    this.banner.classList.add('show');
    this._msgT = ms / 1000;
  }

  hurt(dir, power) {
    if (!this.built) return;
    const v = this.vigHurt;
    v.dataset.dir = dir || 'front';
    v.style.opacity = String(clamp01(0.25 + power * 0.9));
    this._hurtT = 0.5;
    this.vigHurt.classList.add('hit');
    setTimeout(() => this.vigHurt.classList.remove('hit'), 90);
  }

  flash(color) {
    if (!this.built) return;
    this.vigFlash.style.background = color;
    this.vigFlash.style.opacity = '0.5';
    this._flashT = 0.2;
  }

  /** What the player needs to see about the man opposite, and nothing else. */
  refreshFoe() {
    const f = this.foe;
    if (!f) return;
    const b = f.bodyState;
    const hp = clamp01(b.health / b.maxHealth);
    this.foeHealthFill.style.width = (hp * 100).toFixed(1) + '%';
    this.foeHealthFill.dataset.low = hp < 0.35 ? '1' : '0';
    this.foeName.textContent = f.name || 'challenger';
    const lead = f.lead || '';
    this.foeArmour.textContent = `${f.harness?.name || ''}${f.shieldDef?.model ? ' · ' + f.shieldDef.name : ''} · ${f.weaponDef.short || ''}${lead ? ' · ' + lead : ''}`;
    // wound pips: where he is hurt, and whether a limb has stopped serving him
    const hurt = [];
    for (const r in b.regions) {
      const rg = b.regions[r];
      if (rg.disabled) hurt.push(`<b>${rg.label || r} broken</b>`);
      else if (rg.hp < rg.max * 0.65) hurt.push(rg.label || r);
    }
    const bleed = b.bleed > 0.4 ? `<b>bleeding</b>` : '';
    this.foeWounds.innerHTML = [bleed, ...hurt].filter(Boolean).join(' · ');
  }

  update(dt, ctx) {
    if (!this.built) return;
    const p = this.player;
    // ── the tell ──
    const side = ctx.incomingSide || null;
    const threat = ctx.threat;
    if (side && threat) {
      this.tell.dataset.side = side;
      this.tell.classList.add('active');
      this.tellLabel.textContent = ctx.incomingKind === 'thrust' ? 'point — cross it' : `edge — ${side}`;
      this.tell.dataset.kind = ctx.incomingKind || 'cut';
    } else {
      this.tell.classList.remove('active');
    }
    // ── reticle & guard dot: where the point is holding ──
    const q = ctx.quality ?? 0;
    this.reticle.dataset.q = q > 0.55 ? 'good' : q > 0.25 ? 'fair' : 'off';
    const gx = clamp((ctx.aimX || 0) * 60, -34, 34);
    const gy = clamp(-(ctx.aimY || 0) * 60, -34, 34);
    this.guardDot.style.transform = `translate(${gx.toFixed(1)}px, ${gy.toFixed(1)}px)`;
    this.guardDot.dataset.up = p.blocking ? '1' : '0';
    this.guardDot.dataset.broken = p.guardBroken > 0 ? '1' : '0';
    // ── dial: what is charging, and how far it has come ──
    const dir = p.moveDir || 'R';
    for (const arm of this.dial.querySelectorAll('.dial-arm')) {
      arm.classList.toggle('on', arm.dataset.dir === dir && (p.state === 'windup' || p.attacking));
      arm.classList.toggle('armed', arm.dataset.dir === dir && p.state === 'windup');
    }
    this.chargeRing.style.setProperty('--p', (p.state === 'windup' ? clamp01(p.charge) : 0).toFixed(2));
    this.chargeRing.dataset.parry = (p.parryT > 0 && p.blocking) ? '1' : '0';
    // ── your own state ──
    const w = clamp01(p.stamina / p.maxStamina);
    this.windFill.style.width = (w * 100).toFixed(1) + '%';
    this.windFill.dataset.low = w < 0.25 ? '2' : w < 0.45 ? '1' : '0';
    this.windBar.dataset.exhausted = p.exhausted ? '1' : '0';
    const gi = clamp01(1 - p.guardBroken / 1.2);
    this.guardFill.style.width = (gi * 100).toFixed(1) + '%';
    this.guardBar.dataset.broken = p.guardBroken > 0 ? '1' : '0';
    this.selfWeapon.textContent = `${p.weaponDef.short || ''}`;
    // ── vignettes ──
    if (this._hurtT > 0) {
      this._hurtT -= dt;
      if (this._hurtT <= 0) this.vigHurt.style.opacity = '0';
    }
    if (this._flashT > 0) {
      this._flashT -= dt;
      if (this._flashT <= 0) this.vigFlash.style.opacity = '0';
    }
    this.vigWind.style.opacity = p.exhausted ? String(0.35 + 0.1 * Math.sin(p._t * 4)) : '0';
    // ── ticker decay ──
    for (let i = this.ticker.length - 1; i >= 0; i--) {
      const t = this.ticker[i];
      t.t += dt;
      t.n.style.opacity = String(clamp01(1 - (t.t - 1.6) / 1.2));
      if (t.t > 3.0) { t.n.remove(); this.ticker.splice(i, 1); }
    }
    if (this._msgT > 0) {
      this._msgT -= dt;
      if (this._msgT <= 0) this.banner.classList.remove('show');
    }
    this.refreshFoe();
  }

  show(show = true) { this.root.classList.toggle('off', !show); }
}
