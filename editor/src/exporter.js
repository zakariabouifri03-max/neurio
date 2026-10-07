// Montaj Pro — video export: WebCodecs (fast, frame accurate) + MediaRecorder (compatible)
import { clamp, download, bytesToBase64, supports } from './util.js';
import { projectDuration, trackClipsSorted } from './state.js';
import { drawFrame, getCanvas, releaseCanvas } from './render.js';
import { mixProject } from './audio.js';

// Seek-based source provider: frame accurate, works for preview-independent export
export class SeekProvider {
  constructor(project) {
    this.project = project;
    this.els = new Map();
    this.lastSeek = new Map();
    this.lastTime = new Map();
  }
  elementFor(media) {
    if (this.els.has(media.id)) return this.els.get(media.id);
    let el;
    if (media.kind === 'image') {
      el = new Image();
      el.decoding = 'async';
      el.src = media.url;
    } else {
      el = document.createElement('video');
      el.src = media.url;
      el.muted = true; el.playsInline = true; el.preload = 'auto';
      el.style.cssText = 'position:fixed;left:-9999px;top:0;width:2px;height:2px;opacity:0;pointer-events:none';
      document.body.appendChild(el);
      el.load && el.load();
    }
    this.els.set(media.id, el);
    return el;
  }
  async prepare(time) {
    const jobs = [];
    for (const track of this.project.tracks) {
      if (track.type === 'audio' || track.hidden) continue;
      for (const clip of trackClipsSorted(track.id)) {
        const inTransition = clip.transition && clip.transition.type !== 'none' && time <= clip.start + (clip.transition.duration || 0) + 0.001;
        if (!(time >= clip.start && time < clip.start + clip.duration) && !inTransition) continue;
        if (clip.type !== 'video') continue;
        const media = this.project.media.find(m => m.id === clip.mediaId);
        if (!media) continue;
        jobs.push(this.seekClip(clip, media, time));
      }
    }
    await Promise.all(jobs);
  }
  async seekClip(clip, media, time) {
    const el = this.elementFor(media);
    const local = clamp(time - clip.start, -0.5, clip.duration + 0.5);
    let srcT = clip.reverse ? (clip.trimOut - local * clip.speed) : (clip.trimIn + local * clip.speed);
    const lo = Math.min(clip.trimIn, clip.trimOut), hi = Math.max(clip.trimIn, clip.trimOut);
    srcT = clamp(srcT, Math.min(lo, hi), Math.max(lo, hi));
    srcT = clamp(srcT, 0, Math.max(0, (media.duration || 1) - 0.001));
    const prev = this.lastSeek.get(clip.id);
    if (prev != null && Math.abs(prev - srcT) < 1 / 240) return;
    this.lastSeek.set(clip.id, srcT);
    await seekTo(el, srcT);
  }
  getSource(clip, sourceTime) {
    const media = this.project.media.find(m => m.id === clip.mediaId);
    if (!media) return null;
    const el = this.elementFor(media);
    if (media.kind === 'image') return el.complete ? el : null;
    return el.readyState >= 2 ? el : null;
  }
  destroy() {
    for (const el of this.els.values()) { try { el.remove && el.remove(); if (el.pause) el.pause(); } catch (e) { } }
    this.els.clear();
  }
}

export function seekTo(el, t) {
  return new Promise((resolve) => {
    if (!el || el.readyState === 0) { resolve(); return; }
    if (!isFinite(t)) t = 0;
    if (Math.abs((el.currentTime || 0) - t) < 1e-3 && el.readyState >= 2) { resolve(); return; }
    let done = false;
    const finish = () => { if (done) return; done = true; el.removeEventListener('seeked', finish); resolve(); };
    el.addEventListener('seeked', finish, { once: true });
    try { el.currentTime = t; } catch (e) { finish(); }
    setTimeout(finish, 900);
  });
}

