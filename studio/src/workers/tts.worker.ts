/// <reference lib="webworker" />
/**
 * AI voice-over worker: Kokoro-82M (StyleTTS2 architecture, Apache-2.0) running locally through
 * @huggingface/transformers (ONNX). Phonemization is done with the bundled espeak-ng WASM (phonemizer).
 * Model weights (≈90 MB q8 / 330 MB fp32) and voice embeddings are downloaded from the Hugging Face Hub on
 * first use and cached by the browser. English (US/UK) voices only — that is what the model supports well.
 */
import { StyleTextToSpeech2Model, AutoTokenizer, Tensor, env } from '@huggingface/transformers';
import { phonemize } from 'phonemizer';

env.allowLocalModels = false;
env.useBrowserCache = true;

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const VOICE_URL = (id: string) => `https://huggingface.co/${MODEL_ID}/resolve/main/voices/${id}.bin`;
const SAMPLE_RATE = 24000;

type Req = { type: 'warm'; id: number; device: 'wasm' | 'webgpu' } | { type: 'speak'; id: number; text: string; voice: string; speed: number; device: 'wasm' | 'webgpu' };

let loaded: { device: string; p: Promise<{ model: any; tokenizer: any }> } | null = null;
const voiceCache = new Map<string, Float32Array>();

function progress(id: number, ev: any) {
  if (ev.status === 'progress') postMessage({ type: 'progress', id, stage: 'download', file: ev.file, progress: (ev.progress || 0) / 100, loaded: ev.loaded, total: ev.total });
  else if (ev.status === 'initiate') postMessage({ type: 'progress', id, stage: 'download', file: ev.file, progress: 0 });
  else if (ev.status === 'ready') postMessage({ type: 'progress', id, stage: 'ready', progress: 1 });
}

function load(device: 'wasm' | 'webgpu', id: number) {
  if (loaded && loaded.device === device) return loaded.p;
  const p = (async () => {
    const model = await StyleTextToSpeech2Model.from_pretrained(MODEL_ID, { device, dtype: device === 'webgpu' ? 'fp32' : 'q8', progress_callback: (ev: any) => progress(id, ev) } as any);
    const tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID, { progress_callback: (ev: any) => progress(id, ev) } as any);
    return { model, tokenizer };
  })();
  loaded = { device, p };
  p.catch(() => (loaded = null));
  return p;
}

async function voiceData(voice: string): Promise<Float32Array> {
  const hit = voiceCache.get(voice);
  if (hit) return hit;
  const url = VOICE_URL(voice);
  let cache: Cache | null = null;
  try {
    cache = await caches.open('neurio-tts-voices');
    const m = await cache.match(url);
    if (m) {
      const d = new Float32Array(await m.arrayBuffer());
      voiceCache.set(voice, d);
      return d;
    }
  } catch { /* cache unavailable */ }
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Voice download failed (${r.status})`);
  const buf = await r.arrayBuffer();
  if (cache) { try { await cache.put(url, new Response(buf.slice(0), { headers: { 'content-type': 'application/octet-stream' } })); } catch { /* ignore */ } }
  const d = new Float32Array(buf);
  voiceCache.set(voice, d);
  return d;
}

/** Light text normalisation (numbers/abbreviations are handled by espeak itself). */
function normalize(text: string) {
  return text
    .replace(/[‘’]/g, "'").replace(/[“”«»]/g, '"')
    .replace(/\bD[Rr]\.(?= [A-Z])/g, 'Doctor').replace(/\bMr\.(?= [A-Z])/g, 'Mister').replace(/\bMrs\.(?= [A-Z])/g, 'Misses').replace(/\bMs\.(?= [A-Z])/g, 'Miss')
    .replace(/\s+/g, ' ').trim();
}
async function toPhonemes(text: string, lang: 'a' | 'b') {
  const parts = await phonemize(normalize(text), lang === 'a' ? 'en-us' : 'en');
  let ph = parts.join(' ');
  ph = ph.replace(/ʲ/g, 'j').replace(/r/g, 'ɹ').replace(/x/g, 'k').replace(/ɬ/g, 'l').replace(/(?<=[a-zɹː])(?=hˈʌndɹɪd)/g, ' ').replace(/ z(?=[;:,.!?¡¿—…"«»“” ]|$)/g, 'z');
  if (lang === 'a') ph = ph.replace(/(?<=nˈaɪn)ti(?!ː)/g, 'di');
  return ph.trim();
}
/** Split long text into sentence-ish chunks the model handles well (≤ ~400 chars). */
function chunks(text: string): string[] {
  const out: string[] = [];
  const sentences = text.replace(/\s+/g, ' ').match(/[^.!?…\n]+[.!?…]*\s*/g) || [text];
  let cur = '';
  for (const s of sentences) {
    if ((cur + s).length > 380 && cur) { out.push(cur.trim()); cur = ''; }
    cur += s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter(Boolean);
}

self.onmessage = async (e: MessageEvent<Req>) => {
  const msg = e.data;
  try {
    if (msg.type === 'warm') {
      await load(msg.device, msg.id);
      postMessage({ type: 'done', id: msg.id, result: null });
      return;
    }
    const { model, tokenizer } = await load(msg.device, msg.id);
    const style = await voiceData(msg.voice);
    const lang = msg.voice.startsWith('b') ? 'b' : 'a';
    const parts = chunks(msg.text);
    const pcm: Float32Array[] = [];
    let total = 0;
    for (let i = 0; i < parts.length; i++) {
      postMessage({ type: 'progress', id: msg.id, stage: 'synthesize', progress: i / parts.length });
      const ph = await toPhonemes(parts[i], lang);
      if (!ph) continue;
      const { input_ids } = tokenizer(ph, { truncation: true });
      const nTok = Math.min(Math.max(input_ids.dims.at(-1) - 2, 0), 509);
      const off = 256 * nTok;
      const styleVec = style.slice(off, off + 256);
      const out = await model({ input_ids, style: new Tensor('float32', styleVec, [1, 256]), speed: new Tensor('float32', [msg.speed], [1]) });
      const wave = out.waveform.data as Float32Array;
      const copy = new Float32Array(wave.length + Math.round(SAMPLE_RATE * 0.12)); // small pause between chunks
      copy.set(wave, 0);
      pcm.push(copy);
      total += copy.length;
    }
    const all = new Float32Array(total);
    let o = 0;
    for (const p of pcm) { all.set(p, o); o += p.length; }
    postMessage({ type: 'done', id: msg.id, result: { pcm: all, sampleRate: SAMPLE_RATE } }, [all.buffer]);
  } catch (err: any) {
    postMessage({ type: 'error', id: msg.id, error: String(err?.message || err) });
  }
};
