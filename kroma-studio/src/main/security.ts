import { app, protocol, session, shell } from 'electron'
import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ASSET_PROTOCOL } from '../shared/constants'
import { log } from './logger'
import { getAssetStore } from './services/storage/asset-store'
import { getProjectStore } from './services/storage/project-store'
import { ensureStorageDirs } from './services/storage/paths'

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
}

/**
 * Registers the `kroma-asset://` scheme so local images stream into the renderer
 * without `file://` access, without base64 blobs in project JSON and without
 * tainting the canvas on export.
 */
export function registerAssetProtocol(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: ASSET_PROTOCOL,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true, codeCache: true }
    }
  ])
}

export function installAssetProtocolHandler(): void {
  protocol.handle(ASSET_PROTOCOL, async (request) => {
    try {
      const id = new URL(request.url).hostname || decodeURIComponent(new URL(request.url).pathname.replace(/^\//, ''))
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) return new Response('Invalid asset', { status: 400 })
      const path = getAssetStore().resolvePath(id) ?? getProjectStore().thumbnailPath(id)
      const data = await readFile(path)
      const mime = MIME_BY_EXT[extname(path).toLowerCase()] ?? 'application/octet-stream'
      return new Response(new Uint8Array(data), {
        status: 200,
        headers: { 'content-type': mime, 'cache-control': 'private, max-age=31536000, immutable' }
      })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}

export function hardenSession(): void {
  const filter = { urls: ['*://*/*'] }
  session.defaultSession.webRequest.onHeadersReceived(filter, (details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; " +
            `img-src 'self' data: blob: ${ASSET_PROTOCOL}:; ` +
            "script-src 'self'; " +
            "style-src 'self' 'unsafe-inline'; " +
            "font-src 'self' data:; " +
            "connect-src 'self' ipc: http://ipc.localhost data: blob:; " +
            "worker-src 'self' blob:; " +
            "object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'"
        ]
      }
    })
  })

  // No permission prompts: the editor needs none of these.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  session.defaultSession.setPermissionCheckHandler(() => false)
  session.defaultSession.setDevicePermissionHandler(() => false)
}

export function lockNavigation(win: Electron.BrowserWindow): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(win.webContents.getURL())) event.preventDefault()
  })
  win.webContents.on('render-process-gone', (_event, details) => {
    log.error('Renderer crashed', details.reason, details.exitCode)
  })
}

export const prepareStorage = (): void => {
  ensureStorageDirs()
}

export const singleInstance = (): boolean => app.requestSingleInstanceLock()

export const assetUrlOf = (id: string): string => `${ASSET_PROTOCOL}://${id}`
export const fileUrl = (path: string): string => pathToFileURL(path).toString()
