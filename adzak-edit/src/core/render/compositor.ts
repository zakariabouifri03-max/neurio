import type { ProjectDocument } from '../types/project';
import type { Clip, Track } from '../types/timeline';
import { endOf, TIME_EPSILON } from '../types/time';
import { effectRegistry } from '../effects/registry';
import { isTrackRendered, videoTracks } from '../timeline/queries';
import { toSourceTime } from '../timeline/queries';

/**
 * Canvas compositor.
 *
 * One implementation, two consumers:
 *   • the preview player (interactive, seeks on scrub, plays continuously)
 *   • the browser export backend (renders every frame into MediaRecorder)
 *
 * It draws the *same* model the FFmpeg exporter consumes — transforms, effects,
 * opacity, z-order — so what you see is what the desktop app renders. Effects
 * that only exist in FFmpeg are shown with their CSS approximation where one
 * exists and are otherwise passed through unchanged (the inspector says which).
 */

export interface CompositorAsset {
  id: string;
  /** Displayable URI for <video>/<img>. */
  uri: string;
  kind: 'video' | 'audio' | 'image';
  width: number;
  height: number;
  durationSec: number;
}

export interface CompositorFrame {
  /** Clip actually drawn on top, for the inspector. */
  topClipId: string | null;
}

const ELEMENT_POOL_LIMIT = 8;

export class CanvasCompositor {
  private readonly videos = new Map<string, HTMLVideoElement>();
  private readonly images = new Map<string, HTMLImageElement>();
  private readonly accessOrder: string[] = [];
  private readonly readyPromises = new Map<string, Promise<void>>();

  constructor(private readonly resolveAsset: (assetId: string) => CompositorAsset | null) {}

  /** Free every media element. Call on project close. */
  dispose(): void {
    for (const video of this.videos.values()) {
      video.pause();
      video.removeAttribute('src');
      video.load();
    }
    this.videos.clear();
    this.images.clear();
    this.accessOrder.length = 0;
    this.readyPromises.clear();
  }

  /** Ensure elements exist for everything visible at `timeSec`. */
  async prepare(project: ProjectDocument, timeSec: number): Promise<void> {
    const clips = this.clipsAt(project, timeSec);
    await Promise.all(clips.map(async (clip) => this.ensureElement(clip)));
  }

  private clipsAt(project: ProjectDocument, timeSec: number): Clip[] {
    const out: Clip[] = [];
    for (const track of videoTracks(project.sequence)) {
      if (!isTrackRendered(track, project.sequence.tracks)) continue;
      for (const clip of track.clips) {
        if (clip.timeline.start <= timeSec + TIME_EPSILON && endOf(clip.timeline) > timeSec + TIME_EPSILON) {
          out.push(clip);
        }
      }
    }
    return out;
  }

  private ensureElement(clip: Clip): Promise<void> {
    if (clip.kind !== 'media' || !clip.assetId) return Promise.resolve();
    const asset = this.resolveAsset(clip.assetId);
    if (!asset) return Promise.resolve();

    if (asset.kind === 'image') {
      const existing = this.images.get(asset.id);
      if (existing && existing.complete) return Promise.resolve();
      if (this.readyPromises.has(asset.id)) return this.readyPromises.get(asset.id)!;
      const img = new Image();
      const promise = new Promise<void>((resolve) => {
        img.onload = () => resolve();
        img.onerror = () => resolve();
      });
      img.src = asset.uri;
      this.images.set(asset.id, img);
      this.readyPromises.set(asset.id, promise);
      return promise;
    }

    if (asset.kind === 'video') {
      const existing = this.videos.get(asset.id);
      if (existing && existing.readyState >= 2) {
        this.touch(asset.id);
        return Promise.resolve();
      }
      if (this.readyPromises.has(asset.id)) return this.readyPromises.get(asset.id)!;
      const video = document.createElement('video');
      video.src = asset.uri;
      video.crossOrigin = 'anonymous';
      video.muted = true; // audio is mixed separately by the AudioGraph
      video.playsInline = true;
      video.preload = 'auto';
      const promise = new Promise<void>((resolve) => {
        const done = () => resolve();
        video.addEventListener('loadeddata', done, { once: true });
        video.addEventListener('error', done, { once: true });
      });
      this.videos.set(asset.id, video);
      this.readyPromises.set(asset.id, promise);
      this.touch(asset.id);
      this.evict();
      return promise;
    }
    return Promise.resolve();
  }

