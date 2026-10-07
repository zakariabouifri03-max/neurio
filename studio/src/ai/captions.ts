/**
 * Auto captions (speech → text with word timestamps).
 * Backend: OpenAI Whisper running locally in the browser (ONNX runtime, @huggingface/transformers) inside a Web Worker.
 * The model weights are fetched from huggingface.co on first use (≈40–250 MB depending on model) and cached by the browser.
 * If the download fails (offline / blocked), the feature reports itself as unavailable instead of pretending.
 */
import { getAudioBuffer, getAudioContext } from '@/engine/MediaManager';

export interface CaptionWordT {
  text: string;
  start: number;
  end: number;
}
export interface TranscriptResult {
  text: string;
  words: CaptionWordT[];
  duration: number;
  model: string;
  language: string | null;
}
export interface CaptionProgress {
  stage: 'download' | 'ready' | 'decode' | 'transcribe';
  progress: number; // 0..1
  file?: string;
  loaded?: number;
  total?: number;
}

export const WHISPER_MODELS = [
  { id: 'onnx-community/whisper-tiny.en', name: 'Whisper tiny (English)', size: '≈40 MB', note: 'Fastest · English only', languages: ['en'] },
  { id: 'onnx-community/whisper-tiny', name: 'Whisper tiny (multilingual)', size: '≈40 MB', note: 'Fast · 99 languages' },
  { id: 'onnx-community/whisper-base', name: 'Whisper base (multilingual)', size: '≈80 MB', note: 'Better accuracy' },
  { id: 'onnx-community/whisper-small', name: 'Whisper small (multilingual)', size: '≈250 MB', note: 'Best accuracy · slow on CPU' },
];

export const CAPTION_LANGUAGES: { code: string; name: string }[] = [
  { code: 'auto', name: 'Auto-detect' }, { code: 'en', name: 'English' }, { code: 'es', name: 'Spanish' }, { code: 'fr', name: 'French' }, { code: 'de', name: 'German' }, { code: 'it', name: 'Italian' }, { code: 'pt', name: 'Portuguese' }, { code: 'nl', name: 'Dutch' }, { code: 'ru', name: 'Russian' }, { code: 'uk', name: 'Ukrainian' }, { code: 'pl', name: 'Polish' }, { code: 'tr', name: 'Turkish' }, { code: 'ar', name: 'Arabic' }, { code: 'hi', name: 'Hindi' }, { code: 'bn', name: 'Bengali' }, { code: 'ur', name: 'Urdu' }, { code: 'fa', name: 'Persian' }, { code: 'id', name: 'Indonesian' }, { code: 'ms', name: 'Malay' }, { code: 'vi', name: 'Vietnamese' }, { code: 'th', name: 'Thai' }, { code: 'ja', name: 'Japanese' }, { code: 'ko', name: 'Korean' }, { code: 'zh', name: 'Chinese' }, { code: 'sv', name: 'Swedish' }, { code: 'da', name: 'Danish' }, { code: 'no', name: 'Norwegian' }, { code: 'fi', name: 'Finnish' }, { code: 'el', name: 'Greek' }, { code: 'he', name: 'Hebrew' }, { code: 'cs', name: 'Czech' }, { code: 'ro', name: 'Romanian' }, { code: 'hu', name: 'Hungarian' }, { code: 'ta', name: 'Tamil' }, { code: 'sw', name: 'Swahili' },
];

export interface Availability {
  ok: boolean;
  reason?: string;
  webgpu: boolean;
}
export function captionsAvailability(): Availability {
  const webgpu = typeof navigator !== 'undefined' && 'gpu' in navigator;
  if (typeof Worker === 'undefined' || typeof WebAssembly === 'undefined') return { ok: false, reason: 'This browser lacks Web Workers / WebAssembly.', webgpu };
  if (typeof navigator !== 'undefined' && navigator.onLine === false && !modelKnownCached) return { ok: false, reason: 'You are offline and no speech model is cached yet. Connect to the internet for the first run.', webgpu };
  return { ok: true, webgpu };
}
let modelKnownCached = false;

let worker: Worker | null = null;
let seq = 1;
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; onProgress?: (p: CaptionProgress) => void }>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('../workers/captions.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<any>) => {
    const m = e.data;
    const p = pending.get(m.id);
    if (!p) return;
    if (m.type === 'progress') p.onProgress?.({ stage: m.stage, progress: m.progress, file: m.file, loaded: m.loaded, total: m.total });
    else if (m.type === 'done') {
      pending.delete(m.id);
      modelKnownCached = true;
      p.resolve(m.result);
    } else if (m.type === 'error') {
      pending.delete(m.id);
      p.reject(new Error(m.error));
    }
  };
  worker.onerror = (e) => {
    const err = new Error(e.message || 'Speech worker crashed');
    pending.forEach((p) => p.reject(err));
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

/** Cancel everything in flight (terminates the worker; the model cache survives). */
export function cancelTranscriptions() {
  pending.forEach((p) => p.reject(new Error('Cancelled')));
  pending.clear();
  worker?.terminate();
  worker = null;
}

/** Downmix + resample any AudioBuffer (or a slice of it) to 16 kHz mono Float32 as Whisper expects. */
export async function toWhisperPCM(buffer: AudioBuffer, from = 0, to = buffer.duration): Promise<Float32Array> {
  const sr = 16000;
  const len = Math.max(1, Math.round((to - from) * sr));
  const off = new OfflineAudioContext(1, len, sr);
  const src = off.createBufferSource();
  src.buffer = buffer;
  src.connect(off.destination);
  src.start(0, from, to - from);
  const out = await off.startRendering();
  return out.getChannelData(0).slice();
}

export interface TranscribeOptions {
  model?: string;
  language?: string | null; // null/auto = detect
  device?: 'auto' | 'wasm' | 'webgpu';
  onProgress?: (p: CaptionProgress) => void;
}

export async function transcribePCM(audio: Float32Array, opts: TranscribeOptions = {}): Promise<TranscriptResult> {
  const avail = captionsAvailability();
  if (!avail.ok) throw new Error(avail.reason);
  const model = opts.model || WHISPER_MODELS[1].id;
  const device: 'wasm' | 'webgpu' = opts.device === 'webgpu' || (opts.device === 'auto' && avail.webgpu) ? 'webgpu' : 'wasm';
  const language = !opts.language || opts.language === 'auto' ? null : opts.language;
  const w = getWorker();
  const id = seq++;
  const res: { text: string; words: CaptionWordT[]; duration: number } = await new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress: opts.onProgress });
    w.postMessage({ type: 'transcribe', id, audio, model, language, device }, [audio.buffer]);
  });
  return { ...res, model, language };
}

