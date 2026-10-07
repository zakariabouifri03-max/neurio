// Montaj Pro — application shell & wiring
import { qs, qa, uid, clamp, fmtTime, toast, download, deep, debounce, isMobile, bytesToBase64, supports } from './util.js';
import { makeT } from './i18n.js';
import {
  getProject, setProject, newProject, addTrack, addClip, newClip, updateClip, removeClip, clipById,
  snapshot, undo, redo, canUndo, canRedo, emit, onChange, projectDuration, clipsOf, trackClipsSorted,
  freeSlot, saveProjectToDB, listProjects, loadProjectFromDB, idbDel, moveClip, sortClips, clipLocalAt, addKeyHere,
} from './state.js';
import { importFiles, kindOf, getAudioBuffer } from './media.js';
import { PreviewProvider, PreviewView } from './preview.js';
import { Timeline } from './timeline.js';
import { renderInspector, escapeHtml } from './inspector.js';
import { exportWebCodecs, exportMediaRecorder, pickRecorderMime } from './exporter.js';
import { resumeAudio, beatsForProject, mixProject } from './audio.js';
import { drawFrame, getCanvas, releaseCanvas } from './render.js';
import { clipVolumeAt } from './effects.js';
import { captureFrame } from './capture.js';

export const T = makeT();

export class App {
  constructor() {
    this.time = 0;
    this.playing = false;
    this.selected = [];
    this.tab = 'media';
    this.snapping = true;
    this.grid = false;
    this.safeArea = false;
    this.previewQuality = 1;
    this.rate = 1;
    this.needDraw = true;
    this.captions = [];
    this.exportSettings = { height: 1080, fps: 30, format: 'mp4', engine: 'auto', bitrate: 0 };
    this.history = [];
    this.lastTs = 0;
  }
  get project() { return getProject(); }

  async init() {
    this.inspectorEl = qs('#inspector');
    this.provider = new PreviewProvider(getProject() || newProject());
    this.preview = new PreviewView(this);
    this.timeline = new Timeline(this);
    this.bindGlobal();
    T.set(T.lang());
    // load last project or create one
    try {
      const last = localStorage.getItem('montaj.lastProject');
      let p = null;
      if (last) p = await loadProjectFromDB(last);
      if (!p) {
        const all = await listProjects();
        if (all.length) p = await loadProjectFromDB(all[0].id);
      }
      if (p) { setProject(p); this.provider.project = p; this.preview.fit(); this.timeline.render(); }
      else await this.newProjectFlow(true);
    } catch (e) {
      console.warn('load failed', e);
      await this.newProjectFlow(true);
    }
    onChange(debounce(() => this.autosave(), 1200));
    onChange((evt) => { if (evt === 'change') { this.needDraw = true; } });
    this.preview.fit();
    this.timeline.render();
    this.loop(performance.now());
    this.setTab(this.tab);
    document.getElementById('splash')?.remove();
    startHeartbeat();
  }

  // ---------- playback ----------
  loop(ts) {
    const dt = Math.min(0.1, (ts - this.lastTs) / 1000 || 0);
    this.lastTs = ts;
    if (this.playing) {
      const dur = projectDuration(this.project);
      this.time += dt * this.rate;
      if (this.time >= dur) { this.time = dur; this.pause(); }
      this.timeline.syncScroll();
    }
    this.provider.sync(this.time, this.playing, this.rate);
    if (this.needDraw || this.playing) {
      this.preview.draw(this.time);
      this.needDraw = false;
    }
    this.timeline.updateHead();
    if (ts % 4 < 1) this.updateTimeDisplay();
    requestAnimationFrame((t2) => this.loop(t2));
  }
  play() {
    resumeAudio();
    const dur = projectDuration(this.project);
    if (this.time >= dur - 0.02) this.time = 0;
    this.playing = true;
    this.needDraw = true;
    this.updatePlayUI();
  }
  pause() { this.playing = false; this.updatePlayUI(); }
  togglePlay() { this.playing ? this.pause() : this.play(); }
  updateTimeDisplay() {
    const el = qs('#time-display');
    if (el) el.textContent = fmtTime(this.time, true, this.project.settings.fps);
  }
  updatePlayUI() {
    const b = qs('#btn-play');
    if (b) b.innerHTML = this.playing ? '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/></svg>' : '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M8 5l12 7-12 7z" fill="currentColor"/></svg>';
  }
  seek(t) {
    this.time = clamp(t, 0, Math.max(0.001, projectDuration(this.project)));
    this.needDraw = true;
    this.timeline.updateHead();
    this.timeline.scrollToTime(this.time);
  }
  seekPreviewDelta(d) {
    this.rate = 1;
    this.seek(this.time + d);
  }
  schedulePreviewDraw() { this.needDraw = true; }

  // ---------- selection ----------
  select(id) { this.setSelection(id ? [id] : []); }
  setSelection(ids) {
    this.selected = ids;
    this.timeline.render();
    this.updateSelectionOverlaySoon();
    renderInspector(this);
    this.preview.updateSelectionOverlay(this.time);
  }
  commitHistory() { snapshot('edit'); this.needDraw = true; }

