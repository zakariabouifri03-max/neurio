import { ASPECTS, TRACK_COLORS, EFFECTS, TRANSITIONS, TEXT_PRESETS, TEMPLATES, STICKERS, MUSIC, SFX, AI_SERVICES } from './catalog.js';
import { synthesizeAudio } from './audio.js';
import { deleteProject, getAsset, getAssets, getProject, getProjects, makeId, saveAsset, saveProject } from './storage.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));
const safe = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const noExt = value => String(value || '').replace(/\.[^.]+$/, '');
const formatClock = (seconds, fps = 30, frames = true) => {
  const s = Math.max(0, Number(seconds) || 0);
  const totalFrames = Math.floor((s % 1) * fps + 0.0001);
  const whole = Math.floor(s);
  const hh = Math.floor(whole / 3600).toString().padStart(2, '0');
  const mm = Math.floor((whole % 3600) / 60).toString().padStart(2, '0');
  const ss = (whole % 60).toString().padStart(2, '0');
  return frames ? `${hh}:${mm}:${ss}:${totalFrames.toString().padStart(2, '0')}` : whole >= 3600 ? `${hh}:${mm}:${ss}` : `${mm}:${ss}`;
};
const prettySize = bytes => {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};
const slugTitle = text => String(text || 'Untitled').trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'untitled';

const TRACK_DEFAULTS = [
  { kind: 'video', name: 'Video 1' },
  { kind: 'overlay', name: 'Overlay 1' },
  { kind: 'text', name: 'Text 1' },
  { kind: 'audio', name: 'Audio 1' },
  { kind: 'audio', name: 'Audio 2' },
];
const createTracks = () => TRACK_DEFAULTS.map(item => ({ id: makeId('track'), ...item, locked: false, hidden: false, muted: false, color: TRACK_COLORS[item.kind] || TRACK_COLORS.video }));
const defaultAdjustments = () => ({ brightness: 100, contrast: 100, saturation: 100, temperature: 0, tint: 0 });
const defaultTransform = () => ({ x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 });
const newProject = (name = 'Untitled edit') => ({
  id: makeId('project'), name, createdAt: Date.now(), updatedAt: Date.now(), aspect: '16:9', fps: 30, mode: 'pro',
  tracks: createTracks(), clips: [], selectedIds: [], playhead: 0, zoom: 60, snap: true, favorites: {},
});

let state = newProject();
let assetMap = new Map();
let playerMap = new Map();
let imageMap = new Map();
let audioContext = null;
let mixedAudioDestination = null;
let undoStack = [];
let redoStack = [];
let autosaveTimer = 0;
let autoSaveInFlight = false;
let lastSaveError = null;
let activeInspectorTab = 'basic';
let currentPanel = 'media';
let libraryQuery = '';
let audioShelf = 'music';
let audioCategory = 'All';
let audioFavoritesOnly = false;
let effectCategory = 'All';
let templateCategory = 'All';
let templateFavoritesOnly = false;
let effectFavoritesOnly = false;
let mediaFavoritesOnly = false;
let stickerFavoritesOnly = false;
let textFavoritesOnly = false;
let mediaFilter = 'all';
let timelinePps = 60;
let timelineScrubbing = false;
let activeDrag = null;
let exportSession = null;
let exportUiTimer = 0;
let soundPreview = null;
let fitPreviewNative = false;
let autoToneReport = null;
let silenceReport = null;
let replaceClipId = null;
let lastRaf = 0;
let timeUiLast = 0;
let uiReady = false;

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function trackById(id) { return state.tracks.find(track => track.id === id); }
function clipById(id) { return state.clips.find(clip => clip.id === id); }
function selectedClips() { return state.selectedIds.map(clipById).filter(Boolean); }
function selectedClip() { return selectedClips()[0] || null; }
function projectDuration() { return state.clips.reduce((max, clip) => Math.max(max, clip.start + clip.duration), 0); }
function maxSourceDuration(clip) {
  if (!clip || clip.kind === 'image' || clip.kind === 'text' || clip.kind === 'sticker') return Infinity;
  const duration = Number(assetById(clip.assetId)?.meta.duration);
  if (!Number.isFinite(duration) || duration <= 0) return Infinity;
  return Math.max(.05,(duration-Math.max(0,clip.sourceStart))/Math.max(.1,clip.speed||1));
}
function getSnapshot() {
  return {
    name: state.name, aspect: state.aspect, fps: state.fps, mode: state.mode,
    tracks: clone(state.tracks), clips: clone(state.clips), selectedIds: [...state.selectedIds],
    playhead: state.playhead, zoom: state.zoom, snap: state.snap, favorites: clone(state.favorites || {}),
  };
}
function restoreSnapshot(snapshot) {
  const projectId = state.id;
  const createdAt = state.createdAt;
  Object.assign(state, clone(snapshot), { id: projectId, createdAt });
  state.selectedIds = state.selectedIds.filter(id => clipById(id));
  syncProjectControls();
  renderEditor();
  scheduleAutosave();
}
function pushHistory() {
  undoStack.push(getSnapshot());
  if (undoStack.length > 80) undoStack.shift();
  redoStack.length = 0;
  updateHistoryButtons();
}
function updateHistoryButtons() {
  $('#undoButton').disabled = undoStack.length === 0;
  $('#redoButton').disabled = redoStack.length === 0;
}
function undo() {
  if (!undoStack.length) return;
  redoStack.push(getSnapshot());
  restoreSnapshot(undoStack.pop());
  updateHistoryButtons();
  toast('Undo');
}
function redo() {
  if (!redoStack.length) return;
  undoStack.push(getSnapshot());
  restoreSnapshot(redoStack.pop());
  updateHistoryButtons();
  toast('Redo');
}
function commitChange() {
  pushHistory();
  scheduleAutosave();
  renderEditor();
}
function scheduleAutosave() {
  state.updatedAt = Date.now();
  const status = $('.save-status');
  status.classList.add('saving');
  status.classList.remove('error');
  $('#saveStatus').textContent = 'Saving locally…';
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(persistNow, 450);
}
async function persistNow() {
  if (autoSaveInFlight) { autosaveTimer = setTimeout(persistNow, 250); return; }
  autoSaveInFlight = true;
  try {
    const savedState = getSnapshot();
    const record = { id: state.id, name: state.name, createdAt: state.createdAt, updatedAt: Date.now(), state: savedState };
    await saveProject(record);
    try { localStorage.setItem('neurio-last-project', state.id); } catch { /* optional */ }
    lastSaveError = null;
    $('.save-status').classList.remove('saving', 'error');
    $('#saveStatus').textContent = 'All changes saved';
  } catch (error) {
    lastSaveError = error;
    $('.save-status').classList.remove('saving');
    $('.save-status').classList.add('error');
    $('#saveStatus').textContent = 'Local save unavailable';
  } finally { autoSaveInFlight = false; }
}
function toast(message, duration = 2200) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('show'), duration);
}
function syncProjectControls() {
  $('#projectName').value = state.name;
  $('#aspectSelect').value = state.aspect;
  $('#modeLabel').textContent = state.mode === 'pro' ? 'PRO' : 'BEGINNER';
  $('#modeToggle').classList.toggle('beginner', state.mode === 'beginner');
  document.body.classList.toggle('mode-beginner', state.mode === 'beginner');
  $('#zoomRange').value = state.zoom;
  $('#snapToggle').classList.toggle('on', state.snap);
  const aspect = ASPECTS[state.aspect] || ASPECTS['16:9'];
  $('#previewCanvas').style.aspectRatio = `${aspect.width} / ${aspect.height}`;
  $('#previewInfo').textContent = `${state.aspect} · ${state.fps} fps`;
  setCanvasResolution(aspect.width, aspect.height, true);
}

function setCanvasResolution(width, height, preview = false) {
  const canvas = $('#previewCanvas');
  const ratio = width / height;
  if (preview) {
    const area = $('#stageWrap');
    const maxW = Math.max(320, (area?.clientWidth || innerWidth * .62) - 22);
    const maxH = Math.max(180, (area?.clientHeight || innerHeight * .5) - 18);
    const factor = Math.min(maxW / width, maxH / height, .62);
    canvas.width = Math.max(2, Math.round(width * factor));
    canvas.height = Math.max(2, Math.round(height * factor));
    canvas.style.aspectRatio = `${ratio}`;
  } else {
    canvas.width = Math.max(2, Math.round(width));
    canvas.height = Math.max(2, Math.round(height));
    canvas.style.aspectRatio = `${ratio}`;
  }
  drawPreview();
}
function outputDimensions(aspectKey, base) {
  const { width: refW, height: refH } = ASPECTS[aspectKey] || ASPECTS['16:9'];
  const ratio = refW / refH;
  if (ratio > 1.12) return { width: Math.round(base * ratio), height: base };
  if (ratio < .9) return { width: base, height: Math.round(base / ratio) };
  return { width: base, height: base };
}

