import React, { useEffect, useState } from 'react';
import { bridge } from '@/lib/bridge';
import { useApp } from '@/state/appStore';
import { useEditor } from '@/state/editorStore';
import { Icon } from '@/components/common/Icons';
import { Empty, Modal } from '@/components/common/ui';
import { BUILT_IN_TEMPLATES, SIZE_PRESETS } from '@/data/templates';
import { previewSvg, svgDataUrl, applyElements } from '@/lib/blueprint';
import { engine } from '@/editor/engine';
import type { ProjectSummary } from '@/types';

export function HomeScreen() {
  const { go, toast, settings, online } = useApp();
  const newProject = useEditor((s) => s.newProject);
  const openProject = useEditor((s) => s.openProject);
  const setLeftTab = useEditor((s) => s.setLeftTab);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [chooser, setChooser] = useState<null | 'blank' | 'template'>(null);

  const refresh = () => void bridge.projects.list().then(setProjects).catch(() => setProjects([]));
  useEffect(refresh, []);

  const startBlank = async (w: number, h: number, label: string) => {
    setChooser(null);
    try {
      await newProject(`${label} design`, w, h);
      toast('New design created', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const startTemplate = async (id: string) => {
    const t = BUILT_IN_TEMPLATES.find((x) => x.id === id)!;
    setChooser(null);
    await newProject(t.name, t.width, t.height, t.background);
    // The editor canvas mounts on the next frame; place elements once it exists.
    window.setTimeout(async () => {
      engine.setBackground(t.background);
      await applyElements(t.elements, { clear: true });
    }, 220);
  };

  const startAI = async () => {
    await newProject('AI design', 1080, 1080, '#0d0d14');
    setLeftTab('ai');
  };

  return (
    <div className="home">
      <div className="row">
        <div className="brand" style={{ fontSize: 18 }}>
          <span className="logo" />
          Lumora Studio
        </div>
        <div className="spacer" />
        <span className={`pill ${online ? 'ok' : 'off'}`}>{online ? 'AI Online' : 'Offline Mode'}</span>
        <button className="btn" onClick={() => go('settings')}>
          <Icon name="settings" size={15} /> Settings
        </button>
      </div>

      <div style={{ marginTop: 26 }}>
        <h1>Welcome back{settings?.firstRunComplete ? '' : ' to Lumora Studio'}</h1>
        <span className="muted">Create your next design — offline-first, AI-assisted.</span>
      </div>

      <div className="hero">
        <button className="cta" onClick={() => setChooser('blank')}>
          <Icon name="plus" />
          <strong>Create Blank Design</strong>
          <span className="muted">Pick a preset or a fully custom size.</span>
        </button>
        <button className="cta" onClick={() => setChooser('template')}>
          <Icon name="templates" />
          <strong>Choose Template</strong>
          <span className="muted">Original starter layouts for every platform.</span>
        </button>
        <button className="cta" onClick={() => void startAI()}>
          <Icon name="ai" />
          <strong>AI Generate</strong>
          <span className="muted">Describe a design and place it on the canvas.</span>
        </button>
        <button
          className="cta"
          onClick={async () => {
            try {
              const doc = await bridge.projects.importFile();
              if (doc) {
                await useEditor.getState().setProject(doc);
                go('editor');
              }
            } catch (err) {
              toast((err as Error).message, 'error');
            }
          }}
        >
          <Icon name="uploads" />
          <strong>Open Project File</strong>
          <span className="muted">Import a .lumora project.</span>
        </button>
      </div>

      <div className="row" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 17 }}>Your projects</h2>
        <div className="spacer" />
        <button className="btn sm" onClick={refresh}>
          Refresh
        </button>
      </div>

      <div className="project-grid">
        {projects.map((p) => (
          <div key={p.id} className="project-card">
            {p.thumbnail ? (
              <img className="thumb" src={p.thumbnail} alt={p.name} onClick={() => void openProject(p.id)} />
            ) : (
              <div className="thumb" onClick={() => void openProject(p.id)} />
            )}
            <div className="meta">
              <strong style={{ fontSize: 13 }}>{p.name}</strong>
              <span className="muted" style={{ fontSize: 11 }}>
                {p.width}×{p.height} · {p.pageCount} page(s)
              </span>
              <div className="row" style={{ marginTop: 6, flexWrap: 'wrap' }}>
                <button className="btn sm" onClick={() => void openProject(p.id)}>
                  Open
                </button>
                <button
                  className="btn sm"
                  onClick={async () => {
                    await bridge.projects.duplicate(p.id);
                    refresh();
                  }}
                >
                  Duplicate
                </button>
                <button
                  className="btn sm danger"
                  onClick={async () => {
                    if (!window.confirm(`Delete "${p.name}"?`)) return;
                    await bridge.projects.remove(p.id);
                    refresh();
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
      {!projects.length ? <Empty text="No projects yet — create your first design above." /> : null}

      {chooser === 'blank' ? (
        <Modal title="Create a blank design" onClose={() => setChooser(null)}>
          <div className="grid-2">
            {SIZE_PRESETS.map((p) => (
              <button key={p.label} className="btn" onClick={() => void startBlank(p.width, p.height, p.label)}>
                {p.label}
                <span className="muted">
                  {p.width}×{p.height}
                </span>
              </button>
            ))}
          </div>
          <CustomSize onCreate={(w, h) => void startBlank(w, h, 'Custom')} />
        </Modal>
      ) : null}

      {chooser === 'template' ? (
        <Modal title="Choose a template" width={900} onClose={() => setChooser(null)}>
          <div className="grid-3">
            {BUILT_IN_TEMPLATES.map((t) => (
              <div key={t.id} className="template-card" onClick={() => void startTemplate(t.id)}>
                <img className="thumb" alt={t.name} src={svgDataUrl(previewSvg(t.width, t.height, t.background, t.elements))} />
                <div className="meta">
                  <span>{t.name}</span>
                  <span className="muted">{t.category}</span>
                </div>
              </div>
            ))}
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function CustomSize({ onCreate }: { onCreate: (w: number, h: number) => void }) {
  const [w, setW] = useState(1200);
  const [h, setH] = useState(1200);
  return (
    <div className="row" style={{ marginTop: 10 }}>
      <input className="input" type="number" value={w} onChange={(e) => setW(parseInt(e.target.value, 10) || 0)} />
      <span className="muted">×</span>
      <input className="input" type="number" value={h} onChange={(e) => setH(parseInt(e.target.value, 10) || 0)} />
      <button className="btn primary" disabled={w < 16 || h < 16 || w > 12000 || h > 12000} onClick={() => onCreate(w, h)}>
        Create custom size
      </button>
    </div>
  );
}
