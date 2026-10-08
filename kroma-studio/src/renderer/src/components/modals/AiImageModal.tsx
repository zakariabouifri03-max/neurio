import { useState } from 'react'
import { ImagePlus, Loader2, RefreshCw, Upload, ArrowUpRight, Download, Check, Eraser } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { Button, Field, Segmented, Select, Slider, Toggle } from '../ui/controls'
import { ai } from '../../services/ai-facade'
import { useEditorStore } from '../../state/editor-store'
import { useAppStore } from '../../state/app-store'
import { notify } from '../../state/ui-store'
import { platform } from '../../platform'
import { assetUrl } from '../../../../shared/constants'
import { removeBackground, upscale } from '../../services/image-ops'
import type { AspectRatio } from '../../../../shared/types/ai'
import { createImageNode } from '../../../../shared/utils/document'
import { formatBytes } from '../../lib/format'

export function AiImageModal({ onClose, initialPrompt }: { onClose: () => void; initialPrompt?: string }): JSX.Element {
  const [prompt, setPrompt] = useState(initialPrompt ?? '')
  const [negative, setNegative] = useState('')
  const [aspect, setAspect] = useState<AspectRatio>('1:1')
  const [style, setStyle] = useState('none')
  const [transparent, setTransparent] = useState(false)
  const [busy, setBusy] = useState<'generate' | 'bg' | 'upscale' | null>(null)
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [sourceSize, setSourceSize] = useState<{ width: number; height: number } | null>(null)
  const aiStatus = useAppStore((state) => state.aiStatus)

  const generate = async (): Promise<void> => {
    if (!prompt.trim()) {
      notify.warning('Describe the image you want.')
      return
    }
    setBusy('generate')
    try {
      const result = await ai.image({ prompt, negativePrompt: negative || undefined, aspectRatio: aspect, style: style === 'none' ? undefined : style, transparent })
      setDataUrl(result.dataUrl)
      setSourceSize({ width: result.width, height: result.height })
      notify.success('Image generated', result.offline ? undefined : `via ${result.provider}`)
    } catch (error) {
      notify.error('Image generation failed', error instanceof Error ? error.message : undefined)
    } finally {
      setBusy(null)
    }
  }

  const addToCanvas = async (): Promise<void> => {
    if (!dataUrl) return
    try {
      const asset = await platform.assets.importDataUrl(dataUrl, 'ai-image.png')
      const src = asset.storage === 'inline' && asset.data ? asset.data : assetUrl(asset.id)
      const page = useEditorStore.getState().activePage()
      if (!page) return
      const width = asset.width ?? 1024
      const height = asset.height ?? 1024
      const scale = Math.min((page.width * 0.7) / width, (page.height * 0.7) / height, 1)
      useEditorStore.getState().addNodes([
        createImageNode({
          src,
          x: Math.round(page.width / 2 - (width * scale) / 2),
          y: Math.round(page.height / 2 - (height * scale) / 2),
          width: Math.round(width * scale),
          height: Math.round(height * scale),
          naturalWidth: width,
          naturalHeight: height
        })
      ])
      notify.success('Image added to the canvas')
      onClose()
    } catch (error) {
      notify.error('Could not add the image', error instanceof Error ? error.message : undefined)
    }
  }

  const runRemoveBackground = async (): Promise<void> => {
    if (!dataUrl) return
    setBusy('bg')
    try {
      const store = useAppStore.getState()
      const useAi = store.aiStatus ? ai.capabilityReady(store.aiStatus, 'background') : false
      const result = await removeBackground(dataUrl, { useAi })
      setDataUrl(result)
      notify.success('Background removed', useAi ? 'AI provider' : 'Local engine')
    } catch (error) {
      notify.error('Background removal failed', error instanceof Error ? error.message : undefined)
    } finally {
      setBusy(null)
    }
  }

  const runUpscale = async (scale: 2 | 3 | 4): Promise<void> => {
    if (!dataUrl) return
    setBusy('upscale')
    try {
      const store = useAppStore.getState()
      const useAi = store.aiStatus ? ai.capabilityReady(store.aiStatus, 'upscale') : false
      const result = await upscale(dataUrl, scale, useAi)
      setDataUrl(result)
      notify.success(`Upscaled ${scale}×`)
    } catch (error) {
      notify.error('Upscaling failed', error instanceof Error ? error.message : undefined)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Modal
      title="AI image generator"
      subtitle={aiStatus?.capabilities.image.configured ? undefined : 'Add an image provider key to enable generation.'}
      onClose={onClose}
      width={820}
      busy={busy !== null}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy !== null}>
            Cancel
          </Button>
          <Button icon={ImagePlus} disabled={busy !== null || !prompt.trim()} onClick={() => void generate()}>
            {busy === 'generate' ? 'Generating…' : dataUrl ? 'Regenerate' : 'Generate'}
          </Button>
          <Button variant="primary" icon={Check} disabled={busy !== null || !dataUrl} onClick={() => void addToCanvas()}>
            Add to canvas
          </Button>
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 16 }}>
        <div className="k-col" style={{ gap: 12 }}>
          <Field label="Prompt">
            <textarea
              className="k-textarea"
              placeholder="Photorealistic mountain cabin at sunset"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              style={{ minHeight: 90 }}
            />
          </Field>
          <Field label="Avoid (optional)">
            <input className="k-input" value={negative} onChange={(event) => setNegative(event.target.value)} placeholder="text, watermark, blur" />
          </Field>
          <Field label="Aspect ratio">
            <Segmented
              value={aspect}
              options={[
                { value: '1:1', label: '1:1' },
                { value: '4:5', label: '4:5' },
                { value: '16:9', label: '16:9' },
                { value: '9:16', label: '9:16' },
                { value: '3:4', label: '3:4' }
              ]}
              onChange={setAspect}
            />
          </Field>
          <Field label="Style">
            <Select
              ariaLabel="Image style"
              value={style}
              options={[
                { value: 'none', label: 'Default' },
                { value: 'photographic', label: 'Photographic' },
                { value: 'digital-art', label: 'Digital art' },
                { value: 'anime', label: 'Anime' },
                { value: 'cinematic', label: 'Cinematic' },
                { value: '3d-model', label: '3D render' },
                { value: 'comic-book', label: 'Comic' }
              ]}
              onChange={setStyle}
            />
          </Field>
          <Toggle label="Transparent background (PNG)" checked={transparent} onChange={setTransparent} />
        </div>

        <div className="k-col" style={{ gap: 10 }}>
          <div
            className="k-panel k-checker"
            style={{ minHeight: 320, display: 'grid', placeItems: 'center', overflow: 'hidden', position: 'relative', background: 'var(--k-panel-2)' }}
          >
            {busy ? (
              <span className="k-row" style={{ gap: 8, color: 'var(--k-text-dim)' }}>
                <Loader2 size={15} className="k-spin" /> Working…
              </span>
            ) : null}
            {!busy && dataUrl ? (
              <img src={dataUrl} alt="Generated" style={{ maxWidth: '100%', maxHeight: 340, objectFit: 'contain' }} />
            ) : null}
            {!busy && !dataUrl ? (
              <div className="k-empty">
                <ImagePlus size={20} />
                <span>No image yet</span>
              </div>
            ) : null}
          </div>

          <div className="k-row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <Button size="sm" variant="ghost" icon={RefreshCw} disabled={!dataUrl || busy !== null} onClick={() => void generate()}>
              Regenerate
            </Button>
            <Button size="sm" variant="ghost" icon={ArrowUpRight} disabled={!dataUrl || busy !== null} onClick={() => void runUpscale(2)}>
              Upscale 2×
            </Button>
            <Button size="sm" variant="ghost" icon={ArrowUpRight} disabled={!dataUrl || busy !== null} onClick={() => void runUpscale(4)}>
              Upscale 4×
            </Button>
            <Button size="sm" variant="ghost" icon={Eraser} disabled={!dataUrl || busy !== null} onClick={() => void runRemoveBackground()}>
              Remove background
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={Download}
              disabled={!dataUrl}
              onClick={() => {
                if (!dataUrl) return
                const anchor = document.createElement('a')
                anchor.href = dataUrl
                anchor.download = 'kroma-ai-image.png'
                anchor.click()
              }}
            >
              Save PNG
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={Upload}
              onClick={() => {
                void (async () => {
                  const paths = await platform.dialogs.openImages()
                  if (!paths.length) return
                  const [asset] = await platform.assets.importFiles(paths.slice(0, 1))
                  if (!asset) return
                  const src = asset.storage === 'inline' && asset.data ? asset.data : assetUrl(asset.id)
                  setDataUrl(src)
                  setSourceSize({ width: asset.width ?? 0, height: asset.height ?? 0 })
                  notify.info('Image loaded — you can now remove its background or upscale it')
                })()
              }}
            >
              Load image
            </Button>
          </div>

          {dataUrl ? (
            <p style={{ fontSize: 11, color: 'var(--k-text-mute)', margin: 0 }}>
              {sourceSize ? `${sourceSize.width}×${sourceSize.height} · ` : ''}
              {formatBytes(Math.round((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75))}
              {' · '}Upscaling and background removal fall back to local processing when no provider key is set.
            </p>
          ) : null}
          <Slider label="Preview zoom" min={0.5} max={2} step={0.1} value={1} onChange={() => undefined} />
        </div>
      </div>
    </Modal>
  )
}
