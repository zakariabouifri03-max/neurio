import { useEffect, useState } from 'react'
import { Eraser, ArrowUpRight, Loader2, Check, Image as ImageIcon, Upload } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { Button, Segmented, Slider, Toggle } from '../ui/controls'
import { useEditorStore } from '../../state/editor-store'
import { useAppStore } from '../../state/app-store'
import { notify } from '../../state/ui-store'
import { removeBackground, upscale } from '../../services/image-ops'
import { platform } from '../../platform'
import { assetUrl } from '../../../../shared/constants'
import { imageCache } from '../../canvas/engine/image-cache'
import { formatPixels } from '../../lib/format'
import { ai } from '../../services/ai-facade'

export function ImageOpsModal({ onClose, nodeId }: { onClose: () => void; nodeId?: string }): JSX.Element {
  const [tab, setTab] = useState<'background' | 'upscale'>('background')
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [tolerance, setTolerance] = useState(70)
  const [smooth, setSmooth] = useState(true)
  const [useAi, setUseAi] = useState(false)
  const [scale, setScale] = useState<2 | 3 | 4>(2)
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  const aiStatus = useAppStore((state) => state.aiStatus)

  const node = useEditorStore((state) => (nodeId ? state.nodeById(nodeId) : state.selectedNodes()[0]))

  useEffect(() => {
    if (!node || node.kind !== 'image') return
    setPreview(node.src)
    setResult(null)
    void imageCache.load(node.src).then((entry) => setSize({ width: entry.width, height: entry.height }))
  }, [node])

  const commit = async (dataUrl: string): Promise<void> => {
    try {
      const asset = await platform.assets.importDataUrl(dataUrl, 'kroma-image.png')
      const src = asset.storage === 'inline' && asset.data ? asset.data : assetUrl(asset.id)
      if (node) {
        useEditorStore.getState().updateNodes([{ id: node.id, patch: { src, crop: null } as never }], { label: tab })
      }
      notify.success(tab === 'background' ? 'Background removed and image replaced' : `Image upscaled ${scale}×`)
      onClose()
    } catch (error) {
      notify.error('Could not update the image', error instanceof Error ? error.message : undefined)
    }
  }

  const runBackground = async (): Promise<void> => {
    if (!node || node.kind !== 'image') return
    setBusy(true)
    try {
      const dataUrl = await removeBackground(node.src, { useAi, tolerance, smoothEdges: smooth })
      setResult(dataUrl)
    } catch (error) {
      notify.error('Background removal failed', error instanceof Error ? error.message : undefined)
    } finally {
      setBusy(false)
    }
  }

  const runUpscale = async (): Promise<void> => {
    if (!node || node.kind !== 'image') return
    setBusy(true)
    try {
      const dataUrl = await upscale(node.src, scale, useAi)
      setResult(dataUrl)
    } catch (error) {
      notify.error('Upscaling failed', error instanceof Error ? error.message : undefined)
    } finally {
      setBusy(false)
    }
  }

  const aiReady = aiStatus
    ? tab === 'background'
      ? ai.capabilityReady(aiStatus, 'background')
      : ai.capabilityReady(aiStatus, 'upscale')
    : false

  return (
    <Modal
      title={tab === 'background' ? 'Background remover' : 'Image upscaler'}
      subtitle={size ? `${formatPixels(size.width, size.height)} source` : undefined}
      onClose={onClose}
      width={760}
      busy={busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            icon={Check}
            disabled={busy || !result}
            onClick={() => (result ? void commit(result) : undefined)}
          >
            Replace image on canvas
          </Button>
        </>
      }
    >
      {!node || node.kind !== 'image' ? (
        <div className="k-empty">
          <ImageIcon size={20} />
          <span>Select an image on the canvas first</span>
        </div>
      ) : (
        <div className="k-col" style={{ gap: 12 }}>
          <Segmented
            value={tab}
            options={[
              { value: 'background', label: 'Remove background', icon: Eraser },
              { value: 'upscale', label: 'Upscale', icon: ArrowUpRight }
            ]}
            onChange={setTab}
          />

          <Toggle
            label={aiReady ? 'Use AI provider (faster, sharper)' : 'Use AI provider (needs a key in Settings)'}
            checked={useAi && aiReady}
            onChange={setUseAi}
          />

          {tab === 'background' ? (
            <>
              <Slider label="Tolerance" min={10} max={200} value={tolerance} onChange={setTolerance} />
              <Toggle label="Soften edges" checked={smooth} onChange={setSmooth} />
              <p style={{ fontSize: 11.5, color: 'var(--k-text-mute)', margin: 0 }}>
                The local engine flood-fills from the image borders, which works best on products, logos and objects with a
                solid background. Configure remove.bg, Clipdrop, OpenAI or Google in Settings for AI matting on complex photos.
              </p>
            </>
          ) : (
            <>
              <Slider label="Scale" min={2} max={4} step={1} value={scale} onChange={(value) => setScale(value as 2 | 3 | 4)} format={(value) => `${value}×`} />
              <p style={{ fontSize: 11.5, color: 'var(--k-text-mute)', margin: 0 }}>
                Local upscaling uses progressive high-quality resampling. Clipdrop adds AI detail recovery when configured.
              </p>
            </>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <PreviewPane label="Original" src={preview} />
            <PreviewPane label={result ? 'Result' : 'Preview'} src={result ?? preview} />
          </div>

          <div className="k-row" style={{ gap: 6 }}>
            <Button
              variant="primary"
              icon={busy ? Loader2 : tab === 'background' ? Eraser : ArrowUpRight}
              disabled={busy}
              onClick={() => (tab === 'background' ? void runBackground() : void runUpscale())}
            >
              {busy ? 'Working…' : tab === 'background' ? 'Remove background' : `Upscale ${scale}×`}
            </Button>
            <Button
              variant="ghost"
              icon={Upload}
              disabled={busy}
              onClick={() => {
                void (async () => {
                  const paths = await platform.dialogs.openImages()
                  if (!paths.length) return
                  const [asset] = await platform.assets.importFiles(paths.slice(0, 1))
                  if (!asset) return
                  const src = asset.storage === 'inline' && asset.data ? asset.data : assetUrl(asset.id)
                  setPreview(src)
                  setResult(null)
                  setSize({ width: asset.width ?? 0, height: asset.height ?? 0 })
                })()
              }}
            >
              Use another image
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}

function PreviewPane({ label, src }: { label: string; src: string | null }): JSX.Element {
  return (
    <div className="k-col" style={{ gap: 6 }}>
      <span className="k-section-title">{label}</span>
      <div className="k-panel k-checker" style={{ height: 210, display: 'grid', placeItems: 'center', background: 'var(--k-panel-2)', overflow: 'hidden' }}>
        {src ? <img src={src} alt={label} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} /> : <span className="k-muted">—</span>}
      </div>
    </div>
  )
}
