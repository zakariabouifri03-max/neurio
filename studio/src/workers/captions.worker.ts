/// <reference lib="webworker" />
/**
 * Speech-to-text worker: runs OpenAI Whisper (ONNX, via @huggingface/transformers) off the main thread.
 * The model is downloaded from the Hugging Face Hub on first use and cached by the browser.
 */
import { pipeline, env } from '@huggingface/transformers';

env.allowLocalModels = false;
env.useBrowserCache = true;

type Req = { type: 'transcribe'; id: number; audio: Float32Array; model: string; language: string | null; device: 'wasm' | 'webgpu' } | { type: 'warm'; id: number; model: string; device: 'wasm' | 'webgpu' };

let current: { model: string; device: string; p: Promise<any> } | null = null;

function getPipeline(model: string, device: 'wasm' | 'webgpu', id: number) {
  if (current && current.model === model && current.device === device) return current.p;
  const p = pipeline('automatic-speech-recognition', model, {
    device,
    dtype: device === 'webgpu' ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : 'q8',
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
    const asr = await getPipeline(msg.model, msg.device, msg.id);
    postMessage({ type: 'progress', id: msg.id, stage: 'transcribe', progress: 0 });
    const isEnglishOnly = /\.en$/.test(msg.model);
    const total = msg.audio.length / 16000;
    const out = await asr(msg.audio, {
      return_timestamps: 'word',
      chunk_length_s: 30,
      stride_length_s: 5,
      language: isEnglishOnly ? undefined : msg.language || undefined,
      task: 'transcribe',
      // progress per generated chunk
      callback_function: undefined,
      chunk_callback: (chunk: any) => {
        const t = chunk?.stride?.[0] ? chunk.stride[0] : 0;
        postMessage({ type: 'progress', id: msg.id, stage: 'transcribe', progress: Math.min(0.99, total ? t / total : 0) });
      },
    } as any);
    const chunks: { text: string; timestamp: [number, number | null] }[] = (out as any).chunks || [];
    const words = chunks
      .map((c) => ({ text: String(c.text || '').trim(), start: Number(c.timestamp?.[0] ?? 0), end: Number(c.timestamp?.[1] ?? c.timestamp?.[0] ?? 0) }))
      .filter((w) => w.text.length > 0);
    // repair missing / non-monotonic ends
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (!isFinite(w.end) || w.end <= w.start) w.end = Math.min(words[i + 1]?.start ?? w.start + 0.4, w.start + 0.6);
      if (i > 0 && w.start < words[i - 1].end) w.start = words[i - 1].end;
      if (w.end <= w.start) w.end = w.start + 0.15;
    }
    postMessage({ type: 'done', id: msg.id, result: { text: String((out as any).text || '').trim(), words, duration: total } });
  } catch (err: any) {
    postMessage({ type: 'error', id: msg.id, error: String(err?.message || err) });
  }
};
