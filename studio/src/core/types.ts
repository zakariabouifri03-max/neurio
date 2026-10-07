/**
 * Neurio Studio — core project data model.
 *
 * All times are in SECONDS (floating point). Frame-accurate positions are derived from
 * `project.settings.fps` using the helpers in `time.ts`.
 *
 * Every animatable property is an `Animated<T>` so the keyframe engine can treat
 * transforms, adjustments, effect parameters, masks, text and audio uniformly.
 */

export type EasingName =
  | 'linear'
  | 'easeIn'
  | 'easeOut'
  | 'easeInOut'
  | 'easeInCubic'
  | 'easeOutCubic'
  | 'easeInOutCubic'
  | 'easeOutBack'
  | 'easeOutBounce'
  | 'easeOutElastic'
  | 'hold';

/** Either a named easing or a custom cubic-bezier (x1,y1,x2,y2). */
export type Easing = EasingName | [number, number, number, number];

export interface Keyframe<T = number> {
  id: string;
  /** Time relative to the clip start, in seconds (timeline time, after speed). */
  time: number;
  value: T;
  /** Easing applied from this keyframe to the next one. */
  easing: Easing;
}

export interface Animated<T = number> {
  value: T;
  keyframes?: Keyframe<T>[];
}

export type Vec2 = { x: number; y: number };
export type RGBA = { r: number; g: number; b: number; a: number };

export type TrackKind = 'video' | 'audio' | 'text' | 'sticker' | 'overlay' | 'image';
export type ClipKind = 'video' | 'image' | 'audio' | 'text' | 'sticker' | 'caption' | 'color';

export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'add'
  | 'darken'
  | 'lighten'
  | 'difference'
  | 'softlight'
  | 'hardlight';

export interface Transform {
  position: Animated<Vec2>; // in project pixels, relative to center
  scale: Animated<Vec2>; // 1 = fit
  rotation: Animated<number>; // degrees
  opacity: Animated<number>; // 0..1
  anchor: Vec2; // -0.5..0.5 relative
}

export interface Crop {
  left: number;
  top: number;
  right: number;
  bottom: number;
} // 0..1 fractions

export type AdjustmentKey =
  | 'brightness'
  | 'contrast'
  | 'saturation'
  | 'exposure'
  | 'highlights'
  | 'shadows'
  | 'temperature'
  | 'tint'
  | 'sharpness'
  | 'clarity'
  | 'vibrance'
  | 'fade'
  | 'vignette'
  | 'grain'
  | 'whites'
  | 'blacks';

export type Adjustments = Partial<Record<AdjustmentKey, Animated<number>>>;

export interface HSLBand {
  hue: number; // -100..100
  saturation: number;
  luminance: number;
}
export type HSLKey = 'red' | 'orange' | 'yellow' | 'green' | 'aqua' | 'blue' | 'purple' | 'magenta';
export type HSL = Record<HSLKey, HSLBand>;

/** Curve point (x,y) in 0..1 space. */
export type CurvePoint = { x: number; y: number };
export interface Curves {
  master: CurvePoint[];
  red: CurvePoint[];
  green: CurvePoint[];
  blue: CurvePoint[];
}

export interface ColorWheel {
  /** hue shift of the wheel offset, -1..1 for each of r,g,b */
  r: number;
  g: number;
  b: number;
  /** luminance offset */
  lum: number;
}
export interface ColorWheels {
  shadows: ColorWheel;
  midtones: ColorWheel;
  highlights: ColorWheel;
}

export interface ColorGrade {
  adjustments: Adjustments;
  hsl?: HSL;
  curves?: Curves;
  wheels?: ColorWheels;
  lutId?: string;
  lutIntensity?: number;
  whiteBalance?: { temperature: number; tint: number; auto?: boolean };
}

export interface EffectInstance {
  id: string;
  type: string; // key in effect registry
  enabled: boolean;
  params: Record<string, Animated<number>>;
}

