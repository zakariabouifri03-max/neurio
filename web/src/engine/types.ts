/**
 * Prism Studio — core document model.
 *
 * This file is the single source of truth for the design format. It is shared
 * by the React renderer (live editing), the Canvas2D/SVG renderers (export),
 * the collaboration transport, the version snapshots and the mobile clients.
 *
 * Everything is plain JSON so a document can round-trip through the database,
 * an op log, or a future native client without migration.
 */

export type ID = string;

/* ------------------------------------------------------------------ paints */

export type GradientStop = { offset: number; color: string; opacity?: number };

export type Paint =
  | { type: 'solid'; color: string; opacity?: number }
  | {
      type: 'gradient';
      kind: 'linear' | 'radial' | 'conic';
      angle: number;
      stops: GradientStop[];
      center?: { x: number; y: number };
      radius?: number;
    }
  | {
      type: 'image';
      src: string;
      fit: 'cover' | 'contain' | 'fill' | 'tile';
      scale?: number;
      offsetX?: number;
      offsetY?: number;
      opacity?: number;
      tile?: number;
    };

/* ------------------------------------------------------------------ styles */

export type Shadow = {
  color: string;
  x: number;
  y: number;
  blur: number;
  spread?: number;
  inset?: boolean;
};

export type StrokeAlign = 'inside' | 'center' | 'outside';
export type Stroke = {
  color: string;
  width: number;
  style: 'solid' | 'dashed' | 'dotted';
  align?: StrokeAlign;
  dash?: number[];
  opacity?: number;
};

export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity';

/** Non-destructive raster/vector adjustments. */
export type Adjustments = {
  brightness?: number; // -100..100
  contrast?: number; // -100..100
  saturation?: number; // -100..100
  temperature?: number; // -100..100
  exposure?: number; // -100..100
  hue?: number; // -180..180
  highlights?: number; // -100..100
  shadows?: number; // -100..100
  sharpen?: number; // 0..100
  blur?: number; // 0..100 px
  vignette?: number; // 0..100
  noise?: number; // 0..100
  pixelate?: number; // 0..100
  sepia?: number; // 0..100
  grayscale?: number; // 0..100
  invert?: number; // 0..100
  opacity?: number; // 0..100
  duotone?: { light: string; dark: string; amount: number } | null;
  filterPreset?: string | null;
};

/* -------------------------------------------------------------------- text */

export type TextAlign = 'left' | 'center' | 'right' | 'justify';
export type VerticalAlign = 'top' | 'middle' | 'bottom';

export type TextStyle = {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  fontStyle: 'normal' | 'italic';
  color: string;
  letterSpacing: number; // px
  lineHeight: number; // multiplier
  textAlign: TextAlign;
  verticalAlign: VerticalAlign;
  underline: boolean;
  strike: boolean;
  textTransform: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  /** Gradient fill for text (overrides solid color when set). */
  gradient?: { stops: GradientStop[]; angle: number } | null;
  /** Outline / stroke around glyphs. */
  outline?: { color: string; width: number } | null;
  /** Soft glow behind glyphs. */
  glow?: { color: string; blur: number } | null;
  shadow?: Shadow | null;
  highlight?: string | null;
  /** Curved text: SVG path the glyphs follow. */
  path?: { d: string; startOffset: number; spacing: number } | null;
  /** Auto-shrink font size so the text fits its box. */
  autoFit?: boolean;
  background?: string | null;
  padding?: number;
};

export type TextSpan = { text: string; style?: Partial<TextStyle> };

/* --------------------------------------------------------------- animation */

export type Easing = 'linear' | 'ease' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'spring';

export type AnimationPreset =
  | 'none'
  | 'fade'
  | 'rise'
  | 'drop'
  | 'pan-left'
  | 'pan-right'
  | 'zoom-in'
  | 'zoom-out'
  | 'flip'
  | 'pop'
  | 'blur-in'
  | 'typewriter'
  | 'reveal'
  | 'float'
  | 'pulse'
  | 'spin'
  | 'wipe';

export type Animation = {
  preset: AnimationPreset;
  duration: number; // ms
  delay: number; // ms
  easing: Easing;
  loop: boolean;
  direction: 'normal' | 'alternate';
  /** Presentation entrance order (slide animations). */
  order?: number;
};

export type TransitionType =
  | 'none'
  | 'fade'
  | 'slide-left'
  | 'slide-right'
  | 'slide-up'
  | 'slide-down'
  | 'zoom'
  | 'push'
  | 'wipe'
  | 'flip';

export type Transition = {
  type: TransitionType;
  duration: number;
  easing: Easing;
};

