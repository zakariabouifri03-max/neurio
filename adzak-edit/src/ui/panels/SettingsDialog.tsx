import { useState } from 'react';
import { useSettings, DEFAULT_SHORTCUTS, type ShortcutMap } from '../store/settingsStore';
import { useEditor } from '../store/editorStore';
import { useAi } from '../store/aiStore';
import { Icons } from '../components/Icons';
import { Modal } from './ExportDialog';
import { APP_NAME, APP_VERSION, APP_IDENTIFIER } from '../../version';
import { brand } from '../../brand';
import { getBridge } from '../../core/bridge';
import { AI_TOOLS } from '../../core/ai/registry';
import type { ConsentPolicy } from '../../core/types/ai';
import { clsx } from 'clsx';

type Tab = 'general' | 'ai' | 'performance' | 'shortcuts' | 'about';

const TABS: { id: Tab; label: string; icon: keyof typeof Icons }[] = [
  { id: 'general', label: 'General', icon: 'Settings' },
  { id: 'ai', label: 'AI', icon: 'Sparkle' },
  { id: 'performance', label: 'Performance', icon: 'Bolt' },
  { id: 'shortcuts', label: 'Shortcuts', icon: 'Keyboard' },
  { id: 'about', label: 'About', icon: 'Info' },
];

