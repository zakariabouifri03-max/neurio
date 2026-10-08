import type { AiProvider } from '../../types/ai';

/**
 * llama.cpp / llama-server provider.
 *
 * llama-server exposes an OpenAI-compatible `/v1/chat/completions`. Same
 * offline guarantee as Ollama: the endpoint is on the local machine.
 */
export interface LlamaCppOptions {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  timeoutMs?: number;
  temperature?: number;
}

export class LlamaCppProvider implements AiProvider {
  readonly id = 'llamacpp';
  readonly label = 'llama.cpp server (local)';
  readonly requiresInternet = false;

  private readonly baseUrl: string;
  private readonly model: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly temperature: number;

  constructor(options: LlamaCppOptions = {}) {
    this.baseUrl = (options.baseUrl ?? 'http://127.0.0.1:8080').replace(/\/$/, '');
    this.model = options.model ?? 'local-model';
    this.apiKey = options.apiKey ?? '';
    this.timeoutMs = options.timeoutMs ?? 180_000;
    this.temperature = options.temperature ?? 0.1;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const r = await this.request('/v1/models', { method: 'GET' });
      return r.ok;
    } catch {
      return false;
    }
  }

  async listModels() {
    const r = await this.request('/v1/models', { method: 'GET' });
    if (!r.ok) throw new Error('Could not reach the local llama.cpp server.');
    const json = (await r.json()) as { data?: { id: string }[] };
    return (json.data ?? []).map((m) => ({ id: m.id }));
  }

  async completeJson<T>(prompt: string, schemaHint: string): Promise<T> {
    const response = await this.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: schemaHint },
          { role: 'user', content: prompt },
        ],
        temperature: this.temperature,
        response_format: { type: 'json_object' },
      }),
    });
    if (!response.ok) {
      throw new Error(`The local model server returned ${response.status}. Check that llama-server is running.`);
    }
    const json = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const text = json.choices?.[0]?.message?.content ?? '';
    const { extractCommands } = await import('../jsonRepair');
    const extracted = extractCommands(text);
    if (!extracted.ok) throw new Error(`The model returned something unreadable: ${extracted.error}`);
    return extracted.value as T;
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const headers = new Headers(init.headers);
    if (this.apiKey) headers.set('Authorization', `Bearer ${this.apiKey}`);
    try {
      return await fetch(`${this.baseUrl}${path}`, { ...init, headers, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }
}
