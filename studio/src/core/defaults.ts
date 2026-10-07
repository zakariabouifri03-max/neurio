import type {
  AudioFX,
  CaptionClip,
  ChromaKey,
  ColorClip,
  ColorGrade,
  Curves,
  HSL,
  ImageClip,
  Mask,
  MaskShape,
  Project,
  ProjectSettings,
  Speed,
  Stabilization,
  StickerClip,
  TextAnimation,
  TextClip,
  TextStyle,
  Track,
  TrackKind,
  Transform,
  VideoClip,
  AudioClip,
  VisualClipProps,
  ColorWheels,
} from './types';
import { uid } from './util';
import { a } from './keyframes';

export interface SocialPreset {
  id: string;
  label: string;
  platform: string;
  width: number;
  height: number;
  fps: number;
  ratio: string;
  icon: string;
}

export const SOCIAL_PRESETS: SocialPreset[] = [
  { id: 'tiktok', label: 'TikTok', platform: 'TikTok', width: 1080, height: 1920, fps: 30, ratio: '9:16', icon: '♪' },
  { id: 'reels', label: 'Instagram Reels', platform: 'Instagram', width: 1080, height: 1920, fps: 30, ratio: '9:16', icon: '◎' },
  { id: 'shorts', label: 'YouTube Shorts', platform: 'YouTube', width: 1080, height: 1920, fps: 30, ratio: '9:16', icon: '▶' },
  { id: 'youtube', label: 'YouTube 16:9', platform: 'YouTube', width: 1920, height: 1080, fps: 30, ratio: '16:9', icon: '▶' },
  { id: 'youtube4k', label: 'YouTube 4K', platform: 'YouTube', width: 3840, height: 2160, fps: 30, ratio: '16:9', icon: '▶' },
  { id: 'ig-square', label: 'Instagram 1:1', platform: 'Instagram', width: 1080, height: 1080, fps: 30, ratio: '1:1', icon: '◎' },
  { id: 'ig-portrait', label: 'Instagram 4:5', platform: 'Instagram', width: 1080, height: 1350, fps: 30, ratio: '4:5', icon: '◎' },
  { id: 'facebook', label: 'Facebook', platform: 'Facebook', width: 1280, height: 720, fps: 30, ratio: '16:9', icon: 'f' },
  { id: 'x', label: 'X (Twitter)', platform: 'X', width: 1280, height: 720, fps: 30, ratio: '16:9', icon: '𝕏' },
  { id: 'snapchat', label: 'Snapchat', platform: 'Snapchat', width: 1080, height: 1920, fps: 30, ratio: '9:16', icon: '👻' },
  { id: 'linkedin', label: 'LinkedIn', platform: 'LinkedIn', width: 1920, height: 1080, fps: 30, ratio: '16:9', icon: 'in' },
  { id: 'cinema', label: 'Cinema 2.39:1', platform: 'Film', width: 2048, height: 858, fps: 24, ratio: '2.39:1', icon: '🎬' },
];

export const DEFAULT_SETTINGS: ProjectSettings = {
  width: 1080,
  height: 1920,
  fps: 30,
  background: '#000000',
  presetId: 'tiktok',
  sampleRate: 48000,
};

export function defaultTransform(): Transform {
  return {
    position: a({ x: 0, y: 0 }),
    scale: a({ x: 1, y: 1 }),
    rotation: a(0),
    opacity: a(1),
    anchor: { x: 0, y: 0 },
  };
}

export function defaultGrade(): ColorGrade {
  return { adjustments: {} };
}

export function defaultHSL(): HSL {
  const z = () => ({ hue: 0, saturation: 0, luminance: 0 });
  return { red: z(), orange: z(), yellow: z(), green: z(), aqua: z(), blue: z(), purple: z(), magenta: z() };
}

export function defaultCurves(): Curves {
  const line = () => [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ];
  return { master: line(), red: line(), green: line(), blue: line() };
}

export function defaultWheels(): ColorWheels {
  const z = () => ({ r: 0, g: 0, b: 0, lum: 0 });
  return { shadows: z(), midtones: z(), highlights: z() };
}

