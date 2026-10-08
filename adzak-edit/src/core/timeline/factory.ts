import type { Clip, ClipKind, Sequence, Track, TrackKind, Marker } from '../types/timeline';
import type { MediaAsset } from '../types/media';
import {
  defaultAudioSettings,
  defaultProjectSettings,
  defaultTransform,
  defaultTextStyle,
} from '../types/timeline';
import type { ProjectDocument } from '../types/project';
import { ADZAK_FORMAT_VERSION, ADZAK_MAGIC, defaultWorkspace } from '../types/project';
import { snapToRaster } from '../types/time';
import { APP_VERSION } from '../../version';

let counter = 0;
/** Short, sortable, collision-resistant id. No dependency required. */
export function uid(prefix: string): string {
  counter = (counter + 1) % 0xffff;
  const rand =
    typeof globalThis.crypto !== 'undefined' && 'randomUUID' in globalThis.crypto
      ? globalThis.crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${rand}`;
}

export interface CreateClipOptions {
  id?: string;
  name?: string;
  kind?: ClipKind;
  assetId?: string;
  trackId: string;
  start: number;
  duration: number;
  sourceIn?: number;
  sourceOut?: number;
  speed?: number;
  fps?: number;
  text?: Clip['text'];
}

export function createClip(opts: CreateClipOptions): Clip {
  const speed = opts.speed && opts.speed > 0 ? opts.speed : 1;
  const fps = opts.fps ?? 30;
  const duration = Math.max(1 / fps, opts.duration);
  const sourceIn = Math.max(0, opts.sourceIn ?? 0);
  return {
    id: opts.id ?? uid('clip'),
    trackId: opts.trackId,
    kind: opts.kind ?? 'media',
    ...(opts.assetId ? { assetId: opts.assetId } : {}),
    name: opts.name ?? 'Clip',
    timeline: {
      start: snapToRaster(Math.max(0, opts.start), fps),
      duration: snapToRaster(duration, fps),
    },
    source: {
      in: sourceIn,
      // Derive the source span from the timeline span and the rate.
      out: sourceIn + duration * speed,
    },
    speed,
    reverse: false,
    transform: defaultTransform(),
    audio: defaultAudioSettings(),
    effects: [],
    keyframes: {},
    ...(opts.text ? { text: opts.text } : {}),
    createdAt: Date.now(),
  };
}

/** Convenience: a clip that consumes an entire imported asset. */
export function clipFromAsset(
  asset: MediaAsset,
  trackId: string,
  start: number,
  opts: { in?: number; out?: number; fps?: number } = {},
): Clip {
  const fps = opts.fps ?? 30;
  const probe = asset.probe;
  // Images have no intrinsic duration; 4 s is the industry-default still length.
  const duration = probe?.durationSec && probe.durationSec > 0 ? probe.durationSec : 4;
  const sourceIn = Math.max(0, opts.in ?? 0);
  const sourceOut = Math.min(duration, opts.out ?? duration);
  const kind: ClipKind =
    asset.kind === 'audio' ? 'media' : asset.kind === 'image' ? 'media' : 'media';
  return createClip({
    name: asset.name,
    kind,
    assetId: asset.id,
    trackId,
    start,
    duration: (sourceOut - sourceIn) || duration,
    sourceIn,
    sourceOut,
    fps,
  });
}

export function createTextClip(
  trackId: string,
  start: number,
  duration: number,
  text: string,
  fps = 30,
): Clip {
  return createClip({
    kind: 'text',
    name: text.slice(0, 24) || 'Text',
    trackId,
    start,
    duration,
    fps,
    text: { ...defaultTextStyle(), text },
  });
}

export function createTrack(kind: TrackKind, index: number, name?: string): Track {
  return {
    id: uid('trk'),
    kind,
    name: name ?? (kind === 'video' ? `V${index + 1}` : `A${index + 1}`),
    z: index,
    muted: false,
    solo: false,
    locked: false,
    hidden: false,
    heightPx: kind === 'video' ? 84 : 56,
    expanded: true,
    clips: [],
    gain: 1,
  };
}

export function createSequence(settings = defaultProjectSettings()): Sequence {
  const v1 = createTrack('video', 0, 'V1');
  const a1 = createTrack('audio', 0, 'A1');
  return {
    fps: settings.fps,
    width: settings.width,
    height: settings.height,
    backgroundColor: settings.backgroundColor,
    tracks: [v1, a1],
    markers: [],
  };
}

export function createProject(name = 'Untitled Project'): ProjectDocument {
  const settings = defaultProjectSettings();
  return {
    magic: ADZAK_MAGIC,
    version: ADZAK_FORMAT_VERSION,
    appVersion: APP_VERSION,
    id: uid('prj'),
    name,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    settings,
    assets: [],
    sequence: createSequence(settings),
    subtitles: [],
    decisions: [],
    exportSettings: null,
    workspace: defaultWorkspace(),
    migrationsApplied: [],
  };
}

export function createMarker(time: number, label: string, color = '#ffb454'): Marker {
  return { id: uid('mrk'), time, label, color };
}
