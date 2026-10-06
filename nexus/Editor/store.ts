// ============================================================================
// NEXUS EDITOR — Project store
// Central editor state: open project, active scene, selection, undo/redo,
// console & problems, server persistence, snapshots.
// ============================================================================
import {
  ProjectData, SceneData, GameObjectData, cloneData, findObject,
} from '@engine/core/types';
import { editorBus } from '@engine/core/events';

export interface ConsoleLine { level: 'info' | 'warning' | 'error'; message: string; source?: string; time: number; }
export interface ProblemItem { id: string; scriptId?: string; scriptName?: string; file: string; line: number; message: string; severity: 'error' | 'warning'; }

const SERVER = '';

export class EditorStore {
  project: ProjectData | null = null;
  sceneId: string | null = null;
  selection: string[] = [];
  playing = false;
  paused = false;
  dirty = false;
  undoStack: { label: string; snapshot: any }[] = [];
  redoStack: { label: string; snapshot: any }[] = [];
  consoleLines: ConsoleLine[] = [];
  problems: ProblemItem[] = [];
  aiMode: 'offline' | 'llm' = 'offline';
  llmConfigured = false;
  lastSavedAt: number | null = null;

  get scene(): SceneData | null {
    if (!this.project) return null;
    return this.project.scenes.find(s => s.id === this.sceneId) ?? this.project.scenes[0] ?? null;
  }

  setProject(project: ProjectData | null) {
    this.project = project;
    this.sceneId = project?.settings.entrySceneId ?? project?.scenes[0]?.id ?? null;
    this.selection = [];
    this.undoStack = [];
    this.redoStack = [];
    this.consoleLines = [];
    this.problems = [];
    this.dirty = false;
    this.playing = false;
    editorBus.emit('sceneSwitched', { sceneId: this.sceneId ?? '' });
    editorBus.emit('assetsChanged', undefined as any);
  }

  select(ids: string[]) {
    this.selection = ids;
    editorBus.emit('selectionChanged', { ids });
  }
  get selectedObject(): GameObjectData | null {
    if (!this.scene || !this.selection.length) return null;
    return findObject(this.scene, this.selection[0]);
  }

  // ------------------------------ undo / redo --------------------------------

  pushUndo(label: string) {
    if (!this.project || !this.scene) return;
    // snapshot project metadata + active scene (assets/scripts snapshots too for script edits)
    const snap = {
      scene: cloneData(this.scene),
      scripts: cloneData(this.project.scripts),
      assets: cloneData(this.project.assets.map(a => ({ ...a, data: a.data ? cloneData(a.data) : undefined }))),
      uiDocuments: cloneData(this.project.uiDocuments),
      recipes: cloneData(this.project.recipes),
      variables: cloneData(this.project.variables),
    };
    this.undoStack.push({ label, snapshot: snap });
    if (this.undoStack.length > 60) this.undoStack.shift();
    this.redoStack = [];
  }

  undo(): string | null {
    const entry = this.undoStack.pop();
    if (!entry || !this.project || !this.scene) return null;
    this.redoStack.push({ label: entry.label, snapshot: this.captureNow(entry.label) });
    this.restore(entry.snapshot);
    return entry.label;
  }

  redo(): string | null {
    const entry = this.redoStack.pop();
    if (!entry || !this.project || !this.scene) return null;
    this.undoStack.push({ label: entry.label, snapshot: this.captureNow(entry.label) });
    this.restore(entry.snapshot);
    return entry.label;
  }

  private captureNow(label: string) {
    return {
      label,
      snapshot: {
        scene: cloneData(this.scene!),
        scripts: cloneData(this.project!.scripts),
        assets: cloneData(this.project!.assets),
        uiDocuments: cloneData(this.project!.uiDocuments),
        recipes: cloneData(this.project!.recipes),
        variables: cloneData(this.project!.variables),
      },
    };
  }

