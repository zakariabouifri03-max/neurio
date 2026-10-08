import { useEffect, useMemo, useState } from 'react'
import { Sparkles, LayoutTemplate, Plus, ArrowRight, Clock, Trash2, Copy, WifiOff, Wifi } from 'lucide-react'
import { Button } from './ui/controls'
import { useAppStore } from '../state/app-store'
import { useEditorStore } from '../state/editor-store'
import { useUiStore, notify } from '../state/ui-store'
import { projectService } from '../services/project-service'
import { assetUrl } from '../../../shared/constants'
import { formatRelative } from '../lib/format'

export interface WelcomeScreenProps {
  onCreateBlank: () => void
}

export function WelcomeScreen({ onCreateBlank }: WelcomeScreenProps): JSX.Element {
  const projects = useAppStore((state) => state.projects)
  const online = useAppStore((state) => state.online)
  const refreshProjects = useAppStore((state) => state.refreshProjects)
  const [prompt, setPrompt] = useState('')

  useEffect(() => {
    void refreshProjects()
  }, [refreshProjects])

  const recent = useMemo(() => projects.slice(0, 6), [projects])

  const openProject = async (id: string): Promise<void> => {
    try {
      const result = await projectService.open(id)
      if (!result) {
        notify.error('That project could not be opened.')
        return
      }
      useEditorStore.getState().loadDocument(result.document)
      useAppStore.getState().setCurrentProject(id)
      useUiStore.getState().requestFit()
    } catch (error) {
      notify.error('Could not open project', error instanceof Error ? error.message : undefined)
    }
  }

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'radial-gradient(circle at 22% 18%, #1d1b32 0%, #0a0a11 62%)',
        overflow: 'auto'
      }}
    >
      <header className="k-row-between" style={{ padding: '16px 22px' }}>
        <div className="k-row" style={{ gap: 10 }}>
          <span
            style={{
              width: 32,
              height: 32,
              borderRadius: 9,
              background: 'linear-gradient(135deg, var(--k-accent-2), var(--k-accent))',
              display: 'grid',
              placeItems: 'center'
            }}
          >
            <Sparkles size={16} color="#fff" />
          </span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14.5 }}>Kroma Studio</div>
            <div style={{ fontSize: 11, color: 'var(--k-text-mute)' }}>Design anything. Offline-first. AI-assisted.</div>
          </div>
        </div>
        <div className="k-row" style={{ gap: 8 }}>
          <span className={`k-chip ${online ? 'k-chip--ok' : 'k-chip--warn'}`}>
            {online ? <Wifi size={11} /> : <WifiOff size={11} />}
            {online ? 'AI Online' : 'Offline Mode'}
          </span>
          <Button variant="ghost" onClick={() => useUiStore.getState().openModal('settings')}>
            Settings
          </Button>
        </div>
      </header>

      <main style={{ flex: 1, padding: '24px 22px 40px', maxWidth: 1080, width: '100%', margin: '0 auto' }}>
        <h1 style={{ fontSize: 30, margin: '10px 0 6px', letterSpacing: -0.5 }}>Create your first design</h1>
        <p style={{ color: 'var(--k-text-dim)', margin: '0 0 22px', maxWidth: 620 }}>
          A full design studio that runs entirely on this computer. Start blank, pick an original template, or let the AI
          generator compose a layout you can edit object by object.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          <ActionCard
            icon={Plus}
            title="Create blank design"
            hint="Pick a size and start from an empty canvas"
            onClick={onCreateBlank}
          />
          <ActionCard
            icon={LayoutTemplate}
            title="Choose template"
            hint="Original templates for every platform"
            onClick={() => {
              onCreateBlank()
              useUiStore.getState().setLeftPanel('templates')
            }}
          />
          <ActionCard
            icon={Sparkles}
            title="AI generate"
            hint="Describe it — get an editable layout"
            onClick={() => {
              onCreateBlank()
              useUiStore.getState().openModal('ai-design', { prompt })
            }}
          />
        </div>

        <div className="k-panel" style={{ marginTop: 18, padding: 16, background: 'rgba(21,21,31,0.7)' }}>
          <div className="k-row" style={{ gap: 8 }}>
            <input
              className="k-input"
              placeholder="Or describe your idea here, e.g. “vintage Halloween t-shirt with a cute raccoon”"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && prompt.trim()) {
                  onCreateBlank()
                  useUiStore.getState().openModal('ai-design', { prompt })
                }
              }}
              style={{ flex: 1 }}
            />
            <Button
              variant="primary"
              icon={ArrowRight}
              disabled={!prompt.trim()}
              onClick={() => {
                onCreateBlank()
                useUiStore.getState().openModal('ai-design', { prompt })
              }}
            >
              Generate
            </Button>
          </div>
        </div>

        <div className="k-row-between" style={{ marginTop: 28, marginBottom: 10 }}>
          <h2 className="k-row" style={{ fontSize: 15, margin: 0, gap: 7 }}>
            <Clock size={15} /> Recent designs
          </h2>
          <Button size="sm" variant="ghost" onClick={() => void refreshProjects()}>
            Refresh
          </Button>
        </div>

        {recent.length === 0 ? (
          <div className="k-panel" style={{ padding: 26, textAlign: 'center', color: 'var(--k-text-mute)' }}>
            No designs yet — your work will appear here automatically.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            {recent.map((project) => (
              <div
                key={project.id}
                className="k-panel"
                style={{ overflow: 'hidden', cursor: 'pointer', background: 'var(--k-panel-2)', border: '1px solid var(--k-line-soft)' }}
                onClick={() => void openProject(project.id)}
              >
                <div
                  className="k-checker"
                  style={{
                    height: 132,
                    background: project.thumbnailId
                      ? `center / cover no-repeat url(${assetUrl(project.thumbnailId)})`
                      : 'linear-gradient(135deg, #23233a, #14141f)'
                  }}
                />
                <div className="k-row-between" style={{ padding: '9px 10px' }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="k-truncate" style={{ fontSize: 12.5, fontWeight: 600 }}>{project.name}</div>
                    <div style={{ fontSize: 10.5, color: 'var(--k-text-mute)' }}>
                      {project.pageCount} page{project.pageCount > 1 ? 's' : ''} · {formatRelative(project.updatedAt)}
                    </div>
                  </div>
                  <div className="k-row" style={{ gap: 2 }}>
                    <button
                      type="button"
                      title="Duplicate"
                      onClick={(event) => {
                        event.stopPropagation()
                        void projectService.duplicate(project.id).then(() => refreshProjects())
                      }}
                      style={miniButton}
                    >
                      <Copy size={12} />
                    </button>
                    <button
                      type="button"
                      title="Delete"
                      onClick={(event) => {
                        event.stopPropagation()
                        void projectService.remove(project.id).then(() => refreshProjects())
                      }}
                      style={{ ...miniButton, color: 'var(--k-danger)' }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <p style={{ marginTop: 26, fontSize: 11.5, color: 'var(--k-text-mute)', textAlign: 'center' }}>
          Designs are saved locally as readable JSON. Configure AI providers any time in Settings → AI Providers.
        </p>
      </main>
    </div>
  )
}

const miniButton: React.CSSProperties = {
  background: 'none',
  border: 0,
  color: 'var(--k-text-mute)',
  cursor: 'pointer',
  padding: 4,
  borderRadius: 5
}

function ActionCard({
  icon: Icon,
  title,
  hint,
  onClick
}: {
  icon: typeof Plus
  title: string
  hint: string
  onClick: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="k-panel"
      style={{
        padding: 18,
        textAlign: 'left',
        cursor: 'pointer',
        background: 'rgba(21,21,31,0.75)',
        border: '1px solid var(--k-line-soft)',
        transition: 'transform 130ms var(--k-ease), border-color 130ms'
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.transform = 'translateY(-3px)'
        event.currentTarget.style.borderColor = 'var(--k-accent)'
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.transform = 'none'
        event.currentTarget.style.borderColor = 'var(--k-line-soft)'
      }}
    >
      <span
        style={{
          width: 38,
          height: 38,
          borderRadius: 11,
          display: 'grid',
          placeItems: 'center',
          background: 'rgb(124 92 255 / 0.16)',
          color: 'var(--k-accent-2)',
          marginBottom: 10
        }}
      >
        <Icon size={18} />
      </span>
      <div style={{ fontWeight: 650, fontSize: 13.5 }}>{title}</div>
      <div style={{ fontSize: 11.5, color: 'var(--k-text-dim)', marginTop: 3 }}>{hint}</div>
    </button>
  )
}
