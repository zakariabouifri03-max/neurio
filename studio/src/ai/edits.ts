/**
 * Automatic edit operations built on signal analysis: silence removal / jump cuts, beat markers,
 * beat-synced cuts, smart clip selection (highlights → sequence). All are deterministic DSP — no
 * model downloads needed, which is why they are always available.
 */
import type { Project, VideoClip, AudioClip, Clip } from '@/core/types';
import { useProject, usePlayback, addMarker } from '@/core/store';
import * as cmd from '@/core/commands';
import { getAudioBuffer, getAsset } from '@/engine/MediaManager';
import { detectSilences, detectBeats, type SilenceRange } from './audioAnalysis';
import { detectHighlights, highlightsForClip, type Highlight } from './highlights';
import { toast } from '@/core/uiStore';
import { uid } from '@/core/util';

type MediaClip = VideoClip | AudioClip;
const isMediaClip = (c: Clip): c is MediaClip => c.kind === 'video' || c.kind === 'audio';

export interface SilencePlan {
  clipId: string;
  ranges: { start: number; end: number }[]; // timeline seconds
  removed: number; // seconds total
}

/** Compute (but don't apply) silence ranges for clips, mapped to timeline time. */
export async function planSilenceRemoval(clips: Clip[], opts: { thresholdDb?: number; minSilence?: number; padding?: number; onProgress?: (p: number) => void } = {}): Promise<SilencePlan[]> {
  const plans: SilencePlan[] = [];
  const media = clips.filter(isMediaClip).filter((c) => c.kind === 'audio' || (c as VideoClip).hasAudio !== false);
  let i = 0;
  for (const c of media) {
    const buf = await getAudioBuffer(c.mediaId);
    opts.onProgress?.(++i / Math.max(1, media.length));
    if (!buf) continue;
    const rate = c.speed.rate || 1;
    const srcStart = c.mediaIn, srcEnd = c.mediaIn + c.duration * rate;
    const silences = detectSilences(buf, { thresholdDb: opts.thresholdDb, minSilence: (opts.minSilence ?? 0.4) * rate, padding: opts.padding });
    const ranges = silences
      .map((s: SilenceRange) => ({ start: Math.max(s.start, srcStart), end: Math.min(s.end, srcEnd) }))
      .filter((s) => s.end - s.start > 0.05)
      .map((s) => (c.speed.reversed ? { start: c.start + (srcEnd - s.end) / rate, end: c.start + (srcEnd - s.start) / rate } : { start: c.start + (s.start - srcStart) / rate, end: c.start + (s.end - srcStart) / rate }))
      .sort((a, b) => a.start - b.start);
    plans.push({ clipId: c.id, ranges, removed: ranges.reduce((a, r) => a + (r.end - r.start), 0) });
  }
  return plans;
}

/** Remove the planned ranges: split at both ends, delete the middle, ripple close the gaps (all tracks shift together). */
export function applySilenceRemoval(plans: SilencePlan[], label = 'Remove silences') {
  const st = useProject.getState();
  if (!st.project) return 0;
  let removedCount = 0;
  st.apply(label, (p0) => {
    let p = p0;
    // process from the end of the timeline so earlier ranges keep their times
    const all = plans.flatMap((pl) => pl.ranges.map((r) => ({ ...r, clipId: pl.clipId }))).sort((a, b) => b.start - a.start);
    for (const r of all) {
      // find the clip currently covering r.start on that clip's original track (ids change after split)
      const found = cmd.findClip(p, r.clipId);
      if (!found) continue;
      const cover = found.track.clips.find((c) => c.start <= r.start + 1e-4 && c.start + c.duration >= r.end - 1e-4);
      if (!cover) continue;
      let midId: string | null = cover.id;
      const a = cmd.splitClip(p, cover.id, r.start);
      p = a.project;
      if (a.newId) midId = a.newId;
      const b = cmd.splitClip(p, midId, r.end);
      p = b.project;
      // midId now spans [r.start, r.end] (unless cuts were at clip edges)
      const mid = cmd.findClip(p, midId)?.clip;
      if (!mid) continue;
      const span = Math.min(mid.duration, r.end - r.start);
      p = cmd.removeClips(p, [midId]);
      // ripple every track: shift everything that starts at/after r.end by -span
      p = { ...p, tracks: p.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => (c.start >= r.end - 1e-3 ? { ...c, start: c.start - span } : c)) })), markers: p.markers.map((m) => (m.time >= r.end ? { ...m, time: m.time - span } : m)) };
      removedCount++;
    }
    return p;
  });
  return removedCount;
}

