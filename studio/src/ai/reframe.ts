/**
 * Auto reframe: keeps the subject in frame when a clip's aspect differs from the canvas (e.g. 16:9 → 9:16).
 * Subject tracking = MediaPipe face detection (primary) → person segmentation box (secondary) →
 * motion-saliency centroid (fallback, labelled "motion-based"). Output = scale to cover + position keyframes.
 */
import type { VideoClip, ImageClip, Keyframe, Vec2 } from '@/core/types';
import { openGrabber, clipSourceTime } from './frames';
import { loadFaceDetector, loadSegmenter, detectFaces, personBox, useSegmentation } from './segmentation';
import { getAsset } from '@/engine/MediaManager';
import { uid } from '@/core/util';

export interface ReframeResult {
  scale: number;
  keyframes: Keyframe<Vec2>[];
  method: 'face' | 'person' | 'motion';
  samples: number;
  note: string;
}
export interface ReframeOptions {
  canvas: { width: number; height: number };
  /** seconds between samples */
  step?: number;
  /** 0..1 how tightly to follow (1 = snappy, 0 = very smooth) */
  responsiveness?: number;
  mode?: 'auto' | 'face' | 'motion';
  onProgress?: (p: number) => void;
  signal?: { cancelled: boolean };
}

export async function analyzeReframe(clip: VideoClip | ImageClip, opts: ReframeOptions): Promise<ReframeResult | null> {
  const asset = getAsset(clip.mediaId);
  if (!asset || !asset.width || !asset.height) return null;
  const { width: pw, height: ph } = opts.canvas;
  // "fit" size of the source in the canvas
  const fitScale = Math.min(pw / asset.width, ph / asset.height);
  const fitW = asset.width * fitScale, fitH = asset.height * fitScale;
  const cover = Math.max(pw / fitW, ph / fitH);
  const dispW = fitW * cover, dispH = fitH * cover;
  const maxX = Math.max(0, (dispW - pw) / 2), maxY = Math.max(0, (dispH - ph) / 2);
  if (maxX < 1 && maxY < 1) return { scale: cover, keyframes: [], method: 'face', samples: 0, note: 'Clip already matches the canvas aspect — scaled to cover.' };

  const g = await openGrabber(clip.mediaId, 320);
  if (!g) return null;
  const step = opts.step ?? 0.4;
  const n = clip.kind === 'image' ? 1 : Math.max(1, Math.ceil(clip.duration / step));
  const wantFace = opts.mode !== 'motion';
  let haveFace = false, havePerson = false;
  if (wantFace) {
    haveFace = await loadFaceDetector();
    if (!haveFace && opts.mode === 'face') {
      g.dispose();
      return null;
    }
    havePerson = haveFace ? false : await loadSegmenter();
  }
  const pts: { t: number; x: number; y: number; w: number }[] = [];
  let prev: Float32Array | null = null;
  let usedFace = 0, usedPerson = 0, usedMotion = 0;
  const canvas = document.createElement('canvas');
  canvas.width = g.width;
  canvas.height = g.height;
  const cctx = canvas.getContext('2d')!;
  try {
    for (let i = 0; i < n; i++) {
      if (opts.signal?.cancelled) return null;
      const tl = clip.start + Math.min(clip.duration - 0.01, i * step);
      const img = await g.grab(clip.kind === 'image' ? 0 : clipSourceTime(clip, tl));
      let x = 0.5, y = 0.5, w = 0;
      let got = false;
      if (haveFace) {
        cctx.putImageData(img, 0, 0);
        const faces = detectFaces(canvas).filter((f) => f.score > 0.5);
        if (faces.length) {
          // weight by size; multi-face → centroid of the bounding union
          let minX = 1, maxX = 0, minY = 1, maxY = 0, sw = 0, sx = 0, sy = 0;
          for (const f of faces) {
            minX = Math.min(minX, f.x - f.w / 2); maxX = Math.max(maxX, f.x + f.w / 2);
            minY = Math.min(minY, f.y - f.h / 2); maxY = Math.max(maxY, f.y + f.h / 2);
            const wt = f.w * f.h;
            sw += wt; sx += f.x * wt; sy += f.y * wt;
          }
          x = faces.length > 1 ? (minX + maxX) / 2 : sx / sw;
          y = faces.length > 1 ? (minY + maxY) / 2 : sy / sw + faces[0].h * 0.25; // bias down to include shoulders
          w = maxX - minX;
          got = true;
          usedFace++;
        }
      }
      if (!got && havePerson) {
        cctx.putImageData(img, 0, 0);
        const pb = personBox(canvas);
        if (pb && pb.coverage > 0.01) {
          x = pb.x; y = pb.y - pb.h * 0.15; w = pb.w; got = true; usedPerson++;
        }
      }
      if (!got) {
        // motion saliency: centroid of absolute frame difference (falls back to centre on static frames)
        const cur = gray(img);
        if (prev) {
          let sx = 0, sy = 0, s = 0;
          const W = img.width;
          for (let p = 0; p < cur.length; p++) {
            const d = Math.abs(cur[p] - prev[p]);
            if (d > 18) {
              s += d; sx += (p % W) * d; sy += Math.floor(p / W) * d;
            }
          }
          if (s > cur.length * 2) {
            x = sx / s / W; y = sy / s / img.height; got = true; usedMotion++;
          }
        }
        prev = cur;
      }
      if (!got && pts.length) { x = pts[pts.length - 1].x; y = pts[pts.length - 1].y; }
      pts.push({ t: tl - clip.start, x, y, w });
      opts.onProgress?.((i + 1) / n);
    }
  } finally {
    g.dispose();
  }
  // temporal smoothing (exponential, both directions) — stronger when responsiveness is low
  const alpha = 0.15 + 0.6 * (opts.responsiveness ?? 0.4);
  const sm = pts.map((p) => ({ ...p }));
  for (let i = 1; i < sm.length; i++) { sm[i].x = sm[i - 1].x + (sm[i].x - sm[i - 1].x) * alpha; sm[i].y = sm[i - 1].y + (sm[i].y - sm[i - 1].y) * alpha; }
  for (let i = sm.length - 2; i >= 0; i--) { sm[i].x = sm[i + 1].x + (sm[i].x - sm[i + 1].x) * alpha; sm[i].y = sm[i + 1].y + (sm[i].y - sm[i + 1].y) * alpha; }
  // dead-zone: drop keyframes that barely move (keeps the timeline clean)
  const toPos = (p: { x: number; y: number }): Vec2 => ({ x: clamp(-(p.x - 0.5) * dispW, -maxX, maxX), y: clamp(-(p.y - 0.5) * dispH, -maxY, maxY) });
  const kfs: Keyframe<Vec2>[] = [];
  let last: Vec2 | null = null;
  sm.forEach((p, i) => {
    const v = toPos(p);
    const first = i === 0, lastIdx = i === sm.length - 1;
    if (first || lastIdx || !last || Math.hypot(v.x - last.x, v.y - last.y) > Math.max(pw, ph) * 0.01) {
      kfs.push({ id: uid('kf'), time: p.t, value: v, easing: 'easeInOut' });
      last = v;
    }
  });
  const method: ReframeResult['method'] = usedFace >= usedPerson && usedFace >= usedMotion && usedFace > 0 ? 'face' : usedPerson > usedMotion && usedPerson > 0 ? 'person' : 'motion';
  const segErr = useSegmentation.getState().error;
  const note = method === 'face' ? `Tracked faces in ${usedFace}/${n} samples (MediaPipe BlazeFace).` : method === 'person' ? `Tracked person silhouette in ${usedPerson}/${n} samples (MediaPipe selfie segmentation).` : `No face model available${segErr ? ` (${segErr})` : ''} — used motion saliency (heuristic).`;
  return { scale: cover, keyframes: kfs.length > 1 ? kfs : [], method, samples: n, note: kfs.length > 1 ? note : note + ' Subject is static — a fixed crop was applied.' };
}

/** Static reframe when there is a single sample: returns position only. */
export function staticPositionFrom(res: ReframeResult): Vec2 | null {
  return res.keyframes[0]?.value ?? null;
}

function gray(img: ImageData): Float32Array {
  const d = img.data, out = new Float32Array(img.width * img.height);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) out[p] = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
  return out;
}
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