  // ---------- tracks & clips ----------
  addTrack(type) {
    const p = this.project;
    const count = p.tracks.filter(x => x.type === type).length + 1;
    const name = (type === 'audio' ? 'A' : type === 'overlay' ? 'OV' : 'V') + count;
    addTrack(p, type, name);
    snapshot('add-track');
    this.timeline.render();
    this.needDraw = true;
  }
  removeTrack(id) {
    const p = this.project;
    if (p.tracks.length <= 1) return;
    p.tracks = p.tracks.filter(t => t.id !== id);
    p.clips = p.clips.filter(c => c.trackId !== id);
    snapshot('del-track'); this.timeline.render(); this.needDraw = true;
  }
  toggleTrackFlag(id, flag) {
    const t = this.project.tracks.find(x => x.id === id);
    if (!t) return;
    t[flag] = !t[flag];
    snapshot('track-' + flag); this.timeline.render(); this.needDraw = true;
  }
  trackForMedia(media, prefer = null) {
    const p = this.project;
    const want = media.kind === 'audio' || prefer === 'audio' ? 'audio' : 'video';
    if (prefer) {
      const t = p.tracks.find(x => x.id === prefer);
      if (t) return t;
    }
    const candidates = p.tracks.filter(t => t.type === want || (want === 'video' && t.type === 'overlay'));
    return candidates[0] || p.tracks.find(t => t.type === (want === 'audio' ? 'audio' : 'video')) || p.tracks[0];
  }
  async addMediaToTimeline(mediaId, trackId = null, atTime = null, prefer = null) {
    const p = this.project;
    const media = p.media.find(m => m.id === mediaId);
    if (!media) return;
    const track = this.trackForMedia(media, trackId || (media.kind === 'audio' ? prefer : null));
    if (!track) return toast('أضف مسار أولاً');
    const dur = media.kind === 'image' ? 3 : Math.max(0.2, media.duration || 3);
    const start = atTime != null ? atTime : freeSlot(track.id, this.time, dur);
    const clip = newClip({
      trackId: track.id, type: media.kind === 'image' ? 'image' : media.kind === 'audio' ? 'audio' : 'video',
      mediaId: media.id, start, duration: dur, trimIn: 0, trimOut: dur,
      text: null,
    });
    addClip(clip);
    snapshot('add-clip');
    this.select(clip.id);
    this.timeline.render();
    this.needDraw = true;
    setTimeout(() => this.timeline.scrollToTime(start), 30);
    return clip;
  }
  addTextClip(preset = 'title') {
    const p = this.project;
    const track = p.tracks.find(t => t.type === 'overlay') || p.tracks.find(t => t.type === 'video');
    const TEXT_PRESETS = {
      title: { content: 'عنوان الفيديو', size: 120, weight: 800, color: '#ffffff', stroke: '#000000', strokeWidth: 0, shadow: true, bg: 'transparent', font: 'Cairo' },
      sub: { content: 'نص فرعي هنا', size: 60, weight: 600, color: '#ffffff', stroke: '#000000', strokeWidth: 2, shadow: true, bg: 'transparent', font: 'Tajawal' },
      stroke: { content: 'STROKE', size: 130, weight: 800, color: '#ffd400', stroke: '#111111', strokeWidth: 10, shadow: false, bg: 'transparent', font: 'Bebas Neue' },
      box: { content: 'مربع نص', size: 72, weight: 700, color: '#0b0b0b', stroke: '', strokeWidth: 0, shadow: false, bg: '#ffe066', bgAlpha: 0.95, radius: 22, padding: 34, font: 'Cairo' },
    };
    const t = { align: 'center', lineHeight: 1.25, letterSpacing: 0, rtl: true, padding: 24, ...TEXT_PRESETS[preset] || TEXT_PRESETS.title };
    const clip = newClip({ trackId: track.id, type: 'text', start: this.time, duration: 3, text: t, animIn: { type: 'fade', dur: 0.4 } });
    addClip(clip);
    snapshot('add-text');
    this.select(clip.id);
    this.setTab('text');
    this.timeline.render(); this.needDraw = true;
  }
  addSticker(emoji) {
    const p = this.project;
    const track = p.tracks.find(t => t.type === 'overlay') || p.tracks[0];
    const clip = newClip({ trackId: track.id, type: 'sticker', start: this.time, duration: 2.5, sticker: { emoji, size: 260 }, animIn: { type: 'pop', dur: 0.35 } });
    addClip(clip); snapshot('add-sticker'); this.select(clip.id); this.timeline.render(); this.needDraw = true;
  }
  addShape(kind) {
    const p = this.project;
    const track = p.tracks.find(t => t.type === 'overlay') || p.tracks[0];
    const clip = newClip({ trackId: track.id, type: 'shape', start: this.time, duration: 3, shape: { kind, fill: '#ffd400', stroke: '#111111', strokeWidth: kind === 'line' ? 14 : 0, w: Math.round(p.settings.width * 0.5), h: Math.round(p.settings.width * 0.35) } });
    addClip(clip); snapshot('add-shape'); this.select(clip.id); this.setTab('stickers'); this.timeline.render(); this.needDraw = true;
  }
  setSpeed(clip, v, silent) {
    const oldDur = clip.duration;
    const srcLen = clip.trimOut - clip.trimIn;
    clip.speed = clamp(v, 0.05, 20);
    clip.duration = Math.max(0.08, srcLen / clip.speed);
    if (!silent) { snapshot('speed'); this.timeline.render(); }
    this.needDraw = true;
  }
  freezeFrame(clip) {
    try {
      const canvas = captureFrame(this, this.time);
      canvas.toBlob(async (blob) => {
        const file = new File([blob], `freeze-${Date.now()}.png`, { type: 'image/png' });
        const [media] = await importFiles([file]);
        if (!media) return;
        this.project.media.push(media);
        const track = this.project.tracks.find(t => t.id === clip.trackId);
        const nc = newClip({ trackId: track.id, type: 'image', mediaId: media.id, start: clip.start + clip.duration, duration: 2, trimIn: 0, trimOut: 2 });
        addClip(nc); snapshot('freeze'); this.select(nc.id); this.timeline.render(); this.needDraw = true;
        toast('تم تجميد الإطار ❄');
      }, 'image/png');
    } catch (e) { toast('تعذر التجميد'); }
  }
  async extractAudio(clip) {
    if (!clip.mediaId) return;
    const media = this.project.media.find(m => m.id === clip.mediaId);
    if (!media) return;
    const aTrack = this.project.tracks.find(t => t.type === 'audio');
    if (!aTrack) return toast('لا يوجد مسار صوتي');
    clip.muted = true;
    const ac = newClip({
      trackId: aTrack.id, type: 'audio', mediaId: media.id, start: clip.start, duration: clip.duration,
      trimIn: clip.trimIn, trimOut: clip.trimOut, speed: clip.speed,
    });
    addClip(ac); snapshot('extract-audio'); this.timeline.render(); this.needDraw = true;
    toast('تم استخراج الصوت ⤓');
  }
  splitAtPlayhead() {
    if (!this.selected.length) return;
    let any = false;
    for (const id of this.selected) {
      const c = clipById(id);
      if (!c) continue;
      const local = this.time - c.start;
      if (local <= 0.05 || local >= c.duration - 0.05) continue;
      const right = deep(c);
      right.id = uid('clip');
      right.start = c.start + local;
      right.duration = c.duration - local;
      right.trimIn = clamp(c.trimIn + local * c.speed, 0, c.trimOut - 0.02);
      right.transition = { type: 'none', duration: 0.5 };
      if (c.reverse) { right.trimOut = c.trimOut; c.trimIn = c.trimIn; c.trimOut = clamp(c.trimOut - right.duration * c.speed, c.trimIn + 0.02, 1e9); }
      else c.trimOut = right.trimIn;
      c.duration = local;
      // shift existing keyframes
      if (right.keyframes) {
        for (const k in right.keyframes) {
          right.keyframes[k] = right.keyframes[k].map(x => ({ ...x, t: (x.t * c.duration - local) / Math.max(0.01, right.duration) })).filter(x => x.t >= 0 && x.t <= 1);
        }
      }
      if (c.keyframes) for (const k in c.keyframes) c.keyframes[k] = c.keyframes[k].map(x => ({ ...x, t: x.t * c.duration / Math.max(0.01, c.duration) })).filter(x => x.t <= 1);
      addClip(right);
      this.selected = [right.id];
      any = true;
    }
    if (any) { sortClips(); snapshot('split'); this.timeline.render(); this.setSelection(this.selected); this.needDraw = true; }
  }
  duplicateSelection() {
    if (!this.selected.length) return;
    const newIds = [];
    for (const id of this.selected) {
      const c = clipById(id);
      if (!c) continue;
      const n = deep(c);
      n.id = uid('clip');
      n.start = c.start + c.duration;
      n.trackId = c.trackId;
      addClip(n);
      newIds.push(n.id);
    }
    sortClips(); snapshot('duplicate'); this.setSelection(newIds); this.timeline.render(); this.needDraw = true;
  }
  copySelection() {
    this.clipboard = this.selected.map(id => deep(clipById(id))).filter(Boolean);
    toast(`تم نسخ ${this.clipboard.length}`);
  }
  pasteClipboard() {
    if (!this.clipboard || !this.clipboard.length) return;
    const ids = [];
    for (const c of this.clipboard) {
      const n = deep(c);
      n.id = uid('clip');
      n.start = this.time;
      const track = this.project.tracks.find(t => t.id === n.trackId) || this.project.tracks[0];
      n.trackId = track.id;
      n.start = freeSlot(track.id, this.time, n.duration);
      addClip(n); ids.push(n.id);
    }
    sortClips(); snapshot('paste'); this.setSelection(ids); this.timeline.render(); this.needDraw = true;
  }
  deleteSelection() {
    if (!this.selected.length) return;
    const p = this.project;
    p.clips = p.clips.filter(c => !this.selected.includes(c.id));
    this.selected = [];
    snapshot('delete'); this.setSelection([]); this.timeline.render(); this.needDraw = true;
  }
  openClipEditor(clip) {
    this.select(clip.id);
    if (clip.type === 'text') this.setTab('text');
    else this.setTab('motion');
  }
  async removeMedia(mediaId) {
    const used = this.project.clips.some(c => c.mediaId === mediaId);
    if (used && !confirm('هذا الملف مستعمل في المشروع. تحذفه؟')) return;
    this.project.media = this.project.media.filter(m => m.id !== mediaId);
    this.project.clips = this.project.clips.filter(c => c.mediaId !== mediaId);
    await idbDel('blobs', mediaId);
    snapshot('del-media'); this.timeline.render(); this.setTab('media'); this.needDraw = true;
  }

