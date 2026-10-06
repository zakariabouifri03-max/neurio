// ── Filebox — storage layer ─────────────────────────────────────────────────
// IndexedDB holds metadata + small files. Large blobs go to OPFS when the
// browser has it (much faster, and it keeps IndexedDB small).

const DB_NAME = 'filebox';
const DB_VERSION = 1;

let dbp = null;
function db() {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, DB_VERSION);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('files')) {
          const s = d.createObjectStore('files', { keyPath: 'id' });
          s.createIndex('fp', 'fp');
          s.createIndex('kind', 'kind');
          s.createIndex('addedAt', 'addedAt');
        }
        if (!d.objectStoreNames.contains('vaults')) d.createObjectStore('vaults', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'k' });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  return dbp;
}

function tx(store, mode = 'readonly') {
  return db().then((d) => d.transaction(store, mode).objectStore(store));
}
const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

// ── OPFS blob store ─────────────────────────────────────────────────────────
let opfsRoot = null;
async function opfs() {
  if (opfsRoot === undefined) return null;
  if (opfsRoot) return opfsRoot;
  try {
    if (!navigator.storage?.getDirectory) { opfsRoot = null; return null; }
    opfsRoot = await navigator.storage.getDirectory();
    try { await opfsRoot.getDirectoryHandle('blobs'); } catch {}
    return opfsRoot;
  } catch { opfsRoot = null; return null; }
}

async function writeBlob(id, blob) {
  const root = await opfs();
  if (root) {
    try {
      const dir = await root.getDirectoryHandle('blobs');
      const fh = await dir.getFileHandle(id, { create: true });
      const w = await fh.createWritable();
      await w.write(blob);
      await w.close();
      return { where: 'opfs', size: blob.size };
    } catch { /* fall through to IndexedDB */ }
  }
  await (await tx('files', 'readwrite')).put({ id, __blob: blob });
  return { where: 'idb', size: blob.size };
}

async function readBlob(rec) {
  if (rec.where !== 'opfs') {
    const row = await req(await (await tx('files')).get(rec.id));
    return row?.__blob || null;
  }
  const root = await opfs();
  if (!root) return null;
  try {
    const dir = await root.getDirectoryHandle('blobs');
    const fh = await dir.getFileHandle(rec.id);
    return await fh.getFile();
  } catch { return null; }
}

async function deleteBlob(rec) {
  if (rec.where === 'opfs') {
    const root = await opfs();
    if (root) {
      try {
        const dir = await root.getDirectoryHandle('blobs');
        await dir.removeEntry(rec.id);
        return;
      } catch { /* ignore */ }
    }
  }
  // IndexedDB inline blobs live on the record itself and go with it
}

// ── meta ────────────────────────────────────────────────────────────────────
export async function getMeta(k, fallback = null) {
  const row = await req(await (await tx('meta')).get(k));
  return row ? row.v : fallback;
}
export async function setMeta(k, v) {
  await (await tx('meta', 'readwrite')).put({ k, v });
}

// ── files (inbox) ───────────────────────────────────────────────────────────
export async function listFiles() {
  const all = await req(await (await tx('files')).getAll());
  return all.filter((r) => r.kind !== undefined && r.__blob === undefined ? true : r.name)
    .filter((r) => r.name)
    .sort((a, b) => b.addedAt - a.addedAt);
}

export async function getFile(id) {
  const rec = await req(await (await tx('files')).get(id));
  if (!rec) return null;
  const blob = await readBlob(rec);
  return { ...rec, blob };
}

/**
 * Import a File/Blob. Returns {added:true} or {added:false, duplicate:rec}
 * when the same fingerprint is already stored.
 */
export async function addFile(file, opts = {}) {
  const { uid, fingerprint, kindOf } = await import('./util.js');
  const fp = await fingerprint(file);
  const existing = await req(await (await tx('files')).index('fp').get(fp));
  if (existing && !opts.allowDuplicate) return { added: false, duplicate: existing };

  const id = uid();
  const rec = {
    id,
    name: file.name || 'file',
    relPath: opts.relPath || file.webkitRelativePath || '',
    size: file.size,
    type: file.type || '',
    kind: kindOf(file.name),
    fp,
    addedAt: Date.now(),
    lastModified: file.lastModified || Date.now(),
    thumb: null,
  };
  const stored = await writeBlob(id, file);
  rec.where = stored.where;
  if (rec.kind === 'image' && file.size < 25 * 1024 * 1024) rec.thumb = await makeThumb(file);
  await (await tx('files', 'readwrite')).put(rec);
  return { added: true, rec };
}

async function makeThumb(file) {
  try {
    const bmp = await createImageBitmap(file);
    const s = 256;
    const scale = Math.min(s / bmp.width, s / bmp.height, 1);
    const c = new OffscreenCanvas(Math.max(1, bmp.width * scale), Math.max(1, bmp.height * scale));
    const g = c.getContext('2d');
    g.drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await c.convertToBlob({ type: 'image/webp', quality: 0.7 });
    if (blob.size > 60000) return null;
    return await blobToDataUrl(blob);
  } catch { return null; }
}
function blobToDataUrl(blob) {
  return new Promise((res) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = () => res(null);
    fr.readAsDataURL(blob);
  });
}

export async function deleteFiles(ids) {
  const s = await tx('files', 'readwrite');
  for (const id of ids) {
    const rec = await req(await (await tx('files')).get(id));
    if (rec) await deleteBlob(rec);
    s.delete(id);
  }
}

// ── vaults ──────────────────────────────────────────────────────────────────
export async function listVaults() {
  return (await req(await (await tx('vaults')).getAll())).sort((a, b) => b.createdAt - a.createdAt);
}

export async function saveVault(meta, blob) {
  const stored = await writeBlob(meta.id, blob);
  const rec = { ...meta, where: stored.where, size: blob.size, createdAt: Date.now() };
  await (await tx('vaults', 'readwrite')).put(rec);
  return rec;
}

export async function getVault(id) {
  const rec = await req(await (await tx('vaults')).get(id));
  if (!rec) return null;
  const blob = await readBlob(rec);
  return { ...rec, blob };
}

export async function deleteVault(id) {
  const rec = await req(await (await tx('vaults')).get(id));
  if (rec) {
    await deleteBlob({ id, where: rec.where });
    // vault blobs share the OPFS 'blobs' dir with files; also clear any idb copy
    try { (await tx('files', 'readwrite')).delete(id); } catch {}
  }
  (await tx('vaults', 'readwrite')).delete(id);
}

// ── quota / usage ───────────────────────────────────────────────────────────
export async function usage() {
  try {
    const e = await navigator.storage.estimate();
    return { usage: e.usage || 0, quota: e.quota || 0 };
  } catch { return { usage: 0, quota: 0 }; }
}

export async function isPersistent() {
  try { return !!(navigator.storage?.persisted && await navigator.storage.persisted()); }
  catch { return false; }
}
export async function requestPersistent() {
  try { return !!(navigator.storage?.persist && await navigator.storage.persist()); }
  catch { return false; }
}

// ── wipe ────────────────────────────────────────────────────────────────────
export async function wipeAll() {
  const d = await db();
  await Promise.all([...d.objectStoreNames].map((n) =>
    new Promise((res) => { const t = d.transaction(n, 'readwrite').objectStore(n).clear(); t.onsuccess = res; t.onerror = res; })));
  const root = await opfs();
  if (root) { try { await root.removeEntry('blobs', { recursive: true }); } catch {} }
}

export { writeBlob, readBlob };