export function defaultSpeed(): Speed {
  return { rate: 1, reversed: false, preservePitch: true };
}

export function defaultAudioFX(): AudioFX {
  return {
    volume: a(1),
    fadeIn: 0,
    fadeOut: 0,
    pitch: 0,
    eq: { low: 0, mid: 0, high: 0 },
    noiseReduction: 0,
    voiceEnhance: 0,
    compressor: { enabled: false, threshold: -24, ratio: 4, attack: 0.003, release: 0.25, makeup: 0 },
    reverb: { enabled: false, mix: 0.3, size: 0.5, decay: 1.5 },
    echo: { enabled: false, time: 0.3, feedback: 0.35, mix: 0.3 },
    pan: 0,
    stereoWidth: 1,
    normalize: false,
    ducking: { enabled: false, amount: 0.6, threshold: 0.05, attack: 0.1, release: 0.4 },
  };
}

export function defaultStabilization(): Stabilization {
  return { enabled: false, level: 0, cropZoom: 1.08 };
}

export function defaultMask(shape: MaskShape = 'rectangle'): Mask {
  return {
    shape,
    enabled: true,
    center: a({ x: 0, y: 0 }),
    size: a({ x: 0.6, y: 0.6 }),
    rotation: a(0),
    feather: a(0.05),
    opacity: a(1),
    roundness: a(0),
    invert: false,
  };
}

export function defaultChroma(): ChromaKey {
  return {
    enabled: true,
    color: { r: 0, g: 1, b: 0 },
    strength: a(0.4),
    smoothness: a(0.1),
    spill: a(0.5),
    edgeSoftness: a(0.02),
    shadowPreservation: a(0.3),
  };
}

export function defaultVisual(): VisualClipProps {
  return {
    transform: defaultTransform(),
    crop: { left: 0, top: 0, right: 0, bottom: 0 },
    flipH: false,
    flipV: false,
    blend: 'normal',
    grade: defaultGrade(),
    effects: [],
    mask: null,
    chroma: null,
    transitionIn: null,
    transitionOut: null,
    segmentation: null,
  };
}

export function defaultTextStyle(): TextStyle {
  return {
    fontFamily: 'Inter',
    fontSize: 72,
    fontWeight: 700,
    italic: false,
    letterSpacing: 0,
    lineHeight: 1.2,
    align: 'center',
    color: '#ffffff',
    gradient: null,
    outline: null,
    shadow: { color: 'rgba(0,0,0,0.6)', blur: 12, x: 0, y: 4 },
    glow: null,
    background: null,
    uppercase: false,
    underline: false,
    maxWidth: 0.85,
  };
}

export function defaultTextAnimation(): TextAnimation {
  return {
    in: { type: 'fade', duration: 0.4, unit: 'block', stagger: 0.04 },
    out: { type: 'fade', duration: 0.4, unit: 'block', stagger: 0.04 },
    loop: null,
  };
}

export function makeTrack(kind: TrackKind, name?: string): Track {
  const names: Record<TrackKind, string> = {
    video: 'Video',
    audio: 'Audio',
    text: 'Text',
    sticker: 'Sticker',
    overlay: 'Overlay',
    image: 'Image',
  };
  return {
    id: uid('trk'),
    kind,
    name: name || names[kind],
    locked: false,
    hidden: false,
    muted: false,
    solo: false,
    volume: 1,
    height: kind === 'video' || kind === 'overlay' ? 64 : kind === 'audio' ? 52 : 40,
    clips: [],
  };
}

export function makeVideoClip(p: { trackId: string; mediaId: string; name: string; start: number; duration: number; mediaIn?: number; hasAudio?: boolean }): VideoClip {
  return {
    id: uid('clip'),
    kind: 'video',
    trackId: p.trackId,
    name: p.name,
    start: p.start,
    duration: p.duration,
    locked: false,
    mediaId: p.mediaId,
    mediaIn: p.mediaIn ?? 0,
    speed: defaultSpeed(),
    audio: defaultAudioFX(),
    hasAudio: p.hasAudio ?? true,
    audioDetached: false,
    stabilization: defaultStabilization(),
    ...defaultVisual(),
  };
}

