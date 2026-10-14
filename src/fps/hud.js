// ── WARFRONT · the HUD: crosshair, hitmarkers, killfeed, medals, minimap ────

import { clamp, lerp, dist, angDiff, fmtTime, fmt } from './util.js';

const $ = (id) => document.getElementById(id);
const NAME_IRF = ['SGT. VAUGHN', 'CPL. OKAFOR', 'PVT. LUND', 'PVT. AOKI', 'CPL. MENSAB', 'SGT. REYES', 'PVT. HAAL'];
const NAME_OPFOR = ['OPFOR GRUNT', 'OPFOR RIFLE', 'OPFOR BREACHER', 'OPFOR SNIPER', 'OPFOR GUNNER', 'OPFOR SCOUT'];

export class Hud {
  constructor(game) {
    this.g = game;
    this.el = {
      hud: $('hud'), xhair: $('xhair'), ch: [...document.querySelectorAll('#xhair .ch')],
      hitmark: $('hitmark'), vignette: $('vignette'), dmgFlash: $('dmgFlash'), lowHp: $('lowHp'),
      scope: $('scope'), objTag: $('objTag'), objTxt: $('objTxt'), objCount: $('objCount'), objWave: $('objWave'),
      objBar: $('objBar').querySelector('i'), killfeed: $('killfeed'), medals: $('medals'),
      banner: $('banner'), bannerT: $('bannerT'), bannerS: $('bannerS'),
      hpNum: $('hpNum'), hpFill: $('hpFill'), stFill: $('stFill'), armorRow: $('armorRow'), plateNote: $('plateNote'),
      wName: $('wName'), ammoMag: $('ammoMag'), ammoReserve: $('ammoReserve'), nadeCount: $('nadeCount'),
      minimap: $('minimap'), compass: $('compassNeedle'), say: $('say'), prompt: $('prompt'),
      arrows: $('dmgArrows'),
      streaks: { uav: $('stkUav'), strike: $('stkAirstrike'), care: $('stkCare') },
      score: $('hudScore'), streak: $('hudStreak'), xp: $('hudXp'), clock: $('hudClock'), vmx: $('vmx'),
    };
    this.mmCtx = this.el.minimap.getContext('2d');
    this.mmWalls = null;
    this.feed = [];
    this.medalQ = [];
    this._sayT = 0;
    this._prompt = '';
    this.hitmarkT = 0; this.hitmarkKind = '';
    this.dmgT = 0;
    this.dmgArrows = [];
    this.lastHp = 100;
    this.hpPulse = 0;
    this.bannerT_ = 0;
    this.needAmmo = true;
  }

  show(on) {
    this.el.hud.classList.toggle('hide', !on);
    if (on) this.needAmmo = true;
  }

  // ── objective / wave ─────────────────────────────────────────────────────
  setObj(tag, txt, count, goal, wave, total, frac) {
    const sig = tag + '|' + txt + '|' + count + '|' + goal + '|' + wave + '|' + Math.round(frac * 40);
    if (sig === this._objSig) return;
    this._objSig = sig;
    this.el.objTag.textContent = tag;
    this.el.objTxt.textContent = txt;
    this.el.objCount.textContent = `${count} / ${goal}`;
    this.el.objWave.textContent = wave > 0 ? `WAVE ${wave}/${total}` : 'COMPLETE';
    this.el.objBar.style.width = `${clamp(frac * 100, 0, 100)}%`;
  }
  banner(t, s, ms = 2200, cls = '') {
    this.el.bannerT.textContent = t;
    this.el.bannerS.textContent = s || '';
    this.el.banner.className = 'show ' + cls;
    this.bannerT_ = ms / 1000;
  }
  notice(txt) { this.say(txt, null, 'notice'); }
  sayLine(txt, who) {
    this.el.say.innerHTML = who ? `<b>${who}:</b> ${txt}` : txt;
    this.el.say.classList.add('show');
    this._sayT = 3;
  }
  say(...a) { this.sayLine(...a); }
  prompt(txt) {
    if (txt === this._prompt) return;
    this._prompt = txt;
    this.el.prompt.innerHTML = txt || '';
    this.el.prompt.classList.toggle('show', !!txt);
  }

