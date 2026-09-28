// ── BOOYAH FIRE — HUD (DOM + canvas overlay) ────────────────────────────────
// Reads the battle/view each frame and drives the on-screen interface:
// minimap, compass, health/ammo, squad list, kill feed, damage numbers,
// hit markers, pickup list, zone warnings and the drop-phase map.

import { Vector3 } from 'three';
import { WEAPONS, ITEMS, VEST, HELMET, BAG } from './data.js';
import { clamp01, fmtTime, TAU } from './util.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor(game) {
    this.game = game;
    this.battle = null;
    this.view = null;
    this.el = {
      hud: $('hud'), crosshair: $('crosshair'), hitmarker: $('hitmarker'),
      hpBar: $('hpBar'), hpText: $('hpText'), hpFill: $('hpFill'),
      gear: $('gearIcons'), ammo: $('ammoText'), weapon: $('weaponName'), slots: $('slots'),
      items: $('itemsBar'), alive: $('aliveCount'), timer: $('matchTimer'), kills: $('killCount'),
      feed: $('killFeed'), squad: $('squadList'), minimap: $('minimap'), compass: $('compass'),
      pickups: $('pickupList'), zoneWarn: $('zoneWarn'), pops: $('dmgPops'),
      flash: $('flashOverlay'), hurt: $('hurtOverlay'), dropInfo: $('dropInfo'),
      bigMap: $('bigMap'), bigMapCanvas: $('bigMapCanvas'),
      useBar: $('useBar'), useFill: $('useFill'), reloadBar: $('reloadBar'), reloadFill: $('reloadFill'),
      toasts: $('toastWrap'), banner: $('banner'), zoneTimer: $('zoneTimer'), altText: $('altText'),
      spectate: $('spectateHint'), damageVig: $('damageVig'),
      vehHud: $('vehHud'), vehSpeed: $('vehSpeed'), vehFill: $('vehFill'), vehIcon: $('vehIcon'), vehHint: $('vehHint'),
    };
    this.kills = [];
    this.pops = [];
    this._mm = null;
    this._mmCtx = null;
    this._mmBg = null;
    this._lastZoneWarn = 0;
    this._toasts = [];
    this._useLast = null;
    this._banner = '';
  }

  // ── match start ──────────────────────────────────────────────────────────
  init(battle, view) {
    this.battle = battle;
    this.view = view;
    this.el.hud.classList.remove('hidden');
    this.el.feed.innerHTML = '';
    this.el.pickups.innerHTML = '';
    this.el.squad.innerHTML = '';
    this.el.pops.innerHTML = '';
    this.kills = [];
    this.pops = [];
    this._mmBg = this._makeMiniBackground(battle.island);
    this._mm = this.el.minimap;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this._mm.width = 176 * dpr; this._mm.height = 176 * dpr;
    this._mmCtx = this._mm.getContext('2d');
    this._mmCtx.scale(dpr, dpr);
    this._compassCtx = this.el.compass.getContext('2d');
    this.el.compass.width = 220 * dpr; this.el.compass.height = 26 * dpr;
    this._compassCtx.scale(dpr, dpr);
    this.el.bigMapCanvas.width = 512; this.el.bigMapCanvas.height = 512;
    this._bigCtx = this.el.bigMapCanvas.getContext('2d');
    this._bigBg = this._makeMiniBackground(battle.island, 512);
    this.banner('PLANE INBOUND — TAP THE MAP TO PICK A LANDING SPOT', 4);
  }

  // baked island picture for minimap + big map
  _makeMiniBackground(island, size = 176) {
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const g = c.getContext('2d');
    const img = g.createImageData(size, size);
    const N = island.N, d = img.data;
    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        const i = Math.round((px / size) * N), j = Math.round((py / size) * N);
        const h = island.hmap[j * (N + 1) + i];
        const o = (py * size + px) * 4;
        let r, gg, b;
        if (h <= 0.15) { r = 24; gg = 62; b = 104; }
        else if (h < 1.6) { r = 214; gg = 196; b = 148; }
        else if (h < 9) { r = 108; gg = 152; b = 78; }
        else if (h < 22) { r = 88; gg = 130; b = 66; }
        else if (h < 34) { r = 124; gg = 118; b = 96; }
        else { r = 196; gg = 200; b = 204; }
        d[o] = r; d[o + 1] = gg; d[o + 2] = b; d[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    // town pads
    const k = size / island.size;
    for (const t of island.towns) {
      g.fillStyle = 'rgba(196,168,120,0.55)';
      g.beginPath();
      g.arc((t.x + island.size / 2) * k, (t.z + island.size / 2) * k, t.radius * k, 0, TAU);
      g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.25)';
      g.stroke();
    }
    return c;
  }

  // ── per-frame ────────────────────────────────────────────────────────────
  update(dt, events) {
    const b = this.battle, p = b.player;
    if (!b) return;
    const st = b.playerState;

    // health / armor / boost
    const hpFrac = clamp01(st.hp / st.maxHp);
    this.el.hpFill.style.width = (hpFrac * 100).toFixed(1) + '%';
    this.el.hpFill.style.background = hpFrac > 0.6 ? 'linear-gradient(90deg,#42d66f,#8ef2a0)' : hpFrac > 0.3 ? 'linear-gradient(90deg,#ffc93c,#ffe082)' : 'linear-gradient(90deg,#ff5252,#ff8a80)';
    this.el.hpText.textContent = Math.ceil(st.hp);
    this.el.gear.innerHTML =
      `<span class="gear ${st.vest > 0 ? 'on' : 'off'}" style="--c:${VEST[st.vest].color}">🦺${st.vest}</span>` +
      `<span class="gear ${st.helmet > 0 ? 'on' : 'off'}" style="--c:${HELMET[st.helmet].color}">🪖${st.helmet}</span>` +
      `<span class="gear ${st.bag > 0 ? 'on' : 'off'}" style="--c:${BAG[st.bag].color}">🎒${st.bag}</span>`;

    // vehicle readouts (speed, condition, enter/exit prompt)
    const car = st.driving;
    this.el.vehHud.classList.toggle('hidden', !car);
    this.el.hud.classList.toggle('driving', !!car);
    if (car) {
      this.el.vehSpeed.textContent = Math.round(Math.abs(car.speed) * 3.6);
      this.el.vehIcon.textContent = car.def.icon;
      const hpF = clamp01(car.hp / car.maxHp);
      this.el.vehFill.style.width = (hpF * 100).toFixed(0) + '%';
      this.el.vehFill.style.background = hpF > 0.5 ? 'linear-gradient(90deg,#42d66f,#8ef2a0)' : hpF > 0.2 ? 'linear-gradient(90deg,#ffc93c,#ffe082)' : 'linear-gradient(90deg,#ff5252,#ff8a80)';
    }
    const hint = car ? 'F / ✋ · EXIT VEHICLE' : (st.nearVehicle ? `F / ✋ · DRIVE THE ${st.nearVehicle.def.name.toUpperCase()}` : '');
    this.el.vehHint.classList.toggle('hidden', !hint);
    if (hint) this.el.vehHint.textContent = hint;

    // weapons
    const w = st.weapon, def = st.weaponDef;
    if (w && def) {
      this.el.ammo.innerHTML = `<b>${w.ammo}</b><span>/${w.reserve}</span>`;
      this.el.weapon.textContent = def.name;
      this.el.weapon.className = 'wpn r' + def.rarity;
    } else {
      this.el.ammo.innerHTML = '<b>—</b>';
      this.el.weapon.textContent = 'FISTS';
      this.el.weapon.className = 'wpn';
    }
    this.el.slots.innerHTML = [0, 1].map((i) => {
      const wp = p.weapons[i];
      return `<div class="slot ${i === st.cur ? 'active' : ''}">${wp ? WEAPONS[wp.id].icon + ' ' + WEAPONS[wp.id].name.slice(0, 9) : '—'}</div>`;
    }).join('');
    this.el.reloadBar.style.opacity = st.reloading ? 1 : 0;
    this.el.reloadFill.style.width = (st.reloadPct * 100).toFixed(0) + '%';
    this.el.useBar.style.opacity = st.using ? 1 : 0;
    this.el.useFill.style.width = (st.usePct * 100).toFixed(0) + '%';
    if (st.using) this.el.useFill.dataset.label = ITEMS[st.using].name;

    // items bar
    this.el.items.innerHTML = [
      ['medkit', 'med'], ['firstaid', 'fa'], ['gloo', 'gloo'], ['grenade', 'nade'], ['smoke', 'smoke'], ['flash', 'flash'],
    ].map(([id, key]) => {
      const n = st.items[id] || 0;
      const it = ITEMS[id];
      return `<button class="itemBtn ${n > 0 ? '' : 'empty'}" data-item="${id}" style="--c:${it.color}"><span class="ic">${it.icon}</span><b>${n}</b><i>${key === 'med' ? 'H' : key === 'fa' ? 'J' : key === 'gloo' ? 'G' : key === 'nade' ? 'V' : key === 'smoke' ? 'B' : 'N'}</i></button>`;
    }).join('');

    // match info
    this.el.alive.textContent = b.alive;
    this.el.timer.textContent = fmtTime(b.time);
    this.el.kills.textContent = p.kills;
    const z = b.zone;
    const zoneTxt = z.state === 'shrink' ? `ZONE SHRINKING ${Math.ceil(z.t)}s` : z.phase < 0 ? 'ZONE SOON' : `ZONE MOVES ${Math.ceil(z.t)}s`;
    this.el.zoneTimer.textContent = zoneTxt;
    this.el.zoneTimer.className = z.state === 'shrink' ? 'zTimer hot' : 'zTimer';

    // zone warning + damage vignette
    const outside = p.outsideZone && !p.parachuting;
    this.el.zoneWarn.classList.toggle('hidden', !outside);
    this.el.damageVig.style.opacity = p.hp < p.maxHp * 0.35 ? 0.55 : p.hp < p.maxHp * 0.6 ? 0.28 : 0;
    this.el.hurt.style.opacity = clamp01((1 - hpFrac) * 0.85);
    if (p.flash > 0) { this.el.flash.style.opacity = clamp01(p.flash / 2); this.el.flash.classList.remove('hidden'); }
    else this.el.flash.classList.add('hidden');

    // compass
    this._drawCompass(p.yaw);
    // minimap
    this._drawMinimap();

    // pickups nearby
    this._drawPickups();

    // parachute / drop phase
    const para = st.parachuting;
    this.el.dropInfo.classList.toggle('hidden', !para);
    if (para) this.el.altText.textContent = Math.round(p.y) + 'm';
    this._mapOpen = this.game ? !!this.game.mapOpen : false;
    const showMap = (para && p.y >= 40) || this._mapOpen;
    this.el.bigMap.classList.toggle('hidden', !showMap);
    if (showMap) this._drawBigMap();

    // squad list
    this._drawSquad();

    // events → audio hooks / numbers / feed
    for (const ev of events || []) this._event(ev);

    // floating damage numbers
    this._stepPops(dt);
    // toasts
    this._stepToasts(dt);
  }

  _event(ev) {
    const b = this.battle, g = this.game;
    switch (ev.type) {
      case 'hitmarker': {
        this.hit(ev.kill, ev.zone === 'head');
        break;
      }
      case 'damage': {
        if (ev.attacker && ev.attacker.isPlayer && ev.target !== b.player) {
          this.pop(ev.dmg, ev.zone, ev.target, ev.target.hp <= 0);
        }
        break;
      }
      case 'death': {
        this.addKill(ev.attacker, ev.e, ev.zone === 'head', ev.source);
        break;
      }
      case 'knock': this.toast(`${ev.target.name} knocked down`, 'info'); break;
      case 'pickup': {
        if (ev.e.isPlayer) {
          const name = ev.kind === 'weapon' ? WEAPONS[ev.id].name : ev.kind === 'item' ? ITEMS[ev.id].name : (ev.kind === 'vest' ? VEST : ev.kind === 'helmet' ? HELMET : BAG)[ev.level].name;
          this.toast('Picked up ' + name, 'good');
        }
        break;
      }
      case 'zoneShrink': this.toast('⚠ THE ZONE IS CLOSING', 'warn'); g.audio.zoneWarn(); break;
      case 'airdrop': this.toast('📦 AIRDROP INCOMING', 'gold'); g.audio.airdrop(); break;
      case 'playerKnocked': this.toast('YOU ARE KNOCKED — crawl to a teammate!', 'bad'); break;
      case 'revive': if (ev.target.isPlayer) this.toast('REVIVED!', 'good'); break;
      case 'frag': break;
      default: break;
    }
  }

  // ── minimap ─────────────────────────────────────────────────────────────
  // ── full-size tactical map (drop phase or opened with TAB / tapping the minimap)
  _drawBigMap() {
    const g = this._bigCtx, b = this.battle, p = b.player;
    if (!g) return;
    const S = 512, k = S / b.island.size;
    const toMap = (x, z) => [(x + b.island.size / 2) * k, (z + b.island.size / 2) * k];
    g.clearRect(0, 0, S, S);
    g.globalAlpha = 0.95;
    g.drawImage(this._bigBg, 0, 0, S, S);
    g.globalAlpha = 1;
    // zone: current + next
    const z = b.zone;
    const [zx, zc] = toMap(z.x, z.z);
    g.strokeStyle = 'rgba(255,255,255,0.92)'; g.lineWidth = 3;
    g.beginPath(); g.arc(zx, zc, z.r * k, 0, TAU); g.stroke();
    if (z.targetR > 0) {
      const [tx, tz] = toMap(z.tx, z.tz);
      g.strokeStyle = 'rgba(120,220,255,0.95)'; g.setLineDash([7, 7]); g.lineWidth = 3;
      g.beginPath(); g.arc(tx, tz, z.targetR * k, 0, TAU); g.stroke();
      g.setLineDash([]);
    }
    // airdrops + juicy loot
    for (const a of b.airdrops || []) { const [ax, az] = toMap(a.x, a.z); g.fillStyle = '#ffd23f'; g.beginPath(); g.arc(ax, az, 7, 0, TAU); g.fill(); }
    g.fillStyle = 'rgba(255,210,63,0.7)';
    for (const d of b.drops) { if (d.taken || d.tier < 3) continue; const [dx, dz] = toMap(d.x, d.z); g.fillRect(dx - 2, dz - 2, 4, 4); }
    // vehicles worth grabbing
    for (const v of b.vehicles || []) {
      if (v.dead) continue;
      const [vx2, vz2] = toMap(v.x, v.z);
      g.fillStyle = v.water ? '#38bdf8' : 'rgba(255,255,255,0.65)';
      g.fillRect(vx2 - 3, vz2 - 3, 6, 6);
    }
    // squad
    for (const e of b.entities) {
      if (!e.alive || e.team !== p.team || e.isPlayer) continue;
      const [ex, ez] = toMap(e.x, e.z);
      g.fillStyle = '#7ef29a';
      g.beginPath(); g.arc(ex, ez, 5, 0, TAU); g.fill();
    }
    // the landing spot you are steering for
    if (p.targetLandX !== undefined) {
      const [lx, lz] = toMap(p.targetLandX, p.targetLandZ);
      g.strokeStyle = '#ffd23f'; g.lineWidth = 3;
      g.beginPath(); g.arc(lx, lz, 9, 0, TAU); g.stroke();
      g.beginPath(); g.moveTo(lx - 14, lz); g.lineTo(lx + 14, lz); g.moveTo(lx, lz - 14); g.lineTo(lx, lz + 14); g.stroke();
    }
    // you + heading
    const [px, pz] = toMap(p.x, p.z);
    g.save();
    g.translate(px, pz); g.rotate(-p.yaw);
    g.fillStyle = '#ffffff';
    g.beginPath(); g.moveTo(0, -11); g.lineTo(7, 9); g.lineTo(0, 5); g.lineTo(-7, 9); g.closePath(); g.fill();
    g.strokeStyle = '#0b1220'; g.lineWidth = 2; g.stroke();
    g.restore();
  }

  _drawMinimap() {
    const g = this._mmCtx, b = this.battle;
    if (!g) return;
    const S = 176, k = S / b.island.size;
    g.clearRect(0, 0, S, S);
    g.save();
    g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 1, 0, TAU); g.clip();
    g.globalAlpha = 0.92;
    g.drawImage(this._mmBg, 0, 0, S, S);
    g.globalAlpha = 1;
    // full-map minimap: rotate so "up" is where the player looks? keep north-up (easier to read)
    const toMap = (x, z) => [(x + b.island.size / 2) * k, (z + b.island.size / 2) * k];
    // zone: current + next
    const z = b.zone;
    const [zx, zc] = toMap(z.x, z.z);
    g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 1.6;
    g.beginPath(); g.arc(zx, zc, z.r * k, 0, TAU); g.stroke();
    if (z.targetR > 0) {
      const [tx, tz] = toMap(z.tx, z.tz);
      g.strokeStyle = 'rgba(120,220,255,0.95)'; g.setLineDash([3, 3]);
      g.beginPath(); g.arc(tx, tz, z.targetR * k, 0, TAU); g.stroke();
      g.setLineDash([]);
    }
    // airdrops
    for (const a of b.airdrops || []) {
      const [ax, az] = toMap(a.x, a.z);
      g.fillStyle = '#ffd23f';
      g.beginPath(); g.arc(ax, az, 3, 0, TAU); g.fill();
    }
    // loot crates worth running for
    for (const d of b.drops) {
      if (d.taken || d.tier < 3) continue;
      const [dx, dz] = toMap(d.x, d.z);
      g.fillStyle = 'rgba(255,210,63,0.75)';
      g.fillRect(dx - 1, dz - 1, 2, 2);
    }
    // entities
    const myTeam = b.player.team;
    for (const e of b.entities) {
      if (!e.alive) continue;
      const [ex, ez] = toMap(e.x, e.z);
      const d = Math.hypot(e.x - b.player.x, e.z - b.player.z);
      if (e.isPlayer) continue;
      if (e.team === myTeam) {
        g.fillStyle = '#6ee7b7';
        g.beginPath(); g.arc(ex, ez, 2.6, 0, TAU); g.fill();
      } else if (d < 70 || (b.time - (e.lastShotTime || -99) < 3 && d < 120)) {
        g.fillStyle = '#ff5d5d';
        g.beginPath(); g.arc(ex, ez, 2.6, 0, TAU); g.fill();
      }
    }
    // self arrow
    const [px, pz] = toMap(b.player.x, b.player.z);
    g.save();
    g.translate(px, pz);
    g.rotate(-b.player.yaw + Math.PI);
    g.fillStyle = '#ffffff';
    g.beginPath(); g.moveTo(0, -5.4); g.lineTo(3.6, 4.2); g.lineTo(0, 2.4); g.lineTo(-3.6, 4.2); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 0.8; g.stroke();
    g.restore();
    g.restore();
    // frame
    g.strokeStyle = 'rgba(255,255,255,0.45)'; g.lineWidth = 2;
    g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 1, 0, TAU); g.stroke();
    // plane path while dropping
    if (b.player.parachuting) {
      const pl = b.island.plane;
      const [fx, fz] = toMap(pl.from.x, pl.from.z), [tx2, tz2] = toMap(pl.to.x, pl.to.z);
      g.strokeStyle = 'rgba(255,255,255,0.7)'; g.setLineDash([4, 4]);
      g.beginPath(); g.moveTo(fx, fz); g.lineTo(tx2, tz2); g.stroke(); g.setLineDash([]);
    }
  }

  _drawCompass(yaw) {
    const g = this._compassCtx;
    if (!g) return;
    const W = 220, H = 26;
    g.clearRect(0, 0, W, H);
    const dirs = [[0, 'N'], [45, 'NE'], [90, 'E'], [135, 'SE'], [180, 'S'], [225, 'SW'], [270, 'W'], [315, 'NW']];
    const deg = ((yaw * 180 / Math.PI) % 360 + 360) % 360;
    // show ±60° around the facing direction
    for (const [a, label] of dirs) {
      let diff = ((a - deg + 540) % 360) - 180;
      if (Math.abs(diff) > 62) continue;
      const x = W / 2 + (diff / 62) * (W / 2 - 6);
      const fade = 1 - Math.abs(diff) / 70;
      g.fillStyle = `rgba(255,255,255,${0.35 + fade * 0.6})`;
      g.font = 'bold 12px system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillText(label, x, 17);
      g.fillRect(x - 0.5, 0, 1, 4);
    }
    // ticks every 15°
    for (let a = 0; a < 360; a += 15) {
      let diff = ((a - deg + 540) % 360) - 180;
      if (Math.abs(diff) > 62) continue;
      const x = W / 2 + (diff / 62) * (W / 2 - 6);
      g.fillStyle = 'rgba(255,255,255,0.25)';
      g.fillRect(x, 20, 1, 3);
    }
    g.fillStyle = '#ffd23f';
    g.fillRect(W / 2 - 1, 0, 2, 6);
  }

  // ── nearby loot list (tap to pick up) ───────────────────────────────────
  _drawPickups() {
    const b = this.battle;
    const list = b.nearbyDrops(4, 5.5);
    const html = list.map(({ drop, dist }) => {
      let icon = '📦', label = 'Loot', sub = (dist.toFixed(1) + 'm');
      if (drop.kind === 'weapon') { icon = WEAPONS[drop.id].icon; label = WEAPONS[drop.id].name; sub = `${WEAPONS[drop.id].ammo ?? ''} · ${dist.toFixed(1)}m`; }
      else if (drop.kind === 'item') { icon = ITEMS[drop.id].icon; label = ITEMS[drop.id].name; }
      else if (drop.kind === 'vest') { icon = '🦺'; label = VEST[drop.level].name; }
      else if (drop.kind === 'helmet') { icon = '🪖'; label = HELMET[drop.level].name; }
      else if (drop.kind === 'bag') { icon = '🎒'; label = BAG[drop.level].name; }
      return `<button class="pickRow" data-drop="${drop.uid}"><span class="pic">${icon}</span><span class="plabel">${label}</span><span class="pdist">${sub}</span></button>`;
    }).join('');
    if (this._pickupHtml !== html) { this.el.pickups.innerHTML = html; this._pickupHtml = html; }
  }

  _drawSquad() {
    const b = this.battle;
    if (b.mode.team === 1) { this.el.squad.innerHTML = ''; return; }
    const info = b.squadInfo();
    const html = info.map((s) => {
      const frac = clamp01(s.hp / s.maxHp);
      return `<div class="sqRow ${s.isPlayer ? 'me' : ''} ${s.knocked ? 'down' : ''} ${s.alive ? '' : 'dead'}">
        <span class="sqName">${s.name}</span>
        <span class="sqBar"><i style="width:${(frac * 100).toFixed(0)}%;background:${frac > 0.6 ? '#42d66f' : frac > 0.3 ? '#ffc93c' : '#ff5252'}"></i></span>
        <span class="sqK">${s.alive ? (s.knocked ? '💀' : s.kills) : '☠'}</span>
      </div>`;
    }).join('');
    if (this._squadHtml !== html) { this.el.squad.innerHTML = html; this._squadHtml = html; }
  }

  // ── kill feed ───────────────────────────────────────────────────────────
  addKill(killer, victim, head, source) {
    const row = document.createElement('div');
    row.className = 'feedRow' + (victim && victim.isPlayer ? ' me' : '');
    const wname = source && WEAPONS[source] ? WEAPONS[source].name : typeof source === 'string' ? source : '';
    row.innerHTML = `<span class="k">${killer ? killer.name : '☠ ZONE'}</span>` +
      `<span class="w">${head ? '🎯' : ''}${wname}</span>` +
      `<span class="v">${victim ? victim.name : ''}</span>`;
    this.el.feed.prepend(row);
    while (this.el.feed.children.length > 6) this.el.feed.lastChild.remove();
    setTimeout(() => { row.classList.add('fade'); setTimeout(() => row.remove(), 700); }, 6000);
  }

  hit(kill, head) {
    const el = this.el.hitmarker;
    el.classList.remove('hidden');
    el.className = 'hm' + (head ? ' head' : '') + (kill ? ' kill' : '');
    el.style.opacity = 1;
    clearTimeout(this._hmT);
    this._hmT = setTimeout(() => { el.style.opacity = 0; }, kill ? 320 : 160);
  }

  // floating damage number at the victim's screen position
  pop(dmg, zone, target, killed) {
    const v = this.view;
    if (!v) return;
    const p = { x: target.x, y: target.y + (zone === 'head' ? 1.85 : 1.3), z: target.z };
    const vec = new Vector3(p.x, p.y, p.z).project(v.camera);
    if (vec.z > 1) return;
    const el = document.createElement('div');
    el.className = 'dmgPop' + (zone === 'head' ? ' head' : '') + (killed ? ' kill' : '');
    el.textContent = Math.round(dmg);
    el.style.left = ((vec.x * 0.5 + 0.5) * 100).toFixed(2) + '%';
    el.style.top = ((-vec.y * 0.5 + 0.5) * 100).toFixed(2) + '%';
    this.el.pops.appendChild(el);
    requestAnimationFrame(() => { el.style.transform = `translate(-50%,-${killed ? 90 : 60}px) scale(${killed ? 1.25 : 1})`; el.style.opacity = 0; });
    setTimeout(() => el.remove(), 900);
  }

  toast(msg, kind = 'info') {
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.textContent = msg;
    this.el.toasts.appendChild(el);
    requestAnimationFrame(() => el.classList.add('in'));
    setTimeout(() => { el.classList.remove('in'); setTimeout(() => el.remove(), 400); }, 2400);
    while (this.el.toasts.children.length > 4) this.el.toasts.firstChild.remove();
  }

  banner(text, secs = 3) {
    this.el.banner.textContent = text;
    this.el.banner.classList.remove('hidden');
    clearTimeout(this._bannerT);
    this._bannerT = setTimeout(() => this.el.banner.classList.add('hidden'), secs * 1000);
  }

  _stepPops(dt) { /* damage numbers animate via CSS */ }
  _stepToasts(dt) { /* toasts fade via CSS */ }
}
