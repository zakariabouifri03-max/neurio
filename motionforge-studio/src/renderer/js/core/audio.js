// Audio: decoding, waveform peaks, live playback sync and offline mixdown (WAV) for export.
import { S, bus, scene, fps } from './state.js';
import { assetBytes, assetMeta, assets } from './model.js';

let ctx = null; const bufCache = new Map(); const peakCache = new Map();
export function audioCtx() { if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' }); return ctx; }
export async function decodeAsset(assetId) {
  if (bufCache.has(assetId)) return bufCache.get(assetId);
  const b = await assetBytes(assetId); if (!b) throw new Error('Audio data missing');
  const copy = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  const buf = await audioCtx().decodeAudioData(copy);
  bufCache.set(assetId, buf); return buf;
}
export const bufferOf = (id) => bufCache.get(id) || null;
export function peaks(assetId, n = 1200) {
  const key = assetId + ':' + n; if (peakCache.has(key)) return peakCache.get(key);
  const buf = bufCache.get(assetId); if (!buf) return null;
  const ch = buf.getChannelData(0); const out = new Float32Array(n * 2); const step = Math.max(1, Math.floor(ch.length / n));
  for (let i = 0; i < n; i++) { let mn = 1, mx = -1; const s = i * step, e = Math.min(ch.length, s + step); for (let j = s; j < e; j += Math.max(1, (step / 64) | 0)) { const v = ch[j]; if (v < mn) mn = v; if (v > mx) mx = v; } out[i * 2] = mn > mx ? 0 : mn; out[i * 2 + 1] = mn > mx ? 0 : mx; }
  peakCache.set(key, out); return out;
}
export async function ensureSceneAudio(sc = scene()) {
  for (const c of sc.audio || []) { if (!bufCache.has(c.assetId)) { try { await decodeAsset(c.assetId); } catch (e) { console.warn('audio decode', e); c.broken = true; } } }
}
/** Clip duration on the timeline (seconds) after trims. */
export function clipDuration(c) { const b = bufCache.get(c.assetId); const full = b ? b.duration : 0; return Math.max(0, (c.trimOut != null ? c.trimOut : full) - (c.trimIn || 0)); }
export function clipEndFrame(c, fpsv = fps()) { return c.start + Math.ceil(clipDuration(c) * fpsv); }

function gainAt(c, t, dur) { // t = seconds from clip start
  let g = c.volume == null ? 1 : c.volume;
  if (c.fadeIn > 0 && t < c.fadeIn) g *= Math.max(0, t / c.fadeIn);
  if (c.fadeOut > 0 && t > dur - c.fadeOut) g *= Math.max(0, (dur - t) / c.fadeOut);
  return g;
}
function schedule(audioContext, dest, c, buf, t0, whenBase) {
  const f = fps(); const s = c.start / f; const dur = clipDuration(c); if (c.muted) return null;
  if (s + dur <= t0) return null;
  const src = audioContext.createBufferSource(); src.buffer = buf;
  const gn = audioContext.createGain(); src.connect(gn); gn.connect(dest);
  const into = Math.max(0, t0 - s); const when = whenBase + Math.max(0, s - t0);
  const offset = (c.trimIn || 0) + into; const len = dur - into; if (len <= 0) return null;
  // gain automation
  gn.gain.setValueAtTime(gainAt(c, into, dur), when);
  if (c.fadeIn > 0 && into < c.fadeIn) gn.gain.linearRampToValueAtTime((c.volume ?? 1), when + (c.fadeIn - into));
  if (c.fadeOut > 0) { const fo = dur - c.fadeOut; const tt = when + Math.max(0, fo - into); if (fo > into) gn.gain.setValueAtTime(c.volume ?? 1, tt); gn.gain.linearRampToValueAtTime(0, when + (dur - into)); }
  src.start(when, offset, len);
  return src;
}
let live = [];
export function startAudio(fromFrame) {
  stopAudio(); const sc = scene(); if (!sc || !sc.audio || !sc.audio.length) return;
  const ac = audioCtx(); if (ac.state === 'suspended') ac.resume();
  const t0 = fromFrame / fps(); const base = ac.currentTime + 0.05;
  for (const c of sc.audio) { const b = bufCache.get(c.assetId); if (!b) continue; const s = schedule(ac, ac.destination, c, b, t0, base); if (s) live.push(s); }
  return base;
}
export function stopAudio() { for (const s of live) { try { s.stop(); } catch {} } live = []; }
export function audioClock() { return ctx ? ctx.currentTime : 0; }

/** Mix scene audio to a 16-bit PCM WAV (Uint8Array) or null when the scene has no audible clips. */
export async function mixdown(sc, fpsv, startFrame, endFrame, sr = 44100) {
  const clips = (sc.audio || []).filter((c) => !c.muted && bufCache.has(c.assetId));
  if (!clips.length) return null;
  const t0 = startFrame / fpsv, t1 = (endFrame + 1) / fpsv; const len = Math.ceil((t1 - t0) * sr);
  const off = new OfflineAudioContext(2, len, sr);
  let any = false;
  for (const c of clips) {
    const buf = bufCache.get(c.assetId); const s = c.start / fpsv; const dur = clipDuration(c);
    if (s + dur <= t0 || s >= t1) continue;
    const src = off.createBufferSource(); src.buffer = buf; const gn = off.createGain(); src.connect(gn); gn.connect(off.destination);
    const into = Math.max(0, t0 - s); const when = Math.max(0, s - t0); const rem = dur - into; if (rem <= 0) continue;
    gn.gain.setValueAtTime(gainAt(c, into, dur), when);
    if (c.fadeIn > 0 && into < c.fadeIn) gn.gain.linearRampToValueAtTime(c.volume ?? 1, when + (c.fadeIn - into));
    if (c.fadeOut > 0) { const fo = dur - c.fadeOut; if (fo > into) gn.gain.setValueAtTime(c.volume ?? 1, when + (fo - into)); gn.gain.linearRampToValueAtTime(0, when + rem); }
    src.start(when, (c.trimIn || 0) + into, rem); any = true;
  }
  if (!any) return null;
  const out = await off.startRendering();
  return encodeWav(out);
}
export function encodeWav(buf) {
  const n = buf.length, ch = buf.numberOfChannels, sr = buf.sampleRate; const bytes = new Uint8Array(44 + n * ch * 2); const dv = new DataView(bytes.buffer);
  const wr = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  wr(0, 'RIFF'); dv.setUint32(4, 36 + n * ch * 2, true); wr(8, 'WAVE'); wr(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, ch, true); dv.setUint32(24, sr, true); dv.setUint32(28, sr * ch * 2, true); dv.setUint16(32, ch * 2, true); dv.setUint16(34, 16, true); wr(36, 'data'); dv.setUint32(40, n * ch * 2, true);
  const data = []; for (let c = 0; c < ch; c++) data.push(buf.getChannelData(c));
  let o = 44; for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const v = Math.max(-1, Math.min(1, data[c][i])); dv.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true); o += 2; }
  return bytes;
}
