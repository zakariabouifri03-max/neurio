// ── Garage scene + all menu screens (shop, drivers, customize, upgrades…) ───
import * as THREE from 'three';
import { CARS, DRIVERS, PAINTS, WHEELS, HORNS, UPGRADES, RIVALS, carById, driverById, ARCH } from './data.js';
import { buildGarageWorld, buildCar, buildDriver } from './builders.js';
import { clamp, fmt, lerp } from './util.js';
import { audio } from './audio.js';

const $ = (id) => document.getElementById(id);

// ── 2D thumbnails ────────────────────────────────────────────────────────────
function drawCarThumb(cv, car) {
  const g = cv.getContext('2d'), W = cv.width, H = cv.height;
  g.clearRect(0, 0, W, H);
  const cx = W / 2, groundY = H * 0.78;
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.beginPath(); g.ellipse(cx, groundY + 4, W * 0.38, 7, 0, 0, 7); g.fill();
  const u = W / 120; // unit
  const bodyY = groundY - 16 * u;
  const paint = car.paint, acc = car.accent;
  const A = ARCH[car.arch];
  const big = car.arch === 'monster';
  const wr = (big ? 15 : A.wheelR * 15) * u;
  const wb = A.wb * 16 * u;
  // wheels
  for (const s of [-1, 1]) {
    g.fillStyle = '#1b1e26';
    g.beginPath(); g.arc(cx + s * wb, groundY - wr, wr, 0, 7); g.fill();
    g.fillStyle = '#aab0bd';
    g.beginPath(); g.arc(cx + s * wb, groundY - wr, wr * 0.5, 0, 7); g.fill();
  }
  // body
  const bw = A.L * 17 * u, bh = A.bodyH * 20 * u + 6 * u;
  const by = groundY - wr * (big ? 2 : 1) - bh * 0.4;
  g.fillStyle = paint;
  g.beginPath(); g.roundRect(cx - bw / 2, by - bh / 2, bw, bh, 7 * u); g.fill();
  g.fillStyle = acc;
  g.fillRect(cx - bw / 2, by - bh / 2, bw, 3.4 * u);
  // cab
  g.fillStyle = paint;
  if (A.cab === 'bubble') { g.beginPath(); g.roundRect(cx - bw * 0.22, by - bh / 2 - 12 * u, bw * 0.4, 14 * u, 6 * u); g.fill(); g.fillStyle = '#bfe8ff'; g.fillRect(cx - bw * 0.18, by - bh / 2 - 10 * u, bw * 0.16, 10 * u); }
  else if (A.cab === 'truck') { g.beginPath(); g.roundRect(cx + bw * 0.06, by - bh / 2 - 13 * u, bw * 0.26, 15 * u, 4 * u); g.fill(); g.fillStyle = '#bfe8ff'; g.fillRect(cx + bw * 0.24, by - bh / 2 - 11 * u, bw * 0.06, 11 * u); }
  else if (A.cab === 'fastback') { g.beginPath(); g.roundRect(cx - bw * 0.3, by - bh / 2 - 11 * u, bw * 0.34, 13 * u, 5 * u); g.fill(); }
  else if (A.cab === 'sports' || A.cab === 'convert' || A.cab === 'open') { g.fillStyle = '#8ed8ff'; g.beginPath(); g.moveTo(cx - bw * 0.12, by - bh / 2); g.lineTo(cx - bw * 0.04, by - bh / 2 - 9 * u); g.lineTo(cx + bw * 0.06, by - bh / 2); g.fill(); }
  if (A.cage) { g.strokeStyle = '#23262e'; g.lineWidth = 3 * u; g.beginPath(); g.moveTo(cx - bw * 0.2, by - bh / 2); g.lineTo(cx - bw * 0.1, by - bh / 2 - 13 * u); g.lineTo(cx + bw * 0.14, by - bh / 2 - 13 * u); g.lineTo(cx + bw * 0.18, by - bh / 2); g.stroke(); }
  if (A.engine) { g.fillStyle = '#c8ccd6'; g.fillRect(cx - bw * 0.46, by - bh / 2 - 7 * u, bw * 0.16, 8 * u); g.fillRect(cx - bw * 0.43, by - bh / 2 - 12 * u, 3 * u, 6 * u); g.fillRect(cx - bw * 0.37, by - bh / 2 - 12 * u, 3 * u, 6 * u); }
  if (A.spoiler) { g.fillStyle = acc; g.fillRect(cx - bw * 0.5, by - bh / 2 - 8 * u, bw * 0.2, 3 * u); }
  // headlight
  g.fillStyle = '#fff6c9';
  g.beginPath(); g.arc(cx + bw / 2 - 2 * u, by, 2.6 * u, 0, 7); g.fill();
}