  // ---------- import ----------
  pickFiles(accept = 'video/*,audio/*,image/*') {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = accept;
    inp.multiple = true;
    inp.style.cssText = 'position:fixed;left:-9999px';
    document.body.appendChild(inp);
    inp.addEventListener('change', async () => {
      const files = Array.from(inp.files || []);
      inp.remove();
      if (files.length) await this.handleFiles(files);
    });
    inp.click();
  }
  async handleFiles(files) {
    toast('جاري الاستيراد…');
    const media = await importFiles(files);
    const p = this.project;
    for (const m of media) p.media.push(m);
    snapshot('import');
    this.setTab('media');
    this.timeline.render();
    if (media.length === 1) await this.addMediaToTimeline(media[0].id);
    else {
      // lay them out sequentially on the first track
      let t = this.time;
      for (const m of media) {
        const track = this.trackForMedia(m);
        const dur = m.kind === 'image' ? 3 : Math.max(0.2, m.duration || 3);
        const start = m.kind === 'audio' ? this.time : freeSlot(track.id, t, dur);
        const clip = newClip({
          trackId: track.id, type: m.kind === 'image' ? 'image' : m.kind === 'audio' ? 'audio' : 'video',
          mediaId: m.id, start, duration: dur, trimIn: 0, trimOut: dur,
        });
        addClip(clip);
        t = start + dur;
      }
      sortClips();
      snapshot('import-many');
      this.timeline.render();
    }
    toast(`تم استيراد ${media.length} ملف`);
  }

