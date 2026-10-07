/**
 * MediaManager — owns media assets: import, probing, thumbnails, waveforms,
 * object URLs, decoded audio buffers and the per-clip video element pool.
 */
import { create } from 'zustand';
import type { MediaAsset } from '@/core/types';
import { Media } from '@/services/db';
import { uid } from '@/core/util';

interface MediaStore {
  assets: MediaAsset[];
  loaded: boolean;
  importing: { name: string; progress: number }[];
  setAssets: (a: MediaAsset[]) => void;
  upsert: (a: MediaAsset) => void;
  remove: (id: string) => void;
}

export const useMedia = create<MediaStore>((set, get) => ({
  assets: [],
  loaded: false,
  importing: [],
  setAssets: (assets) => set({ assets, loaded: true }),
  upsert: (a) => set({ assets: [a, ...get().assets.filter((x) => x.id !== a.id)] }),
  remove: (id) => set({ assets: get().assets.filter((x) => x.id !== id) }),
}));

const urls = new Map<string, string>();
const blobs = new Map<string, Blob>();
const audioBuffers = new Map<string, Promise<AudioBuffer | null>>();
const imageCache = new Map<string, Promise<HTMLImageElement | ImageBitmap>>();

let sharedCtx: AudioContext | null = null;
export function getAudioContext(): AudioContext {
  if (!sharedCtx) sharedCtx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
  return sharedCtx;
}

export async function loadMediaLibrary() {
  const all = await Media.all();
  useMedia.getState().setAssets(all.sort((a, b) => b.createdAt - a.createdAt));
}

export function getAsset(id: string): MediaAsset | undefined {
  return useMedia.getState().assets.find((a) => a.id === id);
}

export async function getBlob(id: string): Promise<Blob | undefined> {
  if (blobs.has(id)) return blobs.get(id);
  const asset = getAsset(id);
  if (asset?.source === 'url' && asset.url) {
    const b = await (await fetch(asset.url)).blob();
    blobs.set(id, b);
    return b;
  }
  const b = await Media.getBlob(id);
  if (b) blobs.set(id, b);
  return b;
}

export async function getUrl(id: string): Promise<string | null> {
  if (urls.has(id)) return urls.get(id)!;
  const asset = getAsset(id);
  if (asset?.source === 'url' && asset.url) return asset.url;
  const b = await getBlob(id);
  if (!b) return null;
  const u = URL.createObjectURL(b);
  urls.set(id, u);
  return u;
}

export function getUrlSync(id: string): string | null {
  return urls.get(id) ?? getAsset(id)?.url ?? null;
}

/** Decode the full audio of a media asset into an AudioBuffer (cached). */
export function getAudioBuffer(id: string): Promise<AudioBuffer | null> {
  if (!audioBuffers.has(id)) {
    audioBuffers.set(
      id,
      (async () => {
        const b = await getBlob(id);
        if (!b) return null;
        try {
          const ab = await b.arrayBuffer();
          return await getAudioContext().decodeAudioData(ab.slice(0));
        } catch (e) {
          console.warn('Audio decode failed for', id, e);
          return null;
        }
      })(),
    );
  }
  return audioBuffers.get(id)!;
}

export function getImage(id: string): Promise<HTMLImageElement | ImageBitmap> {
  if (!imageCache.has(id)) {
    imageCache.set(
      id,
      (async () => {
        const url = await getUrl(id);
        if (!url) throw new Error('missing image');
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = url;
        await img.decode();
        return img;
      })(),
    );
  }
  return imageCache.get(id)!;
}

/* ------------------------------ Probing ------------------------------ */

function probeVideo(url: string): Promise<{ duration: number; width: number; height: number; hasAudio: boolean }> {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    v.src = url;
    const to = setTimeout(() => reject(new Error('Timed out reading video metadata')), 20000);
    const finish = () => {
      clearTimeout(to);
      const anyV = v as any;
      const hasAudio = anyV.mozHasAudio || !!anyV.webkitAudioDecodedByteCount || (anyV.audioTracks && anyV.audioTracks.length > 0) || true;
      resolve({ duration: isFinite(v.duration) ? v.duration : 0, width: v.videoWidth, height: v.videoHeight, hasAudio });
      v.removeAttribute('src');
      v.load();
    };
    v.onloadedmetadata = () => {
      if (isFinite(v.duration)) return finish();
      // MediaRecorder WebM files (incl. our own screen/webcam recordings) report Infinity until the end is sought
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        v.ontimeupdate = null;
        v.ondurationchange = null;
        finish();
      };
      v.ondurationchange = () => isFinite(v.duration) && done();
      v.ontimeupdate = () => isFinite(v.duration) && done();
      setTimeout(done, 8000);
      try {
        v.currentTime = 1e101;
      } catch {
        done();
      }
    };
    v.onerror = () => {
      clearTimeout(to);
      reject(new Error('This video format cannot be decoded by your browser'));
    };
  });
}

