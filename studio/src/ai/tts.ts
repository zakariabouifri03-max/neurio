/**
 * AI voice-over (text-to-speech). Backend: Kokoro-82M running locally in a Web Worker
 * (@huggingface/transformers + espeak-ng phonemizer). Nothing is faked: when the model cannot be
 * downloaded the feature reports itself unavailable with the reason.
 */
import { WorkerClient, friendlyModelError, type ModelProgress } from './workerClient';
import { getAudioContext } from '@/engine/MediaManager';

export interface TtsVoice {
  id: string;
  name: string;
  lang: 'en-us' | 'en-gb';
  gender: 'Female' | 'Male';
  grade: string;
}
/** Voices shipped with Kokoro v1.0 (quality grades from the model card). */
export const TTS_VOICES: TtsVoice[] = [
  { id: 'af_heart', name: 'Heart', lang: 'en-us', gender: 'Female', grade: 'A' },
  { id: 'af_bella', name: 'Bella', lang: 'en-us', gender: 'Female', grade: 'A-' },
  { id: 'af_nicole', name: 'Nicole', lang: 'en-us', gender: 'Female', grade: 'B-' },
  { id: 'af_aoede', name: 'Aoede', lang: 'en-us', gender: 'Female', grade: 'C+' },
  { id: 'af_kore', name: 'Kore', lang: 'en-us', gender: 'Female', grade: 'C+' },
  { id: 'af_sarah', name: 'Sarah', lang: 'en-us', gender: 'Female', grade: 'C+' },
  { id: 'af_nova', name: 'Nova', lang: 'en-us', gender: 'Female', grade: 'C' },
  { id: 'af_sky', name: 'Sky', lang: 'en-us', gender: 'Female', grade: 'C-' },
  { id: 'af_alloy', name: 'Alloy', lang: 'en-us', gender: 'Female', grade: 'C' },
  { id: 'am_fenrir', name: 'Fenrir', lang: 'en-us', gender: 'Male', grade: 'C+' },
  { id: 'am_michael', name: 'Michael', lang: 'en-us', gender: 'Male', grade: 'C+' },
  { id: 'am_puck', name: 'Puck', lang: 'en-us', gender: 'Male', grade: 'C+' },
  { id: 'am_echo', name: 'Echo', lang: 'en-us', gender: 'Male', grade: 'D' },
  { id: 'am_eric', name: 'Eric', lang: 'en-us', gender: 'Male', grade: 'D' },
  { id: 'am_liam', name: 'Liam', lang: 'en-us', gender: 'Male', grade: 'D' },
  { id: 'am_onyx', name: 'Onyx', lang: 'en-us', gender: 'Male', grade: 'D' },
  { id: 'am_adam', name: 'Adam', lang: 'en-us', gender: 'Male', grade: 'F+' },
  { id: 'bf_emma', name: 'Emma', lang: 'en-gb', gender: 'Female', grade: 'B-' },
  { id: 'bf_isabella', name: 'Isabella', lang: 'en-gb', gender: 'Female', grade: 'C' },
  { id: 'bf_alice', name: 'Alice', lang: 'en-gb', gender: 'Female', grade: 'D' },
  { id: 'bf_lily', name: 'Lily', lang: 'en-gb', gender: 'Female', grade: 'D' },
  { id: 'bm_george', name: 'George', lang: 'en-gb', gender: 'Male', grade: 'C' },
  { id: 'bm_fable', name: 'Fable', lang: 'en-gb', gender: 'Male', grade: 'C' },
  { id: 'bm_lewis', name: 'Lewis', lang: 'en-gb', gender: 'Male', grade: 'D+' },
  { id: 'bm_daniel', name: 'Daniel', lang: 'en-gb', gender: 'Male', grade: 'D' },
];

const client = new WorkerClient(() => new Worker(new URL('../workers/tts.worker.ts', import.meta.url), { type: 'module' }), 'Voice-over worker');

export function ttsAvailability(): { ok: boolean; reason?: string; webgpu: boolean } {
  const webgpu = typeof navigator !== 'undefined' && 'gpu' in navigator;
  if (typeof Worker === 'undefined' || typeof WebAssembly === 'undefined') return { ok: false, reason: 'This browser lacks Web Workers / WebAssembly.', webgpu };
  if (typeof navigator !== 'undefined' && navigator.onLine === false && !client.ready) return { ok: false, reason: 'You are offline and the voice model is not cached yet. Connect to the internet for the first run (≈90 MB).', webgpu };
  return { ok: true, webgpu };
}

export interface TtsResult {
  buffer: AudioBuffer;
  duration: number;
}
export async function synthesizeSpeech(text: string, opts: { voice?: string; speed?: number; device?: 'wasm' | 'webgpu'; onProgress?: (p: ModelProgress) => void } = {}): Promise<TtsResult> {
  const t = text.trim();
  if (!t) throw new Error('Nothing to say — type some text first.');
  if (t.length > 5000) throw new Error('Text is too long (max 5000 characters per voice-over).');
  try {
    const r = await client.request<{ pcm: Float32Array; sampleRate: number }>({ type: 'speak', text: t, voice: opts.voice || 'af_heart', speed: opts.speed ?? 1, device: opts.device || 'wasm' }, opts.onProgress);
    const ctx = getAudioContext();
    const buffer = ctx.createBuffer(1, r.pcm.length, r.sampleRate);
    buffer.copyToChannel(r.pcm as Float32Array<ArrayBuffer>, 0);
    return { buffer, duration: buffer.duration };
  } catch (e) {
    throw new Error(friendlyModelError(e));
  }
}
export const cancelSpeech = () => client.cancelAll();
export const ttsModelCached = () => client.ready;
