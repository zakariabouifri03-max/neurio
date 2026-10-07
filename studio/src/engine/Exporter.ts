/**
 * Exporter — renders the project frame-by-frame with its own WebGL Renderer (no preview involvement),
 * encodes with WebCodecs (VideoEncoder/AudioEncoder) and muxes into MP4 (mp4-muxer) or WebM (webm-muxer).
 * Progress is real (encoded frames / total). When WebCodecs is missing a realtime MediaRecorder fallback
 * records the canvas + mixed audio to WebM and is labelled as such.
 */
import type { Project, VideoClip, VisualClip } from '@/core/types';
import { Renderer, type FrameProvider, type FrameSource } from './Renderer';
import { getAsset, getImage, getUrl, getAudioContext } from './MediaManager';
import { renderMixdown } from './AudioEngine';
import { engine } from './PlaybackEngine';
import { projectDuration, timelineToSourceOffset } from '@/core/commands';

export type Container = 'mp4' | 'webm';
export type VideoCodecId = 'avc' | 'hevc' | 'vp9' | 'av1' | 'vp8';
export interface ExportSettings {
  width: number;
  height: number;
  fps: number;
  container: Container;
  codec: VideoCodecId;
  /** video bitrate in bits per second */
  bitrate: number;
  audioBitrate: number; // bps
  includeAudio: boolean;
  range: { start: number; end: number };
  hardwareAcceleration?: 'no-preference' | 'prefer-hardware' | 'prefer-software';
}
export interface ExportProgress {
  phase: 'preparing' | 'audio' | 'video' | 'muxing' | 'done';
  progress: number; // 0..1 overall
  frame: number;
  totalFrames: number;
  fps: number; // encode speed
  etaSec: number | null;
  bytes?: number;
  note?: string;
}
export interface ExportResult {
  blob: Blob;
  filename: string;
  method: 'webcodecs' | 'mediarecorder';
  seconds: number;
}

export interface CodecOption {
  id: VideoCodecId;
  label: string;
  container: Container;
  codecString: (w: number, h: number, fps: number) => string;
}
export const CODECS: CodecOption[] = [
  { id: 'avc', label: 'H.264 / AVC (most compatible)', container: 'mp4', codecString: (w, h, fps) => `avc1.6400${avcLevel(w, h, fps)}` },
  { id: 'hevc', label: 'H.265 / HEVC (smaller files)', container: 'mp4', codecString: () => 'hvc1.1.6.L153.B0' },
  { id: 'av1', label: 'AV1 (best quality per bit)', container: 'mp4', codecString: () => 'av01.0.08M.08' },
  { id: 'vp9', label: 'VP9', container: 'webm', codecString: () => 'vp09.00.10.08' },
  { id: 'av1', label: 'AV1', container: 'webm', codecString: () => 'av01.0.08M.08' },
  { id: 'vp8', label: 'VP8 (legacy)', container: 'webm', codecString: () => 'vp8' },
];
function avcLevel(w: number, h: number, fps: number) {
  const mbs = Math.ceil(w / 16) * Math.ceil(h / 16) * fps;
  if (w * h > 1920 * 1088 || mbs > 245760) return w * h > 4096 * 2304 ? '34' : '33'; // 5.1 / 5.2
  if (mbs > 108000) return '2A'; // 4.2
  if (mbs > 40500) return '28'; // 4.0
  return '1F'; // 3.1
}

export const hasWebCodecs = () => typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
export const hasMediaRecorder = () => typeof MediaRecorder !== 'undefined' && !!HTMLCanvasElement.prototype.captureStream;

