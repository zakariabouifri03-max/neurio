import type { Clip, Sequence, Track } from '../types/timeline';
import type { Keyframe } from '../types/keyframes';
import { snapToRaster, endOf, TIME_EPSILON } from '../types/time';
import { clampToFreeGap, conflictsForRange, findClip, findTrack } from './queries';

/**
 * Timeline operations.
 *
 * Every function here is **pure**: it takes a `Sequence` and returns a new one.
 * Nothing mutates in place, which gives us undo/redo for free (the history
 * stack stores whole sequences — cheap because clips are small records and the
 * heavy data — assets, waveforms, thumbnails — lives outside the sequence).
 *
 * Every operation is raster-snapped, so repeated split/trim/move cannot
 * accumulate float drift.
 */

export interface OperationError {
  code:
    | 'clip-not-found'
    | 'track-not-found'
    | 'track-locked'
    | 'invalid-range'
    | 'overlap'
    | 'too-short'
    | 'no-asset';
  message: string;
}

export type OperationResult<T> =
  | { ok: true; sequence: Sequence; data: T }
  | { ok: false; error: OperationError };

const MIN_CLIP_SEC = 1 / 120;

function replaceTrack(seq: Sequence, trackId: string, track: Track): Sequence {
  return { ...seq, tracks: seq.tracks.map((t) => (t.id === trackId ? track : t)) };
}

function replaceClipInTrack(track: Track, clipId: string, clip: Clip): Track {
  return { ...track, clips: track.clips.map((c) => (c.id === clipId ? clip : c)) };
}

function err(code: OperationError['code'], message: string): { ok: false; error: OperationError } {
  return { ok: false, error: { code, message } };
}

/** Minimum clip length on the project raster — never allow zero-length clips. */
function minDuration(fps: number): number {
  return Math.max(MIN_CLIP_SEC, snapToRaster(1 / fps, fps) || 1 / fps);
}

/* ------------------------------------------------------------------ *
 * Split
 * ------------------------------------------------------------------ */

export interface SplitResult {
  leftId: string;
  rightId: string;
}

/**
 * Split a clip at a timeline time. The source range is divided at the exact
 * source frame and the keyframes are partitioned, so nothing is lost.
 */
export function splitClip(
  seq: Sequence,
  clipId: string,
  timelineTime: number,
): OperationResult<SplitResult> {
  const clip = findClip(seq, clipId);
  if (!clip) return err('clip-not-found', `No clip with id "${clipId}".`);
  const track = findTrack(seq, clip.trackId);
  if (!track) return err('track-not-found', `Track for clip "${clipId}" is missing.`);
  if (track.locked) return err('track-locked', `Track "${track.name}" is locked.`);

  const start = clip.timeline.start;
  const end = endOf(clip.timeline);
  const t = snapToRaster(timelineTime, seq.fps);
  const min = minDuration(seq.fps);

  if (t <= start + min - TIME_EPSILON || t >= end - min + TIME_EPSILON) {
    return err('too-short', 'Split point is too close to the clip edge.');
  }

  const localSplit = t - start;
  const sourceSplit = clip.source.in + localSplit * clip.speed;

  const left: Clip = {
    ...clip,
    timeline: { start, duration: snapToRaster(localSplit, seq.fps) },
    source: { in: clip.source.in, out: sourceSplit },
    keyframes: partitionKeyframes(clip.keyframes, localSplit).left,
    effects: clip.effects.map((e) => ({
      ...e,
      keyframes: e.keyframes ? partitionKeyframes(e.keyframes, localSplit).left : undefined,
    })),
  };

  const right: Clip = {
    ...clip,
    id: `${clip.id}~b`,
    timeline: { start: t, duration: snapToRaster(end - t, seq.fps) },
    source: { in: sourceSplit, out: clip.source.out },
    keyframes: partitionKeyframes(clip.keyframes, localSplit).right,
    effects: clip.effects.map((e) => ({
      ...e,
      keyframes: e.keyframes ? partitionKeyframes(e.keyframes, localSplit).right : undefined,
    })),
    // Audio fades belong to the outer edges only.
    audio: { ...clip.audio, fadeInSec: 0 },
    createdAt: Date.now(),
  };
  left.audio = { ...clip.audio, fadeOutSec: 0 };

  const nextTrack: Track = {
    ...track,
    clips: [...track.clips.filter((c) => c.id !== clipId), left, right].sort(
      (a, b) => a.timeline.start - b.timeline.start,
    ),
  };

  return {
    ok: true,
    sequence: replaceTrack(seq, track.id, nextTrack),
    data: { leftId: left.id, rightId: right.id },
  };
}

