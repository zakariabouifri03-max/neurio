import { useMemo, useState } from 'react'
import { Sparkles, LayoutTemplate, Plus } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { Button, Field, NumberInput, Segmented } from '../ui/controls'
import { DESIGN_SIZE_PRESETS } from '../../../../shared/constants'
import { useEditorStore } from '../../state/editor-store'
import { useUiStore, notify } from '../../state/ui-store'
import { useAppStore } from '../../state/app-store'
import { projectService } from '../../services/project-service'
import { createDocument } from '../../../../shared/utils/document'

export function NewDesignModal({ onClose }: { onClose: () => void }): JSX.Element {
  const [tab, setTab] = useState<'blank' | 'template' | 'ai'>('blank')
  const [width, setWidth] = useState(1080)
  const [height, setHeight] = useState(1080)
  const [name, setName] = useState('Untitled design')
  const [groupId, setGroupId] = useState('Social')
  const [busy, setBusy] = useState(false)
  const refreshProjects = useAppStore((state) => state.refreshProjects)

  const groups = useMemo(() => [...new Set(DESIGN_SIZE_PRESETS.map((preset) => preset.group))], [])
  const presets = DESIGN_SIZE_PRESETS.filter((preset) => preset.group === groupId)

  const create = async (): Promise<void> => {
    setBusy(true)
    try {
      const project = await projectService.create({ name: name.trim() || 'Untitled design', width, height })
      useEditorStore.getState().loadDocument(createDocument(width, height))
      useAppStore.getState().setCurrentProject(project.id)
      useUiStore.getState().requestFit()
      void refreshProjects()
      notify.success('New design created')
      onClose()
    } catch (error) {
      notify.error('Could not create the design', error instanceof Error ? error.message : undefined)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Create a new design"
      subtitle="Everything is stored locally on this computer."
      onClose={onClose}
      width={640}
      busy={busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          {tab === 'blank' ? (
            <Button variant="primary" icon={Plus} disabled={busy} onClick={() => void create()}>
              Create design
            </Button>
          ) : null}
        </>
      }
    >
      <div className="k-col" style={{ gap: 14 }}>
        <Segmented
          value={tab}
          options={[
            { value: 'blank', label: 'Blank', icon: Plus },
            { value: 'template', label: 'From template', icon: LayoutTemplate },
            { value: 'ai', label: 'AI generate', icon: Sparkles }
          ]}
          onChange={setTab}
        />

        {tab === 'blank' ? (
          <>
            <Field label="Design name">
              <input className="k-input" value={name} onChange={(event) => setName(event.target.value)} placeholder="Untitled design" />
            </Field>
            <Field label="Category">
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {groups.map((group) => (
                  <button
                    key={group}
                    type="button"
                    className="k-chip"
                    onClick={() => setGroupId(group)}
                    style={{
                      cursor: 'pointer',
                      color: groupId === group ? 'var(--k-accent-2)' : undefined,
                      borderColor: groupId === group ? 'var(--k-accent)' : undefined
                    }}
                  >
                    {group}
                  </button>
                ))}
              </div>
            </Field>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 7 }}>
              {presets.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => {
                    setWidth(preset.width)
                    setHeight(preset.height)
                    if (name === 'Untitled design') setName(preset.label)
                  }}
                  className="k-panel"
                  style={{
                    padding: '10px 8px',
                    cursor: 'pointer',
                    background: width === preset.width && height === preset.height ? 'rgb(124 92 255 / 0.14)' : 'var(--k-panel-2)',
                    border: `1px solid ${width === preset.width && height === preset.height ? 'var(--k-accent)' : 'var(--k-line-soft)'}`
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{preset.label}</div>
                  <div className="k-mono" style={{ fontSize: 10.5, color: 'var(--k-text-mute)', marginTop: 2 }}>
                    {preset.width}×{preset.height}
                  </div>
                </button>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Field label="Width">
                <NumberInput value={width} min={16} max={12000} onChange={setWidth} />
              </Field>
              <Field label="Height">
                <NumberInput value={height} min={16} max={12000} onChange={setHeight} />
              </Field>
            </div>
          </>
        ) : null}

        {tab === 'template' ? (
          <div className="k-col" style={{ gap: 8 }}>
            <p style={{ fontSize: 12.5, color: 'var(--k-text-dim)', margin: 0 }}>
              Templates are grouped by platform in the left sidebar. Pick a category to browse.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 7 }}>
              {['YouTube', 'Instagram', 'TikTok', 'Facebook', 'Posters', 'Flyers', 'Business', 'T-Shirts', 'Logos', 'Presentations', 'Wallpapers'].map((category) => (
                <button
                  key={category}
                  type="button"
                  className="k-btn"
                  onClick={() => {
                    useUiStore.getState().setLeftPanel('templates')
                    onClose()
                    notify.info(`Showing ${category} templates in the sidebar`)
                  }}
                >
                  {category}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {tab === 'ai' ? (
          <div className="k-col" style={{ gap: 8 }}>
            <p style={{ fontSize: 12.5, color: 'var(--k-text-dim)', margin: 0 }}>
              Describe what you need and the design generator will build a full layout — headline, copy, palette, shapes and
              optionally an AI hero image.
            </p>
            <Button
              variant="primary"
              icon={Sparkles}
              onClick={() => {
                onClose()
                useUiStore.getState().openModal('ai-design')
              }}
            >
              Open AI design generator
            </Button>
          </div>
        ) : null}
      </div>
    </Modal>
  )
}
