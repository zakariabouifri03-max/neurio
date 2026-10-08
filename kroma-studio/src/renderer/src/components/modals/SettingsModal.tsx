import { useEffect, useState } from 'react'
import {
  Settings as SettingsIcon,
  Palette,
  Database,
  KeyRound,
  Keyboard,
  Download,
  Cpu,
  Info,
  CheckCircle2,
  Loader2,
  Eye,
  EyeOff,
  FolderOpen,
  Trash2
} from 'lucide-react'
import { Modal } from '../ui/Modal'
import { Button, Field, NumberInput, Segmented, Select, Slider, Toggle } from '../ui/controls'
import { useAppStore } from '../../state/app-store'
import { notify } from '../../state/ui-store'
import { platform } from '../../platform'
import { ai } from '../../services/ai-facade'
import { clearFilterCache } from '../../canvas/engine/filters'
import { imageCache } from '../../canvas/engine/image-cache'
import type { AiCapability, AiProviderId, AppSettings } from '../../../../shared/types/settings'
import { BRAND } from '../../../../shared/brand'

type Section = 'general' | 'appearance' | 'storage' | 'ai' | 'shortcuts' | 'export' | 'performance' | 'about'

const SECTIONS: Array<{ id: Section; label: string; icon: typeof SettingsIcon }> = [
  { id: 'general', label: 'General', icon: SettingsIcon },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'storage', label: 'Storage', icon: Database },
  { id: 'ai', label: 'AI Providers', icon: KeyRound },
  { id: 'shortcuts', label: 'Keyboard Shortcuts', icon: Keyboard },
  { id: 'export', label: 'Export', icon: Download },
  { id: 'performance', label: 'Performance', icon: Cpu },
  { id: 'about', label: 'About', icon: Info }
]

export function SettingsModal({ onClose, initialSection }: { onClose: () => void; initialSection?: string }): JSX.Element {
  const [section, setSection] = useState<Section>((initialSection as Section) ?? 'general')
  const settings = useAppStore((state) => state.settings)
  const updateSettings = useAppStore((state) => state.updateSettings)
  const systemInfo = useAppStore((state) => state.systemInfo)

  return (
    <Modal title="Settings" onClose={onClose} width={860} footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
      <div style={{ display: 'grid', gridTemplateColumns: '190px 1fr', gap: 16, minHeight: 420 }}>
        <nav className="k-col" style={{ gap: 2 }}>
          {SECTIONS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setSection(entry.id)}
              className="k-row"
              style={{
                gap: 8,
                padding: '7px 9px',
                borderRadius: 8,
                border: 0,
                cursor: 'pointer',
                textAlign: 'left',
                fontSize: 12.5,
                background: section === entry.id ? 'rgb(124 92 255 / 0.16)' : 'transparent',
                color: section === entry.id ? 'var(--k-accent-2)' : 'var(--k-text-dim)'
              }}
            >
              <entry.icon size={14} />
              {entry.label}
            </button>
          ))}
        </nav>

        <div className="k-scroll" style={{ paddingRight: 6 }}>
          {section === 'general' ? (
            <GeneralSection settings={settings} onChange={(patch) => void updateSettings(patch)} />
          ) : null}
          {section === 'appearance' ? (
            <AppearanceSection settings={settings} onChange={(patch) => void updateSettings(patch)} />
          ) : null}
          {section === 'storage' ? <StorageSection settings={settings} onChange={(patch) => void updateSettings(patch)} /> : null}
          {section === 'ai' ? <AiSection /> : null}
          {section === 'shortcuts' ? <ShortcutsSection /> : null}
          {section === 'export' ? (
            <ExportSection settings={settings} onChange={(patch) => void updateSettings(patch)} />
          ) : null}
          {section === 'performance' ? (
            <PerformanceSection settings={settings} onChange={(patch) => void updateSettings(patch)} />
          ) : null}
          {section === 'about' ? <AboutSection info={systemInfo} /> : null}
        </div>
      </div>
    </Modal>
  )
}