function assetById(id) { return assetMap.get(id) || null; }
function iconForAsset(type) {
  if (type === 'video') return '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3z"/></svg>';
  if (type === 'audio') return '<svg viewBox="0 0 24 24"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
  if (type === 'font') return '<span style="font:700 13px Georgia">Aa</span>';
  return '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m4 17 5-5 3 3 3-4 5 6"/></svg>';
}
function normalizeAssetType(file) {
  const type = file.type || '';
  const ext = file.name.split('.').pop().toLowerCase();
  if (type.startsWith('video/') || ['mp4','mov','webm','m4v','ogv','mkv'].includes(ext)) return 'video';
  if (type.startsWith('audio/') || ['mp3','wav','m4a','aac','ogg','opus','flac'].includes(ext)) return 'audio';
  if (type.startsWith('image/') || ['png','jpg','jpeg','gif','webp','avif','bmp','svg'].includes(ext)) return 'image';
  if (['ttf','otf','woff','woff2'].includes(ext) || /font\//.test(type)) return 'font';
  return null;
}
function waitForMedia(element, event, timeout = 10000) {
  return new Promise(resolve => {
    if ((event === 'load' && element.complete) || (event === 'loadedmetadata' && element.readyState >= 1) || (event === 'loadeddata' && element.readyState >= 2)) { resolve(); return; }
    let done = false;
    const finish = () => { if (done) return; done = true; clearTimeout(timer); resolve(); };
    const timer = setTimeout(finish, timeout);
    element.addEventListener(event, finish, { once: true });
    element.addEventListener('error', finish, { once: true });
  });
}
async function thumbnailFor(blob, type, url) {
  try {
    if (type === 'image') {
      const image = new Image(); image.src = url;
      await waitForMedia(image, 'load', 5000);
      if (!image.naturalWidth) return null;
      const canvas = document.createElement('canvas');
      canvas.width = 256; canvas.height = Math.max(1, Math.round(256 * image.naturalHeight / image.naturalWidth));
      if (canvas.height > 180) { canvas.height = 144; canvas.width = Math.round(144 * image.naturalWidth / image.naturalHeight); }
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', .74);
    }
    if (type === 'video') {
      const video = document.createElement('video');
      video.muted = true; video.playsInline = true; video.preload = 'metadata'; video.src = url;
      await waitForMedia(video, 'loadedmetadata', 9000);
      if (!Number.isFinite(video.duration)) return null;
      try { video.currentTime = Math.min(.4, Math.max(0, video.duration * .08)); } catch { /* metadata can be sparse */ }
      await waitForMedia(video, 'seeked', 3000);
      if (!video.videoWidth) return null;
      const width = 320; const height = Math.max(1, Math.round(width * video.videoHeight / video.videoWidth));
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = Math.min(190, height);
      const ctx = canvas.getContext('2d');
      const scale = Math.max(canvas.width / video.videoWidth, canvas.height / video.videoHeight);
      const dw = video.videoWidth * scale, dh = video.videoHeight * scale;
      ctx.drawImage(video, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
      video.removeAttribute('src'); video.load();
      return canvas.toDataURL('image/jpeg', .68);
    }
  } catch { return null; }
  return null;
}
async function getMediaMetadata(file, type, url) {
  const meta = { id: makeId('asset'), name: file.name, type, mime: file.type || '', size: file.size || 0, duration: 0, width: 0, height: 0, thumbnail: null, waveform: null, addedAt: Date.now() };
  if (type === 'image') {
    const image = new Image(); image.src = url;
    await waitForMedia(image, 'load', 8000);
    meta.width = image.naturalWidth || 0; meta.height = image.naturalHeight || 0;
    meta.duration = 5;
    meta.thumbnail = await thumbnailFor(file, type, url);
  } else if (type === 'video') {
    const v = document.createElement('video'); v.muted = true; v.preload = 'metadata'; v.playsInline = true; v.src = url;
    await waitForMedia(v, 'loadedmetadata', 11000);
    if (Number.isFinite(v.duration)) meta.duration = v.duration;
    meta.width = v.videoWidth || 0; meta.height = v.videoHeight || 0;
    meta.thumbnail = await thumbnailFor(file, type, url);
    v.removeAttribute('src'); v.load();
  } else if (type === 'audio') {
    meta.duration = await readAudioDuration(file);
    meta.waveform = await readWaveform(file);
  } else {
    meta.duration = 0;
    meta.fontFamily = noExt(file.name).replace(/[^a-z0-9 ]/gi, '').trim() || 'Imported font';
  }
  return meta;
}
async function readAudioDuration(blob) {
  try {
    const url = URL.createObjectURL(blob);
    const audio = document.createElement('audio'); audio.preload = 'metadata'; audio.src = url;
    await waitForMedia(audio, 'loadedmetadata', 10000);
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    audio.removeAttribute('src'); audio.load(); URL.revokeObjectURL(url);
    return duration;
  } catch { return 0; }
}
async function readWaveform(blob) {
  try {
    if (blob.size > 120 * 1024 * 1024) return null;
    const ctx = getAudioContext();
    const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
    const channel = buffer.getChannelData(0);
    const count = 120;
    const result = [];
    const stride = Math.max(1, Math.floor(channel.length / count));
    for (let x = 0; x < count; x++) {
      let rms = 0, samples = 0;
      const from = x * stride, to = Math.min(channel.length, from + stride);
      const sampleStep = Math.max(1, Math.floor((to - from) / 320));
      for (let i = from; i < to; i += sampleStep) { rms += channel[i] * channel[i]; samples++; }
      result.push(samples ? Math.max(.05, Math.sqrt(rms / samples)) : .05);
    }
    return result;
  } catch { return null; }
}
function loadFontAsset(asset) {
  if (asset.meta.type !== 'font' || !asset.meta.fontFamily) return;
  try {
    const face = new FontFace(asset.meta.fontFamily, `url(${asset.url})`);
    face.load().then(font => document.fonts.add(font)).catch(() => {});
  } catch { /* optional fonts */ }
}
async function importFiles(fileList) {
  const files = [...fileList];
  if (!files.length) return;
  let added = 0;
  for (const file of files) {
    const type = normalizeAssetType(file);
    if (!type) { toast(`Skipped unsupported file: ${file.name}`); continue; }
    const url = URL.createObjectURL(file);
    try {
      const meta = await getMediaMetadata(file, type, url);
      const asset = { meta, blob: file, url };
      assetMap.set(meta.id, asset);
      if (type === 'font') loadFontAsset(asset);
      try { await saveAsset({ id: meta.id, meta, blob: file }); }
      catch (storageError) { console.warn('Media is available for this session but could not be autosaved', storageError); toast('Media is available now, but browser storage could not keep a recovery copy.', 3600); }
      added++;
    } catch (error) {
      URL.revokeObjectURL(url);
      console.warn('Could not import file', error);
      toast(`Could not read ${file.name}`);
    }
  }
  if (added) {
    renderLibrary();
    renderTracks();
    scheduleAutosave();
    toast(`${added} file${added === 1 ? '' : 's'} added to media`);
  }
  $('#mediaInput').value = '';
}
async function replaceSelectedMedia(file) {
  const clip = clipById(replaceClipId);
  const targetId = replaceClipId;
  replaceClipId = null;
  if (!file || !clip) return;
  const oldKind = clip.kind;
  const type = normalizeAssetType(file);
  if (!type || (oldKind === 'video' && type !== 'video') || (oldKind === 'audio' && type !== 'audio') || (oldKind === 'image' && type !== 'image')) {
    toast(`Choose a ${oldKind} file to replace this clip.`);
    return;
  }
  const before = new Set(assetMap.keys());
  await importFiles([file]);
  const fresh = [...assetMap.values()].filter(asset => !before.has(asset.meta.id) && asset.meta.type === oldKind);
  const current = clipById(targetId);
  if (!fresh.length || !current) return;
  pushHistory();
  current.assetId = fresh[fresh.length - 1].meta.id;
  current.name = noExt(fresh[fresh.length - 1].meta.name);
  current.sourceStart = 0;
  current.duration = Math.min(current.duration || fresh[0].meta.duration, fresh[fresh.length - 1].meta.duration || current.duration);
  if (current.kind === 'video' || current.kind === 'audio') getPlayer(current);
  scheduleAutosave(); renderEditor(); toast('Clip media replaced');
}

function makeClip(kind, opts = {}) {
  return {
    id: makeId('clip'), kind, assetId: opts.assetId || null, name: opts.name || (kind === 'text' ? 'Text' : kind === 'sticker' ? 'Sticker' : 'Clip'),
    trackId: opts.trackId || trackForKind(kind)?.id || state.tracks[0]?.id,
    start: Math.max(0, Number(opts.start ?? state.playhead) || 0), duration: Math.max(.05, Number(opts.duration) || 4),
    sourceStart: Math.max(0, Number(opts.sourceStart) || 0), speed: Number(opts.speed) || 1, volume: Number(opts.volume ?? 1),
    transform: { ...defaultTransform(), ...(opts.transform || {}) }, adjustments: { ...defaultAdjustments(), ...(opts.adjustments || {}) },
    effects: clone(opts.effects || []), transitionIn: opts.transitionIn ? clone(opts.transitionIn) : null,
    keyframes: clone(opts.keyframes || {}), keyframeMode: clone(opts.keyframeMode || {}), keyframeEasing: opts.keyframeEasing || 'linear',
    text: opts.text || '', style: { color: '#ffffff', fontSize: 68, weight: 800, align: 'center', fontFamily: 'Manrope', shadow: true, outline: false, background: false, animation: 'fade', ...(opts.style || {}) },
  };
}
function trackForKind(kind) {
  if (kind === 'audio') return state.tracks.find(track => track.kind === 'audio');
  if (kind === 'text' || kind === 'sticker') return state.tracks.find(track => track.kind === 'text' || track.kind === 'overlay');
  if (kind === 'image') return state.tracks.find(track => track.kind === 'video' || track.kind === 'image' || track.kind === 'overlay');
  if (kind === 'video') return state.tracks.find(track => track.kind === 'video' || track.kind === 'overlay');
  return state.tracks[0];
}
function ensureTrackForKind(kind) {
  let track = trackForKind(kind);
  if (!track) {
    const trackKind = kind === 'audio' ? 'audio' : (kind === 'text' || kind === 'sticker') ? 'text' : 'video';
    track = addTrack(trackKind, false);
  }
  return track;
}
function insertAsset(assetId, options = {}) {
  const asset = assetById(assetId);
  if (!asset) { toast('That media file is no longer available.'); return; }
  if (asset.meta.type === 'font') { toast('Font added. Choose it in a text clip’s properties.'); return; }
  const kind = asset.meta.type === 'image' ? 'image' : asset.meta.type;
  const track = options.trackId ? trackById(options.trackId) : ensureTrackForKind(kind);
  const duration = kind === 'image' ? 5 : Math.max(.1, asset.meta.duration || 4);
  const clip = makeClip(kind, { assetId, name: noExt(asset.meta.name), start: options.start ?? state.playhead, duration, trackId: track?.id });
  pushHistory();
  state.clips.push(clip);
  state.selectedIds = [clip.id];
  if (kind === 'video' || kind === 'audio') getPlayer(clip);
  scheduleAutosave();
  renderEditor();
  toast(`${kind === 'image' ? 'Photo' : kind === 'audio' ? 'Audio' : 'Video'} added to timeline`);
}
function addTrack(kind = 'video', record = true) {
  const labels = { video: 'Video', overlay: 'Overlay', image: 'Image', text: 'Text', audio: 'Audio' };
  const base = labels[kind] || 'Video';
  const index = state.tracks.filter(track => track.kind === kind).length + 1;
  const track = { id: makeId('track'), kind, name: `${base} ${index}`, color: TRACK_COLORS[kind] || TRACK_COLORS.video, locked: false, hidden: false, muted: false };
  if (record) pushHistory();
  // Video overlays stack directly below the main video and before titles.
  if (kind === 'video' || kind === 'overlay' || kind === 'image') {
    const textIndex = state.tracks.findIndex(item => item.kind === 'text');
    state.tracks.splice(textIndex < 0 ? state.tracks.length : textIndex, 0, track);
  } else state.tracks.push(track);
  if (record) { scheduleAutosave(); renderEditor(); toast(`${base} track added`); }
  return track;
}
function deleteTrack(trackId) {
  const track = trackById(trackId);
  if (!track) return;
  if (state.tracks.length <= 1) { toast('A project needs at least one track.'); return; }
  pushHistory();
  const replacement = state.tracks.find(item => item.id !== trackId);
  state.clips.forEach(clip => { if (clip.trackId === trackId) clip.trackId = replacement.id; });
  state.tracks = state.tracks.filter(item => item.id !== trackId);
  scheduleAutosave(); renderEditor(); toast(`${track.name} removed`);
}
function addTextClip(preset = TEXT_PRESETS[0], options = {}) {
  const track = ensureTrackForKind('text');
  const clip = makeClip('text', {
    trackId: options.trackId || track.id,
    name: options.name || preset.name,
    start: options.start ?? state.playhead,
    duration: options.duration || 4,
    text: options.text || 'Type your text',
    style: { ...preset.style, ...(options.style || {}) },
    effects: options.effects || [],
  });
  pushHistory();
  state.clips.push(clip); state.selectedIds = [clip.id];
  scheduleAutosave(); renderEditor();
  toast(`${preset.name} added`);
}
function addSticker(sticker) {
  const track = ensureTrackForKind('text');
  const clip = makeClip('sticker', { trackId: track.id, name: `Sticker ${sticker}`, start: state.playhead, duration: 3, text: sticker, style: { fontSize: 130, color: '#ffffff', weight: 700, align: 'center', shadow: true, animation: 'pop' } });
  pushHistory(); state.clips.push(clip); state.selectedIds = [clip.id]; scheduleAutosave(); renderEditor(); toast('Sticker added to timeline');
}
function addSynthAsset(def, kind) {
  const generated = synthesizeAudio(def, kind);
  const id = makeId(kind === 'music' ? 'music' : 'sfx');
  const label = `${def.name} · ${kind === 'music' ? `${def.bpm} BPM` : 'generated'}`;
  const meta = { id, name: `${def.name}.wav`, type: 'audio', mime: 'audio/wav', size: generated.blob.size, duration: generated.duration, width: 0, height: 0, thumbnail: null, waveform: generated.waveform, addedAt: Date.now(), generated: true, category: def.category, bpm: def.bpm || null };
  const url = URL.createObjectURL(generated.blob);
  const asset = { meta, blob: generated.blob, url };
  assetMap.set(id, asset);
  saveAsset({ id, meta, blob: generated.blob }).catch(error => console.warn('Could not persist generated audio', error));
  insertAsset(id, { start: state.playhead });
  return { asset, label };
}
function playCatalogPreview(def, kind) {
  if (soundPreview) { soundPreview.pause(); URL.revokeObjectURL(soundPreview._objectUrl); soundPreview = null; }
  const rendered = synthesizeAudio(def, kind);
  const url = URL.createObjectURL(rendered.blob);
  const audio = new Audio(url);
  audio._objectUrl = url;
  audio.onended = () => { URL.revokeObjectURL(url); if (soundPreview === audio) soundPreview = null; };
  audio.onerror = () => { URL.revokeObjectURL(url); if (soundPreview === audio) soundPreview = null; };
  audio.play().catch(() => toast('Audio preview is blocked until you interact with the page.'));
  soundPreview = audio;
}

function mediaCard(asset) {
  const m = asset.meta;
  const duration = m.type === 'image' ? 'PHOTO' : m.type === 'font' ? 'FONT' : formatClock(m.duration, 30, false);
  const thumb = m.thumbnail ? `<img src="${m.thumbnail}" alt="">` : `<div class="asset-kind-glyph">${iconForAsset(m.type)}</div>`;
  return `<div class="asset-card" draggable="true" data-asset-card="${safe(m.id)}" title="Drag onto timeline or add at playhead">
    <button class="favorite-button asset-favorite ${state.favorites?.[`asset:${m.id}`] ? 'is-favorite' : ''}" data-action="favorite" data-favorite-key="asset:${safe(m.id)}" title="Favorite media">${state.favorites?.[`asset:${m.id}`] ? '★' : '☆'}</button>
    <div class="asset-thumb">${thumb}<span class="asset-duration">${safe(duration)}</span></div>
    <div class="asset-card-meta"><span title="${safe(m.name)}">${safe(m.name)}</span><button class="asset-add" data-action="add-asset" data-id="${safe(m.id)}" title="Add to timeline">+</button></div>
  </div>`;
}
function searchBox(placeholder = 'Search this library…') {
  return `<div class="library-search"><svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg><input id="librarySearch" type="search" placeholder="${safe(placeholder)}" value="${safe(libraryQuery)}" autocomplete="off"></div>`;
}
function filterChips(items, active, attribute) {
  return `<div class="audio-category">${items.map(item => `<button class="${item === active ? 'active' : ''}" data-${attribute}="${safe(item)}">${safe(item)}</button>`).join('')}</div>`;
}
function favoriteStar(key, isFavorite) {
  return `<button class="favorite-button ${isFavorite ? 'is-favorite' : ''}" data-action="favorite" data-favorite-key="${safe(key)}" title="${isFavorite ? 'Remove from favorites' : 'Add to favorites'}">${isFavorite ? '★' : '☆'}</button>`;
}
function sectionTitle(title, action = '') { return `<div class="library-section-title"><span>${safe(title)}</span>${action}</div>`; }
function waveformArtwork(seed, color = '#9180da', amount = 38) {
  let n = seed >>> 0 || 123;
  return `<div class="card-wave">${Array.from({ length: amount }, () => { n = (n * 1664525 + 1013904223) >>> 0; const h = 4 + (n % 15); return `<i style="height:${h}px;background:${color}"></i>`; }).join('')}</div>`;
}
function renderMediaPanel() {
  const query = libraryQuery.trim().toLowerCase();
  const all = [...assetMap.values()].sort((a, b) => b.meta.addedAt - a.meta.addedAt);
  const visible = all.filter(asset => (mediaFilter === 'all' || mediaFilter === asset.meta.type) && (!mediaFavoritesOnly || state.favorites?.[`asset:${asset.meta.id}`]) && (!query || asset.meta.name.toLowerCase().includes(query)));
  const fonts = visible.filter(asset => asset.meta.type === 'font');
  const media = visible.filter(asset => asset.meta.type !== 'font');
  return `${searchBox('Search project media…')}
    <div class="segmented"><button data-media-filter="all" class="${mediaFilter === 'all' ? 'active' : ''}">All media</button><button data-media-filter="video" class="${mediaFilter === 'video' ? 'active' : ''}">Video</button><button data-media-filter="image" class="${mediaFilter === 'image' ? 'active' : ''}">Photos</button><button data-media-filter="audio" class="${mediaFilter === 'audio' ? 'active' : ''}">Audio</button></div>
    <button class="import-drop" id="importDrop" type="button"><span class="upload-mark"><svg viewBox="0 0 24 24"><path d="M12 16V4m0 0L8 8m4-4 4 4M5 15v5h14v-5"/></svg></span><strong>Import media</strong><small>Video, photo, audio or a font · files stay on this device</small></button>
    ${sectionTitle(`Project media · ${media.length}`, `<button data-action="toggle-media-favorites">${mediaFavoritesOnly ? 'Show all' : '★ Favorites'}</button>`)}
    ${media.length ? `<div class="asset-grid">${media.map(mediaCard).join('')}</div>` : `<div class="empty-library">${mediaFavoritesOnly ? 'No favorite media yet.' : 'Your imported files will appear here.<br>Nothing is uploaded to a server.'}</div>`}
    ${fonts.length ? `${sectionTitle(`Fonts · ${fonts.length}`)}<div class="file-list">${fonts.map(asset => `<div class="file-row"><span class="file-icon">${iconForAsset('font')}</span><span class="file-copy"><strong>${safe(asset.meta.fontFamily)}</strong><small>Installed for this browser project</small></span>${favoriteStar(`asset:${asset.meta.id}`, !!state.favorites?.[`asset:${asset.meta.id}`])}<span class="file-add" title="Font uploaded locally">✓</span></div>`).join('')}</div>` : ''}`;
}
function audioCatalogCard(def, kind) {
  const key = `${kind}:${def.id}`;
  const isFav = !!state.favorites?.[key];
  const icon = kind === 'music' ? '♫' : def.icon;
  const metaLine = kind === 'music' ? `${def.category} · ${def.bpm} BPM` : `${def.category} · ${def.duration.toFixed(1)} sec`;
  const color = def.color || '#7cceaa';
  const art = waveformArtwork(def.key || def.id.split('').reduce((sum, c) => sum + c.charCodeAt(0), 0), color, 31);
  return `<article class="library-card" data-catalog-id="${safe(def.id)}">
    <div class="library-card-top"><span class="library-card-icon" style="color:${safe(color)}">${safe(icon)}</span>${favoriteStar(key, isFav)}</div>
    <strong>${safe(def.name)}</strong><small>${safe(metaLine)}</small>${art}
    <div class="catalog-actions"><button data-action="preview-catalog" data-id="${safe(def.id)}" data-kind="${kind}" title="Preview">▶</button><button data-action="add-catalog" data-id="${safe(def.id)}" data-kind="${kind}">Add to timeline <span>＋</span></button></div>
  </article>`;
}
function renderAudioPanel() {
  const source = audioShelf === 'music' ? MUSIC : SFX;
  const query = libraryQuery.trim().toLowerCase();
  const categories = ['All', ...new Set(source.map(item => item.category))];
  const visible = source.filter(item => (audioCategory === 'All' || item.category === audioCategory) && (!audioFavoritesOnly || state.favorites?.[`${audioShelf}:${item.id}`]) && (!query || `${item.name} ${item.category} ${item.description || ''}`.toLowerCase().includes(query)));
  const chips = filterChips(categories, audioCategory, 'audio-category');
  return `${searchBox(audioShelf === 'music' ? 'Search music moods…' : 'Search generated sound effects…')}
    <div class="segmented"><button data-audio-shelf="music" class="${audioShelf === 'music' ? 'active' : ''}">Music</button><button data-audio-shelf="sfx" class="${audioShelf === 'sfx' ? 'active' : ''}">Sound effects</button></div>
    <div class="shelf-note">${audioShelf === 'music' ? 'Original, procedurally synthesized loops · no stock tracks bundled' : 'Original sounds synthesized locally in your browser'}</div>
    ${chips}<div class="panel-toolbar"><span>${visible.length} sounds</span><button data-action="toggle-audio-favorites">${audioFavoritesOnly ? 'Show all' : '★ Favorites'}</button></div>
    <div class="catalog-list">${visible.map(item => audioCatalogCard(item, audioShelf)).join('') || '<div class="empty-library">No sounds match this view.</div>'}</div>`;
}
function renderTextPanel() {
  const query = libraryQuery.toLowerCase();
  const visible = TEXT_PRESETS.filter(preset => (!textFavoritesOnly || state.favorites?.[`text:${preset.id}`]) && (!query || `${preset.name} ${preset.tag}`.toLowerCase().includes(query)));
  return `${searchBox('Search text styles…')}${sectionTitle('Text presets · editable', `<button data-action="toggle-text-favorites">${textFavoritesOnly ? 'Show all' : '★ Favorites'}</button>`)}
    <div class="catalog-list">${visible.map(preset => `<div class="text-preset-card" data-action="add-text-preset" data-id="${safe(preset.id)}"><span class="preset-preview" style="font-size:${Math.min(26,preset.style.fontSize / 2.5)}px;color:${safe(preset.style.color)};text-shadow:${preset.style.shadow ? '0 2px 7px #000' : 'none'}">${safe(preset.tag)}</span><span class="preset-details"><strong>${safe(preset.name)}</strong><small>${safe(preset.style.animation || 'static')} entrance</small></span>${favoriteStar(`text:${preset.id}`, !!state.favorites?.[`text:${preset.id}`])}<span class="preset-add">＋</span></div>`).join('')}</div>
    <div class="note-card">Choose a preset to place editable text on the timeline. Change copy, font, placement, color and entrance animation in the inspector.</div>`;
}
function renderEffectsPanel() {
  const categories = ['All', ...new Set(EFFECTS.map(effect => effect.category))];
  const query = libraryQuery.toLowerCase();
  const visible = EFFECTS.filter(effect => (effectCategory === 'All' || effect.category === effectCategory) && (!effectFavoritesOnly || state.favorites?.[`effect:${effect.id}`]) && (!query || `${effect.name} ${effect.category} ${effect.description}`.toLowerCase().includes(query)));
  return `${searchBox('Search 16 built-in looks…')}${filterChips(categories, effectCategory, 'effect-category')}
    <div class="panel-toolbar"><span>${visible.length} looks · canvas-rendered</span><button data-action="toggle-effect-favorites">${effectFavoritesOnly ? 'Show all' : '★ Favorites'}</button></div>
    <div class="asset-result-grid">${visible.map(effect => `<article class="library-card effect-card"><div class="library-card-top"><span class="library-card-icon">${safe(effect.icon)}</span>${favoriteStar(`effect:${effect.id}`, !!state.favorites?.[`effect:${effect.id}`])}</div><strong>${safe(effect.name)}</strong><small>${safe(effect.category)}</small><button class="effect-apply" data-action="apply-effect" data-id="${safe(effect.id)}">Apply <span>＋</span></button></article>`).join('')}</div>
    <div class="note-card">Effects are rendered with browser canvas filters and overlays. The applied controls are adjustable on the selected clip.</div>`;
}
function renderTransitionsPanel() {
  const query = libraryQuery.toLowerCase();
  const visible = TRANSITIONS.filter(item => !query || `${item.name} ${item.group}`.toLowerCase().includes(query));
  return `${searchBox('Search transitions…')}${sectionTitle('Clip entrance transitions')}
    <div class="asset-result-grid">${visible.map(item => `<article class="library-card effect-card"><div class="library-card-top"><span class="library-card-icon">${safe(item.icon)}</span>${favoriteStar(`transition:${item.id}`, !!state.favorites?.[`transition:${item.id}`])}</div><strong>${safe(item.name)}</strong><small>${safe(item.group)} · 0.6 sec</small><button class="effect-apply" data-action="apply-transition" data-id="${safe(item.id)}">Apply <span>＋</span></button></article>`).join('')}</div>
    <div class="note-card">Transitions are attached to the selected clip’s entrance. Fade, push, zoom, wipe, spin and flash have real-time canvas previews.</div>`;
}
function renderStickersPanel() {
  const query = libraryQuery.toLowerCase();
  const visible = STICKERS.filter(sticker => (!stickerFavoritesOnly || state.favorites?.[`sticker:${sticker}`]) && (!query || sticker.toLowerCase().includes(query)));
  return `${searchBox('Find a sticker or symbol…')}${sectionTitle('Quick graphics', `<button data-action="toggle-sticker-favorites">${stickerFavoritesOnly ? 'Show all' : '★ Favorites'}</button>`)}
    <div class="sticker-grid">${visible.map(sticker => `<div class="sticker-cell"><button class="sticker-button" data-action="add-sticker" data-id="${safe(sticker)}" title="Add ${safe(sticker)} to timeline">${safe(sticker)}</button>${favoriteStar(`sticker:${sticker}`, !!state.favorites?.[`sticker:${sticker}`])}</div>`).join('') || '<div class="empty-library">No favorite stickers yet.</div>'}</div>
    <div class="note-card">Stickers are editable overlay clips. Import transparent PNG or SVG art from Media to use your own graphics.</div>`;
}
function templateCard(template) {
  const favoriteKey = `template:${template.id}`;
  const fav = !!state.favorites?.[favoriteKey];
  return `<article class="library-card template-card">
    <div class="template-art" style="background:linear-gradient(140deg,${['#3c3157','#253d4a','#4b3636','#2d3b53','#353148','#4b3847'][Number(template.marker) % 6]},#17181f)"><span>${safe(template.tone)}</span></div>
    ${favoriteStar(favoriteKey, fav)}
    <button class="use-template" data-action="use-template" data-id="${safe(template.id)}" title="Use template">＋</button>
    <div class="template-meta"><strong>${safe(template.name)}</strong><small>${safe(template.category)} · ${safe(template.duration)}</small></div>
  </article>`;
}
function renderTemplatesPanel() {
  const categories = ['All', ...new Set(TEMPLATES.map(item => item.category))];
  const query = libraryQuery.toLowerCase();
  const visible = TEMPLATES.filter(item => (templateCategory === 'All' || item.category === templateCategory) && (!templateFavoritesOnly || state.favorites?.[`template:${item.id}`]) && (!query || `${item.name} ${item.category} ${item.tone}`.toLowerCase().includes(query)));
  return `${searchBox('Search creator templates…')}${filterChips(categories, templateCategory, 'template-category')}
    <div class="panel-toolbar"><span>${visible.length} editable starter recipes</span><button data-action="toggle-template-favorites">${templateFavoritesOnly ? 'Show all' : '★ Favorites'}</button></div>
    <div class="asset-result-grid">${visible.map(templateCard).join('') || '<div class="empty-library">No templates match this view.</div>'}</div>
    <div class="note-card">Templates add editable text, a look and a clean opening layout over your footage. Replace the copy, timing, media and effects after applying.</div>`;
}
function renderAiPanel() {
  const query = libraryQuery.trim().toLowerCase();
  const services = AI_SERVICES.filter(item => !query || `${item.name} ${item.detail}`.toLowerCase().includes(query));
  const matchesLocal = !query || 'auto tone frame heuristic detect remove audio silence scan'.includes(query);
  return `${searchBox('Search tools…')}
    <div class="ai-status"><div class="ai-status-icon">✳</div><div><strong>Local tools, honest limits</strong><p>Neurio runs without an AI backend. Local canvas and audio analysis tools are available; cloud/model features are clearly marked below.</p></div></div>
    ${matchesLocal ? `${sectionTitle('Available in this browser')}
    <div class="ai-feature-list"><div class="ai-feature available"><span>Auto tone · frame-based heuristic</span><button data-action="auto-tone">Run</button></div><div class="ai-feature available"><span>Detect / remove audio silence</span><button data-action="scan-silence">Scan</button></div></div>
    ${autoToneReport ? `<div class="note-card">${safe(autoToneReport)}</div>` : ''}
    ${silenceReport ? `<div class="silence-result"><div>${safe(silenceReport.message)}</div>${silenceReport.ranges?.length ? `<button class="inline-action" data-action="remove-silence">Remove detected gaps</button>` : ''}</div>` : ''}` : ''}
    ${services.length ? `${sectionTitle('Model or service required')}
    <div class="ai-feature-list">${services.map(item => `<div class="ai-feature"><span>${safe(item.name)}</span><span>Not connected</span></div>`).join('')}</div>` : ''}
    ${!matchesLocal && !services.length ? '<div class="empty-library">No tools match this search.</div>' : '<div class="note-card">Model-dependent features are unavailable in this offline build. No processing is claimed or performed for them.</div>'}`;
}
const PANEL_META = {
  media: ['PROJECT ASSETS', 'Media'], audio: ['SOUND LIBRARY', 'Audio'], text: ['TITLES & CAPTIONS', 'Text'], effects: ['LOOKS & FINISH', 'Effects'], transitions: ['MOTION BETWEEN CLIPS', 'Transitions'], stickers: ['GRAPHICS', 'Stickers'], templates: ['CREATOR STARTERS', 'Templates'], ai: ['ASSISTED WORKFLOWS', 'AI tools'],
};
function renderLibrary() {
  if (!uiReady) return;
  const meta = PANEL_META[currentPanel] || PANEL_META.media;
  $('#libraryEyebrow').textContent = meta[0]; $('#libraryTitle').textContent = meta[1];
  const renderers = { media: renderMediaPanel, audio: renderAudioPanel, text: renderTextPanel, effects: renderEffectsPanel, transitions: renderTransitionsPanel, stickers: renderStickersPanel, templates: renderTemplatesPanel, ai: renderAiPanel };
  $('#libraryContent').innerHTML = (renderers[currentPanel] || renderMediaPanel)();
  $$('.rail-button[data-panel]').forEach(button => button.classList.toggle('active', button.dataset.panel === currentPanel));
}
function setPanel(panel) { currentPanel = panel; libraryQuery = ''; renderLibrary(); $('#libraryPanel').classList.remove('collapsed'); }

function renderInspector() {
  if (!uiReady) return;
  const clip = selectedClip();
  const selected = selectedClips();
  $('#inspectorTitle').textContent = selected.length > 1 ? `${selected.length} clips selected` : clip ? clip.name : 'Properties';
  $('#selectionText').textContent = selected.length ? `${selected.length} selected` : 'No clip selected';
  $('.selection-indicator').classList.toggle('selected', selected.length > 0);
  $('#resetClipButton').style.visibility = clip ? 'visible' : 'hidden';
  $$('.inspector-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.inspectorTab === activeInspectorTab));
  const content = $('#inspectorContent');
  if (!clip) {
    content.innerHTML = `<div class="inspector-empty"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 9h8M8 13h5"/></svg><strong>Nothing selected</strong><span>Select a clip on the timeline to edit its properties, color or animation.</span></div>`;
    return;
  }
  if (activeInspectorTab === 'color') content.innerHTML = renderColorInspector(clip);
  else if (activeInspectorTab === 'audio') content.innerHTML = renderAudioInspector(clip);
  else if (activeInspectorTab === 'animation') content.innerHTML = renderAnimationInspector(clip);
  else content.innerHTML = renderBasicInspector(clip);
}
function valueAt(clip, property, fallback, time = state.playhead - clip.start) {
  const keys = [...(clip.keyframes?.[property] || [])].sort((a, b) => a.time - b.time);
  if (!keys.length) return fallback;
  if (time <= keys[0].time) return keys[0].value;
  if (time >= keys[keys.length - 1].time) return keys[keys.length - 1].value;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (time < a.time || time > b.time) continue;
    let p = (time - a.time) / Math.max(.0001, b.time - a.time);
    if (a.easing === 'ease-in') p *= p;
    else if (a.easing === 'ease-out') p = 1 - (1 - p) * (1 - p);
    else if (a.easing === 'ease-in-out') p = p < .5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
    return a.value + (b.value - a.value) * p;
  }
  return fallback;
}
function sliderControl(clip, key, label, min, max, step, suffix = '', value = clip.adjustments[key]) {
  const numeric = Number(value);
  const fill = ((numeric - min) / (max - min)) * 100;
  return `<div class="slider-row"><div class="slider-label"><span>${safe(label)}</span><output>${Number(numeric.toFixed(2))}${safe(suffix)}</output></div><span class="slider-range-note">${min}${suffix} / ${max}${suffix}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${numeric}" style="--range-fill:${clamp(fill,0,100)}%" data-prop="${safe(key)}" aria-label="${safe(label)}"></div>`;
}
function numberControl(label, property, value, suffix = '', min = -1000, max = 1000, step = 1) {
  return `<div class="control-row"><label>${safe(label)}</label><div class="control-input"><input type="number" value="${Number(value.toFixed ? value.toFixed(2) : value)}" min="${min}" max="${max}" step="${step}" data-prop="${safe(property)}" aria-label="${safe(label)}"><span>${safe(suffix)}</span></div></div>`;
}
function textStyleControls(clip) {
  const style = clip.style || {};
  const fonts = ['Manrope','DM Sans','Arial','Georgia','Courier New','serif','sans-serif'];
  for (const asset of assetMap.values()) if (asset.meta.type === 'font' && asset.meta.fontFamily && !fonts.includes(asset.meta.fontFamily)) fonts.push(asset.meta.fontFamily);
  return `<div class="control-group"><div class="group-heading">Text content <span class="badge">EDITABLE</span></div><textarea class="text-edit" data-prop="text" aria-label="Text content">${safe(clip.text)}</textarea>
      <div class="control-row"><label>Font</label><select class="control-select" data-prop="fontFamily">${fonts.map(font => `<option ${style.fontFamily === font ? 'selected' : ''} value="${safe(font)}">${safe(font)}</option>`).join('')}</select></div>
      ${numberControl('Size','fontSize',style.fontSize || 68,'px',8,240,1)}
      ${numberControl('Letter spacing','letterSpacing',style.letterSpacing || 0,'px',-10,40,.5)}
      <div class="control-row"><label>Alignment</label><select class="control-select" data-prop="textAlign"><option value="left" ${style.align === 'left' ? 'selected' : ''}>Left</option><option value="center" ${style.align === 'center' ? 'selected' : ''}>Center</option><option value="right" ${style.align === 'right' ? 'selected' : ''}>Right</option></select></div>
      <div class="control-row"><label>Color</label><span class="color-field"><input type="color" value="${safe(style.color || '#ffffff')}" data-prop="textColor" aria-label="Text color"></span></div>
      <div class="control-row"><label>Style</label><label class="modal-check"><input type="checkbox" data-prop="textOutline" ${style.outline ? 'checked' : ''}> Outline</label><label class="modal-check"><input type="checkbox" data-prop="textBackground" ${style.background ? 'checked' : ''}> Backplate</label></div>
      <div class="control-row"><label>Entrance</label><select class="control-select" data-prop="textAnimation"><option value="none" ${style.animation === 'none' ? 'selected' : ''}>None</option><option value="fade" ${style.animation === 'fade' ? 'selected' : ''}>Fade in</option><option value="pop" ${style.animation === 'pop' ? 'selected' : ''}>Pop</option><option value="slide" ${style.animation === 'slide' ? 'selected' : ''}>Slide up</option><option value="typewriter" ${style.animation === 'typewriter' ? 'selected' : ''}>Typewriter</option></select></div></div>`;
}
function renderTimingControls(clip) {
  return `<div class="control-group"><div class="group-heading">Timing</div>${numberControl('Start','start',clip.start,'sec',0,99999,.01)}${numberControl('Duration','duration',clip.duration,'sec',.05,99999,.01)}</div>`;
}
function renderBasicInspector(clip) {
  if (clip.kind === 'text' || clip.kind === 'sticker') {
    return `${textStyleControls(clip)}${renderTimingControls(clip)}${renderTransformControls(clip, true)}${renderTransitionControls(clip)}${renderEffectsApplied(clip)}`;
  }
  const asset = assetById(clip.assetId);
  if (clip.kind === 'audio') {
    return `<div class="control-group"><div class="group-heading">Audio clip <button class="reset-link" data-action="replace-media">Replace audio</button></div>
      <div class="control-row"><label>Source</label><span class="clip-source-label" title="${safe(asset?.meta.name || clip.name)}">${safe(asset?.meta.name || clip.name)}</span></div>
      ${numberControl('Start','start',clip.start,'sec',0,99999,.01)}
      ${numberControl('Duration','duration',clip.duration,'sec',.05,99999,.01)}
      ${numberControl('Source in','sourceStart',clip.sourceStart,'sec',0,99999,.01)}
      ${numberControl('Speed','speed',clip.speed,'×',.1,10,.05)}</div>${renderTransitionControls(clip)}`;
  }
  if (clip.kind === 'image') {
    return `<div class="control-group"><div class="group-heading">Photo <button class="reset-link" data-action="replace-media">Replace image</button></div>
      <div class="control-row"><label>Source</label><span class="clip-source-label" title="${safe(asset?.meta.name || clip.name)}">${safe(asset?.meta.name || clip.name)}</span></div>
      ${numberControl('Start','start',clip.start,'sec',0,99999,.01)}
      ${numberControl('Duration','duration',clip.duration,'sec',.05,99999,.01)}</div>
    ${renderTransformControls(clip, false)}${renderTransitionControls(clip)}${renderEffectsApplied(clip)}`;
  }
  return `<div class="control-group"><div class="group-heading">Clip <button class="reset-link" data-action="replace-media">Replace media</button></div>
      <div class="control-row"><label>Source</label><span class="clip-source-label" title="${safe(asset?.meta.name || clip.name)}">${safe(asset?.meta.name || clip.name)}</span></div>
      ${numberControl('Start','start',clip.start,'sec',0,99999,.01)}
      ${numberControl('Duration','duration',clip.duration,'sec',.05,99999,.01)}
      ${numberControl('Source in','sourceStart',clip.sourceStart,'sec',0,99999,.01)}
      ${numberControl('Speed','speed',clip.speed,'×',.1,10,.05)}</div>
    ${renderTransformControls(clip, false)}${renderTransitionControls(clip)}${renderEffectsApplied(clip)}`;
}
function renderTransformControls(clip, text = false) {
  return `<div class="control-group"><div class="group-heading">Transform <button data-action="reset-transform">Reset</button></div>
    ${numberControl('Position X','x',valueAt(clip,'x',clip.transform.x),'%',-100,100,1)}
    ${numberControl('Position Y','y',valueAt(clip,'y',clip.transform.y),'%',-100,100,1)}
    ${numberControl(text ? 'Text scale' : 'Scale','scale',valueAt(clip,'scale',clip.transform.scale),'×',.05,5,.01)}
    ${numberControl('Rotation','rotation',valueAt(clip,'rotation',clip.transform.rotation),'°',-360,360,1)}
    ${sliderControl(clip,'opacity','Opacity',0,1,.01,'',valueAt(clip,'opacity',clip.transform.opacity))}</div>`;
}
function renderTransitionControls(clip) {
  const transition = clip.transitionIn;
  return `<div class="control-group"><div class="group-heading">Entrance ${transition ? `<button data-action="remove-transition">Remove</button>` : ''}</div>
    ${transition ? `<div class="control-row"><label>Type</label><span class="badge">${safe((TRANSITIONS.find(item => item.id === transition.id)?.name) || transition.id)}</span></div>${numberControl('Duration','transitionDuration',transition.duration,'sec',.1,5,.05)}` : `<div class="note-card compact-note">No transition on this clip. Choose a transition from the left library.</div>`}</div>`;
}
function renderEffectsApplied(clip) {
  const effects = clip.effects || [];
  if (!effects.length) return `<div class="control-group"><div class="group-heading">Applied looks <button data-action="open-effects">Browse</button></div><div class="note-card compact-note">No look applied.</div></div>`;
  return `<div class="control-group"><div class="group-heading">Applied looks <button data-action="open-effects">Browse more</button></div>${effects.map((effect,index) => `<div class="applied-effect"><span>${safe(EFFECTS.find(item => item.id === effect.id)?.name || effect.id)}</span><button data-action="remove-effect" data-index="${index}" title="Remove look">×</button></div>${sliderControl(clip,`effect:${index}`,'Amount',0,1,.01,'',effect.amount ?? .65)}`).join('')}</div>`;
}
function renderColorInspector(clip) {
  if (clip.kind === 'audio') return `<div class="inspector-empty"><svg viewBox="0 0 24 24"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg><strong>Audio has no color controls</strong><span>Use the Audio tab for volume, speed and fades. Model-based EQ and cleanup are not connected.</span></div>`;
  if (clip.kind === 'text' || clip.kind === 'sticker') {
    return `<div class="control-group"><div class="group-heading">Type color</div><div class="control-row"><label>Text color</label><span class="color-field"><input type="color" value="${safe(clip.style.color || '#ffffff')}" data-prop="textColor"></span></div><label class="modal-check"><input type="checkbox" data-prop="textOutline" ${clip.style.outline ? 'checked' : ''}> Outline text</label></div>${renderEffectsApplied(clip)}`;
  }
  return `<div class="control-group"><div class="group-heading">Light & color <button data-action="reset-color">Reset</button></div>
      ${sliderControl(clip,'brightness','Brightness',0,200,1,'%')}
      ${sliderControl(clip,'contrast','Contrast',0,200,1,'%')}
      ${sliderControl(clip,'saturation','Saturation',0,200,1,'%')}
      ${sliderControl(clip,'temperature','Temperature',-100,100,1)}
      ${sliderControl(clip,'tint','Tint',-100,100,1)}
      <div class="note-card compact-note">Adjustments are rendered in the browser preview and export. RGB curves, HSL and LUT processing need a color pipeline not included in this client build.</div>
    </div>${renderEffectsApplied(clip)}`;
}
function renderAudioInspector(clip) {
  const track = trackById(clip.trackId);
  const asset = assetById(clip.assetId);
  if (clip.kind !== 'audio' && clip.kind !== 'video') return `<div class="inspector-empty"><svg viewBox="0 0 24 24"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg><strong>No audio clip selected</strong><span>Select audio or video with source audio to adjust its volume and fades.</span></div>`;
  return `<div class="control-group"><div class="group-heading">Audio source</div><div class="control-row"><label>Track</label><span class="clip-source-label">${safe(track?.name || 'Track')}</span></div><div class="control-row"><label>File</label><span class="clip-source-label" title="${safe(asset?.meta.name || clip.name)}">${safe(asset?.meta.name || clip.name)}</span></div>
      ${sliderControl(clip,'volume','Volume',0,1.5,.01,'×',clip.volume)}
      ${numberControl('Speed','speed',clip.speed,'×',.1,10,.05)}
      ${numberControl('Fade in','fadeIn',clip.fadeIn || 0,'sec',0,12,.05)}
      ${numberControl('Fade out','fadeOut',clip.fadeOut || 0,'sec',0,12,.05)}
      <label class="modal-check"><input type="checkbox" data-prop="clipMute" ${clip.muted ? 'checked' : ''}> Mute this clip</label></div>
      <div class="note-card">Audio plays through the browser’s local media engine. Pitch shifting, EQ and model-based noise reduction are not included.</div>`;
}
function keyframeButton(clip, property, label) {
  const points = clip.keyframes?.[property] || [];
  const t = clamp(state.playhead - clip.start, 0, clip.duration);
  const isKey = points.some(point => Math.abs(point.time - t) <= 1 / state.fps);
  const recording = !!clip.keyframeMode?.[property];
  return `<button class="keyframe-button ${isKey ? 'at-keyframe' : ''} ${recording ? 'recording' : ''}" data-action="keyframe" data-key="${safe(property)}" title="${recording ? 'Stop recording keyframes' : 'Add a keyframe at the playhead'}">${isKey ? '◆' : '◇'} <span>${points.length}</span> ${safe(label)}</button>`;
}
function renderAnimationInspector(clip) {
  const props = [];
  if(clip.kind!=='audio')props.push(
    ['x','Position X',-100,100,1,'%',clip.transform.x], ['y','Position Y',-100,100,1,'%',clip.transform.y],
    ['scale','Scale',.05,5,.01,'×',clip.transform.scale], ['rotation','Rotation',-360,360,1,'°',clip.transform.rotation], ['opacity','Opacity',0,1,.01,'',clip.transform.opacity],
  );
  if(clip.kind==='audio'||clip.kind==='video')props.push(['volume','Volume',0,1.5,.01,'×',clip.volume]);
  if(clip.kind==='video'||clip.kind==='image'){
    props.push(['brightness','Brightness',0,200,1,'%',clip.adjustments.brightness]);
    props.push(['contrast','Contrast',0,200,1,'%',clip.adjustments.contrast]);
    props.push(['saturation','Saturation',0,200,1,'%',clip.adjustments.saturation]);
  }
  return `<div class="control-group"><div class="group-heading">Keyframe animation <span class="badge">${Object.values(clip.keyframes || {}).flat().length} KEYS</span></div>
    <div class="note-card compact-note">Move the playhead, record a value, move again and change it. Values interpolate between keys.</div>
    ${props.map(([key,label,min,max,step,suffix,value]) => `<div class="keyframe-property"><div class="keyframe-property-head"><span>${safe(label)}</span>${keyframeButton(clip,key,label)}</div><div class="control-input"><input type="number" min="${min}" max="${max}" step="${step}" value="${Number(valueAt(clip,key,value).toFixed(2))}" data-prop="${safe(key)}"><span>${safe(suffix)}</span></div></div>`).join('')}
    <div class="control-row"><label>Interpolation</label><select class="control-select" data-prop="keyframeEasing"><option value="linear" ${clip.keyframeEasing === 'linear' ? 'selected' : ''}>Linear</option><option value="ease-in" ${clip.keyframeEasing === 'ease-in' ? 'selected' : ''}>Ease in</option><option value="ease-out" ${clip.keyframeEasing === 'ease-out' ? 'selected' : ''}>Ease out</option><option value="ease-in-out" ${clip.keyframeEasing === 'ease-in-out' ? 'selected' : ''}>Ease in / out</option></select></div>
    ${renderKeyframeStrip(clip)}
  </div>${renderTransitionControls(clip)}`;
}
function renderKeyframeStrip(clip) {
  const keys = Object.entries(clip.keyframes || {}).flatMap(([property, points]) => points.map(point => ({ ...point, property }))).sort((a,b) => a.time-b.time);
  if (!keys.length) return `<div class="keyframe-empty">No keyframes yet. Add one at the current playhead.</div>`;
  return `<div class="keyframe-list">${keys.map(key => `<div class="keyframe-row"><span class="key-dot">◆</span><span>${safe(key.property)}</span><span>${formatClock(key.time,state.fps,false)}</span><button data-action="go-keyframe" data-property="${safe(key.property)}" data-time="${key.time}" title="Go to keyframe">↗</button><button data-action="delete-keyframe" data-property="${safe(key.property)}" data-time="${key.time}" title="Delete keyframe">×</button></div>`).join('')}</div>`;
}
function renderEditor() {
  if (!uiReady) return;
  syncProjectControls();
  renderTracks();
  renderInspector();
  renderLibrary();
  updateHistoryButtons();
  updateTimeDisplay();
  drawPreview();
}

function syncTrackLabelScroll() {
  const scroll=$('#timelineScroll');
  const offset=Math.max(0,scroll.scrollTop-31);
  $('#trackLabelList').style.transform=`translateY(${-offset}px)`;
}
function renderTracks() {
  if (!uiReady) return;
  const labels = $('#trackLabelList');
  const lanes = $('#trackLanes');
  const scroll = $('#timelineScroll');
  const previousScroll = scroll.scrollLeft;
  const duration = projectDuration();
  const visibleDuration = Math.max(24, duration + 10);
  const availableWidth = Math.max(800, (scroll.clientWidth || innerWidth - 480));
  const width = Math.max(availableWidth, visibleDuration * state.zoom);
  timelinePps = state.zoom;
  $('#timelineContent').style.width = `${width}px`;
  $('#timelineRuler').style.width = `${width}px`;
  $('#timelineRuler').style.backgroundSize = `${state.zoom}px 100%`;
  $('#timelineLength').textContent = formatClock(duration, state.fps, false);
  $('#trackCount').textContent = `${state.tracks.length} track${state.tracks.length === 1 ? '' : 's'}`;
  const rulerStep = state.zoom >= 60 ? 1 : state.zoom >= 34 ? 2 : 5;
  let ruler = '';
  for (let second = 0; second <= visibleDuration; second += rulerStep) {
    const x = second * state.zoom;
    ruler += `<span class="ruler-tick" style="left:${x}px"></span><span class="ruler-label" style="left:${x}px">${formatClock(second,state.fps,false)}</span>`;
  }
  $('#timelineRuler').innerHTML = ruler;
  labels.innerHTML = state.tracks.map(track => trackLabel(track)).join('');
  lanes.innerHTML = state.tracks.map(track => {
    const clips = state.clips.filter(clip => clip.trackId === track.id).sort((a,b) => a.start-b.start);
    return `<div class="timeline-lane ${track.locked ? 'locked' : ''} ${track.muted ? 'muted' : ''} ${track.hidden ? 'hidden' : ''}" data-lane-id="${safe(track.id)}" style="background-size:${state.zoom}px 100%">${clips.map(clip => renderClip(clip)).join('')}</div>`;
  }).join('');
  $('#timelinePlayhead').style.left = `${state.playhead * state.zoom}px`;
  $('#timelinePlayhead').style.height = `${31 + state.tracks.length * 59}px`;
  $('#splitButton').disabled = !state.clips.some(clip => clip.start < state.playhead - .02 && clip.start + clip.duration > state.playhead + .02);
  $('#duplicateClipButton').disabled = !selectedClips().length;
  $('#groupClipButton').disabled = selectedClips().length < 2 && !selectedClip()?.groupId;
  const groupIds = [...new Set(selectedClips().map(clip => clip.groupId).filter(Boolean))];
  const isGrouped = groupIds.length === 1 && selectedClips().every(clip => clip.groupId === groupIds[0]);
  $('#groupClipButton').title = isGrouped ? 'Ungroup selected clips' : 'Group selected clips';
  $('#groupClipButton').classList.toggle('grouped', isGrouped);
  $('#deleteClipButton').disabled = !selectedClips().length;
  $('#zoomRange').value = state.zoom;
  scroll.scrollLeft = Math.min(previousScroll, Math.max(0, width - scroll.clientWidth));
  syncTrackLabelScroll();
}
function trackLabel(track) {
  const symbol = track.kind === 'audio' ? '♫' : track.kind === 'text' ? 'T' : track.kind === 'image' ? '▧' : '▰';
  return `<div class="track-label-item" style="--track-color:${safe(track.color)}" data-label-track="${safe(track.id)}">
    <span class="track-label-icon">${symbol}</span><span class="track-label-copy"><span>${safe(track.name)}</span><small>${state.clips.filter(clip => clip.trackId === track.id).length} clips</small></span>
    <button class="track-state-button ${track.hidden ? 'on' : ''}" data-track-action="hide" data-id="${safe(track.id)}" title="${track.hidden ? 'Show' : 'Hide'} track">${track.kind === 'audio' ? '◉' : track.hidden ? '◌' : '◉'}</button>
    <button class="track-state-button ${track.muted ? 'on' : ''}" data-track-action="mute" data-id="${safe(track.id)}" title="${track.muted ? 'Unmute' : 'Mute'} track">${track.kind === 'audio' ? '♫' : 'M'}</button>
    <button class="track-state-button ${track.locked ? 'on' : ''}" data-track-action="lock" data-id="${safe(track.id)}" title="${track.locked ? 'Unlock' : 'Lock'} track">${track.locked ? '▣' : '▢'}</button>
    <button class="track-state-button track-remove" data-track-action="delete" data-id="${safe(track.id)}" title="Remove track">×</button>
  </div>`;
}
function waveformHtml(assetId) {
  const asset = assetById(assetId);
  const values = asset?.meta.waveform;
  if (!values?.length) return '';
  return `<span class="clip-wave">${values.slice(0,84).map(value => `<i style="height:${Math.round(clamp(value,0,1)*14)+2}px"></i>`).join('')}</span>`;
}
function renderClip(clip) {
  const asset = assetById(clip.assetId);
  const isSelected = state.selectedIds.includes(clip.id);
  const typeIcon = clip.kind === 'audio' ? '♫' : clip.kind === 'text' ? 'T' : clip.kind === 'sticker' ? '✦' : clip.kind === 'image' ? '▧' : '▶';
  const color = clip.kind === 'audio' ? '#3fae88' : clip.kind === 'text' || clip.kind === 'sticker' ? '#c47f53' : clip.kind === 'image' ? '#aa70c5' : (trackById(clip.trackId)?.color || '#8271cf');
  const thumbnail = asset?.meta.thumbnail && clip.kind !== 'audio' ? `<span class="clip-visual"><img src="${asset.meta.thumbnail}" alt=""></span>` : '';
  const wave = clip.kind === 'audio' ? waveformHtml(clip.assetId) : '';
  const transition = clip.transitionIn ? `<i class="clip-transition in"></i>` : '';
  const duration = Math.round(clip.duration * state.fps) / state.fps;
  return `<div class="clip ${clip.kind === 'audio' ? 'clip-audio' : clip.kind === 'text' || clip.kind === 'sticker' ? 'clip-text' : clip.kind === 'image' ? 'clip-image' : ''} ${isSelected ? 'selected' : ''} ${clip.groupId ? 'grouped' : ''}" data-clip-id="${safe(clip.id)}" style="left:${clip.start * state.zoom}px;width:${Math.max(16,clip.duration * state.zoom)}px;--clip-color:${safe(color)}" title="${safe(clip.name)} · ${formatClock(duration,state.fps,false)}" tabindex="0">
    ${thumbnail}${transition}<span class="clip-trim left" data-trim="left"></span><span class="clip-main"><span class="clip-type-mark">${typeIcon}</span><span class="clip-name">${safe(clip.name)}</span><span class="clip-duration">${duration.toFixed(1)}s</span></span>${wave}<span class="clip-trim right" data-trim="right"></span>
  </div>`;
}

function updateTimeDisplay() {
  if (!uiReady) return;
  $('#currentTime').textContent = formatClock(state.playhead, state.fps, true);
  $('#totalTime').textContent = formatClock(projectDuration(), state.fps, true);
  $('#timelinePlayhead').style.left = `${state.playhead * state.zoom}px`;
  $('#playButton').classList.toggle('playing', !!state.isPlaying);
  $('#playIcon').classList.toggle('is-playing', !!state.isPlaying);
  $('#playIcon').innerHTML = state.isPlaying ? '<path d="M7 5h4v14H7zM14 5h4v14h-4z"/>' : '<path d="m8 5 12 7-12 7z"/>';
  $('#stageEmpty').classList.toggle('show', state.clips.length === 0);
  $('#splitButton').disabled = !state.clips.some(clip => clip.start < state.playhead - .02 && clip.start + clip.duration > state.playhead + .02);
  $('#duplicateClipButton').disabled = !selectedClips().length;
  $('#groupClipButton').disabled = selectedClips().length < 2 && !selectedClip()?.groupId;
  const groupIds = [...new Set(selectedClips().map(clip => clip.groupId).filter(Boolean))];
  const isGrouped = groupIds.length === 1 && selectedClips().every(clip => clip.groupId === groupIds[0]);
  $('#groupClipButton').title = isGrouped ? 'Ungroup selected clips' : 'Group selected clips';
  $('#groupClipButton').classList.toggle('grouped', isGrouped);
  $('#deleteClipButton').disabled = !selectedClips().length;
}
function setPlayhead(time, follow = false) {
  state.playhead = clamp(time, 0, Math.max(projectDuration(), 0));
  updateTimeDisplay();
  syncPlayers();
  drawPreview();
  if (follow) {
    const scroll = $('#timelineScroll');
    const x = state.playhead * state.zoom;
    const left = scroll.scrollLeft, right = left + scroll.clientWidth;
    if (x < left + 45 || x > right - 45) scroll.scrollLeft = Math.max(0, x - scroll.clientWidth * .35);
  }
}
function togglePlayback(force) {
  const shouldPlay = force ?? !state.isPlaying;
  if (shouldPlay && projectDuration() <= 0) { toast('Add a clip to the timeline before playback.'); return; }
  if (shouldPlay && state.playhead >= projectDuration()) setPlayhead(0);
  state.isPlaying = shouldPlay;
  if (shouldPlay) {
    initAudioGraph().catch(() => {});
    lastRaf = performance.now();
    syncPlayers();
  } else pausePlayers();
  updateTimeDisplay();
}
function animationFrame(now) {
  requestAnimationFrame(animationFrame);
  if (state.isPlaying && !exportSession?.finalizing) {
    const delta = Math.min(.12, Math.max(0, (now - (lastRaf || now)) / 1000));
    lastRaf = now;
    state.playhead = Math.min(projectDuration(), state.playhead + delta);
    syncPlayers();
    if (now - timeUiLast > 60) { updateTimeDisplay(); timeUiLast = now; }
    if (state.playhead >= projectDuration()) {
      state.playhead = projectDuration(); togglePlayback(false);
      if (exportSession?.recording) finishExport(false);
    }
  }
  drawPreview();
}
function mediaPlayerElement(kind) {
  const element = document.createElement(kind === 'audio' ? 'audio' : 'video');
  element.preload = 'auto';
  element.playsInline = true;
  element.setAttribute('playsinline', '');
  element.muted = false;
  element.controls = false;
  element.className = 'offscreen-media-player';
  document.body.appendChild(element);
  return element;
}
function getPlayer(clip) {
  if (!clip || (clip.kind !== 'video' && clip.kind !== 'audio')) return null;
  const asset = assetById(clip.assetId);
  if (!asset) return null;
  let player = playerMap.get(clip.id);
  if (player && player.assetId !== clip.assetId) { disposePlayer(player); player = null; playerMap.delete(clip.id); }
  if (!player) {
    const element = mediaPlayerElement(clip.kind);
    element.src = asset.url;
    element.load();
    player = { clipId: clip.id, assetId: clip.assetId, element, gain: null, source: null, playRequest: null, lastSeek: -99 };
    playerMap.set(clip.id, player);
    element.addEventListener('loadeddata', drawPreview, { once: true });
    if (audioContext) attachAudioSource(player);
  }
  return player;
}
function disposePlayer(player) {
  try { player.element.pause(); player.element.removeAttribute('src'); player.element.load(); } catch { /* media teardown */ }
  try { player.source?.disconnect(); player.gain?.disconnect(); } catch { /* audio graph teardown */ }
  player.element.remove();
}
function clearPlayers() {
  for (const player of playerMap.values()) disposePlayer(player);
  playerMap.clear();
}
function getAudioContext() {
  if (!audioContext) {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) throw new Error('Web Audio is not supported in this browser');
    audioContext = new Context();
    mixedAudioDestination = audioContext.createMediaStreamDestination();
  }
  return audioContext;
}
function attachAudioSource(player) {
  if (!audioContext || player.source) return;
  try {
    player.source = audioContext.createMediaElementSource(player.element);
    player.gain = audioContext.createGain();
    player.source.connect(player.gain);
    player.gain.connect(audioContext.destination);
    player.gain.connect(mixedAudioDestination);
  } catch (error) { console.warn('Audio source routing unavailable', error); }
}
async function initAudioGraph() {
  try {
    const ctx = getAudioContext();
    for (const player of playerMap.values()) attachAudioSource(player);
    if (ctx.state === 'suspended') await ctx.resume();
  } catch (error) { console.info('Using browser media audio without a mix bus', error); }
}
function pausePlayers() {
  for (const player of playerMap.values()) { player.element.pause(); player.playRequest = null; }
}
function syncPlayers() {
  for (const clip of state.clips) {
    if (clip.kind !== 'video' && clip.kind !== 'audio') continue;
    const relative = state.playhead - clip.start;
    const isActive = relative >= 0 && relative < clip.duration;
    let player = playerMap.get(clip.id);
    // Keep only nearby decoders alive; long edits should not preload every source file.
    if (!player && isActive) player = getPlayer(clip);
    if (!player) continue;
    const element = player.element;
    if (!isActive) {
      if (!element.paused) element.pause();
      const distance = relative < 0 ? -relative : relative - clip.duration;
      if (distance > 45) { disposePlayer(player); playerMap.delete(clip.id); }
      continue;
    }
    const track = trackById(clip.trackId);
    if (audioContext && !player.source) attachAudioSource(player);
    let volume = clip.muted || track?.muted ? 0 : clamp(valueAt(clip,'volume',clip.volume,relative), 0, 1.5);
    if (Number(clip.fadeIn) > 0) volume *= clamp(relative / Number(clip.fadeIn),0,1);
    if (clip.transitionIn?.duration > 0 && relative < clip.transitionIn.duration) volume *= clamp(relative / clip.transitionIn.duration,0,1);
    if (Number(clip.fadeOut) > 0 && relative > clip.duration - Number(clip.fadeOut)) volume *= clamp((clip.duration-relative) / Number(clip.fadeOut),0,1);
    if (player.gain) player.gain.gain.setTargetAtTime(volume, audioContext.currentTime, .015);
    else element.volume = Math.min(1, volume);
    if (element.playbackRate !== clip.speed) element.playbackRate = clip.speed;
    const target = Math.max(0, clip.sourceStart + relative * clip.speed);
    if (Math.abs(element.currentTime - target) > (state.isPlaying ? .48 : .001)) {
      try { element.currentTime = target; player.lastSeek = target; } catch { /* wait for metadata */ }
    }
    if (state.isPlaying && element.paused && !player.playRequest) {
      const request = element.play();
      if (request?.catch) player.playRequest = request.catch(() => {}).finally(() => { player.playRequest = null; });
    } else if (!state.isPlaying && !element.paused) element.pause();
  }
}
function getImage(asset) {
  if (!asset) return null;
  let image = imageMap.get(asset.meta.id);
  if (!image) {
    image = new Image();
    image.src = asset.url;
    image.onload = drawPreview;
    imageMap.set(asset.meta.id, image);
  }
  return image;
}
function drawPreview() {
  const canvas = $('#previewCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return;
  const width = canvas.width, height = canvas.height;
  ctx.save(); ctx.setTransform(1,0,0,1,0,0); ctx.fillStyle = '#08090d'; ctx.fillRect(0,0,width,height); ctx.restore();
  const clipList = state.clips.map((clip,index) => ({ clip, index, track: trackById(clip.trackId) }))
    .filter(item => item.track && !item.track.hidden && state.playhead >= item.clip.start && state.playhead < item.clip.start + item.clip.duration)
    .sort((a,b) => state.tracks.indexOf(a.track) - state.tracks.indexOf(b.track) || a.index - b.index);
  const postEffects = [];
  for (const item of clipList) {
    const { clip } = item;
    if (clip.kind === 'video' || clip.kind === 'image') drawVisualClip(ctx, clip, width, height);
    else if (clip.kind === 'text' || clip.kind === 'sticker') drawTextClip(ctx, clip, width, height);
    for (const effect of clip.effects || []) if (['vignette','vhs','grain','glitch'].includes(effect.id)) postEffects.push(effect);
  }
  for (const effect of postEffects) drawPostEffect(ctx, effect, width, height);
}
function transitionValues(clip, width, height) {
  const transition = clip.transitionIn;
  if (!transition || transition.duration <= 0) return { alpha: 1, x: 0, y: 0, scale: 1, rotation: 0, wipe: 1 };
  const progress = clamp((state.playhead - clip.start) / transition.duration, 0, 1);
  const id = transition.id;
  const values = { alpha: 1, x: 0, y: 0, scale: 1, rotation: 0, wipe: 1 };
  if (id === 'fade' || id === 'dissolve' || id === 'blur') values.alpha = progress;
  if (id === 'push-left') values.x = width * (1 - progress);
  if (id === 'push-right') values.x = -width * (1 - progress);
  if (id === 'zoom') values.scale = .68 + .32 * progress;
  if (id === 'spin') { values.scale = .75 + .25 * progress; values.rotation = (1-progress) * -.16; }
  if (id === 'wipe') values.wipe = progress;
  if (id === 'flash') values.alpha = 1;
  if (id === 'glitch') values.x = (Math.floor(progress * 12) % 2 ? 5 : -5) * (1-progress);
  return values;
}
function adjustmentFilter(clip) {
  const a = clip.adjustments || defaultAdjustments();
  const brightness = valueAt(clip,'brightness',a.brightness);
  const contrast = valueAt(clip,'contrast',a.contrast);
  const saturation = valueAt(clip,'saturation',a.saturation);
  const exposure = valueAt(clip,'exposure',a.exposure || 0);
  let blur = 0;
  const fx = (clip.effects || []).map(effect => {
    const amount = clamp(effect.amount ?? .65,0,1);
    if (effect.id === 'blur') { blur += amount * 3; return ''; }
    if (effect.id === 'dream') { blur += amount * 1.5; return ` brightness(${1+amount*.05}) saturate(${1+amount*.12})`; }
    if (effect.id === 'vhs') return ` contrast(${1+amount*.13}) saturate(${1-amount*.2}) sepia(${amount*.2})`;
    if (effect.id === 'film') return ` contrast(${1+amount*.1}) saturate(${1-amount*.08}) sepia(${amount*.13})`;
    if (effect.id === 'cinema') return ` contrast(${1+amount*.22}) saturate(${1-amount*.2})`;
    if (effect.id === 'mono') return ` grayscale(${amount}) contrast(${1+amount*.14})`;
    if (effect.id === 'sepia') return ` sepia(${amount})`;
    if (effect.id === 'fade') return ` contrast(${1-amount*.2}) saturate(${1-amount*.25}) brightness(${1+amount*.06})`;
    if (effect.id === 'warm') return ` sepia(${amount*.34}) saturate(${1+amount*.14})`;
    if (effect.id === 'cool') return ` hue-rotate(${amount*18}deg) saturate(${1-amount*.14})`;
    if (effect.id === 'neon') return ` saturate(${1+amount*1.1}) contrast(${1+amount*.14})`;
    if (effect.id === 'fade-white') return ` brightness(${1+amount*.32}) contrast(${1-amount*.08})`;
    if (effect.id === 'invert') return ` invert(${amount})`;
    return '';
  }).join('');
  return `brightness(${Math.max(0, brightness + exposure * 8)}%) contrast(${Math.max(0, contrast)}%) saturate(${Math.max(0,saturation)}%) blur(${blur}px)${fx}`;
}
function drawVisualClip(ctx, clip, width, height) {
  const asset = assetById(clip.assetId);
  if (!asset) return;
  let source;
  if (clip.kind === 'image') source = getImage(asset);
  else source = getPlayer(clip)?.element;
  if (!source) return;
  const sourceW = clip.kind === 'image' ? source.naturalWidth : source.videoWidth;
  const sourceH = clip.kind === 'image' ? source.naturalHeight : source.videoHeight;
  if (!sourceW || !sourceH || (clip.kind === 'video' && source.readyState < 2)) return;
  const tr = clip.transform || defaultTransform();
  const transition = transitionValues(clip,width,height);
  let opacity = valueAt(clip,'opacity',tr.opacity) * transition.alpha;
  const fadeIn = Number(clip.fadeIn) || 0, fadeOut = Number(clip.fadeOut) || 0;
  const relative = state.playhead - clip.start;
  if (fadeIn > 0 && relative < fadeIn) opacity *= clamp(relative / fadeIn,0,1);
  if (fadeOut > 0 && relative > clip.duration - fadeOut) opacity *= clamp((clip.duration-relative)/fadeOut,0,1);
  ctx.save();
  ctx.globalAlpha = clamp(opacity,0,1);
  const tx = valueAt(clip,'x',tr.x), ty = valueAt(clip,'y',tr.y);
  const scale = valueAt(clip,'scale',tr.scale) * transition.scale;
  const rotation = valueAt(clip,'rotation',tr.rotation) + transition.rotation;
  ctx.translate(width / 2 + (tx / 100) * width + transition.x, height / 2 + (ty / 100) * height);
  ctx.rotate(rotation * Math.PI / 180);
  ctx.scale(scale,scale);
  const fit = Math.min(width / sourceW, height / sourceH);
  const drawW = sourceW * fit, drawH = sourceH * fit;
  ctx.filter = adjustmentFilter(clip);
  if (transition.wipe < 1) {
    const revealWidth = drawW * transition.wipe;
    ctx.beginPath(); ctx.rect(-drawW/2,-drawH/2,revealWidth,drawH); ctx.clip();
    ctx.drawImage(source,-drawW/2,-drawH/2,drawW,drawH);
  } else ctx.drawImage(source,-drawW/2,-drawH/2,drawW,drawH);
  ctx.filter = 'none';
  if (clip.transitionIn?.id === 'flash' && relative < clip.transitionIn.duration * .45) {
    const flash = 1 - relative / Math.max(.01,clip.transitionIn.duration*.45);
    ctx.save();ctx.globalCompositeOperation='screen';ctx.globalAlpha=clamp(flash*.78,0,1)*clamp(opacity,0,1);ctx.fillStyle='#ffffff';ctx.fillRect(-drawW/2,-drawH/2,drawW,drawH);ctx.restore();
  }
  applyClipColorOverlay(ctx,clip,width,height);
  ctx.restore();
}
function applyClipColorOverlay(ctx, clip, width, height) {
  const a = clip.adjustments || {};
  const temperature = clamp(Number(a.temperature)||0,-100,100)/100;
  const tint = clamp(Number(a.tint)||0,-100,100)/100;
  if (Math.abs(temperature) > .01) {
    ctx.save(); ctx.globalAlpha = Math.abs(temperature)*.16; ctx.globalCompositeOperation = 'soft-light';
    ctx.fillStyle = temperature > 0 ? '#ff9d48' : '#4c9de0'; ctx.fillRect(-width/2,-height/2,width,height); ctx.restore();
  }
  if (Math.abs(tint) > .01) {
    ctx.save(); ctx.globalAlpha = Math.abs(tint)*.12; ctx.globalCompositeOperation = 'soft-light';
    ctx.fillStyle = tint > 0 ? '#d55ca5' : '#63c78c'; ctx.fillRect(-width/2,-height/2,width,height); ctx.restore();
  }
}
function wrapCanvasLines(ctx, text, maxWidth) {
  const lines = [];
  for (const paragraph of String(text).split('\n')) {
    const words = paragraph.split(/\s+/);
    let line = '';
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(test).width > maxWidth) { lines.push(line); line = word; }
      else line = test;
    }
    lines.push(line);
  }
  return lines;
}
function drawTextClip(ctx, clip, width, height) {
  const relative = Math.max(0,state.playhead-clip.start);
  const style = clip.style || {};
  const tr = clip.transform || defaultTransform();
  const transition = transitionValues(clip,width,height);
  const entranceDuration = .45;
  let entrance = 1;
  if (style.animation === 'fade') entrance = clamp(relative / entranceDuration,0,1);
  const transformScale = style.animation === 'pop' ? .7 + .3 * clamp(relative/entranceDuration,0,1) : 1;
  const slideY = style.animation === 'slide' ? (1-clamp(relative/entranceDuration,0,1))*height*.06 : 0;
  let text = clip.text || '';
  if (style.animation === 'typewriter') {
    const count = Math.ceil(text.length * clamp(relative/Math.max(1,clip.duration*.45),0,1));
    text = text.slice(0,count);
  }
  const scale = width / 1080;
  const fontSize = clamp(Number(style.fontSize) || 68, 8, 240) * scale;
  ctx.save();
  ctx.globalAlpha = clamp(valueAt(clip,'opacity',tr.opacity) * transition.alpha * entrance,0,1);
  ctx.filter = adjustmentFilter(clip);
  const x = width/2 + (valueAt(clip,'x',tr.x)/100)*width + transition.x;
  const y = height/2 + (valueAt(clip,'y',tr.y)/100)*height + slideY;
  const finalScale = valueAt(clip,'scale',tr.scale) * transition.scale * transformScale;
  ctx.translate(x,y); ctx.rotate((valueAt(clip,'rotation',tr.rotation)+transition.rotation)*Math.PI/180); ctx.scale(finalScale,finalScale);
  const weight = Number(style.weight) || 700;
  const family = style.fontFamily || 'Manrope';
  ctx.font = `${weight} ${fontSize}px "${family.replace(/["\\]/g,'')}"`;
  ctx.textAlign = style.align || 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = style.glow ? (style.color || '#ffffff') : (style.shadow ? '#000000c9' : 'transparent');
  ctx.shadowBlur = style.glow ? 22*scale : style.shadow ? 8*scale : 0;
  ctx.shadowOffsetY = style.shadow && !style.glow ? 3*scale : 0;
  const maxWidth = width * .84;
  if(transition.wipe<1){ctx.beginPath();ctx.rect(-maxWidth/2,-height/2,maxWidth*transition.wipe,height);ctx.clip();}
  const lines = wrapCanvasLines(ctx,text,maxWidth);
  const lineHeight = fontSize * (Number(style.lineSpacing) || 1.12);
  const maxLine = lines.reduce((m,line)=>Math.max(m,ctx.measureText(line).width),0);
  const totalHeight = lines.length*lineHeight;
  if (style.background && lines.length) {
    ctx.save(); ctx.shadowColor='transparent'; ctx.fillStyle = style.backgroundColor || '#11131bcc';
    const px = fontSize*.28, py=fontSize*.18;
    const left = style.align === 'left' ? -maxWidth/2 : style.align === 'right' ? -maxWidth/2+maxWidth-maxLine : -maxLine/2;
    ctx.beginPath(); ctx.roundRect(left-px,-totalHeight/2-py,Math.min(maxWidth,maxLine)+px*2,totalHeight+py*2,fontSize*.12); ctx.fill(); ctx.restore();
  }
  const color = style.color || '#ffffff';
  const startY = -totalHeight/2+lineHeight/2;
  for (let i=0;i<lines.length;i++) {
    const line = lines[i]; const yy = startY+i*lineHeight;
    if (style.outline) { ctx.lineWidth = Math.max(2, fontSize*.07); ctx.strokeStyle = style.outlineColor || '#15131c'; ctx.lineJoin='round'; ctx.strokeText(line,0,yy,maxWidth); }
    ctx.fillStyle = color;
    if (style.letterSpacing && 'letterSpacing' in ctx) ctx.letterSpacing = `${Number(style.letterSpacing)*scale}px`;
    ctx.fillText(line,0,yy,maxWidth);
  }
  if (clip.kind === 'sticker') {
    ctx.font = `${fontSize}px "Apple Color Emoji","Segoe UI Emoji",sans-serif`;
    ctx.fillText(clip.text || '✨',0,0);
  }
  if(clip.transitionIn?.id==='flash'&&relative<clip.transitionIn.duration*.45){const flash=1-relative/Math.max(.01,clip.transitionIn.duration*.45);ctx.save();ctx.globalCompositeOperation='screen';ctx.globalAlpha=clamp(flash*.72,0,1);ctx.fillStyle='#fff';ctx.fillRect(-maxWidth/2,-totalHeight/2,maxWidth,totalHeight);ctx.restore();}
  ctx.filter = 'none';
  ctx.restore();
}
function drawPostEffect(ctx, effect, width, height) {
  const amount = clamp(effect.amount ?? .65,0,1);
  if (effect.id === 'vignette') {
    const gradient = ctx.createRadialGradient(width/2,height/2,Math.min(width,height)*.18,width/2,height/2,Math.max(width,height)*.7);
    gradient.addColorStop(0,'#00000000'); gradient.addColorStop(1,`rgba(0,0,0,${.66*amount})`);
    ctx.fillStyle=gradient; ctx.fillRect(0,0,width,height);
  } else if (effect.id === 'vhs') {
    ctx.save(); ctx.globalAlpha=.11*amount; ctx.fillStyle='#f4eaff';
    for(let y=0;y<height;y+=Math.max(3,Math.round(height/220))) ctx.fillRect(0,y,width,1);
    ctx.restore();
  } else if (effect.id === 'grain') {
    ctx.save(); ctx.globalAlpha=.09*amount; ctx.fillStyle='#ffffff';
    let seed=(Math.floor(state.playhead*12)+61)>>>0;
    for(let i=0;i<Math.round(420*amount);i++){seed=(seed*1664525+1013904223)>>>0;const x=seed%width;seed=(seed*1664525+1013904223)>>>0;const y=seed%height;ctx.fillRect(x,y,1,1);}
    ctx.restore();
  } else if (effect.id === 'glitch') {
    const strips=5; const h=Math.max(1,Math.floor(height/strips));
    for(let i=0;i<strips;i++){ if((i+Math.floor(state.playhead*16))%3===0){ const y=(i*h)%height, shift=(i%2?1:-1)*width*.008*amount; try { ctx.drawImage(ctx.canvas,0,y,width,h,shift,y,width,h); } catch {} } }
  }
}

