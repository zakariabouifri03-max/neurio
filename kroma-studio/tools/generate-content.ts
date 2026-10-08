/**
 * Builds the shipped content: `resources/templates/*.json` and
 * `resources/samples/*.json`, using the same document builders and sanitiser the
 * app uses at runtime — so bundled content is always schema-valid.
 *
 * Run with:  npm run content
 */
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { DOCUMENT_VERSION, TEMPLATE_CATEGORIES } from '../src/shared/constants'
import { createShapeNode, createTextNode, gradient, solid } from '../src/shared/utils/document'
import type { DesignDocument, Page, PageBackground, SceneNode, ShapeKind } from '../src/shared/types/document'
import { sanitizeDocument } from '../src/shared/utils/validation'
import { CURATED_PALETTES } from '../src/shared/utils/color'

/** Run from the package root (`npm run content`), so cwd is the app folder. */
const root = process.cwd()
const templatesDir = join(root, 'resources', 'templates')
const samplesDir = join(root, 'resources', 'samples')

for (const dir of [templatesDir, samplesDir]) {
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
}

type Size = { width: number; height: number }

const text = (
  value: string,
  options: Partial<{
    x: number
    y: number
    width: number
    height: number
    fontSize: number
    fontWeight: number
    letterSpacing: number
    lineHeight: number
    align: 'left' | 'center' | 'right'
    color: string
    fontFamily: string
    italic: boolean
    name: string
    valign: 'top' | 'middle' | 'bottom'
    opacity: number
    curveKind: 'none' | 'arc' | 'arcReverse' | 'wave' | 'circle' | 'valley'
    curveAmount: number
  }> = {}
): SceneNode =>
  createTextNode({
    opacity: options.opacity ?? 1,
    curve: options.curveKind && options.curveKind !== 'none' ? { kind: options.curveKind, amount: options.curveAmount ?? 40 } : null,
    name: options.name ?? 'Text',
    text: value,
    x: options.x ?? 0,
    y: options.y ?? 0,
    width: options.width ?? 600,
    height: options.height ?? (options.fontSize ?? 40) * 1.6,
    fontSize: options.fontSize ?? 40,
    fontWeight: options.fontWeight ?? 700,
    letterSpacing: options.letterSpacing ?? 0,
    lineHeight: options.lineHeight ?? 1.2,
    align: options.align ?? 'center',
    valign: options.valign ?? 'middle',
    fontFamily: options.fontFamily ?? 'Inter',
    italic: options.italic ?? false,
    fill: solid(options.color ?? '#FFFFFF')
  })

const shape = (
  kind: ShapeKind,
  options: Partial<{
    x: number
    y: number
    width: number
    height: number
    color: string
    cornerRadius: number
    opacity: number
    rotation: number
    name: string
    points: number
    strokeColor: string
    strokeWidth: number
    fill: ReturnType<typeof solid>
    shadow: boolean
  }> = {}
): SceneNode =>
  createShapeNode(kind, {
    name: options.name ?? kind,
    x: options.x ?? 0,
    y: options.y ?? 0,
    width: options.width ?? 200,
    height: options.height ?? 200,
    rotation: options.rotation ?? 0,
    opacity: options.opacity ?? 1,
    cornerRadius: options.cornerRadius ?? 0,
    points: options.points,
    fill: options.fill ?? solid(options.color ?? '#7C5CFF'),
    stroke: options.strokeColor ? { color: options.strokeColor, width: options.strokeWidth ?? 3, align: 'outside' } : null,
    shadow: options.shadow ? { color: '#000000', blur: 28, offsetX: 0, offsetY: 12, opacity: 0.28 } : undefined
  })

const page = (size: Size, nodes: SceneNode[], background: PageBackground, name = 'Page 1'): Page => ({
  id: `pg_${slug(name)}`,
  name,
  width: size.width,
  height: size.height,
  background,
  nodes,
  safeArea: 0
})

const doc = (pages: Page[]): DesignDocument => sanitizeDocument({ version: DOCUMENT_VERSION, pages })

const slug = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')

