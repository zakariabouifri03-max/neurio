/// <reference lib="webworker" />
/**
 * Local LLM worker: small instruction-tuned chat models (ONNX) running through @huggingface/transformers.
 * Used by the AI director to turn a free-text brief into a structured edit plan. Weights are downloaded
 * from the Hugging Face Hub on first use (≈250 MB – 1 GB depending on the model) and cached by the browser.
 */
import { pipeline, env, TextStreamer } from '@huggingface/transformers';

env.allowLocalModels = false;
env.useBrowserCache = true;

type Req =
  | { type: 'warm'; id: number; model: string; device: 'wasm' | 'webgpu' }
  | { type: 'chat'; id: number; model: string; device: 'wasm' | 'webgpu'; messages: { role: string; content: string }[]; maxTokens: number };

let current: { model: string; device: string; p: Promise<any> } | null = null;

function getPipeline(model: string, device: 'wasm' | 'webgpu', id: number) {
  if (current && current.model === model && current.device === device) return current.p;
  const p = pipeline('text-generation', model, {
    device,
    dtype: device === 'webgpu' ? 'q4f16' : 'q4',
    progress_callback: (ev: any) => {
      if (ev.status === 'progress') postMessage({ type: 'progress', id, stage: 'download', file: ev.file, progress: (ev.progress || 0) / 100, loaded: ev.loaded, total: ev.total });
      else if (ev.status === 'initiate') postMessage({ type: 'progress', id, stage: 'download', file: ev.file, progress: 0 });
      else if (ev.status === 'ready') postMessage({ type: 'progress', id, stage: 'ready', progress: 1 });
    },
  } as any);
  current = { model, device, p };
  p.catch(() => (current = null));
  return p;
}

self.onmessage = async (e: MessageEvent<Req>) => {
  const msg = e.data;
  try {
    const gen = await getPipeline(msg.model, msg.device, msg.id);
    if (msg.type === 'warm') {
      postMessage({ type: 'done', id: msg.id, result: null });
      return;
    }
    let produced = 0;
    const streamer = new TextStreamer(gen.tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: () => {
        produced++;
        postMessage({ type: 'progress', id: msg.id, stage: 'generate', progress: Math.min(0.95, produced / msg.maxTokens) });
      },
    } as any);
    const out = await gen(msg.messages, { max_new_tokens: msg.maxTokens, do_sample: false, repetition_penalty: 1.05, streamer, return_full_text: false } as any);
    const first = Array.isArray(out) ? out[0] : out;
    let text = '';
    const gt = (first as any)?.generated_text;
    if (typeof gt === 'string') text = gt;
    else if (Array.isArray(gt)) text = String(gt[gt.length - 1]?.content ?? '');
    postMessage({ type: 'done', id: msg.id, result: text });
  } catch (err: any) {
    postMessage({ type: 'error', id: msg.id, error: String(err?.message || err) });
  }
};
