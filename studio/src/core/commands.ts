/**
 * Pure editing operations on Project objects. Every function returns a new Project
 * (shallow copies along the changed path) so the store can keep undo snapshots cheaply.
 */
import type { Clip, Project, Track, TrackKind, VideoClip, AudioClip, ClipKind } from './types';
import { makeTrack, makeAudioClip } from './defaults';
import { uid, deepClone } from './util';
import { shiftKeyframes, scaleKeyframes } from './keyframes';

const EPS = 1e-6;

export const clipEnd = (c: Clip) => c.start + c.duration;

export function findClip(p: Project, id: string): { clip: Clip; track: Track } | null {
  for (const t of p.tracks) {
    const c = t.clips.find((x) => x.id === id);
    if (c) return { clip: c, track: t };
  }
  return null;
}

export function allClips(p: Project): Clip[] {
  return p.tracks.flatMap((t) => t.clips);
}

export function projectDuration(p: Project): number {
  let d = 0;
  for (const t of p.tracks) for (const c of t.clips) d = Math.max(d, clipEnd(c));
  return d;
}

export function trackKindForClip(kind: ClipKind): TrackKind {
  switch (kind) {
    case 'audio':
      return 'audio';
    case 'text':
    case 'caption':
      return 'text';
    case 'sticker':
      return 'sticker';
    default:
      return 'video';
  }
}

export function clipFitsTrack(track: Track, kind: ClipKind): boolean {
  if (track.kind === 'audio') return kind === 'audio';
  if (kind === 'audio') return false;
  if (track.kind === 'text') return kind === 'text' || kind === 'caption';
  if (track.kind === 'sticker') return kind === 'sticker' || kind === 'image' || kind === 'text';
  // video / overlay / image: any visual
  return true;
}

export function sortClips(clips: Clip[]) {
  return [...clips].sort((a, b) => a.start - b.start);
}

/** Find the nearest position >= preferred where a clip of `duration` fits in the track (ignoring `ignoreIds`). */
export function findFreePosition(track: Track, preferred: number, duration: number, ignoreIds: string[] = []): number {
  const clips = sortClips(track.clips.filter((c) => !ignoreIds.includes(c.id)));
  let pos = Math.max(0, preferred);
  const overlaps = (s: number) => clips.find((c) => s < clipEnd(c) - EPS && s + duration > c.start + EPS);
  // Try at preferred, otherwise after the blocking clip, repeat.
  for (let i = 0; i < clips.length + 2; i++) {
    const hit = overlaps(pos);
    if (!hit) return pos;
    // check if we can fit before hit (snap left) when preferred is close to the gap
    const prev = clips.filter((c) => clipEnd(c) <= hit.start + EPS).pop();
    const gapStart = prev ? clipEnd(prev) : 0;
    if (hit.start - gapStart >= duration - EPS && preferred < hit.start) {
      const candidate = Math.min(preferred, hit.start - duration);
      if (candidate >= gapStart - EPS) return Math.max(gapStart, candidate);
    }
    pos = clipEnd(hit);
  }
  return pos;
}

function updateTrack(p: Project, trackId: string, fn: (t: Track) => Track): Project {
  return { ...p, tracks: p.tracks.map((t) => (t.id === trackId ? fn(t) : t)) };
}

export function updateClip(p: Project, clipId: string, fn: (c: Clip) => Clip): Project {
  return {
    ...p,
    tracks: p.tracks.map((t) => (t.clips.some((c) => c.id === clipId) ? { ...t, clips: t.clips.map((c) => (c.id === clipId ? fn(c) : c)) } : t)),
  };
}

export function updateClips(p: Project, ids: string[], fn: (c: Clip) => Clip): Project {
  const set = new Set(ids);
  return { ...p, tracks: p.tracks.map((t) => (t.clips.some((c) => set.has(c.id)) ? { ...t, clips: t.clips.map((c) => (set.has(c.id) ? fn(c) : c)) } : t)) };
}

