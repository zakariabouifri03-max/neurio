import { webPlatform } from './web'
import type { PlatformApi } from './types'

let cached: PlatformApi | null = null

/** Desktop bridge when running in Electron, preview shim in a plain browser. */
export function getPlatform(): PlatformApi {
  if (cached) return cached
  if (typeof window !== 'undefined' && window.kroma) {
    cached = { ...window.kroma, meta: { isDesktop: true, version: window.kroma.meta.version } }
  } else {
    cached = webPlatform
  }
  return cached
}

export const platform = getPlatform()
export type { PlatformApi } from './types'
