import { useMemo, useState } from 'react'
import { Download, Loader2, CheckCircle2 } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { Button, Field, NumberInput, Progress, Segmented, Select, Slider, Toggle } from '../ui/controls'
import { useEditorStore } from '../../state/editor-store'
import { useAppStore } from '../../state/app-store'
import { notify } from '../../state/ui-store'
import { exportDocument, exportPdfDocument } from '../../canvas/engine/export'
import { EXPORT_PRESETS } from '../../../../shared/constants'
import type { ExportFormat } from '../../../../shared/types/export'
import { formatPixels } from '../../lib/format'

export function ExportModal({ onClose, projectName }: { onClose: () => void; projectName: string }): JSX.Element {
  const document = useEditorStore((state) => state.document)
  const settings = useAppStore((state) => state.settings.export)
  const updateSettings = useAppStore((state) => state.updateSettings)

  const [format, setFormat] = useState<ExportFormat>(settings.format)
  const [quality, setQuality] = useState(settings.quality)
  const [scale, setScale] = useState(settings.scale)
  const [transparent, setTransparent] = useState(settings.transparent)
  const [selectedPages, setSelectedPages] = useState<string[]>(() => document?.pages.map((page) => page.id) ?? [])
  const [presetId, setPresetId] = useState<string>('')
  const [customWidth, setCustomWidth] = useState<number>(document?.pages[0]?.width ?? 1080)
  const [customHeight, setCustomHeight] = useState<number>(document?.pages[0]?.height ?? 1080)
  const [usePresetSize, setUsePresetSize] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [done, setDone] = useState<string[]>([])

  const page = document?.pages.find((item) => item.id === selectedPages[0]) ?? document?.pages[0] ?? null

  const targetSize = useMemo(() => {
    if (!page) return { width: 0, height: 0 }
    if (!usePresetSize) return { width: Math.round(page.width * scale), height: Math.round(page.height * scale) }
    return { width: Math.round(customWidth), height: Math.round(customHeight) }
  }, [page, scale, usePresetSize, customWidth, customHeight])

  const run = async (): Promise<void> => {
    if (!document || selectedPages.length === 0) {
      notify.warning('Select at least one page to export.')
      return
    }
    setBusy(true)
    setProgress(0)
    setDone([])
    try {
      const options = {
        format,
        quality,
        scale,
        transparent: transparent && format === 'png',
        pageIds: selectedPages,
        projectName,
        mode: (selectedPages.length > 1 ? 'multi' : 'single') as 'multi' | 'single',
        ...(usePresetSize ? { width: Math.round(customWidth), height: Math.round(customHeight) } : {})
      }
      const result =
        format === 'pdf'
          ? await exportPdfDocument(document, options, (index, total) => setProgress(index / total))
          : await exportDocument(document, options, (index, total) => setProgress(index / total))
      setProgress(1)
      if (result.cancelled) {
        notify.info('Export cancelled')
        return
      }
      setDone(result.files)
      notify.success(`Exported ${result.files.length} file${result.files.length > 1 ? 's' : ''}`)
      void updateSettings({ export: { ...settings, format, quality, scale, transparent } })
    } catch (error) {
      notify.error('Export failed. Please try again.', error instanceof Error ? error.message : undefined)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Export design"
      subtitle={
        page
          ? `${selectedPages.length} page${selectedPages.length > 1 ? 's' : ''} · output ${formatPixels(targetSize.width, targetSize.height)}`
          : undefined
      }
      onClose={onClose}
      busy={busy}
      width={620}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Close
          </Button>
          <Button variant="primary" icon={busy ? Loader2 : Download} disabled={busy || !document} onClick={() => void run()}>
            {busy ? 'Exporting…' : 'Export'}
          </Button>
        </>
      }
    >
      <div className="k-col" style={{ gap: 14 }}>
        <Field label="Format">
          <Segmented
            value={format}
            options={[
              { value: 'png', label: 'PNG' },
              { value: 'jpg', label: 'JPG' },
              { value: 'webp', label: 'WEBP' },
              { value: 'pdf', label: 'PDF' }
            ]}
            onChange={setFormat}
          />
        </Field>

        <Field label="Quick presets">
          <Select
            ariaLabel="Export preset"
            value={presetId}
            options={[
              { value: '', label: 'Page size (no preset)' },
              ...EXPORT_PRESETS.map((preset) => ({ value: preset.id, label: preset.label }))
            ]}
            onChange={(value) => {
              setPresetId(value)
              if (!value) {
                setUsePresetSize(false)
                return
              }
              const preset = EXPORT_PRESETS.find((entry) => entry.id === value)
              if (preset) {
                setCustomWidth(preset.width)
                setCustomHeight(preset.height)
                setUsePresetSize(true)
              }
            }}
          />
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Width">
            <NumberInput value={targetSize.width} min={16} max={12000} disabled={!usePresetSize} onChange={setCustomWidth} />
          </Field>
          <Field label="Height">
            <NumberInput value={targetSize.height} min={16} max={12000} disabled={!usePresetSize} onChange={setCustomHeight} />
          </Field>
        </div>
        <Toggle checked={usePresetSize} label="Use a fixed output size instead of page size × scale" onChange={setUsePresetSize} />

        <Slider
          label="Resolution scale"
          min={0.25}
          max={4}
          step={0.25}
          value={scale}
          onChange={setScale}
          format={(value) => `${Math.round(value * 100)}%`}
        />
        {format !== 'png' && format !== 'pdf' ? (
          <Slider label="Quality" min={0.3} max={1} step={0.01} value={quality} onChange={setQuality} format={(value) => `${Math.round(value * 100)}%`} />
        ) : null}
        <Toggle
          checked={transparent}
          label="Transparent background (PNG only)"
          onChange={(value) => {
            setTransparent(value)
            if (value) setFormat('png')
          }}
        />

        <div className="k-sep" />
        <Field label="Pages">
          <div className="k-col" style={{ gap: 4 }}>
            {document?.pages.map((entry, index) => (
              <label key={entry.id} className="k-row" style={{ gap: 8, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={selectedPages.includes(entry.id)}
                  onChange={(event) => {
                    setSelectedPages((current) =>
                      event.target.checked ? [...current, entry.id] : current.filter((id) => id !== entry.id)
                    )
                  }}
                />
                <span style={{ fontSize: 12.5 }}>Page {index + 1} — {entry.name}</span>
                <span className="k-mono" style={{ color: 'var(--k-text-mute)' }}>{entry.width}×{entry.height}</span>
              </label>
            ))}
          </div>
        </Field>

        {busy ? <Progress value={progress} /> : null}
        {done.length > 0 ? (
          <div className="k-col" style={{ gap: 4 }}>
            {done.map((path) => (
              <div key={path} className="k-row" style={{ gap: 8, color: 'var(--k-ok)', fontSize: 12 }}>
                <CheckCircle2 size={13} />
                <span className="k-truncate">{path}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </Modal>
  )
}
