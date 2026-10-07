/**
 * PlaybackEngine — drives preview rendering: owns the Renderer on the preview canvas,
 * keeps HTMLVideoElements in sync with the timeline, runs the rAF loop and feeds the
 * AudioEngine. The audio clock is the master clock while playing.
 */
import type { Project, VideoClip, VisualClip } from '@/core/types';
import { Renderer, type FrameProvider, type FrameSource } from './Renderer';
import { AudioEngine } from './AudioEngine';
import { getAsset, getImage, getUrl, getVideoSource, pruneVideoPool, type VideoSource } from './MediaManager';
import { useProject, usePlayback } from '@/core/store';
import { projectDuration } from '@/core/commands';
import { snapToFrame } from '@/core/time';

export type SegmentationProvider = (clip: VisualClip, frame: FrameSource) => { data: Uint8Array; width: number; height: number; version: number } | null;

const imageCache = new Map<string, HTMLImageElement | ImageBitmap>();
const imageLoading = new Set<string>();

export class PlaybackEngine implements FrameProvider {
  renderer: Renderer | null = null;
  audio: AudioEngine | null = null;
  canvas: HTMLCanvasElement | null = null;
  segmentation: SegmentationProvider | null = null;
  private raf = 0;
  private dirty = true;
  private lastRenderedTime = -1;
  private lastProject: Project | null = null;
  private qualityScale = 1;
  private frameTimes: number[] = [];
  private listeners = new Set<() => void>();
  /** when true, the provider seeks videos precisely (export / paused). */
  precise = false;
  private lastTickTime = 0;
  fpsEstimate = 0;

  attach(canvas: HTMLCanvasElement) {
    if (this.canvas === canvas && this.renderer) return;
    this.detach();
    this.canvas = canvas;
    try {
      this.renderer = new Renderer(canvas);
    } catch (e) {
      console.error(e);
      this.renderer = null;
    }
    if (!this.audio) this.audio = new AudioEngine();
    this.dirty = true;
    this.loop();
  }

