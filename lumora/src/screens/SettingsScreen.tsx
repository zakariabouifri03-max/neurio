import React, { useEffect, useState } from 'react';
import { useApp } from '@/state/appStore';
import { bridge, isDesktop } from '@/lib/bridge';
import { Field, Toggle } from '@/components/common/ui';
import { SHORTCUTS } from '@/lib/shortcuts';

const SECTIONS = ['General', 'Appearance', 'Storage', 'AI Providers', 'Keyboard Shortcuts', 'Export', 'Performance', 'About'] as const;
type Section = (typeof SECTIONS)[number];

export function SettingsScreen() {
  const { settings, updateSettings, go, toast, appInfo, secretStatus, refreshSecrets } = useApp();
  const [section, setSection] = useState<Section>('General');
  const [usage, setUsage] = useState<{ bytes: number; path: string } | null>(null);
  const [keys, setKeys] = useState({ openai: '', google: '', custom: '', removebg: '' });

  useEffect(() => {
    void bridge.app.storageUsage().then(setUsage).catch(() => undefined);
  }, []);

  if (!settings) return null;
  const ai = settings.ai;
  const setAi = (patch: Partial<typeof ai>) => void updateSettings({ ai: { ...ai, ...patch } as any });

  const saveKey = async (provider: keyof typeof keys) => {
    try {
      await bridge.secrets.set(provider, keys[provider]);
      await refreshSecrets();
      setKeys({ ...keys, [provider]: '' });
      toast('API key stored securely on this device', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  return (
    <div className="settings">
      <nav>
        <button className="btn sm" style={{ marginBottom: 8 }} onClick={() => go('home')}>
          ← Back
        </button>
        {SECTIONS.map((s) => (
          <button key={s} className={section === s ? 'active' : ''} onClick={() => setSection(s)}>
            {s}
          </button>
        ))}
      </nav>
      <div className="content">
        {section === 'General' ? (
          <>
            <h2>General</h2>
            <Field label="Auto-save">
              <Toggle checked={settings.autoSave} onChange={(v) => void updateSettings({ autoSave: v })} label="Save changes automatically" />
            </Field>
            <Field label="Auto-save interval (ms)" hint="Debounced — saves only after you stop editing.">
              <input
                className="input"
                type="number"
                min={1000}
                step={500}
                value={settings.autoSaveIntervalMs}
                onChange={(e) => void updateSettings({ autoSaveIntervalMs: Math.max(1000, parseInt(e.target.value, 10) || 4000) })}
              />
            </Field>
            <Field label="Grid size (px)">
              <input
                className="input"
                type="number"
                value={settings.gridSize}
                onChange={(e) => void updateSettings({ gridSize: Math.max(4, parseInt(e.target.value, 10) || 20) })}
              />
            </Field>
            <Toggle checked={settings.snapToGrid} onChange={(v) => void updateSettings({ snapToGrid: v })} label="Snap to grid" />
            <Toggle checked={settings.showGrid} onChange={(v) => void updateSettings({ showGrid: v })} label="Show grid" />
            <Toggle checked={settings.safeAreaGuides} onChange={(v) => void updateSettings({ safeAreaGuides: v })} label="Safe-area guides" />
          </>
        ) : null}

        {section === 'Appearance' ? (
          <>
            <h2>Appearance</h2>
            <Field label="Theme">
              <div className="row">
                {(['dark', 'midnight', 'light'] as const).map((t) => (
                  <button key={t} className={`btn ${settings.theme === t ? 'primary' : ''}`} onClick={() => void updateSettings({ theme: t })}>
                    {t}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Accent colour">
              <input type="color" value={settings.accent} onChange={(e) => void updateSettings({ accent: e.target.value })} />
            </Field>
          </>
        ) : null}

        {section === 'Storage' ? (
          <>
            <h2>Storage</h2>
            <p className="muted">
              Projects are stored as atomic JSON documents on this machine, so they survive restarts and crashes.
            </p>
            <Field label="Data folder">
              <div className="row">
                <input className="input" readOnly value={usage?.path ?? appInfo?.dataDir ?? ''} />
                <button className="btn" disabled={!isDesktop} onClick={() => void bridge.app.openDataFolder()}>
                  Open
                </button>
              </div>
            </Field>
            <Field label="Space used">
              <span>{usage ? `${(usage.bytes / 1024 / 1024).toFixed(2)} MB` : '—'}</span>
            </Field>
          </>
        ) : null}

        {section === 'AI Providers' ? (
          <>
            <h2>AI Providers</h2>
            <p className="muted">
              Keys are encrypted with the operating system keychain (Electron safeStorage) and are only ever read inside the
              main process — they are never exposed to the UI layer or bundled in code.
            </p>
            {!isDesktop ? <p className="muted">Key management is only available in the desktop app.</p> : null}

            {(
              [
                ['openai', 'OpenAI API Key', 'sk-…'],
                ['google', 'Google AI API Key', 'AIza…'],
                ['custom', 'Other provider API key', 'token'],
                ['removebg', 'Background removal service key', 'key']
              ] as const
            ).map(([id, label, placeholder]) => (
              <Field key={id} label={label} hint={secretStatus[id] ? 'A key is stored for this provider.' : 'No key stored.'}>
                <div className="row">
                  <input
                    className="input"
                    type="password"
                    placeholder={placeholder}
                    value={keys[id]}
                    onChange={(e) => setKeys({ ...keys, [id]: e.target.value })}
                  />
                  <button className="btn primary" disabled={!isDesktop} onClick={() => void saveKey(id)}>
                    Save
                  </button>
                  <button
                    className="btn"
                    disabled={!isDesktop}
                    onClick={async () => {
                      await bridge.secrets.set(id, '');
                      await refreshSecrets();
                    }}
                  >
                    Clear
                  </button>
                </div>
              </Field>
            ))}

            <h3>Routing</h3>
            <Field label="Text provider">
              <select className="select" value={ai.textProvider} onChange={(e) => setAi({ textProvider: e.target.value as any })}>
                <option value="openai">OpenAI (or compatible)</option>
                <option value="google">Google AI</option>
                <option value="custom">Custom endpoint</option>
              </select>
            </Field>
            <Field label="Image provider">
              <select className="select" value={ai.imageProvider} onChange={(e) => setAi({ imageProvider: e.target.value as any })}>
                <option value="openai">OpenAI (or compatible)</option>
                <option value="google">Google AI</option>
                <option value="custom">Custom endpoint</option>
              </select>
            </Field>
            <Field label="Background removal">
              <select
                className="select"
                value={ai.backgroundRemovalProvider}
                onChange={(e) => setAi({ backgroundRemovalProvider: e.target.value as any })}
              >
                <option value="local">Local (offline, no key)</option>
                <option value="custom">Cloud endpoint</option>
              </select>
            </Field>
            <Field label="Upscaler">
              <select className="select" value={ai.upscaleProvider} onChange={(e) => setAi({ upscaleProvider: e.target.value as any })}>
                <option value="local">Local (offline, no key)</option>
                <option value="custom">Cloud endpoint</option>
              </select>
            </Field>

            <h3>Endpoints &amp; models</h3>
            <Field label="OpenAI base URL">
              <input className="input" value={ai.openaiBaseUrl} onChange={(e) => setAi({ openaiBaseUrl: e.target.value })} />
            </Field>
            <div className="grid-2">
              <Field label="OpenAI text model">
                <input className="input" value={ai.openaiTextModel} onChange={(e) => setAi({ openaiTextModel: e.target.value })} />
              </Field>
              <Field label="OpenAI image model">
                <input className="input" value={ai.openaiImageModel} onChange={(e) => setAi({ openaiImageModel: e.target.value })} />
              </Field>
            </div>
            <Field label="Google base URL">
              <input className="input" value={ai.googleBaseUrl} onChange={(e) => setAi({ googleBaseUrl: e.target.value })} />
            </Field>
            <div className="grid-2">
              <Field label="Google text model">
                <input className="input" value={ai.googleTextModel} onChange={(e) => setAi({ googleTextModel: e.target.value })} />
              </Field>
              <Field label="Google image model">
                <input className="input" value={ai.googleImageModel} onChange={(e) => setAi({ googleImageModel: e.target.value })} />
              </Field>
            </div>
            <Field label="Custom base URL" hint="Any OpenAI-compatible server (LM Studio, Ollama proxy, Azure, …)">
              <input className="input" value={ai.customBaseUrl} onChange={(e) => setAi({ customBaseUrl: e.target.value })} />
            </Field>
            <div className="grid-2">
              <Field label="Custom text model">
                <input className="input" value={ai.customTextModel} onChange={(e) => setAi({ customTextModel: e.target.value })} />
              </Field>
              <Field label="Custom image model">
                <input className="input" value={ai.customImageModel} onChange={(e) => setAi({ customImageModel: e.target.value })} />
              </Field>
            </div>
            <Field label="Cloud background-removal endpoint">
              <input className="input" value={ai.removeBgUrl} onChange={(e) => setAi({ removeBgUrl: e.target.value })} placeholder="https://api.remove.bg/v1.0/removebg" />
            </Field>
            <Field label="Cloud upscaler endpoint">
              <input className="input" value={ai.upscaleUrl} onChange={(e) => setAi({ upscaleUrl: e.target.value })} />
            </Field>
          </>
        ) : null}

        {section === 'Keyboard Shortcuts' ? (
          <>
            <h2>Keyboard Shortcuts</h2>
            {SHORTCUTS.map((s) => (
              <div key={s.keys} className="shortcut-row">
                <span>{s.label}</span>
                <kbd>{s.keys}</kbd>
              </div>
            ))}
          </>
        ) : null}

        {section === 'Export' ? (
          <>
            <h2>Export defaults</h2>
            <Field label="Default format">
              <select
                className="select"
                value={settings.defaultExportFormat}
                onChange={(e) => void updateSettings({ defaultExportFormat: e.target.value as any })}
              >
                <option value="png">PNG</option>
                <option value="jpeg">JPG</option>
                <option value="webp">WEBP</option>
                <option value="pdf">PDF</option>
              </select>
            </Field>
            <Field label="Default resolution scale">
              <input
                className="input"
                type="number"
                step={0.25}
                min={0.25}
                max={6}
                value={settings.defaultExportScale}
                onChange={(e) => void updateSettings({ defaultExportScale: parseFloat(e.target.value) || 1 })}
              />
            </Field>
            <Field label="Default quality (JPG/WEBP)">
              <input
                className="input"
                type="number"
                step={0.01}
                min={0.3}
                max={1}
                value={settings.defaultExportQuality}
                onChange={(e) => void updateSettings({ defaultExportQuality: parseFloat(e.target.value) || 0.9 })}
              />
            </Field>
          </>
        ) : null}

        {section === 'Performance' ? (
          <>
            <h2>Performance</h2>
            <Toggle
              checked={settings.hardwareAcceleration}
              onChange={(v) => {
                void updateSettings({ hardwareAcceleration: v });
                toast('Restart Lumora Studio for this to take effect.');
              }}
              label="GPU hardware acceleration"
            />
            <Field label="Undo history steps" hint="Fewer steps use less memory on very large documents.">
              <input
                className="input"
                type="number"
                min={10}
                max={300}
                value={settings.maxUndoSteps}
                onChange={(e) => void updateSettings({ maxUndoSteps: parseInt(e.target.value, 10) || 60 })}
              />
            </Field>
          </>
        ) : null}

        {section === 'About' ? (
          <>
            <h2>About Lumora Studio</h2>
            <p className="muted">
              Lumora Studio is an original, offline-first design editor. All templates, icons and artwork shipped with the
              app were created for this project.
            </p>
            <div className="shortcut-row">
              <span>Version</span>
              <span>{appInfo?.version}</span>
            </div>
            <div className="shortcut-row">
              <span>Platform</span>
              <span>{appInfo?.platform}</span>
            </div>
            <div className="shortcut-row">
              <span>Electron / Chromium</span>
              <span>
                {appInfo?.electron} / {appInfo?.chrome}
              </span>
            </div>
            <button className="btn" style={{ marginTop: 14 }} onClick={() => void bridge.settings.reset().then(() => location.reload())}>
              Reset all settings
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
