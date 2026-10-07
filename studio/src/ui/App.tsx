import { useEffect, useState } from 'react';
import { useUI } from '@/core/uiStore';
import { Home } from './home/Home';
import { EditorShell } from './editor/EditorShell';
import { Toasts } from './common';
import { loadMediaLibrary, restoreFonts } from '@/engine/MediaManager';
import { startAutosave, useProjects } from '@/services/projects';
import { useFavorites, usePresets } from '@/services/favorites';
import { ErrorBoundary } from './ErrorBoundary';

export default function App() {
  const route = useUI((s) => s.route);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    (async () => {
      await Promise.all([loadMediaLibrary(), useProjects.getState().refresh(), useFavorites.getState().load(), usePresets.getState().load()]);
      void restoreFonts();
      startAutosave();
      setReady(true);
    })().catch((e) => {
      console.error(e);
      setReady(true);
    });
  }, []);
  if (!ready)
    return (
      <div className="loading-screen">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="spinner" /> Loading Neurio Studio…
        </div>
      </div>
    );
  return (
    <ErrorBoundary>
      <div className="app">{route.name === 'editor' ? <EditorShell key={route.projectId} /> : <Home />}</div>
      <Toasts />
    </ErrorBoundary>
  );
}
