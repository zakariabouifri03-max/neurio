import { describe, expect, it } from 'vitest'
import { sanitizeDocument, sanitizeNode, sanitizeSvg, sanitizeFileName, sanitizeColor, isSafeDataUrl } from '../src/shared/utils/validation'
import { createShapeNode, createTextNode } from '../src/shared/utils/document'
import type { ImageNode } from '../src/shared/types/document'

describe('validation', () => {
  it('rejects SVG with scripts and event handlers', () => {
    const bad = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><circle onclick="alert(1)" r="10"/></svg>'
    const result = sanitizeSvg(bad)
    expect(result.ok).toBe(false)

    const handlerOnly = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="10" onload="alert(1)"/></svg>'
    const cleaned = sanitizeSvg(handlerOnly)
    expect(cleaned.ok).toBe(true)
    expect(cleaned.svg).not.toContain('onload')
  })

  it('strips external references from SVG', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><image xlink:href="https://evil.example/x.png" width="10" height="10"/></svg>'
    const result = sanitizeSvg(svg)
    expect(result.ok).toBe(true)
    expect(result.svg).not.toContain('evil.example')
  })

  it('accepts safe SVG', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0h24v24H0z" fill="currentColor"/></svg>'
    expect(sanitizeSvg(svg).ok).toBe(true)
  })

  it('rejects image nodes with unsafe sources', () => {
    const unsafe = sanitizeNode({ kind: 'image', id: 'x', src: 'file:///etc/passwd', width: 10, height: 10 })
    expect(unsafe).toBeNull()

    const remote = sanitizeNode({ kind: 'image', id: 'x', src: 'https://example.com/a.png', width: 10, height: 10 })
    expect(remote).toBeNull()
  })

  it('accepts asset-protocol and data URLs', () => {
    const asset = sanitizeNode({ kind: 'image', id: 'x', src: 'kroma-asset://abc123_XYZ-9', width: 10, height: 10 })
    expect(asset).not.toBeNull()
    const data = sanitizeNode({
      kind: 'image',
      id: 'x',
      width: 10,
      height: 10,
      src: `data:image/png;base64,${Buffer.from('89504e470d0a1a0a', 'hex').toString('base64')}`
    })
    expect(data).not.toBeNull()
  })

  it('clamps hostile numeric values', () => {
    const node = sanitizeNode({ kind: 'text', id: 'x', fontSize: 1e9, opacity: 42, rotation: 1e6, width: -50, height: 0 })
    expect(node).not.toBeNull()
    expect(node!.opacity).toBe(1)
    expect(node!.width).toBeGreaterThan(0)
    if (node!.kind === 'text') expect(node!.fontSize).toBeLessThanOrEqual(2000)
  })

  it('sanitises colour strings', () => {
    expect(sanitizeColor('#7c5cff')).toBe('#7c5cff')
    expect(sanitizeColor('url(javascript:alert(1))')).toBe('#000000')
    expect(sanitizeColor('red')).toBe('red')
    expect(sanitizeColor('expression(1)')).toBe('#000000')
  })

  it('sanitises file names against traversal', () => {
    expect(sanitizeFileName('../../etc/passwd')).not.toContain('..')
    expect(sanitizeFileName('my:design?*')).toBe('mydesign')
    expect(sanitizeFileName('')).toBe('untitled')
  })

  it('rejects non-image data URLs', () => {
    expect(isSafeDataUrl('data:text/html;base64,PHNjcmlwdD4=')).toBe(false)
    expect(isSafeDataUrl('data:image/png;base64,AAAA')).toBe(true)
    expect(isSafeDataUrl('javascript:alert(1)')).toBe(false)
  })

  it('repairs a document with an invalid page', () => {
    const doc = {
      version: 3,
      pages: [
        { id: 'p1', name: 'ok', width: 100, height: 100, nodes: [createTextNode({ x: 0, y: 0, text: 'hi' })], background: { type: 'solid', color: '#FFFFFF' } },
        { id: 'p2', name: 'bad', width: -5, height: 0, nodes: [{ kind: 'image', src: 'http://x/y.png' }] }
      ]
    }
    const clean = sanitizeDocument(doc)
    expect(clean.pages).toHaveLength(2)
    expect(clean.pages[1].width).toBeGreaterThan(0)
    expect(clean.pages[1].nodes).toHaveLength(0)
  })

  it('throws when no usable page exists', () => {
    expect(() => sanitizeDocument({ pages: [] })).toThrow()
    expect(() => sanitizeDocument('nope')).toThrow()
  })

  it('keeps shape defaults', () => {
    const node = createShapeNode('star', { x: 0, y: 0 })
    expect(node.points).toBe(5)
    expect(node.fill.type).toBe('solid')
  })

  it('preserves image filters defaults', () => {
    const node = sanitizeNode({
      kind: 'image',
      id: 'img',
      src: 'data:image/png;base64,AAAA',
      width: 10,
      height: 10,
      filters: { brightness: 5 }
    }) as ImageNode
    expect(node.filters?.brightness).toBe(1)
  })
})