  // ── vitals ───────────────────────────────────────────────────────────────
  setHp(hp, max) {
    const v = clamp(hp / max, 0, 1);
    this.el.hpFill.style.width = `${v * 100}%`;
    const n = Math.max(0, Math.ceil(hp));
    if (n !== this.lastHp) {
      this.el.hpNum.textContent = n;
      this.el.hpNum.parentElement.classList.toggle('flash', hp > this.lastHp);
      this.lastHp = n;
    }
    this.el.hpNum.parentElement.classList.toggle('danger', v < .34);
    this.hpPulse = Math.max(this.hpPulse, v < .34 ? 1 : 0);
  }
  setStamina(v) { this.el.stFill.style.width = `${clamp(v, 0, 100)}%`; }
  setArmor(armor, plates, maxArmor) {
    const row = this.el.armorRow;
    const want = Math.max(0, Math.min(6, plates));
    if (row.children.length !== want) {
      row.innerHTML = '';
      for (let i = 0; i < want; i++) { const d = document.createElement('i'); d.className = 'plate'; row.appendChild(d); }
    }
    for (let i = 0; i < row.children.length; i++) row.children[i].classList.toggle('on', i < plates);
    this.el.plateNote.textContent = armor > 0 ? `${Math.round(armor)} ARMOR` : plates > 0 ? 'E — USE PLATE' : 'NO PLATES';
  }

  // ── weapon ───────────────────────────────────────────────────────────────
  flashWeapon(def) { this.needAmmo = true; this.el.wName.textContent = def.name; }
  setAmmo(mag, reserve, def) {
    this.el.ammoMag.textContent = mag;
    this.el.ammoReserve.textContent = '/ ' + reserve;
    this.el.ammoMag.parentElement.classList.toggle('low', mag <= Math.max(2, def.mag * .2));
    this.el.ammoMag.parentElement.classList.toggle('empty', mag === 0);
    this.el.nadeCount.textContent = this.g.player.nades;
    this.needAmmo = false;
  }
  reloadPulse(t) {
    const v = this.el.vmx;
    v.classList.add('show');
    v.style.setProperty('--t', t + 's');
    clearTimeout(this._rt);
    this._rt = setTimeout(() => v.classList.remove('show'), t * 1000);
  }
  plateApplied() { this.needAmmo = true; }

  // ── feedback ─────────────────────────────────────────────────────────────
  hitmark(kind) {
    this.hitmarkT = kind === 'kill' ? .42 : .22;
    this.hitmarkKind = kind;
    const e = this.el.hitmark;
    e.className = 'show ' + (kind || '');
    clearTimeout(this._ht);
    this._ht = setTimeout(() => { e.className = ''; }, this.hitmarkT * 1000);
  }
  damage(hp, ang) {
    this.dmgT = 1;
    this.el.dmgFlash.style.opacity = clamp(.25 + (1 - hp / 100) * .55, 0, .8);
    if (ang !== undefined && ang !== null) this.dmgArrows.push({ a: ang, t: 1.6 });
  }
  killfeed(entry) {
    const d = document.createElement('div');
    d.className = 'kf' + (entry.ours ? '' : ' us') + (entry.head ? ' head' : '') + (entry.vehicle ? ' veh' : '');
    const w = entry.weapon || 'bullet';
    const icon = w === 'explode' ? '✸' : w === 'melee' ? '✜' : '▮';
    d.innerHTML = `<span class="k">${entry.killer}</span><span class="wi">${icon}</span><span class="v">${entry.victim}</span>`;
    this.el.killfeed.appendChild(d);
    this.feed.push({ d, t: 5 });
    while (this.feed.length > 5) { const o = this.feed.shift(); o.d.remove(); }
  }
  medal(title, sub, cls = '') {
    if (this.g && this.g.medalsWon && !this.g.medalsWon.includes(title)) this.g.medalsWon.push(title);
    const d = document.createElement('div');
    d.className = 'medal ' + cls;
    d.innerHTML = `<span class="mi">★</span><div><b>${title}</b><i>${sub || ''}</i></div>`;
    this.el.medals.appendChild(d);
    this.medalQ.push({ d, t: 3.2 });
    setTimeout(() => { d.classList.add('out'); setTimeout(() => d.remove(), 420); }, 3200);
    while (this.medalQ.length > 5) { const o = this.medalQ.shift(); o.d.remove(); }
  }
  setStreaks(uav, strike, care, readyFlags) {
    const set = (el, n, ready) => {
      el.querySelector('i').textContent = n;
      el.classList.toggle('ready', !!ready);
      el.disabled = !ready;
    };
    set(this.el.streaks.uav, uav, readyFlags.uav);
    set(this.el.streaks.strike, strike, readyFlags.strike);
    set(this.el.streaks.care, care, readyFlags.care);
  }

