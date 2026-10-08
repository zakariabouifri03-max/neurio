import { createTextNode, solid } from '../../../../shared/utils/document'
import type { TextNode } from '../../../../shared/types/document'

export interface TextStyleDef {
  id: string
  label: string
  fontSize: number
  fontWeight: number
  letterSpacing: number
  lineHeight: number
  italic?: boolean
  underline?: boolean
  fontFamily?: string
  color?: string
  preview: string
}

export const TEXT_STYLES: TextStyleDef[] = [
  { id: 'heading', label: 'Heading', fontSize: 96, fontWeight: 800, letterSpacing: -2, lineHeight: 1.05, preview: 'The Big Idea' },
  { id: 'subheading', label: 'Subheading', fontSize: 48, fontWeight: 600, letterSpacing: -0.5, lineHeight: 1.2, preview: 'Supporting line here' },
  { id: 'body', label: 'Body', fontSize: 24, fontWeight: 400, letterSpacing: 0, lineHeight: 1.5, preview: 'Add a short paragraph describing the offer.' },
  { id: 'caption', label: 'Caption', fontSize: 18, fontWeight: 500, letterSpacing: 0.3, lineHeight: 1.4, color: '#8A8A9C', preview: '@yourhandle' },
  { id: 'display', label: 'Display', fontSize: 140, fontWeight: 900, letterSpacing: -4, lineHeight: 0.95, preview: 'BOOM' },
  { id: 'script', label: 'Elegant', fontSize: 64, fontWeight: 400, letterSpacing: 1, lineHeight: 1.25, fontFamily: 'Georgia', italic: true, preview: 'With compliments' },
  { id: 'mono', label: 'Mono', fontSize: 28, fontWeight: 500, letterSpacing: 1, lineHeight: 1.5, fontFamily: 'Courier New', preview: 'SYSTEM READY' },
  { id: 'quote', label: 'Quote', fontSize: 40, fontWeight: 400, letterSpacing: 0, lineHeight: 1.35, fontFamily: 'Georgia', italic: true, preview: '“Design is intelligence made visible.”' },
  { id: 'button', label: 'Button', fontSize: 26, fontWeight: 700, letterSpacing: 0.5, lineHeight: 1.2, preview: 'GET STARTED' },
  { id: 'overline', label: 'Overline', fontSize: 20, fontWeight: 700, letterSpacing: 4, lineHeight: 1.3, preview: 'NEW COLLECTION' }
]

export const buildTextFromStyle = (
  style: TextStyleDef,
  options: { x: number; y: number; width: number; color?: string; text?: string }
): TextNode =>
  createTextNode({
    name: style.label,
    text: options.text ?? style.preview,
    x: options.x,
    y: options.y,
    width: options.width,
    height: Math.max(24, style.fontSize * style.lineHeight * 1.4),
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    letterSpacing: style.letterSpacing,
    lineHeight: style.lineHeight,
    italic: style.italic ?? false,
    underline: style.underline ?? false,
    fontFamily: style.fontFamily ?? 'Inter',
    fill: solid(options.color ?? style.color ?? '#111111'),
    align: 'center'
  })
