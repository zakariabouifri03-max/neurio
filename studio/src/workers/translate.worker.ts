/// <reference lib="webworker" />
/**
 * Caption translation worker: Helsinki-NLP OPUS-MT models (MarianMT, ONNX via @huggingface/transformers).
 * One model per language pair (≈ 75–300 MB each) downloaded from the Hugging Face Hub on first use and cached.
 */
import { pipeline, env } from '@huggingface/transformers';

env.allowLocalModels = false;
env.useBrowserCache = true;

type Req = { type: 'translate'; id: number; model: string; texts: string[]; device: 'wasm' | 'webgpu'; srcLang?: string; tgtLang?: string } | { type: 'warm'; id: number; model: string; device: 'wasm' | 'webgpu' };

let current: { model: string; device: string; p: Promise<any> } | null = null;
function getPipeline(model: string, device: 'wasm' | 'webgpu', id: number) {
  if (current && current.model === model && current.device === device) return current.p;
  const p = pipeline('translation', model, {
    device,
    dtype: 'q8',
    progress_callback: (ev: any) => {
      if (ev.status === 'progress') postMessage({ type: 'progress', id, stage: 'download', file: ev.file, progress: (ev.progress || 0) / 100, loaded: ev.loaded, total: ev.total });
      else if (ev.status === 'ready') postMessage({ type: 'progress', id, stage: 'ready', progress: 1 });
      else if (ev.status === 'initiate') postMessage({ type: 'progress', id, stage: 'download', file: ev.file, progress: 0 });
    },
  } as any);
  current = { model, device, p };
  p.catch(() => (current = null));
  return p;
}

self.onmessage = async (e: MessageEvent<Req>) => {
  const msg = e.data;
  try {
    if (msg.type === 'warm') {
      await getPipeline(msg.model, msg.device, msg.id);
      postMessage({ type: 'done', id: msg.id, result: null });
      return;
    }
    const tr = await getPipeline(msg.model, msg.device, msg.id);
    const out: string[] = [];
    for (let i = 0; i < msg.texts.length; i++) {
      postMessage({ type: 'progress', id: msg.id, stage: 'translate', progress: i / msg.texts.length });
      const t = msg.texts[i];
      if (!t.trim()) { out.push(t); continue; }
      const opts: any = { max_new_tokens: 256 };
      if (msg.srcLang) opts.src_lang = msg.srcLang;
      if (msg.tgtLang) opts.tgt_lang = msg.tgtLang;
      const r = await tr(t, opts);
      const txt = Array.isArray(r) ? (r[0] as any)?.translation_text : (r as any)?.translation_text;
      out.push(String(txt ?? '').trim());
    }
    postMessage({ type: 'done', id: msg.id, result: out });
  } catch (err: any) {
    postMessage({ type: 'error', id: msg.id, error: String(err?.message || err) });
  }
};
