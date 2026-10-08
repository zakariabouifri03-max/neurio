import { describe, it, expect, beforeEach } from 'vitest';
import { createProject, createClip, createTextClip } from '../../src/core/timeline/factory';
import {
  splitClip,
  trimClip,
  moveClips,
  deleteClips,
  rippleDelete,
  setClipSpeed,
  addTrack,
  setTrackFlag,
  updateClip,
} from '../../src/core/timeline/operations';
import { sequenceDuration, findClip, clipsAtTime, hasGapFor } from '../../src/core/timeline/queries';
import { History } from '../../src/core/timeline/history';
import type { ProjectDocument } from '../../src/core/types/project';
import type { MediaAsset, MediaProbe } from '../../src/core/types/media';
import { endOf } from '../../src/core/types/time';

function probe(duration: number, hasAudio = true): MediaProbe {
  return {
    durationSec: duration,
    format: 'mp4',
    bitrateBps: 1,
    sizeBytes: 1,
    hasVideo: true,
    hasAudio,
    width: 1920,
    height: 1080,
    fps: 30,
    rotation: 0,
    videoCodec: 'h264',
    pixelFormat: 'yuv420p',
    audioCodec: hasAudio ? 'aac' : '',
    sampleRate: 48000,
    channels: 2,
    isProxy: false,
  };
}

function asset(id: string, duration: number): MediaAsset {
  return {
    id,
    name: `${id}.mp4`,
    kind: 'video',
    location: { kind: 'file', path: `/media/${id}.mp4` },
    originalPath: `/media/${id}.mp4`,
    sizeBytes: 1,
    importedAt: 0,
    probe: probe(duration),
    probeState: 'ready',
    isMissing: false,
  };
}

function fixture(): { project: ProjectDocument; trackId: string; clipId: string } {
  const project = createProject('Test');
  const track = project.sequence.tracks[0]!;
  project.assets = [asset('a', 10)];
  const clip = createClip({ name: 'A', assetId: 'a', trackId: track.id, start: 2, duration: 4, fps: 30 });
  track.clips = [clip];
  return { project, trackId: track.id, clipId: clip.id };
}

describe('timeline: split', () => {
  it('splits a clip into two that together cover the original span', () => {
    const { project, clipId } = fixture();
    const result = splitClip(project.sequence, clipId, 4);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const left = findClip(result.sequence, result.data.leftId)!;
    const right = findClip(result.sequence, result.data.rightId)!;
    expect(left.timeline.start).toBeCloseTo(2);
    expect(endOf(left.timeline)).toBeCloseTo(4);
    expect(right.timeline.start).toBeCloseTo(4);
    expect(endOf(right.timeline)).toBeCloseTo(6);
    expect(left.source.out).toBeCloseTo(right.source.in);
    expect(sequenceDuration(result.sequence)).toBeCloseTo(6);
  });

  it('divides the source window at the correct point', () => {
    const { project, clipId } = fixture();
    const result = splitClip(project.sequence, clipId, 4);
    if (!result.ok) throw new Error('split failed');
    const left = findClip(result.sequence, result.data.leftId)!;
    // 2 s of timeline at 1x == 2 s of source.
    expect(left.source.in).toBeCloseTo(0);
    expect(left.source.out).toBeCloseTo(2);
  });

  it('accounts for playback rate when dividing the source', () => {
    const { project, clipId } = fixture();
    const sped = setClipSpeed(project.sequence, clipId, 2);
    if (!sped.ok) throw new Error('speed failed');
    const clip = findClip(sped.sequence, clipId)!;
    const result = splitClip(sped.sequence, clipId, clip.timeline.start + 1);
    if (!result.ok) throw new Error('split failed');
    const left = findClip(result.sequence, result.data.leftId)!;
    // 1 s of timeline at 2x == 2 s of source.
    expect(left.source.out).toBeCloseTo(2);
  });

  it('refuses to split within one frame of an edge', () => {
    const { project, clipId } = fixture();
    const result = splitClip(project.sequence, clipId, 2.01);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('too-short');
  });

  it('refuses to split a clip that does not exist', () => {
    const { project } = fixture();
    const result = splitClip(project.sequence, 'nope', 3);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('clip-not-found');
  });

  it('partitions keyframes across the split', () => {
    const { project, clipId } = fixture();
    const withKeys = updateClip(project.sequence, clipId, {
      keyframes: {
        opacity: [
          { id: 'k1', time: 0, value: 0, interpolation: 'linear' },
          { id: 'k2', time: 1, value: 1, interpolation: 'linear' },
          { id: 'k3', time: 3, value: 0.5, interpolation: 'linear' },
        ],
      },
    });
    if (!withKeys.ok) throw new Error('update failed');
    const result = splitClip(withKeys.sequence, clipId, 4);
    if (!result.ok) throw new Error('split failed');
    const left = findClip(result.sequence, result.data.leftId)!;
    const right = findClip(result.sequence, result.data.rightId)!;
    expect(left.keyframes['opacity']!.length).toBe(2);
    expect(right.keyframes['opacity']!.length).toBe(1);
    // The surviving keyframe is re-based to the new clip's local time.
    expect(right.keyframes['opacity']![0]!.time).toBeCloseTo(1);
  });

  it('does not mutate the input sequence', () => {
    const { project, clipId } = fixture();
    const before = project.sequence.tracks[0]!.clips.length;
    splitClip(project.sequence, clipId, 4);
    expect(project.sequence.tracks[0]!.clips.length).toBe(before);
  });
});