/* ------------------------------------------------------- nodes & the tree */

export type NodeType =
  | 'frame'
  | 'group'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'polygon'
  | 'star'
  | 'arrow'
  | 'path'
  | 'text'
  | 'image'
  | 'video'
  | 'svg'
  | 'chart'
  | 'table'
  | 'sticker';

export type NodeBase = {
  id: ID;
  type: NodeType;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number; // degrees
  opacity: number; // 0..1
  visible: boolean;
  locked: boolean;
  flipX: boolean;
  flipY: boolean;
  blendMode: BlendMode;
  /** Corner radius in px (single value or 4 corners TL/TR/BR/BL). */
  radius?: number | [number, number, number, number];
  fill: Paint | null;
  stroke: Stroke | null;
  shadow: Shadow | null;
  /** Gaussian blur applied to the whole node (px). */
  blur?: number;
  adjustments?: Adjustments;
  /** Rounded clipping mask for media (frame + image/video). */
  clip?: boolean;
  /** Crop rect in 0..1 of the media's natural size. */
  crop?: { x: number; y: number; width: number; height: number };
  /** Perspective-ish skew, degrees. */
  skew?: { x: number; y: number };
  animation?: Animation;
  /** Timeline visibility window (video projects). */
  timeline?: { in: number; out: number };
  keyframes?: Keyframe[];
  link?: string;
  ariaLabel?: string;
  meta?: Record<string, unknown>;
  children?: SceneNode[];
  /** Extra data used by specific node kinds. */
  data?: Record<string, unknown>;
  /** Free text content for text nodes (spans) — kept at node level for speed. */
  spans?: TextSpan[];
  style?: TextStyle;
  src?: string;
  d?: string;
  points?: number;
  innerRadius?: number;
  /** Optional natural media size, used for crop/restore. */
  natural?: { width: number; height: number };
};

export type RectNode = NodeBase & { type: 'rect' };
export type EllipseNode = NodeBase & { type: 'ellipse' };
export type LineNode = NodeBase & { type: 'line' };
export type PolygonNode = NodeBase & { type: 'polygon'; points: number };
export type StarNode = NodeBase & { type: 'star'; points: number; innerRadius: number };
export type ArrowNode = NodeBase & { type: 'arrow' };
export type PathNode = NodeBase & { type: 'path'; d: string };
export type TextNode = NodeBase & { type: 'text'; spans: TextSpan[]; style: TextStyle };
export type ImageNode = NodeBase & { type: 'image'; src: string };
export type VideoNode = NodeBase & { type: 'video'; src: string; poster?: string };
export type SvgNode = NodeBase & { type: 'svg'; d?: string; svg?: string };
export type GroupNode = NodeBase & { type: 'group'; children: SceneNode[] };
export type FrameNode = NodeBase & { type: 'frame'; children: SceneNode[] };
export type StickerNode = NodeBase & { type: 'sticker'; svg: string };

export type ChartKind =
  | 'bar'
  | 'bar-stacked'
  | 'line'
  | 'area'
  | 'pie'
  | 'doughnut'
  | 'radar'
  | 'scatter'
  | 'progress'
  | 'funnel';

export type ChartData = {
  kind: ChartKind;
  labels: string[];
  series: { name: string; values: number[]; color?: string }[];
  options: {
    showLegend: boolean;
    showGrid: boolean;
    showValues: boolean;
    smooth: boolean;
    stacked: boolean;
    donut?: boolean;
    palette: string[];
    labelColor: string;
    gridColor: string;
    fontFamily: string;
    fontSize: number;
    max?: number;
  };
};

export type ChartNode = NodeBase & { type: 'chart'; data: ChartData };

export type TableData = {
  rows: number;
  cols: number;
  cells: string[][];
  header: boolean;
  style: {
    headerFill: string;
    headerColor: string;
    cellFill: string;
    altFill: string;
    border: string;
    borderWidth: number;
    fontFamily: string;
    fontSize: number;
    color: string;
    padding: number;
  };
};

export type TableNode = NodeBase & { type: 'table'; data: TableData };

export type SceneNode = NodeBase;

/* ---------------------------------------------------------------- keyframes */

export type KeyframeProps = Partial<{
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  rotation: number;
  scale: number;
}>;

export type Keyframe = {
  id: ID;
  t: number; // ms from clip/page start
  props: KeyframeProps;
  easing: Easing;
};

/* ------------------------------------------------------------- media/timeline */