/* --------------------------------- general -------------------------------- */

type Patch = (patch: Partial<AppSettings>) => void

function GeneralSection({ settings, onChange }: { settings: ReturnType<typeof useAppStore.getState>['settings']; onChange: Patch }): JSX.Element {
  return (
    <Section title="General" hint="Workspace behaviour and saving.">
      <Toggle label="Auto-save designs" checked={settings.general.autoSave} onChange={(autoSave) => void onChange({ general: { ...settings.general, autoSave } })} />
      <Slider
        label="Auto-save delay"
        min={400}
        max={10000}
        step={100}
        value={settings.general.autoSaveIntervalMs}
        onChange={(autoSaveIntervalMs) => void onChange({ general: { ...settings.general, autoSaveIntervalMs } })}
        format={(value) => `${(value / 1000).toFixed(1)}s`}
      />
      <Toggle
        label="Reopen last design on launch"
        checked={settings.general.openLastProject}
        onChange={(openLastProject) => void onChange({ general: { ...settings.general, openLastProject } })}
      />
      <Toggle
        label="Confirm before deleting"
        checked={settings.general.confirmDelete}
        onChange={(confirmDelete) => void onChange({ general: { ...settings.general, confirmDelete } })}
      />
      <Field label="Language">
        <Select value={settings.general.language} options={[{ value: 'en', label: 'English' }]} onChange={() => undefined} />
      </Field>
      <p style={{ fontSize: 11.5, color: 'var(--k-text-mute)' }}>
        No telemetry is collected and no data leaves this computer unless you configure an AI provider.
      </p>
    </Section>
  )
}

function AppearanceSection({ settings, onChange }: { settings: ReturnType<typeof useAppStore.getState>['settings']; onChange: Patch }): JSX.Element {
  return (
    <Section title="Appearance" hint="Theme, accent and canvas guides.">
      <Field label="Theme">
        <Segmented
          value={settings.appearance.theme}
          options={[
            { value: 'dark', label: 'Dark' },
            { value: 'light', label: 'Light' },
            { value: 'system', label: 'System' }
          ]}
          onChange={(theme) => void onChange({ appearance: { ...settings.appearance, theme } })}
        />
      </Field>
      <Field label="Accent colour">
        <div className="k-row" style={{ gap: 6 }}>
          {['#7C5CFF', '#00B4D8', '#38D39F', '#FF7B00', '#FF2EC4', '#FF5F7A'].map((color) => (
            <button
              key={color}
              type="button"
              onClick={() => void onChange({ appearance: { ...settings.appearance, accent: color } })}
              style={{
                width: 26,
                height: 26,
                borderRadius: 8,
                background: color,
                border: settings.appearance.accent === color ? '2px solid #fff' : '1px solid var(--k-line)',
                cursor: 'pointer'
              }}
            />
          ))}
        </div>
      </Field>
      <Slider
        label="Interface scale"
        min={0.85}
        max={1.4}
        step={0.05}
        value={settings.appearance.uiScale}
        onChange={(uiScale) => void onChange({ appearance: { ...settings.appearance, uiScale } })}
        format={(value) => `${Math.round(value * 100)}%`}
      />
      <div className="k-sep" />
      <Toggle label="Show grid" checked={settings.appearance.showGrid} onChange={(showGrid) => void onChange({ appearance: { ...settings.appearance, showGrid } })} />
      <Toggle label="Snap to grid" checked={settings.appearance.snapToGrid} onChange={(snapToGrid) => void onChange({ appearance: { ...settings.appearance, snapToGrid } })} />
      <Toggle label="Snap to objects" checked={settings.appearance.snapToObjects} onChange={(snapToObjects) => void onChange({ appearance: { ...settings.appearance, snapToObjects } })} />
      <Toggle label="Alignment guides" checked={settings.appearance.showGuides} onChange={(showGuides) => void onChange({ appearance: { ...settings.appearance, showGuides } })} />
      <Toggle label="Safe-area guides" checked={settings.appearance.showSafeArea} onChange={(showSafeArea) => void onChange({ appearance: { ...settings.appearance, showSafeArea } })} />
      <Toggle label="Rulers" checked={settings.appearance.rulers} onChange={(rulers) => void onChange({ appearance: { ...settings.appearance, rulers } })} />
      <Field label="Grid size">
        <NumberInput value={settings.appearance.gridSize} min={4} max={400} onChange={(gridSize) => void onChange({ appearance: { ...settings.appearance, gridSize } })} />
      </Field>
    </Section>
  )
}