export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('general');
  if (!open) return null;
  return (
    <Modal onClose={onClose}>
      <div className="panel-header">
        <Icons.Settings size={15} />
        <span>Settings</span>
        <button className="icon-btn w-7 h-7 ml-auto" onClick={onClose}>
          <Icons.Close size={15} />
        </button>
      </div>
      <div className="flex flex-1 min-h-0">
        <div className="w-[132px] shrink-0 border-r border-ink-800 p-1.5 space-y-0.5">
          {TABS.map((t) => {
            const Icon = Icons[t.icon];
            return (
              <button
                key={t.id}
                className={clsx(
                  'w-full flex items-center gap-2 px-2 h-8 rounded-md text-[12px] text-left',
                  tab === t.id ? 'bg-ink-750 text-ink-100' : 'text-ink-400 hover:bg-ink-800 hover:text-ink-200',
                )}
                onClick={() => setTab(t.id)}
              >
                <Icon size={14} />
                {t.label}
              </button>
            );
          })}
        </div>
        <div className="flex-1 scroll-area p-4">
          {tab === 'general' && <GeneralTab />}
          {tab === 'ai' && <AiTab />}
          {tab === 'performance' && <PerformanceTab />}
          {tab === 'shortcuts' && <ShortcutsTab />}
          {tab === 'about' && <AboutTab />}
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4 py-2 border-b border-ink-850 last:border-0">
      <div className="w-[190px] shrink-0">
        <div className="text-[12px] text-ink-200">{label}</div>
        {hint && <div className="text-[10px] text-ink-500 leading-relaxed mt-0.5">{hint}</div>}
      </div>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

function GeneralTab() {
  const { settings, patch } = useSettings();
  return (
    <div className="space-y-1">
      <h3 className="text-[11px] uppercase tracking-wider text-ink-500 mb-1">General</h3>
      <Row label="Autosave interval" hint="Your project is saved to the autosave store this often.">
        <select
          className="field h-8 text-[11px]"
          value={settings.general.autosaveSec}
          onChange={(e) => patch('general', { autosaveSec: Number(e.target.value) })}
        >
          {[30, 60, 120, 300, 600].map((s) => (
            <option key={s} value={s}>
              Every {s < 60 ? `${s} seconds` : `${s / 60} minutes`}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Confirm destructive actions" hint="Ask before deleting clips, clearing the timeline or overwriting a file.">
        <Toggle
          checked={settings.general.confirmBeforeDestructive}
          onChange={(v) => patch('general', { confirmBeforeDestructive: v })}
        />
      </Row>
      <Row label="Timeline density">
        <select
          className="field h-8 text-[11px]"
          value={settings.appearance.timelineDensity}
          onChange={(e) => patch('appearance', { timelineDensity: e.target.value as 'compact' | 'comfortable' })}
        >
          <option value="compact">Compact</option>
          <option value="comfortable">Comfortable</option>
        </select>
      </Row>
      <Row label="Show waveforms" hint="Draw audio peaks on audio clips.">
        <Toggle checked={settings.appearance.showWaveforms} onChange={(v) => patch('appearance', { showWaveforms: v })} />
      </Row>
      <Row label="Show thumbnails" hint="Draw video thumbnails on video clips.">
        <Toggle checked={settings.appearance.showThumbnails} onChange={(v) => patch('appearance', { showThumbnails: v })} />
      </Row>
      <Row label="Theme">
        <select
          className="field h-8 text-[11px]"
          value={settings.appearance.theme}
          onChange={(e) => patch('appearance', { theme: e.target.value as 'dark' | 'light' | 'system' })}
        >
          <option value="dark">Dark</option>
          <option value="light">Light (coming soon)</option>
          <option value="system">System</option>
        </select>
      </Row>
    </div>
  );
}

function AiTab() {
  const { settings, patch } = useSettings();
  const modelList = useAi((s) => s.modelList);
  const refreshProvider = useAi((s) => s.refreshProvider);
  const providerStatus = useAi((s) => s.providerStatus);
  const ai = settings.ai;

  return (
    <div className="space-y-1">
      <h3 className="text-[11px] uppercase tracking-wider text-ink-500 mb-1">Local AI</h3>

      <div className="rounded-md border border-ink-800 bg-ink-850/60 p-2.5 mb-2 text-[11px] text-ink-400 leading-relaxed">
        {brand.name} runs every AI feature on your machine. Media never leaves this computer unless you connect a
        provider below — and even those providers are addressed on <span className="mono text-ink-300">127.0.0.1</span>.
      </div>

      <Row label="Language model" hint="Used for natural-language editing instructions.">
        <select
          className="field h-8 text-[11px]"
          value={ai.providerId}
          onChange={(e) => {
            patch('ai', { providerId: e.target.value as typeof ai.providerId });
            void refreshProvider();
          }}
        >
          <option value="offline">Built-in offline assistant (no setup)</option>
          <option value="ollama">Ollama</option>
          <option value="llamacpp">llama.cpp server</option>
        </select>
      </Row>

      {ai.providerId === 'ollama' && (
        <>
          <Row label="Ollama URL">
            <div className="flex gap-1.5">
              <input
                className="field h-8 text-[11px] mono"
                value={ai.ollamaUrl}
                onChange={(e) => patch('ai', { ollamaUrl: e.target.value })}
                placeholder="http://127.0.0.1:11434"
              />
              <button className="btn h-8 px-2" onClick={() => void refreshProvider()} title="Check connection">
                <Icons.Refresh size={13} />
              </button>
            </div>
          </Row>
          <Row label="Model">
            <select
              className="field h-8 text-[11px]"
              value={ai.ollamaModel}
              onChange={(e) => patch('ai', { ollamaModel: e.target.value })}
            >
              <option value="llama3.2:3b">llama3.2:3b</option>
              <option value="qwen2.5:3b">qwen2.5:3b</option>
              {modelList.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id}
                </option>
              ))}
            </select>
          </Row>
        </>
      )}

      {ai.providerId === 'llamacpp' && (
        <Row label="llama.cpp URL">
          <div className="flex gap-1.5">
            <input
              className="field h-8 text-[11px] mono"
              value={ai.llamacppUrl}
              onChange={(e) => patch('ai', { llamacppUrl: e.target.value })}
              placeholder="http://127.0.0.1:8080"
            />
            <button className="btn h-8 px-2" onClick={() => void refreshProvider()} title="Check connection">
              <Icons.Refresh size={13} />
            </button>
          </div>
        </Row>
      )}

      <Row label="Connection" hint="Tested on save; the offline assistant is always available as a fallback.">
        <span
          className={clsx(
            'chip',
            providerStatus === 'ready'
              ? 'border-brand-500/50 text-brand-300 bg-brand-600/15'
              : 'border-ink-700 text-ink-400',
          )}
        >
          {ai.providerId === 'offline' ? 'Offline assistant active' : providerStatus === 'ready' ? 'Connected' : 'Not reachable'}
        </span>
      </Row>

      <Row label="Whisper model" hint="Speech-to-text for auto captions. Downloaded once, used offline forever.">
        <input
          className="field h-8 text-[11px]"
          value={ai.whisperModel}
          onChange={(e) => patch('ai', { whisperModel: e.target.value })}
          placeholder="base.en"
        />
      </Row>

      <div className="mt-3">
        <h3 className="text-[11px] uppercase tracking-wider text-ink-500 mb-1">AI permissions</h3>
        <Row label="Allow AI to edit the timeline" hint="When off, the assistant can only read and suggest.">
          <Toggle
            checked={ai.permissions.aiEditingEnabled}
            onChange={(v) => patch('ai', { permissions: { ...ai.permissions, aiEditingEnabled: v } })}
          />
        </Row>
        <Row label="Auto-apply destructive steps" hint="Deletes, silence removal and exports. Off by default — keep it that way.">
          <Toggle
            checked={ai.permissions.autoApplyDestructive}
            onChange={(v) => patch('ai', { permissions: { ...ai.permissions, autoApplyDestructive: v } })}
          />
        </Row>
        <Row label="Max steps per plan" hint="A hard cap so a confused model cannot flood your timeline.">
          <input
            type="number"
            className="field h-8 text-[11px] w-24"
            min={1}
            max={100}
            value={ai.permissions.maxCommandsPerPlan}
            onChange={(e) =>
              patch('ai', { permissions: { ...ai.permissions, maxCommandsPerPlan: Number(e.target.value) } })
            }
          />
        </Row>
      </div>

      <div className="mt-3">
        <h3 className="text-[11px] uppercase tracking-wider text-ink-500 mb-1">Per-tool policy</h3>
        <p className="text-[10px] text-ink-500 mb-2 leading-relaxed">
          <span className="text-ink-300">Auto</span> runs without asking,{' '}
          <span className="text-ink-300">Ask once</span> remembers your answer for this session,{' '}
          <span className="text-ink-300">Always ask</span> prompts every time. Tools marked destructive always ask
          unless the switch above is on.
        </p>
        <div className="rounded-md border border-ink-800 divide-y divide-ink-850">
          {AI_TOOLS.filter((tool) => !tool.readOnly).map((tool) => (
            <div key={tool.name} className="flex items-center gap-2 px-2.5 h-9">
              <div className="flex-1 min-w-0">
                <div className="text-[11px] text-ink-200 truncate">{tool.name}</div>
                <div className="text-[9px] text-ink-500 truncate">{tool.description}</div>
              </div>
              <select
                className="field h-7 text-[10px] w-[104px] shrink-0"
                value={ai.permissions.overrides[tool.name] ?? tool.defaultPolicy}
                onChange={(e) =>
                  patch('ai', {
                    permissions: {
                      ...ai.permissions,
                      overrides: { ...ai.permissions.overrides, [tool.name]: e.target.value as ConsentPolicy },
                    },
                  })
                }
              >
                <option value="auto">Auto</option>
                <option value="confirm-once">Ask once</option>
                <option value="confirm-always">Always ask</option>
              </select>
            </div>
          ))}
        </div>
        {ai.permissions.blocked.length > 0 && (
          <p className="text-[10px] text-accent-warm mt-2">
            Blocked tools: {ai.permissions.blocked.join(', ')}
          </p>
        )}
      </div>
    </div>
  );
}

function PerformanceTab() {
  const { settings, patch } = useSettings();
  const p = settings.performance;
  return (
    <div className="space-y-1">
      <h3 className="text-[11px] uppercase tracking-wider text-ink-500 mb-1">Performance</h3>
      <Row label="Preview quality" hint="Draft skips expensive effects in the preview; export is always full quality.">
        <select
          className="field h-8 text-[11px]"
          value={p.previewQuality}
          onChange={(e) => patch('performance', { previewQuality: e.target.value as typeof p.previewQuality })}
        >
          <option value="draft">Draft (fastest)</option>
          <option value="balanced">Balanced</option>
          <option value="high">High</option>
        </select>
      </Row>
      <Row label="Thumbnail workers" hint="Parallel jobs generating timeline thumbnails.">
        <input
          type="number"
          className="field h-8 text-[11px] w-24"
          min={1}
          max={8}
          value={p.thumbnailWorkers}
          onChange={(e) => patch('performance', { thumbnailWorkers: Number(e.target.value) })}
        />
      </Row>
      <Row label="Proxy media" hint="Edit from a small copy of large 4K files; the export always uses the original.">
        <Toggle checked={p.proxyEnabled} onChange={(v) => patch('performance', { proxyEnabled: v })} />
      </Row>
      {p.proxyEnabled && (
        <Row label="Proxy height">
          <select
            className="field h-8 text-[11px]"
            value={p.proxyHeight}
            onChange={(e) => patch('performance', { proxyHeight: Number(e.target.value) })}
          >
            {[360, 540, 720].map((h) => (
              <option key={h} value={h}>
                {h}p
              </option>
            ))}
          </select>
        </Row>
      )}
      <Row label="Hardware acceleration" hint="Use the GPU for decoding and encoding where the driver supports it.">
        <Toggle checked={p.hardwareAcceleration} onChange={(v) => patch('performance', { hardwareAcceleration: v })} />
      </Row>
      <Row label="Cache limit (GB)" hint="Thumbnails, waveforms and proxies.">
        <input
          type="number"
          className="field h-8 text-[11px] w-24"
          min={1}
          max={200}
          value={p.maxCacheGb}
          onChange={(e) => patch('performance', { maxCacheGb: Number(e.target.value) })}
        />
      </Row>
    </div>
  );
}

function ShortcutsTab() {
  const { settings, patch } = useSettings();
  const [recording, setRecording] = useState<keyof ShortcutMap | null>(null);

  const capture = (action: keyof ShortcutMap) => (event: React.KeyboardEvent) => {
    event.preventDefault();
    if (event.key === 'Escape') {
      setRecording(null);
      return;
    }
    const pressed = event.key;
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(pressed)) return;
    const parts: string[] = [];
    if (event.ctrlKey) parts.push('Ctrl');
    if (event.shiftKey) parts.push('Shift');
    if (event.altKey) parts.push('Alt');
    parts.push(pressed.length === 1 ? pressed.toUpperCase() : pressed);
    patch('shortcuts', { [action]: parts.join('+') } as Partial<ShortcutMap>);
    setRecording(null);
  };

  const entries = Object.keys(DEFAULT_SHORTCUTS) as (keyof ShortcutMap)[];

  return (
    <div className="space-y-1">
      <h3 className="text-[11px] uppercase tracking-wider text-ink-500 mb-1">Keyboard shortcuts</h3>
      <p className="text-[10px] text-ink-500 mb-2">Click a binding and press the keys you want. Escape cancels.</p>
      {entries.map((key) => (
        <Row key={key} label={labelFor(key)}>
          <button
            className={clsx('field h-8 text-[11px] mono w-40 text-left', recording === key && 'border-brand-500')}
            onClick={() => setRecording(key)}
            onKeyDown={recording === key ? capture(key) : undefined}
            autoFocus={recording === key}
          >
            {recording === key ? 'Press keys…' : settings.shortcuts[key]}
          </button>
        </Row>
      ))}
      <button className="btn h-7 text-[11px] mt-2" onClick={() => patch('shortcuts', { ...DEFAULT_SHORTCUTS })}>
        <Icons.Refresh size={12} />
        Restore defaults
      </button>
    </div>
  );
}

