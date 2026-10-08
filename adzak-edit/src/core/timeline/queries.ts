import type { Clip, Sequence, Track } from '../types/timeline';
import { endOf, timeEq, TIME_EPSILON } from '../types/time';

/* ------------------------------------------------------------------ *
 * Lookups
 * ------------------------------------------------------------------ */

export function findClip(seq: Sequence, clipId: string): Clip | undefined {
  for (const track of seq.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return clip;
  }
  return undefined;
}

export function findTrackOf(seq: Sequence, clipId: string): Track | undefined {
  return seq.tracks.find((t) => t.clips.some((c) => c.id === clipId));
}

export function findTrack(seq: Sequence, trackId: string): Track | undefined {
  return seq.tracks.find((t) => t.id === trackId);
}

export function allClips(seq: Sequence): Clip[] {
  return seq.tracks.flatMap((t) => t.clips);
}

export function clipsOfKind(seq: Sequence, kind: Clip['kind']): Clip[] {
  return allClips(seq).filter((c) => c.kind === kind);
}

/* ------------------------------------------------------------------ *
 * Geometry
 * ------------------------------------------------------------------ */

/** Timeline duration = the farthest clip end (markers included). */
export function sequenceDuration(seq: Sequence): number {
  let max = 0;
  for (const track of seq.tracks) {
    for (const clip of track.clips) max = Math.max(max, endOf(clip.timeline));
  }
  for (const marker of seq.markers) {
    max = Math.max(max, marker.time + (marker.duration ?? 0));
  }
  return max;
}

export function trackDuration(track: Track): number {
  return track.clips.reduce((m, c) => Math.max(m, endOf(c.timeline)), 0);
}

/** Clips overlapping a time range on one track, sorted by start. */
export function clipsInRange(track: Track, start: number, end: number): Clip[] {
  return track.clips
    .filter((c) => c.timeline.start < end - TIME_EPSILON && endOf(c.timeline) > start + TIME_EPSILON)
    .sort((a, b) => a.timeline.start - b.timeline.start);
}

export function clipAtTime(track: Track, time: number): Clip | undefined {
  return track.clips.find(
    (c) => c.timeline.start <= time + TIME_EPSILON && endOf(c.timeline) > time + TIME_EPSILON,
  );
}

/** Every clip under the playhead across all tracks. */
export function clipsAtTime(seq: Sequence, time: number): Clip[] {
  return seq.tracks
    .flatMap((t) => t.clips)
    .filter((c) => c.timeline.start <= time + TIME_EPSILON && endOf(c.timeline) > time + TIME_EPSILON);
}

/** Clips whose pixels are needed to draw `[viewStart, viewEnd]`.
 *  The timeline calls this to virtualise rendering of large sequences. */
export function visibleClips(seq: Sequence, viewStart: number, viewEnd: number): Clip[] {
  return allClips(seq).filter(
    (c) => c.timeline.start < viewEnd && endOf(c.timeline) > viewStart,
  );
}

/* ------------------------------------------------------------------ *
 * Overlap / placement
 * ------------------------------------------------------------------ */

export interface PlacementConflict {
  clipId: string;
  overlapStart: number;
  overlapEnd: number;
}

/** Clips on `track` that a clip occupying [start, end] would collide with. */
export function conflictsForRange(
  track: Track,
  start: number,
  end: number,
  ignoreIds: string[] = [],
): PlacementConflict[] {
  const ignore = new Set(ignoreIds);
  const out: PlacementConflict[] = [];
  for (const c of track.clips) {
    if (ignore.has(c.id)) continue;
    const cEnd = endOf(c.timeline);
    if (c.timeline.start < end - TIME_EPSILON && start < cEnd - TIME_EPSILON) {
      out.push({
        clipId: c.id,
        overlapStart: Math.max(start, c.timeline.start),
        overlapEnd: Math.min(end, cEnd),
      });
    }
  }
  return out;
}

export function hasGapFor(
  track: Track,
  start: number,
  duration: number,
  ignoreIds: string[] = [],
): boolean {
  return conflictsForRange(track, start, start + duration, ignoreIds).length === 0;
}

