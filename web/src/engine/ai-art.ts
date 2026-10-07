/**
 * Prism procedural image engine.
 *
 * Used by AI image generation when no external provider is configured (and as
 * an instant, zero-cost "quick idea" generator even when one is). It is
 * deterministic: the same prompt always yields the same artwork, so results are
 * reproducible and shareable.
 *
 * Prompts are analysed for subject, mood and colour cues; the output is a
 * layered vector composition (mesh background, forms, light, grain).
 */

export type ArtOptions = {
  width?: number;
  height?: number;
  seed?: number;
  style?: 'auto' | 'abstract' | 'gradient' | 'geometric' | 'organic' | 'poster' | 'minimal';
  palette?: string[];
};

const MOOD_PALETTES: { key: string[]; colors: string[] }[] = [
  { key: ['ocean', 'sea', 'water', 'blue', 'بحر', 'أزرق'], colors: ['#022B3A', '#1F7A8C', '#00A8CC', '#7FD8E8', '#E8FBFF'] },
  { key: ['sunset', 'warm', 'orange', 'fire', 'غروب', 'برتقالي'], colors: ['#2B1055', '#7597DE', '#FF6B6B', '#FFA36B', '#FFE3A9'] },
  { key: ['forest', 'nature', 'green', 'eco', 'طبيعة', 'أخضر'], colors: ['#132A13', '#31572C', '#4F772D', '#90A955', '#ECF39E'] },
  { key: ['neon', 'night', 'cyber', 'gaming', 'نيون'], colors: ['#08070D', '#2D00F7', '#F20089', '#00F5D4', '#FEE440'] },
  { key: ['luxury', 'gold', 'premium', 'elegant', 'فاخر', 'ذهبي'], colors: ['#0D0D0D', '#2B2B2B', '#8C6D3F', '#D4AF37', '#F7E7B4'] },
  { key: ['coffee', 'bakery', 'earth', 'brown', 'بني'], colors: ['#3E1F00', '#8C4B1F', '#C87941', '#E6B87A', '#FBF1DE'] },
  { key: ['tech', 'saas', 'software', 'data', 'تقنية'], colors: ['#0A1F44', '#123C8C', '#2E6BE6', '#9DC3F5', '#F4F8FF'] },
  { key: ['health', 'beauty', 'soft', 'calm', 'صحة'], colors: ['#2B1B22', '#6D2E46', '#C05C7E', '#F58F7C', '#FFF1F3'] },
  { key: ['kids', 'playful', 'candy', 'fun', 'أطفال'], colors: ['#FFD6E0', '#FF9EBB', '#C77DFF', '#7B61FF', '#4EA8DE'] },
  { key: ['mono', 'minimal', 'black', 'white', 'أبيض'], colors: ['#0B0B0F', '#2D3436', '#636E72', '#B2BEC3', '#F5F6F8'] },
];

