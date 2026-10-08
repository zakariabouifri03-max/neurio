import type { DesignDocument, SceneNode } from '../../../shared/types/document'
import type { Project, ProjectMeta } from '../../../shared/types/project'
import { LIMITS } from '../../../shared/constants'
import { platform } from '../platform'
import { renderThumbnail } from '../canvas/engine/render-page'
import { getPage, flattenNodes } from '../../../shared/utils/document'
import { newId, slugify } from '../../../shared/utils/ids'
import { sanitizeDocument } from '../../../shared/utils/validation'

export interface OpenResult {
  project: Project
  document: DesignDocument
}

class ProjectService {
  private thumbnailTimer: number | null = null

  async create(input: { name: string; width: number; height: number; document?: DesignDocument; origin?: Project['origin'] }): Promise<Project> {
    return platform.projects.create({
      name: input.name,
      width: input.width,
      height: input.height,
      document: input.document,
      origin: input.origin ?? 'blank'
    })
  }

  async open(id: string): Promise<OpenResult | null> {
    const project = await platform.projects.read(id)
    if (!project) return null
    return { project, document: project.document }
  }

  async save(input: { id: string; name?: string; document: DesignDocument }): Promise<ProjectMeta> {
    const meta = await platform.projects.save({ id: input.id, name: input.name, document: input.document })
    // Thumbnail is regenerated slightly later so saving stays instant.
    this.scheduleThumbnail(input.id, input.document)
    return meta
  }

  private scheduleThumbnail(id: string, document: DesignDocument): void {
    if (this.thumbnailTimer) window.clearTimeout(this.thumbnailTimer)
    this.thumbnailTimer = window.setTimeout(() => {
      void (async () => {
        try {
          const page = getPage(document)
          const dataUrl = await renderThumbnail(page, 480)
          await platform.projects.save({ id, document, thumbnail: { dataUrl } })
        } catch {
          /* thumbnails are cosmetic */
        }
      })()
    }, LIMITS.THUMBNAIL_DEBOUNCE_MS)
  }

  async duplicate(id: string): Promise<ProjectMeta> {
    return platform.projects.duplicate(id)
  }

  async remove(id: string): Promise<void> {
    await platform.projects.remove(id)
  }

  async rename(id: string, name: string): Promise<ProjectMeta> {
    return platform.projects.rename(id, name)
  }

  /** Saves the current editor document as a reusable template. */
  async saveAsTemplate(input: { name: string; category: string; document: DesignDocument }): Promise<ProjectMeta | null> {
    const page = getPage(input.document)
    let thumbnail: string | null = null
    try {
      thumbnail = await renderThumbnail(page, 480)
    } catch {
      thumbnail = null
    }
    await platform.templates.create({
      name: input.name,
      category: input.category,
      document: input.document,
      thumbnail
    })
    return null
  }

  async importFromJson(raw: string): Promise<DesignDocument> {
    const parsed: unknown = JSON.parse(raw)
    const maybeDocument = (parsed as { document?: unknown }).document ?? parsed
    return sanitizeDocument(maybeDocument)
  }

  exportToJson(document: DesignDocument, name: string): Blob {
    const payload = {
      kind: 'kroma-design',
      version: document.version,
      name: slugify(name),
      exportedAt: new Date().toISOString(),
      document
    }
    return new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  }
}

export const projectService = new ProjectService()

/** Collects every image source referenced by a document. */
export function documentImageSources(document: DesignDocument): string[] {
  const out = new Set<string>()
  const walk = (nodes: SceneNode[]): void => {
    for (const node of nodes) {
      if (node.kind === 'image') out.add(node.src)
      if (node.kind === 'group') walk(node.children)
    }
  }
  for (const page of document.pages) {
    if (page.background.imageSrc) out.add(page.background.imageSrc)
    walk(page.nodes)
  }
  return [...out]
}

export const newDocumentId = (): string => newId('doc')
export const countDocumentNodes = (document: DesignDocument): number =>
  document.pages.reduce((sum, page) => sum + flattenNodes(page.nodes).length, 0)