/** Probe which codecs the browser can actually encode at the requested size. */
export async function probeCodecs(w: number, h: number, fps: number, bitrate: number): Promise<{ option: CodecOption; supported: boolean; reason?: string }[]> {
  if (!hasWebCodecs()) return CODECS.map((option) => ({ option, supported: false, reason: 'WebCodecs not available' }));
  const out: { option: CodecOption; supported: boolean; reason?: string }[] = [];
  for (const option of CODECS) {
    try {
      const cfg: VideoEncoderConfig = { codec: option.codecString(w, h, fps), width: w, height: h, bitrate, framerate: fps };
      if (option.id === 'avc') (cfg as any).avc = { format: 'avc' };
      if (option.id === 'hevc') (cfg as any).hevc = { format: 'hevc' };
      const r = await VideoEncoder.isConfigSupported(cfg);
      out.push({ option, supported: !!r.supported, reason: r.supported ? undefined : 'Not supported by this browser/GPU' });
    } catch (e: any) {
      out.push({ option, supported: false, reason: String(e?.message || e) });
    }
  }
  return out;
}
export async function probeAudioCodec(container: Container, sampleRate: number, bitrate: number): Promise<'aac' | 'opus' | null> {
  if (typeof AudioEncoder === 'undefined') return null;
  const tryCfg = async (codec: string) => {
    try {
      return (await AudioEncoder.isConfigSupported({ codec, sampleRate, numberOfChannels: 2, bitrate })).supported;
    } catch {
      return false;
    }
  };
  if (container === 'mp4' && (await tryCfg('mp4a.40.2'))) return 'aac';
  if (await tryCfg('opus')) return 'opus';
  return null;
}

/** Rough file size estimate (bytes) from bitrates and duration. */
export function estimateSize(s: ExportSettings) {
  const dur = Math.max(0, s.range.end - s.range.start);
  return (dur * (s.bitrate + (s.includeAudio ? s.audioBitrate : 0))) / 8;
}
/** Sensible default bitrate for a resolution/fps (close to platform recommendations). */
export function recommendedBitrate(w: number, h: number, fps: number, codec: VideoCodecId = 'avc') {
  const px = w * h;
  let mbps = px >= 3840 * 2160 ? 45 : px >= 2560 * 1440 ? 20 : px >= 1920 * 1080 ? 10 : px >= 1280 * 720 ? 6 : 3;
  if (fps > 40) mbps *= 1.5;
  if (codec === 'hevc' || codec === 'vp9') mbps *= 0.7;
  if (codec === 'av1') mbps *= 0.55;
  return Math.round(mbps * 1e6);
}

/* ------------------------------------------------------------------------------------------------ */
/* Precise frame provider: seeks every video element and awaits 'seeked' before a frame is rendered. */
/* ------------------------------------------------------------------------------------------------ */
class ExportProvider implements FrameProvider {
  private videos = new Map<string, { el: HTMLVideoElement; ready: Promise<void> }>();
  private images = new Map<string, HTMLImageElement | ImageBitmap>();
  private frames = new Map<string, FrameSource>();
  private version = 0;
  constructor(private project: Project) {}

