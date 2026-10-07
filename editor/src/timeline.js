// Montaj Pro — multi-track timeline
import { qs, qa, clamp, fmtTime, debounce, toast, isMobile } from './util.js';
import { getProject, projectDuration, trackClipsSorted, updateClip, moveClip, removeClip, addTrack, addClip, newClip, snapshot, emit, clipLocalAt, clipsOf } from './state.js';
import { clipTransform } from './effects.js';
import { getFilmstrip } from './media.js';

export class Timeline {
  constructor(app) {
    this.app = app;
    this.zoom = 90;              // px per second
    this.scroll = qs('#tl-scroll');
    this.ruler = qs('#tl-ruler');
    this.lanes = qs('#tl-lanes');
    this.heads = qs('#tl-head');
    this.drag = null;
    this.bind();
    this.render();
  }
  get project() { return getProject(); }
  pps() { return this.zoom; }
  timeToX(t) { return t * this.pps(); }
  xToTime(x) { return Math.max(0, x / this.pps()); }

  bind() {
    this.scroll.addEventListener('scroll', () => this.syncScroll());
    let pinch = null;
    this.scroll.addEventListener('wheel', (ev) => {
      if (ev.ctrlKey || ev.metaKey) {
        ev.preventDefault();
        this.setZoom(this.zoom * (ev.deltaY < 0 ? 1.12 : 0.89));
      } else if (ev.shiftKey) { this.scroll.scrollLeft += ev.deltaY; return; }
    }, { passive: false });
    this.scroll.addEventListener('touchstart', (ev) => {
      if (ev.touches.length === 2) {
        pinch = { d: Math.hypot(ev.touches[0].clientX - ev.touches[1].clientX, ev.touches[0].clientY - ev.touches[1].clientY), z: this.zoom };
      }
    }, { passive: true });
    this.scroll.addEventListener('touchmove', (ev) => {
      if (pinch && ev.touches.length === 2) {
        const d = Math.hypot(ev.touches[0].clientX - ev.touches[1].clientX, ev.touches[0].clientY - ev.touches[1].clientY);
        this.setZoom(pinch.z * (d / pinch.d));
      }
    }, { passive: true });
    this.scroll.addEventListener('touchend', () => { pinch = null; }, { passive: true });
    // tap the ruler to scrub
    const scrub = (ev) => {
      const r = this.ruler.getBoundingClientRect();
      const x = ev.clientX - r.left + this.scroll.scrollLeft;
      this.app.seek(this.xToTime(x));
    };
    this.ruler.addEventListener('pointerdown', (ev) => {
      scrub(ev);
      const move = (e2) => scrub(e2);
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
    window.addEventListener('keydown', (ev) => {
      if (ev.target.matches('input,textarea,[contenteditable]')) return;
      if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') {
        const d = ev.key === 'ArrowLeft' ? -1 : 1;
        this.app.seek(this.app.time + d / (getProject().settings.fps || 30), ev.shiftKey);
        ev.preventDefault();
      }
      if (ev.key === 'Home') this.app.seek(0);
      if (ev.key === 'End') this.app.seek(projectDuration(getProject()));
    });
  }
  setZoom(z) {
    const old = this.zoom;
    this.zoom = clamp(z, 6, 900);
    if (Math.abs(old - this.zoom) > 0.4) {
      const anchor = this.scroll.scrollLeft / old;
      this.render();
      this.scroll.scrollLeft = anchor * this.zoom;
    }
  }
  zoomIn() { this.setZoom(this.zoom * 1.25); }
  zoomOut() { this.setZoom(this.zoom / 1.25); }
  zoomFit() {
    const d = Math.max(4, projectDuration(this.project));
    this.setZoom(clamp((this.scroll.clientWidth - 40) / d, 6, 900));
    this.scroll.scrollLeft = 0;
  }
  syncScroll() {
    const x = this.app.time * this.pps() - this.scroll.clientWidth * 0.35;
    if (this.app.playing) {
      if (x > this.scroll.scrollLeft + this.scroll.clientWidth * 0.7) this.scroll.scrollLeft = x;
    }
  }
  // ---------------- render ----------------
  render() {
    const p = this.project;
    if (!p) return;
    const dur = Math.max(projectDuration(p), 6);
    const width = Math.max(dur * this.pps() + 240, this.scroll.clientWidth);
    this.lanes.innerHTML = '';
    this.renderRuler(width, dur);
    this.heads.style.width = width + 'px';

    this.renderHeaders();
    for (const track of p.tracks) {
      const row = document.createElement('div');
      row.className = 'tl-track tl-' + track.type;
      row.dataset.track = track.id;
      const clipsWrap = document.createElement('div');
      clipsWrap.className = 'tl-clips';
      clipsWrap.style.width = width + 'px';
      clipsWrap.dataset.track = track.id;
      this.bindLaneDnd(clipsWrap, track);
      const clips = trackClipsSorted(track.id);
      for (const clip of clips) clipsWrap.appendChild(this.clipEl(clip));
      row.appendChild(clipsWrap);
      this.lanes.appendChild(row);
    }
    this.updateHead();
  }
  renderHeaders() {
    const box = document.getElementById('tl-headers');
    if (!box) return;
    box.innerHTML = '';
    for (const track of this.project.tracks) {
      const row = document.createElement('div');
      row.className = 'trk-head';
      const nm = document.createElement('span');
      nm.className = 'name';
      nm.textContent = track.name || track.id.slice(-4);
      row.appendChild(nm);
      const mk = (icon, flag, title) => {
        const b = document.createElement('button');
        b.textContent = icon; b.title = title;
        b.classList.toggle('on', !!track[flag]);
        b.addEventListener('click', () => this.app.toggleTrackFlag(track.id, flag));
        return b;
      };
      row.appendChild(mk(track.type === 'audio' ? '🔊' : '👁', track.type === 'audio' ? 'muted' : 'hidden', 'إظهار/إخفاء'));
      row.appendChild(mk('🔒', 'locked', 'قفل'));
      const del = document.createElement('button');
      del.textContent = '🗑'; del.title = 'حذف المسار';
      del.addEventListener('click', () => { if (confirm('حذف المسار ومقاطعه؟')) this.app.removeTrack(track.id); });
      row.appendChild(del);
      box.appendChild(row);
    }
  }
  renderRuler(width, dur) {
    const el = this.ruler;
    el.innerHTML = '';
    const step = this.pickStep();
    for (let t = 0; t <= Math.max(dur, width / this.pps()) + step; t += step) {
      const d = document.createElement('div');
      d.className = 'tl-tick';
      d.style.left = (t * this.pps()) + 'px';
      d.textContent = fmtTime(t, this.pps() > 60);
      el.appendChild(d);
    }
    this.ruler.style.width = width + 'px';
  }
  pickStep() {
    const pps = this.pps();
    const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
    for (const s of steps) if (s * pps >= 68) return s;
    return 600;
  }
  updateHead() {
    const x = this.app.time * this.pps();
    this.heads.querySelectorAll('.tl-head-line').forEach(e => e.style.left = x + 'px');
    const bubble = this.heads.querySelector('.tl-head-bubble');
    if (bubble) { bubble.style.left = x + 'px'; bubble.textContent = fmtTime(this.app.time, true, this.project.settings.fps); }
  }
  // ---------------- clip element ----------------
  clipEl(clip) {
    const el = document.createElement('div');
    const p = this.project;
    const dur = clip.duration;
    el.className = 'tl-clip ' + clip.type;
    if (this.app.selected.includes(clip.id)) el.classList.add('sel');
    el.dataset.clip = clip.id;
    el.style.left = (clip.start * this.pps()) + 'px';
    el.style.width = Math.max(6, dur * this.pps()) + 'px';
    const media = p.media.find(m => m.id === clip.mediaId);
    if ((clip.type === 'video' || clip.type === 'image') && media) {
      const cv = document.createElement('canvas');
      cv.className = 'clip-strip';
      const w = Math.min(1400, Math.max(40, Math.round(dur * this.pps())));
      cv.width = Math.max(2, Math.min(w, 1400)); cv.height = 34;
      el.appendChild(cv);
      this.paintFilmstrip(cv, clip, media);
    } else if ((clip.type === 'audio' || (clip.type === 'video' && media && media.hasAudio)) && (media?.peaks || clip.type === 'video')) {
      const cv = document.createElement('canvas');
      cv.className = 'clip-wave';
      const w = Math.min(1600, Math.max(40, Math.round(dur * this.pps())));
      cv.width = Math.max(2, w); cv.height = 30;
      el.appendChild(cv);
      this.paintWave(cv, clip, media);
    }
    if (clip.type === 'text') {
      const lab = document.createElement('div');
      lab.className = 'clip-label';
      lab.textContent = (clip.text && clip.text.content ? String(clip.text.content).slice(0, 24) : 'T');
      el.appendChild(lab);
    } else if (clip.type === 'sticker') {
      const lab = document.createElement('div');
      lab.className = 'clip-label';
      lab.textContent = (clip.sticker && clip.sticker.emoji) || '😎';
      el.appendChild(lab);
    } else if (clip.type === 'shape') {
      el.classList.add('shape-clip');
    }
    if (clip.speed !== 1) {
      const s = document.createElement('span');
      s.className = 'clip-badge';
      s.textContent = clip.speed + 'x';
      el.appendChild(s);
    }
    if (clip.keyframes && Object.values(clip.keyframes).some(a => a && a.length)) {
      const kb = document.createElement('span');
      kb.className = 'clip-badge kf';
      kb.textContent = '◈';
      el.appendChild(kb);
    }
    // trim handles
    for (const side of ['l', 'r']) {
      const h = document.createElement('div');
      h.className = 'tl-handle ' + side;
      h.dataset.side = side;
      el.appendChild(h);
    }
    el.addEventListener('pointerdown', (ev) => this.onClipDown(ev, clip, el));
    el.addEventListener('contextmenu', (ev) => { ev.preventDefault(); this.app.select(clip.id); this.app.contextMenu(ev, clip); });
    let lpTimer = null;
    el.addEventListener('touchstart', (ev) => {
      lpTimer = setTimeout(() => { this.app.select(clip.id); this.app.contextMenu(ev.touches[0], clip); }, 550);
    }, { passive: true });
    el.addEventListener('touchend', () => clearTimeout(lpTimer));
    el.addEventListener('touchmove', () => clearTimeout(lpTimer));
    el.addEventListener('dblclick', () => this.app.openClipEditor(clip));
    return el;
  }
  async paintFilmstrip(cv, clip, media) {
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#1b2029'; ctx.fillRect(0, 0, cv.width, cv.height);
    try {
      const frames = await getFilmstrip(media, Math.max(3, Math.min(12, Math.round(cv.width / 110))));
      if (!frames || !frames.length) return;
      const n = frames.length;
      const fw = cv.width / n;
      frames.forEach((f, i) => { if (f) ctx.drawImage(f, i * fw, 0, fw, cv.height); });
      // dim trimmed-away parts
      const total = media.duration || clip.trimOut || 1;
      const a = (clip.trimIn / total) * cv.width, b = cv.width - (clip.trimOut / total) * cv.width;
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      if (a > 0) ctx.fillRect(0, 0, a, cv.height);
      if (b > 0) ctx.fillRect(cv.width - b, 0, b, cv.height);
    } catch (e) { /* ignore */ }
  }
  paintWave(cv, clip, media) {
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    const peaks = media && media.peaks;
    ctx.fillStyle = clip.type === 'audio' ? 'rgba(61,220,151,.85)' : 'rgba(120,190,255,.7)';
    if (!peaks) {
      ctx.fillRect(0, cv.height / 2 - 1, cv.width, 2);
      return;
    }
    const total = media.duration || 1;
    const from = clip.trimIn / total, to = clip.trimOut / total;
    const n = cv.width;
    for (let i = 0; i < n; i++) {
      const t = from + ((to - from) * (clip.reverse ? (n - i) : i)) / n;
      const idx = clamp(Math.floor(t * peaks.length), 0, peaks.length - 1);
      const v = peaks[idx] || 0;
      const h = Math.max(1, v * (cv.height - 2));
      ctx.fillRect(i, (cv.height - h) / 2, 1, h);
    }
  }
  // ---------------- interaction ----------------
  onClipDown(ev, clip, el) {
    if (ev.button === 2) return;
    const track = this.project.tracks.find(t => t.id === clip.trackId);
    if (track && track.locked) { toast('المسار مقفول'); return; }
    el.setPointerCapture(ev.pointerId);
    const startX = ev.clientX, startY = ev.clientY;
    const side = ev.target && ev.target.dataset ? ev.target.dataset.side : null;
    const mode = side ? 'trim' + side : 'move';
    // selection
    if (ev.shiftKey || ev.ctrlKey || ev.metaKey) {
      const set = new Set(this.app.selected);
      set.has(clip.id) ? set.delete(clip.id) : set.add(clip.id);
      this.app.setSelection([...set]);
    } else if (!this.app.selected.includes(clip.id)) {
      this.app.select(clip.id);
    }
    const pps = this.pps();
    const orig = this.project.clips.filter(c => this.app.selected.includes(c.id)).map(c => ({ id: c.id, start: c.start, duration: c.duration, trimIn: c.trimIn, trimOut: c.trimOut, trackId: c.trackId }));
    let moved = false;
    const move = (e2) => {
      const dx = (e2.clientX - startX) / pps;
      const dy = e2.clientY - startY;
      if (Math.abs(e2.clientX - startX) > 3 || Math.abs(dy) > 3) moved = true;
      if (!moved) return;
      const dt = dx;
      const snapped = this.snapDelta(clip, dt);
      if (mode === 'move') {
        for (const o of orig) {
          const target = Math.max(0, o.start + snapped);
          const c = this.project.clips.find(x => x.id === o.id);
          if (!c) continue;
          c.start = target;
          if (o.id === clip.id && Math.abs(dy) > 26) {
            const nextTrack = this.trackAtY(e2.clientY, c);
            if (nextTrack && nextTrack.id !== c.trackId && this.trackAccepts(nextTrack, c)) {
              c.trackId = nextTrack.id;
              const free = this.firstFree(nextTrack.id, target, c.duration, c.id);
              if (free != null && Math.abs(free - target) < 0.4) c.start = free;
            }
          }
        }
      } else {
        const c = this.project.clips.find(x => x.id === clip.id);
        if (c) {
          const media = this.project.media.find(m => m.id === c.mediaId);
          const maxDur = media && c.type !== 'text' && c.type !== 'shape' && c.type !== 'sticker' ? (media.duration || c.duration) : null;
          if (mode === 'triml') {
            const delta = clamp(snapped, -o0(orig, clip.id).start, c.duration - 0.08);
            c.start = o0(orig, clip.id).start + delta;
            c.duration = Math.max(0.08, o0(orig, clip.id).duration - delta);
            c.trimIn = clamp(o0(orig, clip.id).trimIn + delta * c.speed, 0, c.trimOut - 0.05);
          } else {
            const maxLen = maxDur ? (maxDur - c.trimIn) / c.speed : 1e9;
            c.duration = clamp(o0(orig, clip.id).duration + snapped, 0.08, Math.max(0.08, maxLen));
            c.trimOut = clamp(c.trimIn + c.duration * c.speed, c.trimIn + 0.05, maxDur || 1e9);
          }
        }
      }
      this.quickUpdate();
      this.app.refreshSelectionUI();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (moved) { snapshot('clip-edit'); emit('change'); this.render(); }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    if (!moved) this.app.refreshSelectionUI();
  }
  o0() { }
  trackAtY(y, clip) {
    const rows = qa('.tl-track', this.lanes);
    for (const r of rows) {
      const b = r.getBoundingClientRect();
      if (y >= b.top && y <= b.bottom) return this.project.tracks.find(t => t.id === r.dataset.track);
    }
    return null;
  }
  trackAccepts(track, clip) {
    if (track.type === 'audio') return clip.type === 'audio' || clip.type === 'video';
    return true;
  }
  firstFree(trackId, start, dur, ignoreId) {
    const list = trackClipsSorted(trackId).filter(c => c.id !== ignoreId);
    for (const c of list) {
      if (start < c.start + c.duration && start + dur > c.start) return null;
    }
    return start;
  }
  snapDelta(clip, dt) {
    if (!this.app.snapping) return dt;
    const p = this.project;
    const pps = this.pps();
    const thr = 8 / pps;
    const targets = [this.app.time, 0];
    for (const c of p.clips) {
      if (c.id === clip.id) continue;
      targets.push(c.start, c.start + c.duration);
    }
    const want = clip.start + dt;
    let best = null;
    for (const t of targets) {
      const d = Math.abs(want - t);
      if (d < thr && (best == null || d < Math.abs(want - best))) best = t;
      const d2 = Math.abs(want + clip.duration - t);
      if (d2 < thr && (best == null || d2 < Math.abs(want + clip.duration - best))) best = t - clip.duration;
    }
    if (best != null) return best - clip.start;
    return dt;
  }
  quickUpdate() {
    for (const el of qa('.tl-clip', this.lanes)) {
      const c = this.project.clips.find(x => x.id === el.dataset.clip);
      if (!c) continue;
      el.style.left = (c.start * this.pps()) + 'px';
      el.style.width = Math.max(6, c.duration * this.pps()) + 'px';
    }
    this.app.schedulePreviewDraw();
  }
  bindLaneDnd(wrap, track) {
    wrap.addEventListener('dragover', (ev) => { ev.preventDefault(); wrap.classList.add('drop'); });
    wrap.addEventListener('dragleave', () => wrap.classList.remove('drop'));
    wrap.addEventListener('drop', (ev) => {
      ev.preventDefault(); wrap.classList.remove('drop');
      try {
        const data = JSON.parse(ev.dataTransfer.getData('text/plain') || '{}');
        if (data.mediaId) {
          const r = wrap.getBoundingClientRect();
          const t = this.xToTime(ev.clientX - r.left);
          this.app.addMediaToTimeline(data.mediaId, track.id, t);
        }
      } catch (e) { }
    });
  }
  scrollToTime(t) {
    const x = t * this.pps();
    if (x < this.scroll.scrollLeft + 20 || x > this.scroll.scrollLeft + this.scroll.clientWidth - 40) {
      this.scroll.scrollLeft = Math.max(0, x - this.scroll.clientWidth * 0.4);
    }
  }
}
function o0(orig, id) { return orig.find(o => o.id === id) || { start: 0, duration: 1, trimIn: 0, trimOut: 1 }; }
