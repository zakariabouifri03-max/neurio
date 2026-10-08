import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sanitizeDocument } from '../src/shared/utils/validation'
import { flattenNodes } from '../src/shared/utils/document'
import { TEMPLATE_CATEGORIES } from '../src/shared/constants'
import type { DesignDocument } from '../src/shared/types/document'

const templatesDir = join(process.cwd(), 'resources', 'templates')
const samplesDir = join(process.cwd(), 'resources', 'samples')

const readJson = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8'))

describe('bundled content', () => {
  const templates = existsSync(templatesDir) ? readdirSync(templatesDir).filter((file) => file.endsWith('.json')) : []
  const samples = existsSync(samplesDir) ? readdirSync(samplesDir).filter((file) => file.endsWith('.json')) : []

  it('ships templates in every required category', () => {
    expect(templates.length).toBeGreaterThan(0)
    const categories = new Set<string>()
    for (const file of templates) {
      const record = readJson(join(templatesDir, file)) as { category?: string }
      if (record.category) categories.add(record.category)
    }
    for (const category of TEMPLATE_CATEGORIES) {
      expect(categories.has(category)).toBe(true)
    }
  })

  it('every template passes the document sanitiser', () => {
    for (const file of templates) {
      const record = readJson(join(templatesDir, file)) as { document: unknown }
      const document = sanitizeDocument(record.document)
      expect(document.pages.length).toBeGreaterThan(0)
      for (const node of flattenNodes(document.pages[0].nodes)) {
        expect(['text', 'image', 'shape', 'svg', 'group']).toContain(node.kind)
      }
    }
  })

  it('every template has unique ids and non-empty nodes', () => {
    const ids = new Set<string>()
    for (const file of templates) {
      const record = readJson(join(templatesDir, file)) as { id?: string; document: unknown }
      expect(ids.has(record.id ?? file)).toBe(false)
      ids.add(record.id ?? file)
      const document = sanitizeDocument(record.document) as DesignDocument
      expect(document.pages[0].nodes.length).toBeGreaterThan(0)
    }
  })

  it('ships the demo sample projects', () => {
    expect(samples.length).toBeGreaterThanOrEqual(5)
    for (const file of samples) {
      const record = readJson(join(samplesDir, file)) as { name?: string; document: unknown }
      expect(typeof record.name).toBe('string')
      const document = sanitizeDocument(record.document)
      expect(document.pages[0].width).toBeGreaterThan(0)
    }
  })

  it('sample documents contain no remote or unsafe asset references', () => {
    for (const file of samples) {
      const record = readJson(join(samplesDir, file)) as { document: unknown }
      const document = sanitizeDocument(record.document)
      for (const node of flattenNodes(document.pages[0].nodes)) {
        if (node.kind === 'image') expect(node.src.startsWith('data:') || node.src.startsWith('kroma-asset://')).toBe(true)
        if (node.kind === 'svg') expect(node.svg).not.toContain('<script')
      }
    }
  })
})
