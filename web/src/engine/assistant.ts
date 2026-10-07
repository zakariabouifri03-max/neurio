/**
 * Design assistant — natural language → structured editor command.
 *
 * This is the deterministic parser used when no LLM provider is configured
 * (and the shape the LLM is asked to return when one is). It is shared by the
 * server route and the in-editor assistant, so behaviour is identical offline
 * and online.
 */

export type DesignIntent =
  | 'create'
  | 'recolor'
  | 'resize'
  | 'variations'
  | 'removeBackground'
  | 'typography'
  | 'cleanup'
  | 'brand'
  | 'multiFormat'
  | 'generateImage'
  | 'writeText'
  | 'suggest'
  | 'explain'
  | 'unknown';

export type DesignCommand = {
  intent: DesignIntent;
  params: Record<string, unknown>;
  reply: string;
};

export type CanvasContext = {
  width?: number;
  height?: number;
  selection?: number;
  pageCount?: number;
  kind?: string;
};

const COLOR_WORDS: Record<string, string> = {
  red: '#EF4444',
  crimson: '#DC2626',
  orange: '#F97316',
  amber: '#F59E0B',
  yellow: '#EAB308',
  lime: '#84CC16',
  green: '#22C55E',
  emerald: '#10B981',
  teal: '#14B8A6',
  cyan: '#06B6D4',
  blue: '#3B82F6',
  navy: '#0F172A',
  indigo: '#6366F1',
  violet: '#8B5CF6',
  purple: '#A855F7',
  pink: '#EC4899',
  rose: '#F43F5E',
  brown: '#92400E',
  gold: '#D4AF37',
  black: '#0B0B0F',
  white: '#FFFFFF',
  grey: '#6B7280',
  gray: '#6B7280',
  beige: '#E6D5B8',
  أحمر: '#EF4444',
  أزرق: '#3B82F6',
  أخضر: '#22C55E',
  أصفر: '#EAB308',
  أسود: '#0B0B0F',
  أبيض: '#FFFFFF',
  ذهبي: '#D4AF37',
  بنفسجي: '#8B5CF6',
  برتقالي: '#F97316',
  وردي: '#EC4899',
};

const ARABIC_MAP: [RegExp, string][] = [
  [/انشئ|أنشئ|اصنع|اعمل|صمم/g, 'create'],
  [/غير|بدل|عدل/g, 'change'],
  [/الخلفية|الخلفيه/g, 'background'],
  [/احذف/g, 'remove'],
  [/كبر|صغر|غيّر الحجم|تغيير الحجم/g, 'resize'],
  [/انستغرام|انستقرام/g, 'instagram'],
  [/تيكتوك/g, 'tiktok'],
  [/يوتيوب/g, 'youtube'],
  [/احترافي|احترافية/g, 'professional'],
  [/الخطوط|الخط/g, 'typography'],
  [/تنويعات|نسخ/g, 'variations'],
];

/** Normalises Arabic phrasing into English keywords before rule matching. */
function normalize(input: string): string {
  let out = input;
  for (const [pattern, replacement] of ARABIC_MAP) out = out.replace(pattern, replacement);
  return out;
}

