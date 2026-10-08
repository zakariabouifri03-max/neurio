import React, { useState } from 'react';
import { engine } from '@/editor/engine';
import { useEditor } from '@/state/editorStore';
import { Empty } from '@/components/common/ui';
import { Icon } from '@/components/common/Icons';
import type { LayerInfo } from '@/types';

export function LayersPanel() {
  const layers = useEditor((s) => s.layers);
  const sync = useEditor((s) => s.syncFromEngine);
  const [renaming, setRenaming] = useState<string | null>(null);

  if (!layers.length) return <Empty text="No layers yet. Add text, shapes or images to begin." />;

  const Row = ({ layer, depth }: { layer: LayerInfo; depth: number }) => (
    <>
      <div
        className={`layer ${layer.selected ? 'selected' : ''}`}
        style={{ marginLeft: depth * 12 }}
        onClick={(e) => {
          engine.selectLayer(layer.id, e.shiftKey);
          sync();
        }}
      >
        <button
          className="btn ghost sm"
          title={layer.visible ? 'Hide layer' : 'Show layer'}
          onClick={(e) => {
            e.stopPropagation();
            engine.toggleLayerVisible(layer.id);
            sync();
          }}
        >
          <Icon name={layer.visible ? 'eye' : 'eyeOff'} size={14} />
        </button>
        <button
          className="btn ghost sm"
          title={layer.locked ? 'Unlock layer' : 'Lock layer'}
          onClick={(e) => {
            e.stopPropagation();
            engine.toggleLayerLock(layer.id);
            sync();
          }}
        >
          <Icon name={layer.locked ? 'lock' : 'unlock'} size={14} />
        </button>
        {renaming === layer.id ? (
          <input
            className="input"
            style={{ padding: '2px 6px' }}
            autoFocus
            defaultValue={layer.name}
            onBlur={(e) => {
              engine.renameLayer(layer.id, e.target.value || layer.name);
              setRenaming(null);
              sync();
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        ) : (
          <span className="name" onDoubleClick={() => setRenaming(layer.id)} title="Double-click to rename">
            {layer.name}
            {layer.isGroup ? ' ▾' : ''}
          </span>
        )}
      </div>
      {layer.children?.map((c) => <Row key={c.id} layer={c} depth={depth + 1} />)}
    </>
  );

  const selected = layers.find((l) => l.selected);

  return (
    <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
      {layers.map((l) => (
        <Row key={l.id} layer={l} depth={0} />
      ))}
      <div className="row" style={{ marginTop: 10, flexWrap: 'wrap' }}>
        <button
          className="btn sm"
          disabled={!selected}
          onClick={() => {
            if (selected) void engine.duplicateLayer(selected.id).then(sync);
          }}
        >
          Duplicate
        </button>
        <button
          className="btn sm"
          disabled={!selected}
          onClick={() => {
            if (selected) {
              engine.removeLayer(selected.id);
              sync();
            }
          }}
        >
          Delete
        </button>
        <button className="btn sm" disabled={!selected} onClick={() => selected && engine.reorder(selected.id, 'up')}>
          ↑
        </button>
        <button className="btn sm" disabled={!selected} onClick={() => selected && engine.reorder(selected.id, 'down')}>
          ↓
        </button>
        <button className="btn sm" disabled={!selected} onClick={() => selected && engine.reorder(selected.id, 'front')}>
          Front
        </button>
        <button className="btn sm" disabled={!selected} onClick={() => selected && engine.reorder(selected.id, 'back')}>
          Back
        </button>
      </div>
    </div>
  );
}
