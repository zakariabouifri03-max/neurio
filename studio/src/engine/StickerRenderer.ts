/** Rasterizes stickers (emoji / SVG / custom images) with simple loop animations. */
import type { StickerClip } from '@/core/types';
import { getSticker } from '@/library/stickers';
import type { FrameProvider } from './Renderer';

const svgImages = new Map<string, HTMLImageElement | null>();
const canvases = new Map<string, HTMLCanvasElement | OffscreenCanvas>();

function svgImage(id: string, svg: string): HTMLImageElement | null {
  if (svgImages.has(id)) return svgImages.get(id)!;
  svgImages.set(id, null);
  const img = new Image();
  img.onload = () => svgImages.set(id, img);
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  return null;
}

function anim(type: string | null, t: number): { dx: number; dy: number; scale: number; rot: number; alpha: number } {
  const s = { dx: 0, dy: 0, scale: 1, rot: 0, alpha: 1 };
  switch (type) {
    case 'bounce':
      s.dy = -Math.abs(Math.sin(t * Math.PI * 2)) * 0.15;
      break;
    case 'pulse':
      s.scale = 1 + Math.sin(t * Math.PI * 3) * 0.08;
      break;
    case 'spin':
      s.rot = t * Math.PI * 2 * 0.5;
      break;
    case 'shake':
      s.dx = Math.sin(t * 40) * 0.03;
      s.dy = Math.cos(t * 33) * 0.02;
      break;
    case 'float':
      s.dy = Math.sin(t * Math.PI) * 0.1;
      s.rot = Math.sin(t * Math.PI * 0.7) * 0.08;
      break;
    case 'wiggle':
      s.rot = Math.sin(t * 12) * 0.15;
      break;
    case 'pop': {
      const p = Math.min(1, t / 0.4);
      const c1 = 1.70158, c3 = c1 + 1;
      s.scale = 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
      s.alpha = Math.min(1, p * 3);
      break;
    }
    case 'heartbeat': {
      const ph = t % 1;
      const b = ph < 0.15 ? Math.sin((ph / 0.15) * Math.PI) : ph < 0.35 ? Math.sin(((ph - 0.2) / 0.15) * Math.PI) * 0.6 : 0;
      s.scale = 1 + Math.max(0, b) * 0.15;
      break;
    }
    case 'swing':
      s.rot = Math.sin(t * Math.PI * 2) * 0.2;
      break;
  }
  return s;
}

export function renderSticker(clip: StickerClip, t: number, projW: number, provider: FrameProvider, key: string): { canvas: HTMLCanvasElement | OffscreenCanvas; width: number; height: number; scale: number; version: number } | null {
  const base = Math.round(projW * 0.6); // project px at scale 1
  const scale = Math.min(1, 512 / base);
  const size = Math.max(8, Math.round(base * scale));
  let img: CanvasImageSource | null = null;
  let aspect = 1;
  let text: string | null = null;
  if (clip.mediaId) {
    const f = provider.imageFrame(clip.mediaId);
    if (!f) return null;
    img = f.source as CanvasImageSource;
    aspect = f.width / Math.max(1, f.height);
  } else if (clip.stickerId) {
    const def = getSticker(clip.stickerId);
    if (!def) return null;
    if (def.kind === 'emoji') text = def.char!;
    else {
      img = svgImage(def.id, def.svg!);
      if (!img) return null;
    }
  } else return null;

  const w = size, h = Math.round(size / aspect);
  let c = canvases.get(key);
  if (!c) {
    c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : document.createElement('canvas');
    canvases.set(key, c);
  }
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const a = anim(clip.animation, t);
  ctx.globalAlpha = a.alpha;
  ctx.translate(w / 2 + a.dx * w, h / 2 + a.dy * h);
  ctx.rotate(a.rot);
  ctx.scale(a.scale * 0.9, a.scale * 0.9);
  if (text) {
    ctx.font = `${Math.round(size * 0.8)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 0, size * 0.04);
  } else if (img) {
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
  }
  const animated = !!clip.animation && clip.animation !== 'none';
  const version = animated ? Math.round(t * 1000) : 0;
  return { canvas: c, width: w, height: h, scale, version: version ^ (clip.mediaId ? 1 : 0) };
}
