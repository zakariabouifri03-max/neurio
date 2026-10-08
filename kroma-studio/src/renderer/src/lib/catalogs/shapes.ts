import type { ShapeKind } from '../../../../shared/types/document'

export interface ShapeItem {
  kind: ShapeKind
  label: string
  /** Original SVG path data, drawn on a 24×24 grid. */
  svg: string
}

const path = (d: string): string => `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="${d}" fill="currentColor"/></svg>`

export const SHAPE_CATALOG: ShapeItem[] = [
  { kind: 'rect', label: 'Square', svg: path('M3 3h18v18H3z') },
  { kind: 'circle', label: 'Circle', svg: path('M12 2a10 10 0 100 20 10 10 0 000-20z') },
  { kind: 'ellipse', label: 'Ellipse', svg: path('M12 4c5 0 10 3.6 10 8s-5 8-10 8S2 16.4 2 12 7 4 12 4z') },
  { kind: 'pill', label: 'Pill', svg: path('M12 4c6 0 10 2.7 10 8s-4 8-10 8S2 17.3 2 12 6 4 12 4z') },
  { kind: 'triangle', label: 'Triangle', svg: path('M12 3l10 18H2z') },
  { kind: 'diamond', label: 'Diamond', svg: path('M12 2l10 10-10 10L2 12z') },
  { kind: 'pentagon', label: 'Pentagon', svg: path('M12 2l10 7.7-3.8 11.8H5.8L2 9.7z') },
  { kind: 'hexagon', label: 'Hexagon', svg: path('M7 2h10l5 9-5 9H7l-5-9z') },
  { kind: 'star', label: 'Star', svg: path('M12 2l2.9 6.9 7.1.6-5.4 4.8 1.6 7.2L12 17.8 5.8 21.5l1.6-7.2L2 9.5l7.1-.6z') },
  { kind: 'heart', label: 'Heart', svg: path('M12 21s-8-4.9-8-10.5C4 6.6 6.8 4 10 4c1.6 0 2 .9 2 .9S12.4 4 14 4c3.2 0 6 2.6 6 6.5C20 16.1 12 21 12 21z') },
  { kind: 'arrow', label: 'Arrow', svg: path('M4 9h10V4l10 8-10 8v-5H4z') },
  { kind: 'cross', label: 'Cross', svg: path('M9 2h6v7h7v6h-7v7H9v-7H2V9h7z') },
  { kind: 'blob', label: 'Blob', svg: path('M12 3c5 0 8 4 8 9s-3 9-8 9-8-4-8-9 3-9 8-9z') },
  { kind: 'line', label: 'Line', svg: path('M2 11h20v2H2z') }
]

export const LINES_AND_ARROWS: ShapeItem[] = [
  { kind: 'line', label: 'Line', svg: path('M2 11h20v2H2z') },
  { kind: 'arrow', label: 'Right arrow', svg: path('M4 9h10V4l10 8-10 8v-5H4z') },
  { kind: 'arrow', label: 'Chevron', svg: path('M8 4l10 8-10 8v-5l5-3-5-3z') },
  { kind: 'triangle', label: 'Triangle marker', svg: path('M12 3l10 18H2z') }
]

export const shapeSvg = (kind: ShapeKind): string => SHAPE_CATALOG.find((item) => item.kind === kind)?.svg ?? ''