function addSelection(id, additive = false) {
  const clip = clipById(id);
  const group = clip?.groupId ? state.clips.filter(item => item.groupId === clip.groupId).map(item => item.id) : [id];
  if (additive) {
    const allSelected = group.every(item => state.selectedIds.includes(item));
    state.selectedIds = allSelected ? state.selectedIds.filter(item => !group.includes(item)) : [...new Set([...state.selectedIds, ...group])];
  } else state.selectedIds = group;
  renderTracks(); renderInspector(); updateTimeDisplay();
}
function groupSelected() {
  const clips = selectedClips();
  if (clips.length < 2 && !clips[0]?.groupId) { toast('Select two or more clips to group them.'); return; }
  pushHistory();
  const groupIds = [...new Set(clips.map(clip => clip.groupId).filter(Boolean))];
  const allSameGroup = clips.length > 0 && clips.every(clip => clip.groupId && clip.groupId === clips[0].groupId);
  if (allSameGroup) {
    for (const clip of clips) delete clip.groupId;
    toast('Clips ungrouped');
  } else {
    const id = makeId('group');
    for (const clip of clips) clip.groupId = id;
    toast(`${clips.length} clips grouped`);
  }
  scheduleAutosave(); renderEditor();
}
function snapTime(time, movingClipId) {
  if (!state.snap) return Math.max(0,time);
  const candidates = [0,state.playhead];
  for (const clip of state.clips) if (clip.id !== movingClipId) candidates.push(clip.start,clip.start+clip.duration);
  let best = time, distance = .14;
  for (const candidate of candidates) if (Math.abs(candidate-time) < distance) { best=candidate; distance=Math.abs(candidate-time); }
  return Math.max(0,best);
}
function onClipPointerDown(event) {
  const clipEl = event.target.closest('.clip');
  if (!clipEl) return;
  event.preventDefault();
  const clip = clipById(clipEl.dataset.clipId);
  if (!clip) return;
  const track = trackById(clip.trackId);
  if (track?.locked) { toast(`${track.name} is locked`); return; }
  if (event.shiftKey || event.ctrlKey || event.metaKey) {
    addSelection(clip.id,true);
    return;
  }
  if (!state.selectedIds.includes(clip.id) || state.selectedIds.length > 1) addSelection(clip.id);
  pushHistory();
  const trim = event.target.closest('[data-trim]')?.dataset.trim;
  activeDrag = { kind: trim ? 'trim' : 'move', clipId: clip.id, edge: trim, pointerId: event.pointerId, originX: event.clientX, originY: event.clientY, start: clip.start, duration: clip.duration, sourceStart: clip.sourceStart, trackId: clip.trackId, group: trim ? [] : selectedClips().map(item => ({ id: item.id, start: item.start, trackId: item.trackId })), changed: false };
  $('#timelineScroll').setPointerCapture?.(event.pointerId);
  $(`.clip[data-clip-id="${CSS.escape(clip.id)}"]`)?.classList.add('dragging');
}
function onClipPointerMove(event) {
  if (!activeDrag || activeDrag.pointerId !== event.pointerId) return;
  const drag = activeDrag, clip = clipById(drag.clipId);
  if (!clip) return;
  const delta = (event.clientX-drag.originX)/state.zoom;
  const tracks = $$('#trackLanes .timeline-lane');
  if (drag.kind === 'move') {
    const lane = document.elementFromPoint(event.clientX,event.clientY)?.closest('.timeline-lane');
    const targetTrack = lane ? trackById(lane.dataset.laneId) : null;
    const group=drag.group || [{id:clip.id,start:drag.start,trackId:drag.trackId}];
    const snappedMain=snapTime(drag.start+delta,clip.id);
    const groupDelta=snappedMain-drag.start;
    for (const member of group) {
      const groupedClip = clipById(member.id);
      if (!groupedClip) continue;
      groupedClip.start = Math.max(0,member.start+groupDelta);
      if (groupedClip.id === clip.id && targetTrack && !targetTrack.locked) groupedClip.trackId = targetTrack.id;
    }
  } else if (drag.edge === 'right') {
    clip.duration = Math.min(maxSourceDuration(clip),Math.max(.08, drag.duration + delta));
  } else {
    const minDuration = .08;
    const adjusted = clamp(drag.start + delta, Math.max(0,drag.start+drag.duration-minDuration), drag.start+drag.duration-minDuration);
    const actualDelta = adjusted-drag.start;
    clip.start = adjusted;
    clip.duration = drag.duration-actualDelta;
    clip.sourceStart = Math.max(0,drag.sourceStart+actualDelta*clip.speed);
  }
  drag.changed = drag.changed || Math.abs(delta) > .005;
  const movedClips = drag.kind === 'move' ? (drag.group || []).map(item => clipById(item.id)).filter(Boolean) : [clip];
  for (const moved of movedClips) {
    const el = $(`.clip[data-clip-id="${CSS.escape(moved.id)}"]`);
    if (el) { el.style.left = `${moved.start*state.zoom}px`; el.style.width = `${Math.max(16,moved.duration*state.zoom)}px`; }
  }
  if (drag.kind==='move') {
    for (const lane of $$('.timeline-lane.drop-target')) lane.classList.remove('drop-target');
    const newLane = $(`.timeline-lane[data-lane-id="${CSS.escape(clip.trackId)}"]`); newLane?.classList.add('drop-target');
  }
}
function finishClipDrag(event) {
  if (!activeDrag || (event && activeDrag.pointerId !== event.pointerId)) return;
  const drag = activeDrag;
  $$('.clip.dragging').forEach(el=>el.classList.remove('dragging'));
  $$('.timeline-lane.drop-target').forEach(el=>el.classList.remove('drop-target'));
  activeDrag = null;
  if (drag.changed) { scheduleAutosave(); renderTracks(); renderInspector(); }
  else { undoStack.pop(); updateHistoryButtons(); }
}
function splitSelected() {
  const time = state.playhead;
  let affected = selectedClips().filter(clip => !trackById(clip.trackId)?.locked && clip.start < time-.02 && clip.start+clip.duration > time+.02);
  if (!affected.length) affected = state.clips.filter(clip => !trackById(clip.trackId)?.locked && clip.start < time-.02 && clip.start+clip.duration > time+.02);
  if (!affected.length) { toast('Move the playhead inside an unlocked clip to split it.'); return; }
  pushHistory();
  const created=[];
  for (const clip of affected) {
    const leftDuration=time-clip.start;
    const right=clone(clip); right.id=makeId('clip'); right.start=time; right.duration=clip.duration-leftDuration;
    right.sourceStart=clip.sourceStart+leftDuration*clip.speed;
    clip.duration=leftDuration;
    created.push(right);
  }
  state.clips.push(...created); state.selectedIds=created.map(item=>item.id);
  scheduleAutosave(); renderEditor(); toast(`Split ${created.length} clip${created.length===1?'':'s'}`);
}
function deleteSelected() {
  if (!state.selectedIds.length) return;
  const removable=selectedClips().filter(clip=>!trackById(clip.trackId)?.locked);
  if(!removable.length){toast('Unlock the track before deleting its clips.');return;}
  const removed = new Set(removable.map(clip=>clip.id));
  pushHistory();
  state.clips=state.clips.filter(clip=>!removed.has(clip.id));
  for (const id of removed) {
    const player=playerMap.get(id);
    if(player){disposePlayer(player);playerMap.delete(id);}
  }
  state.selectedIds=state.selectedIds.filter(id=>!removed.has(id)); scheduleAutosave(); renderEditor(); toast(`${removed.size} clip${removed.size===1?'':'s'} deleted`);
}
function duplicateSelected() {
  const originals=selectedClips().filter(clip=>!trackById(clip.trackId)?.locked); if(!originals.length){toast('Unlock the track before duplicating clips.');return;}
  pushHistory();
  const groupMap=new Map();
  const duplicates=originals.map(clip=>{const copy={...clone(clip),id:makeId('clip'),start:clip.start+clip.duration,trackId:clip.trackId};if(clip.groupId){if(!groupMap.has(clip.groupId))groupMap.set(clip.groupId,makeId('group'));copy.groupId=groupMap.get(clip.groupId);}return copy;});
  state.clips.push(...duplicates); state.selectedIds=duplicates.map(clip=>clip.id); scheduleAutosave(); renderEditor(); toast(`${duplicates.length} clip${duplicates.length===1?'':'s'} duplicated`);
}
function copySelected() {
  const chosen=selectedClips(); if(!chosen.length)return;
  try { sessionStorage.setItem('neurio-clip-clipboard',JSON.stringify(chosen)); toast(`${chosen.length} clip${chosen.length===1?'':'s'} copied`); } catch { toast('Could not copy clips'); }
}
function pasteClips() {
  try {
    const copied=JSON.parse(sessionStorage.getItem('neurio-clip-clipboard')||'[]');
    if(!copied.length)return;
    pushHistory(); const minStart=Math.min(...copied.map(item=>item.start));
    const inserted=copied.map(item=>({...clone(item),id:makeId('clip'),start:Math.max(0,state.playhead+(item.start-minStart))}));
    state.clips.push(...inserted); state.selectedIds=inserted.map(item=>item.id); scheduleAutosave(); renderEditor(); toast('Clips pasted');
  }catch{toast('Clipboard is empty');}
}
function applyEffect(id) {
  const clips=selectedClips().filter(clip=>['video','image','text','sticker'].includes(clip.kind)); if(!clips.length){toast('Select a video, photo or text overlay first.');return;}
  const definition=EFFECTS.find(item=>item.id===id); if(!definition)return;
  pushHistory();
  for(const clip of clips){
    clip.effects=clip.effects||[];
    const existing=clip.effects.find(effect=>effect.id===id);
    if(existing)existing.amount=clamp((existing.amount||.65)+.2,0,1);
    else clip.effects.push({id,amount:.65});
  }
  scheduleAutosave();renderEditor();toast(`${definition.name} applied`);
}
function applyTransition(id) {
  const clips=selectedClips(); if(!clips.length){toast('Select a clip before applying a transition.');return;}
  pushHistory();
  for(const clip of clips)clip.transitionIn={id,duration:.6};
  scheduleAutosave();renderEditor();toast('Entrance transition applied');
}
function addKeyframe(clip, property, useCurrent = true) {
  const time=clamp(state.playhead-clip.start,0,clip.duration);
  if(!clip.keyframes[property])clip.keyframes[property]=[];
  const base=property==='x'||property==='y'||property==='scale'||property==='rotation'||property==='opacity'?clip.transform[property]:property==='volume'?clip.volume:clip.adjustments[property];
  const value=useCurrent?valueAt(clip,property,Number(base)||0,time):Number(base)||0;
  const point={time,value,easing:clip.keyframeEasing || 'linear'};
  const found=clip.keyframes[property].findIndex(key=>Math.abs(key.time-time)<.001);
  if(found>=0)clip.keyframes[property][found]=point;else clip.keyframes[property].push(point);
  clip.keyframes[property].sort((a,b)=>a.time-b.time);
}
function setClipProperty(clip, property, value) {
  if (!clip) return;
  if (property === 'start') { clip.start = Math.max(0, Number(value)||0); return; }
  if (property === 'duration') { clip.duration = Math.min(maxSourceDuration(clip),Math.max(.05, Number(value)||.05)); return; }
  if (property === 'sourceStart') { clip.sourceStart = Math.max(0, Number(value)||0); return; }
  if (property === 'transitionDuration') { if(clip.transitionIn)clip.transitionIn.duration=clamp(value,.1,5); return; }
  if (property === 'text') { clip.text=String(value); return; }
  if (property === 'fontFamily') { clip.style.fontFamily=String(value);return; }
  if (property === 'fontSize') { clip.style.fontSize=clamp(value,8,240);return; }
  if (property === 'letterSpacing') { clip.style.letterSpacing=clamp(value,-10,40);return; }
  if (property === 'textAlign') { clip.style.align=value;return; }
  if (property === 'textColor') { clip.style.color=value;return; }
  if (property === 'textOutline') { clip.style.outline=!!value;return; }
  if (property === 'textBackground') { clip.style.background=!!value;return; }
  if (property === 'textAnimation') { clip.style.animation=value;return; }
  if (property === 'clipMute') { clip.muted=!!value;return; }
  if (property === 'keyframeEasing') {
    clip.keyframeEasing=value;
    for(const keys of Object.values(clip.keyframes||{})) { const point=keys.find(key=>Math.abs(key.time-(state.playhead-clip.start))<.15); if(point)point.easing=value; }
    return;
  }
  if (property === 'x'||property==='y'||property==='scale'||property==='rotation'||property==='opacity') {
    const parsed=Number(value);
    if(clip.keyframeMode?.[property]){
      addKeyframe(clip,property,false);
      const key=clip.keyframes[property].find(point=>Math.abs(point.time-(state.playhead-clip.start))<.001); if(key)key.value=parsed;
    }else clip.transform[property]=parsed;
    return;
  }
  if (property === 'speed') { clip.speed=clamp(value,.1,10);clip.duration=Math.min(clip.duration,maxSourceDuration(clip));return; }
  if (property === 'volume') {
    const parsed=clamp(value,0,1.5);
    if(clip.keyframeMode?.[property]){addKeyframe(clip,property,false);const key=clip.keyframes[property].find(point=>Math.abs(point.time-(state.playhead-clip.start))<.001);if(key)key.value=parsed;}
    else clip.volume=parsed;
    return;
  }
  if (property === 'fadeIn'||property==='fadeOut') { clip[property]=clamp(value,0,12);return; }
  if (property in (clip.adjustments||{})) {
    const parsed=Number(value);
    if(clip.keyframeMode?.[property]){
      addKeyframe(clip,property,false);
      const key=clip.keyframes[property].find(point=>Math.abs(point.time-(state.playhead-clip.start))<.001); if(key)key.value=parsed;
    }else clip.adjustments[property]=parsed;
    return;
  }
}
function beginInspectorEdit(event) {
  const target=event.target.closest('[data-prop]');
  if(!target||target.dataset.historyOpen)return;
  target.dataset.historyOpen='1'; target._historyBefore=getSnapshot();
}
function finishInspectorEdit(event) {
  const target=event.target.closest('[data-prop]');
  if(!target||!target.dataset.historyOpen)return;
  target.dataset.historyOpen='';
  target._historyBefore=null;
  redoStack.length=0;updateHistoryButtons();scheduleAutosave();
  if(target.type==='number') renderTracks();
  renderInspector(); drawPreview(); syncPlayers();
}
function handleInspectorProp(event) {
  const control=event.target.closest('[data-prop]'); if(!control)return;
  const clip=selectedClip();if(!clip)return;
  const key=control.dataset.prop;
  let value;
  if(control.type==='checkbox')value=control.checked;
  else value=control.value;
  if(control.type==='range'){
    const slider=control.closest('.slider-row');const output=slider?.querySelector('output');if(output)output.textContent=`${Number(value).toFixed(2)}${key==='volume'?'×':key==='brightness'||key==='contrast'||key==='saturation'?'%':''}`;
    control.style.setProperty('--range-fill',`${(Number(value)-Number(control.min))/(Number(control.max)-Number(control.min))*100}%`);
  }
  if(key.startsWith('effect:')){
    const index=Number(key.split(':')[1]);if(clip.effects?.[index])clip.effects[index].amount=clamp(value,0,1);
  }else setClipProperty(clip,key,value);
  drawPreview();syncPlayers();
}
function resetClip() {
  const clip=selectedClip();if(!clip)return;
  pushHistory();
  clip.transform=defaultTransform();clip.adjustments=defaultAdjustments();clip.speed=1;clip.volume=1;clip.fadeIn=0;clip.fadeOut=0;clip.effects=[];clip.transitionIn=null;clip.keyframes={};clip.keyframeMode={};
  scheduleAutosave();renderEditor();toast('Clip controls reset');
}
function resetClipTransform() {
  const clip=selectedClip();if(!clip)return;
  pushHistory();clip.transform=defaultTransform();scheduleAutosave();renderInspector();drawPreview();
}
function resetClipColor() {
  const clip=selectedClip();if(!clip)return;
  pushHistory();clip.adjustments=defaultAdjustments();scheduleAutosave();renderInspector();drawPreview();
}
function removeAppliedEffect(index) {
  const clip=selectedClip();if(!clip)return;
  pushHistory();clip.effects.splice(index,1);scheduleAutosave();renderEditor();
}
function removeTransition() {
  const clip=selectedClip();if(!clip)return;
  pushHistory();clip.transitionIn=null;scheduleAutosave();renderEditor();
}
function toggleKeyframe(property) {
  const clip=selectedClip();if(!clip)return;
  pushHistory();clip.keyframeMode=clip.keyframeMode||{};
  const active=!clip.keyframeMode[property];clip.keyframeMode[property]=active;
  if(active)addKeyframe(clip,property,true);
  scheduleAutosave();renderInspector();drawPreview();toast(active?'Keyframe recording enabled':'Keyframe recording paused');
}
function focusKeyframe(property,time) { setPlayhead(clipStartForKeyframe(property,time),true); }
function clipStartForKeyframe(property,time) { const clip=selectedClip();return clip?clip.start+Number(time):0; }
function removeKeyframe(property,time) {
  const clip=selectedClip();if(!clip)return;
  pushHistory();clip.keyframes[property]=(clip.keyframes[property]||[]).filter(key=>Math.abs(key.time-Number(time))>.001);if(!clip.keyframes[property].length)delete clip.keyframes[property];scheduleAutosave();renderInspector();drawPreview();
}

