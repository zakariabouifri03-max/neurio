/**
 * Frame access helpers for analysis tasks (auto color, stabilization, reframe, highlights…).
 * These use their own media elements so they never disturb the playback engine.
 */
import type { Clip, VideoClip, ImageClip } from '@/core/types';
import { getAsset, getUrl } from '@/engine/MediaManager';
import { timelineToSourceOffset } from '@/core/commands';

export interface FrameGrabber {
  width: number;
  height: number;
  duration: number;
  /** Draws the frame at `sourceTime` into the internal canvas and returns its ImageData at the grabber size. */
  grab(sourceTime: number): Promise<ImageData>;
  dispose(): void;
}

export async function openGrabber(mediaId: string, maxSize = 256): Promise<FrameGrabber | null> {
  const asset = getAsset(mediaId);
  const url = await getUrl(mediaId);
  if (!asset || !url) return null;
  const scale = Math.min(1, maxSize / Math.max(asset.width || 1, asset.height || 1));
  const w = Math.max(2, Math.round((asset.width || 256) * scale));
  const h = Math.max(2, Math.round((asset.height || 256) * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  if (asset.type === 'image') {
    const img = new Image();
    img.src = url;
    await img.decode().catch(() => {});
    return {
      width: w,
      height: h,
      duration: 0,
      async grab() {
        ctx.drawImage(img, 0, 0, w, h);
        return ctx.getImageData(0, 0, w, h);
      },
      dispose() {},
    };
  }
  const v = document.createElement('video');
  v.muted = true;
  v.preload = 'auto';
  v.src = url;
  await new Promise<void>((res, rej) => {
    v.onloadeddata = () => res();
    v.onerror = () => rej(new Error('Video failed to load'));
    setTimeout(() => res(), 8000);
  });
  return {
    width: w,
    height: h,
    duration: v.duration || asset.duration,
    grab(t: number) {
      return new Promise<ImageData>((resolve) => {
        const target = Math.max(0, Math.min((v.duration || asset.duration) - 0.03, t));
        const done = () => {
          ctx.drawImage(v, 0, 0, w, h);
          resolve(ctx.getImageData(0, 0, w, h));
        };
        if (Math.abs(v.currentTime - target) < 0.001 && v.readyState >= 2) return done();
        const timer = setTimeout(done, 1500);
        v.onseeked = () => {
          clearTimeout(timer);
          done();
        };
        v.currentTime = target;
      });
    },
    dispose() {
      v.src = '';
      v.load();
    },
  };
}

/** Source time of a clip at a timeline time. */
export function clipSourceTime(clip: Clip, timelineTime: number): number {
  if (clip.kind === 'video' || clip.kind === 'audio') return timelineToSourceOffset(clip, timelineTime - clip.start) + clip.mediaIn;
  return 0;
}

export function mediaIdOf(clip: Clip): string | null {
  return (clip as VideoClip | ImageClip).mediaId ?? null;
}

/** Simple luma of an ImageData sample. */
export function lumaStats(img: ImageData) {
  const d = img.data;
  const hist = new Float32Array(256);
  let n = 0;
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < d.length; i += 16) {
    const y = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    hist[Math.min(255, y | 0)]++;
    r += d[i];
    g += d[i + 1];
    b += d[i + 2];
    n++;
  }
  let acc = 0;
  let p1 = 0, p50 = 128, p99 = 255;
  for (let i = 0; i < 256; i++) {
    acc += hist[i];
    if (acc >= n * 0.01 && p1 === 0) p1 = i;
    if (acc >= n * 0.5 && p50 === 128) p50 = i;
    if (acc >= n * 0.99) {
      p99 = i;
      break;
    }
  }
  return { mean: { r: r / n, g: g / n, b: b / n }, p1, p50, p99, n };
}
