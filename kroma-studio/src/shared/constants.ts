/** Hard product limits and shared magic numbers. */
export const LIMITS = {
  /** Longest side of an uploaded raster image, in pixels. */
  MAX_IMAGE_EDGE: 8000,
  /** Uploaded file size ceiling (25 MB). */
  MAX_UPLOAD_BYTES: 25 * 1024 * 1024,
  /** Undo history depth. */
  HISTORY_DEPTH: 80,
  /** Debounce for auto-save (ms). */
  AUTOSAVE_DEBOUNCE_MS: 1200,
  /** Debounce for project thumbnails (ms). */
  THUMBNAIL_DEBOUNCE_MS: 2500,
  /** Max pages per document. */
  MAX_PAGES: 60,
  /** Max nodes per page. */
  MAX_NODES_PER_PAGE: 1200,
  /** Longest side of an exported raster (px). */
  MAX_EXPORT_EDGE: 12000,
  /** Default decoded-image cache budget (bytes). */
  imageCacheSizeMbDefault: 512 * 1024 * 1024
} as const

export const DOCUMENT_VERSION = 3

/** Custom protocol used to stream local asset files into the renderer. */
export const ASSET_PROTOCOL = 'kroma-asset'
export const assetUrl = (assetId: string): string => `${ASSET_PROTOCOL}://${assetId}`
export const isAssetUrl = (src: string): boolean => src.startsWith(`${ASSET_PROTOCOL}://`)

export const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp', 'image/avif'] as const
export const ACCEPTED_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif'] as const
export const ACCEPTED_FONT_EXTENSIONS = ['.ttf', '.otf', '.woff', '.woff2'] as const
export const ACCEPTED_SVG_EXTENSIONS = ['.svg'] as const

export const IMAGE_EXTENSIONS_FOR_UPLOAD = ['.png', '.jpg', '.jpeg', '.webp'] as const

export interface ExportPreset {
  id: string
  label: string
  width: number
  height: number
  hint?: string
}

/** Quick export presets required by the product spec. */
export const EXPORT_PRESETS: ExportPreset[] = [
  { id: 'square-1080', label: 'Square 1080 × 1080', width: 1080, height: 1080, hint: 'Instagram post' },
  { id: 'hd-1920', label: 'Landscape 1920 × 1080', width: 1920, height: 1080, hint: 'YouTube / desktop' },
  { id: 'story-1080', label: 'Vertical 1080 × 1920', width: 1080, height: 1920, hint: 'Story / Reels / TikTok' },
  { id: 'thumb-1280', label: 'Thumbnail 1280 × 720', width: 1280, height: 720, hint: 'YouTube thumbnail' },
  { id: 'merch-4500', label: 'Merch 4500 × 5400', width: 4500, height: 5400, hint: 'T-shirt print (150 dpi)' },
  { id: 'a4-portrait', label: 'A4 Portrait 2480 × 3508', width: 2480, height: 3508, hint: 'Flyer @300 dpi' }
]

/** Canvas sizes offered by the "new design" picker, grouped by use case. */
export interface DesignSizePreset {
  id: string
  label: string
  group: string
  width: number
  height: number
}

export const DESIGN_SIZE_PRESETS: DesignSizePreset[] = [
  { id: 'yt-thumb', label: 'YouTube Thumbnail', group: 'Video', width: 1280, height: 720 },
  { id: 'yt-banner', label: 'YouTube Banner', group: 'Video', width: 2560, height: 1440 },
  { id: 'ig-post', label: 'Instagram Post', group: 'Social', width: 1080, height: 1080 },
  { id: 'ig-story', label: 'Instagram Story', group: 'Social', width: 1080, height: 1920 },
  { id: 'ig-portrait', label: 'Instagram Portrait', group: 'Social', width: 1080, height: 1350 },
  { id: 'tiktok', label: 'TikTok Graphic', group: 'Social', width: 1080, height: 1920 },
  { id: 'fb-post', label: 'Facebook Post', group: 'Social', width: 1200, height: 630 },
  { id: 'x-post', label: 'X / Twitter Post', group: 'Social', width: 1600, height: 900 },
  { id: 'poster-a2', label: 'Poster (A2)', group: 'Print', width: 4961, height: 7016 },
  { id: 'flyer-a5', label: 'Flyer (A5)', group: 'Print', width: 1748, height: 2480 },
  { id: 'tshirt', label: 'T-Shirt Print', group: 'Print', width: 4500, height: 5400 },
  { id: 'logo', label: 'Logo', group: 'Brand', width: 1000, height: 1000 },
  { id: 'slide-16x9', label: 'Presentation 16:9', group: 'Docs', width: 1920, height: 1080 },
  { id: 'wallpaper', label: 'Desktop Wallpaper', group: 'Other', width: 2560, height: 1440 }
]

export const TEMPLATE_CATEGORIES = [
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
  'Wallpapers'
] as const
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number]