/** Insert a clip in the given track, resolving overlaps. Creates a track if needed. */
export function addClip(p: Project, clip: Clip, trackId?: string | null, opts: { allowNewTrack?: boolean } = {}): { project: Project; clip: Clip } {
  const kind = trackKindForClip(clip.kind);
  let track = trackId ? p.tracks.find((t) => t.id === trackId) : undefined;
  if (track && (!clipFitsTrack(track, clip.kind) || track.locked)) track = undefined;
  let project = p;
  if (!track) {
    // find a compatible track where it fits at the preferred position without moving, else create new
    const candidates = p.tracks.filter((t) => clipFitsTrack(t, clip.kind) && !t.locked && (t.kind === kind || (kind === 'video' && t.kind === 'overlay')));
    // prefer tracks of the exact kind (video before overlay), lowest in the stack first
    candidates.sort((a, b) => Number(b.kind === kind) - Number(a.kind === kind) || (kind === 'audio' ? p.tracks.indexOf(a) - p.tracks.indexOf(b) : p.tracks.indexOf(b) - p.tracks.indexOf(a)));
    track = candidates.find((t) => findFreePosition(t, clip.start, clip.duration) === Math.max(0, clip.start));
    if (!track && opts.allowNewTrack !== false) {
      const nt = makeTrack(kind, `${kind[0].toUpperCase()}${kind.slice(1)} ${p.tracks.filter((t) => t.kind === kind).length + 1}`);
      // insert audio tracks at bottom, others at top of their group
      if (kind === 'audio') project = { ...p, tracks: [...p.tracks, nt] };
      else project = { ...p, tracks: [nt, ...p.tracks] };
      track = nt;
    }
    if (!track) track = candidates[0];
    if (!track) throw new Error('No track available');
  }
  const start = findFreePosition(track, clip.start, clip.duration);
  const placed: Clip = { ...clip, trackId: track.id, start };
  project = updateTrack(project, track.id, (t) => ({ ...t, clips: sortClips([...t.clips, placed]) }));
  return { project, clip: placed };
}

export function removeClips(p: Project, ids: string[]): Project {
  const set = new Set(ids);
  return { ...p, tracks: p.tracks.map((t) => ({ ...t, clips: t.clips.filter((c) => !set.has(c.id)) })) };
}

/** Ripple delete: remove clips and close gaps on their tracks. */
export function rippleDelete(p: Project, ids: string[]): Project {
  const set = new Set(ids);
  return {
    ...p,
    tracks: p.tracks.map((t) => {
      const removed = t.clips.filter((c) => set.has(c.id));
      if (!removed.length) return t;
      let clips = t.clips.filter((c) => !set.has(c.id));
      for (const r of sortClips(removed).reverse()) {
        clips = clips.map((c) => (c.start >= clipEnd(r) - EPS ? { ...c, start: c.start - r.duration } : c));
      }
      return { ...t, clips };
    }),
  };
}

export function moveClip(p: Project, clipId: string, newStart: number, newTrackId?: string): Project {
  const found = findClip(p, clipId);
  if (!found) return p;
  const { clip, track } = found;
  if (clip.locked) return p;
  const target = newTrackId ? p.tracks.find((t) => t.id === newTrackId) : track;
  if (!target || target.locked || !clipFitsTrack(target, clip.kind)) return p;
  const start = findFreePosition(target, Math.max(0, newStart), clip.duration, [clipId]);
  let project = removeClips(p, [clipId]);
  project = updateTrack(project, target.id, (t) => ({ ...t, clips: sortClips([...t.clips, { ...clip, start, trackId: t.id }]) }));
  return project;
}

/** Move several clips by a delta keeping relative positions (used for multi-select drags). */
export function moveClips(p: Project, ids: string[], delta: number): Project {
  const clips = ids.map((id) => findClip(p, id)).filter(Boolean) as { clip: Clip; track: Track }[];
  if (!clips.length) return p;
  const minStart = Math.min(...clips.map((c) => c.clip.start));
  const d = Math.max(delta, -minStart);
  let project = p;
  // Validate no collisions with non-moving clips
  for (const { clip, track } of clips) {
    const others = track.clips.filter((c) => !ids.includes(c.id));
    const ns = clip.start + d;
    if (others.some((c) => ns < clipEnd(c) - EPS && ns + clip.duration > c.start + EPS)) return p;
  }
  project = updateClips(project, ids, (c) => ({ ...c, start: c.start + d }));
  return { ...project, tracks: project.tracks.map((t) => ({ ...t, clips: sortClips(t.clips) })) };
}