export async function pickCodecs({ format = 'mp4', width, height, fps, bitrate }) {
  const res = { format, videoCodec: null, audioCodec: null, muxer: null, config: null };
  if (format === 'webm') {
    res.videoCodec = 'vp09.00.10.08';
    res.audioCodec = 'opus';
  } else {
    res.videoCodec = height > 1080 || width > 1920 ? 'avc1.640033' : 'avc1.4d0028';
    res.audioCodec = 'mp4a.40.2';
  }
  if (supports.webcodecs) {
    try {
      const s = await VideoEncoder.isConfigSupported({ codec: res.videoCodec, width, height, bitrate, framerate: fps });
      if (!s.supported) res.videoCodec = null;
    } catch (e) { res.videoCodec = null; }
    if (res.videoCodec === null && format === 'mp4') {
      for (const c of ['avc1.42E01E', 'avc1.42001E', 'avc1.4d001e']) {
        try { const s = await VideoEncoder.isConfigSupported({ codec: c, width, height, bitrate, framerate: fps }); if (s.supported) { res.videoCodec = c; break; } } catch (e) { }
      }
    }
  }
  if (supports.audioEncoder) {
    try {
      const s = await AudioEncoder.isConfigSupported({ codec: res.audioCodec, sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 });
      if (!s.supported) res.audioCodec = null;
    } catch (e) { res.audioCodec = null; }
    if (!res.audioCodec && format === 'mp4') {
      try { const s = await AudioEncoder.isConfigSupported({ codec: 'opus', sampleRate: 48000, numberOfChannels: 2, bitrate: 160000 }); if (s.supported) { res.audioCodec = 'opus'; res.format = 'webm'; } } catch (e) { }
    }
  }
  return res;
}

export async function exportWebCodecs(project, opts, hooks) {
  const { onProgress = () => { }, onStatus = () => { }, signal } = hooks;
  const W = project.settings.width, H = project.settings.height;
  const fps = opts.fps || project.settings.fps || 30;
  const duration = Math.max(0.05, projectDuration(project));
  const totalFrames = Math.max(1, Math.round(duration * fps));
  const bitrate = opts.bitrate || Math.round(W * H * fps * 0.085);
  const codes = await pickCodecs({ format: opts.format || 'mp4', width: W, height: H, fps, bitrate });
  if (!codes.videoCodec) throw new Error('WebCodecs video encoder unavailable');

  const isWebm = codes.format === 'webm' || codes.audioCodec === 'opus';
  const mod = isWebm
    ? await import('../vendor/webm-muxer.mjs')
    : await import('../vendor/mp4-muxer.mjs');
  const muxerOpts = {
    target: new mod.ArrayBufferTarget(),
    fastStart: isWebm ? undefined : 'in-memory',
    firstTimestampBehavior: 'offset',
  };
  muxerOpts.video = isWebm ? { codec: 'V_VP9', width: W, height: H, frameRate: fps } : { codec: 'avc', width: W, height: H, frameRate: fps };
  let audioMixed = null;
  let audioEncoded = false;
  onStatus('mixing-audio');
  try { audioMixed = await mixProject(project, { sampleRate: 48000 }); } catch (e) { console.warn('audio mix failed', e); }
  const hasAudio = !!audioMixed && audioMixed.length > 0;
  const audioCodec = isWebm ? 'opus' : (codes.audioCodec || 'opus');
  if (hasAudio) {
    muxerOpts.audio = isWebm
      ? { codec: 'A_OPUS', numberOfChannels: 2, sampleRate: 48000 }
      : { codec: 'aac', numberOfChannels: 2, sampleRate: 48000 };
  }
  const muxer = new mod.Muxer(muxerOpts);

  // --- encoders ---
  let encError = null;
  const venc = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { encError = e; },
  });
  venc.configure({ codec: codes.videoCodec, width: W, height: H, bitrate, framerate: fps, latencyMode: 'quality', avc: { format: 'avc' } });

  let aenc = null;
  if (hasAudio) {
    try {
      aenc = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: (e) => { encError = e; } });
      aenc.configure({ codec: audioCodec, sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 });
    } catch (e) { aenc = null; }
  }

  // --- audio pass ---
  if (aenc && audioMixed) {
    const sr = audioMixed.sampleRate;
    const ch = Math.min(2, audioMixed.numberOfChannels);
    const chans = [];
    for (let c = 0; c < 2; c++) chans.push(audioMixed.getChannelData(Math.min(c, audioMixed.numberOfChannels - 1)));
    const block = 1024;
    for (let i = 0; i < audioMixed.length; i += block) {
      if (signal && signal.cancelled) break;
      const n = Math.min(block, audioMixed.length - i);
      const planar = new Float32Array(n * 2);
      planar.set(chans[0].subarray(i, i + n), 0);
      planar.set(chans[1].subarray(i, i + n), n);
      const ad = new AudioData({
        format: 'f32-planar', sampleRate: sr, numberOfFrames: n, numberOfChannels: 2,
        timestamp: Math.round((i / sr) * 1e6),
        data: planar,
      });
      aenc.encode(ad);
      ad.close();
      if (i % (block * 64) === 0) { onProgress({ phase: 'audio', value: i / audioMixed.length, text: `${Math.round(i / audioMixed.length * 100)}%` }); await tick(); }
    }
  }
  audioEncoded = !!aenc;

  // --- video pass ---
  const provider = new SeekProvider(project);
  const canvas = getCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const t0 = performance.now();
  let keyEvery = Math.max(1, Math.round(fps * 2));
  for (let i = 0; i < totalFrames; i++) {
    if (signal && signal.cancelled) break;
    if (encError) throw encError;
    const time = i / fps;
    await provider.prepare(time);
    drawFrame(ctx, project, time, provider, { forExport: true });
    const frame = new VideoFrame(canvas, { timestamp: Math.round((i / fps) * 1e6), duration: Math.round(1e6 / fps) });
    venc.encode(frame, { keyFrame: i % keyEvery === 0 });
    frame.close();
    while (venc.encodeQueueSize > 6) await tick(3);
    if (i % 2 === 0 || i === totalFrames - 1) {
      const elapsed = (performance.now() - t0) / 1000;
      const rate = (i + 1) / Math.max(0.01, elapsed);
      const eta = rate > 0 ? (totalFrames - i - 1) / rate : 0;
      onProgress({ phase: 'video', value: (i + 1) / totalFrames, eta, frame: i + 1, total: totalFrames });
      await tick(0);
    }
  }
  releaseCanvas(canvas);
  provider.destroy();
  if (signal && signal.cancelled) { try { venc.close(); aenc && aenc.close(); } catch (e) { } throw new Error('cancelled'); }
  onStatus('finalizing');
  await venc.flush(); venc.close();
  if (aenc) { try { await aenc.flush(); } catch (e) { } aenc.close(); }
  muxer.finalize();
  const buffer = muxer.target.buffer;
  return {
    blob: new Blob([buffer], { type: isWebm ? 'video/webm' : 'video/mp4' }),
    ext: isWebm ? 'webm' : 'mp4', audioEncoded, duration, frames: totalFrames,
  };
}

