/**
 * Person segmentation + face detection via MediaPipe Tasks Vision (runs locally, WebAssembly/WebGL).
 * The wasm runtime is served from /mediapipe/wasm (copied from node_modules by vite.config); the
 * .tflite models are fetched from Google's public model storage on first use and cached by the browser.
 * When anything fails the status becomes 'unavailable' and the UI says so — nothing is faked.
 */
import { create } from 'zustand';
import type { VisualClip } from '@/core/types';
import type { SegmentationProvider } from '@/engine/PlaybackEngine';
import type { FrameSource } from '@/engine/Renderer';
import { engine } from '@/engine/PlaybackEngine';

type Status = 'idle' | 'loading' | 'ready' | 'unavailable';
interface SegStore {
  status: Status;
  faceStatus: Status;
  error?: string;
  progress: number;
  fps: number;
  set: (p: Partial<SegStore>) => void;
}
export const useSegmentation = create<SegStore>((set) => ({ status: 'idle', faceStatus: 'idle', progress: 0, fps: 0, set: (p) => set(p) }));

const WASM_BASE = '/mediapipe/wasm';
const SELFIE_MODEL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';
const SELFIE_MULTI_MODEL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite';
const FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite';
void SELFIE_MULTI_MODEL;

let visionP: Promise<any> | null = null;
async function vision() {
  if (!visionP) {
    visionP = (async () => {
      const mod = await import('@mediapipe/tasks-vision');
      const fileset = await mod.FilesetResolver.forVisionTasks(WASM_BASE);
      return { mod, fileset };
    })();
    visionP.catch(() => (visionP = null));
  }
  return visionP;
}

export function segmentationSupported(): { ok: boolean; reason?: string } {
  if (typeof WebAssembly === 'undefined') return { ok: false, reason: 'WebAssembly not supported' };
  if (typeof OffscreenCanvas === 'undefined' && typeof document === 'undefined') return { ok: false, reason: 'No canvas support' };
  if (typeof navigator !== 'undefined' && navigator.onLine === false && !modelCached) return { ok: false, reason: 'Offline — the segmentation model (≈250 KB) has to be downloaded once.' };
  return { ok: true };
}
let modelCached = false;

/* --------------------------------- segmenter --------------------------------- */
let segmenter: any = null;
let segmenterP: Promise<any> | null = null;
let useGpu = true;

export async function loadSegmenter(): Promise<boolean> {
  if (segmenter) return true;
  if (segmenterP) return segmenterP.then(() => !!segmenter).catch(() => false);
  const sup = segmentationSupported();
  if (!sup.ok) {
    useSegmentation.getState().set({ status: 'unavailable', error: sup.reason });
    return false;
  }
  useSegmentation.getState().set({ status: 'loading', progress: 0.1, error: undefined });
  segmenterP = (async () => {
    const { mod, fileset } = await vision();
    useSegmentation.getState().set({ progress: 0.5 });
    const make = (delegate: 'GPU' | 'CPU') =>
      mod.ImageSegmenter.createFromOptions(fileset, { baseOptions: { modelAssetPath: SELFIE_MODEL, delegate }, runningMode: 'VIDEO', outputCategoryMask: false, outputConfidenceMasks: true });
    try {
      segmenter = await make('GPU');
    } catch {
      useGpu = false;
      segmenter = await make('CPU');
    }
    modelCached = true;
    useSegmentation.getState().set({ status: 'ready', progress: 1 });
    installProvider();
    return segmenter;
  })();
  try {
    await segmenterP;
    return true;
  } catch (e: any) {
    segmenterP = null;
    useSegmentation.getState().set({ status: 'unavailable', error: friendly(e) });
    return false;
  }
}

function friendly(e: any) {
  const m = String(e?.message || e);
  if (/fetch|network|Failed to load|404|CORS/i.test(m)) return 'Could not download the model (network blocked or offline).';
  if (/wasm|WebAssembly/i.test(m)) return 'The MediaPipe WebAssembly runtime failed to load (/mediapipe/wasm).';
  return m;
}

/* Per-clip mask cache keyed by frame version; segmentation is throttled to ~24 fps and reused for scrubbing. */
interface MaskEntry {
  data: Uint8Array;
  width: number;
  height: number;
  version: number;
  frameVersion: number;
  at: number;
}
const masks = new Map<string, MaskEntry>();
let busy = false;
let lastTs = 0;
let frames = 0, fpsAt = performance.now();
const MASK_W = 256;
let scratch: HTMLCanvasElement | OffscreenCanvas | null = null;

function scratchCanvas(w: number, h: number) {
  if (!scratch) scratch = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : document.createElement('canvas');
  if (scratch.width !== w || scratch.height !== h) {
    scratch.width = w;
    scratch.height = h;
  }
  return scratch;
}

