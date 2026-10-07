/**
 * Template engine.
 *
 * A template is *not* a picture — it is a real Prism document (pages + nodes)
 * produced by a recipe, so every template is fully editable the moment it
 * opens. Recipes are parameterised by palette + copy set, which is how a few
 * dozen layouts become a catalogue of hundreds of distinct templates.
 *
 * The same functions run in the browser (live previews, "use this template")
 * and in the seed script (persisted to the templates table).
 */
import type { DocKind, Page, Paint, SceneNode, TextStyle } from '@/engine/types';
import { createChart, createEllipse, createFrame, createRect, createTable, createText, linearGradient, solid, uid } from '@/engine/factory';
import { CURATED_PALETTES, withAlpha } from '@/engine/color';
import { CONTENT_SETS, type ContentSet } from './content';

/* ----------------------------------------------------------------- palettes */

export type Palette = {
  name: string;
  bg: string;
  surface: string;
  ink: string;
  muted: string;
  accent: string;
  accent2: string;
  heading: string;
  body: string;
  dark: boolean;
};

const FONT_PAIRS: { heading: string; body: string }[] = [
  { heading: 'Playfair Display', body: 'Inter' },
  { heading: 'DM Serif Display', body: 'Inter' },
  { heading: 'Montserrat', body: 'Inter' },
  { heading: 'Space Grotesk', body: 'Inter' },
  { heading: 'Bebas Neue', body: 'Inter' },
  { heading: 'Archivo Black', body: 'Inter' },
  { heading: 'Syne', body: 'Inter' },
  { heading: 'Lora', body: 'Inter' },
  { heading: 'Oswald', body: 'Inter' },
  { heading: 'Roboto Slab', body: 'Inter' },
];

export const PALETTES: Palette[] = CURATED_PALETTES.map((p, i) => {
  const [darkest, deep, accent, accent2, light] = p.colors;
  const pair = FONT_PAIRS[i % FONT_PAIRS.length]!;
  const dark = i % 3 !== 2; // mix of dark & light designs
  return {
    name: p.name,
    bg: dark ? darkest : light,
    surface: dark ? deep : '#ffffff',
    ink: dark ? light : darkest,
    muted: dark ? accent2 : deep,
    accent,
    accent2,
    heading: pair.heading,
    body: pair.body,
    dark,
  };
});

export type Ctx = {
  w: number;
  h: number;
  p: Palette;
  c: ContentSet;
  /** fractional → px helpers */
  fx: (v: number) => number;
  fy: (v: number) => number;
};

/* ------------------------------------------------------------------ helpers */

function text(
  text_: string,
  x: number,
  y: number,
  w: number,
  h: number,
  style: Partial<TextStyle> = {},
  opts: Partial<SceneNode> = {},
): SceneNode {
  return createText(text_, style, { x, y, width: w, height: h, ...opts });
}

function box(x: number, y: number, w: number, h: number, fill: Paint | null, opts: Partial<SceneNode> = {}): SceneNode {
  return createRect({ x, y, width: w, height: h, fill, ...opts });
}

function circle(x: number, y: number, d: number, fill: Paint | null, opts: Partial<SceneNode> = {}): SceneNode {
  return createEllipse({ x, y, width: d, height: d, fill, ...opts });
}

/** Stand-in for photography: a gradient panel with a soft highlight. */
function photo(x: number, y: number, w: number, h: number, p: Palette, radius = 0, tint = 0): SceneNode {
  const node = createRect({
    x,
    y,
    width: w,
    height: h,
    radius,
    fill: linearGradient([p.accent, p.accent2, p.muted], 135),
    name: 'Photo',
    clip: true,
  });
  node.children = [
    createEllipse({
      x: w * 0.62,
      y: -h * 0.28,
      width: w * 0.9,
      height: h * 0.9,
      fill: { type: 'solid', color: '#ffffff', opacity: 0.22 + tint * 0.1 },
    }),
    createEllipse({
      x: -w * 0.22,
      y: h * 0.55,
      width: w * 0.8,
      height: w * 0.8,
      fill: { type: 'solid', color: p.ink, opacity: 0.12 },
    }),
  ];
  node.meta = { placeholder: 'photo' };
  return node;
}

function button(label: string, x: number, y: number, w: number, h: number, p: Palette): SceneNode {
  const frame = createFrame({
    x,
    y,
    width: w,
    height: h,
    radius: h / 2,
    fill: solid(p.accent),
    name: 'Button',
    clip: true,
  });
  frame.children = [
    createText(
      label,
      {
        fontFamily: p.body,
        fontSize: h * 0.4,
        fontWeight: 700,
        color: p.dark ? p.bg : '#ffffff',
        letterSpacing: 0.5,
        textAlign: 'center',
        verticalAlign: 'middle',
      },
      { x: 0, y: 0, width: w, height: h, name: 'Button label' },
    ),
  ];
  return frame;
}

function page(nodes: SceneNode[], w: number, h: number, p: Palette, name = 'Page 1', notes?: string): Page {
  return {
    id: uid('pag'),
    name,
    width: w,
    height: h,
    background: { color: p.bg },
    nodes,
    notes,
    meta: {},
  };
}

function headingStyle(p: Palette, size: number, extra: Partial<TextStyle> = {}): Partial<TextStyle> {
  return {
    fontFamily: p.heading,
    fontSize: size,
    fontWeight: 800,
    color: p.ink,
    lineHeight: 1.05,
    letterSpacing: -size * 0.02,
    textAlign: 'left',
    ...extra,
  };
}

function bodyStyle(p: Palette, size: number, extra: Partial<TextStyle> = {}): Partial<TextStyle> {
  return {
    fontFamily: p.body,
    fontSize: size,
    fontWeight: 400,
    color: p.dark ? p.muted : p.surface === '#ffffff' ? p.bg : p.ink,
    lineHeight: 1.5,
    ...extra,
  };
}

function eyebrow(label: string, x: number, y: number, w: number, p: Palette, size = 20): SceneNode {
  return text(
    label.toUpperCase(),
    x,
    y,
    w,
    size * 1.6,
    {
      fontFamily: p.body,
      fontSize: size,
      fontWeight: 700,
      color: p.accent,
      letterSpacing: size * 0.22,
      lineHeight: 1.4,
    },
    { name: 'Eyebrow' },
  );
}

function divider(x: number, y: number, w: number, p: Palette, thickness = 3): SceneNode {
  return box(x, y, w, thickness, solid(p.accent), { radius: thickness / 2, name: 'Divider' });
}

function footerBar(w: number, h: number, p: Palette, c: ContentSet): SceneNode[] {
  return [
    box(0, h - Math.max(56, h * 0.06), w, Math.max(56, h * 0.06), null, { name: 'Footer spacer' }),
    text(c.tagline, w * 0.06, h - Math.max(50, h * 0.055), w * 0.6, 30, {
      fontFamily: p.body,
      fontSize: Math.max(14, w * 0.016),
      fontWeight: 500,
      color: p.muted,
      lineHeight: 1.3,
    }),
  ];
}

/* ------------------------------------------------------------------ recipes */

export type TemplateCategory =
  | 'Instagram'
  | 'TikTok'
  | 'YouTube'
  | 'Business'
  | 'Marketing'
  | 'Education'
  | 'Events'
  | 'Restaurants'
  | 'Real estate'
  | 'E-commerce'
  | 'Presentations'
  | 'Posters'
  | 'Flyers'
  | 'Resumes'
  | 'Invitations'
  | 'Logos'
  | 'Ads'
  | 'Documents'
  | 'Print'
  | 'Wallpapers'
  | 'Covers';

export type Recipe = {
  key: string;
  category: TemplateCategory;
  subcategory?: string;
  tags: string[];
  size: { w: number; h: number };
  kind: DocKind;
  variants: number;
  name: (c: ContentSet) => string;
  build: (ctx: Ctx) => Page[];
};

const W = 1080;
const H = 1080;

