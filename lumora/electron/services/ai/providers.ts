import { settings } from '../settings';
import { secrets } from '../store';
import type { ProviderId } from '../../shared/types';

export class AIError extends Error {
  constructor(message: string, public code: string = 'ai_error') {
    super(message);
  }
}

export const SECRET_KEYS = {
  openai: 'openai_api_key',
  google: 'google_api_key',
  custom: 'custom_api_key',
  removebg: 'removebg_api_key'
} as const;

export function keyFor(provider: ProviderId | 'removebg'): string {
  const key = secrets.get(SECRET_KEYS[provider] ?? '');
  if (!key) {
    throw new AIError(
      `No API key configured for "${provider}". Open Settings → AI Providers and add your key.`,
      'missing_key'
    );
  }
  return key;
}

export function hasKey(provider: ProviderId | 'removebg'): boolean {
  return Boolean(secrets.get(SECRET_KEYS[provider] ?? ''));
}

const TIMEOUT_MS = 120_000;

export async function httpJSON<T>(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: unknown }
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: init.method ?? 'POST',
      headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal
    });
    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      throw new AIError(`Provider returned a non-JSON response (HTTP ${res.status}).`, 'bad_response');
    }
    if (!res.ok) {
      const msg =
        (parsed as any)?.error?.message ??
        (parsed as any)?.message ??
        `Provider request failed (HTTP ${res.status}).`;
      throw new AIError(String(msg), `http_${res.status}`);
    }
    return parsed as T;
  } catch (err) {
    if (err instanceof AIError) throw err;
    if ((err as Error).name === 'AbortError') throw new AIError('The AI request timed out.', 'timeout');
    throw new AIError(
      `Could not reach the AI provider. Check your internet connection. (${(err as Error).message})`,
      'network'
    );
  } finally {
    clearTimeout(timer);
  }
}

export function endpoints() {
  const s = settings.get().ai;
  return {
    s,
    textBase: () =>
      s.textProvider === 'openai' ? s.openaiBaseUrl : s.textProvider === 'google' ? s.googleBaseUrl : s.customBaseUrl,
    imageBase: () =>
      s.imageProvider === 'openai' ? s.openaiBaseUrl : s.imageProvider === 'google' ? s.googleBaseUrl : s.customBaseUrl
  };
}
