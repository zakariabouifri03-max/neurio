import type { ExportSettings } from './settings'

export type ExportFormat = 'png' | 'jpg' | 'webp' | 'pdf'

export interface ExportOptions {
  format: ExportFormat
  /** Target width/height in px. Omit to use page size * scale. */
  width?: number
  height?: number
  /** Multiplier applied to page size when width/height are absent. */
  scale: number
  quality: number
  transparent: boolean
  pageIds: string[]
  projectName: string
  /** 'single' writes one file (first page), 'multi' writes one file per page. */
  mode: 'single' | 'multi'
}

export interface ExportPagePayload {
  pageId: string
  pageName: string
  width: number
  height: number
  /** data URL of the rendered page */
  dataUrl: string
}

export interface ExportRequest {
  options: ExportOptions
  pages: ExportPagePayload[]
  /** Filled by the renderer from the save dialog / chosen directory. */
  targetDirectory?: string
  fileName?: string
}

export interface ExportedFile {
  path: string
  bytes: number
}

export interface ExportResult {
  files: ExportedFile[]
  cancelled: boolean
}

export const EXPORT_FORMAT_MIME: Record<ExportFormat, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  pdf: 'application/pdf'
}

export const EXPORT_FORMAT_EXTENSION: Record<ExportFormat, string> = {
  png: 'png',
  jpg: 'jpg',
  webp: 'webp',
  pdf: 'pdf'
}

export type { ExportSettings }