export type MaskShape = 'rectangle' | 'circle' | 'linear' | 'freehand' | 'star' | 'heart' | 'triangle' | 'hexagon';
export interface Mask {
  shape: MaskShape;
  enabled: boolean;
  center: Animated<Vec2>; // -0.5..0.5 of frame
  size: Animated<Vec2>; // 0..1 of frame
  rotation: Animated<number>;
  feather: Animated<number>; // 0..1
  opacity: Animated<number>;
  roundness: Animated<number>; // rectangle corner radius 0..1
  invert: boolean;
  /** Freehand / custom polygon points, normalized -0.5..0.5 */
  points?: Vec2[];
}

export interface ChromaKey {
  enabled: boolean;
  color: { r: number; g: number; b: number }; // 0..1
  strength: Animated<number>; // similarity 0..1
  smoothness: Animated<number>;
  spill: Animated<number>;
  edgeSoftness: Animated<number>;
  shadowPreservation: Animated<number>;
}

export interface TransitionInstance {
  type: string;
  duration: number; // seconds
  params: Record<string, number>;
}

export type SpeedCurvePoint = { t: number; speed: number }; // t 0..1 source fraction
export interface Speed {
  rate: number; // 0.1..10
  curve?: SpeedCurvePoint[]; // when set overrides rate
  reversed: boolean;
  /** Freeze frame at source time (seconds) — clip shows that frame for its duration. */
  freezeAt?: number;
  preservePitch: boolean;
}

export interface AudioEQ {
  low: number; // dB -24..24 (bass)
  mid: number;
  high: number; // treble
  bands?: number[]; // 10-band graphic eq in dB
}
export interface AudioFX {
  volume: Animated<number>; // 0..4 (1 = unity)
  fadeIn: number;
  fadeOut: number;
  pitch: number; // semitones -12..12
  eq: AudioEQ;
  noiseReduction: number; // 0..1
  voiceEnhance: number; // 0..1
  compressor: { enabled: boolean; threshold: number; ratio: number; attack: number; release: number; makeup: number };
  reverb: { enabled: boolean; mix: number; size: number; decay: number };
  echo: { enabled: boolean; time: number; feedback: number; mix: number };
  pan: number; // -1..1
  stereoWidth: number; // 0..2
  normalize: boolean;
  ducking: { enabled: boolean; amount: number; threshold: number; attack: number; release: number };
}

export interface Stabilization {
  enabled: boolean;
  level: 0 | 1 | 2 | 3; // off, low, medium, high
  cropZoom: number;
  /** Per frame offsets computed by the analyzer (dx, dy in px of source), indexed by source frame. */
  analysis?: { fps: number; offsets: number[]; smoothed: number[] };
}

export interface TextShadow {
  color: string;
  blur: number;
  x: number;
  y: number;
}
export interface TextStyle {
  fontFamily: string;
  fontSize: number; // project pixels
  fontWeight: number;
  italic: boolean;
  letterSpacing: number; // px
  lineHeight: number; // multiplier
  align: 'left' | 'center' | 'right';
  color: string;
  gradient?: { from: string; to: string; angle: number } | null;
  outline: { color: string; width: number } | null;
  shadow: TextShadow | null;
  glow: { color: string; blur: number } | null;
  background: { color: string; padding: number; radius: number } | null;
  uppercase: boolean;
  underline: boolean;
  maxWidth: number; // fraction of project width 0..1
}

export type TextAnimUnit = 'block' | 'word' | 'char' | 'line';
export interface TextAnimation {
  in: { type: string; duration: number; unit: TextAnimUnit; stagger: number };
  out: { type: string; duration: number; unit: TextAnimUnit; stagger: number };
  loop: { type: string; speed: number; intensity: number } | null;
}

export interface CaptionWord {
  text: string;
  start: number; // relative to clip start
  end: number;
}
export interface CaptionStyle {
  highlightColor: string;
  highlightBackground: string | null;
  highlightScale: number;
  mode: 'word' | 'karaoke' | 'box' | 'none';
  wordsPerLine: number;
}

export interface ClipBase {
  id: string;
  trackId: string;
  kind: ClipKind;
  name: string;
  start: number; // timeline seconds
  duration: number; // timeline seconds
  locked: boolean;
  groupId?: string;
  color?: string;
}