  private restore(snap: any) {
    if (!this.project) return;
    const idx = this.project.scenes.findIndex(s => s.id === snap.scene.id);
    if (idx >= 0) this.project.scenes[idx] = snap.scene;
    this.project.scripts = snap.scripts;
    this.project.assets = snap.assets;
    this.project.uiDocuments = snap.uiDocuments;
    this.project.recipes = snap.recipes;
    this.project.variables = snap.variables;
    this.markDirty();
    editorBus.emit('sceneChanged', { sceneId: snap.scene.id, structural: true });
    editorBus.emit('assetsChanged', undefined as any);
    editorBus.emit('selectionChanged', { ids: this.selection.filter(id => findObject(snap.scene, id)) });
  }

  // ------------------------------ dirty / save -------------------------------

  markDirty() {
    this.dirty = true;
    if (this.project) this.project.modifiedAt = new Date().toISOString();
    editorBus.emit('projectChanged', { dirty: true });
  }

  async save(): Promise<boolean> {
    if (!this.project) return false;
    try {
      const res = await fetch(`${SERVER}/api/projects/${this.project.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.project),
      });
      if (!res.ok) throw new Error(await res.text());
      this.dirty = false;
      this.lastSavedAt = Date.now();
      editorBus.emit('projectChanged', { dirty: false });
      this.log('info', `Project saved (${this.project.name}).`);
      return true;
    } catch (e: any) {
      this.log('error', `Save failed: ${e?.message ?? e}`);
      return false;
    }
  }

  // ------------------------------- console -----------------------------------

  log(level: ConsoleLine['level'], message: string, source?: string) {
    this.consoleLines.push({ level, message, source, time: Date.now() });
    if (this.consoleLines.length > 800) this.consoleLines.splice(0, this.consoleLines.length - 800);
    editorBus.emit('console', { level, message, source, time: Date.now() });
  }

  addProblem(p: Omit<ProblemItem, 'id'>) {
    // dedupe by file+line+message
    const dup = this.problems.find(x => x.file === p.file && x.line === p.line && x.message === p.message);
    if (dup) return;
    this.problems.push({ ...p, id: `pr_${Math.random().toString(36).slice(2, 8)}` });
    editorBus.emit('problemsChanged', undefined as any);
  }
  clearProblems() { this.problems = []; editorBus.emit('problemsChanged', undefined as any); }
  removeProblemsFor(scriptId: string) {
    this.problems = this.problems.filter(p => p.scriptId !== scriptId);
    editorBus.emit('problemsChanged', undefined as any);
  }

  // ----------------------------- server helpers ------------------------------

  async listProjects(): Promise<any[]> {
    const res = await fetch(`${SERVER}/api/projects`);
    return res.json();
  }
  async openProject(id: string): Promise<ProjectData | null> {
    const res = await fetch(`${SERVER}/api/projects/${id}`);
    if (!res.ok) { this.log('error', `Failed to open project ${id}`); return null; }
    const p = await res.json();
    this.setProject(p);
    return p;
  }
  async createProject(project: ProjectData): Promise<boolean> {
    try {
      const res = await fetch(`${SERVER}/api/projects`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(project),
      });
      if (!res.ok) throw new Error(await res.text());
      this.setProject(project);
      return true;
    } catch (e: any) { this.log('error', `Create project failed: ${e?.message ?? e}`); return false; }
  }
  async exportProject(): Promise<void> {
    if (!this.project) return;
    const res = await fetch(`${SERVER}/api/projects/${this.project.id}/export`);
    if (!res.ok) return;
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${this.project.name.replace(/\s+/g, '_')}.nexusproj.zip`;
    a.click();
    this.log('info', 'Project exported.');
  }

  async refreshLlmStatus() {
    try {
      const res = await fetch(`${SERVER}/api/ai/status`);
      const j = await res.json();
      this.llmConfigured = !!j.configured;
      this.aiMode = j.configured ? 'llm' : 'offline';
    } catch { this.llmConfigured = false; this.aiMode = 'offline'; }
  }
}

export const store = new EditorStore();