function partitionKeyframes(
  map: Record<string, Keyframe[]>,
  localSplit: number,
): { left: Record<string, Keyframe[]>; right: Record<string, Keyframe[]> } {
  const left: Record<string, Keyframe[]> = {};
  const right: Record<string, Keyframe[]> = {};
  for (const [prop, keys] of Object.entries(map)) {
    left[prop] = keys.filter((k) => k.time <= localSplit + TIME_EPSILON);
    right[prop] = keys
      .filter((k) => k.time > localSplit + TIME_EPSILON)
      .map((k) => ({ ...k, time: k.time - localSplit }));
  }
  return { left, right };
}

/* ------------------------------------------------------------------ *
 * Trim
 * ------------------------------------------------------------------ */

export type TrimEdge = 'in' | 'out';

export interface TrimResult {
  clipId: string;
  /** The realised start/end after clamping — the UI snaps the handle to it. */
  start: number;
  end: number;
}

/**
 * Trim by dragging an edge.
 *
 * The opposite edge is anchored. The source window slides with the handle, so
 * trimming never re-encodes or touches the original file.
 * `maxSourceDurationSec` should be the asset duration (or Infinity).
 */
export function trimClip(
  seq: Sequence,
  clipId: string,
  edge: TrimEdge,
  newTimelineEdge: number,
  maxSourceDurationSec: number = Number.POSITIVE_INFINITY,
): OperationResult<TrimResult> {
  const clip = findClip(seq, clipId);
  if (!clip) return err('clip-not-found', `No clip with id "${clipId}".`);
  const track = findTrack(seq, clip.trackId);
  if (!track) return err('track-not-found', `Track for clip "${clipId}" is missing.`);
  if (track.locked) return err('track-locked', `Track "${track.name}" is locked.`);

  const fps = seq.fps;
  const min = minDuration(fps);
  const target = snapToRaster(Math.max(0, newTimelineEdge), fps);
  const start = clip.timeline.start;
  const end = endOf(clip.timeline);

  let next: Clip;
  if (edge === 'in') {
    // Moving the in point right shortens the head; left extends it into earlier source.
    const requested = target - start; // +ve = shorten
    const sourceDelta = requested * clip.speed;
    const maxForward = clip.source.out - clip.source.in - min * clip.speed;
    const maxBackward = -clip.source.in;
    const clamped = Math.min(Math.max(sourceDelta, maxBackward), Math.max(0, maxForward));
    const realised = clamped / clip.speed;
    if (Math.abs(realised) < TIME_EPSILON) {
      return err('invalid-range', 'Cannot trim further: the clip has no more source media there.');
    }
    next = {
      ...clip,
      timeline: {
        start: snapToRaster(start + realised, fps),
        duration: snapToRaster(Math.max(min, end - (start + realised)), fps),
      },
      source: { in: Math.max(0, clip.source.in + clamped), out: clip.source.out },
      keyframes: shiftKeyframes(clip.keyframes, -realised),
    };
  } else {
    const requested = target - end; // +ve = lengthen
    const sourceDelta = requested * clip.speed;
    const maxForward = maxSourceDurationSec - clip.source.out;
    const maxBackward = -(clip.source.out - clip.source.in - min * clip.speed);
    const clamped = Math.min(Math.max(sourceDelta, maxBackward), Math.max(0, maxForward));
    const realised = clamped / clip.speed;
    if (Math.abs(realised) < TIME_EPSILON) {
      return err('invalid-range', 'Cannot trim further: the end of the source media was reached.');
    }
    next = {
      ...clip,
      timeline: {
        start,
        duration: snapToRaster(Math.max(min, clip.timeline.duration + realised), fps),
      },
      source: { ...clip.source, out: clip.source.out + clamped },
    };
  }

  // Trimming into a neighbour is not allowed; report it so the UI can show why.
  const others = conflictsForRange(
    track,
    next.timeline.start,
    endOf(next.timeline),
    [clip.id],
  );
  if (others.length) {
    return err('overlap', 'Trim would overlap the neighbouring clip.');
  }

  return {
    ok: true,
    sequence: replaceTrack(seq, clip.trackId, replaceClipInTrack(track, clipId, next)),
    data: { clipId, start: next.timeline.start, end: endOf(next.timeline) },
  };
}