function StorageSection({ settings, onChange }: { settings: ReturnType<typeof useAppStore.getState>['settings']; onChange: Patch }): JSX.Element {
  const [info, setInfo] = useState<string>('')
  useEffect(() => {
    void platform.system.info().then((value) => setInfo(value.dataDir))
  }, [])
  return (
    <Section title="Storage" hint="Where designs, assets and settings live.">
      <Field label="Data folder">
        <div className="k-row" style={{ gap: 6 }}>
          <input className="k-input" value={info} readOnly />
          <Button
            icon={FolderOpen}
            onClick={() => {
              void (async () => {
                try {
                  await platform.settings.openDataDir()
                } catch {
                  notify.info('Data folder is managed by the operating system.')
                }
              })()
            }}
          >
            Open
          </Button>
        </div>
      </Field>
      <Slider
        label="Backups kept per project"
        min={0}
        max={20}
        value={settings.storage.keepBackups}
        onChange={(keepBackups) => void onChange({ storage: { ...settings.storage, keepBackups } })}
      />
      <p style={{ fontSize: 11.5, color: 'var(--k-text-mute)' }}>
        Projects are plain JSON files, so they stay readable even if the app is uninstalled. Assets are stored separately and
        referenced by id.
      </p>
    </Section>
  )
}

/* ----------------------------------- AI ----------------------------------- */

const CAPABILITY_LABEL: Record<AiCapability, string> = {
  text: 'Text & copy',
  image: 'Image generation',
  background: 'Background removal',
  upscale: 'Upscaling'
}

