/**
 * IndexedDB persistence: projects, project folders, media metadata, media blobs,
 * user presets, favorites and recents. Autosave writes the open project every few seconds.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { MediaAsset, Project, ProjectFolder } from '@/core/types';

interface NeurioDB extends DBSchema {
  projects: { key: string; value: Project; indexes: { updatedAt: number } };
  folders: { key: string; value: ProjectFolder };
  media: { key: string; value: MediaAsset };
  blobs: { key: string; value: { id: string; blob: Blob } };
  kv: { key: string; value: { key: string; value: any } };
  recovery: { key: string; value: { id: string; project: Project; savedAt: number } };
}

let dbp: Promise<IDBPDatabase<NeurioDB>> | null = null;

export function db() {
  if (!dbp) {
    dbp = openDB<NeurioDB>('neurio-studio', 2, {
      upgrade(d, oldVersion) {
        if (oldVersion < 1) {
          const p = d.createObjectStore('projects', { keyPath: 'id' });
          p.createIndex('updatedAt', 'updatedAt');
          d.createObjectStore('folders', { keyPath: 'id' });
          d.createObjectStore('media', { keyPath: 'id' });
          d.createObjectStore('blobs', { keyPath: 'id' });
          d.createObjectStore('kv', { keyPath: 'key' });
        }
        if (oldVersion < 2) d.createObjectStore('recovery', { keyPath: 'id' });
      },
    });
  }
  return dbp;
}

export const Projects = {
  async all(): Promise<Project[]> {
    const all = await (await db()).getAll('projects');
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  },
  get: async (id: string) => (await db()).get('projects', id),
  put: async (p: Project) => (await db()).put('projects', p),
  delete: async (id: string) => {
    const d = await db();
    await d.delete('projects', id);
    await d.delete('recovery', id).catch(() => {});
  },
};

export const Folders = {
  all: async () => (await db()).getAll('folders'),
  put: async (f: ProjectFolder) => (await db()).put('folders', f),
  delete: async (id: string) => (await db()).delete('folders', id),
};

export const Media = {
  all: async () => (await db()).getAll('media'),
  get: async (id: string) => (await db()).get('media', id),
  put: async (m: MediaAsset) => (await db()).put('media', m),
  delete: async (id: string) => {
    const d = await db();
    await d.delete('media', id);
    await d.delete('blobs', id);
  },
  putBlob: async (id: string, blob: Blob) => (await db()).put('blobs', { id, blob }),
  getBlob: async (id: string) => (await (await db()).get('blobs', id))?.blob,
};

export const KV = {
  get: async <T>(key: string, fallback: T): Promise<T> => ((await (await db()).get('kv', key))?.value as T) ?? fallback,
  set: async (key: string, value: any) => (await db()).put('kv', { key, value }),
};

export const Recovery = {
  put: async (p: Project) => (await db()).put('recovery', { id: p.id, project: p, savedAt: Date.now() }),
  get: async (id: string) => (await db()).get('recovery', id),
  all: async () => (await db()).getAll('recovery'),
  delete: async (id: string) => (await db()).delete('recovery', id),
};

export async function storageEstimate(): Promise<{ used: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null;
  const e = await navigator.storage.estimate();
  return { used: e.usage || 0, quota: e.quota || 0 };
}