function drawDriverThumb(cv, d) {
  const g = cv.getContext('2d'), W = cv.width, H = cv.height;
  g.clearRect(0, 0, W, H);
  g.fillStyle = d.shirt;
  g.beginPath(); g.arc(W / 2, H / 2, W * 0.46, 0, 7); g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 3;
  g.beginPath(); g.arc(W / 2, H / 2, W * 0.43, 0, 7); g.stroke();
  g.font = `${W * 0.52}px serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(d.emoji, W / 2, H / 2 + W * 0.03);
}

function statBars(car) {
  const row = (label, v) => `<div class="srow"><span>${label}</span><div class="sbar"><div style="width:${v}%"></div></div></div>`;
  return `<div class="stats">${row('SPD', car.spd)}${row('ACC', car.acc)}${row('HND', car.hnd)}</div>`;
}

// ══════════════════════════ GARAGE ═══════════════════════════════════════════

export class Garage {
  constructor(game) {
    this.game = game;
    const { scene, carAnchor, driverAnchor, userData, sunDir } = buildGarageWorld();
    this.world = { scene, carAnchor, driverAnchor, userData, sunDir };
    this.scene = scene;
    this.camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.1, 2400);
    this.camera.position.set(11.5, 5.6, 11.5);
    this.camera.lookAt(0, 1.4, 0);
    this.orbitA = 0.78;
    this.orbitT = 0.78;
    this.dragging = false;
    this.carG = null;
    this.driverG = null;

    scene.fog = new THREE.Fog(0xbfe3f5, 160, 800);
    const hemi = new THREE.HemisphereLight(0xbfe3f5, 0xe8d291, 1.05);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff2c0, 2.2);
    sun.position.copy(sunDir).multiplyScalar(130);
    sun.castShadow = true;
    sun.shadow.mapSize.set(game.highQ ? 2048 : 1024, game.highQ ? 2048 : 1024);
    sun.shadow.camera.left = -30; sun.shadow.camera.right = 30;
    sun.shadow.camera.top = 30; sun.shadow.camera.bottom = -30;
    sun.shadow.camera.near = 40; sun.shadow.camera.far = 300;
    sun.shadow.bias = -0.001;
    scene.add(sun);

    // drag rotate
    const el = game.renderer.domElement;
    this._pd = (e) => { this.dragging = true; this._dragX = e.clientX; };
    this._pm = (e) => {
      if (!this.dragging) return;
      this.orbitT -= (e.clientX - this._dragX) * 0.008;
      this._dragX = e.clientX;
    };
    this._pu = () => { this.dragging = false; };
    el.addEventListener('pointerdown', this._pd);
    addEventListener('pointermove', this._pm);
    addEventListener('pointerup', this._pu);

    this.refresh();
  }

  refresh() {
    const save = this.game.save;
    // car
    if (this.carG) { this.world.carAnchor.remove(this.carG.group); this.carG = null; }
    const carDef = carById(save.selectedCar);
    this.carG = buildCar(carDef, { paint: save.paints[carDef.id] || null, wheelColor: save.wheelColor });
    this.world.carAnchor.add(this.carG.group);
    // driver
    if (this.driverG) { this.world.driverAnchor.remove(this.driverG.group); this.driverG = null; }
    this.driverG = buildDriver(driverById(save.selectedDriver), 'stand');
    this.world.driverAnchor.add(this.driverG.group);
    // name plate
    $('carNamePlate').innerHTML = `<b>${carDef.name}</b> · ${driverById(save.selectedDriver).name} ${driverById(save.selectedDriver).emoji}`;
  }

  update(dt) {
    if (!this.dragging) this.orbitT += dt * 0.12;
    this.orbitA = lerp(this.orbitA, this.orbitT, Math.min(1, dt * 6));
    const r = 13.2;
    this.camera.position.set(Math.cos(this.orbitA) * r, 5.4, Math.sin(this.orbitA) * r);
    this.camera.lookAt(0, 1.3, 0);
    if (this.carG) this.carG.group.rotation.y += dt * 0.4;
    if (this.driverG) {
      const t = performance.now() * 0.003;
      this.driverG.group.position.y = Math.abs(Math.sin(t)) * 0.06;
      this.driverG.head.rotation.z = Math.sin(t * 0.7) * 0.08;
    }
    for (const b of this.world.userData.balloons) {
      b.position.y = b.userData.baseY + Math.sin(performance.now() * 0.0004 + b.userData.bobPhase) * 3;
    }
    for (const c of this.world.userData.clouds) c.position.x += c.userData.drift * dt;
  }

  dispose() {
    const el = this.game.renderer.domElement;
    el.removeEventListener('pointerdown', this._pd);
    removeEventListener('pointermove', this._pm);
    removeEventListener('pointerup', this._pu);
  }
}

// ══════════════════════════ PANELS ═══════════════════════════════════════════

function openPanel(title, tabHtml = '') {
  const p = $('panel');
  p.classList.add('open');
  $('panelTitle').textContent = title;
  $('panelTabs').innerHTML = tabHtml;
  $('panelBody').innerHTML = '';
}
export function closePanel() { $('panel').classList.remove('open'); }

function priceTag(item) {
  if (item.gems) return `<span class="price gem">💎 ${fmt(item.gems)}</span>`;
  return `<span class="price coin">🪙 ${fmt(item.coins)}</span>`;
}

let shopTab = 'cars';

export function openShop(game) {
  audio.click();
  openPanel('🛒 SHOP', `
    <button class="tab ${shopTab === 'cars' ? 'on' : ''}" data-t="cars">🚗 Cars (50)</button>
    <button class="tab ${shopTab === 'drivers' ? 'on' : ''}" data-t="drivers">🧑‍🤝‍🧑 Drivers (16)</button>`);
  $('panelTabs').querySelectorAll('.tab').forEach((b) => {
    b.onclick = () => { shopTab = b.dataset.t; audio.click(); openShop(game); };
  });
  const body = $('panelBody');
  const grid = document.createElement('div');
  grid.className = 'grid';
  body.appendChild(grid);
  const save = game.save;

  if (shopTab === 'cars') {
    for (const car of CARS) {
      const owned = save.ownedCars.includes(car.id);
      const selling = owned ? 'owned' : (car.gems ? 'gems' : 'coins');
      const card = document.createElement('div');
      card.className = 'card' + (save.selectedCar === car.id ? ' sel' : '');
      const cv = document.createElement('canvas');
      cv.width = 128; cv.height = 74; cv.className = 'thumb';
      drawCarThumb(cv, car);
      const paint = save.paints[car.id];
      if (owned && paint) drawCarThumb(cv, { ...car, paint });
      card.appendChild(cv);
      card.insertAdjacentHTML('beforeend', `<div class="cname">${car.name}</div><div class="carch">${ARCH[car.arch].label}</div>${statBars(car)}`);
      const btn = document.createElement('button');
      btn.className = 'cbtn ' + selling;
      if (save.selectedCar === car.id) { btn.textContent = '✔ SELECTED'; btn.disabled = true; }
      else if (owned) btn.textContent = 'SELECT';
      else btn.innerHTML = car.gems ? `BUY 💎 ${fmt(car.gems)}` : `BUY 🪙 ${fmt(car.coins)}`;
      btn.onclick = () => {
        if (owned) {
          save.selectedCar = car.id; game.persist(); audio.click();
          game.refreshTopbar(); game.garage.refresh(); openShop(game);
        } else {
          if (game.spend(car.gems ? { gems: car.gems } : { coins: car.coins })) {
            save.ownedCars.push(car.id);
            save.selectedCar = car.id;
            game.persist(); audio.buy();
            game.refreshTopbar(); game.garage.refresh(); openShop(game);
            game.toast(`🎉 You bought <b>${car.name}</b>!`);
          } else { audio.deny(); game.toast('Not enough ' + (car.gems ? 'gems 💎' : 'coins 🪙') + '! Race to earn more.', true); }
        }
      };
      card.appendChild(btn);
      grid.appendChild(card);
    }
  } else {
    for (const d of DRIVERS) {
      const owned = save.ownedDrivers.includes(d.id);
      const card = document.createElement('div');
      card.className = 'card driver' + (save.selectedDriver === d.id ? ' sel' : '');
      const cv = document.createElement('canvas');
      cv.width = 84; cv.height = 84; cv.className = 'thumb round';
      drawDriverThumb(cv, d);
      card.appendChild(cv);
      card.insertAdjacentHTML('beforeend', `<div class="cname">${d.name}</div>`);
      const btn = document.createElement('button');
      btn.className = 'cbtn ' + (owned ? 'owned' : d.gems ? 'gems' : 'coins');
      if (save.selectedDriver === d.id) { btn.textContent = '✔ SELECTED'; btn.disabled = true; }
      else if (owned) btn.textContent = 'SELECT';
      else btn.innerHTML = d.gems ? `BUY 💎 ${fmt(d.gems)}` : `BUY 🪙 ${fmt(d.coins)}`;
      btn.onclick = () => {
        if (owned) {
          save.selectedDriver = d.id; game.persist(); audio.click();
          game.refreshTopbar(); game.garage.refresh(); openShop(game);
        } else if (game.spend(d.gems ? { gems: d.gems } : { coins: d.coins })) {
          save.ownedDrivers.push(d.id);
          save.selectedDriver = d.id;
          game.persist(); audio.buy();
          game.refreshTopbar(); game.garage.refresh(); openShop(game);
          game.toast(`🎉 <b>${d.name}</b> joined your team!`);
        } else { audio.deny(); game.toast('Not enough ' + (d.gems ? 'gems 💎' : 'coins 🪙') + '!', true); }
      };
      card.appendChild(btn);
      grid.appendChild(card);
    }
  }
}

export function openCustomize(game) {
  audio.click();
  openPanel('🎨 CUSTOMIZE');
  const save = game.save;
  const car = carById(save.selectedCar);
  const body = $('panelBody');
  const current = save.paints[car.id] || car.paint;

  let html = `<div class="custTitle">Paint — <b>${car.name}</b></div><div class="swatches" id="swPaints">`;
  PAINTS.forEach((p, i) => {
    const owned = save.ownedPaints.includes(i);
    const sel = current.toLowerCase() === p.c.toLowerCase();
    html += `<button class="sw ${sel ? 'sel' : ''}" data-i="${i}" style="background:${p.c}">
      ${owned ? (sel ? '✔' : '') : `<i>🪙${p.price}</i>`}</button>`;
  });
  html += `</div><div class="custTitle">Wheels</div><div class="swatches" id="swWheels">`;
  WHEELS.forEach((c) => {
    html += `<button class="sw ${save.wheelColor === c ? 'sel' : ''}" data-c="${c}" style="background:${c}">${save.wheelColor === c ? '✔' : ''}</button>`;
  });
  html += `</div><div class="custTitle">Horn</div><div class="horns" id="hornList">`;
  HORNS.forEach((h, i) => {
    const owned = save.ownedHorns.includes(i);
    html += `<button class="horn ${save.horn === i ? 'sel' : ''}" data-i="${i}">
      ${save.horn === i ? '📢 ' : ''}${h.n}${owned ? '' : ` <i>🪙${h.price}</i>`}</button>`;
  });
  html += `</div><div class="hint">Paints & parts are cosmetic — win races to unlock more! 🏁</div>`;
  body.innerHTML = html;

  body.querySelectorAll('#swPaints .sw').forEach((b) => {
    b.onclick = () => {
      const i = +b.dataset.i, p = PAINTS[i];
      if (!save.ownedPaints.includes(i)) {
        if (!game.spend({ coins: p.price })) { audio.deny(); game.toast('Not enough coins!', true); return; }
        save.ownedPaints.push(i);
        audio.buy();
      } else audio.click();
      save.paints[car.id] = p.c;
      game.persist(); game.refreshTopbar(); game.garage.refresh(); openCustomize(game);
    };
  });
  body.querySelectorAll('#swWheels .sw').forEach((b) => {
    b.onclick = () => {
      save.wheelColor = b.dataset.c;
      game.persist(); audio.click(); game.garage.refresh(); openCustomize(game);
    };
  });
  body.querySelectorAll('#hornList .horn').forEach((b) => {
    b.onclick = () => {
      const i = +b.dataset.i;
      if (!save.ownedHorns.includes(i)) {
        if (!game.spend({ coins: HORNS[i].price })) { audio.deny(); game.toast('Not enough coins!', true); return; }
        save.ownedHorns.push(i); audio.buy();
      }
      save.horn = i;
      game.persist(); game.refreshTopbar(); audio.horn(i); openCustomize(game);
    };
  });
}

export function openUpgrades(game) {
  audio.click();
  openPanel('🔧 UPGRADES');
  const save = game.save;
  const car = carById(save.selectedCar);
  const upg = game.getUpgrades(car.id);
  let html = `<div class="custTitle">Tuning — <b>${car.name}</b></div>`;
  for (const key of ['spd', 'acc', 'hnd']) {
    const meta = UPGRADES.meta[key];
    const lvl = upg[key];
    const pips = Array.from({ length: UPGRADES.max }, (_, i) => `<span class="pip ${i < lvl ? 'on' : ''}"></span>`).join('');
    const cost = lvl >= UPGRADES.max ? null : UPGRADES.cost(lvl);
    html += `<div class="upgRow">
      <div class="upgHead">${meta.icon} ${meta.label} <span class="upgBonus">+${lvl * 4}%</span></div>
      <div class="pips">${pips}</div>
      <button class="cbtn coins" data-k="${key}" ${cost === null ? 'disabled' : ''}>
        ${cost === null ? 'MAX 🔥' : `UPGRADE 🪙 ${fmt(cost)}`}</button>
    </div>`;
  }
  html += `<div class="hint">Upgrades apply to <b>${car.name}</b> only. Each car upgrades separately.</div>`;
  $('panelBody').innerHTML = html;
  $('panelBody').querySelectorAll('.cbtn').forEach((b) => {
    b.onclick = () => {
      const key = b.dataset.k;
      const u = game.getUpgrades(car.id);
      const cost = UPGRADES.cost(u[key]);
      if (u[key] >= UPGRADES.max) return;
      if (!game.spend({ coins: cost })) { audio.deny(); game.toast('Not enough coins!', true); return; }
      u[key]++;
      if (!save.upgrades[car.id]) save.upgrades[car.id] = u;
      game.persist(); audio.buy(); game.refreshTopbar(); openUpgrades(game);
    };
  });
}

export function openSeries(game) {
  audio.click();
  openPanel('🏆 CHAMPIONSHIP');
  const save = game.save;
  const st = game.getStandings();
  const rows = Object.entries(st)
    .map(([name, pts]) => ({ name, pts, player: name === 'YOU' }))
    .sort((a, b) => b.pts - a.pts);
  const medals = ['🥇', '🥈', '🥉'];
  let html = `<div class="custTitle">Season ${save.seasonNum} — Race ${save.seasonRace}/10</div><table class="stable">`;
  rows.forEach((r, i) => {
    html += `<tr class="${r.player ? 'me' : ''}"><td>${medals[i] || (i + 1) + 'th'}</td><td>${r.name}</td><td><b>${r.pts}</b> pts</td></tr>`;
  });
  html += `</table><div class="hint">Points per race: 10 / 8 / 6 / 4 / 2 / 1. After 10 races the champion wins
    🪙${fmt(1500)} + 💎6 + 🏆×3!</div>`;
  $('panelBody').innerHTML = html;
}

export function openHelp(game) {
  audio.click();
  openPanel('❓ HOW TO PLAY');
  $('panelBody').innerHTML = `
  <div class="help">
    <p>🏁 <b>Race</b> against 5 rivals on <b>50 random tracks</b> — beaches, jungles, volcanoes, and more!</p>
    <p>🥇🥈🥉 Finish <b>1st–3rd</b> for big coins and 💎 gems. Every place pays something.</p>
    <p><b>Controls</b><br>
      🕹️ <kbd>W A S D</kbd> / <kbd>← ↑ ↓ →</kbd> — drive<br>
      <kbd>SPACE</kbd> — use power-up · <kbd>R</kbd> — reset on track · <kbd>H</kbd> — horn · <kbd>ESC</kbd> — pause</p>
    <p>📦 Grab <b>?</b> boxes: 🔥 Turbo Boost · 🚀 Homing Rocket · 🛡️ Bubble Shield</p>
    <p>🪙 Collect coins <b>on the track</b> for bonus cash, win races, and buy all <b>50 cars</b> and <b>16 drivers</b>!</p>
    <p>🏆 Championship points (10/8/6/4/2/1) decide the <b>Season Champion</b> after 10 races.</p>
  </div>`;
}

// ══════════════════════════ RESULTS ═════════════════════════════════════════

export function showResults(game, res, onAgain) {
  const win = res.place === 1;
  const podium = res.place <= 3;
  const medals = ['🥇', '🥈', '🥉', '4th', '5th', '6th'];
  const m = $('results');
  const title = win ? '🏆 VICTORY!' : podium ? `${medals[res.place - 1]} PODIUM!` : `${medals[res.place - 1]} Place`;
  let rows = '';
  res.order.forEach((k, i) => {
    rows += `<div class="rrow ${k.isPlayer ? 'me' : ''}">
      <span class="rmedal">${medals[i]}</span>
      <span class="remoji">${k.emoji}</span>
      <span class="rname">${k.isPlayer ? k.name + ' (YOU)' : k.name}</span>
      <span class="rpts">+${[10, 8, 6, 4, 2, 1][i]} pts</span></div>`;
  });
  $('resultsBody').innerHTML = `
    <div class="rtitle ${win ? 'win' : podium ? 'pod' : ''}">${title}</div>
    <div class="rmap">${res.map.name} · ${res.time.toFixed(1)}s</div>
    <div class="rrows">${rows}</div>
    <div class="rewards">
      <div class="rew"><span>🪙</span><b>+${fmt(res.coins)}</b></div>
      ${res.raceCoins ? `<div class="rew sub">track coins +${res.raceCoins}</div>` : ''}
      ${res.gems ? `<div class="rew"><span>💎</span><b>+${res.gems}</b></div>` : ''}
      ${res.trophy ? `<div class="rew"><span>🏆</span><b>+1</b></div>` : ''}
    </div>
    <div class="rbtns">
      <button id="btnAgain" class="big race">🏁 RACE AGAIN</button>
      <button id="btnToGarage" class="big ghost">🏠 GARAGE</button>
    </div>`;
  m.classList.add('open');
  if (podium) launchConfetti(win ? 90 : 40);
  $('btnAgain').onclick = () => { m.classList.remove('open'); audio.click(); onAgain(); };
  $('btnToGarage').onclick = () => { m.classList.remove('open'); audio.click(); game.showGarage(); };
}

export function showChampion(game, standings, seasonNum, champReward) {
  const rows = Object.entries(standings).sort((a, b) => b[1] - a[1]);
  const champ = rows[0];
  const isPlayer = champ[0] === 'YOU';
  const medals = ['🥇', '🥈', '🥉'];
  let tableRows = '';
  rows.forEach(([name, pts], i) => {
    tableRows += `<div class="rrow ${name === 'YOU' ? 'me' : ''}">
      <span class="rmedal">${medals[i] || (i + 1) + 'th'}</span><span class="rname">${name}</span><span class="rpts">${pts} pts</span></div>`;
  });
  const m = $('seasonModal');
  $('seasonBody').innerHTML = `
    <div class="rtitle win">${isPlayer ? '👑 SEASON CHAMPION!' : `🏁 SEASON ${seasonNum} OVER`}</div>
    <div class="rmap">${isPlayer ? 'You are the champion of Season ' + seasonNum + '!' : champ[0] + ' wins Season ' + seasonNum + '!'}</div>
    <div class="rrows">${tableRows}</div>
    ${isPlayer ? `<div class="rewards">
      <div class="rew"><span>🪙</span><b>+${fmt(champReward.coins)}</b></div>
      <div class="rew"><span>💎</span><b>+${champReward.gems}</b></div>
      <div class="rew"><span>🏆</span><b>+${champReward.trophies}</b></div></div>` : ''}
    <div class="rbtns"><button id="btnSeasonOk" class="big race">▶ START SEASON ${seasonNum + 1}</button></div>`;
  m.classList.add('open');
  if (isPlayer) launchConfetti(140);
  $('btnSeasonOk').onclick = () => { m.classList.remove('open'); audio.click(); game.showGarage(); };
}

function launchConfetti(n) {
  const wrap = $('confetti');
  const em = ['🎉', '⭐', '🏁', '🪙', '✨', '🎊'];
  for (let i = 0; i < n; i++) {
    const s = document.createElement('span');
    s.textContent = em[(Math.random() * em.length) | 0];
    s.style.left = Math.random() * 100 + 'vw';
    s.style.animationDelay = Math.random() * 2.2 + 's';
    s.style.fontSize = 14 + Math.random() * 22 + 'px';
    wrap.appendChild(s);
  }
  setTimeout(() => { wrap.innerHTML = ''; }, 6500);
}
