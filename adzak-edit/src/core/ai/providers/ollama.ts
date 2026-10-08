import type { AiModelInfo, AiProvider } from '../../types/ai';
import { extractCommands } from '../jsonRepair';

/**
 * Ollama provider.
 *
 * Ollama is a *local* server (default http://127.0.0.1:11434), so this does not
 * break the offline promise — nothing leaves the machine. The base URL is
 * configurable for llama.cpp's `llama-server`, which exposes an OpenAI-shaped
 * `/v1/chat/completions` endpoint; see `llamacpp.ts`.
 */

export interface OllamaOptions {
  baseUrl?: string;
  model?: string;
  /** Response format hint. 'json' uses Ollama's structured output. */
  format?: 'json' | 'text';
  timeoutMs?: number;
  temperature?: number;
  numCtx?: number;
}

export class OllamaProvider implements AiProvider {
  readonly id = 'ollama';
  readonly label = 'Ollama (local)';
  readonly requiresInternet = false;

  private readonly baseUrl: string;
  private model: string;
  private readonly format: 'json' | 'text';
  private readonly timeoutMs: number;
  private readonly temperature: number;
  private readonly numCtx: number;

  constructor(options: OllamaOptions = {}) {
    this.baseUrl = (options.baseUrl ?? 'http://127.0.0.1:11434').replace(/\/$/, '');
    this.model = options.model ?? 'qwen2.5:7b-instruct';
    this.format = options.format ?? 'json';
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.temperature = options.temperature ?? 0.1;
    this.numCtx = options.numCtx ?? 8192;
  }

  setModel(model: string): void {
    this.model = model;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await this.fetchWithTimeout(`${this.baseUrl}/api/tags`, { method: 'GET' });
      return response.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<AiModelInfo[]> {
    const response = await this.fetchWithTimeout(`${this.baseUrl}/api/tags`, { method: 'GET' });
    if (!response.ok) throw new Error('Could not reach the local Ollama server.');
    const json = (await response.json()) as { models?: { name: string; size?: number; details?: { parameter_size?: string } }[] };
    return (json.models ?? []).map((m) => ({
      id: m.name,
      sizeBytes: m.size,
      capabilities: m.details?.parameter_size ? [`size:${m.details.parameter_size}`] : [],
    }));
  }

  async completeJson<T>(prompt: string, schemaHint: string): Promise<T> {
    const body = {
      model: this.model,
      prompt,
      system: schemaHint,
      stream: false,
      format: this.format,
      options: { temperature: this.temperature, num_ctx: this.numCtx },
    };
    const response = await this.fetchWithTimeout(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(
        response.status === 404
          ? `The model "${this.model}" is not installed. Pull it with: ollama pull ${this.model}`
          : `The local model server returned an error (${response.status}). ${detail.slice(0, 200)}`,
      );
    }
    const json = (await response.json()) as { response?: string };
    const text = json.response ?? '';
    const extracted = extractCommands(text);
    if (!extracted.ok) {
      throw new Error(`The model returned something I could not read as commands: ${extracted.error}`);
    }
    return extracted.value as T;
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        throw new Error('The local model took too long to respond. Try a smaller model in Settings → AI Models.');
      }
      throw new Error(
        `Cannot reach the local model server at ${this.baseUrl}. ` +
          `Start it with "ollama serve", or switch the AI provider to Offline Assistant in Settings → AI.`,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