function AiSection(): JSX.Element {
  const [providers, setProviders] = useState<Awaited<ReturnType<typeof ai.providers>>>([])
  const [keys, setKeys] = useState<Record<string, string>>({})
  const [reveal, setReveal] = useState<Record<string, boolean>>({})
  const [testing, setTesting] = useState<string | null>(null)
  const settings = useAppStore((state) => state.settings)
  const refreshAi = useAppStore((state) => state.refreshAi)
  const updateSettings = useAppStore((state) => state.updateSettings)
  const [status, setStatus] = useState<Awaited<ReturnType<typeof ai.status>> | null>(null)

  const reload = async (): Promise<void> => {
    const [list, currentStatus] = await Promise.all([ai.providers(), ai.status(true)])
    setProviders(list)
    setStatus(currentStatus)
  }

  useEffect(() => {
    void reload()
  }, [])

  const saveKey = async (id: AiProviderId): Promise<void> => {
    const key = (keys[id] ?? '').trim()
    if (key.length < 4) {
      notify.warning('That key looks too short.')
      return
    }
    try {
      await platform.settings.setKey(id, key)
      setKeys((current) => ({ ...current, [id]: '' }))
      await Promise.all([reload(), refreshAi()])
      notify.success('API key saved and encrypted')
    } catch (error) {
      notify.error('Could not save the key', error instanceof Error ? error.message : undefined)
    }
  }

  return (
    <Section
      title="AI Providers"
      hint="Keys are encrypted with the operating-system keychain and never leave this computer."
    >
      {providers
        .filter((provider) => provider.id !== 'offline')
        .map((provider) => {
          const stored = settings.ai.providers[provider.id]
          return (
            <div key={provider.id} className="k-panel k-col" style={{ gap: 8, padding: 12, background: 'var(--k-panel-2)' }}>
              <div className="k-row-between">
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{provider.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--k-text-mute)' }}>
                    {provider.capabilities.map((capability) => CAPABILITY_LABEL[capability]).join(' · ')}
                  </div>
                </div>
                {stored?.hasKey ? <span className="k-chip k-chip--ok">Key saved</span> : <span className="k-chip">Not configured</span>}
              </div>

              <div className="k-row" style={{ gap: 6 }}>
                <input
                  className="k-input"
                  type={reveal[provider.id] ? 'text' : 'password'}
                  placeholder={provider.keyPlaceholder ?? 'Paste your API key'}
                  value={keys[provider.id] ?? ''}
                  onChange={(event) => setKeys((current) => ({ ...current, [provider.id]: event.target.value }))}
                  autoComplete="off"
                  spellCheck={false}
                />
                <Button variant="ghost" icon={reveal[provider.id] ? EyeOff : Eye} onClick={() => setReveal((current) => ({ ...current, [provider.id]: !current[provider.id] }))} title="Show / hide" />
              </div>

              {provider.allowBaseUrl ? (
                <input
                  className="k-input"
                  placeholder="Base URL (optional override)"
                  value={settings.ai.providers[provider.id]?.baseUrl ?? ''}
                  onChange={(event) =>
                    void updateSettings({
                      ai: {
                        ...settings.ai,
                        providers: { ...settings.ai.providers, [provider.id]: { ...settings.ai.providers[provider.id], baseUrl: event.target.value } }
                      }
                    } as Partial<AppSettings>)
                  }
                />
              ) : null}

              {provider.models.length > 1 ? (
                <Field label="Model">
                  <Select
                    ariaLabel={`${provider.label} model`}
                    value={settings.ai.providers[provider.id]?.model ?? provider.models[0]}
                    options={provider.models.map((model) => ({ value: model, label: model }))}
                    onChange={(model) =>
                      void updateSettings({
                        ai: {
                          ...settings.ai,
                          providers: { ...settings.ai.providers, [provider.id]: { ...settings.ai.providers[provider.id], model } }
                        }
                      } as Partial<AppSettings>)
                    }
                  />
                </Field>
              ) : null}

              <div className="k-row" style={{ gap: 6 }}>
                <Button size="sm" variant="primary" onClick={() => void saveKey(provider.id)} disabled={!(keys[provider.id] ?? '').trim()}>
                  Save key
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={testing === provider.id}
                  icon={testing === provider.id ? Loader2 : CheckCircle2}
                  onClick={() => {
                    void (async () => {
                      setTesting(provider.id)
                      try {
                        const result = await platform.settings.testProvider(provider.id)
                        if (result.ok) notify.success(result.message)
                        else notify.error(result.message)
                      } finally {
                        setTesting(null)
                      }
                    })()
                  }}
                >
                  Test
                </Button>
                {stored?.hasKey ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={Trash2}
                    onClick={() => {
                      void (async () => {
                        await platform.settings.clearKey(provider.id)
                        await Promise.all([reload(), refreshAi()])
                        notify.info('Key removed')
                      })()
                    }}
                  >
                    Remove
                  </Button>
                ) : null}
                {provider.helpUrl ? (
                  <Button size="sm" variant="ghost" onClick={() => void platform.system.openExternal(provider.helpUrl!)}>
                    Get a key
                  </Button>
                ) : null}
              </div>
            </div>
          )
        })}

      <div className="k-sep" />
      <span className="k-section-title">Routing</span>
      {(Object.keys(CAPABILITY_LABEL) as AiCapability[]).map((capability) => (
        <Field key={capability} label={CAPABILITY_LABEL[capability]}>
          <Select
            ariaLabel={`${capability} provider`}
            value={settings.ai.routing[capability]}
            options={[
              { value: 'offline', label: 'Offline engine (no key)' },
              ...providers.filter((provider) => provider.capabilities.includes(capability) && provider.id !== 'offline').map((provider) => ({ value: provider.id, label: provider.label }))
            ]}
            onChange={(value) =>
              void updateSettings({ ai: { ...settings.ai, routing: { ...settings.ai.routing, [capability]: value } } } as Partial<AppSettings>)
            }
          />
        </Field>
      ))}
      <Toggle
        label="Fall back to the offline engine when a provider fails"
        checked={settings.ai.allowOfflineFallback}
        onChange={(allowOfflineFallback) => void updateSettings({ ai: { ...settings.ai, allowOfflineFallback } } as Partial<AppSettings>)}
      />
      {status ? (
        <p style={{ fontSize: 11.5, color: 'var(--k-text-mute)' }}>
          Connection: {status.online ? 'online' : 'offline'} ·{' '}
          {Object.entries(status.capabilities)
            .map(([capability, entry]) => `${capability}: ${entry.active ? 'ready' : 'idle'}`)
            .join(' · ')}
        </p>
      ) : null}
    </Section>
  )
}

