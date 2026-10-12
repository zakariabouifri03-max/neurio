/** Runtime configuration: defaults, CLI flags and environment variables. */
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import type { IceServerConfig } from '../shared/types';

export const SERVER_NAME = 'Neurio';
export const SERVER_VERSION = '1.0.0';
export const DEFAULT_PORT = 8790;
export const DEFAULT_HOST = '0.0.0.0';

export interface RuntimeConfig {
  serverName: string;
  version: string;
  host: string;
  port: number;
  /** where the SQLite file and uploads live */
  dataDir: string;
  dbFile: string;
  uploadsDir: string;
  maxUploadBytes: number;
  registrationOpen: boolean;
  iceServers: IceServerConfig[];
  offlineMode: boolean;
  /** serve the built renderer (browser mode) from this directory */
  staticDir: string | null;
  /** allow browsers (non-Electron) to talk to this server */
  allowWeb: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  startedAt: number;
  /** trust X-Forwarded-For (only when you really run behind a proxy) */
  trustProxy: boolean;
}

export interface ParsedArgs {
  flags: Map<string, string | boolean>;
  positional: string[];
}

/** Flags that never take a value, so the next token stays positional. */
export const BOOLEAN_FLAGS = new Set([
  'help',
  'h',
  'version',
  'v',
  'no-registration',
  'registration-closed',
  'lan-only',
  'open',
  'install-service',
  'verbose',
  'quiet',
]);

export function parseArgs(argv: string[]): ParsedArgs {
  const flags = new Map<string, string | boolean>();
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const [rawKey, inlineValue] = arg.slice(2).split('=');
      const key = rawKey.trim();
      if (inlineValue !== undefined) {
        flags.set(key, inlineValue);
        continue;
      }
      const next = argv[i + 1];
      if (!BOOLEAN_FLAGS.has(key) && next !== undefined && !next.startsWith('--')) {
        flags.set(key, next);
        i += 1;
      } else {
        flags.set(key, true);
      }
    } else {
      positional.push(arg);
    }
  }
  return { flags, positional };
}

export function defaultDataDir(): string {
  if (process.env.NEURIO_DATA_DIR) return resolve(process.env.NEURIO_DATA_DIR);
  if (process.platform === 'win32') {
    const base = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming');
    return join(base, 'Neurio');
  }
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Neurio');
  }
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'neurio');
}

function parseIceServers(): IceServerConfig[] {
  // NEURIO_ICE_SERVERS='stun:stun.example.org:3478|turn:turn.example.org:3478|user|pass'
  const raw = process.env.NEURIO_ICE_SERVERS;
  if (!raw) return [];
  const parts = raw.split('|').map((p) => p.trim()).filter(Boolean);
  const servers: IceServerConfig[] = [];
  for (const part of parts) {
    if (part.startsWith('turn:') || part.startsWith('turns:')) {
      continue; // credentials are attached below via the 4-part form
    }
    servers.push({ urls: part });
  }
  const turn = parts.find((p) => p.startsWith('turn') || p.startsWith('turns'));
  const username = process.env.NEURIO_TURN_USERNAME;
  const credential = process.env.NEURIO_TURN_CREDENTIAL;
  if (turn && username && credential) servers.push({ urls: turn, username, credential });
  return servers;
}

export interface ConfigOverrides {
  port?: number;
  host?: string;
  dataDir?: string;
  staticDir?: string | null;
  registrationOpen?: boolean;
  allowWeb?: boolean;
  offlineMode?: boolean;
  maxUploadBytes?: number;
  logLevel?: RuntimeConfig['logLevel'];
  iceServers?: IceServerConfig[];
}

export function buildConfig(overrides: ConfigOverrides = {}): RuntimeConfig {
  const dataDir = isAbsolute(overrides.dataDir ?? '') ? overrides.dataDir! : defaultDataDir();
  return {
    serverName: process.env.NEURIO_SERVER_NAME ?? SERVER_NAME,
    version: SERVER_VERSION,
    host: overrides.host ?? DEFAULT_HOST,
    port: overrides.port ?? DEFAULT_PORT,
    dataDir,
    dbFile: join(dataDir, 'neurio.sqlite'),
    uploadsDir: join(dataDir, 'uploads'),
    maxUploadBytes: overrides.maxUploadBytes ?? 25 * 1024 * 1024,
    registrationOpen: overrides.registrationOpen ?? true,
    iceServers: overrides.iceServers ?? parseIceServers(),
    offlineMode: overrides.offlineMode ?? true,
    staticDir: overrides.staticDir ?? null,
    allowWeb: overrides.allowWeb ?? true,
    logLevel: overrides.logLevel ?? ((process.env.NEURIO_LOG_LEVEL as RuntimeConfig['logLevel']) ?? 'info'),
    startedAt: Date.now(),
    trustProxy: process.env.NEURIO_TRUST_PROXY === '1',
  };
}

export function configFromArgv(argv: string[], base: ConfigOverrides = {}): RuntimeConfig {
  const { flags } = parseArgs(argv);
  const overrides: ConfigOverrides = { ...base };
  const port = flags.get('port');
  if (typeof port === 'string') overrides.port = Number(port);
  const host = flags.get('host');
  if (typeof host === 'string') overrides.host = host;
  const dataDir = flags.get('data-dir');
  if (typeof dataDir === 'string') overrides.dataDir = resolve(dataDir);
  const staticDir = flags.get('static');
  if (typeof staticDir === 'string') overrides.staticDir = resolve(staticDir);
  if (flags.get('no-registration') === true) overrides.registrationOpen = false;
  if (flags.get('lan-only') === true) overrides.offlineMode = true;
  const logLevel = flags.get('log-level');
  if (typeof logLevel === 'string') overrides.logLevel = logLevel as RuntimeConfig['logLevel'];
  return buildConfig(overrides);
}
