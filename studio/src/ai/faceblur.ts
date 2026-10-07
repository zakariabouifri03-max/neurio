/**
 * Privacy face blur: detects faces across the clip (MediaPipe BlazeFace, model downloaded on first use),
 * tracks them, then adds one overlay copy of the clip per face with a pixelate/blur effect limited by an
 * animated ellipse mask. Fully editable afterwards (keyframes + mask in the inspector).
 */
import type { VideoClip, ImageClip, Keyframe, Vec2, Project, Clip } from '@/core/types';
import { openGrabber } from './frames';
import { loadFaceDetector, detectFaces, useSegmentation } from './segmentation';
import { defaultMask } from '@/core/defaults';
import { useProject } from '@/core/store';
import * as cmd from '@/core/commands';
import { uid } from '@/core/util';

type Visual = VideoClip | ImageClip;
export interface Obs { t: number; x: number; y: number; w: number; h: number }
export interface Track { obs: Obs[] }

export interface FaceBlurOptions {
  mode?: 'pixelate' | 'blur';
  strength?: number; // 0..1
  maxFaces?: number;
  sampleFps?: number;
  padding?: number; // mask enlarge factor
  onProgress?: (p: number) => void;
  signal?: { cancelled: boolean };
}

export async function analyzeFaces(clip: Visual, opts: FaceBlurOptions = {}): Promise<{ tracks: Track[]; frames: number; detections: number } | null> {
  const ok = await loadFaceDetector();
  if (!ok) return null;
  const g = await openGrabber(clip.mediaId, 320);
  if (!g) return null;
  const isVideo = clip.kind === 'video';
  const rate = isVideo ? (clip as VideoClip).speed.rate || 1 : 1;
  const from = isVideo ? (clip as VideoClip).mediaIn : 0;
  const to = isVideo ? Math.min(g.duration || from + clip.duration * rate, from + clip.duration * rate) : 0;
  const fps = opts.sampleFps ?? 6;
  const n = isVideo ? Math.max(2, Math.ceil((to - from) * fps)) : 1;
  const tracks: Track[] = [];
  let detections = 0;
  const maxFaces = opts.maxFaces ?? 4;
  try {
    for (let i = 0; i < n; i++) {
      if (opts.signal?.cancelled) return null;
      const t = isVideo ? Math.min(to, from + i / fps) : 0;
      const img = await g.grab(t);
      const faces = detectFaces(img).filter((f) => f.score > 0.45).sort((a, b) => b.w * b.h - a.w * a.h).slice(0, maxFaces);
      detections += faces.length;
      const used = new Set<number>();
      for (const f of faces) {
        // nearest live track
        let best = -1, bestD = 0.2;
        tracks.forEach((tr, k) => {
          if (used.has(k)) return;
          const last = tr.obs[tr.obs.length - 1];
          if (t - last.t > 1.0) return; // stale
          const d = Math.hypot(last.x - f.x, last.y - f.y);
          if (d < bestD) { bestD = d; best = k; }
        });
        const o: Obs = { t, x: f.x, y: f.y, w: f.w, h: f.h };
        if (best >= 0) { tracks[best].obs.push(o); used.add(best); }
        else { tracks.push({ obs: [o] }); used.add(tracks.length - 1); }
      }
      opts.onProgress?.((i + 1) / n);
    }
  } finally {
    g.dispose();
  }
  const minObs = isVideo ? 3 : 1;
  const kept = tracks.filter((tr) => tr.obs.length >= minObs).sort((a, b) => b.obs.length - a.obs.length).slice(0, maxFaces);
  return { tracks: kept, frames: n, detections };
}

export const smooth = (obs: Obs[], alpha = 0.5): Obs[] => {
  const out = obs.map((o) => ({ ...o }));
  for (let i = 1; i < out.length; i++) {
    out[i].x = out[i - 1].x + (out[i].x - out[i - 1].x) * alpha;
    out[i].y = out[i - 1].y + (out[i].y - out[i - 1].y) * alpha;
    out[i].w = out[i - 1].w + (out[i].w - out[i - 1].w) * alpha;
    out[i].h = out[i - 1].h + (out[i].h - out[i - 1].h) * alpha;
  }
  return out;
};

