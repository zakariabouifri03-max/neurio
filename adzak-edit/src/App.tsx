import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor, type PanelId } from './ui/store/editorStore';
import { useExport } from './ui/store/exportStore';
import { useSettings } from './ui/store/settingsStore';
import { Toolbar } from './ui/components/Toolbar';
import { Toasts } from './ui/components/Toasts';
import { Icons, type IconName } from './ui/components/Icons';
import { MediaPanel } from './ui/panels/MediaPanel';
import { PreviewPanel } from './ui/panels/PreviewPanel';
import { TimelinePanel } from './ui/panels/TimelinePanel';
import { InspectorPanel } from './ui/panels/InspectorPanel';
import { AiPanel } from './ui/panels/AiPanel';
import { ExportDialog } from './ui/panels/ExportDialog';
import { SettingsDialog } from './ui/panels/SettingsDialog';
import { initBridge, getBridge } from './core/bridge';
import { listProjects } from './core/bridge/idb';
import { effectRegistry } from './core/effects/registry';
import { brand, windowTitle } from './brand';
import { APP_NAME } from './version';
import { clsx } from 'clsx';

/**
 * Application shell.
 *
 * Layout: icon rail + left panel + (preview over timeline) + inspector. The rail
 * only offers panels that exist; Phase-2+ surfaces are rendered as disabled with
 * a "coming soon" note rather than opening an empty room.
 */

interface RailItem {
  id: PanelId;
  icon: IconName;
  label: string;
  /** Set when the surface is not implemented yet — the button is then disabled. */
  comingSoon?: string;
}

const RAIL: RailItem[] = [
  { id: 'media', icon: 'Folder', label: 'Media' },
  { id: 'text', icon: 'Type', label: 'Text' },
  { id: 'subtitles', icon: 'Captions', label: 'Subtitles' },
  { id: 'effects', icon: 'Sparkle', label: 'Effects' },
  { id: 'transitions', icon: 'Grid', label: 'Transitions', comingSoon: 'Phase 2 — transitions are not implemented yet.' },
  { id: 'ai', icon: 'Sparkle', label: 'AI editor' },
];

