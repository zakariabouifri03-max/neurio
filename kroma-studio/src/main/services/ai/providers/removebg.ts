import { KromaError } from '../../../../shared/ipc'
import type { AiProviderId } from '../../../../shared/types/settings'
import { bufferToDataUrl, dataUrlToBase64, Http, requireKey } from '../http'
import type { BackgroundProvider, ImageOutput, ResolvedProvider } from '../types'

const ID: AiProviderId = 'removebg'

export const removeBgProvider: BackgroundProvider = {
  id: ID,
  capabilities: ['background'],

  async background(imageDataUrl: string, provider: ResolvedProvider): Promise<ImageOutput> {
    const key = requireKey(provider.apiKey, ID, 'remove.bg')
    const base = provider.baseUrl?.replace(/\/$/, '') || 'https://api.remove.bg'
    const form = new FormData()
    form.append('image_file', new Blob([Buffer.from(dataUrlToBase64(imageDataUrl), 'base64')], { type: 'image/png' }), 'source.png')
    form.append('size', 'auto')
    form.append('format', 'png')
    const buffer = await Http.buffer(
      `${base}/v1.0/removebg`,
      { method: 'POST', headers: { 'x-api-key': key }, body: form, timeoutMs: provider.timeoutMs },
      ID
    )
    if (buffer.length === 0) throw new KromaError('UPSTREAM', 'remove.bg returned an empty image.', ID)
    return { dataUrl: bufferToDataUrl(buffer, 'image/png'), width: 0, height: 0 }
  }
}
