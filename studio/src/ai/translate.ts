/**
 * Caption translation. Backend: OPUS-MT (MarianMT) models from Helsinki-NLP, converted to ONNX
 * (Xenova/*) and run locally in a Web Worker through @huggingface/transformers. One model per pair.
 */
import { WorkerClient, friendlyModelError, type ModelProgress } from './workerClient';

export interface TranslationPair {
  from: string;
  to: string;
  model: string;
  size: string;
}
const pair = (from: string, to: string, size = '≈75 MB'): TranslationPair => ({ from, to, model: `Xenova/opus-mt-${from}-${to}`, size });
export const TRANSLATION_PAIRS: TranslationPair[] = [
  pair('en', 'ar'), pair('ar', 'en'), pair('en', 'fr'), pair('fr', 'en'), pair('en', 'es'), pair('es', 'en'), pair('en', 'de'), pair('de', 'en'),
  pair('en', 'it'), pair('it', 'en'), pair('en', 'ru'), pair('ru', 'en'), pair('en', 'zh'), pair('zh', 'en'), pair('en', 'hi'), pair('hi', 'en'),
  pair('en', 'nl'), pair('nl', 'en'), pair('en', 'id'), pair('id', 'en'), pair('en', 'vi'), pair('vi', 'en'), pair('en', 'jap'), pair('jap', 'en'),
  pair('fr', 'ar'), pair('ar', 'fr'), pair('fr', 'es'), pair('es', 'fr'), pair('fr', 'de'), pair('de', 'fr'), pair('es', 'de'), pair('de', 'es'),
  pair('mul', 'en', '≈300 MB'),
];
export const TRANSLATION_LANGS: Record<string, string> = { en: 'English', ar: 'Arabic', fr: 'French', es: 'Spanish', de: 'German', it: 'Italian', ru: 'Russian', zh: 'Chinese', hi: 'Hindi', nl: 'Dutch', id: 'Indonesian', vi: 'Vietnamese', jap: 'Japanese', mul: 'Other (auto)', tr: 'Turkish', pt: 'Portuguese', pl: 'Polish', uk: 'Ukrainian', fa: 'Persian', ur: 'Urdu', ko: 'Korean', sv: 'Swedish', he: 'Hebrew' };
export const SOURCE_LANGS = ['en', 'ar', 'fr', 'es', 'de', 'it', 'ru', 'zh', 'hi', 'nl', 'id', 'vi', 'jap', 'tr', 'pt', 'pl', 'uk', 'fa', 'ur', 'ko', 'sv', 'he'];
export const TARGET_LANGS = ['en', 'ar', 'fr', 'es', 'de', 'it', 'ru', 'zh', 'hi', 'nl', 'id', 'vi', 'jap'];

/** Direct model for the pair, or the multilingual→English model when translating into English. */
export function findPair(from: string, to: string): TranslationPair | null {
  if (from === to) return null;
  return TRANSLATION_PAIRS.find((p) => p.from === from && p.to === to) ?? (to === 'en' ? TRANSLATION_PAIRS.find((p) => p.from === 'mul' && p.to === 'en')! : null);
}

const client = new WorkerClient(() => new Worker(new URL('../workers/translate.worker.ts', import.meta.url), { type: 'module' }), 'Translation worker');

export function translationAvailability(): { ok: boolean; reason?: string } {
  if (typeof Worker === 'undefined' || typeof WebAssembly === 'undefined') return { ok: false, reason: 'This browser lacks Web Workers / WebAssembly.' };
  if (typeof navigator !== 'undefined' && navigator.onLine === false && !client.ready) return { ok: false, reason: 'You are offline and no translation model is cached yet.' };
  return { ok: true };
}

export async function translateTexts(texts: string[], from: string, to: string, opts: { onProgress?: (p: ModelProgress) => void } = {}): Promise<string[]> {
  const p = findPair(from, to);
  if (!p) throw new Error(`No offline model for ${from} → ${to}.`);
  try {
    return await client.request<string[]>({ type: 'translate', model: p.model, texts, device: 'wasm' }, opts.onProgress);
  } catch (e) {
    throw new Error(friendlyModelError(e));
  }
}
export const cancelTranslation = () => client.cancelAll();