  async prepare() {
    const ids = new Set<string>();
    for (const t of this.project.tracks) for (const c of t.clips) if (c.kind === 'image' || (c.kind === 'sticker' && c.mediaId)) ids.add((c as any).mediaId);
    for (const t of this.project.tracks) for (const c of t.clips) if ((c as any).segmentation?.imageMediaId) ids.add((c as any).segmentation.imageMediaId);
    await Promise.all([...ids].map(async (id) => {
      try {
        this.images.set(id, await getImage(id));
      } catch {}
    }));
  }
  private async video(clip: VideoClip) {
    let v = this.videos.get(clip.id);
    if (v) return v;
    const url = await getUrl(clip.mediaId);
    const el = document.createElement('video');
    el.muted = true;
    el.playsInline = true;
    el.preload = 'auto';
    el.crossOrigin = 'anonymous';
    el.src = url || '';
    const ready = new Promise<void>((res) => {
      el.addEventListener('loadeddata', () => res(), { once: true });
      el.addEventListener('error', () => res(), { once: true });
      setTimeout(res, 10000);
    });
    el.load();
    v = { el, ready };
    this.videos.set(clip.id, v);
    return v;
  }
  /** Seek all videos visible at `time`; resolves when their frames are ready. */
  async seekAll(time: number) {
    this.version++;
    const jobs: Promise<void>[] = [];
    for (const t of this.project.tracks) {
      if (t.kind === 'audio' || t.hidden) continue;
      for (const c of t.clips) {
        if (c.kind !== 'video') continue;
        // include neighbours for transitions (a transition spans the cut)
        const tin = c.transitionIn?.duration ?? 0, tout = c.transitionOut?.duration ?? 0;
        if (time < c.start - tin - 0.001 || time > c.start + c.duration + tout + 0.001) continue;
        const asset = getAsset(c.mediaId);
        if (!asset) continue;
        const local = Math.max(0, Math.min(c.duration, time - c.start));
        const src = c.speed.freezeAt !== undefined ? c.speed.freezeAt : timelineToSourceOffset(c, local) + c.mediaIn;
        jobs.push(this.seekOne(c, Math.max(0, Math.min((asset.duration || 1e9) - 0.02, src))));
      }
    }
    await Promise.all(jobs);
  }
  private async seekOne(clip: VideoClip, target: number) {
    const v = await this.video(clip);
    await v.ready;
    const el = v.el;
    if (Math.abs(el.currentTime - target) > 0.0005 || el.readyState < 2) {
      await new Promise<void>((res) => {
        const done = () => {
          clearTimeout(timer);
          res();
        };
        const timer = setTimeout(done, 2000);
        el.addEventListener('seeked', done, { once: true });
        el.currentTime = target;
      });
      // Give the decoder a tick to surface the frame (Chrome occasionally reports seeked early)
      if ('requestVideoFrameCallback' in el) await new Promise<void>((res) => { let settled = false; (el as any).requestVideoFrameCallback(() => { if (!settled) { settled = true; res(); } }); setTimeout(() => { if (!settled) { settled = true; res(); } }, 60); });
    }
    this.frames.set(clip.id, { source: el, width: el.videoWidth, height: el.videoHeight, version: this.version });
  }
  videoFrame(clip: VideoClip): FrameSource | null {
    return this.frames.get(clip.id) ?? null;
  }
  imageFrame(mediaId: string): FrameSource | null {
    const img = this.images.get(mediaId);
    if (!img) return null;
    const w = (img as HTMLImageElement).naturalWidth || (img as ImageBitmap).width;
    const h = (img as HTMLImageElement).naturalHeight || (img as ImageBitmap).height;
    return { source: img as any, width: w, height: h, version: 1 };
  }
  segmentationMask(clip: VisualClip, frame: FrameSource) {
    return engine.segmentation ? engine.segmentation(clip, frame) : null;
  }
  dispose() {
    for (const v of this.videos.values()) {
      v.el.pause();
      v.el.removeAttribute('src');
      v.el.load();
    }
    this.videos.clear();
  }
}

/* ------------------------------------------------------------------------------------------------ */
export interface ExportHandle {
  cancel: () => void;
}

