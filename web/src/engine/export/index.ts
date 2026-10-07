/**
 * Export pipeline.
 *
 * PNG / JPG / SVG / PDF / GIF / MP4-WebM / print sheets — all rendered from the
 * document model with the Canvas2D renderer, so output is identical to the
 * editor at any resolution.
 */
import type { DesignDoc, Page } from '../types';
import { renderPageToCanvas, preloadPageImages } from '../render/canvas2d';
import { pageToSvg } from '../render/svg';

export type ImageFormat = 'png' | 'jpg' | 'webp';

export type ImageExportOptions = {
  format: ImageFormat;
  scale: number;
  quality?: number;
  transparent?: boolean;
  pages?: number[];
};

export type PdfExportOptions = {
  pages?: number[];
  /** Render scale — 2 ≈ 150 dpi, 3 ≈ 225 dpi, 4 ≈ 300 dpi. */
  scale?: number;
  compress?: boolean;
};

export type VideoExportOptions = {
  fps: number;
  scale: number;
  quality: 'draft' | 'standard' | 'high';
  includeAudio: boolean;
  format: 'webm' | 'mp4';
  onProgress?: (percent: number) => void;
};

/* ------------------------------------------------------------------ helpers */

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function safeFilename(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9\u0600-\u06ff]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'prism-design'
  );
}

function canvasToBlob(canvas: HTMLCanvasElement, format: ImageFormat, quality = 0.92): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode image'))),
      format === 'png' ? 'image/png' : format === 'jpg' ? 'image/jpeg' : 'image/webp',
      format === 'png' ? undefined : quality,
    );
  });
}

/* -------------------------------------------------------------------- images */

export async function exportPageImage(page: Page, options: ImageExportOptions): Promise<Blob> {
  const canvas = await renderPageToCanvas(page, {
    scale: options.scale,
    transparent: options.transparent && options.format === 'png',
  });
  return canvasToBlob(canvas, options.format, options.quality ?? 0.92);
}

export async function exportDocImages(doc: DesignDoc, options: ImageExportOptions): Promise<Blob[]> {
  const pages = (options.pages ?? doc.pages.map((_, i) => i)).map((i) => doc.pages[i]).filter(Boolean) as Page[];
  const blobs: Blob[] = [];
  for (const page of pages) blobs.push(await exportPageImage(page, options));
  return blobs;
}

export async function exportDocZip(doc: DesignDoc, options: ImageExportOptions): Promise<Blob> {
  // ZIP writer (store, no compression) — keeps dependencies at zero.
  const blobs = await exportDocImages(doc, options);
  const files = await Promise.all(
    blobs.map(async (blob, index) => ({
      name: `${safeFilename(doc.title)}-${String(index + 1).padStart(2, '0')}.${options.format}`,
      data: new Uint8Array(await blob.arrayBuffer()),
    })),
  );
  return zipFiles(files);
}

/* ----------------------------------------------------------------------- svg */

export async function exportPageSvg(page: Page, embedImages = true): Promise<Blob> {
  const svg = await pageToSvg(page, { embedImages });
  return new Blob([svg], { type: 'image/svg+xml' });
}

/* ----------------------------------------------------------------------- pdf */

export async function exportPdf(doc: DesignDoc, options: PdfExportOptions = {}): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const pages = (options.pages ?? doc.pages.map((_, i) => i)).map((i) => doc.pages[i]).filter(Boolean) as Page[];
  const scale = options.scale ?? 2;

  let pdf: any = null;
  for (let index = 0; index < pages.length; index++) {
    const page = pages[index]!;
    const canvas = await renderPageToCanvas(page, { scale, transparent: false });
    const orientation = page.width >= page.height ? 'landscape' : 'portrait';
    // Points = px * 72/96 at 100% (design px are CSS px).
    const unit = 'pt';
    const widthPt = (page.width * 72) / 96;
    const heightPt = (page.height * 72) / 96;
    if (!pdf) pdf = new jsPDF({ orientation, unit, format: [widthPt, heightPt], compress: options.compress ?? true });
    else pdf.addPage([widthPt, heightPt], orientation);
    const imageData = canvas.toDataURL('image/jpeg', options.compress === false ? 1 : 0.92);
    pdf.addImage(imageData, 'JPEG', 0, 0, widthPt, heightPt, undefined, 'FAST');
  }
  return pdf!.output('blob') as Blob;
}