  // ── per-frame ────────────────────────────────────────────────────────────
  update(dt, g) {
    const p = g.player;
    const guns = g.guns;
    const def = guns.def();
    // crosshair spread
    const spr = guns.currentSpread();
    const gap = clamp(spr * 6 + 6, 6, 46);
    const len = clamp(6 + spr * 2.2, 5, 13);
    const hidden = guns.ads > .5 || p.dead || g.state !== 'play';
    this.el.xhair.style.opacity = hidden ? 0 : 1;
    if (!hidden) {
      const [t, bt, l, r] = this.el.ch;
      t.style.transform = `translate(-50%,-50%) translateY(${-gap - len / 2}px)`;
      bt.style.transform = `translate(-50%,-50%) translateY(${gap + len / 2}px)`;
      l.style.transform = `translate(-50%,-50%) translateX(${-gap - len / 2}px)`;
      r.style.transform = `translate(-50%,-50%) translateX(${gap + len / 2}px)`;
      t.style.height = bt.style.height = len + 'px';
      l.style.width = r.style.width = len + 'px';
      this.el.xhair.style.setProperty('--o', clamp(1 - spr / 7, .35, 1));
    }
    const am = guns.ammo();
    if (this.needAmmo || am.mag !== this._lastMag || am.reserve !== this._lastRes || p.nades !== this._lastNade || def.name !== this._lastW) {
      this._lastMag = am.mag; this._lastRes = am.reserve; this._lastNade = p.nades; this._lastW = def.name;
      this.setAmmo(am.mag, am.reserve, def);
    }

    // scope / vignette / low hp
    this.el.scope.classList.toggle('hide', !guns.scopeActive);
    this.el.xhair.classList.toggle('noscope', guns.scopeActive);
    const dmgV = this.dmgT = Math.max(0, this.dmgT - dt * 1.3);
    this.el.dmgFlash.style.opacity = dmgV * .8;
    const hurt = clamp(1 - p.hp / p.maxHp, 0, 1);
    this.el.vignette.style.opacity = (0.35 + hurt * .5).toFixed(3);
    const crit = p.hp < 32 && !p.dead;
    this.el.lowHp.classList.toggle('on', crit);
    if (crit && (g.tickCount % 44 === 0)) g.audio.heartbeat();
    this.el.hud.classList.toggle('combat', g.combat > .35);

    // damage direction arrows
    if (this.dmgArrows.length) {
      let html = '';
      for (let i = this.dmgArrows.length - 1; i >= 0; i--) {
        const a = this.dmgArrows[i];
        a.t -= dt;
        if (a.t <= 0) { this.dmgArrows.splice(i, 1); continue; }
        const deg = -a.a * 180 / Math.PI;
        html += `<div class="dmgArrow" style="transform:translate(-50%,-50%) rotate(${deg.toFixed(1)}deg) translateY(-140px);opacity:${clamp(a.t, 0, 1).toFixed(2)}"></div>`;
      }
      if (html !== this._arrowsHtml) { this._arrowsHtml = html; if (this.el.arrows) this.el.arrows.innerHTML = html; }
    } else if (this._arrowsHtml !== '') {
      this._arrowsHtml = '';
      if (this.el.arrows) this.el.arrows.innerHTML = '';
    }

    // banner fade
    if (this.bannerT_ > 0) {
      this.bannerT_ -= dt;
      this.el.banner.style.opacity = clamp(this.bannerT_ * 1.6, 0, 1);
      if (this.bannerT_ <= 0) this.el.banner.className = '';
    }
    // killfeed timers
    for (let i = this.feed.length - 1; i >= 0; i--) {
      const f = this.feed[i];
      f.t -= dt;
      f.d.style.opacity = clamp(f.t * 1.4, 0, 1);
      if (f.t <= 0) { f.d.remove(); this.feed.splice(i, 1); }
    }
    // subtitles
    if (this._sayT > 0) { this._sayT -= dt; if (this._sayT <= 0) this.el.say.classList.remove('show'); }
    // streak counters
    this.setStreaks(g.stocks.uav, g.stocks.strike, g.stocks.care, {
      uav: g.stocks.uav > 0, strike: g.stocks.strike > 0, care: g.stocks.care > 0,
    });
    this.drawMinimap(g);
    // compass
    if (this.el.score) {
      const sc = Math.round(g.score || 0);
      if (sc !== this._sc) { this._sc = sc; this.el.score.textContent = fmt(sc); }
      const stk = g.streak || 0;
      if (stk !== this._stk) {
        this._stk = stk;
        this.el.streak.textContent = 'STREAK ' + stk;
        this.el.streak.classList.toggle('hot', stk >= 3);
      }
      const xp = Math.round(g.sessionXp || 0);
      if (xp !== this._xp) { this._xp = xp; this.el.xp.textContent = '+' + fmt(xp) + ' XP'; }
      const tl = Math.max(0, Math.ceil(g.timeLeft || 0));
      if (tl !== this._tl) {
        this._tl = tl;
        this.el.clock.textContent = fmtTime(tl);
        this.el.clock.classList.toggle('urgent', tl < 90);
      }
    }
    if (this.el.compass) {
      const bearing = ((-p.yaw * 180 / Math.PI) % 360 + 360) % 360;
      this.el.compass.style.transform = `translateX(${-bearing / 360 * 560 + 80}px)`;
      this.el.compass.parentElement.dataset.b = Math.round(bearing) + '°';
    }
  }

