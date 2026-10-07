const DB_NAME = 'neurio-studio-v1';
const DB_VERSION = 1;
let dbPromise;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) { reject(new Error('IndexedDB is not available')); return; }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open local project storage'));
  });
  return dbPromise;
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Local storage request failed'));
  });
}

async function readStore(storeName, mode, action) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let result;
    try { result = action(store); } catch (error) { reject(error); return; }
    if (result && typeof result.onsuccess !== 'undefined') {
      result.onsuccess = () => resolve(result.result);
      result.onerror = () => reject(result.error || new Error('Local storage request failed'));
    } else {
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error || new Error('Local storage transaction failed'));
      tx.onabort = () => reject(tx.error || new Error('Local storage transaction aborted'));
    }
  });
}

export async function saveProject(record) {
  try { await readStore('projects', 'readwrite', store => store.put(record)); }
  catch (error) {
    // Keep a useful recovery copy of project structure even if IndexedDB is unavailable.
    try { localStorage.setItem(`neurio-project-${record.id}`, JSON.stringify({ ...record, assets: undefined })); }
    catch { throw error; }
  }
}

export async function getProject(id) {
  try { return await requestResult((await openDb()).transaction('projects', 'readonly').objectStore('projects').get(id)); }
  catch {
    try { const raw = localStorage.getItem(`neurio-project-${id}`); return raw ? JSON.parse(raw) : null; }
    catch { return null; }
  }
}

export async function getProjects() {
  try { return await requestResult((await openDb()).transaction('projects', 'readonly').objectStore('projects').getAll()); }
  catch {
    const fallback = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key?.startsWith('neurio-project-')) continue;
        const record = JSON.parse(localStorage.getItem(key));
        if (record?.id && record?.state) fallback.push(record);
      }
    } catch { /* storage can be disabled */ }
    return fallback;
  }
}

export async function saveAsset(record) {
  return readStore('assets', 'readwrite', store => store.put(record));
}

export async function getAsset(id) {
  try { return await requestResult((await openDb()).transaction('assets', 'readonly').objectStore('assets').get(id)); }
  catch { return null; }
}

export async function getAssets() {
  try { return await requestResult((await openDb()).transaction('assets', 'readonly').objectStore('assets').getAll()); }
  catch { return []; }
}

export async function deleteProject(id) {
  try { await readStore('projects', 'readwrite', store => store.delete(id)); } catch { /* optional cleanup */ }
  try { localStorage.removeItem(`neurio-project-${id}`); } catch { /* optional cleanup */ }
}

export function makeId(prefix = 'id') {
  return `${prefix}-${crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;
}
