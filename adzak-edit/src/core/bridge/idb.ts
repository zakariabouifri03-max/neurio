/**
 * Tiny IndexedDB wrapper used by the browser bridge for project storage.
 *
 * Only what the app needs: put/get/delete/list of string and blob records.
 * The desktop build uses SQLite instead, so this stays small on purpose.
 */

const DB_NAME = 'adzak-edit';
const DB_VERSION = 1;
const STORE_PROJECTS = 'projects';
const STORE_BLOBS = 'blobs';

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('This browser has no IndexedDB, so projects cannot be saved locally.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_BLOBS)) {
        db.createObjectStore(STORE_BLOBS);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB could not be opened.'));
  });
  return dbPromise;
}

export interface StoredProject {
  id: string;
  name: string;
  path: string;
  content: string;
  updatedAt: number;
  thumbnail?: string;
}

export async function saveProject(record: StoredProject): Promise<void> {
  const db = await open();
  await tx(db, STORE_PROJECTS, 'readwrite', (store) => store.put(record));
}

export async function loadProject(id: string): Promise<StoredProject | undefined> {
  const db = await open();
  return tx<StoredProject | undefined>(db, STORE_PROJECTS, 'readonly', (store) => store.get(id));
}

export async function listProjects(): Promise<StoredProject[]> {
  const db = await open();
  const all = await tx<StoredProject[]>(db, STORE_PROJECTS, 'readonly', (store) => store.getAll());
  return (all ?? []).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteProject(id: string): Promise<void> {
  const db = await open();
  await tx(db, STORE_PROJECTS, 'readwrite', (store) => store.delete(id));
}

export async function putBlob(key: string, blob: Blob): Promise<void> {
  const db = await open();
  await tx(db, STORE_BLOBS, 'readwrite', (store) => store.put(blob, key));
}

export async function getBlob(key: string): Promise<Blob | undefined> {
  const db = await open();
  return tx<Blob | undefined>(db, STORE_BLOBS, 'readonly', (store) => store.get(key));
}

function tx<T>(
  db: IDBDatabase,
  storeName: string,
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const request = work(transaction.objectStore(storeName));
    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}
