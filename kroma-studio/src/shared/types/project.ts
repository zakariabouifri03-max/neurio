import type { BrandKit, DesignDocument } from './document'

export interface AssetRecord {
  id: string
  name: string
  mime: string
  bytes: number
  width?: number
  height?: number
  createdAt: number
  /** Where the bytes live: assets dir (file) or inline data URL (small icons). */
  storage: 'file' | 'inline'
  data?: string
}

/** Lightweight row used by the project browser (no document payload). */
export interface ProjectMeta {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  pageCount: number
  width: number
  height: number
  thumbnailId?: string | null
  tags: string[]
}

export interface Project {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  document: DesignDocument
  assets: AssetRecord[]
  brandKit?: BrandKit | null
  tags: string[]
  origin?: 'blank' | 'template' | 'sample' | 'ai'
  sourceId?: string | null
}

export interface CreateProjectInput {
  name?: string
  width: number
  height: number
  document?: DesignDocument
  tags?: string[]
  origin?: Project['origin']
  sourceId?: string | null
}

export interface SaveProjectInput {
  id: string
  name?: string
  document: DesignDocument
  assets?: AssetRecord[]
  brandKit?: BrandKit | null
  thumbnail?: { dataUrl: string } | null
}

export interface TemplateMeta {
  id: string
  name: string
  category: string
  width: number
  height: number
  thumbnailId?: string | null
  builtin: boolean
  tags: string[]
  description?: string
}

export interface TemplateRecord extends TemplateMeta {
  document: DesignDocument
  assets: AssetRecord[]
}