export async function exportProject(project: Project, settings: ExportSettings, onProgress: (p: ExportProgress) => void, handle?: ExportHandle & { cancelled?: boolean }): Promise<ExportResult> {
  const state = { cancelled: false };
  if (handle) handle.cancel = () => (state.cancelled = true);
  const t0 = performance.now();
  const start = Math.max(0, settings.range.start);
  const end = Math.min(Math.max(projectDuration(project), start + 1 / settings.fps), settings.range.end);
  const duration = end - start;
  const totalFrames = Math.max(1, Math.round(duration * settings.fps));
  const W = settings.width & ~1, H = settings.height & ~1;
  const safeName = project.name.replace(/[^\w\- ]+/g, '').trim() || 'export';
  onProgress({ phase: 'preparing', progress: 0, frame: 0, totalFrames, fps: 0, etaSec: null });

  if (!hasWebCodecs()) {
    if (!hasMediaRecorder()) throw new Error('This browser supports neither WebCodecs nor MediaRecorder — export is unavailable here. Try Chrome, Edge or Safari 16.4+.');
    const blob = await exportWithMediaRecorder(project, settings, W, H, start, duration, totalFrames, onProgress, state);
    return { blob, filename: `${safeName}.webm`, method: 'mediarecorder', seconds: (performance.now() - t0) / 1000 };
  }

  const codecOpt = CODECS.find((c) => c.id === settings.codec && c.container === settings.container) || CODECS[0];
  const videoCfg: VideoEncoderConfig = { codec: codecOpt.codecString(W, H, settings.fps), width: W, height: H, bitrate: settings.bitrate, framerate: settings.fps, hardwareAcceleration: settings.hardwareAcceleration || 'no-preference', latencyMode: 'quality' } as any;
  if (codecOpt.id === 'avc') (videoCfg as any).avc = { format: 'avc' };
  if (codecOpt.id === 'hevc') (videoCfg as any).hevc = { format: 'hevc' };
  const sup = await VideoEncoder.isConfigSupported(videoCfg);
  if (!sup.supported) throw new Error(`${codecOpt.label} is not supported by this browser at ${W}×${H}. Pick another codec.`);

  // ---- audio first (fast, gives the muxer its track) ----
  let audioBuf: AudioBuffer | null = null;
  let audioCodec: 'aac' | 'opus' | null = null;
  const sampleRate = 48000;
  if (settings.includeAudio) {
    audioCodec = await probeAudioCodec(settings.container, sampleRate, settings.audioBitrate);
    if (audioCodec) {
      onProgress({ phase: 'audio', progress: 0.02, frame: 0, totalFrames, fps: 0, etaSec: null });
      const full = await renderMixdown(project, end, sampleRate, (p) => onProgress({ phase: 'audio', progress: 0.02 + p * 0.08, frame: 0, totalFrames, fps: 0, etaSec: null }));
      audioBuf = start > 0 ? sliceBuffer(full, start, end) : full;
    }
  }
  if (state.cancelled) throw new Error('Cancelled');

  // ---- muxer ----
  let muxer: any;
  let target: any;
  if (settings.container === 'mp4') {
    const mp4 = await import('mp4-muxer');
    target = new mp4.ArrayBufferTarget();
    muxer = new mp4.Muxer({ target, video: { codec: codecOpt.id === 'vp8' ? 'vp9' : (codecOpt.id as any), width: W, height: H, frameRate: settings.fps }, audio: audioBuf && audioCodec ? { codec: audioCodec, numberOfChannels: 2, sampleRate } : undefined, fastStart: 'in-memory', firstTimestampBehavior: 'offset' });
  } else {
    const webm = await import('webm-muxer');
    target = new webm.ArrayBufferTarget();
    muxer = new webm.Muxer({ target, video: { codec: codecOpt.id === 'vp9' ? 'V_VP9' : codecOpt.id === 'av1' ? 'V_AV1' : 'V_VP8', width: W, height: H, frameRate: settings.fps }, audio: audioBuf && audioCodec ? { codec: 'A_OPUS', numberOfChannels: 2, sampleRate } : undefined, firstTimestampBehavior: 'offset' });
  }

  // ---- audio encode ----
  if (audioBuf && audioCodec) {
    const aenc = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: (e) => console.error(e) });
    aenc.configure({ codec: audioCodec === 'aac' ? 'mp4a.40.2' : 'opus', sampleRate, numberOfChannels: 2, bitrate: settings.audioBitrate });
    const frames = 1024 * 10;
    const L = audioBuf.getChannelData(0), R = audioBuf.numberOfChannels > 1 ? audioBuf.getChannelData(1) : L;
    for (let off = 0; off < audioBuf.length; off += frames) {
      const n = Math.min(frames, audioBuf.length - off);
      const data = new Float32Array(n * 2);
      data.set(L.subarray(off, off + n), 0);
      data.set(R.subarray(off, off + n), n);
      const ad = new AudioData({ format: 'f32-planar', sampleRate, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((off / sampleRate) * 1e6), data });
      aenc.encode(ad);
      ad.close();
      if (aenc.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 5));
    }
    await aenc.flush();
    aenc.close();
  }
  if (state.cancelled) throw new Error('Cancelled');

  // ---- video ----
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const renderer = new Renderer(canvas);
  const provider = new ExportProvider(project);
  await provider.prepare();
  let encError: Error | null = null;
  const venc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => (encError = e as Error) });
  venc.configure(videoCfg);
  const keyEvery = Math.round(settings.fps * 2);
  let encoded = 0;
  const tv0 = performance.now();
  try {
    for (let i = 0; i < totalFrames; i++) {
      if (state.cancelled) throw new Error('Cancelled');
      if (encError) throw encError;
      const t = start + i / settings.fps;
      await provider.seekAll(t + 1e-4);
      renderer.render(project, t + 1e-4, provider, { width: W, height: H, toCanvas: true });
      const frame = new VideoFrame(canvas, { timestamp: Math.round((i / settings.fps) * 1e6), duration: Math.round(1e6 / settings.fps) });
      venc.encode(frame, { keyFrame: i % keyEvery === 0 });
      frame.close();
      encoded++;
      while (venc.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 2));
      if (i % 2 === 0 || i === totalFrames - 1) {
        const el = (performance.now() - tv0) / 1000;
        const fps = encoded / Math.max(0.001, el);
        onProgress({ phase: 'video', progress: 0.1 + 0.88 * ((i + 1) / totalFrames), frame: i + 1, totalFrames, fps, etaSec: fps > 0 ? (totalFrames - i - 1) / fps : null });
      }
      // let the UI breathe every few frames
      if (i % 4 === 3) await new Promise((r) => setTimeout(r, 0));
    }
    await venc.flush();
  } finally {
    try {
      venc.close();
    } catch {}
    provider.dispose();
    renderer.dispose();
  }
  onProgress({ phase: 'muxing', progress: 0.99, frame: totalFrames, totalFrames, fps: 0, etaSec: 0 });
  muxer.finalize();
  const blob = new Blob([target.buffer], { type: settings.container === 'mp4' ? 'video/mp4' : 'video/webm' });
  onProgress({ phase: 'done', progress: 1, frame: totalFrames, totalFrames, fps: 0, etaSec: 0, bytes: blob.size });
  return { blob, filename: `${safeName}.${settings.container}`, method: 'webcodecs', seconds: (performance.now() - t0) / 1000 };
}