function probeAudio(url: string): Promise<{ duration: number }> {
  return new Promise((resolve, reject) => {
    const a = new Audio();
    a.preload = 'metadata';
    a.src = url;
    a.onloadedmetadata = () => resolve({ duration: isFinite(a.duration) ? a.duration : 0 });
    a.onerror = () => reject(new Error('This audio format cannot be decoded by your browser'));
  });
}

function probeImage(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve({ width: i.naturalWidth, height: i.naturalHeight });
    i.onerror = () => reject(new Error('Unsupported image'));
    i.src = url;
  });
}

export async function makeVideoThumbnail(url: string, at = 0.5, w = 160): Promise<string> {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'auto';
    v.src = url;
    v.crossOrigin = 'anonymous';
    const done = () => {
      try {
        const h = Math.round((w * v.videoHeight) / Math.max(1, v.videoWidth));
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h || 90;
        c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.7));
      } catch {
        resolve('');
      }
      v.src = '';
    };
    v.onloadeddata = () => {
      v.currentTime = Math.min(at, Math.max(0, v.duration - 0.1));
    };
    v.onseeked = done;
    v.onerror = () => resolve('');
    setTimeout(() => resolve(''), 8000);
  });
}

async function makeImageThumbnail(url: string, w = 160): Promise<string> {
  const img = new Image();
  img.src = url;
  await img.decode();
  const c = document.createElement('canvas');
  const h = Math.round((w * img.naturalHeight) / Math.max(1, img.naturalWidth));
  c.width = w;
  c.height = h;
  c.getContext('2d')!.drawImage(img, 0, 0, w, h);
  return c.toDataURL('image/jpeg', 0.75);
}

export function computeWaveform(buffer: AudioBuffer, buckets = 2000): number[] {
  const ch = buffer.numberOfChannels;
  const len = buffer.length;
  const step = Math.max(1, Math.floor(len / buckets));
  const out = new Array(Math.ceil(len / step)).fill(0);
  for (let c = 0; c < ch; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0, b = 0; i < len; i += step, b++) {
      let peak = 0;
      const end = Math.min(len, i + step);
      for (let j = i; j < end; j += 2) {
        const v = Math.abs(data[j]);
        if (v > peak) peak = v;
      }
      if (peak > out[b]) out[b] = peak;
    }
  }
  return out.map((v) => Math.round(v * 255) / 255);
}

function typeFromFile(file: File): MediaAsset['type'] | null {
  const m = file.type;
  const n = file.name.toLowerCase();
  if (m.startsWith('video/') || /\.(mp4|mov|webm|mkv|m4v|avi)$/.test(n)) return 'video';
  if (m.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|aac|flac|opus)$/.test(n)) return 'audio';
  if (m.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/.test(n)) return 'image';
  if (/\.(ttf|otf|woff2?)$/.test(n) || m.includes('font')) return 'font';
  return null;
}