/* ------------------------------- shortcuts -------------------------------- */

const SHORTCUTS: Array<{ action: string; keys: string }> = [
  { action: 'Undo', keys: 'Ctrl + Z' },
  { action: 'Redo', keys: 'Ctrl + Shift + Z' },
  { action: 'Save', keys: 'Ctrl + S' },
  { action: 'Copy', keys: 'Ctrl + C' },
  { action: 'Paste', keys: 'Ctrl + V' },
  { action: 'Duplicate', keys: 'Ctrl + D' },
  { action: 'Delete selected object', keys: 'Delete' },
  { action: 'Select all', keys: 'Ctrl + A' },
  { action: 'Group', keys: 'Ctrl + G' },
  { action: 'Ungroup', keys: 'Ctrl + Shift + G' },
  { action: 'Export', keys: 'Ctrl + E' },
  { action: 'Preview', keys: 'Ctrl + P' },
  { action: 'Zoom in / out', keys: 'Ctrl + Wheel' },
  { action: 'Pan canvas', keys: 'Space + Drag / Middle drag' },
  { action: 'Constrain drag', keys: 'Shift + Drag' },
  { action: 'Resize around centre', keys: 'Alt + Drag handle' },
  { action: 'Free transform', keys: 'Drag corner handles' },
  { action: 'Rotate in steps', keys: 'Shift + Drag rotate' },
  { action: 'Nudge selection', keys: 'Arrow keys (Shift = 10×)' },
  { action: 'Edit text', keys: 'Double-click text' }
]

function ShortcutsSection(): JSX.Element {
  return (
    <Section title="Keyboard shortcuts" hint="Shortcuts are fixed for consistency across platforms.">
      <div className="k-col" style={{ gap: 2 }}>
        {SHORTCUTS.map((entry) => (
          <div key={entry.action} className="k-row-between" style={{ padding: '6px 8px', background: 'var(--k-panel-2)', borderRadius: 7 }}>
            <span style={{ fontSize: 12.5 }}>{entry.action}</span>
            <span className="k-mono" style={{ color: 'var(--k-text-dim)' }}>{entry.keys}</span>
          </div>
        ))}
      </div>
    </Section>
  )
}

/* ---------------------------- export & performance ------------------------ */

function ExportSection({ settings, onChange }: { settings: ReturnType<typeof useAppStore.getState>['settings']; onChange: Patch }): JSX.Element {
  return (
    <Section title="Export" hint="Defaults used by the export dialog.">
      <Field label="Default format">
        <Segmented
          value={settings.export.format}
          options={[
            { value: 'png', label: 'PNG' },
            { value: 'jpg', label: 'JPG' },
            { value: 'webp', label: 'WEBP' },
            { value: 'pdf', label: 'PDF' }
          ]}
          onChange={(format) => void onChange({ export: { ...settings.export, format } })}
        />
      </Field>
      <Slider label="Quality" min={0.3} max={1} step={0.01} value={settings.export.quality} onChange={(quality) => void onChange({ export: { ...settings.export, quality } })} format={(value) => `${Math.round(value * 100)}%`} />
      <Slider label="Scale" min={0.25} max={4} step={0.25} value={settings.export.scale} onChange={(scale) => void onChange({ export: { ...settings.export, scale } })} format={(value) => `${Math.round(value * 100)}%`} />
      <Toggle label="Transparent background by default" checked={settings.export.transparent} onChange={(transparent) => void onChange({ export: { ...settings.export, transparent } })} />
      <Toggle label="Include all pages by default" checked={settings.export.includeAllPages} onChange={(includeAllPages) => void onChange({ export: { ...settings.export, includeAllPages } })} />
    </Section>
  )
}