  detach() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.renderer?.dispose();
    this.renderer = null;
    this.canvas = null;
  }

  onFrame(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  invalidate() {
    this.dirty = true;
  }

  /* ----------------------------- transport ----------------------------- */

  async play() {
    const p = useProject.getState().project;
    if (!p || !this.audio) return;
    const pb = usePlayback.getState();
    let t = pb.time;
    const dur = projectDuration(p);
    if (t >= dur - 0.01) t = pb.inPoint ?? 0;
    pb.set({ time: t, playing: true });
    await this.audio.start(p, t);
    this.precise = false;
  }

  pause() {
    const pb = usePlayback.getState();
    if (!pb.playing) return;
    const t = this.audio ? this.audio.currentTime() : pb.time;
    this.audio?.stop();
    const p = useProject.getState().project;
    pb.set({ playing: false, time: snapToFrame(Math.max(0, t), p?.settings.fps ?? 30) });
    for (const s of this.activeVideos.values()) s.el.pause();
    this.dirty = true;
  }

  toggle() {
    if (usePlayback.getState().playing) this.pause();
    else void this.play();
  }

  seek(t: number) {
    const wasPlaying = usePlayback.getState().playing;
    if (wasPlaying) this.audio?.stop();
    const p = useProject.getState().project;
    usePlayback.getState().set({ time: snapToFrame(Math.max(0, t), p?.settings.fps ?? 30) });
    this.dirty = true;
    if (wasPlaying && p) void this.audio?.start(p, usePlayback.getState().time);
  }

  /* --------------------------- frame provider -------------------------- */

  private activeVideos = new Map<string, VideoSource>();
  private neededThisFrame = new Set<string>();

  videoFrame(clip: VideoClip, sourceTime: number): FrameSource | null {
    const key = clip.id;
    const asset = getAsset(clip.mediaId);
    if (!asset) return null;
    const mediaId = asset.proxyId && !this.precise ? asset.proxyId : clip.mediaId;
    const src = getVideoSource(key, mediaId);
    if (!src) return null;
    this.neededThisFrame.add(key);
    this.activeVideos.set(key, src);
    const el = src.el;
    const playing = usePlayback.getState().playing;
    const sp = clip.speed;
    const canStream = playing && !sp.reversed && sp.freezeAt === undefined && !(sp.curve && sp.curve.length > 1) && sp.rate >= 0.0625 && sp.rate <= 16 && !this.precise;
    const target = Math.max(0, Math.min(Math.max(0, (el.duration || asset.duration) - 0.02), sourceTime));
    if (canStream) {
      if (el.playbackRate !== sp.rate) el.playbackRate = sp.rate;
      const drift = el.currentTime - target;
      if (el.paused || el.ended) {
        el.currentTime = target;
        void el.play().catch(() => {});
      } else if (Math.abs(drift) > 0.15) {
        el.currentTime = target;
      }
    } else {
      if (!el.paused) el.pause();
      const fps = asset.fps || 30;
      if (Math.abs(el.currentTime - target) > 0.5 / fps && !(el as any).__seeking) {
        (el as any).__seeking = true;
        const done = () => {
          (el as any).__seeking = false;
          this.dirty = true;
        };
        el.addEventListener('seeked', done, { once: true });
        el.addEventListener('error', done, { once: true });
        el.currentTime = target;
        setTimeout(done, 400); // safety
      }
    }
    if (el.readyState < 2) return null;
    return { source: el, width: el.videoWidth, height: el.videoHeight, version: Math.round(el.currentTime * 1000) };
  }

  imageFrame(mediaId: string): FrameSource | null {
    const img = imageCache.get(mediaId);
    if (img) {
      const w = (img as HTMLImageElement).naturalWidth || (img as ImageBitmap).width;
      const h = (img as HTMLImageElement).naturalHeight || (img as ImageBitmap).height;
      return { source: img as any, width: w, height: h, version: 1 };
    }
    if (!imageLoading.has(mediaId)) {
      imageLoading.add(mediaId);
      getImage(mediaId)
        .then((i) => {
          imageCache.set(mediaId, i);
          this.dirty = true;
        })
        .catch(() => {})
        .finally(() => imageLoading.delete(mediaId));
    }
    return null;
  }

  segmentationMask(clip: VisualClip, frame: FrameSource) {
    return this.segmentation ? this.segmentation(clip, frame) : null;
  }

  /** Make sure upcoming clips' media are warm. */
  private preload(project: Project, t: number) {
    for (const track of project.tracks) {
      if (track.kind === 'audio') continue;
      for (const c of track.clips) {
        if (c.kind === 'video' && c.start > t && c.start < t + 2.5) {
          const asset = getAsset(c.mediaId);
          if (!asset) continue;
          const src = getVideoSource(c.id, asset.proxyId ? asset.proxyId : c.mediaId);
          if (src && src.el.readyState >= 1 && Math.abs(src.el.currentTime - c.mediaIn) > 0.1 && !(src.el as any).__seeking) src.el.currentTime = c.mediaIn;
          this.neededThisFrame.add(c.id);
        } else if ((c.kind === 'image' || c.kind === 'sticker') && (c as any).mediaId && c.start < t + 5) {
          void getUrl((c as any).mediaId);
          this.imageFrame((c as any).mediaId);
        }
      }
    }
  }

  /* ------------------------------- loop ------------------------------- */

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const project = useProject.getState().project;
    const pb = usePlayback.getState();
    if (!project || !this.renderer || !this.canvas) return;
    let t = pb.time;
    if (pb.playing && this.audio) {
      t = this.audio.currentTime();
      const dur = projectDuration(project);
      const end = pb.outPoint ?? dur;
      if (t >= end) {
        if (pb.loop) {
          this.seek(pb.inPoint ?? 0);
          return;
        }
        this.pause();
        usePlayback.getState().set({ time: end });
        return;
      }
      this.audio.tick(project, t);
      // publish time to UI (every frame; store subscribers use selectors)
      usePlayback.getState().setTimeInternal(t);
    }
    if (project !== this.lastProject) {
      this.dirty = true;
      if (pb.playing && this.lastProject && this.audio) this.audio.restart(project);
      this.lastProject = project;
    }
    const needs = this.dirty || pb.playing || Math.abs(t - this.lastRenderedTime) > 1e-6;
    if (!needs) return;
    this.dirty = false;
    this.neededThisFrame.clear();
    // adaptive quality
    const q = pb.previewQuality;
    let scale = q === 'full' ? 1 : q === 'half' ? 0.5 : q === 'quarter' ? 0.25 : this.qualityScale;
    if (!pb.playing && q === 'auto') scale = Math.max(scale, 0.75);
    const pw = project.settings.width, ph = project.settings.height;
    const cw = this.canvas.clientWidth || 640, ch = this.canvas.clientHeight || 360;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.round(Math.min(pw, cw * dpr) * scale), H = Math.round(W * (ph / pw));
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W;
      this.canvas.height = H;
    }
    const start = performance.now();
    try {
      this.renderer.render(project, t, this, { width: W, height: H, fast: pb.playing });
    } catch (e) {
      console.error('Render error', e);
    }
    const dt = performance.now() - start;
    this.frameTimes.push(dt);
    if (this.frameTimes.length > 30) this.frameTimes.shift();
    if (pb.playing && q === 'auto' && this.frameTimes.length >= 20) {
      const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
      if (avg > 24 && this.qualityScale > 0.4) {
        this.qualityScale = Math.max(0.4, this.qualityScale * 0.8);
        this.frameTimes = [];
      } else if (avg < 8 && this.qualityScale < 1) {
        this.qualityScale = Math.min(1, this.qualityScale * 1.15);
        this.frameTimes = [];
      }
    }
    const now = performance.now();
    if (this.lastTickTime) this.fpsEstimate = this.fpsEstimate * 0.9 + (1000 / Math.max(1, now - this.lastTickTime)) * 0.1;
    this.lastTickTime = now;
    this.lastRenderedTime = t;
    this.preload(project, t);
    // pause videos no longer needed
    for (const [k, s] of this.activeVideos) {
      if (!this.neededThisFrame.has(k)) {
        if (!s.el.paused) s.el.pause();
        this.activeVideos.delete(k);
      }
    }
    pruneVideoPool(this.neededThisFrame);
    for (const l of this.listeners) l();
  };

  /** Read the composited color under normalized canvas coords (0..1, top-left origin). */
  pickColor(nx: number, ny: number): { r: number; g: number; b: number } | null {
    const gl = this.renderer?.ctx.gl;
    if (!gl || !this.canvas) return null;
    const x = Math.max(0, Math.min(this.canvas.width - 1, Math.floor(nx * this.canvas.width)));
    const y = Math.max(0, Math.min(this.canvas.height - 1, Math.floor((1 - ny) * this.canvas.height)));
    const buf = new Uint8Array(4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    return { r: buf[0] / 255, g: buf[1] / 255, b: buf[2] / 255 };
  }

  getStats() {
    return { frameMs: this.renderer?.lastFrameMs ?? 0, quality: this.qualityScale, fps: this.fpsEstimate, ...(this.renderer?.frameStats ?? { clips: 0, passes: 0 }) };
  }
}

export const engine = new PlaybackEngine();
