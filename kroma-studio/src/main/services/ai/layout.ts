import type { DesignGeneratorOptions, GeneratedElement } from '../../../shared/types/ai'
import type { PageBackground, SceneNode, ShapeNode, TextNode } from '../../../shared/types/document'
import { createShapeNode, createTextNode, gradient, solid } from '../../../shared/utils/document'
import { darken, lighten, readableOn, seededRandom } from '../../../shared/utils/color'
import { round } from '../../../shared/utils/geometry'

export interface LayoutCopy {
  kicker: string
  headline: string
  subheadline: string
  body: string
  cta: string
}

export interface LayoutInput {
  width: number
  height: number
  palette: string[]
  fonts: { headline: string; body: string }
  style: DesignGeneratorOptions['style']
  complexity: DesignGeneratorOptions['complexity']
  background: DesignGeneratorOptions['background']
  copy: LayoutCopy
  seed: number
  /** Slot reserved for an AI/generated hero image (placed by the caller). */
  heroBox?: { x: number; y: number; width: number; height: number } | null
}

export interface LayoutResult {
  nodes: GeneratedElement[]
  background: PageBackground
  archetype: string
  heroBox: { x: number; y: number; width: number; height: number } | null
}

type Archetype = 'hero' | 'split' | 'poster' | 'badge' | 'quote'

const ARCHETYPES: Archetype[] = ['hero', 'split', 'poster', 'badge', 'quote']

const STYLE_WEIGHT: Record<DesignGeneratorOptions['style'], number> = {
  modern: 700,
  vintage: 700,
  minimal: 500,
  bold: 900,
  elegant: 600,
  playful: 800,
  retro: 800,
  corporate: 600,
  neon: 800
}

const STYLE_TRACKING: Record<DesignGeneratorOptions['style'], number> = {
  modern: -1,
  vintage: 2,
  minimal: 1,
  bold: -2,
  elegant: 3,
  playful: -0.5,
  retro: 4,
  corporate: 0,
  neon: 1
}

const weightOf = (style: DesignGeneratorOptions['style']): number => STYLE_WEIGHT[style]
const baseFont = (style: DesignGeneratorOptions['style']): string =>
  style === 'minimal' || style === 'corporate' ? 'Inter' : style === 'elegant' ? 'Georgia' : style === 'retro' || style === 'vintage' ? 'Georgia' : 'Inter'

