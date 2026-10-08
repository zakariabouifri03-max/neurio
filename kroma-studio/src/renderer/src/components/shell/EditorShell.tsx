import { useCallback, useEffect, useRef, useState } from 'react'
import { useEditorStore } from '../../state/editor-store'
import { useAppStore } from '../../state/app-store'
import { useUiStore, notify } from '../../state/ui-store'
import { LeftRail } from './LeftRail'
import { LeftPanel } from './LeftPanel'
import { TopToolbar } from './TopToolbar'
import { PagesStrip } from './PagesStrip'
import { CanvasStage } from './CanvasStage'
import { PropertiesPanel } from '../properties/PropertiesPanel'
import { projectService } from '../../services/project-service'
import { platform } from '../../platform'
import { assetUrl, LIMITS } from '../../../../shared/constants'
import { newId } from '../../../../shared/utils/ids'

export interface EditorShellProps {
  projectId: string
  initialName: string
}

export function EditorShell({ projectId, initialName }: EditorShellProps): JSX.Element {
  const document = useEditorStore((state) => state.document)
  const dirty = useEditorStore((state) => state.dirty)
  const autoSave = useAppStore((state) => state.autoSaveEnabled)
  const autoSaveInterval = useAppStore((state) => state.settings.general.autoSaveIntervalMs)
  const setSaveState = useAppStore((state) => state.setSaveState)
  const refreshProjects = useAppStore((state) => state.refreshProjects)
  const rightOpen = useUiStore((state) => state.rightPanelOpen)

  const [name, setName] = useState(initialName)
  const saveTimer = useRef<number | null>(null)

  const save = useCallback(
    async (options?: { silent?: boolean }) => {
      const state = useEditorStore.getState()
      if (!state.document) return
      setSaveState('saving')
      try {
        await projectService.save({ id: projectId, name, document: state.document })
        state.markSaved()
        setSaveState('saved')
        void refreshProjects()
        if (!options?.silent) notify.success('Design saved')
      } catch (error) {
        setSaveState('error')
        notify.error('Could not save the design', error instanceof Error ? error.message : undefined)
      }
    },
    [name, projectId, refreshProjects, setSaveState]
  )

  /* ------------------------------- autosave ------------------------------ */

  useEffect(() => {
    if (!autoSave || !dirty) return
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      void save({ silent: true })
    }, Math.max(400, autoSaveInterval || LIMITS.AUTOSAVE_DEBOUNCE_MS))
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
    }
  }, [autoSave, dirty, autoSaveInterval, save, document])

  /* ----------------------------- import images --------------------------- */

  const importImages = useCallback(async (paths: string[], at?: { x: number; y: number }) => {
    try {
      const imported = await platform.assets.importFiles(paths)
      if (imported.length === 0) return
      const page = useEditorStore.getState().activePage()
      if (!page) return
      const { createImageNode } = await import('../../../../shared/utils/document')
      const nodes = imported.map((asset, index) => {
        const width = asset.width ?? 800
        const height = asset.height ?? 600
        const scale = Math.min((page.width * 0.7) / width, (page.height * 0.7) / height, 1)
        return createImageNode({
          src: assetUrl(asset.id),
          x: Math.round((at?.x ?? page.width / 2) - (width * scale) / 2 + index * 12),
          y: Math.round((at?.y ?? page.height / 2) - (height * scale) / 2 + index * 12),
          width: Math.round(width * scale),
          height: Math.round(height * scale),
          naturalWidth: width,
          naturalHeight: height
        })
      })
      useEditorStore.getState().addNodes(nodes)
      notify.success(`Added ${nodes.length} image${nodes.length > 1 ? 's' : ''}`)
    } catch (error) {
      notify.error('Unsupported image format', error instanceof Error ? error.message : undefined)
    }
  }, [])

  /* --------------------------- data-URL drops ---------------------------- */

  const importDropped = useCallback(async (paths: string[], at?: { x: number; y: number }) => {
    // In the browser preview the "paths" are object URLs; in Electron they are files.
    const isData = (value: string): boolean => value.startsWith('data:image/')
    const files = paths.filter((path) => !isData(path) && !path.startsWith('kroma-asset://'))
    const dataUrls = paths.filter(isData)
    if (files.length) await importImages(files, at)
    for (const dataUrl of dataUrls) {
      try {
        const asset = await platform.assets.importDataUrl(dataUrl, `dropped-${newId('im')}.png`)
        useEditorStore.getState().addNodes([
          {
            id: newId('im'),
            kind: 'image',
            name: 'Dropped image',
            visible: true,
            locked: false,
            x: (at?.x ?? 0) - 150,
            y: (at?.y ?? 0) - 150,
            width: 300,
            height: 300,
            rotation: 0,
            opacity: 1,
            src: asset.storage === 'inline' && asset.data ? asset.data : assetUrl(asset.id),
            fit: 'cover'
          }
        ])
      } catch (error) {
        notify.error('Unsupported image format', error instanceof Error ? error.message : undefined)
      }
    }
  }, [importImages])

  /* ------------------------------ menu events ---------------------------- */

  useEffect(() => {
    const off = platform.system.onMenuAction((action) => {
      const state = useEditorStore.getState()
      const ui = useUiStore.getState()
      switch (action) {
        case 'undo':
          state.undo()
          break
        case 'redo':
          state.redo()
          break
        case 'save':
          void save()
          break
        case 'export':
          ui.openModal('export')
          break
        case 'preview':
          ui.openModal('preview')
          break
        case 'copy':
          state.selection.length ? state.duplicateSelection() : undefined
          break
        case 'duplicate':
          state.duplicateSelection()
          break
        case 'delete':
          state.deleteNodes()
          break
        case 'select-all':
          state.selectAll()
          break
        case 'group':
          state.groupSelection()
          break
        case 'ungroup':
          state.ungroupSelection()
          break
        case 'new-design':
          ui.openModal('new-design')
          break
        case 'open-project':
          ui.setLeftPanel('projects')
          break
        case 'settings':
          ui.openModal('settings')
          break
        default:
          break
      }
    })
    return off
  }, [save])

  /* ---------------------------- global shortcuts -------------------------- */

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      const meta = event.ctrlKey || event.metaKey
      if (meta && event.key.toLowerCase() === 'e') {
        event.preventDefault()
        useUiStore.getState().openModal('export')
      } else if (meta && event.key.toLowerCase() === 'p') {
        event.preventDefault()
        useUiStore.getState().openModal('preview')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!document) {
    return (
      <div className="k-empty" style={{ height: '100%' }}>
        <span>No design loaded</span>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <TopToolbar projectName={name} onProjectNameChange={setName} onSave={() => void save()} />
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <LeftRail />
        <LeftPanel />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
          <CanvasStage document={document} onSave={() => void save()} onOpenImage={(paths, at) => void importDropped(paths, at)} />
          <PagesStrip />
        </div>
        {rightOpen ? (
          <aside
            style={{
              width: 'var(--k-right)',
              flex: 'none',
              borderLeft: '1px solid var(--k-line-soft)',
              background: 'var(--k-panel)',
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0
            }}
          >
            <div style={{ padding: '12px 14px 8px' }}>
              <h2 style={{ margin: 0, fontSize: 14, fontWeight: 650 }}>Properties</h2>
            </div>
            <div className="k-scroll" style={{ flex: 1, minHeight: 0, padding: '4px 14px 16px' }}>
              <PropertiesPanel />
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  )
}
