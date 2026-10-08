import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { projectsDir, readJSON, writeJSON, templatesDir } from './store';
import type { ProjectDoc, ProjectSummary } from '../shared/types';

const id = () => crypto.randomUUID();

function fileFor(projectId: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(projectId)) throw new Error('Invalid project id');
  return path.join(projectsDir(), `${projectId}.lumora.json`);
}

function summarize(p: ProjectDoc): ProjectSummary {
  const first = p.pages[0];
  return {
    id: p.id,
    name: p.name,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    pageCount: p.pages.length,
    width: first?.width ?? 0,
    height: first?.height ?? 0,
    thumbnail: first?.thumbnail ?? null
  };
}

export const projects = {
  list(): ProjectSummary[] {
    const dir = projectsDir();
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.lumora.json'))
      .map((f) => readJSON<ProjectDoc | null>(path.join(dir, f), null))
      .filter((p): p is ProjectDoc => Boolean(p && p.id))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(summarize);
  },

  get(projectId: string): ProjectDoc | null {
    return readJSON<ProjectDoc | null>(fileFor(projectId), null);
  },

  save(doc: ProjectDoc): ProjectSummary {
    if (!doc?.id) throw new Error('Project is missing an id');
    const next: ProjectDoc = { ...doc, updatedAt: Date.now(), format: 'lumora/project@1' };
    writeJSON(fileFor(next.id), next);
    return summarize(next);
  },

  create(doc: Omit<ProjectDoc, 'id' | 'createdAt' | 'updatedAt' | 'format'>): ProjectDoc {
    const now = Date.now();
    const next: ProjectDoc = { ...doc, id: id(), createdAt: now, updatedAt: now, format: 'lumora/project@1' };
    writeJSON(fileFor(next.id), next);
    return next;
  },

  duplicate(projectId: string): ProjectDoc {
    const src = projects.get(projectId);
    if (!src) throw new Error('Project not found');
    const now = Date.now();
    const copy: ProjectDoc = {
      ...src,
      id: id(),
      name: `${src.name} (copy)`,
      createdAt: now,
      updatedAt: now,
      pages: src.pages.map((pg) => ({ ...pg, id: id() }))
    };
    writeJSON(fileFor(copy.id), copy);
    return copy;
  },

  rename(projectId: string, name: string): ProjectSummary {
    const doc = projects.get(projectId);
    if (!doc) throw new Error('Project not found');
    doc.name = name.slice(0, 120);
    return projects.save(doc);
  },

  remove(projectId: string): boolean {
    const f = fileFor(projectId);
    if (fs.existsSync(f)) fs.unlinkSync(f);
    return true;
  },

  exportFile(projectId: string, target: string): string {
    const doc = projects.get(projectId);
    if (!doc) throw new Error('Project not found');
    writeJSON(target, doc);
    return target;
  },

  importFile(source: string): ProjectDoc {
    const raw = readJSON<ProjectDoc | null>(source, null);
    if (!raw || !Array.isArray(raw.pages)) throw new Error('Not a valid .lumora project file');
    const now = Date.now();
    const doc: ProjectDoc = { ...raw, id: id(), createdAt: now, updatedAt: now, format: 'lumora/project@1' };
    writeJSON(fileFor(doc.id), doc);
    return doc;
  }
};

/* -------- user (custom) templates -------- */

export interface StoredTemplate {
  id: string;
  name: string;
  category: string;
  width: number;
  height: number;
  background: string | null;
  scene: unknown;
  thumbnail?: string | null;
  custom: true;
  createdAt: number;
}

export const customTemplates = {
  list(): StoredTemplate[] {
    const dir = templatesDir();
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => readJSON<StoredTemplate | null>(path.join(dir, f), null))
      .filter((t): t is StoredTemplate => Boolean(t && t.id))
      .sort((a, b) => b.createdAt - a.createdAt);
  },
  save(t: Omit<StoredTemplate, 'id' | 'custom' | 'createdAt'>): StoredTemplate {
    const next: StoredTemplate = { ...t, id: id(), custom: true, createdAt: Date.now() };
    writeJSON(path.join(templatesDir(), `${next.id}.json`), next);
    return next;
  },
  remove(templateId: string): boolean {
    if (!/^[A-Za-z0-9._-]+$/.test(templateId)) return false;
    const f = path.join(templatesDir(), `${templateId}.json`);
    if (fs.existsSync(f)) fs.unlinkSync(f);
    return true;
  }
};
