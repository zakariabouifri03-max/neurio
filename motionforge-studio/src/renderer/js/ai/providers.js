// AI provider abstraction. Providers return text (expected to contain a JSON animation plan).
// New providers can be registered with registerProvider(type, factory) without touching the rest of the app.
import { S } from '../core/state.js';

const registry = new Map();
export function registerProvider(type, ctor, meta) { registry.set(type, { ctor, meta }); }
export const providerTypes = () => [...registry.entries()].map(([type, v]) => ({ type, ...v.meta }));

export class AIProvider {
  constructor(cfg) { this.cfg = cfg; }
  get id() { return this.cfg.id; }
  get label() { return this.cfg.label; }
  get offline() { return false; }
  /** @returns {Promise<string>} */
  async complete(/* { system, user, json } */) { throw new Error('not implemented'); }
  async test() { const r = await this.complete({ system: 'Reply with the single word OK.', user: 'ping', json: false }); return r.slice(0, 80); }
}

/** Any server that speaks POST {base}/chat/completions (OpenAI, OpenRouter, Groq, Together, Azure-compatible gateways, LM Studio, Ollama, llama.cpp…). */
export class OpenAICompatibleProvider extends AIProvider {
  get needsKey() { return true; }
  async complete({ system, user, json = true }) {
    const base = (this.cfg.baseUrl || '').replace(/\/+$/, '');
    if (!base) throw new Error('No API base URL configured.');
    const body = { model: this.cfg.model, temperature: this.cfg.temperature ?? 0.2, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] };
    if (json && this.cfg.jsonMode !== false) body.response_format = { type: 'json_object' };
    const send = (b) => window.mf.ai.request({ url: base + '/chat/completions', method: 'POST', headers: { 'Content-Type': 'application/json', ...(this.cfg.headers || {}) }, body: b, provider: this.id, useKey: this.needsKey, timeoutMs: this.cfg.timeoutMs || 120000 });
    let r = await send(body);
    if (!r.ok && r.status === 400 && body.response_format) { delete body.response_format; r = await send(body); } // servers without JSON mode
    if (!r.ok) throw new Error(r.error || `HTTP ${r.status}: ${(r.text || '').slice(0, 300)}`);
    let j; try { j = JSON.parse(r.text); } catch { throw new Error('Provider returned non-JSON response.'); }
    const msg = j.choices && j.choices[0] && j.choices[0].message;
    if (!msg || !msg.content) throw new Error('Provider returned an empty response.');
    return msg.content;
  }
}
/** Local AI server (Ollama / LM Studio / llama.cpp). No key required. */
export class LocalAIProvider extends OpenAICompatibleProvider {
  get needsKey() { return false; }
}
/** Built-in rule-based planner; works without any network. */
export class OfflineProvider extends AIProvider {
  get offline() { return true; }
  async complete({ user, planner }) { return JSON.stringify(planner ? planner(user) : { steps: [] }); }
}
registerProvider('openai-compatible', OpenAICompatibleProvider, { label: 'OpenAI-compatible API', needsKey: true, defaults: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' } });
registerProvider('local', LocalAIProvider, { label: 'Local AI (Ollama / LM Studio)', needsKey: false, defaults: { baseUrl: 'http://localhost:11434/v1', model: 'llama3.1' } });
registerProvider('offline', OfflineProvider, { label: 'Built-in offline planner', needsKey: false, defaults: {} });

export const DEFAULT_AI = {
  active: 'offline',
  providers: [
    { id: 'offline', type: 'offline', label: 'Offline Planner (built-in)' },
    { id: 'openai', type: 'openai-compatible', label: 'OpenAI-compatible', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    { id: 'local', type: 'local', label: 'Local AI (Ollama)', baseUrl: 'http://localhost:11434/v1', model: 'llama3.1' },
  ],
};
export function aiSettings() {
  const s = S.settings.ai || (S.settings.ai = JSON.parse(JSON.stringify(DEFAULT_AI)));
  if (!s.providers.some((p) => p.id === 'offline')) s.providers.unshift(DEFAULT_AI.providers[0]);
  return s;
}
export function getProvider(id) {
  const s = aiSettings(); const cfg = s.providers.find((p) => p.id === (id || s.active)) || s.providers[0];
  const reg = registry.get(cfg.type); if (!reg) throw new Error('Unknown provider type: ' + cfg.type);
  return new reg.ctor(cfg);
}
