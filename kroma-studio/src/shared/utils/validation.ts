import { ACCEPTED_IMAGE_TYPES, DOCUMENT_VERSION, LIMITS } from '../constants'
import type {
  DesignDocument,
  GroupNode,
  ImageNode,
  Page,
  SceneNode,
  ShapeNode,
  SvgNode,
  TextNode
} from '../types/document'
import { newId } from './ids'
import { clamp, round } from './geometry'

/* ------------------------------ primitives ------------------------------ */

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const asString = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback)
export const asNumber = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback
export const asBoolean = (value: unknown, fallback = false): boolean => (typeof value === 'boolean' ? value : fallback)
export const asOneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback

/** Accept #rgb/#rrggbb/#rrggbbaa, reject anything that could smuggle CSS. */
export function sanitizeColor(value: unknown, fallback = '#000000'): string {
  if (typeof value !== 'string') return fallback
  const v = value.trim()
  if (/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v)) return v
  const named = /^(transparent|white|black|red|green|blue)$/i
  return named.test(v) ? v.toLowerCase() : fallback
}

/** Strip path separators / traversal from user supplied names. */
export function sanitizeFileName(name: string, fallback = 'untitled'): string {
  const cleaned = name
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, '')
    .replace(/\.{2,}/g, '.')
    .trim()
    .slice(0, 120)
  return cleaned || fallback
}

export function sanitizeText(value: unknown, max = 20000): string {
  return asString(value).replace(/\u0000/g, '').slice(0, max)
}

