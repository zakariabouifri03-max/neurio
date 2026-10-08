import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { KromaError, type IpcResult } from '../../shared/ipc'
import { log } from '../logger'

type Handler<T> = (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<T> | T

/**
 * Wraps every IPC handler so a failure inside one feature returns a structured
 * error instead of crashing the app or leaking a stack to the renderer.
 */
export function handle<T>(channel: string, handler: Handler<T>): void {
  ipcMain.handle(channel, async (event, ...args): Promise<IpcResult<T>> => {
    try {
      const value = await handler(event, ...args)
      return { ok: true, value }
    } catch (error) {
      log.error(`IPC ${channel} failed`, error)
      if (error instanceof KromaError) {
        return { ok: false, error: { code: error.code, message: error.message, details: error.details } }
      }
      const code = typeof error === 'object' && error && 'code' in error ? String((error as { code: unknown }).code) : 'UNKNOWN'
      const message = error instanceof Error ? error.message : 'Unexpected error'
      return { ok: false, error: { code, message } }
    }
  })
}

export const arg = <T,>(value: unknown, fallback: T): T => (value === undefined || value === null ? fallback : (value as T))
