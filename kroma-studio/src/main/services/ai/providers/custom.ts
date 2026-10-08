import { KromaError } from '../../../../shared/ipc'
import type { AiImageRequest, AiTextRequest } from '../../../../shared/types/ai'
import type { AiProviderId } from '../../../../shared/types/settings'
import { bufferToDataUrl, Http } from '../http'
import type { ImageOutput, ImageProvider, ResolvedProvider, TextProvider } from '../types'
import { parseVariants } from './openai'

const ID: AiProviderId = 'custom'

/**
 * Any OpenAI-compatible endpoint (Ollama, LM Studio, OpenRouter, Together,
 * vLLM, Azure OpenAI gateways, ...). The base URL is user supplied.
 */
export const customProvider: TextProvider & ImageProvider = {
  id: ID,
  capabilities: ['text', 'image'],

  async text(request: AiTextRequest, provider: ResolvedProvider): Promise<string[]> {
    const key = provider.apiKey ?? ''
    const base = provider.baseUrl?.replace(/\/$/, '')
    if (!base) throw new KromaError('NOT_CONFIGURED', 'Set the Base URL for the custom provider in Settings.', ID)
    const count = Math.max(1, Math.min(6, request.count ?? 3))
    const data = await Http.json<{ choices?: Array<{ message?: { content?: string } }> }>(
      `${base}/chat/completions`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
        body: JSON.stringify({
          model: provider.model || 'gpt-4o-mini',
          temperature: 0.85,
          messages: [
            { role: 'system', content: 'You write design copy. Reply with strict JSON {"variants":["..."]}.' },
            {
              role: 'user',
              content: `Task: ${request.task}. Brief: ${request.prompt}${request.sourceText ? ` Text: """${request.sourceText}"""` : ''}. Return ${count} variants.`
            }
          ]
        }),
        timeoutMs: provider.timeoutMs
      },
      ID
    )
    return parseVariants(data.choices?.[0]?.message?.content ?? '', count)
  },

  async image(request: AiImageRequest, provider: ResolvedProvider): Promise<ImageOutput> {
    const key = provider.apiKey ?? ''
    const base = provider.baseUrl?.replace(/\/$/, '')
    if (!base) throw new KromaError('NOT_CONFIGURED', 'Set the Base URL for the custom provider in Settings.', ID)
    const data = await Http.json<{ data?: Array<{ b64_json?: string; url?: string }> }>(
      `${base}/images/generations`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
        body: JSON.stringify({
          model: provider.model || undefined,
          prompt: request.prompt.slice(0, 4000),
          n: 1,
          size: request.width && request.height ? `${request.width}x${request.height}` : '1024x1024',
          response_format: 'b64_json'
        }),
        timeoutMs: Math.max(provider.timeoutMs, 150_000)
      },
      ID
    )
    const item = data.data?.[0]
    if (item?.b64_json) return { dataUrl: `data:image/png;base64,${item.b64_json}`, width: request.width ?? 1024, height: request.height ?? 1024 }
    if (item?.url) {
      const buffer = await Http.buffer(item.url, { timeoutMs: provider.timeoutMs }, ID)
      return { dataUrl: bufferToDataUrl(buffer, 'image/png'), width: request.width ?? 1024, height: request.height ?? 1024 }
    }
    throw new KromaError('UPSTREAM', 'The custom provider returned no image.', ID)
  }
}
