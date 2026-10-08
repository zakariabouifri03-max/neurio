import type { KromaApi } from '../../../shared/ipc'

/** Same surface in Electron and in the browser preview shim. */
export type PlatformApi = Omit<KromaApi, 'meta'> & { meta: { isDesktop: boolean; version: string } }

export const isDesktopPlatform = (api: PlatformApi): boolean => api.meta.isDesktop
