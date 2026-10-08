import { KromaError } from '../../../../shared/ipc'
import type { AiImageRequest } from '../../../../shared/types/ai'
import type { AiProviderId } from '../../../../shared/types/settings'
import { bufferToDataUrl, Http, requireKey } from '../http'
import type { ImageOutput, ImageProvider, ResolvedProvider } from '../types'

const ID: AiProviderId = 'stability'
const DEFAULT_BASE = 'https://api.stability.ai'

const ratioMap: Record<string, string> = {
  '1:1': '1:1',
  '4:5': '4:5',
  '3:4': '3:4',
  '2:3': '2:3',
  '16:9': '16:9',
  '9:16': '9:16',
  custom: '1:1'
}

export const stabilityProvider: ImageProvider = {
  id: ID,
  capabilities: ['image'],

  async image(request: AiImageRequest, provider: ResolvedProvider): Promise<ImageOutput> {
    const key = requireKey(provider.apiKey, ID, 'Stability AI')
    const base = provider.baseUrl?.replace(/\/$/, '') || DEFAULT_BASE
    const model = provider.model || 'core'
    const form = new FormData()
    form.append('prompt', request.prompt.slice(0, 4000))
    if (request.negativePrompt) form.append('negative_prompt', request.negativePrompt)
    form.append('output_format', 'png')
    form.append('aspect_ratio', ratioMap[request.aspectRatio] ?? '1:1')
    if (request.style) form.append('style_preset', request.style)
    const buffer = await Http.buffer(
      `${base}/v2beta/stable-image/generate/${model}`,
      { method: 'POST', headers: { authorization: `Bearer ${key}`, accept: 'image/*' }, body: form, timeoutMs: Math.max(provider.timeoutMs, 150_000) },
      ID
    )
    if (buffer.length === 0) throw new KromaError('UPSTREAM', 'Stability returned an empty image.', ID)
    return { dataUrl: bufferToDataUrl(buffer, 'image/png'), width: request.width ?? 1024, height: request.height ?? 1024 }
  }
}