export function composeLayout(input: LayoutInput): LayoutResult {
  const rand = seededRandom(input.seed || 1)
  const { width: W, height: H } = input
  const unit = Math.min(W, H)
  const palette = normalizePalette(input.palette)
  const [ink, deep, accent, soft, paper] = palette
  const style = input.style
  const fonts = {
    headline: input.fonts.headline || baseFont(style),
    body: input.fonts.body || 'Inter'
  }
  // The archetype is derived from the seed *and* the brief, so changing the
  // style or complexity always yields a visibly different composition.
  const archetype = ARCHETYPES[hashString(`${input.seed}:${style}:${input.complexity}:${W}x${H}`) % ARCHETYPES.length]
  const margin = round(unit * (input.complexity === 'simple' ? 0.1 : 0.08))
  const contentWidth = W - margin * 2
  const nodes: GeneratedElement[] = []
  const background = buildBackground(input, palette)
  const onDark = readableOn(background.type === 'transparent' ? paper : (background.color ?? paper))
  const headlineColor = onDark
  const bodyColor = onDark === '#FFFFFF' ? soft : deep

  const sizes = {
    kicker: Math.max(10, round(unit * 0.028)),
    headline: Math.max(24, round(unit * (style === 'minimal' ? 0.1 : 0.13))),
    sub: Math.max(14, round(unit * 0.042)),
    body: Math.max(12, round(unit * 0.03)),
    cta: Math.max(12, round(unit * 0.032))
  }

  const push = (slot: GeneratedElement['slot'], node: SceneNode, hint?: string): void => {
    nodes.push({ slot, node, regenerationHint: hint })
  }

  let heroBox: LayoutResult['heroBox'] = null

  if (archetype === 'hero') {
    // The copy must always fit between the hero image and the bottom margin,
    // so the stack is measured first and the image/font sizes give way to it.
    const gap = round(unit * 0.03)
    const ctaHeight = input.complexity !== 'simple' ? round(sizes.cta * 2.6) : 0
    const bottomLimit = H - margin - (ctaHeight > 0 ? ctaHeight + gap : 0)

    const wanted = [
      { height: round(sizes.kicker * 2), size: sizes.kicker },
      { height: round(sizes.headline * 2.2), size: sizes.headline },
      { height: round(sizes.sub * 2.4), size: sizes.sub }
    ]
    const total = (k: number, h: number, s: number, withGaps: boolean): number =>
      k + h + s + (withGaps ? gap * 2 : 0)

    let heroHeight = round(H * 0.44)
    const minHero = round(H * 0.22)
    let textTop = margin + heroHeight + round(unit * 0.05)

    const firstOverflow = textTop + total(wanted[0].height, wanted[1].height, wanted[2].height, true) - bottomLimit
    if (firstOverflow > 0) {
      heroHeight = round(heroHeight - Math.min(firstOverflow, Math.max(0, heroHeight - minHero)))
      textTop = margin + heroHeight + round(unit * 0.05)
    }

    const available = Math.max(unit * 0.12, bottomLimit - textTop)
    const wantedTotal = total(wanted[0].height, wanted[1].height, wanted[2].height, true)
    const scale = wantedTotal > available ? Math.max(0.4, available / wantedTotal) : 1

    const kickerH = Math.max(14, round(wanted[0].height * scale))
    const headH = Math.max(28, round(wanted[1].height * scale))
    const subH = Math.max(16, round(wanted[2].height * scale))
    const scaledSizes = {
      ...sizes,
      kicker: Math.max(9, round(sizes.kicker * scale)),
      headline: Math.max(18, round(sizes.headline * scale)),
      sub: Math.max(11, round(sizes.sub * scale))
    }

    const stackTop = Math.max(margin, Math.min(textTop, bottomLimit - total(kickerH, headH, subH, true)))
    heroBox = {
      x: margin,
      y: margin,
      width: contentWidth,
      height: Math.max(minHero, round(stackTop - margin - round(unit * 0.05)))
    }

    push('kicker', kickerNode(input, fonts, scaledSizes, accent, margin, stackTop, contentWidth))
    push(
      'headline',
      text({
        text: input.copy.headline,
        x: margin,
        y: round(stackTop + kickerH + gap),
        width: contentWidth,
        height: headH,
        fontSize: scaledSizes.headline,
        color: headlineColor,
        family: fonts.headline,
        weight: weightOf(style),
        letterSpacing: STYLE_TRACKING[style],
        name: 'Headline'
      })
    )
    push(
      'subheadline',
      text({
        text: input.copy.subheadline,
        x: margin,
        y: round(stackTop + kickerH + gap + headH + gap),
        width: contentWidth,
        height: subH,
        fontSize: scaledSizes.sub,
        color: bodyColor,
        family: fonts.body,
        weight: 400,
        name: 'Subheadline'
      })
    )
    if (input.complexity !== 'simple' && ctaHeight > 0) {
      push('cta', ctaNode(input, fonts, sizes, accent, margin, bottomLimit + gap, contentWidth))
      push('decoration', accentBar(margin, margin, unit, accent))
    }
  } else if (archetype === 'split') {
    const panelWidth = round(W * 0.46)
    heroBox = { x: 0, y: 0, width: panelWidth, height: H }
    push('accent', shape('rect', 0, 0, panelWidth, H, gradient([{ color: accent, offset: 0 }, { color: deep, offset: 1 }], 135), 'Panel'))
    const textX = panelWidth + margin
    const textWidth = W - textX - margin
    const centerY = H / 2 - sizes.headline * 1.6
    push('kicker', kickerNode(input, fonts, sizes, accent, textX, centerY - sizes.kicker * 2.4, textWidth))
    push(
      'headline',
      text({
        text: input.copy.headline,
        x: textX,
        y: centerY,
        width: textWidth,
        height: round(sizes.headline * 3),
        fontSize: sizes.headline,
        color: headlineColor,
        family: fonts.headline,
        weight: weightOf(style),
        align: 'left',
        letterSpacing: STYLE_TRACKING[style],
        name: 'Headline'
      })
    )
    push(
      'body',
      text({
        text: input.copy.body,
        x: textX,
        y: centerY + sizes.headline * 3 + unit * 0.02,
        width: textWidth,
        height: round(sizes.body * 4),
        fontSize: sizes.body,
        color: bodyColor,
        family: fonts.body,
        weight: 400,
        align: 'left',
        lineHeight: 1.5,
        name: 'Body'
      })
    )
    push('cta', ctaNode(input, fonts, sizes, accent, textX, centerY + sizes.headline * 3 + sizes.body * 4 + unit * 0.06, Math.min(textWidth, unit * 0.6)))
  } else if (archetype === 'poster') {
    const baseTop = round(H * 0.62)
    heroBox = { x: 0, y: 0, width: W, height: baseTop }
    push('accent', shape('rect', 0, baseTop, W, H - baseTop, solid(ink), 'Poster base'))

    // Fit headline + subheadline into the lower band of the poster.
    const gap = round(unit * 0.02)
    const top = round(baseTop + unit * 0.04)
    const bottom = H - margin
    const headBand = round(sizes.headline * 2.4)
    const subBand = round(sizes.sub * 2)
    const wanted = headBand + gap + subBand
    const available = Math.max(unit * 0.1, bottom - top)
    const scale = wanted > available ? Math.max(0.4, available / wanted) : 1
    const headH = Math.max(28, round(headBand * scale))
    const subH = Math.max(16, round(subBand * scale))
    const stackTop = Math.max(baseTop + 4, Math.min(top, bottom - (headH + gap + subH)))

    push(
      'headline',
      text({
        text: input.copy.headline,
        x: margin,
        y: round(stackTop),
        width: contentWidth,
        height: headH,
        fontSize: Math.max(18, Math.round(sizes.headline * 1.15 * scale)),
        color: paper,
        family: fonts.headline,
        weight: 900,
        letterSpacing: STYLE_TRACKING[style] - 1,
        name: 'Headline'
      })
    )
    push(
      'subheadline',
      text({
        text: input.copy.subheadline,
        x: margin,
        y: round(stackTop + headH + gap),
        width: contentWidth,
        height: subH,
        fontSize: Math.max(11, round(sizes.sub * scale)),
        color: soft,
        family: fonts.body,
        weight: 400,
        name: 'Subheadline'
      })
    )
    push('decoration', shape('rect', margin, baseTop - unit * 0.012, unit * 0.5, unit * 0.012, solid(accent), 'Rule'))
  } else if (archetype === 'badge') {
    const badge = round(unit * 0.3)
    heroBox = { x: (W - badge) / 2, y: margin, width: badge, height: badge }
    push('accent', shape('circle', (W - badge) / 2, margin, badge, badge, gradient([{ color: accent, offset: 0 }, { color: deep, offset: 1 }], 90), 'Badge'))
    push(
      'kicker',
      text({
        text: input.copy.kicker,
        x: (W - badge) / 2,
        y: margin + badge / 2 - sizes.kicker,
        width: badge,
        height: round(sizes.kicker * 2),
        fontSize: sizes.kicker,
        color: readableOn(accent),
        family: fonts.body,
        weight: 700,
        letterSpacing: 3,
        name: 'Kicker'
      })
    )
    const textTop = margin + badge + unit * 0.06
    push(
      'headline',
      text({
        text: input.copy.headline,
        x: margin,
        y: textTop,
        width: contentWidth,
        height: round(sizes.headline * 2.4),
        fontSize: sizes.headline,
        color: headlineColor,
        family: fonts.headline,
        weight: weightOf(style),
        name: 'Headline'
      })
    )
    push(
      'body',
      text({
        text: input.copy.body,
        x: margin + contentWidth * 0.1,
        y: textTop + sizes.headline * 2.4,
        width: contentWidth * 0.8,
        height: round(sizes.body * 3.4),
        fontSize: sizes.body,
        color: bodyColor,
        family: fonts.body,
        weight: 400,
        lineHeight: 1.5,
        name: 'Body'
      })
    )
    if (input.complexity === 'rich') push('decoration', dotField(W, H, margin, accent, rand))
  } else {
    // quote — minimal, framed
    push('accent', frame(margin * 0.6, margin * 0.6, W - margin * 1.2, H - margin * 1.2, accent, 2))
    push(
      'headline',
      text({
        text: input.copy.headline,
        x: margin * 2,
        y: H / 2 - sizes.headline * 1.8,
        width: W - margin * 4,
        height: round(sizes.headline * 3),
        fontSize: sizes.headline,
        color: headlineColor,
        family: fonts.headline,
        weight: weightOf(style),
        lineHeight: 1.2,
        name: 'Headline'
      })
    )
    push(
      'subheadline',
      text({
        text: input.copy.subheadline,
        x: margin * 2,
        y: H / 2 + sizes.headline * 1.4,
        width: W - margin * 4,
        height: round(sizes.sub * 2.2),
        fontSize: sizes.sub,
        color: bodyColor,
        family: fonts.body,
        weight: 400,
        name: 'Subheadline'
      })
    )
    heroBox = null
  }

  return { nodes: fitToPage(nodes, W, H), background, archetype, heroBox }
}

