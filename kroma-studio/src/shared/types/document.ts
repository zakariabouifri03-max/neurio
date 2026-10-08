/**
 * The serialisable design document. This is the only shape that ever touches
 * disk, so it must stay JSON-safe and free of engine (Fabric) references.
 */

export type NodeKind = 'text' | 'image' | 'shape' | 'svg' | 'group'

export type Align = 'left' | 'center' | 'right'
export type VerticalAlign = 'top' | 'middle' | 'bottom'
export type ShapeKind =
  | 'rect'
  | 'circle'
  | 'ellipse'
  | 'triangle'
  | 'diamond'
  | 'pentagon'
  | 'hexagon'
  | 'star'
  | 'heart'
  | 'arrow'
  | 'line'
  | 'pill'
  | 'cross'
  | 'blob'

export type MaskKind = 'none' | 'circle' | 'rounded' | 'triangle' | 'hexagon' | 'star' | 'heart' | 'diamond'

export interface ShadowSpec {
  color: string
  blur: number
  offsetX: number
  offsetY: number
  opacity: number
}

export interface GradientStop {
  color: string
  offset: number
}

export type FillType = 'solid' | 'linear' | 'radial'

export interface FillSpec {
  type: FillType
  color: string
  stops?: GradientStop[]
  /** Degrees, 0 = left→right */
  angle?: number
}

export interface StrokeSpec {
  color: string
  width: number
  align: 'inside' | 'center' | 'outside'
  dash?: number[]
}

export interface ImageFilters {
  brightness: number // -1 .. 1 (0 = neutral)
  contrast: number // -1 .. 1
  saturation: number // -1 .. 1
  blur: number // px at natural size
  grayscale: number // 0..1
  sepia: number // 0..1
  invert: number // 0..1
  sharpen: number // 0..1
  pixelate: number // 0 = off
}

/** Normalised crop rectangle, relative to the source image (0..1). */
export interface CropSpec {
  x: number
  y: number
  width: number
  height: number
}

export type CurveKind = 'none' | 'arc' | 'arcReverse' | 'wave' | 'circle' | 'valley'

export interface CurveSpec {
  kind: CurveKind
  /** Bend strength, -100..100 */
  amount: number
}

export interface BaseNode {
  id: string
  kind: NodeKind
  name: string
  visible: boolean
  locked: boolean
  /** Top-left of the untransformed box, in page pixels. */
  x: number
  y: number
  width: number
  height: number
  /** Degrees, clockwise. */
  rotation: number
  opacity: number
  flipX?: boolean
  flipY?: boolean
  shadow?: ShadowSpec | null
  /** Percentage of the shorter side, 0 = square corners. */
  cornerRadius?: number
  /** Kept so resize handles preserve ratio. */
  lockRatio?: boolean
  /** Optional user note shown in the layer row. */
  meta?: Record<string, string | number | boolean>
}

export interface TextNode extends BaseNode {
  kind: 'text'
  text: string
  fontFamily: string
  fontSize: number
  fontWeight: number
  italic: boolean
  underline: boolean
  strikethrough: boolean
  align: Align
  valign: VerticalAlign
  letterSpacing: number
  lineHeight: number
  fill: FillSpec
  stroke?: StrokeSpec | null
  curve?: CurveSpec | null
  /** 'fixed' keeps the box, 'grow' expands the box to the text. */
  boxMode: 'fixed' | 'grow'
  /** Vertical padding inside the box, px. */
  padding: number
}

export interface ImageNode extends BaseNode {
  kind: 'image'
  /** `kroma-asset://<id>` or a `data:` URL. */
  src: string
  naturalWidth?: number
  naturalHeight?: number
  crop?: CropSpec | null
  filters?: Partial<ImageFilters> | null
  mask?: MaskKind
  /** Object-fit behaviour inside the box. */
  fit: 'cover' | 'contain'
}

export interface ShapeNode extends BaseNode {
  kind: 'shape'
  shape: ShapeKind
  fill: FillSpec
  stroke?: StrokeSpec | null
  /** Star/polygon only: number of points. */
  points?: number
  /** Line/arrow only. */
  thickness?: number
}

export interface SvgNode extends BaseNode {
  kind: 'svg'
  /** Sanitised SVG markup. */
  svg: string
  /** Re-colour every currentColor/fill in the artwork. */
  fillColor?: string | null
}

export interface GroupNode extends BaseNode {
  kind: 'group'
  children: SceneNode[]
}

export type SceneNode = TextNode | ImageNode | ShapeNode | SvgNode | GroupNode

export type PageBackgroundType = 'solid' | 'gradient' | 'image' | 'transparent'

export interface PageBackground {
  type: PageBackgroundType
  color: string
  gradient?: FillSpec
  imageSrc?: string
  imageOpacity?: number
}

export interface Page {
  id: string
  name: string
  width: number
  height: number
  background: PageBackground
  nodes: SceneNode[]
  /** Safe-area inset in % of the shorter side (0 disables the guide). */
  safeArea?: number
}

export interface DesignDocument {
  version: number
  pages: Page[]
}

export interface BrandKit {
  name: string
  colors: string[]
  fonts: string[]
  logoAssetId?: string | null
}

export const DEFAULT_SHADOW: ShadowSpec = { color: '#000000', blur: 12, offsetX: 0, offsetY: 6, opacity: 0.35 }
export const DEFAULT_IMAGE_FILTERS: ImageFilters = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  blur: 0,
  grayscale: 0,
  sepia: 0,
  invert: 0,
  sharpen: 0,
  pixelate: 0
}
export const NO_CURVE: CurveSpec = { kind: 'none', amount: 40 }