function PerformanceSection({ settings, onChange }: { settings: ReturnType<typeof useAppStore.getState>['settings']; onChange: Patch }): JSX.Element {
  return (
    <Section title="Performance" hint="Tune rendering for very large documents.">
      <Slider
        label="Image cache"
        min={64}
        max={4096}
        step={64}
        value={settings.performance.imageCacheSizeMb}
        onChange={(imageCacheSizeMb) => void onChange({ performance: { ...settings.performance, imageCacheSizeMb } })}
        format={(value) => `${value} MB`}
      />
      <Toggle label="Lazy-load images" checked={settings.performance.lazyImageLoading} onChange={(lazyImageLoading) => void onChange({ performance: { ...settings.performance, lazyImageLoading } })} />
      <Toggle label="Object caching" checked={settings.performance.objectCaching} onChange={(objectCaching) => void onChange({ performance: { ...settings.performance, objectCaching } })} />
      <Toggle
        label="Hardware acceleration"
        checked={settings.performance.hardwareAcceleration}
        onChange={(hardwareAcceleration) => void onChange({ performance: { ...settings.performance, hardwareAcceleration } })}
      />
      <p style={{ fontSize: 11.5, color: 'var(--k-text-mute)' }}>
        Hardware acceleration changes apply the next time the app starts.
      </p>
      <Button
        size="sm"
        onClick={() => {
          clearFilterCache()
          imageCache.clear()
          notify.success('Image caches cleared')
        }}
      >
        Clear caches now
      </Button>
    </Section>
  )
}

function AboutSection({ info }: { info: Awaited<ReturnType<typeof platform.system.info>> | null }): JSX.Element {
  return (
    <Section title="About" hint={`${BRAND.name} — ${BRAND.tagline}`}>
      <div className="k-col" style={{ gap: 4 }}>
        <Row label="Version" value={info?.appVersion ?? '—'} />
        <Row label="Electron" value={info?.electronVersion ?? '—'} />
        <Row label="Chromium" value={info?.chromeVersion ?? '—'} />
        <Row label="Node.js" value={info?.nodeVersion ?? '—'} />
        <Row label="Platform" value={info ? `${info.platform} · ${info.arch}` : '—'} />
        <Row label="Packaged" value={info?.isPackaged ? 'yes' : 'development'} />
      </div>
      <div className="k-sep" />
      <p style={{ fontSize: 12, color: 'var(--k-text-dim)', lineHeight: 1.6 }}>
        {BRAND.name} is an offline-first design studio. The editor, text engine, image pipeline, templates, icons and export
        system are all built into this app — an internet connection is only needed for optional AI features you configure
        yourself.
      </p>
      <Button size="sm" variant="ghost" onClick={() => void platform.system.openExternal(BRAND.supportUrl)}>
        Project home
      </Button>
    </Section>
  )
}

/* --------------------------------- shared --------------------------------- */

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="k-col" style={{ gap: 10 }}>
      <div>
        <h3 style={{ margin: 0, fontSize: 13.5 }}>{title}</h3>
        {hint ? <p style={{ margin: '3px 0 0', fontSize: 11.5, color: 'var(--k-text-mute)' }}>{hint}</p> : null}
      </div>
      {children}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="k-row-between" style={{ padding: '6px 8px', background: 'var(--k-panel-2)', borderRadius: 7 }}>
      <span style={{ fontSize: 12 }}>{label}</span>
      <span className="k-mono" style={{ color: 'var(--k-text-dim)' }}>{value}</span>
    </div>
  )
}
