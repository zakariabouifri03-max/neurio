// Montaj Pro — media import, probing, thumbnails, waveforms
import { uid, clamp } from './util.js';
import { idbPut, idbGet } from './state.js';

export async function importFiles(files) {
  const out = [];
  for (const f of files) {
    try { out.push(await importOne(f)); } catch (e) { console.warn('import failed', f.name, e); }
  }
  return out;
}

export async function importOne(file) {
  const type = kindOf(file);
  const m = { id: uid('media'), name: file.name, kind: type, size: file.size, mime: file.type, addedAt: Date.now() };
  const url = URL.createObjectURL(file);
  m.blob = file; m.url = url;
  if (type === 'video' || type === 'audio') {
    const meta = await probeAV(url, type);
    m.duration = meta.duration; m.width = meta.width; m.height = meta.height;
    m.hasAudio = meta.hasAudio;
    if (type === 'video' && m.width) m.aspect = m.width / m.height;
    m.thumb = await makeThumb(url, type, Math.min(0.1, (m.duration || 1) * 0.1));
    if (type === 'video' || type === 'audio') {
      try { m.peaks = await makePeaks(file, 900); } catch (e) { m.peaks = null; }
    }
  } else {
    m.thumb = url;
    try {
      const bmp = await createImageBitmap(file);
      m.width = bmp.width; m.height = bmp.height; m.aspect = bmp.width / bmp.height;
      bmp.close && bmp.close();
    } catch (e) { /* ignore */ }
  }
  // persist blob + asset record
  try { await idbPut('blobs', m.id, file); await idbPut('thumbs', m.id, m.thumb || ''); } catch (e) { }
  m.blobKey = m.id;
  return m;
}

export function kindOf(file) {
  const t = (file.type || '').toLowerCase();
  if (t.startsWith('video')) return 'video';
  if (t.startsWith('audio')) return 'audio';
  if (t.startsWith('image')) return 'image';
  const n = (file.name || '').toLowerCase();
  if (/\.(mp4|mov|webm|mkv|avi|m4v|3gp)$/.test(n)) return 'video';
  if (/\.(mp3|wav|m4a|aac|ogg|oga|flac|opus)$/.test(n)) return 'audio';
  if (/\.(png|jpe?g|webp|gif|bmp|avif)$/.test(n)) return 'image';
  return 'video';
}

export function probeAV(url, kind = 'video') {
  return new Promise((resolve) => {
    const el = document.createElement(kind === 'audio' ? 'audio' : 'video');
    el.preload = 'metadata'; el.muted = true; el.playsInline = true; el.src = url;
    let done = false;
    const finish = (extra = {}) => {
      if (done) return; done = true;
      const hasAudio = kind === 'audio' ? true : ((el.mozHasAudio || (el.webkitAudioDecodedByteCount > 0) || (el.audioTracks && el.audioTracks.length > 0)) ? true : !!el.__hasAudio);
      resolve({ duration: isFinite(el.duration) ? el.duration : 0, width: el.videoWidth || 0, height: el.videoHeight || 0, hasAudio, ...extra });
      el.remove();
    };
    el.onloadedmetadata = () => {
      // some webm/mp4 report Infinity until seeked
      if (!isFinite(el.duration)) {
        el.currentTime = 1e6;
        el.ontimeupdate = () => { if (isFinite(el.duration)) finish(); };
        setTimeout(() => finish(), 900);
      } else finish();
    };
    el.onerror = () => finish({ error: true });
    setTimeout(() => finish(), 4000);
  });
}

export async function makeThumb(url, kind, at = 0.1) {
  return new Promise((resolve) => {
    if (kind === 'audio') return resolve(audioThumbPlaceholder());
    const el = document.createElement(kind === 'video' ? 'video' : 'img');
    el.muted = true; el.playsInline = true; el.src = url;
    const canvas = document.createElement('canvas');
    const W = 240; canvas.width = W; canvas.height = Math.round(W * 0.62);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#141821'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    const shoot = () => {
      try {
        const w = el.videoWidth || el.naturalWidth || W, h = el.videoHeight || el.naturalHeight || canvas.height;
        const scale = Math.min(canvas.width / w, canvas.height / h);
        const dw = w * scale, dh = h * scale;
        ctx.drawImage(el, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
        resolve(canvas.toDataURL('image/jpeg', 0.72));
      } catch (e) { resolve(''); }
      el.remove();
    };
    if (kind === 'image') { el.onload = shoot; el.onerror = () => resolve(''); }
    else {
      el.onloadeddata = () => { try { el.currentTime = clamp(at, 0, Math.max(0, (el.duration || 1) - 0.05)); } catch (e) { shoot(); } };
      el.onseeked = shoot;
      el.onerror = () => resolve('');
    }
    setTimeout(() => resolve(canvas.toDataURL('image/jpeg', 0.6)), 5000);
  });
}

