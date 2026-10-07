/**
 * Where Prism Studio keeps its data.
 *
 * The SQLite file and uploaded media must live **outside** the repository:
 * hosts and sandboxes routinely recreate a checkout (or refuse to persist
 * ignored files), which would silently wipe every design and upload. The
 * default is therefore a per-user data directory, overridable with
 * `PRISM_DATA_DIR`, `DATABASE_URL` / `DATABASE_FILE` or `STORAGE_LOCAL_DIR`.
 *
 * Plain `.mjs` so the Next runtime, the migrate script and the seeder all
 * resolve the exact same path.
 */
import path from 'node:path';
import os from 'node:os';

/** Directory holding the database and local uploads. */
export function dataDir() {
  const configured = process.env.PRISM_DATA_DIR?.trim();
  const base = configured && configured.length ? configured : path.join(os.homedir(), '.prism-studio');
  return path.isAbsolute(base) ? base : path.resolve(process.cwd(), base);
}

/** Absolute path of the SQLite database file. */
export function databasePath() {
  const url = process.env.DATABASE_URL ?? process.env.DATABASE_FILE ?? '';
  if (url.startsWith('file:')) {
    const rel = url.slice(5);
    return path.isAbsolute(rel) ? rel : path.resolve(process.cwd(), rel);
  }
  if (url && !url.includes('://')) {
    return path.isAbsolute(url) ? url : path.resolve(process.cwd(), url);
  }
  // Non-SQLite URLs are handled by the driver layer; the local default applies otherwise.
  return path.join(dataDir(), 'prism.db');
}

/** Absolute path of the local upload root (used by the `local` storage driver). */
export function uploadsPath() {
  const configured = process.env.STORAGE_LOCAL_DIR?.trim();
  if (configured && configured.length) {
    return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
  }
  return path.join(dataDir(), 'uploads');
}
