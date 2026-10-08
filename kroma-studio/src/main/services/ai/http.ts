import { KromaError } from '../../../shared/ipc'
import type { AiProviderId } from '../../../shared/types/settings'

type RequestBody = string | Buffer | Uint8Array | FormData | null

export interface FetchOptions {
  method?: string
  headers?: Record<string, string>
  body?: RequestBody
  timeoutMs?: number
}

export class Http {
  static async request(url: string, options: FetchOptions = {}, provider?: AiProviderId): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 90_000)
    try {
      const response = await fetch(url, { ...options, signal: controller.signal, body: options.body as never })
      if (!response.ok) throw Http.fromResponse(response, provider, await response.text().catch(() => ''))
      return response
    } catch (error) {
      if (error instanceof KromaError) throw error
      throw Http.fromUnknown(error, provider)
    } finally {
      clearTimeout(timer)
    }
  }

  static async json<T>(url: string, options: FetchOptions = {}, provider?: AiProviderId): Promise<T> {
    const response = await Http.request(url, options, provider)
    return (await response.json()) as T
  }

  static async buffer(url: string, options: FetchOptions = {}, provider?: AiProviderId): Promise<Buffer> {
    const response = await Http.request(url, options, provider)
    return Buffer.from(await response.arrayBuffer())
  }

  static fromResponse(response: Response, provider?: AiProviderId, body = ''): KromaError {
    const status = response.status
    const snippet = [provider, body.slice(0, 400)].filter(Boolean).join(' | ')
    if (status === 401 || status === 403) {
      return new KromaError('INVALID_KEY', 'That API key was rejected by the provider. Check it in Settings → AI Providers.', snippet)
    }
    if (status === 429) {
      return new KromaError('RATE_LIMITED', 'The provider rate-limited this request. Wait a moment and try again.', snippet)
    }
    if (status === 400) {
      return new KromaError('INVALID_INPUT', 'The provider rejected this request (check the prompt and size).', snippet)
    }
    if (status >= 500) {
      return new KromaError('UPSTREAM', `Provider error ${status}. Please try again.`, snippet)
    }
    return new KromaError('UPSTREAM', `Provider returned ${status}.`, snippet)
  }

  static fromUnknown(error: unknown, provider?: AiProviderId): KromaError {
    const message = error instanceof Error ? error.message : String(error)
    if (/abort/i.test(message)) return new KromaError('TIMEOUT', 'The request timed out. Try a shorter prompt or a faster model.', provider)
    if (/fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|network/i.test(message)) {
      return new KromaError('NETWORK', 'No connection to the AI provider. Check your internet connection.', provider)
    }
    return new KromaError('UNKNOWN', `AI request failed: ${message}`, provider)
  }
}

export const requireKey = (key: string | undefined, provider: AiProviderId, label: string): string => {
  if (!key) throw new KromaError('NOT_CONFIGURED', `${label} is not configured. Add your API key in Settings → AI Providers.`, provider)
  return key
}

export const dataUrlToBase64 = (dataUrl: string): string => dataUrl.slice(dataUrl.indexOf(',') + 1)

export const bufferToDataUrl = (buffer: Buffer, mime: string): string => `data:${mime};base64,${buffer.toString('base64')}`