/** Adds the blur overlays to the project. Returns the number of overlays created. */
export function applyFaceBlur(clip: Visual, tracks: Track[], opts: FaceBlurOptions = {}): number {
  const st = useProject.getState();
  if (!st.project || !tracks.length) return 0;
  const mode = opts.mode ?? 'pixelate';
  const strength = opts.strength ?? 0.7;
  const pad = opts.padding ?? 1.5;
  const isVideo = clip.kind === 'video';
  const rate = isVideo ? (clip as VideoClip).speed.rate || 1 : 1;
  const mediaIn = isVideo ? (clip as VideoClip).mediaIn : 0;
  const reversed = isVideo && (clip as VideoClip).speed.reversed;
  const span = clip.duration * rate;
  const rel = (src: number) => (reversed ? (mediaIn + span - src) / rate : (src - mediaIn) / rate);
  let created = 0;
  st.apply('Blur faces', (p0) => {
    let p: Project = p0;
    const found = cmd.findClip(p, clip.id);
    if (!found) return p;
    const trackIndex = p.tracks.findIndex((t) => t.id === found.track.id);
    for (const tr of tracks) {
      const obs = smooth(tr.obs);
      const kf = <T,>(time: number, value: T): Keyframe<T> => ({ id: uid('kf'), time: Math.max(0, Math.min(clip.duration, time)), value, easing: 'linear' });
      const centers: Keyframe<Vec2>[] = [];
      const sizes: Keyframe<Vec2>[] = [];
      const opac: Keyframe<number>[] = [];
      obs.forEach((o, i) => {
        const t = rel(o.t);
        centers.push(kf(t, { x: o.x - 0.5, y: o.y - 0.5 }));
        sizes.push(kf(t, { x: Math.min(1, o.w * pad), y: Math.min(1, o.h * pad * 1.15) }));
        // hide the blur while the face is not seen (gap > 0.6 s)
        const prev = obs[i - 1];
        if (prev && o.t - prev.t > 0.6) {
          opac.push(kf(rel(prev.t) + 0.15, 0), kf(t - 0.15, 0));
        }
        opac.push(kf(t, 1));
      });
      if (isVideo) {
        const first = obs[0], last = obs[obs.length - 1];
        if (rel(first.t) > 0.3) opac.unshift(kf(0, 0), kf(rel(first.t) - 0.15, 0));
        if (clip.duration - rel(last.t) > 0.3) opac.push(kf(rel(last.t) + 0.15, 0), kf(clip.duration, 0));
      }
      const mask = defaultMask('circle');
      mask.center = { value: centers[0].value, keyframes: centers.length > 1 ? centers : undefined };
      mask.size = { value: sizes[0].value, keyframes: sizes.length > 1 ? sizes : undefined };
      mask.feather = { value: 0.25 };
      mask.opacity = { value: 1, keyframes: opac.length > 1 ? opac.sort((a, b) => a.time - b.time) : undefined };
      const effect = mode === 'pixelate'
        ? { id: uid('fx'), type: 'pixelate', enabled: true, params: { size: { value: Math.round(8 + strength * 56) } } }
        : { id: uid('fx'), type: 'blur', enabled: true, params: { radius: { value: Math.round(8 + strength * 32) } } };
      const copy = {
        ...(found.clip as Visual),
        id: uid('clip'),
        name: `${clip.name} · face blur ${created + 1}`,
        effects: [effect],
        mask,
        transitionIn: null,
        transitionOut: null,
        groupId: undefined,
        locked: false,
        ...(isVideo ? { hasAudio: false } : {}),
      } as unknown as Clip;
      // overlay track directly above the source clip's track
      const nt = cmd.addTrack(p, 'overlay', Math.max(0, trackIndex));
      p = nt.project;
      nt.track.name = `Face blur ${created + 1}`;
      p = { ...p, tracks: p.tracks.map((t) => (t.id === nt.track.id ? { ...t, name: `Face blur ${created + 1}` } : t)) };
      p = cmd.addClip(p, copy, nt.track.id).project;
      created++;
    }
    return p;
  });
  return created;
}

export const faceModelStatus = () => useSegmentation.getState().faceStatus;