function sourceDurationFor(clip: Clip, mediaDuration?: number): number | undefined {
  if (clip.kind === 'video' || clip.kind === 'audio') return mediaDuration;
  return undefined;
}

/** Effective source speed (time scale) of a media clip. */
export function effectiveRate(clip: Clip): number {
  if (clip.kind === 'video' || clip.kind === 'audio') {
    if (clip.speed.freezeAt !== undefined) return 0;
    if (clip.speed.curve && clip.speed.curve.length > 1) {
      // average speed from curve
      let sum = 0;
      const n = 32;
      for (let i = 0; i < n; i++) sum += speedAtFraction(clip.speed.curve, (i + 0.5) / n);
      return sum / n;
    }
    return clip.speed.rate;
  }
  return 1;
}

export function speedAtFraction(curve: { t: number; speed: number }[], f: number): number {
  if (!curve.length) return 1;
  if (f <= curve[0].t) return curve[0].speed;
  for (let i = 0; i < curve.length - 1; i++) {
    const a = curve[i], b = curve[i + 1];
    if (f >= a.t && f <= b.t) {
      const t = (f - a.t) / Math.max(1e-6, b.t - a.t);
      const s = t * t * (3 - 2 * t); // smoothstep for smooth ramps
      return a.speed + (b.speed - a.speed) * s;
    }
  }
  return curve[curve.length - 1].speed;
}

/**
 * Map timeline offset (0..duration) to source time offset for a media clip with speed/curve/reverse.
 * Returns seconds into the source relative to mediaIn.
 */
export function timelineToSourceOffset(clip: VideoClip | AudioClip, tl: number): number {
  const sp = clip.speed;
  if (sp.freezeAt !== undefined) return sp.freezeAt - clip.mediaIn;
  const dur = clip.duration;
  let src: number;
  if (sp.curve && sp.curve.length > 1) {
    // integrate speed over timeline time (speed in curve is parameterized over *timeline* fraction)
    const steps = 64;
    const f = Math.min(1, Math.max(0, tl / dur));
    let acc = 0;
    const n = Math.max(1, Math.round(steps * f));
    const dt = (f * dur) / n;
    for (let i = 0; i < n; i++) acc += speedAtFraction(sp.curve, ((i + 0.5) / n) * f) * dt;
    src = acc;
  } else {
    src = tl * sp.rate;
  }
  if (sp.reversed) {
    const total = sourceSpan(clip);
    src = total - src;
  }
  return src;
}

/** Total source seconds covered by the clip. */
export function sourceSpan(clip: VideoClip | AudioClip): number {
  const sp = clip.speed;
  if (sp.freezeAt !== undefined) return 0;
  if (sp.curve && sp.curve.length > 1) {
    const n = 64;
    let acc = 0;
    const dt = clip.duration / n;
    for (let i = 0; i < n; i++) acc += speedAtFraction(sp.curve, (i + 0.5) / n) * dt;
    return acc;
  }
  return clip.duration * sp.rate;
}

export function trimClip(p: Project, clipId: string, edge: 'start' | 'end', newTime: number, mediaDuration?: number): Project {
  const found = findClip(p, clipId);
  if (!found) return p;
  const { clip, track } = found;
  if (clip.locked) return p;
  const minDur = 1 / 60;
  const isMedia = clip.kind === 'video' || clip.kind === 'audio';
  const rate = isMedia ? effectiveRate(clip) || 1 : 1;
  const srcDur = sourceDurationFor(clip, mediaDuration);
  const others = track.clips.filter((c) => c.id !== clipId);
  if (edge === 'start') {
    const prevEnd = Math.max(0, ...others.filter((c) => clipEnd(c) <= clip.start + EPS).map(clipEnd));
    let ns = Math.max(prevEnd, Math.min(newTime, clipEnd(clip) - minDur));
    if (isMedia && !(clip as VideoClip).speed.freezeAt && !(clip as VideoClip).speed.reversed) {
      // cannot extend before source start
      const minStart = clip.start - (clip as VideoClip).mediaIn / rate;
      ns = Math.max(ns, minStart);
    }
    const delta = ns - clip.start;
    return updateClip(p, clipId, (c) => {
      const nc: any = { ...c, start: ns, duration: c.duration - delta };
      if (isMedia && !(c as VideoClip).speed.freezeAt && !(c as VideoClip).speed.reversed) nc.mediaIn = (c as VideoClip).mediaIn + delta * rate;
      return shiftKeyframes(nc, -delta, nc.duration);
    });
  } else {
    const nextStart = Math.min(Infinity, ...others.filter((c) => c.start >= clipEnd(clip) - EPS).map((c) => c.start));
    let ne = Math.min(nextStart, Math.max(newTime, clip.start + minDur));
    if (isMedia && srcDur && !(clip as VideoClip).speed.freezeAt) {
      const maxEnd = clip.start + (srcDur - (clip as VideoClip).mediaIn) / rate;
      ne = Math.min(ne, (clip as VideoClip).speed.reversed ? clip.start + srcDur / rate : maxEnd);
    }
    return updateClip(p, clipId, (c) => ({ ...c, duration: ne - c.start }));
  }
}

