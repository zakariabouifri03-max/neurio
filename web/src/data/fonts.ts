/**
 * Font catalogue.
 *
 * Families are loaded lazily from Google Fonts (only the ones a document
 * actually uses), and user-uploaded fonts are registered with the FontFace API.
 * Curated categories power the pairing + "automatic typography suggestions"
 * features; the raw list is intentionally large so the picker feels like a
 * professional type library.
 */

export type FontDef = {
  family: string;
  category: 'sans' | 'serif' | 'display' | 'mono' | 'handwriting' | 'arabic';
  weights: number[];
  popular?: boolean;
  /** Pairing hints used by the smart typography features. */
  pairsWith?: string[];
};

const SANS = [
  'Inter', 'Roboto', 'Open Sans', 'Montserrat', 'Poppins', 'Lato', 'Nunito', 'Raleway', 'Work Sans', 'Rubik',
  'DM Sans', 'Manrope', 'Outfit', 'Plus Jakarta Sans', 'Figtree', 'Sora', 'Epilogue', 'Space Grotesk', 'Archivo',
  'Barlow', 'Karla', 'Mulish', 'Jost', 'Hanken Grotesk', 'Urbanist', 'Schibsted Grotesk', 'Bricolage Grotesque',
  'Onest', 'Instrument Sans', 'Geist', 'Host Grotesk', 'General Sans', 'Albert Sans', 'Be Vietnam Pro', 'Familjen Grotesk',
  'Public Sans', 'IBM Plex Sans', 'Noto Sans', 'Source Sans 3', 'PT Sans', 'Hind', 'Hind Siliguri', 'Tajawal', 'Cairo',
  'Almarai', 'Noto Kufi Arabic', 'Noto Naskh Arabic', 'Rubik Mono One', 'Anton', 'Oswald', 'Archivo Black', 'Bebas Neue',
];

const SERIF = [
  'Playfair Display', 'Lora', 'Merriweather', 'DM Serif Display', 'Libre Baskerville', 'Cormorant Garamond', 'EB Garamond',
  'Crimson Pro', 'Source Serif 4', 'Noto Serif', 'PT Serif', 'Bitter', 'Zilla Slab', 'Roboto Slab', 'Arvo', 'Cardo',
  'Spectral', 'Literata', 'Newsreader', 'Fraunces', 'Instrument Serif', 'Bodoni Moda', 'Prata', 'Gloock', 'Marcelus',
  'Young Serif', 'Vollkorn', 'Alegreya', 'Lusitana', 'Faustina', 'Petrona', 'Rokkitt', 'Amiri', 'Reem Kufi', 'Noto Naskh Arabic',
];

const DISPLAY = [
  'Bebas Neue', 'Anton', 'Archivo Black', 'Alfa Slab One', 'Abril Fatface', 'Righteous', 'Bungee', 'Syne', 'Bowlby One',
  'Fugaz One', 'Fascinate', 'Telefon Black', 'Monoton', 'Poiret One', 'Cinzel', 'Cinzel Decorative', 'Playball', 'Lobster',
  'Pacifico', 'Fredoka', 'Fredoka One', 'Baloo 2', 'Bungee Shade', 'Shrikhand', 'Ultra', 'Racing Sans One', 'Titan One',
  'Big Shoulders Display', 'League Gothic', 'Oswald', 'Yeseva One', 'Rozha One', 'Kanit', 'Changa', 'Cairo Play',
];

const MONO = [
  'JetBrains Mono', 'Fira Code', 'IBM Plex Mono', 'Space Mono', 'Roboto Mono', 'Source Code Pro', 'Inconsolata', 'Anonymous Pro',
  'Courier Prime', 'Martian Mono', 'Reddit Mono', 'Geist Mono', 'Ubuntu Mono', 'Overpass Mono', 'Nanum Gothic Coding',
];

const HANDWRITING = [
  'Dancing Script', 'Great Vibes', 'Satisfy', 'Kalam', 'Caveat', 'Permanent Marker', 'Shadows Into Light', 'Gloria Hallelujah',
  'Amatic SC', 'Indie Flower', 'Architects Daughter', 'Sacramento', 'Parisienne', 'Allura', 'Alex Brush', 'Homemade Apple',
  'Reenie Beanie', 'Just Another Hand', 'Nothing You Could Do', 'Crafty Girls',
];