export const RECIPES: Recipe[] = [
  /* ------------------------------------------------------------ Instagram */
  {
    key: 'ig-bold-center',
    category: 'Instagram',
    subcategory: 'Promo',
    tags: ['instagram', 'square', 'promo', 'bold'],
    size: { w: W, h: H },
    kind: 'design',
    variants: 14,
    name: (c) => `${c.brand} — bold announcement`,
    build: ({ w, h, p, c }) => [
      page(
        [
          photo(0, 0, w, h, p, 0, 1),
          box(0, 0, w, h, { type: 'solid', color: p.bg, opacity: 0.72 }),
          eyebrow(c.niche, w * 0.1, h * 0.2, w * 0.8, p, w * 0.02),
          text(c.headline, w * 0.1, h * 0.26, w * 0.8, h * 0.34, headingStyle(p, w * 0.115, { color: p.ink })),
          divider(w * 0.1, h * 0.63, w * 0.16, p, 6),
          text(c.sub, w * 0.1, h * 0.68, w * 0.62, h * 0.14, bodyStyle(p, w * 0.028, { color: p.ink })),
          button(c.cta, w * 0.1, h * 0.85, w * 0.34, h * 0.075, p),
        ],
        w,
        h,
        p,
      ),
    ],
  },
  {
    key: 'ig-split',
    category: 'Instagram',
    subcategory: 'Editorial',
    tags: ['instagram', 'split', 'editorial', 'photo'],
    size: { w: W, h: H },
    kind: 'design',
    variants: 12,
    name: (c) => `${c.brand} — split editorial`,
    build: ({ w, h, p, c }) => [
      page(
        [
          photo(0, 0, w, h * 0.52, p, 0),
          box(0, h * 0.52, w, h * 0.48, solid(p.bg)),
          circle(w * 0.78, h * 0.44, w * 0.2, solid(p.accent)),
          text(c.headline, w * 0.08, h * 0.58, w * 0.6, h * 0.2, headingStyle(p, w * 0.082)),
          text(c.sub, w * 0.08, h * 0.79, w * 0.56, h * 0.1, bodyStyle(p, w * 0.026, { color: p.muted })),
          text(c.meta, w * 0.08, h * 0.9, w * 0.5, h * 0.05, bodyStyle(p, w * 0.022, { color: p.accent, fontWeight: 600 })),
        ],
        w,
        h,
        p,
      ),
    ],
  },
  {
    key: 'ig-quote',
    category: 'Instagram',
    subcategory: 'Quote',
    tags: ['instagram', 'quote', 'typography', 'minimal'],
    size: { w: W, h: H },
    kind: 'design',
    variants: 10,
    name: () => 'Quote card',
    build: ({ w, h, p, c }) => [
      page(
        [
          box(0, 0, w, h, solid(p.bg)),
          circle(w * 0.72, h * 0.12, w * 0.42, { type: 'solid', color: p.accent, opacity: 0.16 }),
          text('“', w * 0.09, h * 0.16, w * 0.3, h * 0.24, {
            fontFamily: p.heading,
            fontSize: w * 0.4,
            fontWeight: 700,
            color: p.accent,
            lineHeight: 1,
          }),
          text(c.sub, w * 0.09, h * 0.42, w * 0.8, h * 0.28, headingStyle(p, w * 0.058, { lineHeight: 1.28, letterSpacing: 0 })),
          divider(w * 0.09, h * 0.76, w * 0.12, p, 5),
          text(c.brand, w * 0.09, h * 0.8, w * 0.7, h * 0.06, bodyStyle(p, w * 0.03, { fontWeight: 700, color: p.ink })),
        ],
        w,
        h,
        p,
      ),
    ],
  },
  {
    key: 'ig-list',
    category: 'Instagram',
    subcategory: 'List',
    tags: ['instagram', 'list', 'tips', 'carousel'],
    size: { w: W, h: H },
    kind: 'design',
    variants: 10,
    name: (c) => `${c.brand} — three reasons`,
    build: ({ w, h, p, c }) => [
      page(
        [
          box(0, 0, w, h, solid(p.bg)),
          box(0, 0, w, h * 0.06, solid(p.accent)),
          eyebrow(c.niche, w * 0.08, h * 0.12, w * 0.84, p, w * 0.019),
          text(c.headline.replace(/\n/g, ' '), w * 0.08, h * 0.17, w * 0.84, h * 0.16, headingStyle(p, w * 0.085)),
          ...c.items.flatMap((item, i) => {
            const y = h * 0.38 + i * h * 0.19;
            return [
              circle(w * 0.08, y + h * 0.012, w * 0.085, solid(p.accent), { name: `Number ${i + 1}` }),
              text(String(i + 1), w * 0.08, y + h * 0.03, w * 0.085, h * 0.05, {
                fontFamily: p.body,
                fontSize: w * 0.04,
                fontWeight: 800,
                color: p.dark ? p.bg : '#ffffff',
                textAlign: 'center',
              }),
              text(item.title, w * 0.2, y, w * 0.72, h * 0.06, headingStyle(p, w * 0.045)),
              text(item.body, w * 0.2, y + h * 0.06, w * 0.72, h * 0.05, bodyStyle(p, w * 0.026, { color: p.muted })),
            ];
          }),
        ],
        w,
        h,
        p,
      ),
    ],
  },
  {
    key: 'ig-promo-badge',
    category: 'Instagram',
    subcategory: 'Sale',
    tags: ['instagram', 'sale', 'offer', 'promo'],
    size: { w: W, h: H },
    kind: 'design',
    variants: 10,
    name: () => 'Offer — 50% off',
    build: ({ w, h, p, c }) => [
      page(
        [
          box(0, 0, w, h, solid(p.bg)),
          circle(w * 0.58, h * 0.02, w * 0.6, linearGradient([p.accent, p.accent2], 120)),
          box(w * 0.06, h * 0.06, w * 0.34, h * 0.075, solid(p.accent), { radius: h * 0.0375 }),
          text('LIMITED', w * 0.06, h * 0.075, w * 0.34, h * 0.05, {
            fontFamily: p.body,
            fontSize: w * 0.026,
            fontWeight: 800,
            color: p.dark ? p.bg : '#fff',
            letterSpacing: w * 0.004,
            textAlign: 'center',
          }),
          text('50%', w * 0.07, h * 0.2, w * 0.86, h * 0.26, headingStyle(p, w * 0.3, { lineHeight: 1 })),
          text('OFF', w * 0.07, h * 0.45, w * 0.86, h * 0.1, headingStyle(p, w * 0.1, { letterSpacing: w * 0.06 })),
          text(c.headline.replace(/\n/g, ' '), w * 0.07, h * 0.6, w * 0.7, h * 0.12, headingStyle(p, w * 0.06)),
          text(c.sub, w * 0.07, h * 0.73, w * 0.6, h * 0.09, bodyStyle(p, w * 0.024, { color: p.muted })),
          button(c.cta, w * 0.07, h * 0.85, w * 0.4, h * 0.08, p),
        ],
        w,
        h,
        p,
      ),
    ],
  },
  {
    key: 'ig-story-promo',
    category: 'Instagram',
    subcategory: 'Story',
    tags: ['instagram', 'story', 'vertical', 'promo'],
    size: { w: 1080, h: 1920 },
    kind: 'design',
    variants: 12,
    name: (c) => `${c.brand} — story promo`,
    build: ({ w, h, p, c }) => [
      page(
        [
          photo(0, 0, w, h, p, 0, 1),
          box(0, 0, w, h, { type: 'solid', color: p.bg, opacity: 0.6 }),
          box(0, h * 0.06, w, 8, solid(p.accent)),
          eyebrow(c.niche, w * 0.1, h * 0.2, w * 0.8, p, w * 0.026),
          text(c.headline, w * 0.1, h * 0.25, w * 0.8, h * 0.22, headingStyle(p, w * 0.14, { lineHeight: 1.06 })),
          text(c.sub, w * 0.1, h * 0.51, w * 0.76, h * 0.12, bodyStyle(p, w * 0.036, { color: p.ink })),
          photo(w * 0.1, h * 0.63, w * 0.8, h * 0.16, p, 24, 1),
          button(c.cta, w * 0.1, h * 0.83, w * 0.56, h * 0.075, p),
          text(c.meta, w * 0.1, h * 0.92, w * 0.8, h * 0.04, bodyStyle(p, w * 0.03, { color: p.muted, textAlign: 'center' })),
        ],
        w,
        h,
        p,
      ),
    ],
  },
  {
    key: 'ig-story-poll',
    category: 'Instagram',
    subcategory: 'Story',
    tags: ['instagram', 'story', 'poll', 'interactive'],
    size: { w: 1080, h: 1920 },
    kind: 'design',
    variants: 8,
    name: () => 'Story — this or that',
    build: ({ w, h, p, c }) => [
      page(
        [
          box(0, 0, w, h, solid(p.bg)),
          circle(w * 0.1, h * 0.08, w * 0.3, linearGradient([p.accent, p.accent2], 90)),
          text('THIS OR THAT', w * 0.08, h * 0.2, w * 0.84, h * 0.06, {
            fontFamily: p.body,
            fontSize: w * 0.055,
            fontWeight: 800,
            color: p.accent,
            letterSpacing: w * 0.012,
            textAlign: 'center',
          }),
          box(w * 0.08, h * 0.32, w * 0.84, h * 0.2, solid(p.surface), { radius: 32 }),
          text(c.items[0]?.title ?? 'Option one', w * 0.08, h * 0.39, w * 0.84, h * 0.08, headingStyle(p, w * 0.09, { textAlign: 'center' })),
          text('VS', w * 0.4, h * 0.53, w * 0.2, h * 0.06, headingStyle(p, w * 0.06, { textAlign: 'center', color: p.accent })),
          box(w * 0.08, h * 0.6, w * 0.84, h * 0.2, solid(p.accent), { radius: 32 }),
          text(c.items[1]?.title ?? 'Option two', w * 0.08, h * 0.67, w * 0.84, h * 0.08, headingStyle(p, w * 0.09, { textAlign: 'center', color: p.dark ? p.bg : '#fff' })),
          text('Tap to vote', w * 0.08, h * 0.85, w * 0.84, h * 0.05, bodyStyle(p, w * 0.04, { textAlign: 'center', color: p.muted })),
        ],
        w,
        h,
        p,
      ),
    ],
  },

  /* --------------------------------------------------------------- TikTok */
  {
    key: 'tt-cover',
    category: 'TikTok',
    subcategory: 'Cover',
    tags: ['tiktok', 'vertical', 'cover', 'video'],
    size: { w: 1080, h: 1920 },
    kind: 'video',
    variants: 12,
    name: (c) => `${c.brand} — TikTok cover`,
    build: ({ w, h, p, c }) => [
      page(
        [
          photo(0, 0, w, h, p, 0, 1),
          box(0, 0, w, h, { type: 'solid', color: p.bg, opacity: 0.55 }),
          box(0, h * 0.72, w, h * 0.28, linearGradient([`${p.bg}00`, p.bg], 90)),
          text(c.headline.toUpperCase(), w * 0.08, h * 0.12, w * 0.84, h * 0.2, {
            fontFamily: p.heading,
            fontSize: w * 0.16,
            fontWeight: 800,
            color: '#ffffff',
            lineHeight: 1.02,
            letterSpacing: -2,
            shadow: { color: 'rgba(0,0,0,.35)', x: 0, y: 8, blur: 24 },
          }),
          box(w * 0.08, h * 0.42, w * 0.36, h * 0.028, solid(p.accent), { radius: 14 }),
          text(c.sub, w * 0.08, h * 0.78, w * 0.7, h * 0.1, {
            fontFamily: p.body,
            fontSize: w * 0.038,
            color: '#ffffff',
            lineHeight: 1.4,
          }),
          text(c.brand.toUpperCase(), w * 0.08, h * 0.9, w * 0.84, h * 0.05, {
            fontFamily: p.body,
            fontSize: w * 0.032,
            fontWeight: 700,
            color: p.accent,
            letterSpacing: w * 0.006,
          }),
        ],
        w,
        h,
        p,
      ),
    ],
  },

  /* -------------------------------------------------------------- YouTube */
  {
    key: 'yt-thumb-shock',
    category: 'YouTube',
    subcategory: 'Thumbnail',
    tags: ['youtube', 'thumbnail', 'bold', 'video'],
    size: { w: 1280, h: 720 },
    kind: 'design',
    variants: 12,
    name: (c) => `${c.brand} — thumbnail`,
    build: ({ w, h, p, c }) => [
      page(
        [
          photo(0, 0, w, h, p, 0, 1),
          box(0, 0, w, h, { type: 'solid', color: p.bg, opacity: 0.42 }),
          text(c.headline.replace(/\n/g, ' ').toUpperCase(), w * 0.05, h * 0.24, w * 0.56, h * 0.42, {
            fontFamily: p.heading,
            fontSize: w * 0.085,
            fontWeight: 800,
            color: '#ffffff',
            lineHeight: 1.02,
            shadow: { color: 'rgba(0,0,0,.55)', x: 0, y: 6, blur: 18 },
          }),
          circle(w * 0.7, h * 0.24, w * 0.24, solid(p.accent)),
          text('!', w * 0.7, h * 0.33, w * 0.24, h * 0.3, {
            fontFamily: p.heading,
            fontSize: w * 0.2,
            fontWeight: 800,
            color: p.dark ? p.bg : '#ffffff',
            textAlign: 'center',
          }),
          box(w * 0.05, h * 0.72, w * 0.3, h * 0.12, solid(p.accent), { radius: 10 }),
          text(c.cta.toUpperCase(), w * 0.05, h * 0.765, w * 0.3, h * 0.06, {
            fontFamily: p.body,
            fontSize: w * 0.028,
            fontWeight: 800,
            color: p.dark ? p.bg : '#ffffff',
            textAlign: 'center',
          }),
        ],
        w,
        h,
        p,
      ),
    ],
  },
  {
    key: 'yt-banner',
    category: 'YouTube',
    subcategory: 'Channel art',
    tags: ['youtube', 'banner', 'channel', 'wide'],
    size: { w: 2560, h: 1440 },
    kind: 'design',
    variants: 8,
    name: (c) => `${c.brand} — channel banner`,
    build: ({ w, h, p, c }) => [
      page(
        [
          box(0, 0, w, h, linearGradient([p.bg, p.surface, p.bg], 100)),
          circle(w * 0.7, h * 0.2, w * 0.3, { type: 'solid', color: p.accent, opacity: 0.22 }),
          circle(w * 0.2, h * 0.75, w * 0.2, { type: 'solid', color: p.accent2, opacity: 0.18 }),
          text(c.brand, w * 0.06, h * 0.36, w * 0.62, h * 0.2, headingStyle(p, h * 0.16, { lineHeight: 1 })),
          box(w * 0.06, h * 0.58, w * 0.14, h * 0.012, solid(p.accent), { radius: 6 }),
          text(c.tagline, w * 0.06, h * 0.63, w * 0.55, h * 0.09, bodyStyle(p, h * 0.045, { color: p.muted })),
          box(0, h * 0.78, w, h * 0.22, { type: 'solid', color: p.bg, opacity: 0.55 }),
        ],
        w,
        h,
        p,
      ),
    ],
  },

  /* ------------------------------------------------------------- Business */
  {
    key: 'biz-card',
    category: 'Business',
    subcategory: 'Business card',
    tags: ['business card', 'print', 'brand', 'contact'],
    size: { w: 1050, h: 600 },
    kind: 'print',
    variants: 10,
    name: (c) => `${c.brand} — business card`,
    build: ({ w, h, p, c }) => [
      page(
        [
          box(0, 0, w, h, solid(p.surface)),
          box(0, 0, w, h * 0.1, solid(p.accent)),
          text(c.brand, w * 0.07, h * 0.24, w * 0.6, h * 0.2, headingStyle(p, h * 0.2)),
          text(c.tagline, w * 0.07, h * 0.46, w * 0.6, h * 0.08, bodyStyle(p, h * 0.08, { color: p.accent, fontWeight: 600 })),
          divider(w * 0.07, h * 0.62, w * 0.1, p, 4),
          text('hello@example.com\n+44 20 7946 0123\n' + c.meta, w * 0.07, h * 0.7, w * 0.5, h * 0.22, bodyStyle(p, h * 0.075, { lineHeight: 1.5, color: p.muted })),
          circle(w * 0.78, h * 0.52, w * 0.24, linearGradient([p.accent, p.accent2], 120)),
        ],
        w,
        h,
        p,
        'Front',
      ),
    ],
  },
  {
    key: 'biz-report-cover',
    category: 'Business',
    subcategory: 'Report',
    tags: ['report', 'document', 'cover', 'corporate'],
    size: { w: 794, h: 1123 },
    kind: 'document',
    variants: 8,
    name: (c) => `${c.brand} — report cover`,
    build: ({ w, h, p, c }) => [
      page(
        [
          box(0, 0, w, h, solid(p.bg)),
          box(0, 0, w, h * 0.012, solid(p.accent)),
          eyebrow('ANNUAL REPORT 2026', w * 0.1, h * 0.1, w * 0.8, p, 13),
          text(c.headline.replace(/\n/g, ' '), w * 0.1, h * 0.16, w * 0.7, h * 0.2, headingStyle(p, 54)),
          divider(w * 0.1, h * 0.39, w * 0.14, p, 4),
          text(c.sub, w * 0.1, h * 0.44, w * 0.66, h * 0.14, bodyStyle(p, 17, { color: p.muted })),
          photo(w * 0.1, h * 0.62, w * 0.8, h * 0.22, p, 8),
          text(c.brand, w * 0.1, h * 0.9, w * 0.5, h * 0.05, bodyStyle(p, 15, { fontWeight: 700, color: p.ink })),
        ],
        w,
        h,
        p,
        'Cover',
      ),
    ],
  },
  {
    key: 'biz-letterhead',
    category: 'Business',
    subcategory: 'Letterhead',
    tags: ['letter', 'document', 'corporate', 'a4'],
    size: { w: 794, h: 1123 },
    kind: 'document',
    variants: 6,
    name: (c) => `${c.brand} — letterhead`,
    build: ({ w, h, p, c }) => [
      page(
        [
          box(0, 0, w, h, solid('#ffffff')),
          text(c.brand, w * 0.1, h * 0.06, w * 0.5, h * 0.05, { fontFamily: p.heading, fontSize: 26, fontWeight: 700, color: p.bg }),
          text(c.tagline, w * 0.1, h * 0.105, w * 0.5, h * 0.03, { fontFamily: p.body, fontSize: 13, color: p.accent }),
          divider(w * 0.1, h * 0.15, w * 0.8, p, 2),
          text(
            'Dear Friend,\n\nThank you for taking the time to read this letter. We wanted to share a short update on what we have been building, and where we are heading next.\n\nOver the last twelve months we have focused on the fundamentals: fewer features, done properly. The result is a product that is faster, clearer and easier to trust.\n\nIf you would like to talk through any of this, my door is open.\n\nWarm regards,\nThe Team',
            w * 0.1,
            h * 0.2,
            w * 0.8,
            h * 0.55,
            { fontFamily: p.body, fontSize: 16, lineHeight: 1.7, color: '#1f2430' },
          ),
          box(0, h * 0.94, w, h * 0.06, solid(p.bg)),
          text(c.meta + '  ·  ' + c.brand, w * 0.1, h * 0.955, w * 0.8, h * 0.03, { fontFamily: p.body, fontSize: 12, color: '#ffffff' }),
        ],
        w,
        h,
        p,
        'Letter',
      ),
    ],
  },

  /* ------------------------------------------------------------ Marketing */
  {
    key: 'mk-ad-square',
    category: 'Marketing',
    subcategory: 'Display ad',
    tags: ['ad', 'square', 'marketing', 'campaign'],
    size: { w: 1080, h: 1080 },
    kind: 'design',
    variants: 12,
    name: (c) => `${c.brand} — square ad`,
    build: ({ w, h, p, c }) => [
      page(
        [
          box(0, 0, w, h, solid(p.bg)),
          photo(w * 0.5, 0, w * 0.5, h, p, 0, 1),
          text(c.headline, w * 0.07, h * 0.1, w * 0.4, h * 0.3, headingStyle(p, w * 0.085, { lineHeight: 1.06 })),
          text(c.sub, w * 0.07, h * 0.45, w * 0.38, h * 0.16, bodyStyle(p, w * 0.026, { color: p.muted })),
          button(c.cta, w * 0.07, h * 0.66, w * 0.26, h * 0.07, p),
          text('No credit card required', w * 0.07, h * 0.77, w * 0.4, h * 0.04, bodyStyle(p, w * 0.02, { color: p.accent })),
          circle(w * 0.44, h * 0.86, w * 0.12, solid(p.accent2)),
        ],
        w,
        h,
        p,
      ),
    ],
  },
  {
    key: 'mk-product-launch',
    category: 'Marketing',
    subcategory: 'Launch',
    tags: ['launch', 'product', 'announcement', 'marketing'],
    size: { w: 1200, h: 630 },
    kind: 'design',
    variants: 10,
    name: (c) => `${c.brand} — product launch`,
    build: ({ w, h, p, c }) => [
      page(
        [
          box(0, 0, w, h, linearGradient([p.bg, p.surface], 120)),
          circle(w * 0.86, h * 0.2, w * 0.22, { type: 'solid', color: p.accent, opacity: 0.25 }),
          eyebrow('NEW', w * 0.06, h * 0.14, w * 0.5, p, 15),
          text(c.headline.replace(/\n/g, ' '), w * 0.06, h * 0.22, w * 0.55, h * 0.3, headingStyle(p, w * 0.075)),
          text(c.sub, w * 0.06, h * 0.56, w * 0.5, h * 0.14, bodyStyle(p, w * 0.021, { color: p.muted })),
          button(c.cta, w * 0.06, h * 0.76, w * 0.22, h * 0.11, p),
          photo(w * 0.62, h * 0.16, w * 0.32, h * 0.68, p, 20, 1),
        ],
        w,
        h,
        p,
      ),
    ],
  },
  {
    key: 'mk-infographic',
    category: 'Marketing',
    subcategory: 'Infographic',
    tags: ['infographic', 'data', 'tall', 'marketing'],
    size: { w: 1000, h: 3000 },
    kind: 'design',
    variants: 6,
    name: (c) => `${c.brand} — infographic`,
    build: ({ w, h, p, c }) => [
      page(
        [
          box(0, 0, w, h, solid(p.bg)),
          box(0, 0, w, h * 0.06, solid(p.accent)),
          text(c.headline.replace(/\n/g, ' '), w * 0.07, h * 0.09, w * 0.86, h * 0.05, headingStyle(p, 64)),
          text(c.sub, w * 0.07, h * 0.135, w * 0.7, h * 0.03, bodyStyle(p, 26, { color: p.muted })),
          ...c.items.flatMap((item, i) => {
            const y = h * 0.2 + i * h * 0.16;
            return [
              circle(w * 0.12, y, w * 0.14, solid(p.accent)),
              text(String(i + 1).padStart(2, '0'), w * 0.12, y + w * 0.045, w * 0.14, w * 0.06, {
                fontFamily: p.heading,
                fontSize: 46,
                fontWeight: 800,
                color: p.dark ? p.bg : '#fff',
                textAlign: 'center',
              }),
              text(item.title, w * 0.32, y - h * 0.005, w * 0.6, h * 0.03, headingStyle(p, 46)),
              text(item.body, w * 0.32, y + h * 0.035, w * 0.6, h * 0.04, bodyStyle(p, 24, { color: p.muted })),
            ];
          }),
          (() => {
            const chart = createChart('bar', { x: w * 0.07, y: h * 0.7, width: w * 0.86, height: h * 0.16, name: 'Results' });
            chart.data.labels = c.items.map((i) => i.title.split(' ')[0] ?? '');
            chart.data.series = [{ name: 'Growth', values: [34, 52, 71] }];
            chart.data.options.palette = [p.accent, p.accent2, p.bg];
            chart.data.options.labelColor = p.muted;
            chart.data.options.gridColor = p.dark ? 'rgba(255,255,255,.12)' : 'rgba(0,0,0,.08)';
            return chart;
          })(),
          box(w * 0.07, h * 0.9, w * 0.86, h * 0.06, solid(p.accent), { radius: 12 }),
          text(c.cta.toUpperCase(), w * 0.07, h * 0.915, w * 0.86, h * 0.035, {
            fontFamily: p.body,
            fontSize: 30,
            fontWeight: 800,
            color: p.dark ? p.bg : '#fff',
            textAlign: 'center',
          }),
        ],
        w,
        h,
        p,
      ),
    ],
  },

  /* ------------------------------------------------------------ Education */
  {
    key: 'edu-lesson',
    category: 'Education',
    subcategory: 'Worksheet',
    tags: ['education', 'worksheet', 'school', 'lesson'],
    size: { w: 794, h: 1123 },
    kind: 'document',
    variants: 8,
    name: (c) => `${c.brand} — lesson sheet`,
    build: ({ w, h, p, c }) => [
      page(
        [
          box(0, 0, w, h, solid('#ffffff')),
          box(0, 0, w, h * 0.11, solid(p.bg)),
          text(c.brand, w * 0.07, h * 0.035, w * 0.6, h * 0.04, { fontFamily: p.heading, fontSize: 24, fontWeight: 700, color: '#ffffff' }),
          text('Lesson 04', w * 0.07, h * 0.072, w * 0.6, h * 0.025, { fontFamily: p.body, fontSize: 13, color: p.accent }),
          text(c.headline.replace(/\n/g, ' '), w * 0.07, h * 0.15, w * 0.86, h * 0.08, headingStyle(p, 40, { color: p.bg })),
          text(c.sub, w * 0.07, h * 0.24, w * 0.86, h * 0.06, bodyStyle(p, 16, { color: '#444' })),
          ...c.items.flatMap((item, i) => {
            const y = h * 0.34 + i * h * 0.14;
            return [
              circle(w * 0.075, y, w * 0.055, solid(p.accent)),
              text(String(i + 1), w * 0.075, y + w * 0.017, w * 0.055, w * 0.03, {
                fontFamily: p.body,
                fontSize: 20,
                fontWeight: 800,
                color: '#fff',
                textAlign: 'center',
              }),
              text(item.title, w * 0.16, y, w * 0.72, h * 0.03, headingStyle(p, 22, { color: p.bg })),
              text(item.body, w * 0.16, y + h * 0.032, w * 0.72, h * 0.05, bodyStyle(p, 15, { color: '#555' })),
              box(w * 0.16, y + h * 0.085, w * 0.72, 2, solid('#e5e7eb')),
            ];
          }),
          box(w * 0.07, h * 0.86, w * 0.86, h * 0.09, solid(p.bg), { radius: 10 }),
          text(c.cta, w * 0.07, h * 0.885, w * 0.86, h * 0.03, { fontFamily: p.body, fontSize: 17, fontWeight: 700, color: '#fff', textAlign: 'center' }),
        ],
        w,
        h,
        p,
      ),
    ],
  },
  {
    key: 'edu-certificate',
    category: 'Education',
    subcategory: 'Certificate',
    tags: ['certificate', 'award', 'education', 'print'],
    size: { w: 1600, h: 1131 },
    kind: 'print',
    variants: 8,
    name: (c) => `${c.brand} — certificate`,
    build: ({ w, h, p, c }) => [
      page(
        [
          box(0, 0, w, h, solid('#ffffff')),
          box(w * 0.03, h * 0.04, w * 0.94, h * 0.92, null, { stroke: { color: p.accent, width: 3, style: 'solid' }, radius: 8 }),
          box(w * 0.045, h * 0.055, w * 0.91, h * 0.89, null, { stroke: { color: p.accent, width: 1, style: 'solid' }, radius: 6 }),
          circle(w * 0.46, h * 0.13, w * 0.08, linearGradient([p.accent, p.accent2], 120)),
          text('CERTIFICATE', w * 0.2, h * 0.25, w * 0.6, h * 0.07, {
            fontFamily: p.body,
            fontSize: 26,
            fontWeight: 700,
            color: p.accent,
            letterSpacing: 12,
            textAlign: 'center',
          }),
          text('OF COMPLETION', w * 0.2, h * 0.32, w * 0.6, h * 0.05, {
            fontFamily: p.body,
            fontSize: 16,
            color: p.bg,
            letterSpacing: 8,
            textAlign: 'center',
          }),
          text('Awarded to', w * 0.2, h * 0.42, w * 0.6, h * 0.04, { fontFamily: p.body, fontSize: 18, color: '#666', textAlign: 'center' }),
          text('Alex Morgan', w * 0.15, h * 0.47, w * 0.7, h * 0.12, {
            fontFamily: p.heading,
            fontSize: 72,
            fontWeight: 700,
            color: p.bg,
            textAlign: 'center',
          }),
          divider(w * 0.3, h * 0.6, w * 0.4, p, 2),
          text(c.sub, w * 0.15, h * 0.63, w * 0.7, h * 0.08, { fontFamily: p.body, fontSize: 19, color: '#444', textAlign: 'center', lineHeight: 1.5 }),
          text(c.brand, w * 0.1, h * 0.8, w * 0.35, h * 0.04, { fontFamily: p.heading, fontSize: 22, color: p.bg }),
          divider(w * 0.1, h * 0.845, w * 0.25, p, 1),
          text('Director', w * 0.1, h * 0.855, w * 0.3, h * 0.03, { fontFamily: p.body, fontSize: 14, color: '#777' }),
          text('Date: ______________', w * 0.6, h * 0.8, w * 0.3, h * 0.04, { fontFamily: p.body, fontSize: 18, color: p.bg }),
          divider(w * 0.6, h * 0.845, w * 0.25, p, 1),
        ],
        w,
        h,
        p,
      ),
    ],
  },

  /* --------------------------------------------------------------- Events */
  {
    key: 'ev-poster',
    category: 'Events',
    subcategory: 'Poster',
    tags: ['event', 'poster', 'party', 'music'],
    size: { w: 1123, h: 1587 },
    kind: 'print',
    variants: 12,
    name: (c) => `${c.brand} — event poster`,
    build: ({ w, h, p, c }) => [
      page(
        [
          box(0, 0, w, h, solid(p.bg)),
          circle(w * 0.5, h * 0.3, w * 1.1, { type: 'solid', color: p.accent, opacity: 0.18 }),
          eyebrow(c.meta.toUpperCase(), w * 0.08, h * 0.07, w * 0.84, p, 20),
          text(c.brand, w * 0.08, h * 0.11, w * 0.84, h * 0.14, headingStyle(p, w * 0.14, { textAlign: 'center', lineHeight: 1 })),
          divider(w * 0.3, h * 0.27, w * 0.4, p, 4),
          text(c.headline, w * 0.08, h * 0.3, w * 0.84, h * 0.16, headingStyle(p, w * 0.085, { textAlign: 'center' })),
          photo(w * 0.12, h * 0.48, w * 0.76, h * 0.24, p, 12),
          text(c.sub, w * 0.1, h * 0.75, w * 0.8, h * 0.08, bodyStyle(p, 22, { textAlign: 'center', color: p.ink })),
          box(w * 0.28, h * 0.85, w * 0.44, h * 0.055, solid(p.accent), { radius: 30 }),
          text(c.cta.toUpperCase(), w * 0.28, h * 0.862, w * 0.44, h * 0.035, {
            fontFamily: p.body,
            fontSize: 20,
            fontWeight: 800,
            color: p.dark ? p.bg : '#fff',
            textAlign: 'center',
            letterSpacing: 2,
          }),
          text(c.tagline, w * 0.1, h * 0.93, w * 0.8, h * 0.03, bodyStyle(p, 16, { textAlign: 'center', color: p.muted })),
        ],
        w,
        h,
        p,
      ),
    ],
  },
  {
    key: 'ev-invite',
    category: 'Invitations',
    subcategory: 'Invitation',
    tags: ['invitation', 'wedding', 'party', 'elegant'],
    size: { w: 1500, h: 2100 },
    kind: 'print',
    variants: 10,
    name: (c) => `${c.brand} — invitation`,
    build: ({ w, h, p, c }) => [
      page(
        [
          box(0, 0, w, h, solid(p.bg)),
          box(w * 0.05, h * 0.035, w * 0.9, h * 0.93, null, { stroke: { color: p.accent, width: 2, style: 'solid' }, radius: 4 }),
          text('YOU ARE INVITED', w * 0.15, h * 0.12, w * 0.7, h * 0.03, {
            fontFamily: p.body,
            fontSize: 26,
            fontWeight: 600,
            letterSpacing: 10,
            color: p.accent,
            textAlign: 'center',
          }),
          text(c.brand, w * 0.1, h * 0.2, w * 0.8, h * 0.12, {
            fontFamily: p.heading,
            fontSize: 96,
            fontWeight: 700,
            color: p.ink,
            textAlign: 'center',
            lineHeight: 1.05,
          }),
          circle(w * 0.42, h * 0.36, w * 0.16, linearGradient([p.accent, p.accent2], 120)),
          text(c.headline, w * 0.12, h * 0.55, w * 0.76, h * 0.1, headingStyle(p, 54, { textAlign: 'center' })),
          text(c.sub, w * 0.15, h * 0.66, w * 0.7, h * 0.08, bodyStyle(p, 26, { textAlign: 'center', color: p.muted })),
          divider(w * 0.4, h * 0.77, w * 0.2, p, 2),
          text(c.meta, w * 0.1, h * 0.8, w * 0.8, h * 0.04, {
            fontFamily: p.body,
            fontSize: 28,
            color: p.ink,
            textAlign: 'center',
          }),
          text('RSVP by 1 May · ' + c.tagline, w * 0.1, h * 0.86, w * 0.8, h * 0.03, bodyStyle(p, 20, { textAlign: 'center', color: p.accent })),
        ],
        w,
        h,
        p,
      ),
    ],
  },

  /* ----------------------------------------------------------- Restaurant */
  {
    key: 'menu-classic',
    category: 'Restaurants',
    subcategory: 'Menu',
    tags: ['menu', 'restaurant', 'food', 'print'],
    size: { w: 794, h: 1123 },
    kind: 'print',
    variants: 10,
    name: (c) => `${c.brand} — menu`,
    build: ({ w, h, p, c }) => [
      page(
        [
          box(0, 0, w, h, solid('#fbfaf7')),
          box(0, 0, w, h * 0.14, solid(p.bg)),
          text(c.brand, w * 0.08, h * 0.035, w * 0.84, h * 0.05, {
            fontFamily: p.heading,
            fontSize: 40,
            fontWeight: 700,
            color: '#fff',
            textAlign: 'center',
          }),
          text(c.tagline.toUpperCase(), w * 0.08, h * 0.09, w * 0.84, h * 0.025, {
            fontFamily: p.body,
            fontSize: 13,
            letterSpacing: 6,
            color: p.accent,
            textAlign: 'center',
          }),
          ...c.items.flatMap((item, i) => {
            const y = h * 0.2 + i * h * 0.16;
            return [
              text(item.title, w * 0.1, y, w * 0.6, h * 0.03, { fontFamily: p.heading, fontSize: 26, fontWeight: 700, color: p.bg }),
              text('£' + (9 + i * 4), w * 0.75, y, w * 0.15, h * 0.03, { fontFamily: p.body, fontSize: 22, fontWeight: 700, color: p.accent, textAlign: 'right' }),
              text(item.body, w * 0.1, y + h * 0.033, w * 0.8, h * 0.04, { fontFamily: p.body, fontSize: 15, color: '#666', lineHeight: 1.4 }),
              box(w * 0.1, y + h * 0.075, w * 0.8, 1, { type: 'solid', color: '#e2ded4' }),
            ];
          }),
          box(w * 0.1, h * 0.72, w * 0.8, h * 0.14, solid(p.bg), { radius: 8 }),
          text('TODAY’S SPECIAL', w * 0.1, h * 0.745, w * 0.8, h * 0.025, {
            fontFamily: p.body,
            fontSize: 13,
            letterSpacing: 4,
            color: p.accent,
            textAlign: 'center',
          }),
          text(c.headline.replace(/\n/g, ' '), w * 0.1, h * 0.775, w * 0.8, h * 0.04, {
            fontFamily: p.heading,
            fontSize: 30,
            color: '#fff',
            textAlign: 'center',
          }),
          text(c.meta, w * 0.1, h * 0.9, w * 0.8, h * 0.03, { fontFamily: p.body, fontSize: 14, color: '#888', textAlign: 'center' }),
        ],
        w,
        h,
        p,
      ),
    ],
  },

  /* ---------------------------------------------------------- Real estate */
  {
    key: 're-listing',
    category: 'Real estate',
    subcategory: 'Listing',
    tags: ['realestate', 'listing', 'property', 'home'],
    size: { w: 1200, h: 900 },
    kind: 'design',
    variants: 10,
    name: (c) => `${c.brand} — property listing`,
    build: ({ w, h, p, c }) => [
      page(
        [
          box(0, 0, w, h, solid(p.bg)),
          photo(0, 0, w * 0.52, h, p, 0, 1),
          box(w * 0.52, 0, w * 0.48, h, solid(p.surface)),
          eyebrow('FOR SALE', w * 0.57, h * 0.08, w * 0.38, p, 14),
          text(c.headline, w * 0.57, h * 0.13, w * 0.38, h * 0.2, headingStyle(p, 46, { color: p.dark ? p.ink : p.bg })),
          text(c.meta, w * 0.57, h * 0.35, w * 0.38, h * 0.04, {
            fontFamily: p.body,
            fontSize: 22,
            fontWeight: 700,
            color: p.accent,
          }),
          divider(w * 0.57, h * 0.42, w * 0.1, p, 3),
          text(c.sub, w * 0.57, h * 0.47, w * 0.38, h * 0.12, bodyStyle(p, 16, { color: p.muted })),
          ...c.items.flatMap((item, i) => {
            const y = h * 0.63 + i * h * 0.08;
            return [
              circle(w * 0.575, y + 6, w * 0.022, solid(p.accent)),
              text(`${item.title} — ${item.body}`, w * 0.615, y, w * 0.34, h * 0.05, bodyStyle(p, 15, { color: p.dark ? p.ink : p.bg })),
            ];
          }),
          button(c.cta, w * 0.57, h * 0.88, w * 0.2, h * 0.07, p),
        ],
        w,
        h,
        p,
      ),
    ],
  },

  /* ----------------------------------------------------------- E-commerce */
  {
    key: 'ec-product',
    category: 'E-commerce',
    subcategory: 'Product ad',
    tags: ['ecommerce', 'product', 'shop', 'ad'],
    size: { w: 1080, h: 1350 },
    kind: 'design',
    variants: 12,
    name: (c) => `${c.brand} — product ad`,
    build: ({ w, h, p, c }) => [
      page(
        [
          box(0, 0, w, h, solid(p.bg)),
          box(0, 0, w, h * 0.62, solid(p.surface)),
          photo(w * 0.08, h * 0.06, w * 0.84, h * 0.5, p, 24, 1),
          box(w * 0.72, h * 0.1, w * 0.2, h * 0.06, solid(p.accent), { radius: 30 }),
          text('NEW IN', w * 0.72, h * 0.115, w * 0.2, h * 0.03, {
            fontFamily: p.body,
            fontSize: 20,
            fontWeight: 800,
            letterSpacing: 3,
            color: p.dark ? p.bg : '#fff',
            textAlign: 'center',
          }),
          text(c.items[0]?.title ?? c.brand, w * 0.08, h * 0.67, w * 0.84, h * 0.07, headingStyle(p, 58)),
          text(c.sub, w * 0.08, h * 0.75, w * 0.7, h * 0.08, bodyStyle(p, 22, { color: p.muted })),
          text('£48.00', w * 0.08, h * 0.84, w * 0.3, h * 0.05, {
            fontFamily: p.heading,
            fontSize: 40,
            fontWeight: 700,
            color: p.accent,
          }),
          button(c.cta, w * 0.42, h * 0.84, w * 0.5, h * 0.07, p),
          text(c.meta, w * 0.08, h * 0.93, w * 0.84, h * 0.03, bodyStyle(p, 18, { color: p.muted, textAlign: 'center' })),
        ],
        w,
        h,
        p,
      ),
    ],
  },
  {
    key: 'ec-sale-banner',
    category: 'Ads',
    subcategory: 'Sale',
    tags: ['sale', 'banner', 'ad', 'ecommerce'],
    size: { w: 1456, h: 600 },
    kind: 'design',
    variants: 8,
    name: () => 'Seasonal sale banner',
    build: ({ w, h, p, c }) => [
      page(
        [
          box(0, 0, w, h, linearGradient([p.accent, p.accent2], 100)),
          circle(w * 0.85, h * 0.5, w * 0.3, { type: 'solid', color: '#fff', opacity: 0.14 }),
          text('SEASON SALE', w * 0.06, h * 0.22, w * 0.5, h * 0.1, {
            fontFamily: p.body,
            fontSize: 30,
            fontWeight: 800,
            letterSpacing: 8,
            color: '#fff',
          }),
          text('UP TO 40% OFF', w * 0.06, h * 0.35, w * 0.6, h * 0.26, {
            fontFamily: p.heading,
            fontSize: 96,
            fontWeight: 800,
            color: '#fff',
            lineHeight: 1,
          }),
          text(c.sub, w * 0.06, h * 0.68, w * 0.45, h * 0.1, { fontFamily: p.body, fontSize: 22, color: 'rgba(255,255,255,0.9)' }),
          button(c.cta, w * 0.06, h * 0.8, w * 0.22, h * 0.12, { ...p, accent: '#ffffff' }) as SceneNode,
        ],
        w,
        h,
        p,
      ),
    ],
  },

  /* -------------------------------------------------------- Presentations */
  {
    key: 'deck-title',
    category: 'Presentations',
    subcategory: 'Title slide',
    tags: ['presentation', 'title', 'slides', 'deck'],
    size: { w: 1920, h: 1080 },
    kind: 'presentation',
    variants: 12,
    name: (c) => `${c.brand} — presentation`,
    build: ({ w, h, p, c }) => {
      const slides: Page[] = [];
      slides.push(
        page(
          [
            box(0, 0, w, h, solid(p.bg)),
            circle(w * 0.78, h * 0.15, w * 0.34, { type: 'solid', color: p.accent, opacity: 0.2 }),
            eyebrow(c.niche.toUpperCase(), w * 0.08, h * 0.22, w * 0.84, p, 22),
            text(c.headline, w * 0.08, h * 0.28, w * 0.7, h * 0.32, headingStyle(p, 132, { lineHeight: 1.02 })),
            divider(w * 0.08, h * 0.66, w * 0.1, p, 6),
            text(c.sub, w * 0.08, h * 0.72, w * 0.5, h * 0.12, bodyStyle(p, 30, { color: p.muted })),
            text(c.brand, w * 0.08, h * 0.88, w * 0.5, h * 0.05, bodyStyle(p, 24, { fontWeight: 700, color: p.ink })),
          ],
          w,
          h,
          p,
          'Title',
          'Welcome everyone. Set the context in one sentence before diving in.',
        ),
      );
      slides.push(
        page(
          [
            box(0, 0, w, h, solid(p.surface)),
            eyebrow('AGENDA', w * 0.08, h * 0.12, w * 0.84, p, 22),
            text('What we will cover', w * 0.08, h * 0.17, w * 0.7, h * 0.14, headingStyle(p, 84, { color: p.dark ? p.ink : p.bg })),
            ...c.items.flatMap((item, i) => {
              const y = h * 0.38 + i * h * 0.16;
              return [
                circle(w * 0.08, y + 8, w * 0.055, solid(p.accent)),
                text(String(i + 1), w * 0.08, y + 22, w * 0.055, w * 0.04, {
                  fontFamily: p.body,
                  fontSize: 34,
                  fontWeight: 800,
                  color: p.dark ? p.bg : '#fff',
                  textAlign: 'center',
                }),
                text(item.title, w * 0.17, y, w * 0.7, h * 0.06, headingStyle(p, 44, { color: p.dark ? p.ink : p.bg })),
                text(item.body, w * 0.17, y + h * 0.07, w * 0.7, h * 0.05, bodyStyle(p, 26, { color: p.muted })),
              ];
            }),
          ],
          w,
          h,
          p,
          'Agenda',
          'Keep it to three or four points — people remember what fits on one screen.',
        ),
      );
      slides.push(
        page(
          [
            box(0, 0, w, h, solid(p.bg)),
            text('By the numbers', w * 0.08, h * 0.12, w * 0.6, h * 0.12, headingStyle(p, 72)),
            (() => {
              const chart = createChart('bar', { x: w * 0.08, y: h * 0.3, width: w * 0.84, height: h * 0.5, name: 'Metrics' });
              chart.data.labels = ['Q1', 'Q2', 'Q3', 'Q4'];
              chart.data.series = [
                { name: '2025', values: [28, 42, 51, 68] },
                { name: '2026', values: [34, 55, 72, 96] },
              ];
              chart.data.options.palette = [p.accent, p.accent2];
              chart.data.options.labelColor = p.muted;
              chart.data.options.fontSize = 22;
              chart.data.options.gridColor = p.dark ? 'rgba(255,255,255,.12)' : 'rgba(0,0,0,.08)';
              return chart;
            })(),
            text(c.meta, w * 0.08, h * 0.87, w * 0.84, h * 0.05, bodyStyle(p, 24, { color: p.muted })),
          ],
          w,
          h,
          p,
          'Metrics',
          'Lead with the trend, then explain what changed.',
        ),
      );
      slides.push(
        page(
          [
            box(0, 0, w, h, solid(p.surface)),
            photo(0, 0, w * 0.5, h, p, 0, 1),
            text(c.headline, w * 0.56, h * 0.3, w * 0.38, h * 0.22, headingStyle(p, 64, { color: p.dark ? p.ink : p.bg })),
            text(c.sub, w * 0.56, h * 0.55, w * 0.38, h * 0.16, bodyStyle(p, 26, { color: p.muted })),
            ...c.items.flatMap((item, i) => {
              const y = h * 0.74 + i * h * 0.07;
              return [
                circle(w * 0.565, y + 10, w * 0.014, solid(p.accent)),
                text(`${item.title} — ${item.body}`, w * 0.59, y, w * 0.35, h * 0.05, bodyStyle(p, 22, { color: p.dark ? p.ink : p.bg })),
              ];
            }),
          ],
          w,
          h,
          p,
          'Split',
        ),
      );
      slides.push(
        page(
          [
            box(0, 0, w, h, solid(p.bg)),
            circle(w * 0.5, h * 0.42, w * 0.62, { type: 'solid', color: p.accent, opacity: 0.12 }),
            text('“' + c.sub + '”', w * 0.14, h * 0.3, w * 0.72, h * 0.28, {
              fontFamily: p.heading,
              fontSize: 60,
              fontWeight: 700,
              color: p.ink,
              textAlign: 'center',
              lineHeight: 1.3,
            }),
            divider(w * 0.45, h * 0.66, w * 0.1, p, 4),
            text(c.brand, w * 0.2, h * 0.72, w * 0.6, h * 0.06, bodyStyle(p, 28, { textAlign: 'center', fontWeight: 700, color: p.ink })),
          ],
          w,
          h,
          p,
          'Quote',
        ),
      );
      slides.push(
        page(
          [
            box(0, 0, w, h, solid(p.accent)),
            text('Thank you', w * 0.08, h * 0.36, w * 0.84, h * 0.18, {
              fontFamily: p.heading,
              fontSize: 120,
              fontWeight: 800,
              color: p.dark ? p.bg : '#fff',
              textAlign: 'center',
            }),
            text(c.cta, w * 0.08, h * 0.58, w * 0.84, h * 0.06, {
              fontFamily: p.body,
              fontSize: 34,
              color: p.dark ? p.bg : '#fff',
              textAlign: 'center',
            }),
            text(c.meta, w * 0.08, h * 0.68, w * 0.84, h * 0.05, {
              fontFamily: p.body,
              fontSize: 24,
              textAlign: 'center',
              color: withAlpha(p.dark ? p.bg : '#ffffff', 0.85),
            }),
          ],
          w,
          h,
          p,
          'Closing',
          'End with a single, specific next step.',
        ),
      );
      return slides;
    },
  },
  {
    key: 'deck-stats',
    category: 'Presentations',
    subcategory: 'Data',
    tags: ['presentation', 'data', 'charts', 'report'],
    size: { w: 1920, h: 1080 },
    kind: 'presentation',
    variants: 8,
    name: (c) => `${c.brand} — data deck`,
    build: ({ w, h, p, c }) => {
      const slides: Page[] = [];
      slides.push(
        page(
          [
            box(0, 0, w, h, solid(p.bg)),
            eyebrow(c.niche.toUpperCase(), w * 0.08, h * 0.14, w * 0.84, p, 22),
            text(c.headline.replace(/\n/g, ' '), w * 0.08, h * 0.2, w * 0.7, h * 0.18, headingStyle(p, 104)),
            ...[128, 64, 32].flatMap((value, i) => {
              const x = w * 0.08 + i * w * 0.29;
              return [
                box(x, h * 0.46, w * 0.25, h * 0.3, solid(p.surface), { radius: 20 }),
                text(`${value}%`, x, h * 0.53, w * 0.25, h * 0.12, {
                  fontFamily: p.heading,
                  fontSize: 84,
                  fontWeight: 800,
                  color: p.accent,
                  textAlign: 'center',
                }),
                text(c.items[i]?.title ?? 'Metric', x, h * 0.67, w * 0.25, h * 0.05, bodyStyle(p, 26, { textAlign: 'center', color: p.ink })),
              ];
            }),
          ],
          w,
          h,
          p,
          'Overview',
        ),
      );
      slides.push(
        page(
          [
            box(0, 0, w, h, solid(p.surface)),
            text('Comparison', w * 0.08, h * 0.12, w * 0.6, h * 0.12, headingStyle(p, 72, { color: p.dark ? p.ink : p.bg })),
            (() => {
              const table = createTable(4, 3, { x: w * 0.08, y: h * 0.3, width: w * 0.84, height: h * 0.42, name: 'Comparison table' });
              table.data.cells = [
                ['Metric', '2025', '2026'],
                ...c.items.map((item) => [item.title, String(20 + item.title.length), String(40 + item.body.length)]),
              ];
              table.data.style.headerFill = p.accent;
              table.data.style.fontSize = 24;
              table.data.style.color = p.dark ? p.ink : p.bg;
              table.data.style.cellFill = p.dark ? 'rgba(255,255,255,0.04)' : '#ffffff';
              table.data.style.altFill = p.dark ? 'rgba(255,255,255,0.02)' : '#f7f7fb';
              table.data.style.border = p.dark ? 'rgba(255,255,255,0.12)' : '#e6e6ef';
              return table;
            })(),
            text(c.sub, w * 0.08, h * 0.78, w * 0.7, h * 0.1, bodyStyle(p, 26, { color: p.muted })),
          ],
          w,
          h,
          p,
          'Comparison',
        ),
      );
      slides.push(
        page(
          [
            box(0, 0, w, h, solid(p.bg)),
            text('Trend', w * 0.08, h * 0.12, w * 0.6, h * 0.12, headingStyle(p, 72)),
            (() => {
              const chart = createChart('line', { x: w * 0.08, y: h * 0.3, width: w * 0.84, height: h * 0.5, name: 'Trend' });
              chart.data.labels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
              chart.data.series = [{ name: 'Growth', values: [12, 26, 24, 44, 58, 79] }];
              chart.data.options.palette = [p.accent];
              chart.data.options.labelColor = p.muted;
              chart.data.options.fontSize = 22;
              chart.data.options.gridColor = p.dark ? 'rgba(255,255,255,.12)' : 'rgba(0,0,0,.08)';
              return chart;
            })(),
          ],
          w,
          h,
          p,
          'Trend',
        ),
      );
      return slides;
    },
  },

  /* -------------------------------------------------------------- Posters */
  {
    key: 'poster-typo',
    category: 'Posters',
    subcategory: 'Typography',
    tags: ['poster', 'typography', 'bold', 'print'],
    size: { w: 1123, h: 1587 },
    kind: 'print',
    variants: 12,
    name: (c) => `${c.brand} — typographic poster`,
    build: ({ w, h, p, c }) => [
      page(
        [
          box(0, 0, w, h, solid(p.bg)),
          box(0, h * 0.06, w, h * 0.005, solid(p.accent)),
          text(c.brand.toUpperCase(), w * 0.07, h * 0.09, w * 0.86, h * 0.04, {
            fontFamily: p.body,
            fontSize: 22,
            fontWeight: 700,
            letterSpacing: 14,
            color: p.accent,
          }),
          text(c.headline, w * 0.07, h * 0.16, w * 0.7, h * 0.3, {
            fontFamily: p.heading,
            fontSize: w * 0.17,
            fontWeight: 800,
            color: p.ink,
            lineHeight: 0.98,
            letterSpacing: -4,
          }),
          box(w * 0.07, h * 0.5, w * 0.5, h * 0.002, solid(p.ink)),
          text(c.sub, w * 0.07, h * 0.53, w * 0.6, h * 0.12, bodyStyle(p, 20, { color: p.muted })),
          photo(w * 0.07, h * 0.66, w * 0.86, h * 0.2, p, 6),
          text(c.meta + '   ·   ' + c.tagline, w * 0.07, h * 0.9, w * 0.86, h * 0.04, bodyStyle(p, 17, { color: p.ink })),
        ],
        w,
        h,
        p,
      ),
    ],
  },
  {
    key: 'poster-grid',
    category: 'Posters',
    subcategory: 'Editorial',
    tags: ['poster', 'grid', 'modern', 'print'],
    size: { w: 1587, h: 2245 },
    kind: 'print',
    variants: 8,
    name: (c) => `${c.brand} — grid poster (A2)`,
    build: ({ w, h, p, c }) => [
      page(
        [
          box(0, 0, w, h, solid(p.bg)),
          box(w * 0.06, h * 0.04, w * 0.88, h * 0.92, null, { stroke: { color: p.accent, width: 2, style: 'solid' } }),
          text(c.brand, w * 0.1, h * 0.07, w * 0.8, h * 0.05, {
            fontFamily: p.heading,
            fontSize: 64,
            fontWeight: 700,
            color: p.ink,
            textAlign: 'center',
          }),
          text(c.tagline.toUpperCase(), w * 0.1, h * 0.125, w * 0.8, h * 0.03, {
            fontFamily: p.body,
            fontSize: 20,
            letterSpacing: 10,
            color: p.accent,
            textAlign: 'center',
          }),
          ...[0, 1, 2].map((i) => photo(w * (0.1 + i * 0.275), h * 0.2, w * 0.25, h * 0.3, p, 6, i)),
          text(c.headline, w * 0.1, h * 0.55, w * 0.8, h * 0.14, headingStyle(p, 96, { textAlign: 'center' })),
          text(c.sub, w * 0.15, h * 0.7, w * 0.7, h * 0.08, bodyStyle(p, 26, { textAlign: 'center', color: p.muted })),
          divider(w * 0.42, h * 0.8, w * 0.16, p, 3),
          text(c.meta, w * 0.1, h * 0.84, w * 0.8, h * 0.04, bodyStyle(p, 22, { textAlign: 'center', color: p.ink })),
        ],
        w,
        h,
        p,
      ),
    ],
  },

  /* --------------------------------------------------------------- Flyers */
  {
    key: 'flyer-sale',
    category: 'Flyers',
    subcategory: 'Sale',
    tags: ['flyer', 'sale', 'retail', 'print'],
    size: { w: 816, h: 1056 },
    kind: 'print',
    variants: 10,
    name: (c) => `${c.brand} — sale flyer`,
    build: ({ w, h, p, c }) => [
      page(
        [
          box(0, 0, w, h, solid('#ffffff')),
          box(0, 0, w, h * 0.3, solid(p.bg)),
          text('MEGA SALE', w * 0.06, h * 0.08, w * 0.88, h * 0.08, {
            fontFamily: p.heading,
            fontSize: 68,
            fontWeight: 800,
            color: '#fff',
            textAlign: 'center',
          }),
          text('UP TO 60% OFF STORE WIDE', w * 0.06, h * 0.19, w * 0.88, h * 0.04, {
            fontFamily: p.body,
            fontSize: 22,
            letterSpacing: 6,
            color: p.accent,
            textAlign: 'center',
          }),
          ...c.items.flatMap((item, i) => {
            const y = h * 0.36 + i * h * 0.14;
            return [
              box(w * 0.06, y, w * 0.88, h * 0.115, solid(i % 2 ? '#f7f7fb' : '#ffffff'), { radius: 8 }),
              text(item.title, w * 0.1, y + h * 0.018, w * 0.5, h * 0.04, { fontFamily: p.heading, fontSize: 26, fontWeight: 700, color: p.bg }),
              text(item.body, w * 0.1, y + h * 0.062, w * 0.6, h * 0.03, { fontFamily: p.body, fontSize: 15, color: '#666' }),
              box(w * 0.72, y + h * 0.03, w * 0.18, h * 0.05, solid(p.accent), { radius: 25 }),
              text('£' + (12 + i * 7), w * 0.72, y + h * 0.04, w * 0.18, h * 0.03, {
                fontFamily: p.body,
                fontSize: 20,
                fontWeight: 800,
                color: '#fff',
                textAlign: 'center',
              }),
            ];
          }),
          box(w * 0.06, h * 0.85, w * 0.88, h * 0.08, solid(p.accent), { radius: 8 }),
          text(c.cta.toUpperCase() + ' · ' + c.meta, w * 0.06, h * 0.875, w * 0.88, h * 0.03, {
            fontFamily: p.body,
            fontSize: 20,
            fontWeight: 800,
            color: '#fff',
            textAlign: 'center',
            letterSpacing: 2,
          }),
        ],
        w,
        h,
        p,
      ),
    ],
  },

  /* -------------------------------------------------------------- Resumes */
  {
    key: 'resume-modern',
    category: 'Resumes',
    subcategory: 'Modern',
    tags: ['resume', 'cv', 'job', 'document'],
    size: { w: 816, h: 1056 },
    kind: 'document',
    variants: 10,
    name: () => 'Modern résumé',
    build: ({ w, h, p, c }) => [
      page(
        [
          box(0, 0, w, h, solid('#ffffff')),
          box(0, 0, w * 0.32, h, solid(p.bg)),
          circle(w * 0.16, h * 0.06, w * 0.12, solid(p.accent)),
          text('AM', w * 0.16, h * 0.085, w * 0.12, h * 0.05, {
            fontFamily: p.heading,
            fontSize: 34,
            fontWeight: 700,
            color: '#fff',
            textAlign: 'center',
          }),
          text('ALEX MORGAN', w * 0.05, h * 0.19, w * 0.24, h * 0.04, {
            fontFamily: p.body,
            fontSize: 20,
            fontWeight: 800,
            color: '#fff',
            textAlign: 'center',
          }),
          text('Product Designer', w * 0.05, h * 0.225, w * 0.24, h * 0.03, {
            fontFamily: p.body,
            fontSize: 13,
            color: p.accent,
            textAlign: 'center',
            letterSpacing: 2,
          }),
          divider(w * 0.08, h * 0.29, w * 0.16, p, 2),
          ...['CONTACT', 'SKILLS', 'EDUCATION'].flatMap((section, i) => {
            const y = h * 0.33 + i * h * 0.18;
            return [
              text(section, w * 0.05, y, w * 0.24, h * 0.025, {
                fontFamily: p.body,
                fontSize: 12,
                fontWeight: 800,
                letterSpacing: 3,
                color: p.accent,
              }),
              text(
                ['alex@example.com\n+44 7700 900123\nLondon, UK', c.items.map((i) => i.title).join('\n'), 'BA Design, 2019\nRoyal College of Art'][i] ?? '',
                w * 0.05,
                y + h * 0.03,
                w * 0.24,
                h * 0.13,
                { fontFamily: p.body, fontSize: 13, lineHeight: 1.7, color: 'rgba(255,255,255,.86)' },
              ),
            ];
          }),
          text('EXPERIENCE', w * 0.38, h * 0.06, w * 0.5, h * 0.03, {
            fontFamily: p.body,
            fontSize: 12,
            fontWeight: 800,
            letterSpacing: 3,
            color: p.accent,
          }),
          ...c.items.flatMap((item, i) => {
            const y = h * 0.11 + i * h * 0.15;
            return [
              text(item.title, w * 0.38, y, w * 0.5, h * 0.03, { fontFamily: p.heading, fontSize: 21, fontWeight: 700, color: p.bg }),
              text('2022 — Present · ' + c.brand, w * 0.38, y + h * 0.03, w * 0.5, h * 0.025, { fontFamily: p.body, fontSize: 12, color: p.accent }),
              text(item.body, w * 0.38, y + h * 0.058, w * 0.5, h * 0.07, { fontFamily: p.body, fontSize: 13.5, lineHeight: 1.6, color: '#444' }),
            ];
          }),
          box(w * 0.38, h * 0.6, w * 0.5, 1, solid('#e5e7eb')),
          text('PROFILE', w * 0.38, h * 0.63, w * 0.5, h * 0.025, {
            fontFamily: p.body,
            fontSize: 12,
            fontWeight: 800,
            letterSpacing: 3,
            color: p.accent,
          }),
          text(c.sub, w * 0.38, h * 0.665, w * 0.5, h * 0.1, { fontFamily: p.body, fontSize: 13.5, lineHeight: 1.7, color: '#444' }),
        ],
        w,
        h,
        p,
      ),
    ],
  },

  /* ---------------------------------------------------------------- Logos */
  {
    key: 'logo-mark',
    category: 'Logos',
    subcategory: 'Mark',
    tags: ['logo', 'brand', 'identity', 'mark'],
    size: { w: 1000, h: 1000 },
    kind: 'design',
    variants: 12,
    name: (c) => `${c.brand} — logo mark`,
    build: ({ w, h, p, c }) => [
      page(
        [
          box(0, 0, w, h, solid('#ffffff')),
          circle(w * 0.5, h * 0.42, w * 0.34, linearGradient([p.accent, p.accent2], 120)),
          text(c.brand.slice(0, 2).toUpperCase(), w * 0.5, h * 0.36, w * 0.34, h * 0.12, {
            fontFamily: p.heading,
            fontSize: w * 0.19,
            fontWeight: 800,
            color: '#ffffff',
            textAlign: 'center',
          }),
          text(c.brand, w * 0.1, h * 0.78, w * 0.8, h * 0.08, {
            fontFamily: p.heading,
            fontSize: w * 0.085,
            fontWeight: 700,
            color: p.bg,
            textAlign: 'center',
            letterSpacing: w * 0.008,
          }),
          text(c.tagline.toUpperCase(), w * 0.1, h * 0.87, w * 0.8, h * 0.04, {
            fontFamily: p.body,
            fontSize: w * 0.022,
            letterSpacing: w * 0.008,
            color: p.accent,
            textAlign: 'center',
          }),
        ],
        w,
        h,
        p,
      ),
    ],
  },
  {
    key: 'logo-badge',
    category: 'Logos',
    subcategory: 'Badge',
    tags: ['logo', 'badge', 'vintage', 'brand'],
    size: { w: 1000, h: 1000 },
    kind: 'design',
    variants: 8,
    name: (c) => `${c.brand} — badge logo`,
    build: ({ w, h, p, c }) => [
      page(
        [
          box(0, 0, w, h, solid(p.bg)),
          circle(w * 0.5, h * 0.45, w * 0.72, null, { stroke: { color: p.accent, width: 6, style: 'solid' } }),
          circle(w * 0.5, h * 0.45, w * 0.62, null, { stroke: { color: p.accent, width: 2, style: 'dashed' } }),
          text('EST.', w * 0.5, h * 0.22, w * 0.4, h * 0.04, {
            fontFamily: p.body,
            fontSize: w * 0.035,
            fontWeight: 700,
            letterSpacing: w * 0.01,
            color: p.accent,
            textAlign: 'center',
          }),
          text('2014', w * 0.5, h * 0.26, w * 0.4, h * 0.04, {
            fontFamily: p.heading,
            fontSize: w * 0.05,
            color: p.ink,
            textAlign: 'center',
          }),
          text(c.brand, w * 0.18, h * 0.4, w * 0.64, h * 0.14, {
            fontFamily: p.heading,
            fontSize: w * 0.11,
            fontWeight: 800,
            color: p.ink,
            textAlign: 'center',
            lineHeight: 1,
          }),
          divider(w * 0.36, h * 0.56, w * 0.28, p, 3),
          text(c.tagline.toUpperCase(), w * 0.18, h * 0.6, w * 0.64, h * 0.05, {
            fontFamily: p.body,
            fontSize: w * 0.028,
            letterSpacing: w * 0.006,
            color: p.accent,
            textAlign: 'center',
          }),
        ],
        w,
        h,
        p,
      ),
    ],
  },

  /* ------------------------------------------------------------ Wallpaper */
  {
    key: 'wall-mesh',
    category: 'Wallpapers',
    subcategory: 'Abstract',
    tags: ['wallpaper', 'gradient', 'abstract', 'screen'],
    size: { w: 1920, h: 1080 },
    kind: 'design',
    variants: 10,
    name: () => 'Gradient mesh wallpaper',
    build: ({ w, h, p }) => [
      page(
        [
          box(0, 0, w, h, linearGradient([p.bg, p.surface, p.bg], 110)),
          circle(w * 0.18, h * 0.2, w * 0.28, { type: 'solid', color: p.accent, opacity: 0.4, }),
          circle(w * 0.76, h * 0.28, w * 0.32, { type: 'solid', color: p.accent2, opacity: 0.32 }),
          circle(w * 0.55, h * 0.82, w * 0.26, { type: 'solid', color: p.accent, opacity: 0.22 }),
          box(0, 0, w, h, { type: 'solid', color: p.bg, opacity: 0.12 }),
        ],
        w,
        h,
        p,
      ),
    ],
  },

  /* --------------------------------------------------------------- Covers */
  {
    key: 'cover-book',
    category: 'Covers',
    subcategory: 'Book',
    tags: ['book', 'cover', 'publishing', 'print'],
    size: { w: 1600, h: 2560 },
    kind: 'print',
    variants: 10,
    name: (c) => `${c.headline.replace(/\n/g, ' ')} — book cover`,
    build: ({ w, h, p, c }) => [
      page(
        [
          box(0, 0, w, h, solid(p.bg)),
          circle(w * 0.78, h * 0.24, w * 0.55, { type: 'solid', color: p.accent, opacity: 0.9 }),
          text(c.brand.toUpperCase(), w * 0.1, h * 0.08, w * 0.8, h * 0.03, {
            fontFamily: p.body,
            fontSize: 28,
            fontWeight: 700,
            letterSpacing: 12,
            color: p.accent,
          }),
          text(c.headline, w * 0.1, h * 0.14, w * 0.7, h * 0.24, {
            fontFamily: p.heading,
            fontSize: 132,
            fontWeight: 800,
            color: p.ink,
            lineHeight: 1.02,
            letterSpacing: -3,
          }),
          text(c.sub, w * 0.1, h * 0.42, w * 0.6, h * 0.1, bodyStyle(p, 34, { color: p.muted })),
          divider(w * 0.1, h * 0.56, w * 0.2, p, 5),
          text('ALEX MORGAN', w * 0.1, h * 0.62, w * 0.8, h * 0.04, {
            fontFamily: p.body,
            fontSize: 36,
            fontWeight: 700,
            color: p.ink,
          }),
          box(w * 0.1, h * 0.88, w * 0.8, h * 0.045, solid(p.accent)),
          text(c.tagline.toUpperCase(), w * 0.1, h * 0.89, w * 0.8, h * 0.03, {
            fontFamily: p.body,
            fontSize: 22,
            letterSpacing: 6,
            color: p.dark ? p.bg : '#fff',
            textAlign: 'center',
          }),
        ],
        w,
        h,
        p,
      ),
    ],
  },
  {
    key: 'cover-album',
    category: 'Covers',
    subcategory: 'Album',
    tags: ['album', 'music', 'cover', 'square'],
    size: { w: 1400, h: 1400 },
    kind: 'print',
    variants: 10,
    name: (c) => `${c.brand} — album cover`,
    build: ({ w, h, p, c }) => [
      page(
        [
          box(0, 0, w, h, solid(p.bg)),
          circle(w * 0.5, h * 0.5, w * 0.62, linearGradient([p.accent, p.accent2], 135)),
          circle(w * 0.5, h * 0.5, w * 0.32, solid(p.bg)),
          circle(w * 0.5, h * 0.5, w * 0.06, solid(p.accent)),
          text(c.brand, w * 0.1, h * 0.1, w * 0.8, h * 0.1, {
            fontFamily: p.heading,
            fontSize: 92,
            fontWeight: 800,
            color: p.ink,
            textAlign: 'center',
          }),
          text(c.tagline.toUpperCase(), w * 0.1, h * 0.87, w * 0.8, h * 0.04, {
            fontFamily: p.body,
            fontSize: 26,
            letterSpacing: 8,
            color: p.muted,
            textAlign: 'center',
          }),
        ],
        w,
        h,
        p,
      ),
    ],
  },
  {
    key: 'print-tshirt',
    category: 'Print',
    subcategory: 'Apparel',
    tags: ['tshirt', 'apparel', 'merch', 'print'],
    size: { w: 2000, h: 2400 },
    kind: 'print',
    variants: 8,
    name: (c) => `${c.brand} — T-shirt print`,
    build: ({ w, h, p, c }) => [
      page(
        [
          box(0, 0, w, h, solid('#ffffff')),
          circle(w * 0.5, h * 0.36, w * 0.5, { type: 'solid', color: p.accent, opacity: 0.16 }),
          text(c.brand.toUpperCase(), w * 0.12, h * 0.2, w * 0.76, h * 0.08, {
            fontFamily: p.heading,
            fontSize: 128,
            fontWeight: 800,
            color: p.bg,
            textAlign: 'center',
            letterSpacing: 4,
          }),
          divider(w * 0.38, h * 0.3, w * 0.24, p, 8),
          text(c.tagline.toUpperCase(), w * 0.12, h * 0.35, w * 0.76, h * 0.05, {
            fontFamily: p.body,
            fontSize: 46,
            letterSpacing: 12,
            color: p.accent,
            textAlign: 'center',
          }),
          text(c.headline.replace(/\n/g, ' '), w * 0.15, h * 0.46, w * 0.7, h * 0.16, {
            fontFamily: p.heading,
            fontSize: 76,
            color: p.bg,
            textAlign: 'center',
            lineHeight: 1.1,
          }),
        ],
        w,
        h,
        p,
      ),
    ],
  },
];