export function splitClip(p: Project, clipId: string, time: number): { project: Project; newId: string | null } {
  const found = findClip(p, clipId);
  if (!found) return { project: p, newId: null };
  const { clip } = found;
  if (clip.locked) return { project: p, newId: null };
  const off = time - clip.start;
  if (off <= 1 / 120 || off >= clip.duration - 1 / 120) return { project: p, newId: null };
  const left: any = { ...deepClone(clip), duration: off, transitionOut: null };
  const right: any = { ...deepClone(clip), id: uid('clip'), start: time, duration: clip.duration - off, transitionIn: null };
  if (clip.kind === 'video' || clip.kind === 'audio') {
    const mc = clip as VideoClip;
    if (mc.speed.freezeAt === undefined) {
      if (mc.speed.curve && mc.speed.curve.length > 1) {
        // bake curve into constant rates for each half (keeps media mapping continuous)
        const srcOff = timelineToSourceOffset(mc, off);
        const total = sourceSpan(mc);
        if (mc.speed.reversed) {
          left.speed = { ...mc.speed, curve: undefined, rate: (total - srcOff) / off };
          right.speed = { ...mc.speed, curve: undefined, rate: srcOff / (clip.duration - off) };
          right.mediaIn = mc.mediaIn;
          left.mediaIn = mc.mediaIn + srcOff;
        } else {
          left.speed = { ...mc.speed, curve: undefined, rate: srcOff / off };
          right.speed = { ...mc.speed, curve: undefined, rate: (total - srcOff) / (clip.duration - off) };
          right.mediaIn = mc.mediaIn + srcOff;
        }
      } else if (mc.speed.reversed) {
        const total = sourceSpan(mc);
        const srcOff = off * mc.speed.rate;
        left.mediaIn = mc.mediaIn + (total - srcOff);
        right.mediaIn = mc.mediaIn;
      } else {
        right.mediaIn = mc.mediaIn + off * mc.speed.rate;
      }
    }
  }
  if (clip.kind === 'caption') {
    const cc = clip as any;
    left.words = cc.words.filter((w: any) => w.start < off);
    right.words = cc.words.filter((w: any) => w.end > off).map((w: any) => ({ ...w, start: Math.max(0, w.start - off), end: w.end - off }));
    left.text = left.words.map((w: any) => w.text).join(' ');
    right.text = right.words.map((w: any) => w.text).join(' ');
  }
  const rightShifted = shiftKeyframes(right, -off, right.duration);
  const leftTrimmed = shiftKeyframes(left, 0, left.duration);
  const project = updateTrack(p, clip.trackId, (t) => ({
    ...t,
    clips: sortClips([...t.clips.filter((c) => c.id !== clipId), leftTrimmed, rightShifted]),
  }));
  return { project, newId: right.id };
}

export function duplicateClips(p: Project, ids: string[]): { project: Project; newIds: string[] } {
  let project = p;
  const newIds: string[] = [];
  for (const id of ids) {
    const f = findClip(project, id);
    if (!f) continue;
    const copy: Clip = { ...deepClone(f.clip), id: uid('clip'), start: clipEnd(f.clip), groupId: undefined };
    const res = addClip(project, copy, f.track.id);
    project = res.project;
    newIds.push(res.clip.id);
  }
  return { project, newIds };
}

