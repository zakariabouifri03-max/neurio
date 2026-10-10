// BLOCK CITY ULTRA — browser slice: HUD, minimap, map screen, toasts.
// Every number here comes from the simulation; the HUD owns no game logic.

import { DISTRICTS, WORLD_SIZE } from './config.js';
import { clamp, formatCash } from './util.js';

export class Hud {
  constructor(city) {
    this.city = city;
    this.el = {
      root: document.getElementById('hud'),
      district: document.getElementById('district'),
      clock: document.getElementById('clock'),
      cash: document.getElementById('cash'),
      wanted: document.getElementById('wanted'),
      weather: document.getElementById('weather'),
      objectiveLabel: document.getElementById('objective-label'),
      objectiveText: document.getElementById('objective-text'),
      objectiveDistance: document.getElementById('objective-distance'),
      minimap: document.getElementById('minimap'),
      speed: document.getElementById('speed-value'),
      unit: document.getElementById('speed-unit'),
      gear: document.getElementById('gear'),
      health: document.getElementById('health'),
      healthFill: document.getElementById('health-fill'),
      prompt: document.getElementById('prompt'),
      promptText: document.getElementById('prompt-text'),
      toasts: document.getElementById('toast-container'),
      loading: document.getElementById('loading'),
      loadingFill: document.getElementById('loading-fill'),
      loadingStage: document.getElementById('loading-stage'),
      map: document.getElementById('map'),
      mapCanvas: document.getElementById('map-canvas'),
      mapDistricts: document.getElementById('map-districts'),
      card: document.getElementById('card'),
      cardTitle: document.getElementById('card-title'),
      cardSub: document.getElementById('card-sub'),
      cardReward: document.getElementById('card-reward'),
      cardButton: document.getElementById('card-button'),
    };

    this.minimapCtx = this.el.minimap.getContext('2d');
    this.mapCtx = this.el.mapCanvas.getContext('2d');
    this.mapOpen = false;
    this.wantedLevel = 0;
    this.pursuit = false;
    this.#buildDistrictLegend();
  }

  show() { this.el.root.classList.remove('hidden'); }

  setLoading(fraction, stage) {
    this.el.loadingFill.style.width = `${clamp(fraction, 0, 1) * 100}%`;
    if (stage) this.el.loadingStage.textContent = stage;
  }
  hideLoading() { this.el.loading.classList.add('hidden'); }
  showLoading() { this.el.loading.classList.remove('hidden'); }

  // ── Toasts ────────────────────────────────────────────────────────────────
  toast(message, kind = '', life = 3.4) {
    const node = document.createElement('div');
    node.className = `toast ${kind}`;
    node.style.setProperty('--toast-life', `${life}s`);
    node.textContent = message;
    this.el.toasts.appendChild(node);
    setTimeout(() => node.remove(), (life + 0.6) * 1000);

    // Cap the stack so a long chase does not bury the screen.
    while (this.el.toasts.children.length > 4) this.el.toasts.firstChild.remove();
  }

  bark(text) { this.toast(`📻 ${text}`, '', 2.8); }

  // ── End card ──────────────────────────────────────────────────────────────
  showCard(title, sub, reward, kind = '') {
    this.el.cardTitle.textContent = title;
    this.el.cardTitle.className = kind === 'fail' ? 'fail' : '';
    this.el.cardSub.textContent = sub || '';
    this.el.cardReward.textContent = reward || '';
    this.el.card.classList.remove('hidden');
    document.exitPointerLock?.();
  }
  hideCard() { this.el.card.classList.add('hidden'); }
  onCardButton(fn) { this.el.cardButton.onclick = fn; }

  // ── Map screen ────────────────────────────────────────────────────────────
  toggleMap(force) {
    this.mapOpen = force !== undefined ? force : !this.mapOpen;
    this.el.map.classList.toggle('hidden', !this.mapOpen);
    if (this.mapOpen) { this.drawBigMap(); document.exitPointerLock?.(); }
  }