function applyTemplate(templateId) {
  const template=TEMPLATES.find(item=>item.id===templateId);if(!template)return;
  const visuals=state.clips.some(clip=>clip.kind==='video'||clip.kind==='image');
  if(!visuals){toast('Import a video or photo first to use a visual template.');setPanel('media');return;}
  const preset=TEXT_PRESETS.find(item=>item.id===template.style)||TEXT_PRESETS[0];
  const visual=state.clips.find(clip=>(clip.kind==='video'||clip.kind==='image')&&clip.start<=state.playhead&&clip.start+clip.duration>state.playhead)||state.clips.find(clip=>clip.kind==='video'||clip.kind==='image');
  const start=Math.max(0,visual?.start ?? state.playhead);
  const duration=Math.min(visual?.duration||5,8);
  const track=ensureTrackForKind('text');
  const title=makeClip('text',{trackId:track.id,name:`${template.name} · Title`,start,duration,text:template.title,style:{...preset.style,fontSize:Math.min(82,preset.style.fontSize||68),animation:preset.style.animation||'fade',align:'center'}});
  const caption=makeClip('text',{trackId:track.id,name:`${template.name} · Caption`,start:start+Math.max(0,duration*.18),duration:Math.max(1,duration*.68),text:template.caption,style:{fontSize:21,color:'#eee9f9',weight:600,align:'center',shadow:true,background:false,animation:'fade',letterSpacing:2}});
  pushHistory();state.clips.push(title,caption);state.selectedIds=[title.id];
  if(visual&&!visual.effects?.some(effect=>effect.id===template.effect))visual.effects=[...(visual.effects||[]),{id:template.effect,amount:.48}];
  state.playhead=start;scheduleAutosave();renderEditor();setPanel('media');toast(`${template.name} added · text and look are editable`);
}
function addAssetAtPointer(assetId,event) {
  const lane=event.target.closest('.timeline-lane');
  const track=lane?trackById(lane.dataset.laneId):null;
  const scroll=$('#timelineScroll');const rect=scroll.getBoundingClientRect();
  const time=clamp((event.clientX-rect.left+scroll.scrollLeft)/state.zoom,0,99999);
  insertAsset(assetId,{start:time,trackId:track?.id});
}

