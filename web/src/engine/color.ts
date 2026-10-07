/**
 * Colour system: parsing/conversion (HEX, RGB, HSL, HSV, CMYK), WCAG contrast,
 * harmonies, palette extraction (median-cut quantisation) and gradient helpers.
 * Pure math — usable in workers.
 */

export type RGB = { r: number; g: number; b: number; a?: number };
export type HSL = { h: number; s: number; l: number; a?: number };
export type HSV = { h: number; s: number; v: number; a?: number };
export type CMYK = { c: number; m: number; y: number; k: number };

const NAMED: Record<string, string> = {
  white: '#ffffff', black: '#000000', red: '#ef4444', orange: '#f97316', amber: '#f59e0b',
  yellow: '#eab308', lime: '#84cc16', green: '#22c55e', emerald: '#10b981', teal: '#14b8a6',
  cyan: '#06b6d4', sky: '#0ea5e9', blue: '#3b82f6', indigo: '#6366f1', violet: '#8b5cf6',
  purple: '#a855f7', fuchsia: '#d946ef', pink: '#ec4899', rose: '#f43f5e', slate: '#64748b',
  gray: '#6b7280', grey: '#6b7280', zinc: '#71717a', neutral: '#737373', stone: '#78716c',
  brown: '#92400e', gold: '#d4af37', navy: '#0f172a', transparent: '#00000000',
};

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/* --------------------------------------------------------------- conversion */

export function parseColor(input: string): RGB {
  if (!input) return { r: 0, g: 0, b: 0, a: 1 };
  let s = String(input).trim().toLowerCase();
  if (NAMED[s]) s = NAMED[s];
  if (s === 'transparent' || s === 'none') return { r: 0, g: 0, b: 0, a: 0 };
  if (s.startsWith('#')) {
    let hex = s.slice(1);
    if (hex.length === 3 || hex.length === 4)
      hex = hex
        .split('')
        .map((c) => c + c)
        .join('');
    if (hex.length === 6) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: 1,
      };
    }
    if (hex.length === 8) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: parseInt(hex.slice(6, 8), 16) / 255,
      };
    }
  }
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const parts = m[1].split(/[,\s/]+/).filter(Boolean);
    const r = parseFloat(parts[0] ?? '0');
    const g = parseFloat(parts[1] ?? '0');
    const b = parseFloat(parts[2] ?? '0');
    const a = parts[3] !== undefined ? (parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3])) : 1;
    return { r: clamp(r, 0, 255), g: clamp(g, 0, 255), b: clamp(b, 0, 255), a: clamp(a, 0, 1) };
  }
  const hsl = s.match(/hsla?\(([^)]+)\)/);
  if (hsl) {
    const parts = hsl[1].split(/[,\s/]+/).filter(Boolean);
    return hslToRgb({
      h: parseFloat(parts[0] ?? '0'),
      s: parseFloat(parts[1] ?? '0') / 100,
      l: parseFloat(parts[2] ?? '0') / 100,
      a: parts[3] !== undefined ? parseFloat(parts[3]) : 1,
    });
  }
  return { r: 0, g: 0, b: 0, a: 1 };
}

export function toHex({ r, g, b }: RGB, includeAlpha = false): string {
  const h = (v: number) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

export function toRgbString({ r, g, b, a = 1 }: RGB): string {
  return a >= 1 ? `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})` : `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${round(a, 3)})`;
}

export function toHslString({ h, s, l, a = 1 }: HSL): string {
  return a >= 1
    ? `hsl(${Math.round(h)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`
    : `hsla(${Math.round(h)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%, ${round(a, 3)})`;
}

export function rgbToHsl({ r, g, b, a = 1 }: RGB): HSL {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
    else if (max === gn) h = ((bn - rn) / d + 2) * 60;
    else h = ((rn - gn) / d + 4) * 60;
  }
  return { h, s, l, a };
}

