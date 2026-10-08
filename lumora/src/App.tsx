import React, { useEffect, useState } from 'react';
import { useApp } from '@/state/appStore';
import { useEditor } from '@/state/editorStore';
import { HomeScreen } from '@/screens/HomeScreen';
import { SettingsScreen } from '@/screens/SettingsScreen';
import { EditorScreen } from '@/components/editor/EditorScreen';
import { Modal } from '@/components/common/ui';
import { installShortcuts } from '@/lib/shortcuts';
import { bridge } from '@/lib/bridge';
import { engine } from '@/editor/engine';
import { seedSampleProjects } from '@/lib/seed';
import { SIZE_PRESETS } from '@/data/templates';
import '@/styles/global.css';

export default function App() {
  const project = useEditor((s) => s.project);
  const { route, ready, init, settings, toasts, dismiss, go, updateSettings, toast } = useApp();
  const [welcome, setWelcome] = useState(false);

  useEffect(() => {
    void (async () => {
      await init();
      const s = useApp.getState().settings;
      if (s && !s.firstRunComplete) {
        try {
          await seedSampleProjects();
        } catch {
          /* seeding is best-effort */
        }
        setWelcome(true);
      }
    })();
  }, [init]);

  useEffect(() => installShortcuts(), []);

  // Native menu commands (File ▸ Save, Edit ▸ Undo, …).
  useEffect(() => {
    return bridge.on('menu:action', (action: string) => {
      const editor = useEditor.getState();
      const actions: Record<string, () => void> = {
        new: () => go('home'),
        open: () => go('home'),
        save: () => void editor.save(),
        export: () => editor.setExport(true),
        preview: () => editor.setPreview(true),
        settings: () => go('settings'),
        undo: () => void engine.undo(),
        redo: () => void engine.redo(),
        duplicate: () => void engine.duplicateSelection(),
        selectAll: () => void engine.selectAll(),
        zoomIn: () => engine.zoomBy(1.15),
        zoomOut: () => engine.zoomBy(1 / 1.15),
        about: () => go('settings')
      };
      actions[action]?.();
    });
  }, [go]);

  useEffect(() => {
    if (settings) {
      document.documentElement.dataset.theme = settings.theme;
      document.documentElement.style.setProperty('--accent', settings.accent);
    }
  }, [settings?.theme, settings?.accent]);

  // Warn before closing with unsaved work.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (useEditor.getState().dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  if (!ready) {
    return (
      <div className="app" style={{ display: 'grid', placeItems: 'center' }}>
        <div className="brand" style={{ fontSize: 20 }}>
          <span className="logo" /> Lumora Studio
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      {route === 'home' ? <HomeScreen /> : null}
      {route === 'settings' ? <SettingsScreen /> : null}
      {route === 'editor' && project ? <EditorScreen /> : null}
      {route === 'editor' && !project ? <HomeScreen /> : null}

      {welcome ? (
        <Modal
          title="Welcome to Lumora Studio"
          onClose={() => {
            setWelcome(false);
            void updateSettings({ firstRunComplete: true });
          }}
        >
          <p style={{ margin: 0 }}>
            Create your first design. Everything in the editor — canvas, text, shapes, layers, projects and export — works
            fully offline. Add an API key later to unlock cloud AI.
          </p>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button
              className="btn primary"
              onClick={async () => {
                setWelcome(false);
                await updateSettings({ firstRunComplete: true });
                const p = SIZE_PRESETS[0];
                await useEditor.getState().newProject('My first design', p.width, p.height);
              }}
            >
              Create Blank Design
            </button>
            <button
              className="btn"
              onClick={async () => {
                setWelcome(false);
                await updateSettings({ firstRunComplete: true });
                go('home');
                toast('Pick a template from "Choose Template".');
              }}
            >
              Choose Template
            </button>
            <button
              className="btn"
              onClick={async () => {
                setWelcome(false);
                await updateSettings({ firstRunComplete: true });
                await useEditor.getState().newProject('AI design', 1080, 1080, '#0d0d14');
                useEditor.getState().setLeftTab('ai');
              }}
            >
              AI Generate
            </button>
          </div>
          <span className="muted">Five original demo projects have been added so you can explore straight away.</span>
        </Modal>
      ) : null}

      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismiss(t.id)}>
            {t.message}
          </div>
        ))}
      </div>
    </div>
  );
}
