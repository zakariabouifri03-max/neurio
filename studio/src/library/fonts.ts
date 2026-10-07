/**
 * Font registry. Google Fonts are loaded on demand through the public CSS API (network needed);
 * user fonts are imported through FontFace from local files (persisted in IndexedDB as media assets).
 */
import { GOOGLE_FONT_ROWS } from './googleFonts';

export interface FontDef {
  family: string;
  category: 'Sans' | 'Serif' | 'Display' | 'Handwriting' | 'Mono' | 'User';
  weights: number[];
  source: 'system' | 'google' | 'user';
  /** writing systems covered (google fonts subsets): latin, arabic, cyrillic, greek, hebrew, vietnamese, devanagari, japanese, korean, chinese, thai */
  scripts?: string[];
  italic?: boolean;
}

const SYSTEM_FONTS: FontDef[] = [
  { family: 'Arial', category: 'Sans', weights: [400, 700], source: 'system', scripts: ['latin', 'arabic', 'cyrillic', 'greek'] },
  { family: 'Georgia', category: 'Serif', weights: [400, 700], source: 'system', scripts: ['latin', 'cyrillic', 'greek'] },
  { family: 'Impact', category: 'Display', weights: [400], source: 'system', scripts: ['latin'] },
  { family: 'Courier New', category: 'Mono', weights: [400, 700], source: 'system', scripts: ['latin', 'arabic', 'cyrillic'] },
  { family: 'Times New Roman', category: 'Serif', weights: [400, 700], source: 'system', scripts: ['latin', 'arabic', 'cyrillic', 'greek'] },
  { family: 'Verdana', category: 'Sans', weights: [400, 700], source: 'system', scripts: ['latin', 'cyrillic', 'greek'] },
  { family: 'Trebuchet MS', category: 'Sans', weights: [400, 700], source: 'system', scripts: ['latin', 'cyrillic', 'greek'] },
  { family: 'Tahoma', category: 'Sans', weights: [400, 700], source: 'system', scripts: ['latin', 'arabic', 'cyrillic', 'hebrew'] },
];

/** 870+ Google Fonts families (open-source, loaded on demand) + common system fonts. */
export const FONTS: FontDef[] = [
  ...GOOGLE_FONT_ROWS.map(([family, category, weights, scripts, italic]): FontDef => ({ family, category, weights, source: 'google', scripts, italic: !!italic })),
  ...SYSTEM_FONTS,
];
export const FONT_SCRIPTS = ['latin', 'arabic', 'cyrillic', 'greek', 'hebrew', 'vietnamese', 'devanagari', 'japanese', 'korean', 'chinese', 'thai'] as const;
export type FontScript = (typeof FONT_SCRIPTS)[number];

const userFonts: FontDef[] = [];
const loaded = new Map<string, Promise<boolean>>();
const listeners = new Set<() => void>();
export const onFontsChanged = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
const notify = () => listeners.forEach((l) => l());

export function allFonts(): FontDef[] {
  return [...userFonts, ...FONTS];
}
const fontIndex = new Map(FONTS.map((f) => [f.family, f]));
export function getFont(family: string): FontDef | undefined {
  return userFonts.find((f) => f.family === family) ?? fontIndex.get(family);
}
/** Whether a loaded font is actually usable (false after a failed network load). */
export function fontStatus(family: string): 'loaded' | 'loading' | 'failed' | 'idle' {
  return status.get(family) ?? 'idle';
}
const status = new Map<string, 'loaded' | 'loading' | 'failed'>();

/** Load a Google font (all listed weights). Resolves true when available for canvas rendering. */
export function ensureFont(family: string): Promise<boolean> {
  const def = getFont(family);
  if (!def || def.source !== 'google') return Promise.resolve(true);
  let p = loaded.get(family);
  if (p) return p;
  status.set(family, 'loading');
  p = new Promise<boolean>((resolve) => {
    const id = `gf-${family.replace(/\s+/g, '-')}`;
    if (!document.getElementById(id)) {
      const link = document.createElement('link');
      link.id = id;
      link.rel = 'stylesheet';
      link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}:wght@${def.weights.join(';')}&display=swap`;
      document.head.appendChild(link);
      link.onerror = () => resolve(false);
    }
    const checks = def.weights.map((w) => document.fonts.load(`${w} 24px "${family}"`).catch(() => []));
    Promise.all(checks).then((r) => {
      const ok = r.some((faces) => faces.length > 0);
      status.set(family, ok ? 'loaded' : 'failed');
      resolve(ok);
      notify();
    });
    setTimeout(() => {
      if (status.get(family) === 'loading') status.set(family, 'failed');
      resolve(false);
    }, 12000);
  });
  loaded.set(family, p);
  return p;
}

export function registerUserFont(family: string): FontDef {
  const existing = userFonts.find((f) => f.family === family);
  if (existing) return existing;
  const def: FontDef = { family, category: 'User', weights: [400, 700], source: 'user' };
  userFonts.unshift(def);
  loaded.set(family, Promise.resolve(true));
  status.set(family, 'loaded');
  notify();
  return def;
}

export const FONT_CATEGORIES: FontDef['category'][] = ['Sans', 'Display', 'Serif', 'Handwriting', 'Mono', 'User'];