  drawMinimap(g) {
    const c = this.el.minimap, x = this.mmCtx, S = c.width;
    const p = g.player;
    if (!this.mmWalls) {
      this.mmWalls = g.world.colliders.map((b) => ({
        x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2, w: b.x1 - b.x0, d: b.z1 - b.z0, h: b.y1,
      }));
    }
    const scale = S / 112;
    x.clearRect(0, 0, S, S);
    x.save();
    x.translate(S / 2, S / 2);
    x.rotate(-p.yaw);
    x.translate(-p.pos.x * scale, -p.pos.z * scale);
    // ground blocks
    x.fillStyle = 'rgba(228,220,205,.22)';
    x.strokeStyle = 'rgba(0,0,0,.35)';
    for (const w of this.mmWalls) {
      if (dist(w.x, w.z, p.pos.x, p.pos.z) > 62) continue;
      x.fillRect(w.x * scale - w.w * scale / 2, w.z * scale - w.d * scale / 2, w.w * scale, w.d * scale);
    }
    // objective
    const o = g.world.objective;
    x.strokeStyle = g.objActive ? '#54e0a0' : 'rgba(120,220,170,.55)';
    x.lineWidth = 2;
    x.beginPath(); x.arc(o.x * scale, o.z * scale, o.r * scale, 0, 7); x.stroke();
    // soldiers
    for (const s of g.soldiers) {
      if (s.dead) continue;
      if (dist(s.pos.x, s.pos.z, p.pos.x, p.pos.z) > 58) continue;
      const hostile = s.team === 'opfor';
      const seen = !hostile || s.marked > 0 || g.uav > 0 || s.alert > 3;
      if (hostile && !seen) continue;
      x.fillStyle = hostile ? '#ff4a3c' : '#5ac8ff';
      x.beginPath(); x.arc(s.pos.x * scale, s.pos.z * scale, hostile ? 2.8 : 2.2, 0, 7); x.fill();
      if (hostile && s.state !== 'dead' && s.alert > 0) {
        x.strokeStyle = 'rgba(255,90,70,.6)'; x.lineWidth = 1;
        x.beginPath(); x.arc(s.pos.x * scale, s.pos.z * scale, 5.5, 0, 7); x.stroke();
      }
    }
    // care package / airdrops
    for (const a of g.drops) {
      x.fillStyle = '#ffd166';
      x.fillRect(a.pos.x * scale - 3, a.pos.z * scale - 3, 6, 6);
    }
    x.restore();
    // player arrow (always up)
    x.save();
    x.translate(S / 2, S / 2);
    x.fillStyle = '#fff';
    x.beginPath(); x.moveTo(0, -6); x.lineTo(4.4, 5); x.lineTo(0, 2.6); x.lineTo(-4.4, 5); x.closePath(); x.fill();
    x.restore();
    // frame
    x.strokeStyle = 'rgba(255,255,255,.15)';
    x.strokeRect(.5, .5, S - 1, S - 1);
  }