export function setSpeed(p: Project, clipId: string, rate: number, mediaDuration?: number): Project {
  return updateClip(p, clipId, (c) => {
    if (c.kind !== 'video' && c.kind !== 'audio') return c;
    const old = effectiveRate(c) || 1;
    const span = sourceSpan(c);
    const newDur = span / rate;
    const factor = newDur / c.duration;
    const nc: any = scaleKeyframes({ ...c, speed: { ...c.speed, rate, curve: undefined }, duration: newDur }, factor);
    // Avoid overlapping next clip: clamp
    const track = p.tracks.find((t) => t.id === c.trackId)!;
    const next = track.clips.filter((x) => x.id !== c.id && x.start >= clipEnd(c) - EPS).sort((a, b) => a.start - b.start)[0];
    if (next && nc.start + nc.duration > next.start) nc.duration = next.start - nc.start;
    void old;
    void mediaDuration;
    return nc;
  });
}

export function setSpeedCurve(p: Project, clipId: string, curve: { t: number; speed: number }[] | undefined): Project {
  return updateClip(p, clipId, (c) => {
    if (c.kind !== 'video' && c.kind !== 'audio') return c;
    const span = sourceSpan(c);
    const tmp: any = { ...c, speed: { ...c.speed, curve } };
    // compute new duration so that the source span stays the same
    let avg = 1;
    if (curve && curve.length > 1) {
      let sum = 0;
      const n = 64;
      for (let i = 0; i < n; i++) sum += speedAtFraction(curve, (i + 0.5) / n);
      avg = sum / n;
    } else avg = c.speed.rate;
    const newDur = span / avg;
    tmp.duration = newDur;
    const track = p.tracks.find((t) => t.id === c.trackId)!;
    const next = track.clips.filter((x) => x.id !== c.id && x.start >= clipEnd(c) - EPS).sort((a, b) => a.start - b.start)[0];
    if (next && tmp.start + tmp.duration > next.start) tmp.duration = next.start - tmp.start;
    return tmp;
  });
}

export function toggleReverse(p: Project, clipId: string): Project {
  return updateClip(p, clipId, (c) => (c.kind === 'video' || c.kind === 'audio' ? { ...c, speed: { ...c.speed, reversed: !c.speed.reversed } } : c));
}

/** Insert a freeze-frame clip at time inside a video clip: splits the clip and inserts a frozen copy. */
export function freezeFrame(p: Project, clipId: string, time: number, holdDuration = 2): Project {
  const f = findClip(p, clipId);
  if (!f || f.clip.kind !== 'video') return p;
  const clip = f.clip as VideoClip;
  const srcT = clip.mediaIn + timelineToSourceOffset(clip, time - clip.start);
  const { project: p2, newId } = splitClip(p, clipId, time);
  let project = p2;
  const frozen: VideoClip = { ...deepClone(clip), id: uid('clip'), start: time, duration: holdDuration, speed: { ...clip.speed, freezeAt: srcT, curve: undefined }, transitionIn: null, transitionOut: null, name: `${clip.name} (freeze)` };
  // shift everything after `time` on this track by holdDuration
  project = updateTrack(project, clip.trackId, (t) => ({ ...t, clips: t.clips.map((c) => (c.start >= time - EPS && c.id !== clipId ? { ...c, start: c.start + holdDuration } : c)) }));
  project = updateTrack(project, clip.trackId, (t) => ({ ...t, clips: sortClips([...t.clips, frozen]) }));
  void newId;
  return project;
}

export function detachAudio(p: Project, clipId: string): Project {
  const f = findClip(p, clipId);
  if (!f || f.clip.kind !== 'video') return p;
  const clip = f.clip as VideoClip;
  if (!clip.hasAudio || clip.audioDetached) return p;
  const ac = makeAudioClip({ trackId: '', mediaId: clip.mediaId, name: `${clip.name} (audio)`, start: clip.start, duration: clip.duration, mediaIn: clip.mediaIn });
  ac.speed = { ...clip.speed };
  ac.audio = deepClone(clip.audio);
  let project = updateClip(p, clipId, (c) => ({ ...(c as VideoClip), audioDetached: true }));
  project = addClip(project, ac, null).project;
  return project;
}