const STYLE_HINTS: Record<string, string[]> = {
  geometric: ['geometric', 'shape', 'abstract', 'grid', 'هندسي'],
  organic: ['organic', 'blob', 'fluid', 'liquid', 'عضوي'],
  poster: ['poster', 'retro', 'vintage', 'ملصق'],
  minimal: ['minimal', 'simple', 'clean', 'بسيط'],
  gradient: ['gradient', 'mesh', 'تدرج'],
};

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function rng(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export function paletteForPrompt(prompt: string): string[] {
  const lower = prompt.toLowerCase();
  for (const entry of MOOD_PALETTES) {
    if (entry.key.some((k) => lower.includes(k))) return entry.colors;
  }
  const seed = hash(prompt || 'prism');
  const base = seed % 360;
  const hsl = (h: number, s: number, l: number) => `hsl(${h}, ${s}%, ${l}%)`;
  return [hsl(base, 60, 12), hsl(base, 55, 30), hsl(base, 65, 52), hsl((base + 30) % 360, 70, 68), hsl((base + 60) % 360, 80, 90)];
}

function detectStyle(prompt: string, requested: ArtOptions['style']): NonNullable<ArtOptions['style']> {
  if (requested && requested !== 'auto') return requested;
  const lower = prompt.toLowerCase();
  for (const [style, hints] of Object.entries(STYLE_HINTS)) {
    if (hints.some((h) => lower.includes(h))) return style as NonNullable<ArtOptions['style']>;
  }
  return 'abstract';
}

function blob(seed: number, size: number, points = 6, variance = 0.25): string {
  const rand = rng(seed);
  const c = size / 2;
  const base = size * 0.3;
  const radii = Array.from({ length: points }, () => base * (1 - variance + rand() * variance * 2));
  const coords = radii.map((r, i) => {
    const angle = ((i / points) * 360 - 90) * (Math.PI / 180);
    return [c + r * Math.cos(angle), c + r * Math.sin(angle)] as const;
  });
  let d = `M${coords[0]![0].toFixed(1)},${coords[0]![1].toFixed(1)}`;
  for (let i = 0; i < points; i++) {
    const cur = coords[i]!;
    const next = coords[(i + 1) % points]!;
    const mx = (cur[0] + next[0]) / 2;
    const my = (cur[1] + next[1]) / 2;
    d += `Q${cur[0].toFixed(1)},${cur[1].toFixed(1)} ${mx.toFixed(1)},${my.toFixed(1)}`;
  }
  return `${d}Z`;
}

/**
 * Builds an SVG artwork for a prompt. Returns a data URL ready to drop into an
 * image node (vector, so it exports at any resolution).
 */
export function generateArtwork(prompt: string, options: ArtOptions = {}): string {
  const width = options.width ?? 1024;
  const height = options.height ?? 1024;
  const seed = options.seed ?? hash(prompt || 'prism');
  const rand = rng(seed);
  const palette = options.palette ?? paletteForPrompt(prompt);
  const style = detectStyle(prompt, options.style);
  const [dark, deep, mid, light, pale] = palette;

  const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length) % arr.length];

  const layers: string[] = [];
  layers.push(`<rect width="${width}" height="${height}" fill="${dark}"/>`);

  // Mesh background: soft radial forms
  const meshCount = style === 'minimal' ? 2 : 4;
  for (let i = 0; i < meshCount; i++) {
    const cx = width * (0.1 + rand() * 0.8);
    const cy = height * (0.1 + rand() * 0.8);
    const r = Math.max(width, height) * (0.25 + rand() * 0.4);
    const color = pick([deep, mid, light]);
    layers.push(
      `<circle cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" r="${r.toFixed(0)}" fill="${color}" opacity="${(0.28 + rand() * 0.35).toFixed(2)}" filter="url(#soft)"/>`,
    );
  }

  if (style === 'geometric') {
    const count = 5 + Math.floor(rand() * 6);
    for (let i = 0; i < count; i++) {
      const size = Math.min(width, height) * (0.08 + rand() * 0.3);
      const x = rand() * (width - size);
      const y = rand() * (height - size);
      const color = pick([mid, light, pale, deep]);
      const kind = Math.floor(rand() * 4);
      if (kind === 0) layers.push(`<rect x="${x.toFixed(0)}" y="${y.toFixed(0)}" width="${size.toFixed(0)}" height="${size.toFixed(0)}" rx="${(size * 0.12).toFixed(0)}" fill="${color}" opacity="${(0.35 + rand() * 0.5).toFixed(2)}"/>`);
      else if (kind === 1) layers.push(`<circle cx="${(x + size / 2).toFixed(0)}" cy="${(y + size / 2).toFixed(0)}" r="${(size / 2).toFixed(0)}" fill="${color}" opacity="${(0.35 + rand() * 0.5).toFixed(2)}"/>`);
      else if (kind === 2)
        layers.push(
          `<path d="M${(x + size / 2).toFixed(0)},${y.toFixed(0)} L${(x + size).toFixed(0)},${(y + size).toFixed(0)} L${x.toFixed(0)},${(y + size).toFixed(0)} Z" fill="${color}" opacity="${(0.35 + rand() * 0.5).toFixed(2)}"/>`,
        );
      else
        layers.push(
          `<rect x="${x.toFixed(0)}" y="${y.toFixed(0)}" width="${size.toFixed(0)}" height="${(size * 0.16).toFixed(0)}" rx="${(size * 0.08).toFixed(0)}" fill="${color}" opacity="${(0.4 + rand() * 0.4).toFixed(2)}" transform="rotate(${(rand() * 90 - 45).toFixed(0)} ${(x + size / 2).toFixed(0)} ${(y + size / 2).toFixed(0)})"/>`,
        );
    }
  } else if (style === 'organic') {
    const count = 3 + Math.floor(rand() * 4);
    for (let i = 0; i < count; i++) {
      const size = Math.min(width, height) * (0.3 + rand() * 0.6);
      const x = rand() * (width - size * 0.6) - size * 0.2;
      const y = rand() * (height - size * 0.6) - size * 0.2;
      const color = pick([deep, mid, light, pale]);
      layers.push(
        `<path d="${blob(seed + i * 977, size, 5 + Math.floor(rand() * 4))}" transform="translate(${x.toFixed(0)} ${y.toFixed(0)})" fill="${color}" opacity="${(0.3 + rand() * 0.45).toFixed(2)}" filter="url(#soft)"/>`,
      );
    }
  } else if (style === 'poster') {
    layers.push(`<circle cx="${(width * 0.5).toFixed(0)}" cy="${(height * 0.42).toFixed(0)}" r="${(Math.min(width, height) * 0.28).toFixed(0)}" fill="${mid}" opacity="0.95"/>`);
    layers.push(`<rect x="0" y="${(height * 0.72).toFixed(0)}" width="${width}" height="${(height * 0.06).toFixed(0)}" fill="${light}" opacity="0.9"/>`);
    layers.push(`<rect x="0" y="${(height * 0.8).toFixed(0)}" width="${(width * 0.6).toFixed(0)}" height="${(height * 0.025).toFixed(0)}" fill="${pale}" opacity="0.8"/>`);
  } else if (style === 'minimal') {
    layers.push(`<circle cx="${(width * 0.7).toFixed(0)}" cy="${(height * 0.32).toFixed(0)}" r="${(Math.min(width, height) * 0.2).toFixed(0)}" fill="${light}" opacity="0.85"/>`);
    layers.push(`<rect x="${(width * 0.12).toFixed(0)}" y="${(height * 0.66).toFixed(0)}" width="${(width * 0.5).toFixed(0)}" height="${(height * 0.012).toFixed(0)}" fill="${pale}" opacity="0.7"/>`);
  } else {
    const count = 4 + Math.floor(rand() * 5);
    for (let i = 0; i < count; i++) {
      const size = Math.min(width, height) * (0.15 + rand() * 0.45);
      const x = rand() * width - size / 2;
      const y = rand() * height - size / 2;
      const color = pick([deep, mid, light, pale]);
      if (rand() > 0.5) {
        layers.push(`<circle cx="${(x + size / 2).toFixed(0)}" cy="${(y + size / 2).toFixed(0)}" r="${(size / 2).toFixed(0)}" fill="${color}" opacity="${(0.22 + rand() * 0.4).toFixed(2)}" filter="url(#soft)"/>`);
      } else {
        layers.push(
          `<path d="${blob(seed + i * 331, size, 6)}" transform="translate(${x.toFixed(0)} ${y.toFixed(0)})" fill="${color}" opacity="${(0.2 + rand() * 0.4).toFixed(2)}" filter="url(#soft)"/>`,
        );
      }
    }
  }

  // Light sweep + grain
  layers.push(
    `<rect width="${width}" height="${height}" fill="url(#sheen)" opacity="0.5"/>`,
    `<rect width="${width}" height="${height}" filter="url(#grain)" opacity="0.16"/>`,
  );

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <filter id="soft" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="${(Math.min(width, height) * 0.05).toFixed(0)}"/></filter>
    <linearGradient id="sheen" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#ffffff" stop-opacity="0.18"/><stop offset="55%" stop-color="#ffffff" stop-opacity="0"/><stop offset="100%" stop-color="#000000" stop-opacity="0.22"/></linearGradient>
    <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter>
    <radialGradient id="vig" cx="50%" cy="50%" r="75%"><stop offset="60%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity="0.45"/></radialGradient>
  </defs>
  ${layers.join('\n  ')}
  <rect width="${width}" height="${height}" fill="url(#vig)"/>
</svg>`;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Variation seeds keep the same subject but change the composition. */
export function generateVariations(prompt: string, count = 4, options: ArtOptions = {}): string[] {
  const base = options.seed ?? hash(prompt || 'prism');
  return Array.from({ length: count }, (_, i) => generateArtwork(prompt, { ...options, seed: base + i * 7919 }));
}
