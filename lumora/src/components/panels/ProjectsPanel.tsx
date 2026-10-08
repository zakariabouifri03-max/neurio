import React, { useEffect, useState } from 'react';
import { bridge } from '@/lib/bridge';
import { useEditor } from '@/state/editorStore';
import { useApp } from '@/state/appStore';
import { Empty } from '@/components/common/ui';
import type { ProjectSummary } from '@/types';

export function ProjectsPanel() {
  const [list, setList] = useState<ProjectSummary[]>([]);
  const openProject = useEditor((s) => s.openProject);
  const save = useEditor((s) => s.save);
  const current = useEditor((s) => s.project);
  const toast = useApp((s) => s.toast);

  const refresh = () => void bridge.projects.list().then(setList).catch(() => setList([]));
  useEffect(refresh, []);

  const act = async (fn: () => Promise<unknown>, message: string) => {
    try {
      await fn();
      refresh();
      toast(message, 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  return (
    <>
      <h3>Projects</h3>
      <button className="btn sm" onClick={() => void save()}>
        Save current project
      </button>
      <button
        className="btn sm"
        onClick={() =>
          void act(async () => {
            const doc = await bridge.projects.importFile();
            if (doc) await useEditor.getState().setProject(doc);
          }, 'Project imported')
        }
      >
        Import .lumora file
      </button>
      {list.map((p) => (
        <div key={p.id} className="card" style={{ padding: 8 }}>
          <div className="row">
            <strong style={{ flex: 1, fontSize: 12 }}>{p.name}</strong>
            {p.id === current?.id ? <span className="pill ok">open</span> : null}
          </div>
          <span className="muted" style={{ fontSize: 11 }}>
            {p.pageCount} page(s) · {new Date(p.updatedAt).toLocaleString()}
          </span>
          <div className="row" style={{ marginTop: 6, flexWrap: 'wrap' }}>
            <button className="btn sm" onClick={() => void openProject(p.id)}>
              Open
            </button>
            <button className="btn sm" onClick={() => void act(() => bridge.projects.duplicate(p.id), 'Project duplicated')}>
              Duplicate
            </button>
            <button
              className="btn sm"
              onClick={() => {
                const name = window.prompt('New name', p.name);
                if (name) void act(() => bridge.projects.rename(p.id, name), 'Project renamed');
              }}
            >
              Rename
            </button>
            <button
              className="btn sm danger"
              onClick={() => {
                if (window.confirm(`Delete "${p.name}"? This cannot be undone.`))
                  void act(() => bridge.projects.remove(p.id), 'Project deleted');
              }}
            >
              Delete
            </button>
          </div>
        </div>
      ))}
      {!list.length ? <Empty text="No saved projects yet." /> : null}
    </>
  );
}