export interface VisualClipProps {
  transform: Transform;
  crop: Crop;
  flipH: boolean;
  flipV: boolean;
  blend: BlendMode;
  grade: ColorGrade;
  effects: EffectInstance[];
  mask: Mask | null;
  chroma: ChromaKey | null;
  transitionIn: TransitionInstance | null;
  transitionOut: TransitionInstance | null;
  /** AI segmentation background (requires the segmentation model). */
  segmentation: { enabled: boolean; background: 'transparent' | 'blur' | 'color' | 'image'; color: string; imageMediaId?: string; blur: number } | null;
  /** Blur-based "beauty"/"smoothing" strength. */
}

export interface VideoClip extends ClipBase, VisualClipProps {
  kind: 'video';
  mediaId: string;
  mediaIn: number; // seconds into source
  speed: Speed;
  audio: AudioFX;
  hasAudio: boolean;
  audioDetached: boolean;
  stabilization: Stabilization;
}

export interface ImageClip extends ClipBase, VisualClipProps {
  kind: 'image';
  mediaId: string;
  /** Ken Burns style motion preset id */
  motion?: string | null;
}

export interface ColorClip extends ClipBase, VisualClipProps {
  kind: 'color';
  color: string;
}

export interface AudioClip extends ClipBase {
  kind: 'audio';
  mediaId: string;
  mediaIn: number;
  speed: Speed;
  audio: AudioFX;
  /** Beat markers (relative to clip start, timeline time). */
  beats?: number[];
}

export interface TextClip extends ClipBase, VisualClipProps {
  kind: 'text';
  text: string;
  style: TextStyle;
  animation: TextAnimation;
}

export interface CaptionClip extends ClipBase, VisualClipProps {
  kind: 'caption';
  text: string;
  words: CaptionWord[];
  style: TextStyle;
  caption: CaptionStyle;
  animation: TextAnimation;
}

export interface StickerClip extends ClipBase, VisualClipProps {
  kind: 'sticker';
  /** sticker registry id OR custom media id */
  stickerId: string | null;
  mediaId: string | null;
  color?: string;
  animation: string | null; // sticker animation preset
}

export type Clip = VideoClip | ImageClip | ColorClip | AudioClip | TextClip | CaptionClip | StickerClip;
export type VisualClip = VideoClip | ImageClip | ColorClip | TextClip | CaptionClip | StickerClip;

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  locked: boolean;
  hidden: boolean;
  muted: boolean;
  solo: boolean;
  volume: number;
  height: number;
  clips: Clip[];
}

export interface Marker {
  id: string;
  time: number;
  label: string;
  color: string;
  kind: 'marker' | 'beat' | 'chapter';
}

export interface ProjectSettings {
  width: number;
  height: number;
  fps: number;
  background: string;
  presetId: string;
  sampleRate: number;
}

export interface Project {
  id: string;
  name: string;
  version: number;
  createdAt: number;
  updatedAt: number;
  folderId: string | null;
  settings: ProjectSettings;
  /** Tracks ordered from top of the timeline (rendered last / on top) to bottom. */
  tracks: Track[];
  markers: Marker[];
  mediaIds: string[];
  thumbnail?: string | null;
  templateId?: string | null;
}

export interface ProjectFolder {
  id: string;
  name: string;
  createdAt: number;
}

export type MediaType = 'video' | 'audio' | 'image' | 'font' | 'sticker';
export interface MediaAsset {
  id: string;
  type: MediaType;
  name: string;
  mime: string;
  size: number;
  duration: number; // seconds (0 for images)
  width: number;
  height: number;
  hasAudio: boolean;
  hasVideo: boolean;
  fps?: number;
  createdAt: number;
  folderId: string | null;
  favorite: boolean;
  /** data URL thumbnail */
  thumbnail?: string;
  /** Downsampled waveform peaks 0..1 (mono) */
  waveform?: number[];
  waveformDuration?: number;
  /** Proxy media id (low-res copy) for smooth preview. */
  proxyId?: string | null;
  isProxy?: boolean;
  /** Where the blob is stored: 'idb' = IndexedDB blob store; 'generated' = synthesized in app */
  source: 'idb' | 'generated' | 'url';
  url?: string;
  tags?: string[];
}

export type EditorMode = 'beginner' | 'pro';
