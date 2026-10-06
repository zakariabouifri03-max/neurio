import { cloneProject, validateProject } from './project.js';

const HISTORY_LIMIT = 40;
const VERSION_LIMIT = 12;

export class ProjectStore {
  constructor(project, onChange = () => {}) {
    this.project = validateProject(project);
    this.onChange = onChange;
    this.undoStack = [];
    this.redoStack = [];
  }

  setOnChange(callback) { this.onChange = callback; }

  commit(label, mutator) {
    const before = cloneProject(this.project);
    const draft = cloneProject(this.project);
    const result = mutator(draft);
    if (result === false) return false;
    draft.updatedAt = new Date().toISOString();
    const snapshot = { label, createdAt: draft.updatedAt, tracks: cloneProject({ ...draft, assets: [], analysis: {}, versions: [] }).tracks, settings: { ...draft.settings } };
    draft.versions = [...(draft.versions ?? []), snapshot].slice(-VERSION_LIMIT);
    validateProject(draft);
    this.undoStack.push({ label, project: before });
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    this.project = draft;
    this.onChange(this.project, { type: 'commit', label });
    return result ?? true;
  }

  replace(project, label = 'Open project') {
    this.project = validateProject(cloneProject(project));
    this.undoStack = [];
    this.redoStack = [];
    this.onChange(this.project, { type: 'replace', label });
  }

  undo() {
    const item = this.undoStack.pop();
    if (!item) return false;
    this.redoStack.push({ label: item.label, project: cloneProject(this.project) });
    this.project = item.project;
    this.project.updatedAt = new Date().toISOString();
    this.onChange(this.project, { type: 'undo', label: item.label });
    return item.label;
  }

  redo() {
    const item = this.redoStack.pop();
    if (!item) return false;
    this.undoStack.push({ label: item.label, project: cloneProject(this.project) });
    this.project = item.project;
    this.project.updatedAt = new Date().toISOString();
    this.onChange(this.project, { type: 'redo', label: item.label });
    return item.label;
  }

  canUndo() { return this.undoStack.length > 0; }
  canRedo() { return this.redoStack.length > 0; }
}
