import { useState } from 'react'
import { Sparkles, ImagePlus, Wand2, Type, Eraser, ArrowUpRight, KeyRound } from 'lucide-react'
import { Button } from '../ui/controls'
import { useUiStore } from '../../state/ui-store'
import { useAppStore } from '../../state/app-store'
import { ai } from '../../services/ai-facade'
import { notify } from '../../state/ui-store'

export function AiPanel(): JSX.Element {
  const openModal = useUiStore((state) => state.openModal)
  const settings = useAppStore((state) => state.settings)
  const aiStatus = useAppStore((state) => state.aiStatus)
  const online = useAppStore((state) => state.online)
  const [prompt, setPrompt] = useState('')

  const configured = Boolean(aiStatus?.anyKeyStored)
  const textReady = aiStatus ? ai.capabilityReady(aiStatus, 'text') : false
  const imageReady = aiStatus ? ai.capabilityReady(aiStatus, 'image') : false

  const quickGenerate = async (): Promise<void> => {
    if (!prompt.trim()) {
      notify.warning('Describe the design you want first.')
      return
    }
    openModal('ai-design', { prompt })
  }

  return (
    <div className="k-col" style={{ gap: 12, height: '100%' }}>
      <div className="k-row" style={{ gap: 6 }}>
        <span className={`k-chip ${online ? 'k-chip--ok' : 'k-chip--warn'}`}>{online ? 'AI Online' : 'Offline Mode'}</span>
        {configured ? (
          <span className="k-chip k-chip--ok">{Object.keys(settings.ai.providers).length} provider(s)</span>
        ) : (
          <span className="k-chip k-chip--warn">No API key</span>
        )}
      </div>

      <div className="k-field">
        <label>Quick prompt</label>
        <textarea
          className="k-textarea"
          placeholder="e.g. vintage Halloween t-shirt design with a cute raccoon"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void quickGenerate()
          }}
        />
      </div>
      <Button variant="primary" icon={Sparkles} onClick={() => void quickGenerate()}>
        Generate design
      </Button>

      <div className="k-sep" />
      <span className="k-section-title">AI tools</span>
      <div className="k-col" style={{ gap: 6 }}>
        <ToolRow
          icon={Wand2}
          label="AI design generator"
          hint="Full layout from a prompt"
          ready={textReady}
          offlineNote="Offline layouts always work"
          onClick={() => openModal('ai-design')}
        />
        <ToolRow
          icon={ImagePlus}
          label="Image generator"
          hint="Text → image, upscale"
          ready={imageReady}
          offlineNote="Needs an image provider key"
          onClick={() => openModal('ai-image')}
        />
        <ToolRow
          icon={Type}
          label="Text tools"
          hint="Headlines, rewrites, captions"
          ready={textReady}
          offlineNote="Offline copy engine"
          onClick={() => openModal('ai-text')}
        />
        <ToolRow
          icon={Eraser}
          label="Background remover"
          hint="Transparent PNG in one click"
          ready={aiStatus ? ai.capabilityReady(aiStatus, 'background') : false}
          offlineNote="Local engine works offline"
          onClick={() => openModal('image')}
        />
        <ToolRow
          icon={ArrowUpRight}
          label="Upscaler"
          hint="2× / 3× / 4× enlarger"
          ready={aiStatus ? ai.capabilityReady(aiStatus, 'upscale') : false}
          offlineNote="Local 2× resampler"
          onClick={() => openModal('image', { tab: 'upscale' })}
        />
      </div>

      <div className="k-sep" />
      <Button size="sm" icon={KeyRound} onClick={() => openModal('settings', { section: 'ai' })}>
        Configure providers
      </Button>
      <p style={{ fontSize: 11, color: 'var(--k-text-mute)', margin: 0 }}>
        Keys stay in the desktop app and are encrypted with the OS keychain. Nothing is sent anywhere unless you configure a provider.
      </p>
    </div>
  )
}

function ToolRow({
  icon: Icon,
  label,
  hint,
  ready,
  offlineNote,
  onClick
}: {
  icon: typeof Sparkles
  label: string
  hint: string
  ready: boolean
  offlineNote: string
  onClick: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="k-panel k-row"
      style={{
        gap: 10,
        padding: '9px 10px',
        cursor: 'pointer',
        background: 'var(--k-panel-2)',
        border: '1px solid var(--k-line-soft)',
        textAlign: 'left',
        width: '100%'
      }}
    >
      <span
        style={{
          width: 30,
          height: 30,
          borderRadius: 9,
          display: 'grid',
          placeItems: 'center',
          background: 'rgb(124 92 255 / 0.16)',
          color: 'var(--k-accent-2)',
          flex: 'none'
        }}
      >
        <Icon size={15} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600 }}>{label}</span>
        <span style={{ display: 'block', fontSize: 11, color: 'var(--k-text-mute)' }}>{hint}</span>
      </span>
      <span className={`k-chip ${ready ? 'k-chip--ok' : ''}`} title={offlineNote}>
        {ready ? 'AI' : 'Local'}
      </span>
    </button>
  )
}
