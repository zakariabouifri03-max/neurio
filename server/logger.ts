/* Minimal structured logger — no dependencies, no telemetry, no network. */
type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const envLevel = (process.env.NEURIO_LOG_LEVEL as Level | undefined) ?? 'info';
let currentLevel = LEVELS[envLevel] ?? LEVELS.info;

export function setLogLevel(level: Level): void {
  currentLevel = LEVELS[level];
}

function write(level: Level, scope: string, message: string, extra?: unknown): void {
  if (LEVELS[level] < currentLevel) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}`;
  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  if (extra !== undefined) stream.write(`${line} ${safeJson(extra)}\n`);
  else stream.write(`${line}\n`);
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export interface Logger {
  debug(message: string, extra?: unknown): void;
  info(message: string, extra?: unknown): void;
  warn(message: string, extra?: unknown): void;
  error(message: string, extra?: unknown): void;
  child(scope: string): Logger;
}

export function logger(scope: string): Logger {
  return {
    debug: (m, e) => write('debug', scope, m, e),
    info: (m, e) => write('info', scope, m, e),
    warn: (m, e) => write('warn', scope, m, e),
    error: (m, e) => write('error', scope, m, e),
    child: (sub) => logger(`${scope}:${sub}`),
  };
}
