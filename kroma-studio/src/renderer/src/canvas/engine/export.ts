import type { ExportOptions, ExportPagePayload } from '../../../../shared/types/export'
import type { DesignDocument } from '../../../../shared/types/document'
import { EXPORT_FORMAT_MIME } from '../../../../shared/types/export'
import { platform } from '../../platform'
import { canvasToDataUrl, renderPageToCanvas } from './render-page'
import { slugify } from '../../../../shared/utils/ids'

export interface ProgressCallback {
  (done: number, total: number, label: string): void
}

/**
 * Renders the selected pages and hands them to the main process, which owns
 * the file dialogs and the actual disk writes.
 */
export async function exportDocument(
  document: DesignDocument,
  options: ExportOptions,
  onProgress?: ProgressCallback
): Promise<{ files: string[]; cancelled: boolean }> {
  const pages = document.pages.filter((page) => options.pageIds.includes(page.id))
  if (pages.length === 0) throw new Error('Select at least one page to export.')

  const payloads: ExportPagePayload[] = []
  const base = slugify(options.projectName || 'kroma-design')
  let index = 0

  for (const page of pages) {
    index += 1
    onProgress?.(index, pages.length, page.name)
    const width = options.width ?? Math.round(page.width * options.scale)
    const height = options.height ?? Math.round(page.height * options.scale)
    const canvas = await renderPageToCanvas(page, {
      width,
      height,
      transparent: options.transparent && options.format === 'png'
    })
    payloads.push({
      pageId: page.id,
      pageName: page.name,
      width: canvas.width,
      height: canvas.height,
      dataUrl:
        options.format === 'pdf'
          ? canvasToDataUrl(canvas, 'image/png')
          : canvasToDataUrl(canvas, EXPORT_FORMAT_MIME[options.format] as 'image/png' | 'image/jpeg' | 'image/webp', options.quality)
    })
  }

  const files = buildFileList(payloads, options, base)
  const result = await platform.export.write({ request: { options, pages: payloads }, files })
  return { files: result.files.map((file) => file.path), cancelled: result.cancelled }
}

function buildFileList(payloads: ExportPagePayload[], options: ExportOptions, base: string): Array<{ fileName: string; dataUrl: string }> {
  const extension = options.format === 'jpg' ? 'jpg' : options.format
  const isSingle = payloads.length === 1 || options.mode === 'single'
  if (isSingle) return [{ fileName: `${base}.${extension}`, dataUrl: payloads[0].dataUrl }]
  return payloads.map((page, index) => ({
    fileName: `${base}-${page.pageName ? `${slugify(page.pageName)}-` : ''}${String(index + 1).padStart(2, '0')}.${extension}`,
    dataUrl: page.dataUrl
  }))
}

/** PDF assembly. jsPDF is imported lazily so it never slows the first paint. */
export async function buildPdf(payloads: ExportPagePayload[], quality = 0.92): Promise<string> {
  const { jsPDF } = await import('jspdf')
  const first = payloads[0]
  const orientation = first.width >= first.height ? 'landscape' : 'portrait'
  // 72 pt per inch; use ~150 dpi for a good size/quality balance.
  const pdf = new jsPDF({ orientation, unit: 'pt', format: [first.width, first.height], compress: true })
  payloads.forEach((page, index) => {
    if (index > 0) pdf.addPage([page.width, page.height], page.width >= page.height ? 'landscape' : 'portrait')
    pdf.addImage(page.dataUrl, 'JPEG', 0, 0, page.width, page.height, undefined, 'FAST')
    void quality
  })
  return pdf.output('datauristring')
}

export async function exportPdfDocument(
  document: DesignDocument,
  options: ExportOptions,
  onProgress?: ProgressCallback
): Promise<{ files: string[]; cancelled: boolean }> {
  const pages = document.pages.filter((page) => options.pageIds.includes(page.id))
  if (pages.length === 0) throw new Error('Select at least one page to export.')
  const payloads: ExportPagePayload[] = []
  let index = 0
  for (const page of pages) {
    index += 1
    onProgress?.(index, pages.length, page.name)
    const canvas = await renderPageToCanvas(page, {
      width: options.width ?? Math.round(page.width * options.scale),
      height: options.height ?? Math.round(page.height * options.scale),
      background: options.transparent ? undefined : '#FFFFFF'
    })
    payloads.push({
      pageId: page.id,
      pageName: page.name,
      width: canvas.width,
      height: canvas.height,
      dataUrl: canvasToDataUrl(canvas, 'image/jpeg', Math.max(0.7, options.quality))
    })
  }
  const dataUrl = await buildPdf(payloads, options.quality)
  const base = slugify(options.projectName || 'kroma-design')
  const result = await platform.export.write({
    request: { options, pages: payloads },
    files: [{ fileName: `${base}.pdf`, dataUrl }]
  })
  return { files: result.files.map((file) => file.path), cancelled: result.cancelled }
}
