import type { TemplateCategory } from '@/types';
import type { BlueprintElement } from '@/types/design';

export interface BuiltInTemplate {
  id: string;
  name: string;
  category: TemplateCategory;
  width: number;
  height: number;
  background: string;
  elements: BlueprintElement[];
}

const t = (
  id: string,
  text: string,
  x: number,
  y: number,
  width: number,
  fontSize: number,
  fill: string,
  opts: Record<string, unknown> = {}
): BlueprintElement => ({
  type: 'text',
  id,
  text,
  x,
  y,
  width,
  fontSize,
  fontFamily: 'Inter',
  fontWeight: 'bold',
  fill,
  align: 'center',
  role: 'headline',
  ...opts
}) as BlueprintElement;

const s = (
  id: string,
  type: 'rect' | 'ellipse' | 'triangle' | 'star',
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string,
  opts: Record<string, unknown> = {}
): BlueprintElement => ({ type, id, x, y, width, height, fill, ...opts }) as BlueprintElement;

/**
 * Original Lumora starter templates — every layout, palette and wording below
 * was written for this project. No third-party template assets are used.
 */
export const BUILT_IN_TEMPLATES: BuiltInTemplate[] = [
  {
    id: 'yt-bold-beam',
    name: 'Bold Beam Thumbnail',
    category: 'YouTube',
    width: 1280,
    height: 720,
    background: '#10131f',
    elements: [
      s('a', 'rect', -80, 420, 1500, 420, '#7c5cff', { angle: -8, opacity: 0.9 }),
      s('b', 'ellipse', 880, -120, 620, 620, '#ff3d9a', { opacity: 0.45 }),
      t('c', 'I BUILT THIS\nIN 24 HOURS', 70, 120, 740, 96, '#ffffff', { align: 'left' }),
      t('d', 'full breakdown inside', 74, 360, 600, 34, '#c9c6ff', { align: 'left', fontWeight: 'normal', role: 'subhead' }),
      s('e', 'rect', 70, 470, 230, 64, '#ffd166', { rx: 32 }),
      t('f', 'NEW EPISODE', 70, 487, 230, 26, '#1b1b2f', { role: 'caption' })
    ]
  },
  {
    id: 'yt-split-review',
    name: 'Split Review Thumbnail',
    category: 'YouTube',
    width: 1280,
    height: 720,
    background: '#0b1020',
    elements: [
      s('a', 'rect', 0, 0, 640, 720, '#12284f'),
      s('b', 'rect', 640, 0, 640, 720, '#4a1030'),
      s('c', 'ellipse', 540, 260, 200, 200, '#ffd166'),
      t('d', 'VS', 540, 300, 200, 110, '#1b1b2f'),
      t('e', 'BUDGET', 40, 540, 560, 70, '#8fd5ff'),
      t('f', 'PREMIUM', 680, 540, 560, 70, '#ff9ecb')
    ]
  },
  {
    id: 'ig-quote-card',
    name: 'Soft Quote Card',
    category: 'Instagram',
    width: 1080,
    height: 1080,
    background: '#f6efe7',
    elements: [
      s('a', 'ellipse', -180, -180, 640, 640, '#e8c7a9', { opacity: 0.8 }),
      s('b', 'ellipse', 700, 740, 520, 520, '#b7cbb0', { opacity: 0.7 }),
      t('c', '"Small steps,\nrepeated daily,\nbecome momentum."', 120, 360, 840, 68, '#2f2a26'),
      t('d', '@yourhandle', 120, 880, 840, 30, '#7a6a5c', { fontWeight: 'normal', role: 'caption' })
    ]
  },
  {
    id: 'ig-product-drop',
    name: 'Product Drop Post',
    category: 'Instagram',
    width: 1080,
    height: 1080,
    background: '#0f0f14',
    elements: [
      s('a', 'rect', 80, 80, 920, 760, '#1b1b26', { rx: 40 }),
      s('b', 'ellipse', 300, 220, 480, 480, '#7c5cff', { opacity: 0.55 }),
      t('c', 'NEW DROP', 80, 150, 920, 44, '#ffd166', { role: 'caption' }),
      t('d', 'AURORA\nSNEAKERS', 80, 520, 920, 96, '#ffffff'),
      s('e', 'rect', 380, 880, 320, 86, '#ffd166', { rx: 43 }),
      t('f', 'SHOP NOW', 380, 905, 320, 34, '#17171f')
    ]
  },
  {
    id: 'tiktok-hook',
    name: 'Hook Cover',
    category: 'TikTok',
    width: 1080,
    height: 1920,
    background: '#120c1f',
    elements: [
      s('a', 'ellipse', -200, 1200, 900, 900, '#ff3d9a', { opacity: 0.4 }),
      s('b', 'ellipse', 500, -200, 800, 800, '#22d3ee', { opacity: 0.35 }),
      t('c', '3 THINGS\nNOBODY\nTELLS YOU', 90, 620, 900, 120, '#ffffff'),
      t('d', 'save this for later', 90, 1080, 900, 44, '#ffd166', { fontWeight: 'normal', role: 'subhead' })
    ]
  },
  {
    id: 'fb-event-banner',
    name: 'Event Cover Banner',
    category: 'Facebook',
    width: 1640,
    height: 624,
    background: '#0d1b2a',
    elements: [
      s('a', 'rect', 0, 460, 1640, 164, '#1b4965'),
      s('b', 'star', 1280, 120, 260, 260, '#ffd166', { opacity: 0.9 }),
      t('c', 'COMMUNITY MEETUP 2026', 80, 180, 1100, 72, '#ffffff', { align: 'left' }),
      t('d', 'Saturday · 6 PM · The Old Mill', 80, 300, 1100, 38, '#8ecae6', { align: 'left', fontWeight: 'normal', role: 'subhead' })
    ]
  },
  {
    id: 'poster-gig',
    name: 'Gig Night Poster',
    category: 'Posters',
    width: 1240,
    height: 1754,
    background: '#1a1014',
    elements: [
      s('a', 'rect', 100, 100, 1040, 1554, '#241519', { rx: 24 }),
      s('b', 'ellipse', 240, 300, 760, 760, '#ff5f6d', { opacity: 0.6 }),
      t('c', 'MIDNIGHT\nSESSIONS', 140, 1120, 960, 120, '#ffe6d5'),
      t('d', 'live music · 9pm · entry free', 140, 1360, 960, 40, '#ffb3a7', { fontWeight: 'normal', role: 'subhead' }),
      s('e', 'rect', 140, 1480, 300, 8, '#ffd166')
    ]
  },
  {
    id: 'flyer-service',
    name: 'Service Flyer',
    category: 'Flyers',
    width: 1240,
    height: 1754,
    background: '#ffffff',
    elements: [
      s('a', 'rect', 0, 0, 1240, 420, '#0f766e'),
      t('b', 'HOME CLEANING\nTHAT ACTUALLY SHINES', 80, 120, 1080, 66, '#ffffff'),
      s('c', 'rect', 80, 520, 1080, 2, '#d7d7d7'),
      t('d', 'Deep clean · Move-out · Weekly plans', 80, 600, 1080, 44, '#333333', { fontWeight: 'normal', role: 'subhead' }),
      s('e', 'rect', 80, 1400, 1080, 220, '#f1f5f4', { rx: 24 }),
      t('f', 'Call 555-0199 · brightnest.example', 80, 1480, 1080, 44, '#0f766e', { role: 'body' })
    ]
  },
  {
    id: 'business-card',
    name: 'Minimal Business Card',
    category: 'Business',
    width: 1050,
    height: 600,
    background: '#101014',
    elements: [
      s('a', 'rect', 0, 0, 18, 600, '#7c5cff'),
      t('b', 'ALEX RIVERA', 90, 200, 600, 54, '#ffffff', { align: 'left' }),
      t('c', 'Product Designer', 92, 280, 600, 30, '#9c97c9', { align: 'left', fontWeight: 'normal', role: 'subhead' }),
      t('d', 'hello@example.com · +1 555 0134', 92, 420, 700, 24, '#6f6b90', { align: 'left', fontWeight: 'normal', role: 'caption' })
    ]
  },
  {
    id: 'tee-vintage',
    name: 'Vintage Badge Tee',
    category: 'T-Shirts',
    width: 4500,
    height: 5400,
    background: '#e8d8b9',
    elements: [
      s('a', 'ellipse', 900, 1200, 2700, 2700, '#7d4f2a', { opacity: 0.18 }),
      t('b', 'WILD & WANDER', 500, 1500, 3500, 360, '#3f2a1d'),
      s('c', 'rect', 1200, 2050, 2100, 30, '#a53f2b'),
      t('d', 'EST. 1998 · OUTDOOR CLUB', 500, 2200, 3500, 150, '#7d4f2a', { fontWeight: 'normal', role: 'subhead' }),
      s('e', 'triangle', 1700, 2700, 1100, 900, '#a53f2b', { opacity: 0.9 })
    ]
  },
  {
    id: 'logo-monogram',
    name: 'Monogram Mark',
    category: 'Logos',
    width: 1000,
    height: 1000,
    background: '#ffffff',
    elements: [
      s('a', 'ellipse', 200, 170, 600, 600, '#111827'),
      t('b', 'LM', 200, 380, 600, 200, '#ffffff'),
      t('c', 'LUMORA MAKERS', 100, 820, 800, 44, '#111827', { fontWeight: 'normal', role: 'subhead' })
    ]
  },
  {
    id: 'deck-title',
    name: 'Deck Title Slide',
    category: 'Presentations',
    width: 1920,
    height: 1080,
    background: '#0b1120',
    elements: [
      s('a', 'rect', 0, 0, 24, 1080, '#22d3ee'),
      t('b', 'Quarterly Product Review', 120, 400, 1400, 88, '#ffffff', { align: 'left' }),
      t('c', 'Design systems · Roadmap · Metrics', 124, 540, 1400, 40, '#7dd3fc', { align: 'left', fontWeight: 'normal', role: 'subhead' }),
      s('d', 'ellipse', 1450, 620, 420, 420, '#22d3ee', { opacity: 0.25 })
    ]
  },
  {
    id: 'wall-gradient',
    name: 'Aurora Wallpaper',
    category: 'Wallpapers',
    width: 1920,
    height: 1080,
    background: '#05060f',
    elements: [
      s('a', 'ellipse', -200, -200, 1100, 1100, '#7c5cff', { opacity: 0.5 }),
      s('b', 'ellipse', 1100, 400, 1100, 1100, '#22d3ee', { opacity: 0.4 }),
      s('c', 'ellipse', 600, 700, 800, 800, '#ff3d9a', { opacity: 0.3 }),
      t('d', 'stay curious', 560, 480, 800, 90, '#ffffff', { fontWeight: 'normal' })
    ]
  },
  {
    id: 'ig-story-sale',
    name: 'Flash Sale Story',
    category: 'Instagram',
    width: 1080,
    height: 1920,
    background: '#fff4e6',
    elements: [
      s('a', 'rect', 0, 0, 1080, 520, '#ff5f6d'),
      t('b', 'FLASH\nSALE', 90, 120, 900, 150, '#fff4e6'),
      t('c', '48 HOURS ONLY', 90, 640, 900, 60, '#3a2b24'),
      s('d', 'rect', 240, 900, 600, 600, '#ffd166', { rx: 48 }),
      t('e', '-40%', 240, 1080, 600, 200, '#3a2b24'),
      t('f', 'code: LUMORA40', 90, 1680, 900, 48, '#3a2b24', { fontWeight: 'normal', role: 'subhead' })
    ]
  }
];

export const TEMPLATE_CATEGORIES: TemplateCategory[] = [
  'YouTube',
  'Instagram',
  'TikTok',
  'Facebook',
  'Posters',
  'Flyers',
  'Business',
  'T-Shirts',
  'Logos',
  'Presentations',
  'Wallpapers',
  'Custom'
];

export const SIZE_PRESETS = [
  { label: 'Instagram Post', width: 1080, height: 1080 },
  { label: 'Instagram Story', width: 1080, height: 1920 },
  { label: 'YouTube Thumbnail', width: 1280, height: 720 },
  { label: 'Full HD', width: 1920, height: 1080 },
  { label: 'TikTok', width: 1080, height: 1920 },
  { label: 'Facebook Cover', width: 1640, height: 624 },
  { label: 'A4 Poster', width: 2480, height: 3508 },
  { label: 'Flyer', width: 1240, height: 1754 },
  { label: 'T-Shirt Print', width: 4500, height: 5400 },
  { label: 'Logo', width: 1000, height: 1000 },
  { label: 'Presentation 16:9', width: 1920, height: 1080 },
  { label: 'Business Card', width: 1050, height: 600 }
];
