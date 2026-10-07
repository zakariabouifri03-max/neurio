// Montaj Pro — audio: live preview graph + offline mixing for export
import { clamp } from './util.js';
import { clipSourceTime, clipLocalAt, projectDuration } from './state.js';
import { clipVolumeAt } from './effects.js';
import { getAudioBuffer } from './media.js';

let actx = null;
let master = null;
const elementNodes = new WeakMap();
let mediaGains = new Map();

export function audioCtx() {
  if (!actx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    actx = new AC({ latencyHint: 'interactive' });
    master = actx.createGain();
    master.gain.value = 1;
    master.connect(actx.destination);
  }
  return actx;
}
export function resumeAudio() { const c = audioCtx(); if (c && c.state === 'suspended') c.resume(); }
export function setMasterVolume(v) { if (master) master.gain.value = v; }

// route a media element through the graph so we control gain per clip
export function attachElement(el) {
  const c = audioCtx();
  if (!c) return;
  if (elementNodes.has(el)) return elementNodes.get(el);
  try {
    const src = c.createMediaElementSource(el);
    const g = c.createGain();
    src.connect(g); g.connect(master);
    const node = { src, gain: g };
    elementNodes.set(el, node);
    return node;
  } catch (e) { console.warn('attachElement failed', e); return null; }
}
export function setElementGain(el, v) {
  const n = elementNodes.get(el);
  if (n) n.gain.gain.value = clamp(v, 0, 4);
}

// ---------- offline mix (used by export) ----------
export async function mixProject(project, { sampleRate = 48000 } = {}) {
  const AC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!AC) return null;
  const dur = Math.max(0.1, projectDuration(project));
  const channels = 2;
  const ctx = new AC(channels, Math.ceil(dur * sampleRate), sampleRate);
  const out = ctx.createGain();
  out.connect(ctx.destination);
  let any = false;

  for (const track of project.tracks) {
    if (track.type !== 'audio') continue;
    for (const clip of project.clips) {
      if (clip.trackId !== track.id) continue;
      if (clip.type !== 'audio' && clip.type !== 'video') continue;
      if (clip.muted || track.muted) continue;
      const media = project.media.find(m => m.id === clip.mediaId);
      if (!media) continue;
      const mediaHasAudio = clip.type === 'video' ? media.hasAudio !== false : true;
      if (!mediaHasAudio && clip.type === 'video') continue;
      let buf = await getAudioBuffer(media, sampleRate);
      if (!buf) continue;
      any = true;
      if (clip.reverse) buf = reverseBuffer(ctx, buf);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = clamp(clip.speed || 1, 0.1, 8);
      if (src.preservesPitch !== undefined) src.preservesPitch = true;
      else if (src.webkitPreservesPitch !== undefined) src.webkitPreservesPitch = true;
      const g = ctx.createGain();
      src.connect(g); g.connect(out);
      const start = clip.start;
      const speed = clamp(clip.speed || 1, 0.1, 8);
      // source offset: trimIn (+ reverse handled by reversed buffer)
      const offset = clamp(clip.trimIn, 0, Math.max(0, buf.duration - 0.01));
      const playable = Math.min(clip.duration * speed, Math.max(0, buf.duration - offset));
      const vol = clip.volume ?? 1;
      const fi = clip.fadeIn || 0, fo = clip.fadeOut || 0;
      const T = ctx.currentTime;
      g.gain.setValueAtTime(0, T + start);
      g.gain.linearRampToValueAtTime(vol, T + start + Math.min(fi, clip.duration));
      if (fo > 0) {
        g.gain.setValueAtTime(vol, T + start + Math.max(0, clip.duration - fo));
        g.gain.linearRampToValueAtTime(0.0001, T + start + clip.duration);
      }
      try { src.start(T + start, offset, playable + 0.02); } catch (e) { /* ignore */ }
    }
  }
  if (!any) return ctx.startRendering();   // silence
  return ctx.startRendering();
}

function reverseBuffer(ctx, buf) {
  const b = ctx.createBuffer(buf.numberOfChannels, buf.length, buf.sampleRate);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const src = buf.getChannelData(c), dst = b.getChannelData(c);
    for (let i = 0, n = src.length; i < n; i++) dst[i] = src[n - 1 - i];
  }
  return b;
}

// ---------- beat detection (for auto-cut) ----------
export function detectBeats(buffer, { threshold = 1.35, minGap = 0.28 } = {}) {
  if (!buffer) return [];
  const sr = buffer.sampleRate;
  const data = buffer.getChannelData(0);
  const win = Math.floor(sr * 0.02);
  const energies = [];
  for (let i = 0; i + win < data.length; i += win) {
    let e = 0;
    for (let j = i; j < i + win; j += 2) e += data[j] * data[j];
    energies.push(Math.sqrt(e / (win / 2)));
  }
  const beats = [];
  const hist = [];
  for (let i = 0; i < energies.length; i++) {
    hist.push(energies[i]);
    if (hist.length > 43) hist.shift();
    const avg = hist.reduce((a, b) => a + b, 0) / hist.length;
    const local = energies.slice(Math.max(0, i - 8), i + 8);
    const localAvg = local.reduce((a, b) => a + b, 0) / Math.max(1, local.length);
    const t = i * 0.02;
    if (energies[i] > localAvg * threshold && energies[i] > avg * threshold * 0.9) {
      if (!beats.length || t - beats[beats.length - 1] > minGap) beats.push(+t.toFixed(3));
    }
  }
  return beats;
}

export async function beatsForProject(project) {
  for (const m of project.media) {
    if (m.kind !== 'audio' && m.kind !== 'video') continue;
    const b = await getAudioBuffer(m, 22050);
    if (b) {
      const beats = detectBeats(b);
      if (beats.length > 3) return beats;
    }
  }
  return [];
}
