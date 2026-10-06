import { createProject, validateProject } from './project.js';

const PROJECT_KEY = 'nexus-video-studio:last-project:v1';
const DB_NAME = 'nexus-video-studio-local';
const DB_VERSION = 1;
const ASSET_STORE = 'media-assets';

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error('IndexedDB is not available in this browser.'));
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ASSET_STORE)) db.createObjectStore(ASSET_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open the local media cache.'));
  });
}

async function withAssetStore(mode, run) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ASSET_STORE, mode);
    const store = tx.objectStore(ASSET_STORE);
    let result;
    try { result = run(store); } catch (error) { reject(error); db.close(); return; }
    tx.oncomplete = () => { db.close(); resolve(result?.result); };
    tx.onerror = () => { db.close(); reject(tx.error ?? new Error('Local media storage failed.')); };
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error('Local media storage was interrupted.')); };
  });
}

export async function cacheMediaBlob(key, blob) {
  try {
    await withAssetStore('readwrite', (store) => store.put(blob, key));
    return true;
  } catch (error) {
    console.warn('Could not cache the imported media. The current editing session still has access to it.', error);
    return false;
  }
}

export async function getCachedMediaBlob(key) {
  try { return await withAssetStore('readonly', (store) => store.get(key)); }
  catch { return null; }
}

export async function removeCachedMediaBlob(key) {
  if (!key) return;
  try { await withAssetStore('readwrite', (store) => store.delete(key)); }
  catch (error) { console.warn('Could not remove replaced media from the local cache.', error); }
}

export async function saveLastProject(project) {
  try {
    localStorage.setItem(PROJECT_KEY, JSON.stringify(project));
    return true;
  } catch (error) {
    console.warn('Could not autosave project metadata locally.', error);
    return false;
  }
}

export function loadLastProject() {
  try {
    const raw = localStorage.getItem(PROJECT_KEY);
    if (!raw) return null;
    return validateProject(JSON.parse(raw));
  } catch (error) {
    console.warn('Saved local project could not be restored.', error);
    return null;
  }
}

export async function restoreCachedAssetUrls(project) {
  const urls = new Map();
  for (const asset of project.assets) {
    if (!asset.storageKey) continue;
    const blob = await getCachedMediaBlob(asset.storageKey);
    if (blob) urls.set(asset.id, URL.createObjectURL(blob));
    else asset.missing = true;
  }
  return urls;
}

export function downloadProjectFile(project) {
  const filename = `${safeName(project.name)}.nexusvideo`;
  const file = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(file);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 2500);
}

export async function readProjectFromBrowserFile(file) {
  const raw = await file.text();
  try { return validateProject(JSON.parse(raw)); }
  catch (error) { throw new Error(`Could not open project: ${error.message}`); }
}

export function createNewProject(name) {
  return createProject(name?.trim() || 'Untitled Project');
}

export function safeName(name) {
  return String(name || 'Nexus Project').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'Nexus Project';
}
