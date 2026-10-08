import { useCallback, useEffect, useState } from 'react'
import { AppShell } from './components/shell/AppShell'
import { WelcomeScreen } from './components/WelcomeScreen'
import { Modals } from './components/Modals'
import { Toasts } from './components/ui/Toasts'
import { useAppStore } from './state/app-store'
import { useEditorStore } from './state/editor-store'
import { useUiStore, notify } from './state/ui-store'
import { projectService } from './services/project-service'
import { platform } from './platform'
import { createDocument } from '../../shared/utils/document'
import { loadFonts } from './services/fonts'

interface Session {
  projectId: string
  name: string
}

export function App(): JSX.Element {
  const ready = useAppStore((state) => state.ready)
  const init = useAppStore((state) => state.init)
  const settings = useAppStore((state) => state.settings)
  const [session, setSession] = useState<Session | null>(null)
  const [booted, setBooted] = useState(false)

  useEffect(() => {
    void init()
  }, [init])

  useEffect(() => {
    void loadFonts()
  }, [])

  useEffect(() => {
    if (!ready) return
    const off = platform.system.onConnectivity((online) => useAppStore.getState().setOnline(online))
    return off
  }, [ready])

  /** Creates a project in storage so autosave has somewhere to write. */
  const startSession = useCallback(async (document: ReturnType<typeof createDocument>, name: string, remember = true): Promise<void> => {
    const project = await projectService.create({ name, width: document.pages[0].width, height: document.pages[0].height, document })
    useEditorStore.getState().loadDocument(document)
    useAppStore.getState().setCurrentProject(project.id)
    setSession({ projectId: project.id, name: project.name })
    if (remember) void useAppStore.getState().refreshProjects()
    void platform.settings.markFirstRunComplete()
  }, [])

  const createBlank = useCallback(async () => {
    try {
      await startSession(createDocument(1080, 1080), 'Untitled design')
      useUiStore.getState().requestFit()
    } catch (error) {
      notify.error('Could not create the design', error instanceof Error ? error.message : undefined)
    }
  }, [startSession])

  // First run: jump straight into a fresh design so the editor is usable immediately.
  useEffect(() => {
    if (!ready || booted) return
    setBooted(true)
    if (!settings.firstRunCompleted) {
      void createBlank()
    }
  }, [ready, booted, settings.firstRunCompleted, createBlank])

  useEffect(() => {
    const off = platform.system.onMenuAction((action) => {
      if (action === 'new-design') useUiStore.getState().openModal('new-design')
    })
    return off
  }, [])

  if (!ready) {
    return (
      <div style={{ height: '100%', display: 'grid', placeItems: 'center', background: 'var(--k-bg)' }}>
        <div className="k-col" style={{ alignItems: 'center', gap: 12 }}>
          <span className="k-spin" style={{ width: 22, height: 22 }} />
          <span style={{ color: 'var(--k-text-dim)', fontSize: 12.5 }}>Starting Kroma Studio…</span>
        </div>
      </div>
    )
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--k-bg)' }}>
      {session ? (
        <AppShell projectId={session.projectId} initialName={session.name} />
      ) : (
        <WelcomeScreen onCreateBlank={() => void createBlank()} />
      )}
      <Modals />
      <Toasts />
    </div>
  )
}