async function autoTone() {
  const clip=selectedClip();if(!clip){toast('Select a video or photo clip first.');return;}
  if(clip.kind!=='video'&&clip.kind!=='image'){toast('Auto tone is for video and photo clips.');return;}
  const canvas=$('#previewCanvas');
  try {
    const sample=document.createElement('canvas');sample.width=32;sample.height=32;
    const ctx=sample.getContext('2d',{willReadFrequently:true});ctx.drawImage(canvas,0,0,32,32);
    const data=ctx.getImageData(0,0,32,32).data;let sum=0;for(let i=0;i<data.length;i+=4)sum+=.2126*data[i]+.7152*data[i+1]+.0722*data[i+2];
    const mean=sum/(data.length/4);const brightness=clamp(100+(128-mean)*.42,72,138);
    pushHistory();clip.adjustments.brightness=Math.round(brightness);clip.adjustments.contrast=Math.round(clamp(100+(120-mean)*.08,88,120));
    autoToneReport=`Applied a local brightness/contrast heuristic to the current preview frame (average luma ${Math.round(mean)}). This is not an AI model.`;
    scheduleAutosave();renderEditor();toast('Auto tone applied from current frame');
  }catch(error){toast('Could not sample this preview frame.');console.warn(error);}
}
async function decodeAssetAudio(asset) {
  if(!asset)throw new Error('Select an audio file first.');
  const ctx=getAudioContext();
  return ctx.decodeAudioData(await asset.blob.arrayBuffer());
}
async function scanSilence() {
  const clip=selectedClip();
  if(!clip||clip.kind!=='audio'){silenceReport={message:'Select an audio clip on the timeline to scan its source.'};renderLibrary();return;}
  const asset=assetById(clip.assetId);if(!asset){silenceReport={message:'The source audio file is not available.'};renderLibrary();return;}
  silenceReport={message:'Analyzing audio locally…'};setPanel('ai');renderLibrary();
  try{
    const buffer=await decodeAssetAudio(asset);const rate=buffer.sampleRate;const windowSize=Math.max(1,Math.round(rate*.02));const threshold=.009;const minSilence=.38;
    const channelData=Array.from({length:buffer.numberOfChannels},(_,i)=>buffer.getChannelData(i));
    const sourceStart=clip.sourceStart;const sourceEnd=sourceStart+clip.duration*clip.speed;const frames=[];
    for(let start=Math.floor(sourceStart*rate/windowSize)*windowSize;start<Math.min(buffer.length,sourceEnd*rate);start+=windowSize){
      const end=Math.min(buffer.length,start+windowSize);let sum=0,count=0;
      const sampleStep=Math.max(4,Math.floor(windowSize/24));
      for(const channel of channelData){for(let i=start;i<end;i+=sampleStep){sum+=channel[i]*channel[i];count++;}}
      frames.push({time:start/rate,rms:count?Math.sqrt(sum/count):0});
    }
    const raw=[];let silenceStart=null;
    for(const frame of frames){if(frame.rms<threshold){if(silenceStart===null)silenceStart=frame.time;}else if(silenceStart!==null){const end=frame.time;if(end-silenceStart>=minSilence)raw.push([silenceStart,end]);silenceStart=null;}}
    if(silenceStart!==null&&frames.length){const end=frames[frames.length-1].time;if(end-silenceStart>=minSilence)raw.push([silenceStart,end]);}
    const ranges=raw.map(([from,to])=>[Math.max(0,(from-sourceStart)/clip.speed),Math.min(clip.duration,(to-sourceStart)/clip.speed)]).filter(([a,b])=>b-a>=minSilence);
    const total=ranges.reduce((sum,[a,b])=>sum+b-a,0);
    silenceReport={clipId:clip.id,ranges,total,message:ranges.length?`Found ${ranges.length} quiet gap${ranges.length===1?'':'s'} (${total.toFixed(1)} seconds total) in “${clip.name}”.`:`No quiet gaps longer than ${minSilence.toFixed(1)} seconds found in “${clip.name}”.`};
    renderLibrary();
  }catch(error){silenceReport={message:`Could not decode this audio format in the current browser. ${error.message||''}`};renderLibrary();}
}
function removeDetectedSilence() {
  const scan=silenceReport;const clip=clipById(scan?.clipId);if(!clip||!scan.ranges?.length){toast('Run a silence scan on the selected clip first.');return;}
  const keep=[];let cursor=0;
  for(const [from,to] of scan.ranges){const a=clamp(from,cursor,clip.duration),b=clamp(to,a,clip.duration);if(a-cursor>.04)keep.push([cursor,a]);cursor=b;}
  if(clip.duration-cursor>.04)keep.push([cursor,clip.duration]);
  if(!keep.length){toast('The scan found no audio left after trimming.');return;}
  pushHistory();
  const originalStart=clip.start,originalEnd=clip.start+clip.duration,originalId=clip.id;
  const keptDuration=keep.reduce((sum,[a,b])=>sum+b-a,0),removed=clip.duration-keptDuration;
  const template=clone(clip);
  state.clips=state.clips.filter(item=>item.id!==originalId);
  let timelineOffset=0;
  const segments=keep.map(([from,to],index)=>{
    const copy=clone(template);copy.id=index===0?originalId:makeId('clip');copy.start=originalStart+timelineOffset;copy.duration=to-from;copy.sourceStart=template.sourceStart+from*template.speed;timelineOffset+=copy.duration;return copy;
  });
  state.clips.push(...segments);
  for(const other of state.clips)if(other.id!==originalId&&other.trackId===template.trackId&&other.start>=originalEnd-.001)other.start=Math.max(0,other.start-removed);
  state.selectedIds=segments.map(item=>item.id);silenceReport=null;scheduleAutosave();renderEditor();toast(`Removed ${removed.toFixed(1)} sec of detected silence`);
}

