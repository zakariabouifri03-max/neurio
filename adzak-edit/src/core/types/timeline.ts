/** What a clip actually is. Keeps one clip type on the timeline while giving
 *  each variant its own payload — the timeline never needs to special-case. */
export type ClipKind = 'media' | 'text' | 'subtitle' | 'solid' | 'adjustment';

export type TrackKind = 'video' | 'audio';

/** Spatial transform applied to a clip at render time (and in the preview). */
export interface Transform {
  /** Normalised centre position; 0,0 = centre of frame. Units: fraction of frame. */
  x: number;
  y: number;
  /** 1 = native fit, 2 = 200 %. */
  scale: number;
  rotationDeg: number;
  opacity: number;
  /** Horizontal / vertical flip. */
  flipX: boolean;
  flipY: boolean;
  /** Crop in normalised source units (0..1). All-zero = no crop. */
  crop: { top: number; right: number; bottom: number; left: number };
}

export const defaultTransform = (): Transform => ({
  x: 0,
  y: 0,
  scale: 1,
  rotationDeg: 0,
  opacity: 1,
  flipX: false,
  flipY: false,
  crop: { top: 0, right: 0, bottom: 0, left: 0 },
});

export interface AudioClipSettings {
  /** Linear gain, 1 = 0 dB. UI shows dB. */
  volume: number;
  pan: number;
  fadeInSec: number;
  fadeOutSec: number;
  /** Non-destructive audio effects (see core/audio/chain.ts). */
  chain: AudioProcessId[];
  /** Detach-from-video marker: audio is muted but the file is untouched. */
  muted: boolean;
}

export type AudioProcessId =
  | 'noise-reduce'
  | 'normalize'
  | 'voice-enhance'
  | 'de-esser'
  | 'eq-broadcast'
  | 'compressor';

export const defaultAudioSettings = (): AudioClipSettings => ({
  volume: 1,
  pan: 0,
  fadeInSec: 0,
  fadeOutSec: 0,
  chain: [],
  muted: false,
});

export interface TextStyle {
  text: string;
  fontFamily: string;
  fontSizePx: number;
  fontWeight: number;
  fontStyle: 'normal' | 'italic';
  color: string;
  align: 'left' | 'center' | 'right';
  lineHeight: number;
  letterSpacing: number;
  uppercase: boolean;
  strokeColor: string;
  strokeWidthPx: number;
  shadow: { enabled: boolean; color: string; blurPx: number; offsetX: number; offsetY: number };
  background: { enabled: boolean; color: string; paddingPx: number; radiusPx: number };
  /** Anchor box in normalised frame units (0..1). null = auto-centre. */
  box: { x: number; y: number; width: number; height: number } | null;
  /** Preset entrance/exit animation, resolved to keyframes by core/timeline/keyframes.ts */
  animation: 'none' | 'fade' | 'slide-up' | 'slide-left' | 'pop' | 'typewriter';
  animationSec: number;
}

export const defaultTextStyle = (): TextStyle => ({
  text: 'Your text',
  fontFamily: 'Inter',
  fontSizePx: 64,
  fontWeight: 700,
  fontStyle: 'normal',
  color: '#ffffff',
  align: 'center',
  lineHeight: 1.2,
  letterSpacing: 0,
  uppercase: false,
  strokeColor: '#000000',
  strokeWidthPx: 0,
  shadow: { enabled: false, color: '#00000099', blurPx: 8, offsetX: 0, offsetY: 4 },
  background: { enabled: false, color: '#000000b3', paddingPx: 16, radiusPx: 8 },
  box: null,
  animation: 'none',
  animationSec: 0.4,
});

/** An instance of an effect with its own parameter values. */
export interface EffectInstance {
  /** Instance id (stable across undo/redo). */
  id: string;
  effectId: string;
  enabled: boolean;
  /** paramId -> value. Values are JSON primitives or [x,y] tuples. */
  params: Record<string, number | boolean | string | number[]>;
  /** Per-parameter keyframe overrides, keyed by paramId. */
  keyframes?: Record<string, import('./keyframes').Keyframe[]>;
}