  private touch(assetId: string): void {
    const idx = this.accessOrder.indexOf(assetId);
    if (idx >= 0) this.accessOrder.splice(idx, 1);
    this.accessOrder.push(assetId);
  }

  private evict(): void {
    while (this.accessOrder.length > ELEMENT_POOL_LIMIT) {
      const oldest = this.accessOrder.shift();
      if (!oldest) break;
      const video = this.videos.get(oldest);
      if (video) {
        video.pause();
        video.removeAttribute('src');
        video.load();
        this.videos.delete(oldest);
      }
      this.readyPromises.delete(oldest);
    }
  }

  /** Draw the timeline at `timeSec` into the canvas. */
  draw(ctx: CanvasRenderingContext2D, project: ProjectDocument, timeSec: number): CompositorFrame {
    const { width, height } = ctx.canvas;
    ctx.save();
    ctx.fillStyle = project.settings.backgroundColor;
    ctx.fillRect(0, 0, width, height);

    let topClipId: string | null = null;
    // Bottom track first: videoTracks() is ascending z.
    for (const track of videoTracks(project.sequence)) {
      if (!isTrackRendered(track, project.sequence.tracks)) continue;
      for (const clip of [...track.clips].sort((a, b) => a.timeline.start - b.timeline.start)) {
        if (clip.timeline.start > timeSec + TIME_EPSILON || endOf(clip.timeline) <= timeSec + TIME_EPSILON) continue;
        if (this.drawClip(ctx, clip, project, timeSec, width, height)) topClipId = clip.id;
      }
    }
    ctx.restore();
    return { topClipId };
  }