/* ------------------------------- helpers ------------------------------- */

/** FNV-1a string hash — stable across processes, used for archetype selection. */
function hashString(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/**
 * Safety net: whatever the archetype produced, no element is ever allowed to
 * sit outside the page. Elements are nudged inside and, if they are simply too
 * tall or wide for the canvas, trimmed rather than left hanging off the edge.
 */
function fitToPage(nodes: GeneratedElement[], width: number, height: number): GeneratedElement[] {
  return nodes.map((element) => {
    const node = element.node
    const w = Math.min(node.width, width)
    const h = Math.min(node.height, height)
    const x = Math.max(0, Math.min(node.x, width - w))
    const y = Math.max(0, Math.min(node.y, height - h))
    if (x === node.x && y === node.y && w === node.width && h === node.height) return element
    return {
      ...element,
      node: { ...node, x: round(x), y: round(y), width: round(w), height: round(h) } as SceneNode
    }
  })
}

function normalizePalette(palette: string[]): [string, string, string, string, string] {
  const base = [...palette]
  while (base.length < 5) base.push(base[base.length - 1] ?? '#7C5CFF')
  const [a, b, c, d, e] = base.slice(0, 5)
  return [a, b, c, d, e]
}

function buildBackground(input: LayoutInput, palette: string[]): PageBackground {
  const [ink, deep, accent, , paper] = palette
  switch (input.background) {
    case 'transparent':
      return { type: 'transparent', color: 'transparent' }
    case 'gradient':
      return {
        type: 'gradient',
        color: ink,
        gradient: gradient(
          [
            { color: input.style === 'neon' ? '#05010F' : ink, offset: 0 },
            { color: deep, offset: 0.6 },
            { color: darken(accent, 0.35), offset: 1 }
          ],
          135
        )
      }
    case 'pattern':
      return { type: 'solid', color: ink }
    case 'image':
      return { type: 'solid', color: ink }
    case 'solid':
    default:
      return { type: 'solid', color: input.style === 'minimal' || input.style === 'corporate' ? paper : ink }
  }
}

interface TextArgs {
  text: string
  x: number
  y: number
  width: number
  height: number
  fontSize: number
  color: string
  family: string
  weight: number
  align?: 'left' | 'center' | 'right'
  letterSpacing?: number
  lineHeight?: number
  name: string
}

function text(args: TextArgs): TextNode {
  return createTextNode({
    name: args.name,
    text: args.text,
    x: round(args.x),
    y: round(args.y),
    width: round(args.width),
    height: round(args.height),
    fontSize: args.fontSize,
    fontFamily: args.family,
    fontWeight: args.weight,
    align: args.align ?? 'center',
    letterSpacing: args.letterSpacing ?? 0,
    lineHeight: args.lineHeight ?? 1.2,
    fill: solid(args.color),
    boxMode: 'fixed'
  })
}

function shape(kind: ShapeNode['shape'], x: number, y: number, width: number, height: number, fill: TextNode['fill'], name: string): ShapeNode {
  return createShapeNode(kind, { name, x: round(x), y: round(y), width: round(width), height: round(height), fill })
}

function kickerNode(input: LayoutInput, fonts: { body: string }, sizes: { kicker: number }, accent: string, x: number, y: number, width: number): TextNode {
  return text({
    text: input.copy.kicker.toUpperCase(),
    x,
    y,
    width,
    height: sizes.kicker * 2,
    fontSize: sizes.kicker,
    color: accent,
    family: fonts.body,
    weight: 700,
    letterSpacing: 4,
    name: 'Kicker'
  })
}

function ctaNode(input: LayoutInput, fonts: { body: string }, sizes: { cta: number }, accent: string, x: number, y: number, width: number): SceneNode {
  const label = input.copy.cta
  const pillWidth = Math.min(width, Math.max(180, label.length * sizes.cta * 0.72 + sizes.cta * 2.4))
  const groupX = input.copy.cta ? x + (width - pillWidth) / 2 : x
  return createShapeNode('pill', {
    name: 'Call to action',
    x: round(groupX),
    y: round(y),
    width: round(pillWidth),
    height: round(sizes.cta * 2.6),
    fill: solid(accent),
    shadow: { color: '#000000', blur: 18, offsetX: 0, offsetY: 8, opacity: 0.25 },
    meta: { ctaText: label, fontFamily: fonts.body }
  })
}

function accentBar(x: number, y: number, unit: number, accent: string): ShapeNode {
  return shape('rect', x, y - unit * 0.04, unit * 0.22, unit * 0.012, solid(accent), 'Accent rule')
}

function frame(x: number, y: number, width: number, height: number, color: string, thickness: number): ShapeNode {
  return createShapeNode('rect', {
    name: 'Frame',
    x: round(x),
    y: round(y),
    width: round(width),
    height: round(height),
    fill: { type: 'solid', color: '#00000000' },
    stroke: { color, width: thickness, align: 'inside' }
  })
}

function dotField(width: number, height: number, margin: number, accent: string, rand: () => number): ShapeNode {
  const size = Math.max(6, Math.min(width, height) * 0.02)
  const x = margin + rand() * (width - margin * 2 - size)
  const y = margin + rand() * (height - margin * 2 - size)
  return shape('circle', x, y, size, size, solid(lighten(accent, 0.3)), 'Dot accent')
}