const provider: SegmentationProvider = (clip: VisualClip, frame: FrameSource) => {
  const prev = masks.get(clip.id);
  if (!segmenter) return prev ?? null;
  if (prev && prev.frameVersion === frame.version) return prev;
  if (busy) return prev ?? null;
  busy = true;
  try {
    const aspect = frame.width / Math.max(1, frame.height);
    const w = aspect >= 1 ? MASK_W : Math.round(MASK_W * aspect), h = aspect >= 1 ? Math.round(MASK_W / aspect) : MASK_W;
    const c = scratchCanvas(w, h);
    const g = (c as HTMLCanvasElement).getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
    g.drawImage(frame.source as CanvasImageSource, 0, 0, w, h);
    // MediaPipe needs strictly increasing timestamps in VIDEO mode
    const ts = Math.max(lastTs + 1, Math.round(performance.now()));
    lastTs = ts;
    const result = segmenter.segmentForVideo(c, ts);
    const conf = result?.confidenceMasks?.[0];
    if (!conf) {
      result?.close?.();
      return prev ?? null;
    }
    const f32: Float32Array = conf.getAsFloat32Array();
    const data = prev && prev.width === conf.width && prev.height === conf.height ? prev.data : new Uint8Array(conf.width * conf.height);
    for (let i = 0; i < f32.length; i++) data[i] = f32[i] * 255;
    const entry: MaskEntry = { data, width: conf.width, height: conf.height, version: (prev?.version ?? 0) + 1, frameVersion: frame.version, at: performance.now() };
    masks.set(clip.id, entry);
    result.close?.();
    frames++;
    const now = performance.now();
    if (now - fpsAt > 1000) {
      useSegmentation.getState().set({ fps: Math.round((frames * 1000) / (now - fpsAt)) });
      frames = 0;
      fpsAt = now;
    }
    return entry;
  } catch (e) {
    console.warn('segmentation failed', e);
    return prev ?? null;
  } finally {
    busy = false;
  }
};

function installProvider() {
  engine.segmentation = provider;
  engine.invalidate?.();
}
export function dropMaskCache(clipId?: string) {
  if (clipId) masks.delete(clipId);
  else masks.clear();
}
export const segmentationDelegate = () => (useGpu ? 'GPU' : 'CPU');

/* --------------------------------- face detector --------------------------------- */
let faceDetector: any = null;
let faceP: Promise<any> | null = null;
export async function loadFaceDetector(): Promise<boolean> {
  if (faceDetector) return true;
  if (faceP) return faceP.then(() => true).catch(() => false);
  const sup = segmentationSupported();
  if (!sup.ok) {
    useSegmentation.getState().set({ faceStatus: 'unavailable', error: sup.reason });
    return false;
  }
  useSegmentation.getState().set({ faceStatus: 'loading' });
  faceP = (async () => {
    const { mod, fileset } = await vision();
    try {
      faceDetector = await mod.FaceDetector.createFromOptions(fileset, { baseOptions: { modelAssetPath: FACE_MODEL, delegate: 'GPU' }, runningMode: 'IMAGE', minDetectionConfidence: 0.5 });
    } catch {
      faceDetector = await mod.FaceDetector.createFromOptions(fileset, { baseOptions: { modelAssetPath: FACE_MODEL, delegate: 'CPU' }, runningMode: 'IMAGE', minDetectionConfidence: 0.5 });
    }
    useSegmentation.getState().set({ faceStatus: 'ready' });
    return faceDetector;
  })();
  try {
    await faceP;
    return true;
  } catch (e: any) {
    faceP = null;
    useSegmentation.getState().set({ faceStatus: 'unavailable', error: friendly(e) });
    return false;
  }
}

export interface FaceBox {
  x: number; // normalized 0..1 (center)
  y: number;
  w: number;
  h: number;
  score: number;
}
/** Detect faces in an ImageData / canvas. Returns normalized boxes. */
export function detectFaces(img: ImageData | HTMLCanvasElement | OffscreenCanvas | HTMLVideoElement): FaceBox[] {
  if (!faceDetector) return [];
  const res = faceDetector.detect(img as any);
  const W = (img as any).width, H = (img as any).height;
  return (res?.detections || []).map((d: any) => {
    const b = d.boundingBox;
    return { x: (b.originX + b.width / 2) / W, y: (b.originY + b.height / 2) / H, w: b.width / W, h: b.height / H, score: d.categories?.[0]?.score ?? 0 };
  });
}

/** Person bounding box (normalized center/size) from the segmenter for a still image — used by reframe when no face is visible. */
export function personBox(img: HTMLCanvasElement | OffscreenCanvas | ImageData): { x: number; y: number; w: number; h: number; coverage: number } | null {
  if (!segmenter) return null;
  try {
    // segmenter is VIDEO mode; use monotonically increasing timestamps
    const ts = Math.max(lastTs + 1, Math.round(performance.now()));
    lastTs = ts;
    const result = segmenter.segmentForVideo(img as any, ts);
    const conf = result?.confidenceMasks?.[0];
    if (!conf) return null;
    const f = conf.getAsFloat32Array() as Float32Array;
    const w = conf.width, h = conf.height;
    let minX = w, minY = h, maxX = 0, maxY = 0, n = 0;
    for (let y = 0; y < h; y += 2)
      for (let x = 0; x < w; x += 2) {
        if (f[y * w + x] > 0.6) {
          n++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    result.close?.();
    if (n < 20) return null;
    return { x: (minX + maxX) / 2 / w, y: (minY + maxY) / 2 / h, w: (maxX - minX) / w, h: (maxY - minY) / h, coverage: (n * 4) / (w * h) };
  } catch {
    return null;
  }
}
