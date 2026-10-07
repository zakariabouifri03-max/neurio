// Montaj Pro — project model, history, persistence
import { uid, deep, clamp } from './util.js';

export const ASPECTS = {
  '9:16': [1080, 1920], '16:9': [1920, 1080], '1:1': [1080, 1080], '4:5': [1080, 1350], '21:9': [2100, 900], '3:4': [1080, 1440], '2:3': [1080, 1620],
};
export const RES_PRESETS = [480, 720, 1080, 1440, 2160];

let project = null;
const listeners = new Set();
export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export function emit(evt = 'change') { for (const fn of listeners) { try { fn(evt, project); } catch (e) { console.error(e); } } }

export const getProject = () => project;

// ---------- history ----------
const history = { stack: [], index: -1, max: 80 };
let suspend = false;
export function snapshot(label = '') {
  if (suspend || !project) return;
  const s = JSON.stringify({ tracks: project.tracks, clips: project.clips, settings: project.settings, media: project.media.map(m => ({ ...m, blob: undefined })) });
  history.stack = history.stack.slice(0, history.index + 1);
  history.stack.push({ s, label, at: Date.now() });
  if (history.stack.length > history.max) history.stack.shift();
  history.index = history.stack.length - 1;
  emit('history');
}
export function undo() {
  if (history.index <= 0) return;
  history.index--;
  applyHistory();
}
export function redo() {
  if (history.index >= history.stack.length - 1) return;
  history.index++;
  applyHistory();
}
function applyHistory() {
  const snap = history.stack[history.index];
  if (!snap) return;
  const data = JSON.parse(snap.s);
  suspend = true;
  project.tracks = data.tracks; project.clips = data.clips; project.settings = data.settings;
  suspend = false;
  emit('history'); emit('change');
}
export const canUndo = () => history.index > 0;
export const canRedo = () => history.index < history.stack.length - 1;
export function withSuspend(fn) { suspend = true; try { fn(); } finally { suspend = false; } }