/**
 * Word-level timing and speaker data carried by an ASR-generated subtitle clip.
 *
 * The words are what make karaoke-style highlight possible and they survive
 * trim/split, because `splitClip` rebases them with the clip.
 */
export interface SubtitleClipMeta {
  words?: import('./subtitles').WordTiming[];
  speaker?: string;
  language?: string;
  /** Confidence of the ASR segment, 0..1, so the UI can flag shaky captions. */
  confidence?: number;
}

/**
 * A clip on the timeline.
 *
 * `source.in` / `source.out` address the *original* media in source seconds and
 * are always clamped to `[0, probe.durationSec]`. Trimming changes them.
 * `timeline.start` / `timeline.duration` address the sequence. Speed links the
 * two: timeline.duration === (source.out - source.in) / speed.
 */
export interface Clip {
  id: string;
  trackId: string;
  kind: ClipKind;
  /** Media clips only. */
  assetId?: string;
  name: string;
  timeline: { start: number; duration: number };
  source: { in: number; out: number };
  /** Playback rate. Negative is invalid — reversal is the `reverse` flag so the
   *  time maths stays monotonic. */
  speed: number;
  reverse: boolean;
  transform: Transform;
  audio: AudioClipSettings;
  effects: EffectInstance[];
  keyframes: Record<string, import('./keyframes').Keyframe[]>;
  /** Text/subtitle payload. */
  text?: TextStyle;
  /** Subtitle-only metadata that has no visual representation. */
  subtitle?: SubtitleClipMeta;
  /** Optional accent colour for the clip block in the timeline UI. */
  color?: string;
  /** Clips sharing a groupId move/trim/delete together (A/V link). */
  groupId?: string;
  /** Freeze frame duration at the clip start, seconds. */
  freezeStartSec?: number;
  /** True when the referenced asset cannot be resolved. */
  isOffline?: boolean;
  createdAt: number;
}

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  /** Render order. Higher = drawn later (on top) for video. */
  z: number;
  muted: boolean;
  solo: boolean;
  locked: boolean;
  hidden: boolean;
  /** UI only, never affects the render. */
  heightPx: number;
  expanded: boolean;
  clips: Clip[];
  /** Per-track master volume (audio) / opacity (video). */
  gain: number;
}

export interface Marker {
  id: string;
  time: number;
  label: string;
  color: string;
  /** Optional span for "chapter" markers. */
  duration?: number;
}

/** Non-destructive edit decision: a range the user asked to remove.
 *  Kept separately so silence removal is always reversible. */
export interface EditDecision {
  id: string;
  /** Clip the decision applies to. */
  clipId: string;
  start: number;
  end: number;
  reason: 'silence' | 'dead-air' | 'manual' | 'ai';
  confidence: number;
  applied: boolean;
  createdAt: number;
}

/** Everything that is NOT project settings or assets. */
export interface Sequence {
  /** Sequence fps is the render raster. */
  fps: number;
  width: number;
  height: number;
  backgroundColor: string;
  tracks: Track[];
  markers: Marker[];
  /** Cached so "total duration" is O(1) for the ruler. */
  durationHint?: number;
}

export interface ProjectSettings {
  width: number;
  height: number;
  fps: number;
  backgroundColor: string;
  sampleRate: number;
  channels: 1 | 2;
  /** Autosave interval, seconds. 0 disables. */
  autosaveSec: number;
  proxy: { enabled: boolean; height: number; codec: 'h264' | 'vp9' };
  /** Render quality defaults for the preview (not the export). */
  preview: { quality: 'draft' | 'balanced' | 'high'; hardwareAccelerated: boolean };
}

export const defaultProjectSettings = (): ProjectSettings => ({
  width: 1920,
  height: 1080,
  fps: 30,
  backgroundColor: '#000000',
  sampleRate: 48000,
  channels: 2,
  autosaveSec: 60,
  proxy: { enabled: false, height: 540, codec: 'h264' },
  preview: { quality: 'balanced', hardwareAccelerated: true },
});
