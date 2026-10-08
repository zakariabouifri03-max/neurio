import type { FontFamily } from '../../../shared/ipc'
import { platform } from '../platform'

const loaded = new Set<string>()

/** Registers a user font as a CSS FontFace so canvas can use it immediately. */
export async function registerFonts(fonts: FontFamily[]): Promise<void> {
  if (typeof document === 'undefined' || !('fonts' in document)) return
  for (const font of fonts) {
    if (!font.dataUrl || font.source !== 'user') continue
    const key = `${font.family}|${font.style ?? 'normal'}|${font.weight ?? 400}`
    if (loaded.has(key)) continue
    try {
      const face = new FontFace(font.family, `url(${font.dataUrl})`, {
        weight: String(font.weight ?? 400),
        style: font.style ?? 'normal'
      })
      await face.load()
      document.fonts.add(face)
      loaded.add(key)
    } catch {
      /* ignore unparsable fonts */
    }
  }
}

let fontPromise: Promise<FontFamily[]> | null = null

export async function loadFonts(): Promise<FontFamily[]> {
  fontPromise ??= platform.fonts.list().then(async (fonts) => {
    await registerFonts(fonts)
    return fonts
  })
  return fontPromise
}

export function invalidateFontCache(): void {
  fontPromise = null
}

/** Unique family names, deduplicated and sorted (system fonts last). */
export function uniqueFamilies(fonts: FontFamily[]): string[] {
  const set = new Set<string>()
  for (const font of fonts) set.add(font.family)
  if (set.size === 0) set.add('Inter')
  return [...set].sort((a, b) => a.localeCompare(b))
}

export const webSafeFallbacks = ['Inter', 'Arial', 'Helvetica', 'Georgia', 'Times New Roman', 'Courier New', 'Verdana', 'Impact', 'Trebuchet MS', 'Segoe UI']
