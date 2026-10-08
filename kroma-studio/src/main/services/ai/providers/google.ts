import { KromaError } from '../../../../shared/ipc'
import type { AiImageRequest, AiTextRequest } from '../../../../shared/types/ai'
import type { AiProviderId } from '../../../../shared/types/settings'
import { Http, requireKey } from '../http'
import { sizeForAspectRatio } from '../sizes'
import type { BackgroundProvider, ImageOutput, ImageProvider, ResolvedProvider, TextProvider } from '../types'
import { parseVariants } from './openai'

const ID: AiProviderId = 'google'
const DEFAULT_BASE = 'https://generativelanguage.googleapis.com'
const DEFAULT_TEXT_MODEL = 'gemini-2.0-flash'
const DEFAULT_IMAGE_MODEL = 'gemini-2.0-flash-preview-image-generation'

interface GenerateContentResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string; inlineData?: { mimeType?: string; data?: string } }> }
  }>
}

interface PredictResponse {
  predictions?: Array<{ bytesBase64Encoded?: string; mimeType?: string }>
}

const withKey = (base: string, path: string, key: string, model: string): string =>
  `${base.replace(/\/$/, '')}${path.replace('{model}', model)}?key=${encodeURIComponent(key)}`

export const googleProvider: TextProvider & ImageProvider & BackgroundProvider = {
  id: ID,
  capabilities: ['text', 'image', 'background'],

  async text(request: AiTextRequest, provider: ResolvedProvider): Promise<string[]> {
    const key = requireKey(provider.apiKey, ID, 'Google AI')
    const base = provider.baseUrl || DEFAULT_BASE
    const model = provider.model || DEFAULT_TEXT_MODEL
    const count = Math.max(1, Math.min(6, request.count ?? 3))
    const data = await Http.json<GenerateContentResponse>(
      withKey(base, '/v1beta/models/{model}:generateContent', key, model),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: textPrompt(request, count) }] }],
          generationConfig: { temperature: 0.9, responseMimeType: 'application/json' }
        }),
        timeoutMs: provider.timeoutMs
      },
      ID
    )
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
    return parseVariants(text, count)
  },

  async image(request: AiImageRequest, provider: ResolvedProvider): Promise<ImageOutput> {
    const key = requireKey(provider.apiKey, ID, 'Google AI')
    const base = provider.baseUrl || DEFAULT_BASE
    const model = provider.model || DEFAULT_IMAGE_MODEL
    const prompt = [request.prompt, request.style ? `Style: ${request.style}.` : '', request.negativePrompt ? `Avoid: ${request.negativePrompt}.` : '']
      .filter(Boolean)
      .join(' ')

    if (model.startsWith('imagen')) {
      const data = await Http.json<PredictResponse>(
        withKey(base, '/v1beta/models/{model}:predict', key, model),
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            instances: [{ prompt }],
            parameters: { sampleCount: 1, aspectRatio: sizeForAspectRatio(request.aspectRatio, request.width, request.height, 'imagen') }
          }),
          timeoutMs: Math.max(provider.timeoutMs, 150_000)
        },
        ID
      )
      const b64 = data.predictions?.[0]?.bytesBase64Encoded
      if (!b64) throw new KromaError('UPSTREAM', 'Google returned no image.', ID)
      return { dataUrl: `data:image/png;base64,${b64}`, width: request.width ?? 1024, height: request.height ?? 1024 }
    }

    const data = await Http.json<GenerateContentResponse>(
      withKey(base, '/v1beta/models/{model}:generateContent', key, model),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { responseModalities: ['TEXT', 'IMAGE'] }
        }),
        timeoutMs: Math.max(provider.timeoutMs, 150_000)
      },
      ID
    )
    const part = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)
    const b64 = part?.inlineData?.data
    if (!b64) throw new KromaError('UPSTREAM', 'Google returned no image for this prompt. Try again or switch model.', ID)
    return {
      dataUrl: `data:${part?.inlineData?.mimeType ?? 'image/png'};base64,${b64}`,
      width: request.width ?? 1024,
      height: request.height ?? 1024
    }
  },

  async background(imageDataUrl: string, provider: ResolvedProvider): Promise<ImageOutput> {
    const key = requireKey(provider.apiKey, ID, 'Google AI')
    const base = provider.baseUrl || DEFAULT_BASE
    const model = provider.model || DEFAULT_IMAGE_MODEL
    const b64 = imageDataUrl.slice(imageDataUrl.indexOf(',') + 1)
    const data = await Http.json<GenerateContentResponse>(
      withKey(base, '/v1beta/models/{model}:generateContent', key, model),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                { inlineData: { mimeType: 'image/png', data: b64 } },
                { text: 'Remove the background and return the subject on a fully transparent background as PNG.' }
              ]
            }
          ],
          generationConfig: { responseModalities: ['IMAGE'] }
        }),
        timeoutMs: Math.max(provider.timeoutMs, 150_000)
      },
      ID
    )
    const part = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)
    if (!part?.inlineData?.data) throw new KromaError('UPSTREAM', 'Google returned no image.', ID)
    return { dataUrl: `data:image/png;base64,${part.inlineData.data}`, width: 1024, height: 1024 }
  }
}

function textPrompt(request: AiTextRequest, count: number): string {
  const source = request.sourceText ? `\nExisting text: """${request.sourceText}"""` : ''
  return `You are a design copywriter. Produce ${count} variant(s) as strict JSON {"variants":["..."]}.\nTask: ${request.task}\nBrief: ${request.prompt}${source}`
}
