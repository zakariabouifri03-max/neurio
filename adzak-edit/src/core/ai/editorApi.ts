import type { Clip, Track } from '../types/timeline';
import type { SilenceSegment } from '../audio/chain';
import type { SubtitleCue } from '../types/subtitles';

/**
 * The editor surface the AI executor is allowed to touch.
 *
 * This interface is the *entire* capability set of the agent. It is implemented
 * by the UI store (`ui/store/editorStore.ts`) and injected into the executor —
 * the AI layer imports no store, no filesystem module and no bridge. Anything
 * not declared here is unreachable from a model-generated command.
 */

export interface OperationOutcome {
  ok: boolean;
  error?: string;
  /** Ids created or affected, echoed back to the model. */
  ids?: string[];
  data?: unknown;
}

export interface ClipSummary {
  id: string;
  name: string;
  trackId: string;
  trackName: string;
  kind: Clip['kind'];
  start: number;
  duration: number;
  end: number;
  speed: number;
  reverse: boolean;
  volumeDb: number;
  effects: { effectId: string; enabled: boolean }[];
  /** Name of the source asset, when the clip has one. */
  assetName?: string;
  isOffline: boolean;
}

export interface TrackSummary {
  id: string;
  name: string;
  kind: Track['kind'];
  muted: boolean;
  locked: boolean;
  hidden: boolean;
  clipIds: string[];
}

export interface ProjectSummary {
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  durationSec: number;
  aspectRatio: string;
  assets: { id: string; name: string; kind: string; durationSec: number; isMissing: boolean }[];
  tracks: TrackSummary[];
  clipCount: number;
  selectedClipIds: string[];
  /** Effect ids the local FFmpeg can actually render. */
  availableEffects: string[];
  /** True when a local LLM is reachable. */
  aiAvailable: boolean;
  isOffline: boolean;
}

export interface TimelineSnapshot {
  durationSec: number;
  fps: number;
  tracks: (TrackSummary & { clips: ClipSummary[] })[];
  markers: { id: string; time: number; label: string }[];
}

export interface SilenceOutcome extends OperationOutcome {
  segments?: SilenceSegment[];
  /** Timeline-absolute ranges that would be removed. */
  removals?: { start: number; end: number }[];
  totalRemovedSec?: number;
}

export interface TranscribeOutcome extends OperationOutcome {
  cues?: SubtitleCue[];
  language?: string;
  /** Set when a local model is not installed. */
  needsModel?: boolean;
}

export interface EditorApi {
  /* ---- reads ---- */
  getProjectSummary(): ProjectSummary;
  getTimelineSnapshot(): TimelineSnapshot;
  getSelectedClipIds(): string[];
  getClip(clipId: string): ClipSummary | null;
  searchMedia(query: string): ProjectSummary['assets'];

  /* ---- mutations (all undoable) ---- */
  splitClip(clipId: string, time: number): OperationOutcome;
  trimClip(clipId: string, edge: 'in' | 'out', time: number): OperationOutcome;
  moveClip(clipId: string, start: number, trackId?: string): OperationOutcome;
  deleteClip(clipId: string, ripple: boolean): OperationOutcome;
  addText(text: string, start: number, duration: number, trackId?: string): OperationOutcome;
  addSubtitle(text: string, start: number, end: number, trackId?: string): OperationOutcome;
  changeSpeed(clipId: string, speed: number, keepPitch: boolean): OperationOutcome;
  reverseClip(clipId: string, reverse: boolean): OperationOutcome;
  cropClip(clipId: string, crop: { top: number; right: number; bottom: number; left: number }): OperationOutcome;
  resizeSequence(width: number, height: number): OperationOutcome;
  addTransition(leftClipId: string, rightClipId: string, type: string, duration: number): OperationOutcome;
  addEffect(clipId: string, effectId: string, params?: Record<string, number | boolean | string>): OperationOutcome;
  setVolume(clipId: string, volumeDb: number): OperationOutcome;
  setKeyframe(clipId: string, property: string, time: number, value: number | number[]): OperationOutcome;
  createSequence(name: string, width: number, height: number, fps: number): OperationOutcome;

  /* ---- long-running, always user-gated ---- */
  removeSilence(clipId: string, thresholdDb: number, minSilenceSec: number, dryRun: boolean): Promise<SilenceOutcome>;
  transcribeClip(clipId: string, language?: string): Promise<TranscribeOutcome>;
  queueExport(preset: string, path?: string): OperationOutcome;
}

/** Convert a linear gain to dB for summaries shown to the model. */
export function gainToDb(gain: number): number {
  if (!Number.isFinite(gain) || gain <= 0) return -Infinity;
  return Math.round(20 * Math.log10(gain) * 10) / 10;
}

export function dbToGain(db: number): number {
  return 10 ** (Math.max(-60, Math.min(12, db)) / 20);
}
