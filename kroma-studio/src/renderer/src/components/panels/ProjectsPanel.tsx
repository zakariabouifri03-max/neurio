import { useEffect, useMemo, useState } from 'react'
import { Search, Copy, Trash2, Pencil, FolderOpen, Plus } from 'lucide-react'
import type { ProjectMeta } from '../../../../shared/types/project'
import { Button } from '../ui/controls'
import { platform } from '../../platform'
import { assetUrl } from '../../../../shared/constants'
import { projectService } from '../../services/project-service'
import { useUiStore, notify } from '../../state/ui-store'
import { useEditorStore } from '../../state/editor-store'
import { useAppStore } from '../../state/app-store'
import { formatRelative } from '../../lib/format'

export function ProjectsPanel(): JSX.Element {
  const [projects, setProjects] = useState<ProjectMeta[]>([])
  const [query, setQuery] = useState('')
  const [renaming, setRenaming] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const refreshProjects = useAppStore((state) => state.refreshProjects)

  const refresh = async (): Promise<void> => {
    setProjects(await platform.projects.list())
  }

  useEffect(() => {
    void refresh()
  }, [])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return projects
    return projects.filter((project) => project.name.toLowerCase().includes(needle))
  }, [projects, query])

  const open = async (project: ProjectMeta): Promise<void> => {
    try {
      const result = await projectService.open(project.id)
      if (!result) {
        notify.error('That project could not be opened.')
        return
      }
      useEditorStore.getState().loadDocument(result.document)
      useAppStore.getState().setCurrentProject(project.id)
      useUiStore.getState().requestFit()
      notify.success(`Opened “${project.name}”`)
    } catch (error) {
      notify.error('Could not open project', error instanceof Error ? error.message : undefined)
    }
  }

  return (
    <div className="k-col" style={{ gap: 10, height: '100%' }}>
      <div className="k-row" style={{ gap: 6 }}>
        <Button size="sm" variant="primary" icon={Plus} onClick={() => useUiStore.getState().openModal('new-design')}>
          New design
        </Button>
        <Button size="sm" icon={FolderOpen} onClick={() => void refresh()}>
          Refresh
        </Button>
      </div>
      <div className="k-row" style={{ position: 'relative' }}>
        <Search size={13} color="var(--k-text-mute)" style={{ position: 'absolute', left: 9 }} />
        <input
          className="k-input"
          placeholder="Search projects"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          style={{ paddingLeft: 26 }}
        />
      </div>

      <div className="k-scroll" style={{ flex: 1, display: 'grid', gap: 6, alignContent: 'start' }}>
        {filtered.length === 0 ? (
          <div className="k-empty">
            <FolderOpen size={18} />
            <span>No projects yet</span>
            <span style={{ fontSize: 11 }}>Create a blank design or start from a template.</span>
          </div>
        ) : null}
        {filtered.map((project) => (
          <div
            key={project.id}
            className="k-panel k-row"
            style={{ gap: 10, padding: 8, background: 'var(--k-panel-2)', border: '1px solid var(--k-line-soft)', cursor: 'pointer' }}
            onClick={() => void open(project)}
          >
            <div
              className="k-checker"
              style={{
                width: 46,
                height: 46,
                borderRadius: 8,
                flex: 'none',
                background: project.thumbnailId
                  ? `center / cover no-repeat url(${assetUrl(project.thumbnailId)})`
                  : 'var(--k-panel-3)',
                border: '1px solid var(--k-line)'
              }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              {renaming === project.id ? (
                <input
                  className="k-input"
                  style={{ height: 26 }}
                  value={draft}
                  autoFocus
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) => setDraft(event.target.value)}
                  onBlur={() => {
                    void (async () => {
                      if (draft.trim() && draft !== project.name) {
                        await projectService.rename(project.id, draft.trim())
                        await refresh()
                        void refreshProjects()
                      }
                      setRenaming(null)
                    })()
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
                  }}
                />
              ) : (
                <div className="k-truncate" style={{ fontSize: 12.5, fontWeight: 600 }}>{project.name}</div>
              )}
              <div style={{ fontSize: 10.5, color: 'var(--k-text-mute)' }}>
                {project.pageCount} page{project.pageCount > 1 ? 's' : ''} · {project.width}×{project.height} · {formatRelative(project.updatedAt)}
              </div>
            </div>
            <div className="k-row" style={{ gap: 2 }}>
              <button
                type="button"
                title="Rename"
                onClick={(event) => {
                  event.stopPropagation()
                  setRenaming(project.id)
                  setDraft(project.name)
                }}
                style={iconButtonStyle}
              >
                <Pencil size={12} />
              </button>
              <button
                type="button"
                title="Duplicate"
                onClick={(event) => {
                  event.stopPropagation()
                  void (async () => {
                    await projectService.duplicate(project.id)
                    await refresh()
                    void refreshProjects()
                    notify.success('Project duplicated')
                  })()
                }}
                style={iconButtonStyle}
              >
                <Copy size={12} />
              </button>
              <button
                type="button"
                title="Delete"
                onClick={(event) => {
                  event.stopPropagation()
                  void (async () => {
                    await projectService.remove(project.id)
                    await refresh()
                    void refreshProjects()
                    notify.info('Project deleted')
                  })()
                }}
                style={{ ...iconButtonStyle, color: 'var(--k-danger)' }}
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

const iconButtonStyle: React.CSSProperties = {
  background: 'none',
  border: 0,
  color: 'var(--k-text-mute)',
  cursor: 'pointer',
  padding: 4,
  borderRadius: 5
}