  // ── scoreboard ───────────────────────────────────────────────────────────
  scoreboard(g) {
    const p = g.player, acc = g.guns ? (g.player.stats.shots ? (g.player.stats.hits / g.player.stats.shots * 100) : 0) : 0;
    const rows = (arr, cls) => arr.map((r) => `
      <tr class="${cls}"><td class="nm">${r.name}</td><td>${r.kills}</td><td>${r.deaths}</td>
      <td>${r.score != null ? fmt(r.score) : '—'}</td><td>${r.streak ? r.streak + '🔥' : ''}</td></tr>`).join('');
    const allies = g.soldiers.filter((s) => s.team === 'irf').map((s) => ({ name: s.name || 'ALLIED AI', kills: s.kills || 0, deaths: s.deaths || 0, score: null, streak: 0 }));
    const enemies = g.soldiers.filter((s) => s.team === 'opfor' && !s.dead);
    return `<div class="sb">
      <div class="sbHead"><span>OPERATION BLACKOUT</span><b>${fmtTime(g.time)}</b><em>WAVE ${g.wave}/${g.totalWaves}</em></div>
      <table><thead><tr><th>OPERATOR</th><th>K</th><th>D</th><th>SCORE</th><th>STRK</th></tr></thead>
      <tbody>
        ${rows([{ name: 'YOU — ' + (g.callsign || 'GHOST-1'), kills: g.kills, deaths: p.dead ? g.deaths + 1 : g.deaths, score: g.score, streak: g.streak }], 'me')}
        ${rows(allies, '')}
      </tbody></table>
      <div class="sbSub">HOSTILES ACTIVE: <b>${enemies.length}</b> · ACCURACY <b>${acc.toFixed(1)}%</b> · XP <b>${fmt(g.sessionXp)}</b></div>
      ${g.medalsWon.length ? `<div class="sbMedals">${g.medalsWon.map((m) => `<span>${m}</span>`).join('')}</div>` : ''}
    </div>`;
  }
}
