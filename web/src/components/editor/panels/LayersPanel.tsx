'use client';

import { useState } from 'react';
import { Eye, EyeOff, Lock, Unlock, ChevronRight, ChevronDown, Trash2, Copy, Group, Ungroup } from 'lucide-react';
import { useEditor } from '@/store/editor';
import type { SceneNode } from '@/engine/types';

const TYPE_GLYPH: Record<string, string> = {
  frame: '▭',
  group: '❏',
  rect: '▬',
  ellipse: '◯',
  text: 'T',
  image: '🖼',
  video: '▶',
  svg: '✦',
  sticker: '✦',
  chart: '📊',
  table: '▦',
  line: '━',
  arrow: '➜',
  star: '★',
  polygon: '⬠',
  path: '⌇',
};

export function LayersPanel() {
  const doc = useEditor((s) => s.doc);
  const activePage = useEditor((s) => s.activePage);
  const selection = useEditor((s) => s.selection);
  const setSelection = useEditor((s) => s.setSelection);
  const toggleSelection = useEditor((s) => s.toggleSelection);
  const setHovered = useEditor((s) => s.setHovered);
  const toggleLock = useEditor((s) => s.toggleLock);
  const toggleVisible = useEditor((s) => s.toggleVisible);
  const deleteNodes = useEditor((s) => s.deleteNodes);
  const duplicateNodesById = useEditor((s) => s.duplicateNodesById);
  const groupSelection = useEditor((s) => s.groupSelection);
  const ungroupSelection = useEditor((s) => s.ungroupSelection);
  const zMove = useEditor((s) => s.zMove);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const page = doc.pages[activePage];
  if (!page) return null;

  const toggleCollapse = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="flex h-full flex-col">
      {selection.length ? (
        <div className="flex items-center gap-1 border-b p-2" style={{ borderColor: 'var(--border)' }}>
          <IconAction icon={<Copy size={12} />} label="Duplicate" onClick={() => duplicateNodesById(selection)} />
          <IconAction icon={<Group size={12} />} label="Group" onClick={groupSelection} />
          <IconAction icon={<Ungroup size={12} />} label="Ungroup" onClick={ungroupSelection} />
          <IconAction icon={<ChevronDown size={12} />} label="Send backward" onClick={() => zMove('backward')} />
          <IconAction icon={<ChevronRight size={12} />} label="Bring forward" onClick={() => zMove('forward')} />
          <IconAction icon={<Trash2 size={12} />} label="Delete" danger onClick={() => deleteNodes(selection)} />
        </div>
      ) : null}

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-1.5">
        {[...page.nodes].reverse().map((node) => (
          <LayerRow
            key={node.id}
            node={node}
            depth={0}
            selection={selection}
            collapsed={collapsed}
            onToggleCollapse={toggleCollapse}
            onSelect={(event) => (event.shiftKey ? toggleSelection(node.id) : setSelection([node.id]))}
            onHover={setHovered}
            onToggleLock={() => toggleLock([node.id])}
            onToggleVisible={() => toggleVisible([node.id])}
          />
        ))}
        {page.nodes.length === 0 ? (
          <p className="p-4 text-center text-[12px]" style={{ color: 'var(--text-faint)' }}>
            This page is empty. Add elements from the left panel.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function LayerRow({
  node,
  depth,
  selection,
  collapsed,
  onToggleCollapse,
  onSelect,
  onHover,
  onToggleLock,
  onToggleVisible,
}: {
  node: SceneNode;
  depth: number;
  selection: string[];
  collapsed: Set<string>;
  onToggleCollapse: (id: string) => void;
  onSelect: (event: React.MouseEvent) => void;
  onHover: (id: string | null) => void;
  onToggleLock: () => void;
  onToggleVisible: () => void;
}) {
  const isOpen = !collapsed.has(node.id);
  const hasChildren = !!node.children?.length;
  const selected = selection.includes(node.id);

  return (
    <div>
      <div
        onMouseEnter={() => onHover(node.id)}
        onMouseLeave={() => onHover(null)}
        onClick={onSelect}
        className="group flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 text-[12px]"
        style={{
          paddingInlineStart: 6 + depth * 12,
          background: selected ? 'var(--bg-active)' : 'transparent',
          color: selected ? 'var(--text)' : 'var(--text-muted)',
        }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onToggleCollapse(node.id);
            }}
            className="grid h-4 w-4 place-items-center"
            style={{ color: 'var(--text-faint)' }}
          >
            {isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          </button>
        ) : (
          <span className="w-4" />
        )}

        <span className="w-4 text-center text-[11px]" style={{ color: 'var(--text-faint)' }}>
          {TYPE_GLYPH[node.type] ?? '▪'}
        </span>

        <span className="min-w-0 flex-1 truncate">{node.name || node.type}</span>

        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onToggleLock();
          }}
          className="opacity-0 transition-opacity group-hover:opacity-100"
          style={{ color: node.locked ? 'var(--warning)' : 'var(--text-faint)' }}
          aria-label={node.locked ? 'Unlock' : 'Lock'}
        >
          {node.locked ? <Lock size={11} /> : <Unlock size={11} />}
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onToggleVisible();
          }}
          className="opacity-0 transition-opacity group-hover:opacity-100"
          style={{ color: node.visible ? 'var(--text-faint)' : 'var(--danger)' }}
          aria-label={node.visible ? 'Hide' : 'Show'}
        >
          {node.visible ? <Eye size={11} /> : <EyeOff size={11} />}
        </button>
      </div>

      {hasChildren && isOpen
        ? [...node.children!].reverse().map((child) => (
            <LayerRow
              key={child.id}
              node={child}
              depth={depth + 1}
              selection={selection}
              collapsed={collapsed}
              onToggleCollapse={onToggleCollapse}
              onSelect={onSelect}
              onHover={onHover}
              onToggleLock={() => onToggleLock()}
              onToggleVisible={() => onToggleVisible()}
            />
          ))
        : null}
    </div>
  );
}

function IconAction({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="grid h-6 w-6 place-items-center rounded-md hover:bg-[var(--bg-hover)]"
      style={{ color: danger ? 'var(--danger)' : 'var(--text-muted)' }}
    >
      {icon}
    </button>
  );
}
