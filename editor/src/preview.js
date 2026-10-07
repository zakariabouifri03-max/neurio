// Montaj Pro — preview: live source provider + canvas interaction (move/scale/rotate/snap)
import { clamp, qs, toast, isTouch } from './util.js';
import { clipVolumeAt, clipTransform } from './effects.js';
import { drawFrame, clipBounds, activeClips } from './render.js';
import { clipLocalAt, updateClip, emit, getProject, trackById } from './state.js';
import { attachElement, setElementGain, resumeAudio } from './audio.js';

export class PreviewProvider {
  constructor(project) {
    this.project = project;
    this.els = new Map();
    this.ready = new Set();
  }
  elementFor(media) {
    if (this.els.has(media.id)) return this.els.get(media.id);
    let el;
    if (media.kind === 'image') {
      el = new Image();
      el.src = media.url;
      el.onload = () => this.ready.add(media.id);
    } else {
      el = document.createElement('video');
      el.src = media.url;
      el.muted = false;                 // audio goes through the WebAudio graph
      el.playsInline = true;
      el.preload = 'auto';
      el.crossOrigin = 'anonymous';
      el.style.cssText = 'position:fixed;left:-9999px;top:0;width:2px;height:2px;opacity:0;pointer-events:none';
      document.body.appendChild(el);
      attachElement(el);
    }
    this.els.set(media.id, el);
    return el;
  }
  getSource(clip, sourceTime) {
    const media = this.project.media.find(m => m.id === clip.mediaId);
    if (!media) return null;
    const el = this.elementFor(media);
    if (media.kind === 'image') return el.complete && el.naturalWidth ? el : null;
    return el.readyState >= 2 ? el : null;
  }
  // keep media elements in sync with the timeline
  sync(time, playing, rate = 1) {
    const used = new Map();
    for (const clip of this.project.clips) {
      if (clip.type !== 'video' && clip.type !== 'audio') continue;
      const track = trackById(clip.trackId);
      if (!track) continue;
      const active = time >= clip.start && time < clip.start + clip.duration;
      const media = this.project.media.find(m => m.id === clip.mediaId);
      if (!media) continue;
      const el = this.elementFor(media);
      if (!active) {
        if (el.tagName === 'VIDEO' && !el.paused && !used.has(media.id)) { try { el.pause(); } catch (e) { } }
        setElementGain(el, 0);
        continue;
      }
      used.set(media.id, clip);
      const local = clipLocalAt(clip, time);
      const srcT = clamp(
        clip.reverse ? clip.trimOut - local * clip.speed : clip.trimIn + local * clip.speed,
        0, Math.max(0, (media.duration || 0) - 0.02));
      const wantRate = clamp((clip.speed || 1) * rate, 0.1, 8);
      if (Math.abs((el.playbackRate || 1) - wantRate) > 0.01) { try { el.playbackRate = wantRate; if (el.preservesPitch !== undefined) el.preservesPitch = true; } catch (e) { } }
      const drift = Math.abs((el.currentTime || 0) - srcT);
      if (playing && !(track.muted && clip.muted) ) {
        if (drift > 0.3 && el.readyState >= 2) { try { el.currentTime = srcT; } catch (e) { } }
        if (el.paused && el.readyState >= 2) el.play().catch(() => { });
      } else {
        if (!el.paused) { try { el.pause(); } catch (e) { } }
        if (drift > 0.02 && el.readyState >= 1) { try { el.currentTime = srcT; } catch (e) { } }
      }
      const gain = (track.muted || clip.muted) ? 0 : clipVolumeAt(clip, local) * (track.volume ?? 1);
      setElementGain(el, gain);
    }
    for (const [id, el] of this.els) {
      if (!used.has(id)) { setElementGain(el, 0); if (el.tagName === 'VIDEO' && !el.paused) { try { el.pause(); } catch (e) { } } }
    }
  }
  destroy() {
    for (const el of this.els.values()) { try { el.pause && el.pause(); el.remove && el.remove(); } catch (e) { } }
    this.els.clear();
  }
}