describe('timeline: trim', () => {
  it('trims the out point without moving the start', () => {
    const { project, clipId } = fixture();
    const result = trimClip(project.sequence, clipId, 'out', 5, 10);
    if (!result.ok) throw new Error(result.error.message);
    const clip = findClip(result.sequence, clipId)!;
    expect(clip.timeline.start).toBeCloseTo(2);
    expect(endOf(clip.timeline)).toBeCloseTo(5);
    expect(clip.source.out).toBeCloseTo(3);
  });

  it('trims the in point and keeps the out point anchored', () => {
    const { project, clipId } = fixture();
    const result = trimClip(project.sequence, clipId, 'in', 3, 10);
    if (!result.ok) throw new Error(result.error.message);
    const clip = findClip(result.sequence, clipId)!;
    expect(clip.timeline.start).toBeCloseTo(3);
    expect(endOf(clip.timeline)).toBeCloseTo(6);
    expect(clip.source.in).toBeCloseTo(1);
  });

  it('stops at the start of the source media', () => {
    const { project, clipId } = fixture();
    const result = trimClip(project.sequence, clipId, 'in', 0, 10);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('invalid-range');
  });

  it('clamps an out-trim at the end of the source media instead of failing', () => {
    const { project, clipId } = fixture();
    // Asking for 50 s when the source is only 10 s long: the drag just stops.
    const result = trimClip(project.sequence, clipId, 'out', 50, 10);
    if (!result.ok) throw new Error(result.error.message);
    const clip = findClip(result.sequence, clipId)!;
    expect(clip.source.out).toBeCloseTo(10);
    // The clip now spans the whole 10 s of source at 1x.
    expect(clip.timeline.duration).toBeCloseTo(10);
    expect(endOf(clip.timeline)).toBeCloseTo(12);
  });

  it('clamps a trim that would shorten below the minimum length', () => {
    const { project, clipId } = fixture();
    // In point pushed to just before the out point.
    const result = trimClip(project.sequence, clipId, 'in', 5.99, 10);
    if (!result.ok) throw new Error(result.error.message);
    const clip = findClip(result.sequence, clipId)!;
    expect(clip.timeline.duration).toBeGreaterThanOrEqual(1 / 30);
  });
});

