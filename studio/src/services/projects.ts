/** Project lifecycle: create, open, autosave, recovery, duplicate, import/export. */
import type { Project, ProjectFolder } from '@/core/types';
import { makeProject, SOCIAL_PRESETS } from '@/core/defaults';
import { Projects, Folders, Recovery } from './db';
import { useProject } from '@/core/store';
import { useUI, toast } from '@/core/uiStore';
import { uid, downloadBlob, debounce } from '@/core/util';
import { create } from 'zustand';

interface ProjectsStore {
  list: Project[];
  folders: ProjectFolder[];
  loaded: boolean;
  refresh: () => Promise<void>;
}
export const useProjects = create<ProjectsStore>((set) => ({
  list: [],
  folders: [],
  loaded: false,
  refresh: async () => {
    const [list, folders] = await Promise.all([Projects.all(), Folders.all()]);
    set({ list, folders, loaded: true });
  },
}));

export async function createProject(opts: { name?: string; presetId?: string; width?: number; height?: number; fps?: number } = {}): Promise<Project> {
  const preset = SOCIAL_PRESETS.find((p) => p.id === (opts.presetId || 'tiktok')) || SOCIAL_PRESETS[0];
  const p = makeProject(opts.name || 'Untitled project', { width: opts.width ?? preset.width, height: opts.height ?? preset.height, fps: opts.fps ?? preset.fps, presetId: preset.id });
  await Projects.put(p);
  await useProjects.getState().refresh();
  return p;
}

export async function openProject(id: string): Promise<boolean> {
  const p = await Projects.get(id);
  if (!p) return false;
  // recovery check
  const rec = await Recovery.get(id);
  let proj = migrate(p);
  if (rec && rec.savedAt > p.updatedAt + 2000) {
    if (confirm(`A newer unsaved version of "${p.name}" was recovered (from ${new Date(rec.savedAt).toLocaleTimeString()}). Restore it?`)) proj = migrate(rec.project);
  }
  useProject.getState().load(proj);
  useUI.getState().navigate({ name: 'editor', projectId: id });
  return true;
}

function migrate(p: Project): Project {
  // forward-compatible: fill missing fields from defaults
  const base = makeProject(p.name);
  return { ...base, ...p, settings: { ...base.settings, ...p.settings }, markers: p.markers || [], mediaIds: p.mediaIds || [], tracks: p.tracks.map((t) => ({ ...t, clips: t.clips || [] })) };
}

export async function saveCurrent(): Promise<void> {
  const { project, dirty } = useProject.getState();
  if (!project) return;
  await Projects.put(project);
  await Recovery.delete(project.id).catch(() => {});
  if (dirty) useProject.getState().markSaved();
  void useProjects.getState().refresh();
}

const recoverySave = debounce(async () => {
  const { project } = useProject.getState();
  if (project) await Recovery.put(project).catch(() => {});
}, 1500);

const autosave = debounce(() => void saveCurrent(), 4000);

/** Subscribe once: writes a recovery snapshot ~1.5s after each change and autosaves after 4s of inactivity. */
export function startAutosave() {
  let last: Project | null = null;
  useProject.subscribe((s) => {
    if (s.project && s.project !== last && s.dirty) {
      last = s.project;
      recoverySave();
      autosave();
    }
  });
  window.addEventListener('beforeunload', () => {
    const { project, dirty } = useProject.getState();
    if (project && dirty) void Projects.put(project);
  });
}

export async function deleteProject(id: string) {
  await Projects.delete(id);
  await useProjects.getState().refresh();
}

export async function duplicateProject(id: string): Promise<Project | null> {
  const p = await Projects.get(id);
  if (!p) return null;
  const copy: Project = { ...structuredClone(p), id: uid('prj'), name: `${p.name} (copy)`, createdAt: Date.now(), updatedAt: Date.now() };
  await Projects.put(copy);
  await useProjects.getState().refresh();
  return copy;
}

export async function renameProject(id: string, name: string) {
  const p = await Projects.get(id);
  if (!p) return;
  await Projects.put({ ...p, name, updatedAt: Date.now() });
  const cur = useProject.getState().project;
  if (cur?.id === id) useProject.getState().rename(name);
  await useProjects.getState().refresh();
}

export async function moveProjectToFolder(id: string, folderId: string | null) {
  const p = await Projects.get(id);
  if (!p) return;
  await Projects.put({ ...p, folderId });
  await useProjects.getState().refresh();
}

export async function createFolder(name: string) {
  await Folders.put({ id: uid('fld'), name, createdAt: Date.now() });
  await useProjects.getState().refresh();
}
export async function deleteFolder(id: string) {
  await Folders.delete(id);
  for (const p of useProjects.getState().list) if (p.folderId === id) await Projects.put({ ...p, folderId: null });
  await useProjects.getState().refresh();
}

/** Export a project as a portable JSON file (media is referenced by id; include media blobs optionally). */
export async function exportProjectFile(p: Project, includeMedia: boolean) {
  const { Media } = await import('./db');
  const media: any[] = [];
  if (includeMedia) {
    const ids = new Set<string>();
    for (const t of p.tracks) for (const c of t.clips) if ('mediaId' in c && c.mediaId) ids.add(c.mediaId as string);
    for (const id of ids) {
      const m = await Media.get(id);
      const b = await Media.getBlob(id);
      if (m && b) media.push({ meta: m, data: await blobToBase64(b) });
    }
  }
  const json = JSON.stringify({ format: 'neurio-project', version: 1, project: p, media }, null, 0);
  downloadBlob(new Blob([json], { type: 'application/json' }), `${p.name.replace(/[^\w\- ]+/g, '')}.neurio.json`);
}

export async function importProjectFile(file: File): Promise<Project | null> {
  const { Media } = await import('./db');
  const { loadMediaLibrary } = await import('@/engine/MediaManager');
  try {
    const data = JSON.parse(await file.text());
    if (data.format !== 'neurio-project') throw new Error('Not a Neurio project file');
    for (const m of data.media || []) {
      const blob = base64ToBlob(m.data, m.meta.mime);
      await Media.putBlob(m.meta.id, blob);
      await Media.put(m.meta);
    }
    await loadMediaLibrary();
    const p: Project = { ...migrate(data.project), id: uid('prj'), updatedAt: Date.now() };
    await Projects.put(p);
    await useProjects.getState().refresh();
    toast('Project imported', 'success', p.name);
    return p;
  } catch (e: any) {
    toast('Import failed', 'error', e.message);
    return null;
  }
}

function blobToBase64(b: Blob): Promise<string> {
  return new Promise((res) => {
    const r = new FileReader();
    r.onload = () => res((r.result as string).split(',')[1]);
    r.readAsDataURL(b);
  });
}
function base64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