const palette = (id: string): string[] => CURATED_PALETTES.find((entry) => entry.id === id)?.colors ?? CURATED_PALETTES[0].colors

interface TemplateSpec {
  id: string
  name: string
  category: (typeof TEMPLATE_CATEGORIES)[number]
  size: Size
  description: string
  tags: string[]
  build: (size: Size) => { background: PageBackground; nodes: SceneNode[] }
}

const TEMPLATES: TemplateSpec[] = [
  {
    id: 'yt-thumbnail-bold',
    name: 'YouTube Thumbnail — Bold React',
    category: 'YouTube',
    size: { width: 1280, height: 720 },
    description: 'High-contrast thumbnail with a headline slab and kicker.',
    tags: ['youtube', 'video', 'bold'],
    build: (size) => {
      const [ink, , accent, soft, paper] = palette('midnight')
      const [w, h] = [size.width, size.height]
      return {
        background: { type: 'gradient', color: ink, gradient: gradient([{ color: ink, offset: 0 }, { color: '#2B2D63', offset: 1 }], 135) },
        nodes: [
          shape('rect', { name: 'Frame', x: 0, y: 0, width: w, height: h, fill: solid('#00000000'), strokeColor: accent, strokeWidth: 8 }),
          shape('circle', { name: 'Glow', x: w * 0.62, y: h * 0.1, width: h * 0.9, height: h * 0.9, fill: gradient([{ color: accent, offset: 0 }, { color: '#00000000', offset: 1 }], 90), opacity: 0.55 }),
          text('WAIT…', { name: 'Kicker', x: w * 0.06, y: h * 0.16, width: w * 0.44, fontSize: Math.round(h * 0.07), fontWeight: 900, letterSpacing: 6, align: 'left', color: accent }),
          text('THIS CHANGED\nEVERYTHING', {
            name: 'Headline',
            x: w * 0.06,
            y: h * 0.28,
            width: w * 0.56,
            height: h * 0.42,
            fontSize: Math.round(h * 0.15),
            fontWeight: 900,
            lineHeight: 0.98,
            letterSpacing: -3,
            align: 'left',
            color: paper
          }),
          text('Full breakdown inside', { name: 'Sub', x: w * 0.06, y: h * 0.72, width: w * 0.5, fontSize: Math.round(h * 0.05), fontWeight: 500, align: 'left', color: soft }),
          shape('pill', { name: 'Arrow bar', x: w * 0.06, y: h * 0.84, width: w * 0.22, height: h * 0.08, fill: solid(accent) })
        ]
      }
    }
  },
  {
    id: 'yt-thumbnail-minimal',
    name: 'YouTube Thumbnail — Clean Cut',
    category: 'YouTube',
    size: { width: 1280, height: 720 },
    description: 'Minimal thumbnail with a large serif headline and rule.',
    tags: ['youtube', 'minimal'],
    build: (size) => {
      const [w, h] = [size.width, size.height]
      const [, deep, accent] = palette('mono')
      return {
        background: { type: 'solid', color: '#F5F3FF' },
        nodes: [
          shape('rect', { name: 'Accent rule', x: w * 0.08, y: h * 0.2, width: w * 0.16, height: h * 0.012, fill: solid(accent) }),
          text('The quiet\nupgrade', {
            name: 'Headline',
            x: w * 0.08,
            y: h * 0.26,
            width: w * 0.6,
            height: h * 0.44,
            fontSize: Math.round(h * 0.16),
            fontWeight: 600,
            lineHeight: 1.02,
            letterSpacing: -3,
            align: 'left',
            color: '#111111',
            fontFamily: 'Georgia'
          }),
          text('Episode 42', { name: 'Label', x: w * 0.08, y: h * 0.76, width: w * 0.5, fontSize: Math.round(h * 0.045), fontWeight: 700, letterSpacing: 4, align: 'left', color: deep }),
          shape('circle', { name: 'Dot', x: w * 0.78, y: h * 0.32, width: h * 0.36, height: h * 0.36, fill: gradient([{ color: accent, offset: 0 }, { color: '#C9B8FF', offset: 1 }], 90) })
        ]
      }
    }
  },
  {
    id: 'ig-post-quote',
    name: 'Instagram Post — Quote Card',
    category: 'Instagram',
    size: { width: 1080, height: 1080 },
    description: 'Centred quote card with generous typography.',
    tags: ['instagram', 'quote', 'minimal'],
    build: (size) => {
      const w = size.width
      const [, , accent, , paper] = palette('mono')
      return {
        background: { type: 'solid', color: '#0B0B0C' },
        nodes: [
          shape('rect', { name: 'Frame', x: w * 0.08, y: w * 0.08, width: w * 0.84, height: w * 0.84, fill: solid('#00000000'), strokeColor: accent, strokeWidth: 3 }),
          text('“Design is\nintelligence\nmade visible.”', {
            name: 'Quote',
            x: w * 0.16,
            y: w * 0.28,
            width: w * 0.68,
            height: w * 0.42,
            fontSize: Math.round(w * 0.085),
            fontWeight: 500,
            lineHeight: 1.28,
            align: 'center',
            color: paper,
            fontFamily: 'Georgia',
            italic: true
          }),
          text('STUDIO NOTES', { name: 'Footer', x: w * 0.16, y: w * 0.74, width: w * 0.68, fontSize: Math.round(w * 0.028), fontWeight: 700, letterSpacing: 8, color: accent })
        ]
      }
    }
  },
  {
    id: 'ig-post-promo',
    name: 'Instagram Post — Promo Drop',
    category: 'Instagram',
    size: { width: 1080, height: 1080 },
    description: 'Sale announcement with badge and price band.',
    tags: ['instagram', 'promo', 'sale'],
    build: (size) => {
      const w = size.width
      const [, , accent, soft, paper] = palette('candy')
      return {
        background: { type: 'gradient', color: '#FF4FA3', gradient: gradient([{ color: '#FF4FA3', offset: 0 }, { color: '#6C5CE7', offset: 1 }], 135) },
        nodes: [
          shape('circle', { name: 'Badge', x: w * 0.62, y: w * 0.08, width: w * 0.3, height: w * 0.3, fill: solid('#FFF8F0'), shadow: true }),
          text('50%', { name: 'Badge text', x: w * 0.62, y: w * 0.19, width: w * 0.3, height: w * 0.1, fontSize: Math.round(w * 0.09), fontWeight: 900, color: '#FF4FA3' }),
          text('MID-SEASON\nDROP', {
            name: 'Headline',
            x: w * 0.08,
            y: w * 0.44,
            width: w * 0.84,
            height: w * 0.26,
            fontSize: Math.round(w * 0.13),
            fontWeight: 900,
            lineHeight: 1,
            letterSpacing: -3,
            color: paper
          }),
          text('This weekend only · free shipping over $60', {
            name: 'Sub',
            x: w * 0.1,
            y: w * 0.72,
            width: w * 0.8,
            fontSize: Math.round(w * 0.032),
            fontWeight: 500,
            color: soft
          }),
          shape('pill', { name: 'CTA', x: w * 0.28, y: w * 0.82, width: w * 0.44, height: w * 0.1, fill: solid('#FFF8F0'), shadow: true }),
          text('SHOP THE DROP', { name: 'CTA text', x: w * 0.28, y: w * 0.85, width: w * 0.44, height: w * 0.05, fontSize: Math.round(w * 0.032), fontWeight: 800, letterSpacing: 2, color: accent })
        ]
      }
    }
  },
  {
    id: 'ig-story-launch',
    name: 'Instagram Story — Launch',
    category: 'Instagram',
    size: { width: 1080, height: 1920 },
    description: 'Vertical story with a stacked headline and CTA pill.',
    tags: ['story', 'launch', 'vertical'],
    build: (size) => {
      const [w, h] = [size.width, size.height]
      const [ink, , accent, soft, paper] = palette('midnight')
      return {
        background: { type: 'gradient', color: ink, gradient: gradient([{ color: '#0F1024', offset: 0 }, { color: '#2B2D63', offset: 1 }], 160) },
        nodes: [
          shape('circle', { name: 'Halo', x: w * 0.18, y: h * 0.2, width: w * 0.72, height: w * 0.72, fill: gradient([{ color: accent, offset: 0 }, { color: '#00000000', offset: 1 }], 90), opacity: 0.7 }),
          text('NEW', { name: 'Kicker', x: w * 0.1, y: h * 0.5, width: w * 0.8, fontSize: Math.round(w * 0.05), fontWeight: 800, letterSpacing: 12, color: accent }),
          text('Studio 2.0\nis live', {
            name: 'Headline',
            x: w * 0.08,
            y: h * 0.55,
            width: w * 0.84,
            height: h * 0.16,
            fontSize: Math.round(w * 0.135),
            fontWeight: 900,
            lineHeight: 1.02,
            letterSpacing: -3,
            color: paper
          }),
          text('Faster exports, new AI layouts and a rebuilt text engine.', {
            name: 'Body',
            x: w * 0.12,
            y: h * 0.72,
            width: w * 0.76,
            height: h * 0.07,
            fontSize: Math.round(w * 0.038),
            fontWeight: 400,
            lineHeight: 1.4,
            color: soft
          }),
          shape('pill', { name: 'CTA', x: w * 0.2, y: h * 0.83, width: w * 0.6, height: h * 0.055, fill: solid(accent) }),
          text('Try it free', { name: 'CTA text', x: w * 0.2, y: h * 0.845, width: w * 0.6, height: h * 0.03, fontSize: Math.round(w * 0.04), fontWeight: 800, color: '#FFFFFF' })
        ]
      }
    }
  },
  {
    id: 'tiktok-cover',
    name: 'TikTok Cover — Neon',
    category: 'TikTok',
    size: { width: 1080, height: 1920 },
    description: 'Neon vertical cover with glow shapes.',
    tags: ['tiktok', 'neon', 'vertical'],
    build: (size) => {
      const [w, h] = [size.width, size.height]
      const [ink, , accent, , paper] = palette('neon')
      return {
        background: { type: 'solid', color: ink },
        nodes: [
          shape('rect', { name: 'Glow band', x: 0, y: h * 0.36, width: w, height: h * 0.28, fill: gradient([{ color: accent, offset: 0 }, { color: '#FF2EC4', offset: 1 }], 90), opacity: 0.9 }),
          text('NIGHT\nMODE', {
            name: 'Headline',
            x: w * 0.06,
            y: h * 0.38,
            width: w * 0.88,
            height: h * 0.2,
            fontSize: Math.round(w * 0.19),
            fontWeight: 900,
            lineHeight: 0.95,
            letterSpacing: -4,
            color: paper
          }),
          text('part 3 · the finale', { name: 'Sub', x: w * 0.06, y: h * 0.66, width: w * 0.88, fontSize: Math.round(w * 0.05), fontWeight: 600, letterSpacing: 4, color: accent }),
          shape('star', { name: 'Sparkle', x: w * 0.72, y: h * 0.18, width: w * 0.24, height: w * 0.24, fill: solid('#FF2EC4'), points: 8 })
        ]
      }
    }
  },
  {
    id: 'fb-event',
    name: 'Facebook Event Cover',
    category: 'Facebook',
    size: { width: 1200, height: 630 },
    description: 'Event cover with date block and title.',
    tags: ['facebook', 'event'],
    build: (size) => {
      const [w, h] = [size.width, size.height]
      const [, deep, accent, , paper] = palette('ocean')
      return {
        background: { type: 'gradient', color: deep, gradient: gradient([{ color: '#03045E', offset: 0 }, { color: '#0077B6', offset: 1 }], 90) },
        nodes: [
          shape('rect', { name: 'Date block', x: w * 0.07, y: h * 0.22, width: w * 0.16, height: h * 0.56, fill: solid(paper), cornerRadius: 4 }),
          text('12\nSEP', { name: 'Date', x: w * 0.07, y: h * 0.32, width: w * 0.16, height: h * 0.3, fontSize: Math.round(h * 0.16), fontWeight: 900, lineHeight: 1, color: deep }),
          text('SUMMER\nSOUND\nFESTIVAL', {
            name: 'Title',
            x: w * 0.29,
            y: h * 0.2,
            width: w * 0.64,
            height: h * 0.5,
            fontSize: Math.round(h * 0.13),
            fontWeight: 900,
            lineHeight: 1,
            letterSpacing: -2,
            align: 'left',
            color: paper
          }),
          text('Harbour Stage · 8pm · All ages', {
            name: 'Details',
            x: w * 0.29,
            y: h * 0.74,
            width: w * 0.64,
            fontSize: Math.round(h * 0.05),
            fontWeight: 500,
            align: 'left',
            color: accent
          })
        ]
      }
    }
  },
  {
    id: 'poster-modern',
    name: 'Poster — Modern Exhibition',
    category: 'Posters',
    size: { width: 1080, height: 1440 },
    description: 'Editorial poster with grid rules and rotated label.',
    tags: ['poster', 'editorial'],
    build: (size) => {
      const [w, h] = [size.width, size.height]
      const [ink, , accent, soft, paper] = palette('mono')
      return {
        background: { type: 'solid', color: paper },
        nodes: [
          shape('rect', { name: 'Bar', x: w * 0.08, y: h * 0.08, width: w * 0.84, height: h * 0.006, fill: solid(ink) }),
          text('KROMA', { name: 'Brand', x: w * 0.08, y: h * 0.1, width: w * 0.3, fontSize: Math.round(w * 0.03), fontWeight: 800, letterSpacing: 6, align: 'left', color: ink }),
          text('FORM\n&\nSIGNAL', {
            name: 'Title',
            x: w * 0.08,
            y: h * 0.24,
            width: w * 0.84,
            height: h * 0.34,
            fontSize: Math.round(w * 0.19),
            fontWeight: 900,
            lineHeight: 0.92,
            letterSpacing: -6,
            align: 'left',
            color: ink
          }),
          shape('rect', { name: 'Accent', x: w * 0.08, y: h * 0.6, width: w * 0.28, height: h * 0.008, fill: solid(accent) }),
          text('A group exhibition of graphic systems,\ntype experiments and printed matter.\n12 Oct — 30 Nov, Hall B.', {
            name: 'Body',
            x: w * 0.08,
            y: h * 0.65,
            width: w * 0.7,
            height: h * 0.16,
            fontSize: Math.round(w * 0.028),
            fontWeight: 400,
            lineHeight: 1.6,
            align: 'left',
            color: soft
          }),
          text('ADMISSION FREE', { name: 'Footer', x: w * 0.08, y: h * 0.9, width: w * 0.84, fontSize: Math.round(w * 0.026), fontWeight: 700, letterSpacing: 6, align: 'left', color: ink })
        ]
      }
    }
  },
  {
    id: 'flyer-cafe',
    name: 'Flyer — Weekend Café',
    category: 'Flyers',
    size: { width: 1080, height: 1440 },
    description: 'Warm flyer with offer block and menu lines.',
    tags: ['flyer', 'food', 'warm'],
    build: (size) => {
      const [w, h] = [size.width, size.height]
      const [ink, , accent, soft, paper] = palette('earth')
      return {
        background: { type: 'solid', color: paper },
        nodes: [
          shape('rect', { name: 'Header band', x: 0, y: 0, width: w, height: h * 0.22, fill: solid(ink) }),
          text('WEEKEND\nBREAKFAST', {
            name: 'Title',
            x: w * 0.08,
            y: h * 0.05,
            width: w * 0.84,
            height: h * 0.16,
            fontSize: Math.round(w * 0.11),
            fontWeight: 800,
            lineHeight: 1.02,
            letterSpacing: -2,
            color: paper
          }),
          text('2 for 1 on all pastries', {
            name: 'Offer',
            x: w * 0.08,
            y: h * 0.28,
            width: w * 0.84,
            fontSize: Math.round(w * 0.062),
            fontWeight: 700,
            color: accent
          }),
          text('Saturday & Sunday · 8am – 11am\nFresh sourdough, single-origin filter,\nand the cinnamon knot you keep asking for.', {
            name: 'Body',
            x: w * 0.08,
            y: h * 0.38,
            width: w * 0.84,
            height: h * 0.2,
            fontSize: Math.round(w * 0.034),
            fontWeight: 400,
            lineHeight: 1.7,
            color: ink
          }),
          shape('circle', { name: 'Seal', x: w * 0.66, y: h * 0.62, width: w * 0.26, height: w * 0.26, fill: solid(accent) }),
          text('LOCAL\n& LOVED', { name: 'Seal text', x: w * 0.66, y: h * 0.7, width: w * 0.26, height: w * 0.1, fontSize: Math.round(w * 0.035), fontWeight: 800, lineHeight: 1.2, color: paper }),
          text('14 Rosewood Lane · Open daily 7am – 4pm', {
            name: 'Footer',
            x: w * 0.08,
            y: h * 0.9,
            width: w * 0.84,
            fontSize: Math.round(w * 0.026),
            fontWeight: 500,
            letterSpacing: 1,
            color: soft
          })
        ]
      }
    }
  },
  {
    id: 'business-card',
    name: 'Business Card — Studio',
    category: 'Business',
    size: { width: 1050, height: 600 },
    description: 'Double-sided style card with mark and contact block.',
    tags: ['business', 'card'],
    build: (size) => {
      const [w, h] = [size.width, size.height]
      const [ink, deep, accent, soft, paper] = palette('midnight')
      return {
        background: { type: 'solid', color: paper },
        nodes: [
          shape('rect', { name: 'Edge', x: 0, y: 0, width: w * 0.035, height: h, fill: solid(accent) }),
          text('KROMA', { name: 'Mark', x: w * 0.09, y: h * 0.16, width: w * 0.5, fontSize: Math.round(h * 0.16), fontWeight: 900, letterSpacing: -1, align: 'left', color: ink }),
          text('DESIGN STUDIO', { name: 'Tag', x: w * 0.095, y: h * 0.36, width: w * 0.5, fontSize: Math.round(h * 0.045), fontWeight: 700, letterSpacing: 6, align: 'left', color: accent }),
          shape('rect', { name: 'Rule', x: w * 0.09, y: h * 0.52, width: w * 0.3, height: h * 0.006, fill: solid(soft) }),
          text('Amara Vance\nCreative Director\namara@kroma.studio', {
            name: 'Contact',
            x: w * 0.09,
            y: h * 0.58,
            width: w * 0.5,
            height: h * 0.3,
            fontSize: Math.round(h * 0.05),
            fontWeight: 500,
            lineHeight: 1.7,
            align: 'left',
            color: deep
          }),
          shape('circle', { name: 'Dot', x: w * 0.74, y: h * 0.3, width: h * 0.4, height: h * 0.4, fill: gradient([{ color: accent, offset: 0 }, { color: '#C9B8FF', offset: 1 }], 90) })
        ]
      }
    }
  },
  {
    id: 'tshirt-raccoon',
    name: 'T-Shirt — Halloween Raccoon',
    category: 'T-Shirts',
    size: { width: 4500, height: 5400 },
    description: 'Vintage badge tee with arched headline.',
    tags: ['tshirt', 'halloween', 'vintage'],
    build: (size) => {
      const w = size.width
      const [ink, deep, accent, soft, paper] = palette('halloween')
      return {
        background: { type: 'transparent', color: '#00000000' },
        nodes: [
          shape('circle', { name: 'Badge ring', x: w * 0.14, y: w * 0.42, width: w * 0.72, height: w * 0.72, fill: solid('#00000000'), strokeColor: accent, strokeWidth: Math.round(w * 0.012) }),
          shape('circle', { name: 'Inner disc', x: w * 0.19, y: w * 0.47, width: w * 0.62, height: w * 0.62, fill: solid(ink) }),
          text('MIDNIGHT SNACKS', {
            name: 'Arch top',
            x: w * 0.14,
            y: w * 0.44,
            width: w * 0.72,
            height: w * 0.22,
            fontSize: Math.round(w * 0.075),
            fontWeight: 800,
            letterSpacing: Math.round(w * 0.008),
            color: paper,
            curveKind: 'arc'
          }),
          text('EST. 1993', {
            name: 'Arch bottom',
            x: w * 0.14,
            y: w * 0.82,
            width: w * 0.72,
            height: w * 0.2,
            fontSize: Math.round(w * 0.055),
            fontWeight: 800,
            letterSpacing: Math.round(w * 0.006),
            color: soft,
            curveKind: 'arcReverse'
          }),
          shape('circle', { name: 'Snout', x: w * 0.42, y: w * 0.62, width: w * 0.16, height: w * 0.16, fill: solid(soft) }),
          shape('circle', { name: 'Ear left', x: w * 0.33, y: w * 0.53, width: w * 0.12, height: w * 0.12, fill: solid(deep) }),
          shape('circle', { name: 'Ear right', x: w * 0.55, y: w * 0.53, width: w * 0.12, height: w * 0.12, fill: solid(deep) }),
          text('RACCOON\nCREW', {
            name: 'Centre',
            x: w * 0.24,
            y: w * 0.7,
            width: w * 0.52,
            height: w * 0.16,
            fontSize: Math.round(w * 0.07),
            fontWeight: 900,
            lineHeight: 1,
            letterSpacing: -2,
            color: accent
          })
        ]
      }
    }
  },
  {
    id: 'logo-monogram',
    name: 'Logo — Monogram Mark',
    category: 'Logos',
    size: { width: 1000, height: 1000 },
    description: 'Geometric monogram with wordmark lockup.',
    tags: ['logo', 'brand', 'mark'],
    build: (size) => {
      const w = size.width
      const [ink, , accent, , paper] = palette('midnight')
      return {
        background: { type: 'transparent', color: '#00000000' },
        nodes: [
          shape('rect', { name: 'Mark', x: w * 0.2, y: w * 0.16, width: w * 0.6, height: w * 0.6, fill: solid(accent), cornerRadius: 18 }),
          text('KV', { name: 'Monogram', x: w * 0.2, y: w * 0.36, width: w * 0.6, height: w * 0.2, fontSize: Math.round(w * 0.28), fontWeight: 900, letterSpacing: -8, color: paper }),
          text('KROMA VISUAL', {
            name: 'Wordmark',
            x: w * 0.1,
            y: w * 0.82,
            width: w * 0.8,
            fontSize: Math.round(w * 0.075),
            fontWeight: 800,
            letterSpacing: 10,
            color: ink
          })
        ]
      }
    }
  },
  {
    id: 'slide-title',
    name: 'Presentation — Title Slide',
    category: 'Presentations',
    size: { width: 1920, height: 1080 },
    description: 'Clean 16:9 title slide with accent column.',
    tags: ['presentation', 'slide'],
    build: (size) => {
      const [w, h] = [size.width, size.height]
      const [ink, , accent, soft, paper] = palette('midnight')
      return {
        background: { type: 'solid', color: paper },
        nodes: [
          shape('rect', { name: 'Column', x: 0, y: 0, width: w * 0.06, height: h, fill: solid(accent) }),
          text('Q3 REVIEW', { name: 'Kicker', x: w * 0.11, y: h * 0.24, width: w * 0.6, fontSize: Math.round(h * 0.04), fontWeight: 800, letterSpacing: 10, align: 'left', color: accent }),
          text('Design systems\nthat scale', {
            name: 'Title',
            x: w * 0.11,
            y: h * 0.32,
            width: w * 0.74,
            height: h * 0.34,
            fontSize: Math.round(h * 0.13),
            fontWeight: 800,
            lineHeight: 1.04,
            letterSpacing: -3,
            align: 'left',
            color: ink
          }),
          text('Prepared by the Brand & Product team · 12 October', {
            name: 'Footer',
            x: w * 0.11,
            y: h * 0.74,
            width: w * 0.7,
            fontSize: Math.round(h * 0.03),
            fontWeight: 500,
            align: 'left',
            color: soft
          })
        ]
      }
    }
  },
  {
    id: 'wallpaper-aurora',
    name: 'Wallpaper — Aurora',
    category: 'Wallpapers',
    size: { width: 2560, height: 1440 },
    description: 'Layered gradient wallpaper with soft bands.',
    tags: ['wallpaper', 'gradient'],
    build: (size) => {
      const [w, h] = [size.width, size.height]
      const [ink, deep, accent, , paper] = palette('neon')
      return {
        background: { type: 'gradient', color: ink, gradient: gradient([{ color: ink, offset: 0 }, { color: '#12102A', offset: 1 }], 160) },
        nodes: [
          shape('rect', { name: 'Band 1', x: -w * 0.1, y: h * 0.18, width: w * 1.2, height: h * 0.22, fill: gradient([{ color: accent, offset: 0 }, { color: '#00000000', offset: 1 }], 90), opacity: 0.65 }),
          shape('rect', { name: 'Band 2', x: -w * 0.1, y: h * 0.42, width: w * 1.2, height: h * 0.16, fill: gradient([{ color: '#FF2EC4', offset: 0 }, { color: '#00000000', offset: 1 }], 90), opacity: 0.55 }),
          shape('circle', { name: 'Glow', x: w * 0.7, y: h * 0.1, width: h * 0.7, height: h * 0.7, fill: gradient([{ color: accent, offset: 0 }, { color: '#00000000', offset: 1 }], 90), opacity: 0.4 }),
          text('AURORA', { name: 'Label', x: w * 0.06, y: h * 0.8, width: w * 0.4, fontSize: Math.round(h * 0.06), fontWeight: 800, letterSpacing: 20, align: 'left', color: paper, opacity: 0.7 })
        ]
      }
    }
  }
]

