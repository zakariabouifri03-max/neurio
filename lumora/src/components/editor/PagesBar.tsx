import React from 'react';
import { useEditor } from '@/state/editorStore';
import { Icon } from '@/components/common/Icons';

export function PagesBar() {
  const { project, activePage, gotoPage, addPage, duplicatePage, deletePage, movePage } = useEditor();
  if (!project) return null;

  return (
    <div className="pagesbar">
      <span className="muted" style={{ marginRight: 4 }}>
        Pages
      </span>
      {project.pages.map((page, i) => (
        <div key={page.id} className={`page-chip ${i === activePage ? 'active' : ''}`}>
          <button className="btn ghost sm" onClick={() => void gotoPage(i)} title={`${page.width}×${page.height}`}>
            {i + 1}. {page.name}
          </button>
          <button className="btn ghost sm" title="Move left" disabled={i === 0} onClick={() => movePage(i, i - 1)}>
            ‹
          </button>
          <button
            className="btn ghost sm"
            title="Move right"
            disabled={i === project.pages.length - 1}
            onClick={() => movePage(i, i + 1)}
          >
            ›
          </button>
          <button className="btn ghost sm" title="Duplicate page" onClick={() => void duplicatePage(i)}>
            <Icon name="copy" size={13} />
          </button>
          <button className="btn ghost sm danger" title="Delete page" onClick={() => void deletePage(i)}>
            <Icon name="trash" size={13} />
          </button>
        </div>
      ))}
      <button className="btn sm" onClick={() => void addPage()}>
        <Icon name="plus" size={13} /> Add page
      </button>
    </div>
  );
}
