import crypto from 'node:crypto';
import { TextGenerator } from './TextGenerator';
import { hasKey, AIError } from './providers';
import { settings } from '../settings';
import type { BlueprintElement, DesignBlueprint } from '../../shared/types';

export interface DesignRequest {
  prompt: string;
  style: string;
  palette: string;
  aspect: string; // "1080x1080"
  background: 'solid' | 'gradient' | 'transparent' | 'image';
  typography: string;
  complexity: 'minimal' | 'balanced' | 'rich';
}

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

const uid = () => crypto.randomUUID();

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

export class DesignGenerator {
  private text = new TextGenerator();

  /** Uses the configured text model when a key exists, else composes offline. */
  async generate(req: DesignRequest): Promise<{ blueprint: DesignBlueprint; source: 'ai' | 'offline' }> {
    const local = composeLocally(req);
    const provider = settings.get().ai.textProvider;
    if (!hasKey(provider)) return { blueprint: local, source: 'offline' };

    const schema = `Return ONLY minified JSON matching:
{"title":string,"background":string(hex or "transparent"),"palette":string[5],
"elements":[{"type":"text","text":string,"x":number,"y":number,"width":number,"fontSize":number,"fontFamily":string,"fontWeight":"bold"|"normal","fill":string,"align":"left"|"center"|"right","role":"headline"|"subhead"|"body"|"caption"}
|{"type":"rect"|"ellipse"|"triangle","x":number,"y":number,"width":number,"height":number,"fill":string,"opacity":number,"rx":number,"angle":number}
|{"type":"image","prompt":string,"x":number,"y":number,"width":number,"height":number}]}
Canvas is ${local.width}x${local.height} px; all coordinates are absolute top-left pixels and must stay inside the canvas.`;

    const instruction = `Design brief: ${req.prompt}
Style: ${req.style}. Palette mood: ${req.palette}. Typography: ${req.typography}. Background: ${req.background}. Complexity: ${req.complexity}.
Compose a balanced, professional layout with ${req.complexity === 'minimal' ? '3-5' : req.complexity === 'rich' ? '9-14' : '6-9'} elements.
${schema}`;

    try {
      const raw = await this.text.run('freeform', instruction);
      const parsed = extractJSON(raw);
      return { blueprint: normalize(parsed, local), source: 'ai' };
    } catch (err) {
      if (err instanceof AIError && err.code === 'missing_key') return { blueprint: local, source: 'offline' };
      throw err;
    }
  }

  /** Regenerate a single element's copy without touching the rest of the design. */
  async regenerateText(current: string, brief: string): Promise<string> {
    return this.text.run('freeform', `Rewrite this design text so it still fits the brief "${brief}". Keep a similar length. Text: "${current}"`);
  }
}

function extractJSON(raw: string): any {
  const cleaned = raw.replace(/```json|```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) throw new AIError('The model did not return a usable design.', 'bad_response');
  return JSON.parse(cleaned.slice(start, end + 1));
}

function normalize(parsed: any, fallback: DesignBlueprint): DesignBlueprint {
  const elements: BlueprintElement[] = Array.isArray(parsed?.elements)
    ? parsed.elements
        .filter((e: any) => e && typeof e.type === 'string')
        .map((e: any) => ({ ...e, id: uid() }))
        .slice(0, 40)
    : fallback.elements;
  return {
    title: typeof parsed?.title === 'string' ? parsed.title : fallback.title,
    width: fallback.width,
    height: fallback.height,
    background: typeof parsed?.background === 'string' ? parsed.background : fallback.background,
    palette: Array.isArray(parsed?.palette) && parsed.palette.length ? parsed.palette : fallback.palette,
    elements
  };
}
