/**
 * Font registry. Google Fonts are loaded on demand through the public CSS API (network needed);
 * user fonts are imported through FontFace from local files (persisted in IndexedDB as media assets).
 */
export interface FontDef {
  family: string;
  category: 'Sans' | 'Serif' | 'Display' | 'Handwriting' | 'Mono' | 'User';
  weights: number[];
  source: 'system' | 'google' | 'user';
}

export const FONTS: FontDef[] = [
  { family: 'Inter', category: 'Sans', weights: [400, 500, 600, 700, 800, 900], source: 'google' },
  { family: 'Roboto', category: 'Sans', weights: [400, 500, 700, 900], source: 'google' },
  { family: 'Montserrat', category: 'Sans', weights: [400, 600, 700, 800, 900], source: 'google' },
  { family: 'Poppins', category: 'Sans', weights: [400, 500, 600, 700, 800, 900], source: 'google' },
  { family: 'Oswald', category: 'Sans', weights: [400, 500, 600, 700], source: 'google' },
  { family: 'Bebas Neue', category: 'Display', weights: [400], source: 'google' },
  { family: 'Anton', category: 'Display', weights: [400], source: 'google' },
  { family: 'Archivo Black', category: 'Display', weights: [400], source: 'google' },
  { family: 'Bangers', category: 'Display', weights: [400], source: 'google' },
  { family: 'Luckiest Guy', category: 'Display', weights: [400], source: 'google' },
  { family: 'Lilita One', category: 'Display', weights: [400], source: 'google' },
  { family: 'Righteous', category: 'Display', weights: [400], source: 'google' },
  { family: 'Permanent Marker', category: 'Handwriting', weights: [400], source: 'google' },
  { family: 'Pacifico', category: 'Handwriting', weights: [400], source: 'google' },
  { family: 'Caveat', category: 'Handwriting', weights: [400, 700], source: 'google' },
  { family: 'Dancing Script', category: 'Handwriting', weights: [400, 700], source: 'google' },
  { family: 'Satisfy', category: 'Handwriting', weights: [400], source: 'google' },
  { family: 'Playfair Display', category: 'Serif', weights: [400, 700, 900], source: 'google' },
  { family: 'Merriweather', category: 'Serif', weights: [400, 700, 900], source: 'google' },
  { family: 'Lora', category: 'Serif', weights: [400, 700], source: 'google' },
  { family: 'Abril Fatface', category: 'Serif', weights: [400], source: 'google' },
  { family: 'Cinzel', category: 'Serif', weights: [400, 700, 900], source: 'google' },
  { family: 'JetBrains Mono', category: 'Mono', weights: [400, 700], source: 'google' },
  { family: 'Space Mono', category: 'Mono', weights: [400, 700], source: 'google' },
  { family: 'Press Start 2P', category: 'Display', weights: [400], source: 'google' },
  { family: 'Orbitron', category: 'Display', weights: [400, 700, 900], source: 'google' },
  { family: 'Audiowide', category: 'Display', weights: [400], source: 'google' },
  { family: 'Russo One', category: 'Display', weights: [400], source: 'google' },
  { family: 'Black Ops One', category: 'Display', weights: [400], source: 'google' },
  { family: 'Fredoka', category: 'Sans', weights: [400, 600, 700], source: 'google' },
  { family: 'Nunito', category: 'Sans', weights: [400, 700, 900], source: 'google' },
  { family: 'Raleway', category: 'Sans', weights: [400, 700, 900], source: 'google' },
  { family: 'Lato', category: 'Sans', weights: [400, 700, 900], source: 'google' },
  { family: 'Open Sans', category: 'Sans', weights: [400, 600, 700, 800], source: 'google' },
  { family: 'Kanit', category: 'Sans', weights: [400, 700, 900], source: 'google' },
  { family: 'Teko', category: 'Display', weights: [400, 700], source: 'google' },
  { family: 'Rubik Mono One', category: 'Display', weights: [400], source: 'google' },
  { family: 'Creepster', category: 'Display', weights: [400], source: 'google' },
  { family: 'Nosifer', category: 'Display', weights: [400], source: 'google' },
  { family: 'Monoton', category: 'Display', weights: [400], source: 'google' },
  { family: 'Arial', category: 'Sans', weights: [400, 700], source: 'system' },
  { family: 'Georgia', category: 'Serif', weights: [400, 700], source: 'system' },
  { family: 'Impact', category: 'Display', weights: [400], source: 'system' },
  { family: 'Courier New', category: 'Mono', weights: [400, 700], source: 'system' },
];

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
export function getFont(family: string): FontDef | undefined {
  return allFonts().find((f) => f.family === family);
}

/** Load a Google font (all listed weights). Resolves true when available for canvas rendering. */
export function ensureFont(family: string): Promise<boolean> {
  const def = getFont(family);
  if (!def || def.source !== 'google') return Promise.resolve(true);
  let p = loaded.get(family);
  if (p) return p;
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
      resolve(ok);
      notify();
    });
    setTimeout(() => resolve(false), 12000);
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
  notify();
  return def;
}

export const FONT_CATEGORIES: FontDef['category'][] = ['Sans', 'Display', 'Serif', 'Handwriting', 'Mono', 'User'];