function labelFor(key: keyof ShortcutMap): string {
  const labels: Record<keyof ShortcutMap, string> = {
    split: 'Split at playhead',
    delete: 'Delete selection',
    rippleDelete: 'Ripple delete',
    undo: 'Undo',
    redo: 'Redo',
    save: 'Save project',
    playPause: 'Play / pause',
    frameLeft: 'Previous frame',
    frameRight: 'Next frame',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    toggleSnap: 'Toggle snapping',
    selectTool: 'Select tool',
    addMarker: 'Add marker',
  };
  return labels[key];
}

function AboutTab() {
  const capabilities = useEditor((s) => s.capabilities);
  const bridge = getBridge();
  const rows: { label: string; value: string; ok: boolean | null }[] = [
    { label: 'Runtime', value: bridge.kind === 'tauri' ? 'Desktop (Tauri)' : 'Browser', ok: null },
    { label: 'FFmpeg', value: capabilities?.ffmpeg ? 'Available' : 'Not available', ok: capabilities?.ffmpeg ?? false },
    { label: 'ffprobe', value: capabilities?.ffprobe ? 'Available' : 'Not available', ok: capabilities?.ffprobe ?? false },
    { label: 'H.265 / HEVC', value: capabilities?.hevc ? 'Supported' : 'Not supported', ok: capabilities?.hevc ?? false },
    { label: 'Hardware encoding', value: capabilities?.hardwareEncoding ? 'Available' : 'Not available', ok: capabilities?.hardwareEncoding ?? false },
    { label: 'Whisper (ASR)', value: capabilities?.whisper ? 'Available' : 'Not available', ok: capabilities?.whisper ?? false },
    { label: 'Local LLM', value: capabilities?.localLlm ? 'Available' : 'Not available', ok: capabilities?.localLlm ?? false },
    { label: 'Persistent storage', value: capabilities?.persistentStorage ? 'Available' : 'Session only', ok: capabilities?.persistentStorage ?? false },
  ];
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-xl bg-brand-600/20 border border-brand-500/40 flex items-center justify-center text-brand-300 text-[18px] font-bold">
          {brand.monogram}
        </div>
        <div>
          <div className="text-[15px] font-semibold text-ink-100">{APP_NAME}</div>
          <div className="text-[11px] text-ink-500 mono">
            v{APP_VERSION} · {APP_IDENTIFIER}
          </div>
        </div>
      </div>

      <h3 className="text-[11px] uppercase tracking-wider text-ink-500">Detected capabilities</h3>
      <div className="rounded-md border border-ink-800 divide-y divide-ink-850">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center gap-2 px-2.5 h-8 text-[11px]">
            <span className="text-ink-300 flex-1">{row.label}</span>
            {row.ok !== null && (
              <span className={row.ok ? 'text-brand-300' : 'text-ink-500'}>
                {row.ok ? <Icons.Check size={13} /> : <Icons.Close size={12} />}
              </span>
            )}
            <span className={clsx('text-[10px]', row.ok === false ? 'text-ink-500' : 'text-ink-300')}>{row.value}</span>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-ink-600 leading-relaxed">
        Features whose capability is missing are shown as disabled with an explanation rather than silently failing.
      </p>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={clsx(
        'relative w-9 h-5 rounded-full transition-colors',
        checked ? 'bg-brand-600' : 'bg-ink-700',
      )}
    >
      <span
        className={clsx(
          'absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform',
          checked ? 'translate-x-[18px]' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}