export default function App() {
  const activePanel = useEditor((s) => s.activePanel);
  const setActivePanel = useEditor((s) => s.setActivePanel);
  const loadWarnings = useEditor((s) => s.loadWarnings);
  const projectName = useEditor((s) => s.project.name);
  const dirty = useEditor((s) => s.dirty);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [leftWidth, setLeftWidth] = useState(268);
  const [rightWidth, setRightWidth] = useState(300);
  const [rightOpen, setRightOpen] = useState(true);
  const bootstrapped = useRef(false);

  /* ---------------- boot ---------------- */

  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    void bootstrap();
  }, []);

  const bootstrap = useCallback(async () => {
    const store = useEditor.getState();
    try {
      const bridge = await initBridge();
      store.setCapabilities(bridge.capabilities);
      if (!bridge.capabilities.ffmpeg) {
        store.toast({
          kind: 'info',
          title: 'Running in the browser',
          message:
            'Editing, preview and project files all work. MP4/H.264 export needs the desktop app, which bundles FFmpeg.',
        });
      }
    } catch (error) {
      store.toast({
        kind: 'error',
        title: 'The editor could not start',
        message: (error as Error).message,
      });
      return;
    }

    // Crash recovery: offer the most recent autosaved project, never silently load it.
    if (getBridge().capabilities.persistentStorage) {
      try {
        const stored = await listProjects();
        const recent = stored.sort((a, b) => b.updatedAt - a.updatedAt)[0];
        if (recent && Date.now() - recent.updatedAt < 1000 * 60 * 60 * 24 * 7) {
          useEditor.getState().toast({
            kind: 'info',
            title: 'Recovered project found',
            message: `"${recent.name}" was autosaved ${formatAge(recent.updatedAt)}. Restore it?`,
            actions: [
              {
                label: 'Restore',
                run: () => useEditor.getState().loadProjectFromText(recent.content, recent.path),
              },
            ],
          });
        }
      } catch {
        // A failed recovery probe must never block the editor.
      }
    }
  }, []);

  /* ---------------- document title ---------------- */

  useEffect(() => {
    document.title = windowTitle(projectName, dirty);
  }, [projectName, dirty]);

  /* ---------------- autosave ---------------- */

  const autosaveSec = useSettings((s) => s.settings.general.autosaveSec);
  useEffect(() => {
    if (autosaveSec <= 0) return;
    const timer = window.setInterval(() => void useEditor.getState().autosave(), Math.max(10, autosaveSec) * 1000);
    const onUnload = () => void useEditor.getState().autosave();
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, [autosaveSec]);

  /* ---------------- shortcuts ---------------- */

  const shortcuts = useSettings((s) => s.settings.shortcuts);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      const combo = comboOf(event);
      const store = useEditor.getState();

      if (combo === comboOfKey(shortcuts.undo)) return store.undo();
      if (combo === comboOfKey(shortcuts.redo)) return store.redo();
      if (combo === comboOfKey(shortcuts.save)) {
        event.preventDefault();
        return void store.saveProject();
      }
      if (combo === comboOfKey(shortcuts.playPause)) {
        event.preventDefault();
        return store.togglePlay();
      }
      if (combo === comboOfKey(shortcuts.frameLeft)) {
        event.preventDefault();
        return store.stepFrame(-1);
      }
      if (combo === comboOfKey(shortcuts.frameRight)) {
        event.preventDefault();
        return store.stepFrame(1);
      }
      if (combo === comboOfKey(shortcuts.zoomIn)) {
        event.preventDefault();
        return store.setZoom(Math.min(1200, store.zoomPxPerSec * 1.25));
      }
      if (combo === comboOfKey(shortcuts.zoomOut)) {
        event.preventDefault();
        return store.setZoom(Math.max(4, store.zoomPxPerSec / 1.25));
      }
      if (combo === comboOfKey(shortcuts.split)) return store.splitAtPlayhead();
      if (combo === comboOfKey(shortcuts.toggleSnap)) return store.setSnapping(!store.snapping);
      if (combo === comboOfKey(shortcuts.selectTool)) return store.setTool('select');
      if (combo === comboOfKey(shortcuts.addMarker)) return store.addMarkerAtPlayhead();
      if (combo === comboOfKey(shortcuts.rippleDelete)) return store.deleteSelected(true);
      if (combo === comboOfKey(shortcuts.delete)) return store.deleteSelected(false);
      if (combo === 'Ctrl+E') {
        event.preventDefault();
        return useExport.getState().openDialog();
      }
      if (combo === 'Ctrl+I') {
        event.preventDefault();
        return void store.importFiles();
      }
      return undefined;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shortcuts]);

  /* ---------------- file drop anywhere ---------------- */

  useEffect(() => {
    const bridge = getBridge();
    return bridge.onFileDropped((paths) => void useEditor.getState().importPaths(paths));
  }, []);

  useEffect(() => {
    const onDrop = (event: DragEvent) => event.preventDefault();
    const onDragOver = (event: DragEvent) => event.preventDefault();
    window.addEventListener('drop', onDrop);
    window.addEventListener('dragover', onDragOver);
    return () => {
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('dragover', onDragOver);
    };
  }, []);

  /* ---------------- render ---------------- */

  const effectCount = effectRegistry.all().length;

  return (
    <div className="h-screen w-screen flex flex-col bg-ink-900 text-ink-200 overflow-hidden">
      <Toolbar onOpenSettings={() => setSettingsOpen(true)} />

      {loadWarnings.length > 0 && (
        <div className="shrink-0 px-3 py-1.5 bg-accent-warm/10 border-b border-accent-warm/30 text-[11px] text-accent-warm/90 flex items-start gap-2">
          <Icons.Warning size={13} className="mt-0.5 shrink-0" />
          <span className="flex-1 leading-relaxed">
            {loadWarnings.length === 1 ? loadWarnings[0] : `${loadWarnings.length} problems were repaired on load.`}
          </span>
          <button className="shrink-0" onClick={() => useEditor.setState({ loadWarnings: [] })}>
            <Icons.Close size={12} />
          </button>
        </div>
      )}

      <div className="flex-1 flex min-h-0">
        {/* Icon rail */}
        <nav className="shrink-0 w-11 border-r border-ink-800 bg-ink-900 flex flex-col items-center py-2 gap-1">
          {RAIL.map((item) => {
            const Icon = Icons[item.icon];
            const active = activePanel === item.id;
            return (
              <button
                key={item.id}
                className={clsx(
                  'w-9 h-9 rounded-md flex items-center justify-center transition-colors',
                  active ? 'bg-ink-750 text-brand-300' : 'text-ink-500 hover:bg-ink-800 hover:text-ink-200',
                  item.comingSoon && 'cursor-not-allowed hover:bg-transparent hover:text-ink-500 opacity-60',
                )}
                onClick={() => (item.comingSoon ? undefined : setActivePanel(item.id))}
                title={item.comingSoon ?? item.label}
                disabled={Boolean(item.comingSoon)}
              >
                <Icon size={16} />
              </button>
            );
          })}
          <div className="mt-auto flex flex-col items-center gap-1">
            <button
              className="w-9 h-9 rounded-md flex items-center justify-center text-ink-500 hover:bg-ink-800 hover:text-ink-200"
              onClick={() => setRightOpen((o) => !o)}
              title={rightOpen ? 'Hide inspector' : 'Show inspector'}
            >
              <Icons.Settings size={15} />
            </button>
          </div>
        </nav>

        {/* Left panel */}
        <aside className="shrink-0 border-r border-ink-800 bg-ink-900 min-w-0" style={{ width: leftWidth }}>
          {activePanel === 'ai' ? <AiPanel /> : <MediaPanel />}
          {(activePanel === 'text' || activePanel === 'subtitles' || activePanel === 'effects') && (
            <ComingSoonPanel
              panel={activePanel}
              onGoToMedia={() => setActivePanel('media')}
              effectCount={effectCount}
            />
          )}
        </aside>
        <Splitter onDrag={(dx) => setLeftWidth((w) => Math.min(520, Math.max(200, w + dx)))} />

        {/* Centre */}
        <main className="flex-1 flex flex-col min-w-0 min-h-0">
          <div className="flex-1 min-h-0">
            <PreviewPanel />
          </div>
          <div className="h-[300px] shrink-0">
            <TimelinePanel />
          </div>
        </main>

        {/* Inspector */}
        {rightOpen && (
          <>
            <Splitter onDrag={(dx) => setRightWidth((w) => Math.min(480, Math.max(220, w - dx)))} />
            <aside className="shrink-0 border-l border-ink-800 bg-ink-900" style={{ width: rightWidth }}>
              <InspectorPanel />
            </aside>
          </>
        )}
      </div>

      <StatusBar />
      <Toasts />
      <ExportDialog />
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}

