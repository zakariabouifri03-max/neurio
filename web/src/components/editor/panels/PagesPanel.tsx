'use client';

import { Plus, Copy, Trash2, ChevronUp, ChevronDown } from 'lucide-react';
import { useEditor } from '@/store/editor';
import { TemplatePreview } from '@/components/template/TemplatePreview';
import { Button } from '@/components/ui';

export function PagesPanel({ vertical = false }: { vertical?: boolean }) {
  const doc = useEditor((s) => s.doc);
  const activePage = useEditor((s) => s.activePage);
  const setActivePage = useEditor((s) => s.setActivePage);
  const addPage = useEditor((s) => s.addPage);
  const duplicatePage = useEditor((s) => s.duplicatePage);
  const deletePage = useEditor((s) => s.deletePage);
  const movePage = useEditor((s) => s.movePage);

  return (
    <div className={vertical ? 'scroll-thin flex h-full flex-col gap-2 overflow-y-auto p-3' : 'flex items-end gap-3'}>
      {doc.pages.map((page, index) => {
        const active = index === activePage;
        return (
          <div key={page.id} className={vertical ? 'relative' : 'relative shrink-0'}>
            <button
              type="button"
              onClick={() => setActivePage(index)}
              className="block rounded-lg p-1 transition-transform hover:-translate-y-0.5"
              style={{
                border: `1px solid ${active ? 'var(--brand)' : 'var(--border)'}`,
                background: active ? 'var(--brand-soft)' : 'var(--bg-panel)',
              }}
            >
              <TemplatePreview page={page} width={vertical ? 150 : 96} />
              <div className="px-1 pb-0.5 pt-1 text-[10.5px]" style={{ color: 'var(--text-muted)' }}>
                {index + 1}. {page.name || 'Page'}
              </div>
            </button>

            {active ? (
              <div className={vertical ? 'mt-1 flex justify-end gap-1' : 'absolute -top-7 end-0 flex gap-1'}>
                <IconAction icon={<ChevronUp size={11} />} label="Move up" disabled={index === 0} onClick={() => movePage(index, index - 1)} />
                <IconAction
                  icon={<ChevronDown size={11} />}
                  label="Move down"
                  disabled={index === doc.pages.length - 1}
                  onClick={() => movePage(index, index + 1)}
                />
                <IconAction icon={<Copy size={11} />} label="Duplicate page" onClick={() => duplicatePage(index)} />
                <IconAction
                  icon={<Trash2 size={11} />}
                  label="Delete page"
                  danger
                  disabled={doc.pages.length <= 1}
                  onClick={() => {
                    if (window.confirm(`Delete “${page.name}”?`)) deletePage(index);
                  }}
                />
              </div>
            ) : null}
          </div>
        );
      })}

      {vertical ? (
        <Button variant="secondary" size="sm" icon={<Plus size={13} />} onClick={() => addPage(true)} className="w-full">
          Add page
        </Button>
      ) : (
        <button
          type="button"
          onClick={() => addPage(true)}
          className="grid h-[68px] w-[54px] shrink-0 place-items-center rounded-lg"
          style={{ border: '1px dashed var(--border)', color: 'var(--text-muted)' }}
          aria-label="Add page"
        >
          <Plus size={16} />
        </button>
      )}
    </div>
  );
}

function IconAction({
  icon,
  label,
  onClick,
  disabled,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="grid h-6 w-6 place-items-center rounded-md disabled:opacity-40"
      style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: danger ? 'var(--danger)' : 'var(--text-muted)' }}
    >
      {icon}
    </button>
  );
}