/** Strip control characters and cap length on free-form prompts. */
export function sanitizePrompt(value: unknown, max = 4000): string {
  return asString(value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ')
    .trim()
    .slice(0, max)
}

/* -------------------------------- images -------------------------------- */

export function mimeFromDataUrl(dataUrl: string): string | null {
  const match = /^data:([^;,]+)[;,]/.exec(dataUrl)
  return match ? match[1].toLowerCase() : null
}

export function isAcceptedImageMime(mime: string | null | undefined): boolean {
  return !!mime && (ACCEPTED_IMAGE_TYPES as readonly string[]).includes(mime.toLowerCase())
}

export function isSafeDataUrl(dataUrl: unknown): dataUrl is string {
  if (typeof dataUrl !== 'string') return false
  if (!dataUrl.startsWith('data:')) return false
  const mime = mimeFromDataUrl(dataUrl)
  if (!isAcceptedImageMime(mime)) return false
  // Rough size guard: 4 base64 chars ≈ 3 bytes.
  return dataUrl.length <= Math.ceil((LIMITS.MAX_UPLOAD_BYTES * 4) / 3) + 64
}

export function isSafeAssetUrl(src: unknown): src is string {
  return typeof src === 'string' && /^kroma-asset:\/\/[A-Za-z0-9_-]{1,128}$/.test(src)
}

export function isSafeImageSource(src: unknown): boolean {
  return isSafeAssetUrl(src) || isSafeDataUrl(src)
}

/* --------------------------------- svg ---------------------------------- */

const SVG_EVENT_ATTRS = /^on[a-z]/i
const SVG_FORBIDDEN_TAGS = /<(script|foreignObject|iframe|object|embed|audio|video|animate[^>]*href)/i

/**
 * Best-effort SVG sanitiser for imported icon/element files. Removes scripts,
 * event handlers and external references so imported artwork can never execute
 * code inside the renderer.
 */
export function sanitizeSvg(input: unknown): { ok: boolean; svg: string; reason?: string } {
  const raw = asString(input)
  if (!raw.trim()) return { ok: false, svg: '', reason: 'Empty SVG' }
  if (raw.length > 512 * 1024) return { ok: false, svg: '', reason: 'SVG too large (max 512 KB)' }
  if (SVG_FORBIDDEN_TAGS.test(raw)) return { ok: false, svg: '', reason: 'SVG contains disallowed elements' }

  let cleaned = raw
    .replace(/<\?xml[\s\S]*?\?>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s(on[a-z]+)\s*=\s*"[^"]*"/gi, '')
    .replace(/\s(on[a-z]+)\s*=\s*'[^']*'/gi, '')
    .replace(/(xlink:href|href)\s*=\s*"(?!#)[^"]*"/gi, '')
    .replace(/(xlink:href|href)\s*=\s*'(?!#)[^']*'/gi, '')

  // Remove attributes that are not safe/needed after tag-level filtering.
  cleaned = cleaned.replace(/<([a-zA-Z][\w:-]*)((?:\s+[\w:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*\/?>/g, (tag, name: string, attrs: string) => {
    const kept = (attrs as string)
      .split(/\s+/)
      .filter(Boolean)
      .map((attr) => attr)
      .filter((attr) => !SVG_EVENT_ATTRS.test(attr.split('=')[0]))
      .join(' ')
    const selfClosing = tag.trimEnd().endsWith('/>') ? ' /' : ''
    return kept ? `<${name} ${kept}${selfClosing}>` : `<${name}${selfClosing}>`
  })

  if (!/<svg[\s>]/i.test(cleaned)) return { ok: false, svg: '', reason: 'Not an SVG document' }
  return { ok: true, svg: cleaned.trim() }
}

/* ------------------------------- document -------------------------------- */

const SHAPES = ['rect', 'circle', 'ellipse', 'triangle', 'diamond', 'pentagon', 'hexagon', 'star', 'heart', 'arrow', 'line', 'pill', 'cross', 'blob'] as const
const MASKS = ['none', 'circle', 'rounded', 'triangle', 'hexagon', 'star', 'heart', 'diamond'] as const
const CURVES = ['none', 'arc', 'arcReverse', 'wave', 'circle', 'valley'] as const

function sanitizeFill(value: unknown): TextNode['fill'] {
  if (!isRecord(value)) return { type: 'solid', color: '#000000' }
  const type = asOneOf(value.type, ['solid', 'linear', 'radial'] as const, 'solid')
  const stops = Array.isArray(value.stops)
    ? (value.stops as unknown[])
        .filter(isRecord)
        .slice(0, 12)
        .map((stop) => ({ color: sanitizeColor(stop.color, '#000000'), offset: clamp(asNumber(stop.offset, 0), 0, 1) }))
    : undefined
  return {
    type,
    color: sanitizeColor(value.color, '#000000'),
    stops: stops && stops.length > 1 ? stops : undefined,
    angle: clamp(asNumber(value.angle, 0), -360, 360)
  }
}

function sanitizeStroke(value: unknown): TextNode['stroke'] {
  if (!isRecord(value)) return null
  return {
    color: sanitizeColor(value.color, '#000000'),
    width: clamp(asNumber(value.width, 0), 0, 400),
    align: asOneOf(value.align, ['inside', 'center', 'outside'] as const, 'center'),
    dash: Array.isArray(value.dash) ? (value.dash as unknown[]).slice(0, 8).map((n) => clamp(asNumber(n, 0), 0, 500)) : undefined
  }
}

function sanitizeShadow(value: unknown): TextNode['shadow'] {
  if (!isRecord(value)) return null
  return {
    color: sanitizeColor(value.color, '#000000'),
    blur: clamp(asNumber(value.blur, 0), 0, 400),
    offsetX: clamp(asNumber(value.offsetX, 0), -2000, 2000),
    offsetY: clamp(asNumber(value.offsetY, 0), -2000, 2000),
    opacity: clamp(asNumber(value.opacity, 0.4), 0, 1)
  }
}

function sanitizeFilters(value: unknown): ImageNode['filters'] {
  if (!isRecord(value)) return null
  const num = (key: string, fallback: number, min: number, max: number): number => clamp(asNumber(value[key], fallback), min, max)
  return {
    brightness: num('brightness', 0, -1, 1),
    contrast: num('contrast', 0, -1, 1),
    saturation: num('saturation', 0, -1, 1),
    blur: num('blur', 0, 0, 200),
    grayscale: num('grayscale', 0, 0, 1),
    sepia: num('sepia', 0, 0, 1),
    invert: num('invert', 0, 0, 1),
    sharpen: num('sharpen', 0, 0, 1),
    pixelate: num('pixelate', 0, 0, 200)
  }
}

function baseFields(raw: Record<string, unknown>, kind: SceneNode['kind']): SceneNode {
  return {
    id: asString(raw.id) || newId(kind.slice(0, 2)),
    kind,
    name: sanitizeText(raw.name, 120) || kind,
    visible: asBoolean(raw.visible, true),
    locked: asBoolean(raw.locked, false),
    x: round(asNumber(raw.x, 0)),
    y: round(asNumber(raw.y, 0)),
    width: Math.max(1, round(asNumber(raw.width, 100))),
    height: Math.max(1, round(asNumber(raw.height, 100))),
    rotation: clamp(asNumber(raw.rotation, 0), -3600, 3600),
    opacity: clamp(asNumber(raw.opacity, 1), 0, 1),
    flipX: asBoolean(raw.flipX, false) || undefined,
    flipY: asBoolean(raw.flipY, false) || undefined,
    cornerRadius: raw.cornerRadius === undefined ? undefined : clamp(asNumber(raw.cornerRadius, 0), 0, 100),
    lockRatio: asBoolean(raw.lockRatio, false) || undefined
  } as SceneNode
}

/** Coerce untrusted JSON into a valid SceneNode, dropping anything unsafe. */
export function sanitizeNode(raw: unknown): SceneNode | null {
  if (!isRecord(raw)) return null
  const kind = asString(raw.kind)
  switch (kind) {
    case 'text': {
      const base = baseFields(raw, 'text') as TextNode
      return {
        ...base,
        text: sanitizeText(raw.text),
        fontFamily: sanitizeText(raw.fontFamily, 120) || 'Inter',
        fontSize: clamp(asNumber(raw.fontSize, 32), 1, 2000),
        fontWeight: clamp(asNumber(raw.fontWeight, 400), 100, 900),
        italic: asBoolean(raw.italic, false),
        underline: asBoolean(raw.underline, false),
        strikethrough: asBoolean(raw.strikethrough, false),
        align: asOneOf(raw.align, ['left', 'center', 'right'] as const, 'left'),
        valign: asOneOf(raw.valign, ['top', 'middle', 'bottom'] as const, 'middle'),
        letterSpacing: clamp(asNumber(raw.letterSpacing, 0), -50, 200),
        lineHeight: clamp(asNumber(raw.lineHeight, 1.2), 0.4, 8),
        fill: sanitizeFill(raw.fill),
        stroke: sanitizeStroke(raw.stroke),
        shadow: sanitizeShadow(raw.shadow),
        curve: isRecord(raw.curve)
          ? { kind: asOneOf(raw.curve.kind, CURVES, 'none'), amount: clamp(asNumber(raw.curve.amount, 40), -100, 100) }
          : null,
        boxMode: asOneOf(raw.boxMode, ['fixed', 'grow'] as const, 'fixed'),
        padding: clamp(asNumber(raw.padding, 0), 0, 500)
      }
    }
    case 'image': {
      const base = baseFields(raw, 'image') as ImageNode
      const src = asString(raw.src)
      if (!isSafeImageSource(src)) return null
      return {
        ...base,
        src,
        fit: asOneOf(raw.fit, ['cover', 'contain'] as const, 'cover'),
        mask: asOneOf(raw.mask, MASKS, 'none'),
        filters: sanitizeFilters(raw.filters),
        crop: isRecord(raw.crop)
          ? {
              x: clamp(asNumber(raw.crop.x, 0), 0, 1),
              y: clamp(asNumber(raw.crop.y, 0), 0, 1),
              width: clamp(asNumber(raw.crop.width, 1), 0.01, 1),
              height: clamp(asNumber(raw.crop.height, 1), 0.01, 1)
            }
          : null,
        naturalWidth: raw.naturalWidth === undefined ? undefined : Math.max(1, asNumber(raw.naturalWidth, 1)),
        naturalHeight: raw.naturalHeight === undefined ? undefined : Math.max(1, asNumber(raw.naturalHeight, 1))
      }
    }
    case 'shape': {
      const base = baseFields(raw, 'shape') as ShapeNode
      return {
        ...base,
        shape: asOneOf(raw.shape, SHAPES, 'rect'),
        fill: sanitizeFill(raw.fill),
        stroke: sanitizeStroke(raw.stroke),
        shadow: sanitizeShadow(raw.shadow),
        points: raw.points === undefined ? undefined : clamp(asNumber(raw.points, 5), 3, 24),
        thickness: raw.thickness === undefined ? undefined : clamp(asNumber(raw.thickness, 4), 0.5, 200)
      }
    }
    case 'svg': {
      const base = baseFields(raw, 'svg') as SvgNode
      const result = sanitizeSvg(raw.svg)
      if (!result.ok) return null
      return { ...base, svg: result.svg, fillColor: raw.fillColor == null ? null : sanitizeColor(raw.fillColor, '#000000'), shadow: sanitizeShadow(raw.shadow) }
    }
    case 'group': {
      const base = baseFields(raw, 'group') as GroupNode
      const children = Array.isArray(raw.children) ? (raw.children as unknown[]).slice(0, LIMITS.MAX_NODES_PER_PAGE).map(sanitizeNode).filter(Boolean) : []
      return { ...base, children: children as SceneNode[], shadow: sanitizeShadow(raw.shadow) }
    }
    default:
      return null
  }
}

export function sanitizePage(raw: unknown, index: number): Page | null {
  if (!isRecord(raw)) return null
  const nodes = (Array.isArray(raw.nodes) ? raw.nodes : [])
    .slice(0, LIMITS.MAX_NODES_PER_PAGE)
    .map(sanitizeNode)
    .filter((n): n is SceneNode => n !== null)
  const background = isRecord(raw.background) ? raw.background : {}
  return {
    id: asString(raw.id) || newId('pg'),
    name: sanitizeText(raw.name, 80) || `Page ${index + 1}`,
    width: clamp(Math.round(asNumber(raw.width, 1080)), 16, LIMITS.MAX_EXPORT_EDGE),
    height: clamp(Math.round(asNumber(raw.height, 1080)), 16, LIMITS.MAX_EXPORT_EDGE),
    background: {
      type: asOneOf(background.type, ['solid', 'gradient', 'image', 'transparent'] as const, 'solid'),
      color: sanitizeColor(background.color, '#FFFFFF'),
      gradient: isRecord(background.gradient) ? sanitizeFill(background.gradient) : undefined,
      imageSrc: isSafeImageSource(background.imageSrc) ? asString(background.imageSrc) : undefined,
      imageOpacity: background.imageOpacity === undefined ? undefined : clamp(asNumber(background.imageOpacity, 1), 0, 1)
    },
    nodes,
    safeArea: raw.safeArea === undefined ? 0 : clamp(asNumber(raw.safeArea, 0), 0, 40)
  }
}

/** Validate + repair an imported project/template document. Throws on garbage. */
export function sanitizeDocument(raw: unknown): DesignDocument {
  if (!isRecord(raw)) throw new Error('Document must be an object')
  const rawPages = Array.isArray(raw.pages) ? raw.pages : []
  const pages = rawPages.slice(0, LIMITS.MAX_PAGES).map(sanitizePage).filter((p): p is Page => p !== null)
  if (pages.length === 0) throw new Error('Document contains no valid pages')
  return { version: DOCUMENT_VERSION, pages }
}

export function sanitizeProjectName(name: unknown, fallback = 'Untitled design'): string {
  return sanitizeFileName(asString(name).trim(), fallback)
}
