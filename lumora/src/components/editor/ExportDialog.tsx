import React, { useState } from 'react';
import { Modal, Field, Slider } from '@/components/common/ui';
import { useEditor, snapshotPages } from '@/state/editorStore';
import { useApp } from '@/state/appStore';
import { exportPages, QUICK_PRESETS, type ExportOptions } from '@/lib/exporter';

export function ExportDialog() {
  const open = useEditor((s) => s.exportOpen);
  const setOpen = useEditor((s) => s.setExport);
  const project = useEditor((s) => s.project);
  const activePage = useEditor((s) => s.activePage);
  const settings = useApp((s) => s.settings);
  const toast = useApp((s) => s.toast);

  const [opts, setOpts] = useState<ExportOptions>({
    format: settings?.defaultExportFormat ?? 'png',
    scale: settings?.defaultExportScale ?? 2,
    quality: settings?.defaultExportQuality ?? 0.92,
    transparent: false,
    pageIndexes: [activePage],
    width: null,
    height: null
  });
  const [busy, setBusy] = useState(false);

  if (!open || !project) return null;

  const run = async () => {
    setBusy(true);
    try {
      const pages = snapshotPages();
      const { saved } = await exportPages(project.name, pages, opts);
      if (saved.length) toast(`Exported to ${saved[0]}`, 'success');
      else toast('Export cancelled.', 'info');
      setOpen(false);
    } catch (err) {
      toast(`Export failed. ${(err as Error).message}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const togglePage = (i: number) =>
    setOpts((o) => ({
      ...o,
      pageIndexes: o.pageIndexes.includes(i) ? o.pageIndexes.filter((p) => p !== i) : [...o.pageIndexes, i].sort()
    }));

  const page = project.pages[activePage];
  const outW = opts.width ?? Math.round(page.width * opts.scale);
  const outH = opts.height ?? Math.round(page.height * opts.scale);

  return (
    <Modal
      title="Export design"
      onClose={() => setOpen(false)}
      footer={
        <>
          <button className="btn" onClick={() => setOpen(false)}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy} onClick={() => void run()}>
            {busy ? 'Exporting…' : 'Export'}
          </button>
        </>
      }
    >
      <Field label="Format">
        <div className="row">
          {(['png', 'jpeg', 'webp', 'pdf'] as const).map((f) => (
            <button key={f} className={`btn ${opts.format === f ? 'primary' : ''}`} onClick={() => setOpts({ ...opts, format: f })}>
              {f.toUpperCase()}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Quick size presets" hint={`Output: ${outW} × ${outH} px`}>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          {QUICK_PRESETS.map((p) => (
            <button key={p.label} className="btn sm" onClick={() => setOpts({ ...opts, width: p.width, height: null })}>
              {p.label}
            </button>
          ))}
          <button className="btn sm" onClick={() => setOpts({ ...opts, width: null, height: null })}>
            Use scale
          </button>
        </div>
      </Field>

      <Field label="Custom width (px)" hint="Leave empty to export using the resolution scale below.">
        <input
          className="input"
          type="number"
          value={opts.width ?? ''}
          onChange={(e) => setOpts({ ...opts, width: e.target.value ? parseInt(e.target.value, 10) : null })}
        />
      </Field>

      <Slider label="Resolution scale" min={0.25} max={6} step={0.25} value={opts.scale} display={`${opts.scale}×`} onChange={(v) => setOpts({ ...opts, scale: v, width: null })} />

      {opts.format !== 'png' && opts.format !== 'pdf' ? (
        <Slider label="Quality" min={0.3} max={1} step={0.01} value={opts.quality} display={`${Math.round(opts.quality * 100)}%`} onChange={(v) => setOpts({ ...opts, quality: v })} />
      ) : null}

      {opts.format !== 'jpeg' ? (
        <label className="row">
          <input type="checkbox" checked={opts.transparent} onChange={(e) => setOpts({ ...opts, transparent: e.target.checked })} />
          <span>Transparent background</span>
        </label>
      ) : null}

      <Field label="Pages">
        <div className="row" style={{ flexWrap: 'wrap' }}>
          {project.pages.map((p, i) => (
            <button key={p.id} className={`btn sm ${opts.pageIndexes.includes(i) ? 'primary' : ''}`} onClick={() => togglePage(i)}>
              {i + 1}. {p.name}
            </button>
          ))}
          <button className="btn sm" onClick={() => setOpts({ ...opts, pageIndexes: project.pages.map((_, i) => i) })}>
            All
          </button>
        </div>
      </Field>
    </Modal>
  );
}
