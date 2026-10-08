import { useUiStore, type PanelRoute } from '../../state/ui-store'
import { TemplatesPanel } from '../panels/TemplatesPanel'
import { ElementsPanel } from '../panels/ElementsPanel'
import { TextPanel } from '../panels/TextPanel'
import { UploadsPanel } from '../panels/UploadsPanel'
import { AiPanel } from '../panels/AiPanel'
import { BackgroundsPanel } from '../panels/BackgroundsPanel'
import { ShapesPanel } from '../panels/ShapesPanel'
import { IconsPanel } from '../panels/IconsPanel'
import { ProjectsPanel } from '../panels/ProjectsPanel'
import { BrandKitPanel } from '../panels/BrandKitPanel'
import { LayersPanel } from '../panels/LayersPanel'

const TITLES: Record<PanelRoute, string> = {
  templates: 'Templates',
  elements: 'Elements',
  text: 'Text',
  uploads: 'Uploads',
  ai: 'AI Tools',
  backgrounds: 'Backgrounds',
  shapes: 'Shapes',
  icons: 'Icons',
  projects: 'Projects',
  brand: 'Brand Kit',
  layers: 'Layers',
  design: 'Design',
  image: 'Image'
}

const PANELS: Record<PanelRoute, () => JSX.Element> = {
  templates: TemplatesPanel,
  elements: ElementsPanel,
  text: TextPanel,
  uploads: UploadsPanel,
  ai: AiPanel,
  backgrounds: BackgroundsPanel,
  shapes: ShapesPanel,
  icons: IconsPanel,
  projects: ProjectsPanel,
  brand: BrandKitPanel,
  layers: LayersPanel,
  design: ElementsPanel,
  image: UploadsPanel
}

export function LeftPanel(): JSX.Element {
  const route = useUiStore((state) => state.leftPanel)
  const open = useUiStore((state) => state.leftPanelOpen)
  if (!open) return <></>
  const Panel = PANELS[route]
  return (
    <aside
      style={{
        width: 'var(--k-left)',
        flex: 'none',
        borderRight: '1px solid var(--k-line-soft)',
        background: 'var(--k-panel)',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0
      }}
    >
      <div style={{ padding: '12px 14px 8px' }}>
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 650 }}>{TITLES[route]}</h2>
      </div>
      <div style={{ flex: 1, minHeight: 0, padding: '4px 14px 14px', display: 'flex', flexDirection: 'column' }}>
        <Panel />
      </div>
    </aside>
  )
}
