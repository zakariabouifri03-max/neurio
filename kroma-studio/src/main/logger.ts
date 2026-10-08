import { app } from 'electron'
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

let logFile: string | null = null

function file(): string {
  if (!logFile) {
    logFile = join(app.getPath('userData'), 'logs', 'kroma.log')
    try {
      mkdirSync(dirname(logFile), { recursive: true })
    } catch {
      /* logging must never break the app */
    }
  }
  return logFile
}

const stamp = (): string => new Date().toISOString()

function write(level: string, args: unknown[]): void {
  const line = `${stamp()} [${level}] ${args
    .map((a) => (a instanceof Error ? `${a.message}\n${a.stack ?? ''}` : typeof a === 'string' ? a : JSON.stringify(a)))
    .join(' ')}\n`
  try {
    appendFileSync(file(), line)
  } catch {
    /* ignore */
  }
  if (level === 'error') console.error('[kroma]', ...args)
  else console.log('[kroma]', ...args)
}

export const log = {
  info: (...args: unknown[]): void => write('info', args),
  warn: (...args: unknown[]): void => write('warn', args),
  error: (...args: unknown[]): void => write('error', args)
}
