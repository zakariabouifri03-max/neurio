import { useEffect, useMemo, useState } from 'react'
import { Upload, Trash2, Image as ImageIcon } from 'lucide-react'
import type { AssetRecord } from '../../../../shared/types/project'
import { Button } from '../ui/controls'
import { platform } from '../../platform'
import { assetUrl } from '../../../../shared/constants'
import { useEditorActions } from '../../hooks/useEditorActions'
import { useEditorStore } from '../../state/editor-store'
import { notify } from '../../state/ui-store'
import { isDesktopPlatform } from '../../platform/types'

export function UploadsPanel(): JSX.Element {
  const [assets, setAssets] = useState<AssetRecord[]>([])
  const [loading, setLoading] = useState(true)
  const actions = useEditorActions()
  const page = useEditorStore((state) => state.activePage())
  const [isDesktop] = useState(() => typeof window !== 'undefined' && Boolean(window.kroma))

  const refresh = async (): Promise<void> => {
    try {
      setAssets(await platform.assets.list())
    } catch {
      setAssets([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const importFiles = async (): Promise<void> => {
    try {
      if (!isDesktopPlatform(platform as never)) {
        notify.info('Drag images onto the canvas in the browser preview.')
        return
      }
      const paths = await platform.dialogs.openImages()
      if (paths.length === 0) return
      const imported = await platform.assets.importFiles(paths)
      setAssets(await platform.assets.list())
      notify.success(`Imported ${imported.length} image${imported.length > 1 ? 's' : ''}`)
      const first = imported[0]
      if (first && page) {
        actions.addImage(assetUrl(first.id), first.width && first.height ? { width: first.width, height: first.height } : undefined)
      }
    } catch (error) {
      notify.error('Import failed', error instanceof Error ? error.message : undefined)
    }
  }

  const addToCanvas = (asset: AssetRecord): void => {
    const src = asset.storage === 'inline' && asset.data ? asset.data : assetUrl(asset.id)
    actions.addImage(src, asset.width && asset.height ? { width: asset.width, height: asset.height } : undefined)
  }

  const remove = async (asset: AssetRecord): Promise<void> => {
    try {
      await platform.assets.remove(asset.id)
      setAssets(await platform.assets.list())
    } catch (error) {
      notify.error('Could not delete asset', error instanceof Error ? error.message : undefined)
    }
  }

  const grid = useMemo(() => assets, [assets])

  return (
    <div className="k-col" style={{ gap: 10, height: '100%' }}>
      <Button variant="primary" icon={Upload} onClick={() => void importFiles()}>
        Upload images
      </Button>
      <p style={{ fontSize: 11, color: 'var(--k-text-mute)', margin: 0 }}>
        PNG, JPG, WEBP, GIF, BMP or AVIF · up to 25 MB each. You can also drag files straight onto the canvas.
        {isDesktop ? '' : ' The browser preview supports drag & drop and paste.'}
      </p>

      <div className="k-scroll" style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, alignContent: 'start' }}>
        {loading ? <div className="k-empty">Loading uploads…</div> : null}
        {!loading && grid.length === 0 ? (
          <div className="k-empty" style={{ gridColumn: '1 / -1' }}>
            <ImageIcon size={18} />
            <span>No uploads yet</span>
          </div>
        ) : null}
        {grid.map((asset) => {
          const src = asset.storage === 'inline' && asset.data ? asset.data : assetUrl(asset.id)
          return (
            <div
              key={asset.id}
              className="k-panel"
              style={{ overflow: 'hidden', background: 'var(--k-panel-2)', border: '1px solid var(--k-line-soft)' }}
            >
              <button
                type="button"
                onClick={() => addToCanvas(asset)}
                className="k-checker"
                style={{
                  display: 'block',
                  width: '100%',
                  height: 86,
                  border: 0,
                  cursor: 'pointer',
                  background: `center / cover no-repeat url(${src})`,
                  padding: 0
                }}
                title={`Add ${asset.name} to canvas`}
              />
              <div className="k-row-between" style={{ padding: '5px 7px' }}>
                <span className="k-truncate" style={{ fontSize: 11, flex: 1 }}>{asset.name}</span>
                <button
                  type="button"
                  onClick={() => void remove(asset)}
                  style={{ background: 'none', border: 0, color: 'var(--k-text-mute)', cursor: 'pointer', padding: 0 }}
                  title="Delete asset"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