/* --------------------------------- emit --------------------------------- */

let count = 0
for (const spec of TEMPLATES) {
  const { background, nodes } = spec.build(spec.size)
  const document = doc([page(spec.size, nodes, background, spec.name)])
  const payload = {
    id: spec.id,
    name: spec.name,
    category: spec.category,
    width: spec.size.width,
    height: spec.size.height,
    description: spec.description,
    tags: spec.tags,
    document,
    assets: []
  }
  writeFileSync(join(templatesDir, `${spec.id}.json`), JSON.stringify(payload, null, 2), 'utf8')
  count += 1
}

/* -------------------------------- samples -------------------------------- */

interface SampleSpec {
  id: string
  name: string
  size: Size
  build: (size: Size) => { background: PageBackground; nodes: SceneNode[] }
}

const SAMPLES: SampleSpec[] = [
  {
    id: 'sample-youtube-thumbnail',
    name: 'YouTube Thumbnail — Demo',
    size: { width: 1280, height: 720 },
    build: (size) => TEMPLATES[0].build(size)
  },
  {
    id: 'sample-halloween-tshirt',
    name: 'Halloween T-Shirt — Demo',
    size: { width: 4500, height: 5400 },
    build: (size) => TEMPLATES.find((entry) => entry.id === 'tshirt-raccoon')!.build(size)
  },
  {
    id: 'sample-instagram-post',
    name: 'Instagram Post — Demo',
    size: { width: 1080, height: 1080 },
    build: (size) => TEMPLATES.find((entry) => entry.id === 'ig-post-promo')!.build(size)
  },
  {
    id: 'sample-poster',
    name: 'Poster — Demo',
    size: { width: 1080, height: 1440 },
    build: (size) => TEMPLATES.find((entry) => entry.id === 'poster-modern')!.build(size)
  },
  {
    id: 'sample-business-flyer',
    name: 'Business Flyer — Demo',
    size: { width: 1080, height: 1440 },
    build: (size) => TEMPLATES.find((entry) => entry.id === 'flyer-cafe')!.build(size)
  }
]

for (const spec of SAMPLES) {
  const { background, nodes } = spec.build(spec.size)
  const document = doc([page(spec.size, nodes, background, spec.name)])
  writeFileSync(
    join(samplesDir, `${spec.id}.json`),
    JSON.stringify({ name: spec.name, tags: ['sample'], document }, null, 2),
    'utf8'
  )
}

console.log(`Wrote ${count} templates -> resources/templates`)
console.log(`Wrote ${SAMPLES.length} sample projects -> resources/samples`)