/** Transcribe a media asset (whole file or [from,to] in source seconds). */
export async function transcribeAsset(mediaId: string, opts: TranscribeOptions & { from?: number; to?: number } = {}): Promise<TranscriptResult> {
  opts.onProgress?.({ stage: 'decode', progress: 0 });
  const buf = await getAudioBuffer(mediaId);
  if (!buf) throw new Error('This media has no decodable audio track.');
  getAudioContext(); // ensure context exists for later playback
  const pcm = await toWhisperPCM(buf, opts.from ?? 0, Math.min(buf.duration, opts.to ?? buf.duration));
  opts.onProgress?.({ stage: 'decode', progress: 1 });
  return transcribePCM(pcm, opts);
}

/** Pre-download a model so the first transcription is instant. */
export function warmModel(model: string, onProgress?: (p: CaptionProgress) => void, device: 'wasm' | 'webgpu' = 'wasm') {
  const w = getWorker();
  const id = seq++;
  return new Promise<void>((resolve, reject) => {
    pending.set(id, { resolve: () => resolve(), reject, onProgress });
    w.postMessage({ type: 'warm', id, model, device });
  });
}

/* ------------------------------ grouping & export ------------------------------ */
export interface CaptionLine {
  start: number;
  end: number;
  words: CaptionWordT[];
  text: string;
}

/** Group words into caption lines: at most `maxWords`, `maxDuration` seconds, break on long pauses & sentence ends. */
export function groupWords(words: CaptionWordT[], opts: { maxWords?: number; maxDuration?: number; maxGap?: number; maxChars?: number } = {}): CaptionLine[] {
  const maxWords = opts.maxWords ?? 4, maxDuration = opts.maxDuration ?? 3.5, maxGap = opts.maxGap ?? 0.7, maxChars = opts.maxChars ?? 32;
  const lines: CaptionLine[] = [];
  let cur: CaptionWordT[] = [];
  const flush = () => {
    if (!cur.length) return;
    lines.push({ start: cur[0].start, end: cur[cur.length - 1].end, words: cur, text: cur.map((w) => w.text).join(' ') });
    cur = [];
  };
  for (const w of words) {
    const prev = cur[cur.length - 1];
    const chars = cur.reduce((a, x) => a + x.text.length + 1, 0) + w.text.length;
    if (cur.length && (cur.length >= maxWords || w.end - cur[0].start > maxDuration || w.start - prev.end > maxGap || chars > maxChars || /[.!?…]$/.test(prev.text))) flush();
    cur.push(w);
  }
  flush();
  // avoid overlaps & give short lines a minimum readable duration
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i], n = lines[i + 1];
    const minEnd = l.start + Math.max(0.6, l.text.length * 0.045);
    l.end = Math.max(l.end, Math.min(minEnd, n ? n.start - 0.02 : minEnd));
  }
  return lines;
}

const ts = (t: number, sep: ',' | '.') => {
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60), ms = Math.round((t - Math.floor(t)) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${sep}${String(ms).padStart(3, '0')}`;
};
export function toSRT(lines: { start: number; end: number; text: string }[]): string {
  return lines.map((l, i) => `${i + 1}\n${ts(l.start, ',')} --> ${ts(l.end, ',')}\n${l.text}\n`).join('\n');
}
export function toVTT(lines: { start: number; end: number; text: string }[]): string {
  return 'WEBVTT\n\n' + lines.map((l) => `${ts(l.start, '.')} --> ${ts(l.end, '.')}\n${l.text}\n`).join('\n');
}
/** Parse SRT / VTT text into lines (manual import). */
export function parseSubtitles(text: string): CaptionLine[] {
  const lines: CaptionLine[] = [];
  const re = /(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})/;
  const blocks = text.replace(/\r/g, '').split(/\n\s*\n/);
  for (const b of blocks) {
    const ls = b.split('\n');
    const ti = ls.findIndex((l) => re.test(l));
    if (ti < 0) continue;
    const m = ls[ti].match(re)!;
    const toS = (h: string, mi: string, s: string, ms: string) => +h * 3600 + +mi * 60 + +s + +ms.padEnd(3, '0') / 1000;
    const start = toS(m[1], m[2], m[3], m[4]), end = toS(m[5], m[6], m[7], m[8]);
    const txt = ls.slice(ti + 1).join(' ').replace(/<[^>]+>/g, '').trim();
    if (!txt) continue;
    const ws = txt.split(/\s+/);
    const per = (end - start) / ws.length;
    lines.push({ start, end, text: txt, words: ws.map((w, i) => ({ text: w, start: start + i * per, end: start + (i + 1) * per })) });
  }
  return lines;
}
