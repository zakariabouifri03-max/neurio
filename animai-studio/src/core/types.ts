export type ToolId =
  | "pencil"
  | "brush"
  | "ink"
  | "eraser"
  | "fill"
  | "line"
  | "rect"
  | "circle"
  | "select"
  | "transform"
  | "lasso"
  | "eyedropper"
  | "text"
  | "hand";

export type LayerType = "drawing" | "image" | "video" | "text";

export type CanvasPreset = "1920x1080" | "1080x1920" | "1080x1080" | "custom";

export const FPS_PRESETS = [12, 15, 24, 30, 60] as const;
export type FpsPreset = (typeof FPS_PRESETS)[number];

export interface BrushSettings {
  size: number;
  opacity: number;
  hardness: number;
  stabilization: number;
  pressureSensitivity: number;
  spacing: number;
  smoothing: number;
}

export interface LayerMeta {
  id: string;
  name: string;
  type: LayerType;
  visible: boolean;
  locked: boolean;
  opacity: number;
  blend: "source-over" | "multiply" | "screen";
}

export interface TimelineFrame {
  id: string;
  hold: number;
}

export interface CameraState {
  x: number;
  y: number;
  zoom: number;
  rotation: number;
  shake: number;
}

export interface CameraKeyframe {
  frame: number;
  camera: CameraState;
}

export interface AudioClip {
  id: string;
  name: string;
  startFrame: number;
  durationMs: number;
  volume: number;
  muted: boolean;
  dataUrl: string;
}

export interface CharacterReference {
  id: string;
  name: string;
  createdAt: number;
  notes: {
    face: string;
    hair: string;
    clothes: string;
    colors: string;
    proportions: string;
    accessories: string;
    style: string;
  };
  thumbnailDataUrl: string;
  sheetDataUrl: string;
}

export interface AIMetadata {
  lastProvider: string;
  lastPrompt: string;
  generations: { at: number; kind: string; prompt: string; provider: string }[];
}

export interface ProjectSettings {
  name: string;
  width: number;
  height: number;
  fps: number;
  background: string;
  transparentBackground: boolean;
}

export interface PointerSample {
  x: number;
  y: number;
  pressure: number;
  t: number;
}

export const DEFAULT_BRUSH: BrushSettings = {
  size: 8,
  opacity: 1,
  hardness: 0.85,
  stabilization: 0.35,
  pressureSensitivity: 0.7,
  spacing: 0.12,
  smoothing: 0.4,
};

export const DEFAULT_CAMERA: CameraState = {
  x: 0,
  y: 0,
  zoom: 1,
  rotation: 0,
  shake: 0,
};