export function hslToRgb({ h, s, l, a = 1 }: HSL): RGB {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  let rgb: [number, number, number] = [0, 0, 0];
  if (hue < 60) rgb = [c, x, 0];
  else if (hue < 120) rgb = [x, c, 0];
  else if (hue < 180) rgb = [0, c, x];
  else if (hue < 240) rgb = [0, x, c];
  else if (hue < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return { r: (rgb[0] + m) * 255, g: (rgb[1] + m) * 255, b: (rgb[2] + m) * 255, a };
}

export function rgbToHsv({ r, g, b, a = 1 }: RGB): HSV {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max, a };
}

export function hsvToRgb({ h, s, v, a = 1 }: HSV): RGB {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let rgb: [number, number, number] = [0, 0, 0];
  const hue = ((h % 360) + 360) % 360;
  if (hue < 60) rgb = [c, x, 0];
  else if (hue < 120) rgb = [x, c, 0];
  else if (hue < 180) rgb = [0, c, x];
  else if (hue < 240) rgb = [0, x, c];
  else if (hue < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return { r: (rgb[0] + m) * 255, g: (rgb[1] + m) * 255, b: (rgb[2] + m) * 255, a };
}

/** Approximate CMYK (useful for print-oriented exports). */
export function rgbToCmyk({ r, g, b }: RGB): CMYK {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const k = 1 - Math.max(rn, gn, bn);
  if (k === 1) return { c: 0, m: 0, y: 0, k: 100 };
  return {
    c: ((1 - rn - k) / (1 - k)) * 100,
    m: ((1 - gn - k) / (1 - k)) * 100,
    y: ((1 - bn - k) / (1 - k)) * 100,
    k: k * 100,
  };
}

export function cmykToRgb({ c, m, y, k }: CMYK): RGB {
  const cn = c / 100;
  const mn = m / 100;
  const yn = y / 100;
  const kn = k / 100;
  return {
    r: 255 * (1 - cn) * (1 - kn),
    g: 255 * (1 - mn) * (1 - kn),
    b: 255 * (1 - yn) * (1 - kn),
    a: 1,
  };
}

/* ------------------------------------------------------------------ analysis */

export function relativeLuminance({ r, g, b }: RGB): number {
  const chan = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(parseColor(a));
  const lb = relativeLuminance(parseColor(b));
  const light = Math.max(la, lb);
  const dark = Math.min(la, lb);
  return (light + 0.05) / (dark + 0.05);
}

export type ContrastRating = 'AAA' | 'AA' | 'AA Large' | 'Fail';

export function contrastRating(ratio: number, large = false): ContrastRating {
  if (ratio >= 7) return 'AAA';
  if (ratio >= 4.5) return 'AA';
  if (large && ratio >= 3) return 'AA Large';
  return 'Fail';
}

export function isDark(color: string): boolean {
  return relativeLuminance(parseColor(color)) < 0.42;
}

export function readableOn(background: string, light = '#ffffff', dark = '#111827'): string {
  return isDark(background) ? light : dark;
}

export function mix(a: string, b: string, amount: number): string {
  const ca = parseColor(a);
  const cb = parseColor(b);
  const t = clamp(amount, 0, 1);
  return toHex({
    r: ca.r + (cb.r - ca.r) * t,
    g: ca.g + (cb.g - ca.g) * t,
    b: ca.b + (cb.b - ca.b) * t,
  });
}

export function withAlpha(color: string, alpha: number): string {
  const c = parseColor(color);
  return toRgbString({ ...c, a: clamp(alpha, 0, 1) });
}

export function shade(color: string, amount: number): string {
  return mix(color, amount > 0 ? '#ffffff' : '#000000', Math.abs(amount));
}

export function saturate(color: string, amount: number): string {
  const hsl = rgbToHsl(parseColor(color));
  return toHex(hslToRgb({ ...hsl, s: clamp(hsl.s + amount, 0, 1) }));
}

export function rotateHue(color: string, degrees: number): string {
  const hsl = rgbToHsl(parseColor(color));
  return toHex(hslToRgb({ ...hsl, h: hsl.h + degrees }));
}

/* ---------------------------------------------------------------- harmonies */

export function harmonies(color: string): Record<string, string[]> {
  const hsl = rgbToHsl(parseColor(color));
  const at = (h: number, s = hsl.s, l = hsl.l) => toHex(hslToRgb({ h: ((h % 360) + 360) % 360, s, l }));
  return {
    complementary: [at(hsl.h), at(hsl.h + 180)],
    analogous: [at(hsl.h - 30), at(hsl.h), at(hsl.h + 30)],
    triadic: [at(hsl.h), at(hsl.h + 120), at(hsl.h + 240)],
    tetradic: [at(hsl.h), at(hsl.h + 90), at(hsl.h + 180), at(hsl.h + 270)],
    monochrome: [at(hsl.h, hsl.s, 0.2), at(hsl.h, hsl.s, 0.4), at(hsl.h, hsl.s, 0.6), at(hsl.h, hsl.s, 0.8)],
    'split-complementary': [at(hsl.h), at(hsl.h + 150), at(hsl.h + 210)],
  };
}

export function generatePalette(base: string, count = 5, mode: keyof ReturnType<typeof harmonies> = 'analogous'): string[] {
  const set = harmonies(base)[mode] ?? harmonies(base).analogous;
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(set[i % set.length]);
  return out;
}

/* --------------------------------------------------------------- extraction */

type Pixel = { r: number; g: number; b: number };

/**
 * Median-cut quantisation — extracts the dominant colours of an image.
 * Runs on a downsampled pixel buffer, so it is fast even for large photos.
 */
export function extractPalette(data: Uint8ClampedArray | Uint8Array, colorCount = 6, step = 4): string[] {
  const pixels: Pixel[] = [];
  for (let i = 0; i < data.length; i += 4 * step) {
    const a = data[i + 3];
    if (a !== undefined && a < 125) continue;
    pixels.push({ r: data[i]!, g: data[i + 1]!, b: data[i + 2]! });
  }
  if (!pixels.length) return [];

  const boxes: Pixel[][] = [pixels];
  while (boxes.length < colorCount) {
    boxes.sort((a, b) => volume(b) - volume(a));
    const box = boxes.shift();
    if (!box || box.length < 2) {
      if (box) boxes.push(box);
      break;
    }
    const [a, b] = splitBox(box);
    boxes.push(a, b);
  }

  return boxes
    .filter((b) => b.length)
    .map((box) => {
      let r = 0;
      let g = 0;
      let bl = 0;
      for (const p of box) {
        r += p.r;
        g += p.g;
        bl += p.b;
      }
      return toHex({ r: r / box.length, g: g / box.length, b: bl / box.length });
    })
    .sort((a, b) => relativeLuminance(parseColor(b)) - relativeLuminance(parseColor(a)));
}

function channelRange(box: Pixel[], ch: keyof Pixel): number {
  let min = 255;
  let max = 0;
  for (const p of box) {
    min = Math.min(min, p[ch]);
    max = Math.max(max, p[ch]);
  }
  return max - min;
}

function volume(box: Pixel[]): number {
  return channelRange(box, 'r') * channelRange(box, 'g') * channelRange(box, 'b') * box.length;
}

function splitBox(box: Pixel[]): [Pixel[], Pixel[]] {
  const ranges: [keyof Pixel, number][] = [
    ['r', channelRange(box, 'r')],
    ['g', channelRange(box, 'g')],
    ['b', channelRange(box, 'b')],
  ];
  ranges.sort((a, b) => b[1] - a[1]);
  const ch = ranges[0][0];
  const sorted = [...box].sort((a, b) => a[ch] - b[ch]);
  const mid = Math.floor(sorted.length / 2);
  return [sorted.slice(0, mid), sorted.slice(mid)];
}

/* ---------------------------------------------------------------- gradients */

export function gradientCss(stops: { offset: number; color: string; opacity?: number }[], angle = 90, kind: 'linear' | 'radial' | 'conic' = 'linear'): string {
  const list = stops
    .slice()
    .sort((a, b) => a.offset - b.offset)
    .map((s) => `${withAlpha(s.color, s.opacity ?? 1)} ${Math.round(s.offset * 100)}%`)
    .join(', ');
  if (kind === 'radial') return `radial-gradient(circle at 50% 50%, ${list})`;
  if (kind === 'conic') return `conic-gradient(from ${angle}deg at 50% 50%, ${list})`;
  return `linear-gradient(${angle}deg, ${list})`;
}

export function randomPalette(count = 5, seed = Math.random()): string[] {
  const baseHue = seed * 360;
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const h = (baseHue + i * (360 / count)) % 360;
    out.push(toHex(hslToRgb({ h, s: 0.55 + (i % 3) * 0.12, l: 0.45 + (i % 2) * 0.16 })));
  }
  return out;
}