function favoriteToggle(key) {
  state.favorites=state.favorites||{};pushHistory();
  if(state.favorites[key])delete state.favorites[key];else state.favorites[key]=true;
  scheduleAutosave();renderLibrary();
}
function handleLibraryClick(event) {
  const target=event.target.closest('button,[data-asset-card],[data-action]');if(!target)return;
  if(target.matches('[data-asset-card]')&&!event.target.closest('button')){insertAsset(target.dataset.assetCard);return;}
  const mediaFilterButton=target.closest('[data-media-filter]');if(mediaFilterButton){mediaFilter=mediaFilterButton.dataset.mediaFilter;renderLibrary();return;}
  const shelf=target.closest('[data-audio-shelf]');if(shelf){audioShelf=shelf.dataset.audioShelf;audioCategory='All';audioFavoritesOnly=false;renderLibrary();return;}
  const audioCat=target.closest('[data-audio-category]');if(audioCat){audioCategory=audioCat.dataset.audioCategory;renderLibrary();return;}
  const effectCat=target.closest('[data-effect-category]');if(effectCat){effectCategory=effectCat.dataset.effectCategory;renderLibrary();return;}
  const templateCat=target.closest('[data-template-category]');if(templateCat){templateCategory=templateCat.dataset.templateCategory;renderLibrary();return;}
  const action=target.dataset.action;
  if(action==='add-asset')insertAsset(target.dataset.id);
  else if(action==='favorite')favoriteToggle(target.dataset.favoriteKey);
  else if(action==='preview-catalog'){
    const def=(target.dataset.kind==='music'?MUSIC:SFX).find(item=>item.id===target.dataset.id);if(def)playCatalogPreview(def,target.dataset.kind);
  }else if(action==='add-catalog'){
    const list=target.dataset.kind==='music'?MUSIC:SFX;const def=list.find(item=>item.id===target.dataset.id);if(def){const result=addSynthAsset(def,target.dataset.kind);toast(`${result.asset.meta.name} generated and added`);}
  }else if(action==='toggle-audio-favorites'){audioFavoritesOnly=!audioFavoritesOnly;renderLibrary();}
  else if(action==='toggle-template-favorites'){templateFavoritesOnly=!templateFavoritesOnly;renderLibrary();}
  else if(action==='toggle-media-favorites'){mediaFavoritesOnly=!mediaFavoritesOnly;renderLibrary();}
  else if(action==='toggle-effect-favorites'){effectFavoritesOnly=!effectFavoritesOnly;renderLibrary();}
  else if(action==='toggle-text-favorites'){textFavoritesOnly=!textFavoritesOnly;renderLibrary();}
  else if(action==='toggle-sticker-favorites'){stickerFavoritesOnly=!stickerFavoritesOnly;renderLibrary();}
  else if(action==='add-text-preset'){const preset=TEXT_PRESETS.find(item=>item.id===target.dataset.id);if(preset)addTextClip(preset);}
  else if(action==='apply-effect')applyEffect(target.dataset.id);
  else if(action==='apply-transition')applyTransition(target.dataset.id);
  else if(action==='add-sticker')addSticker(target.dataset.id);
  else if(action==='use-template')applyTemplate(target.dataset.id);
  else if(action==='auto-tone')autoTone();
  else if(action==='scan-silence')scanSilence();
  else if(action==='remove-silence')removeDetectedSilence();
}
function handleLibraryInput(event) {
  const search=event.target.closest('#librarySearch');if(!search)return;
  libraryQuery=search.value;
  const position=search.selectionStart;
  renderLibrary();
  const replacement=$('#librarySearch');replacement?.focus();replacement?.setSelectionRange(position,position);
}