  // ---------- voiceover ----------
  async toggleVoiceover() {
    if (this.recording) { this.stopVoiceover(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
        const file = new File([blob], `voiceover-${Date.now()}.webm`, { type: blob.type });
        const [media] = await importFiles([file]);
        if (!media) return toast('تعذر حفظ التسجيل');
        this.project.media.push(media);
        const track = this.project.tracks.find(t => t.type === 'audio');
        const clip = newClip({ trackId: track.id, type: 'audio', mediaId: media.id, start: this.startRecTime, duration: media.duration, trimIn: 0, trimOut: media.duration });
        addClip(clip); snapshot('voiceover'); this.timeline.render(); this.needDraw = true;
        toast('تم إضافة التعليق الصوتي 🎙');
      };
      this.recorder = rec;
      this.recording = true;
      this.startRecTime = this.time;
      rec.start();
      this.play();
      toast('جاري التسجيل…');
      renderInspector(this);
    } catch (e) {
      toast('الميكروفون غير متاح');
      console.warn(e);
    }
  }
  stopVoiceover() {
    this.recording = false;
    this.pause();
    try { this.recorder && this.recorder.stop(); } catch (e) { }
    renderInspector(this);
  }

  // ---------- auto cut on beats ----------
  async autoCutOnBeats() {
    toast('جاري تحليل الصوت…');
    const beats = await beatsForProject(this.project);
    if (!beats.length) return toast('ما لقيتش إيقاع واضح');
    let cuts = 0;
    for (const id of [...this.selected]) {
      const clip = clipById(id);
      if (!clip || (clip.type !== 'video' && clip.type !== 'image')) continue;
      const inside = beats.filter(b => b > clip.start + 0.1 && b < clip.start + clip.duration - 0.1);
      for (const b of inside.reverse()) {
        this.time = b;
        this.selected = [id];
        this.splitAtPlayhead();
        cuts++;
      }
    }
    toast(cuts ? `تم القص على ${cuts} نقطة إيقاع 🥁` : 'حدد مقطع فيديو أولاً');
  }