/** Add beat markers for an asset's audio over the clip's span. */
export async function addBeatMarkersForClip(clip: MediaClip, opts: { sensitivity?: number; every?: 1 | 2 | 4 } = {}): Promise<{ count: number; bpm: number } | null> {
  const buf = await getAudioBuffer(clip.mediaId);
  if (!buf) return null;
  const { beats, bpm, confidence } = detectBeats(buf, { sensitivity: opts.sensitivity ?? 1 });
  const rate = clip.speed.rate || 1;
  const every = opts.every ?? 1;
  const times = beats
    .filter((_, i) => i % every === 0)
    .map((b) => clip.start + (b - clip.mediaIn) / rate)
    .filter((t) => t >= clip.start && t <= clip.start + clip.duration);
  if (!times.length) return { count: 0, bpm };
  useProject.getState().apply('Beat markers', (p) => ({ ...p, markers: [...p.markers.filter((m) => !(m.kind === 'beat' && m.time >= clip.start && m.time <= clip.start + clip.duration)), ...times.map((t) => ({ id: uid('mk'), time: Math.round(t * 1000) / 1000, label: '', kind: 'beat' as const, color: '#f472b6' }))].sort((a, b) => a.time - b.time) }));
  void confidence;
  return { count: times.length, bpm: Math.round(bpm) };
}

/** Beat sync: cut the given visual clips so each cut lands on a beat marker (every N beats). */
export function beatSyncClips(clipIds: string[], opts: { everyBeats?: number } = {}) {
  const st = useProject.getState();
  const p0 = st.project;
  if (!p0) return 0;
  const beats = p0.markers.filter((m) => m.kind === 'beat').map((m) => m.time).sort((a, b) => a - b);
  if (beats.length < 2) {
    toast('No beat markers yet', 'info', 'Run "Detect beats" on a music clip first.');
    return 0;
  }
  const every = Math.max(1, opts.everyBeats ?? 2);
  const grid = beats.filter((_, i) => i % every === 0);
  let cuts = 0;
  st.apply('Beat sync', (p) => {
    let proj = p;
    // Sequential ordering: clips sorted by start on their tracks; each clip trimmed to end at next grid beat, following clip moved up.
    for (const id of clipIds) {
      const f = cmd.findClip(proj, id);
      if (!f || f.clip.kind === 'audio') continue;
      const c = f.clip;
      const nextBeat = grid.find((b) => b > c.start + 0.25);
      if (!nextBeat) continue;
      const newDur = Math.min(c.duration, nextBeat - c.start);
      if (newDur < c.duration - 1e-3) {
        const removed = c.duration - newDur;
        proj = cmd.updateClip(proj, id, (x) => ({ ...x, duration: newDur }) as Clip);
        // close the gap for the rest of this track
        proj = { ...proj, tracks: proj.tracks.map((t) => (t.id !== f.track.id ? t : { ...t, clips: t.clips.map((x) => (x.start > c.start ? { ...x, start: x.start - removed } : x)) })) };
        cuts++;
      }
    }
    return proj;
  });
  return cuts;
}

/** Smart clip selection: analyze the clip for highlights and keep only the best windows (ripple delete the rest). */
export async function smartTrimClip(clip: VideoClip, opts: { count?: number; windowSec?: number; onProgress?: (p: number) => void; signal?: { cancelled: boolean } }): Promise<{ kept: Highlight[]; note: string } | null> {
  const res = await detectHighlights(clip.mediaId, { count: opts.count ?? 4, windowSec: opts.windowSec ?? 4, onProgress: opts.onProgress, signal: opts.signal });
  if (!res) return null;
  const tl = highlightsForClip(clip, res.highlights);
  if (!tl.length) return { kept: [], note: res.note };
  // keep ranges → remove everything else inside the clip
  const keep = tl.map((h) => ({ start: h.start, end: h.end })).sort((a, b) => a.start - b.start);
  const remove: { start: number; end: number }[] = [];
  let cursor = clip.start;
  for (const k of keep) {
    if (k.start - cursor > 0.1) remove.push({ start: cursor, end: k.start });
    cursor = Math.max(cursor, k.end);
  }
  if (clip.start + clip.duration - cursor > 0.1) remove.push({ start: cursor, end: clip.start + clip.duration });
  applySilenceRemoval([{ clipId: clip.id, ranges: remove, removed: remove.reduce((a, r) => a + r.end - r.start, 0) }], 'Smart trim');
  return { kept: tl, note: res.note };
}

/** Add markers at highlight positions (non-destructive alternative). */
export function markHighlights(clip: VideoClip, hs: Highlight[]) {
  const tl = highlightsForClip(clip, hs);
  tl.forEach((h, i) => addMarker(h.start, `Highlight ${i + 1} (${Math.round(h.score * 100)}%)`, 'chapter', '#fbbf24'));
  return tl.length;
}

export function currentProjectOrNull(): Project | null {
  return useProject.getState().project;
}
export const playheadTime = () => usePlayback.getState().time;
export const assetOf = (clip: MediaClip) => getAsset(clip.mediaId);