/* -------------------------------------------------------------- generation */

export type GeneratedTemplate = {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  subcategory?: string;
  tags: string[];
  width: number;
  height: number;
  kind: DocKind;
  pages: Page[];
  featured: boolean;
  trending: boolean;
  palette: string;
};

function slugFor(...parts: string[]): string {
  return parts
    .join('-')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/**
 * Expands every recipe into `variants` concrete templates by walking the
 * palette and copy pools — hundreds of unique, editable documents from a small
 * amount of code.
 */
export function generateTemplates(): GeneratedTemplate[] {
  const out: GeneratedTemplate[] = [];
  let index = 0;
  for (const recipe of RECIPES) {
    for (let v = 0; v < recipe.variants; v++) {
      const palette = PALETTES[(index * 5 + v * 3) % PALETTES.length]!;
      const content = CONTENT_SETS[(index * 7 + v) % CONTENT_SETS.length]!;
      const ctx: Ctx = {
        w: recipe.size.w,
        h: recipe.size.h,
        p: palette,
        c: content,
        fx: (value) => recipe.size.w * value,
        fy: (value) => recipe.size.h * value,
      };
      const pages = recipe.build(ctx);
      out.push({
        id: `${recipe.key}-${v}`,
        slug: slugFor(recipe.key, content.niche, palette.name),
        name: recipe.name(content),
        description: `${recipe.category} template — ${palette.name} palette, fully editable.`,
        category: recipe.category,
        subcategory: recipe.subcategory,
        tags: [...recipe.tags, content.niche, palette.name.toLowerCase()],
        width: recipe.size.w,
        height: recipe.size.h,
        kind: recipe.kind,
        pages,
        featured: v < 3,
        trending: v % 4 === 1,
        palette: palette.name,
      });
      index += 1;
    }
  }
  return out;
}

export const TEMPLATE_CATEGORIES: TemplateCategory[] = [
  'Instagram',
  'TikTok',
  'YouTube',
  'Business',
  'Marketing',
  'Education',
  'Events',
  'Restaurants',
  'Real estate',
  'E-commerce',
  'Presentations',
  'Posters',
  'Flyers',
  'Resumes',
  'Invitations',
  'Logos',
  'Ads',
  'Documents',
  'Print',
  'Wallpapers',
  'Covers',
];

let cached: GeneratedTemplate[] | null = null;

/** Memoised — building the catalogue is deterministic and cheap (~50 ms). */
export function allTemplates(): GeneratedTemplate[] {
  if (!cached) cached = generateTemplates();
  return cached;
}

export function templatesByCategory(category: string): GeneratedTemplate[] {
  return allTemplates().filter((t) => t.category === category);
}