  // ---------- captions ----------
  addCaptionAtPlayhead(text = '') {
    const c = { start: this.time, end: this.time + 2, text: text || 'نص الترجمة' };
    this.captions.push(c);
    this.syncCaptions();
    renderInspector(this);
    return c;
  }
  async startAutoCaptions() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return toast(T('speechUnsupported'));
    if (this.listening) { this.listening = false; try { this.rec.stop(); } catch (e) { } renderInspector(this); return; }
    const rec = new SR();
    this.rec = rec;
    this.listening = true;
    rec.lang = T.lang() === 'ar' ? 'ar-MA' : 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    let segStart = this.time;
    rec.onresult = (ev) => {
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) {
          const txt = r[0].transcript.trim();
          const now = this.time;
          if (txt) {
            this.captions.push({ start: segStart, end: Math.max(now, segStart + 0.6), text: txt });
            this.syncCaptions();
            renderInspector(this);
          }
          segStart = now;
        }
      }
    };
    rec.onerror = (e) => { console.warn(e); toast('تعذر التعرف على الكلام'); this.listening = false; renderInspector(this); };
    rec.onend = () => { if (this.listening) { try { rec.start(); } catch (e) { } } };
    try { rec.start(); this.play(); toast('🎧 سجّل الكلام…'); } catch (e) { toast('تعذر البدء'); }
    renderInspector(this);
  }
  syncCaptions() {
    const p = this.project;
    const track = p.tracks.find(t => t.type === 'overlay') || p.tracks[0];
    p.clips = p.clips.filter(c => !(c.type === 'text' && c.isCaption));
    for (const c of this.captions) {
      const clip = newClip({
        trackId: track.id, type: 'text', isCaption: true, start: c.start, duration: Math.max(0.4, c.end - c.start),
        text: {
          content: c.text, size: 64, weight: 700, color: '#ffffff', stroke: '#000000', strokeWidth: 4, shadow: true,
          bg: 'transparent', font: 'Cairo', align: 'center', rtl: true, padding: 24, lineHeight: 1.25,
          maxWidth: Math.round(p.settings.width * 0.86),
        },
        transform: { x: 0, y: p.settings.height * 0.32, scale: 1, rotate: 0, flipH: false, flipV: false, opacity: 1, crop: { l: 0, t: 0, r: 0, b: 0 }, radius: 0 },
        animIn: { type: 'fade', dur: 0.2 }, animOut: { type: 'fade', dur: 0.2 },
      });
      addClip(clip);
    }
    snapshot('captions');
    this.timeline.render(); this.needDraw = true;
  }
  importSrt() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.srt,.vtt,text/plain';
    inp.addEventListener('change', async () => {
      const f = inp.files[0];
      if (!f) return;
      const text = await f.text();
      const caps = parseSrt(text);
      if (!caps.length) return toast('ملف غير صالح');
      this.captions = this.captions.concat(caps);
      this.syncCaptions(); renderInspector(this);
      toast(`تم استيراد ${caps.length} ترجمة`);
    });
    inp.click();
  }
  exportSrt() {
    const srt = this.captions.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join('\n');
    download(new Blob([srt], { type: 'text/plain;charset=utf-8' }), (this.project.name || 'captions') + '.srt');
  }

  // ---------- projects ----------
  async newProjectFlow(silent) {
    if (!silent && !confirm('مشروع جديد؟ تغييرات لم تُحفظ ستضيع.')) return;
    const p = newProject({ width: 1080, height: 1920, fps: 30, aspect: '9:16' });
    setProject(p);
    this.selected = []; this.time = 0; this.captions = [];
    this.provider.project = p;
    this.preview.fit(); this.preview.draw(0);
    this.timeline.render();
    renderInspector(this);
    await saveProjectToDB(p);
    localStorage.setItem('montaj.lastProject', p.id);
  }
  async saveProject() {
    await saveProjectToDB(this.project);
    toast('تم حفظ المشروع ✓');
  }
  async autosave() {
    try { await saveProjectToDB(this.project); } catch (e) { }
  }
  async openProjectsModal() {
    const modal = qs('#modal-projects');
    const list = qs('#projects-list');
    list.innerHTML = '';
    const projects = await listProjects();
    if (!projects.length) list.innerHTML = '<div class="hint">لا توجد مشاريع محفوظة</div>';
    for (const p of projects) {
      const row = document.createElement('div');
      row.className = 'proj-row';
      row.innerHTML = `<div><b>${escapeHtml(p.name || 'مشروع')}</b><span class="dim">${new Date(p.updatedAt || p.createdAt || Date.now()).toLocaleString('ar-MA')} · ${(p.clips || []).length} مقطع</span></div>`;
      const actions = document.createElement('div');
      actions.className = 'proj-actions';
      const mk = (label, fn) => { const b = document.createElement('button'); b.className = 'mini'; b.textContent = label; b.onclick = fn; actions.appendChild(b); };
      mk('فتح', async () => {
        const loaded = await loadProjectFromDB(p.id);
        if (!loaded) return toast('تعذر الفتح');
        setProject(loaded);
        this.provider.project = loaded;
        this.selected = []; this.time = 0;
        this.preview.fit(); this.timeline.render(); renderInspector(this);
        localStorage.setItem('montaj.lastProject', loaded.id);
        modal.close();
      });
      mk('نسخ', async () => {
        const loaded = await loadProjectFromDB(p.id);
        if (!loaded) return;
        loaded.id = uid('proj'); loaded.name = (loaded.name || 'مشروع') + ' (نسخة)';
        await saveProjectToDB(loaded);
        this.openProjectsModal();
      });
      mk('حذف', async () => {
        if (!confirm(T('confirmDelete'))) return;
        await idbDel('projects', p.id);
        this.openProjectsModal();
      });
      row.appendChild(actions);
      list.appendChild(row);
    }
    modal.showModal();
  }

  // ---------- export ----------
  openExportModal(autoStart) {
    const modal = qs('#modal-export');
    const p = this.project;
    const dur = projectDuration(p);
    if (!p.clips.length) return toast(T('needMedia'));
    qs('#exp-info').textContent = `${fmtTime(dur)} · ${p.clips.length} مقطع · ${p.tracks.length} مسار`;
    qs('#exp-engine').textContent = supports.webcodecs ? 'WebCodecs ✓' : 'MediaRecorder';
    modal.showModal();
    if (autoStart) setTimeout(() => this.runExport(), 200);
  }
  async runExport() {
    const p = this.project;
    const es = this.exportSettings;
    const ar = p.settings.width / p.settings.height;
    const H = es.height || p.settings.height;
    const W = Math.round(H * ar / 2) * 2;
    const fps = es.fps || p.settings.fps;
    const bitrate = es.bitrate || Math.round(W * H * fps * 0.09);
    const progressBar = qs('#exp-bar');
    const statusEl = qs('#exp-status');
    const logEl = qs('#exp-log');
    const signal = { cancelled: false };
    this.exportSignal = signal;
    qs('#exp-cancel').onclick = () => { signal.cancelled = true; statusEl.textContent = 'جاري الإلغاء…'; };
    const hooks = {
      signal,
      onStatus: (s) => { statusEl.textContent = s === 'mixing-audio' ? 'جاري دمج الصوت…' : s === 'finalizing' ? 'جاري إنهاء الملف…' : s; },
      onProgress: (pr) => {
        const pct = Math.round((pr.value || 0) * 100);
        progressBar.style.width = pct + '%';
        if (pr.phase === 'video') {
          statusEl.textContent = `${T('exporting')} ${pr.frame || 0}/${pr.total || 0} — ${pct}%`;
          logEl.textContent = pr.eta ? `${T('eta')}: ${fmtTime(pr.eta)}` : '';
        } else if (pr.phase === 'audio') statusEl.textContent = `الصوت ${pct}%`;
        else statusEl.textContent = `${T('exporting')} ${pct}%`;
      },
    };
    const wantsFast = es.engine === 'fast' || (es.engine === 'auto' && supports.webcodecs);
    let result = null;
    try {
      document.body.classList.add('exporting');
      if (wantsFast && supports.webcodecs) {
        const saved = { w: p.settings.width, h: p.settings.height, fps: p.settings.fps };
        p.settings.width = W; p.settings.height = H; p.settings.fps = fps;
        try {
          result = await exportWebCodecs(p, { fps, bitrate, format: es.format, width: W, height: H }, hooks);
        } finally {
          p.settings.width = saved.w; p.settings.height = saved.h; p.settings.fps = saved.fps;
          this.preview.fit();
        }
      } else {
        result = await exportMediaRecorder(p, { fps, bitrate, format: es.format, width: W, height: H }, hooks);
      }
    } catch (e) {
      console.error(e);
      if (String(e.message) === 'cancelled') { statusEl.textContent = 'أُلغي التصدير'; document.body.classList.remove('exporting'); return; }
      statusEl.textContent = 'فشل التصدير — جاري المحاولة بطريقة متوافقة…';
      try {
        result = await exportMediaRecorder(p, { fps, bitrate, format: es.format, width: W, height: H }, hooks);
      } catch (e2) {
        console.error(e2);
        statusEl.textContent = 'تعذر التصدير: ' + e2.message;
        document.body.classList.remove('exporting');
        return;
      }
    }
    document.body.classList.remove('exporting');
    if (!result) return;
    progressBar.style.width = '100%';
    statusEl.textContent = T('done');
    const name = `${(p.name || 'montaj').replace(/[^\w\u0600-\u06FF\- ]/g, '')}-${Date.now()}.${result.ext}`;
    this.lastExport = { blob: result.blob, name };
    logEl.innerHTML = `${(result.blob.size / 1048576).toFixed(1)} MB · ${result.ext.toUpperCase()}`;
    await this.saveBlob(result.blob, name);
  }
  async saveBlob(blob, name) {
    // APK bridge: chunked save to a user-picked folder (blob downloads are not possible in a WebView)
    const bridge = window.MontajBridge;
    if (bridge && bridge.beginSave) {
      const statusEl = qs('#exp-status');
      try {
        statusEl.textContent = 'اختار مكان الحفظ (مثلاً مجلد التنزيلات)…';
        const mime = (blob.type || 'video/mp4').split(';')[0].trim() || 'video/mp4';
        bridge.beginSave(name, mime);
        let ready = false, failed = false;
        for (let i = 0; i < 1800; i++) {           // ~6 min: the user may take a while to pick a folder
          if (bridge.saveReady && bridge.saveReady()) { ready = true; break; }
          if (bridge.saveFailed && bridge.saveFailed()) { failed = true; break; }
          if (i === 25) toast('اختار مكان حفظ الفيديو من نافذة الهاتف');
          await new Promise(r => setTimeout(r, 200));
        }
        if (ready) {
          const CH = 512 * 1024;
          for (let off = 0; off < blob.size; off += CH) {
            const buf = await blob.slice(off, Math.min(blob.size, off + CH)).arrayBuffer();
            bridge.writeChunk(bytesToBase64(new Uint8Array(buf)));
            qs('#exp-bar').style.width = Math.round(((off + CH) / blob.size) * 100) + '%';
            if (off % (CH * 8) === 0) await new Promise(r => setTimeout(r, 0));
          }
          bridge.endSave();
          const where = bridge.lastPath ? ('' + bridge.lastPath()) : '';
          const shown = where && where !== 'null' ? (where.split('/').pop() || where) : 'جهازك';
          statusEl.textContent = (T('done') || '') + ' — ' + shown;
          qs('#exp-log').textContent = '📁 ' + where;
          toast('تم حفظ الفيديو في ' + shown + ' ✓', 4000);
          return;
        }
        console.warn('bridge save: ready=' + ready + ' failed=' + failed);
      } catch (e) { console.warn('bridge save failed', e); }
      statusEl.textContent = T('saveFailed');
      toast(T('saveFailed'), 4000);
      return;
    }
    download(blob, name);
    toast('تم تنزيل الفيديو ✓');
  }
  showLastExport() { if (this.lastExport) this.saveBlob(this.lastExport.blob, this.lastExport.name); }

  // ---------- tabs & UI ----------
  updateSelectionOverlaySoon() { setTimeout(() => this.preview.updateSelectionOverlay(this.time), 0); }
  setTab(tab) {
    this.tab = tab;
    const titles = { media: 'الوسائط', audio: 'الصوت', text: 'النص', stickers: 'الملصقات', effects: 'التأثيرات', motion: 'الحركة', speed: 'السرعة', captions: 'الترجمة', export: 'التصدير', project: 'المشروع' };
    const st = qs('#sheet-title');
    if (st) st.textContent = titles[tab] || '';
    qa('.rail-btn, .tabbar-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    renderInspector(this);
    if (isMobile()) qs('#sheet')?.classList.add('open');
  }
  rerender() {
    renderInspector(this);
    this.timeline.render();
    qa('[data-i18n]').forEach(el => { const k = el.dataset.i18n; el.textContent = T(k); });
  }
  fitPreview() { this.preview.fit(); }

  // ---------- global bindings ----------
  bindGlobal() {
    // playback controls
    qs('#btn-play').onclick = () => this.togglePlay();
    qs('#btn-undo').onclick = () => { undo(); this.timeline.render(); this.needDraw = true; };
    qs('#btn-redo').onclick = () => { redo(); this.timeline.render(); this.needDraw = true; };
    qs('#btn-split').onclick = () => this.splitAtPlayhead();
    qs('#btn-export').onclick = () => this.openExportModal();
    qs('#btn-projects').onclick = () => this.openProjectsModal();
    qs('#btn-save').onclick = () => this.saveProject();
    qs('#btn-full').onclick = () => toggleFullscreen();
    qs('#btn-zoom-in').onclick = () => this.timeline.zoomIn();
    qs('#btn-zoom-out').onclick = () => this.timeline.zoomOut();
    qs('#btn-zoom-fit').onclick = () => this.timeline.zoomFit();
    qs('#btn-add-video-track').onclick = () => this.addTrack('video');
    qs('#btn-add-audio-track').onclick = () => this.addTrack('audio');
    qs('#btn-add-overlay-track').onclick = () => this.addTrack('overlay');
    qa('.rail-btn, .tabbar-btn').forEach(b => b.addEventListener('click', () => this.setTab(b.dataset.tab)));
    qs('#sheet-close') && (qs('#sheet-close').onclick = () => qs('#sheet').classList.remove('open'));
    // drag & drop import
    const dz = document.body;
    ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, (e) => { e.preventDefault(); document.body.classList.add('dragging'); }));
    ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, (e) => { e.preventDefault(); if (ev === 'dragleave' && e.relatedTarget) return; document.body.classList.remove('dragging'); }));
    dz.addEventListener('drop', async (e) => {
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) await this.handleFiles(Array.from(e.dataTransfer.files));
    });
    document.addEventListener('paste', async (e) => {
      const items = Array.from(e.clipboardData?.items || []);
      const files = items.filter(i => i.kind === 'file').map(i => i.getAsFile()).filter(Boolean);
      if (files.length) await this.handleFiles(files);
    });
    // keyboard
    window.addEventListener('keydown', (e) => {
      if (e.target.matches('input,textarea,select,[contenteditable]')) return;
      const mod = e.ctrlKey || e.metaKey;
      if (e.code === 'Space') { e.preventDefault(); this.togglePlay(); }
      else if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); this.timeline.render(); this.needDraw = true; }
      else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); this.timeline.render(); this.needDraw = true; }
      else if (mod && e.key.toLowerCase() === 'c') { this.copySelection(); }
      else if (mod && e.key.toLowerCase() === 'v') { this.pasteClipboard(); }
      else if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); this.saveProject(); }
      else if (mod && e.key.toLowerCase() === 'e') { e.preventDefault(); this.openExportModal(); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { if (!mod) this.deleteSelection(); }
      else if (e.key.toLowerCase() === 's') { this.splitAtPlayhead(); }
      else if (e.key.toLowerCase() === 'd') { this.duplicateSelection(); }
      else if (e.key.toLowerCase() === 'k') { this.pause(); }
      else if (e.key === 'Escape') { this.setSelection([]); }
      else if (e.key === 'ArrowUp') { this.seek(this.time + 1 / this.project.settings.fps); }
    });
    // history buttons state
    onChange(() => {
      qs('#btn-undo')?.classList.toggle('disabled', !canUndo());
      qs('#btn-redo')?.classList.toggle('disabled', !canRedo());
    });
  }
  contextMenu(ev, clip) {
    const menu = qs('#ctx-menu');
    menu.innerHTML = '';
    const items = [
      ['✂ ' + T('split'), () => this.splitAtPlayhead()],
      ['⧉ ' + T('duplicate'), () => this.duplicateSelection()],
      ['⎘ ' + T('copy'), () => this.copySelection()],
      ['🗑 ' + T('delete'), () => this.deleteSelection()],
      ['⇄ ' + T('reverse'), () => { updateClip(clip.id, { reverse: !clip.reverse }); snapshot('reverse'); this.timeline.render(); this.needDraw = true; }],
      ['⤓ استخراج الصوت', () => this.extractAudio(clip)],
      ['❄ تجميد الإطار', () => this.freezeFrame(clip)],
      ['◈ مفتاح موضع', () => { const lt = clipLocalAt(clip, this.time); addKeyHere(clip, 'x', lt); addKeyHere(clip, 'y', lt); snapshot('kf'); this.needDraw = true; }],
      ['Fill/Fit', () => { updateClip(clip.id, { fit: clip.fit === 'fill' ? 'contain' : 'fill' }); snapshot('fit'); this.needDraw = true; }],
      ['🎯 ملاءمة الشاشة', () => { updateClip(clip.id, { transform: { x: 0, y: 0, scale: 1, rotate: 0 } }); snapshot('center'); this.needDraw = true; }],
    ];
    for (const [label, fn] of items) {
      const b = document.createElement('button');
      b.textContent = label;
      b.onclick = () => { menu.close ? menu.close() : menu.classList.remove('open'); this.select(clip.id); fn(); };
      menu.appendChild(b);
    }
    const r = ev.clientX ? { x: ev.clientX, y: ev.clientY } : { x: 100, y: 100 };
    menu.style.left = Math.min(r.x, window.innerWidth - 220) + 'px';
    menu.style.top = Math.min(r.y, window.innerHeight - 260) + 'px';
    menu.classList.add('open');
    if (menu.showModal) try { menu.showModal(); } catch (e) { menu.classList.add('open'); }
    setTimeout(() => {
      const close = (e2) => { if (!menu.contains(e2.target)) { menu.close && menu.close(); menu.classList.remove('open'); window.removeEventListener('pointerdown', close); } };
      window.addEventListener('pointerdown', close);
    }, 10);
  }
  refreshSelectionUI() { renderInspector(this); this.preview.updateSelectionOverlay(this.time); }
}