export function detectColors(prompt: string): string[] {
  const lower = prompt.toLowerCase();
  const found: string[] = [];
  for (const [word, hex] of Object.entries(COLOR_WORDS)) {
    if (new RegExp(`\\b${word}\\b`).test(lower) && !found.includes(hex)) found.push(hex);
  }
  const hexes = [...lower.matchAll(/#([0-9a-f]{6})\b/g)].map((m) => `#${m[1]!.toUpperCase()}`);
  for (const hex of hexes) if (!found.includes(hex)) found.push(hex);
  return found;
}

const FORMAT_KEYWORDS: Record<string, string> = {
  instagram: 'instagram',
  'ig post': 'instagram',
  'instagram post': 'instagram',
  story: 'story',
  stories: 'story',
  tiktok: 'tiktok',
  reels: 'story',
  youtube: 'youtube',
  thumbnail: 'youtube',
  banner: 'youtubeBanner',
  'channel art': 'youtubeBanner',
  facebook: 'facebook',
  linkedin: 'linkedin',
  'x post': 'x',
  twitter: 'x',
  pinterest: 'pinterest',
  presentation: 'presentation',
  slides: 'presentation',
  a4: 'a4',
  document: 'a4',
  poster: 'poster',
};

export function detectFormats(prompt: string): string[] {
  const lower = prompt.toLowerCase();
  const out: string[] = [];
  for (const [key, value] of Object.entries(FORMAT_KEYWORDS)) {
    if (lower.includes(key) && !out.includes(value)) out.push(value);
  }
  return out;
}

const TEMPLATE_HINTS: Record<string, string> = {
  coffee: 'coffee',
  cafe: 'coffee',
  gym: 'fitness',
  fitness: 'fitness',
  bakery: 'bakery',
  bread: 'bakery',
  realestate: 'realestate',
  'real estate': 'realestate',
  property: 'realestate',
  tech: 'tech',
  saas: 'tech',
  startup: 'tech',
  fashion: 'fashion',
  boutique: 'fashion',
  education: 'education',
  course: 'education',
  school: 'education',
  music: 'music',
  album: 'music',
  podcast: 'podcast',
  travel: 'travel',
  beauty: 'beauty',
  skincare: 'beauty',
  finance: 'finance',
  restaurant: 'restaurant',
  menu: 'restaurant',
  photography: 'photography',
  charity: 'nonprofit',
  nonprofit: 'nonprofit',
  event: 'event',
  conference: 'event',
  ecommerce: 'ecommerce',
  shop: 'ecommerce',
  coaching: 'coaching',
  gaming: 'gaming',
  health: 'health',
  clinic: 'health',
  architecture: 'architecture',
  legal: 'legal',
};

export function detectSubject(prompt: string): string | null {
  const lower = prompt.toLowerCase();
  for (const [key, value] of Object.entries(TEMPLATE_HINTS)) {
    if (new RegExp(`\\b${key}\\b`).test(lower)) return value;
  }
  return null;
}

const TYPOGRAPHY_PRESETS = ['classic', 'modern', 'editorial', 'playful', 'luxury', 'bold'];

export function parseDesignCommand(rawPrompt: string, context: CanvasContext = {}): DesignCommand {
  const prompt = normalize(rawPrompt).toLowerCase();
  const colors = detectColors(prompt);
  const formats = detectFormats(prompt);
  const subject = detectSubject(prompt);

  const has = (...words: string[]) => words.some((w) => prompt.includes(w));

  /* ------------------------------------------------------------- generation */
  if (has('generate', 'draw', 'create an image', 'make an image', 'picture of', 'photo of', 'illustration of')) {
    return {
      intent: 'generateImage',
      params: { prompt: rawPrompt, count: 2 },
      reply: 'Generating artwork for that description.',
    };
  }

  if (has('write', 'caption', 'headline', 'copy', 'rewrite', 'summarize', 'summarise', 'hashtag', 'product description')) {
    const feature = has('caption')
      ? 'caption'
      : has('headline')
        ? 'headline'
        : has('hashtag')
          ? 'hashtags'
          : has('product')
            ? 'product'
            : has('summar')
              ? 'summarize'
              : has('rewrite')
                ? 'rewrite'
                : 'generate';
    return {
      intent: 'writeText',
      params: { feature, prompt: rawPrompt, topic: subject },
      reply: 'Drafting copy you can drop straight onto the canvas.',
    };
  }

  /* -------------------------------------------------------- background etc */
  if (has('remove background', 'background remover', 'cut out', 'transparent background', 'no background')) {
    return { intent: 'removeBackground', params: {}, reply: 'Removing the background of the selected image.' };
  }

  if (has('upscale', 'enhance', 'sharpen', 'restore', 'higher resolution')) {
    return { intent: 'removeBackground', params: { enhance: true }, reply: 'Enhancing the selected image.' };
  }

  /* ------------------------------------------------------------- variations */
  if (has('variation', 'variations', 'alternatives', 'options', 'different versions', '5 versions')) {
    const countMatch = prompt.match(/(\d+)\s*(variation|version|option|alternative)/);
    const count = countMatch ? Math.min(Math.max(Number(countMatch[1]), 2), 8) : 4;
    return { intent: 'variations', params: { count }, reply: `Creating ${count} variations of this design.` };
  }

  /* ---------------------------------------------------------------- resize */
  if (has('resize', 'reformat', 're-format', 'different size', 'for instagram', 'for tiktok', 'for youtube')) {
    if (formats.length > 1) {
      return { intent: 'multiFormat', params: { targets: formats }, reply: `Generating ${formats.length} formats from this design.` };
    }
    return { intent: 'resize', params: { targets: formats.length ? formats : ['instagram'] }, reply: 'Resizing the design.' };
  }

  if (formats.length > 1 && has('and', 'both', 'all')) {
    return { intent: 'multiFormat', params: { targets: formats }, reply: `Creating ${formats.length} formats.` };
  }

  /* ---------------------------------------------------------------- colors */
  if (colors.length && (has('color', 'colour', 'recolor', 'recolour', 'palette', 'change'))) {
    const target = has('background') ? 'background' : has('text', 'typography') ? 'text' : 'all';
    return {
      intent: 'recolor',
      params: { colors, target },
      reply: `Applying ${colors.map((c) => c.toLowerCase()).join(' and ')} across the design.`,
    };
  }

  if (has('brand', 'brand kit', 'our brand')) {
    return { intent: 'brand', params: {}, reply: 'Applying your brand kit to this design.' };
  }

  /* ------------------------------------------------------------ typography */
  if (has('typography', 'font', 'fonts', 'text style', 'typeface')) {
    const preset = TYPOGRAPHY_PRESETS.find((p) => prompt.includes(p)) ?? 'modern';
    return { intent: 'typography', params: { preset }, reply: `Applying the ${preset} typography system.` };
  }

  if (has('professional', 'cleaner', 'tidy', 'clean up', 'align', 'spacing', 'consistent')) {
    return { intent: 'cleanup', params: {}, reply: 'Tidying alignment, spacing and hierarchy.' };
  }

  if (has('suggest', 'improve', 'recommend', 'tips', 'how can')) {
    return { intent: 'suggest', params: {}, reply: 'Here are improvements for this design.' };
  }

  if (has('explain', 'what is', 'help', 'how do i')) {
    return { intent: 'explain', params: {}, reply: 'Here is how that works.' };
  }

  /* ----------------------------------------------------------------- create */
  if (has('create', 'make', 'design', 'build', 'new')) {
    const sizeMatch = prompt.match(/(\d{2,5})\s*[x×]\s*(\d{2,5})/);
    const kind = has('presentation', 'slides', 'deck')
      ? 'presentation'
      : has('document', 'resume', 'cv', 'report', 'letter')
        ? 'document'
        : has('video', 'reel')
          ? 'video'
          : 'design';
    return {
      intent: 'create',
      params: {
        templateHint: subject,
        width: sizeMatch ? Number(sizeMatch[1]) : undefined,
        height: sizeMatch ? Number(sizeMatch[2]) : undefined,
        kind,
        formats: formats.length ? formats : undefined,
        prompt: rawPrompt,
      },
      reply: subject
        ? `Building a ${subject} design you can edit.`
        : 'Creating a new design from your description.',
    };
  }

  return {
    intent: 'unknown',
    params: {},
    reply:
      "I can create designs, recolor them, resize for any platform, generate variations, write copy, fix typography, apply your brand, or remove backgrounds. Try: “make this blue and white”, “resize for Instagram and YouTube”, or “create a coffee shop post”.",
  };
}
