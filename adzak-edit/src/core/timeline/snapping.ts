import type { Clip, Sequence } from '../types/timeline';
import { endOf, TIME_EPSILON } from '../types/time';

/**
 * Magnetic snapping.
 *
 * The timeline asks for a snapped time on every drag frame, so this must stay
 * cheap: we only ever look at the edges of clips already on screen plus a few
 * structural anchors (playhead, markers, sequence start).
 */

export interface SnapTarget {
  time: number;
  /** What the user is snapping to, for the tooltip. */
  kind: 'clip-start' | 'clip-end' | 'playhead' | 'marker' | 'sequence-start' | 'sequence-end' | 'grid';
  label?: string;
}

export interface SnapOptions {
  /** Snap radius in *pixels* — converted with the current zoom. */
  thresholdPx: number;
  pxPerSec: number;
  enabled: boolean;
  snapToGrid?: boolean;
  gridSec?: number;
}

export interface SnapResult {
  time: number;
  target: SnapTarget | null;
  /** True when the returned time differs from the requested one. */
  snapped: boolean;
}

const DEFAULT_OPTIONS: SnapOptions = { thresholdPx: 8, pxPerSec: 60, enabled: true };

export function collectSnapTargets(
  seq: Sequence,
  playheadSec: number,
  options: { visibleRange?: [number, number]; ignoreClipIds?: string[] } = {},
): SnapTarget[] {
  const ignore = new Set(options.ignoreClipIds ?? []);
  const [viewStart, viewEnd] = options.visibleRange ?? [0, Number.POSITIVE_INFINITY];
  const targets: SnapTarget[] = [
    { time: 0, kind: 'sequence-start' },
    { time: playheadSec, kind: 'playhead' },
  ];
  for (const marker of seq.markers) {
    targets.push({ time: marker.time, kind: 'marker', label: marker.label });
  }
  for (const track of seq.tracks) {
    for (const clip of track.clips) {
      if (ignore.has(clip.id)) continue;
      const start = clip.timeline.start;
      const end = endOf(clip.timeline);
      if (end < viewStart || start > viewEnd) continue;
      targets.push({ time: start, kind: 'clip-start', label: clip.name });
      targets.push({ time: end, kind: 'clip-end', label: clip.name });
    }
  }
  return targets;
}

/** Snap `time` to the nearest target within the pixel threshold. */
export function snapTime(time: number, targets: SnapTarget[], options: Partial<SnapOptions> = {}): SnapResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  if (!opts.enabled || !Number.isFinite(time)) return { time, target: null, snapped: false };
  const thresholdSec = Math.max(TIME_EPSILON, opts.thresholdPx / Math.max(1, opts.pxPerSec));

  let best: SnapTarget | null = null;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const t of targets) {
    const delta = Math.abs(t.time - time);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = t;
    }
  }
  if (opts.snapToGrid && opts.gridSec && opts.gridSec > 0) {
    const grid = Math.round(time / opts.gridSec) * opts.gridSec;
    const delta = Math.abs(grid - time);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = { time: grid, kind: 'grid' };
    }
  }
  if (best && bestDelta <= thresholdSec) {
    return { time: Math.max(0, best.time), target: best, snapped: true };
  }
  return { time: Math.max(0, time), target: null, snapped: false };
}

/** Snap a dragged clip block by its leading edge. */
export function snapBlockStart(
  start: number,
  seq: Sequence,
  playheadSec: number,
  blockIds: string[],
  options: Partial<SnapOptions> = {},
): SnapResult {
  const targets = collectSnapTargets(seq, playheadSec, { ignoreClipIds: blockIds });
  return snapTime(start, targets, options);
}

/** Snap a trim handle. Both edges of the trimmed clip are offered. */
export function snapTrimEdge(
  edgeTime: number,
  seq: Sequence,
  playheadSec: number,
  ignoreClipIds: string[],
  options: Partial<SnapOptions> = {},
): SnapResult {
  const targets = collectSnapTargets(seq, playheadSec, { ignoreClipIds });
  return snapTime(edgeTime, targets, options);
}

/** Ruler tick spacing that stays legible at any zoom. */
export function rulerStepSec(pxPerSec: number): number {
  const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];
  const minPx = 90;
  for (const s of steps) if (s * pxPerSec >= minPx) return s;
  return 7200;
}

/** Clips intersecting the viewport, used for virtualisation. */
export function clipsInViewport(seq: Sequence, startSec: number, endSec: number): Clip[] {
  return seq.tracks
    .flatMap((t) => t.clips)
    .filter((c) => c.timeline.start <= endSec && endOf(c.timeline) >= startSec);
}
