/**
 * Client for the image worker, with a transparent main-thread fallback
 * (older browsers / SSR / worker bundling disabled).
 */
import { runOp, type ImageOp } from './process';

type Pending = { resolve: (value: any) => void; reject: (error: Error) => void };

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function ensureWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('../../workers/image-worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent) => {
      const data = event.data as { id: number; ok: boolean; image?: ImageData; crop?: any; error?: string };
      const entry = pending.get(data.id);
      if (!entry) return;
      pending.delete(data.id);
      if (data.ok) entry.resolve(data.image ?? data.crop);
      else entry.reject(new Error(data.error ?? 'Image operation failed'));
    };
    worker.onerror = () => {
      for (const entry of pending.values()) entry.reject(new Error('Image worker failed'));
      pending.clear();
      worker?.terminate();
      worker = null;
    };
    return worker;
  } catch {
    return null;
  }
}

export async function processImage(image: ImageData, op: ImageOp): Promise<any> {
  const active = ensureWorker();
  if (!active) return runOp(image, op);
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    active.postMessage({ id, image, op });
    window.setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error('Image operation timed out'));
      }
    }, 60_000);
  });
}

/** Loads a URL/bitmap into ImageData, normalised to a workable size. */
export async function imageDataFromSource(src: string, maxDimension = 2400): Promise<ImageData> {
  const bitmap = await loadBitmap(src);
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}

export async function loadBitmap(src: string): Promise<ImageBitmap | HTMLImageElement> {
  if (src.startsWith('data:') || src.startsWith('blob:')) {
    const res = await fetch(src);
    const blob = await res.blob();
    if (typeof createImageBitmap === 'function') return createImageBitmap(blob);
    return loadImageElement(src);
  }
  return loadImageElement(src);
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not load image'));
    image.src = src;
  });
}

export function imageDataToDataUrl(image: ImageData): string {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext('2d')!.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
}