const ARABIC = ['Cairo', 'Tajawal', 'Almarai', 'Amiri', 'Reem Kufi', 'Noto Kufi Arabic', 'Noto Naskh Arabic', 'Aref Ruqaa', 'Rakkas', 'Lemonada', 'Mada', 'Changa', 'El Messiri', 'Harmattan', 'Scheherazade New', 'Lateef'];

function def(family: string, category: FontDef['category'], weights: number[], popular = false): FontDef {
  return { family, category, weights, popular };
}

const STANDARD_WEIGHTS = [300, 400, 500, 600, 700, 800];

export const FONTS: FontDef[] = [
  ...SANS.map((f) => def(f, 'sans', STANDARD_WEIGHTS, ['Inter', 'Montserrat', 'Poppins', 'Roboto', 'Open Sans', 'Cairo', 'Tajawal'].includes(f))),
  ...SERIF.map((f) => def(f, 'serif', [400, 500, 600, 700, 800], ['Playfair Display', 'Lora', 'DM Serif Display', 'Amiri'].includes(f))),
  ...DISPLAY.map((f) => def(f, 'display', [400, 700], ['Bebas Neue', 'Anton', 'Archivo Black', 'Syne'].includes(f))),
  ...MONO.map((f) => def(f, 'mono', [400, 500, 700], false)),
  ...HANDWRITING.map((f) => def(f, 'handwriting', [400, 700], ['Dancing Script', 'Caveat'].includes(f))),
  ...ARABIC.map((f) => def(f, 'arabic', [300, 400, 500, 700, 800], ['Cairo', 'Tajawal'].includes(f))),
];

export const FONT_CATEGORIES: { id: FontDef['category']; label: string }[] = [
  { id: 'sans', label: 'Sans serif' },
  { id: 'serif', label: 'Serif' },
  { id: 'display', label: 'Display' },
  { id: 'handwriting', label: 'Handwriting' },
  { id: 'mono', label: 'Monospace' },
  { id: 'arabic', label: 'Arabic' },
];

/**
 * Typography presets used by the text panel and the "make the typography
 * better" AI command. Each preset is a complete system (heading + body +
 * metrics) so one click restyles an entire document consistently.
 */
export type TypographyPreset = {
  id: string;
  name: string;
  heading: { family: string; weight: number; tracking: number; lineHeight: number; transform?: 'none' | 'uppercase' };
  body: { family: string; weight: number; tracking: number; lineHeight: number };
  scale: number; // heading size multiplier relative to body size
};

export const TYPOGRAPHY_PRESETS: TypographyPreset[] = [
  { id: 'classic', name: 'Classic editorial', heading: { family: 'Playfair Display', weight: 700, tracking: -0.5, lineHeight: 1.08 }, body: { family: 'Lora', weight: 400, tracking: 0, lineHeight: 1.65 }, scale: 2.6 },
  { id: 'modern', name: 'Modern geometric', heading: { family: 'Montserrat', weight: 800, tracking: -1, lineHeight: 1.05 }, body: { family: 'Inter', weight: 400, tracking: 0, lineHeight: 1.55 }, scale: 2.4 },
  { id: 'editorial', name: 'Magazine', heading: { family: 'DM Serif Display', weight: 400, tracking: 0, lineHeight: 1.02 }, body: { family: 'Inter', weight: 400, tracking: 0.02, lineHeight: 1.6 }, scale: 3 },
  { id: 'playful', name: 'Playful rounded', heading: { family: 'Fredoka', weight: 600, tracking: -0.5, lineHeight: 1.1 }, body: { family: 'Nunito', weight: 400, tracking: 0, lineHeight: 1.6 }, scale: 2.2 },
  { id: 'luxury', name: 'Luxury minimal', heading: { family: 'Cormorant Garamond', weight: 300, tracking: 1.5, lineHeight: 1.1, transform: 'uppercase' }, body: { family: 'Inter', weight: 300, tracking: 0.08, lineHeight: 1.8 }, scale: 2.8 },
  { id: 'bold', name: 'Bold impact', heading: { family: 'Archivo Black', weight: 400, tracking: -2, lineHeight: 0.95, transform: 'uppercase' }, body: { family: 'Inter', weight: 500, tracking: 0, lineHeight: 1.45 }, scale: 2.6 },
  { id: 'tech', name: 'Technical', heading: { family: 'Space Grotesk', weight: 700, tracking: -1, lineHeight: 1.08 }, body: { family: 'Inter', weight: 400, tracking: 0, lineHeight: 1.6 }, scale: 2.3 },
  { id: 'handwritten', name: 'Handwritten', heading: { family: 'Caveat', weight: 700, tracking: 0, lineHeight: 1.15 }, body: { family: 'Nunito', weight: 400, tracking: 0, lineHeight: 1.6 }, scale: 2.4 },
  { id: 'arabic-modern', name: 'Arabic modern (عربي)', heading: { family: 'Cairo', weight: 800, tracking: 0, lineHeight: 1.25 }, body: { family: 'Tajawal', weight: 400, tracking: 0, lineHeight: 1.8 }, scale: 2.3 },
  { id: 'arabic-classic', name: 'Arabic classic (عربي)', heading: { family: 'Amiri', weight: 700, tracking: 0, lineHeight: 1.35 }, body: { family: 'Almarai', weight: 400, tracking: 0, lineHeight: 1.9 }, scale: 2.4 },
];