function shiftKeyframes(
  map: Record<string, Keyframe[]>,
  delta: number,
): Record<string, Keyframe[]> {
  const out: Record<string, Keyframe[]> = {};
  for (const [prop, keys] of Object.entries(map)) {
    out[prop] = keys.map((k) => ({ ...k, time: Math.max(0, k.time - delta) }));
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Move
 * ------------------------------------------------------------------ */

export interface MoveResult {
  /** Actual start applied per clip, so the UI can reconcile after clamping. */
  realisedStart: number;
  /** Clips that were nudged out of the way when ripple/push was requested. */
  shiftedIds: string[];
}

export interface MoveOptions {
  /** Absolute desired start for the first clip of the block. */
  start: number;
  /** Destination track; omit to stay on the current track. */
  trackId?: string;
  /** Clamp instead of overlapping. Set false to allow overlap (magnetic off). */
  preventOverlap?: boolean;
  /** Push later clips on the destination track aside instead of clamping. */
  ripple?: boolean;
}

/**
 * Move one or many clips as a block. The block keeps its internal spacing.
 */
export function moveClips(
  seq: Sequence,
  clipIds: string[],
  options: MoveOptions,
): OperationResult<MoveResult> {
  const ids = new Set(clipIds);
  if (ids.size === 0) return err('clip-not-found', 'Nothing selected to move.');
  const block = seq.tracks.flatMap((t) => t.clips).filter((c) => ids.has(c.id));
  if (!block.length) return err('clip-not-found', 'Selected clips are not on the timeline.');

  const anchorTrack = findTrack(seq, block[0]!.trackId);
  if (!anchorTrack) return err('track-not-found', 'Source track is missing.');
  if (anchorTrack.locked) return err('track-locked', `Track "${anchorTrack.name}" is locked.`);

  const destTrackId = options.trackId ?? block[0]!.trackId;
  const destTrack = findTrack(seq, destTrackId);
  if (!destTrack) return err('track-not-found', 'Destination track is missing.');
  if (destTrack.locked) return err('track-locked', `Track "${destTrack.name}" is locked.`);

  const blockStart = Math.min(...block.map((c) => c.timeline.start));
  const blockEnd = Math.max(...block.map((c) => endOf(c.timeline)));
  const blockDuration = blockEnd - blockStart;
  const fps = seq.fps;

  let targetStart = snapToRaster(Math.max(0, options.start), fps);

  if (options.preventOverlap !== false && !options.ripple) {
    targetStart = clampToFreeGap(
      destTrack,
      targetStart,
      blockDuration,
      [...ids],
    );
  } else if (targetStart < 0) {
    targetStart = 0;
  }

  const delta = targetStart - blockStart;
  const shifted: string[] = [];

  // 1. Detach the block from its current tracks.
  let nextTracks = seq.tracks.map((t) => ({
    ...t,
    clips: t.clips.filter((c) => !ids.has(c.id)),
  }));

  // 2. Optionally ripple the destination track: push everything after aside.
  if (options.ripple) {
    nextTracks = nextTracks.map((t) => {
      if (t.id !== destTrack.id) return t;
      const cut = targetStart;
      const pushed = t.clips
        .filter((c) => endOf(c.timeline) > cut + TIME_EPSILON)
        .sort((a, b) => a.timeline.start - b.timeline.start);
      if (!pushed.length) return t;
      const firstPushed = pushed[0]!;
      const gapNeeded = Math.max(0, cut + blockDuration - firstPushed.timeline.start);
      if (gapNeeded <= TIME_EPSILON) return t;
      for (const p of pushed) shifted.push(p.id);
      return {
        ...t,
        clips: t.clips.map((c) =>
          endOf(c.timeline) > cut + TIME_EPSILON && !ids.has(c.id)
            ? { ...c, timeline: { ...c.timeline, start: snapToRaster(c.timeline.start + gapNeeded, fps) } }
            : c,
        ),
      };
    });
  }

  // 3. Re-insert the block at its new position.
  const moved = block.map((c) => ({
    ...c,
    trackId: destTrack.id,
    timeline: {
      ...c.timeline,
      start: snapToRaster(c.timeline.start + delta, fps),
    },
  }));

  nextTracks = nextTracks.map((t) =>
    t.id === destTrack.id
      ? {
          ...t,
          clips: [...t.clips, ...moved].sort((a, b) => a.timeline.start - b.timeline.start),
        }
      : t,
  );

  return {
    ok: true,
    sequence: { ...seq, tracks: nextTracks },
    data: { realisedStart: targetStart, shiftedIds: shifted },
  };
}

/* ------------------------------------------------------------------ *
 * Delete
 * ------------------------------------------------------------------ */

export interface DeleteResult {
  deletedIds: string[];
  /** Kept so "undo" can restore exact positions. */
  removed: { trackId: string; clip: Clip }[];
}

/** Plain delete leaves a gap. */
export function deleteClips(
  seq: Sequence,
  clipIds: string[],
): OperationResult<DeleteResult> {
  const ids = new Set(clipIds);
  const removed: { trackId: string; clip: Clip }[] = [];
  for (const track of seq.tracks) {
    if (track.locked) continue;
    for (const c of track.clips) if (ids.has(c.id)) removed.push({ trackId: track.id, clip: c });
  }
  if (!removed.length) return err('clip-not-found', 'Nothing selected to delete.');

  const nextTracks = seq.tracks.map((t) =>
    t.locked ? t : { ...t, clips: t.clips.filter((c) => !ids.has(c.id)) },
  );
  return {
    ok: true,
    sequence: { ...seq, tracks: nextTracks },
    data: { deletedIds: [...ids], removed },
  };
}

/**
 * Ripple delete: remove the clips and close the gap on every track, shifting
 * only the material that came after the earliest removal on that track.
 */
export function rippleDelete(
  seq: Sequence,
  clipIds: string[],
): OperationResult<DeleteResult> {
  const base = deleteClips(seq, clipIds);
  if (!base.ok) return base;
  const { removed } = base.data;
  const ids = new Set(clipIds);
  const fps = seq.fps;

  const byTrack = new Map<string, Clip[]>();
  for (const r of removed) {
    const list = byTrack.get(r.trackId) ?? [];
    list.push(r.clip);
    byTrack.set(r.trackId, list);
  }

  const nextTracks = base.sequence.tracks.map((track) => {
    const removedOnTrack = (byTrack.get(track.id) ?? []).sort(
      (a, b) => a.timeline.start - b.timeline.start,
    );
    if (!removedOnTrack.length) return track;
    // Every surviving clip shifts left by the total removed duration that sat
    // before it. That is the classic per-track ripple.
    const clips = track.clips
      .filter((c) => !ids.has(c.id))
      .map((c) => {
        let shift = 0;
        for (const r of removedOnTrack) {
          if (r.timeline.start <= c.timeline.start + TIME_EPSILON) shift += r.timeline.duration;
        }
        if (shift <= TIME_EPSILON) return c;
        return {
          ...c,
          timeline: {
            ...c.timeline,
            start: snapToRaster(Math.max(0, c.timeline.start - shift), fps),
          },
        };
      });
    return { ...track, clips };
  });

  return {
    ok: true,
    sequence: { ...base.sequence, tracks: nextTracks },
    data: base.data,
  };
}

/* ------------------------------------------------------------------ *
 * Clip property updates
 * ------------------------------------------------------------------ */

export function updateClip(
  seq: Sequence,
  clipId: string,
  patch: Partial<Clip>,
): OperationResult<{ clipId: string }> {
  const clip = findClip(seq, clipId);
  if (!clip) return err('clip-not-found', `No clip with id "${clipId}".`);
  const track = findTrack(seq, clip.trackId);
  if (!track) return err('track-not-found', 'Track is missing.');
  if (track.locked) return err('track-locked', `Track "${track.name}" is locked.`);
  const next = { ...clip, ...patch, id: clip.id, trackId: clip.trackId };
  return {
    ok: true,
    sequence: replaceTrack(seq, track.id, replaceClipInTrack(track, clipId, next)),
    data: { clipId },
  };
}

/** Change playback rate while keeping the clip's *source window* fixed.
 *  The timeline duration follows the rate, which is what users expect when
 *  they set 200% on a clip they have already trimmed. */
export function setClipSpeed(
  seq: Sequence,
  clipId: string,
  speed: number,
): OperationResult<{ clipId: string; speed: number; duration: number }> {
  if (!Number.isFinite(speed) || speed <= 0) {
    return err('invalid-range', 'Speed must be a positive number.');
  }
  if (speed > 100) return err('invalid-range', 'Speed above 100x is not supported.');
  const clip = findClip(seq, clipId);
  if (!clip) return err('clip-not-found', `No clip with id "${clipId}".`);
  const track = findTrack(seq, clip.trackId);
  if (!track) return err('track-not-found', 'Track is missing.');
  if (track.locked) return err('track-locked', `Track "${track.name}" is locked.`);

  const sourceSpan = clip.source.out - clip.source.in;
  const duration = snapToRaster(Math.max(minDuration(seq.fps), sourceSpan / speed), seq.fps);
  const next: Clip = { ...clip, speed, timeline: { ...clip.timeline, duration } };
  return {
    ok: true,
    sequence: replaceTrack(seq, track.id, replaceClipInTrack(track, clipId, next)),
    data: { clipId, speed, duration },
  };
}

/* ------------------------------------------------------------------ *
 * Tracks
 * ------------------------------------------------------------------ */

export function addTrack(
  seq: Sequence,
  kind: Track['kind'],
  name?: string,
): OperationResult<{ trackId: string }> {
  const existing = seq.tracks.filter((t) => t.kind === kind).length;
  const id = `trk_${kind}_${existing}_${Math.random().toString(36).slice(2, 8)}`;
  const track: Track = {
    id,
    kind,
    name: name ?? (kind === 'video' ? `V${existing + 1}` : `A${existing + 1}`),
    z: existing,
    muted: false,
    solo: false,
    locked: false,
    hidden: false,
    heightPx: kind === 'video' ? 84 : 56,
    expanded: true,
    clips: [],
    gain: 1,
  };
  // Video tracks stack upwards: the new one goes on top of the video stack.
  const tracks =
    kind === 'video'
      ? [...seq.tracks, track]
      : [...seq.tracks.filter((t) => t.kind === 'video'), track, ...seq.tracks.filter((t) => t.kind === 'audio')];
  return { ok: true, sequence: { ...seq, tracks }, data: { trackId: id } };
}

export function removeTrack(seq: Sequence, trackId: string): OperationResult<{ trackId: string }> {
  const track = findTrack(seq, trackId);
  if (!track) return err('track-not-found', `No track "${trackId}".`);
  if (track.locked) return err('track-locked', `Track "${track.name}" is locked.`);
  return {
    ok: true,
    sequence: { ...seq, tracks: seq.tracks.filter((t) => t.id !== trackId) },
    data: { trackId },
  };
}

export type TrackFlag = 'muted' | 'solo' | 'locked' | 'hidden';

export function setTrackFlag(
  seq: Sequence,
  trackId: string,
  flag: TrackFlag,
  value: boolean,
): OperationResult<{ trackId: string; flag: TrackFlag; value: boolean }> {
  const track = findTrack(seq, trackId);
  if (!track) return err('track-not-found', `No track "${trackId}".`);
  return {
    ok: true,
    sequence: replaceTrack(seq, trackId, { ...track, [flag]: value }),
    data: { trackId, flag, value },
  };
}

/* ------------------------------------------------------------------ *
 * Markers
 * ------------------------------------------------------------------ */

export function addMarker(
  seq: Sequence,
  time: number,
  label: string,
  color = '#ffb454',
): OperationResult<{ markerId: string }> {
  const id = `mrk_${Math.random().toString(36).slice(2, 10)}`;
  return {
    ok: true,
    sequence: { ...seq, markers: [...seq.markers, { id, time: snapToRaster(time, seq.fps), label, color }] },
    data: { markerId: id },
  };
}

export function removeMarker(seq: Sequence, markerId: string): OperationResult<{ markerId: string }> {
  return {
    ok: true,
    sequence: { ...seq, markers: seq.markers.filter((m) => m.id !== markerId) },
    data: { markerId },
  };
}
