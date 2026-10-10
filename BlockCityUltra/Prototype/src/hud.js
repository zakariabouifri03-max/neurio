// BLOCK CITY ULTRA — HUD, minimap and GPS (browser vertical slice)
// The minimap is drawn from the road graph directly into a 2D canvas: no extra
// render pass, no top-down camera capture (mirrors the engine's approach).

import { clamp } from './util.js';

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor(roads, layout) {
    this.roads = roads;
    this.layout = layout;
    this.canvas = $('minimap');
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
    this.range = 240;             // metres across
    this.rotate = true;

    this.el = {
      speed: $('speed'),
      gear: $('gear'),
      rpmBar: $('rpmbar'),
      stars: $('stars'),
      heat: $('heatbar'),
      mission: $('mission'),
      objective: $('objective'),
      clock: $('clock'),
      weather: $('weather'),
      credits: $('credits'),
      dist: $('dist'),
      toast: $('toast'),
      fps: $('fps'),
      stats: $('stats'),
      dmgBar: $('dmgbar'),
      fuelBar: $('fuelbar'),
    };

    this._buildStatic();
    this._toastTimer = 0;
  }

  _buildStatic() {
    if (!this.ctx) return;
    // Pre-project the road graph once: redrawing hundreds of segments per frame
    // is the classic way to waste a millisecond.
    this.base = document.createElement('canvas');
    this.base.width = this.canvas.width;
    this.base.height = this.canvas.height;
    const g = this.base.getContext('2d');
    const size = this.base.width;
    const scale = size / (this.range * 2);

    g.fillStyle = 'rgba(10,14,22,0.82)';
    g.fillRect(0, 0, size, size);

    g.strokeStyle = 'rgba(150,170,200,0.30)';
    g.lineWidth = Math.max(1, this.roads.road * scale * 0.55);
    g.beginPath();
    for (const s of this.roads.segs) {
      g.moveTo(size / 2 + (s.a.x - 0) * scale, size / 2 + (s.a.z - 0) * scale);
      g.lineTo(size / 2 + (s.b.x - 0) * scale, size / 2 + (s.b.z - 0) * scale);
    }
    g.stroke();

    g.strokeStyle = 'rgba(190,210,240,0.55)';
    g.lineWidth = Math.max(1, this.roads.road * scale * 0.22);
    g.stroke();
  }

  toast(title, body, secs = 4) {
    if (!this.el.toast) return;
    this.el.toast.innerHTML = `<strong>${title}</strong><br><span>${body}</span>`;
    this.el.toast.classList.add('show');
    this._toastTimer = secs;
  }

  update(dt, s) {
    if (this._toastTimer > 0) {
      this._toastTimer -= dt;
      if (this._toastTimer <= 0 && this.el.toast) this.el.toast.classList.remove('show');
    }

    if (this.el.speed) this.el.speed.textContent = Math.round(s.kph);
    if (this.el.gear) this.el.gear.textContent = s.inVehicle ? `G${s.gear}` : '—';
    if (this.el.rpmBar) this.el.rpmBar.style.width = `${clamp(s.rpm / 7000, 0, 1) * 100}%`;
    if (this.el.dmgBar) this.el.dmgBar.style.width = `${s.damage * 100}%`;
    if (this.el.fuelBar) this.el.fuelBar.style.width = `${s.fuel * 100}%`;
    if (this.el.stars) this.el.stars.textContent = s.wanted.stars;
    if (this.el.heat) this.el.heat.style.width = `${s.wanted.heat}%`;
    if (this.el.clock) this.el.clock.textContent = s.clock;
    if (this.el.weather) this.el.weather.textContent = s.weather;
    if (this.el.credits) this.el.credits.textContent = `§${s.credits.toLocaleString('en-US')}`;
    if (this.el.dist) this.el.dist.textContent = s.routeLength > 0 ? `${Math.round(s.routeLength)} m` : '';

    if (this.el.mission) this.el.mission.textContent = s.missionTitle || '';
    if (this.el.objective) {
      this.el.objective.textContent = s.objective ? `${s.objective.title}` : '';
      this.el.objective.style.opacity = s.objective ? '1' : '0.35';
    }

    if (this.el.fps) this.el.fps.textContent = `${Math.round(s.fps)} FPS`;
    if (this.el.stats && s.showStats) {
      this.el.stats.style.display = 'block';
      this.el.stats.innerHTML = `
        <div><b>BLOCK CITY ULTRA</b> — ${s.preset}</div>
        <div>frame ${s.frameMs.toFixed(2)} ms · 1% low ${s.worst.toFixed(1)} ms</div>
        <div>draws ${s.drawCalls} · tris ${(s.tris / 1000).toFixed(0)}k</div>
        <div>voxel boxes ${s.boxes.toLocaleString('en-US')} · buildings ${s.buildings}</div>
        <div>traffic ${s.trafficSimulated} sim / ${s.trafficGhosts} ghost</div>
        <div>peds ${s.peds} · police ${s.policeUnits} (${s.policePursuing} pursuing)</div>
        <div>res ${s.res} · ${s.gpu}</div>`;
    } else if (this.el.stats) {
      this.el.stats.style.display = 'none';
    }

    this._drawMinimap(s);
  }

  _drawMinimap(s) {
    const ctx = this.ctx;
    if (!ctx || !this.base) return;
    const size = this.canvas.width;
    const half = size * 0.5;
    const scale = size / (this.range * 2);

    ctx.clearRect(0, 0, size, size);

    // static road layer, rotated to follow heading
    ctx.save();
    ctx.beginPath();
    ctx.arc(half, half, half, 0, Math.PI * 2);
    ctx.clip();
    ctx.translate(half, half);
    if (this.rotate) ctx.rotate(-s.heading);
    ctx.translate(-half, -half);
    ctx.drawImage(this.base,
      half - s.player.x * scale, half - s.player.y * scale,
      size, size);
    ctx.restore();

    // helper: world -> minimap in the rotated frame
    const toMap = (wx, wz) => {
      let dx = (wx - s.player.x) * scale;
      let dy = (wz - s.player.y) * scale;
      if (this.rotate) {
        const c = Math.cos(-s.heading), sn = Math.sin(-s.heading);
        const rx = dx * c - dy * sn;
        const ry = dx * sn + dy * c;
        dx = rx; dy = ry;
      }
      return [half + dx, half + dy];
    };

    // GPS route
    if (s.route && s.route.length > 1) {
      ctx.strokeStyle = 'rgba(70,170,255,0.95)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let i = 0; i < Math.min(s.route.length, 60); i++) {
        const [px, py] = toMap(s.route[i].x, s.route[i].z);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }

    // mission marker
    if (s.missionLoc) {
      const [px, py] = toMap(s.missionLoc.x, s.missionLoc.z);
      ctx.save();
      ctx.translate(px, py);
      ctx.fillStyle = '#ffd24a';
      ctx.beginPath();
      ctx.moveTo(0, -8); ctx.lineTo(6, 6); ctx.lineTo(-6, 6); ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // police
    for (const p of s.police) {
      const [px, py] = toMap(p.x, p.z);
      ctx.fillStyle = p.chasing ? '#ff4d4d' : '#6fa8ff';
      ctx.beginPath();
      ctx.arc(px, py, 3.4, 0, Math.PI * 2);
      ctx.fill();
    }

    // traffic (nearby only)
    ctx.fillStyle = 'rgba(200,210,230,0.55)';
    for (const t of s.trafficNear) {
      const [px, py] = toMap(t.x, t.z);
      ctx.fillRect(px - 1.2, py - 1.2, 2.4, 2.4);
    }

    // player arrow
    ctx.save();
    ctx.translate(half, half);
    ctx.fillStyle = '#7dff9b';
    ctx.beginPath();
    ctx.moveTo(0, -9); ctx.lineTo(6, 7); ctx.lineTo(0, 3.5); ctx.lineTo(-6, 7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // north indicator
    if (this.rotate) {
      ctx.save();
      ctx.translate(half, half);
      ctx.rotate(-s.heading);
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('N', 0, -half + 12);
      ctx.restore();
    }
  }
}