function toggleFullscreen() {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => { });
  else document.exitFullscreen?.();
}
function parseSrt(text) {
  const blocks = String(text).replace(/\r/g, '').split(/\n\n+/);
  const out = [];
  const parseT = (s) => {
    const m = /(\d+):(\d+):(\d+)[,.](\d+)/.exec(s);
    return m ? (+m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000) : 0;
  };
  for (const b of blocks) {
    const lines = b.split('\n').filter(Boolean);
    if (lines.length < 2) continue;
    const idx = lines.findIndex(l => l.includes('-->'));
    if (idx < 0) continue;
    const [a, c] = lines[idx].split('-->');
    const txt = lines.slice(idx + 1).join('\n').trim();
    if (!txt) continue;
    out.push({ start: parseT(a), end: parseT(c), text: txt });
  }
  return out;
}
function srtTime(s) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60), ms = Math.round((s % 1) * 1000);
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${p(h)}:${p(m)}:${p(sec)},${p(ms, 3)}`;
}

// the Windows .exe launcher keeps its local server alive while we ping it
function startHeartbeat() {
  const h = location.hostname;
  if (h !== '127.0.0.1' && h !== 'localhost') return;
  const ping = () => { try { fetch('/ping', { cache: 'no-store' }).catch(() => { }); } catch (e) { } };
  ping();
  setInterval(ping, 10000);
}

export async function boot() {
  const app = new App();
  window.__app = app;
  window.__state = await import('./state.js');
  await app.init();
  return app;
}
