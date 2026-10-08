import { KromaError } from '../../../../shared/ipc'
import type { AiUpscaleRequest } from '../../../../shared/types/ai'
import type { AiProviderId } from '../../../../shared/types/settings'
import { bufferToDataUrl, dataUrlToBase64, Http, requireKey } from '../http'
import type { BackgroundProvider, ImageOutput, ResolvedProvider, UpscaleProvider } from '../types'

const ID: AiProviderId = 'clipdrop'
const DEFAULT_BASE = 'https://clipdrop-api.co'

const form = (imageDataUrl: string): FormData => {
  const body = new FormData()
  body.append('image_file', new Blob([Buffer.from(dataUrlToBase64(imageDataUrl), 'base64')], { type: 'image/png' }), 'source.png')
  return body
}

export const clipdropProvider: BackgroundProvider & UpscaleProvider = {
  id: ID,
  capabilities: ['background', 'upscale'],

  async background(imageDataUrl: string, provider: ResolvedProvider): Promise<ImageOutput> {
    const key = requireKey(provider.apiKey, ID, 'Clipdrop')
    const base = provider.baseUrl?.replace(/\/$/, '') || DEFAULT_BASE
    const buffer = await Http.buffer(
      `${base}/remove-background/v1`,
      {
        method: 'POST',
        headers: { 'x-api-key': key },
        body: form(imageDataUrl),
        timeoutMs: provider.timeoutMs
      },
      ID
    )
    if (buffer.length === 0) throw new KromaError('UPSTREAM', 'Clipdrop returned an empty image.', ID)
    return { dataUrl: bufferToDataUrl(buffer, 'image/png'), width: 0, height: 0 }
  },

  async upscale(request: AiUpscaleRequest, provider: ResolvedProvider): Promise<ImageOutput> {
    const key = requireKey(provider.apiKey, ID, 'Clipdrop')
    const base = provider.baseUrl?.replace(/\/$/, '') || DEFAULT_BASE
    const body = form(request.imageDataUrl)
    body.append('scale', String(request.scale))
    const buffer = await Http.buffer(
      `${base}/upscale-image/v1`,
      { method: 'POST', headers: { 'x-api-key': key }, body, timeoutMs: Math.max(provider.timeoutMs, 150_000) },
      ID
    )
    if (buffer.length === 0) throw new KromaError('UPSTREAM', 'Clipdrop returned an empty image.', ID)
    return { dataUrl: bufferToDataUrl(buffer, 'image/png'), width: 0, height: 0 }
  }
}