describe('timeline: move', () => {
  it('moves a clip and keeps its duration', () => {
    const { project, clipId } = fixture();
    const result = moveClips(project.sequence, [clipId], { start: 8 });
    if (!result.ok) throw new Error(result.error.message);
    const clip = findClip(result.sequence, clipId)!;
    expect(clip.timeline.start).toBeCloseTo(8);
    expect(clip.timeline.duration).toBeCloseTo(4);
  });

  it('clamps against a neighbouring clip instead of overlapping', () => {
    const { project, trackId, clipId } = fixture();
    const second = createClip({ name: 'B', assetId: 'a', trackId, start: 10, duration: 3, fps: 30 });
    project.sequence.tracks[0]!.clips.push(second);
    const result = moveClips(project.sequence, [clipId], { start: 9 });
    if (!result.ok) throw new Error(result.error.message);
    const moved = findClip(result.sequence, clipId)!;
    expect(hasGapFor(project.sequence.tracks[0]!, moved.timeline.start, moved.timeline.duration, [clipId])).toBe(true);
    expect(endOf(moved.timeline)).toBeLessThanOrEqual(10 + 1e-6);
  });

  it('refuses to move on a locked track', () => {
    const { project, clipId, trackId } = fixture();
    const locked = setTrackFlag(project.sequence, trackId, 'locked', true);
    if (!locked.ok) throw new Error('lock failed');
    const result = moveClips(locked.sequence, [clipId], { start: 8 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('track-locked');
  });

  it('never produces a negative start', () => {
    const { project, clipId } = fixture();
    const result = moveClips(project.sequence, [clipId], { start: -50 });
    if (!result.ok) throw new Error(result.error.message);
    expect(findClip(result.sequence, clipId)!.timeline.start).toBeGreaterThanOrEqual(0);
  });

  it('moves a multi-selection as a block, preserving spacing', () => {
    const { project, trackId, clipId } = fixture();
    const second = createClip({ name: 'B', assetId: 'a', trackId, start: 20, duration: 2, fps: 30 });
    project.sequence.tracks[0]!.clips.push(second);
    const result = moveClips(project.sequence, [clipId, second.id], { start: 30 });
    if (!result.ok) throw new Error(result.error.message);
    const a = findClip(result.sequence, clipId)!;
    const b = findClip(result.sequence, second.id)!;
    expect(a.timeline.start).toBeCloseTo(30);
    // Original gap was 20 - 6 = 14 s.
    expect(b.timeline.start - endOf(a.timeline)).toBeCloseTo(14);
  });

  it('ripple mode pushes later material aside', () => {
    const { project, trackId, clipId } = fixture();
    const second = createClip({ name: 'B', assetId: 'a', trackId, start: 20, duration: 2, fps: 30 });
    project.sequence.tracks[0]!.clips.push(second);
    const result = moveClips(project.sequence, [clipId], { start: 19, ripple: true });
    if (!result.ok) throw new Error(result.error.message);
    const b = findClip(result.sequence, second.id)!;
    expect(b.timeline.start).toBeGreaterThan(20);
  });
});

describe('timeline: delete', () => {
  it('plain delete leaves a gap', () => {
    const { project, trackId, clipId } = fixture();
    const second = createClip({ name: 'B', assetId: 'a', trackId, start: 20, duration: 2, fps: 30 });
    project.sequence.tracks[0]!.clips.push(second);
    const result = deleteClips(project.sequence, [clipId]);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.sequence.tracks[0]!.clips.length).toBe(1);
    expect(findClip(result.sequence, second.id)!.timeline.start).toBeCloseTo(20);
  });

  it('ripple delete closes the gap', () => {
    const { project, trackId, clipId } = fixture();
    const second = createClip({ name: 'B', assetId: 'a', trackId, start: 20, duration: 2, fps: 30 });
    project.sequence.tracks[0]!.clips.push(second);
    const result = rippleDelete(project.sequence, [clipId]);
    if (!result.ok) throw new Error(result.error.message);
    const b = findClip(result.sequence, second.id)!;
    // B started at 20; the removed clip was 4 s long.
    expect(b.timeline.start).toBeCloseTo(16);
  });

  it('ripple delete with two removals shifts by the combined duration', () => {
    const { project, trackId, clipId } = fixture();
    const b = createClip({ name: 'B', assetId: 'a', trackId, start: 20, duration: 2, fps: 30 });
    const c = createClip({ name: 'C', assetId: 'a', trackId, start: 30, duration: 2, fps: 30 });
    project.sequence.tracks[0]!.clips.push(b, c);
    const result = rippleDelete(project.sequence, [clipId, b.id]);
    if (!result.ok) throw new Error(result.error.message);
    const moved = findClip(result.sequence, c.id)!;
    // 4 s + 2 s removed before C.
    expect(moved.timeline.start).toBeCloseTo(24);
  });

  it('cannot delete from a locked track', () => {
    const { project, trackId, clipId } = fixture();
    const locked = setTrackFlag(project.sequence, trackId, 'locked', true);
    if (!locked.ok) throw new Error('lock failed');
    const result = deleteClips(locked.sequence, [clipId]);
    expect(result.ok).toBe(false);
  });
});

describe('timeline: speed', () => {
  it('changing speed keeps the source window and changes the duration', () => {
    const { project, clipId } = fixture();
    const result = setClipSpeed(project.sequence, clipId, 2);
    if (!result.ok) throw new Error(result.error.message);
    const clip = findClip(result.sequence, clipId)!;
    expect(clip.source.out - clip.source.in).toBeCloseTo(4);
    expect(clip.timeline.duration).toBeCloseTo(2);
  });

  it('rejects zero and negative speeds', () => {
    const { project, clipId } = fixture();
    expect(setClipSpeed(project.sequence, clipId, 0).ok).toBe(false);
    expect(setClipSpeed(project.sequence, clipId, -1).ok).toBe(false);
  });

  it('reversal is a flag, so time maths stays monotonic', () => {
    const { project, clipId } = fixture();
    const result = updateClip(project.sequence, clipId, { reverse: true });
    if (!result.ok) throw new Error(result.error.message);
    const clip = findClip(result.sequence, clipId)!;
    expect(clip.speed).toBe(1);
    expect(clip.reverse).toBe(true);
  });
});

describe('timeline: tracks', () => {
  it('adds a video track and a second audio track', () => {
    const { project } = fixture();
    const v = addTrack(project.sequence, 'video');
    if (!v.ok) throw new Error('addTrack failed');
    expect(v.sequence.tracks.filter((t) => t.kind === 'video').length).toBe(2);
    const a = addTrack(v.sequence, 'audio');
    if (!a.ok) throw new Error('addTrack failed');
    expect(a.sequence.tracks.filter((t) => t.kind === 'audio').length).toBe(2);
  });
});

describe('timeline: repeated operations stay frame-exact', () => {
  it('splitting the same clip 40 times leaves no drift', () => {
    const { project, trackId } = fixture();
    project.assets = [asset('a', 100)];
    let sequence = project.sequence;
    const big = createClip({ name: 'A', assetId: 'a', trackId, start: 0, duration: 40, fps: 30 });
    sequence.tracks[0]!.clips = [big];

    // 39 splits of a 40 s clip at 1 s intervals yields exactly 40 clips.
    let targetId = big.id;
    for (let i = 1; i <= 39; i++) {
      const clip = findClip(sequence, targetId)!;
      const result = splitClip(sequence, targetId, clip.timeline.start + 1);
      if (!result.ok) throw new Error(`split ${i} failed: ${result.error.message}`);
      targetId = result.data.rightId;
      sequence = result.sequence;
    }
    expect(sequence.tracks[0]!.clips.length).toBe(40);
    // Every clip is exactly one second, and the last ends exactly at 40.
    for (const clip of sequence.tracks[0]!.clips) {
      expect(clip.timeline.duration).toBeCloseTo(1, 6);
    }
    expect(sequenceDuration(sequence)).toBeCloseTo(40, 6);
  });
});

describe('undo / redo', () => {
  let history: History<number>;
  beforeEach(() => {
    history = new History<number>(0, { coalesceMs: 0 });
  });

  it('undoes and redoes a chain of edits', () => {
    history.push(1, 'one');
    history.push(2, 'two');
    history.push(3, 'three');
    expect(history.value).toBe(3);
    expect(history.undo()).toBe(2);
    expect(history.undo()).toBe(1);
    expect(history.undo()).toBe(0);
    expect(history.undo()).toBeNull();
    expect(history.redo()).toBe(1);
    expect(history.redo()).toBe(2);
    expect(history.value).toBe(2);
  });

  it('a new edit clears the redo stack', () => {
    history.push(1, 'one');
    history.push(2, 'two');
    history.undo();
    history.push(9, 'nine');
    expect(history.canRedo).toBe(false);
    expect(history.value).toBe(9);
  });

  it('coalesces a continuous gesture into one undo step', () => {
    const h = new History<number>(0, { coalesceMs: 60_000 });
    h.pushCoalesced(1, 'drag clip');
    h.pushCoalesced(2, 'drag clip');
    h.pushCoalesced(3, 'drag clip');
    expect(h.value).toBe(3);
    expect(h.undo()).toBe(0);
  });

  it('does not coalesce a different gesture', () => {
    const h = new History<number>(0, { coalesceMs: 60_000 });
    h.pushCoalesced(1, 'drag clip');
    h.pushCoalesced(2, 'trim clip');
    expect(h.undo()).toBe(1);
  });

  it('respects the depth limit', () => {
    const h = new History<number>(0, { limit: 5, coalesceMs: 0 });
    for (let i = 1; i <= 20; i++) h.push(i, `edit ${i}`);
    expect(h.size).toBe(5);
  });

  it('restores a real timeline operation', () => {
    const { project, clipId } = fixture();
    const h = new History(project.sequence, { coalesceMs: 0 });
    const result = splitClip(h.value, clipId, 4);
    if (!result.ok) throw new Error('split failed');
    h.push(result.sequence, 'Split clip');
    expect(h.value.tracks[0]!.clips.length).toBe(2);
    h.undo();
    expect(h.value.tracks[0]!.clips.length).toBe(1);
    h.redo();
    expect(h.value.tracks[0]!.clips.length).toBe(2);
  });
});

describe('timeline: playhead queries', () => {
  it('finds the clips under the playhead', () => {
    const { project } = fixture();
    expect(clipsAtTime(project.sequence, 3).length).toBe(1);
    expect(clipsAtTime(project.sequence, 1).length).toBe(0);
    expect(clipsAtTime(project.sequence, 6).length).toBe(0);
  });
});

describe('timeline: text clips', () => {
  it('creates a text clip with a style', () => {
    const { project, trackId } = fixture();
    const clip = createTextClip(trackId, 1, 3, 'Hello', 30);
    expect(clip.kind).toBe('text');
    expect(clip.text?.text).toBe('Hello');
    expect(clip.timeline.duration).toBeCloseTo(3);
    void project;
  });
});
