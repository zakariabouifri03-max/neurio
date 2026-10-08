/**
 * Single source of truth for product branding.
 * Rename the product here and the whole app (window title, dialogs,
 * installer name references, about screen) follows.
 */
export const BRAND = {
  name: 'Kroma Studio',
  short: 'Kroma',
  appId: 'studio.kroma.desktop',
  tagline: 'Design anything. Offline-first. AI-assisted.',
  version: '0.1.0',
  accent: '#7C5CFF',
  accentSoft: '#9C86FF',
  supportUrl: 'https://github.com/kroma-studio/kroma-studio'
} as const

export type Brand = typeof BRAND