export const FONT_PAIRINGS: { name: string; heading: string; body: string; mood: string }[] = [
  { name: 'Editorial contrast', heading: 'Playfair Display', body: 'Inter', mood: 'Confident, editorial' },
  { name: 'Geometric calm', heading: 'Montserrat', body: 'Inter', mood: 'Clean, corporate' },
  { name: 'Warm craft', heading: 'Fraunces', body: 'Work Sans', mood: 'Artisan, friendly' },
  { name: 'Tech forward', heading: 'Space Grotesk', body: 'Inter', mood: 'Startup, precise' },
  { name: 'Luxury serif', heading: 'Cormorant Garamond', body: 'Inter', mood: 'Premium, restrained' },
  { name: 'Loud poster', heading: 'Archivo Black', body: 'Inter', mood: 'Bold, high impact' },
  { name: 'Humanist', heading: 'DM Serif Display', body: 'Karla', mood: 'Approachable, cultured' },
  { name: 'Arabic pairing', heading: 'Cairo', body: 'Tajawal', mood: 'Modern Arabic' },
  { name: 'Soft rounded', heading: 'Fredoka', body: 'Nunito', mood: 'Playful, family' },
  { name: 'Industrial', heading: 'Oswald', body: 'Roboto', mood: 'Compact, functional' },
];

/* ------------------------------------------------------------------ loading */

const loadedFamilies = new Set<string>();
const loadingFamilies = new Set<string>();

/** Injects the Google Fonts stylesheet for a family (once per family). */
export function loadFont(family: string, weights: number[] = [400, 700]): Promise<void> {
  if (!family || typeof document === 'undefined') return Promise.resolve();
  if (loadedFamilies.has(family)) return Promise.resolve();
  if (loadingFamilies.has(family)) return Promise.resolve();

  loadingFamilies.add(family);
  const familyParam = `${family.replace(/\s+/g, '+')}:wght@${weights.join(';')}`;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${familyParam}&display=swap`;
  link.crossOrigin = 'anonymous';
  document.head.appendChild(link);

  if (document.fonts?.load) {
    const probes = weights.map((w) => document.fonts.load(`${w} 16px "${family}"`).catch(() => undefined));
    Promise.all(probes).then(() => {
      loadedFamilies.add(family);
      loadingFamilies.delete(family);
      document.dispatchEvent(new CustomEvent('prism:fontloaded', { detail: { family } }));
    });
  } else {
    loadedFamilies.add(family);
  }
  return Promise.resolve();
}

/** Loads every family referenced by a document. */
export function loadFontsForDocument(families: Iterable<string>): void {
  const list = [...new Set([...families].filter(Boolean))];
  for (const family of list) {
    const meta = FONTS.find((f) => f.family === family);
    loadFont(family, meta?.weights ?? [400, 700]);
  }
}

/** Registers an uploaded font file so it behaves like any other family. */
export async function registerUploadedFont(name: string, url: string): Promise<void> {
  if (typeof document === 'undefined' || !('FontFace' in window)) return;
  const face = new FontFace(name, `url(${url})`);
  await face.load();
  document.fonts.add(face);
  loadedFamilies.add(name);
}

export function isFontLoaded(family: string): boolean {
  return loadedFamilies.has(family);
}

/** Fallback stacks so text is never invisible while a webfont loads. */
export function fontStack(family: string): string {
  const meta = FONTS.find((f) => f.family === family);
  const fallbacks =
    meta?.category === 'serif'
      ? 'ui-serif, Georgia, serif'
      : meta?.category === 'mono'
        ? 'ui-monospace, SFMono-Regular, Menlo, monospace'
        : meta?.category === 'handwriting'
          ? 'cursive'
          : 'ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif';
  return `"${family}", ${fallbacks}`;
}
