import React from 'react';
import { TopBar } from './TopBar';
import { CanvasStage } from './CanvasStage';
import { RightPanel } from './RightPanel';
import { PagesBar } from './PagesBar';
import { ExportDialog } from './ExportDialog';
import { PreviewModal } from './PreviewModal';
import { useEditor, type LeftTab } from '@/state/editorStore';
import { Icon, type IconName } from '@/components/common/Icons';
import { TemplatesPanel } from '@/components/panels/TemplatesPanel';
import { ElementsPanel } from '@/components/panels/ElementsPanel';
import { TextPanel } from '@/components/panels/TextPanel';
import { UploadsPanel } from '@/components/panels/UploadsPanel';
import { AIPanel } from '@/components/panels/AIPanel';
import { BackgroundsPanel } from '@/components/panels/BackgroundsPanel';
import { ProjectsPanel } from '@/components/panels/ProjectsPanel';
import { BrandPanel } from '@/components/panels/BrandPanel';

const TABS: { id: LeftTab; label: string; icon: IconName }[] = [
  { id: 'templates', label: 'Templates', icon: 'templates' },
  { id: 'elements', label: 'Elements', icon: 'elements' },
  { id: 'text', label: 'Text', icon: 'text' },
  { id: 'uploads', label: 'Uploads', icon: 'uploads' },
  { id: 'ai', label: 'AI Tools', icon: 'ai' },
  { id: 'backgrounds', label: 'Background', icon: 'backgrounds' },
  { id: 'shapes', label: 'Shapes', icon: 'shapes' },
  { id: 'icons', label: 'Icons', icon: 'icons' },
  { id: 'projects', label: 'Projects', icon: 'projects' },
  { id: 'brand', label: 'Brand Kit', icon: 'brand' }
];

export function EditorScreen() {
  const leftTab = useEditor((s) => s.leftTab);
  const setLeftTab = useEditor((s) => s.setLeftTab);

  return (
    <>
      <TopBar />
      <div className="editor">
        <div className="rail">
          {TABS.map((t) => (
            <button key={t.id} className={leftTab === t.id ? 'active' : ''} onClick={() => setLeftTab(t.id)}>
              <Icon name={t.icon} />
              {t.label}
            </button>
          ))}
        </div>
        <div className="panel">
          {leftTab === 'templates' ? <TemplatesPanel /> : null}
          {leftTab === 'elements' ? <ElementsPanel /> : null}
          {leftTab === 'text' ? <TextPanel /> : null}
          {leftTab === 'uploads' ? <UploadsPanel /> : null}
          {leftTab === 'ai' ? <AIPanel /> : null}
          {leftTab === 'backgrounds' ? <BackgroundsPanel /> : null}
          {leftTab === 'shapes' ? <ElementsPanel only="shapes" /> : null}
          {leftTab === 'icons' ? <ElementsPanel only="icons" /> : null}
          {leftTab === 'projects' ? <ProjectsPanel /> : null}
          {leftTab === 'brand' ? <BrandPanel /> : null}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <CanvasStage />
          <PagesBar />
        </div>
        <RightPanel />
      </div>
      <ExportDialog />
      <PreviewModal />
    </>
  );
}