const HANDLE = 14;   // display px
export class PreviewView {
  constructor(app) {
    this.app = app;
    this.canvas = qs('#preview-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.wrap = qs('#preview-wrap');
    this.guides = qs('#preview-overlays');
    this.zoom = 1;
    this.offset = { x: 0, y: 0 };
    this.drag = null;
    this.showGrid = false;
    this.showSafe = false;
    this.bindPointer();
    window.addEventListener('resize', () => this.fit());
  }
  get project() { return getProject(); }
  fit() {
    const p = this.project; if (!p) return;
    this.canvas.width = p.settings.width;
    this.canvas.height = p.settings.height;
    const wrapR = this.wrap.getBoundingClientRect();
    const pad = 12;
    const availW = wrapR.width - pad * 2, availH = wrapR.height - pad * 2;
    const scale = Math.min(availW / p.settings.width, availH / p.settings.height);
    const cssW = Math.max(60, Math.floor(p.settings.width * scale));
    const cssH = Math.max(60, Math.floor(p.settings.height * scale));
    this.canvas.style.width = cssW + 'px';
    this.canvas.style.height = cssH + 'px';
    this.disp = { w: cssW, h: cssH, scale: cssW / p.settings.width };
    this.drawGuides();
  }
  draw(t) {
    if (!this.project) return;
    if (this.canvas.width !== this.project.settings.width || this.canvas.height !== this.project.settings.height) this.fit();
    drawFrame(this.ctx, this.project, t, this.app.provider, { preview: true });
    this.updateSelectionOverlay(t);
  }
  drawGuides() {
    const el = this.guides;
    if (!el) return;
    const p = this.project; if (!p) return;
    el.innerHTML = '';
    el.style.width = this.canvas.style.width;
    el.style.height = this.canvas.style.height;
    el.classList.toggle('grid', this.showGrid);
    el.classList.toggle('safe', this.showSafe);
  }
  updateSelectionOverlay(t) {
    const sel = this.app.selected && this.app.selected[0];
    const ov = qs('#clip-box');
    if (!ov) return;
    const clip = sel ? this.app.project.clips.find(c => c.id === sel) : null;
    if (!clip || clip.type === 'audio' || !this.disp) { ov.style.display = 'none'; return; }
    const b = clipBounds(this.project, clip, t);
    const s = this.disp.scale;
    ov.style.display = 'block';
    ov.style.width = b.w * s + 'px';
    ov.style.height = b.h * s + 'px';
    ov.style.left = (b.cx * s - (b.w * s) / 2) + 'px';
    ov.style.top = (b.cy * s - (b.h * s) / 2) + 'px';
    ov.style.transform = `rotate(${b.rot}rad)`;
  }
  // -------- pointer interaction --------
  toProject(ev) {
    const r = this.canvas.getBoundingClientRect();
    return { x: (ev.clientX - r.left) / (this.disp ? this.disp.scale : 1), y: (ev.clientY - r.top) / (this.disp ? this.disp.scale : 1) };
  }
  hitTest(pt) {
    const t = this.app.time;
    const list = activeClips(this.project, t);
    for (const clip of list) {
      const b = clipBounds(this.project, clip, t);
      const dx = pt.x - b.cx, dy = pt.y - b.cy;
      const cos = Math.cos(-b.rot), sin = Math.sin(-b.rot);
      const lx = dx * cos - dy * sin, ly = dx * sin + dy * cos;
      const hw = Math.max(b.w / 2, 4), hh = Math.max(b.h / 2, 4);
      if (Math.abs(lx) <= hw && Math.abs(ly) <= hh) return clip;
    }
    return null;
  }
  bindPointer() {
    const c = this.canvas;
    let gesture = null;
    c.addEventListener('pointerdown', (ev) => {
      if (!this.project) return;
      c.setPointerCapture(ev.pointerId);
      resumeAudio();
      const pt = this.toProject(ev);
      this.app.pause();
      const active = (this.app.pointers = this.app.pointers || new Map());
      active.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (active.size === 2 && this.app.selection) {
        const [a, b] = [...active.values()];
        gesture = { type: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y), angle: Math.atan2(b.y - a.y, b.x - a.x) };
        this.drag = gesture;
        return;
      }
      const clip = this.hitTest(pt);
      if (clip) {
        if (this.app.selection !== clip.id) this.app.select(clip.id);
        const tf = clipTransform(clip, clipLocalAt(clip, this.app.time));
        this.drag = { type: 'move', clip, start: pt, orig: { x: tf.x, y: tf.y, scale: tf.scale, rotate: tf.rotate, opacity: tf.opacity }, moved: false, mode: 'move' };
        // handle detection
        const b = clipBounds(this.project, clip, this.app.time);
        const corners = [
          ['nw', -b.w / 2, -b.h / 2], ['ne', b.w / 2, -b.h / 2], ['sw', -b.w / 2, b.h / 2], ['se', b.w / 2, b.h / 2], ['rot', 0, -b.h / 2 - 48 / (this.disp.scale || 1)],
        ];
        for (const [name, ox, oy] of corners) {
          const cos = Math.cos(b.rot), sin = Math.sin(b.rot);
          const wx = b.cx + ox * cos - oy * sin, wy = b.cy + ox * sin + oy * cos;
          if (Math.hypot(pt.x - wx, pt.y - wy) < (name === 'rot' ? 26 : 34) / (this.disp.scale || 1)) { this.drag.mode = name; break; }
        }
      } else {
        this.drag = { type: 'scrub', start: pt, moved: false };
      }
    });
    c.addEventListener('pointermove', (ev) => {
      if (!this.drag || !this.project) return;
      const active = this.app.pointers || new Map();
      active.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      const pt = this.toProject(ev);
      const d = this.drag;
      if (d.type === 'scrub') {
        d.moved = true;
        // drag anywhere on the empty canvas scrubs time
        this.app.seekPreviewDelta(ev.movementX * 0.02);
        return;
      }
      if (d.type === 'pinch') {
        if (active.size < 2) return;
        const [a, b] = [...active.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const angle = Math.atan2(b.y - a.y, b.x - a.x);
        const clip = this.project.clips.find(c2 => c2.id === this.app.selection);
        if (!clip) return;
        const scaleF = dist / Math.max(1, d.dist);
        const rotF = angle - d.angle;
        const patch = { transform: { scale: clamp(d.orig.scale * scaleF, 0.05, 12), rotate: d.orig.rotate + rotF } };
        updateClip(clip.id, patch, { silent: true });
        this.app.refreshSelectionUI();
        return;
      }
      d.moved = true;
      const clip = d.clip;
      const dx = pt.x - d.start.x, dy = pt.y - d.start.y;
      if (d.mode === 'move') {
        let nx = d.orig.x + dx, ny = d.orig.y + dy;
        // snapping to centre / thirds
        const W = this.project.settings.width, H = this.project.settings.height;
        const snaps = [0, -W / 3, W / 3, -W / 2, W / 2];
        const snapsY = [0, -H / 3, H / 3, -H / 2, H / 2];
        const thr = 12 / (this.disp.scale || 1);
        for (const s of snaps) if (Math.abs(nx - s) < thr) { nx = s; this.showGuideLine('v', W / 2 + s); }
        for (const s of snapsY) if (Math.abs(ny - s) < thr) { ny = s; this.showGuideLine('h', H / 2 + s); }
        updateClip(clip.id, { transform: { x: nx, y: ny } }, { silent: true });
      } else if (d.mode === 'rot') {
        const b = clipBounds(this.project, clip, this.app.time);
        const ang = Math.atan2(pt.y - b.cy, pt.x - b.cx) + Math.PI / 2;
        updateClip(clip.id, { transform: { rotate: ang } }, { silent: true });
      } else {
        const b = clipBounds(this.project, clip, this.app.time);
        const distNow = Math.hypot(pt.x - b.cx, pt.y - b.cy);
        const distStart = Math.hypot(d.start.x - b.cx, d.start.y - b.cy);
        const f = distStart > 8 ? distNow / distStart : 1;
        updateClip(clip.id, { transform: { scale: clamp(d.orig.scale * f, 0.05, 12) } }, { silent: true });
      }
      this.app.refreshSelectionUI();
    });
    const end = (ev) => {
      if (this.app.pointers) this.app.pointers.delete(ev.pointerId);
      const d = this.drag;
      this.drag = null;
      this.clearGuideLines();
      if (d && d.moved && d.type !== 'scrub') this.app.commitHistory();
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('dblclick', () => {
      const sel = this.project.clips.find(c2 => c2.id === this.app.selection);
      if (sel && (sel.type === 'video' || sel.type === 'image')) {
        updateClip(sel.id, { fit: sel.fit === 'fill' ? 'contain' : 'fill' });
        this.app.commitHistory();
      }
    });
    c.addEventListener('wheel', (ev) => {
      if (!this.project) return;
      ev.preventDefault();
      this.app.seekPreviewDelta(-ev.deltaY * 0.002);
    }, { passive: false });
  }
  showGuideLine(axis, pos) {
    let el = document.getElementById('align-guide');
    if (!el) {
      el = document.createElement('div'); el.id = 'align-guide';
      this.wrap.appendChild(el);
    }
    const s = this.disp.scale;
    el.style.display = 'block';
    if (axis === 'v') { el.style.width = '1px'; el.style.height = '100%'; el.style.left = pos * s + 'px'; el.style.top = '0'; }
    else { el.style.height = '1px'; el.style.width = '100%'; el.style.top = pos * s + 'px'; el.style.left = '0'; }
  }
  clearGuideLines() {
    const el = document.getElementById('align-guide');
    if (el) el.style.display = 'none';
  }
}
