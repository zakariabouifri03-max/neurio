/**
 * Language-model backends for the AI director.
 *   • local  — small open chat models running in a Web Worker (transformers.js, ONNX, WebGPU or WASM).
 *   • api    — any OpenAI-compatible chat endpoint (OpenAI, OpenRouter, Groq, Mistral, Gemini-compat, Ollama…).
 *              The key is stored only in this browser's localStorage and requests go straight to the provider.
 *   • rules  — no model at all: a keyword parser (handled in director.ts). Always available, clearly labelled.
 */
import { WorkerClient, friendlyModelError, type ModelProgress } from './workerClient';

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export interface LocalModel {
  id: string;
  name: string;
  size: string;
  note: string;
}
export const LOCAL_MODELS: LocalModel[] = [
  { id: 'HuggingFaceTB/SmolLM2-360M-Instruct', name: 'SmolLM2 360M', size: '≈270 MB', note: 'Fastest · simple briefs' },
  { id: 'onnx-community/Qwen2.5-0.5B-Instruct', name: 'Qwen2.5 0.5B', size: '≈400 MB', note: 'Good multilingual (FR/AR) understanding' },
  { id: 'onnx-community/Qwen2.5-1.5B-Instruct', name: 'Qwen2.5 1.5B', size: '≈1.1 GB', note: 'Best quality · needs WebGPU + 4 GB RAM' },
];

export interface ApiPreset {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  keyUrl?: string;
}
export const API_PRESETS: ApiPreset[] = [
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', keyUrl: 'https://platform.openai.com/api-keys' },
  { id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini', keyUrl: 'https://openrouter.ai/keys' },
  { id: 'groq', name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', keyUrl: 'https://console.groq.com/keys' },
  { id: 'gemini', name: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.0-flash', keyUrl: 'https://aistudio.google.com/apikey' },
  { id: 'mistral', name: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', model: 'mistral-small-latest', keyUrl: 'https://console.mistral.ai/api-keys' },
  { id: 'ollama', name: 'Ollama (local server)', baseUrl: 'http://localhost:11434/v1', model: 'llama3.2' },
  { id: 'custom', name: 'Custom OpenAI-compatible', baseUrl: '', model: '' },
];

export interface ApiConfig {
  preset: string;
  baseUrl: string;
  model: string;
  key: string;
}
const API_KEY = 'neurio.llm.api';
export function loadApiConfig(): ApiConfig {
  try {
    const raw = localStorage.getItem(API_KEY);
    if (raw) return { ...{ preset: 'openai', baseUrl: API_PRESETS[0].baseUrl, model: API_PRESETS[0].model, key: '' }, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { preset: 'openai', baseUrl: API_PRESETS[0].baseUrl, model: API_PRESETS[0].model, key: '' };
}
export function saveApiConfig(c: ApiConfig) {
  localStorage.setItem(API_KEY, JSON.stringify(c));
}

/* ------------------------------- local worker ------------------------------- */
const client = new WorkerClient(() => new Worker(new URL('../workers/llm.worker.ts', import.meta.url), { type: 'module' }), 'LLM worker');

export function localLlmAvailability(): { ok: boolean; reason?: string; webgpu: boolean } {
  const webgpu = typeof navigator !== 'undefined' && 'gpu' in navigator;
  if (typeof Worker === 'undefined' || typeof WebAssembly === 'undefined') return { ok: false, reason: 'This browser lacks Web Workers / WebAssembly.', webgpu };
  if (typeof navigator !== 'undefined' && navigator.onLine === false && !client.ready) return { ok: false, reason: 'You are offline and no language model is cached yet.', webgpu };
  return { ok: true, webgpu };
}

export async function chatLocal(messages: ChatMessage[], opts: { model: string; device?: 'wasm' | 'webgpu'; maxTokens?: number; onProgress?: (p: ModelProgress) => void }): Promise<string> {
  try {
    return await client.request<string>({ type: 'chat', model: opts.model, device: opts.device ?? (localLlmAvailability().webgpu ? 'webgpu' : 'wasm'), messages, maxTokens: opts.maxTokens ?? 700 }, opts.onProgress);
  } catch (e) {
    throw new Error(friendlyModelError(e));
  }
}
export const cancelLocalLlm = () => client.cancelAll();
export const localLlmBusy = () => client.busy;

/* --------------------------------- API ---------------------------------- */
export async function chatApi(messages: ChatMessage[], cfg: ApiConfig, opts: { signal?: AbortSignal; json?: boolean; maxTokens?: number } = {}): Promise<string> {
  const base = cfg.baseUrl.replace(/\/+$/, '');
  if (!base) throw new Error('Enter the API base URL.');
  if (!cfg.model) throw new Error('Enter the model name.');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cfg.key) headers.Authorization = `Bearer ${cfg.key}`;
  if (cfg.preset === 'openrouter') { headers['HTTP-Referer'] = location.origin; headers['X-Title'] = 'Neurio Studio'; }
  const body: Record<string, unknown> = { model: cfg.model, messages, temperature: 0.2, max_tokens: opts.maxTokens ?? 900 };
  if (opts.json !== false) body.response_format = { type: 'json_object' };
  let res: Response;
  try {
    res = await fetch(`${base}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body), signal: opts.signal });
    if (res.status === 400 && opts.json !== false) {
      // some providers reject response_format — retry without it
      delete body.response_format;
      res = await fetch(`${base}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body), signal: opts.signal });
    }
  } catch (e: any) {
    if (e?.name === 'AbortError') throw e;
    throw new Error(`Could not reach ${base} — check your connection, the URL, and that the provider allows browser (CORS) requests. ${e?.message || ''}`.trim());
  }
  if (!res.ok) {
    let detail = '';
    try { const j = await res.json(); detail = j?.error?.message || j?.message || JSON.stringify(j).slice(0, 200); } catch { detail = await res.text().catch(() => ''); }
    if (res.status === 401 || res.status === 403) throw new Error(`The provider rejected the API key (${res.status}). ${detail}`);
    if (res.status === 429) throw new Error(`Rate limit / quota exceeded (429). ${detail}`);
    throw new Error(`Provider error ${res.status}: ${detail}`);
  }
  const j = await res.json();
  const text = j?.choices?.[0]?.message?.content;
  if (typeof text !== 'string') throw new Error('Unexpected response from the provider (no message content).');
  return text;
}
