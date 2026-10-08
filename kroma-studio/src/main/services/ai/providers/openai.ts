import { KromaError } from '../../../../shared/ipc'
import type { AiImageRequest, AiTextRequest } from '../../../../shared/types/ai'
import type { AiProviderId } from '../../../../shared/types/settings'
import { bufferToDataUrl, dataUrlToBase64, Http, requireKey } from '../http'
import { sizeForAspectRatio } from '../sizes'
import type { BackgroundProvider, ImageOutput, ImageProvider, ResolvedProvider, TextProvider } from '../types'

const ID: AiProviderId = 'openai'
const DEFAULT_BASE = 'https://api.openai.com/v1'
const DEFAULT_TEXT_MODEL = 'gpt-4o-mini'
const DEFAULT_IMAGE_MODEL = 'gpt-image-1'

interface ChatResponse {
  choices?: Array<{ message?: { content?: string } }>
}

interface ImagesResponse {
  data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }>
}

const SYSTEM_PROMPT =
  'You are a senior graphic designer and copywriter working inside a design editor. ' +
  'Reply with exactly what is asked, as strict JSON when JSON is requested.'

export function buildTextPrompt(request: AiTextRequest, count: number): string {
  const ctx = request.sourceText ? `\nExisting text: """${request.sourceText}"""` : ''
  const audience = request.audience ? ` Audience: ${request.audience}.` : ''
  switch (request.task) {
    case 'headline':
      return `Write ${count} punchy design headlines for: ${request.prompt}.${audience} Return JSON {"variants":["..."]}`
    case 'rewrite':
      return `Rewrite this text so it reads better, keeping the meaning.${ctx} Brief: ${request.prompt} Return JSON {"variants":["..."]}`
    case 'shorten':
      return `Shorten to at most ${request.maxLength ?? 60} characters without losing the point.${ctx} Return JSON {"variants":["..."]}`
    case 'expand':
      return `Expand into ${count} longer, richer versions.${ctx} Brief: ${request.prompt} Return JSON {"variants":["..."]}`
    case 'professional':
      return `Rewrite in a confident, professional tone.${ctx} Return JSON {"variants":["..."]}`
    case 'funny':
      return `Rewrite with light, friendly humour.${ctx} Return JSON {"variants":["..."]}`
    case 'marketing':
      return `Write ${count} marketing versions with a clear benefit and a call to action for: ${request.prompt}.${ctx}${audience} Return JSON {"variants":["..."]}`
    case 'product':
      return `Write ${count} product descriptions for: ${request.prompt}.${ctx}${audience} Return JSON {"variants":["..."]}`
    case 'slogans':
      return `Write ${count} short slogans (max 6 words) for: ${request.prompt}. Return JSON {"variants":["..."]}`
    case 'captions':
      return `Write ${count} social media captions, each with 3 relevant hashtags, for: ${request.prompt}. Return JSON {"variants":["..."]}`
    default:
      return `${request.prompt}${ctx} Return JSON {"variants":["..."]} with ${count} variants.`
  }
}

export function parseVariants(content: string, count: number): string[] {
  const trimmed = content.trim()
  try {
    const parsed = JSON.parse(trimmed) as { variants?: unknown }
    if (Array.isArray(parsed.variants)) {
      const variants = parsed.variants.map((v) => String(v).trim()).filter(Boolean)
      if (variants.length > 0) return variants.slice(0, count)
    }
  } catch {
    /* fall back to line splitting */
  }
  return trimmed
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter(Boolean)
    .slice(0, count)
}

export const openaiProvider: TextProvider & ImageProvider & BackgroundProvider = {
  id: ID,
  capabilities: ['text', 'image', 'background'],

  async text(request: AiTextRequest, provider: ResolvedProvider): Promise<string[]> {
    const key = requireKey(provider.apiKey, ID, 'OpenAI')
    const base = provider.baseUrl?.replace(/\/$/, '') || DEFAULT_BASE
    const count = Math.max(1, Math.min(6, request.count ?? 3))
    const data = await Http.json<ChatResponse>(
      `${base}/chat/completions`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: provider.model || DEFAULT_TEXT_MODEL,
          temperature: request.task === 'funny' ? 1.1 : 0.8,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: buildTextPrompt(request, count) }
          ]
        }),
        timeoutMs: provider.timeoutMs
      },
      ID
    )
    return parseVariants(data.choices?.[0]?.message?.content ?? '', count)
  },

  async image(request: AiImageRequest, provider: ResolvedProvider): Promise<ImageOutput> {
    const key = requireKey(provider.apiKey, ID, 'OpenAI')
    const base = provider.baseUrl?.replace(/\/$/, '') || DEFAULT_BASE
    const model = provider.model || DEFAULT_IMAGE_MODEL
    const isDalle = model.startsWith('dall-e')
    const size = sizeForAspectRatio(request.aspectRatio, request.width, request.height, isDalle ? 'dall-e' : 'gpt-image')
    const body: Record<string, unknown> = { model, prompt: request.prompt.slice(0, 4000), n: 1, size }
    if (isDalle) body.response_format = 'url'
    else {
      body.background = request.transparent ? 'transparent' : 'auto'
      body.quality = 'high'
      if (request.referenceDataUrl) body.image = dataUrlToBase64(request.referenceDataUrl)
    }
    const endpoint = request.referenceDataUrl && !isDalle ? 'edits' : 'generations'
    const data = await Http.json<ImagesResponse>(
      `${base}/images/${endpoint}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
        timeoutMs: Math.max(provider.timeoutMs, 150_000)
      },
      ID
    )
    const item = data.data?.[0]
    if (!item) throw new KromaError('UPSTREAM', 'OpenAI returned no image.', ID)
    let dataUrl: string
    if (item.b64_json) dataUrl = `data:image/png;base64,${item.b64_json}`
    else if (item.url) dataUrl = bufferToDataUrl(await Http.buffer(item.url, { timeoutMs: provider.timeoutMs }, ID), 'image/png')
    else throw new KromaError('UPSTREAM', 'OpenAI returned an empty response.', ID)
    const [width, height] = size.split('x').map(Number)
    return { dataUrl, width, height, revisedPrompt: item.revised_prompt }
  },

  async background(imageDataUrl: string, provider: ResolvedProvider): Promise<ImageOutput> {
    const key = requireKey(provider.apiKey, ID, 'OpenAI')
    const base = provider.baseUrl?.replace(/\/$/, '') || DEFAULT_BASE
    const form = new FormData()
    form.append('model', provider.model || DEFAULT_IMAGE_MODEL)
    form.append('image', new Blob([Buffer.from(dataUrlToBase64(imageDataUrl), 'base64')], { type: 'image/png' }), 'source.png')
    form.append('prompt', 'Remove the background completely. Keep the subject crisp and preserve original colours. Output a transparent PNG.')
    form.append('size', '1024x1024')
    form.append('background', 'transparent')
    const data = await Http.json<ImagesResponse>(
      `${base}/images/edits`,
      { method: 'POST', headers: { authorization: `Bearer ${key}` }, body: form, timeoutMs: Math.max(provider.timeoutMs, 150_000) },
      ID
    )
    const b64 = data.data?.[0]?.b64_json
    if (!b64) throw new KromaError('UPSTREAM', 'OpenAI returned no image.', ID)
    return { dataUrl: `data:image/png;base64,${b64}`, width: 1024, height: 1024 }
  }
}