function round(v: number, p: number): number {
  const f = Math.pow(10, p);
  return Math.round(v * f) / f;
}

/** Curated palettes used by templates, smart variations and the colour panel. */
export const CURATED_PALETTES: { name: string; colors: string[] }[] = [
  { name: 'Midnight Violet', colors: ['#1B1035', '#3D2C8D', '#6C5CE7', '#A29BFE', '#F1F0FF'] },
  { name: 'Sunset Boulevard', colors: ['#2B1055', '#7597DE', '#FF6B6B', '#FFA36B', '#FFE3A9'] },
  { name: 'Emerald Calm', colors: ['#04302B', '#0B6E4F', '#00B894', '#55E6C1', '#E9FFF8'] },
  { name: 'Mono Studio', colors: ['#0B0B0F', '#2D3436', '#636E72', '#B2BEC3', '#F5F6F8'] },
  { name: 'Citrus Pop', colors: ['#1B1B1B', '#FFB800', '#FF7A00', '#FF4D6D', '#FFF3D6'] },
  { name: 'Ocean Deep', colors: ['#022B3A', '#1F7A8C', '#00A8CC', '#7FD8E8', '#E8FBFF'] },
  { name: 'Rose Editorial', colors: ['#2B1B22', '#6D2E46', '#C05C7E', '#F58F7C', '#FFF1F3'] },
  { name: 'Forest Print', colors: ['#132A13', '#31572C', '#4F772D', '#90A955', '#ECF39E'] },
  { name: 'Neon Night', colors: ['#08070D', '#2D00F7', '#F20089', '#00F5D4', '#FEE440'] },
  { name: 'Desert Clay', colors: ['#3E1F00', '#8C4B1F', '#C87941', '#E6B87A', '#FBF1DE'] },
  { name: 'Nordic Ice', colors: ['#0F2027', '#203A43', '#2C5364', '#8FB8C9', '#F0F7FA'] },
  { name: 'Retro Poster', colors: ['#F2E8CF', '#E76F51', '#F4A261', '#2A9D8F', '#264653'] },
  { name: 'Corporate Blue', colors: ['#0A1F44', '#123C8C', '#2E6BE6', '#9DC3F5', '#F4F8FF'] },
  { name: 'Gold Luxe', colors: ['#0D0D0D', '#2B2B2B', '#8C6D3F', '#D4AF37', '#F7E7B4'] },
  { name: 'Playful Candy', colors: ['#FFD6E0', '#FF9EBB', '#C77DFF', '#7B61FF', '#4EA8DE'] },
  { name: 'Earth Tones', colors: ['#3C2A21', '#6B4F3A', '#A47551', '#D0B49F', '#F4EEE1'] },
];
