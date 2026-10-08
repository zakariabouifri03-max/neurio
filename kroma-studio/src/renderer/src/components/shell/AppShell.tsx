import { EditorShell } from './EditorShell'

export function AppShell({ projectId, initialName }: { projectId: string; initialName: string }): JSX.Element {
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <EditorShell projectId={projectId} initialName={initialName} />
    </div>
  )
}