export type MediaClip = {
  id: ID;
  trackId: ID;
  name: string;
  kind: 'video' | 'audio' | 'image';
  src: string;
  /** Position on the timeline (ms). */
  start: number;
  /** Playback duration on the timeline (ms). */
  duration: number;
  /** Trim offsets into the source media (ms). */
  trimStart: number;
  trimEnd: number;
  speed: number;
  reverse: boolean;
  volume: number; // 0..1
  muted: boolean;
  fadeIn: number; // ms
  fadeOut: number; // ms
  /** Crossfade/dip transition into the next clip. */
  transition?: { type: TransitionType; duration: number } | null;
  filters?: Adjustments | null;
  crop?: { x: number; y: number; width: number; height: number } | null;
  /** Rendered size/position inside the composition (video/image). */
  layout?: { x: number; y: number; width: number; height: number };
  keyframes?: Keyframe[];
  poster?: string;
  natural?: { width: number; height: number; duration?: number };
};

export type Track = {
  id: ID;
  kind: 'video' | 'audio' | 'overlay' | 'subtitle';
  name: string;
  muted: boolean;
  locked: boolean;
  height?: number;
  clips: MediaClip[];
};

export type Timeline = {
  fps: number;
  duration: number; // ms
  tracks: Track[];
  subtitles?: { id: ID; start: number; end: number; text: string }[];
};

/* -------------------------------------------------------------- page & doc */

export type PageBackground = {
  color: string;
  paint?: Paint | null;
  /** Safe-area / margin guides. */
  margins?: { top: number; right: number; bottom: number; left: number };
};

export type Page = {
  id: ID;
  name: string;
  width: number;
  height: number;
  background: PageBackground;
  nodes: SceneNode[];
  /** Presentation speaker notes, document settings, etc. */
  notes?: string;
  transition?: Transition;
  meta?: Record<string, unknown>;
};

export type DocKind = 'design' | 'presentation' | 'document' | 'video' | 'print';

export type DocSettings = {
  /** Global grid */
  grid: { size: number; visible: boolean; snap: boolean };
  guides: { x: number[]; y: number[] };
  rulers: boolean;
  snapToObjects: boolean;
  snapToGrid: boolean;
  showMargins: boolean;
  /** Brand kit applied to this document */
  brandKitId?: string | null;
  theme: {
    colors: string[];
    fontHeading: string;
    fontBody: string;
  };
  units: 'px' | 'mm' | 'in';
  bleed?: number;
};

export type DesignDoc = {
  id: ID;
  title: string;
  kind: DocKind;
  width: number;
  height: number;
  pages: Page[];
  settings: DocSettings;
  timeline?: Timeline;
  createdAt?: number;
  updatedAt?: number;
  version?: number;
};

/* ---------------------------------------------------------------- preset sizes */

export type SizePreset = {
  id: string;
  name: string;
  group: string;
  width: number;
  height: number;
  kind?: DocKind;
};

/* ------------------------------------------------------------------ helpers */

export function isContainer(node: SceneNode | null): node is SceneNode {
  return !!node && (node.type === 'group' || node.type === 'frame');
}

export function hasText(node: SceneNode | null): node is TextNode {
  return !!node && node.type === 'text';
}

export function nodeText(node: SceneNode): string {
  if (node.type !== 'text') return '';
  return (node.spans ?? []).map((s) => s.text).join('');
}

export function setNodeText(node: SceneNode, text: string): void {
  if (node.type !== 'text') return;
  const base = node.spans?.[0]?.style;
  node.spans = [{ text, style: base }];
}

export function defaultTextStyle(): TextStyle {
  return {
    fontFamily: 'Inter',
    fontSize: 48,
    fontWeight: 700,
    fontStyle: 'normal',
    color: '#111827',
    letterSpacing: 0,
    lineHeight: 1.2,
    textAlign: 'left',
    verticalAlign: 'top',
    underline: false,
    strike: false,
    textTransform: 'none',
    gradient: null,
    outline: null,
    glow: null,
    shadow: null,
    highlight: null,
    path: null,
    autoFit: false,
    background: null,
    padding: 0,
  };
}

export function defaultDocSettings(): DocSettings {
  return {
    grid: { size: 20, visible: false, snap: false },
    guides: { x: [], y: [] },
    rulers: true,
    snapToObjects: true,
    snapToGrid: false,
    showMargins: false,
    brandKitId: null,
    theme: {
      colors: ['#6C5CE7', '#00B894', '#FD79A8', '#FDCB6E', '#0984E3', '#E17055', '#2D3436', '#FFFFFF'],
      fontHeading: 'Playfair Display',
      fontBody: 'Inter',
    },
    units: 'px',
  };
}
