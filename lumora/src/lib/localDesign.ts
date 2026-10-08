import type { BlueprintElement, DesignBlueprint, DesignRequest } from '@/types/design';

/**
 * Offline design composer (renderer copy).
 * Mirrors electron/services/ai/DesignGenerator.ts so the browser preview and
 * the offline desktop path produce identical layouts without any API key.
 */

const PALETTES: Record<string, string[]> = {
  vibrant: ['#ff4d6d', '#ffd166', '#06d6a0', '#118ab2', '#1b1b2f'],
  vintage: ['#e8d8b9', '#c08457', '#7d4f2a', '#3f2a1d', '#a53f2b'],
  pastel: ['#ffd6e0', '#c1f0f6', '#fff3b0', '#d4c1f9', '#4a4e69'],
  monochrome: ['#ffffff', '#cfcfcf', '#8a8a8a', '#3d3d3d', '#111111'],
  neon: ['#00ffd5', '#ff00a0', '#7c5cff', '#f9f871', '#07070f'],
  earth: ['#dcd0a8', '#a3b18a', '#588157', '#3a5a40', '#2b2118'],
  ocean: ['#caf0f8', '#90e0ef', '#00b4d8', '#0077b6', '#03045e'],
  sunset: ['#ffcf70', '#ff9770', '#ff5f6d', '#8a2d6b', '#201335']
};

const FONTS: Record<string, { display: string; body: string }> = {
  modern: { display: 'Inter', body: 'Inter' },
  bold: { display: 'Impact', body: 'Arial' },
  elegant: { display: 'Georgia', body: 'Georgia' },
  playful: { display: 'Comic Sans MS', body: 'Verdana' },
  techy: { display: 'Consolas', body: 'Consolas' },
  classic: { display: 'Times New Roman', body: 'Georgia' }
};

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `id-${Math.random().toString(36).slice(2)}`);

function titleCase(s: string): string {
  return s.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1));
}

/** Offline, deterministic composer — always available, no API key required. */
export function composeLocally(req: DesignRequest): DesignBlueprint {
  const [w, h] = (req.aspect || '1080x1080').split('x').map((n) => parseInt(n, 10));
  const width = Number.isFinite(w) ? w : 1080;
  const height = Number.isFinite(h) ? h : 1080;
  const palette = PALETTES[req.palette] ?? PALETTES.vibrant;
  const fonts = FONTS[req.typography] ?? FONTS.modern;

  const words = req.prompt.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  const stop = new Set(['a', 'an', 'the', 'with', 'and', 'of', 'for', 'create', 'make', 'design', 'to', 'in', 'on']);
  const keywords = words.filter((x) => !stop.has(x.toLowerCase()));
  const headline = titleCase(keywords.slice(0, 3).join(' ') || 'Your Design');
  const subhead = titleCase(keywords.slice(3, 8).join(' ') || req.style || 'Made with Lumora');

  const bg = req.background === 'transparent' ? 'transparent' : palette[palette.length - 1];
  const elements: BlueprintElement[] = [];
  const pad = Math.round(Math.min(width, height) * 0.08);

  // Backdrop shapes scale with requested complexity.
  const shapeCount = req.complexity === 'minimal' ? 1 : req.complexity === 'rich' ? 6 : 3;
  for (let i = 0; i < shapeCount; i++) {
    const size = Math.round(Math.min(width, height) * (0.22 + (i % 3) * 0.12));
    elements.push({
      type: i % 3 === 0 ? 'ellipse' : i % 3 === 1 ? 'rect' : 'triangle',
      id: uid(),
      x: Math.round(((i * 37) % 80) / 100 * width),
      y: Math.round(((i * 53) % 70) / 100 * height),
      width: size,
      height: size,
      fill: palette[i % (palette.length - 1)],
      opacity: 0.18 + (i % 3) * 0.08,
      rx: i % 3 === 1 ? Math.round(size * 0.12) : 0,
      angle: (i * 23) % 40 - 20
    });
  }

  // Hero image slot (filled by the image generator when available).
  elements.push({
    type: 'image',
    id: uid(),
    prompt: `${req.prompt}. ${req.style} style, centered subject, clean composition`,
    x: Math.round(width * 0.2),
    y: Math.round(height * 0.18),
    width: Math.round(width * 0.6),
    height: Math.round(height * 0.42)
  });

  const headlineSize = Math.round(width / Math.max(6, headline.length * 0.55));
  elements.push({
    type: 'text',
    id: uid(),
    text: headline.toUpperCase(),
    x: pad,
    y: Math.round(height * 0.66),
    width: width - pad * 2,
    fontSize: Math.min(headlineSize, Math.round(height * 0.16)),
    fontFamily: fonts.display,
    fontWeight: 'bold',
    fill: palette[0],
    align: 'center',
    role: 'headline'
  });
  elements.push({
    type: 'text',
    id: uid(),
    text: subhead,
    x: pad,
    y: Math.round(height * 0.81),
    width: width - pad * 2,
    fontSize: Math.round(height * 0.045),
    fontFamily: fonts.body,
    fontWeight: 'normal',
    fill: palette[1],
    align: 'center',
    role: 'subhead'
  });

  return { title: headline, width, height, background: bg, palette, elements };
}