export function makeImageClip(p: { trackId: string; mediaId: string; name: string; start: number; duration: number }): ImageClip {
  return {
    id: uid('clip'),
    kind: 'image',
    trackId: p.trackId,
    name: p.name,
    start: p.start,
    duration: p.duration,
    locked: false,
    mediaId: p.mediaId,
    motion: null,
    ...defaultVisual(),
  };
}

export function makeColorClip(p: { trackId: string; color: string; start: number; duration: number; name?: string }): ColorClip {
  return {
    id: uid('clip'),
    kind: 'color',
    trackId: p.trackId,
    name: p.name || 'Color',
    start: p.start,
    duration: p.duration,
    locked: false,
    color: p.color,
    ...defaultVisual(),
  };
}

export function makeAudioClip(p: { trackId: string; mediaId: string; name: string; start: number; duration: number; mediaIn?: number }): AudioClip {
  return {
    id: uid('clip'),
    kind: 'audio',
    trackId: p.trackId,
    name: p.name,
    start: p.start,
    duration: p.duration,
    locked: false,
    mediaId: p.mediaId,
    mediaIn: p.mediaIn ?? 0,
    speed: defaultSpeed(),
    audio: defaultAudioFX(),
  };
}

export function makeTextClip(p: { trackId: string; text: string; start: number; duration: number; style?: Partial<TextStyle>; animation?: Partial<TextAnimation> }): TextClip {
  return {
    id: uid('clip'),
    kind: 'text',
    trackId: p.trackId,
    name: p.text.slice(0, 24) || 'Text',
    start: p.start,
    duration: p.duration,
    locked: false,
    text: p.text,
    style: { ...defaultTextStyle(), ...(p.style || {}) },
    animation: { ...defaultTextAnimation(), ...(p.animation || {}) },
    ...defaultVisual(),
  };
}

export function makeCaptionClip(p: { trackId: string; text: string; words: CaptionClip['words']; start: number; duration: number; style?: Partial<TextStyle>; caption?: Partial<CaptionClip['caption']> }): CaptionClip {
  const style = { ...defaultTextStyle(), fontSize: 64, fontWeight: 800, uppercase: true, ...(p.style || {}) };
  return {
    id: uid('clip'),
    kind: 'caption',
    trackId: p.trackId,
    name: p.text.slice(0, 24) || 'Caption',
    start: p.start,
    duration: p.duration,
    locked: false,
    text: p.text,
    words: p.words,
    style,
    caption: { highlightColor: '#ffe600', highlightBackground: null, highlightScale: 1.12, mode: 'word', wordsPerLine: 4, ...(p.caption || {}) },
    animation: { in: { type: 'pop', duration: 0.15, unit: 'block', stagger: 0 }, out: { type: 'none', duration: 0, unit: 'block', stagger: 0 }, loop: null },
    ...defaultVisual(),
    transform: { ...defaultTransform(), position: a({ x: 0, y: 0.25 }) },
  };
}

export function makeStickerClip(p: { trackId: string; stickerId?: string; mediaId?: string; name: string; start: number; duration: number; animation?: string | null }): StickerClip {
  const vis = defaultVisual();
  vis.transform.scale = a({ x: 0.3, y: 0.3 });
  return {
    id: uid('clip'),
    kind: 'sticker',
    trackId: p.trackId,
    name: p.name,
    start: p.start,
    duration: p.duration,
    locked: false,
    stickerId: p.stickerId ?? null,
    mediaId: p.mediaId ?? null,
    animation: p.animation ?? null,
    ...vis,
  };
}

export function makeProject(name = 'Untitled project', settings: Partial<ProjectSettings> = {}): Project {
  const now = Date.now();
  return {
    id: uid('prj'),
    name,
    version: 1,
    createdAt: now,
    updatedAt: now,
    folderId: null,
    settings: { ...DEFAULT_SETTINGS, ...settings },
    tracks: [makeTrack('text', 'Text 1'), makeTrack('overlay', 'Overlay 1'), makeTrack('video', 'Video 1'), makeTrack('audio', 'Audio 1')],
    markers: [],
    mediaIds: [],
    thumbnail: null,
  };
}