  #buildDistrictLegend() {
    this.el.mapDistricts.innerHTML = DISTRICTS.map(d =>
      `<span><i style="background:#${d.color.toString(16).padStart(6, '0')}"></i>${d.name}</span>`
    ).join('');
  }

  drawBigMap(playerPos, playerYaw, mission, police) {
    const ctx = this.mapCtx;
    const S = this.el.mapCanvas.width;
    const scale = S / WORLD_SIZE;
    const toMap = (x, z) => [(x + WORLD_SIZE / 2) * scale, (z + WORLD_SIZE / 2) * scale];

    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = '#070a10';
    ctx.fillRect(0, 0, S, S);

    // District blocks.
    for (const b of this.city.buildings) {
      const d = DISTRICTS[b.district];
      const [mx, mz] = toMap(b.x, b.z);
      const w = Math.max(1, b.w * scale), h = Math.max(1, b.d * scale);
      // Height drives brightness: the downtown core visibly glows on the map.
      const bright = clamp(0.22 + b.h / 260, 0.2, 0.9);
      ctx.fillStyle = this.#shade(d.color, bright);
      ctx.fillRect(mx, mz, w, h);
    }

    // Roads.
    ctx.strokeStyle = 'rgba(150,170,200,0.30)';
    ctx.lineWidth = 1.4;
    for (const r of this.city.roads) {
      ctx.beginPath();
      if (r.vertical) {
        const [x1, y1] = toMap(r.x, r.z1), [x2, y2] = toMap(r.x, r.z2);
        ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
      } else {
        const [x1, y1] = toMap(r.x1, r.z), [x2, y2] = toMap(r.x2, r.z);
        ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
      }
      ctx.stroke();
    }

    // River.
    ctx.strokeStyle = 'rgba(60,140,200,0.5)';
    ctx.lineWidth = 16 * scale;
    ctx.beginPath();
    const [rx1, ry1] = toMap(WORLD_SIZE / 2 - 44, -WORLD_SIZE / 2);
    const [rx2, ry2] = toMap(WORLD_SIZE / 2 - 44, WORLD_SIZE / 2);
    ctx.moveTo(rx1, ry1); ctx.lineTo(rx2, ry2); ctx.stroke();

    // Mission marker.
    if (mission?.target) {
      const [mx, mz] = toMap(mission.target.x, mission.target.z);
      ctx.fillStyle = '#ffc93c';
      ctx.beginPath();
      ctx.moveTo(mx, mz - 9); ctx.lineTo(mx + 7, mz + 5); ctx.lineTo(mx - 7, mz + 5);
      ctx.closePath(); ctx.fill();
    }

    // Police.
    if (police) {
      ctx.fillStyle = '#ff3b30';
      for (const p of police.pursuerLocations) {
        const [mx, mz] = toMap(p.x, p.z);
        ctx.beginPath(); ctx.arc(mx, mz, 4.5, 0, Math.PI * 2); ctx.fill();
      }
    }

    // Player arrow.
    if (playerPos) {
      const [mx, mz] = toMap(playerPos.x, playerPos.z);
      ctx.save();
      ctx.translate(mx, mz);
      ctx.rotate(-(playerYaw || 0));
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(0, -10); ctx.lineTo(7, 8); ctx.lineTo(0, 4); ctx.lineTo(-7, 8);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }

  #shade(hex, factor) {
    const r = Math.round(((hex >> 16) & 255) * factor);
    const g = Math.round(((hex >> 8) & 255) * factor);
    const b = Math.round((hex & 255) * factor);
    return `rgb(${clamp(r, 0, 255)},${clamp(g, 0, 255)},${clamp(b, 0, 255)})`;
  }

  // ── Minimap ───────────────────────────────────────────────────────────────
  drawMinimap(playerPos, playerYaw, mission, police, extent = 130) {
    const ctx = this.minimapCtx;
    const S = this.el.minimap.width;
    const R = S / 2;

    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath();
    ctx.arc(R, R, R - 2, 0, Math.PI * 2);
    ctx.clip();

    ctx.fillStyle = '#0a0e16';
    ctx.fillRect(0, 0, S, S);

    const scale = (R - 4) / extent;
    const cos = Math.cos(-playerYaw), sin = Math.sin(-playerYaw);

    // Rotate world points into player space so "up" is always ahead.
    const project = (x, z) => {
      const dx = x - playerPos.x, dz = z - playerPos.z;
      return [R + (dx * cos - dz * sin) * scale, R + (dx * sin + dz * cos) * scale];
    };

    // Buildings.
    for (const b of this.city.buildings) {
      const dx = b.x + b.w / 2 - playerPos.x, dz = b.z + b.d / 2 - playerPos.z;
      if (Math.abs(dx) > extent * 1.4 || Math.abs(dz) > extent * 1.4) continue;

      const [mx, mz] = project(b.x, b.z);
      const [mx2, mz2] = project(b.x + b.w, b.z);
      const [mx3, mz3] = project(b.x + b.w, b.z + b.d);
      const [mx4, mz4] = project(b.x, b.z + b.d);

      ctx.fillStyle = this.#shade(DISTRICTS[b.district].color, clamp(0.3 + b.h / 300, 0.28, 0.95));
      ctx.beginPath();
      ctx.moveTo(mx, mz); ctx.lineTo(mx2, mz2); ctx.lineTo(mx3, mz3); ctx.lineTo(mx4, mz4);
      ctx.closePath(); ctx.fill();
    }

    // Roads.
    ctx.strokeStyle = 'rgba(160,180,210,0.34)';
    ctx.lineWidth = 2.1;
    for (const r of this.city.roads) {
      ctx.beginPath();
      if (r.vertical) {
        const [x1, y1] = project(r.x, r.z1), [x2, y2] = project(r.x, r.z2);
        ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
      } else {
        const [x1, y1] = project(r.x1, r.z), [x2, y2] = project(r.x2, r.z);
        ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
      }
      ctx.stroke();
    }

    // Traffic.
    ctx.fillStyle = 'rgba(200,215,235,0.35)';
    for (const v of window.__bcuTraffic?.vehicles || []) {
      const dx = v.position.x - playerPos.x, dz = v.position.z - playerPos.z;
      if (Math.abs(dx) > extent || Math.abs(dz) > extent) continue;
      const [mx, mz] = project(v.position.x, v.position.z);
      ctx.fillRect(mx - 1.5, mz - 1.5, 3, 3);
    }

    // Police blips.
    if (police && police.wantedLevel > 0) {
      ctx.fillStyle = '#ff3b30';
      for (const p of police.pursuerLocations) {
        const dx = p.x - playerPos.x, dz = p.z - playerPos.z;
        if (Math.abs(dx) > extent || Math.abs(dz) > extent) continue;
        const [mx, mz] = project(p.x, p.z);
        ctx.beginPath(); ctx.arc(mx, mz, 4, 0, Math.PI * 2); ctx.fill();
      }
    }

    // GPS route.
    if (mission?.target) {
      const [tx, tz] = project(mission.target.x, mission.target.z);
      ctx.strokeStyle = 'rgba(255,201,60,0.85)';
      ctx.lineWidth = 3;
      ctx.setLineDash([6, 5]);
      ctx.beginPath(); ctx.moveTo(R, R); ctx.lineTo(tx, tz); ctx.stroke();
      ctx.setLineDash([]);

      // Clamp the marker to the rim when the target is off-map.
      const d = Math.hypot(tx - R, tz - R);
      const maxR = R - 12;
      const cx = d > maxR ? R + (tx - R) / d * maxR : tx;
      const cy = d > maxR ? R + (tz - R) / d * maxR : tz;

      ctx.fillStyle = '#ffc93c';
      ctx.beginPath();
      ctx.moveTo(cx, cy - 7); ctx.lineTo(cx + 5.5, cy + 4); ctx.lineTo(cx - 5.5, cy + 4);
      ctx.closePath(); ctx.fill();
    }

    // Player arrow, always centred.
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(R, R - 8); ctx.lineTo(R + 5.5, R + 6); ctx.lineTo(R, R + 3); ctx.lineTo(R - 5.5, R + 6);
    ctx.closePath(); ctx.fill();

    ctx.restore();

    // Rim.
    ctx.strokeStyle = 'rgba(140,165,200,0.22)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(R, R, R - 2, 0, Math.PI * 2); ctx.stroke();
  }

  // ── Per-frame readouts ────────────────────────────────────────────────────
  update(state) {
    const { player, mission, police, timeOfDay, weather, cash, health, prompt, district } = state;

    this.el.district.textContent = district;
    this.el.clock.textContent = this.#clockText(timeOfDay);
    this.el.cash.textContent = formatCash(cash);
    this.el.weather.textContent = weather;

    // Wanted stars.
    if (this.wantedLevel !== police.wantedLevel) {
      this.wantedLevel = police.wantedLevel;
      const spans = this.el.wanted.querySelectorAll('span');
      spans.forEach((s, i) => s.classList.toggle('on', i < this.wantedLevel));
      this.el.wanted.classList.toggle('pulse', this.wantedLevel >= 3);
    }

    // Objective.
    const obj = mission.currentObjective;
    if (obj) {
      this.el.objectiveText.innerHTML = obj.text
        + (obj.count > 1 ? ` <b>(${mission.progress}/${obj.count})</b>` : '');
      const d = mission.distanceToTarget;
      this.el.objectiveDistance.textContent = d >= 0
        ? `${d < 1 ? Math.round(d * 100) + ' m' : (d / 1000).toFixed(2) + ' km'}`
          + (obj.timeLimit ? `  ·  ${Math.max(0, Math.ceil(obj.timeLimit - mission.objectiveElapsed))}s` : '')
        : '';
      this.el.objectiveLabel.textContent = `OBJECTIVE ${mission.objectiveIndex + 1}/${mission.objectiveCount} — ${mission.active.title}`;
    } else {
      this.el.objectiveText.innerHTML = mission.nextMission
        ? `Find work. <b>${mission.nextMission.giver}</b> has a job in ${mission.nextMission.district}.`
        : 'No work left in the city. Drive.';
      this.el.objectiveLabel.textContent = 'OBJECTIVE';
      this.el.objectiveDistance.textContent = '';
    }

    // Speedo.
    const driving = player.isDriving;
    this.el.speed.textContent = Math.round(player.speedKmh);
    this.el.unit.textContent = 'km/h';
    this.el.gear.textContent = driving
      ? (player.vehicle.speed < -0.5 ? 'R' : (player.vehicle.speedKmh < 1 ? 'N' : player.vehicle.gear + 1))
      : '—';

    // Health.
    const frac = clamp(health / 100, 0, 1);
    this.el.healthFill.style.width = `${frac * 100}%`;
    this.el.health.classList.toggle('low', frac < 0.35);

    // Interaction prompt.
    if (prompt) {
      this.el.prompt.classList.remove('hidden');
      this.el.promptText.textContent = prompt;
    } else {
      this.el.prompt.classList.add('hidden');
    }
  }

  #clockText(t) {
    const hours = (t * 24) % 24;
    const h = Math.floor(hours);
    const m = Math.floor((hours - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
}