/* ------------------------------------------------------------------ */

function ComingSoonPanel({
  panel,
  onGoToMedia,
  effectCount,
}: {
  panel: PanelId;
  onGoToMedia: () => void;
  effectCount: number;
}) {
  const copy = {
    text: {
      title: 'Text & titles',
      body: 'Text layers already work — add one from the toolbar and style it in the Inspector. A template gallery lands in Phase 2.',
      ready: true,
    },
    subtitles: {
      title: 'Subtitles',
      body: 'SRT, VTT and ASS import/export is implemented, along with word-level cues and burn-in. Auto-captions from Whisper need the desktop app.',
      ready: true,
    },
    effects: {
      title: 'Effects',
      body: `${effectCount} colour and visual effects are available per clip in the Inspector. Effect presets and a browser arrive in Phase 2.`,
      ready: true,
    },
    transitions: {
      title: 'Transitions',
      body: 'Transitions are not implemented yet. The timeline data model already reserves room for them.',
      ready: false,
    },
  } as const;
  const info = copy[panel as keyof typeof copy] ?? copy.transitions;

  return (
    <div className="p-4">
      <div className="flex items-center gap-2 mb-2">
        <span
          className={clsx(
            'chip',
            info.ready ? 'border-brand-500/50 text-brand-300 bg-brand-600/15' : 'border-accent-warm/50 text-accent-warm bg-accent-warm/10',
          )}
        >
          {info.ready ? 'Available now' : 'Coming soon'}
        </span>
      </div>
      <h2 className="text-[13px] font-medium text-ink-100 mb-1">{info.title}</h2>
      <p className="text-[11px] text-ink-400 leading-relaxed">{info.body}</p>
      <button className="btn h-7 text-[11px] mt-3" onClick={onGoToMedia}>
        <Icons.Folder size={12} />
        Back to media
      </button>
    </div>
  );
}