/* ----------------------------------------------------------------------- gif */

export async function exportGif(
  doc: DesignDoc,
  options: { fps?: number; scale?: number; duration?: number; loop?: boolean; onProgress?: (percent: number) => void } = {},
): Promise<Blob> {
  const { GIFEncoder, quantize, applyPalette } = await import('gifenc');
  const fps = options.fps ?? 12;
  const duration = options.duration ?? 3000;
  const scale = options.scale ?? 0.5;
  const page = doc.pages[0]!;
  const frames = Math.max(2, Math.round((duration / 1000) * fps));

  const gif = GIFEncoder();
  for (let index = 0; index < frames; index++) {
    const time = (index / fps) * 1000;
    const canvas = await renderPageToCanvas(page, { scale, time });
    const ctx = canvas.getContext('2d')!;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const palette = quantize(data, 256, { format: 'rgb565' });
    const indexed = applyPalette(data, palette, 'rgb565');
    // repeat: 0 loops forever, -1 plays once.
    gif.writeFrame(indexed, canvas.width, canvas.height, {
      palette,
      delay: Math.round(1000 / fps),
      repeat: index === 0 ? (options.loop === false ? -1 : 0) : 0,
    });
    options.onProgress?.(((index + 1) / frames) * 100);
  }
  gif.finish();
  return new Blob([gif.bytes().slice().buffer] as BlobPart[], { type: 'image/gif' });
}

/* --------------------------------------------------------------------- video */

export type SupportedVideoMime = { mime: string; extension: string; label: string };

export function supportedVideoFormats(): SupportedVideoMime[] {
  if (typeof MediaRecorder === 'undefined') return [];
  const candidates: SupportedVideoMime[] = [
    { mime: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', extension: 'mp4', label: 'MP4 (H.264)' },
    { mime: 'video/mp4', extension: 'mp4', label: 'MP4' },
    { mime: 'video/webm;codecs=vp9,opus', extension: 'webm', label: 'WebM (VP9)' },
    { mime: 'video/webm;codecs=vp8,opus', extension: 'webm', label: 'WebM (VP8)' },
    { mime: 'video/webm', extension: 'webm', label: 'WebM' },
  ];
  return candidates.filter((candidate) => {
    try {
      return MediaRecorder.isTypeSupported(candidate.mime);
    } catch {
      return false;
    }
  });
}

/**
 * Renders the composition (page + timeline media + keyframes) frame by frame
 * onto an offscreen canvas and records it. Audio clips are mixed through
 * WebAudio so exported videos carry their soundtrack and fades.
 */
export async function exportVideo(doc: DesignDoc, options: VideoExportOptions): Promise<Blob> {
  const page = doc.pages[0];
  if (!page) throw new Error('Nothing to export');

  const formats = supportedVideoFormats();
  const requested = formats.find((f) => f.extension === options.format) ?? formats[0];
  if (!requested) throw new Error('Video recording is not supported in this browser');

  const timeline = doc.timeline;
  const duration = timeline?.duration ?? 5000;
  const fps = options.fps;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(page.width * options.scale);
  canvas.height = Math.round(page.height * options.scale);
  const ctx = canvas.getContext('2d', { alpha: false })!;

  await preloadPageImages(page);

  // Media elements for playback inside the render loop.
  const mediaElements: HTMLMediaElement[] = [];
  let audioContext: AudioContext | null = null;
  const stream = canvas.captureStream(fps);

  if (options.includeAudio && timeline) {
    const audioClips = timeline.tracks.filter((t) => t.kind === 'audio' && !t.muted).flatMap((t) => t.clips);
    const videoClips = timeline.tracks.filter((t) => t.kind === 'video' && !t.muted).flatMap((t) => t.clips);
    const withAudio = [...audioClips, ...videoClips].filter((clip) => clip.src && !clip.muted);
    if (withAudio.length && typeof AudioContext !== 'undefined') {
      audioContext = new AudioContext();
      const destination = audioContext.createMediaStreamDestination();
      for (const clip of withAudio) {
        const element = clip.kind === 'audio' ? new Audio(clip.src) : Object.assign(document.createElement('video'), { src: clip.src });
        element.crossOrigin = 'anonymous';
        element.preload = 'auto';
        mediaElements.push(element);
        const source = audioContext.createMediaElementSource(element as HTMLAudioElement);
        const gain = audioContext.createGain();
        gain.gain.value = clip.volume ?? 1;
        source.connect(gain);
        gain.connect(destination);
      }
      for (const track of destination.stream.getAudioTracks()) stream.addTrack(track);
    }
  }

  const bitrate =
    options.quality === 'high' ? 16_000_000 : options.quality === 'standard' ? 8_000_000 : 3_000_000;
  const recorder = new MediaRecorder(stream, { mimeType: requested.mime, videoBitsPerSecond: bitrate });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size) chunks.push(event.data);
  };

  const done = new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: requested.mime.split(';')[0] }));
    recorder.onerror = () => reject(new Error('Recording failed'));
  });

  recorder.start(200);

  const frameCount = Math.max(1, Math.round((duration / 1000) * fps));
  const startedAt = performance.now();

  for (let frame = 0; frame < frameCount; frame++) {
    const time = (frame / fps) * 1000;
    // Sync media elements to the current timeline position.
    for (const element of mediaElements) {
      try {
        element.currentTime = time / 1000;
      } catch {
        /* not seekable yet */
      }
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    await renderPage(ctx, page, {
      scale: options.scale,
      time,
      background: page.background.color,
    });
    options.onProgress?.(((frame + 1) / frameCount) * 100);
    // Yield so the browser can composite + encode.
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    void startedAt;
  }

  await new Promise((resolve) => setTimeout(resolve, 350));
  recorder.stop();
  mediaElements.forEach((element) => {
    element.pause();
    element.src = '';
  });
  if (audioContext) await audioContext.close();
  return done;
}

