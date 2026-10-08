import { useUiStore } from '../state/ui-store'
import { useAppStore } from '../state/app-store'
import { ExportModal } from './modals/ExportModal'
import { SettingsModal } from './modals/SettingsModal'
import { NewDesignModal } from './modals/NewDesignModal'
import { PreviewModal } from './modals/PreviewModal'
import { AiDesignModal } from './modals/AiDesignModal'
import { AiImageModal } from './modals/AiImageModal'
import { AiTextModal } from './modals/AiTextModal'
import { ImageOpsModal } from './modals/ImageOpsModal'
import { ShortcutsModal } from './modals/ShortcutsModal'

export function Modals(): JSX.Element | null {
  const modal = useUiStore((state) => state.modal)
  const data = useUiStore((state) => state.modalData)
  const close = useUiStore((state) => state.closeModal)
  const projectName = useAppStore((state) => state.currentProjectId)
  const projects = useAppStore((state) => state.projects)
  const name = projects.find((project) => project.id === projectName)?.name ?? 'Kroma design'

  switch (modal) {
    case 'export':
      return <ExportModal onClose={close} projectName={name} />
    case 'settings':
      return <SettingsModal onClose={close} initialSection={(data as { section?: string } | undefined)?.section} />
    case 'new-design':
      return <NewDesignModal onClose={close} />
    case 'preview':
      return <PreviewModal onClose={close} />
    case 'ai-design':
      return <AiDesignModal onClose={close} initialPrompt={(data as { prompt?: string } | undefined)?.prompt} />
    case 'ai-image':
      return <AiImageModal onClose={close} initialPrompt={(data as { prompt?: string } | undefined)?.prompt} />
    case 'ai-text':
      return <AiTextModal onClose={close} nodeId={(data as { nodeId?: string } | undefined)?.nodeId} initialText={(data as { text?: string } | undefined)?.text} />
    case 'image':
      return <ImageOpsModal onClose={close} nodeId={(data as { nodeId?: string } | undefined)?.nodeId} />
    case 'shortcuts':
      return <ShortcutsModal onClose={close} />
    default:
      return null
  }
}