/** Import a File (or Blob with a name) into the library. */
export async function importFile(file: File | Blob, opts: { name?: string; type?: MediaAsset['type']; folderId?: string | null; tags?: string[]; isProxy?: boolean } = {}): Promise<MediaAsset> {
  const name = opts.name || (file as File).name || 'media';
  const type = opts.type || typeFromFile(file as File);
  if (!type) throw new Error(`Unsupported file: ${name}`);
  const id = uid('m');
  const url = URL.createObjectURL(file);
  urls.set(id, url);
  blobs.set(id, file);
  const asset: MediaAsset = {
    id,
    type,
    name,
    mime: file.type,
    size: file.size,
    duration: 0,
    width: 0,
    height: 0,
    hasAudio: type === 'audio',
    hasVideo: type === 'video' || type === 'image',
    createdAt: Date.now(),
    folderId: opts.folderId ?? null,
    favorite: false,
    source: 'idb',
    tags: opts.tags || [],
    isProxy: opts.isProxy,
  };
  useMedia.setState((s) => ({ importing: [...s.importing, { name, progress: 0.1 }] }));
  const setProg = (p: number) => useMedia.setState((s) => ({ importing: s.importing.map((x) => (x.name === name ? { ...x, progress: p } : x)) }));
  try {
    if (type === 'video') {
      const meta = await probeVideo(url);
      Object.assign(asset, meta);
      setProg(0.4);
      asset.thumbnail = await makeVideoThumbnail(url, Math.min(1, meta.duration * 0.1));
      setProg(0.6);
      // waveform (decode in background, don't block import on huge files)
      const buf = await getAudioBuffer(id).catch(() => null);
      if (buf) {
        asset.hasAudio = true;
        asset.waveform = computeWaveform(buf);
        asset.waveformDuration = buf.duration;
        if (!asset.duration || !isFinite(asset.duration)) asset.duration = buf.duration;
      } else asset.hasAudio = false;
    } else if (type === 'audio') {
      const meta = await probeAudio(url).catch(() => ({ duration: 0 }));
      asset.duration = meta.duration;
      setProg(0.5);
      const buf = await getAudioBuffer(id);
      if (buf) {
        asset.duration = buf.duration;
        asset.waveform = computeWaveform(buf);
        asset.waveformDuration = buf.duration;
      }
    } else if (type === 'image') {
      const meta = await probeImage(url);
      Object.assign(asset, meta);
      asset.thumbnail = await makeImageThumbnail(url);
    } else if (type === 'font') {
      const fam = name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
      const ff = new FontFace(fam, await file.arrayBuffer());
      await ff.load();
      document.fonts.add(ff);
      asset.name = fam;
    }
    setProg(0.9);
    await Media.putBlob(id, file);
    await Media.put(asset);
    useMedia.getState().upsert(asset);
    return asset;
  } finally {
    useMedia.setState((s) => ({ importing: s.importing.filter((x) => x.name !== name) }));
  }
}

export async function importFiles(files: FileList | File[], folderId: string | null = null): Promise<{ assets: MediaAsset[]; errors: string[] }> {
  const assets: MediaAsset[] = [];
  const errors: string[] = [];
  for (const f of Array.from(files)) {
    try {
      assets.push(await importFile(f, { folderId }));
    } catch (e: any) {
      errors.push(`${f.name}: ${e?.message || e}`);
    }
  }
  return { assets, errors };
}

export async function updateAsset(id: string, patch: Partial<MediaAsset>) {
  const a = getAsset(id);
  if (!a) return;
  const next = { ...a, ...patch };
  await Media.put(next);
  useMedia.getState().upsert(next);
}

export async function deleteAsset(id: string) {
  await Media.delete(id);
  const u = urls.get(id);
  if (u) URL.revokeObjectURL(u);
  urls.delete(id);
  blobs.delete(id);
  audioBuffers.delete(id);
  imageCache.delete(id);
  useMedia.getState().remove(id);
}

/** Re-register custom fonts on startup. */
export async function restoreFonts() {
  for (const a of useMedia.getState().assets.filter((x) => x.type === 'font')) {
    try {
      const b = await getBlob(a.id);
      if (!b) continue;
      const ff = new FontFace(a.name, await b.arrayBuffer());
      await ff.load();
      document.fonts.add(ff);
    } catch {}
  }
}

/* --------------------------- Video element pool --------------------------- */

export interface VideoSource {
  el: HTMLVideoElement;
  ready: boolean;
  assetId: string;
  lastUsed: number;
}

const videoPool = new Map<string, VideoSource>();

/** Get (or create) a video element for a clip. Keyed per clip so overlapping clips of the same media each have a decoder. */
export function getVideoSource(key: string, assetId: string): VideoSource | null {
  let src = videoPool.get(key);
  if (src && src.assetId === assetId) {
    src.lastUsed = performance.now();
    return src;
  }
  if (src) releaseVideoSource(key);
  const url = getUrlSync(assetId);
  if (!url) {
    void getUrl(assetId);
    return null;
  }
  const el = document.createElement('video');
  el.muted = true;
  el.playsInline = true;
  el.preload = 'auto';
  el.crossOrigin = 'anonymous';
  el.src = url;
  (el as any).disableRemotePlayback = true;
  src = { el, ready: false, assetId, lastUsed: performance.now() };
  el.addEventListener('loadeddata', () => (src!.ready = true), { once: true });
  el.load();
  videoPool.set(key, src);
  return src;
}

export function releaseVideoSource(key: string) {
  const s = videoPool.get(key);
  if (!s) return;
  s.el.pause();
  s.el.removeAttribute('src');
  s.el.load();
  videoPool.delete(key);
}

export function pruneVideoPool(activeKeys: Set<string>, maxIdleMs = 15000) {
  const now = performance.now();
  for (const [k, s] of videoPool) {
    if (!activeKeys.has(k) && now - s.lastUsed > maxIdleMs) releaseVideoSource(k);
  }
}

export function allVideoSources() {
  return videoPool;
}