// ---------- defaults ----------
export function newProject(settings = {}) {
  const p = {
    id: uid('proj'), name: 'مشروعي ' + new Date().toLocaleDateString('en-GB').replace(/\//g, '-'),
    createdAt: Date.now(), updatedAt: Date.now(),
    settings: {
      width: 1080, height: 1920, fps: 30, bg: '#000000', aspect: '9:16',
      ...settings,
    },
    media: [], clips: [], tracks: [],
  };
  addTrack(p, 'video', 'V1');
  addTrack(p, 'audio', 'A1');
  return p;
}
export function setProject(p, { resetHistory = true } = {}) {
  project = p;
  if (resetHistory) { history.stack = []; history.index = -1; snapshot('init'); }
  emit('project'); emit('change');
}
export const newTrack = (type, name) => ({ id: uid('trk'), type, name: name || (type === 'audio' ? 'A' : type === 'overlay' ? 'OV' : 'V'), hidden: false, locked: false, muted: false, volume: 1 });
export function addTrack(p, type, name) {
  const t = newTrack(type, name);
  if (type === 'audio') p.tracks.push(t); else p.tracks.unshift(t);
  // keep visual order: overlay tracks above video tracks
  p.tracks.sort((a, b) => order(a.type) - order(b.type));
  return t;
}
const order = (type) => (type === 'audio' ? 2 : type === 'overlay' ? 0 : 1);

export function newClip(partial = {}) {
  return {
    id: uid('clip'), trackId: null, type: 'video', mediaId: null,
    start: 0, duration: 3, trimIn: 0, trimOut: 3, speed: 1, reverse: false,
    volume: 1, muted: false, fadeIn: 0, fadeOut: 0,
    transform: { x: 0, y: 0, scale: 1, rotate: 0, flipH: false, flipV: false, opacity: 1, crop: { l: 0, t: 0, r: 0, b: 0 }, radius: 0 },
    adjust: { brightness: 0, contrast: 0, saturation: 0, temperature: 0, tint: 0, blur: 0, sharpen: 0, vignette: 0, hue: 0, grain: 0 },
    filter: 'none', filterStrength: 100,
    chroma: { enabled: false, color: '#00ff00', tol: 0.28, feather: 0.12, spill: 0.4 },
    keyframes: {}, animIn: { type: 'none', dur: 0.5 }, animOut: { type: 'none', dur: 0.5 },
    transition: { type: 'none', duration: 0.5 },
    text: null, shape: null, sticker: null,
    ...partial,
  };
}
export function clipsOf(trackId) { return project.clips.filter(c => c.trackId === trackId); }
export const clipById = (id) => project.clips.find(c => c.id === id);
export const trackById = (id) => project.tracks.find(t => t.id === id);
export const mediaById = (id) => project.media.find(m => m.id === id);
export function trackClipsSorted(trackId) { return clipsOf(trackId).slice().sort((a, b) => a.start - b.start); }
export function projectDuration() {
  let d = 0;
  for (const c of project.clips) d = Math.max(d, c.start + c.duration);
  return d;
}
export function addClip(clip) {
  project.clips.push(clip);
  project.updatedAt = Date.now();
  emit('change');
  return clip;
}
export function removeClip(id) {
  const i = project.clips.findIndex(c => c.id === id);
  if (i >= 0) { project.clips.splice(i, 1); emit('change'); }
}
export function updateClip(id, patch, { silent = false } = {}) {
  const c = clipById(id);
  if (!c) return null;
  for (const k in patch) {
    if (patch[k] && typeof patch[k] === 'object' && !Array.isArray(patch[k]) && c[k] && typeof c[k] === 'object') Object.assign(c[k], patch[k]);
    else c[k] = patch[k];
  }
  project.updatedAt = Date.now();
  if (!silent) emit('change');
  return c;
}
export function moveClip(id, start, trackId) {
  const c = clipById(id); if (!c) return;
  c.start = Math.max(0, start);
  if (trackId && trackId !== c.trackId) {
    const t = trackById(trackId);
    if (t && !t.locked && compatible(c, t)) c.trackId = trackId;
  }
  emit('change');
}
const compatible = (c, t) => (t.type === 'audio' ? (c.type === 'audio' || c.type === 'video') : (c.type !== 'audio' || true));
export function clipAt(trackId, t, excludeId) {
  return clipsOf(trackId).find(c => c.id !== excludeId && t >= c.start && t < c.start + c.duration);
}
// first free position on a track at/after `from`
export function freeSlot(trackId, from, duration, ignoreId) {
  let t = Math.max(0, from);
  const list = trackClipsSorted(trackId).filter(c => c.id !== ignoreId);
  let moved = true;
  let guard = 0;
  while (moved && guard++ < 500) {
    moved = false;
    for (const c of list) {
      if (t < c.start + c.duration && t + duration > c.start) { t = c.start + c.duration; moved = true; }
    }
  }
  return t;
}
export function sortClips() { project.clips.sort((a, b) => a.start - b.start); }
export const isVisual = (c) => c.type === 'video' || c.type === 'image' || c.type === 'text' || c.type === 'shape' || c.type === 'sticker';
export const clipSourceTime = (c, localT) => {
  const t = clamp(localT, 0, c.duration);
  const src = c.reverse ? (c.trimOut - t * c.speed) : (c.trimIn + t * c.speed);
  const lo = Math.min(c.trimIn, c.trimOut), hi = Math.max(c.trimIn, c.trimOut);
  return clamp(src, lo, Math.max(lo, hi - 1e-4));
};
export const clipLocalAt = (c, t) => clamp(t - c.start, 0, c.duration);

// ---------- keyframes ----------
export const KF_PROPS = ['x', 'y', 'scale', 'rotate', 'opacity', 'volume'];
export function hasKeys(clip, prop) { return !!(clip.keyframes && clip.keyframes[prop] && clip.keyframes[prop].length); }
export function setKey(clip, prop, clipT, value, ease = 'easeInOut') {
  if (!clip.keyframes) clip.keyframes = {};
  const arr = clip.keyframes[prop] || (clip.keyframes[prop] = []);
  const p = clamp(clipT / Math.max(0.0001, clip.duration), 0, 1);
  const existing = arr.findIndex(k => Math.abs(k.t - p) < 0.004);
  const kf = { t: p, v: value, ease };
  if (existing >= 0) arr[existing] = kf; else arr.push(kf);
  arr.sort((a, b) => a.t - b.t);
  emit('change');
  return kf;
}
export function removeKey(clip, prop, clipT) {
  const arr = clip.keyframes && clip.keyframes[prop];
  if (!arr) return;
  const p = clipT / Math.max(0.0001, clip.duration);
  clip.keyframes[prop] = arr.filter(k => Math.abs(k.t - p) >= 0.004);
  emit('change');
}
export function addKeyHere(clip, prop, clipT) {
  const v = kfValue(clip, prop, clipT);
  return setKey(clip, prop, clipT, v);
}
export function kfValue(clip, prop, clipT, fallback) {
  const arr = clip.keyframes && clip.keyframes[prop];
  const base = fallback !== undefined ? fallback : (clip.transform && clip.transform[prop] !== undefined ? clip.transform[prop] : clip[prop]);
  if (!arr || arr.length === 0) return base;
  if (arr.length === 1) return arr[0].v;
  const p = clamp(clipT / Math.max(0.0001, clip.duration), 0, 1);
  if (p <= arr[0].t) return arr[0].v;
  if (p >= arr[arr.length - 1].t) return arr[arr.length - 1].v;
  for (let i = 0; i < arr.length - 1; i++) {
    const a = arr[i], b = arr[i + 1];
    if (p >= a.t && p <= b.t) {
      const span = Math.max(1e-6, b.t - a.t);
      const t = (p - a.t) / span;
      const e = easeFns(a.ease)(t);
      return a.v + (b.v - a.v) * e;
    }
  }
  return base;
}
function easeFns(name) {
  switch (name) {
    case 'linear': return (t) => t;
    case 'easeIn': return (t) => t * t;
    case 'easeOut': return (t) => 1 - (1 - t) ** 2;
    case 'back': return (t) => 1 + 2.7 * (t - 1) ** 3 + 1.7 * (t - 1) ** 2;
    case 'bounce': return (t) => { const n = 7.5625, d = 2.75; if (t < 1 / d) return n * t * t; if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75; if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375; return n * (t -= 2.625 / d) * t + 0.984375; };
    default: return (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
  }
}

// ---------- clipboard ----------
export let clipboard = null;
export const setClipboard = (v) => { clipboard = v; };

// ---------- persistence ----------
const DB_NAME = 'montaj-pro';
let dbP = null;
export function openDB() {
  if (dbP) return dbP;
  dbP = new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error('no idb'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
      if (!db.objectStoreNames.contains('thumbs')) db.createObjectStore('thumbs');
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch(e => { console.warn('IDB unavailable:', e.message); return null; });
  return dbP;
}
function tx(db, store, mode) { return db.transaction(store, mode).objectStore(store); }
export async function idbPut(store, key, value) {
  const db = await openDB(); if (!db) return;
  return new Promise((res, rej) => { const r = tx(db, store, 'readwrite').put(value, key); r.onsuccess = () => res(); r.onerror = () => rej(r.error); });
}
export async function idbGet(store, key) {
  const db = await openDB(); if (!db) return undefined;
  return new Promise((res, rej) => { const r = tx(db, store, 'readonly').get(key); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
export async function idbDel(store, key) {
  const db = await openDB(); if (!db) return;
  return new Promise((res) => { const r = tx(db, store, 'readwrite').delete(key); r.onsuccess = () => res(); r.onerror = () => res(); });
}
export async function idbAll(store) {
  const db = await openDB(); if (!db) return [];
  return new Promise((res, rej) => { const r = tx(db, store, 'readonly').getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error); });
}
export async function saveProjectToDB(p = project) {
  const data = { ...deep({ ...p, media: p.media.map(m => ({ ...m, blob: undefined })) }) };
  data.updatedAt = Date.now();
  await idbPut('projects', data.id, data);
  localStorage.setItem('montaj.lastProject', data.id);
  await idbPut('meta', 'lastOpen', data.id);
  return data;
}
export async function listProjects() {
  const all = await idbAll('projects');
  return all.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}
export async function loadProjectFromDB(id) {
  const data = await idbGet('projects', id);
  if (!data) return null;
  // re-hydrate media blobs
  for (const m of data.media) {
    const blob = await idbGet('blobs', m.blobKey || m.id);
    if (blob) { m.blob = blob; m.url = URL.createObjectURL(blob); }
  }
  return data;
}
