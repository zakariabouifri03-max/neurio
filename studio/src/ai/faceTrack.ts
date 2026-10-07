/**
 * Face tracking → keyframes. Uses the MediaPipe face detector (same tracks as the face-blur tool) and
 * turns a chosen face track into:
 *   • follow  — the clip itself is zoomed and its position keyframed so the face stays centered;
 *   • attach  — another clip (text / sticker / image / overlay) gets position (+ scale) keyframes
 *               pinned to the face (above the head, centered, or below the chin);
 *   • mask    — the clip's own mask follows the face (optionally inverted → effects hit the background only).
 * Everything produced is ordinary keyframes/masks, fully editable afterwards.
 */
import type { Clip, Keyframe, Project, Vec2, VideoClip, ImageClip, VisualClip } from '@/core/types';
import type { Track as FaceTrack, Obs } from './faceblur';
import { smooth } from './faceblur';
import { getAsset } from '@/engine/MediaManager';
import { useProject } from '@/core/store';
import * as cmd from '@/core/commands';
import { vec, hasKeyframes } from '@/core/keyframes';
import { defaultMask } from '@/core/defaults';
import { uid } from '@/core/util';

type Visual = VideoClip | ImageClip;

/** Face observations converted to clip-relative timeline seconds (speed/reverse aware) and smoothed. */
export function timelineObs(clip: Visual, track: FaceTrack, smoothing = 0.5): Obs[] {
  const isVideo = clip.kind === 'video';
  const rate = isVideo ? (clip as VideoClip).speed.rate || 1 : 1;
  const mediaIn = isVideo ? (clip as VideoClip).mediaIn : 0;
  const reversed = isVideo && (clip as VideoClip).speed.reversed;
  const span = clip.duration * rate;
  const rel = (src: number) => (reversed ? (mediaIn + span - src) / rate : (src - mediaIn) / rate);
  const obs = smooth(track.obs, smoothing).map((o) => ({ ...o, t: Math.max(0, Math.min(clip.duration, rel(o.t))) }));
  return obs.sort((a, b) => a.t - b.t);
}

/** Display geometry of a visual clip in project pixels (scale 1 = "fit"). */
export function fitSize(clip: Visual, canvas: { width: number; height: number }) {
  const asset = getAsset(clip.mediaId);
  const aw = asset?.width || canvas.width, ah = asset?.height || canvas.height;
  const fit = Math.min(canvas.width / aw, canvas.height / ah);
  return { fitW: aw * fit, fitH: ah * fit, cover: Math.max(canvas.width / (aw * fit), canvas.height / (ah * fit)) };
}

const kf = <T,>(time: number, value: T, easing: Keyframe<T>['easing'] = 'easeInOut'): Keyframe<T> => ({ id: uid('kf'), time, value, easing });

export interface FollowOptions {
  /** Zoom relative to "cover" (1 = just fills the canvas, 1.3 = punch-in 30 %). */
  zoom?: number;
  smoothing?: number; // 0..1 (1 = raw)
  /** Vertical bias: 0 = face center, 0.3 = face in upper third (rule of thirds). */
  headroom?: number;
}

/** Keyframes the clip's own transform so the face stays centered (camera follow / punch-in). */
export function applyFollowFace(clip: Visual, track: FaceTrack, opts: FollowOptions = {}): { keyframes: number; scale: number } {
  const st = useProject.getState();
  const p = st.project!;
  const { fitW, fitH, cover } = fitSize(clip, p.settings);
  const s = cover * (opts.zoom ?? 1.25);
  const dispW = fitW * s, dispH = fitH * s;
  const maxX = Math.max(0, (dispW - p.settings.width) / 2), maxY = Math.max(0, (dispH - p.settings.height) / 2);
  const obs = timelineObs(clip, track, 0.25 + 0.7 * (opts.smoothing ?? 0.4));
  const headroom = opts.headroom ?? 0.15;
  const toPos = (o: Obs): Vec2 => ({
    x: clamp(-(o.x - 0.5) * dispW, -maxX, maxX),
    y: clamp(-(o.y - 0.5) * dispH + headroom * p.settings.height, -maxY, maxY),
  });
  const kfs: Keyframe<Vec2>[] = [];
  let last: Vec2 | null = null;
  obs.forEach((o, i) => {
    const v = toPos(o);
    if (i === 0 || i === obs.length - 1 || !last || Math.hypot(v.x - last.x, v.y - last.y) > Math.max(p.settings.width, p.settings.height) * 0.006) {
      kfs.push(kf(o.t, v));
      last = v;
    }
  });
  st.apply('Follow face', (proj) =>
    cmd.updateClip(proj, clip.id, (c) => {
      const t = (c as VisualClip).transform;
      return { ...c, transform: { ...t, scale: { value: { x: s, y: s } }, position: kfs.length > 1 ? { value: kfs[0].value, keyframes: kfs } : { value: kfs[0]?.value ?? { x: 0, y: 0 } } } } as Clip;
    }),
  );
  return { keyframes: kfs.length, scale: s };
}

export interface AttachOptions {
  anchor?: 'above' | 'center' | 'below';
  /** Scale the attached clip with the face size. */
  scaleWithFace?: boolean;
  smoothing?: number;
  /** Extra offset in face-heights (positive = down). */
  offsetY?: number;
}