function StatusBar() {
  const project = useEditor((s) => s.project);
  const capabilities = useEditor((s) => s.capabilities);
  const selectedClipIds = useEditor((s) => s.selectedClipIds);
  const bridge = getBridge();
  const clipCount = project.sequence.tracks.reduce((n, t) => n + t.clips.length, 0);
  return (
    <div className="shrink-0 h-6 px-3 flex items-center gap-3 border-t border-ink-800 bg-ink-900 text-[10px] text-ink-500">
      <span className="mono">
        {project.settings.width}×{project.settings.height} @ {project.sequence.fps}fps
      </span>
      <span className="mono">
        {project.sequence.tracks.length} tracks · {clipCount} clips
      </span>
      {selectedClipIds.length > 0 && <span className="mono">{selectedClipIds.length} selected</span>}
      <span className="ml-auto flex items-center gap-1">
        {capabilities?.ffmpeg ? (
          <Icons.Check size={11} className="text-brand-400" />
        ) : (
          <Icons.Offline size={11} className="text-accent-warm" />
        )}
        {capabilities?.ffmpeg ? 'FFmpeg ready' : bridge.kind === 'web' ? 'Browser runtime' : 'No FFmpeg'}
      </span>
      <span>{APP_NAME} is free and local — nothing is uploaded.</span>
    </div>
  );
}

function Splitter({ onDrag }: { onDrag: (dx: number) => void }) {
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    if (!dragging) return;
    let lastX = 0;
    const onMove = (event: MouseEvent) => {
      onDrag(event.clientX - lastX);
      lastX = event.clientX;
    };
    const onUp = () => setDragging(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
    };
  }, [dragging, onDrag]);

  return (
    <div
      className={clsx('w-1 shrink-0 cursor-col-resize hover:bg-brand-500/40', dragging && 'bg-brand-500/60')}
      onMouseDown={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragStart={(event) => event.preventDefault()}
    />
  );
}

/* ---------------- helpers ---------------- */

function comboOf(event: KeyboardEvent | { ctrlKey?: boolean; shiftKey?: boolean; key: string }): string {
  const parts: string[] = [];
  if (event.ctrlKey) parts.push('Ctrl');
  if (event.shiftKey) parts.push('Shift');
  const key = event.key;
  if (!['Control', 'Shift', 'Alt', 'Meta'].includes(key)) {
    parts.push(key.length === 1 ? key.toUpperCase() : key);
  }
  return parts.join('+');
}

function comboOfKey(binding: string): string {
  return binding
    .split('+')
    .map((part) => (part.length === 1 ? part.toUpperCase() : part))
    .join('+');
}

function formatAge(timestamp: number): string {
  const seconds = Math.max(1, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** Exposed so the branding swap has one obvious place to check at runtime. */
export const APP_BRAND = brand;
