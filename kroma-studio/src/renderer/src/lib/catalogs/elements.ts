import { createShapeNode, createTextNode, gradient, solid } from '../../../../shared/utils/document'
import type { SceneNode } from '../../../../shared/types/document'

/**
 * Composite decorations built from primitives. Everything here is generated
 * procedurally, so the library stays small and original.
 */

export interface ElementDef {
  id: string
  label: string
  category: 'badges' | 'frames' | 'stickers' | 'decorations'
  build: (options: { width: number; height: number; accent?: string }) => SceneNode[]
}

const accentOr = (accent?: string): string => accent ?? '#7C5CFF'

export const ELEMENT_CATALOG: ElementDef[] = [
  {
    id: 'badge-circle',
    label: 'Circle badge',
    category: 'badges',
    build: ({ width, accent }) => [
      createShapeNode('circle', { name: 'Badge', x: 0, y: 0, width, height: width, fill: solid(accentOr(accent)) }),
      createTextNode({
        name: 'Badge text',
        text: 'NEW',
        x: 0,
        y: width * 0.36,
        width,
        height: width * 0.3,
        fontSize: Math.max(12, width * 0.2),
        fontWeight: 800,
        fill: solid('#FFFFFF'),
        letterSpacing: 2,
        align: 'center'
      })
    ]
  },
  {
    id: 'badge-ribbon',
    label: 'Ribbon',
    category: 'badges',
    build: ({ width, accent }) => [
      createShapeNode('rect', { name: 'Ribbon', x: 0, y: 0, width, height: width * 0.32, fill: solid(accentOr(accent)), cornerRadius: 6 }),
      createTextNode({
        name: 'Ribbon text',
        text: 'FEATURED',
        x: 0,
        y: width * 0.07,
        width,
        height: width * 0.18,
        fontSize: Math.max(10, width * 0.13),
        fontWeight: 800,
        letterSpacing: 3,
        fill: solid('#FFFFFF'),
        align: 'center'
      })
    ]
  },
  {
    id: 'badge-star',
    label: 'Star burst',
    category: 'badges',
    build: ({ width, accent }) => {
      const size = width
      return [
        createShapeNode('star', { name: 'Burst', x: 0, y: 0, width: size, height: size, fill: solid(accentOr(accent)), points: 12 }),
        createTextNode({
          name: 'Burst text',
          text: '50%',
          x: 0,
          y: size * 0.38,
          width: size,
          height: size * 0.26,
          fontSize: size * 0.2,
          fontWeight: 900,
          fill: solid('#FFFFFF'),
          align: 'center'
        })
      ]
    }
  },
  {
    id: 'frame-thin',
    label: 'Thin frame',
    category: 'frames',
    build: ({ width, height, accent }) => [
      createShapeNode('rect', {
        name: 'Frame',
        x: 0,
        y: 0,
        width,
        height,
        fill: solid('#00000000'),
        stroke: { color: accentOr(accent), width: 2, align: 'inside' }
      })
    ]
  },
  {
    id: 'frame-matted',
    label: 'Matted frame',
    category: 'frames',
    build: ({ width, height, accent }) => [
      createShapeNode('rect', { name: 'Mat', x: 0, y: 0, width, height, fill: solid('#FFFFFF'), shadow: { color: '#000000', blur: 20, offsetX: 0, offsetY: 8, opacity: 0.18 } }),
      createShapeNode('rect', {
        name: 'Inner line',
        x: width * 0.05,
        y: height * 0.05,
        width: width * 0.9,
        height: height * 0.9,
        fill: solid('#00000000'),
        stroke: { color: accentOr(accent), width: 1.5, align: 'inside' }
      })
    ]
  },
  {
    id: 'frame-rounded',
    label: 'Rounded frame',
    category: 'frames',
    build: ({ width, height, accent }) => [
      createShapeNode('rect', {
        name: 'Rounded frame',
        x: 0,
        y: 0,
        width,
        height,
        fill: solid('#00000000'),
        stroke: { color: accentOr(accent), width: 4, align: 'inside' },
        cornerRadius: 14
      })
    ]
  },
  {
    id: 'decor-divider',
    label: 'Divider',
    category: 'decorations',
    build: ({ width, accent }) => [
      createShapeNode('rect', { name: 'Divider', x: 0, y: 0, width, height: Math.max(2, width * 0.012), fill: solid(accentOr(accent)), cornerRadius: 50 })
    ]
  },
  {
    id: 'decor-corner',
    label: 'Corner accents',
    category: 'decorations',
    build: ({ width, height, accent }) => {
      const size = Math.min(width, height) * 0.28
      const bar = Math.max(3, size * 0.12)
      const color = accentOr(accent)
      return [
        createShapeNode('rect', { name: 'Top left', x: 0, y: 0, width: size, height: bar, fill: solid(color), cornerRadius: 50 }),
        createShapeNode('rect', { name: 'Top left v', x: 0, y: 0, width: bar, height: size, fill: solid(color), cornerRadius: 50 }),
        createShapeNode('rect', { name: 'Bottom right', x: width - size, y: height - bar, width: size, height: bar, fill: solid(color), cornerRadius: 50 }),
        createShapeNode('rect', { name: 'Bottom right v', x: width - bar, y: height - size, width: bar, height: size, fill: solid(color), cornerRadius: 50 })
      ]
    }
  },
  {
    id: 'decor-dots',
    label: 'Dot grid',
    category: 'decorations',
    build: ({ width, height, accent }) => {
      const nodes: SceneNode[] = []
      const dot = Math.max(4, Math.min(width, height) * 0.09)
      const gap = dot * 1.8
      const columns = Math.floor(width / gap)
      const rows = Math.floor(height / gap)
      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          nodes.push(
            createShapeNode('circle', {
              name: `Dot ${row}-${column}`,
              x: column * gap,
              y: row * gap,
              width: dot,
              height: dot,
              fill: solid(accentOr(accent)),
              opacity: 0.75
            })
          )
        }
      }
      return nodes.slice(0, 400)
    }
  },
  {
    id: 'decor-waves',
    label: 'Waves',
    category: 'decorations',
    build: ({ width, height, accent }) => [
      createShapeNode('rect', {
        name: 'Wave band',
        x: 0,
        y: 0,
        width,
        height,
        fill: gradient(
          [
            { color: accentOr(accent), offset: 0 },
            { color: '#00000000', offset: 1 }
          ],
          90
        ),
        cornerRadius: 40
      })
    ]
  },
  {
    id: 'sticker-arrow',
    label: 'Arrow sticker',
    category: 'stickers',
    build: ({ width, accent }) => [
      createShapeNode('arrow', {
        name: 'Arrow',
        x: 0,
        y: 0,
        width,
        height: width * 0.6,
        fill: solid(accentOr(accent)),
        stroke: { color: '#FFFFFF', width: 4, align: 'outside' }
      })
    ]
  },
  {
    id: 'sticker-speech',
    label: 'Speech bubble',
    category: 'stickers',
    build: ({ width, accent }) => [
      createShapeNode('rect', {
        name: 'Bubble',
        x: 0,
        y: 0,
        width,
        height: width * 0.72,
        fill: solid(accentOr(accent)),
        cornerRadius: 18
      }),
      createShapeNode('triangle', {
        name: 'Tail',
        x: width * 0.18,
        y: width * 0.66,
        width: width * 0.22,
        height: width * 0.18,
        fill: solid(accentOr(accent)),
        rotation: 180
      })
    ]
  },
  {
    id: 'sticker-seal',
    label: 'Seal',
    category: 'stickers',
    build: ({ width, accent }) => [
      createShapeNode('hexagon', { name: 'Seal', x: 0, y: 0, width, height: width, fill: gradient([{ color: accentOr(accent), offset: 0 }, { color: '#0F1024', offset: 1 }], 135) }),
      createTextNode({
        name: 'Seal text',
        text: '100%',
        x: 0,
        y: width * 0.38,
        width,
        height: width * 0.26,
        fontSize: width * 0.19,
        fontWeight: 900,
        fill: solid('#FFFFFF'),
        align: 'center'
      })
    ]
  }
]

export const ELEMENT_CATEGORIES = [
  { id: 'badges', label: 'Badges' },
  { id: 'frames', label: 'Frames' },
  { id: 'decorations', label: 'Decorations' },
  { id: 'stickers', label: 'Stickers' }
] as const

export const elementsByCategory = (category: string): ElementDef[] =>
  ELEMENT_CATALOG.filter((element) => element.category === category)
