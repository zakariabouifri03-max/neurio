// ============================================================================
// NEXUS AI AGENT — LLM client
// Calls the local server proxy (/api/ai/llm) which forwards to the configured
// provider (OpenAI-compatible or Anthropic). The API key never reaches the
// client. Tools are executed locally; the model only decides which to call.
// ============================================================================

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: any[];
  tool_call_id?: string;
  name?: string;
}

export interface LlmToolSpec {
  name: string;
  description: string;
  params: Record<string, { type: string; description?: string; required?: boolean }>;
  destructive?: boolean;
}

export async function callLlm(messages: LlmMessage[], tools: LlmToolSpec[] = []): Promise<LlmMessage> {
  const res = await fetch('/api/ai/llm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, tools }),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error ?? `LLM request failed (${res.status})`);
  }
  return res.json();
}

/** Tool-calling loop: model → tool calls → local execution → model → … */
export async function llmToolLoop(
  userText: string,
  system: string,
  runToolLocal: (name: string, args: any) => { ok: boolean; summary: string; details?: any },
  onProgress?: (text: string) => void,
  maxSteps = 12,
): Promise<string> {
  const { allTools } = await import('./tools');
  const tools: LlmToolSpec[] = allTools().map(t => ({
    name: t.name, description: t.description, params: t.params, destructive: t.destructive,
  }));
  const messages: LlmMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: userText },
  ];
  for (let step = 0; step < maxSteps; step++) {
    const reply = await callLlm(messages, tools);
    if (reply.tool_calls?.length) {
      messages.push(reply);
      for (const tc of reply.tool_calls) {
        let args: any = {};
        try { args = JSON.parse(tc.function?.arguments ?? '{}'); } catch { }
        const result = runToolLocal(tc.function?.name ?? '', args);
        messages.push({
          role: 'tool', tool_call_id: tc.id, name: tc.function?.name,
          content: JSON.stringify({ ok: result.ok, summary: result.summary, details: result.details }).slice(0, 4000),
        });
        onProgress?.(result.summary);
      }
      continue;
    }
    return reply.content ?? '';
  }
  return 'Reached the maximum number of tool steps — stopping here.';
}

/** Configure the provider server-side (AI Settings dialog). */
export async function configureLlm(cfg: { provider: string; baseUrl?: string; apiKey: string; model: string }): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch('/api/ai/config', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cfg),
  });
  return res.json();
}
