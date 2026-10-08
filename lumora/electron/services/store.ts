import { app, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Lightweight, crash-safe JSON document store.
 *
 * Why not SQLite: the editor's workload is "a few hundred whole-document
 * reads/writes", not relational querying. A transactional JSON store avoids a
 * native module (better-sqlite3) that must be rebuilt per Electron ABI, which
 * is the #1 source of broken Windows packaging. Writes are atomic
 * (write temp -> fsync -> rename), so projects survive power loss.
 */

export function dataDir(): string {
  const dir = path.join(app.getPath('userData'), 'data');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function projectsDir(): string {
  const dir = path.join(dataDir(), 'projects');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function assetsDir(): string {
  const dir = path.join(dataDir(), 'assets');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function templatesDir(): string {
  const dir = path.join(dataDir(), 'templates');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function atomicWrite(file: string, contents: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeFileSync(fd, contents, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

export function readJSON<T>(file: string, fallback: T): T {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

export function writeJSON(file: string, value: unknown): void {
  atomicWrite(file, JSON.stringify(value, null, 2));
}

/* ---------------- secrets ---------------- */

const secretsFile = () => path.join(dataDir(), 'secrets.bin');

type SecretBag = Record<string, string>;

function loadSecrets(): SecretBag {
  try {
    if (!fs.existsSync(secretsFile())) return {};
    const raw = fs.readFileSync(secretsFile());
    const json = safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(raw)
      : Buffer.from(raw.toString('utf8'), 'base64').toString('utf8');
    return JSON.parse(json) as SecretBag;
  } catch {
    return {};
  }
}

function persistSecrets(bag: SecretBag): void {
  const json = JSON.stringify(bag);
  const payload = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(json)
    : Buffer.from(Buffer.from(json, 'utf8').toString('base64'), 'utf8');
  fs.mkdirSync(path.dirname(secretsFile()), { recursive: true });
  fs.writeFileSync(secretsFile(), payload);
}

/** Secrets never leave the main process; the renderer only sees booleans. */
export const secrets = {
  get(key: string): string | undefined {
    return loadSecrets()[key];
  },
  set(key: string, value: string): void {
    const bag = loadSecrets();
    if (value) bag[key] = value;
    else delete bag[key];
    persistSecrets(bag);
  },
  presence(): Record<string, boolean> {
    const bag = loadSecrets();
    return Object.fromEntries(Object.keys(bag).map((k) => [k, Boolean(bag[k])]));
  }
};