function handleInspectorClick(event) {
  const tab=event.target.closest('[data-inspector-tab]');if(tab){activeInspectorTab=tab.dataset.inspectorTab;renderInspector();return;}
  const actionButton=event.target.closest('[data-action]');if(!actionButton)return;
  const clip=selectedClip();const action=actionButton.dataset.action;
  if(action==='keyframe')toggleKeyframe(actionButton.dataset.key);
  else if(action==='reset-transform')resetClipTransform();
  else if(action==='reset-color')resetClipColor();
  else if(action==='remove-effect')removeAppliedEffect(Number(actionButton.dataset.index));
  else if(action==='remove-transition')removeTransition();
  else if(action==='open-effects')setPanel('effects');
  else if(action==='replace-media'&&clip){replaceClipId=clip.id;$('#replaceInput').click();}
  else if(action==='go-keyframe')setPlayhead(clip.start+Number(actionButton.dataset.time),true);
  else if(action==='delete-keyframe')removeKeyframe(actionButton.dataset.property,actionButton.dataset.time);
}
function handleInspectorChange(event) {
  const control=event.target.closest('[data-prop]');if(!control)return;
  const clip=selectedClip();if(!clip)return;
  if(control.type==='range'||control.type==='number'){
    // range/number values are applied live by the input listener.
  }else handleInspectorProp(event);
  finishInspectorEdit(event);
}
function handleInspectorInput(event) {
  const control=event.target.closest('[data-prop]');if(!control)return;
  handleInspectorProp(event);
  if(control.type==='range'||control.tagName==='TEXTAREA'||control.type==='text'){
    scheduleAutosave();
  }
}
function beginHistoryEdit(event) {
  const target=event.target.closest('[data-prop]');if(!target||target.dataset.historyOpen)return;
  target.dataset.historyOpen='1';
  const before=getSnapshot();
  // Push the pre-edit state directly; live slider frames remain a single undo step.
  undoStack.push(before);if(undoStack.length>80)undoStack.shift();redoStack.length=0;updateHistoryButtons();
}

function toggleTrackState(trackId, action) {
  const track=trackById(trackId);if(!track)return;
  pushHistory();
  if(action==='lock')track.locked=!track.locked;
  else if(action==='hide')track.hidden=!track.hidden;
  else if(action==='mute')track.muted=!track.muted;
  else if(action==='delete'){undoStack.pop();updateHistoryButtons();deleteTrack(trackId);return;}
  scheduleAutosave();renderEditor();
}
function handleTrackLabels(event) {
  const button=event.target.closest('[data-track-action]');if(button){toggleTrackState(button.dataset.id,button.dataset.trackAction);return;}
  const label=event.target.closest('[data-label-track]');if(label){const track=trackById(label.dataset.labelTrack);if(track)toast(`${track.name}${track.locked?' · locked':''}${track.muted?' · muted':''}`);}
}
function seekFromTimeline(event) {
  const scroll=$('#timelineScroll');const rect=scroll.getBoundingClientRect();
  const x=event.clientX-rect.left+scroll.scrollLeft;
  setPlayhead(clamp(x/state.zoom,0,projectDuration()),false);
}
function beginTimelineScrub(event) {
  if(event.button!==undefined&&event.button!==0)return;
  if(event.target.closest('.clip'))return;
  if(event.target.closest('.timeline-ruler,.timeline-lane,.playhead-cap')){timelineScrubbing=true;event.preventDefault();if(event.target.closest('.playhead-cap'))$('#timelineScroll').setPointerCapture?.(event.pointerId);seekFromTimeline(event);}
}
function onTimelineDragOver(event) {
  if(event.dataTransfer?.types?.includes('application/x-neurio-asset')){event.preventDefault();event.dataTransfer.dropEffect='copy';event.target.closest('.timeline-lane')?.classList.add('drop-target');}
}
async function onTimelineDrop(event) {
  const assetId=event.dataTransfer?.getData('application/x-neurio-asset');
  $$('.timeline-lane.drop-target').forEach(el=>el.classList.remove('drop-target'));
  if(assetId){event.preventDefault();addAssetAtPointer(assetId,event);return;}
  if(event.dataTransfer?.files?.length){
    event.preventDefault();
    const rect=$('#timelineScroll').getBoundingClientRect();
    const start=Math.max(0,(event.clientX-rect.left+$('#timelineScroll').scrollLeft)/state.zoom);
    const trackId=event.target.closest('.timeline-lane')?.dataset.laneId;
    const before=new Set(assetMap.keys());
    await importFiles(event.dataTransfer.files);
    const imported=[...assetMap.values()].filter(asset=>!before.has(asset.meta.id)&&asset.meta.type!=='font');
    let at=start;
    for(const asset of imported){insertAsset(asset.meta.id,{start:at,trackId});at+=Math.max(.15,asset.meta.duration||3);}
  }
}
function setZoom(value, anchorX = null) {
  const scroll=$('#timelineScroll');const previous=state.zoom;
  state.zoom=clamp(value,24,140);
  const anchor=anchorX===null?scroll.scrollLeft+scroll.clientWidth/2:anchorX;
  const time=anchor/previous;
  renderTracks();
  scroll.scrollLeft=Math.max(0,time*state.zoom-(anchorX===null?scroll.clientWidth/2:anchorX));
  scheduleAutosave();
}

function resolutionBaseFromLabel(value) { return Number(value) || 1080; }
function estimatedExportBytes(base, fps, bitrate) {
  const d=projectDuration();const audio=160;const dims=outputDimensions(state.aspect,base);const area=dims.width*dims.height;
  const scale=area/(1920*1080);const fpsScale=fps/30;
  const estimateVideo=Math.max(bitrate,Math.min(bitrate*2.2,bitrate*scale*fpsScale));
  return d*(estimateVideo+audio)*1000/8;
}
function availableMimeTypes() {
  if(!window.MediaRecorder)return [];
  return ['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'].filter(type=>MediaRecorder.isTypeSupported(type));
}
function exportDialogMarkup() {
  const supported=availableMimeTypes();
  const base=1080, fps=30, bitrate=10;
  const dims=outputDimensions(state.aspect,base);
  const estimated=estimatedExportBytes(base,fps,bitrate);
  return `<div class="modal-backdrop" data-modal-backdrop><div class="modal export-modal" role="dialog" aria-modal="true" aria-labelledby="exportTitle">
    <div class="modal-header"><div><h2 id="exportTitle">Export video</h2><p>Render this timeline in real time from your browser preview.</p></div><button class="icon-button" data-action="close-modal" aria-label="Close">×</button></div>
    <div class="modal-content">
      <div class="modal-field-grid">
        <label class="modal-field">Resolution<select id="exportResolution"><option value="720">720p</option><option value="1080" selected>1080p</option><option value="1440">1440p</option><option value="2160">4K · device permitting</option></select></label>
        <label class="modal-field">Frame rate<select id="exportFps"><option value="24">24 fps</option><option value="30" selected>30 fps</option><option value="60">60 fps</option></select></label>
        <label class="modal-field">Format<select id="exportFormat">${supported.map((type,index)=>`<option value="${safe(type)}" ${index===0?'selected':''}>WebM · ${type.includes('vp9')?'VP9':type.includes('vp8')?'VP8':'browser default'}</option>`).join('')||'<option value="">Unavailable</option>'}<option value="unavailable" disabled>MP4 / MOV · requires a video encoder service</option></select></label>
        <label class="modal-field">Video bitrate<select id="exportBitrate"><option value="5">5 Mbps · compact</option><option value="10" selected>10 Mbps · balanced</option><option value="18">18 Mbps · high quality</option><option value="30">30 Mbps · 4K / high detail</option></select></label>
      </div>
      <div class="export-summary"><span><strong id="exportDimensions">${dims.width} × ${dims.height}</strong> · ${safe(state.aspect)}</span><span>${formatClock(projectDuration(),state.fps,false)} duration</span><span>Estimated <strong id="exportEstimate">${prettySize(estimated)}</strong></span></div>
      <div class="export-progress-wrap" id="exportProgressWrap" hidden><div class="export-progress-top"><span id="exportProgressLabel">Preparing render…</span><span id="exportProgressPct">0%</span></div><div class="export-progress"><i id="exportProgressBar"></i></div></div>
      <p class="modal-note">Export uses Canvas + MediaRecorder, records at playback speed, and downloads a WebM file. Audio is mixed through Web Audio when supported. This browser build does not encode MP4/MOV and does not upload your files.</p>
      <div id="exportResult" class="export-result" hidden></div>
    </div>
    <div class="modal-footer"><button class="secondary-button" data-action="close-modal" id="exportCancel">Cancel</button><button class="primary-button" data-action="start-export" id="startExportButton">Start export</button></div>
  </div></div>`;
}
function showExportDialog() {
  if(!state.clips.length){toast('Add clips to the timeline before exporting.');return;}
  if(!window.MediaRecorder||!$('#previewCanvas').captureStream){toast('WebM export is unavailable in this browser.');return;}
  $('#modalRoot').innerHTML=exportDialogMarkup();
}
function updateExportEstimate() {
  const base=Number($('#exportResolution')?.value)||1080;const fps=Number($('#exportFps')?.value)||30;const bitrate=Number($('#exportBitrate')?.value)||10;
  const d=outputDimensions(state.aspect,base);const dimensions=$('#exportDimensions');if(dimensions)dimensions.textContent=`${d.width} × ${d.height}`;
  const estimate=$('#exportEstimate');if(estimate)estimate.textContent=prettySize(estimatedExportBytes(base,fps,bitrate));
}
async function startExport() {
  if(exportSession?.recording)return;
  const modal=$('.modal.export-modal');if(!modal)return;
  const format=$('#exportFormat').value;if(!format||format==='unavailable'){toast('No supported browser recording format is available.');return;}
  const base=resolutionBaseFromLabel($('#exportResolution').value);const fps=Number($('#exportFps').value)||30;const bitrate=Number($('#exportBitrate').value)||10;
  const dims=outputDimensions(state.aspect,base);const canvas=$('#previewCanvas');
  const original={width:canvas.width,height:canvas.height,playhead:state.playhead};
  const button=$('#startExportButton');button.disabled=true;button.textContent='Preparing…';
  try{
    await initAudioGraph();
    setCanvasResolution(dims.width,dims.height,false);
    drawPreview();
    const canvasStream=canvas.captureStream(fps);
    const stream=new MediaStream();
    for(const track of canvasStream.getVideoTracks())stream.addTrack(track);
    let audioAttached=false;
    if(mixedAudioDestination){
      for(const track of mixedAudioDestination.stream.getAudioTracks())stream.addTrack(track);
      audioAttached=state.clips.some(clip=>(clip.kind==='audio'||clip.kind==='video')&&!clip.muted&&clip.volume>0&&!trackById(clip.trackId)?.muted);
    }
    const options={mimeType:format,videoBitsPerSecond:bitrate*1000000,audioBitsPerSecond:192000};
    let recorder;
    try{recorder=new MediaRecorder(stream,options);}catch{recorder=new MediaRecorder(stream,{mimeType:format});}
    const chunks=[];
    const fileName=`${slugTitle(state.name)}.webm`;
    const backdrop=$('.modal-backdrop');
    $('#exportProgressWrap').hidden=false;$('#exportResult').hidden=true;
    $('#exportCancel').textContent='Stop export';button.textContent='Recording…';button.disabled=true;
    exportSession={recorder,stream,canvasStream,chunks,original,startedAt:performance.now(),fileName,audioAttached,recording:true,finalizing:false,cancelled:false,blob:null};
    recorder.ondataavailable=event=>{if(event.data?.size)chunks.push(event.data);};
    recorder.onerror=event=>{console.error('Export recording failed',event.error);toast('Export failed. Try a lower resolution or bitrate.');finishExport(true);};
    recorder.onstop=()=>completeExport(chunks,stream,original,fileName,audioAttached);
    recorder.start(1000);
    state.playhead=0;state.isPlaying=true;lastRaf=performance.now();await initAudioGraph();syncPlayers();updateTimeDisplay();
    exportUiTimer=setInterval(()=>{
      if(!exportSession?.recording)return;
      const progress=clamp(state.playhead/Math.max(.1,projectDuration()),0,1);
      $('#exportProgressBar').style.width=`${progress*100}%`;
      $('#exportProgressPct').textContent=`${Math.round(progress*100)}%`;
      $('#exportProgressLabel').textContent=`Rendering · ${formatClock(state.playhead,state.fps,false)} / ${formatClock(projectDuration(),state.fps,false)}`;
    },180);
    toast(audioAttached?'Export recording started. Audio mix is connected.':'Export recording started. This browser did not expose an audio mix track.');
  }catch(error){
    console.error(error);button.disabled=false;button.textContent='Start export';setCanvasResolution(original.width,original.height,false);toast(`Could not start export: ${error.message||'browser recorder error'}`);
  }
}
function finishExport(cancelled=false) {
  if(!exportSession?.recording)return;
  exportSession.cancelled=cancelled;
  exportSession.recording=false;exportSession.finalizing=true;
  clearInterval(exportUiTimer);state.isPlaying=false;pausePlayers();
  const recorder=exportSession.recorder;
  try{if(recorder.state!=='inactive')recorder.stop();}catch{completeExport(exportSession.chunks,exportSession.stream,exportSession.original,exportSession.fileName,exportSession.audioAttached);}
}
function completeExport(chunks,stream,original,fileName,audioAttached) {
  clearInterval(exportUiTimer);
  const session=exportSession;
  state.isPlaying=false;pausePlayers();
  const persistentAudioTracks=new Set(mixedAudioDestination?.stream.getAudioTracks()||[]);
  for(const track of stream?.getTracks()||[])if(!persistentAudioTracks.has(track))track.stop();
  if(session){session.recording=false;session.finalizing=false;session.blob=new Blob(chunks,{type:session.recorder?.mimeType||'video/webm'});}
  setCanvasResolution(original.width,original.height,false);
  state.playhead=original.playhead;updateTimeDisplay();drawPreview();
  const blob=session?.blob;
  const result=$('#exportResult');const start=$('#startExportButton');const cancel=$('#exportCancel');
  if(result&&blob?.size){
    const url=URL.createObjectURL(blob);
    session.downloadUrl=url;
    result.hidden=false;
    result.innerHTML=`<div class="export-result-mark">✓</div><div><strong>${session.cancelled?'Partial render ready':'Export ready'}</strong><span>${safe(fileName)} · ${prettySize(blob.size)} · WebM${audioAttached?' · audio included':' · no audio track'}</span></div><button class="inline-action" data-action="download-export">Download file</button>`;
    $('#exportProgressBar').style.width='100%';$('#exportProgressPct').textContent='100%';$('#exportProgressLabel').textContent=session.cancelled?'Stopped · partial file ready':'Encoding complete';
    if(start){start.disabled=false;start.textContent='Export again';}
    if(cancel)cancel.textContent='Close';
    toast(session.cancelled?'Partial export is ready to download.':'Video export completed.');
  }else{
    if(start){start.disabled=false;start.textContent='Start export';}
    toast('No encoded video data was produced.');
    exportSession=null;
  }
  if(session)session.finalizing=false;
}
function downloadExport() {
  const session=exportSession;if(!session?.downloadUrl)return;
  const link=document.createElement('a');link.href=session.downloadUrl;link.download=session.fileName;document.body.appendChild(link);link.click();link.remove();
  toast('Download started');
}
function closeModal() {
  if(exportSession?.recording){finishExport(true);return;}
  $('#modalRoot').innerHTML='';
}