export function addTrack(p: Project, kind: TrackKind, index?: number): { project: Project; track: Track } {
  const count = p.tracks.filter((t) => t.kind === kind).length + 1;
  const name = `${kind[0].toUpperCase()}${kind.slice(1)} ${count}`;
  const t = makeTrack(kind, name);
  const tracks = [...p.tracks];
  if (index === undefined) {
    if (kind === 'audio') tracks.push(t);
    else {
      // insert above first track of same kind, else top
      const i = tracks.findIndex((x) => x.kind === kind);
      tracks.splice(i < 0 ? 0 : i, 0, t);
    }
  } else tracks.splice(index, 0, t);
  return { project: { ...p, tracks }, track: t };
}

export function removeTrack(p: Project, trackId: string): Project {
  return { ...p, tracks: p.tracks.filter((t) => t.id !== trackId) };
}

export function moveTrack(p: Project, trackId: string, dir: -1 | 1): Project {
  const i = p.tracks.findIndex((t) => t.id === trackId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= p.tracks.length) return p;
  const tracks = [...p.tracks];
  [tracks[i], tracks[j]] = [tracks[j], tracks[i]];
  return { ...p, tracks };
}

export function setTrackProps(p: Project, trackId: string, props: Partial<Track>): Project {
  return updateTrack(p, trackId, (t) => ({ ...t, ...props }));
}

export function groupClips(p: Project, ids: string[]): Project {
  const gid = uid('grp');
  return updateClips(p, ids, (c) => ({ ...c, groupId: gid }));
}
export function ungroupClips(p: Project, ids: string[]): Project {
  return updateClips(p, ids, (c) => ({ ...c, groupId: undefined }));
}

/** Expand a selection to include all clips in the same groups. */
export function expandGroups(p: Project, ids: string[]): string[] {
  const groups = new Set<string>();
  for (const id of ids) {
    const f = findClip(p, id);
    if (f?.clip.groupId) groups.add(f.clip.groupId);
  }
  if (!groups.size) return ids;
  const out = new Set(ids);
  for (const c of allClips(p)) if (c.groupId && groups.has(c.groupId)) out.add(c.id);
  return [...out];
}

/** Replace media of a video/image/audio clip. */
export function replaceMedia(p: Project, clipId: string, mediaId: string, mediaDuration: number, mediaName: string): Project {
  return updateClip(p, clipId, (c) => {
    if (c.kind === 'video' || c.kind === 'audio') {
      const span = Math.min(sourceSpan(c), mediaDuration);
      const dur = span / (effectiveRate(c) || 1);
      return { ...c, mediaId, mediaIn: 0, duration: Math.min(c.duration, dur) || c.duration, name: mediaName };
    }
    if (c.kind === 'image' || c.kind === 'sticker') return { ...c, mediaId, name: mediaName } as Clip;
    return c;
  });
}

export function clipsInRange(p: Project, t0: number, t1: number): Clip[] {
  return allClips(p).filter((c) => c.start < t1 && clipEnd(c) > t0);
}

export function nextEdge(p: Project, time: number, dir: 1 | -1): number | null {
  const edges = new Set<number>();
  for (const c of allClips(p)) {
    edges.add(c.start);
    edges.add(clipEnd(c));
  }
  for (const m of p.markers) edges.add(m.time);
  const sorted = [...edges].sort((a, b) => a - b);
  if (dir > 0) return sorted.find((e) => e > time + 1e-4) ?? null;
  return [...sorted].reverse().find((e) => e < time - 1e-4) ?? null;
}

/** Remove the gap: move all clips on a track after `time` left to close empty space. */
export function closeGap(p: Project, trackId: string, time: number): Project {
  return updateTrack(p, trackId, (t) => {
    const after = sortClips(t.clips.filter((c) => c.start >= time - EPS));
    if (!after.length) return t;
    const before = t.clips.filter((c) => c.start < time - EPS);
    const prevEnd = Math.max(0, ...before.map(clipEnd));
    const gap = after[0].start - prevEnd;
    if (gap <= EPS) return t;
    return { ...t, clips: sortClips([...before, ...after.map((c) => ({ ...c, start: c.start - gap }))]) };
  });
}