/**
 * Clamp a desired start so the moved block does not overlap neighbours.
 * `blockIds` move together (multi-selection), so they are excluded from the test.
 *
 * Strategy: enumerate the gaps around every neighbour, keep the ones that
 * actually fit, and take whichever is closest to where the user aimed. Guessing
 * the drag direction from the neighbour's position gets it wrong whenever a
 * clip is dragged rightwards into a clip that starts later.
 */
export function clampToFreeGap(
  track: Track,
  desiredStart: number,
  blockDuration: number,
  blockIds: string[],
): number {
  const ignore = new Set(blockIds);
  const start = Math.max(0, desiredStart);
  if (conflictsForRange(track, start, start + blockDuration, blockIds).length === 0) {
    return start;
  }

  const candidates = new Set<number>([0]);
  for (const c of track.clips) {
    if (ignore.has(c.id)) continue;
    candidates.add(Math.max(0, c.timeline.start - blockDuration)); // just before
    candidates.add(endOf(c.timeline)); // just after
  }

  let best: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    if (conflictsForRange(track, candidate, candidate + blockDuration, blockIds).length) continue;
    const distance = Math.abs(candidate - start);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  if (best !== null) return best;

  // Nothing fits anywhere: append after the last clip rather than overlapping.
  return track.clips.reduce((acc, c) => Math.max(acc, endOf(c.timeline)), 0);
}

/** Nearest gap-free start at or after `start` (used by "append to end"). */
export function firstFreeStart(track: Track, duration: number): number {
  const sorted = [...track.clips].sort((a, b) => a.timeline.start - b.timeline.start);
  if (!sorted.length) return 0;
  let cursor = 0;
  for (const c of sorted) {
    if (c.timeline.start - cursor >= duration - TIME_EPSILON) return cursor;
    cursor = Math.max(cursor, endOf(c.timeline));
  }
  return cursor;
}

/** Two clips are adjacent when they touch within a frame. */
export function areAdjacent(a: Clip, b: Clip): boolean {
  return timeEq(endOf(a.timeline), b.timeline.start) || timeEq(endOf(b.timeline), a.timeline.start);
}

/* ------------------------------------------------------------------ *
 * Track helpers
 * ------------------------------------------------------------------ */

export function effectiveTrackGain(track: Track): number {
  return track.muted ? 0 : track.gain;
}

/** Solo semantics: if any track is solo, non-solo tracks are silent/invisible. */
export function isTrackAudible(track: Track, all: Track[]): boolean {
  if (track.muted) return false;
  const anySolo = all.some((t) => t.solo);
  return anySolo ? track.solo : true;
}

export function isTrackRendered(track: Track, all: Track[]): boolean {
  if (track.hidden) return false;
  const anySolo = all.some((t) => t.solo);
  return anySolo ? track.solo : true;
}

export function videoTracks(seq: Sequence): Track[] {
  return [...seq.tracks].filter((t) => t.kind === 'video').sort((a, b) => a.z - b.z);
}

export function audioTracks(seq: Sequence): Track[] {
  return [...seq.tracks].filter((t) => t.kind === 'audio').sort((a, b) => a.z - b.z);
}

/** Clip-local time (seconds from clip start) for a timeline time, or null. */
export function toClipLocalTime(clip: Clip, timelineTime: number): number | null {
  const start = clip.timeline.start;
  const end = endOf(clip.timeline);
  if (timelineTime < start - TIME_EPSILON || timelineTime > end + TIME_EPSILON) return null;
  return Math.max(0, timelineTime - start);
}

/** Source time for a timeline time, honouring rate and reversal. */
export function toSourceTime(clip: Clip, timelineTime: number): number | null {
  const local = toClipLocalTime(clip, timelineTime);
  if (local === null) return null;
  const span = clip.timeline.duration;
  const progress = clip.reverse && span > 0 ? (span - local) / span : span > 0 ? local / span : 0;
  const sourceSpan = clip.source.out - clip.source.in;
  return clip.source.in + progress * sourceSpan;
}