import { renderPage } from '../render/canvas2d';

/* ---------------------------------------------------------------------- zip */

/** Minimal ZIP (stored) writer — no dependencies, enough for multi-page export. */
export function zipFiles(files: { name: string; data: Uint8Array }[]): Blob {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c >>> 0;
    }
    return table;
  })();

  const crc32 = (data: Uint8Array): number => {
    let crc = 0xffffffff;
    for (let i = 0; i < data.length; i++) crc = crcTable[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  };

  const encoder = new TextEncoder();

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const crc = crc32(file.data);
    const local = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x0800, true); // UTF-8
    view.setUint16(8, 0, true);
    view.setUint32(10, 0, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, file.data.length, true);
    view.setUint32(22, file.data.length, true);
    view.setUint16(26, nameBytes.length, true);
    view.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    chunks.push(local, file.data);

    const dir = new Uint8Array(46 + nameBytes.length);
    const dirView = new DataView(dir.buffer);
    dirView.setUint32(0, 0x02014b50, true);
    dirView.setUint16(4, 20, true);
    dirView.setUint16(6, 20, true);
    dirView.setUint16(8, 0x0800, true);
    dirView.setUint16(10, 0, true);
    dirView.setUint32(12, 0, true);
    dirView.setUint32(16, crc, true);
    dirView.setUint32(20, file.data.length, true);
    dirView.setUint32(24, file.data.length, true);
    dirView.setUint16(28, nameBytes.length, true);
    dirView.setUint32(42, offset, true);
    dir.set(nameBytes, 46);
    central.push(dir);

    offset += local.length + file.data.length;
  }

  const centralSize = central.reduce((sum, c) => sum + c.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);

  return new Blob([...chunks, ...central, end] as unknown as BlobPart[], { type: 'application/zip' });
}

/* -------------------------------------------------------------- thumbnails */

export async function pageThumbnail(page: Page, maxSize = 480): Promise<string> {
  const scale = Math.min(1, maxSize / Math.max(page.width, page.height));
  const canvas = await renderPageToCanvas(page, { scale: Math.max(0.08, scale) });
  return canvas.toDataURL('image/jpeg', 0.72);
}
