import { useState } from 'react'
import { Wand2, Loader2, Check, Copy } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { Button, Field, Slider } from '../ui/controls'
import { ai } from '../../services/ai-facade'
import { useEditorStore } from '../../state/editor-store'
import { useAppStore } from '../../state/app-store'
import { notify } from '../../state/ui-store'
import type { AiTextTask } from '../../../../shared/types/ai'

const TASKS: Array<{ value: AiTextTask; label: string }> = [
  { value: 'headline', label: 'Generate headline' },
  { value: 'rewrite', label: 'Rewrite text' },
  { value: 'shorten', label: 'Make shorter' },
  { value: 'expand', label: 'Make longer' },
  { value: 'professional', label: 'Professional tone' },
  { value: 'funny', label: 'Funny tone' },
  { value: 'marketing', label: 'Marketing copy' },
  { value: 'product', label: 'Product description' },
  { value: 'slogans', label: 'Generate slogans' },
  { value: 'captions', label: 'Social captions' }
]

export function AiTextModal({
  onClose,
  nodeId,
  initialText
}: {
  onClose: () => void
  nodeId?: string
  initialText?: string
}): JSX.Element {
  const [task, setTask] = useState<AiTextTask>('headline')
  const [brief, setBrief] = useState('')
  const [sourceText, setSourceText] = useState(initialText ?? '')
  const [count, setCount] = useState(3)
  const [busy, setBusy] = useState(false)
  const [variants, setVariants] = useState<string[]>([])
  const [offline, setOffline] = useState(false)
  const aiStatus = useAppStore((state) => state.aiStatus)

  const run = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await ai.text({
        task,
        prompt: brief.trim() || (task === 'headline' || task === 'slogans' || task === 'captions' ? sourceText : sourceText),
        sourceText: sourceText.trim() || undefined,
        count
      })
      setVariants(result.variants)
      setOffline(result.offline)
    } catch (error) {
      notify.error('Text generation failed', error instanceof Error ? error.message : undefined)
    } finally {
      setBusy(false)
    }
  }

  const apply = async (text: string): Promise<void> => {
    const state = useEditorStore.getState()
    if (nodeId) {
      state.updateNodes([{ id: nodeId, patch: { text } as never }], { label: 'ai text' })
      notify.success('Text applied')
      onClose()
      return
    }
    if (state.selection.length > 0) {
      const patches = state.selection.map((id) => ({ id, patch: { text } as never }))
      state.updateNodes(patches, { label: 'ai text' })
      notify.success('Text applied to selection')
      onClose()
      return
    }
    await navigator.clipboard.writeText(text).catch(() => undefined)
    notify.info('Copied — select a text object to apply it')
  }

  return (
    <Modal
      title="AI text tools"
      subtitle={
        aiStatus?.capabilities.text.configured && !offline
          ? 'Using your configured provider'
          : 'Using the offline copy engine — add a provider key in Settings for AI copy'
      }
      onClose={onClose}
      width={620}
      busy={busy}
      footer={
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Close
        </Button>
      }
    >
      <div className="k-col" style={{ gap: 12 }}>
        <Field label="Task">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {TASKS.map((entry) => (
              <button
                key={entry.value}
                type="button"
                className="k-btn"
                onClick={() => setTask(entry.value)}
                style={{
                  justifyContent: 'flex-start',
                  background: task === entry.value ? 'rgb(124 92 255 / 0.16)' : undefined,
                  borderColor: task === entry.value ? 'var(--k-accent)' : undefined,
                  color: task === entry.value ? 'var(--k-accent-2)' : undefined
                }}
              >
                {entry.label}
              </button>
            ))}
          </div>
        </Field>

        {task === 'headline' || task === 'slogans' || task === 'captions' || task === 'marketing' || task === 'product' ? (
          <Field label="What is it about?">
            <input
              className="k-input"
              placeholder="e.g. Halloween t-shirt with a cute raccoon"
              value={brief}
              onChange={(event) => setBrief(event.target.value)}
            />
          </Field>
        ) : null}

        <Field label="Text to work from">
          <textarea
            className="k-textarea"
            value={sourceText}
            onChange={(event) => setSourceText(event.target.value)}
            placeholder="Paste or edit the text here"
            style={{ minHeight: 80 }}
          />
        </Field>

        <Slider label="Variants" min={1} max={6} value={count} onChange={setCount} />

        <Button variant="primary" icon={busy ? Loader2 : Wand2} disabled={busy} onClick={() => void run()}>
          {busy ? 'Working…' : 'Generate'}
        </Button>

        {variants.length > 0 ? (
          <div className="k-col" style={{ gap: 6 }}>
            {offline ? <span className="k-chip k-chip--warn">Offline engine</span> : null}
            {variants.map((variant, index) => (
              <div key={index} className="k-panel k-row" style={{ gap: 8, padding: 10, background: 'var(--k-panel-2)' }}>
                <span style={{ flex: 1, fontSize: 12.5, lineHeight: 1.5 }}>{variant}</span>
                <Button size="sm" variant="ghost" icon={Copy} onClick={() => void navigator.clipboard.writeText(variant).then(() => notify.info('Copied'))} title="Copy">
                  Copy
                </Button>
                <Button size="sm" variant="primary" icon={Check} onClick={() => void apply(variant)}>
                  Apply
                </Button>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </Modal>
  )
}