  private drawClip(
    ctx: CanvasRenderingContext2D,
    clip: Clip,
    _project: ProjectDocument,
    timeSec: number,
    width: number,
    height: number,
  ): boolean {
    if (clip.kind === 'text' || clip.kind === 'subtitle') {
      return this.drawText(ctx, clip, width, height);
    }
    if (!clip.assetId) return false;
    const asset = this.resolveAsset(clip.assetId);
    if (!asset) return false;

    const source = asset.kind === 'image' ? this.images.get(asset.id) : this.videos.get(asset.id);
    if (!source) return false;
    if (asset.kind === 'video') {
      const video = source as HTMLVideoElement;
      if (video.readyState < 2) return false;
      const target = toSourceTime(clip, timeSec) ?? clip.source.in;
      // Only correct when the drift is visible; seeking every frame would stall.
      if (Math.abs(video.currentTime - target) > 0.18) {
        try {
          video.currentTime = Math.min(Math.max(0, target), video.duration || target);
        } catch {
          /* seeking is not always available on a partially loaded stream */
        }
      }
    }

    const t = clip.transform;
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, t.opacity));
    ctx.filter = this.cssFilterFor(clip);

    // Natural size, letterboxed into the frame like the exporter's scale+pad.
    const sourceW = asset.width || width;
    const sourceH = asset.height || height;
    const scale = Math.min(width / sourceW, height / sourceH) * t.scale;
    const drawW = sourceW * scale;
    const drawH = sourceH * scale;

    ctx.translate(width / 2 + t.x * width, height / 2 + t.y * height);
    if (t.rotationDeg) ctx.rotate((t.rotationDeg * Math.PI) / 180);
    ctx.scale(t.flipX ? -1 : 1, t.flipY ? -1 : 1);

    // Crop in normalised source units.
    const crop = t.crop;
    const sx = crop.left * sourceW;
    const sy = crop.top * sourceH;
    const sw = Math.max(1, (1 - crop.left - crop.right) * sourceW);
    const sh = Math.max(1, (1 - crop.top - crop.bottom) * sourceH);
    const aspect = sw / sh;
    const fitW = Math.min(drawW, drawH * aspect);
    const fitH = fitW / aspect;

    try {
      ctx.drawImage(source as CanvasImageSource, sx, sy, sw, sh, -fitW / 2, -fitH / 2, fitW, fitH);
    } catch {
      ctx.restore();
      return false;
    }
    ctx.restore();
    return true;
  }

  private drawText(ctx: CanvasRenderingContext2D, clip: Clip, width: number, height: number): boolean {
    const style = clip.text;
    if (!style) return false;
    const t = clip.transform;
    const scale = height / 1080;
    const fontSize = Math.max(6, style.fontSizePx * scale);

    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, t.opacity));
    ctx.translate(width / 2 + t.x * width, height / 2 + t.y * height);
    if (t.rotationDeg) ctx.rotate((t.rotationDeg * Math.PI) / 180);

    ctx.font = `${style.fontStyle} ${style.fontWeight} ${fontSize}px "${style.fontFamily}", system-ui, sans-serif`;
    ctx.textAlign = style.align;
    ctx.textBaseline = 'middle';

    const text = style.uppercase ? style.text.toUpperCase() : style.text;
    const lines = text.split('\n');
    const lineHeight = fontSize * style.lineHeight;
    const totalHeight = lines.length * lineHeight;
    const x = style.align === 'left' ? -width / 2 + 48 : style.align === 'right' ? width / 2 - 48 : 0;

    const widest = lines.reduce((m, l) => Math.max(m, ctx.measureText(l).width), 0);
    if (style.background.enabled) {
      const pad = style.background.paddingPx * scale;
      ctx.fillStyle = style.background.color;
      const bx = style.align === 'left' ? x - pad : style.align === 'right' ? x - widest - pad : -widest / 2 - pad;
      roundRect(ctx, bx, -totalHeight / 2 - pad, widest + pad * 2, totalHeight + pad * 2, style.background.radiusPx * scale);
      ctx.fill();
    }

    lines.forEach((line, i) => {
      const y = -totalHeight / 2 + lineHeight * (i + 0.5);
      if (style.shadow.enabled) {
        ctx.shadowColor = style.shadow.color;
        ctx.shadowBlur = style.shadow.blurPx * scale;
        ctx.shadowOffsetX = style.shadow.offsetX * scale;
        ctx.shadowOffsetY = style.shadow.offsetY * scale;
      }
      if (style.strokeWidthPx > 0) {
        ctx.lineWidth = style.strokeWidthPx * scale;
        ctx.strokeStyle = style.strokeColor;
        ctx.lineJoin = 'round';
        ctx.strokeText(line, x, y);
      }
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
      ctx.fillStyle = style.color;
      ctx.fillText(line, x, y);
    });

    ctx.restore();
    return true;
  }

  /** CSS filter string approximating the clip's FFmpeg effects. */
  cssFilterFor(clip: Clip): string {
    const parts: string[] = [];
    for (const instance of clip.effects) {
      if (!instance.enabled) continue;
      const def = effectRegistry.get(instance.effectId);
      if (!def?.toCss) continue;
      const css = def.toCss(instance.params, { width: 0, height: 0, fps: 0, timeSec: 0, warnings: [] });
      if (css) parts.push(css);
    }
    return parts.length ? parts.join(' ') : 'none';
  }

  /** The video element for an asset, so the audio graph can tap it. */
  videoFor(assetId: string): HTMLVideoElement | undefined {
    return this.videos.get(assetId);
  }

  /** Start playback of every element that is on-screen in [start, end). */
  async playRange(project: ProjectDocument, startSec: number, endSec: number): Promise<void> {
    const clips = project.sequence.tracks.flatMap((t: Track) => t.clips).filter(
      (c) => c.timeline.start < endSec && endOf(c.timeline) > startSec,
    );
    await Promise.all(clips.map((c) => this.ensureElement(c)));
    for (const clip of clips) {
      if (clip.kind !== 'media' || !clip.assetId) continue;
      const video = this.videos.get(clip.assetId);
      if (!video) continue;
      const target = toSourceTime(clip, startSec) ?? clip.source.in;
      try {
        video.currentTime = target;
      } catch {
        /* ignore */
      }
      void video.play().catch(() => undefined);
    }
  }

  pauseAll(): void {
    for (const video of this.videos.values()) video.pause();
  }

  /** Drift between the timeline clock and the actual media position. */
  driftFor(clip: Clip, expectedTimeSec: number): number {
    if (!clip.assetId) return 0;
    const video = this.videos.get(clip.assetId);
    if (!video) return 0;
    return video.currentTime - expectedTimeSec;
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}
