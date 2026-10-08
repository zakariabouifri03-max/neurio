/**
 * Brand tokens.
 *
 * Everything cosmetic about the product's identity lives here so the app can be
 * renamed or re-coloured without editing a single component: change these
 * values and the palette in `tailwind.config.ts`.
 */
export const brand = {
  name: 'ADZAK EDIT',
  shortName: 'ADZAK',
  tagline: 'Local-first video editing',
  /** Shown in the window title bar and About dialog. */
  edition: 'Free · Offline · No account',
  /** Accent colour used for the wordmark gradient. */
  accent: '#3ddc97',
  accentAlt: '#6ea8fe',
  /** Single-letter mark used until a real logo asset is supplied. */
  monogram: 'A',
  supportUrl: '',
} as const;

/** Window title helper — the one place the app name is composed. */
export function windowTitle(projectName: string, dirty: boolean): string {
  return `${dirty ? '• ' : ''}${projectName} — ${brand.name}`;
}