function showHelp() {
  $('#modalRoot').innerHTML=`<div class="modal-backdrop" data-modal-backdrop><div class="modal" role="dialog" aria-modal="true"><div class="modal-header"><div><h2>Keyboard shortcuts</h2><p>Small shortcuts to keep the edit moving.</p></div><button class="icon-button" data-action="close-modal">×</button></div><div class="modal-content"><div class="shortcut-list">
    <div class="shortcut-row"><span>Play / pause</span><kbd>Space</kbd></div><div class="shortcut-row"><span>Split at playhead</span><kbd>S</kbd></div><div class="shortcut-row"><span>Delete selected clips</span><kbd>Delete</kbd></div><div class="shortcut-row"><span>Undo / redo</span><kbd>Ctrl/⌘ Z / ⇧ Z</kbd></div><div class="shortcut-row"><span>Copy / paste clips</span><kbd>Ctrl/⌘ C / V</kbd></div><div class="shortcut-row"><span>Duplicate clips</span><kbd>Ctrl/⌘ D</kbd></div><div class="shortcut-row"><span>Frame step</span><kbd>← / →</kbd></div><div class="shortcut-row"><span>Timeline zoom</span><kbd>Ctrl/⌘ + scroll</kbd></div><div class="shortcut-row"><span>Go to start / end</span><kbd>Home / End</kbd></div><div class="shortcut-row"><span>Exit fullscreen</span><kbd>Esc</kbd></div>
    </div><div class="note-card">Media, project state and autosaves are stored in this browser on this device. Export is a real-time WebM recording; MP4/MOV encoding and model-backed AI need services not bundled here.</div></div><div class="modal-footer"><button class="primary-button" data-action="close-modal">Got it</button></div></div></div>`;
}
function setProject(projectState) {
  clearPlayers();
  const normalized=newProject(projectState.name||'Imported edit');
  Object.assign(normalized,clone(projectState));
  normalized.id=projectState.id||normalized.id;
  normalized.createdAt=projectState.createdAt||Date.now();
  normalized.tracks=Array.isArray(projectState.tracks)&&projectState.tracks.length?projectState.tracks:createTracks();
  normalized.clips=Array.isArray(projectState.clips)?projectState.clips:[];
  normalized.selectedIds=[];
  normalized.playhead=clamp(projectState.playhead||0,0,Math.max(...normalized.clips.map(clip=>clip.start+clip.duration),0));
  normalized.zoom=clamp(projectState.zoom||60,24,140);
  normalized.aspect=ASPECTS[projectState.aspect]?projectState.aspect:'16:9';
  normalized.fps=Number(projectState.fps)||30;
  normalized.favorites=projectState.favorites||{};
  state=normalized;undoStack=[];redoStack=[];activeInspectorTab='basic';
  syncProjectControls();renderEditor();scheduleAutosave();
}
async function loadAssetRecords() {
  const records=await getAssets();
  for(const record of records){
    if(!record?.blob||!record.meta)continue;
    const url=URL.createObjectURL(record.blob);
    const asset={meta:record.meta,blob:record.blob,url};assetMap.set(record.id||record.meta.id,asset);loadFontAsset(asset);
  }
}
async function loadInitialProject() {
  try{
    await loadAssetRecords();
    const projects=await getProjects();
    let lastId=null;try{lastId=localStorage.getItem('neurio-last-project');}catch{}
    const record=projects.find(item=>item.id===lastId)||projects.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0))[0];
    if(record?.state)setProject({...record.state,id:record.id,name:record.name||record.state.name,createdAt:record.createdAt});
    else{state=newProject();renderEditor();scheduleAutosave();}
  }catch(error){
    console.warn('Local project recovery could not load',error);
    state=newProject();renderEditor();
    $('.save-status').classList.add('error');$('#saveStatus').textContent='Browser storage unavailable';
    toast('Local browser storage is unavailable. Export your project file regularly.',3800);
  }
}
function projectRecordContent() {
  const content={format:'neurio-project',version:1,exportedAt:new Date().toISOString(),project:{...getSnapshot(),id:state.id,name:state.name,createdAt:state.createdAt},mediaReferences:state.clips.map(clip=>clip.assetId).filter(Boolean).filter((id,index,array)=>array.indexOf(id)===index).map(id=>({id,name:assetById(id)?.meta.name||'Missing media'}))};
  const blob=new Blob([JSON.stringify(content,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`${slugTitle(state.name)}.neurio`;a.click();URL.revokeObjectURL(url);toast('Project edit file exported');
}
async function importProjectFile(file) {
  try{
    const data=JSON.parse(await file.text());const project=data.project||data;
    if(!project||!Array.isArray(project.clips)||!Array.isArray(project.tracks))throw new Error('File does not contain a Neurio timeline.');
    const projectCopy={...project,id:makeId('project'),name:`${project.name||noExt(file.name)} (imported)`,createdAt:Date.now()};
    setProject(projectCopy);toast('Project edit imported. Relinked media references are kept if already in this browser.');
  }catch(error){toast(`Could not import project file: ${error.message||'invalid file'}`,3500);}
}
function updateProjectName(value) {
  state.name=String(value||'Untitled edit').trim().slice(0,70)||'Untitled edit';
  scheduleAutosave();
}
function newProjectFromMenu() {
  if(state.clips.length&&!confirm('Create a new project? Your current edit is autosaved locally.'))return;
  clearPlayers();state=newProject();undoStack=[];redoStack=[];state.selectedIds=[];renderEditor();scheduleAutosave();toast('New project created');
}
function duplicateProject() {
  const copy=getSnapshot();copy.id=makeId('project');copy.name=`${state.name} copy`;copy.createdAt=Date.now();copy.tracks=copy.tracks.map(track=>({...track,id:makeId('track')}));
  const idMap=new Map(state.tracks.map((track,index)=>[track.id,copy.tracks[index].id]));
  copy.clips=copy.clips.map(clip=>({...clip,id:makeId('clip'),trackId:idMap.get(clip.trackId)||copy.tracks[0].id}));
  copy.selectedIds=[];setProject(copy);toast('Project duplicated');
}
function projectMenuAction(action) {
  $('#projectMenu').hidden=true;
  if(action==='new')newProjectFromMenu();
  else if(action==='duplicate')duplicateProject();
  else if(action==='export')projectRecordContent();
  else if(action==='import')$('#projectInput').click();
  else if(action==='recover'){
    getProject(state.id).then(record=>{if(record?.state){setProject({...record.state,id:record.id,name:record.name});toast('Latest autosave restored');}else toast('No saved recovery copy found.');}).catch(()=>toast('Could not read local recovery data.'));
  }
}

function bindUI() {
  $$('.rail-button[data-panel]').forEach(button=>button.addEventListener('click',()=>setPanel(button.dataset.panel)));
  $('#libraryCollapse').addEventListener('click',()=>$('#libraryPanel').classList.toggle('collapsed'));
  $('#libraryContent').addEventListener('click',handleLibraryClick);
  $('#libraryContent').addEventListener('input',handleLibraryInput);
  $('#libraryContent').addEventListener('dragstart',event=>{
    const card=event.target.closest('[data-asset-card]');if(!card)return;
    event.dataTransfer.setData('application/x-neurio-asset',card.dataset.assetCard);event.dataTransfer.effectAllowed='copy';
  });
  $('#libraryContent').addEventListener('dragover',event=>{if([...event.dataTransfer.types].includes('Files')){event.preventDefault();$('.import-drop')?.classList.add('dragover');}});
  $('#libraryContent').addEventListener('dragleave',event=>$('.import-drop')?.classList.remove('dragover'));
  $('#libraryContent').addEventListener('drop',event=>{if(event.dataTransfer.files?.length){event.preventDefault();$('.import-drop')?.classList.remove('dragover');importFiles(event.dataTransfer.files);}});
  $('#libraryContent').addEventListener('keydown',event=>{if(event.target.id==='librarySearch'&&event.key==='Escape'){libraryQuery='';renderLibrary();}});
  $('#libraryContent').addEventListener('click',event=>{if(event.target.closest('#importDrop'))$('#mediaInput').click();});
  $('#emptyImportButton').addEventListener('click',()=>$('#mediaInput').click());
  $('#mediaInput').addEventListener('change',()=>importFiles($('#mediaInput').files));
  $('#replaceInput').addEventListener('change',()=>{const file=$('#replaceInput').files?.[0];replaceSelectedMedia(file);$('#replaceInput').value='';});
  $('#projectInput').addEventListener('change',()=>{const file=$('#projectInput').files?.[0];if(file)importProjectFile(file);$('#projectInput').value='';});
  $('#projectName').addEventListener('change',event=>updateProjectName(event.target.value));
  $('#projectName').addEventListener('keydown',event=>{if(event.key==='Enter')event.target.blur();});
  $('#projectMenuButton').addEventListener('click',event=>{event.stopPropagation();$('#projectMenu').hidden=!$('#projectMenu').hidden;});
  $('#projectMenu').addEventListener('click',event=>{const button=event.target.closest('[data-project-action]');if(button)projectMenuAction(button.dataset.projectAction);});
  document.addEventListener('click',event=>{if(!event.target.closest('.project-switcher'))$('#projectMenu').hidden=true;if(!event.target.closest('.timeline-tools'))$('#trackMenu').hidden=true;});
  $('#undoButton').addEventListener('click',undo);$('#redoButton').addEventListener('click',redo);
  $('#aspectSelect').addEventListener('change',event=>{pushHistory();state.aspect=event.target.value;syncProjectControls();renderTracks();drawPreview();scheduleAutosave();});
  $('#modeToggle').addEventListener('click',()=>{pushHistory();state.mode=state.mode==='pro'?'beginner':'pro';syncProjectControls();renderInspector();scheduleAutosave();toast(`${state.mode==='pro'?'Pro':'Beginner'} mode`);});
  $('#inspectorToggle').addEventListener('click',()=>document.body.classList.toggle('inspector-open'));
  $('#exportButton').addEventListener('click',showExportDialog);
  $('#fullscreenPreview').addEventListener('click',()=>{const stage=$('#stageWrap');if(document.fullscreenElement){document.exitFullscreen?.();}else{const request=stage.requestFullscreen?.();request?.catch(()=>toast('Fullscreen preview is not available.'));}});
  $('#fitPreview').addEventListener('click',()=>{fitPreviewNative=!fitPreviewNative;$('#stageWrap').classList.toggle('zoom-native',fitPreviewNative);$('#fitPreview').innerHTML=fitPreviewNative?'100%&nbsp;⌄':'Fit&nbsp;⌄';});
  $('#playButton').addEventListener('click',()=>togglePlayback());
  $('#jumpStart').addEventListener('click',()=>setPlayhead(0));$('#jumpEnd').addEventListener('click',()=>setPlayhead(projectDuration(),true));
  $('#stepBack').addEventListener('click',()=>{togglePlayback(false);setPlayhead(state.playhead-1/state.fps);});$('#stepForward').addEventListener('click',()=>{togglePlayback(false);setPlayhead(state.playhead+1/state.fps);});
  $('#splitButton').addEventListener('click',splitSelected);$('#deleteClipButton').addEventListener('click',deleteSelected);$('#duplicateClipButton').addEventListener('click',duplicateSelected);$('#groupClipButton').addEventListener('click',groupSelected);
  $('#snapToggle').addEventListener('click',()=>{pushHistory();state.snap=!state.snap;$('#snapToggle').classList.toggle('on',state.snap);scheduleAutosave();});
  $('#addTrackButton').addEventListener('click',event=>{event.stopPropagation();$('#trackMenu').hidden=!$('#trackMenu').hidden;});
  $('#trackMenu').addEventListener('click',event=>{const button=event.target.closest('[data-track-kind]');if(button){$('#trackMenu').hidden=true;addTrack(button.dataset.trackKind);}});
  $('#zoomRange').addEventListener('input',event=>setZoom(Number(event.target.value)));
  $('#zoomOut').addEventListener('click',()=>setZoom(state.zoom-8));$('#zoomIn').addEventListener('click',()=>setZoom(state.zoom+8));
  $('#timelineScroll').addEventListener('scroll',syncTrackLabelScroll,{passive:true});
  $('#timelineScroll').addEventListener('pointerdown',beginTimelineScrub);
  $('#timelineScroll').addEventListener('pointermove',event=>{if(timelineScrubbing)seekFromTimeline(event);});
  document.addEventListener('pointerup',()=>{timelineScrubbing=false;finishClipDrag();});
  $('#timelineScroll').addEventListener('pointerdown',onClipPointerDown);
  $('#timelineScroll').addEventListener('pointermove',onClipPointerMove);
  $('#timelineScroll').addEventListener('pointerup',finishClipDrag);
  $('#timelineScroll').addEventListener('pointercancel',finishClipDrag);
  $('#timelineScroll').addEventListener('dragover',onTimelineDragOver);
  $('#timelineScroll').addEventListener('drop',onTimelineDrop);
  $('#trackLabels').addEventListener('click',handleTrackLabels);
  $('#inspectorContent').addEventListener('click',handleInspectorClick);
  $('#inspectorContent').addEventListener('pointerdown',beginHistoryEdit);
  $('#inspectorContent').addEventListener('focusin',beginHistoryEdit);
  $('#inspectorContent').addEventListener('input',handleInspectorInput);
  $('#inspectorContent').addEventListener('change',handleInspectorChange);
  $('#inspectorContent').addEventListener('focusout',finishInspectorEdit);
  $('#resetClipButton').addEventListener('click',resetClip);
  $('#helpButton').addEventListener('click',showHelp);
  $('#previewCanvas').addEventListener('pointerdown',beginPreviewTransform);
  $('#previewCanvas').addEventListener('pointermove',movePreviewTransform);
  $('#previewCanvas').addEventListener('pointerup',endPreviewTransform);
  $('#previewCanvas').addEventListener('pointercancel',endPreviewTransform);
  $('#timelineScroll').addEventListener('wheel',event=>{
    if(event.ctrlKey||event.metaKey){event.preventDefault();const rect=$('#timelineScroll').getBoundingClientRect();setZoom(state.zoom+(event.deltaY<0?5:-5),event.clientX-rect.left);}
  },{passive:false});
  $('#modalRoot').addEventListener('click',handleModalClick);
  $('#modalRoot').addEventListener('change',event=>{if(event.target.matches('#exportResolution,#exportFps,#exportBitrate'))updateExportEstimate();});
  window.addEventListener('keydown',handleKeyboard);
  window.addEventListener('resize',()=>{if(!exportSession?.recording){const aspect=ASPECTS[state.aspect];setCanvasResolution(aspect.width,aspect.height,true);}});
  window.addEventListener('pagehide',()=>{if(!exportSession?.recording)persistNow();});
  document.addEventListener('dragover',event=>{if(event.dataTransfer?.types?.includes('Files'))event.preventDefault();});
  document.addEventListener('drop',event=>{if(event.dataTransfer?.files?.length&&!event.target.closest('#timelineScroll,#libraryContent')){event.preventDefault();importFiles(event.dataTransfer.files);}});
}
let previewDrag=null;
function beginPreviewTransform(event) {
  const clip=selectedClip();if(!clip||!['text','sticker'].includes(clip.kind)||event.button!==0)return;
  previewDrag={clipId:clip.id,x:event.clientX,y:event.clientY,tx:clip.transform.x,ty:clip.transform.y};
  $('#previewCanvas').setPointerCapture(event.pointerId);
}
function movePreviewTransform(event) {
  if(!previewDrag)return;
  const clip=clipById(previewDrag.clipId);if(!clip)return;
  const rect=$('#previewCanvas').getBoundingClientRect();
  clip.transform.x=clamp(previewDrag.tx+(event.clientX-previewDrag.x)/rect.width*100,-100,100);
  clip.transform.y=clamp(previewDrag.ty+(event.clientY-previewDrag.y)/rect.height*100,-100,100);
  drawPreview();const xControl=$('[data-prop="x"]',$('#inspectorContent'));const yControl=$('[data-prop="y"]',$('#inspectorContent'));if(xControl)xControl.value=clip.transform.x.toFixed(1);if(yControl)yControl.value=clip.transform.y.toFixed(1);
}
function endPreviewTransform(event) {
  if(!previewDrag)return;
  const clip=clipById(previewDrag.clipId);const moved=clip&&(Math.abs(clip.transform.x-previewDrag.tx)>.1||Math.abs(clip.transform.y-previewDrag.ty)>.1);
  if(moved){undoStack.push({...getSnapshot(),clips:getSnapshot().clips.map(item=>item.id===clip.id?{...item,transform:{...item.transform,x:previewDrag.tx,y:previewDrag.ty}}:item)});if(undoStack.length>80)undoStack.shift();redoStack.length=0;updateHistoryButtons();scheduleAutosave();}
  previewDrag=null;
}
function handleModalClick(event) {
  if(event.target.matches('[data-modal-backdrop]')){closeModal();return;}
  if(event.target.closest('#exportCancel')){if(exportSession?.recording)finishExport(true);else closeModal();return;}
  const button=event.target.closest('[data-action]');if(!button)return;
  if(button.dataset.action==='close-modal')closeModal();
  else if(button.dataset.action==='start-export')startExport();
  else if(button.dataset.action==='download-export')downloadExport();
}
function handleKeyboard(event) {
  const tag=event.target?.tagName?.toLowerCase();
  const typing=['input','textarea','select'].includes(tag)||event.target?.isContentEditable;
  const modifier=event.ctrlKey||event.metaKey;
  if(event.key==='Escape'){
    if(exportSession?.recording){finishExport(true);return;}
    if($('#modalRoot').innerHTML)closeModal();
    else if(document.fullscreenElement)document.exitFullscreen?.();
    return;
  }
  if(typing)return;
  if(modifier&&event.key.toLowerCase()==='z'){event.preventDefault();event.shiftKey?redo():undo();return;}
  if(modifier&&event.key.toLowerCase()==='y'){event.preventDefault();redo();return;}
  if(modifier&&event.key.toLowerCase()==='d'){event.preventDefault();duplicateSelected();return;}
  if(modifier&&event.key.toLowerCase()==='c'){event.preventDefault();copySelected();return;}
  if(modifier&&event.key.toLowerCase()==='v'){event.preventDefault();pasteClips();return;}
  if(event.code==='Space'){event.preventDefault();togglePlayback();return;}
  if(event.key.toLowerCase()==='s'){event.preventDefault();splitSelected();return;}
  if(event.key==='Delete'||event.key==='Backspace'){event.preventDefault();deleteSelected();return;}
  if(event.key==='ArrowLeft'){event.preventDefault();togglePlayback(false);setPlayhead(state.playhead-1/state.fps);return;}
  if(event.key==='ArrowRight'){event.preventDefault();togglePlayback(false);setPlayhead(state.playhead+1/state.fps);return;}
  if(event.key==='Home'){event.preventDefault();setPlayhead(0);return;}
  if(event.key==='End'){event.preventDefault();setPlayhead(projectDuration(),true);return;}
}

async function boot() {
  uiReady=true;
  bindUI();
  if (matchMedia('(max-width:640px)').matches) $('#libraryPanel').classList.add('collapsed');
  await loadInitialProject();
  syncProjectControls();renderEditor();
  requestAnimationFrame(animationFrame);
  setInterval(()=>{if(!exportSession?.recording)drawPreview();},1000);
}
boot();