function sliceBuffer(b: AudioBuffer, from: number, to: number): AudioBuffer {
  const sr = b.sampleRate;
  const s = Math.floor(from * sr), e = Math.min(b.length, Math.ceil(to * sr));
  const out = new AudioBuffer({ length: Math.max(1, e - s), numberOfChannels: b.numberOfChannels, sampleRate: sr });
  for (let c = 0; c < b.numberOfChannels; c++) out.copyToChannel(b.getChannelData(c).subarray(s, e), c);
  return out;
}

/* ----------------------------- realtime fallback ----------------------------- */
async function exportWithMediaRecorder(project: Project, settings: ExportSettings, W: number, H: number, start: number, duration: number, totalFrames: number, onProgress: (p: ExportProgress) => void, state: { cancelled: boolean }): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const renderer = new Renderer(canvas);
  const provider = new ExportProvider(project);
  await provider.prepare();
  const stream = canvas.captureStream(0);
  const vtrack = stream.getVideoTracks()[0] as any;
  let audioSrc: AudioBufferSourceNode | null = null;
  if (settings.includeAudio) {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') await ctx.resume();
    const mix = await renderMixdown(project, start + duration, ctx.sampleRate, (p) => onProgress({ phase: 'audio', progress: p * 0.1, frame: 0, totalFrames, fps: 0, etaSec: null }));
    const dest = ctx.createMediaStreamDestination();
    audioSrc = ctx.createBufferSource();
    audioSrc.buffer = mix;
    audioSrc.connect(dest);
    dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
  }
  const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m)) || '';
  const rec = new MediaRecorder(stream, { mimeType: mime || undefined, videoBitsPerSecond: settings.bitrate, audioBitsPerSecond: settings.audioBitrate });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise<void>((res) => (rec.onstop = () => res()));
  rec.start(250);
  audioSrc?.start(0, start, duration);
  const tv0 = performance.now();
  const frameMs = 1000 / settings.fps;
  try {
    for (let i = 0; i < totalFrames; i++) {
      if (state.cancelled) break;
      const t = start + i / settings.fps;
      await provider.seekAll(t + 1e-4);
      renderer.render(project, t + 1e-4, provider, { width: W, height: H, toCanvas: true });
      vtrack.requestFrame?.();
      // keep realtime pacing (MediaRecorder timestamps are wall-clock)
      const due = tv0 + (i + 1) * frameMs;
      const wait = due - performance.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      const el = (performance.now() - tv0) / 1000;
      onProgress({ phase: 'video', progress: 0.1 + 0.88 * ((i + 1) / totalFrames), frame: i + 1, totalFrames, fps: (i + 1) / Math.max(0.001, el), etaSec: (totalFrames - i - 1) / settings.fps, note: 'Realtime fallback (MediaRecorder) — WebCodecs unavailable in this browser' });
    }
  } finally {
    rec.stop();
    try {
      audioSrc?.stop();
    } catch {}
    await done;
    provider.dispose();
    renderer.dispose();
  }
  if (state.cancelled) throw new Error('Cancelled');
  return new Blob(chunks, { type: 'video/webm' });
}