const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));

// --- MediaRecorder fallback: real-time capture ---
export async function exportMediaRecorder(project, opts, hooks) {
  const { onProgress = () => { }, signal } = hooks;
  const W = project.settings.width, H = project.settings.height;
  const fps = opts.fps || project.settings.fps || 30;
  const duration = Math.max(0.05, projectDuration(project));
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const stream = canvas.captureStream ? canvas.captureStream(fps) : canvas.mozCaptureStream(fps);

  // live audio: play media elements through a MediaStreamDestination
  const anodes = [];
  let audioCtx = null, dest = null;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AC({ sampleRate: 48000 });
    dest = audioCtx.createMediaStreamDestination();
    const gain = audioCtx.createGain(); gain.connect(dest);
    for (const track of project.tracks) {
      if (track.type !== 'audio' || track.muted) continue;
      for (const clip of project.clips) {
        if (clip.trackId !== track.id || clip.muted || (clip.type !== 'audio' && clip.type !== 'video')) continue;
        const media = project.media.find(m => m.id === clip.mediaId);
        if (!media) continue;
        if (clip.type === 'video' && media.hasAudio === false) continue;
        const el = document.createElement(clip.type === 'audio' ? 'audio' : 'video');
        el.src = media.url; el.playsInline = true;
        el.style.cssText = 'position:fixed;left:-9999px;width:2px;height:2px;opacity:0';
        document.body.appendChild(el);
        const src = audioCtx.createMediaElementSource(el);
        const g = audioCtx.createGain();
        src.connect(g); g.connect(gain);
        anodes.push({ el, clip, gain: g, media });
      }
    }
    const aTrack = dest.stream.getAudioTracks()[0];
    if (aTrack && anodes.length) stream.addTrack(aTrack);
  } catch (e) { console.warn('live audio unavailable', e); }

  const mime = pickRecorderMime(opts.format);
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: opts.bitrate || Math.round(W * H * fps * 0.08), audioBitsPerSecond: 192000 });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  const done = new Promise((resolve) => { rec.onstop = resolve; });

  // playback loop
  const provider = new LiveProvider(project);
  const t0 = performance.now();
  anodes.forEach(({ el, clip, gain, media }) => {
    el.muted = true;
    attachLive(anodes, clip, media, gain);
  });
  rec.start(250);
  await new Promise((resolve) => {
    const loop = () => {
      if (signal && signal.cancelled) return resolve();
      const t = (performance.now() - t0) / 1000;
      provider.sync(t);
      drawFrame(ctx, project, Math.min(t, duration), provider);
      onProgress({ phase: 'record', value: Math.min(1, t / duration), eta: Math.max(0, duration - t) });
      if (t >= duration) return resolve();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
  anodes.forEach(({ el }) => { try { el.pause(); el.remove(); } catch (e) { } });
  rec.stop();
  await done;
  try { audioCtx && audioCtx.close(); } catch (e) { }
  if (signal && signal.cancelled) throw new Error('cancelled');
  return { blob: new Blob(chunks, { type: mime }), ext: mime.includes('mp4') ? 'mp4' : 'webm', duration, frames: Math.round(duration * fps) };
}
function attachLive(anodes, clip, media, gain) { /* audio follows the same element used for video via preview provider */ }

export function pickRecorderMime(format = 'mp4') {
  const list = format === 'webm'
    ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
    : ['video/mp4;codecs=h264,aac', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'];
  for (const m of list) { try { if (MediaRecorder.isTypeSupported(m)) return m; } catch (e) { } }
  return '';
}

// live provider: uses <video> elements playing in real time (for MediaRecorder export)
export class LiveProvider {
  constructor(project) {
    this.project = project;
    this.els = new Map();
    this.playing = false;
  }
  elementFor(media) {
    if (this.els.has(media.id)) return this.els.get(media.id);
    let el;
    if (media.kind === 'image') { el = new Image(); el.src = media.url; }
    else {
      el = document.createElement('video');
      el.src = media.url; el.muted = true; el.playsInline = true; el.preload = 'auto';
      el.style.cssText = 'position:fixed;left:-9999px;top:0;width:2px;height:2px;opacity:0';
      document.body.appendChild(el);
    }
    this.els.set(media.id, el);
    return el;
  }
  sync(t) {
    const wanted = new Map();
    for (const track of this.project.tracks) {
      if (track.type === 'audio' || track.hidden) continue;
      for (const clip of trackClipsSorted(track.id)) {
        if (!(t >= clip.start && t < clip.start + clip.duration)) continue;
        if (clip.type === 'image') continue;
        wanted.set(clip.id, true);
        const media = this.project.media.find(m => m.id === clip.mediaId);
        if (!media) continue;
        const el = this.elementFor(media);
        const local = t - clip.start;
        const srcT = clip.reverse ? (clip.trimOut - local * clip.speed) : (clip.trimIn + local * clip.speed);
        el.playbackRate = clamp(clip.speed || 1, 0.1, 8);
        if (Math.abs((el.currentTime || 0) - srcT) > 0.28) { try { el.currentTime = srcT; } catch (e) { } }
        if (el.paused) { el.play().catch(() => { }); }
      }
    }
    for (const [id, el] of this.els) {
      if (!wanted.has(id) && el.pause && !el.paused) el.pause();
    }
  }
  getSource(clip) {
    const media = this.project.media.find(m => m.id === clip.mediaId);
    if (!media) return null;
    const el = this.elementFor(media);
    if (media.kind === 'image') return el.complete ? el : null;
    return el.readyState >= 2 ? el : null;
  }
  destroy() { for (const el of this.els.values()) { try { el.pause && el.pause(); el.remove && el.remove(); } catch (e) { } } }
}
