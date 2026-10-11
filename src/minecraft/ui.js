// ═══════════════════════════════════════════════════════════════════════════
//  UI CONTROLLER — binds every control in minecraft.html to the viewer:
//  time of day, camera modes, world toggles, quality, seed, screenshot, GLB
//  export, live stats, toast messages and the block inspector.
// ═══════════════════════════════════════════════════════════════════════════
import { PALETTE } from './textures.js';

const $ = (id) => document.getElementById(id);
const fmtTime = (h) => {
  const hh = Math.floor(h) % 24, mm = Math.floor((h - Math.floor(h)) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
};

export class UI {
  constructor(app) {
    this.app = app;
    app.ui = this;
    this.panel = $('panel');
    this.toastEl = $('toast');
    this._toastT = 0;
    this._shotLabel = 'Establishing';
    this.bind();
  }

  bind() {
    const app = this.app;

    // panel collapse
    $('panelToggle').addEventListener('click', () => {
      this.panel.classList.toggle('closed');
      app.audio.init(); app.audio.click(720);
    });

    // ── time ───────────────────────────────────────────────────────────────
    const time = $('time');
    time.addEventListener('input', () => {
      app.sky.playing = false;
      app.sky.setTime(parseFloat(time.value));
      this.syncTime();
      $('timePlay').classList.remove('on');
      $('timePlay').textContent = '▶ Cycle';
    });
    $('timePlay').addEventListener('click', () => {
      app.sky.playing = !app.sky.playing;
      $('timePlay').classList.toggle('on', app.sky.playing);
      $('timePlay').textContent = app.sky.playing ? '⏸ Pause' : '▶ Cycle';
      app.audio.init(); app.audio.click(app.sky.playing ? 980 : 620);
    });
    $('speed').addEventListener('input', (e) => { app.sky.speed = parseFloat(e.target.value); $('speedVal').textContent = e.target.value + '×'; });
    for (const b of document.querySelectorAll('[data-hour]')) {
      b.addEventListener('click', () => { this.setTime(parseFloat(b.dataset.hour)); app.audio.init(); app.audio.click(880); });
    }

    // ── camera ─────────────────────────────────────────────────────────────
    for (const b of document.querySelectorAll('[data-mode]')) {
      b.addEventListener('click', () => { app.setMode(b.dataset.mode); app.audio.init(); app.audio.click(660); });
    }
    for (const b of document.querySelectorAll('[data-focus]')) {
      b.addEventListener('click', () => {
        const sp = app.E.spawn[b.dataset.focus];
        if (!sp) return this.toast('Not in this world');
        app.setMode('orbit');
        app.focusOn({ x: sp.x, y: sp.y + 1, z: sp.z }, b.dataset.focus === 'tower' ? 26 : 18);
        app.audio.init(); app.audio.click(940);
      });
    }
    $('autoRotate').addEventListener('change', (e) => { app.autoRotate = e.target.checked; });

    // ── world toggles ──────────────────────────────────────────────────────
    const tog = (id, fn) => {
      const e = $(id);
      e.addEventListener('change', () => { fn(e.checked); e.parentElement.classList.toggle('off', !e.checked); });
    };
    tog('shadows', (v) => app.setShadows(v));
    tog('bloom', (v) => app.setBloom(v));
    tog('clouds', (v) => app.sky.clouds.visible = v);
    tog('grass', (v) => app.setFoliage(v));
    tog('mobs', (v) => app.mobs.setVisible(v));
    tog('chars', (v) => { for (const c of app.chars) c.obj.visible = v; });
    tog('water', (v) => { app.ocean.setVisible(v); });
    tog('wire', (v) => app.setWireframe(v));
    tog('audio', (v) => { app.audio.init(); app.audio.setMuted(!v); });
    tog('pause', (v) => { app.paused = v; });

    // ── quality + seed ─────────────────────────────────────────────────────
    $('quality').addEventListener('change', (e) => { app.setQuality(e.target.value); this.toast('Quality → ' + e.target.value); });
    $('seedBtn').addEventListener('click', () => this.regenerate());
    $('seed').addEventListener('keydown', (e) => { if (e.key === 'Enter') this.regenerate(); });

    // ── export ─────────────────────────────────────────────────────────────
    $('shotBtn').addEventListener('click', () => { app.audio.click(1200); app.screenshot(); });
    $('exportBtn').addEventListener('click', async (e) => {
      const b = e.currentTarget;
      b.disabled = true; b.textContent = 'Exporting…';
      app.audio.click(520);
      try { await app.exportGLB($('exportWhat').value); }
      catch (err) { console.error(err); this.toast('Export failed: ' + err.message); }
      b.disabled = false; b.textContent = '⬇ Export .glb';
    });

    // ── help ───────────────────────────────────────────────────────────────
    $('helpBtn').addEventListener('click', () => this.toggleHelp());
    $('helpClose').addEventListener('click', () => this.toggleHelp(false));
    $('help').addEventListener('click', (e) => { if (e.target.id === 'help') this.toggleHelp(false); });

    // ── block inspector (click the world) ──────────────────────────────────
    const cv = app.canvas;
    let down = null;
    cv.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
    cv.addEventListener('pointerup', (e) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const dt = performance.now() - down.t;
      down = null;
      if (moved > 6 || dt > 420 || app.mode !== 'orbit') return;
      const hit = app.pick(e.clientX, e.clientY);
      if (!hit) return this.setBlock(null);
      const p = PALETTE[hit.id];
      this.setBlock({ name: p.name, x: hit.x, y: hit.y, z: hit.z });
      app.audio.init(); app.audio.click(1400);
      // gently frame the block we just clicked
      app.focusOn({ x: hit.x + 0.5, y: hit.y + 0.5, z: hit.z + 0.5 }, Math.max(9, app.orb.dist * 0.6));
    });
  }

  setBlock(info) {
    const e = $('blockInfo');
    if (!info) { e.classList.remove('show'); return; }
    e.classList.add('show');
    $('blockName').textContent = info.name.replace(/_/g, ' ');
    $('blockPos').textContent = `${info.x} · ${info.y} · ${info.z}`;
  }

  click(id) {
    const e = $(id);
    if (!e) return;
    if (e.type === 'checkbox') { e.checked = !e.checked; e.dispatchEvent(new Event('change')); }
    else e.click();
  }

  setTime(h) {
    const app = this.app;
    app.sky.playing = false;
    app.sky.setTime(h);
    $('timePlay').classList.remove('on');
    $('timePlay').textContent = '▶ Cycle';
    this.syncTime();
  }

  syncTime() {
    const app = this.app;
    $('time').value = app.sky.hour.toFixed(2);
    $('timeVal').textContent = fmtTime(app.sky.hour);
  }

  toggleBloom() {
    const e = $('bloom');
    e.checked = !e.checked;
    e.dispatchEvent(new Event('change'));
  }

  toggleHelp(force) {
    const h = $('help');
    const show = force === undefined ? !h.classList.contains('show') : force;
    h.classList.toggle('show', show);
  }

  syncMode(m) {
    for (const b of document.querySelectorAll('[data-mode]')) b.classList.toggle('on', b.dataset.mode === m);
    $('fpHint').classList.toggle('show', m === 'fp');
    $('shotName').classList.toggle('show', m === 'cine');
  }

  setShot(label) {
    this._shotLabel = label;
    $('shotName').textContent = '🎬 ' + label;
  }

  regenerate() {
    const app = this.app;
    const raw = $('seed').value.trim();
    const seed = raw === '' ? (Math.random() * 1e9) | 0 : (isNaN(Number(raw)) ? hashStr(raw) : Number(raw) | 0);
    $('seed').value = seed;
    this.toast('🌱 Growing a new island…');
    $('loading').classList.remove('hidden');
    setTimeout(() => app.regenerate(seed).catch((e) => { console.error(e); this.toast('Generation failed'); $('loading').classList.add('hidden'); }), 60);
  }

  toast(msg) {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('show');
    this._toastT = 2.6;
  }

  tick(app) {
    // time readout follows the running clock
    if (app.sky.playing) {
      $('time').value = app.sky.hour.toFixed(2);
      $('timeVal').textContent = fmtTime(app.sky.hour);
    }
    if (this._toastT > 0) {
      this._toastT -= 1 / 60;
      if (this._toastT <= 0) this.toastEl.classList.remove('show');
    }
    // stats (throttled)
    this._st = (this._st || 0) + 1;
    if (this._st % 12 === 0) {
      const info = app.renderer.info;
      $('fps').textContent = Math.round(app.fps);
      $('calls').textContent = info.render.calls;
      $('tris').textContent = (info.render.triangles / 1000).toFixed(1) + 'k';
      $('blocks').textContent = (app.world.blockCount / 1000).toFixed(0) + 'k';
      $('chunks').textContent = app.world.stats.chunks;
      const h = app.sky.hour;
      $('phase').textContent = h < 4.5 ? '🌙 Night' : h < 6.5 ? '🌅 Dawn' : h < 11 ? '🌤 Morning' : h < 15 ? '☀️ Midday' : h < 17.5 ? '🌇 Afternoon' : h < 19.5 ? '🌆 Sunset' : h < 21 ? '🌃 Dusk' : '🌙 Night';
    }
  }

  setProgress(p, label) {
    $('barFill').style.width = (p * 100).toFixed(1) + '%';
    if (label) $('loadingLabel').textContent = label;
    if (p >= 1) setTimeout(() => $('loading').classList.add('hidden'), 420);
  }
}

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return Math.abs(h | 0);
}