/** Pins another clip to the face: writes position (and optionally scale) keyframes on `target`. */
export function applyAttachToFace(clip: Visual, track: FaceTrack, target: Clip, opts: AttachOptions = {}): { keyframes: number } {
  const st = useProject.getState();
  const p = st.project!;
  if (target.kind === 'audio') return { keyframes: 0 };
  const { fitW, fitH } = fitSize(clip, p.settings);
  const obs = timelineObs(clip, track, 0.25 + 0.7 * (opts.smoothing ?? 0.5));
  const anchor = opts.anchor ?? 'above';
  const tv = target as VisualClip;
  const baseScale = vec(tv.transform.scale, 0, { x: 1, y: 1 });
  const pos: Keyframe<Vec2>[] = [];
  const scl: Keyframe<Vec2>[] = [];
  let refW = 0;
  for (const o of obs) {
    const tlTime = clip.start + o.t; // absolute timeline time
    const tt = tlTime - target.start; // target-relative
    if (tt < -0.05 || tt > target.duration + 0.05) continue;
    const ct = o.t;
    const cpos = vec((clip as VisualClip).transform.position, ct, { x: 0, y: 0 });
    const cscale = vec((clip as VisualClip).transform.scale, ct, { x: 1, y: 1 });
    const faceW = o.w * fitW * cscale.x, faceH = o.h * fitH * cscale.y;
    const fx = cpos.x + (o.x - 0.5) * fitW * cscale.x;
    let fy = cpos.y + (o.y - 0.5) * fitH * cscale.y;
    if (anchor === 'above') fy -= faceH * 0.95;
    else if (anchor === 'below') fy += faceH * 0.85;
    fy += (opts.offsetY ?? 0) * faceH;
    pos.push(kf(Math.max(0, Math.min(target.duration, tt)), { x: fx, y: fy }));
    if (opts.scaleWithFace) {
      if (!refW) refW = faceW || 1;
      const k = faceW / refW;
      scl.push(kf(Math.max(0, Math.min(target.duration, tt)), { x: baseScale.x * k, y: baseScale.y * k }));
    }
  }
  if (!pos.length) return { keyframes: 0 };
  st.apply('Attach to face', (proj) =>
    cmd.updateClip(proj, target.id, (c) => {
      const t = (c as VisualClip).transform;
      return {
        ...c,
        transform: {
          ...t,
          position: pos.length > 1 ? { value: pos[0].value, keyframes: pos } : { value: pos[0].value },
          scale: opts.scaleWithFace && scl.length > 1 ? { value: scl[0].value, keyframes: scl } : t.scale,
        },
      } as Clip;
    }),
  );
  return { keyframes: pos.length };
}

export interface TrackedMaskOptions {
  shape?: 'circle' | 'rectangle';
  padding?: number; // mask enlarge factor (1.5 = 150 % of the face box)
  feather?: number;
  invert?: boolean;
  smoothing?: number;
}

/** Makes the clip's mask follow the face. With `invert`, effects/adjustments apply to everything except the face. */
export function applyTrackedMask(clip: Visual, track: FaceTrack, opts: TrackedMaskOptions = {}): { keyframes: number } {
  const st = useProject.getState();
  const obs = timelineObs(clip, track, 0.25 + 0.7 * (opts.smoothing ?? 0.5));
  const pad = opts.padding ?? 1.6;
  const centers: Keyframe<Vec2>[] = obs.map((o) => kf(o.t, { x: o.x - 0.5, y: o.y - 0.5 }, 'linear'));
  const sizes: Keyframe<Vec2>[] = obs.map((o) => kf(o.t, { x: Math.min(1, o.w * pad), y: Math.min(1, o.h * pad * 1.2) }, 'linear'));
  if (!centers.length) return { keyframes: 0 };
  const mask = defaultMask(opts.shape === 'rectangle' ? 'rectangle' : 'circle');
  mask.center = { value: centers[0].value, keyframes: centers.length > 1 ? centers : undefined };
  mask.size = { value: sizes[0].value, keyframes: sizes.length > 1 ? sizes : undefined };
  mask.feather = { value: opts.feather ?? 0.3 };
  mask.invert = !!opts.invert;
  mask.enabled = true;
  st.apply('Tracked face mask', (proj) => cmd.updateClip(proj, clip.id, (c) => ({ ...c, mask }) as Clip));
  return { keyframes: centers.length };
}

/** Overlay clips (text/sticker/image/video on other tracks) that overlap the given clip in time — attach candidates. */
export function overlayCandidates(p: Project, clip: Visual): Clip[] {
  const a0 = clip.start, a1 = clip.start + clip.duration;
  return cmd.allClips(p).filter((c) => c.id !== clip.id && c.kind !== 'audio' && c.kind !== 'caption' && c.trackId !== clip.trackId && c.start < a1 && c.start + c.duration > a0);
}

export const describeTrack = (clip: Visual, track: FaceTrack, frames: number) => {
  const seen = Math.round((track.obs.length / Math.max(1, frames)) * 100);
  const avgW = track.obs.reduce((a, o) => a + o.w, 0) / Math.max(1, track.obs.length);
  const o0 = track.obs[0];
  const where = o0 ? `${o0.x < 0.33 ? 'left' : o0.x > 0.66 ? 'right' : 'center'}` : '';
  return `${clip.kind === 'video' ? `seen ${seen}% of the time` : 'still image'} · ${Math.round(avgW * 100)}% wide · ${where}`;
};

export const isAnimatedPos = (c: Clip) => c.kind !== 'audio' && hasKeyframes((c as VisualClip).transform.position);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