export function audioThumbPlaceholder() {
  const c = document.createElement('canvas');
  c.width = 240; c.height = 148;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#131a24'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = '#3ddc97'; ctx.lineWidth = 2;
  ctx.beginPath();
  for (let x = 0; x < c.width; x += 2) {
    const a = Math.sin(x * 0.16) * Math.sin(x * 0.031) * 26 + Math.sin(x * 0.6) * 6;
    ctx.moveTo(x, c.height / 2 - a); ctx.lineTo(x, c.height / 2 + a);
  }
  ctx.stroke();
  return c.toDataURL('image/png');
}

// waveform peaks from decoded audio (mono, `buckets` values 0..1)
export async function makePeaks(blob, buckets = 900) {
  const AC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!AC) return null;
  const buf = await new Promise((res, rej) => blob.arrayBuffer().then(ab => {
    const ctx = new AC(1, 1, 8000);
    ctx.decodeAudioData(ab, res, rej);
  }));
  const data = buf.getChannelData(0);
  const step = Math.max(1, Math.floor(data.length / buckets));
  const peaks = new Float32Array(buckets);
  for (let i = 0; i < buckets; i++) {
    let m = 0;
    const s = i * step, e = Math.min(data.length, s + step);
    for (let j = s; j < e; j += 3) { const v = Math.abs(data[j]); if (v > m) m = v; }
    peaks[i] = m;
  }
  return Array.from(peaks);
}

// Decoded audio buffer cache (for mixing & export)
const audioCache = new Map();
export async function getAudioBuffer(media, sampleRate = 48000) {
  if (!media || !media.blob) return null;
  const key = media.id;
  if (audioCache.has(key)) return audioCache.get(key);
  const AC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!AC) return null;
  const p = (async () => {
    try {
      const ab = await media.blob.arrayBuffer();
      const ctx = new AC(1, 1, sampleRate);
      return await new Promise((res, rej) => ctx.decodeAudioData(ab, res, rej));
    } catch (e) { console.warn('decodeAudioData failed', media.name, e); return null; }
  })();
  audioCache.set(key, p);
  return p;
}
export const clearAudioCache = (id) => (id ? audioCache.delete(id) : audioCache.clear());

// ---------- thumbnails along a clip (for the timeline filmstrip) ----------
const stripCache = new Map();
export async function getFilmstrip(media, count = 8) {
  if (!media || media.kind === 'audio' || !media.url) return null;
  const key = media.id + ':' + count;
  if (stripCache.has(key)) return stripCache.get(key);
  const p = (async () => {
    const el = document.createElement(media.kind === 'image' ? 'img' : 'video');
    el.src = media.url; el.muted = true; el.playsInline = true;
    const frames = [];
    if (media.kind === 'image') {
      const bmp = await createImageBitmap(media.blob);
      frames.push(smallCanvas(bmp, 96));
      bmp.close && bmp.close();
      return frames;
    }
    await new Promise((r) => { el.onloadeddata = r; el.onerror = r; setTimeout(r, 4000); });
    const dur = media.duration || 1;
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count * dur;
      await new Promise((r) => {
        let fired = false;
        const ok = () => { if (fired) return; fired = true; r(); };
        el.onseeked = ok;
        try { el.currentTime = clamp(t, 0, Math.max(0, dur - 0.05)); } catch (e) { ok(); }
        setTimeout(ok, 700);
      });
      try { frames.push(smallCanvas(el, 96)); } catch (e) { frames.push(null); }
    }
    el.remove();
    return frames;
  })();
  stripCache.set(key, p);
  return p;
}
function smallCanvas(src, h) {
  const w = Math.max(16, Math.round((src.videoWidth || src.width || 16) / (src.videoHeight || src.height || 16) * h));
  const c = document.createElement('canvas'); c.width = Math.min(220, w); c.height = h;
  const ctx = c.getContext('2d');
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}
